/* =========================================================================
 * 連鎖開箱——主畫面與連鎖演出（C02）
 *
 * 職責：把核心（DemoCore）算好的整局結果「演」出來——整盤落下 → 圈出片 → 箱子打開 → 下落補箱 → …… → 結算；
 *       管檔位／注額選擇、餘額、倍率階梯、這局戰利品清單、四級回饋（含大獎覆蓋層）。
 *       演出只讀結果物件，自己不判斷哪裡會爆；演完才 game.ack() 入帳。
 *       LogUI／Autobet 的接線不在這裡（C03 的 js/wire.js）；最高紀錄與關鍵時刻停頓也不在這裡（C04 的 js/extras.js）。
 *
 * 對外（DEMO.ui）：見 tasks/C02-主畫面與演出.md「完成註記」。摘要：
 *   on(evt, fn) / off(evt, fn)   事件：roundStart／stepStart／stepOpen／stepEnd／roundEnd／tierChange／stakeChange
 *   play(tierId, stake, opts?)   → Promise<{ stake, pay, payout, net, x, grade, result, orderId, tier, wallet }>
 *   busy() / setTier(id) / setStake(n) / getTier() / getStake() / setPace(fn) / resetWallet()
 *   DEMO.addStrings(dict) 在 strings.js。
 *
 * 動畫：只動 transform／opacity；箱子落下／箱蓋／金幣用 CSS keyframes（--sp 為加速倍率），
 *       演出時序用自己的虛擬計時器（加速時照 --sp 縮短）。無 filter。
 * 依賴：values.js、env.js、strings.js、toast.js、core.js。載入完成後設 window.__demoReady = true。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t;
var $ = function(id){ return document.getElementById(id); };
var CFG = EV.CFG, TIERS = EV.TIERS;
var COLS = CFG.COLS, ROWS = CFG.ROWS, N = COLS * ROWS;
var STEP = 58;                          // 格距（= --cell 53 + --gap 5）
var GX = 16, GY = 182;                  // 格子原點（#app 座標）：rack left 10＋border 2＋padding 4；top 176＋2＋4
var LOOT_SLOTS = 5;
var HOLD = { miss:400, back:800, big:1600, jackpot:3000 };      // 規格書 §7：結算停留（毫秒，正常速度）
var FAST = 2.5;                         // 點畫面加速倍率
var TOT_XY = { x:311, y:631 };          // 戰利品累計框中心（金幣從這裡飛出）
var BAL_XY = { x:32, y:30 };            // 餘額金幣圖示中心（金幣飛向這裡）

var shot = D.q.shot;
var game = DemoCore.createGame({ storage: shot ? false : undefined });
D.game = game;

var gridEl = $('grid'), fxEl = $('fx'), jpEl = $('jp'), appEl = $('app');
var ladderEl = $('ladder'), slotsEl = $('slots'), lootEl = $('loot'), totEl = $('tot'), totv = $('totv'), walEl = $('wal');
var goBtn = $('goBtn');

/* ---------- 狀態 ---------- */
var tierIdx = EV.tierIndex(D.ls('tier'));
if(tierIdx < 0) tierIdx = EV.tierIndex('mid');
var stake = D.ls('stake');
if(CFG.STAKES.indexOf(stake) < 0) stake = CFG.DEFAULT_STAKE;
var busy = false;                       // 演出中（含結算停留）
var pend = null;                        // 進行中的 play()：{ res, rej, o }
var cur = null;                         // 進行中那一局：{ orderId, tierId, stake, result }
var lastSettled = null;                 // 最近一次 settled 事件資料
var B = [], E = [];                     // 盤面：B＝格子上的 { cw, cr, v }；E＝同一份盤面的純數值（對照用）
var loot = { items:[], total:0, newCount:0, nxt:false, tone:'' };
var speed = 1, userFast = false;
var paceFn = null;
var subs = {};
var shownBal = game.getState().wallet, targetBal = shownBal, deferBal = false;
var fxTrash = [];
var balDelay = 0, jpToken = 0;

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

/* ---------- 虛擬計時器：加速時照倍率縮短（演出時序與數字滾動共用一個節拍） ---------- */
var timers = [], rolls = {}, tk = null, lastT = 0;
function nowMs(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
function kick(){ if(tk === null){ lastT = nowMs(); tk = setTimeout(tick, 16); } }
function tick(){
  tk = null;
  var t = nowMs(), dt = (t - lastT) * speed; lastT = t;
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
    timers.push({ left:ms, res:res }); kick();
  });
}
function later(ms, fn){ if(!(ms > 0)) fn(); else sleep(ms).then(fn); }
function rollTo(key, from, to, ms, apply){
  delete rolls[key];
  if(!(ms > 0) || from === to){ apply(to); return; }
  rolls[key] = { from:from, to:to, left:ms, total:ms, apply:apply }; kick();
}

