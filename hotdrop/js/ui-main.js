/* =========================================================================
 * 空投爭奪——主畫面與演出（H02）＋模組接線
 *
 * 流程（核心先抽定結果，UI 只演，演完才算結算）：
 *   待命（盤面公告、喊話）─點落點→ 封盤倒數 3 秒（可改點／立即跳傘）→ 飛機＋跳傘
 *   → 落地揭曉（各落點就地 1.5 秒：圓內放頭像，獨佔亮起＋✓、撞車變紅＋💥、沒人變虛線）
 *   → 結果彈窗（地圖中央；獨佔外框用落點色，大獎轉金色＋爆金幣）→ 玩家點任一處收起 → 換上下一局盤面，落點才可點
 *
 * 核心對接（見 tasks/H01-核心.md 完成註記）：
 *   result → 開始演出；repick → 封盤中改點；settled → 彈窗出現時呼叫 game.ack() 觸發，
 *   此時 game.board() 已是「下一局」盤面，所以畫面上的舊盤面由 view.board 自己持有，
 *   等彈窗收起才換成 nextBoard。
 *
 * 區段索引（後面三張卡各自只改自己的區段）：
 *   [0] 演出常數（時序、大獎門檻、金幣開關）
 *   [1] 小工具與視覺常數
 *   [2] 主畫面：盤面、喊話、封盤倒數、跳傘、揭曉、結果彈窗、大獎金幣（H02）
 *   [3] 核心事件接線與下注入口（H02）
 *   [A] LogUI 區段（H05 授權）
 *   [B] Recent 呼叫點（H04 的掛點 #recent；呼叫點由 H02 留好）
 *   [C] Autobet adapter 區段（H05 授權）
 *   （無教學：R3-4 起不做任何引導、提示條、說明鈕；舊的 [D] Onboard 區段已拿掉）
 *   [E] DEMO.ui 對外介面＋DEMO.shots 自動駕駛（H05 授權）
 *
 * 對外（DEMO.ui）：
 *   play(pointIdx, stake, o) → Promise<{ stake, pay }>（彈窗收起、盤面換好才 resolve）
 *     o.fast      縮時（true＝×0.35，或給 0～1 的倍率）
 *     o.skipLock  省略封盤倒數（自動下注、測試用）
 *     o.autoClose 彈窗停留一下自動收起（預設＝fast）
 *     o.hold      'lock'｜'reveal'｜'popup'：停在該階段不往下走（截圖用；true＝'popup'）
 *     o.onReveal／o.onPopup  揭曉開始／彈窗出現時回呼
 *   isBusy() / phase() / resetWallet() / stake()；?dev=1 或 ?shot= 時另有 rig(bots, boxIdx)（強制下一局結果）、
 *   coins(on)（爆金幣開關，導演台用）
 * 依賴：全部前面的檔。載入完成後設 window.__demoReady = true。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t;
var $ = function(id){ return document.getElementById(id); };
var shot = D.q.shot;
function noop(){}

/* =====================================================================
 * [0] 演出常數（時序、大獎門檻、金幣開關；全是演出參數，不影響結果）
 * ===================================================================== */
var TIMING = {
  LOCK_SEC:3,           // 封盤倒數秒數（規格 §2、§7）
  TICK_MS:1000,         // 倒數每一格
  PLANE_MS:1200,        // 飛機橫越地圖
  FALL_MS:950,          // 傘兵從飛機落到落點
  JUMP_AT:[0.20, 0.34, 0.48, 0.60],   // 四個人從航程的哪個比例跳下（順序會打亂）；最後落地 ≈ 1.7 秒
  REVEAL_MS:1500,       // 各落點就地揭曉（用戶：1～2 秒，暫定 1.5）
  POPUP_AUTO_MS:1100,   // 自動模式下彈窗停留
  POPUP_AUTO_BIG_MS:2300, // 自動模式遇大獎多停一下，讓金幣飛完
  GUARD_MS:250,         // 彈窗收起後到落點可點的緩衝（防連點誤開下一局）
  SHOUT_MS:2200,        // 喊話輪播
  FAST:0.35             // 縮時倍率（自動下注、測試）
};
var BIGWIN_MULT = 5;     // 大獎門檻：結果倍率 ≥ 5x（用戶 2026-11-17 同意；演出常數，不進 values.js）
var BIGWIN_COINS = true; // 爆金幣開關：效果不好時只改成 false，其他流程（金色彈窗等）不動
var COIN_COUNT = 20;     // 金幣顆數（舊手機掉幀就減）
var COIN_MS = 1200;      // 金幣飛行時間
var BIGWIN_COIN_DELAY_MS = 650; // 彈窗出現後多久爆金幣（對齊倍率數字砸出的瞬間）

/* =====================================================================
 * [1] 小工具與視覺常數（佔位美術：emoji／CSS）
 * ===================================================================== */
/* 落點圓心（以 375×594 地圖為基準的比例，與 home-A 靜態稿一致；落點全程不移動）＋顏色（色值＝base.css 的 --rc0～--rc3） */
var ZONE = [
  { cx:92/375,  cy:176/594, c:'#35D07F', r:'53,208,127'  },   // 綠
  { cx:285/375, cy:202/594, c:'#4AA8FF', r:'74,168,255'  },   // 藍
  { cx:95/375,  cy:378/594, c:'#B56BFF', r:'181,107,255' },   // 紫
  { cx:282/375, cy:406/594, c:'#FFC531', r:'255,197,49'  }    // 金
];
var BOTS = ['🐺', '🦊', '🐻'];                         // 三個機器人的頭像；名字在字典 bot.0～2
var BOXC = ['#9AA9BD', '#4AA8FF', '#B56BFF', '#FFC531']; // 箱子等級色（依 EV.BOX.tiers 順序：灰／藍／紫／金）
var PLANE_ROUTE = [166/375, 210/375];                  // 飛機航線 x（上緣→下緣），對應靜態稿的虛線

