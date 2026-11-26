/* =========================================================================
 * 爆金連鎖——對局核心（可移植層，零 DOM）
 *
 * 只包「狀態」：錢包、目前面額、每個面額各一張盤面、注單流水、進行中一單、存檔與接回。
 * 規則（丟一枚、連爆、天降、寶物方向、實付、分級）全部呼叫凍結的 values.js（EV.play／cash／tier），
 * 這裡不重寫規則、不碰任何機率、不自己取亂數（只把 rng 交給 EV.play；一注固定取 2～3 次，見 values.js 檔頭）。
 *
 * 一句話：「一注」＝丟一枚。扣一個面額 → EV.play 算完（含天降）→ 盤面已是新盤面 → UI 演出 → ack() 入帳。
 *
 * ── 公開介面 ───────────────────────────────────────────────────────────
 * DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, now, wallet, keyPrefix }
 *         storage 不給＝localStorage（沒有就不存）；false＝不存。keyPrefix 預設 DEMO_KEY（'burst'）。
 *
 * 動作（回傳 true＝成功；false＝失敗，同時發 error 事件，game.getLastError() 可查）
 *   bet(cellIndex)     丟一枚到第 cellIndex 格（0～24，列優先：row*5+col）。以目前面額為注額。
 *   ack()              UI 演完後呼叫：把拿回金額入帳，回到可下注。核心不自帶計時。
 *   setDenom(di)       換面額（DENOMS 索引）＝切到那張盤面。演出中（ANIM）不可。
 *   clearSaved()       重置：錢包回 10,000、三張盤面回起始盤面（全部「還沒丟過」）、注單清空、面額回預設。演出中不可。
 *   addMoney(n)        導演台加錢（Demo 專用）。演出中不可。
 *   armNext(plan)      導演台：指定「下一注」的結果（EV.scripted 的 plan：{ kind:'coin'|'diamond'|'crown',
 *                      sky:false|true|格號 }，沒給的項照 rng）。只對下一次成功的 bet 生效，用完自動清掉；armNext(null) 取消。
 *                      一般的 rng 注入用 setRng(fn)／getRng()。
 *   on(fn(type, data)) 訂閱事件
 *
 * 查詢（全部唯讀；回傳的盤面都是拷貝，改了不影響核心）
 *   getState()         { phase:'BET'|'ANIM', wallet, denomIndex, denom, board, fresh, glow, canBet,
 *                        st:進行中一單的 result|null, records:最近 20 筆, seq }
 *   getBoard(di?)      該面額「目前」盤面 { h:[25], g:[25][寶物種類清單] }；不給 di＝目前面額。
 *                      演出中（ANIM）回的是「算完後」的盤面（重整接回也是這張）；演出起點看 result.boardBefore。
 *   isFresh(di?)       這張盤面是否還沒丟過（首次進場旗標；重置後全部回 true）
 *   glowCell(di?)      還沒丟過 → 發光格編號（EV.bestCell：起始盤面最會爆的那格）；丟過了 → -1
 *   getDenom()／getDenomIndex()  目前面額金額／索引
 *   getWallet()        錢包（整數）
 *   getRecords(n?)     注單流水（時間順序、最舊在前；不給 n＝全部，核心封頂 200 筆；每筆是「紀錄」，見下）
 *   getPending()       進行中一單的 result（沒有＝null）
 *   getRestored()      建立遊戲時若有「演出中重整」被直接結算，回那一筆紀錄（含 restored:true），否則 null
 *   getLastError()     最近一次失敗 { code, msg }：code ∈ 'phase'（階段不對）｜'cell'（格號不合法）｜'funds'（餘額不足）｜'denom'（面額索引不合法）
 *   canBet()           目前能不能下注（BET 階段且餘額 ≥ 目前面額）
 *
 * 事件（on(fn(type, data))）
 *   wallet  { wallet }                                          餘額變動（扣注、入帳、重置、加錢）
 *   result  { orderId, denomIndex, stake, cell, result, win, payout, mult, tier }
 *                                                               結果已先定（錢已扣、盤面已是新盤面），交給 UI 演出
 *   settled { orderId, denomIndex, stake, cell, payout, net, mult, tier, wallet, restored, rec }
 *                                                               ack 後入帳（restored＝重整接回的直接結算）
 *   denom   { denomIndex, denom }                               換面額
 *   reset   { wallet }                                          重置完成（盤面／面額／錢包都已回初始）
 *   error   { code, msg }
 *
 * ── 一注的結果 result（演出與紀錄頁只讀它；EV.play 的欄位原樣帶入，沒有毫秒）──────────
 *   orderId, ts            注單號、時間戳
 *   denomIndex, stake      面額索引、注額（＝該面額金額；整數）
 *   cell                   玩家丟的格
 *   kind                   丟的是什麼 'coin'|'diamond'|'crown'
 *   main                   玩家那一枚的演出：{ cell, kind, waves, exits:{coin,diamond,crown}, topples, exitCount, pay }
 *                            waves[w] ＝ { cells:[這一波同時炸開的格], exitCount,
 *                                         moves:[{ from, dir(0左1右2上3下), to(-1＝噴出盤面), kind }] }（每格炸 4 筆 moves）
 *                            沒爆＝waves 是空陣列
 *   sky                    天降：null＝沒有；有＝同 main 的形狀（sky.cell＝落點，sky.kind 一定是 'coin'）
 *   hasSky, skyCell        有無天降、落點（沒有＝-1）
 *   exits, enter           噴出盤面各種類枚數（主＋天降合計）、這一注進場各種類枚數
 *   inValue, pay, topples, exitCount   values.js 原值：進場面值／拿回（個面額）／連爆總格數／噴出總枚數
 *   items                  噴出清單（依發生順序：先玩家那一枚的各波、再天降的各波）：
 *                            [{ src:'main'|'sky', wave:波序(0 起), from, dir, kind, amount:該枚實付金額(整數) }]
 *                            Σamount ＝ payout；每枚金額取自 EV.PAY[di]，不另算
 *   payout                 拿回金額（整數；＝EV.cash(play, di)）
 *   mult                   倍數＝拿回幾個面額（＝res.pay；payout ＝ mult×stake）
 *   net                    淨額 payout − stake
 *   tier                   分級 EV.tier：'none'|'back'|'big'|'huge'
 *   quiet                  沒爆也沒天降（topples===0 且沒天降）：UI 可不等演出、立刻 ack()
 *   boardBefore, boardAfter 這一注前後的盤面（拷貝）
 *
 * ── 紀錄 rec（getRecords／settled.rec；一注一筆，不含分波，留 200 筆）────────────────
 *   { orderId, ts, denomIndex, stake, cell, kind, hasSky, skyCell, payout, net, mult, tier, win(payout>0),
 *     exits:{coin,diamond,crown}, exitCount, topples }
 *
 * ── 存檔 ───────────────────────────────────────────────────────────
 *   單一 key：<keyPrefix>.core＝'burst.core'，內容 { v:2, wallet, seq, denom, fresh:[各面額還沒丟過],
 *   boards:[各面額盤面], records, pending:進行中一單（含完整 result）|null }。每次 bet／ack／換面額／重置後整份寫。
 *   重整接回：有 pending＝演出中被重整→直接入帳（結果早已定，不重演、不重抽；盤面本來就存的是算完的盤面）。
 *   壞檔（格式不對、盤面不合法）→ 整份忽略，或該張盤面回起始盤面。
 *
 * 流程：BET —bet→ ANIM（結果已抽定、押額已扣）—ack→ BET（拿回入帳）。「上一單已 ack 才能下一單」。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * ========================================================================= */
