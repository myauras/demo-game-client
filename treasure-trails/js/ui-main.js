/* =========================================================================
 * 三路尋寶——主畫面與闖關、擲骰演出（T02）
 *
 * 職責：把核心（DemoCore）算好的整局結果「演」出來——冒險者沿路走、收寶物、遇敵擲兩顆 6 面骰、
 *       打贏前進／打輸扣心重打／心扣完撤退、結算分四級回饋；管路線分頁、注額、餘額、戰利品列、地圖版位。
 *       演出只讀結果物件（events／fights／prizes），自己不擲骰、不判斷輸贏；演完才 game.ack() 入帳。
 *       LogUI／Autobet 的接線不在這裡（T03 的 js/wire.js）；導演台與完整截圖駕駛也不在這裡（T03 的 js/dev.js）。
 *
 * 對外（DEMO.ui）：
 *   on(evt, fn) / off(evt, fn)    事件：roundStart／roll／prize／retreat／roundEnd／mapChange／routeChange／stakeChange
 *   play(routeId, stake, opts?)   → Promise<{ stake, pay, payout, net, x, grade, route, reachedEnd, heartsLeft, result, orderId, wallet, ms }>
 *   busy() / setRoute(id) / setStake(n) / getRoute() / getStake() / setPace(fn) / resetWallet() / gradeOf(x)
 *   DEMO.addStrings(dict) 在 strings.js。
 *   詳細簽名與事件資料見 tasks/T02-主畫面與演出.md「完成註記」。
 *
 * ?shot=：dev.js（T03）接手前，本檔自己處理幾個截圖畫面（DEMO.shots：idle／idle-safe／idle-risk／long／
 *         roll／land／retry／win／miss／big／jackpot）。dev.js 載入後它會先分派（設 DEMO.shotDispatched），本檔就不再動。
 *
 * 動畫：只動 transform／opacity。演出時序用虛擬計時器與 rAF，加速時照 speed 倍率縮短；CSS 動畫用 --sp。無 filter。
 * 依賴：values.js、env.js、strings.js、toast.js、core.js。載入完成後設 window.__demoReady = true。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t;
var $ = function(id){ return document.getElementById(id); };
var CFG = EV.CFG, shot = D.q.shot, dev = D.q.dev;
var ROUTES = EV.ids();                                  // ['safe','mid','risk']
var FAST = 3.5;                                         // 點畫面加速倍率（至少 3 倍）
var AUTO_SPEED = 2.2;                                   // 高速模式下自動下注（opts.fast）的節拍
var NORMAL = 0.6, AUTO_NORMAL = 1;                      // 普通速度（預設）：手動 0.6 倍、自動 1 倍；高速模式＝節拍表原速
var SHOT_SEED = 486;                                    // ?shot= 用的地圖種子（test/sample-maps.json 的典型圖）

/* 節拍（毫秒，正常速度）。第一次遇敵整場約 1.1～1.3 秒；重打省掉走位與停頓，約 0.7 秒 */
var B = {
  start: 80,                                            // 出發前停一下
  toStart: 170,                                         // 從帳篷旁走到路的起點
  walkPx: 0.5,                                          // 走路速度（px／ms）
  walkMin: 110, walkMax: 300,
  prizeHold: 110, chestHold: 340,
  first: { pre: 110, flight: 600, stagger: 90, hold: 260, post: 100 },
  retry: { pre: 0,   flight: 430, stagger: 60, hold: 170, post: 50 },
  retreat: 380,
  hold: { miss: 300, back: 560, big: 1200, jackpot: 2300 },
  swapOut: 180
};

var appEl = $('app'), stageEl = $('stage'), lootEl = $('loot'), walEl = $('wal'), goBtn = $('goBtn');
var fxEl = $('fx'), ovEl = $('ov'), tabsEl = $('tabs'), stakesEl = $('stakes');

var game = DemoCore.createGame({ storage: shot ? false : undefined });
D.game = game;
if(shot) game.devSetMap(SHOT_SEED);

/* ---------- 狀態 ---------- */
var ri = 0;                                             // 每次進場都停在「穩」
var stake = D.ls('stake');
if(CFG.STAKES.indexOf(stake) < 0) stake = CFG.STAKES[0];
var busy = false, pend = null, cur = null;
var shownMap = game.getState().map;                     // 畫面上現在這張（演出中核心可能已換新圖，演完才換）
var lastSettled = null;
var speed = 1, userFast = false, frozen = false;
var hiSpeed = shot ? true : D.ls('speed') === 'fast';   // 速度切換鈕：false＝普通（預設）、true＝高速；截圖一律高速
var autoRound = false;
function baseSpeed(){ return autoRound ? (hiSpeed ? AUTO_SPEED : AUTO_NORMAL) : (hiSpeed ? 1 : NORMAL); }
var paceFn = null, subs = {};
var shownBal = game.getState().wallet, targetBal = shownBal, deferBal = false, balDelay = 0;
var LAY = null, X = null, A = null, layCache = {}, layKey = '';   // 目前版位、DOM 參照、冒險者、版位快取
var loot = { n: 0 };
var rollNo = 0;

/* ---------- 事件 ---------- */
function on(evt, fn){ (subs[evt] = subs[evt] || []).push(fn); return function(){ off(evt, fn); }; }
function off(evt, fn){
  var a = subs[evt]; if(!a) return;
  var i = a.indexOf(fn); if(i >= 0) a.splice(i, 1);
}
function emit(evt, data){
  var a = subs[evt]; if(!a) return;
  a = a.slice();
  for(var i = 0; i < a.length; i++){
    try{ a[i](data); }catch(e){ console.error('[DEMO.ui.on ' + evt + ']', e); }
  }
}

