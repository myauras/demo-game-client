/* =========================================================================
 * 專案E「皇帝牌」E02——對局核心（可移植層，零 DOM）
 * 規格：reports/E規格書_v1.html（§Q 裁決：Q1 顯示2位捨去／結算全精度、
 *       Q2 決策倒數10s逾時視同收手、Q3 出牌倒數5s逾時隨機出、N1 修正採用）
 * 數值單點：values.js 之 EV.*（本檔零硬編碼賠率；載入前須先載 values.js）
 *
 * 對外：DuelCore.createGame(opts) → game
 *   opts：{ storage:物件|false, timers:布林, rng, now, wallet, keyPrefix }
 *   game：setMode / bet / play / ack / continueRung / cashOut /
 *         fireTimeout / getState / on / clearSaved
 * 事件：mode / wallet / lock / await / trick / ladder / settle / timeout / error
 * 流程：BET —bet→ [normal]   ANIM(script) —ack→ LADDER｜BET
 *              [advanced] PLAY —play/Q3逾時→ ANIM —ack→ PLAY｜LADDER｜BET
 *       LADDER —continueRung→ 下一階；—cashOut/Q2逾時→ BET；觸頂＝自動結算
 * 演出節奏歸 shell（E03/E04）：核心停在 ANIM 等 shell ack()，不自帶動畫計時。
 * ========================================================================= */
