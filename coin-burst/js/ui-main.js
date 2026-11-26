/* =========================================================================
 * 爆金連鎖——主畫面與演出（C02；B 案：斜看幣柱＋底部收集槽＋面額分頁縮圖）
 *
 * 職責：把核心（DemoCore）一注算好的結果「演」出來，演完 ack() 入帳。演出只讀結果、不自己算規則與金額：
 *   result.boardBefore → 丟入 → main.waves 逐波炸開（壓→彈→飛→落）→ 噴出的幣在離開盤面當下讓金額加一次、
 *   先停在噴出的那一邊、再滑進底部收集槽排成一列 → 天降（sky.waves 同樣演）→ 分級回饋 → 逐枚進錢包 → ack。
 *   amount 一律取 result.items[].amount；分級用 result.tier；盤面終點與 result.boardAfter 對帳。
 * 收集槽只是演出（拿掉規則不變）：要拿掉就刪掉標著「收集槽」的區塊（buildTray、schedExit 的 glide 與 pay 兩段），
 *   把 schedExit 末端改成「幣從停住的地方直接飛進錢包」，其他部分不用動。
 * 動畫：全部掛在 FX（js/fx.js）的虛擬時間軸上，只寫 transform／opacity；不用 filter；
 *   精靈（金幣、鑽石、皇冠、天降幣、火花）由 js/art.js 畫一次成 CSS 背景圖，重複使用。
 *
 * 節拍（普通速度，毫秒；高速＝普通 × 0.6）：丟入 150／每波 520（壓 170＋飛 320＋空檔 30）／噴出停在邊上 110＋滑進槽 300～500／
 *   天降 淡入 150＋停 500＋落下 300／分級 回本 400、大連爆 1000、全畫面 1600／落袋 逐枚、每枚間隔 ≤90、總長 ≤0.9 秒。
 *
 * 對外（DEMO.ui；dev.js 的自動駕駛、C03 的 wire.js 用）：
 *   on(evt, fn)／off(evt, fn)   事件：roundStart{result}｜wave{src,wave,cells,dom}｜exit{amount,total,index}｜
 *                               chainEnd{result,tray,amt}｜roundEnd{result,record,payout,…}｜denom{denomIndex}｜speed{fast}
 *   play(cell, opts?)           → Promise<{ orderId, stake, pay(＝payout), payout, net, mult, tier, quiet, result, wallet }>
 *                               opts：{ plan（導演台：下一注結果，同 DemoCore.armNext）, speed（倍率，疊在普通／高速上）,
 *                                      fast（true＝這注用高速節拍）, freeze（截圖：停在某個時間點，見 shots）}
 *   isBusy()/busy()             演出中（沒爆沒天降的那一注不算）
 *   setDenom(di)／getDenom()    換面額（＝換一張盤面）
 *   setFast(bool, quiet?)／isFast()  速度切換（存 burst.speed）
 *   resetWallet()               錢包與盤面回初始（log 頁的重置鈕走這裡）
 *   cellInfo(i)                 該格目前畫面上的枚數與寶物（讀 DOM，探針用）
 *   snapshot()                  { cells:[{h,g}], wallet, amt, tray, banner }（讀 DOM，探針用）
 *   stats()                     { desync, balFix, rounds }（演出終點與核心對不上的次數；應恆為 0）
  isFirstRun()／setTapGuard(fn)  （C03）第一次進場中；自動下注中擋手點（fn('cell'|'denom')→true＝擋掉）。play 的 plan 只在 ?dev／?shot 才認
 *   掛點（留給 C03）：#logBtn（LogUI.mount 的 openBtn）、#autoBtn／#abar（Autobet.mount 的 entryBtn／slot）、#director、
 *     DEMO.ui.on('roundEnd')（組紀錄用 result／record）、DEMO.ui.play（自動下注 adapter）、DEMO.ui.isBusy
 *
 * 依賴：values.js、env.js、strings.js、toast.js、core.js、art.js、fx.js。載入完成後設 window.__demoReady = true。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, G = ART.G, E = FX.E;
var $ = function(id){ return document.getElementById(id); };
var shot = D.q.shot;
var game = DemoCore.createGame({ storage: shot ? false : undefined });
D.game = game;

var NN = EV.N, COLS = EV.CFG.COLS, CAP = EV.CFG.CAP, DIRS = EV.DIRS;

/* ---------- 節拍（普通速度，毫秒） ---------- */
var DROP = 150, PRESS = 130, FLY = 245, WGAP = 25, STEP = PRESS + FLY + WGAP;   // 每波 0.4 秒（2026-11-26 用戶「幫我設定0.4」）
var EXHOLD = 110, EXSTAG = 45, SPRING = 300;
var SKY_GAP = 380, SKY_IN = 150, SKY_HOLD = 500, SKY_DROP = 300;
var PAYDUR = 380, PAYMAX = 700;
var TIER_DELAY = { none: 120, back: 450, big: 650, huge: 800 };
var TIER_DUR = { none: 0, back: 400, big: 1000, huge: 1600 };
var HI = 1 / 0.6;                                         // 高速＝普通的 0.6 倍時間

/* ---------- 版位（世界座標 375×812；盤面幾何在 art.js） ---------- */
var TR = { x: 12, y: 560, w: 351, h: 80 }, TRY = 600;     // 收集槽、槽裡幣的中心高度
var SLOT0 = 32, SLOTW = 22, TRAYS = 0.44;                 // 槽裡第一枚的 x、間距、縮放
var WAL = { x: 34, y: 22 };                               // 錢包圖示

/* ---------- 狀態 ---------- */
var disp = game.getBoard();                               // 畫面上的盤面（演出逐步更新；結束時和核心對帳）
var shownBal = game.getWallet();
var busy = false, payoutPhase = false, cur = null, pend = null, pendingDrops = 0;
var hiSpeed = shot ? false : D.ls('speed') === 'fast';
var firstSeen = !!D.ls('first');
var subs = {};
var STATS = { desync: 0, balFix: 0, rounds: 0 };
var cols = [], hv = [], bv = [], dv = [], gv = [], fv = [], thumbs = [], tabEls = [];
var gemSig = '', elWorld, elFx, elStage;

function noop(){}
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function n2(v){ return Math.round(v * 100) / 100; }
function on(evt, fn){ (subs[evt] = subs[evt] || []).push(fn); return function(){ off(evt, fn); }; }
function off(evt, fn){ var a = subs[evt], i; if(!a) return; i = a.indexOf(fn); if(i >= 0) a.splice(i, 1); }
function emit(evt, data){
  var a = subs[evt], i; if(!a) return; a = a.slice();
  for(i = 0; i < a.length; i++){ try{ a[i](data); }catch(e){ if(window.console) console.error('[DEMO.ui.on ' + evt + ']', e); } }
}
function baseSpeed(){ return hiSpeed ? HI : 1; }

/* =========================================================================
 * 建畫面
 * ========================================================================= */
function cellPoly(r, c, inset){
  var p = G.cellPts(r, c), i = inset || 0;
  return n2(p.xtl + i) + ',' + n2(p.yt + i) + ' ' + n2(p.xtr - i) + ',' + n2(p.yt + i) + ' ' + n2(p.xbr - i) + ',' + n2(p.yb - i) + ' ' + n2(p.xbl + i) + ',' + n2(p.yb - i);
}

function buildStyles(){
  var st = document.createElement('style');
  st.textContent = ART.css();
  document.head.appendChild(st);
}

