/* =========================================================================
 * 連鎖開箱——對局核心（可移植層，零 DOM）
 *
 * 對外：DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, now, wallet, keyPrefix }
 *   game：bet(choice, stake) / ack() / getState() / clearSaved() / addMoney(n) / on(fn) /
 *         setRng(fn) / getRng()
 *   choice＝檔位 id（EV.ids()：'stable'／'mid'／'wild'）；stake＝注額（正整數，不超過錢包）。
 * 其他匯出：DemoCore.rollRound／findGroups／makeRng（純函式，tune／測試直接用）、RULES。
 *
 * 事件（on(fn(type, data))）：
 *   wallet  { wallet }                                      餘額變動（扣注、派彩、重置）
 *   result  { orderId, choice, stake, result, win, odds }   結果已先定，交給 UI 演出
 *   settled { orderId, choice, stake, result, win, odds, payout, net, wallet, restored, record }
 *   error   { msg }
 *   result／結果物件（rollRound 回傳）的欄位見 rollRound 上方註解。win＝總賠 > 注額；odds＝總賠÷注額。
 * 流程：BET —bet→ ANIM（結果已抽定、押額已扣）—ack→ BET（派彩入帳）
 *   UI 演完才呼叫 ack()；核心不自帶動畫計時。
 * 重整接回：演出中重整＝直接結算（存檔裡的結果已定，不重演、不重抽）。
 * 存檔：進行中那一單存完整結果；已結注單（留 200 筆）只存摘要，不存盤面與步驟。
 *
 * 換玩法時只改下面 RULES 這一段（與其上的純函式），其餘（錢包、狀態機、注單、存檔、事件）不動。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * 沒有任何依餘額或局面調整機率的東西：結果只由 rng 與檔位決定。
 * ========================================================================= */
