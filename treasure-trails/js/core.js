/* =========================================================================
 * 三路尋寶——對局核心（可移植層，零 DOM）
 *
 * 對外：DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, now, wallet, keyPrefix, mapSource(seed) }
 *   game：bet(route, stake) / ack() / getState() / clearSaved() / addMoney(n) / on(fn) /
 *         setRng(fn) / getRng() / devSetMap(seed)（Demo／導演台專用，不在預設介面露出）
 * 事件（on(fn(type, data))）：
 *   wallet  { wallet }                                    餘額變動（扣注、派彩、重置）
 *   result  { orderId, route, choice, stake, result, win, total, totalX }
 *                                                         結果已先定，交給 UI 演出（result 見下）
 *   settled { orderId, route, choice, stake, win, total, totalX, payout, net, wallet, restored, rec }
 *   map     { map, seed }                                 結算後換上的下一張地圖（開局、重整接回不發）
 *   error   { msg }
 * 流程：BET —bet→ ANIM（結果已抽定、押額已扣）—ack→ BET（派彩入帳、換下一張地圖）
 *   UI 演完才呼叫 ack()；核心不自帶動畫計時。
 *   目前這張地圖是遊戲狀態的一部分：由種子產生、存進存檔，未下注重整＝同一張圖；
 *   不提供「不下注就換一張」的入口。演出中重整＝直接結算、地圖換新（結果已定，不重演、不重抽）。
 *
 * 地圖 map：{ seed, routes:[ route×3（穩／中／拚）] }；route：{ id, index, hearts, shape, tpl, nodes[] }；
 *   node：{ id, route, idx, kind:'enemy'|'prize', need（enemy：兩顆骰和 ≥ need 才贏）, v／tier／role（prize） }
 *
 * 結果物件 result（UI 只讀它就能演；節拍歸 UI，沒有毫秒）：
 *   route 'safe'|'mid'|'risk'、routeIndex、stake、hearts（起始心數）、heartsLeft（結束時剩幾顆）、
 *   total（金額）、totalX（倍率合計）、reachedEnd（走到底＝true；心扣完撤退＝false）
 *   prizes  [{ id, idx, v, tier, amount, n, cum }]  依序收下的寶物（amount＝這顆的金額、cum＝累計）
 *   fights  [{ enemyId, idx, need, dice:[a,b], sum, win, heartsLeft }]  每一擲（打輸後留在原地再擲，同一隻會有多筆）
 *   events  依序：move { from, to }（from＝-1 是入口；to＝節點 idx）／prize { id, idx, v, tier, amount, cum }／
 *           roll { enemyId, idx, need, dice, sum, win, heartsLeft }／retreat { at, heartsLeft:0 }（心扣完撤退，at＝敵人 idx）／
 *           end { reachedEnd, total, totalX }（一定是最後一筆）
 *   map、mapSeed  這局用的地圖（不寫進存檔與注單）
 *
 * 換玩法時只改下面 RULES 這一段，其餘（錢包、狀態機、注單、存檔、事件）不動。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * ========================================================================= */
