/* =========================================================================
 * 三選一冒煙——新手引導骨架（拋棄式畫面；步驟與文案可沿用）
 *   ① 常駐一句「怎麼玩」提示（可點展開一行白話說明）
 *   ② 首次進場多步聚光引導（下一步／跳過；完成寫存檔旗標）
 *   ③ log 頁底列「重看教學」入口
 *
 * 介面：
 *   Onboard.mount({
 *     root,                 #app
 *     hintEl,               常駐提示的掛點（空 div，本檔填內容）
 *     steps:[{ key, target }],   key＝字典前綴（tut.<key>.title／tut.<key>.body）；
 *                                target＝CSS 選擇器或回傳元素的函式（聚光洞對位用）
 *     canStart() → boolean       目前可不可以開引導（例：自動下注中不開；預設 true）
 *     autoStart: boolean         非截圖、沒看過、沒帶 ?tut=0 時進場自動開
 *   })
 *   Onboard.start() / finish() / isOpen()
 * 網址：?tut=1 強制重播、?tut=0 關閉。完成寫『kitsmoke.tut』＝'done'；清掉即恢復首次引導。
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
function resolve(target){
  var n = typeof target === 'function' ? target() : document.querySelector(target);
  return n || null;
}
function rectIn(node){
  var a = app.getBoundingClientRect(), r = node.getBoundingClientRect();
  return { x:r.left - a.left, y:r.top - a.top, w:r.width, h:r.height, aw:a.width, ah:a.height };
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
    els.hint.onclick = function(){ els.pop.classList.toggle('show'); };
    els.pop.querySelector('.opx').onclick = function(e){ e.stopPropagation(); els.pop.classList.remove('show'); };
  }

  /* ② 覆蓋層 */
  els.ov = el('div', '', '');
  els.ov.id = 'obd';
  els.ov.innerHTML =
    '<div class="obspot"></div>' +
    '<button class="obskip" type="button"></button>' +
    '<div class="obcard">' +
      '<div class="obstep"></div><div class="obtit"></div><div class="obbody"></div>' +
      '<div class="obfoot"><span class="obdots"></span><button class="obnext" type="button"></button></div>' +
    '</div>';
  app.appendChild(els.ov);
  els.spot = els.ov.querySelector('.obspot');
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
  if(force === '1'){ setTimeout(start, 120); return; }
  if(D.q.shot) return;                                   // 截圖自動駕駛不彈
  if(opts.autoStart === false) return;
  if(D.ls('tut') === 'done') return;
  setTimeout(function(){ if(canStart()) start(); }, 260);
}

function canStart(){ return opts.canStart ? !!opts.canStart() : true; }

function place(){
  if(!on) return;
  var node = resolve(steps[idx].target);
  if(!node){ finish(); return; }
  var r = rectIn(node), pad = 6;
  var x = Math.max(2, r.x - pad), y = Math.max(2, r.y - pad);
  var w = Math.min(r.aw - x - 2, r.w + pad * 2), h = Math.min(r.ah - y - 2, r.h + pad * 2);
  els.spot.style.left = x + 'px'; els.spot.style.top = y + 'px';
  els.spot.style.width = w + 'px'; els.spot.style.height = h + 'px';
  /* 說明卡擺在聚光洞的另一側；貼不下就夾在畫面內 */
  var ch = els.card.offsetHeight || 140, gap = 10;
  var top = (y + h / 2 > r.ah / 2) ? (y - gap - ch) : (y + h + gap);
  top = Math.max(38, Math.min(r.ah - ch - 8, top));
  els.card.style.top = top + 'px';
}

function render(){
  var s = steps[idx], last = idx === steps.length - 1;
  els.ov.querySelector('.obstep').textContent = T('tut.step', { n:idx + 1, total:steps.length });
  els.ov.querySelector('.obtit').textContent = T('tut.' + s.key + '.title');
  els.ov.querySelector('.obbody').textContent = T('tut.' + s.key + '.body');
  els.next.textContent = last ? T('btn.done') : T('btn.next');
  els.ov.querySelector('.obdots').innerHTML = steps.map(function(_, i){
    return '<i class="' + (i === idx ? 'on' : '') + '"></i>';
  }).join('');
  place();
}
function start(){
  if(!steps.length) return;
  if(!canStart()){ toast(T('tut.blocked')); return; }
  if(els.pop) els.pop.classList.remove('show');
  on = true; idx = 0;
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