function buildScene(){
  var s = ART.boardSVG(), r, c, i, d, p;
  s += '<defs>'
    + '<linearGradient id="hf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4a12"/><stop offset="1" stop-color="#3a2509"/></linearGradient>'
    + '<linearGradient id="bmg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8fc0" stop-opacity="0"/><stop offset=".25" stop-color="#ff8fc0" stop-opacity=".55"/><stop offset="1" stop-color="#ff6fae" stop-opacity=".28"/></linearGradient>'
    + '<linearGradient id="brg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#e89a1a"/></linearGradient>'
    + '</defs>';
  for(i = 0; i < NN; i++){                                // 格子狀態層（疊在底圖上、幣柱下）
    r = (i / COLS) | 0; c = i % COLS; p = cellPoly(r, c, 1.2);
    s += '<polygon class="hv" id="hv' + i + '" points="' + p + '" fill="url(#hf)" stroke="#ffb020" stroke-width="2.2" stroke-linejoin="round"/>';
    s += '<polygon class="bv" id="bv' + i + '" points="' + p + '" fill="#5a2416" stroke="#ff7a3c" stroke-width="2.4" stroke-linejoin="round"/>';
  }
  for(i = 0; i < NN; i++){                                // 相鄰兩格都快滿：中間連起來（右、下各一段）
    r = (i / COLS) | 0; c = i % COLS; d = G.dims(r, c);
    if(c < COLS - 1) s += '<rect class="brg" id="bh' + i + '" x="' + n2(G.CX + (c - 1.5) * G.CWd * d.f - 8) + '" y="' + n2(d.yb - 22) + '" width="16" height="9" rx="4" fill="url(#brg)" stroke="#8a5206" stroke-width="1"/>';
    if(r < COLS - 1) s += '<rect class="brg" id="bd' + i + '" x="' + n2(d.x - 9) + '" y="' + n2(d.yb - 6) + '" width="18" height="12" rx="5" fill="url(#brg)" stroke="#8a5206" stroke-width="1"/>';
  }
  s += '<polygon id="beam" points="0,0 0,0 0,0 0,0" fill="url(#bmg)"/>';
  $('scene').innerHTML = s;
  var ov = '';                                            // 寶物所在格的外框、第一次進場的發光框、暗化（疊在幣柱上、點擊層下）
  for(i = 0; i < NN; i++){
    r = (i / COLS) | 0; c = i % COLS; p = cellPoly(r, c, 1.4);
    ov += '<polygon class="dv" id="dv' + i + '" points="' + p + '" fill="#030610" opacity="0"/>';
    ov += '<polygon class="gv" id="gv' + i + '" points="' + p + '" fill="none" stroke="#7fe3ff" stroke-width="2.4" stroke-linejoin="round"/>';
    ov += '<polygon class="gv" id="fv' + i + '" points="' + p + '" fill="rgba(255,210,74,.14)" stroke="#ffd24a" stroke-width="3.2" stroke-linejoin="round"/>';
  }
  ov += '<g class="arr" id="arrows"></g>';
  $('over').innerHTML = ov;
  var ht = '';
  for(i = 0; i < NN; i++){ r = (i / COLS) | 0; c = i % COLS; ht += '<polygon data-i="' + i + '" points="' + cellPoly(r, c, 0) + '"/>'; }
  $('hit').innerHTML = ht;
  for(i = 0; i < NN; i++){ hv[i] = $('hv' + i); bv[i] = $('bv' + i); dv[i] = $('dv' + i); gv[i] = $('gv' + i); fv[i] = $('fv' + i); }
}

function buildCols(){
  var h = '', i, r, c, d, L;
  var box = $('cols');
  for(i = 0; i < NN; i++){
    r = (i / COLS) | 0; c = i % COLS; d = G.dims(r, c);
    var el = document.createElement('div');
    el.className = 'col';
    el.style.transform = 'translate(' + n2(d.x - 28) + 'px,' + n2(d.cy0 + 24.5 * d.s - 96) + 'px) scale(' + n2(d.s) + ')';
    el.innerHTML = '<div class="cb"><i class="sh"></i><i class="gl"></i><i class="k k0"></i><i class="k k1"></i><i class="k k2"></i><i class="k k3"></i><i class="gm"></i><i class="gm"></i></div>';
    box.appendChild(el);
    var cb = el.firstChild, kids = cb.children;
    cols[i] = { el: el, cb: cb, gl: kids[1], k: [kids[2], kids[3], kids[4], kids[5]], gm: [kids[6], kids[7]], key: '', tok: 0, d: d, r: r, c: c };
  }
}

function buildTray(){                                     // 收集槽：溝、十個幣座、分隔線、外框（金色外框是疊在上面的兩層）
  var s = '<svg viewBox="0 0 351 80" xmlns="http://www.w3.org/2000/svg" style="overflow:visible"><defs>'
    + '<linearGradient id="tb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03060f"/><stop offset=".55" stop-color="#080e22"/><stop offset="1" stop-color="#0e1734"/></linearGradient>'
    + '<linearGradient id="ts" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
    + '<linearGradient id="tl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5c9a"/><stop offset="1" stop-color="#1c2650"/></linearGradient>'
    + '<linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#ffd24a"/><stop offset="1" stop-color="#b8821c"/></linearGradient>'
    + '<radialGradient id="tp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#02040c" stop-opacity=".9"/><stop offset="1" stop-color="#02040c" stop-opacity="0"/></radialGradient></defs>'
    + '<rect x="1" y="1" width="349" height="78" rx="22" fill="url(#tb)" stroke="url(#tl)" stroke-width="2"/>'
    + '<rect x="3" y="3" width="345" height="30" rx="20" fill="url(#ts)"/>'
    + '<path d="M20 77.2h311" stroke="#fff" stroke-opacity=".1" stroke-width="1.2" stroke-linecap="round"/>';
  var i;
  for(i = 0; i < 10; i++) s += '<ellipse cx="' + (SLOT0 - TR.x + i * SLOTW) + '" cy="' + (TRY - TR.y + 5) + '" rx="12" ry="6.6" fill="url(#tp)"/>';
  s += '<path d="M234 14v52" stroke="#2b3a68" stroke-width="1.5"/><path d="M235.5 14v52" stroke="#fff" stroke-opacity=".06" stroke-width="1"/>'
    + '<rect id="trayGold2" x="-5" y="-5" width="361" height="90" rx="27" fill="none" stroke="#ffd24a" stroke-width="3"/>'
    + '<rect id="trayGold" x="1" y="1" width="349" height="78" rx="22" fill="none" stroke="url(#tg)" stroke-width="3.2"/></svg>';
  $('tray').innerHTML = s;
}

function buildHud(){
  var h = '', di;
  for(di = 0; di < EV.CFG.DENOMS.length; di++){
    h += '<button class="tab" type="button" data-di="' + di + '"><div class="th">';
    for(var i = 0; i < NN; i++) h += '<i></i>';
    h += '</div><div class="lb"><i class="ico cn" style="width:16px;height:11px"></i><b>' + D.fmt(EV.CFG.DENOMS[di]) + '</b></div></button>';
  }
  $('tabs').innerHTML = h;
  var tabs = $('tabs').children;
  for(di = 0; di < tabs.length; di++){
    tabEls[di] = tabs[di];
    thumbs[di] = tabs[di].firstChild.children;
    fitText(tabs[di].querySelector('b'), 70, 17, 11);
  }
  $('legend').innerHTML = '<div class="chip"><i class="ico cn"></i><b></b></div><div class="chip"><i class="ico gd"></i><b></b></div><div class="chip"><i class="ico gk"></i><b></b></div>';
}

/* 字太長就縮：多語／大數字不破版 */
function fitText(el, maxW, start, min){
  var sz = start;
  el.style.fontSize = sz + 'px';
  while(el.offsetWidth > maxW && sz > min){ sz -= 1; el.style.fontSize = sz + 'px'; }
}

/* =========================================================================
 * 幣柱與格子狀態
 * ========================================================================= */
