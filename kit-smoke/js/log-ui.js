/* =========================================================================
 * 三選一冒煙——勝負 log 頁（拋棄式畫面；規格是公司定死的，勿改設計）
 *
 * 規格：
 *  - 總覽列＝金色「+淨額」（獲勝）或灰色「−下注額」（失敗）＋日期時間
 *  - 點列進詳細頁：本局細節（由玩法提供 detail rows）＋注單 order id＋「回報」鈕
 *  - 封頂 50 筆（EV.CFG.LOG_CAP）；頁內有錢包重置（二段確認）
 *  - 拖曳滾動、零原生捲軸（DragScroll）
 *
 * 介面：
 *   LogUI.mount({ root, openBtn, cap, onReset(), onReport(rec) })
 *       onReset：玩法層實際重置錢包；回 false＝不能重置（頁面不清 log）
 *       onReport：回報鈕回呼（預設 toast）
 *   LogUI.push(rec)   rec＝{ id, ts, stake, pay, rows:[{ k:'字典key', v:'已格式化文字' }] }
 *                     淨額由本檔算（pay − stake）；同 id 已存在則略過（重整接回補記用）
 *   LogUI.open() / close() / openDetail(i) / isOpen()
 *   LogUI.list()      最新在前的複本
 *   LogUI.has(id)     是否已記過這張注單
 *   LogUI.clear()
 *   LogUI.addFooter(el)  底列塞額外按鈕（新手引導的「重看教學」用）
 * 持久化：『kitsmoke.log』（經 DEMO.ls；?shot= 模式不落地）
 * 依賴：DEMO（env.js）、t（strings.js）、Toast、DragScroll（缺了就退化成原生滾動）
 * ========================================================================= */