var DemoCore = (function(){

var REC_CAP = 200;                      // 核心留的注單筆數

/* ---------- 規則：只有這幾個函式認識玩法，全部轉呼叫 values.js ---------- */
var RULES = {
  validCell:  function(i){ return typeof i === 'number' && i === Math.floor(i) && i >= 0 && i < EV.N; },
  validDenom: function(di){ return typeof di === 'number' && di === Math.floor(di) && di >= 0 && di < EV.CFG.DENOMS.length; },
  play:       function(board, cell, rng){ return EV.play(board, cell, rng); },   // 結果先定；直接改 board
  payout:     function(res, di){ return EV.cash(res, di); },                      // 實付（整數）
  tier:       function(res){ return EV.tier(res); },
  startBoard: function(di){ return EV.startBoard(di); }
};

/* 噴出清單：把各波 moves 裡 to<0 的挑出來，金額取自 EV.PAY（不另算） */
function collectItems(res, di){
  var items = [], pay = EV.PAY[di];
  function scan(part, src){
    if(!part || !part.waves) return;
    for(var w = 0; w < part.waves.length; w++){
      var mv = part.waves[w].moves;
      for(var m = 0; m < mv.length; m++){
        if(mv[m].to < 0) items.push({ src: src, wave: w, from: mv[m].from, dir: mv[m].dir, kind: mv[m].kind, amount: pay[mv[m].kind] });
      }
    }
  }
  scan(res.main, 'main'); scan(res.sky, 'sky');
  return items;
}

function copyExits(e){ return { coin: e.coin, diamond: e.diamond, crown: e.crown }; }

function summarize(r){
  return { orderId: r.orderId, ts: r.ts, denomIndex: r.denomIndex, stake: r.stake, cell: r.cell, kind: r.kind,
           hasSky: r.hasSky, skyCell: r.skyCell, payout: r.payout, net: r.net, mult: r.mult, tier: r.tier,
           win: r.payout > 0, exits: copyExits(r.exits), exitCount: r.exitCount, topples: r.topples };
}

function validBoard(b){
  var N = EV.N, i, q;
  if(!b || !Array.isArray(b.h) || !Array.isArray(b.g) || b.h.length !== N || b.g.length !== N) return false;
  for(i = 0; i < N; i++){
    if(typeof b.h[i] !== 'number' || b.h[i] !== Math.floor(b.h[i]) || b.h[i] < 0 || b.h[i] >= EV.CFG.CAP) return false;
    if(!Array.isArray(b.g[i]) || b.g[i].length > b.h[i]) return false;
    for(q = 0; q < b.g[i].length; q++) if(b.g[i][q] !== 'diamond' && b.g[i][q] !== 'crown') return false;
  }
  return true;
}

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || Math.random;
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;
  var ND = EV.CFG.DENOMS.length;

  var wallet = startWallet;
  var records = [];                       // 已結注單紀錄（核心留 200 筆）
  var st = null;                          // 進行中的一單（結果已定，含完整 result）
  var phase = 'BET';                      // BET | ANIM
  var seq = 0;                            // 注單流水號（存檔）
  var denom = EV.CFG.DENOM_DEFAULT;       // 目前面額索引
  var boards = [], fresh = [];            // 每個面額一張盤面、還沒丟過的旗標
  var nextPlan = null;                    // 導演台指定的下一注結果
  var lastError = null, restoredRec = null;
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
  function fail(code, msg){ lastError = { code: code, msg: msg }; emit('error', { code: code, msg: msg }); return false; }
  function resetBoards(){
    boards = []; fresh = [];
    for(var d = 0; d < ND; d++){ boards.push(RULES.startBoard(d)); fresh.push(true); }
  }

  /* ---------- 存檔／接回 ---------- */
  function save(){
    if(!store) return;
    try{
      store.setItem(KEY, JSON.stringify({ v: 2, wallet: wallet, seq: seq, denom: denom, fresh: fresh,
        boards: boards, records: records, pending: st }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null, i;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== 2 || typeof d.wallet !== 'number' || !isFinite(d.wallet) || !Array.isArray(d.boards)) return;
    wallet = d.wallet; seq = d.seq || 0; records = Array.isArray(d.records) ? d.records : [];
    if(RULES.validDenom(d.denom)) denom = d.denom;
    for(i = 0; i < ND; i++){                                        // 壞掉的盤面只重置那一張
      if(validBoard(d.boards[i])){ boards[i] = d.boards[i]; fresh[i] = !!(d.fresh && d.fresh[i]); }
    }
    if(d.pending && d.pending.result && typeof d.pending.payout === 'number'){
      st = d.pending; phase = 'ANIM'; settle(true);                 // 演出中重整＝直接結算（盤面本來就是算完的）
      restoredRec = records[records.length - 1];
    }
  }

  /* ---------- 注單號：前綴＋時間（36 進位）＋流水號，同毫秒也不撞 ---------- */
  function newOrderId(ts){
    seq++;
    return String(DEMO_KEY).toUpperCase() + '-' + ts.toString(36).toUpperCase() + '-' +
      ('000' + seq).slice(-4);
  }

  function canBet(){ return phase === 'BET' && wallet >= EV.CFG.DENOMS[denom]; }

  function bet(cell){
    if(phase !== 'BET') return fail('phase', '非下注階段');
    if(!RULES.validCell(cell)) return fail('cell', '格號不合法');
    var stake = EV.CFG.DENOMS[denom];
    if(stake > wallet) return fail('funds', '餘額不足');
    var ts = now();
    var board = boards[denom];
    var before = EV.cloneBoard(board);
    wallet -= stake;
    var useRng = nextPlan ? EV.scripted(nextPlan, rng) : rng;
    nextPlan = null;
    var res = RULES.play(board, cell, useRng);                      // 結果先定：一次算完（含天降），board 已是新盤面
    fresh[denom] = false;
    var payout = RULES.payout(res, denom);
    res.orderId = newOrderId(ts); res.ts = ts;
    res.denomIndex = denom; res.stake = stake;
    res.hasSky = !!res.sky; res.skyCell = res.sky ? res.sky.cell : -1;
    res.quiet = res.topples === 0 && !res.sky;
    res.payout = payout; res.mult = res.pay; res.net = payout - stake;
    res.tier = RULES.tier(res);
    res.items = collectItems(res, denom);
    res.boardBefore = before; res.boardAfter = EV.cloneBoard(board);
    st = { orderId: res.orderId, ts: ts, denomIndex: denom, stake: stake, cell: cell, payout: payout, result: res };
    phase = 'ANIM';
    save();
    emit('wallet', { wallet: wallet });
    emit('result', { orderId: res.orderId, denomIndex: denom, stake: stake, cell: cell, result: res,
                     win: payout > 0, payout: payout, mult: res.mult, tier: res.tier });
    return true;
  }

  function ack(){                                                   // UI 演出完成的結算點
    if(phase !== 'ANIM') return fail('phase', '非演出結算點');
    settle(false);
    return true;
  }

  function settle(restored){
    var r = st.result, pay = st.payout;                             // 結果先定：結算只認抽定時的金額
    wallet += pay;
    var rec = summarize(r);
    records.push(rec);
    if(records.length > REC_CAP) records.splice(0, records.length - REC_CAP);
    st = null; phase = 'BET';
    save();
    emit('settled', { orderId: rec.orderId, denomIndex: rec.denomIndex, stake: rec.stake, cell: rec.cell,
      payout: pay, net: rec.net, mult: rec.mult, tier: rec.tier, wallet: wallet, restored: !!restored,
      rec: rec });
    emit('wallet', { wallet: wallet });
  }

  function setDenom(di){
    if(phase !== 'BET') return fail('phase', '演出中不可換面額');
    if(!RULES.validDenom(di)) return fail('denom', '面額不合法');
    denom = di; save();
    emit('denom', { denomIndex: di, denom: EV.CFG.DENOMS[di] });
    return true;
  }

  function dix(di){ return di == null ? denom : di; }
  function getBoard(di){ di = dix(di); return RULES.validDenom(di) ? EV.cloneBoard(boards[di]) : null; }
  function isFresh(di){ di = dix(di); return RULES.validDenom(di) ? !!fresh[di] : false; }
  function glowCell(di){ di = dix(di); return (RULES.validDenom(di) && fresh[di]) ? EV.bestCell(boards[di]) : -1; }

  function getState(){
    return { phase: phase, wallet: wallet, denomIndex: denom, denom: EV.CFG.DENOMS[denom],
             board: EV.cloneBoard(boards[denom]), fresh: !!fresh[denom], glow: glowCell(denom), canBet: canBet(),
             st: st ? st.result : null, records: records.slice(-20), seq: seq };
  }

  function clearSaved(){                                            // 重置：錢包、三張盤面、注單、面額全部回初始（演出中不可）
    if(st) return fail('phase', '對局中不可重置');
    if(store){ try{ store.removeItem(KEY); }catch(e){} }
    wallet = startWallet; records = []; seq = 0; denom = EV.CFG.DENOM_DEFAULT; nextPlan = null;
    resetBoards(); save();
    emit('wallet', { wallet: wallet });
    emit('reset', { wallet: wallet });
    return true;
  }

  function addMoney(n){                                             // 導演台加錢（Demo 專用）
    if(st) return fail('phase', '對局中不可加錢');
    wallet += Math.floor(n); save();
    emit('wallet', { wallet: wallet });
    return true;
  }

  function armNext(plan){ nextPlan = plan || null; return true; }

  resetBoards();
  restore();
  if(store){ var had = null; try{ had = store.getItem(KEY); }catch(e){} if(!had) save(); }   // 未下注重整＝同樣的盤面
  return { bet: bet, ack: ack, setDenom: setDenom, clearSaved: clearSaved, addMoney: addMoney, armNext: armNext,
           getState: getState, getBoard: getBoard, isFresh: isFresh, glowCell: glowCell,
           getDenom: function(){ return EV.CFG.DENOMS[denom]; }, getDenomIndex: function(){ return denom; },
           getWallet: function(){ return wallet; },
           getRecords: function(n){ return (n > 0 ? records.slice(-n) : records.slice()); },
           getPending: function(){ return st ? st.result : null; },
           getRestored: function(){ return restoredRec; },
           getLastError: function(){ return lastError; },
           canBet: canBet,
           on: function(fn){ subs.push(fn); },
           setRng: function(fn){ rng = fn; },
           getRng: function(){ return rng; } };
}

return { createGame: createGame, RULES: RULES };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
