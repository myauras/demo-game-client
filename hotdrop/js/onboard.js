/* =========================================================================
 * 空投爭奪——新手引導（H03：三步聚光，版型照 mockups/guide-A）
 *   ① 常駐一句「怎麼玩」提示（可點展開一行白話說明，說明卡貼在提示列正上方）
 *   ② 首次進場多步聚光引導（下一步／跳過；完成或跳過都寫存檔旗標）
 *   ③ log 頁底列「重看教學」入口
 *
 * 介面：
 *   Onboard.mount({
 *     root,                 #app
 *     hintEl,               常駐提示的掛點（空 div，本檔填內容）
 *     steps:[{ key, target, pad, hand }],
 *                           key＝字典前綴（tut.<key>.title／tut.<key>.body）；
 *                           target＝CSS 選擇器、元素、或回傳「元素／元素陣列」的函式
 *                                   （陣列＝取聯集框；聚光洞對位用；找不到不收引導，說明卡置中）；
 *                           pad＝聚光洞外擴 px（預設 8）；
 *                           hand＝選用，回傳元素的函式，👆 擺在該元素中心旁
 *     canStart() → boolean       目前可不可以開引導（例：自動下注中不開；預設 true）
 *     autoStart: boolean         非截圖、沒看過、沒帶 ?tut=0 時進場自動開
 *   })
 *   Onboard.start(n) / finish() / isOpen()      n＝從第幾步開（0 起算，截圖用；預設 0）
 * 網址：?tut=1 強制重播、?tut=0 關閉。完成寫『hotdrop.tut』＝'done'；清掉即恢復首次引導。
 * 引導開著時覆蓋層（#obd）蓋住整個 #app，所以點落點、單注、紀錄鈕都不會動到遊戲。
 * 對位一律 getBoundingClientRect 換算成 #app 內座標，零硬編碼座標。
 * 動畫只用 transform／opacity；聚光洞靠靜態 box-shadow，位置直接設不做補間。
 * 依賴：DEMO（env.js）、t（strings.js）、LogUI／Toast（選用）
 * ========================================================================= */