/* ---------- 加速 ---------- */
function setSpeed(s){
  var old = speed;
  if(s === old) return;
  var anims = [];
  try{ anims = document.getAnimations ? document.getAnimations() : []; }catch(e){}
  // 已在跑的動畫：先把原本的倍率釘在元素上，再用 playbackRate 接著加速（避免改 --sp 造成進度跳動）
  anims.forEach(function(a){
    var tg = a.effect && a.effect.target;
    if(tg && tg.style) tg.style.setProperty('--sp', old);
  });
  speed = s;
  appEl.style.setProperty('--sp', s);
  anims.forEach(function(a){ try{ a.playbackRate = a.playbackRate * s / old; }catch(e){} });
}
function speedUp(){
  if(!busy || userFast) return;
  userFast = true;
  setSpeed(FAST);
}
appEl.addEventListener('pointerdown', function(){ speedUp(); });

/* ---------- 版面縮放（窄螢幕／矮螢幕等比縮小；375×812 時不動） ---------- */
function fit(){
  if(D.q.vw) return;
  var vw = window.innerWidth, vh = window.innerHeight, s = Math.min(1, vw / 375, vh / 812);
  if(s >= 0.999){ appEl.style.transform = ''; appEl.style.transformOrigin = ''; appEl.style.marginLeft = ''; return; }
  appEl.style.transformOrigin = '0 0';
  appEl.style.transform = 'scale(' + s + ')';
  appEl.style.marginLeft = Math.max(0, (vw - 375 * s) / 2) + 'px';
}
window.addEventListener('resize', fit);

/* ---------- 小工具 ---------- */
function reflow(){ return gridEl.offsetWidth; }
function cellXY(i){ var r = (i / COLS) | 0, c = i % COLS; return { r:r, c:c, x:c * STEP, y:r * STEP }; }
function lenCls(s){ var n = String(s).length; return n >= 8 ? ' s8' : n >= 7 ? ' s7' : n >= 6 ? ' s6' : ''; }
function gradeOf(x){ return x >= CFG.JACKPOT_X ? 'jackpot' : x >= CFG.BIG_X ? 'big' : x >= 1 ? 'back' : 'miss'; }
function noop(){}
function sym(k){ return '<svg class="sy" viewBox="0 0 24 24"><use href="#sy' + k + '" xlink:href="#sy' + k + '"/></svg>'; }

/* ---------- 餘額 ---------- */
function setWalletText(n){ shownBal = n; walEl.textContent = D.fmt(n); }
function onWallet(w){
  var from = shownBal;
  targetBal = w;
  if(deferBal) return;
  if(w <= from){ rollTo('bal', from, w, 0, setWalletText); return; }       // 扣注：直接變
  if(balDelay > 0){
    var dly = balDelay; balDelay = 0;
    later(dly, function(){ rollTo('bal', shownBal, targetBal, 480, setWalletText); });
    return;
  }
  rollTo('bal', from, w, 480, setWalletText);
}
function flushBal(){ deferBal = false; delete rolls.bal; setWalletText(targetBal); }

