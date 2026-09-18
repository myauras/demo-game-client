/* =========================================================================
 * 專案E「皇帝牌」E09——新手帶入層
 *   ① 剋制環常駐（小三角圖：皇帝 > 平民 > 奴隸 > 皇帝）＋點擊展開白話說明
 *   ② 首次四步引導覆蓋層（選一邊下注 → 相剋演示 → 看兩邊出牌對決 → 收手或續戰）
 *   ③ log 頁「重看教學」入口
 *
 * 紀律：本檔只「加」DOM，不改既有檔的函式；字串一律走 t()（見 js/strings.js）
 * 效能：動畫只用 transform／opacity；聚光洞靠靜態 box-shadow，位置直接設不做補間
 * 對位：一律 getBoundingClientRect 換算成 #app 內座標，零硬編碼座標
 * ========================================================================= */
(function(){
'use strict';
if(!window.EUI) return;                                  // 沒有主 UI 就不掛（dev.html／sim.html）

var $ = document.getElementById.bind(document);
var app = $('app'), panel = $('panel'), banner = $('banner');
var T = window.t || function(k){ return k; };

/* ---------- 小工具 ---------- */
function qs(name){
  var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}
function ls(k, v){
  try{
    if(v === undefined) return localStorage.getItem(k);
    if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  }catch(e){}
  return null;
}
function el(tag, cls, html){
  var n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html != null) n.innerHTML = html;
  return n;
}
function rectIn(node){                                    // 元素在 #app 內的座標（getBoundingClientRect 換算，零硬編碼）
  var a = app.getBoundingClientRect(), r = node.getBoundingClientRect();
  return { x:r.left - a.left, y:r.top - a.top, w:r.width, h:r.height, aw:a.width, ah:a.height };
}
function autoRunning(){
  return !!(window.EAtmos && EAtmos.auto && EAtmos.auto.on);
}
function toast(s){ if(window.EAtmos && EAtmos.toast) EAtmos.toast(s); }

/* =========================================================================
 * ① 剋制環：小三角圖
 *    幾何固定在 viewBox 56×50 內（帝在上、民在右下、奴在左下，箭頭順時針＝「吃」）
 *    三個箭頭：帝→民、民→奴、奴→帝；純 inline SVG、無動畫
 * ========================================================================= */
function ringSVG(h){
  return '<svg class="ringsvg" viewBox="0 0 56 50" height="' + h + '" width="' + Math.round(h * 56 / 50) +
    '" role="img" aria-label="' + T('ring.aria') + '">' +
    '<line class="rarw" x1="33.6" y1="20.3" x2="39.4" y2="28.7"/>' +
    '<line class="rarw" x1="35" y1="37" x2="21" y2="37"/>' +
    '<line class="rarw" x1="16.6" y1="28.7" x2="22.4" y2="20.3"/>' +
    '<polygon class="rhead" points="39.4,28.7 35.2,26.7 39.1,24.0"/>' +
    '<polygon class="rhead" points="21,37 25,34.6 25,39.4"/>' +
    '<polygon class="rhead" points="22.4,20.3 22.1,25.0 18.2,22.3"/>' +
    '<circle class="rnode rE" cx="28" cy="12" r="10"/>' +
    '<circle class="rnode rC" cx="45" cy="37" r="10"/>' +
    '<circle class="rnode rS" cx="11" cy="37" r="10"/>' +
    '<text class="rtx rtxE" x="28" y="12">帝</text>' +
    '<text class="rtx rtxC" x="45" y="37">民</text>' +
    '<text class="rtx rtxS" x="11" y="37">奴</text>' +
    '</svg>';
}

/* 版位方案：A＝獨立說明列（普通機位夾在自動下注槽與面板之間；進階機位貼右緣階梯下方）
 *           B＝零高度徽章（貼戰報帶左端，兩機位共用）
 * 比稿期用 ?ring=a／?ring=b 切換並記住，定案後改 DEFAULT_POS 即可 */
var DEFAULT_POS = 'a';
var ringPos = (qs('ring') || ls('ecard.ringpos') || DEFAULT_POS).toLowerCase();
if(ringPos !== 'a' && ringPos !== 'b') ringPos = DEFAULT_POS;
if(qs('ring')) ls('ecard.ringpos', ringPos);
document.body.classList.add('ring-' + ringPos);

/* 版位 A：普通機位獨立列 */
var ringRow = el('div', 'ringrow',
  ringSVG(30) +
  '<span class="rtitle">' + T('ring.title') + '</span>' +
  '<span class="rline">' + T('ring.short') + '</span>' +
  '<span class="rmore">' + T('ring.more') + '</span>');
ringRow.setAttribute('role', 'button');
panel.parentNode.insertBefore(ringRow, panel);

/* 版位 A：進階機位分身（右緣直式階梯條下方） */
var ringSide = el('div', 'ringside', ringSVG(30));
ringSide.setAttribute('role', 'button');
$('advMain').appendChild(ringSide);

/* 版位 B：貼戰報帶左端的零高度徽章 */
var ringBadge = el('div', 'ringbadge', ringSVG(24) + '<span class="rq">?</span>');
ringBadge.setAttribute('role', 'button');
app.appendChild(ringBadge);
function syncBadge(){                                     // 跟著戰報帶走（普通／進階兩機位高度不同）
  var r = rectIn(banner);
  ringBadge.style.top = r.y + 'px';
  ringBadge.style.height = r.h + 'px';
}

/* 點開的一行白話說明 */
var ringPop = el('div', 'ringpop',
  '<button class="rpx" type="button">' + T('btn.close') + '</button>' + T('ring.detail'));
app.appendChild(ringPop);
function popShow(on){ ringPop.classList.toggle('show', !!on); }
ringRow.onclick = ringSide.onclick = ringBadge.onclick = function(){
  popShow(!ringPop.classList.contains('show'));
};
ringPop.querySelector('.rpx').onclick = function(e){ e.stopPropagation(); popShow(false); };

/* =========================================================================
 * ② 首次四步引導覆蓋層（R2：第 2 步為相剋演示）
 * ========================================================================= */
var K_TUT = 'ecard.tut';
function adv(){ return document.body.classList.contains('adv'); }
function ringTarget(){                                    // 常駐剋制環現在的所在（兩版位×兩機位）
  if(ringPos === 'b') return ringBadge;
  return adv() ? ringSide : ringRow;
}
var STEPS = [
  { key:'s1', target:function(){ return panel; } },
  { key:'s2', target:ringTarget },                          // 相剋演示：亮常駐剋制環，告訴玩家之後去哪看
  { key:'s3', target:function(){ return adv() ? document.querySelector('#advMain .table3d') : $('duelZ'); } },
  { key:'s4', target:function(){ return adv() ? $('vrail') : $('hrail'); } }
];

/* 相剋演示：三組配對依序上場，全程牌面翻開（E08 卡面圖），敗方淡出下沉、勝方微放大
 * 動畫全部走 CSS keyframes，只動 transform／opacity；?rm=1 降級為三組靜態並排 */
function demoHTML(){
  var P = [['emp','cit','emp_cit'], ['cit','slv','cit_slv'], ['slv','emp','slv_emp']];
  var CL = { emp:'e', slv:'s', cit:'c' }, GL = { emp:'glyph.emp', slv:'glyph.slv', cit:'glyph.cit' };
  function card(who, win){
    return '<span class="obdc ' + CL[who] + (win ? ' win' : ' lose') + '"><i>' + T(GL[who]) + '</i></span>';
  }
  var rows = P.map(function(p, i){
    return '<div class="obrow r' + i + '">' + card(p[0], true) + '<b>vs</b>' + card(p[1], false) +
      '<em>' + T('verdict.' + p[2]) + '</em></div>';
  }).join('');
  var oe = EUI.fmtX(EV.baseOdds('emp')), os = EUI.fmtX(EV.baseOdds('slv'));   // 數字一律取自 EV，零寫死
  var ratio = Math.round(EV.baseOdds('slv') / EV.baseOdds('emp'));
  return '<div class="obdemo' + (EUI.RM ? ' rm' : '') + '">' + rows + '</div>' +
    '<div class="obodds">' + T('tut.s2.odds', { pe:EV.CFG.P.emp * 100, oe:oe, ps:EV.CFG.P.slv * 100, os:os }) + '</div>' +
    '<div class="obnote">' + T('tut.s2.note', { ratio:ratio }) + '</div>';
}

var obd = el('div', '');
obd.id = 'obd';
obd.innerHTML =
  '<div class="obspot" id="obSpot"></div>' +
  '<button class="obskip" id="obSkip" type="button">' + T('btn.skip') + '</button>' +
  '<div class="obcard" id="obCard">' +
    '<div class="obstep" id="obStep"></div>' +
    '<div class="obtit" id="obTit"></div>' +
    '<div class="obbody" id="obBody"></div>' +
    '<div class="obring" id="obRing"></div>' +
    '<div class="obfoot">' +
      '<span class="obdots" id="obDots"></span>' +
      '<button class="obnext" id="obNext" type="button"></button>' +
    '</div>' +
  '</div>';
app.appendChild(obd);
var obSpot = $('obSpot'), obCard = $('obCard');

var stepIdx = -1, tutOn = false;
function place(){
  if(!tutOn) return;
  var node = STEPS[stepIdx].target();
  if(!node){ finish(); return; }
  var r = rectIn(node), pad = 6;
  var x = Math.max(2, r.x - pad), y = Math.max(2, r.y - pad);
  var w = Math.min(r.aw - x - 2, r.w + pad * 2), h = Math.min(r.ah - y - 2, r.h + pad * 2);
  obSpot.style.left = x + 'px'; obSpot.style.top = y + 'px';
  obSpot.style.width = w + 'px'; obSpot.style.height = h + 'px';
  /* 說明卡擺在聚光洞的另一側：洞在下半部就擺上面，反之擺下面；貼不下就夾在畫面內 */
  var ch = obCard.offsetHeight || 150, gap = 10;
  var top = (y + h / 2 > r.ah / 2) ? (y - gap - ch) : (y + h + gap);
  top = Math.max(38, Math.min(r.ah - ch - 8, top));
  obCard.style.top = top + 'px';
}
function render(){
  var s = STEPS[stepIdx], last = stepIdx === STEPS.length - 1;
  $('obStep').textContent = T('tut.step', { n:stepIdx + 1, total:STEPS.length });
  $('obTit').textContent  = T('tut.' + s.key + '.title');
  $('obBody').textContent = T('tut.' + s.key + '.body');
  $('obNext').textContent = last ? T('btn.done') : T('btn.next');
  /* 第 2 步：卡片內放相剋演示（常駐版位可能被卡片壓住，這一步保證看得到） */
  var ring = $('obRing'), on2 = s.key === 's2';
  ring.innerHTML = on2 ? demoHTML() : '';
  ring.className = on2 ? 'obring demo' : 'obring';
  ring.style.display = on2 ? 'block' : 'none';
  $('obDots').innerHTML = STEPS.map(function(_, i){
    return '<i class="' + (i === stepIdx ? 'on' : '') + '"></i>';
  }).join('');
  place();
}
function start(){
  if(autoRunning()){ toast(T('tut.blocked')); return; }
  popShow(false);
  tutOn = true; stepIdx = 0;
  obd.classList.add('on');
  render();
  requestAnimationFrame(function(){ obd.classList.add('show'); place(); });
}
function next(){
  if(stepIdx < STEPS.length - 1){ stepIdx++; render(); }
  else finish();
}
function finish(){
  tutOn = false;
  obd.classList.remove('show');
  setTimeout(function(){ if(!tutOn) obd.classList.remove('on'); }, 220);
  ls(K_TUT, 'done');
}
$('obNext').onclick = next;
$('obSkip').onclick = function(){ finish(); };

/* =========================================================================
 * ③ log 頁「重看教學」入口（掛在底列，與筆數同一行）
 * ========================================================================= */
var replayBtn = el('button', 'tutb', T('tut.replay'));
replayBtn.type = 'button';
replayBtn.onclick = function(){
  if(autoRunning()){ toast(T('tut.blocked')); return; }
  if(window.EAtmos && EAtmos.openLog) EAtmos.openLog(false);
  setTimeout(function(){ start(); toast(T('tut.replayed')); }, 60);
};
(function(){
  var foot = document.querySelector('#lgm .lgf');
  if(foot) foot.insertBefore(replayBtn, foot.firstChild);
})();

/* =========================================================================
 * 啟動：首次進場自動開；截圖自動駕駛與自動下注中不彈
 *   ?tut=1 強制重看（截圖用）、?tut=0 關閉
 * ========================================================================= */
function reposition(){ syncBadge(); place(); }
window.addEventListener('resize', reposition);
if(window.MutationObserver){                              // 切換普通⇄進階時，徽章與聚光洞跟著移位
  new MutationObserver(reposition)
    .observe(document.body, { attributes:true, attributeFilter:['class'] });
}
syncBadge();

(function boot(){
  var force = qs('tut');
  if(force === '0') return;
  if(force === '1'){ setTimeout(start, 120); return; }
  if(EUI.SHOT) return;                                    // 截圖自動駕駛頁不彈
  if(ls(K_TUT) === 'done') return;
  var s = EUI.game.getState();
  if(s.st || s.phase !== 'BET') return;                   // 重整接回到對局中途不彈，下次回下注態再說
  if(autoRunning()) return;
  setTimeout(start, 260);
})();

window.EOnboard = { start:start, finish:finish, ringPos:ringPos,
  setRingPos:function(p){ ls('ecard.ringpos', p); location.reload(); },
  isOpen:function(){ return tutOn; } };
})();