var Onboard = (function(){
'use strict';
var D = window.DEMO, T = window.t;
var app, steps = [], opts = {};
var els = {}, idx = -1, on = false;

function el(tag, cls, html){
  var n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html != null) n.innerHTML = html;
  return n;
}
function resolve(target){                                  // → 元素陣列（可能為空）
  var n = typeof target === 'function' ? target() : target;
  if(typeof n === 'string') n = document.querySelector(n);
  if(!n) return [];
  return (n.length != null && !n.nodeType ? Array.prototype.slice.call(n) : [n]).filter(Boolean);
}
function rectIn(node){
  var a = app.getBoundingClientRect(), r = node.getBoundingClientRect();
  return { x:r.left - a.left, y:r.top - a.top, w:r.width, h:r.height, aw:a.width, ah:a.height };
}
function unionRect(nodes){
  var u = null;
  nodes.forEach(function(nd){
    var r = rectIn(nd);
    if(!u) u = { x:r.x, y:r.y, r:r.x + r.w, b:r.y + r.h, aw:r.aw, ah:r.ah };
    else{
      u.x = Math.min(u.x, r.x); u.y = Math.min(u.y, r.y);
      u.r = Math.max(u.r, r.x + r.w); u.b = Math.max(u.b, r.y + r.h);
    }
  });
  if(u){ u.w = u.r - u.x; u.h = u.b - u.y; }
  return u;
}
function toast(m){ if(window.Toast) Toast.show(m); }

function mount(o){
  opts = o || {};
  app = opts.root || document.getElementById('app');
  steps = opts.steps || [];

  /* ① 常駐提示：一行＋點開一行說明 */
  if(opts.hintEl){
    els.hint = opts.hintEl;
    els.hint.classList.add('obhint');
    els.hint.innerHTML =
      '<span class="oht">' + T('hint.title') + '</span>' +
      '<span class="ohs">' + T('hint.short') + '</span>' +
      '<span class="ohm">' + T('hint.more') + '</span>';
    els.hint.setAttribute('role', 'button');
    els.pop = el('div', 'obpop',
      '<button class="opx" type="button">' + T('btn.close') + '</button>' + T('hint.detail'));
    app.appendChild(els.pop);
    els.hint.onclick = function(){
      if(els.pop.classList.contains('show')){ els.pop.classList.remove('show'); return; }
      var r = rectIn(els.hint);                              // 說明卡貼在提示列正上方，不蓋提示本身
      els.pop.style.top = 'auto';
      els.pop.style.bottom = Math.round(r.ah - r.y + 6) + 'px';
      els.pop.classList.add('show');
    };
    els.pop.querySelector('.opx').onclick = function(e){ e.stopPropagation(); els.pop.classList.remove('show'); };
    document.addEventListener('pointerdown', function(e){    // 點別處就收起，免得蓋著落點又開了局
      if(!els.pop.classList.contains('show')) return;
      if(els.pop.contains(e.target) || els.hint.contains(e.target)) return;
      els.pop.classList.remove('show');
    }, true);
  }

  /* ② 覆蓋層 */
  els.ov = el('div', '', '');
  els.ov.id = 'obd';
  els.ov.innerHTML =
    '<div class="obspot"></div>' +
    '<span class="obhand">👆</span>' +
    '<div class="obcard">' +
      '<div class="obstep"><span class="obdots"></span><span class="obn"></span></div>' +
      '<div class="obtit"></div><div class="obbody"></div>' +
      '<div class="obfoot"><button class="obskip" type="button"></button><button class="obnext" type="button"></button></div>' +
    '</div>';
  app.appendChild(els.ov);
  els.spot = els.ov.querySelector('.obspot');
  els.hand = els.ov.querySelector('.obhand');
  els.card = els.ov.querySelector('.obcard');
  els.skip = els.ov.querySelector('.obskip');
  els.next = els.ov.querySelector('.obnext');
  els.skip.textContent = T('btn.skip');
  els.skip.onclick = finish;
  els.next.onclick = next;

  /* ③ log 頁「重看教學」 */
  if(window.LogUI){
    var b = el('button', 'tutb', T('tut.replay'));
    b.type = 'button';
    b.onclick = function(){
      if(!canStart()){ toast(T('tut.blocked')); return; }
      LogUI.close();
      setTimeout(function(){ start(); toast(T('tut.replayed')); }, 60);
    };
    LogUI.addFooter(b);
  }

  window.addEventListener('resize', place);

  /* 啟動 */
  var force = D.q.tut;
  if(force === '0') return;
  if(force === '1'){ setTimeout(function(){ start(); }, 120); return; }
  if(D.q.shot) return;                                   // 截圖自動駕駛不彈
  if(opts.autoStart === false) return;
  if(D.ls('tut') === 'done') return;
  setTimeout(function(){ if(canStart()) start(); }, 260);
}

function canStart(){ return opts.canStart ? !!opts.canStart() : true; }

function place(){
  if(!on) return;
  var st = steps[idx], box = unionRect(resolve(st.target));
  var ch = els.card.offsetHeight || 150, gap = 14, top, aw, ah;
  if(!box){                                              // 找不到目標：不收掉引導，只置中顯示說明
    var a = app.getBoundingClientRect();
    aw = a.width; ah = a.height;
    els.spot.classList.add('none');
    els.spot.style.left = '0px'; els.spot.style.top = '0px';
    els.spot.style.width = aw + 'px'; els.spot.style.height = ah + 'px';
    els.hand.style.display = 'none';
    els.card.classList.remove('up', 'dn');
    els.card.style.top = Math.max(8, Math.round((ah - ch) / 2)) + 'px';
    return;
  }
  aw = box.aw; ah = box.ah;
  var pad = st.pad != null ? st.pad : 8;
  var x = Math.max(2, box.x - pad), y = Math.max(2, box.y - pad);
  var w = Math.min(aw - x - 2, box.w + pad * 2), h = Math.min(ah - y - 2, box.h + pad * 2);
  els.spot.classList.remove('none');
  els.spot.style.left = x + 'px'; els.spot.style.top = y + 'px';
  els.spot.style.width = w + 'px'; els.spot.style.height = h + 'px';
  /* 說明卡擺在聚光洞的另一側（洞在上半就放下面）；貼不下就夾在畫面內；小尖角對著洞中心 */
  var below = (y + h / 2) <= ah / 2;
  top = below ? (y + h + gap) : (y - gap - ch);
  top = Math.max(8, Math.min(ah - ch - 8, top));
  els.card.style.top = Math.round(top) + 'px';
  els.card.classList.toggle('up', below);
  els.card.classList.toggle('dn', !below);
  var cw = els.card.offsetWidth || (aw - 24);
  var tl = Math.max(22, Math.min(cw - 44, x + w / 2 - els.card.offsetLeft - 11));
  els.card.style.setProperty('--tl', Math.round(tl) + 'px');
  /* 👆 手指：擺在 hand 元素中心偏右下 */
  var hn = st.hand ? resolve(st.hand)[0] : null;
  if(hn){
    var hr = rectIn(hn);
    els.hand.style.display = 'block';
    els.hand.style.left = Math.round(hr.x + hr.w / 2 + 10) + 'px';
    els.hand.style.top = Math.round(hr.y + hr.h / 2 - 2) + 'px';
  }else els.hand.style.display = 'none';
}

function render(){
  var s = steps[idx], last = idx === steps.length - 1;
  els.ov.querySelector('.obn').textContent = T('tut.step', { n:idx + 1, total:steps.length });
  els.ov.querySelector('.obtit').textContent = T('tut.' + s.key + '.title');
  els.ov.querySelector('.obbody').textContent = T('tut.' + s.key + '.body');
  els.next.textContent = last ? T('btn.done') : T('btn.next');
  els.ov.querySelector('.obdots').innerHTML = steps.map(function(_, i){
    return '<i class="' + (i === idx ? 'on' : '') + '"></i>';
  }).join('');
  place();
}
function start(n){
  if(!steps.length) return;
  if(!canStart()){ toast(T('tut.blocked')); return; }
  if(els.pop) els.pop.classList.remove('show');
  on = true; idx = Math.max(0, Math.min(steps.length - 1, +n || 0));
  els.ov.classList.add('on');
  render();
  requestAnimationFrame(function(){ els.ov.classList.add('show'); place(); });
}
function next(){ if(idx < steps.length - 1){ idx++; render(); } else finish(); }
function finish(){
  on = false;
  els.ov.classList.remove('show');
  setTimeout(function(){ if(!on) els.ov.classList.remove('on'); }, 220);
  D.ls('tut', 'done');
}

return { mount:mount, start:start, finish:finish, isOpen:function(){ return on; } };
})();