/* ---------- 檔位／注額／階梯／戰利品 ---------- */
function renderTiers(){
  var h = '';
  TIERS.forEach(function(tr, i){
    h += '<button type="button" class="tier' + (i === tierIdx ? ' on' : '') + '" data-i="' + i + '"><span class="lb">' +
      T('tier.' + tr.id) + '</span><span class="dots">';
    for(var d = 0; d < tr.kinds; d++) h += '<i class="k' + d + '"></i>';
    h += '</span></button>';
  });
  $('tiers').innerHTML = h;
}
function renderStakes(){
  var h = '';
  CFG.STAKES.forEach(function(v){
    h += '<button type="button" class="bet' + (v === stake ? ' on' : '') + '" data-v="' + v + '">' + D.fmt(v) + '</button>';
  });
  $('stakes').innerHTML = h;
}
/* cur＝亮到第幾格（-1 全暗）；pop＝目前這格要彈一下；mute＝沒回本的低調樣式 */
function renderLadder(curI, pop, mute){
  var lad = TIERS[tierIdx].ladder, h = '';
  for(var i = 0; i < lad.length; i++){
    var c = '';
    if(curI >= 0){ if(i < curI) c = 'done'; else if(i === curI) c = 'cur' + (pop ? ' pop' : ''); }
    h += '<div class="lseg ' + c + '"><span>×' + EV.fmtX(lad[i]) + '</span></div>';
  }
  ladderEl.innerHTML = h;
  ladderEl.className = 'ladder' + (mute ? ' mute' : '');
}
/* 清單：最多 5 格；超過時最舊的往左收成「+N」（佔第 1 格，其餘是最新的片）；連鎖中最後一格留一個虛線格 */
function renderLoot(){
  var items = loot.items, room = LOOT_SLOTS - (loot.nxt ? 1 : 0), hidden = 0, list = items, h = '', i;
  if(items.length > room){
    hidden = items.length - (room - 1);
    list = items.slice(hidden);
    h += '<div class="slot"><div class="more">+' + hidden + '</div><em></em></div>';
  }
  var used = list.length + (hidden ? 1 : 0);
  list.forEach(function(it, j){
    var isNew = loot.newCount && j >= list.length - loot.newCount;
    h += '<div class="slot' + (isNew ? ' new' : '') + '"><div class="chip k' + it.c + (loot.tone === 'mute' ? ' mute' : '') + '">' +
      '<svg viewBox="0 0 24 24"><use href="#sy' + it.c + '" xlink:href="#sy' + it.c + '"/></svg>' + (it.g ? '<span class="gd"></span>' : '') +
      '</div><em>' + D.fmt(it.a) + '</em></div>';
  });
  if(loot.nxt){ h += '<div class="slot"><div class="chip nxt"></div><em></em></div>'; used++; }
  for(i = used; i < LOOT_SLOTS; i++) h += '<div class="slot"><div class="chip empty"></div><em></em></div>';
  slotsEl.innerHTML = h;
  lootEl.className = 'loot' + (loot.tone ? ' ' + loot.tone : '');
  setTotText(loot.total);
}
function setTotText(n){
  totv.textContent = D.fmt(n);
  totEl.className = 'tot' + (loot.items.length ? '' : ' zero') + lenCls(D.fmt(n));
}
function resetLoot(){
  loot = { items:[], total:0, newCount:0, nxt:false, tone:'' };
  delete rolls.tot;
  renderLoot();
}
function popTot(){
  totEl.classList.remove('pop'); reflow(); totEl.classList.add('pop');
}

/* ---------- 盤面 ---------- */
function makeCrate(v, i){
  var p = cellXY(i), k = v & 7, gold = (v & 8) ? 1 : 0;
  var cw = document.createElement('div');
  cw.className = 'cw';
  cw.style.setProperty('--x', p.x + 'px'); cw.style.setProperty('--y', p.y + 'px');
  var cr = document.createElement('div');
  cr.className = 'crate k' + k + (gold ? ' isg' : '');
  cr.innerHTML = sym(k) + (gold ? '<span class="g">×' + CFG.GOLD_MULT + '</span>' : '');
  cw.appendChild(cr);
  gridEl.appendChild(cw);
  return { cw:cw, cr:cr, v:v };
}
/* 一批箱子的落下／補位：list＝[{ o, fy（起點 y）, y（終點 y）, d（時間 ms）, dl（延遲 ms） }]；一次 reflow 全部起跑 */
function startFalls(list){
  list.forEach(function(l){ l.o.cw.classList.remove('mv'); });
  reflow();
  list.forEach(function(l){
    var cw = l.o.cw, s = cw.style;
    s.setProperty('--y', l.y + 'px'); s.setProperty('--fy', l.fy + 'px');
    s.setProperty('--d', Math.round(l.d) + 'ms'); s.setProperty('--dl', Math.round(l.dl) + 'ms');
    cw.classList.add('mv');
  });
}
gridEl.addEventListener('animationend', function(e){
  if(e.animationName === 'cfall' && e.target.classList) e.target.classList.remove('mv');
});
function clearGrid(){ gridEl.innerHTML = ''; B = []; E = []; }
/* 直接畫出一張盤面（待命／重整／校正用）；fade＝淡入 */
function showBoard(arr, fade){
  clearGrid();
  for(var i = 0; i < N; i++){
    B[i] = makeCrate(arr[i], i);
    if(fade) B[i].cw.classList.add('fadein');
  }
  E = arr.slice();
}
function calmBoard(ti, seed){
  var rng = DemoCore.makeRng(seed), K = TIERS[ti].kinds, b, tries = 0, i;
  do{
    b = [];
    for(i = 0; i < N; i++) b.push(Math.floor(rng() * K));
    tries++;
  }while(DemoCore.findGroups(b, COLS, ROWS, CFG.MIN_GROUP).length && tries < 3000);
  return b;
}
function showIdle(fade){
  clearFx();
  resetLoot();
  renderLadder(-1);
  var seed = shot ? 20 + tierIdx : ((Math.random() * 4294967295) >>> 0);
  showBoard(calmBoard(tierIdx, seed), fade);
}

