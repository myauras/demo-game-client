/* =========================================================================
 * 三選一冒煙——範例玩法畫面與演出＋模組接線（拋棄式：範例，換掉）
 *
 * 職責：
 *  ① 範例玩法「三選一押注」的畫面與演出（翻亮一張牌，只動 transform／opacity）
 *  ② 把核心事件接到畫面；把 LogUI／Autobet／Onboard 三個通用模組接起來
 *     （autobet adapter、log record 組裝、引導步驟都在這裡）
 * 新 demo 換玩法時：重寫 ① 與 record／steps 的內容，② 的接線方式照用。
 *
 * 對外（DEMO.ui，給 dev.js 的自動駕駛與測試用）：
 *   play(choice, stake, { fast, hold, onReveal }) → Promise<{ stake, pay }>
 *       fast＝演出壓縮；hold＝亮出結果後不 ack（截圖停在結果畫面）；onReveal＝亮出結果時回呼
 *   isBusy() / resetWallet()
 * 依賴：全部前面的檔。載入完成後設 window.__demoReady = true。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t;
var $ = function(id){ return document.getElementById(id); };
var shot = D.q.shot;

var game = DemoCore.createGame({ storage: shot ? false : undefined });
D.game = game;

var busy = game.getState().phase !== 'BET';
var stake = D.ls('stake');
if(EV.CFG.STAKES.indexOf(stake) < 0) stake = EV.CFG.STAKES[1] != null ? EV.CFG.STAKES[1] : EV.CFG.STAKES[0];
var pend = null;                                    // 進行中的 play()：{ res, fast, hold, onReveal, choice }

/* ---------- 畫面：餘額、單注、三張選項卡 ---------- */
function setWallet(v){ $('wal').textContent = D.fmt(v); }
function setBusy(b){
  busy = b;
  Array.prototype.forEach.call($('cards').children, function(c){ c.classList.toggle('dis', b); });
  Autobet.refresh();
}
function banner(s){ $('banner').textContent = s; }
function netText(cls, s){ var n = $('net'); n.className = 'net' + (cls ? ' ' + cls : ''); n.textContent = s || ''; }

function renderStakes(){
  var h = '';
  EV.CFG.STAKES.forEach(function(v){
    h += '<button type="button" data-v="' + v + '" class="' + (v === stake ? 'on' : '') + '">' + D.fmt(v) + '</button>';
  });
  $('stakes').innerHTML = h;
}
$('stakes').onclick = function(e){
  var b = e.target.closest ? e.target.closest('button') : null;
  if(!b) return;
  stake = +b.getAttribute('data-v'); D.ls('stake', stake); renderStakes();
};

function renderCards(){
  var h = '';
  EV.ids().forEach(function(id){
    h += '<div class="card" data-id="' + id + '" role="button">' +
      '<div class="lamp"></div><div class="cl">' + T('choice.' + id) + '</div>' +
      '<div class="cp">' + T('card.p', { p:Math.round(EV.P[id] * 100) }) + '</div>' +
      '<div class="co">' + T('card.odds', { x:EV.fmtX(EV.ODDS[id]) }) + '</div></div>';
  });
  $('cards').innerHTML = h;
}
function cardOf(id){ return $('cards').querySelector('[data-id="' + id + '"]'); }
function clearCards(){
  Array.prototype.forEach.call($('cards').children, function(c){ c.className = 'card' + (busy ? ' dis' : ''); });
}

$('cards').onclick = function(e){
  var c = e.target.closest ? e.target.closest('.card') : null;
  if(!c) return;
  if(busy){ Toast.show(T('rej.busy')); return; }
  if(game.getState().wallet < stake){ Toast.show(T('rej.insufficient')); return; }
  play(c.getAttribute('data-id'), stake, {}).catch(function(){});
};

/* ---------- 下注＋演出：先抽定（核心）→ UI 演 → ack 才結算 ---------- */
function play(choice, st, o){
  o = o || {};
  return new Promise(function(res, rej){
    if(busy) return rej(new Error('busy'));
    pend = { res:res, fast:!!o.fast, hold:!!o.hold, onReveal:o.onReveal, choice:choice };
    if(!game.bet(choice, st)){ pend = null; rej(new Error('bet')); }
  });
}
function scale(){ return pend && pend.fast ? 0.35 : 1; }