function renderCol(i){
  var h = disp.h[i], g = disp.g[i], L = cols[i], key = h + '|' + g.join(','), k, nc, hot, q, el, surf, gh;
  if(L.key === key) return;
  L.key = key;
  nc = clamp(h - g.length, 0, 4); hot = h >= CAP - 1;
  for(k = 0; k < 4; k++){
    el = L.k[k];
    if(k < nc){ el.style.visibility = 'visible'; el.className = 'k k' + k + (hot ? ' ch' : ' cn'); }
    else el.style.visibility = 'hidden';
  }
  L.gl.style.opacity = h >= CAP ? 1 : (h === CAP - 1 ? 0.72 : 0);
  surf = nc >= 1 ? 58 - 11 * (nc - 1) + 13.5 : 71.5 + 6;       // 幣柱最上面那枚的幣面中心（柱內座標）
  for(q = 0; q < 2; q++){
    el = L.gm[q];
    if(q < g.length){
      var crown = g[q] === 'crown';
      gh = crown ? 32 : 35;
      el.style.visibility = 'visible';
      el.className = 'gm ' + (crown ? 'gk' : 'gd');
      el.style.top = n2(surf + (crown ? 4 : 2) - gh - q * 5) + 'px';
      el.style.left = (g.length > 1 ? (q ? 21 : 3) : (crown ? 10 : 13)) + 'px';
    }else el.style.visibility = 'hidden';
  }
  L.el.setAttribute('data-h', h); L.el.setAttribute('data-g', g.join(','));
  if(thumbs[game.getDenomIndex()]) thumbs[game.getDenomIndex()][i].className = thumbCls(h, g);
}
function thumbCls(h, g){ return g.length ? 'g' : 'c' + Math.min(3, h); }
function renderAll(){ for(var i = 0; i < NN; i++){ cols[i].key = ''; renderCol(i); } flushOv(); }

/* 快滿的格子（疊 3 枚）：金色底；相鄰兩格都快滿：中間連起來；寶物所在格：青框＋箭頭指它下次往哪走 */
function flushOv(){
  var i, r, c, hot = [], sig = '';
  var fm = firstOn();
  for(i = 0; i < NN; i++) hot[i] = !fm && disp.h[i] >= CAP - 1;
  for(i = 0; i < NN; i++){
    r = (i / COLS) | 0; c = i % COLS;
    hv[i].setAttribute('class', 'hv' + (hot[i] ? ' on' : ''));
    var bh = $('bh' + i), bd = $('bd' + i);
    if(bh) bh.setAttribute('class', 'brg' + (hot[i] && hot[i + 1] ? ' on' : ''));
    if(bd) bd.setAttribute('class', 'brg' + (hot[i] && hot[i + COLS] ? ' on' : ''));
    gv[i].setAttribute('class', 'gv' + (disp.g[i].length ? ' on' : ''));
    if(disp.g[i].length) sig += i + ':' + disp.g[i].join('') + ';';
  }
  if(sig !== gemSig){ gemSig = sig; drawArrows(); }
}

function drawArrows(){
  var s = '', i, q, r, c, d, dir, dist, edge, gem, col, nc, yg, x1, y1, x2, y2, x, ah = 9;
  for(i = 0; i < NN; i++){
    var g = disp.g[i];
    for(q = 0; q < Math.min(2, g.length); q++){
      r = (i / COLS) | 0; c = i % COLS; d = G.dims(r, c);
      dir = DIRS[i][q]; dist = [c + 1, COLS - c, r + 1, COLS - r][dir]; edge = dist === 1;
      gem = g[q]; col = gem === 'crown' ? '#ffd24a' : '#7fe3ff';
      nc = clamp(disp.h[i] - g.length, 0, 4);
      yg = d.cy0 - 11 * d.s * Math.max(0, nc - 1) - 14 * d.s;
      x = d.x + (g.length > 1 ? (q ? 8 : -8) : 0);
      var cls = edge ? ' class="edge"' : '', sw = edge ? 4 : 3, kk = edge ? 1.35 : 1, hw = 9 * kk, hl = 13 * kk;
      if(dir < 2){
        var sgn = dir === 0 ? -1 : 1;
        x1 = x + sgn * 20 * d.s; x2 = dir === 0 ? G.xL(yg, 8) : G.xR(yg, 8); y1 = yg + q * 6;
        s += '<g' + cls + '><line x1="' + n2(x1) + '" y1="' + n2(y1) + '" x2="' + n2(x2 - sgn * hl * 0.7) + '" y2="' + n2(y1) + '" stroke="' + col + '" stroke-width="' + sw + '" stroke-dasharray="7 6" stroke-linecap="round" opacity=".92"/>'
          + '<polygon points="' + n2(x2) + ',' + n2(y1) + ' ' + n2(x2 - sgn * hl) + ',' + n2(y1 - hw) + ' ' + n2(x2 - sgn * hl) + ',' + n2(y1 + hw) + '" fill="' + col + '" stroke="#06384f" stroke-width="1.4" stroke-linejoin="round"/></g>';
      }else{
        var sgv = dir === 2 ? -1 : 1;
        y1 = yg + sgv * 18; y2 = dir === 2 ? G.TOP - 6 : G.BOT + 6;
        s += '<g' + cls + '><line x1="' + n2(x) + '" y1="' + n2(y1) + '" x2="' + n2(x) + '" y2="' + n2(y2 - sgv * hl * 0.7) + '" stroke="' + col + '" stroke-width="' + sw + '" stroke-dasharray="7 6" stroke-linecap="round" opacity=".92"/>'
          + '<polygon points="' + n2(x) + ',' + n2(y2) + ' ' + n2(x - hw) + ',' + n2(y2 - sgv * hl) + ' ' + n2(x + hw) + ',' + n2(y2 - sgv * hl) + '" fill="' + col + '" stroke="#06384f" stroke-width="1.4" stroke-linejoin="round"/></g>';
      }
    }
  }
  $('arrows').innerHTML = s;
}

/* 柱的動畫通道：同一格新動畫蓋掉舊的（避免兩條補間搶 transform） */
function cbAnim(i, t0, dur, fn, done){
  var L = cols[i], tok = ++L.tok;
  FX.tw(t0, dur, function(p){ if(L.tok === tok) fn(p, L.cb.style); }, function(){ if(L.tok === tok && done) done(); });
}
function sq(st, sy){ st.transform = 'scale(' + n2(1 - (sy - 1) * 0.55) + ',' + n2(sy) + ')'; }
function pressAnim(i, t0){                                // 壓：柱子往下壓扁、發亮
  var L = cols[i];
  cbAnim(i, t0, PRESS, function(p, st){ var e = E.in(p); sq(st, 1 - 0.22 * e); L.gl.style.opacity = 1; bv[i].style.opacity = n2(0.85 * e); });
}
function springAnim(i, t0, A){                            // 彈：從壓扁的樣子衝過頭再回來
  cbAnim(i, t0, SPRING, function(p, st){
    var s;
    if(p < 0.3) s = lerp(0.78, 1 + A, E.out(p / 0.3));
    else{ var q = (p - 0.3) / 0.7; s = 1 + A * Math.cos(q * Math.PI * 1.5) * Math.pow(1 - q, 1.5); }
    sq(st, s);
  }, function(){ cols[i].cb.style.transform = ''; });
}
function bounceAnim(i, t0, A){                            // 落：幣落到這一疊上，這一疊跟著彈一下
  cbAnim(i, t0, 230, function(p, st){
    var s = 1 - A * Math.sin(p * Math.PI) * (1 - 0.35 * p);
    sq(st, s);
  }, function(){ cols[i].cb.style.transform = ''; });
}
function boomFlash(i, t0){
  FX.tw(t0, 320, function(p){ bv[i].style.opacity = n2(0.9 * (1 - E.out(p))); }, function(){ bv[i].style.opacity = ''; });
}