/* 與核心的結尾盤面對帳；不一致就直接畫核心的盤面（演出只信結果） */
function syncFinal(R){
  var ok = true, i;
  for(i = 0; i < N; i++) if(E[i] !== R.final[i]){ ok = false; break; }
  if(!ok){ console.warn('[ui] 演出盤面與核心結尾盤面不一致，改畫核心盤面'); }
  var bad = false;
  for(i = 0; i < N; i++) if(!B[i] || B[i].v !== R.final[i]){ bad = true; break; }
  if(!ok || bad) showBoard(R.final.slice(), false);
}

/* ---------- 特效層 ---------- */
function fxAdd(tag, cls, style){
  var n = document.createElement(tag);
  n.className = cls;
  if(style) n.style.cssText = style;
  fxEl.appendChild(n);
  fxTrash.push(n);
  return n;
}
function clearFx(){
  fxTrash.forEach(function(n){ if(n.parentNode) n.parentNode.removeChild(n); });
  fxTrash = [];
  var b = fxEl.querySelector('.bw'); if(b && b.parentNode) b.parentNode.removeChild(b);
  closeJp(true);
}
function sweepFx(nodes, ms){
  setTimeout(function(){
    nodes.forEach(function(n){ if(n.parentNode) n.parentNode.removeChild(n); });
    fxTrash = fxTrash.filter(function(n){ return nodes.indexOf(n) < 0; });
  }, ms);
}
/* 一顆箱子打開：箱蓋、光、金幣三顆（獨立元素，只動 transform／opacity） */
function fxOpen(ci, v, made){
  var p = cellXY(ci), X = GX + p.x, Y = GY + p.y, k = v & 7, j;
  made.push(fxAdd('i', 'fbeam', 'left:' + (X + 3) + 'px;top:' + (Y - 20) + 'px'));
  made.push(fxAdd('i', 'flid k' + k, 'left:' + (X - 1) + 'px;top:' + Y + 'px'));
  var cx = [12, 24, 34], dxs = [-9, 3, 10];
  for(j = 0; j < 3; j++){
    var jit = ((ci * 7 + j * 3) % 5 - 2) * 2;
    made.push(fxAdd('i', 'fcn n' + (j + 1),
      'left:' + (X + cx[j]) + 'px;top:' + (Y + 5) + 'px;--cd:' + (120 + 40 * j) + 'ms;--dx:' + (dxs[j] + jit) + 'px;--dy:-' + (34 + j * 5) + 'px'));
  }
}
/* 金幣飛向餘額（回本以上才有） */
function burstCoins(n){
  var nodes = [], i;
  for(i = 0; i < n; i++){
    var sx = TOT_XY.x + ((i * 37) % 41 - 20), sy = TOT_XY.y + ((i * 17) % 21 - 10);
    var d = 560 + (i * 53) % 160, dl = i * 42;
    var f = fxAdd('b', 'fly', 'left:' + sx + 'px;top:' + sy + 'px;--tx:' + (BAL_XY.x - sx) + 'px;--ty:' + (BAL_XY.y - sy) + 'px;--d:' + d + 'ms;--dl:' + dl + 'ms');
    f.innerHTML = '<i></i>';
    nodes.push(f);
  }
  sweepFx(nodes, 1800);
}
function showBigText(total){
  var s = D.fmt(total);
  var n = fxAdd('div', 'bw' + lenCls(s));
  n.innerHTML = '<b>' + s + '</b>';
  return n;
}