var DemoCore = (function(){

/* ---------- 規則：只有這幾個函式認識玩法 ---------- */
var RULES = {
  validChoice: function(c){ return EV.ids().indexOf(c) >= 0; },
  validStake:  function(s){ return EV.CFG.STAKES.indexOf(s) >= 0; },
  /* 先抽定結果：在目前地圖上照真實流程走完（遇敵就擲兩顆骰，各自均勻 1～6，和 ≥ need 贏，
   * 輸了扣一顆心留在原地再擲，心 0 撤退）。骰子只吃 rng，不看餘額、不看局面。 */
  draw:        function(map, choice, stake, rng){ return simulate(map, EV.routeIndex(choice), stake, rng); },
  /* 每顆寶物的金額：倍率 × 注額，逐顆取整（一局拿回＝各顆金額相加） */
  prizeAmount: function(stake, mult){ return EV.payoutFloor(stake, mult); }
};

function rollDie(rng){ return 1 + Math.floor(rng() * EV.CFG.FACES); }

/* ---------- 玩一局：結果與事件表一次算完 ---------- */
function simulate(map, ri, stake, rng){
  var route = map.routes[ri], N = route.nodes, ev = [], fights = [], prizes = [];
  var left = route.hearts, reached = true, pos = -1, cum = 0, sumX = 0;
  for(var i = 0; i < N.length; i++){
    var n = N[i];
    ev.push({ k:'move', from:pos, to:i });
    pos = i;
    if(n.kind === 'prize'){
      var amt = RULES.prizeAmount(stake, n.v);
      cum += amt; sumX = EV.r2(sumX + n.v);
      var p = { id:n.id, idx:i, v:n.v, tier:n.tier, amount:amt, n:prizes.length + 1, cum:cum };
      prizes.push(p);
      ev.push({ k:'prize', id:n.id, idx:i, v:n.v, tier:n.tier, amount:amt, cum:cum });
      continue;
    }
    for(;;){                                              // 同一隻：打贏才前進，打輸扣心再打
      var a = rollDie(rng), b = rollDie(rng), sum = a + b, win = sum >= n.need;
      if(!win) left--;
      fights.push({ enemyId:n.id, idx:i, need:n.need, dice:[a, b], sum:sum, win:win, heartsLeft:left });
      ev.push({ k:'roll', enemyId:n.id, idx:i, need:n.need, dice:[a, b], sum:sum, win:win, heartsLeft:left });
      if(win) break;
      if(left <= 0){ reached = false; break; }
    }
    if(!reached){ ev.push({ k:'retreat', at:i, heartsLeft:0 }); break; }
  }
  ev.push({ k:'end', reachedEnd:reached, total:cum, totalX:sumX });
  return { route:route.id, routeIndex:ri, stake:stake, hearts:route.hearts, heartsLeft:left,
           total:cum, totalX:sumX, reachedEnd:reached,
           prizes:prizes, fights:fights, events:ev, map:map, mapSeed:map.seed };
}

/* 注單摘要（不含地圖；留 200 筆）；rolls 緊湊格式：[need, a, b, win(1|0)] */
function summarize(st, total){
  var r = st.result, mults = r.prizes.map(function(p){ return p.v; }), mx = 0;
  mults.forEach(function(m){ if(m > mx) mx = m; });
  return { orderId:st.orderId, ts:st.ts, route:st.route, choice:st.route, stake:st.stake,
           payout:total, win:total > 0, totalX:r.totalX,
           nPrizes:mults.length, nRolls:r.fights.length, heartsLeft:r.heartsLeft, reachedEnd:r.reachedEnd,
           maxX:mx, mults:mults,
           rolls:r.fights.map(function(f){ return [f.need, f.dice[0], f.dice[1], f.win ? 1 : 0]; }) };
}

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || Math.random;
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;
  var mapSrc = opts.mapSource || EV.genMapSeed;       // 種子→地圖（測試可換成預先產好的地圖池，加速大量模擬）

  var wallet = startWallet;
  var records = [];                       // 已結注單摘要（核心留 200 筆）
  var st = null;                          // 進行中的一單（結果已定）
  var phase = 'BET';                      // BET | ANIM
  var seq = 0;                            // 注單流水號（存檔）
  var subs = [];
  var mapSeed = 0, map = null;            // 目前這張地圖（種子存檔，圖由種子重建）

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
  function newSeed(){ return Math.floor(rng() * 4294967296) >>> 0; }
  function useMap(seed){ mapSeed = seed >>> 0; map = mapSrc(mapSeed); }

  /* ---------- 存檔／接回 ---------- */
  function save(){
    if(!store) return;
    var pend = null;
    if(st){
      var rs = {}, k;
      for(k in st.result) if(k !== 'map') rs[k] = st.result[k];     // 地圖由種子重建，不存
      pend = { orderId:st.orderId, ts:st.ts, route:st.route, stake:st.stake, total:st.total,
               mapSeed:st.mapSeed, result:rs };
    }
    try{
      store.setItem(KEY, JSON.stringify({ v:3, wallet:wallet, seq:seq, records:records,
        mapSeed:mapSeed, pending:pend }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== 3) return;                                      // 舊版（岔路版 v2）存檔忽略
    wallet = d.wallet; seq = d.seq || 0; records = d.records || [];
    if(typeof d.mapSeed === 'number') useMap(d.mapSeed);
    if(d.pending){ st = d.pending; phase = 'ANIM'; settle(true); }   // 演出中重整＝直接結算、地圖換新
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
    if(typeof stake !== 'number' || !RULES.validStake(stake)) return fail('注額不合法');
    if(stake > wallet) return fail('餘額不足');
    var ts = now();
    wallet -= stake;
    var res = RULES.draw(map, choice, stake, rng);        // 結果先定，之後 UI 只負責演
    st = { orderId:newOrderId(ts), ts:ts, route:choice, stake:stake, total:res.total,
           mapSeed:mapSeed, result:res };
    phase = 'ANIM';
    save();
    emit('wallet', { wallet:wallet });
    emit('result', { orderId:st.orderId, route:choice, choice:choice, stake:stake, result:res,
                     win:res.total > 0, total:res.total, totalX:res.totalX });
    return true;
  }

  function ack(){                                        // UI 演出完成的結算點
    if(phase !== 'ANIM') return fail('非演出結算點');
    settle(false);
    return true;
  }

  function settle(restored){
    var pay = st.total;                                   // 結果先定：結算只認抽定時的總額
    wallet += pay;
    var rec = summarize(st, pay);
    records.push(rec);
    if(records.length > EV.CFG.REC_CAP) records.splice(0, records.length - EV.CFG.REC_CAP);
    st = null; phase = 'BET';
    useMap(newSeed());                                    // 結算後才換下一張地圖
    save();
    emit('settled', { orderId:rec.orderId, route:rec.route, choice:rec.route, stake:rec.stake,
      win:rec.win, total:pay, totalX:rec.totalX, payout:pay, net:pay - rec.stake, wallet:wallet,
      restored:!!restored, rec:rec });
    emit('wallet', { wallet:wallet });
    emit('map', { map:map, seed:mapSeed });
  }

  function getState(){
    return { phase:phase, wallet:wallet, map:map, mapSeed:mapSeed,
             st: st ? { orderId:st.orderId, route:st.route, stake:st.stake, total:st.total,
                        win:st.total > 0, result:st.result } : null,
             records: records.slice(-20) };
  }

  function clearSaved(){                                  // 錢包重置（演出中不可；地圖保留）
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

  function devSetMap(seed){                               // 導演台／測試：指定地圖種子（演出中不可）
    if(st) return fail('對局中不可換圖');
    useMap(seed); save();
    emit('map', { map:map, seed:mapSeed });
    return true;
  }

  restore();
  if(!map) useMap(newSeed());                             // 全新開局（沒存檔）才抽一張
  if(!store || !store.getItem(KEY)) save();               // 讓「未下注重整＝同一張圖」從第一張就成立
  return { bet:bet, ack:ack, getState:getState, clearSaved:clearSaved, addMoney:addMoney,
           devSetMap:devSetMap,
           on:function(fn){ subs.push(fn); },
           setRng:function(fn){ rng = fn; },
           getRng:function(){ return rng; } };
}

return { createGame:createGame, RULES:RULES, simulate:simulate, summarize:summarize,
         makeRng:function(seed){ return EV.mulberry32(seed); } };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