var DemoCore = (function(){

/* ---------- 純函式：亂數、找片、整局計算 ---------- */

/* 可播種亂數（mulberry32）：測試與模擬用；遊戲預設用 Math.random */
function makeRng(seed){
  var a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 找出盤面上所有「同色相連 ≥ min」的片。箱子值 v = kind | (gold ? 8 : 0)；格序 i = row*COLS + col（row 0 在最上）。 */
function findGroups(b, C, R, min){
  var N = C * R, seen = new Uint8Array(N), out = [], st = [], i;
  for(i = 0; i < N; i++){
    if(seen[i]) continue;
    var k = b[i] & 7, cells = [], golds = 0;
    st.length = 0; st.push(i); seen[i] = 1;
    while(st.length){
      var x = st.pop();
      cells.push(x);
      if(b[x] & 8) golds++;
      var r = (x / C) | 0, c = x % C, y;
      if(r > 0)     { y = x - C; if(!seen[y] && (b[y] & 7) === k){ seen[y] = 1; st.push(y); } }
      if(r < R - 1) { y = x + C; if(!seen[y] && (b[y] & 7) === k){ seen[y] = 1; st.push(y); } }
      if(c > 0)     { y = x - 1; if(!seen[y] && (b[y] & 7) === k){ seen[y] = 1; st.push(y); } }
      if(c < C - 1) { y = x + 1; if(!seen[y] && (b[y] & 7) === k){ seen[y] = 1; st.push(y); } }
    }
    if(cells.length >= min) out.push({ cells:cells, kind:k, size:cells.length, golds:golds });
  }
  return out;
}

/* 先把整局算完：初始盤面、每次連鎖（哪些片爆、賠多少、怎麼掉）、結尾盤面、差一個的片。演出只讀這個結果。
 * lean＝true 只省略演出用的紀錄（盤面副本、掉落表、各片賠付分攤），邏輯與亂數消耗完全相同，模擬用；
 * lean＝2 連「差一點」(near) 也不算（校表專用，只要 w）。
 *
 * 結果物件：
 *   tier      檔位索引（0 穩／1 中／2 拚）          tierId   檔位 id
 *   bet       注額                                 total    總賠（整數；已含取整與單局上限）
 *   totalX    total ÷ bet                          chains   連鎖次數（＝steps.length，0＝沒連到）
 *   maxSize   整局出現過的最大片（沒連鎖＝0）        hasGold  有沒有爆過含金箱的片
 *   capped    是否撞到單局 500 倍上限                chainCapped 是否連鎖滿 30 次
 *   w         7 格：各片大小(4..10+)的「倍率加權次數」（校賠率用，與賠率表無關）
 *   init      初始盤面（長度 COLS×ROWS 的陣列，值＝kind | (金箱 ? 8 : 0)）
 *   final     結尾盤面（同格式）
 *   steps[]   每一次連鎖：
 *     chain 0 起算的連鎖序；mult 本次連鎖倍率（階梯）；pay 本步賠付；cum 累計賠付
 *     clusters[] 本步爆開的各片：{ cells[格序], kind, size, golds, mult(＝連鎖倍率×金箱倍率), pay }
 *       （同一步各片 pay 加總＝step.pay；各步 pay 加總＝total）
 *     moves[]   [from, to]：既有箱子往下掉（格序）；spawns[]  { to, v, fromRow }：頂端補入的新箱
 *               （fromRow 為負，代表從盤面上方 |fromRow| 格外落入）
 *   near[]    結尾盤面上大小＝3 的同色片：{ cells, kind, size:3, golds, nextMult }
 *             nextMult＝若再連一次會套用的連鎖倍率（階梯，不含金箱）
 * 注意：init／final／steps 在 lean 為 null／[]（steps 仍有 clusters 但無 moves／spawns）。 */
function rollRound(tierIdx, bet, rnd, lean){
  var CFG = EV.CFG, T = EV.TIERS[tierIdx], K = T.kinds, C = CFG.COLS, R = CFG.ROWS, N = C * R;
  var goldP = CFG.GOLD_P, minG = CFG.MIN_GROUP, sizeMax = CFG.MAX_SIZE;
  function draw(){ var k = Math.floor(rnd() * K); return rnd() < goldP ? (k | 8) : k; }
  var b = new Array(N), i, c, r, g, j;
  for(i = 0; i < N; i++) b[i] = draw();
  var init = lean ? null : b.slice();
  var steps = [];
  var cumRaw = 0, cumInt = 0, maxSize = 0, hasGold = false, capped = false;
  var w = [0, 0, 0, 0, 0, 0, 0];
  for(var chain = 0; chain < CFG.MAX_CHAIN; chain++){
    var groups = findGroups(b, C, R, minG);
    if(!groups.length) break;
    var lm = T.ladder[Math.min(chain, T.ladder.length - 1)];
    var stepRaw = 0;
    for(j = 0; j < groups.length; j++){
      g = groups[j];
      var mult = lm * Math.pow(CFG.GOLD_MULT, g.golds), si = Math.min(g.size, sizeMax) - minG;
      g.mult = mult;
      g.raw = T.pay[si] * mult;
      stepRaw += g.raw;
      w[si] += mult;
      if(g.size > maxSize) maxSize = g.size;
      if(g.golds) hasGold = true;
    }
    if(cumRaw + stepRaw > CFG.MAX_WIN_X) capped = true;
    var newRaw = Math.min(cumRaw + stepRaw, CFG.MAX_WIN_X);
    var newInt = Math.round(bet * newRaw);
    var stepPay = newInt - cumInt;
    if(!lean){
      // 把這一步的賠付按各片比例分攤（累進取整，加總必等於 stepPay）
      var acc = 0, accInt = 0;
      for(j = 0; j < groups.length; j++){
        g = groups[j];
        acc += g.raw;
        var t = stepRaw > 0 ? Math.round(stepPay * acc / stepRaw) : 0;
        g.pay = t - accInt; accInt = t;
        delete g.raw;
      }
    }
    cumRaw = newRaw; cumInt = newInt;
    var step = { chain:chain, mult:lm, clusters:groups, pay:stepPay, cum:cumInt };
    // 爆開 → 上方下落 → 頂端補新箱
    var pop = new Uint8Array(N);
    for(j = 0; j < groups.length; j++){ var cl = groups[j].cells; for(var q = 0; q < cl.length; q++) pop[cl[q]] = 1; }
    var moves = lean ? null : [], spawns = lean ? null : [];
    for(c = 0; c < C; c++){
      var wr = R - 1;
      for(r = R - 1; r >= 0; r--){
        var idx = r * C + c;
        if(pop[idx]) continue;
        if(!lean && wr !== r) moves.push([idx, wr * C + c]);
        b[wr * C + c] = b[idx];
        wr--;
      }
      var n = wr + 1;
      for(r = n - 1; r >= 0; r--){
        var v = draw();
        b[r * C + c] = v;
        if(!lean) spawns.push({ to:r * C + c, v:v, fromRow:r - n });
      }
    }
    if(!lean){ step.moves = moves; step.spawns = spawns; }
    steps.push(step);
  }
  var chains = steps.length, near = [];
  if(lean !== 2){
    var nm = T.ladder[Math.min(chains, T.ladder.length - 1)];
    var ng = findGroups(b, C, R, minG - 1);
    for(j = 0; j < ng.length; j++){
      if(ng[j].size === minG - 1) near.push({ cells:ng[j].cells, kind:ng[j].kind, size:ng[j].size, golds:ng[j].golds, nextMult:nm });
    }
  }
  return { tier:tierIdx, tierId:T.id, bet:bet, init:init, steps:steps, final:lean ? null : b.slice(), near:near,
           w:w, total:cumInt, totalX:cumInt / bet, chains:chains, maxSize:maxSize, hasGold:hasGold,
           capped:capped, chainCapped:chains >= CFG.MAX_CHAIN };
}

/* ---------- 規則：只有這三個函式認識玩法 ---------- */
var RULES = {
  validChoice: function(c){ return EV.tierIndex(c) >= 0; },
  draw:        function(rng, choice, stake){                        // 先抽定整局結果
    return rollRound(EV.tierIndex(choice), stake, rng, false);
  },
  payout:      function(choice, stake, result){ return result.total; }   // 總賠已含取整與單局上限
};

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || Math.random;
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;

  var wallet = startWallet;
  var records = [];                       // 已結注單（核心留 200 筆；只存摘要）
  var st = null;                          // 進行中的一單
  var phase = 'BET';                      // BET | ANIM
  var seq = 0;                            // 注單流水號（存檔）
  var subs = [];

  function resolveStore(s){
    if(s === false) return null;
    if(s) return s;
    try{ if(typeof localStorage !== 'undefined') return localStorage; }catch(e){}
    return null;
  }
  function emit(type, data){
    for(var i = 0; i < subs.length; i++){ try{ subs[i](type, data || {}); }catch(e){} }
  }
  function fail(msg){ emit('error', { msg:msg }); return false; }

  /* ---------- 存檔／接回 ---------- */
  function save(){
    if(!store) return;
    try{
      store.setItem(KEY, JSON.stringify({ v:2, wallet:wallet, seq:seq,
        records:records, pending:st }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== 2) return;
    wallet = d.wallet; seq = d.seq || 0; records = d.records || [];
    if(d.pending){
      var p = d.pending;
      if(p.result && typeof p.result.total === 'number' && RULES.validChoice(p.choice)){
        st = p; phase = 'ANIM'; settle(true);            // 演出中重整＝直接結算
      }else{
        wallet += (p.stake | 0); save();                 // 壞檔：退還押額，不開局
      }
    }
  }

  /* ---------- 注單號：前綴＋時間（36 進位）＋流水號，同毫秒也不撞 ---------- */
  function newOrderId(ts){
    seq++;
    return String(DEMO_KEY).toUpperCase() + '-' + ts.toString(36).toUpperCase() + '-' +
      ('000' + seq).slice(-4);
  }

  function bet(choice, stake){
    if(phase !== 'BET') return fail('非下注階段');
    if(!RULES.validChoice(choice)) return fail('未知選項');
    stake = Math.floor(stake);
    if(!(stake > 0)) return fail('押額需為正整數');
    if(stake > wallet) return fail('餘額不足');
    var ts = now();
    wallet -= stake;
    var result = RULES.draw(rng, choice, stake);         // 結果先定，之後 UI 只負責演
    st = { orderId:newOrderId(ts), ts:ts, choice:choice, stake:stake, result:result };
    phase = 'ANIM';
    save();
    emit('wallet', { wallet:wallet });
    emit('result', { orderId:st.orderId, choice:choice, stake:stake, result:result,
                     win:result.total > stake, odds:result.totalX });
    return true;
  }

  function ack(){                                        // UI 演出完成的結算點
    if(phase !== 'ANIM') return fail('非演出結算點');
    settle(false);
    return true;
  }

  function settle(restored){
    var res = st.result, pay = RULES.payout(st.choice, st.stake, res);
    wallet += pay;
    // 已結注單只存摘要（不存盤面與步驟）
    var rec = { orderId:st.orderId, ts:st.ts, choice:st.choice, stake:st.stake, payout:pay,
                odds:pay / st.stake, win:pay > st.stake, chains:res.chains,
                maxSize:res.maxSize, gold:!!res.hasGold };
    records.push(rec);
    if(records.length > 200) records.splice(0, records.length - 200);
    st = null; phase = 'BET';
    save();
    emit('settled', { orderId:rec.orderId, choice:rec.choice, stake:rec.stake, result:res,
      win:rec.win, odds:rec.odds, payout:pay, net:pay - rec.stake, wallet:wallet,
      restored:!!restored, record:rec });
    emit('wallet', { wallet:wallet });
  }

  function getState(){
    return { phase:phase, wallet:wallet,
             st: st ? { orderId:st.orderId, choice:st.choice, stake:st.stake, result:st.result } : null,
             records: records.slice(-20) };
  }

  function clearSaved(){                                  // 錢包重置（演出中不可）
    if(st) return fail('對局中不可重置');
    if(store){ try{ store.removeItem(KEY); }catch(e){} }
    wallet = startWallet; records = []; seq = 0; save();
    emit('wallet', { wallet:wallet });
    return true;
  }

  function addMoney(n){                                   // 導演台加錢（Demo 專用）
    if(st) return fail('對局中不可加錢');
    wallet += Math.floor(n); save();
    emit('wallet', { wallet:wallet });
    return true;
  }

  restore();
  return { bet:bet, ack:ack, getState:getState, clearSaved:clearSaved, addMoney:addMoney,
           on:function(fn){ subs.push(fn); },
           setRng:function(fn){ rng = fn; },
           getRng:function(){ return rng; } };
}

return { createGame:createGame, RULES:RULES, rollRound:rollRound, findGroups:findGroups, makeRng:makeRng };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