/* =========================================================================
 * 演出層小零件（元件池）
 * ========================================================================= */
var pool = {};
function getEl(cls, txt){
  var a = pool[cls], el = a && a.pop();
  if(!el){ el = document.createElement('div'); el.className = cls; el._cls = cls; elFx.appendChild(el); }
  el.style.display = ''; el.style.opacity = '1';
  if(txt != null) el.textContent = txt;
  return el;
}
function putEl(el){ el.style.display = 'none'; (pool[el._cls] = pool[el._cls] || []).push(el); }
function place(el, x, y, s, rot, op){
  el.style.transform = 'translate3d(' + n2(x) + 'px,' + n2(y) + 'px,0)' + (rot ? ' rotate(' + n2(rot) + 'deg)' : '') + ' scale(' + n2(s) + ')';
  if(op != null) el.style.opacity = n2(op);
}
function flightEl(kind, hot){                              // 一枚飛行中的東西（金幣／鑽石／皇冠）
  return getEl(kind === 'diamond' ? 'fg gd' : kind === 'crown' ? 'fk gk' : 'fc ' + (hot === 's' ? 'cs' : hot === false ? 'cn' : 'ch'));
}
function kscale(kind, m){ return kind === 'coin' ? 1 : lerp(0.78, 1.2, m || 0); }   // 鑽石、皇冠在盤上小一點、在槽裡放大到和幣一樣醒目

function ring(x, y, s, t0){
  var el = getEl('rg'); el.style.opacity = '0';
  FX.tw(t0, 430, function(p){ var e = E.out(p); place(el, x, y, s * lerp(0.35, 1.5, e), 0, 0.85 * (1 - p)); }, function(){ putEl(el); });
}
function glowBurst(x, y, s, t0){
  var el = getEl('bm'); el.style.opacity = '0';
  FX.tw(t0, 300, function(p){ place(el, x, y, s * lerp(0.4, 1.25, E.out(p)), 0, p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8); }, function(){ putEl(el); });
}
function sparkAt(x, y, t0, ang, dist, sz, gold){
  var el = getEl('sp ' + (gold ? 'spg' : 'spk')); el.style.opacity = '0';
  var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.8;
  FX.tw(t0, 380, function(p){ var e = E.out(p); place(el, x + dx * e, y + dy * e, sz * (1 - 0.5 * p), p * 90, p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85); }, function(){ putEl(el); });
}
function popText(x, y, txt, t0){
  var el = getEl('pp', txt); el.style.opacity = '0';
  FX.tw(t0, 650, function(p){ place(el, x, y - 30 * E.out(p), lerp(0.8, 1.1, E.out(Math.min(1, p * 4))), 0, p < 0.12 ? p / 0.12 : 1 - Math.max(0, (p - 0.45) / 0.55)); }, function(){ putEl(el); });
}
function shake(amp, t0, dur){                              // 盤面跟著震（波次越後面越大）
  var st = elStage.style, ph = amp * 3.7;
  FX.tw(t0, dur || 240, function(p){ var a = amp * (1 - p), w = p * 26; st.transform = 'translate3d(' + n2(Math.sin(w) * a) + 'px,' + n2(Math.cos(w * 1.3) * a * 0.7) + 'px,0)'; }, function(){ st.transform = ''; });
}
function bump(el, t0, A, dur){
  var tok = (el._tok = (el._tok || 0) + 1);
  FX.tw(t0, dur || 150, function(p){ if(el._tok === tok) el.style.transform = 'scale(' + n2(1 + A * Math.sin(p * Math.PI)) + ')'; }, function(){ if(el._tok === tok) el.style.transform = ''; });
}

/* =========================================================================
 * HUD：餘額、金額、分頁縮圖、面額表
 * ========================================================================= */
function setBal(v){
  shownBal = v;
  var el = $('wal'); el.textContent = D.fmt(v);
  fitText(el, 190, 20, 12);
}
function setAmt(v, tier){
  var el = $('amtN'); el.textContent = D.fmt(v);
  $('amt').className = v === 0 ? 'dim hud' : (tier && tier !== 'none' ? 'gold hud' : 'hud');
  fitText(el, 100, 32, 12);
}
function updTabs(){
  var di, cur = game.getDenomIndex(), b, i;
  for(di = 0; di < tabEls.length; di++){
    tabEls[di].className = 'tab' + (di === cur ? ' on' : '');
    b = di === cur ? disp : game.getBoard(di);
    for(i = 0; i < NN; i++) thumbs[di][i].className = thumbCls(b.h[i], b.g[i]);
  }
}
function updLegend(){
  var p = EV.PAY[game.getDenomIndex()], bs = $('legend').querySelectorAll('b');
  bs[0].textContent = D.fmt(p.coin); bs[1].textContent = D.fmt(p.diamond); bs[2].textContent = D.fmt(p.crown);
  for(var i = 0; i < 3; i++) fitText(bs[i], 62, 17, 11);
}
function hideBanner(){ var b = $('banner'); b.style.opacity = '0'; }
function showBanner(txt, t0, big){
  var b = $('banner'); b.textContent = txt; fitText(b, 340, big ? 38 : 34, 18);
  FX.tw(t0, 320, function(p){ var e = E.back(p); b.style.opacity = n2(Math.min(1, p * 4)); b.style.transform = 'scale(' + n2(lerp(0.4, 1, e)) + ')'; });
}
function setTrayGold(a, b){ $('trayGold').style.opacity = n2(a); $('trayGold2').style.opacity = n2(b || 0); }

/* 第一次進場：整個畫面變暗，只有一格發光可點。不寫字。 */
function firstOn(){ return !firstSeen && game.isFresh(); }
function updateFirst(){
  var on = firstOn(), gc = on ? game.glowCell() : -1, i;
  elWorld.classList.toggle('first', on);
  for(i = 0; i < NN; i++){
    dv[i].setAttribute('class', 'dv' + (on && i !== gc ? ' on' : ''));
    fv[i].setAttribute('class', 'gv' + (on && i === gc ? ' on' : ''));
    cols[i].el.className = 'col' + (on && i !== gc ? ' dimc' : '') + (on && i === gc ? ' breathe' : '');
  }
}

/* =========================================================================
 * 一注的演出：把整條時間軸一次排好（虛擬時間），再由 FX 推
 * ========================================================================= */
function slotX(idx){ return SLOT0 + idx * cur.step; }

function schedDrop(cell, kind, T0){                        // 丟入：幣從上方落到那一格
  var d = cols[cell].d, S = cur.S, nc = clamp(S.h[cell] - S.g[cell].length, 0, 3);
  var y1 = kind === 'coin' ? d.cy0 - 11 * d.s * nc : d.cy0 - 11 * d.s * Math.max(0, nc - 1) - 14 * d.s;
  S.h[cell]++; if(kind !== 'coin') S.g[cell].push(kind);
  pendingDrops++;
  FX.at(T0, function(){
    var f = flightEl(kind, false), sc = kscale(kind);
    FX.tw(T0, DROP, function(p){ var e = E.in(p); place(f, d.x, lerp(y1 - 78, y1, e), d.s * sc * lerp(1.25, 1, e), 0, Math.min(1, 0.25 + p * 1.5)); }, function(){ putEl(f); });
  });
  FX.at(T0 + DROP, function(){
    pendingDrops--;
    disp.h[cell]++; if(kind !== 'coin') disp.g[cell].push(kind);
    renderCol(cell); flushOv(); bounceAnim(cell, T0 + DROP, 0.1);
    glowBurst(d.x, d.cy0 - 4, d.s * 0.5, T0 + DROP);
    if(!busy) verifyBoard();
  });
  return T0 + DROP;
}