/* ---------- 大獎覆蓋層（≥20 倍） ---------- */
var BIGCROWN = '<svg width="96" height="66" viewBox="0 0 96 66"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c4"/><stop offset=".55" stop-color="#ffc933"/><stop offset="1" stop-color="#d98200"/></linearGradient></defs><path d="M6 18l21 20 21-32 21 32 21-20-8 46H14z" fill="url(#cg)" stroke="#6b3d00" stroke-width="4" stroke-linejoin="round"/><circle cx="6" cy="16" r="5" fill="#fff3b0" stroke="#6b3d00" stroke-width="3"/><circle cx="48" cy="6" r="5.5" fill="#fff3b0" stroke="#6b3d00" stroke-width="3"/><circle cx="90" cy="16" r="5" fill="#fff3b0" stroke="#6b3d00" stroke-width="3"/><path d="M16 52h64" stroke="#8a4f00" stroke-width="3" stroke-linecap="round" opacity=".6"/></svg>';
var jpOn = false, jpRes = null;
function openJp(total){
  var K = TIERS[tierIdx].kinds, h = '<div class="core"></div><div class="beams"></div><div class="fade"></div>';
  [[22, 120, -18, 0, 1], [288, 104, 16, 1, 1], [304, 214, 28, 4, .8], [8, 214, -26, 2, .75],
   [24, 440, 20, 3, 1], [146, 500, -12, 5, .9], [292, 452, -22, 0, 1], [236, 560, 14, 2, .8], [66, 566, -30, 1, .8]
  ].forEach(function(b, i){
    h += '<div class="bit" style="left:' + b[0] + 'px;top:' + b[1] + 'px;transform:rotate(' + b[2] + 'deg) scale(' + (b[4] * 1.15) + ')">' +
      '<div class="bob" style="animation-delay:-' + ((i * 0.37) % 2.2).toFixed(2) + 's"><div class="crate k' + (b[3] % K) + '">' + sym(b[3] % K) + '</div></div></div>';
  });
  [[110, 190, 20], [250, 170, 16], [330, 340, 18], [20, 380, 16], [210, 460, 22], [100, 470, 16], [330, 540, 18], [40, 520, 20], [190, 610, 16]
  ].forEach(function(q, i){
    h += '<span class="coinp" style="left:' + q[0] + 'px;top:' + q[1] + 'px;width:' + q[2] + 'px;height:' + q[2] +
      'px;animation-delay:-' + ((i * 0.29) % 1.8).toFixed(2) + 's"></span>';
  });
  var s = D.fmt(total);
  h += '<div class="crown">' + BIGCROWN + '</div><div class="amt' + lenCls(s) + '"><b id="jpv">0</b></div>';
  jpEl.innerHTML = h;
  jpEl.className = 'jp on';
  reflow();
  jpEl.className = 'jp on show';
  jpOn = true;
  var v = $('jpv');
  rollTo('jp', 0, total, 1300, function(n){ v.textContent = D.fmt(n); });
  var tok = ++jpToken;
  return new Promise(function(res){
    jpRes = res;
    sleep(HOLD.jackpot).then(function(){ if(tok === jpToken) closeJp(); });
  });
}
function closeJp(instant){
  if(!jpOn && instant !== true) return;
  var wasOn = jpOn;
  jpOn = false;
  delete rolls.jp;
  if(instant === true){ jpEl.className = 'jp'; jpEl.innerHTML = ''; }
  else{
    jpEl.className = 'jp on';                                    // 淡出（opacity 轉場）
    setTimeout(function(){ if(!jpOn){ jpEl.className = 'jp'; jpEl.innerHTML = ''; } }, 280);
  }
  if(wasOn && jpRes){ var r = jpRes; jpRes = null; r(); }
}
jpEl.addEventListener('click', function(){ closeJp(); });

/* ---------- 演出：停在某個瞬間（只給自動駕駛截圖用） ---------- */
function maybeStop(ph, idx){
  var s = pend && pend.o && pend.o.stopAt;
  if(!s || s.phase !== ph || (s.step != null && s.step !== idx)) return null;
  return new Promise(function(){
    var fired = false;
    function go(){                                              // 等瀏覽器真的出過畫面再起算（剛載入時動畫時鐘可能還沒走）
      if(fired) return; fired = true;
      setTimeout(function(){
        try{ document.getAnimations().forEach(function(a){ a.pause(); }); }catch(e){}
        if(pend && pend.o.onStop) pend.o.onStop(ph, idx);
      }, s.delay || 0);
    }
    if(window.requestAnimationFrame){ requestAnimationFrame(function(){ requestAnimationFrame(go); }); setTimeout(go, 900); }
    else go();
  });
}

/* ---------- 演出各段 ---------- */
function stepData(R, i){
  var st = R.steps[i], nL = TIERS[tierIdx].ladder.length;
  return { orderId:cur.orderId, tier:R.tierId, tierIndex:R.tier, stake:cur.stake, chain:i, chainNo:i + 1, chains:R.chains,
           mult:st.mult, ladderIndex:Math.min(i, nL - 1), clusters:st.clusters, pay:st.pay, cum:st.cum,
           last:i === R.steps.length - 1, result:R };
}
function pace(phase, i, R){
  if(!paceFn) return Promise.resolve();
  var ms = 0;
  try{
    ms = +paceFn({ phase:phase, chain:i, done:i, hasNext:phase === 'step', result:R, tier:R.tierId, stake:cur.stake,
                   fast:speed > 1, cum:i ? R.steps[i - 1].cum : 0 });
  }catch(e){ console.error('[DEMO.ui.setPace]', e); }
  return ms > 0 ? sleep(ms) : Promise.resolve();
}