function onResult(d){
  setBusy(true);
  clearCards(); netText('', '');
  cardOf(d.choice).classList.add('picked');
  banner(T('banner.rolling'));
  Array.prototype.forEach.call($('cards').children, function(c){ c.classList.add('shake'); });
  var p = pend;
  setTimeout(function(){
    Array.prototype.forEach.call($('cards').children, function(c){
      c.classList.remove('shake');
      c.classList.add(c.getAttribute('data-id') === d.result ? 'lit' : 'dim');
    });
    banner(T('banner.result', { r:T('choice.' + d.result), c:T('choice.' + d.choice) }));
    if(p && p.onReveal) p.onReveal();
    if(p && p.hold) return;                          // 截圖停在結果畫面
    setTimeout(function(){ game.ack(); }, 900 * (p && p.fast ? 0.35 : 1));
  }, 700 * (p && p.fast ? 0.35 : 1));
}

function rowsOf(r){
  return [
    { k:'log.row.pick',   v:T('choice.' + r.choice) },
    { k:'log.row.result', v:T('choice.' + r.result) },
    { k:'log.row.hit',    v:T(r.win ? 'log.hit' : 'log.miss') },
    { k:'log.row.odds',   v:EV.fmtX(r.odds) + 'x' },
    { k:'log.row.stake',  v:D.fmt(r.stake) },
    { k:'log.row.pay',    v:D.fmt(r.payout) }
  ];
}
function toLog(r){ return { id:r.orderId, ts:r.ts, stake:r.stake, pay:r.payout, rows:rowsOf(r) }; }

function onSettled(d){
  var w = d.payout > 0;
  netText(w ? 'w' : 'l', T(w ? 'net.win' : 'net.lose', { n:D.fmt(w ? d.net : d.stake) }));
  var rec = game.getState().records.slice(-1)[0];
  if(rec) LogUI.push(toLog(rec));
  var p = pend; pend = null;
  setBusy(false);
  if(p) p.res({ stake:d.stake, pay:d.payout });
}

game.on(function(type, d){
  if(type === 'wallet') setWallet(d.wallet);
  else if(type === 'result') onResult(d);
  else if(type === 'settled') onSettled(d);
});

/* ---------- 錢包重置（log 頁的重置鈕走這裡） ---------- */
function resetWallet(){
  if(busy){ Toast.show(T('log.noReset')); return false; }
  if(Autobet.isRunning()) Autobet.stop();
  if(!game.clearSaved()) return false;
  clearCards(); banner(T('banner.idle')); netText('', '');
  Toast.show(T('log.resetDone', { n:D.fmt(game.getState().wallet) }));
  return true;
}

/* ---------- 接線：log 頁、自動下注、新手引導 ---------- */
LogUI.mount({ root:$('app'), openBtn:$('logBtn'), cap:EV.CFG.LOG_CAP, onReset:resetWallet });
game.getState().records.forEach(function(r){ LogUI.push(toLog(r)); });   // 重整接回：補記沒進 log 的注單（去重）

Autobet.mount({
  root:$('app'), entryBtn:$('autoBtn'), slot:$('abar'),
  choices:EV.ids().map(function(id){ return { id:id, label:T('choice.' + id) }; }),
  stakes:EV.CFG.STAKES,
  placeOne:function(cfg){ return play(cfg.choice, cfg.stake, { fast:true }); },
  balance:function(){ return game.getState().wallet; },
  isIdle:function(){ return !busy; },
  toast:Toast.show
});

Onboard.mount({
  root:$('app'), hintEl:$('hint'),
  steps:[ { key:'s1', target:'#stakes' }, { key:'s2', target:'#cards' }, { key:'s3', target:'#banner' } ],
  canStart:function(){ return !Autobet.isRunning() && !busy; },
  autoStart:true
});

/* ---------- init ---------- */
renderStakes(); renderCards();
setWallet(game.getState().wallet);
D.ui = { play:play, isBusy:function(){ return busy; }, resetWallet:resetWallet };
Autobet.refresh();
window.__demoReady = true;
})();