var DuelCore = (function(){
'use strict';
if(typeof EV === 'undefined') throw new Error('DuelCore：請先載入 values.js（EV）');

var R = EV.CFG.CITIZENS + 1;                       // 標準局回合數＝5
var TIMING = { DECIDE_MS: 10000, PLAY_MS: 5000 };  // §Q2/§Q3 裁決秒數（時間常數，非賠率）
var CIT = '民', SP = { emp:'帝', slv:'奴' }, OTHER = { emp:'slv', slv:'emp' };

/* ---------- 取整與顯示（Q1：顯示 2 位無條件捨去＝保守下限；結算全精度） ----------
 * 先四捨到 1e-6 再取整：吃掉浮點雜訊（~1e-8 級），不動真實小數（≥1e-6 級）。 */
function payoutFloor(stake, mult){ return Math.floor(Math.round(stake*mult*1e6)/1e6); }
function floor2(n){ return Math.floor(Math.round(n*1e6)/1e4)/100; }
function fmtX(n){ return floor2(n).toFixed(2); }

/* ---------- 階梯進度條（§7 對數刻度）：0%＝起點、100%＝滿貫線 ---------- */
function railPct(m){
  var lo = EV.CFG.RTP_CASH, hi = EV.CFG.SLAM_LINE;
  return Math.max(0, Math.min(100, Math.log(m/lo)/Math.log(hi/lo)*100));
}

/* ---------- 回合裁決：pc＝玩家（下注側）牌、oc＝對面牌；null＝民民平手 ---------- */
function verdict(pc, oc){
  if(pc===CIT && oc===CIT) return null;
  var win, reason;
  if(pc==='帝'){ if(oc==='奴'){win=false;reason='奴弒帝！';} else {win=true; reason='帝斬民！';} }
  else if(pc==='奴'){ if(oc==='帝'){win=true; reason='奴弒帝！';} else {win=false;reason='民擒奴！';} }
  else { if(oc==='帝'){win=false;reason='帝斬民！';} else {win=true; reason='民擒奴！';} }
  return { win:win, reason:reason };
}

/* ---------- 普通模式腳本（結果反推編排；決勝回合偏後段＝活原型 2/3/4/4/5/5）
 * 牌數自洽修正（E03-R4）：決勝第 5 回合時雙方前四回合已各出 4 張民，
 * 只有「帝奴對撞」湊得出第 5 張——非對撞局（決勝有一側出民）d 上限 4，
 * 否則出民側等於出了第 5 張民（原型同有此漏，觀眾對牌數即可拆穿）。
 * 勝負在 startRung 已抽定，本函數純演出編排，EV 零影響。 ---------- */
function buildScript(side, win, rng){
  var collide = (side==='slv') ? win : !win;         // 對撞＝帝奴同回合（奴弒帝）
  var D = collide ? [2,3,4,4,5,5] : [2,3,4,4];
  var d = D[Math.floor(rng()*D.length)], tricks = [], pc, oc, t;
  for(t=1; t<d; t++) tricks.push({ p:CIT, o:CIT, decisive:false });
  if(side==='slv'){
    if(win){ pc='奴'; oc='帝'; }
    else if(rng()<0.5){ pc='奴'; oc='民'; } else { pc='民'; oc='帝'; }
  }else{
    if(win){ if(rng()<0.5){ pc='帝'; oc='民'; } else { pc='民'; oc='奴'; } }
    else { pc='帝'; oc='奴'; }
  }
  tricks.push({ p:pc, o:oc, decisive:true, verdict:verdict(pc, oc) });
  return tricks;
}

function createGame(opts){
  opts = opts || {};
  var rng  = opts.rng || Math.random;
  var now  = opts.now || function(){ return Date.now(); };
  var useTimers = opts.timers !== false && typeof setTimeout === 'function';
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || 'ecard') + '.core';   // §8：ecard. 前綴避免撞名

  var mode = 'normal';
  var wallet = (opts.wallet != null) ? opts.wallet : 10000;
  var records = [];                                  // 注單（§8 欄位；核心留 200 筆）
  var st = null;                                     // 進行中階梯＋對局
  var phase = 'BET';                                 // BET | PLAY | ANIM | LADDER
  var subs = [], timer = null;

  function resolveStore(s){
    if(s === false) return null;
    if(s) return s;
    try{ if(typeof localStorage !== 'undefined') return localStorage; }catch(e){}
    return null;
  }
  function emit(type, data){
    for(var i=0;i<subs.length;i++){ try{ subs[i](type, data||{}); }catch(e){} }
  }
  function fail(msg){ emit('error', {msg:msg}); return false; }

  /* ---------- 計時（Q2/Q3；shell 讀 st.deadline 畫倒數圈） ---------- */
  function armTimer(ms, which){
    clearT();
    if(st) st.deadline = now() + ms;
    if(useTimers) timer = setTimeout(function(){ timer=null; fireTimeout(which); }, ms);
  }
  function clearT(){
    if(timer){ clearTimeout(timer); timer=null; }
    if(st) st.deadline = null;
  }

  /* ---------- 持久化（重整接回進行中的局；任務卡覆蓋規格§8「不落地」簡化） ---------- */
  function save(){
    if(!store) return;
    try{
      store.setItem(KEY, JSON.stringify({ v:1, wallet:wallet, mode:mode,
        records:records, pending: st ? { phase:phase, st:st } : null }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== 1) return;
    wallet = d.wallet; records = d.records || []; mode = d.mode || 'normal';
    if(d.pending && d.pending.st){
      st = d.pending.st; phase = d.pending.phase;
      if(phase==='ANIM' && mode==='advanced'){ afterAck(); }   // 中斷於演出→邏輯直接推進
      else if(phase==='PLAY')   armTimer(TIMING.PLAY_MS, 'play');
      else if(phase==='LADDER') armTimer(TIMING.DECIDE_MS, 'decide');
      // normal 之 ANIM：保留腳本，shell 重播演出後 ack()
    }
  }

  /* ---------- 發牌與對手引擎 ---------- */
  function mkHand(side){
    var h = [], i;
    for(i=0;i<EV.CFG.CITIZENS;i++) h.push({ t:CIT, used:false });
    h.splice(Math.floor(rng()*(EV.CFG.CITIZENS+1)), 0, { t:SP[side], used:false });
    return h;
  }
  /* 反應式對手（進階）含 N1 修正：
   * 交會局（特殊牌同回合對上＝奴側勝局／帝側輸局）→ 民等到你出特殊牌才對出特殊牌（照原型）。
   * 非交會局（奴側輸局／帝側勝局，對稱）→ 對你的民牌以風險率 1/(5−t) 出特殊牌，
   * 使決勝回合分佈與密封隨機序全等（帝側勝局為 N1 之對稱分支，理由同一：
   * 對手特殊牌在「≠你特殊牌位置」的 4 格均勻，第 t 回合條件機率恰為 1/(5−t)）。 */
  function opponentCard(pc, t){
    var collide = (st.side==='slv') ? st.win : !st.win;
    var opSP = SP[OTHER[st.side]];
    if(collide){
      if(pc === SP[st.side]){ st.oppSpecialOut = true; return opSP; }
      return CIT;
    }
    if(pc === SP[st.side]) return CIT;                 // 錯開：你的特殊先出→當回合決勝
    if(!st.oppSpecialOut && rng() < 1/(R - t)){        // N1 風險率
      st.oppSpecialOut = true; return opSP;
    }
    return CIT;
  }

  /* ---------- 狀態機 ---------- */
  function startRung(side){
    st.side = side; st.rung++; st.trick = 0; st.path.push(side);
    st.win = rng() < EV.CFG.P[side];                   // 鎖定抽定（結果反推起點）
    st.lastVerdict = null;
    if(mode==='advanced'){
      st.myCards = mkHand(side); st.oppUsed = 0; st.oppSpecialOut = false; st.script = null;
      phase = 'PLAY'; armTimer(TIMING.PLAY_MS, 'play');
    }else{
      st.script = buildScript(side, st.win, rng); st.myCards = null;
      phase = 'ANIM';
    }
    save();
    emit('lock', { side:side, rung:st.rung, script:st.script });
    if(mode==='advanced') emit('await', { trick:st.trick+1, deadline:st.deadline });
  }
  function setMode(m){
    if(st) return fail('對局中不可切換模式');
    if(m!=='normal' && m!=='advanced') return fail('mode 需為 normal／advanced');
    mode = m; save(); emit('mode', {mode:m});
    return true;
  }
  function bet(side, stake){
    if(phase!=='BET') return fail('非下注階段');
    if(side!=='emp' && side!=='slv') return fail('side 需為 emp／slv');
    stake = Math.floor(stake);
    if(!(stake>0)) return fail('押額需為正整數');
    if(stake>wallet) return fail('餘額不足');
    wallet -= stake;
    st = { stake0:stake, M:EV.cashValue([]), rung:0, hist:[], path:[], won:[] };
    emit('wallet', {wallet:wallet});
    startRung(side);
    return true;
  }
  function play(i, viaTimeout){
    if(phase!=='PLAY') return fail('非出牌階段');
    var c = st.myCards[i];
    if(!c || c.used) return fail('無效手牌');
    clearT();
    var t = st.trick + 1;
    var pc = c.t, oc = opponentCard(pc, t);
    c.used = true; st.oppUsed++; st.trick = t;
    st.lastVerdict = verdict(pc, oc);
    phase = 'ANIM';
    save();
    emit('trick', { t:t, pc:pc, oc:oc, verdict:st.lastVerdict, timeout:!!viaTimeout });
    return true;
  }
  function ack(){                                      // shell 演出完成的結算點
    if(phase!=='ANIM') return fail('非演出結算點');
    afterAck();
    return true;
  }
  function afterAck(){
    if(mode==='normal'){
      st.trick = st.script.length;                     // 腳本演完＝整局結束（勝負 lock 已定）
      postDuel(st.win, st.script[st.script.length-1].verdict);
    }else if(!st.lastVerdict){
      phase = 'PLAY'; armTimer(TIMING.PLAY_MS, 'play'); save();
      emit('await', { trick:st.trick+1, deadline:st.deadline });
    }else{
      postDuel(st.lastVerdict.win, st.lastVerdict);
    }
  }
  function postDuel(win, v){
    if(!win){ finish('bust', 0, null, 'auto'); return; }
    st.won.push(st.side);
    st.M = EV.cashValue(st.won);                       // 單點：M＝0.93×Π(1/p)
    st.hist.push(st.M);
    if(EV.isTop(st.M, st.rung)){                       // 越滿貫線／10 階完賭＝自動結算
      var boosted = EV.topPayout(st.M);
      finish(st.M >= EV.CFG.SLAM_LINE ? 'slam' : 'full',
             payoutFloor(st.stake0, boosted), boosted, 'auto');
      return;
    }
    phase = 'LADDER'; armTimer(TIMING.DECIDE_MS, 'decide'); save();
    emit('ladder', { M:st.M, rung:st.rung, cash:payoutFloor(st.stake0, st.M),
      nextEmp:st.M*EV.FAIR.emp, nextSlv:st.M*EV.FAIR.slv, deadline:st.deadline });
  }
  function continueRung(side){
    if(phase!=='LADDER') return fail('非階梯決策階段');
    if(side!=='emp' && side!=='slv') return fail('side 需為 emp／slv');
    clearT();
    startRung(side);
    return true;
  }
  function cashOut(via){
    if(phase!=='LADDER') return fail('非階梯決策階段');
    finish('cash', payoutFloor(st.stake0, st.M), null, via||'user');
    return true;
  }
  function finish(kind, pay, boosted, via){            // kind：cash|slam|full|bust
    clearT();
    wallet += pay;
    records.push({ ts:now(), mode:mode, path:st.path.slice(), stake:st.stake0,
      rung:st.rung, M:st.M, boosted:boosted||null, kind:kind, via:via, payout:pay });
    if(records.length>200) records.splice(0, records.length-200);
    var info = { kind:kind, payout:pay, M:st.M, boosted:boosted||null,
                 via:via, wallet:wallet };
    st = null; phase = 'BET';
    save();
    emit('settle', info);
    emit('wallet', {wallet:wallet});
  }
  function fireTimeout(which){
    if(which==='decide'){
      if(phase!=='LADDER') return false;
      emit('timeout', {which:'decide'});
      return cashOut('timeout');                       // Q2：逾時視同收手
    }
    if(which==='play'){
      if(phase!=='PLAY') return false;
      var free = [], i;
      for(i=0;i<st.myCards.length;i++) if(!st.myCards[i].used) free.push(i);
      emit('timeout', {which:'play'});
      return play(free[Math.floor(rng()*free.length)], true);  // Q3：逾時隨機出
    }
    return false;
  }
  function getState(){
    var s = { phase:phase, mode:mode, wallet:wallet, timing:TIMING,
              records:records.slice(-20), st:null };
    if(st){
      s.st = { side:st.side, stake0:st.stake0, M:st.M, rung:st.rung, trick:st.trick,
        deadline:st.deadline||null, win:st.win, lastVerdict:st.lastVerdict,
        hist:st.hist.slice(), path:st.path.slice(), won:st.won.slice(),
        script: st.script ? st.script.slice() : null,
        myCards: st.myCards ? st.myCards.map(function(c){return {t:c.t, used:c.used};}) : null,
        oppUsed: st.oppUsed||0, oppSpecialOut: !!st.oppSpecialOut,
        cash: st.won.length ? payoutFloor(st.stake0, st.M) : 0 };
    }
    return s;
  }
  function clearSaved(){                               // dev 用：清存檔＋重置
    if(st) return fail('對局中不可清存檔');
    if(store){ try{ store.removeItem(KEY); }catch(e){} }
    wallet = (opts.wallet != null) ? opts.wallet : 10000;
    records = []; save();
    emit('wallet', {wallet:wallet});
    return true;
  }

  restore();
  return { setMode:setMode, bet:bet, play:play, ack:ack,
           continueRung:continueRung, cashOut:cashOut, fireTimeout:fireTimeout,
           getState:getState, clearSaved:clearSaved,
           on:function(fn){ subs.push(fn); } };
}

return { createGame:createGame, verdict:verdict, buildScript:buildScript,
         payoutFloor:payoutFloor, floor2:floor2, fmtX:fmtX, railPct:railPct,
         TIMING:TIMING, ROUNDS:R };
})();
if(typeof module!=='undefined' && module.exports) module.exports = DuelCore;
