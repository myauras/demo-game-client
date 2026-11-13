/* =========================================================================
 * 三選一冒煙——自動下注三件套（拋棄式畫面；不認識玩法）
 *   ⟳ 入口鈕 → 底部設定彈窗（選項、單注、局數、停利、停損）→
 *   進行中專屬槽浮條（剩餘局數＋累計盈虧＋停止鈕）
 *
 * 與玩法的唯一接縫＝adapter（由 ui-main.js 提供）：
 *   Autobet.mount({
 *     root, entryBtn, slot,                  掛點：#app、⟳ 鈕、in-flow 浮條槽
 *     choices:[{ id, label }],               可選項（本檔另加「輪流」）
 *     stakes:[number],                       單注可選值
 *     placeOne(cfg) → Promise<{ stake, pay }>  代按一局，演完才 resolve；reject＝失敗
 *                                            cfg＝{ choice（已解開輪流）, stake, n（第幾局，1 起算） }
 *     balance() → number,                    目前餘額
 *     isIdle() → boolean,                    玩法層目前可下注
 *     toast(msg)                             提示（預設 Toast.show）
 *   })
 *   Autobet.start(cfg) / stop() / isRunning() / openSheet() / closeSheet() /
 *   refresh()（玩法層狀態變動後呼叫，更新 ⟳ 鈕顯示）/ state()（{ on, n, pnl, total }）
 *
 * 停止條件：跑滿局數／累計盈虧 ≥ 停利／≤ −停損／餘額不足／手動停止／placeOne 失敗。
 * 持久化：設定『kitsmoke.autocfg』、進行中旗標『kitsmoke.auto』；
 *   重整＝中止並 toast 提示（安全預設，不自動續跑）。
 * 依賴：DEMO（env.js）、t（strings.js）、DragScroll（選用）、Toast（選用）
 * ========================================================================= */