var LogUI = (function(){
'use strict';
var D = window.DEMO, T = window.t;
var cap = 50, log = [];                    // 舊→新
var opts = {}, els = {};
var view = 'ov', idx = -1, resetArmed = false, openFlag = false;

function net(r){ return r.pay - r.stake; }
function win(r){ return r.pay > 0; }
/* 總覽顯示口徑：獲勝＝+（派彩−下注）；失敗＝−下注額 */
function shown(r){ return win(r) ? net(r) : -r.stake; }

function save(){ D.ls('log', log); }
function trim(){ if(log.length > cap) log.splice(0, log.length - cap); }

function mount(o){
  opts = o || {};
  cap = opts.cap || cap;
  var root = opts.root || document.getElementById('app');
  log = D.ls('log') || []; trim();

  var m = document.createElement('div');
  m.className = 'lgm';
  m.innerHTML =
    '<div class="lgh"><button class="lgback hid" type="button"></button><b class="lgtitle"></b>' +
    '<button class="lgx" type="button">×</button></div>' +
    '<div class="lgb"></div>' +
    '<div class="lgf"><span class="lgcount"></span><span class="lgfr">' +
    '<span class="lgextra"></span>' +
    '<button class="lgcancel okb" type="button" style="display:none"></button>' +
    '<button class="lgreset" type="button"></button></span></div>';
  root.appendChild(m);
  els = { m:m, back:m.querySelector('.lgback'), title:m.querySelector('.lgtitle'),
          body:m.querySelector('.lgb'), count:m.querySelector('.lgcount'),
          extra:m.querySelector('.lgextra'), cancel:m.querySelector('.lgcancel'),
          reset:m.querySelector('.lgreset') };
  els.back.textContent = T('btn.back');
  els.cancel.textContent = T('btn.cancel');
  if(window.DragScroll) DragScroll.attach(els.body);

  m.querySelector('.lgx').onclick = close;
  els.back.onclick = function(){ view = 'ov'; resetArmed = false; render(); };
  els.body.onclick = function(e){
    var row = e.target.closest ? e.target.closest('.lrowi') : null;
    if(row){ idx = +row.getAttribute('data-i'); view = 'dt'; resetArmed = false; render(); return; }
    var rb = e.target.closest ? e.target.closest('.lreport') : null;
    if(rb && !rb.disabled){
      rb.disabled = true; rb.textContent = T('log.reported');
      var rec = log[idx];
      if(opts.onReport) opts.onReport(rec); else if(window.Toast) Toast.show(T('log.reportToast'));
    }
  };
  els.reset.onclick = function(){ if(resetArmed) doReset(); else { resetArmed = true; render(); } };
  els.cancel.onclick = function(){ resetArmed = false; render(); };
  if(opts.openBtn) opts.openBtn.onclick = open;
  render();
}

function doReset(){
  resetArmed = false;
  if(opts.onReset && opts.onReset() === false){ render(); return; }
  clear();
  view = 'ov'; render();
}

function render(){
  if(!els.m) return;
  var detail = (view === 'dt' && log[idx]);
  if(!detail) view = 'ov';
  els.back.classList.toggle('hid', !detail);
  els.title.textContent = T(detail ? 'log.detail' : 'log.title');
  els.body.innerHTML = detail ? htmlDetail(log[idx]) : htmlOverview();
  els.count.textContent = T('log.count', { n:log.length, cap:cap });
  els.reset.textContent = T(resetArmed ? 'log.resetAsk' : 'log.reset');
  els.reset.className = 'lgreset' + (resetArmed ? ' warnb' : '');
  els.cancel.style.display = resetArmed ? '' : 'none';
}

function htmlOverview(){
  if(!log.length) return '<div class="lempty">' + T('log.empty') + '</div>';
  var h = '';
  for(var i = log.length - 1; i >= 0; i--){
    var r = log[i], w = win(r);
    h += '<div class="lrowi" data-i="' + i + '">' +
      '<div class="lt">' + D.fmtTime(r.ts) + '</div>' +
      '<div class="lv ' + (w ? 'gold' : 'grey') + '">' + D.signed(shown(r)) + '</div></div>';
  }
  return h;
}

function kv(k, v, rawHtml){
  return '<div class="kv"><span>' + k + '</span><span>' + (rawHtml ? v : D.esc(v)) + '</span></div>';
}
function htmlDetail(r){
  var w = win(r);
  var h = '<div class="ldh"><div class="big ' + (w ? 'gold' : 'grey') + '">' + D.signed(shown(r)) + '</div>' +
    kv(T('log.time'), D.fmtTime(r.ts));
  (r.rows || []).forEach(function(row){ h += kv(T(row.k), row.v); });
  h += kv(T('log.order'), '<span class="oid">' + D.esc(r.id) + '</span>', true) + '</div>' +
    '<div class="lrep"><button class="lreport" type="button">' + T('log.report') + '</button></div>';
  return h;
}

function has(id){ for(var i = 0; i < log.length; i++) if(log[i].id === id) return true; return false; }
function push(rec){
  if(rec.id && has(rec.id)) return;
  log.push({ id:rec.id, ts:rec.ts, stake:rec.stake, pay:rec.pay, rows:rec.rows || [] });
  trim(); save();
  if(openFlag) render();
}
function clear(){ log = []; save(); render(); }
function list(){ return log.slice().reverse(); }

function open(){
  openFlag = true; view = 'ov'; resetArmed = false; render();
  els.m.classList.add('show');
}
function close(){ openFlag = false; els.m.classList.remove('show'); }
function openDetail(i){                    // i＝最新在前的序（0＝最新）
  if(!els.m) return;
  idx = log.length - 1 - i; view = 'dt'; resetArmed = false; openFlag = true; render();
  els.m.classList.add('show');
}
function addFooter(el){ if(els.extra) els.extra.appendChild(el); }

return { mount:mount, push:push, open:open, close:close, openDetail:openDetail,
         isOpen:function(){ return openFlag; }, list:list, has:has, clear:clear, addFooter:addFooter };
})();