/* ---------- 小工具 ---------- */
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function easeOut(t){ return 1 - (1 - t) * (1 - t); }
function easeIO(t){ return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function noop(){}
function nowMs(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
function use(id, vb, cls){ return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="' + (vb || '0 0 24 24') + '"><use href="#' + id + '"/></svg>'; }
var CK = use('ic-ok', '0 0 12 12'), CX = use('ic-no', '0 0 12 12');
function needTier(n){ return n <= 6 ? 'ez' : n <= 8 ? 'md' : 'hd'; }       // 門檻顏色：≤6 綠、7～8 黃、≥9 紅
function gradeOf(x){ return x >= CFG.BIG_X ? 'jackpot' : x >= CFG.MID_X ? 'big' : x >= 1 ? 'back' : 'miss'; }

/* ---------- 虛擬計時器：加速時照倍率縮短 ---------- */
var timers = [], rolls = {}, tk = null, lastT = 0;
function kick(){ if(tk === null && !frozen){ lastT = nowMs(); tk = setTimeout(tick, 16); } }
function tick(){
  tk = null;
  if(frozen) return;
  var t = nowMs(), dt = Math.min(t - lastT, 100) * speed; lastT = t;
  var i, fire = [];
  for(i = timers.length - 1; i >= 0; i--){
    timers[i].left -= dt;
    if(timers[i].left <= 0){ fire.push(timers[i]); timers.splice(i, 1); }
  }
  var k, any = false;
  for(k in rolls){
    var r = rolls[k]; r.left -= dt;
    var p = r.left <= 0 ? 1 : 1 - r.left / r.total;
    r.apply(Math.round(r.from + (r.to - r.from) * (1 - Math.pow(1 - p, 3))));
    if(p >= 1) delete rolls[k]; else any = true;
  }
  fire.reverse().forEach(function(f){ f.res(); });
  if(timers.length || any || Object.keys(rolls).length) kick();
}
function sleep(ms){
  return new Promise(function(res){
    if(!(ms > 0)){ res(); return; }
    timers.push({ left: ms, res: res }); kick();
  });
}
function rollTo(key, from, to, ms, apply){
  delete rolls[key];
  if(!(ms > 0) || from === to){ apply(to); return; }
  rolls[key] = { from: from, to: to, left: ms, total: ms, apply: apply }; kick();
}
/* rAF 補間（也吃 speed）。fn(e, u)：e＝緩動後進度、u＝線性進度 */
function tween(ms, fn, ease){
  return new Promise(function(res){
    var el = 0, last = 0;
    function f(now){
      if(frozen) return;
      if(!last) last = now;
      el += Math.min(now - last, 64) * speed; last = now;
      var u = Math.min(1, el / ms);
      fn(ease ? ease(u) : u, u);
      if(u < 1) requestAnimationFrame(f); else res();
    }
    requestAnimationFrame(f);
  });
}
/* Web Animations：建立時就套目前速度 */
function anim(el, kf, o){
  var a = el.animate(kf, o);
  if(speed !== 1){ try{ a.playbackRate = speed; }catch(e){} }
  return a;
}
function setSpeed(s){
  var old = speed;
  if(s === old) return;
  speed = s;
  appEl.style.setProperty('--sp', s);
  var anims = [];
  try{ anims = document.getAnimations ? document.getAnimations() : []; }catch(e){}
  anims.forEach(function(a){ try{ a.playbackRate = a.playbackRate * s / old; }catch(e){} });
}
function speedUp(){
  if(!busy || userFast) return;
  userFast = true;
  setSpeed(FAST);
}
appEl.addEventListener('pointerdown', function(){ speedUp(); });
var spdBtn = $('spdBtn');
function renderSpd(){
  if(!spdBtn) return;
  spdBtn.classList.toggle('on', hiSpeed && !shot);            // 截圖模式為了省時間跑高速，但按鈕照預設（普通）顯示
  spdBtn.setAttribute('aria-pressed', hiSpeed ? 'true' : 'false');
  spdBtn.title = T(hiSpeed ? 'top.speed.fast' : 'top.speed.normal');
}
function setFast(v, quiet){
  v = !!v;
  if(v === hiSpeed) return;
  hiSpeed = v; D.ls('speed', v ? 'fast' : 'normal');
  renderSpd();
  if(busy && !userFast) setSpeed(baseSpeed());             // 演出中切換立刻生效
  if(!quiet) Toast.show(T(v ? 'top.speed.fast' : 'top.speed.normal'));
}
if(spdBtn){
  spdBtn.addEventListener('pointerdown', function(e){ e.stopPropagation(); });   // 不觸發「點畫面加速」
  spdBtn.onclick = function(){ setFast(!hiSpeed); };
  renderSpd();
}

/* ---------- 造型（卷軸風：深墨線＋平塗） ---------- */
var INK = '#3b2a1a', RED = '#b3261e';
var IMP = '<svg viewBox="0 0 40 40"><path d="M8 16 L4 3 L17 10 Z M32 16 L36 3 L23 10 Z" fill="#efe2c0" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
  '<ellipse cx="20" cy="23.5" rx="14.5" ry="13" fill="#9b87cf" stroke="' + INK + '" stroke-width="2.2"/>' +
  '<path d="M9.5 17.5 L17 21 M30.5 17.5 L23 21" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>' +
  '<ellipse cx="14.2" cy="23.5" rx="3.2" ry="3.6" fill="#fff6d8" stroke="' + INK + '" stroke-width="1.4"/><ellipse cx="25.8" cy="23.5" rx="3.2" ry="3.6" fill="#fff6d8" stroke="' + INK + '" stroke-width="1.4"/>' +
  '<circle cx="14.8" cy="24.2" r="1.6" fill="' + INK + '"/><circle cx="25.2" cy="24.2" r="1.6" fill="' + INK + '"/>' +
  '<path d="M12 30 Q20 34.5 28 30 Q20 38 12 30 Z" fill="' + INK + '"/><path d="M15 31.4 L16.6 34 L18.2 32.2 M25 31.4 L23.4 34 L21.8 32.2" fill="#fff6d8" stroke="#fff6d8" stroke-width="1" stroke-linejoin="round"/></svg>';
var ADV = '<svg viewBox="0 0 44 60"><path d="M13 24L5 54h34l-8-30z" fill="#a8363a" stroke="#4a1418" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<rect x="14" y="48" width="6" height="10" rx="2" fill="#3a2a1c" stroke="#1a1008" stroke-width="1.4"/><rect x="24" y="48" width="6" height="10" rx="2" fill="#3a2a1c" stroke="#1a1008" stroke-width="1.4"/>' +
  '<path d="M13 26h18l2 23H11z" fill="#3f6fb5" stroke="#14243f" stroke-width="1.6" stroke-linejoin="round"/><rect x="11.5" y="39" width="21" height="4" fill="#8a5a2a" stroke="#2e1a08" stroke-width="1"/><rect x="20" y="38.5" width="4" height="5" fill="#ffd24a"/>' +
  '<circle cx="22" cy="17" r="9" fill="#f0c89a" stroke="#6a4a2a" stroke-width="1.4"/><path d="M12.5 16a9.5 9.5 0 0 1 19 0z" fill="#8e98a6" stroke="#3a4250" stroke-width="1.4" stroke-linejoin="round"/><rect x="20" y="7.5" width="4" height="8.5" fill="#c9d0da"/>' +
  '<circle cx="18.5" cy="19" r="1.3" fill="#2a1a10"/><circle cx="25.5" cy="19" r="1.3" fill="#2a1a10"/>' +
  '<path d="M36 33L41 6" stroke="#dfe6ee" stroke-width="3.2" stroke-linecap="round"/><path d="M36 33L41 6" stroke="#7a8696" stroke-width="1" stroke-linecap="round"/><path d="M32.5 31.5l7 2" stroke="#ffd24a" stroke-width="3" stroke-linecap="round"/>' +
  '<circle cx="9" cy="37" r="7.5" fill="#c58a3c" stroke="#4a2c0c" stroke-width="1.6"/><circle cx="9" cy="37" r="3" fill="#ffd24a" stroke="#7a5000" stroke-width="1"/></svg>';
var CHECKG = '<g class="gk"><circle cx="0" cy="0" r="8" fill="' + RED + '" stroke="#f4e6c3" stroke-width="1.6"/><path d="M-3.6 .2 L-1 3 L3.8 -3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>';
/* 寶物外框（.ico）正好貼著可見的圖：金幣／寶石 viewBox 46×46＝60s 見方；大寶藏 54×52＝70.4s×67.8s */
function treasureSvg(v, tier){
  var t = '×' + EV.fmtX(v);
  if(tier === 'coin') return '<svg class="ico" viewBox="-23 -23 46 46"><circle r="19" fill="#f6c445" stroke="' + INK + '" stroke-width="3"/><circle r="14" fill="none" stroke="#c98a10" stroke-width="1.6"/>' +
    '<path d="M-10 -9 A14 14 0 0 1 4 -14" fill="none" stroke="#fff6c8" stroke-width="2.4" stroke-linecap="round"/><text x="0" y="4.4" text-anchor="middle" font-size="13" font-weight="900" fill="' + INK + '" letter-spacing="-.5">' + t + '</text>' +
    '<g class="gk"><circle r="24" fill="none" stroke="' + RED + '" stroke-width="2.6"/></g><g transform="translate(19 -20)">' + CHECKG + '</g></svg>';
  if(tier === 'gem') return '<svg class="ico" viewBox="-23 -23 46 46"><path d="M-21 -6 L-12 -19 L12 -19 L21 -6 L0 20 Z" fill="#62cfe8" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M-21 -6 H21 M-12 -19 L-6 -6 L0 20 L6 -6 L12 -19" fill="none" stroke="#2c8aa8" stroke-width="1.4" stroke-linejoin="round" opacity=".7"/><path d="M-16 -15 L-11 -15" stroke="#e8fbff" stroke-width="2.4" stroke-linecap="round"/>' +
    '<text x="0" y="2" text-anchor="middle" font-size="13" font-weight="900" fill="' + INK + '" letter-spacing="-.5">' + t + '</text>' +
    '<g class="gk"><circle r="25" fill="none" stroke="' + RED + '" stroke-width="2.6"/></g><g transform="translate(19 -20)">' + CHECKG + '</g></svg>';
  return '<svg class="ico ch" viewBox="-27 -27 54 52"><rect x="-25" y="-6" width="50" height="29" rx="4" fill="#9a6034" stroke="' + INK + '" stroke-width="3"/>' +
    '<path d="M-25 -6 V-12 A25 14 0 0 1 25 -12 V-6 Z" fill="#b6743c" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/><path d="M-25 -6 H25" stroke="' + INK + '" stroke-width="2.4"/>' +
    '<rect x="-25" y="-6" width="9" height="29" fill="#f2c24a" stroke="' + INK + '" stroke-width="2"/><rect x="16" y="-6" width="9" height="29" fill="#f2c24a" stroke="' + INK + '" stroke-width="2"/>' +
    '<rect x="-9" y="-11" width="18" height="12" rx="3" fill="#f6c445" stroke="' + INK + '" stroke-width="2.2"/><circle cx="0" cy="-5" r="2.2" fill="' + INK + '"/>' +
    '<text x="0" y="17.5" text-anchor="middle" font-size="14" font-weight="900" fill="#fff0c0" stroke="' + INK + '" stroke-width="3" paint-order="stroke" letter-spacing="-.3">' + t + '</text>' +
    '<g class="gk"><rect x="-27" y="-26" width="54" height="49" rx="11" fill="none" stroke="' + RED + '" stroke-width="2.6"/></g><g transform="translate(25 -23)">' + CHECKG + '</g></svg>';
}
var TENT = '<svg viewBox="-40 -44 80 70" width="80" height="70" style="position:absolute;left:-40px;top:-44px;overflow:visible"><path d="M0 -22 V-36" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/><path d="M1 -36 L15 -31 L1 -26 Z" fill="' + RED + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M-29 23 L0 -22 L29 23 Z" fill="#d9b172" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/><path d="M0 -22 L-8 23 M0 -22 L8 23" stroke="rgba(0,0,0,.22)" stroke-width="2"/>' +
  '<path d="M-8 23 L0 4 L8 23 Z" fill="' + INK + '"/><path d="M-36 23.5 H36" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/></svg>';
var SPARK = '<svg viewBox="-9 -9 18 18"><path d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2 Z" fill="#fff3b8" stroke="#d9962a" stroke-width="1" stroke-linejoin="round"/></svg>';

/* 骰子：立方體六面（點數 1～6），ORI＝要讓點數 n 的面朝 +z 所需的 rotateX／rotateY；
 * 擲骰時外層再加 rotateX(90deg) 把 +z 那面翻到正上方——結果一律是「朝上的那一面」，鏡頭從斜上方往下看（.tilt） */
var ORI = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function cubeHTML(){
  var h = '<div class="tilt"><div class="cube">';
  [[1, 'f1'], [6, 'f6'], [3, 'f3'], [4, 'f4'], [2, 'f2'], [5, 'f5']].forEach(function(p){
    h += '<div class="face ' + p[1] + '">';
    for(var i = 0; i < 9; i++) h += '<i' + (PIPS[p[0]].indexOf(i) >= 0 ? ' class="on"' : '') + '></i>';
    h += '</div>';
  });
  return h + '</div></div>';
}

/* ---------- 餘額 ---------- */
function setWalletText(n){ shownBal = n; walEl.textContent = D.fmt(n); }
function onWallet(w){
  var from = shownBal;
  targetBal = w;
  if(deferBal) return;
  if(w <= from){ rollTo('bal', from, w, 0, setWalletText); return; }          // 扣注：直接變
  if(balDelay > 0){
    var dly = balDelay; balDelay = 0;
    sleep(dly).then(function(){ rollTo('bal', shownBal, targetBal, 400, setWalletText); });
    return;
  }
  rollTo('bal', from, w, 400, setWalletText);
}
function flushBal(){ deferBal = false; delete rolls.bal; setWalletText(targetBal); }

/* ---------- 分頁、注額、戰利品列 ---------- */
function heartsHtml(full, max){ var s = ''; for(var i = 0; i < max; i++) s += use(i < full ? 'ic-heart' : 'ic-heart0', '0 0 24 22'); return s; }
var TAB_CLS = ['g', 'y', 'r'];
function renderTabs(){
  var h = '';
  ROUTES.forEach(function(id, i){
    var hs = CFG.ROUTES[i].hearts;
    h += '<button type="button" class="tab ' + TAB_CLS[i] + (i === ri ? ' on' : '') + '" data-i="' + i + '"><b>' + T('route.' + id) + '</b><span class="hs">' + heartsHtml(hs, hs) + '</span></button>';
  });
  tabsEl.innerHTML = h;
}
function renderStakes(){
  var h = '';
  CFG.STAKES.forEach(function(v){
    h += '<button type="button" class="bet' + (v === stake ? ' on' : '') + '" data-v="' + v + '">' + D.fmt(v) + '</button>';
  });
  stakesEl.innerHTML = h;
}
function prizeCount(route){ var n = 0; route.nodes.forEach(function(x){ if(x.kind === 'prize') n++; }); return n; }
function resetLoot(){
  var n = prizeCount(shownMap.routes[ri]), s = '';
  for(var i = 0; i < n; i++) s += '<div class="slot empty"></div>';
  lootEl.innerHTML = '<div class="slots" id="slots">' + s + '</div><div class="tot" id="tot"><small>' + T('main.back') + '</small><b>0</b></div>';
  loot = { n: 0 };
  delete rolls.tot;
}
function slotText(amount, w){
  var s = D.fmt(amount), cw = 6.6;
  if(s.length * cw + 4 <= w) return s;
  var k = amount >= 10000 ? Math.round(amount / 1000) + 'K' : (Math.round(amount / 100) / 10) + 'K';
  if(amount >= 1000 && k.length * cw + 4 <= w) return k;
  return '';
}
function fillSlot(idx, tier, amount){
  var slots = $('slots'), el = slots.children[idx];
  if(!el){ el = document.createElement('div'); slots.appendChild(el); }
  var txt = slotText(amount, el.clientWidth || 36);
  el.className = 'slot ' + tier + (txt ? '' : ' nb');
  el.setAttribute('data-a', amount);
  el.innerHTML = use('ic-' + tier, tier === 'chest' ? '0 0 32 28' : '0 0 24 24') + (txt ? '<b>' + txt + '</b>' : '');
  anim(el, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.2)', opacity: 1 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'ease-out' });
}
function setTot(v, cls){
  var t = $('tot'); if(!t) return;
  t.className = 'tot ' + (cls || '');
  t.querySelector('b').textContent = D.fmt(v);
}

/* ---------- 路的走向（種子 → 候選；同一張圖同一個走向） ---------- */
function mk(seed){ return EV.mulberry32((seed ^ 0x9E3779B9) >>> 0); }
function genParams(kind, rng){
  var r = function(a, b){ return a + rng() * (b - a); }, sg = function(){ return rng() < .5 ? 1 : -1; };
  if(kind === 'wave') return { kind: 'wave', ax: r(.33, .41), waves: [1, 1, 1.25, 1.5][Math.floor(rng() * 4)], phase: rng() < .5 ? 0 : Math.PI };
  if(kind === 'stair') return { kind: 'stair', rows: [3, 4, 4, 5][Math.floor(rng() * 4)], run: r(.6, .78), dir: sg(), round: r(14, 22) };
  return { kind: 'spiral', turns: r(1.05, 1.45), dir: sg(), r0: .92, r1: r(.2, .3) };
}
/* 第一個＝這張圖原本的走向；版位不夠擠時才往後換（也是種子決定，所以重整後相同） */
function pathCandidates(R){
  var rng = mk(R.shape + R.index * 7919), kinds = ['wave', 'stair', 'spiral'], k0 = Math.floor(rng() * 3), out = [];
  for(var i = 0; i < 15; i++) out.push(genParams(kinds[(k0 + i) % 3], rng));
  return out;
}
function genPoly(p, bx, by, bw, bh, s){
  var pts = [], i, t, N = 240, X0 = function(u){ return bx + bw * u; }, Y0 = function(v){ return by + bh * (1 - v); };
  if(p.kind === 'wave'){
    for(i = 0; i <= N; i++){ t = i / N; pts.push({ x: X0(.5 + p.ax * Math.sin(2 * Math.PI * p.waves * t + p.phase)), y: Y0(t) }); }
  }else if(p.kind === 'spiral'){
    for(i = 0; i <= N; i++){
      t = i / N;
      var a = -Math.PI / 2 + p.dir * 2 * Math.PI * p.turns * t, r = lerp(p.r0, p.r1, t);
      pts.push({ x: X0(.5 + .5 * r * Math.cos(a)), y: Y0(.5 + .5 * r * Math.sin(a)) });
    }
  }else{
    var ctl = [], k, a0 = (1 - p.run) / 2, b0 = a0 + p.run, mx = function(v){ return p.dir > 0 ? v : 1 - v; };
    for(k = 0; k < p.rows; k++){
      var yy = k / (p.rows - 1), x0 = k % 2 === 0 ? a0 : b0, x1 = k % 2 === 0 ? b0 : a0;
      ctl.push({ x: X0(mx(x0)), y: Y0(yy) }); ctl.push({ x: X0(mx(x1)), y: Y0(yy) });
    }
    pts = roundPoly(ctl, p.round * s);
  }
  return pts;
}
function roundPoly(c, r){
  var out = [c[0]], i, j;
  for(i = 1; i < c.length - 1; i++){
    var a = c[i - 1], b = c[i], d = c[i + 1];
    var l1 = Math.hypot(a.x - b.x, a.y - b.y), l2 = Math.hypot(d.x - b.x, d.y - b.y), r1 = Math.min(r, l1 / 2), r2 = Math.min(r, l2 / 2);
    var p1 = { x: b.x + (a.x - b.x) / l1 * r1, y: b.y + (a.y - b.y) / l1 * r1 }, p2 = { x: b.x + (d.x - b.x) / l2 * r2, y: b.y + (d.y - b.y) / l2 * r2 };
    for(j = 0; j <= 8; j++){ var t = j / 8, q = 1 - t; out.push({ x: q * q * p1.x + 2 * q * t * b.x + t * t * p2.x, y: q * q * p1.y + 2 * q * t * b.y + t * t * p2.y }); }
  }
  out.push(c[c.length - 1]);
  return out;
}
function ptAt(L, d){
  var c = L.cum, i = 1;
  d = clamp(d, 0, L.L);
  while(i < c.length - 1 && c[i] < d) i++;
  var u = (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1), a = L.pts[i - 1], b = L.pts[i];
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
}
function subPath(L, s0, s1){
  var p = ptAt(L, s0), d = 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1), i;
  for(i = 1; i < L.pts.length; i++) if(L.cum[i] > s0 && L.cum[i] < s1) d += ' L' + L.pts[i].x.toFixed(1) + ' ' + L.pts[i].y.toFixed(1);
  p = ptAt(L, s1);
  return d + ' L' + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
}

/* ---------- 版位：地圖區多大就畫多大；不夠擠就換走向、再縮小節點；全部在這裡算，不碰 DOM ---------- */
var CW = 40, CH = 20, CG = 2, CHH = 2 * CH + CG;        // 結果小標：寬、高、間距、留 2 個的總高
function ov(a, b, m){ return a[2] > b[0] + m && a[0] < b[2] - m && a[3] > b[1] + m && a[1] < b[3] - m; }
function rectCircle(r, cx, cy, rad){ return Math.hypot(cx - clamp(cx, r[0], r[2]), cy - clamp(cy, r[1], r[3])) < rad; }
function boxOf(nd, c, s){                               // 節點的可見外框（和 CSS 的 .tok／.ico 一致）
  if(nd.kind === 'prize' && nd.tier === 'chest') return [c.x - 35.2 * s, c.y - 35.2 * s, c.x + 35.2 * s, c.y + 32.6 * s];
  return [c.x - 30 * s, c.y - 30 * s, c.x + 30 * s, c.y + 30 * s];
}
function geometry(R, W, H, cand, sm){
  var N = R.nodes, n = N.length, i, k, q;
  var s = Math.max(.5, clamp(Math.min(W / 355, H / 450) * .74, .52, .84) * sm), as = s * 1.1;
  var cs = clamp(Math.round(s * 54), 28, 44);
  var padX = 36 * s + 14, padTop = 40 * s + 22, padBot = 36 * s + 8;
  var pts = genPoly(cand, padX, padTop, W - 2 * padX, H - padTop - padBot, s), cum = [0];
  for(i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  var L = { s: s, as: as, cs: cs, W: W, H: H, pts: pts, cum: cum, L: cum[cum.length - 1], cand: cand, sm: sm, n: n };
  var sN = []; for(k = 0; k <= n; k++) sN.push(L.L * k / n);
  var P = sN.map(function(v){ return ptAt(L, v); });
  L.sN = sN; L.P = P; L.stand = []; L.info = [];
  var tsc = s * 1.05, t0 = { x: P[0].x, y: P[0].y - 12 * s };
  L.tent = [t0.x - 40 * tsc, t0.y - 44 * tsc, t0.x + 40 * tsc, t0.y + 26 * tsc]; L.tentAt = t0; L.tentScale = tsc;
  var boxes = N.map(function(nd, j){ return boxOf(nd, P[j + 1], s); });
  var advRect = function(sp){ return [sp.x - 17 * as, sp.y - 48 * as, sp.x + 17 * as, sp.y]; };
  var chH = CHH, pillW = CFG.ROUTES[R.index].hearts * 16 + 2 * (CFG.ROUTES[R.index].hearts - 1) + 16;
  var FPW = 2 * cs + 8, FPH = cs + 36;                  // 兩顆骰子＋點數和小標佔的框（以骰列中心為準：上 cs/2+30、下 cs/2+6）
  for(k = 0; k < n; k++){
    var c = P[k + 1], segLen = sN[k + 1] - sN[k];
    if(N[k].kind !== 'enemy'){ L.info[k] = { c: c, box: boxes[k] }; L.stand[k] = 1; continue; }
    var dd, sp = null;
    for(dd = 24; dd <= Math.min(segLen * .86, 100); dd += 2){
      sp = ptAt(L, sN[k + 1] - dd);
      if(!rectCircle(advRect(sp), c.x, c.y, 24 * s + 5)) break;
    }
    if(!sp){ dd = 24; sp = ptAt(L, sN[k + 1] - dd); }
    var below = sp.y > c.y + 6;
    var badge = function(bl){ return bl ? [c.x - 27, c.y - 30 * s - 9, c.x + 27, c.y - 30 * s + 12] : [c.x - 27, c.y + 30 * s - 12, c.x + 27, c.y + 30 * s + 9]; };
    var occ = function(bl, rc){ return bl ? [rc[0], c.y - 8, rc[2], c.y - 8 + chH] : [rc[0], c.y + 8 - chH, rc[2], c.y + 8]; };
    // 1. 結果小標放左、右、上、下（左右優先；上下是擠不下時的備案）
    var best = null;
    ['sl', 'sr', 'st', 'sb'].forEach(function(side){
      var x0 = side === 'sr' ? c.x + 31 : c.x - 31 - CW, pen = side === 'st' || side === 'sb' ? 3 : 0, j, rc;
      if(side === 'st') rc = [c.x - CW / 2, c.y - 30 * s - 4 - chH, c.x + CW / 2, c.y - 30 * s - 4];
      else if(side === 'sb') rc = [c.x - CW / 2, c.y + 30 * s + 4, c.x + CW / 2, c.y + 30 * s + 4 + chH];
      else rc = occ(below, [x0, 0, x0 + CW, 0]);
      if(side === 'st' || side === 'sb'){ if(ov(rc, badge(below), 0)) pen += 30; }
      for(q = 0; q < pts.length; q += 2){ var pp = pts[q]; if(pp.x > rc[0] - 3 && pp.x < rc[2] + 3 && pp.y > rc[1] - 3 && pp.y < rc[3] + 3) pen += 1; }
      for(j = 0; j < n; j++) if(j !== k && ov(rc, boxes[j], -2)) pen += 14;
      if(ov(rc, L.tent, -2)) pen += 14;
      if(rc[0] < 0 || rc[2] > W || rc[1] < 0 || rc[3] > H) pen += 200;
      if(ov(rc, advRect(sp), 0)) pen += 16;
      if(!best || pen < best.pen) best = { side: side, pen: pen, rc: rc };
    });
    // 2. 冒險者重新找站位：不蓋敵人、不蓋小標、不蓋門檻小標
    var bdR = badge(below), bs = null;
    for(dd = 24; dd <= Math.min(segLen * .92, 110); dd += 2){
      var sp1 = ptAt(L, sN[k + 1] - dd), ar = advRect(sp1), pn = dd * .05;
      if(rectCircle(ar, c.x, c.y, 24 * s + 5)) pn += 40;
      if(ov(ar, best.side === 'sl' || best.side === 'sr' ? occ(below, best.rc) : best.rc, 0)) pn += 25;
      if(ov(ar, bdR, 0)) pn += 25;
      if(ar[0] < 2 || ar[2] > W - 2) pn += 60;
      if(!bs || pn < bs.pn) bs = { pn: pn, dd: dd, sp: sp1 };
    }
    if(bs){ sp = bs.sp; dd = bs.dd; }
    L.stand[k] = 1 - dd / segLen;
    below = sp.y > c.y + 6;
    bdR = badge(below);
    var chipRc = best.side === 'sl' || best.side === 'sr' ? occ(below, best.rc) : best.rc, ar2 = advRect(sp);
    var csJ = best.side === 'st' ? 'flex-end' : best.side === 'sb' ? 'flex-start' : below ? 'flex-start' : 'flex-end';
    var csA = best.side === 'sl' ? 'flex-end' : best.side === 'sr' ? 'flex-start' : 'center';
    // 3. 兩顆骰子落哪（以骰列中心為準，八個候選）
    var dx = 30 * s + cs + 12, dyU = 30 * s + cs / 2 + 32, dyD = 30 * s + cs / 2 + 10, opp = best.side === 'sl' ? 1 : -1;
    var cands = [
      { x: c.x + opp * dx, y: c.y, pen: 0 }, { x: c.x - opp * dx, y: c.y, pen: 6 },
      { x: c.x, y: c.y - dyU, pen: 8 }, { x: c.x, y: c.y + dyD, pen: 8 },
      { x: c.x + opp * dx * .75, y: c.y - dyU * .75, pen: 10 }, { x: c.x - opp * dx * .75, y: c.y - dyU * .75, pen: 12 },
      { x: c.x + opp * dx * .75, y: c.y + dyD * .9, pen: 12 }, { x: c.x - opp * dx * .75, y: c.y + dyD * .9, pen: 12 },
      { x: c.x + opp * dx * 1.35, y: c.y, pen: 14 }, { x: c.x - opp * dx * 1.35, y: c.y, pen: 16 },
      { x: c.x + opp * dx * 1.2, y: c.y - dyU * .6, pen: 16 }, { x: c.x - opp * dx * 1.2, y: c.y - dyU * .6, pen: 18 },
      { x: c.x + opp * dx * 1.2, y: c.y + dyD * .7, pen: 18 }, { x: c.x - opp * dx * 1.2, y: c.y + dyD * .7, pen: 20 }
    ], bl = null;
    cands.forEach(function(cd){
      var ox = cd.x, oy = cd.y;
      cd.x = clamp(cd.x, FPW / 2 + 2, W - FPW / 2 - 2); cd.y = clamp(cd.y, cs / 2 + 32, H - cs / 2 - 8);       // 擠進地圖區（骰子不能被裁掉）
      var fp = [cd.x - FPW / 2, cd.y - cs / 2 - 30, cd.x + FPW / 2, cd.y + cs / 2 + 6], pen = cd.pen + Math.abs(cd.x - ox) * .1 + Math.abs(cd.y - oy) * .1, j;
      for(j = 0; j < n; j++) if(ov(fp, boxes[j], 2)) pen += (j === k ? 60 : 30);
      if(ov(fp, L.tent, 2)) pen += 30;
      if(ov(fp, chipRc, 0)) pen += 30;
      if(ov(fp, bdR, 0)) pen += 30;
      if(ov(fp, ar2, 0)) pen += 25;
      if(!bl || pen < bl.pen) bl = { x: cd.x, y: cd.y, pen: pen, fp: fp };
    });
    // 4. 心條：頭上／右邊／左邊
    var opts = [['up', sp.x - pillW / 2, sp.y - 60 * as - 26], ['R', sp.x + 17 * as + 6, sp.y - 22 * as - 11], ['L', sp.x - 17 * as - 6 - pillW, sp.y - 22 * as - 11]], bp = null;
    opts.forEach(function(o){
      var rc = [o[1], o[2], o[1] + pillW, o[2] + 22], pen = o[0] === 'up' ? 0 : 1, j;
      if(ov(rc, boxes[k], -2)) pen += 30;
      if(ov(rc, bdR, 0)) pen += 30;
      if(ov(rc, chipRc, 0)) pen += 30;
      if(ov(rc, bl.fp, 0)) pen += 12;
      for(j = 0; j < n; j++) if(j !== k && ov(rc, boxes[j], -2)) pen += 20;
      if(rc[0] < 2 || rc[2] > W - 2 || rc[1] < 2) pen += 100;
      if(!bp || pen < bp.pen) bp = { m: o[0], pen: pen };
    });
    L.info[k] = { c: c, box: boxes[k], side: best.side, csJ: csJ, csA: csA, below: below, bdR: bdR, chipRc: chipRc, stand: sp, land: { x: bl.x, y: bl.y }, pill: bp.m };
  }
  // 冒險者待命位置：帳篷旁，離路與節點最遠的那邊
  var cd2 = [[58, 4], [-58, 4], [0, -50], [54, -30], [-54, -30]], bestH = null;
  cd2.forEach(function(cc){
    var hx = P[0].x + cc[0] * as, hy = P[0].y + cc[1] * as, m = 1e9, q2;
    for(q2 = 0; q2 < pts.length; q2++) if(cum[q2] > 46) m = Math.min(m, Math.hypot(pts[q2].x - hx, pts[q2].y - 22 * as - hy));
    for(q2 = 1; q2 <= n; q2++) m = Math.min(m, Math.hypot(P[q2].x - hx, P[q2].y - 22 * as - hy) - 6);
    if(hx < 24 * as || hx > W - 24 * as || hy > H - 4) m -= 200;
    if(!bestH || m > bestH.m) bestH = { x: hx, y: hy, m: m };
  });
  L.home = { x: bestH.x, y: bestH.y };
  L.viol = verify(L, R);
  return L;
}
/* 版位自查：節點互蓋、小標蓋到別的節點、東西超出地圖區。回傳違規描述陣列（空＝合格） */
function verify(L, R){
  var out = [], n = R.nodes.length, W = L.W, H = L.H, I = L.info, k, j;
  var oob = function(r){ return r[0] < -.5 || r[2] > W + .5 || r[1] < -.5 || r[3] > H + .5; };
  for(k = 0; k < n; k++){
    var b = I[k].box;
    if(oob(b)) out.push('節點' + k + ' 超出地圖區');
    if(ov(b, L.tent, .3)) out.push('節點' + k + ' 蓋到帳篷');
    for(j = k + 1; j < n; j++) if(ov(b, I[j].box, .3)) out.push('節點' + k + ' 與 ' + j + ' 互蓋');
    if(R.nodes[k].kind !== 'enemy') continue;
    var bd = I[k].bdR, ch = I[k].chipRc;
    if(oob(bd)) out.push('節點' + k + ' 門檻小標超出地圖區');
    if(oob(ch)) out.push('節點' + k + ' 結果小標超出地圖區');
    if(ov(bd, L.tent, .3)) out.push('節點' + k + ' 門檻小標蓋到帳篷');
    for(j = 0; j < n; j++){
      if(j === k) continue;
      if(ov(bd, I[j].box, .3)) out.push('節點' + k + ' 門檻小標蓋到節點' + j);
      if(ov(ch, I[j].box, .3)) out.push('節點' + k + ' 結果小標蓋到節點' + j);
      if(j > k && R.nodes[j].kind === 'enemy'){
        if(ov(bd, I[j].bdR, .3)) out.push('門檻小標 ' + k + ' 與 ' + j + ' 互蓋');
        if(ov(ch, I[j].chipRc, .3)) out.push('結果小標 ' + k + ' 與 ' + j + ' 互蓋');
        if(ov(bd, I[j].chipRc, .3)) out.push('門檻小標 ' + k + ' 蓋到結果小標 ' + j);
        if(ov(ch, I[j].bdR, .3)) out.push('結果小標 ' + k + ' 蓋到門檻小標 ' + j);
      }
    }
  }
  return out;
}
/* 選版位：先在原本大小試遍所有走向，不行再縮小節點；都不行就取違規最少的 */
function planLayout(R, W, H){
  var cands = pathCandidates(R), best = null, SM = [1, .94, .88, .82, .76], a, c;
  for(a = 0; a < SM.length; a++){
    for(c = 0; c < cands.length; c++){
      var L = geometry(R, W, H, cands[c], SM[a]);
      if(!L.viol.length){ L.pick = { cand: c, sm: SM[a] }; return L; }
      if(!best || L.viol.length < best.viol.length){ best = L; best.pick = { cand: c, sm: SM[a] }; }
    }
  }
  return best;
}
function getLayout(){
  var W = stageEl.clientWidth, H = stageEl.clientHeight;
  if(!W || !H) return null;
  var key = shownMap.seed + ':' + ri + ':' + W + 'x' + H;
  if(!layCache[key]){
    var keys = Object.keys(layCache);
    if(keys.length > 12) layCache = {};
    layCache[key] = planLayout(shownMap.routes[ri], W, H);
  }
  return layCache[key];
}

/* ---------- 畫出地圖（只畫選中的那條路） ---------- */
var dl = document.createElement('div');                  // 骰子層：骰子、影子、點數和小標（只建一次，每次換圖再掛回舞台）
dl.className = 'dl';
var DICE = [0, 1].map(function(i){
  var sh = document.createElement('div'); sh.className = 'dsh';
  var dp = document.createElement('div'); dp.className = 'dp'; dp.innerHTML = cubeHTML();
  dl.appendChild(sh); dl.appendChild(dp);
  return { sh: sh, dp: dp, cube: dp.querySelector('.cube'), rx: 0, ry: 0 };
});
var dsum = document.createElement('div'); dsum.className = 'dsum'; dl.appendChild(dsum);

function renderStage(){
  var L = getLayout(); if(!L) return false;
  var R = shownMap.routes[ri], N = R.nodes, n = N.length, k;
  LAY = L;
  var h = '<svg class="paths" id="paths" width="' + L.W + '" height="' + L.H + '"><g id="decor" opacity=".4" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></g>';
  for(k = 0; k < n; k++) h += '<path class="pb" d="' + subPath(L, L.sN[k], L.sN[k + 1]) + '"/>';
  for(k = 0; k < n; k++) h += '<path class="pr" id="pr' + k + '" d="' + subPath(L, L.sN[k], L.sN[k + 1]) + '"/>';
  h += '</svg><div class="nd tent" id="tent" style="transform:translate(' + L.tentAt.x.toFixed(1) + 'px,' + L.tentAt.y.toFixed(1) + 'px)"><div style="transform:scale(' + L.tentScale.toFixed(3) + ');transform-origin:0 0">' + TENT + '</div></div>';
  N.forEach(function(nd, j){
    var inf = L.info[j], tf = 'transform:translate(' + inf.c.x.toFixed(1) + 'px,' + inf.c.y.toFixed(1) + 'px)';
    if(nd.kind === 'enemy'){
      h += '<div class="nd en ' + (inf.below ? 'bt' : 'bb') + ' tier-' + needTier(nd.need) + '" id="nd' + j + '" style="' + tf + '"><div class="tok"><div class="spr">' + IMP + '</div></div>' +
        '<div class="bd">' + use('ic-dice', '0 0 26 16') + '<b>' + nd.need + '+</b></div><div class="cs" style="left:' + (inf.chipRc[0] - inf.c.x).toFixed(1) + 'px;top:' + (inf.chipRc[1] - inf.c.y).toFixed(1) + 'px;justify-content:' + inf.csJ + ';align-items:' + inf.csA + '"></div></div>';
    }else{
      h += '<div class="nd tr" id="nd' + j + '" style="' + tf + '">' + treasureSvg(nd.v, nd.tier) + '</div>';
    }
  });
  h += '<div class="adv" id="adv"><div class="in">' + ADV + '</div></div><div class="advh" id="advh"></div>';
  stageEl.innerHTML = h;
  stageEl.style.setProperty('--s', L.s.toFixed(3));
  stageEl.appendChild(dl);
  dl.style.setProperty('--cs', L.cs + 'px');
  hideDice();
  X = { nd: [], cs: [], tok: [], ico: [], pr: [], adv: $('adv'), advIn: $('adv').firstChild, advh: $('advh') };
  for(k = 0; k < n; k++){
    var el = $('nd' + k);
    X.nd[k] = el; X.cs[k] = el.querySelector('.cs'); X.tok[k] = el.querySelector('.tok'); X.ico[k] = el.querySelector('.ico'); X.pr[k] = $('pr' + k);
  }
  A = { seg: -1, t: 0, x: L.home.x, y: L.home.y, flip: 1, pillMode: 'up', pillW: 0 };
  setAdv(-1, 0);
  renderDecor(L, n);
  if(dev && L.viol.length) console.error('[ui] 版位自查未過（seed ' + shownMap.seed + '、路 ' + ROUTES[ri] + '、' + L.W + 'x' + L.H + '）：' + L.viol.join('；'));
  return true;
}
function renderDecor(L, n){                              // 地圖上的淡淡裝飾：放在離路最遠的空地
  var s = L.s, W = L.W, H = L.H, P = L.P, pts = L.pts;
  var tree = '<path d="M0 14 V0"/><path d="M-9 4 L0 -16 L9 4 Z"/><path d="M-7 -4 L0 -22 L7 -4"/>';
  var items = [
    { r: 34, svg: '<circle r="19"/><circle r="14" stroke-dasharray="2 3"/><path d="M0 -26 L4.5 0 L0 26 L-4.5 0 Z" fill="' + INK + '" fill-opacity=".35"/><path d="M-26 0 L0 -4.5 L26 0 L0 4.5 Z"/>', sc: .9 },
    { r: 36, svg: '<path d="M-26 20 L-9 -10 L2 8 L12 -16 L30 20 Z"/><path d="M-9 -10 L-14 -2 L-9 1 L-5 -3 M12 -16 L6 -6 L12 -1 L17 -8"/>', sc: 1 },
    { r: 30, svg: tree + '<g transform="translate(18 14) scale(.75)">' + tree + '</g>', sc: 1 },
    { r: 28, svg: '<path d="M0 0 q6 -7 12 0 t12 0 t12 0"/><path d="M8 11 q6 -7 12 0 t12 0"/>', sc: 1 }
  ];
  var spots = [], gx, gy, Dh = '';
  for(gx = .13; gx < .9; gx += .185) for(gy = .08; gy < .95; gy += .14) spots.push({ x: W * gx, y: H * gy });
  items.forEach(function(it){
    var bi = -1, bd2 = -1;
    spots.forEach(function(sp2, si){
      var m = 1e9, q;
      for(q = 0; q < pts.length; q += 3) m = Math.min(m, Math.hypot(pts[q].x - sp2.x, pts[q].y - sp2.y));
      for(q = 0; q <= n; q++) m = Math.min(m, Math.hypot(P[q].x - sp2.x, P[q].y - sp2.y) - 12);
      if(sp2.x < 28 || sp2.x > W - 28 || sp2.y < 26 || sp2.y > H - 26) m -= 60;
      if(m > bd2){ bd2 = m; bi = si; }
    });
    if(bi < 0 || bd2 < it.r * s + 10) return;
    var sp3 = spots[bi];
    Dh += '<g transform="translate(' + sp3.x.toFixed(1) + ' ' + sp3.y.toFixed(1) + ') scale(' + (it.sc * s).toFixed(2) + ')">' + it.svg + '</g>';
    spots = spots.filter(function(o){ return Math.hypot(o.x - sp3.x, o.y - sp3.y) > 70; });
  });
  $('decor').innerHTML = Dh;
}

/* ---------- 冒險者與心 ---------- */
function advXY(seg, t){
  if(seg < 0) return { x: LAY.home.x, y: LAY.home.y };
  return ptAt(LAY, LAY.sN[seg] + (LAY.sN[seg + 1] - LAY.sN[seg]) * t);
}
function pillXY(p){
  var u = LAY.as, w = A.pillW, m = A.pillMode, q;
  if(m === 'R') q = { x: p.x + 17 * u + 6, y: p.y - 22 * u - 11 };
  else if(m === 'L') q = { x: p.x - 17 * u - 6 - w, y: p.y - 22 * u - 11 };
  else q = { x: p.x - w / 2, y: p.y - 60 * u - 26 };
  q.x = clamp(q.x, 2, LAY.W - w - 2); q.y = Math.max(2, q.y);                       // 不要被地圖區裁掉
  return q;
}
function setAdv(seg, t, xy){
  var p = xy || advXY(seg, t), u = LAY.as;
  A.seg = seg; A.t = t; A.x = p.x; A.y = p.y;
  X.adv.style.transform = 'translate(' + (p.x - 22).toFixed(1) + 'px,' + (p.y - 60).toFixed(1) + 'px) scale(' + (A.flip * u).toFixed(3) + ',' + u.toFixed(3) + ')';
  var q = pillXY(p);
  X.advh.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px)';
}
function showHearts(curH, max){
  var s = '';
  for(var i = 0; i < max; i++) s += '<i>' + use(i < curH ? 'ic-heart' : 'ic-heart0', '0 0 24 22') + '</i>';
  X.advh.innerHTML = s; X.advh.classList.add('show');
  X.advh.classList.toggle('last', curH === 1 && max > 1);       // 剩最後一顆：心條邊框轉紅
  A.pillW = max * 16 + 2 * (max - 1) + 16;
  setAdv(A.seg, A.t, { x: A.x, y: A.y });
}
function setPillMode(m){                                         // 進入／離開戰鬥時換心條位置（短暫開 transition 讓它滑過去）
  if(A.pillMode === m) return;
  A.pillMode = m; X.advh.classList.add('slide');
  setAdv(A.seg, A.t, { x: A.x, y: A.y });
  setTimeout(function(){ if(X) X.advh.classList.remove('slide'); }, 230 / speed);
}
function loseHeart(left, max){
  var hp = X.advh.children[left];
  if(hp){
    anim(hp, [{ transform: 'scale(1)' }, { transform: 'scale(1.7)', opacity: 1 }, { transform: 'scale(.2)', opacity: 0 }], { duration: 300, easing: 'ease-in' }).onfinish = function(){ hp.innerHTML = use('ic-heart0', '0 0 24 22'); hp.style.opacity = ''; };
  }
  X.advh.classList.toggle('last', left === 1 && max > 1);
}

/* ---------- 行走 ---------- */
function walk(seg, a, b, ms, ease){
  X.pr[seg].classList.add('on');
  return tween(ms, function(e, u){
    setAdv(seg, a + (b - a) * e);
    X.advIn.style.transform = 'translateY(' + (-Math.abs(Math.sin(u * ms / 95)) * 3).toFixed(1) + 'px)';
  }, ease || null).then(function(){ X.advIn.style.transform = ''; });
}
function walkMs(seg, a, b){
  var len = Math.abs(b - a) * (LAY.sN[seg + 1] - LAY.sN[seg]);
  return clamp(len / B.walkPx, B.walkMin, B.walkMax);
}
function moveXY(to, ms){
  var f = { x: A.x, y: A.y };
  return tween(ms, function(e){ setAdv(-1, 0, { x: lerp(f.x, to.x, e), y: lerp(f.y, to.y, e) }); }, easeIO);
}

/* ---------- 特效：火花、光圈、飛進戰利品列的寶物、飛向餘額的金幣、大贏字 ---------- */
function burst(x, y, n, big){
  for(var i = 0; i < n; i++){
    var el = document.createElement('div'); el.className = 'fx sp'; el.innerHTML = SPARK; stageEl.appendChild(el);
    var a = (i / n) * Math.PI * 2 + .3, r = (big ? 70 : 46) * LAY.as;
    var dx = Math.cos(a) * r, dy = Math.sin(a) * r;
    var an = anim(el, [{ transform: 'translate(' + x + 'px,' + y + 'px) scale(.3)', opacity: 1 }, { transform: 'translate(' + (x + dx) + 'px,' + (y + dy) + 'px) scale(' + (big ? 1.3 : .9) + ')', opacity: 0 }], { duration: 520, easing: 'ease-out' });
    an.onfinish = (function(e){ return function(){ e.remove(); }; })(el);
  }
}
function ringFx(x, y){
  var el = document.createElement('div'); el.className = 'fx ring'; stageEl.appendChild(el);
  var an = anim(el, [{ transform: 'translate(' + x + 'px,' + y + 'px) scale(.5)', opacity: .9 }, { transform: 'translate(' + x + 'px,' + y + 'px) scale(1.9)', opacity: 0 }], { duration: 480, easing: 'ease-out' });
  an.onfinish = function(){ el.remove(); };
}
function appXY(el){                                       // 元素中心在 #app 內的座標
  var a = appEl.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
}
var flights = [];
function flyToLoot(k, p){                                 // 寶物飛進戰利品列：飛到了才把那一格填上
  var idx = p.n - 1, slot = $('slots').children[idx], st = appXY(stageEl), from = { x: st.x - stageEl.clientWidth / 2 + LAY.P[k + 1].x, y: st.y - stageEl.clientHeight / 2 + LAY.P[k + 1].y };
  var to = slot ? appXY(slot) : appXY(lootEl), el = document.createElement('div');
  el.className = 'lf'; el.innerHTML = use('ic-' + p.tier, p.tier === 'chest' ? '0 0 32 28' : '0 0 24 24'); fxEl.appendChild(el);
  var done = new Promise(function(res){
    var an = anim(el, [{ transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(1.1)', opacity: 1 },
      { transform: 'translate(' + ((from.x + to.x) / 2) + 'px,' + (Math.min(from.y, to.y) - 26) + 'px) scale(1)', opacity: 1, offset: .5 },
      { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(.7)', opacity: 1 }], { duration: 300, easing: 'ease-in-out' });
    an.onfinish = function(){ el.remove(); fillSlot(idx, p.tier, p.amount); res(); };
  });
  flights.push(done);
}
function burstCoins(n){
  var from = appXY($('tot')), to = appXY(walEl), i;
  for(i = 0; i < n; i++){
    var sx = from.x + ((i * 37) % 41 - 20), sy = from.y + ((i * 17) % 21 - 10), el = document.createElement('div');
    el.className = 'fly'; el.innerHTML = use('ic-coin'); fxEl.appendChild(el);
    var an = anim(el, [{ transform: 'translate(' + sx + 'px,' + sy + 'px) scale(1)', opacity: 1 },
      { transform: 'translate(' + ((sx + to.x) / 2) + 'px,' + (Math.min(sy, to.y) - 30 - (i % 3) * 12) + 'px) scale(1.1)', opacity: 1, offset: .5 },
      { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(.6)', opacity: 0 }], { duration: 560 + (i * 53) % 160, delay: i * 42, easing: 'ease-in-out', fill: 'backwards' });
    an.onfinish = (function(e){ return function(){ e.remove(); }; })(el);
  }
}
function showBigText(total){
  var n = document.createElement('div');
  n.className = 'bw'; n.innerHTML = '<b>' + D.fmt(total) + '</b>';
  fxEl.appendChild(n);
  return n;
}
function clearFx(){ fxEl.innerHTML = ''; flights = []; }

/* ---------- 大獎覆蓋層（≥20 倍） ---------- */
var ovOn = false, ovRes = null, ovTok = 0;
(function buildOv(){
  var st = '', pos = [[.14, .2, 1], [.86, .24, 1], [.2, .72, 0], [.82, .7, 0], [.5, .12, 1], [.08, .46, 0], [.92, .5, 0]];
  pos.forEach(function(p){ st += '<div class="st' + (p[2] ? ' b' : '') + '" style="left:' + (p[0] * 100) + '%;top:' + (p[1] * 100) + '%">' + SPARK + '</div>'; });
  ovEl.innerHTML = '<div class="rays"></div><div class="halo"></div>' + st + '<div class="chestbig">' + use('ic-chest', '0 0 32 28') + '</div><div class="amt" id="amt">0</div>';
})();
function openOv(total){
  var s = D.fmt(total), a = $('amt');
  a.className = 'amt' + (s.length >= 9 ? ' s9' : s.length >= 7 ? ' s7' : '');
  a.textContent = '0';
  ovEl.classList.add('on'); ovOn = true;
  rollTo('ov', 0, total, 1100, function(n){ a.textContent = D.fmt(n); });
  var tok = ++ovTok;
  return new Promise(function(res){
    ovRes = res;
    sleep(B.hold.jackpot).then(function(){ if(tok === ovTok) closeOv(); });
  });
}
function closeOv(instant){
  if(!ovOn && instant !== true) return;
  var was = ovOn;
  ovOn = false; delete rolls.ov;
  if(instant === true){ ovEl.style.transition = 'none'; ovEl.classList.remove('on'); ovEl.offsetWidth; ovEl.style.transition = ''; }
  else ovEl.classList.remove('on');
  if(was && ovRes){ var r = ovRes; ovRes = null; r(); }
}
ovEl.addEventListener('click', function(){ closeOv(); });

/* ---------- 擲骰（骰面點數是核心給的；動畫只演出來） ---------- */
function hideDice(){
  DICE.forEach(function(d){ d.dp.style.opacity = 0; d.sh.style.opacity = 0; });
  dsum.style.opacity = 0;
  dl.className = 'dl';
}
function dieFlight(hand, lp, k, topY){
  var dir = lp.x >= hand.x ? 1 : -1;
  var i1 = { x: lp.x - dir * 30 * k, y: lp.y }, i2 = { x: lp.x - dir * 11 * k, y: lp.y };
  var H1 = clamp(lp.y - topY, 36, 112 * k), H2 = 34 * k, H3 = 12 * k;
  var g = function(v, c){ var z = (v - c) / .028; return Math.exp(-z * z); };
  return function(v){
    var x, y, p;
    if(v < .5){ p = v / .5; x = lerp(hand.x, i1.x, p); y = lerp(hand.y, i1.y, p) - 4 * H1 * p * (1 - p); }
    else if(v < .74){ p = (v - .5) / .24; x = lerp(i1.x, i2.x, p); y = lp.y - 4 * H2 * p * (1 - p); }
    else if(v < .9){ p = (v - .74) / .16; x = lerp(i2.x, lp.x, p); y = lp.y - 4 * H3 * p * (1 - p); }
    else{ x = lp.x; y = lp.y; }
    var amp = Math.pow(1 - v, 1.1), sq = g(v, .5) * .9 + g(v, .74) * .6 + g(v, .9) * .45;
    var sx = (1 - .1 * amp) * (1 + .14 * sq), sy = (1 + .05 * amp) * (1 - .15 * sq);
    var pop = 1; if(v > .9){ var q = (v - .9) / .1; pop = 1 + .14 * Math.sin(Math.PI * q) * (1 - q * .3); }
    return { x: x, y: y, sx: sx * pop, sy: sy * pop, h: Math.max(0, lp.y - y) };
  };
}
/* 兩顆骰子從冒險者手上拋出、立體翻滾、先後落定（朝上面＝結果的點數）；落定時 resolve */
function throwDice(k, vals, mode){
  var inf = LAY.info[k], cs = LAY.cs, kk = cs / 46, cfg = mode === 'retry' ? B.retry : B.first;
  var T1 = cfg.flight - cfg.stagger;
  var hand = { x: A.x + 14 * LAY.as, y: A.y - 40 * LAY.as };
  var plan = [0, 1].map(function(i){
    var lp = { x: inf.land.x + (i ? 1 : -1) * (cs * .58 + 2), y: inf.land.y };
    var hd = { x: hand.x + (i ? 5 : -3), y: hand.y + (i ? -4 : 2) };
    var rnd = function(){ return shot ? .37 : Math.random(); };
    var o0 = ORI[1 + Math.floor(rnd() * 6)], oT = ORI[vals[i]];
    return { d: DICE[i], lp: lp, delay: i * cfg.stagger, pose: dieFlight(hd, lp, kk, 30),
      rx0: o0[0], ry0: o0[1], rxT: oT[0] + 360 * (2 + Math.floor(rnd() * 2)) * (rnd() < .5 ? -1 : 1), ryT: oT[1] + 360 * (2 + Math.floor(rnd() * 2)) * (rnd() < .5 ? -1 : 1) };
  });
  dl.className = 'dl'; dsum.style.opacity = 0;
  var no = rollNo, thud = false;
  return new Promise(function(res){
    var el = 0, last = 0;
    function place(t){
      plan.forEach(function(pl){
        var f = t - pl.delay, v = clamp(f / T1, 0, 1), d = pl.d;
        if(f < 0){ d.dp.style.opacity = 0; d.sh.style.opacity = 0; return; }
        var p = pl.pose(v), r = 1 - Math.pow(1 - Math.min(1, v / .9), 2.4);
        d.dp.style.opacity = 1;
        d.dp.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) scale(' + p.sx.toFixed(3) + ',' + p.sy.toFixed(3) + ')';
        d.cube.style.transform = 'rotateX(90deg) rotateX(' + (pl.rx0 + (pl.rxT - pl.rx0) * r).toFixed(1) + 'deg) rotateY(' + (pl.ry0 + (pl.ryT - pl.ry0) * r).toFixed(1) + 'deg)';
        var sc = clamp(1 - p.h / 150, .4, 1);
        d.sh.style.width = (cs * 1.05) + 'px'; d.sh.style.height = (cs * .22) + 'px';
        d.sh.style.opacity = v > .02 ? clamp(.9 - p.h / 160, .3, .9) : 0;
        d.sh.style.transform = 'translate(' + (p.x - cs * .525).toFixed(1) + 'px,' + (pl.lp.y + cs * .45).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ',' + (sc * .9).toFixed(3) + ')';
        if(v >= 1){ d.rx = pl.rxT; d.ry = pl.ryT; }
      });
    }
    function f(now){
      if(frozen) return;
      if(!last) last = now;
      el += Math.min(now - last, 64) * speed; last = now;
      place(el);
      var s = pend && pend.o && pend.o.stopAt;
      if(s && s.phase === 'fly' && (s.n == null || s.n === no) && el >= (s.at || 0)){ freeze('fly'); return; }
      if(!thud && el >= cfg.flight * .9){ thud = true; anim(stageEl, [{ transform: 'translateY(0)' }, { transform: 'translateY(3px)' }, { transform: 'translateY(-1px)' }, { transform: 'none' }], { duration: 200 }); }
      if(el < cfg.flight) requestAnimationFrame(f); else res();
    }
    place(0);
    requestAnimationFrame(f);
  });
}

/* ---------- 截圖用：停在某個瞬間 ---------- */
function freeze(ph){
  frozen = true;
  try{ document.getAnimations().forEach(function(a){ a.pause(); }); }catch(e){}
  if(pend && pend.o && pend.o.onStop) setTimeout(function(){ pend.o.onStop(ph); }, 30);
}
function maybeStop(ph, n){
  var s = pend && pend.o && pend.o.stopAt;
  if(!s || s.phase !== ph || (s.n != null && s.n !== n)) return null;
  return new Promise(function(){
    setTimeout(function(){ freeze(ph); }, s.delay || 0);
  });
}
function pace(phase, e, R){
  if(!paceFn) return Promise.resolve();
  var ms = 0;
  try{ ms = +paceFn({ phase: phase, event: e || null, result: R, route: R.route, stake: cur.stake, fast: speed > 1 }); }catch(x){ console.error('[DEMO.ui.setPace]', x); }
  return ms > 0 ? sleep(ms) : Promise.resolve();
}

/* ---------- 演出：逐筆讀 events ---------- */
function addChip(k, sum, win){                            // 結果小標：同一隻最多留最近 2 次
  var host = X.cs[k], c = document.createElement('div');
  c.className = 'chip ' + (win ? 'win' : 'no'); c.innerHTML = '<b>' + sum + '</b>' + (win ? CK : CX);
  host.appendChild(c);
  while(host.children.length > 2) host.removeChild(host.firstChild);
  X.nd[k].classList.remove('cur', 'lost', 'dead');
  X.nd[k].classList.add(win ? 'dead' : 'lost');
}
async function fightRoll(e, first, R){
  var k = e.idx, cfg = first ? B.first : B.retry, t0 = nowMs(), win = e.win;
  X.nd[k].classList.add('cur');
  await pace('roll', e, R);
  if(cfg.pre) await sleep(cfg.pre);
  var m = maybeStop('roll', rollNo); if(m) await m;
  await throwDice(k, e.dice, first ? 'first' : 'retry');
  // 落定：骰子與點數和（贏＝金、輸＝紅）
  var inf = LAY.info[k], lp = inf.land;
  dl.className = 'dl ' + (win ? 'win' : 'lose');
  dsum.innerHTML = '<b>' + e.sum + '</b>' + (win ? CK : CX);
  var dt = 'translate(' + lp.x.toFixed(1) + 'px,' + (lp.y - LAY.cs / 2 - 20).toFixed(1) + 'px) translate(-50%,-50%)';
  dsum.style.transform = dt;
  dsum.style.opacity = 1;
  anim(dsum, [{ transform: dt + ' scale(.4)', opacity: 0 }, { transform: dt + ' scale(1.15)', opacity: 1, offset: .6 }, { transform: dt + ' scale(1)', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  if(win){ ringFx(lp.x, lp.y); burst(lp.x, lp.y, 6, false); }
  else{
    anim(X.advIn, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 340 });
    anim(X.tok[k], [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 300 });
    loseHeart(e.heartsLeft, R.hearts);
  }
  emit('roll', { orderId: cur.orderId, route: R.route, routeIndex: R.routeIndex, stake: cur.stake, enemyId: e.enemyId, idx: k, need: e.need, dice: e.dice.slice(), sum: e.sum,
    win: win, heartsLeft: e.heartsLeft, hearts: R.hearts, retry: !first, rollNo: rollNo, result: R });
  var ms = maybeStop('land', rollNo); if(ms) await ms;
  await sleep(cfg.hold);
  addChip(k, e.sum, win);
  hideDice();
  await sleep(cfg.post);
  timing.rolls.push({ idx: k, retry: !first, ms: Math.round((nowMs() - t0) * speed) });
  rollNo++;
}
var timing = null;
async function collect(e, R){
  var k = e.idx, big = e.tier === 'chest', P0 = LAY.P[k + 1];
  X.nd[k].classList.add('got');
  anim(X.ico[k], [{ transform: 'scale(1)' }, { transform: 'scale(' + (big ? 1.3 : 1.25) + ')' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
  burst(P0.x, P0.y, big ? 12 : 6, big);
  if(big) ringFx(P0.x, P0.y);
  flyToLoot(k, { n: e.n, tier: e.tier, amount: e.amount });
  setTot(e.cum, 'run');
  loot.n++;
  emit('prize', { orderId: cur.orderId, route: R.route, id: e.id, idx: k, n: loot.n, v: e.v, tier: e.tier, amount: e.amount, cum: e.cum, stake: cur.stake, result: R });
  await pace('prize', e, R);
  await sleep(big ? B.chestHold : B.prizeHold);
}
async function perform(d){
  var R = d.result, ev = R.events, tries = {}, i, e, seg, k;
  rollNo = 0;
  timing = { rolls: [] };
  await sleep(B.start);
  await moveXY(advXY(0, 0), B.toStart);
  showHearts(R.hearts, R.hearts);
  for(i = 0; i < ev.length; i++){
    e = ev[i];
    if(e.k === 'move'){
      k = e.to; seg = k;
      var nd = shownMap.routes[ri].nodes[k];
      if(nd.kind === 'enemy'){
        await walk(seg, 0, LAY.stand[k], walkMs(seg, 0, LAY.stand[k]), easeOut);
        setPillMode(LAY.info[k].pill);
      }else{
        await walk(seg, 0, 1, walkMs(seg, 0, 1), easeIO);
      }
    }else if(e.k === 'prize'){
      await collect(e, R);
    }else if(e.k === 'roll'){
      var first = !tries[e.idx]; tries[e.idx] = (tries[e.idx] || 0) + 1;
      await fightRoll(e, first, R);
      if(e.win){
        setPillMode('up');
        await walk(e.idx, LAY.stand[e.idx], 1, walkMs(e.idx, LAY.stand[e.idx], 1), easeOut);
      }
    }else if(e.k === 'retreat'){
      A.flip = -1; X.adv.style.opacity = .55; showHearts(0, R.hearts);
      emit('retreat', { orderId: cur.orderId, route: R.route, at: e.at, heartsLeft: 0, result: R });
      var sg = e.at, back = Math.max(.02, LAY.stand[sg] - 8 / (LAY.sN[sg + 1] - LAY.sN[sg]));
      await walk(sg, LAY.stand[sg], back, B.retreat, easeIO);
      var mr = maybeStop('retreat', 0); if(mr) await mr;
    }
  }
  await Promise.all(flights);
  await pace('end', null, R);
}

/* ---------- 結算：入帳、依等級給回饋、停留、換下一張地圖 ---------- */
async function settle(d){
  var R = d.result, total = R.total, x = total / d.stake, grade = gradeOf(x);
  deferBal = grade === 'jackpot';                                 // 大獎：餘額等覆蓋層收起再滾
  balDelay = (grade === 'back' || grade === 'big') ? 250 : 0;     // 回本以上：等金幣飛到再滾
  lastSettled = null;
  delete rolls.tot;
  game.ack();                                                     // → settled、wallet、map 事件（餘額在這裡入帳）
  var sd = lastSettled || { payout: total, net: total - d.stake, wallet: game.getState().wallet, orderId: d.orderId, rec: null };
  setTot(total, total >= d.stake ? 'up' : 'dn');                  // 沒回本：灰色、不噴金幣、不放大字
  var data = { orderId: d.orderId, route: R.route, routeIndex: R.routeIndex, stake: d.stake, total: total, payout: sd.payout, pay: sd.payout, net: sd.net,
    x: x, grade: grade, reachedEnd: R.reachedEnd, retreated: !R.reachedEnd, heartsLeft: R.heartsLeft, hearts: R.hearts,
    nPrizes: R.prizes.length, nRolls: R.fights.length, result: R, wallet: sd.wallet, restored: false, record: sd.rec || null, timing: timing };
  if(grade === 'back') burstCoins(6);
  else if(grade === 'big') burstCoins(12);
  emit('roundEnd', data);
  var big = grade === 'big' ? showBigText(total) : null;
  var hs = maybeStop('settle', 0); if(hs) await hs;
  if(grade === 'jackpot'){
    var pr = openOv(total), hj = maybeStop('jackpot', 0);
    if(hj) await hj;
    await pr;
    deferBal = false; rollTo('bal', shownBal, targetBal, 450, setWalletText);
    await sleep(250);
  }else{
    await sleep(B.hold[grade]);
    if(big){ big.classList.add('out'); await sleep(240); }
  }
  return data;
}
function swapMap(){                                              // 舊圖淡出、換成核心給的新圖、新圖淡入
  stageEl.classList.add('out');
  return sleep(B.swapOut).then(function(){
    shownMap = game.getState().map;
    clearFx();
    renderStage();
    stageEl.classList.remove('out');
    emit('mapChange', { map: shownMap, seed: shownMap.seed, restored: false });
  });
}
function finish(payload){
  busy = false;
  setBusyUI(false);
  flushBal();
  userFast = false;
  setSpeed(1);
  var p = pend; pend = null;
  if(p) p.res(payload);
}
function recover(d, e){
  console.error('[ui] 演出發生例外，直接結算：', e);
  try{ if(game.getState().phase === 'ANIM') game.ack(); }catch(x){}
  closeOv(true);
  try{ shownMap = game.getState().map; clearFx(); renderStage(); }catch(x){}
  var sd = lastSettled || {};
  finish({ stake: d ? d.stake : 0, pay: sd.payout || 0, payout: sd.payout || 0, net: sd.net || 0, x: 0, grade: 'miss', route: d ? d.route : '',
    result: d ? d.result : null, orderId: d ? d.orderId : '', wallet: game.getState().wallet, error: String(e) });
}

/* ---------- 下注接線：result → 演出 ---------- */
/* 估一局的正常速度總時長（毫秒）；太長的局（九個節點又一路重打）整體加快一點，讓最長的局也不拖 */
function estimate(R){
  var N = R.map.routes[R.routeIndex].nodes, ms = B.start + B.toStart + 420, tr = {}, i, e;
  for(i = 0; i < R.events.length; i++){
    e = R.events[i];
    if(e.k === 'move') ms += N[e.to].kind === 'enemy' ? 380 : 260;
    else if(e.k === 'prize') ms += e.tier === 'chest' ? B.chestHold : B.prizeHold;
    else if(e.k === 'roll'){ var f = !tr[e.idx]; tr[e.idx] = 1; ms += f ? B.first.pre + B.first.flight + B.first.hold + B.first.post : B.retry.flight + B.retry.hold + B.retry.post; }
    else if(e.k === 'retreat') ms += B.retreat;
  }
  return ms + B.hold[gradeOf(R.total / R.stake)] + B.swapOut + 200;
}
var PACE_CAP = 9600;                                           // 超過這個估計值就整體加快（最多 1.3 倍）
function onResult(d){
  var R = d.result, t0 = nowMs();
  if(!busy){ busy = true; setBusyUI(true); }                     // 不經 play() 直接 game.bet 也要鎖操作
  if(R.map && R.map.seed !== shownMap.seed){ shownMap = R.map; renderStage(); }
  if(R.routeIndex !== ri){ ri = R.routeIndex; D.ls('route', ROUTES[ri]); renderTabs(); resetLoot(); renderStage(); }
  cur = { orderId: d.orderId, route: d.route, stake: d.stake, result: R };
  if(!userFast && hiSpeed && speed === 1) setSpeed(clamp(estimate(R) / PACE_CAP, 1, 1.3));
  clearFx(); resetLoot();
  emit('roundStart', { orderId: d.orderId, route: d.route, routeIndex: R.routeIndex, stake: d.stake, hearts: R.hearts, result: R, fast: speed > 1 });
  perform(d)
    .then(function(){ return settle(d); })
    .then(function(data){ return swapMap().then(function(){ data.ms = Math.round(nowMs() - t0); return data; }); })
    .then(finish, function(e){ recover(d, e); });
}
function onMapEvent(d){
  if(busy) return;                                               // 演出中核心可能已換新圖：演完才換
  shownMap = d.map; clearFx(); resetLoot(); renderStage();
  emit('mapChange', { map: shownMap, seed: shownMap.seed, restored: false });
}
game.on(function(type, d){
  if(type === 'wallet') onWallet(d.wallet);
  else if(type === 'result') onResult(d);
  else if(type === 'settled') lastSettled = d;
  else if(type === 'map') onMapEvent(d);
});

/* ---------- 對外操作 ---------- */
function setBusyUI(b){ appEl.classList.toggle('busy', b); }
function selectRoute(i, silent){
  if(i === ri) return false;
  var prev = ROUTES[ri];
  ri = i; D.ls('route', ROUTES[i]);
  renderTabs(); resetLoot(); renderStage();
  if(!silent) emit('routeChange', { route: ROUTES[i], routeIndex: i, prev: prev });
  return true;
}
function selectStake(v){
  if(v === stake) return false;
  var prev = stake;
  stake = v; D.ls('stake', v);
  renderStakes();
  emit('stakeChange', { stake: v, prev: prev });
  return true;
}
function setRoute(id){
  var i = EV.routeIndex(id);
  if(i < 0 || busy) return false;
  selectRoute(i);
  return true;
}
function setStake(v){
  v = +v;
  if(CFG.STAKES.indexOf(v) < 0 || busy) return false;
  selectStake(v);
  return true;
}
/* 下注＋演出：先抽定（核心）→ UI 演 → ack 才結算。opts：{ fast, stopAt, onStop }（後兩個只給截圖用）。
 * resolve 時機＝一局演完、已 game.ack() 入帳、換好下一張地圖、放開操作之後 */
function play(routeId, st, o){
  o = o || {};
  return new Promise(function(res, rej){
    if(busy || game.getState().phase !== 'BET') return rej(new Error('busy'));
    var ti = EV.routeIndex(routeId);
    if(ti < 0) return rej(new Error('route'));
    st = Math.floor(st);
    if(CFG.STAKES.indexOf(st) < 0 || st > game.getState().wallet) return rej(new Error('stake'));
    if(ti !== ri) selectRoute(ti);
    if(st !== stake) selectStake(st);
    busy = true;
    setBusyUI(true);
    userFast = false;
    autoRound = !!o.fast;
    setSpeed(baseSpeed());
    pend = { res: res, rej: rej, o: o };
    if(!game.bet(routeId, st)){ pend = null; busy = false; setBusyUI(false); setSpeed(1); rej(new Error('bet')); }
  });
}
goBtn.onclick = function(){
  if(busy) return;
  if(game.getState().wallet < stake){ Toast.show(T('rej.insufficient')); return; }
  play(ROUTES[ri], stake).catch(noop);
};
tabsEl.onclick = function(e){
  var b = e.target.closest ? e.target.closest('.tab') : null;
  if(!b || busy) return;
  selectRoute(+b.getAttribute('data-i'));
};
stakesEl.onclick = function(e){
  var b = e.target.closest ? e.target.closest('.bet') : null;
  if(!b || busy) return;
  selectStake(+b.getAttribute('data-v'));
};
/* 錢包重置（log 頁的重置鈕走這裡；T03 接 LogUI.mount({ onReset:... })） */
function resetWallet(){
  if(busy){ Toast.show(T('log.noReset')); return false; }
  if(!game.clearSaved()) return false;
  resetLoot();
  Toast.show(T('log.resetDone', { n: D.fmt(game.getState().wallet) }));
  return true;
}
if('ResizeObserver' in window) new ResizeObserver(function(){ if(!busy) renderStage(); }).observe(stageEl);
else window.addEventListener('resize', function(){ if(!busy) renderStage(); });

/* ---------- 截圖畫面（?shot=）：dev.js（T03）接手前的最小版 ---------- */
function scene(seed, rIdx, stk, pred){                         // 指定地圖＋找一組亂數種子，讓核心照真實流程抽到想要的情況
  game.devSetMap(seed);
  if(ri !== rIdx) selectRoute(rIdx, true);
  var map = game.getState().map, i, r = null;
  for(i = 1; i < 300000; i++){
    r = DemoCore.simulate(map, rIdx, stk, EV.mulberry32(i));
    if(pred(r)) break;
  }
  game.setRng(EV.mulberry32(i));
  if(stake !== stk) selectStake(stk);
  return r;
}
function retryNo(r){ for(var i = 1; i < r.fights.length; i++) if(!r.fights[i - 1].win && r.fights[i - 1].idx === r.fights[i].idx) return i; return -1; }
D.shots = D.shots || {};
D.shots.idle = function(done){ selectRoute(1, true); setTimeout(done, 50); };
D.shots['idle-safe'] = function(done){ selectRoute(0, true); setTimeout(done, 50); };
D.shots['idle-risk'] = function(done){ selectRoute(2, true); setTimeout(done, 50); };
D.shots.long = function(done){                                  // 找一張有 9 個節點的路
  var s, r;
  for(s = 1; s < 3000; s++){ var m = EV.genMapSeed(s); if(m.routes[0].nodes.length === 9){ game.devSetMap(s); break; } }
  selectRoute(0, true); setTimeout(done, 50);
};
D.shots.roll = function(done){                                  // 第一次擲骰翻滾中
  scene(SHOT_SEED, 1, 100, function(r){ return r.fights.length > 1; });
  play('mid', 100, { stopAt: { phase: 'fly', n: 0, at: 330 }, onStop: done }).catch(noop);
};
D.shots.land = function(done){                                  // 兩顆骰落定、點數和出現
  scene(SHOT_SEED, 1, 100, function(r){ return r.fights.length > 1 && r.fights[0].win; });
  play('mid', 100, { stopAt: { phase: 'land', n: 0, delay: 170 }, onStop: done }).catch(noop);
};
D.shots.retry = function(done){                                 // 打輸後留在原地重打（穩路線，剩 2 顆心）
  var r = scene(SHOT_SEED, 0, 100, function(r){ var n = retryNo(r); return n > 0 && r.fights[n].heartsLeft >= 1; });
  var n = retryNo(r);
  play('safe', 100, { stopAt: { phase: 'fly', n: n, at: 260 }, onStop: done }).catch(noop);
};
D.shots.win = function(done){                                   // 回本以上（結算停留中）
  scene(SHOT_SEED, 0, 100, function(r){ return r.total >= 100 && r.total < 500 && r.fights.length >= 3; });
  play('safe', 100, { stopAt: { phase: 'settle', delay: 300 }, onStop: done }).catch(noop);
};
D.shots.miss = function(done){                                  // 撤退、沒回本
  scene(SHOT_SEED, 1, 100, function(r){ return !r.reachedEnd && r.total > 0 && r.total < 100 && r.prizes.length >= 1; });
  play('mid', 100, { stopAt: { phase: 'retreat' }, onStop: done }).catch(noop);
};
D.shots.big = function(done){                                   // 大贏（≥5 倍）
  scene(SHOT_SEED, 1, 500, function(r){ return r.total >= 5 * 500 && r.total < 20 * 500; });
  play('mid', 500, { stopAt: { phase: 'settle', delay: 300 }, onStop: done }).catch(noop);
};
D.shots.jackpot = function(done){                               // 大獎（≥20 倍）全畫面
  scene(SHOT_SEED, 2, 100, function(r){ return r.total >= 20 * 100; });
  play('risk', 100, { stopAt: { phase: 'jackpot', delay: 1500 }, onStop: done }).catch(noop);
};

/* ---------- init ---------- */
(function init(){
  var gt = T('main.go');
  $('goTxt').textContent = gt;
  $('autoBtn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5V8h-4.5"/></svg><span>' + T('main.auto') + '</span>';
  renderTabs(); renderStakes(); resetLoot();
  setWalletText(game.getState().wallet);
  renderStage();
  D.ui = {
    on: on, off: off, play: play, busy: function(){ return busy; }, isBusy: function(){ return busy; },
    setRoute: setRoute, setStake: setStake,
    getRoute: function(){ return ROUTES[ri]; }, getStake: function(){ return stake; },
    setPace: function(fn){ paceFn = typeof fn === 'function' ? fn : null; },
    setFast: function(v){ setFast(v, true); }, isFast: function(){ return hiSpeed; },
    resetWallet: resetWallet, gradeOf: gradeOf,
    layout: function(){ return LAY; }, shownMap: function(){ return shownMap; }
  };
  window.__demoReady = true;
  /* ?shot= 與 __shotReady：dev.js（T03）載入後由它分派；它還沒接手時由這裡處理 */
  function dispatch(){
    setTimeout(function(){                                      // load 事件之後（所有 script 都跑完，dev.js 若有載入已先設好 shotDispatched）
      if(D.shotDispatched) return;
      if(shot){
        var fn = D.shots[shot];
        if(!fn){ window.__shotError = 'unknown shot: ' + shot; window.__shotReady = true; }
        else fn(function(){ window.__shotReady = true; });
      }else window.__shotReady = true;
    }, 0);
  }
  if(document.readyState === 'complete') dispatch(); else window.addEventListener('load', dispatch);
})();
})();