function exitPoint(cell, dir){
  var d = cols[cell].d;
  if(dir === 0) return { x: G.xL(d.yc, 10) + 11, y: d.cy0 - 4 };
  if(dir === 1) return { x: G.xR(d.yc, 10) - 11, y: d.cy0 - 4 };
  if(dir === 2) return { x: d.x, y: G.TOP - 14 };
  return { x: d.x, y: G.BOT + 15 };
}

function schedPart(part, src, T0){
  var k, ws = T0 + WGAP, lastLand = T0;
  for(k = 0; k < part.waves.length; k++){
    schedWave(part.waves[k], k, ws, src);
    lastLand = ws + PRESS + FLY;
    ws = lastLand + WGAP;
  }
  return lastLand;
}

function schedWave(w, k, ws, src){
  var S = cur.S, cells = w.cells, bt = ws + PRESS, lt = bt + FLY, kk = Math.min(k, 6), a, m, j;
  cur.wavesT.push(ws);
  var starts = [];                                        // 這一波每格噴之前的疊高（飛行起點用）
  for(a = 0; a < cells.length; a++) starts[a] = Math.min(S.h[cells[a]], CAP + 1);
  var moves = w.moves, mvs = [];
  /* 先把核心的「噴出」套到排程用的盤面：全部先扣、再發（同一波同時發生） */
  for(a = 0; a < cells.length; a++){
    var c = cells[a], gemsOut = 0;
    for(m = 0; m < moves.length; m++) if(moves[m].from === c && moves[m].kind !== 'coin') gemsOut++;
    S.h[c] -= CAP; S.g[c].splice(0, gemsOut);
  }
  var exitJ = 0;
  for(m = 0; m < moves.length; m++){
    var mv = moves[m], d0 = cols[mv.from].d, ai = cells.indexOf(mv.from), sp = starts[ai];
    var x0 = d0.x, y0 = d0.cy0 - 11 * d0.s * (Math.min(sp, CAP) - 1) - 8 * d0.s, p1, s1, dur, isExit = mv.to < 0, j2 = isExit ? exitJ++ : 0, slot = 0, d1;
    if(isExit){ p1 = exitPoint(mv.from, mv.dir); s1 = 0.72; dur = FLY + j2 * EXSTAG; }
    else{
      d1 = cols[mv.to].d; slot = clamp(S.h[mv.to] - S.g[mv.to].length, 0, 3);
      p1 = { x: d1.x, y: d1.cy0 - 11 * d1.s * slot - (mv.kind === 'coin' ? 0 : 10 * d1.s) }; s1 = d1.s; dur = FLY;
      S.h[mv.to]++; if(mv.kind !== 'coin') S.g[mv.to].push(mv.kind);
    }
    var oo = { mv: mv, x0: x0, y0: y0, s0: d0.s, p1: p1, s1: s1, dur: dur, isExit: isExit, j: j2, item: isExit ? cur.itemIdx++ : -1, gd: 0 };
    if(isExit){                                            // 滑進槽的時間在排程時就算好（分級與落袋要等最後一枚到槽）
      var sxx = slotX(oo.item), dd2 = Math.sqrt(Math.pow(sxx - p1.x, 2) + Math.pow(TRY - p1.y, 2));
      oo.gd = clamp(240 + dd2 * 0.5, 300, 520);
      cur.lastArr = Math.max(cur.lastArr, bt + dur + EXHOLD + oo.gd + 160);
    }
    mvs.push(oo);
  }
  /* 壓：這一波的每一格往下壓扁、發亮 */
  FX.at(ws, function(){ for(var q = 0; q < cells.length; q++) pressAnim(cells[q], ws); });
  /* 彈＋飛：壓到底、四枚幣帶弧線飛出、柱子彈開、震波、盤面震 */
  FX.at(bt, function(){
    var q, f, g2;
    for(q = 0; q < cells.length; q++){
      var cc = cells[q], L = cols[cc], dd = L.d, gemsOut = 0, mi;
      for(mi = 0; mi < moves.length; mi++) if(moves[mi].from === cc && moves[mi].kind !== 'coin') gemsOut++;
      disp.h[cc] -= CAP; disp.g[cc].splice(0, gemsOut);
      renderCol(cc);
      springAnim(cc, bt, 0.08 + 0.025 * kk);
      boomFlash(cc, bt);
      ring(dd.x, dd.cy0 - 6, dd.s * (1 + 0.1 * kk), bt);
      glowBurst(dd.x, dd.cy0 - 14, dd.s * (1 + 0.06 * kk), bt);
      for(mi = 0; mi < 3; mi++) sparkAt(dd.x, dd.cy0 - 14, bt, (q * 1.3 + mi * 2.1 + k) % 6.28, 26 + 6 * kk, 0.7 + 0.08 * kk, mi === 1);
    }
    flushOv();
    shake(Math.min(1.4 + 0.85 * k, 6.2) * (1 + 0.06 * cells.length), bt, 260);
    for(q = 0; q < mvs.length; q++) flyOne(mvs[q], bt, k);
  });
  /* 落：幣落到鄰格、那一疊跟著彈；排程用盤面已先更新，這裡更新畫面 */
  FX.at(lt, function(){
    var q, touched = {};
    for(q = 0; q < mvs.length; q++){
      var o = mvs[q], to = o.mv.to;
      if(o.isExit) continue;
      disp.h[to]++; if(o.mv.kind !== 'coin') disp.g[to].push(o.mv.kind);
      touched[to] = (touched[to] || 0) + 1;
      putEl(o.f);
    }
    for(var t in touched){ renderCol(+t); bounceAnim(+t, lt, Math.min(0.1 + 0.02 * kk, 0.17)); }
    flushOv();
    emit('wave', { src: src, wave: k, cells: cells.slice(), dom: domCounts() });
  });
}

function flyOne(o, bt, k){                                 // 一枚飛出：弧線、放大一下再落
  var mv = o.mv, hot = mv.kind === 'coin' ? true : null, f = flightEl(mv.kind, true), sc = kscale(mv.kind);
  o.f = f;
  var dx = o.p1.x - o.x0, dy = o.p1.y - o.y0, dist = Math.sqrt(dx * dx + dy * dy), H = clamp(20 + dist * 0.15, 24, 46);
  var spin = [-26, 26, 16, -16][mv.dir];
  FX.tw(bt, o.dur, function(p){
    var pe = E.out(p) * 0.4 + p * 0.6, y = lerp(o.y0, o.p1.y, pe) - 4 * H * p * (1 - p);
    place(f, lerp(o.x0, o.p1.x, pe), y, sc * lerp(o.s0, o.s1, p) * (1 + 0.2 * Math.sin(p * Math.PI)), spin * p, 1);
  }, function(){ if(o.isExit) schedExit(o, bt + o.dur, k); });
}