/* 整盤落下（0.6s）：舊盤面往下退場，新盤面一欄欄由上落下 */
function phaseInit(R){
  var old = B.slice();
  old.forEach(function(o){ if(o){ o.cw.classList.remove('mv'); o.cw.classList.add('exit'); } });
  setTimeout(function(){ old.forEach(function(o){ if(o && o.cw.parentNode) o.cw.parentNode.removeChild(o.cw); }); }, 320);
  B = []; E = R.init.slice();
  var list = [];
  for(var i = 0; i < N; i++){
    var o = makeCrate(R.init[i], i), p = cellXY(i);
    B[i] = o;
    list.push({ o:o, fy:p.y - ROWS * STEP - 20, y:p.y, d:380, dl:50 + (ROWS - 1 - p.r) * 12 + p.c * 14 });
  }
  startFalls(list);
  var h = maybeStop('init', 0); if(h) return h;
  return sleep(600);
}

/* 圈出這次要爆的片、其餘變暗；階梯亮一格 */
function phaseCircle(R, i){
  var st = R.steps[i], hot = {}, nL = TIERS[tierIdx].ladder.length, c, ci;
  st.clusters.forEach(function(cl){ cl.cells.forEach(function(x){ hot[x] = 1; }); });
  for(ci = 0; ci < N; ci++){
    var o = B[ci]; if(!o) continue;
    if(hot[ci]){ o.cr.classList.add('hot'); o.cw.classList.add('zh'); } else o.cr.classList.add('dim');
  }
  loot.nxt = true; loot.newCount = 0; renderLoot();
  renderLadder(Math.min(i, nL - 1), true);
  emit('stepStart', stepData(R, i));
  var h = maybeStop('circle', i); if(h) return h;
  return sleep(500);
}

/* 箱子打開（0.45s）：箱蓋掀開、金幣冒出、清單多一格、累計滾動；同一片由上往下錯開 30ms */
function phaseOpen(R, i){
  var st = R.steps[i], made = [], popped = {};
  st.clusters.forEach(function(cl){
    var minRow = 99;
    cl.cells.forEach(function(x){ var r = (x / COLS) | 0; if(r < minRow) minRow = r; });
    cl.cells.forEach(function(x){
      var o = B[x]; if(!o) return;
      popped[x] = 1;
      var od = Math.min(((x / COLS) | 0) - minRow, 3) * 30;
      later(od, function(){
        o.cr.classList.add('open');
        o.cr.insertAdjacentHTML('afterbegin', '<span class="int"></span>');
        fxOpen(x, o.v, made);
      });
    });
    loot.items.push({ c:cl.kind, a:cl.pay, g:cl.golds > 0 });
  });
  var prev = loot.total;
  loot.newCount = st.clusters.length; loot.nxt = true;
  renderLoot();                                                 // 先以舊累計畫出新格
  loot.total = st.cum;
  rollTo('tot', prev, st.cum, 300, setTotText);                 // 累計數字滾到新值
  emit('stepOpen', stepData(R, i));
  sweepFx(made, 1400);
  var h = maybeStop('open', i); if(h) return h;
  return sleep(450).then(function(){
    for(var x in popped){ var o = B[x]; if(o && o.cw.parentNode) o.cw.parentNode.removeChild(o.cw); B[x] = null; }
  });
}

/* 上方下落、頂端補新箱（0.4s） */
function phaseDrop(R, i){
  var st = R.steps[i], oldB = B, oldE = E, nb = new Array(N), ne = new Array(N), popped = {}, src = {}, list = [], idx;
  st.clusters.forEach(function(cl){ cl.cells.forEach(function(x){ popped[x] = 1; }); });
  st.moves.forEach(function(m){ src[m[0]] = 1; });
  for(idx = 0; idx < N; idx++){
    if(popped[idx] || src[idx]) continue;
    nb[idx] = oldB[idx]; ne[idx] = oldE[idx];
  }
  st.moves.forEach(function(m){
    var from = cellXY(m[0]), to = cellXY(m[1]), o = oldB[m[0]];
    nb[m[1]] = o; ne[m[1]] = oldE[m[0]];
    if(o) list.push({ o:o, fy:from.y, y:to.y, d:Math.min(360, 200 + 28 * (to.r - from.r)), dl:to.c * 10 });
  });
  st.spawns.forEach(function(s){
    var to = cellXY(s.to), o = makeCrate(s.v, s.to);
    nb[s.to] = o; ne[s.to] = s.v;
    list.push({ o:o, fy:s.fromRow * STEP, y:to.y, d:Math.min(360, 200 + 28 * (to.r - s.fromRow)), dl:to.c * 10 });
  });
  B = nb; E = ne;
  for(idx = 0; idx < N; idx++){
    var o2 = B[idx];
    if(o2){ o2.cr.classList.remove('hot', 'dim'); o2.cw.classList.remove('zh'); }
  }
  startFalls(list);
  var h = maybeStop('drop', i); if(h) return h;
  var end = 0;
  list.forEach(function(l){ if(l.d + l.dl > end) end = l.d + l.dl; });
  return sleep(end);
}