function lcg(seed){ var a = seed >>> 0; return function(){ a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; }
/* 氛圍亂數（喊話、金幣、跳傘順序）：與核心 rng 完全分離；截圖模式固定種子讓畫面可重現 */
var cos = lcg(shot ? 20261117 : (Date.now() % 4294967296));

function restartClass(el, cls){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function ptName(i){ return T('pt.name', { n:EV.POINTS[i].name }); }
function boxOf(i){ return EV.BOX.tiers[i]; }
function after(ms, fn){ return setTimeout(fn, ms); }

/* =====================================================================
 * [2] 主畫面
 * ===================================================================== */
var game = DemoCore.createGame({ storage: shot ? false : undefined, rng: shot ? lcg(20260101) : undefined });
D.game = game;

var app = $('app'), map = $('map'), panel = $('panel');
var zoneBox = $('zones'), spriteBox = $('sprites'), plane = $('plane');
var popveil = $('popveil'), pop = $('pop'), glow = $('glow'), coinBox = $('coins');
var zones = [];
var phase = 'idle';              // idle｜lock｜jump｜reveal｜popup｜settle（彈窗收起後的短緩衝）
var cur = null;                  // 進行中那局（result／repick 最新快照）
var pend = null;                 // 進行中的 play()：{ res, rej, fast, skipLock, hold, autoClose, onReveal, onPopup }
var view = { board:null };       // 畫面上顯示的盤面（彈窗收起前一直是本局盤面）
var nextBoard = null;            // settled 帶來的下一局盤面，等彈窗收起才換上畫面
var lockN = 0, lockTimer = null;
var lastSettled = null;
var stake = D.ls('stake');
if(EV.CFG.STAKES.indexOf(stake) < 0) stake = EV.CFG.STAKES[1] != null ? EV.CFG.STAKES[1] : EV.CFG.STAKES[0];

function scale(){
  var f = pend && pend.fast;
  return !f ? 1 : (typeof f === 'number' ? f : TIMING.FAST);
}
function setPhase(p){ phase = p; map.setAttribute('data-ph', p === 'settle' ? 'idle' : p); }
function isBusy(){ return phase !== 'idle'; }

/* ---------- 餘額、單注 ---------- */
function setWallet(v){ $('wal').textContent = D.fmt(v); }
function setBusy(b){
  $('stakes').classList.toggle('dis', b);
  Autobet.refresh();
  syncAutoBtn();
}
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
  if(phase === 'popup') dismissPopup();              // 彈窗還在：先收起，單注照選
  else if(phase !== 'idle') return;
  stake = +b.getAttribute('data-v'); D.ls('stake', stake); renderStakes();
};

/* ---------- 四個落點（結構固定，內容隨盤面換）：圓圈內＝（揭曉時的頭像）＋賠率大字＋勝率 ---------- */
function buildZones(){
  var h = '';
  EV.POINTS.forEach(function(p, i){
    var z = ZONE[i];
    h += '<div class="zone" data-i="' + i + '" style="--c:' + z.c + ';--r:' + z.r +
      ';left:' + (z.cx * 100).toFixed(2) + '%;top:' + (z.cy * 100).toFixed(2) + '%">' +
      '<div class="pt"><div class="in"><div class="avs"></div><b class="od"></b><span class="wr"></span></div>' +
      '<span class="ok">✓</span><span class="boom">💥</span></div>' +
      '<span class="me">' + D.esc(T('who.you')) + '</span></div>';
  });
  zoneBox.innerHTML = h;
  zones = Array.prototype.slice.call(zoneBox.children);
}

/* 盤面：賠率（最醒目）、勝率（＝核心的獨佔率 q），全讀核心；anim＝換盤提示動作。
   賠率字數多（≥6、≥7 字）時加 n6／n7 縮字，圓內放得下 */
function renderBoard(b, anim){
  view.board = b;
  zones.forEach(function(z, i){
    var od = z.querySelector('.od'), tx = EV.fmtX(b.odds[i]) + 'x';
    od.textContent = tx;
    od.className = 'od' + (tx.length >= 7 ? ' n7' : tx.length === 6 ? ' n6' : '');
    z.querySelector('.wr').textContent = T('zone.wr', { p:Math.round(b.q[i] * 100) });
    if(anim) restartClass(z.querySelector('.in'), 'in-swap');
  });
}

/* ---------- 對手喊話：純氛圍，用氛圍亂數 cos，不碰核心 rng、不讀 botPicks／botP ---------- */
var shoutSt = [], shoutTm = null, chips = [];
/* 喊話字串帶 [cN]字[/c] 標記：先跳脫 HTML，再把標記換成帶落點色 class 的 span（.sc0～.sc3，色取 base.css 的 --rc0～--rc3） */
function rich(s){
  return D.esc(s).replace(/\[c([0-3])\]([\s\S]*?)\[\/c\]/g, '<span class="sc$1">$2</span>');
}
function buildShouts(){
  var h = '';
  BOTS.forEach(function(face){
    h += '<div class="chip"><span class="em">' + face + '</span><span class="say"></span></div>';
  });
  $('ban').innerHTML = h;
  chips = Array.prototype.slice.call($('ban').children);
}
function rollShout(b){ shoutSt[b] = { p:Math.floor(cos() * EV.POINTS.length), k:Math.floor(cos() * 3) }; }
function renderShout(b, flash){
  chips[b].querySelector('.say').innerHTML = rich(T('shout.' + shoutSt[b].p + '.' + shoutSt[b].k));
  if(flash) restartClass(chips[b], 'chg');
}
function shoutAll(){ for(var b = 0; b < BOTS.length; b++){ rollShout(b); renderShout(b, false); } }
function startShouts(){
  shoutAll();
  if(!shoutTm) shoutTm = setInterval(function(){
    if(phase !== 'idle' || document.hidden) return;
    var b = Math.floor(cos() * BOTS.length); rollShout(b); renderShout(b, true);
  }, TIMING.SHOUT_MS);
}

/* ---------- 封盤倒數 ---------- */
function showLockRow(on){ panel.classList.toggle('lk', on); }
function renderLock(){
  var sel = cur.pointIdx;
  zones.forEach(function(z, i){
    z.classList.toggle('sel', i === sel);
    z.classList.toggle('dim', i !== sel);
  });
  $('goBtn').textContent = T('lock.go');
  $('goBtn').classList.remove('dis');
}
function startLock(){
  setPhase('lock'); showLockRow(true);
  $('cdSub').textContent = T('lock.sub');
  var sg = '';
  for(var i = 0; i < TIMING.LOCK_SEC; i++) sg += '<span class="sgm"><i></i></span>';
  $('cdSeg').innerHTML = sg;
  renderLock();
  lockN = TIMING.LOCK_SEC; lockTick();
}
function lockTick(){
  if(phase !== 'lock') return;
  var num = $('cdNum');
  num.textContent = lockN; restartClass(num, 'pulse');
  if(pend && pend.hold === 'lock') return;                         // 截圖：停在「3」
  var segs = $('cdSeg').querySelectorAll('i'), k = TIMING.LOCK_SEC - lockN;
  if(segs[k]) segs[k].classList.add('dr');                          // 這一格開始流掉
  lockTimer = after(TIMING.TICK_MS * scale(), function(){
    lockN--;
    if(lockN <= 0) startJump(); else lockTick();
  });
}
function jumpNow(){
  if(phase !== 'lock') return;
  if(lockTimer){ clearTimeout(lockTimer); lockTimer = null; }
  startJump();
}

/* ---------- 飛機＋跳傘 ---------- */
/* 落點圓內第 idx 個人的頭像左上角偏移（圓心為原點，頭像 24px）；與 base.css 揭曉時 .avs＋賠率行的排法一致，
   傘兵落在這裡、揭曉換成圓內頭像時不會跳位：≤3 人一排（置中），4 人 2×2；賠率行固定 24px、頭像列與賠率行間距 2px */
function slotPos(n, idx){
  if(n >= 4) return [-25 + (idx % 2) * 26, -38 + Math.floor(idx / 2) * 26];
  return [-(n * 24 + (n - 1) * 2) / 2 + idx * 26, -25];
}
function occupants(r){                                              // 各落點上的人：[{me}｜{bot:b}, ...]
  var occ = [], i;
  for(i = 0; i < EV.POINTS.length; i++) occ.push([]);
  occ[r.pointIdx].push({ me:true });
  r.botPicks.forEach(function(p, b){ occ[p].push({ bot:b }); });
  return occ;
}
function clearField(){
  spriteBox.innerHTML = '';
  zones.forEach(function(z, i){
    z.className = 'zone';
    z.querySelector('.avs').innerHTML = '';
    z.querySelector('.avs').className = 'avs';
  });
  plane.className = 'plane';
  glow.classList.remove('on'); coinBox.innerHTML = '';
}
function avatar(o){                                                 // 頭像：你＝白底「你」金框；機器人＝emoji
  return o.me ? '<span class="av you">' + D.esc(T('who.you')) + '</span>' : '<span class="av">' + BOTS[o.bot] + '</span>';
}
function startJump(){
  lockTimer = null;
  setPhase('jump');
  zones.forEach(function(z){ z.classList.remove('sel', 'dim'); });
  if(panel.classList.contains('lk')){
    $('goBtn').textContent = T('lock.flying');
    $('goBtn').classList.add('dis');
  }
  var W = map.clientWidth, H = map.clientHeight;
  /* 飛機：沿虛線航線由上緣飛到下緣（相對待命位置的位移） */
  var icx = W * 0.459 + 12, icy = H * 0.443 + 12;
  plane.style.setProperty('--fx0', (W * PLANE_ROUTE[0] - icx).toFixed(1) + 'px');
  plane.style.setProperty('--fy0', (-30 - icy).toFixed(1) + 'px');
  plane.style.setProperty('--fx1', (W * PLANE_ROUTE[1] - icx).toFixed(1) + 'px');
  plane.style.setProperty('--fy1', (H + 30 - icy).toFixed(1) + 'px');
  plane.style.setProperty('--plane', TIMING.PLANE_MS + 'ms');
  plane.className = 'plane fly';
  /* 傘兵：四個人（你＋三個機器人）各自從飛機位置跳向自己的落點 */
  var occ = occupants(cur), who = [], used = [], i, b;
  for(i = 0; i < occ.length; i++) used.push(0);
  who.push({ me:true, zone:cur.pointIdx });
  for(b = 0; b < cur.botPicks.length; b++) who.push({ bot:b, zone:cur.botPicks[b] });
  var order = []; for(i = 0; i < who.length; i++) order.push(i);
  order.sort(function(){ return cos() - 0.5; });
  var h = '', end = 0;
  who.forEach(function(o, k){
    var z = ZONE[o.zone], n = occ[o.zone].length, sl = slotPos(n, used[o.zone]++);
    var f = TIMING.JUMP_AT[order[k] % TIMING.JUMP_AT.length];
    var sx = W * (PLANE_ROUTE[0] + (PLANE_ROUTE[1] - PLANE_ROUTE[0]) * f) - 12, sy = -30 + (H + 60) * f - 12;
    var tx = z.cx * W + sl[0], ty = z.cy * H + sl[1];
    var dl = Math.round(f * TIMING.PLANE_MS);
    end = Math.max(end, dl + TIMING.FALL_MS);
    h += '<div class="sp' + (o.me ? ' you' : '') + '" style="--sx:' + sx.toFixed(1) + 'px;--sy:' + sy.toFixed(1) +
      'px;--tx:' + tx.toFixed(1) + 'px;--ty:' + ty.toFixed(1) + 'px;--dl:' + dl + 'ms;--fall:' + TIMING.FALL_MS + 'ms">' +
      '<span class="cv">🪂</span>' + avatar(o) + '</div>';
  });
  spriteBox.innerHTML = h;
  after(end * scale() + 80, startReveal);
}

/* ---------- 落地揭曉：各落點就地（圓內換成頭像；獨佔亮起＋✓／撞車變紅＋💥／沒人變虛線），此時還沒有彈窗 ---------- */
function startReveal(){
  setPhase('reveal');
  spriteBox.innerHTML = '';                                         // 傘兵已落在圓內頭像的位置，換成圓內真正的頭像（位置相同）
  var occ = occupants(cur);
  zones.forEach(function(z, i){
    var list = occ[i], avs = z.querySelector('.avs'), me = false, h = '';
    list.forEach(function(o){ if(o.me) me = true; h += avatar(o); });
    avs.innerHTML = h;
    avs.className = 'avs' + (list.length >= 4 ? ' q4' : '');
    z.classList.add('rv');
    if(list.length === 0) z.classList.add('emp');
    else if(list.length === 1){ z.classList.add('solo'); if(me) z.classList.add('mine'); }
    else z.classList.add('clash');
  });
  if(pend && pend.onReveal) pend.onReveal();
  if(pend && pend.hold === 'reveal') return;
  after(TIMING.REVEAL_MS * scale(), showPopup);
}

/* ---------- 結果彈窗（地圖中央，蓋住落點；底部不蓋）：沒有算式、沒有提示字、沒有落點名牌 ---------- */
function showPopup(){
  setPhase('popup'); showLockRow(false);
  var d = cur, big = d.solo && d.mult >= BIGWIN_MULT;
  var z = ZONE[d.pointIdx], bx = boxOf(d.boxIdx), bc = BOXC[d.boxIdx] || BOXC[0], h;
  pop.className = 'pop in';
  if(d.solo){
    /* 外框＝玩家選的落點色（綠藍紫金）；大獎＝金色版（.bw 另帶金色底與光暈） */
    pop.classList.add(big ? 'bw' : 'wn');
    pop.setAttribute('style', big ? '--c:#FFD24A;--r:255,210,74;--t:' + bc : '--c:' + z.c + ';--r:' + z.r + ';--t:' + bc);
    h = '<h1 class="st" style="--d:0s">' + D.esc(T(big ? 'pop.big' : 'pop.win')) + '</h1>' +
      '<div class="bxr st" style="--d:.1s"><span class="bi shk" id="popBox">📦</span><b class="bx">×' + bx.mult + '</b></div>' +
      '<div class="big" style="--bd:.55s">' + EV.fmtX(d.mult) + 'x</div>' +
      '<div class="earn st" style="--d:.85s"><span>' + D.esc(T('pop.earn')) + '</span><b>' + D.fmt(d.payout) + '</b></div>';
  }else{
    var mates = [];
    d.botPicks.forEach(function(p, b){ if(p === d.pointIdx) mates.push('<span class="av">' + BOTS[b] + '</span>'); });
    pop.classList.add('cr');
    pop.setAttribute('style', '--c:#5A4750;--r:90,71,80');
    h = '<h1 class="st" style="--d:0s">' + D.esc(T('pop.crash')) + '</h1>' +
      '<div class="who st" style="--d:.1s">' + avatar({ me:true }) + '<span class="x">✕</span>' + mates.join('') + '</div>' +
      '<div class="big" style="--bd:.35s">0x</div>';
  }
  pop.innerHTML = h;
  popveil.classList.add('on');
  if(d.solo){                                                       // 箱子先抖、再打開
    after(550 * scale(), function(){
      var bi = $('popBox');
      if(bi && phase === 'popup'){ bi.className = 'bi open'; bi.textContent = '🎁'; }
    });
  }
  if(big) after(BIGWIN_COIN_DELAY_MS * scale(), coinBurst);        // 倍率數字砸出來時才爆金幣
  game.ack();                                                       // 演出到彈窗＝演完：派彩入帳、記注單、核心換下一局盤面（畫面先不換）
  if(pend && pend.onPopup) pend.onPopup();
  if(pend && pend.hold === 'popup') return;                         // 截圖：停在彈窗
  if(pend && pend.autoClose) after((big ? TIMING.POPUP_AUTO_BIG_MS : TIMING.POPUP_AUTO_MS) * scale(), dismissPopup);
}

/* 大獎爆金幣：獨立函式，約 20 顆獨立元素（只動 transform／opacity）；效果不好時把 BIGWIN_COINS 設 false 即可 */
function coinBurst(){
  if(!BIGWIN_COINS) return;
  var W = map.clientWidth, H = map.clientHeight, cx = W / 2, cy = H * 0.46, h = '', k;
  for(k = 0; k < COIN_COUNT; k++){
    var ang = cos() * Math.PI * 2, r1 = 50 + cos() * 90, r2 = 90 + cos() * 130, s = 18 + Math.round(cos() * 16);
    h += '<i class="coin" style="--s:' + s + 'px;--cx:' + (cx - s / 2).toFixed(0) + 'px;--cy:' + (cy - s / 2).toFixed(0) +
      'px;--mx:' + (Math.cos(ang) * r1).toFixed(0) + 'px;--my:' + (Math.sin(ang) * r1 - 50).toFixed(0) +
      'px;--dx:' + (Math.cos(ang) * r2).toFixed(0) + 'px;--dy:' + (Math.sin(ang) * r2 + 140).toFixed(0) +
      'px;--rt:' + Math.round(cos() * 80 - 40) + 'deg;--sx:' + (0.55 + cos() * 0.45).toFixed(2) +
      ';--dl:' + Math.round(cos() * 250) + 'ms;--ms:' + COIN_MS + 'ms"></i>';
  }
  coinBox.innerHTML = h;
  glow.classList.add('on');
  after((COIN_MS + 250 + 150) * scale(), function(){ coinBox.innerHTML = ''; });
}

/* 彈窗收起（玩家點任一處／自動模式計時）：先換上下一局盤面，緩衝一下落點才可點 */
function dismissPopup(){
  if(phase !== 'popup') return;
  setPhase('settle');
  popveil.classList.remove('on');
  clearField();
  renderBoard(nextBoard || game.board(), true); nextBoard = null;
  shoutAll();                                                       // 喊話在 data-ph=idle 才顯示：先換新句，免得閃出舊句
  var p = pend, sc = scale();
  after(TIMING.GUARD_MS * sc, function(){
    setPhase('idle'); setBusy(false);
    app.style.setProperty('--tm', 1);
    pend = null; cur = null;
    startShouts();
    if(p && p.res) p.res({ stake:lastSettled ? lastSettled.stake : 0, pay:lastSettled ? lastSettled.payout : 0 });
  });
}

/* =====================================================================
 * [3] 核心事件接線與下注入口
 * ===================================================================== */
function play(pointIdx, st, o){
  o = o || {};
  return new Promise(function(res, rej){
    if(phase !== 'idle') return rej(new Error('busy'));
    var hold = o.hold === true ? 'popup' : (o.hold || '');
    pend = { res:res, rej:rej, fast:o.fast, skipLock:!!o.skipLock, hold:hold,
             autoClose:(o.autoClose !== undefined ? !!o.autoClose : !!o.fast),
             onReveal:o.onReveal, onPopup:o.onPopup };
    if(!game.bet(pointIdx, st)){ pend = null; rej(new Error('bet')); }
  });
}

function onResult(d){
  if(!pend) pend = { fast:false, skipLock:false, hold:'', autoClose:false };
  cur = d;
  setBusy(true);
  app.style.setProperty('--tm', scale());
  clearField();
  if(pend.skipLock) startJump(); else startLock();
}

function onSettled(d){
  lastSettled = d;
  nextBoard = d.nextBoard;
  var rec = game.getState().records.slice(-1)[0];
  if(rec){ logPush(rec); recentPush(rec); }
}

game.on(function(type, d){
  if(type === 'wallet') setWallet(d.wallet);
  else if(type === 'result') onResult(d);
  else if(type === 'repick'){ cur = d; if(phase === 'lock') renderLock(); }
  else if(type === 'settled') onSettled(d);
  else if(type === 'board') nextBoard = d.board;
  else if(type === 'error') Toast.show(d.msg);
});

function onZone(i){
  if(phase === 'idle'){
    if(Autobet.isRunning()){ Toast.show(T('auto.manualBlock')); return; }   // H05：自動下注進行中不接手動開局（兩局間的空檔也不行）
    if(game.getState().wallet < stake){ Toast.show(T('rej.insufficient')); return; }
    play(i, stake, {}).catch(noop);
  }else if(phase === 'lock'){
    if(i === cur.pointIdx) jumpNow(); else game.changePoint(i);      // 再點同一點＝立即跳；點別點＝改跳
  }else if(phase === 'popup'){
    dismissPopup();
  }
}
map.onclick = function(e){
  if(phase === 'popup'){ dismissPopup(); return; }
  var z = e.target.closest ? e.target.closest('.zone') : null;
  if(z) onZone(+z.getAttribute('data-i'));
};
$('goBtn').onclick = jumpNow;

/* ---------- 錢包重置（log 頁的重置鈕走這裡） ---------- */
function resetWallet(){
  if(phase !== 'idle'){ Toast.show(T('log.noReset')); return false; }
  if(Autobet.isRunning()) Autobet.stop();
  if(!game.clearSaved()) return false;
  recentRebuild([]);
  Toast.show(T('log.resetDone', { n:D.fmt(game.getState().wallet) }));
  return true;
}

/* =====================================================================
 * [A] LogUI 區段（H05 授權）：注單紀錄 → 勝負 log 的列
 * ===================================================================== */
/* 詳細頁（R2-1）＝上半部一張無互動小地圖（主畫面縮小版）＋一行結論；文字列只留下注、拿回、淨額（時間與注單號由 LogUI 加）。
   小圖資料全來自該筆 record 的 fig（當局盤面賠率 o、你的落點 p、三個對手落點 b、是否獨佔 s、箱子 x、結果倍率 m），
   不讀目前盤面；沒有 fig 的舊紀錄 LogUI 不呼叫 renderDetail，退回原本的純文字列（舊列的字典 key 與 .ptd 圓點樣式都還在）。 */
function rowsOf(r){
  return [
    { k:'log.row.stake', v:D.fmt(r.stake) },
    { k:'log.row.pay',   v:D.fmt(r.payout) },
    { k:'log.row.net',   v:D.signed(r.payout - r.stake) }
  ];
}
function figOf(r){
  return { o:r.board.odds.slice(), p:r.pointIdx, b:r.botPicks.slice(), s:r.solo ? 1 : 0, x:r.boxIdx, m:r.mult };
}
/* 簡化島底圖：視窗 y 96～526 只留四個落點會用到的範圍；配色與主畫面 #map 的 SVG 同一組（海、沙灘、草地、河） */
var FIG_VB_Y = 96, FIG_VB_H = 430;
var FIG_SVG = '<svg class="lfs" viewBox="0 ' + FIG_VB_Y + ' 375 ' + FIG_VB_H + '" preserveAspectRatio="none" aria-hidden="true">' +
  '<defs><linearGradient id="lgoc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d3a5e"/><stop offset="1" stop-color="#092743"/></linearGradient>' +
  '<radialGradient id="lggr" cx=".5" cy=".5" r=".65"><stop offset="0" stop-color="#76c25a"/><stop offset="1" stop-color="#4b9645"/></radialGradient></defs>' +
  '<rect y="' + FIG_VB_Y + '" width="375" height="' + FIG_VB_H + '" fill="url(#lgoc)"/>' +
  '<g transform="translate(0 27)"><path d="M 60 150 C 40 110, 120 92, 190 98 C 260 90, 340 110, 350 170 C 360 230, 340 300, 352 360 C 358 420, 300 470, 220 468 C 150 480, 70 470, 40 410 C 20 350, 40 290, 28 240 C 20 200, 40 180, 60 150 Z" fill="#e6cd8f" stroke="#c9ad6a" stroke-width="3"/>' +
  '<path d="M 60 150 C 40 110, 120 92, 190 98 C 260 90, 340 110, 350 170 C 360 230, 340 300, 352 360 C 358 420, 300 470, 220 468 C 150 480, 70 470, 40 410 C 20 350, 40 290, 28 240 C 20 200, 40 180, 60 150 Z" transform="translate(188 285) scale(.92) translate(-188 -285)" fill="url(#lggr)"/>' +
  '<circle cx="165" cy="120" r="9" fill="#2d6e3a"/><circle cx="210" cy="240" r="11" fill="#2d6e3a"/><circle cx="150" cy="310" r="7" fill="#2d6e3a"/><circle cx="215" cy="300" r="9" fill="#2d6e3a"/>' +
  '<circle cx="330" cy="250" r="11" fill="#2d6e3a"/><circle cx="60" cy="300" r="9" fill="#2d6e3a"/><circle cx="180" cy="455" r="11" fill="#2d6e3a"/><circle cx="255" cy="135" r="9" fill="#2d6e3a"/>' +
  '<path d="M 24 238 C 80 262, 130 244, 188 266 C 244 288, 300 268, 354 296" fill="none" stroke="#3ba3d6" stroke-width="9" stroke-linecap="round"/></g></svg>';
/* 一個落點（R3-11：與主畫面同一種圓圈）：圓內＝頭像＋賠率；獨佔＝亮起＋✓（你獨佔金環）、撞車＝紅圈＋💥、沒人＝虛線；不放文字 */
function figZone(f, i){
  var z = ZONE[i], list = [], me = (f.p === i), tx = EV.fmtX(f.o[i]) + 'x';
  if(me) list.push('<i class="gzf you">' + D.esc(T('who.you')) + '</i>');
  f.b.forEach(function(p, b){ if(p === i) list.push('<i class="gzf">' + BOTS[b] + '</i>'); });
  var n = list.length, st = n === 0 ? 'emp' : n === 1 ? 'solo' : 'clash';
  return '<div class="gz ' + st + (me ? ' mine' : '') + '" style="--c:var(--rc' + i + ');--r:' + z.r +
    ';left:' + (z.cx * 100).toFixed(2) + '%;top:' + (((z.cy * 594 - FIG_VB_Y) / FIG_VB_H) * 100).toFixed(2) + '%">' +
    '<div class="gzp"><div class="gzin">' + (n ? '<div class="gzv' + (n >= 4 ? ' q4' : '') + '">' + list.join('') + '</div>' : '') +
    '<b class="god' + (tx.length >= 7 ? ' n7' : tx.length === 6 ? ' n6' : '') + '">' + D.esc(tx) + '</b></div>' +
    (st === 'solo' ? '<span class="gzk">✓</span>' : '') + (st === 'clash' ? '<span class="gzb">💥</span>' : '') + '</div></div>';
}
function figOk(f){
  function idx(v){ return typeof v === 'number' && v >= 0 && v < EV.POINTS.length && v % 1 === 0; }
  return f && f.o && f.o.length === EV.POINTS.length && f.o.every(function(x){ return typeof x === 'number' && isFinite(x); }) &&
    idx(f.p) && f.b && f.b.length === BOTS.length && f.b.every(idx) &&
    typeof f.x === 'number' && !!EV.BOX.tiers[f.x] && typeof f.m === 'number' && isFinite(f.m);
}
/* LogUI 的 renderDetail：回傳插在文字列上方的圖解 HTML；資料不齊回空字串＝LogUI 退回純文字列 */
function renderFig(rec){
  var f = rec.fig;
  if(!figOk(f)) return '';
  var h = '', i, bx = boxOf(f.x), mates = [];
  for(i = 0; i < EV.POINTS.length; i++) h += figZone(f, i);
  f.b.forEach(function(p, b){ if(p === f.p) mates.push(T('bot.' + b)); });
  var solo = !!f.s;                                  // 是否獨佔：record 的 solo（核心 resolve 的結果）
  var cc = solo ? T('log.fig.solo', { box:bx.name, m:bx.mult, x:EV.fmtX(f.m) })
                : T('log.fig.miss', { who:mates.join('、'), box:bx.name, m:bx.mult });
  return '<div class="lfg" role="img" aria-label="' + D.esc(T('log.fig.alt')) + '" data-solo="' + (solo ? 1 : 0) + '">' +
    '<div class="lfm">' + FIG_SVG + '<div class="gzs">' + h + '</div></div>' +
    '<div class="lfc ' + (solo ? 'ok' : 'no') + '">' + D.esc(cc) + '</div></div>';
}
function toLog(r){ return { id:r.orderId, ts:r.ts, stake:r.stake, pay:r.payout, rows:rowsOf(r), fig:figOf(r) }; }
function logPush(rec){ LogUI.push(toLog(rec)); }

LogUI.mount({ root:$('app'), openBtn:$('logBtn'), cap:EV.CFG.LOG_CAP, onReset:resetWallet, renderDetail:renderFig });
game.getState().records.forEach(function(r){ logPush(r); });        // 重整接回：補記沒進 log 的注單（去重）

/* =====================================================================
 * [B] Recent 呼叫點（H04 掛點）：掛點 <div id="recent">；H04 的 js/recent.js 載入在本檔之後，
 *     所以這裡「等它出現再掛」：init、window load、每次 settled 都會試一次（掛過就不再掛）。
 *     H04 需提供：Recent.mount(el)／Recent.push(rec)／Recent.rebuild(records)；
 *     rec＝核心注單紀錄（含 topSoloPoint：本局獨佔成功且賠率最高的落點，全撞＝-1）
 * ===================================================================== */
var recentOn = false;
function ensureRecent(){
  if(recentOn || !window.Recent) return;
  recentOn = true;
  if(Recent.mount) Recent.mount($('recent'));
  if(Recent.rebuild) Recent.rebuild(game.getState().records);
}
function recentPush(rec){
  var was = recentOn;
  ensureRecent();
  if(was && window.Recent && Recent.push) Recent.push(rec);        // 剛掛上時 rebuild 已含這一局
}
function recentRebuild(records){ if(window.Recent && recentOn && Recent.rebuild) Recent.rebuild(records); }
window.addEventListener('load', ensureRecent);

/* =====================================================================
 * [C] Autobet adapter 區段（H05 授權）：入口鈕 #autoBtn、狀態槽 #abar（固定 40px 的 .aslot 內）
 *     自動下注＝不倒數（skipLock）＋縮時（fast）＋彈窗自動收起，演完才 resolve
 * ===================================================================== */
function pointIdxById(id){
  for(var i = 0; i < EV.POINTS.length; i++) if(EV.POINTS[i].id === id) return i;
  return 0;
}
var autoBtn = $('autoBtn'), autoLab = autoBtn.querySelector('span');
var autoPause = 0;       // 只給 ?shot= 的 auto-run 用：跑到第幾局就停在待命（讓截圖停在穩定畫面）
/* 入口鈕：自動下注進行中不隱藏，改成「進行中」樣式與文字（樣式 .run 在 autobet.css）；autobet.js 只管 .show，狀態從這裡同步 */
function syncAutoBtn(){
  if(!autoBtn) return;
  var on = Autobet.isRunning();
  autoBtn.classList.toggle('run', on);
  var tx = T(on ? 'auto.entryOn' : 'auto.entry');
  if(autoLab && autoLab.textContent !== tx) autoLab.textContent = tx;
}
Autobet.mount({
  root:$('app'), entryBtn:autoBtn, slot:$('abar'),
  choices:EV.POINTS.map(function(p){ return { id:p.id, label:ptName(EV.POINTS.indexOf(p)) }; }),
  stakes:EV.CFG.STAKES,
  placeOne:function(cfg){
    if(shot && autoPause && cfg.n >= autoPause) return new Promise(noop);          // 截圖專用：停住不下注
    return play(pointIdxById(cfg.choice), cfg.stake, { fast:(shot ? 0.05 : true), skipLock:true, autoClose:true });
  },
  balance:function(){ return game.getState().wallet; },
  isIdle:function(){ return phase === 'idle'; },
  toast:Toast.show
});
if(window.MutationObserver) new MutationObserver(syncAutoBtn).observe(autoBtn, { attributes:true, attributeFilter:['class'] });
syncAutoBtn();

/* =====================================================================
 * [E] DEMO.ui 對外介面＋自動駕駛（H05 授權 DEMO.ui；shots 的 idle／lock／win／bigwin／crash 由 H02 先備）
 * ===================================================================== */
/* 強制下一局結果（只在 ?dev=1／?shot= 掛，正式網址沒有）：bots＝三個機器人各選哪個落點、boxIdx＝箱子等級。
   原理：依目前盤面的 botP／箱子機率算出落在目標區間正中的亂數，餵給核心下一次 bet 的 4 個亂數，之後還原。 */
function uMid(weights, idx){
  var acc = 0, i;
  for(i = 0; i < idx; i++) acc += weights[i];
  return acc + weights[idx] / 2;
}
function rig(bots, boxIdx){
  var b = game.board(), seq = [], base = game.getRng(), k = 0;
  bots.forEach(function(p){ seq.push(uMid(b.botP, p)); });
  seq.push(uMid(EV.BOX.tiers.map(function(t){ return t.p; }), boxIdx));
  game.setRng(function(){ return k < seq.length ? seq[k++] : base(); });
}

D.ui = { play:play, isBusy:isBusy, phase:function(){ return phase; }, resetWallet:resetWallet, stake:function(){ return stake; } };
if(D.q.dev || D.q.shot){
  D.ui.rig = rig;
  /* 爆金幣開關（導演台用；效果不好時正式的關法仍是把 [0] 的 BIGWIN_COINS 設成 false）：coins() 讀、coins(on) 寫 */
  D.ui.coins = function(on){ if(on !== undefined) BIGWIN_COINS = !!on; return BIGWIN_COINS; };
}

/* ---------- 截圖自動駕駛（落點：0 綠 1 藍 2 紫 3 金；機器人順序：野狼、狐狸、阿熊；箱子：0 軍用 1 精良 2 稀有 3 傳說） ---------- */
/* 依序跑幾局（固定結果、極速縮時）：[ [落點, [三個機器人落點], 箱子, 單注], ... ]，全部演完才呼叫 cb。
   fast 給 0.02＝演出時間乘 0.02，一局約 0.2 秒，十幾局也不會逾時 */
function seedRounds(list, cb){
  var i = 0;
  (function nxt(){
    if(i >= list.length){ cb(); return; }
    var it = list[i++];
    rig(it[1], it[2]);
    play(it[0], it[3] || 100, { fast:0.02, skipLock:true }).then(function(){ after(30, nxt); }, function(){ after(80, nxt); });
  })();
}
var SEED_LOG = [                                   // 贏、輸、贏、輸、大獎、輸、贏（最新＝最後一筆＝紫點撞車）
  [2, [3, 3, 1], 1, 100],                          // 紫點獨佔精良箱
  [3, [3, 0, 1], 2, 100],                          // 金點撞野狼（錯過稀有箱）
  [0, [2, 3, 1], 0,  50],                          // 綠點獨佔軍用箱
  [1, [1, 1, 0], 0,  50],                          // 藍點撞兩人
  [3, [0, 1, 2], 3, 100],                          // 金點獨佔傳說箱（大獎）
  [0, [0, 3, 2], 1, 500],                          // 綠點撞野狼
  [2, [3, 0, 1], 2, 100]                           // 紫點獨佔稀有箱
];
var SEED_RECENT = (function(){                     // 近況列：固定種子隨機 14 局，混合各色與全撞
  var r = lcg(77), list = [], i;
  for(i = 0; i < 14; i++){
    var pt = Math.floor(r() * 4), bots = [];
    for(var k = 0; k < 3; k++) bots.push(Math.floor(r() * 4));
    list.push([pt, bots, Math.floor(r() * 3), 50]);
  }
  return list;
})();

D.shots.idle = function(done){ after(50, done); };
D.shots.lock = function(done){                       // 紫點封盤倒數，停在「3」
  rig([3, 0, 1], 0);
  play(2, stake, { hold:'lock' }).catch(noop);
  after(500, done);
};
D.shots.reveal = function(done){                     // 落地揭曉瞬間
  rig([3, 3, 1], 1);
  play(2, stake, { skipLock:true, hold:'reveal', onReveal:function(){ after(500, done); } }).catch(noop);
};
D.shots.win = function(done){                        // 紫點獨佔、精良箱（非大獎）
  rig([3, 3, 1], 1);
  play(2, stake, { skipLock:true, hold:'popup', onPopup:function(){ after(1700, done); } }).catch(noop);
};
D.shots.bigwin = function(done){                     // 金點獨佔、傳說箱（大獎＋爆金幣，截在金幣飛行中）
  rig([2, 1, 1], 3);
  play(3, stake, { skipLock:true, hold:'popup', onPopup:function(){ after(1350, done); } }).catch(noop);
};
D.shots.crash = function(done){                      // 金點撞野狼、錯過稀有箱
  rig([3, 0, 1], 2);
  play(3, stake, { skipLock:true, hold:'popup', onPopup:function(){ after(1300, done); } }).catch(noop);
};
D.shots['auto-modal'] = function(done){ Autobet.openSheet(); after(450, done); };
D.shots['auto-run'] = function(done){                // 輪流選項跑到第 3 局開跑前：待命地圖＋進行中狀態條＋「進行中」入口鈕
  autoPause = 3;
  Autobet.start({ choice:'alt', stake:50, rounds:10, tp:0, sl:0 });
  var iv = setInterval(function(){
    if(Autobet.state().n >= 3){ clearInterval(iv); after(400, done); }
  }, 100);
};
D.shots['log-list'] = function(done){ seedRounds(SEED_LOG, function(){ LogUI.open(); after(450, done); }); };
D.shots['log-detail'] = function(done){              // 最新一筆＝紫點獨佔稀有箱
  seedRounds(SEED_LOG, function(){ LogUI.openDetail(0); after(450, done); });
};
D.shots['log-detail-crash'] = function(done){        // 撞車那筆（最新往前第 2 筆＝綠點撞野狼）
  seedRounds(SEED_LOG, function(){ LogUI.openDetail(1); after(450, done); });
};
D.shots['log-detail-old'] = function(done){          // 改版前存的舊格式紀錄（沒有 fig、列是完整文字）：詳細頁要退回純文字列
  LogUI.push({ id:'HOTDROP-OLD-0001', ts:Date.now() - 86400000, stake:100, pay:0, rows:[
    { k:'log.row.pick.0', v:ptName(0) }, { k:'log.row.board', v:'綠 1.27x／藍 1.70x／紫 2.13x／金 2.55x' },
    { k:'log.row.bots', v:'野狼→綠、狐狸→金、阿熊→紫' }, { k:'log.row.hit', v:T('log.miss') }, { k:'log.row.mates', v:T('bot.0') },
    { k:'log.row.boxMiss', v:'精良箱 ×1.5' }, { k:'log.row.result', v:'0.00x' }, { k:'log.row.stake', v:'100' },
    { k:'log.row.pay', v:'0' }, { k:'log.row.net', v:'−100' } ] });
  LogUI.openDetail(0); after(450, done);
};
D.shots.recent = function(done){                     // 先塞十幾局紀錄，再截待命畫面（看近況列）
  seedRounds(SEED_RECENT, function(){ after(500, done); });
};

/* =====================================================================
 * init
 * ===================================================================== */
buildZones(); buildShouts();
renderStakes();
renderBoard(game.board(), false);
setWallet(game.getState().wallet);
startShouts();
ensureRecent();
Autobet.refresh();
window.__demoReady = true;
})();