/* —— 噴出盤面的幣：離開當下金額加一次 → 停在噴出的那一邊 → 滑進收集槽排成一列（收集槽區塊：要拿掉就改這裡）—— */
function schedExit(o, A, k){
  var f = o.f, idx = o.item, item = cur.res.items[idx], mv = o.mv, sc = kscale(mv.kind);
  cur.amt += item.amount; cur.exited++;
  setAmt(cur.amt, null); bump($('amt'), A, 0.2, 150);
  popText(312 - (idx % 3) * 24, TR.y - 4, '+' + D.fmt(item.amount), A);
  sparkAt(o.p1.x, o.p1.y, A, 3.9 + mv.dir, 12, 0.8, true);
  cur.tray[idx] = { el: f, kind: mv.kind, amount: item.amount, x: slotX(idx), y: TRY };
  emit('exit', { amount: item.amount, total: cur.amt, index: idx });
  FX.tw(A, EXHOLD, function(p){ place(f, o.p1.x, o.p1.y, sc * o.s1 * (1 + 0.16 * Math.sin(p * Math.PI)), [-26, 26, 16, -16][mv.dir], 1); });
  var gt = A + EXHOLD, sx = slotX(idx), gd = o.gd;
  FX.tw(gt, gd, function(p){
    var e = E.io(p), pa = E.out(p);
    place(f, lerp(o.p1.x, sx, e), lerp(o.p1.y, TRY, e) - 18 * Math.sin(p * Math.PI), kscale(mv.kind, e) * lerp(o.s1, cur.trayS, e) * (1 + 0.12 * Math.sin(p * Math.PI)), lerp([-26, 26, 16, -16][mv.dir], 0, pa), 1);
  }, function(){
    var st = kscale(mv.kind, 1) * cur.trayS;
    place(f, sx, TRY, st, 0, 1);
    FX.tw(gt + gd, 140, function(p){ place(f, sx, TRY - 3 * Math.sin(p * Math.PI), st * (1 + 0.2 * Math.sin(p * Math.PI)), 0, 1); }, function(){ place(f, sx, TRY, st, 0, 1); });
  });
}

/* —— 天降：先停在盤面上方（和玩家丟的不同：玫紅幣、光柱、從天上來）、再掉下去 —— */
function schedSky(sky, T0){
  var cell = sky.cell, L = cols[cell], d = L.d, c = L.c, S = cur.S;
  var sx = G.CX + (c - 2) * G.CWd * G.fy(166), nc = clamp(S.h[cell] - S.g[cell].length, 0, 3);
  var yEnd = d.cy0 - 11 * d.s * nc, tag = $('skyTag'), beam = $('beam');
  S.h[cell]++;
  cur.skyCell = cell;
  var bp = [G.CX + (c - 2.5) * G.CWd * G.fy(146), 146, G.CX + (c - 1.5) * G.CWd * G.fy(146), 146, G.CX + (c - 1.5) * G.CWd * G.fy(G.BOT), G.BOT, G.CX + (c - 2.5) * G.CWd * G.fy(G.BOT), G.BOT];
  var f;
  pendingDrops++;
  FX.at(T0, function(){
    f = flightEl('coin', 's');
    beam.setAttribute('points', n2(bp[0]) + ',' + bp[1] + ' ' + n2(bp[2]) + ',' + bp[3] + ' ' + n2(bp[4]) + ',' + bp[5] + ' ' + n2(bp[6]) + ',' + bp[7]);
    tag.style.display = ''; tag.style.left = n2(sx > 230 ? sx - 34 - tag.offsetWidth : sx + 34) + 'px';
    FX.tw(T0, SKY_IN + SKY_HOLD, function(p){
      var tin = Math.min(1, p * (SKY_IN + SKY_HOLD) / SKY_IN), bob = Math.sin(p * Math.PI * 5) * 3;
      place(f, sx, 166 + bob, 0.95 * lerp(0.6, 1, E.out(tin)), 0, tin);
      beam.style.opacity = n2(tin); tag.style.opacity = n2(tin);
    });
  });
  var td = T0 + SKY_IN + SKY_HOLD;
  FX.at(td, function(){
    FX.tw(td, SKY_DROP, function(p){ var e = E.in(p); place(f, sx, lerp(166, yEnd, e), lerp(0.95, d.s, e), p * 120, 1); beam.style.opacity = n2(1 - 0.5 * p); });
  });
  FX.at(td + SKY_DROP, function(){
    pendingDrops--;
    putEl(f); beam.style.opacity = '0'; tag.style.opacity = '0'; tag.style.display = 'none';
    disp.h[cell]++; renderCol(cell); flushOv(); bounceAnim(cell, td + SKY_DROP, 0.12);
    glowBurst(d.x, d.cy0 - 6, d.s * 0.8, td + SKY_DROP); ring(d.x, d.cy0 - 4, d.s * 0.8, td + SKY_DROP);
  });
  return td + SKY_DROP;
}

/* —— 分級回饋（門檻＝鐵表，由核心的 result.tier 給）—— */
function tierFx(F0, tier){
  var res = cur.res, bigWord = res.exitCount >= 4;
  if(tier === 'none') return;
  FX.at(F0, function(){
    setAmt(cur.amt, tier);
    bump($('amt'), F0, tier === 'back' ? 0.25 : 0.4, 220);
    var i;
    if(tier === 'back'){
      FX.tw(F0, 400, function(p){ setTrayGold(p < 0.3 ? p / 0.3 : lerp(1, 0.55, (p - 0.3) / 0.7), 0); });
      for(i = 0; i < 3; i++) sparkAt(262 + i * 42, TRY - 22, F0 + i * 60, -1.2 - i * 0.4, 20, 0.9, i === 1);
    }else{
      var pulses = tier === 'huge' ? 4 : 3, dur = TIER_DUR[tier];
      FX.tw(F0, dur, function(p){
        var w = Math.abs(Math.sin(p * Math.PI * pulses));
        setTrayGold(0.5 + 0.5 * w, 0.2 + 0.8 * w * (1 - p * 0.4));
      }, function(){ setTrayGold(0.8, 0); });
      FX.tw(F0, 320, function(p){ $('flash').style.opacity = n2((tier === 'huge' ? 0.62 : 0.42) * (1 - E.out(p))); }, function(){ $('flash').style.opacity = '0'; });
      confetti(tier === 'huge' ? 28 : 16, F0);
      for(i = 0; i < 8; i++) sparkAt(20 + ((i * 47) % 335), TRY - 40 + (i % 3) * 20, F0 + i * 50, -1.6 + i * 0.4, 28, 1, i % 2 === 0);
      if(bigWord) showBanner(T(tier === 'huge' ? 'tier.huge' : 'tier.big'), F0, tier === 'huge');
      if(tier === 'huge'){
        FX.tw(F0, dur + 300, function(p){ $('halo').style.opacity = n2(Math.min(1, p * 5) * (1 - Math.max(0, (p - 0.7) / 0.3))); var r = $('rays'); r.style.opacity = n2(0.9 * Math.min(1, p * 4) * (1 - Math.max(0, (p - 0.6) / 0.4))); r.style.transform = 'rotate(' + n2(p * 24) + 'deg) scale(' + n2(0.7 + 0.5 * E.out(p)) + ')'; }, function(){ $('halo').style.opacity = '0'; $('rays').style.opacity = '0'; });
        FX.tw(F0 + 500, 320, function(p){ $('flash').style.opacity = n2(0.4 * (1 - E.out(p))); }, function(){ $('flash').style.opacity = '0'; });
      }
    }
  });
}
function confetti(n, t0){                                  // 灑幣：裝飾，不代表金額
  var i;
  for(i = 0; i < n; i++){
    (function(i){
      var el = getEl('cf ' + (i % 3 ? 'ch' : 'cn')), x0 = 18 + ((i * 97 + 31) % 340), sc = 0.34 + (i % 4) * 0.07, dur = 1350 + (i % 7) * 95, st = t0 + (i % 6) * 55, ph = i * 1.7, sp = 140 + (i % 5) * 60;
      el.style.opacity = '0';
      FX.tw(st, dur, function(p){ place(el, x0 + Math.sin(p * 7 + ph) * 16, lerp(-30, 840, E.in(p) * 0.6 + p * 0.4), sc, p * sp * (i % 2 ? 1 : -1), 1); }, function(){ putEl(el); });
    })(i);
  }
}