function runSteps(R, i){
  if(i >= R.steps.length) return Promise.resolve();
  return pace('step', i, R)
    .then(function(){ return phaseCircle(R, i); })
    .then(function(){ return phaseOpen(R, i); })
    .then(function(){ return phaseDrop(R, i); })
    .then(function(){
      loot.newCount = 0;
      emit('stepEnd', stepData(R, i));
      return runSteps(R, i + 1);
    });
}

/* 結算：入帳、依等級給回饋、停留、放開操作 */
function phaseSettle(d){
  var R = d.result, grade = gradeOf(R.totalX), noChain = R.chains === 0;
  syncFinal(R);
  loot.nxt = false; loot.newCount = 0;
  loot.tone = noChain ? '' : (grade === 'miss' ? 'mute' : 'win');
  var big = grade === 'big' || grade === 'jackpot';
  deferBal = grade === 'jackpot';                               // 大獎：餘額等覆蓋層收起再滾
  balDelay = (grade === 'back' || grade === 'big') ? 450 : 0;   // 回本以上：等金幣飛到再滾
  lastSettled = null;
  delete rolls.tot;
  game.ack();                                                   // → settled、wallet 事件（餘額在這裡入帳）
  var sd = lastSettled || { payout:R.total, net:R.total - d.stake, wallet:game.getState().wallet, orderId:d.orderId };
  renderLoot();
  if(!noChain && grade === 'miss') ladderEl.classList.add('mute');
  if(grade === 'back' || big){ popTot(); }
  var holdMs = HOLD[grade], bigNode = null, p = Promise.resolve();
  if(grade === 'back') burstCoins(7);
  else if(grade === 'big'){ burstCoins(14); bigNode = showBigText(R.total); }
  var data = { orderId:d.orderId, tier:R.tierId, tierIndex:R.tier, stake:d.stake, total:R.total, payout:sd.payout, pay:sd.payout, net:sd.net,
               x:R.totalX, grade:grade, noChain:noChain, chains:R.chains, near:R.near, result:R, wallet:sd.wallet,
               restored:false, record:sd.record || null };
  if(grade === 'jackpot'){
    p = openJp(R.total).then(function(){ flushBalSoft(); return sleep(400); });
    var hj = maybeStop('jackpot', 0); if(hj) p = hj;
  }else{
    p = sleep(holdMs).then(function(){
      if(bigNode){ bigNode.classList.add('out'); return sleep(240); }
    });
  }
  if(grade !== 'jackpot'){ var hs = maybeStop('settle', 0); if(hs) p = hs; }
  emit('roundEnd', data);
  return p.then(function(){ return data; });
}
function flushBalSoft(){                                        // 大獎收起後才讓餘額滾上去
  deferBal = false;
  var from = shownBal;
  rollTo('bal', from, targetBal, 480, setWalletText);
}

function finish(payload){
  busy = false;
  setBusyUI(false);
  flushBal();
  var p = pend; pend = null;
  if(p) p.res(payload);
}
function recover(d, e){
  console.error('[ui] 演出發生例外，直接結算：', e);
  try{ if(game.getState().phase === 'ANIM') game.ack(); }catch(x){}
  try{ if(d && d.result && d.result.final) showBoard(d.result.final.slice(), false); }catch(x){}
  closeJp(true);
  var sd = lastSettled || {};
  finish({ stake:d ? d.stake : 0, pay:sd.payout || 0, payout:sd.payout || 0, net:sd.net || 0, x:0, grade:'miss',
           result:d ? d.result : null, orderId:d ? d.orderId : '', tier:d ? d.choice : '', wallet:game.getState().wallet, error:String(e) });
}