var Autobet = (function(){
'use strict';
var D = window.DEMO, T = window.t;
var TP = [0, 1000, 2000, 5000], SL = [0, 500, 1500, 3000], ROUNDS = [10, 20, 50];
var ad = null, cfg = null;
var A = { on:false, stopping:false, cfg:null, n:0, pnl:0, tm:null };
var els = {};

function toast(m, ms){ if(ad && ad.toast) ad.toast(m, ms); else if(window.Toast) Toast.show(m, ms); }
function merge(a, b){ var o = {}, k; for(k in a) o[k] = a[k]; for(k in b) if(b[k] !== undefined) o[k] = b[k]; return o; }

function mount(adapter){
  ad = adapter;
  var root = ad.root || document.getElementById('app');
  cfg = merge({ choice:ad.choices[0].id, stake:(ad.stakes[1] != null ? ad.stakes[1] : ad.stakes[0]),
                rounds:10, tp:0, sl:0 }, D.ls('autocfg') || {});
  if(ad.choices.every(function(c){ return c.id !== cfg.choice; }) && cfg.choice !== 'alt') cfg.choice = ad.choices[0].id;

  /* 浮條槽 */
  els.bar = ad.slot;
  els.bar.classList.add('abar');
  els.bar.innerHTML = '<div class="at"></div><button class="astop" type="button"></button>';
  els.txt = els.bar.querySelector('.at');
  els.stopBtn = els.bar.querySelector('.astop');
  els.stopBtn.textContent = T('auto.stop');
  els.stopBtn.onclick = onStop;
  barShow(false);

  /* 設定彈窗 */
  els.veil = document.createElement('div'); els.veil.className = 'veil';
  els.sheet = document.createElement('div'); els.sheet.className = 'sheet';
  els.sheet.innerHTML = '<div class="shead"><b></b><button class="xb" type="button">×</button></div><div class="sbody"></div>';
  root.appendChild(els.veil); root.appendChild(els.sheet);
  els.sheet.querySelector('b').textContent = T('auto.title');
  els.body = els.sheet.querySelector('.sbody');
  if(window.DragScroll) DragScroll.attach(els.body);
  els.veil.onclick = closeSheet;
  els.sheet.querySelector('.xb').onclick = closeSheet;
  els.body.onclick = onSheetClick;

  ad.entryBtn.title = T('auto.btn');
  ad.entryBtn.onclick = function(){ if(ad.isIdle() && !A.on) openSheet(); };

  /* 重整＝中止並提示 */
  var ab = D.ls('auto');
  if(ab){
    D.ls('auto', null);
    setTimeout(function(){ toast(T('auto.aborted', { n:ab.n, total:ab.N, pnl:D.signed(ab.pnl) }), 4200); }, 400);
  }
  refresh();
}

/* ---------- 設定彈窗 ---------- */
function seg(key, list, labels, onCls){
  return '<div class="seg" data-k="' + key + '">' + list.map(function(v, i){
    return '<button type="button" data-v="' + D.esc(v) + '" class="' + (String(cfg[key]) === String(v) ? (onCls || 'on') : '') + '">' + labels[i] + '</button>';
  }).join('') + '</div>';
}
function row(label, inner){ return '<div class="srow"><span class="slab">' + label + '</span>' + inner + '</div>'; }
function renderSheet(){
  var ids = ad.choices.map(function(c){ return c.id; }).concat(['alt']);
  var lab = ad.choices.map(function(c){ return c.label; }).concat([T('auto.alt')]);
  els.body.innerHTML =
    row(T('auto.pick'), seg('choice', ids, lab)) +
    row(T('auto.stake'), seg('stake', ad.stakes, ad.stakes.map(D.fmt))) +
    row(T('auto.rounds'), seg('rounds', ROUNDS, ROUNDS.map(String))) +
    row(T('auto.tp'), seg('tp', TP, TP.map(function(v){ return v ? '+' + D.fmt(v) : T('auto.off'); }), 'onG')) +
    row(T('auto.sl'), seg('sl', SL, SL.map(function(v){ return v ? '−' + D.fmt(v) : T('auto.off'); }), 'onS')) +
    '<div class="snote">' + T('auto.note') + '</div>' +
    '<button class="sgo" type="button">' + T('auto.go') + '</button>';
}
function onSheetClick(e){
  var b = e.target.closest ? e.target.closest('button') : null;
  if(!b) return;
  if(b.classList.contains('sgo')){ start(cfg); return; }
  var grp = b.parentNode, k = grp && grp.getAttribute && grp.getAttribute("data-k");
  if(!k) return;
  var v = b.getAttribute('data-v');
  cfg[k] = (k === 'choice') ? v : +v;
  renderSheet();
}
function openSheet(){ renderSheet(); els.veil.classList.add('show'); els.sheet.classList.add('show'); }
function closeSheet(){ els.veil.classList.remove('show'); els.sheet.classList.remove('show'); }

/* ---------- 浮條 ---------- */
function barShow(on){
  els.bar.classList.toggle('on', on);
  if(!on) els.txt.textContent = T('auto.idle');
}
function barRender(){
  els.txt.textContent = T('auto.running', { n:A.n, total:A.cfg.rounds, pnl:D.signed(A.pnl),
    tail:A.stopping ? T('auto.stopping') : '' });
  els.bar.classList.toggle('stopping', A.stopping);
}
function onStop(){
  if(!A.on || A.stopping) return;
  if(inFlight){ A.stopping = true; barRender(); }       // 本局演完才停
  else end(T('auto.endStop'));
}

/* ---------- 流程 ---------- */
var inFlight = false;
function persist(){ D.ls('auto', A.on ? { n:A.n, N:A.cfg.rounds, pnl:A.pnl } : null); }
function pickChoice(n){
  if(A.cfg.choice !== 'alt') return A.cfg.choice;
  return ad.choices[(n - 1) % ad.choices.length].id;
}
function start(c){
  c = merge(cfg, c || {});
  if(A.on) return false;
  if(!ad.isIdle()){ toast(T('auto.busy')); return false; }
  if(ad.balance() < c.stake){ toast(T('auto.noMoney', { have:D.fmt(ad.balance()), need:D.fmt(c.stake) })); return false; }
  D.ls('autocfg', c);
  A.on = true; A.stopping = false; A.cfg = c; A.n = 0; A.pnl = 0; inFlight = false;
  closeSheet(); barShow(true); barRender(); persist(); refresh();
  schedule(150);
  return true;
}
function schedule(delay){
  if(A.tm) clearTimeout(A.tm);
  A.tm = setTimeout(step, delay || 0);
}
function step(){
  A.tm = null;
  if(!A.on) return;
  if(A.stopping){ end(T('auto.endStop')); return; }
  if(!ad.isIdle()){ schedule(300); return; }            // 面板還沒歸位再等
  if(A.n >= A.cfg.rounds){ end(T('auto.endDone', { n:A.cfg.rounds })); return; }
  if(ad.balance() < A.cfg.stake){ end(T('auto.endMoney')); return; }
  A.n++; inFlight = true; barRender(); persist();
  var p;
  try{ p = ad.placeOne({ choice:pickChoice(A.n), stake:A.cfg.stake, n:A.n }); }
  catch(e){ p = Promise.reject(e); }
  p.then(function(r){
    inFlight = false;
    if(!A.on) return;
    A.pnl += (r.pay - r.stake); barRender(); persist();
    if(A.stopping){ end(T('auto.endStop')); return; }
    if(A.cfg.tp > 0 && A.pnl >= A.cfg.tp){ end(T('auto.endTp', { n:D.fmt(A.cfg.tp) })); return; }
    if(A.cfg.sl > 0 && A.pnl <= -A.cfg.sl){ end(T('auto.endSl', { n:D.fmt(A.cfg.sl) })); return; }
    schedule(350);
  }, function(){
    inFlight = false; A.n--; end(T('auto.endFail'));
  });
}
function end(reason){
  var summary = T('auto.end', { reason:reason, n:A.n, pnl:D.signed(A.pnl) });
  A.on = false; A.stopping = false; inFlight = false;
  if(A.tm){ clearTimeout(A.tm); A.tm = null; }
  persist(); barShow(false); els.bar.classList.remove('stopping');
  toast(summary, 3800); refresh();
}
function stop(){ onStop(); }

/* ⟳ 鈕：玩法層可下注且沒在跑才顯示 */
function refresh(){
  if(!ad) return;
  ad.entryBtn.classList.toggle('show', ad.isIdle() && !A.on);
}

return { mount:mount, start:start, stop:stop, openSheet:openSheet, closeSheet:closeSheet,
         refresh:refresh, isRunning:function(){ return A.on; },
         state:function(){ return { on:A.on, n:A.n, pnl:A.pnl, total:A.cfg ? A.cfg.rounds : 0 }; } };
})();