/* —— 落袋：收集槽裡的幣一枚一枚飛進錢包，到一枚餘額加一次 —— */
function deliver(it, t){                                  // 一枚到錢包：餘額加一次（idempotent：ack 前會把沒到的補齊）
  if(it.paid) return;
  it.paid = true; cur.paidAmt += it.amount;
  putEl(it.el);
  setBal(cur.balBase + cur.paidAmt);
  if(t != null){ bump($('bal'), t, 0.07, 150); sparkAt(WAL.x, WAL.y, t, -0.6, 14, 0.6, true); }
}
function schedPay(i, t0){
  FX.at(t0, function(){
    var it = cur.tray[i];
    if(!it) return;                                        // 時間軸一次跳太遠（探針加速、分頁卡頓）時這枚還沒進槽：交給 finishRound 補齊
    var f = it.el, sx = it.x, sy = it.y;
    FX.tw(t0, PAYDUR, function(p){
      if(it.paid) return;
      var e = E.in(p) * 0.55 + p * 0.45;
      place(f, lerp(sx, WAL.x, e), lerp(sy, WAL.y, e) - 70 * Math.sin(p * Math.PI) * (1 - p * 0.3), kscale(it.kind, 1 - p * 0.5) * lerp(cur.trayS, 0.4, p), p * 40, p > 0.85 ? (1 - p) / 0.15 : 1);
    }, function(){ deliver(it, t0 + PAYDUR); });
  });
}

/* —— 一注的總排程 —— */
function startRound(res, p){
  var o = (p && p.o) || {}, t0 = FX.now(), T0 = t0, i;
  cur = { res: res, o: o, p: p, S: { h: res.boardBefore.h.slice(), g: res.boardBefore.g.map(function(x){ return x.slice(); }) },
          itemIdx: 0, lastArr: t0, amt: 0, exited: 0, balBase: 0, paidAmt: 0, wavesT: [], tray: [], skyT: -1 };
  var N = res.items.length;
  cur.step = N > 10 ? 198 / (N - 1) : SLOTW;
  cur.trayS = N > 20 ? 0.38 : TRAYS;
  FX.setSpeed(baseSpeed() * (o.fast ? HI / baseSpeed() : 1) * (o.speed || 1));
  hideBanner(); $('flash').style.opacity = '0';
  setTrayGold(0, 0); setAmt(0, null); payoutPhase = false;
  STATS.rounds++;
  emit('roundStart', { result: res });
  T0 = schedDrop(res.cell, res.kind, T0);
  if(res.quiet){                                           // 沒爆也沒天降：立刻 ack，不鎖操作，可以連點
    var cq = cur;
    game.ack();
    cq.rec = game.getRecords(1)[0] || null;
    FX.at(T0 + 2, function(){ resolveRound(res, true, cq); });
    return;
  }
  busy = true;
  T0 = schedPart(res.main, 'main', T0);
  if(res.sky){ cur.skyT = T0 + SKY_GAP; T0 = schedSky(res.sky, cur.skyT); T0 = schedPart(res.sky, 'sky', T0); }
  var F0 = Math.max(T0, cur.lastArr) + 80, tier = res.tier, n = N;
  cur.F0 = F0;
  FX.at(F0, function(){
    payoutPhase = true; cur.balBase = shownBal; cur.paidAmt = 0;
    emit('chainEnd', { result: res, tray: cur.tray.length, amt: cur.amt });
  });
  tierFx(F0, tier);
  var P0 = F0 + TIER_DELAY[tier], gap = n ? clamp(PAYMAX / n, 30, 90) : 0;
  for(i = 0; i < n; i++) schedPay(i, P0 + i * gap);
  var payEnd = n ? P0 + (n - 1) * gap + PAYDUR : F0;
  var ackT = Math.max(payEnd, F0 + TIER_DUR[tier]) + 120;
  cur.ackT = ackT;
  FX.at(ackT, function(){ finishRound(); });
  if(o.freeze) applyFreeze(o.freeze, p);
}

function applyFreeze(fz, p){                               // 截圖用：停在時間軸的某一點
  var t;
  if(fz.wave != null) t = cur.wavesT[fz.wave] + (fz.frac || 0) * (PRESS + FLY);
  else if(fz.at === 'sky') t = cur.skyT + SKY_IN + (fz.add || 0);
  else if(fz.at === 'chainEnd') t = cur.F0 + (fz.add || 0);
  else t = cur.ackT;
  FX.freezeAt(t, function(){ if(p && p.res) p.res({ frozen: true, result: cur.res }); });
}

function finishRound(){
  var c = cur, res = c.res, q;
  for(q = 0; q < c.tray.length; q++) if(c.tray[q]) deliver(c.tray[q], null);   // 沒飛完的先補齊，餘額才不會被晚到的補間重複加
  payoutPhase = false;
  var before = shownBal;
  game.ack();                                              // 'wallet' 事件會把餘額對齊核心
  busy = false;
  if(before !== game.getWallet()) STATS.balFix++;
  verifyBoard();
  resolveRound(res, false);
}
function resolveRound(res, quiet, c0){
  var c = c0 || cur, rec = (c && c.rec) || game.getRecords(1)[0] || null;
  var out = { orderId: res.orderId, stake: res.stake, pay: res.payout, payout: res.payout, net: res.net, mult: res.mult,
              tier: res.tier, quiet: quiet, result: res, record: rec, wallet: game.getWallet() };
  emit('roundEnd', out);
  if(c && c.p && c.p.res) c.p.res(out);
}

/* 演出終點和核心對帳：不一致就以核心為準（並記一筆，探針要求恆為 0） */
function verifyBoard(){
  if(pendingDrops > 0 || busy) return;
  var b = game.getBoard(), i, bad = false;
  for(i = 0; i < NN; i++){
    if(b.h[i] !== disp.h[i] || b.g[i].join(',') !== disp.g[i].join(',')){ bad = true; break; }
  }
  if(bad){ STATS.desync++; disp = b; renderAll(); updTabs(); }
}

function domCounts(){
  var out = { h: [], g: [] }, i;
  for(i = 0; i < NN; i++){ out.h.push(+cols[i].el.getAttribute('data-h')); out.g.push(cols[i].el.getAttribute('data-g') || ''); }
  return out;
}

/* =========================================================================
 * 下注、換面額、速度
 * ========================================================================= */
function play(cell, o){
  o = o || {};
  return new Promise(function(res, rej){
    if(busy){ rej(new Error('busy')); return; }
    pend = { res: res, rej: rej, o: o };
    if(o.plan && (D.q.dev || shot)) game.armNext(o.plan);       // 指定結果只在 ?dev／?shot 才認（預設網址不留後門）
    if(!game.bet(cell)){ pend = null; rej(new Error((game.getLastError() || {}).code || 'bet')); }
  });
}
function onResult(d){
  var p = pend; pend = null;
  if(!firstSeen){ firstSeen = true; D.ls('first', 1); }
  updateFirst();
  startRound(d.result, p);
}
var tapGuard = null;                                       // wire.js 掛：自動下注中擋掉手點（回 true＝已處理，不往下走）
function onTap(i){
  if(tapGuard && tapGuard('cell')) return;
  if(busy) return;                                         // 演出中不收（不漏單、不重複扣款）
  if(firstOn() && i !== game.glowCell()) return;
  if(!game.canBet()){ if(game.getWallet() < game.getDenom()) Toast.show(T('rej.insufficient')); return; }
  play(i, {}).catch(noop);
}
$('hit').addEventListener('click', function(e){
  var t = e.target, i = t && t.getAttribute ? t.getAttribute('data-i') : null;
  if(i != null) onTap(+i);
});

