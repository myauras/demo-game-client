/* =========================================================================
 * 近況列（H04）：一排 12 顆圓點，每顆＝該局「獨佔成功且基準賠率最高」的落點色，全撞＝灰，最新在右。
 * 不認識演出、不讀核心；由 ui-main 的 [B] 區段呼叫：
 *   Recent.mount(el)        掛到 #recent（只掛一次；沒有 el 就靜默略過）
 *   Recent.push(rec)        一局結算：rec＝核心注單紀錄（讀 topSoloPoint：0 綠 1 藍 2 紫 3 金，其餘＝全撞）
 *   Recent.rebuild(records) 重整／重置錢包：以注單紀錄（舊→新）整排重建，只取最後 12 筆
 * 重整後不另存：由核心 records 重建。動畫只動 transform／opacity（見 recent.css）。
 * ========================================================================= */
(function(){
'use strict';

var N = 12;                                  // 顯示局數
var DEF = {                                  // strings.js 缺鍵時的退回文字
  'recent.title':  '近況'
};
var list = [];                               // [{id, p}]，舊→新，p：0～3 或 -1（全撞）
var root = null, rowEl = null;

function tx(key){
  var s = (typeof window.t === 'function') ? window.t(key) : key;
  return (s == null || s === key) ? DEF[key] : s;
}
function pName(p){
  var P = window.EV && window.EV.POINTS;
  return (P && P[p]) ? P[p].name : '';
}
function norm(rec){
  var p = rec ? rec.topSoloPoint : -1;
  return { id: rec ? rec.orderId : null, p: (p === 0 || p === 1 || p === 2 || p === 3) ? p : -1 };
}

/* 畫整排。animate＝true：新增一局時，舊點從右邊一格滑回原位、最新那顆彈出（只動 transform／opacity） */
function render(animate){
  if(!rowEl) return;
  var h = '', i, k, it, cls, nm;
  for(i = 0; i < N; i++){
    k = i - (N - list.length);               // 靠右對齊：list 的第 k 筆放第 i 格
    it = k >= 0 ? list[k] : null;
    if(!it){ h += '<span class="rc-cell"><i class="rc-d rc-e"></i></span>'; continue; }
    cls = 'rc-d ' + (it.p >= 0 ? 'rc-p' + it.p : 'rc-x');
    if(i === N - 1) cls += animate ? ' rc-nw rc-in' : ' rc-nw';
    else if(animate) cls += ' rc-sh';
    nm = it.p >= 0 ? pName(it.p) : '';
    h += '<span class="rc-cell"><i class="' + cls + '"' + (nm ? ' title="' + nm + '"' : '') + '></i></span>';
  }
  rowEl.innerHTML = h;
}

function mount(el){
  if(root || !el) return;
  root = el;
  root.className = (root.className ? root.className + ' ' : '') + 'rc';
  root.innerHTML = '<div class="rc-ht"><span class="rc-t"></span></div><div class="rc-row"></div>';
  root.querySelector('.rc-t').textContent = tx('recent.title');
  rowEl = root.querySelector('.rc-row');
  render(false);
}

function push(rec){
  if(!rec) return;
  var n = norm(rec);
  if(n.id != null && list.length && list[list.length - 1].id === n.id) return;   // 同一局不重複加
  list.push(n);
  if(list.length > N) list.splice(0, list.length - N);
  render(true);
}

function rebuild(records){
  var a = Array.isArray(records) ? records.slice(-N) : [];
  list = a.map(norm);
  render(false);
}

window.Recent = { mount: mount, push: push, rebuild: rebuild };
})();
