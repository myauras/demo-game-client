/* =========================================================================
 * 三選一冒煙——對局核心（可移植層，零 DOM）
 *
 * 對外：DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, now, wallet, keyPrefix }
 *   game：bet(choice, stake) / ack() / getState() / clearSaved() / on(fn) /
 *         setRng(fn) / getRng()
 * 事件（on(fn(type, data))）：
 *   wallet  { wallet }                      餘額變動（扣注、派彩、重置）
 *   result  { orderId, choice, stake, result, win, odds }   結果已先定，交給 UI 演出
 *   settled { orderId, choice, stake, result, win, odds, payout, net, wallet, restored }
 *   error   { msg }
 * 流程：BET —bet→ ANIM（結果已抽定、押額已扣）—ack→ BET（派彩入帳）
 *   UI 演完才呼叫 ack()；核心不自帶動畫計時。
 * 重整接回：演出中重整＝直接結算（存檔裡的結果已定，不重演、不重抽）。
 *
 * 換玩法時只改下面 RULES 這一段，其餘（錢包、狀態機、注單、存檔、事件）不動。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * ========================================================================= */
var DemoCore = (function(){

/* ---------- 規則（範例，換掉）：只有這三個函式認識玩法 ---------- */
var RULES = {
  validChoice: function(c){ return EV.ids().indexOf(c) >= 0; },
  draw:        function(rng){ return EV.pick(rng()); },            // 先抽定結果
  payout:      function(choice, stake, result){                    // 結算（全精度算、取整一次）
    return choice === result ? EV.payoutFloor(stake, EV.ODDS[choice]) : 0;
  }
};

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || Math.random;
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;

  var wallet = startWallet;
  var records = [];                       // 已結注單（核心留 200 筆）
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
      store.setItem(KEY, JSON.stringify({ v:1, wallet:wallet, seq:seq,
        records:records, pending:st }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== 1) return;
    wallet = d.wallet; seq = d.seq || 0; records = d.records || [];
    if(d.pending){ st = d.pending; phase = 'ANIM'; settle(true); }   // 演出中重整＝直接結算
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
    var result = RULES.draw(rng);                        // 結果先定，之後 UI 只負責演
    st = { orderId:newOrderId(ts), ts:ts, choice:choice, stake:stake,
           odds:EV.ODDS[choice], result:result, win:(result === choice) };
    phase = 'ANIM';
    save();
    emit('wallet', { wallet:wallet });
    emit('result', { orderId:st.orderId, choice:choice, stake:stake,
                     result:result, win:st.win, odds:st.odds });
    return true;
  }

  function ack(){                                        // UI 演出完成的結算點
    if(phase !== 'ANIM') return fail('非演出結算點');
    settle(false);
    return true;
  }

  function settle(restored){
    var pay = RULES.payout(st.choice, st.stake, st.result);
    wallet += pay;
    var rec = { orderId:st.orderId, ts:st.ts, choice:st.choice, stake:st.stake,
                odds:st.odds, result:st.result, win:st.win, payout:pay };
    records.push(rec);
    if(records.length > 200) records.splice(0, records.length - 200);
    st = null; phase = 'BET';
    save();
    emit('settled', { orderId:rec.orderId, choice:rec.choice, stake:rec.stake, result:rec.result,
      win:rec.win, odds:rec.odds, payout:pay, net:pay - rec.stake, wallet:wallet, restored:!!restored });
    emit('wallet', { wallet:wallet });
  }

  function getState(){
    return { phase:phase, wallet:wallet,
             st: st ? { orderId:st.orderId, choice:st.choice, stake:st.stake,
                        result:st.result, win:st.win, odds:st.odds } : null,
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

return { createGame:createGame, RULES:RULES };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