function onDenom(){                                        // 換面額＝換一張盤面：整盤落下再升起
  disp = game.getBoard();
  renderAll(); updTabs(); updLegend(); updateFirst();
  var t0 = FX.now(), i;
  for(i = 0; i < NN; i++){
    (function(i){
      var L = cols[i], st = t0 + L.r * 45;
      L.el.style.opacity = '0';
      FX.tw(st, 260, function(p){ var e = E.out(p); L.el.style.opacity = n2(e); L.cb.style.transform = 'translateY(' + n2((1 - e) * 16) + 'px)'; }, function(){ L.el.style.opacity = ''; L.cb.style.transform = ''; });
    })(i);
  }
  emit('denom', { denomIndex: game.getDenomIndex() });
}
function setDenom(di){
  if(busy || di === game.getDenomIndex()) return false;
  return game.setDenom(di);
}
$('tabs').addEventListener('click', function(e){
  var b = e.target.closest ? e.target.closest('.tab') : null;
  if(b){ if(tapGuard && tapGuard('denom')) return; setDenom(+b.getAttribute('data-di')); }
});

function onReset(){
  disp = game.getBoard(); setBal(game.getWallet());
  /* 重置後不再出現「只亮一格」（2026-11-26 用戶裁決：重置只是讓沒錢時能繼續測試）；firstSeen 維持原值 */
  hideBanner(); setAmt(0, null); setTrayGold(0, 0);
  renderAll(); updTabs(); updLegend(); updateFirst();
}
function resetWallet(){
  if(busy){ Toast.show(T('log.noReset')); return false; }
  if(window.Autobet && Autobet.isRunning && Autobet.isRunning()) Autobet.stop();
  if(!game.clearSaved()) return false;
  Toast.show(T('log.resetDone', { n: D.fmt(game.getWallet()) }));
  return true;
}

var spdBtn = $('spdBtn');
function renderSpd(){
  spdBtn.classList.toggle('on', hiSpeed);
  spdBtn.setAttribute('aria-pressed', hiSpeed ? 'true' : 'false');
  spdBtn.title = T(hiSpeed ? 'top.speed.fast' : 'top.speed.normal');
}
function setFast(v, quiet){
  v = !!v;
  if(v === hiSpeed) return;
  hiSpeed = v; D.ls('speed', v ? 'fast' : 'normal'); renderSpd();
  if(cur && cur.o) FX.setSpeed(baseSpeed() * (cur.o.speed || 1)); else FX.setSpeed(baseSpeed());
  if(!quiet) Toast.show(T(v ? 'top.speed.fast' : 'top.speed.normal'));
  emit('speed', { fast: v });
}
spdBtn.onclick = function(){ setFast(!hiSpeed); };

game.on(function(type, d){
  if(type === 'wallet'){ if(!payoutPhase) setBal(d.wallet); }
  else if(type === 'result') onResult(d);
  else if(type === 'denom') onDenom(d);
  else if(type === 'reset') onReset(d);
});

/* ---------- 視窗比 375×812 小：整個世界等比縮 ---------- */
function fitWorld(){
  var app = $('app'), w = app.clientWidth, h = app.clientHeight, k = Math.min(w / 375, h / 812);
  if(k < 0.999){ elWorld.style.transform = 'scale(' + k + ')'; elWorld.style.left = ((w - 375 * k) / 2) + 'px'; }
  else{ elWorld.style.transform = ''; elWorld.style.left = '0'; }
}
window.addEventListener('resize', fitWorld);

/* =========================================================================
 * 初始化
 * ========================================================================= */
elWorld = $('world'); elFx = $('fx'); elStage = $('stage');
buildStyles(); buildScene(); buildCols(); buildTray(); buildHud();
renderAll(); updTabs(); updLegend(); updateFirst();
setBal(game.getWallet()); setAmt(0, null); renderSpd(); fitWorld();
fitText($('wal'), 190, 20, 12);

function snapshot(){
  var cells = [], i;
  for(i = 0; i < NN; i++) cells.push({ h: +cols[i].el.getAttribute('data-h'), g: cols[i].el.getAttribute('data-g') || '' });
  var gold = $('trayGold').style.opacity;
  return { cells: cells, wallet: $('wal').textContent, amt: $('amtN').textContent, amtCls: $('amt').className,
           tray: cur ? cur.tray.filter(Boolean).length : 0, banner: $('banner').textContent, bannerOn: $('banner').style.opacity, gold: gold };
}

D.ui = {
  on: on, off: off, play: play, busy: function(){ return busy; }, isBusy: function(){ return busy; },
  setDenom: setDenom, getDenom: function(){ return game.getDenomIndex(); },
  setFast: setFast, isFast: function(){ return hiSpeed; }, resetWallet: resetWallet,
  cellInfo: function(i){ return { h: +cols[i].el.getAttribute('data-h'), g: cols[i].el.getAttribute('data-g') || '' }; },
  snapshot: snapshot, stats: function(){ return { desync: STATS.desync, balFix: STATS.balFix, rounds: STATS.rounds }; },
  isFirstRun: function(){ return firstOn(); }, setTapGuard: function(fn){ tapGuard = fn; },
  thaw: function(){ FX.thaw(); }, fx: FX
};

/* =========================================================================
 * ?shot= 截圖畫面（dev.js 的自動駕駛分派到這裡）
 *   idle＝丟一枚沒爆的幣（盤面已不是起始）　first＝第一次進場　chain＝連爆停在第 3 波中途　win＝回本（這一注的第一下）
 *   big＝大連爆　huge＝全畫面　sky＝天降停在盤面上方　gem＝寶物在盤上　denom＝換面額後
 *   另有 seq-1…seq-6：同一注（起始發光格）逐波中途的序列圖
 * ========================================================================= */
var TURBO = 40;
function wait(ms, fn){ setTimeout(fn, ms); }
function quiet(cell, plan){ return play(cell, { plan: plan || { kind: 'coin', sky: false }, speed: TURBO }); }
D.shots = D.shots || {};
D.shots.first = function(done){ wait(80, done); };
D.shots.idle = function(done){ quiet(3).then(function(){ wait(120, done); }); };
D.shots['gem-mid'] = function(done){ quiet(8, { kind: 'diamond', sky: false }).then(function(){ wait(150, done); }); };   // 寶物不在邊上（箭頭較長）
D.shots.gem = function(done){ quiet(10, { kind: 'diamond', sky: false }).then(function(){ wait(150, done); }); };
D.shots.denom = function(done){ quiet(3).then(function(){ setDenom(1); wait(600, done); }); };
D.shots.chain = function(done){ play(game.glowCell(), { freeze: { wave: 2, frac: 0.5 } }).then(function(){ done(); }); };
D.shots.win = function(done){ play(game.glowCell(), { freeze: { at: 'chainEnd', add: 280 } }).then(function(){ done(); }); };
D.shots.big = function(done){
  quiet(0).then(function(){ return quiet(0); }).then(function(){ return play(0, { plan: { kind: 'coin', sky: false }, freeze: { at: 'chainEnd', add: 420 } }); }).then(function(){ done(); });
};
D.shots.huge = function(done){
  quiet(0).then(function(){ return quiet(0, { kind: 'diamond', sky: false }); }).then(function(){ return play(0, { plan: { kind: 'diamond', sky: false }, freeze: { at: 'chainEnd', add: 760 } }); }).then(function(){ done(); });
};
D.shots.sky = function(done){ play(3, { plan: { kind: 'coin', sky: 8 }, freeze: { at: 'sky', add: 330 } }).then(function(){ done(); }); };
D.shots['seq-press'] = function(done){ play(game.glowCell(), { freeze: { wave: 2, frac: 0.3 } }).then(function(){ done(); }); };   // 第 3 波的「壓」
D.shots['seq-exit'] = function(done){ play(game.glowCell(), { freeze: { wave: 3, frac: 1.1 } }).then(function(){ done(); }); };   // 噴出的幣停在邊上
[1, 2, 3, 4, 5, 6].forEach(function(n){
  D.shots['seq-' + n] = function(done){ play(game.glowCell(), { freeze: { wave: n - 1, frac: 0.55 } }).then(function(){ done(); }); };
});

window.__demoReady = true;
})();