/* ---------- 下注接線：result → 演出 ---------- */
function onResult(d){
  cur = { orderId:d.orderId, tierId:d.choice, stake:d.stake, result:d.result };
  var R = d.result;
  setBusyUI(true);
  clearFx();
  resetLoot();
  renderLadder(-1);
  emit('roundStart', { orderId:d.orderId, tier:d.choice, tierIndex:R.tier, stake:d.stake, result:R, fast:userFast });
  phaseInit(R)
    .then(function(){ return runSteps(R, 0); })
    .then(function(){ return pace('end', R.steps.length, R); })
    .then(function(){ return phaseSettle(d); })
    .then(finish, function(e){ recover(d, e); });
}

function onSettled(d){ lastSettled = d; }

game.on(function(type, d){
  if(type === 'wallet') onWallet(d.wallet);
  else if(type === 'result') onResult(d);
  else if(type === 'settled') onSettled(d);
});

/* ---------- 對外操作 ---------- */
function setBusyUI(b){
  goBtn.classList.toggle('off', b);
  $('stakes').classList.toggle('dis', b);
  $('colr').classList.toggle('dis', b);
}
function selectTier(i, silent){
  if(i === tierIdx) return false;
  var prev = TIERS[tierIdx].id;
  tierIdx = i;
  D.ls('tier', TIERS[i].id);
  renderTiers();
  showIdle(true);                                               // 顏色數變了：換一張該檔的待命盤面
  if(!silent) emit('tierChange', { tier:TIERS[i].id, tierIndex:i, prev:prev });
  return true;
}
function selectStake(v, silent){
  if(v === stake) return false;
  var prev = stake;
  stake = v;
  D.ls('stake', v);
  renderStakes();
  if(!silent) emit('stakeChange', { stake:v, prev:prev });
  return true;
}
function setTier(id){
  var i = EV.tierIndex(id);
  if(i < 0 || busy) return false;
  selectTier(i);
  return true;
}
function setStake(v){
  v = +v;
  if(CFG.STAKES.indexOf(v) < 0 || busy) return false;
  selectStake(v);
  return true;
}

/* 下注＋演出：先抽定（核心）→ UI 演 → ack 才結算。opts：{ fast, stopAt, onStop }（後兩個只給截圖用） */
function play(tierId, st, o){
  o = o || {};
  return new Promise(function(res, rej){
    if(busy || game.getState().phase !== 'BET') return rej(new Error('busy'));
    var ti = EV.tierIndex(tierId);
    if(ti < 0) return rej(new Error('tier'));
    st = Math.floor(st);
    if(!(st > 0) || st > game.getState().wallet) return rej(new Error('stake'));
    if(ti !== tierIdx) selectTier(ti);
    if(st !== stake && CFG.STAKES.indexOf(st) >= 0) selectStake(st);
    busy = true;
    userFast = !!o.fast;
    setSpeed(userFast ? FAST : 1);
    pend = { res:res, rej:rej, o:o };
    if(!game.bet(tierId, st)){ pend = null; busy = false; setBusyUI(false); rej(new Error('bet')); }
  });
}

goBtn.onclick = function(){
  if(busy) return;
  if(game.getState().wallet < stake){ Toast.show(T('rej.insufficient')); return; }
  play(TIERS[tierIdx].id, stake).catch(noop);
};
$('tiers').onclick = function(e){
  var b = e.target.closest ? e.target.closest('.tier') : null;
  if(!b || busy) return;
  selectTier(+b.getAttribute('data-i'));
};
$('stakes').onclick = function(e){
  var b = e.target.closest ? e.target.closest('.bet') : null;
  if(!b || busy) return;
  selectStake(+b.getAttribute('data-v'));
};

/* 錢包重置（log 頁的重置鈕走這裡；C03 接 LogUI.mount({ onReset:DEMO.ui.resetWallet })） */
function resetWallet(){
  if(busy){ Toast.show(T('log.noReset')); return false; }
  if(!game.clearSaved()) return false;
  showIdle(true);
  Toast.show(T('log.resetDone', { n:D.fmt(game.getState().wallet) }));
  return true;
}

/* ---------- init ---------- */
(function init(){
  var gt = T('main.go');
  $('goTxt').textContent = gt;
  $('goTxt').classList.toggle('long', gt.length > 2);
  renderTiers(); renderStakes();
  setWalletText(game.getState().wallet);
  showIdle(false);
  setBusyUI(false);
  fit();
  D.ui = {
    on:on, off:off, play:play, busy:function(){ return busy; }, isBusy:function(){ return busy; },
    setTier:setTier, setStake:setStake,
    getTier:function(){ return TIERS[tierIdx].id; }, getStake:function(){ return stake; },
    setPace:function(fn){ paceFn = typeof fn === 'function' ? fn : null; },
    resetWallet:resetWallet, gradeOf:gradeOf
  };
  window.__demoReady = true;
})();
})();
