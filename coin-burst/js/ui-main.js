/* =========================================================================
 * 爆金連鎖——主畫面與演出（C02；B 案：斜看幣柱＋底部收集槽＋面額分頁縮圖；v2：A 案能量條＋金幣雨；v2.3：連鎖獎池＋「會炸幾格」提示）
 *
 * 職責：把核心（DemoCore）一注算好的結果「演」出來，演完 ack() 入帳。演出只讀結果、不自己算規則與金額：
 *   result.boardBefore → 丟入 → main.waves 逐波炸開（壓→彈→飛→落）→ 噴出的幣在離開盤面當下讓金額加一次、
 *   先停在噴出的那一邊、再滑進底部收集槽排成一列 → （有金幣雨）預告 → 25 枚同時落下 → rain.waves 逐波（同樣壓→彈→飛→落）
 *   → 分級回饋（金幣雨固定最高一級）→ 逐枚進錢包 → ack。
 *   amount 一律取 result.items[].amount；分級用 result.tier（金幣雨固定 huge）；盤面終點與 result.boardAfter 對帳。
 * 能量條（buildMeter／meterSet／meterAnim）：刻度數＝EV.RAIN_EVERY，值一律讀核心（result.meterBefore／meterAfter、game.getMeter）；
 *   每丟一枚漲一格（和丟入同時）；剩 NEAR_N 格以內＝快滿（金框脈動＋放射光＋最後幾格追光）；金幣雨中邊下邊退、途中閃爍，雨停歸零。
 *   別張盤面的進度畫在各自分頁底下的小條。
 * 連鎖獎池（v2.3；potTick／schedPot／schedPotPay／deliverPot）：圖例那一排左邊常駐一個獎池（爆炸徽章＋金額），值一律讀核心（result.potBefore／potAdd／potWin／potAfter、game.getPot）；
 *   每丟一枚在丟入落地那刻 +這一注存的；拿到時（potWin>0）連鎖／雨演完後：蓄力 → 整筆飛進收集槽的金額（金額一次大跳）→ 隨落袋整筆飛進錢包。節拍見檔頭 POT_*。
 * 「會炸幾格」提示（updHints／hideHints）：疊 3 枚的格子角上的小徽章＝EV.probe 的 topples，到 potChain 的格子特別標示；可開關（hintBtn、存 burst.hint，預設開）；演出中隱藏、演出完才算一次。
 * 收集槽只是演出（拿掉規則不變）：要拿掉就刪掉標著「收集槽」的區塊（buildTray、schedExit 的 glide 與 pay 兩段），
 *   把 schedExit 末端改成「幣從停住的地方直接飛進錢包」，其他部分不用動。
 * 動畫：全部掛在 FX（js/fx.js）的虛擬時間軸上，只寫 transform／opacity；不用 filter；
 *   精靈（金幣、鑽石、皇冠、火花）由 js/art.js 畫一次成 CSS 背景圖，重複使用。
 *
 * 節拍（普通速度，毫秒；高速＝普通 × 0.6）：丟入 150／每波 400（壓 130＋飛 245＋空檔 25）／噴出停在邊上 110＋滑進槽 300～500／
 *   金幣雨 預告 600＋落下 約 480（25 枚各差 ≤110 錯開）＋rain.waves 每波同上／分級 回本 400、大連爆 1000、全畫面 1600／落袋 逐枚、每枚間隔 ≤90、總長 ≤0.9 秒。
 *
 * 對外（DEMO.ui；dev.js 的自動駕駛、C03 的 wire.js 用）：
 *   on(evt, fn)／off(evt, fn)   事件：roundStart{result}｜wave{src:'main'|'rain',wave,cells,dom}｜exit{amount,total,index}｜
 *                               rainPre{result,dom}｜rainFall{result,dom,falling}｜rainLanded{result,dom}｜rainEnd{result,meter}｜
 *                               potCharge／potFly／potLand／potPaid（拿獎池的四個節點）｜hint{on}｜
 *                               chainEnd{result,tray,amt}｜roundEnd{result,record,payout,…}｜denom{denomIndex}｜speed{fast}
 *   play(cell, opts?)           → Promise<{ orderId, stake, pay(＝payout), payout, net, mult, tier, quiet, result, wallet }>
 *                               opts：{ plan（導演台：下一注結果，同 DemoCore.armNext）, speed（倍率，疊在普通／高速上）,
 *                                      fast（true＝這注用高速節拍）, freeze（截圖：停在某個時間點，見 shots）}
 *   isBusy()/busy()             演出中（沒爆沒金幣雨的那一注不算）
 *   setDenom(di)／getDenom()    換面額（＝換一張盤面）
 *   setFast(bool, quiet?)／isFast()  速度切換（存 burst.speed）
 *   resetWallet()               錢包與盤面回初始（log 頁的重置鈕走這裡）
 *   cellInfo(i)                 該格目前畫面上的枚數與寶物（讀 DOM，探針用）
 *   snapshot()                  { cells:[{h,g}], wallet, amt, tray, banner }（讀 DOM，探針用）
 *   stats()                     { desync, balFix, rounds }（演出終點與核心對不上的次數；應恆為 0）
 *   setHint(bool)／isHint()／hintDom()  提示開關（存 burst.hint）；hintDom() 讀畫面上的提示（每個徽章的格號／數字／等級／描邊格子，探針用）；potDom() 讀畫面上的獎池數字
 *   meterDom()                  讀畫面：{ main:能量條填到第幾格, lit:是否快滿發光, tabs:[各分頁小條格數], near:[各分頁是否快滿] }（探針用）
 *   isFirstRun()／setTapGuard(fn)  （C03）第一次進場中；自動下注中擋手點（fn('cell'|'denom')→true＝擋掉）。play 的 plan 只在 ?dev／?shot 才認
 *   掛點（留給 C03）：#logBtn（LogUI.mount 的 openBtn）、#autoBtn／#abar（Autobet.mount 的 entryBtn／slot）、#director、
 *     DEMO.ui.on('roundEnd')（組紀錄用 result／record）、DEMO.ui.play（自動下注 adapter）、DEMO.ui.isBusy
 *
 * 依賴：values.js、env.js、strings.js、toast.js、core.js、art.js、fx.js。載入完成後設 window.__demoReady = true。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, G = ART.G, E = FX.E;
var DEV_OK = !!(D.q.dev || D.q.shot);                     // 載入時就定好：事後在 console 改 DEMO.q.dev 不會打開指定結果
/* 換版清理：同一個網址玩過 v1 的人，舊的紀錄（普通幣 0.7、有天降）和「看過第一次進場」的記號都清掉，
   核心存檔由 core.js 依版本號自己忽略。?shot 模式不讀不寫，所以這段不會動到任何東西。 */
var SAVE_GEN = 5;                                         // 換版記號：v2.3 連鎖獎池、能量條 86 格（核心存檔版本同步 v:5）
if(!D.q.shot && +D.ls('gen') !== SAVE_GEN){ D.ls('log', null); D.ls('first', null); D.ls('auto', null); D.ls('gen', SAVE_GEN); }
var $ = function(id){ return document.getElementById(id); };
var shot = D.q.shot;
var game = DemoCore.createGame({ storage: shot ? false : undefined });
D.game = game;

var NN = EV.N, COLS = EV.CFG.COLS, CAP = EV.CFG.CAP, DIRS = EV.DIRS, MAX = EV.RAIN_EVERY;

/* ---------- 節拍（普通速度，毫秒） ---------- */
var DROP = 150, PRESS = 130, FLY = 245, WGAP = 25, STEP = PRESS + FLY + WGAP;   // 每波 0.4 秒（2026-11-26 用戶「幫我設定0.4」）
var EXHOLD = 110, EXSTAG = 45, SPRING = 300;
var RAIN_PRE = 600, RAIN_JIT = 110, RAIN_DUR = 330;            // 金幣雨：預告 0.6 秒；25 枚的起跑錯開 ≤110、飛 330～360（整片約 0.48 秒落完）
var NEAR_N = 4;                                           // 剩幾格以內算「快滿」
var PAYDUR = 380, PAYMAX = 700;
var TIER_DELAY = { none: 120, back: 450, big: 650, huge: 800 };   // 金幣雨固定 huge
var TIER_DUR = { none: 0, back: 400, big: 1000, huge: 1600 };
var HI = 1 / 0.6;                                         // 高速＝普通的 0.6 倍時間

/* ---------- 版位（世界座標 375×812；盤面幾何在 art.js） ---------- */
var TR = { x: 12, y: 560, w: 351, h: 80 }, TRY = 600;     // 收集槽、槽裡幣的中心高度
var SLOT0 = 32, SLOTW = 22, TRAYS = 0.44;                 // 槽裡第一枚的 x、間距、縮放
var WAL = { x: 34, y: 22 };                               // 錢包圖示
var MT = { x: 12, y: 142, w: 351, h: 44 }, MX0 = 16, MDX = 275 / MAX, MHX = 329, MHY = 22;   // 能量條（槽、第一個刻度的 x、刻度間距、徽章圓心；#mt 內座標）

/* ---------- 連鎖獎池（v2.3）：節拍與版位 ---------- */
var PC = game.getState().potChain;                        // 炸幾格拿獎池（核心給，不寫死）
var POT_PRE = 120, POT_CHARGE = 380, POT_FLY = 560, POT_PAYDUR = 520;   // 拿獎池：連鎖演完停 0.12 → 獎池蓄力 0.38 → 整筆飛進金額 0.56（落下時金額大跳）→ 之後隨落袋整筆飛進錢包 0.52
var PX = 78, PY = 675, AX = 302, AY = 600;                // 獎池徽章中心、收集槽金額中心（飛行牌的起訖點）

/* ---------- 狀態 ---------- */
var disp = game.getBoard();                               // 畫面上的盤面（演出逐步更新；結束時和核心對帳）
var shownBal = game.getWallet();
var shownPot = game.getPot();                             // 畫面上的獎池數字（演出中逐步更新）
var hintOn = D.ls('hint') !== 'off';                      // 「會炸幾格」提示開關（預設開，存 burst.hint）
var busy = false, payoutPhase = false, cur = null, pend = null, pendingDrops = 0;
var hiSpeed = shot ? false : D.ls('speed') === 'fast';
var firstSeen = !!D.ls('first');
var subs = {};
var STATS = { desync: 0, balFix: 0, rounds: 0 };
var cols = [], hv = [], bv = [], dv = [], gv = [], fv = [], thumbs = [], tabEls = [], ebs = [];
var gemSig = '', elWorld, elFx, elStage;
var mtr = { v: 0, tok: 0, force: false, drain: false, base: -1, lit: false, el: {} };   // 能量條：目前畫出來的格數（可帶小數）、補間通道、金幣雨中強制發亮／退條、追光位置

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
    + '<linearGradient id="abm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a" stop-opacity=".62"/><stop offset=".45" stop-color="#ffc83a" stop-opacity=".26"/><stop offset="1" stop-color="#ffb020" stop-opacity=".1"/></linearGradient>'
    + '<radialGradient id="anz"><stop offset="0" stop-color="#fff7c2" stop-opacity=".95"/><stop offset="1" stop-color="#ffd24a" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="brg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#e89a1a"/></linearGradient>'
    + '<radialGradient id="hbg" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#fff6b8"/><stop offset=".5" stop-color="#ffbc2e"/><stop offset="1" stop-color="#ff7a1e"/></radialGradient>'
    + '<radialGradient id="hbc" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#ff8a44"/><stop offset=".55" stop-color="#e5391a"/><stop offset="1" stop-color="#a3180a"/></radialGradient>'
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
  s += beamsSVG();
  $('scene').innerHTML = s;
  var ov = '';                                            // 寶物所在格的外框、第一次進場的發光框、暗化（疊在幣柱上、點擊層下）
  for(i = 0; i < NN; i++){
    r = (i / COLS) | 0; c = i % COLS; p = cellPoly(r, c, 1.4);
    ov += '<polygon class="dv" id="dv' + i + '" points="' + p + '" fill="#030610" opacity="0"/>';
    ov += '<polygon class="gv" id="gv' + i + '" points="' + p + '" fill="none" stroke="#7fe3ff" stroke-width="2.4" stroke-linejoin="round"/>';
    ov += '<polygon class="gv" id="fv' + i + '" points="' + p + '" fill="rgba(255,210,74,.14)" stroke="#ffd24a" stroke-width="3.2" stroke-linejoin="round"/>';
  }
  ov += '<g class="arr" id="arrows"></g><g id="hints"></g>';
  $('over').innerHTML = ov;
  var ht = '';
  for(i = 0; i < NN; i++){ r = (i / COLS) | 0; c = i % COLS; ht += '<polygon data-i="' + i + '" points="' + cellPoly(r, c, 0) + '"/>'; }
  $('hit').innerHTML = ht;
  for(i = 0; i < NN; i++){ hv[i] = $('hv' + i); bv[i] = $('bv' + i); dv[i] = $('dv' + i); gv[i] = $('gv' + i); fv[i] = $('fv' + i); }
}

/* 金幣雨的五道光柱：從能量條下緣順著盤面的五欄灌下去（只在雨的預告到落完時淡入淡出，整組只動 opacity） */
function beamsSVG(){
  var y0 = 178, y1 = G.BOT, f0 = G.fy(y0), f1 = G.fy(y1), c, g = '<g id="beams">', xl0, xr0, xl1, xr1;
  for(c = 0; c < COLS; c++){
    xl0 = G.CX + (c - 2.5) * G.CWd * f0; xr0 = G.CX + (c - 1.5) * G.CWd * f0;
    xl1 = G.CX + (c - 2.5) * G.CWd * f1; xr1 = G.CX + (c - 1.5) * G.CWd * f1;
    g += '<polygon points="' + n2(xl0 + 3) + ',' + y0 + ' ' + n2(xr0 - 3) + ',' + y0 + ' ' + n2(xr1 - 1.5) + ',' + y1 + ' ' + n2(xl1 + 1.5) + ',' + y1 + '" fill="url(#abm)" opacity="' + (c % 2 ? 0.78 : 1) + '"/>';
    g += '<ellipse cx="' + n2((xl0 + xr0) / 2) + '" cy="' + (y0 + 3) + '" rx="' + n2((xr0 - xl0) * 0.42) + '" ry="9" fill="url(#anz)"/>';
  }
  return g + '</g>';
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
    h += '</div><div class="lb"><i class="ico cn" style="width:16px;height:11px"></i><b>' + D.fmt(EV.CFG.DENOMS[di]) + '</b></div><div class="eb"><i></i></div></button>';
  }
  $('tabs').innerHTML = h;
  var tabs = $('tabs').children;
  for(di = 0; di < tabs.length; di++){
    tabEls[di] = tabs[di];
    thumbs[di] = tabs[di].firstChild.children;
    ebs[di] = tabs[di].querySelector('.eb i');
    fitText(tabs[di].querySelector('b'), 70, 17, 11);
  }
  $('legend').innerHTML = '<div class="chip"><i class="ico cn"></i><b></b></div><div class="chip"><i class="ico gd"></i><b></b></div><div class="chip"><i class="ico gk"></i><b></b></div>';
  $('pot').innerHTML = '<i class="pi ico bst"><b id="potC">' + PC + '</b></i><b id="potN">0</b>';   // 獎池：爆炸徽章（裡面是門檻格數）＋金額
}

/* 字太長就縮：多語／大數字不破版 */
function fitText(el, maxW, start, min){
  var sz = start;
  el.style.fontSize = sz + 'px';
  while(el.offsetWidth > maxW && sz > min){ sz -= 1; el.style.fontSize = sz + 'px'; }
}

/* =========================================================================
 * 能量條（A 案「橫條」）：盤面上方一條被金幣填滿的槽，刻度數＝EV.RAIN_EVERY，每個刻度是一枚幣的側邊；右端是雨雲徽章。不寫數字。
 *   填滿的部分：.mf（裁切窗）與裡面的 .mi（刻度帶）一正一反平移，只動 transform，不重畫；
 *   快滿（剩 NEAR_N 格以內）：.lit 疊上金色外框脈動、放射光、亮金刻度、最後幾格追光；金幣雨中：整條閃爍並一路退到 0。
 * ========================================================================= */
function tickRects(fill, extra){
  var s = '', i;
  for(i = 0; i < MAX; i++) s += '<rect x="' + n2(MX0 + i * MDX) + '" y="15" width="2.5" height="14" rx="1.2" fill="' + fill + '"' + (extra || '') + '/>';
  return s;
}
function rainIcon(lit){                                    // 雨雲圖示：雲＋三枚掉下來的幣（暗＝藍灰、亮＝金）
  var k = 0.9, w = 36 * k, h = 34 * k, g = lit ? 'url(#mcgL)' : 'url(#mcgD)', ol = lit ? '#7a4a06' : '#26356b';
  var shapes = '<rect x="5" y="12" width="26" height="9" rx="4.5"/><circle cx="12" cy="12" r="6.5"/><circle cx="20" cy="8.5" r="8"/><circle cx="28.5" cy="13" r="5.5"/>';
  var s = '<span class="mic ' + (lit ? 'l' : 'd') + '" style="width:' + n2(w) + 'px;height:' + n2(h) + 'px">'
    + '<svg width="' + n2(w) + '" height="' + n2(22 * k) + '" viewBox="0 0 36 22" style="position:absolute;left:0;top:0;overflow:visible">'
    + '<g fill="' + ol + '" stroke="' + ol + '" stroke-width="3" stroke-linejoin="round">' + shapes + '</g>'
    + '<g fill="' + g + '">' + shapes + '</g>'
    + '<path d="M14.6 5.6a8 8 0 0 1 8.4-1.1" fill="none" stroke="#fff" stroke-opacity="' + (lit ? .85 : .5) + '" stroke-width="1.6" stroke-linecap="round"/></svg>';
  [[2.5, 23.4, -12], [12, 26.4, 8], [22, 22.6, -5]].forEach(function(q){
    s += '<i class="ico ' + (lit ? 'ch' : 'cn') + '" style="position:absolute;left:' + n2(q[0] * k) + 'px;top:' + n2(q[1] * k) + 'px;width:' + n2(14 * k) + 'px;height:' + n2(9.5 * k) + 'px;opacity:' + (lit ? 1 : 0.62) + ';transform:rotate(' + q[2] + 'deg)"></i>';
  });
  return s + '</span>';
}

function buildMeter(){
  var o = $('mt'), i, s, W = MT.w, H = MT.h;
  var defs = '<defs>'
    + '<linearGradient id="amg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03060f"/><stop offset=".55" stop-color="#080e22"/><stop offset="1" stop-color="#0e1734"/></linearGradient>'
    + '<linearGradient id="aml" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5c9a"/><stop offset="1" stop-color="#1c2650"/></linearGradient>'
    + '<linearGradient id="amG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#ffd24a"/><stop offset="1" stop-color="#b8821c"/></linearGradient>'
    + '<linearGradient id="atn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".5" stop-color="#e2b03c"/><stop offset="1" stop-color="#a96f14"/></linearGradient>'
    + '<linearGradient id="ath" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#ffe27a"/><stop offset="1" stop-color="#e8a418"/></linearGradient>'
    + '<radialGradient id="abg" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#243664"/><stop offset="1" stop-color="#070c1f"/></radialGradient>'
    + '<radialGradient id="abgL" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#3a2f12"/><stop offset="1" stop-color="#070c1f"/></radialGradient>'
    + '<linearGradient id="mcgL" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="22"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#ffd54a"/><stop offset="1" stop-color="#d98a14"/></linearGradient>'
    + '<linearGradient id="mcgD" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="22"><stop offset="0" stop-color="#a9b8ea"/><stop offset=".55" stop-color="#6f82c6"/><stop offset="1" stop-color="#4a5b9e"/></linearGradient>'
    + '</defs>';
  var svg0 = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
  /* 底：槽、RAIN_EVERY 個暗刻度、徽章 */
  s = '<div class="mrays"></div>' + svg0 + defs
    + '<rect x="1" y="9" width="349" height="26" rx="13" fill="url(#amg)" stroke="url(#aml)" stroke-width="2"/>'
    + '<rect x="3" y="10.5" width="345" height="10" rx="8" fill="#000" opacity=".3"/>'
    + '<path d="M20 34h300" stroke="#fff" stroke-opacity=".1" stroke-width="1.2" stroke-linecap="round"/>';
  for(i = 0; i < MAX; i++){
    var x = n2(MX0 + i * MDX);
    s += '<rect x="' + x + '" y="15" width="2.5" height="14" rx="1.2" fill="#18244d"/><rect x="' + x + '" y="27.6" width="2.5" height="1.4" rx=".7" fill="#2d3f7c" opacity=".7"/>';
  }
  s += '<circle cx="' + MHX + '" cy="' + (MHY + 1) + '" r="21" fill="#000" opacity=".4"/>'
    + '<circle cx="' + MHX + '" cy="' + MHY + '" r="20.5" fill="url(#abg)" stroke="url(#aml)" stroke-width="2.4"/>'
    + '<circle cx="' + MHX + '" cy="' + MHY + '" r="17" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1"/></svg>';
  /* 殘影（雨中：剛退掉的那一段留淡淡的金色，讓人看出條在往左退）、填滿（普通金＋亮金，快滿時亮金淡入） */
  var hi = function(op){ return '<rect x="' + (MX0 - 1) + '" y="15.4" width="' + n2(MAX * MDX + 1) + '" height="4.2" rx="2" fill="#fff" opacity="' + op + '"/>'; };
  s += '<div class="mf mg"><div class="mi">' + svg0 + tickRects('#ffe27a', ' opacity=".34"') + '</svg></div></div>'
    + '<div class="mf mn"><div class="mi">' + svg0 + tickRects('url(#atn)') + hi(0.2) + '</svg>'
    + svg0.replace('<svg ', '<svg class="mhot" ') + tickRects('url(#ath)') + hi(0.34) + '</svg></div></div>';
  /* 快滿的疊層：發光外框（脈動）、金色槽框、亮徽章 */
  s += svg0.replace('<svg ', '<svg class="ml" ')
    + '<rect class="a-glow" x="-4" y="5" width="359" height="34" rx="17" fill="none" stroke="#ffd24a" stroke-width="3.2"/>'
    + '<rect x="-1" y="8" width="353" height="28" rx="14" fill="none" stroke="#ffd24a" stroke-width="1.4" opacity=".55"/>'
    + '<rect x="1" y="9" width="349" height="26" rx="13" fill="none" stroke="url(#amG)" stroke-width="2.6"/>'
    + '<circle class="a-pulse" cx="' + MHX + '" cy="' + MHY + '" r="24" fill="none" stroke="#ffd24a" stroke-width="2"/>'
    + '<circle cx="' + MHX + '" cy="' + MHY + '" r="20.5" fill="url(#abgL)" stroke="url(#amG)" stroke-width="3"/>'
    + '<circle cx="' + MHX + '" cy="' + MHY + '" r="17" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1"/></svg>';
  for(i = 0; i < NEAR_N; i++) s += '<i class="chs"></i>';
  s += rainIcon(false) + rainIcon(true) + '<div class="mh"><i class="ico cn"></i><i class="ico ch l"></i></div>';
  o.innerHTML = s;
  var E1 = mtr.el;
  E1.mt = o; E1.mg = o.querySelector('.mg'); E1.go = E1.mg; E1.gi = E1.mg.firstChild;
  E1.fo = o.querySelector('.mn'); E1.fi = E1.fo.firstChild; E1.hot = o.querySelector('.mhot'); E1.ml = o.querySelector('.ml');
  E1.head = o.querySelector('.mh'); E1.chs = o.querySelectorAll('.chs');
  for(i = 0; i < E1.chs.length; i++) E1.chs[i].style.animationDelay = n2(-i * 0.18) + 's';
}

/* 畫出 v 格（可帶小數）：填滿窗的右緣、頭上的幣、快滿的發亮、追光、當前分頁底下的小條。只寫 transform／opacity／class */
function meterSet(v){
  var E1 = mtr.el, e, i, lit, base, di, ge;
  v = clamp(v, 0, MAX); mtr.v = v;
  e = MX0 + v * MDX - 0.5;                                  // 填滿的右緣（#mt 內 x）
  E1.fo.style.transform = 'translate3d(' + n2(e - MT.w) + 'px,0,0)';
  E1.fi.style.transform = 'translate3d(' + n2(MT.w - e) + 'px,0,0)';
  if(mtr.drain){
    ge = MX0 + Math.min(MAX, v + 14) * MDX - 0.5;
    E1.go.style.transform = 'translate3d(' + n2(ge - MT.w) + 'px,0,0)';
    E1.gi.style.transform = 'translate3d(' + n2(MT.w - ge) + 'px,0,0)';
  }
  E1.head.style.transform = 'translate3d(' + n2(MX0 + v * MDX - 13) + 'px,' + (MHY - 11) + 'px,0) rotate(-8deg)';
  E1.head.style.opacity = n2(clamp(v * 2, 0, 1));
  lit = mtr.force || v >= MAX - NEAR_N;
  if(lit !== mtr.lit){ mtr.lit = lit; E1.mt.classList.toggle('lit', lit); }
  base = (lit && !mtr.force) ? Math.ceil(v - 1e-6) : -1;     // 追光：還沒填的最後幾格一格一格閃
  if(base !== mtr.base){
    mtr.base = base;
    for(i = 0; i < E1.chs.length; i++){
      if(base >= 0 && base + i < MAX){ E1.chs[i].style.transform = 'translate3d(' + n2(MX0 + (base + i) * MDX - 0.6) + 'px,0,0)'; E1.chs[i].className = 'chs on'; }
      else E1.chs[i].className = 'chs';
    }
  }
  di = game.getDenomIndex();
  if(ebs[di]) ebs[di].style.transform = 'scaleX(' + n2(v / MAX) + ')';
}
function mvMode(force, drain){                              // 金幣雨預告／雨中：強制發亮、關掉淡入淡出（閃爍由補間逐格寫）、雨中再開殘影
  var E1 = mtr.el;
  mtr.force = force; mtr.drain = drain;
  E1.mt.classList.toggle('fl', force);
  if(!force){ E1.hot.style.opacity = ''; E1.ml.style.opacity = ''; }
  E1.go.style.opacity = drain ? '1' : '';
  meterSet(mtr.v);
}
/* 能量條補間：t0 起 dur 毫秒從 from 走到 to。開始的當下才搶通道（後來的補間蓋掉先前的）；dn＝這一注的面額，已換掉就不畫 */
function meterAnim(t0, dur, from, to, ease, onFrame, dn){
  var tok = 0;
  FX.at(t0, function(){
    if(dn != null && game.getDenomIndex() !== dn){ tok = -1; return; }
    tok = ++mtr.tok; meterSet(from);
  });
  FX.tw(t0, dur, function(p){ if(mtr.tok === tok){ meterSet(lerp(from, to, p)); if(onFrame) onFrame(p); } },
    function(){ if(mtr.tok === tok) meterSet(to); }, ease);
}
/* 讀畫面（探針用）：條填到第幾格（量填滿窗的右緣）、是否發亮、各分頁小條的格數與是否快滿 */
function meterDom(){
  var mr = mtr.el.mt.getBoundingClientRect(), r = mtr.el.fo.getBoundingClientRect();   // 量填滿窗的右緣，相對整條（整條被彈一下放大時也準）
  var edge = (r.right - mr.left) / mr.width * MT.w, tabs = [], near = [], di, a, b;
  for(di = 0; di < ebs.length; di++){
    a = ebs[di].getBoundingClientRect(); b = ebs[di].parentNode.getBoundingClientRect();
    tabs.push(n2(MAX * a.width / b.width)); near.push(tabEls[di].classList.contains('nr'));
  }
  return { main: n2((edge - MX0 + 0.5) / MDX), lit: mtr.el.mt.classList.contains('lit'), tabs: tabs, near: near };
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

/* =========================================================================
 * 「會炸幾格」提示（v2.3，可開關，預設開，存 burst.hint）
 *   每個疊 3 枚的格子（只有它們點下去會炸）角上一顆小徽章＝「點下去會炸幾格」（EV.probe(盤面, 格).topples，核心驗過等於真丟普通幣的 main.topples；
 *   丟出去的若是鑽石／皇冠，炸的格數相同）。一般＝深藍底；≥ 門檻一半＝金邊；≥ 門檻（PC，能拿獎池）＝爆炸徽章＋格子描邊，最多兩格呼吸；
 *   獎池徽章也跟著呼吸一圈（提示開著而且盤面上有能拿獎池的格子時）。演出中整個拿掉、演出完（盤面和核心對完帳）才算一次再出現；第一次進場（只亮一格）不顯示。
 *   樣式全是靜態（css 的 #hints），只有進場的淡入彈出與最多兩格的呼吸。
 * ========================================================================= */
function hideHints(){
  var h = $('hints');
  h.setAttribute('class', ''); h.innerHTML = '';
  $('pot').classList.remove('rdy');
}
function updHints(){
  var h = $('hints'), i, n, list = [], pz = {}, s = '', t, d, r, c, k, w2, txt, mid = Math.ceil(PC / 2), anyHot = false;
  if(!hintOn || firstOn() || busy || pendingDrops > 0){ hideHints(); return; }
  for(i = 0; i < NN; i++){
    if(disp.h[i] < CAP - 1) continue;
    n = EV.probe(disp, i).topples;
    list.push({ i: i, n: n });
    if(n >= PC) anyHot = true;
  }
  list.filter(function(q){ return q.n >= PC; }).sort(function(a, b){ return b.n - a.n || a.i - b.i; }).slice(0, 2).forEach(function(q){ pz[q.i] = true; });
  for(k = 0; k < list.length; k++){                        // 格子描邊（能拿獎池的格子）：先畫，徽章壓在上面
    if(list[k].n < PC) continue;
    i = list[k].i; r = (i / COLS) | 0; c = i % COLS;
    s += '<polygon class="hp v' + (pz[i] ? ' pz' : '') + '" data-i="' + i + '" points="' + cellPoly(r, c, 2.2) + '"/>';
  }
  for(k = 0; k < list.length; k++){
    i = list[k].i; n = list[k].n; d = cols[i].d;
    t = n >= PC ? 'h' : (n >= mid ? 'm' : 'l'); txt = String(n); w2 = txt.length > 1;
    s += '<g class="ht v ' + t + (pz[i] ? ' pz' : '') + '" data-i="' + i + '" data-n="' + n + '" transform="translate(' + n2(d.x + 21 * d.s) + ',' + n2(d.cy0 - 31 * d.s) + ')"><g class="hz" style="transition-delay:' + (k * 28) + 'ms">';
    if(t === 'h') s += '<polygon points="' + ART.burstPts(16, 12.6) + '" fill="url(#hbg)" stroke="#8a2a04" stroke-width="1.2" stroke-linejoin="round"/><circle r="9.8" fill="url(#hbc)" stroke="#ffe9a0" stroke-width="1"/>';
    else s += '<rect class="hb" x="' + (w2 ? -13.5 : -9) + '" y="-9" width="' + (w2 ? 27 : 18) + '" height="18" rx="9"/>';
    s += '<text class="hn" y="' + (t === 'h' ? 5 : 4.3) + '">' + txt + '</text></g></g>';
  }
  h.setAttribute('class', ''); h.innerHTML = s;
  void h.getBoundingClientRect();                          // 先排一次版（元件在「隱藏」的樣子），下面加上 on 才有淡入彈出
  h.setAttribute('class', 'on');
  $('pot').classList.toggle('rdy', anyHot);
}
function hintDom(){                                        // 讀畫面（探針用）：提示開關、每個徽章的格號／數字／等級／是否看得見、描邊的格子
  var out = [], els = $('hints').querySelectorAll('.ht'), i, e, hz;
  for(i = 0; i < els.length; i++){
    e = els[i]; hz = e.querySelector('.hz');
    out.push({ i: +e.getAttribute('data-i'), n: +e.querySelector('.hn').textContent, tier: e.classList.contains('h') ? 'h' : (e.classList.contains('m') ? 'm' : 'l'),
               pz: e.classList.contains('pz'), vis: +getComputedStyle(hz).opacity });
  }
  var ol = $('hints').querySelectorAll('.hp'), cells = [];
  for(i = 0; i < ol.length; i++) cells.push(+ol[i].getAttribute('data-i'));
  return { on: $('hints').getAttribute('class') === 'on', btn: hintOn, btnOn: $('hintBtn').classList.contains('on'), cells: out, outlines: cells, potRdy: $('pot').classList.contains('rdy'), chain: PC };
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
  el.style.display = ''; el.style.opacity = '1'; el._free = false;
  if(txt != null) el.textContent = txt;
  return el;
}
function putEl(el){ if(el._free) return; el._free = true; el.style.display = 'none'; (pool[el._cls] = pool[el._cls] || []).push(el); }
function place(el, x, y, s, rot, op){
  el.style.transform = 'translate3d(' + n2(x) + 'px,' + n2(y) + 'px,0)' + (rot ? ' rotate(' + n2(rot) + 'deg)' : '') + ' scale(' + n2(s) + ')';
  if(op != null) el.style.opacity = n2(op);
}
function flightEl(kind, hot){                              // 一枚飛行中的東西（金幣／鑽石／皇冠）
  return getEl(kind === 'diamond' ? 'fg gd' : kind === 'crown' ? 'fk gk' : 'fc ' + (hot === false ? 'cn' : 'ch'));
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
var live = { sp: 0, pp: 0 };                               // 同時在畫面上的火花、+金額字：設上限（元件數要節制，舊手機）
function sparkAt(x, y, t0, ang, dist, sz, gold){
  if(live.sp >= 36) return;
  live.sp++;
  var el = getEl('sp ' + (gold ? 'spg' : 'spk')); el.style.opacity = '0';
  var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.8;
  FX.tw(t0, 380, function(p){ var e = E.out(p); place(el, x + dx * e, y + dy * e, sz * (1 - 0.5 * p), p * 90, p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85); }, function(){ putEl(el); live.sp--; });
}
function popText(x, y, txt, t0, cls){
  if(live.pp >= 6) return;
  live.pp++;
  var el = getEl(cls || 'pp', txt); el.style.opacity = '0';
  FX.tw(t0, 650, function(p){ place(el, x, y - 30 * E.out(p), lerp(0.8, 1.1, E.out(Math.min(1, p * 4))), 0, p < 0.12 ? p / 0.12 : 1 - Math.max(0, (p - 0.45) / 0.55)); }, function(){ putEl(el); live.pp--; });
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
  fitText(el, 112, 20, 12);
}
function setAmt(v, tier, clsOnly){
  var el = $('amtN');
  if(!clsOnly){ el.textContent = D.fmt(v); fitText(el, 100, 32, 12); }
  $('amt').className = v === 0 ? 'dim hud' : (tier && tier !== 'none' ? 'gold hud' : 'hud');
}
/* 獎池數字（主畫面常駐）：setPot 直接寫；potRoll 在 dur 毫秒內滾動（只改字，結束時才縮字體） */
function setPot(v){
  shownPot = v;
  var el = $('potN'); el.textContent = D.fmt(v);
  $('pot').classList.toggle('z', v === 0);
  fitText(el, 66, 22, 12);
}
function potRoll(a, b, t0, dur, ease){
  var el = $('potN');
  FX.tw(t0, dur, function(p){ el.textContent = D.fmt(a + (b - a) * p); }, function(){ setPot(b); }, ease);
}
function amtRoll(a, b, t0, dur, tier){                      // 金額滾動：只改字
  var el = $('amtN');
  FX.tw(t0, dur, function(p){ el.textContent = D.fmt(a + (b - a) * p); }, function(){ setAmt(b, tier); });
}
function updTabs(){                                        // 分頁：縮圖＋底下的能量條小條（目前那張讀畫面上的條，別張讀核心）；別張快滿＝金色發光
  var di, cur = game.getDenomIndex(), b, i, m;
  for(di = 0; di < tabEls.length; di++){
    m = di === cur ? mtr.v : game.getMeter(di);
    tabEls[di].className = 'tab' + (di === cur ? ' on' : (m >= MAX - NEAR_N ? ' nr' : ''));
    ebs[di].style.transform = 'scaleX(' + n2(clamp(m, 0, MAX) / MAX) + ')';
    b = di === cur ? disp : game.getBoard(di);
    for(i = 0; i < NN; i++) thumbs[di][i].className = thumbCls(b.h[i], b.g[i]);
  }
}
function updLegend(){
  var p = EV.PAY[game.getDenomIndex()], bs = $('legend').querySelectorAll('b');
  bs[0].textContent = D.fmt(p.coin); bs[1].textContent = D.fmt(p.diamond); bs[2].textContent = D.fmt(p.crown);
  for(var i = 0; i < 3; i++) fitText(bs[i], 44, 15, 10);
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
function slotX(idx){ return SLOT0 + (cur.rows2 ? (idx >> 1) : idx) * cur.step; }
function slotY(idx){ return cur.rows2 ? TRY + ((idx & 1) ? 9 : -8) : TRY; }       // 收集槽超過 15 枚時排兩列
var SPIN = [-26, 26, 16, -16];                              // 四個方向飛出時的旋轉

function schedDrop(cell, kind, T0){                        // 丟入：幣從上方落到那一格；能量條同時漲一格
  var d = cols[cell].d, S = cur.S, res = cur.res, dn = res.denomIndex, nc = clamp(S.h[cell] - S.g[cell].length, 0, 3);
  var y1 = kind === 'coin' ? d.cy0 - 11 * d.s * nc : d.cy0 - 11 * d.s * Math.max(0, nc - 1) - 14 * d.s;
  var m1 = res.hasRain ? MAX : res.meterAfter;             // 金幣雨那一注：最後一格在丟下去時補滿（之後預告、退條）
  S.h[cell]++; if(kind !== 'coin') S.g[cell].push(kind);
  pendingDrops++;
  FX.at(T0, function(){
    var f = flightEl(kind, false), sc = kscale(kind);
    FX.tw(T0, DROP, function(p){ var e = E.in(p); place(f, d.x, lerp(y1 - 78, y1, e), d.s * sc * lerp(1.25, 1, e), 0, Math.min(1, 0.25 + p * 1.5)); }, function(){ putEl(f); });
  });
  meterAnim(T0, DROP, res.meterBefore, m1, E.out, null, dn);
  FX.at(T0 + DROP, function(){
    pendingDrops--;
    if(game.getDenomIndex() !== dn) return;                // 落地前已換面額：畫面已經讀新盤面
    disp.h[cell]++; if(kind !== 'coin') disp.g[cell].push(kind);
    renderCol(cell); flushOv(); bounceAnim(cell, T0 + DROP, 0.1);
    glowBurst(d.x, d.cy0 - 4, d.s * 0.5, T0 + DROP);
    sparkAt(MT.x + MX0 + m1 * MDX, MT.y + MHY, T0 + DROP, -1.3, 12, 0.7, true);
    potTick(res, T0 + DROP);                               // 獎池 +這一注存的（每丟一枚跳一下）
    if(!busy){ verifyBoard(); updHints(); }
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
  var S = cur.S, cells = w.cells, bt = ws + PRESS, lt = bt + FLY, kk = Math.min(k + (src === 'rain' ? 2 : 0), 6), a, m, j;
  (src === 'rain' ? cur.rwavesT : cur.wavesT).push(ws);
  var starts = [];                                        // 這一波每格噴之前的疊高（飛行起點用）
  for(a = 0; a < cells.length; a++) starts[a] = Math.min(S.h[cells[a]], CAP + 1);
  var moves = w.moves, mvs = [], nEx = 0;
  for(m = 0; m < moves.length; m++) if(moves[m].to < 0) nEx++;
  var stag = Math.min(EXSTAG, 220 / Math.max(1, nEx));    // 同一波噴很多枚時，錯開的間隔縮小（整波不拖長）
  /* 先把核心的「噴出」套到排程用的盤面：全部先扣、再發（同一波同時發生） */
  for(a = 0; a < cells.length; a++){
    var c = cells[a], gemsOut = 0;
    for(m = 0; m < moves.length; m++) if(moves[m].from === c && moves[m].kind !== 'coin') gemsOut++;
    S.h[c] -= CAP; S.g[c].splice(0, gemsOut);
  }
  var exitJ = 0;
  for(m = 0; m < moves.length; m++){
    var mv0 = moves[m], d0 = cols[mv0.from].d, ai = cells.indexOf(mv0.from), sp = starts[ai];
    var x0 = d0.x, y0 = d0.cy0 - 11 * d0.s * (Math.min(sp, CAP) - 1) - 8 * d0.s, p1, s1, dur, isExit = mv0.to < 0, j2 = isExit ? exitJ++ : 0, slot = 0, d1;
    if(isExit){ p1 = exitPoint(mv0.from, mv0.dir); s1 = 0.72; dur = FLY + j2 * stag; }
    else{
      d1 = cols[mv0.to].d; slot = clamp(S.h[mv0.to] - S.g[mv0.to].length, 0, 3);
      p1 = { x: d1.x, y: d1.cy0 - 11 * d1.s * slot - (mv0.kind === 'coin' ? 0 : 10 * d1.s) }; s1 = d1.s; dur = FLY;
      S.h[mv0.to]++; if(mv0.kind !== 'coin') S.g[mv0.to].push(mv0.kind);
    }
    var oo = { mv: mv0, x0: x0, y0: y0, s0: d0.s, p1: p1, s1: s1, dur: dur, isExit: isExit, j: j2, item: isExit ? cur.itemIdx++ : -1, gd: 0,
               f: null, paid: false, kind: mv0.kind, amount: 0, x: 0, y: 0, A: bt + dur };
    if(isExit){                                            // 滑進槽的時間在排程時就算好（分級與落袋要等最後一枚到槽）
      oo.x = slotX(oo.item); oo.y = slotY(oo.item);
      var dd2 = Math.sqrt(Math.pow(oo.x - p1.x, 2) + Math.pow(oo.y - p1.y, 2));
      oo.gd = clamp(240 + dd2 * 0.5, 300, 520);
      cur.lastArr = Math.max(cur.lastArr, bt + dur + EXHOLD + oo.gd + 160);
      (function(o){ FX.at(o.A, function(){ regExit(o); }); })(oo);   // 離開盤面當下：金額加一次、登記進槽（用計時器、不靠補間收尾，時間一次跳很遠也依序）
    }
    mvs.push(oo);
  }
  /* 壓：這一波的每一格往下壓扁、發亮 */
  FX.at(ws, function(){ for(var q = 0; q < cells.length; q++) pressAnim(cells[q], ws); });
  /* 彈＋飛：壓到底、四枚幣帶弧線飛出、柱子彈開、震波、盤面震 */
  FX.at(bt, function(){
    var q, mi, many = cells.length > 6, nSp = cells.length <= 4 ? 3 : (cells.length <= 8 ? 2 : 1);      // 一波炸很多格時，裝飾元件（震波、光爆、火花）減量
    for(q = 0; q < cells.length; q++){
      var cc = cells[q], L = cols[cc], dd = L.d, gemsOut2 = 0;
      for(mi = 0; mi < moves.length; mi++) if(moves[mi].from === cc && moves[mi].kind !== 'coin') gemsOut2++;
      disp.h[cc] -= CAP; disp.g[cc].splice(0, gemsOut2);
      renderCol(cc);
      springAnim(cc, bt, 0.08 + 0.025 * kk);
      boomFlash(cc, bt);
      if(q < (many ? 3 : 6)) ring(dd.x, dd.cy0 - 6, dd.s * (1 + 0.1 * kk), bt);
      if(q < (many ? 5 : 10)) glowBurst(dd.x, dd.cy0 - 14, dd.s * (1 + 0.06 * kk), bt);
      if(!many || q < 5) for(mi = 0; mi < nSp; mi++) sparkAt(dd.x, dd.cy0 - 14, bt, (q * 1.3 + mi * 2.1 + k) % 6.28, 26 + 6 * kk, 0.7 + 0.08 * kk, mi === 1);
    }
    flushOv();
    shake(Math.min(1.4 + 0.85 * kk, 6.2) * (1 + 0.04 * Math.min(cells.length, 10)), bt, 260);
    for(q = 0; q < mvs.length; q++) flyOne(mvs[q], bt, k);
  });
  /* 落：幣落到鄰格、那一疊跟著彈；排程用盤面已先更新，這裡更新畫面（飛行的幣在自己的補間收尾時收回） */
  FX.at(lt, function(){
    var q, touched = {};
    for(q = 0; q < mvs.length; q++){
      var o = mvs[q], to = o.mv.to;
      if(o.isExit) continue;
      disp.h[to]++; if(o.mv.kind !== 'coin') disp.g[to].push(o.mv.kind);
      touched[to] = (touched[to] || 0) + 1;
    }
    for(var t in touched){ renderCol(+t); bounceAnim(+t, lt, Math.min(0.1 + 0.02 * kk, 0.17)); }
    flushOv();
    emit('wave', { src: src, wave: k, cells: cells.slice(), dom: domCounts() });
  });
}

function flyOne(o, bt, k){                                 // 一枚飛出：弧線、放大一下再落
  var mv = o.mv, f = flightEl(mv.kind, true), sc = kscale(mv.kind);
  o.f = f;
  var dx = o.p1.x - o.x0, dy = o.p1.y - o.y0, dist = Math.sqrt(dx * dx + dy * dy), H = clamp(20 + dist * 0.15, 24, 46);
  var spin = SPIN[mv.dir];
  FX.tw(bt, o.dur, function(p){
    if(o.paid) return;
    var pe = E.out(p) * 0.4 + p * 0.6, y = lerp(o.y0, o.p1.y, pe) - 4 * H * p * (1 - p);
    place(f, lerp(o.x0, o.p1.x, pe), y, sc * lerp(o.s0, o.s1, p) * (1 + 0.2 * Math.sin(p * Math.PI)), spin * p, 1);
  }, function(){ if(!o.isExit) putEl(f); });                 // 落到鄰格的幣在這裡收回；噴出的幣要留著進槽
}

/* —— 噴出盤面的幣：離開當下金額加一次 → 停在噴出的那一邊 → 滑進收集槽排成一列（收集槽區塊：要拿掉就改這裡）—— */
function regExit(o){
  var f = o.f, idx = o.item, item = cur.res.items[idx], mv = o.mv, A = o.A, sc = kscale(mv.kind), trayS = cur.trayS, rows2 = cur.rows2;
  o.amount = item ? item.amount : 0;
  cur.amt += o.amount; cur.exited++;
  setAmt(cur.amt, null); bump($('amt'), A, 0.2, 150);
  popText(312 - (idx % 3) * 24, TR.y - 4, '+' + D.fmt(o.amount), A);
  sparkAt(o.p1.x, o.p1.y, A, 3.9 + mv.dir, 12, 0.8, true);
  cur.tray[idx] = o;
  emit('exit', { amount: o.amount, total: cur.amt, index: idx });
  FX.tw(A, EXHOLD, function(p){ if(o.paid) return; place(f, o.p1.x, o.p1.y, sc * o.s1 * (1 + 0.16 * Math.sin(p * Math.PI)), SPIN[mv.dir], 1); });
  var gt = A + EXHOLD, sx = o.x, sy = o.y, gd = o.gd;
  FX.tw(gt, gd, function(p){
    if(o.paid) return;
    var e = E.io(p), pa = E.out(p);
    place(f, lerp(o.p1.x, sx, e), lerp(o.p1.y, sy, e) - 18 * Math.sin(p * Math.PI), kscale(mv.kind, e) * lerp(o.s1, trayS, e) * (1 + 0.12 * Math.sin(p * Math.PI)), lerp(SPIN[mv.dir], 0, pa), 1);
  }, function(){
    if(o.paid) return;
    var st = kscale(mv.kind, 1) * trayS;
    place(f, sx, sy, st, 0, 1);
    FX.tw(gt + gd, 140, function(p){ if(o.paid) return; place(f, sx, sy - 3 * Math.sin(p * Math.PI), st * (1 + 0.2 * Math.sin(p * Math.PI)), 0, 1); }, function(){ if(!o.paid) place(f, sx, sy, st, 0, 1); });
  });
}

/* =========================================================================
 * 金幣雨（只讀 result.rain）：預告（條全亮、畫面暗一下）→ 25 枚同時落下（五道光柱）→ rain.waves 逐波 → 條邊退邊閃、雨停歸零
 * 接在 main 各波之後；回傳這場雨演完（最後一波落下、條歸零）的時間。時間軸上每個動作都用 FX.at／FX.tw 各自掛在絕對時間上，
 * 狀態變更（盤面、能量條值）只在計時器裡做，補間只管畫面——時間一次跳很遠也依序，finishRound 再統一補齊。
 * ========================================================================= */
function schedRain(res, T0){
  var rain = res.rain, S = cur.S, cells = rain.fall, tF = T0 + RAIN_PRE, tLand = tF, dim = $('dim'), beams = $('beams'), mt = $('mt'), j;
  cur.rainT = { pre: T0, fall: tF };
  /* —— 預告：條全亮、整條閃、畫面暗一下 —— */
  FX.at(T0, function(){ mvMode(true, false); emit('rainPre', { result: res, dom: domCounts() }); });
  meterAnim(T0, RAIN_PRE, MAX, MAX, E.lin, function(p){
    var w = Math.sin(p * Math.PI * 2 * 3.5);
    mtr.el.hot.style.opacity = n2(clamp(0.55 + 0.9 * w, 0.2, 1));
    mtr.el.ml.style.opacity = n2(clamp(0.7 + 0.5 * w, 0.35, 1));
  });
  for(j = 0; j < 3; j++) bump(mt, T0 + 60 + j * 180, 0.05 + 0.02 * j, 170);
  for(j = 0; j < 10; j++) sparkAt(MT.x + 24 + j * 29, MT.y + 12 + (j % 2) * 20, T0 + 40 + j * 48, -1.57 + ((j % 3) - 1) * 0.6, 16, 0.85, j % 2 === 0);
  FX.tw(T0, 220, function(p){ dim.style.opacity = n2(0.58 * E.out(p)); });
  FX.tw(tF, 300, function(p){ dim.style.opacity = n2(0.58 * (1 - E.out(p))); }, function(){ dim.style.opacity = '0'; });
  FX.tw(tF - 140, 260, function(p){ beams.style.opacity = n2(E.out(p)); });
  /* —— 25 枚同時落下：每格一枚，起跑錯開 ≤RAIN_JIT，沿著光柱掉進自己那一格 —— */
  for(j = 0; j < cells.length; j++){
    (function(c){
      var d = cols[c].d, nc = clamp(S.h[c] - S.g[c].length, 0, 3), y1 = d.cy0 - 11 * d.s * nc;
      var ts = tF + ((c * 37) % 25) / 25 * RAIN_JIT, dur = RAIN_DUR + ((c / COLS) | 0) * 8, tl = ts + dur;
      var x0 = d.x + (((c * 29) % 13) - 6) * 0.9, rot0 = ((c * 53) % 70) - 35, f = null, tr = null;
      S.h[c]++;
      pendingDrops++;
      if(tl > tLand) tLand = tl;
      FX.at(ts, function(){ f = flightEl('coin', true); f.style.opacity = '0'; if(c % 2 === 0){ tr = getEl('trl'); tr.style.opacity = '0'; } });   // 拖尾隔格畫（元件數）
      FX.tw(ts, dur, function(p){
        if(!f) return;
        var e = 0.3 * p + 0.7 * E.in(p), x = lerp(x0, d.x, e), y = lerp(176, y1, e);
        place(f, x, y, lerp(0.62, d.s * 1.16, E.out(p)), rot0 * (1 - e), Math.min(1, 0.3 + p * 2));
        if(tr){ tr.style.transform = 'translate3d(' + n2(x) + 'px,' + n2(y - 2) + 'px,0) scale(1,' + n2((26 + 44 * e) / 80) + ')'; tr.style.opacity = n2(0.25 + 0.6 * e); }
      }, function(){ if(f){ putEl(f); if(tr) putEl(tr); f = null; tr = null; } });
      FX.at(tl, function(){                                  // 落地：這一格 +1（畫面上的幣柱）、那一疊彈一下、發亮
        pendingDrops--;
        disp.h[c]++; renderCol(c); flushOv(); bounceAnim(c, tl, 0.1);
        landFlash(c, tl);
        if(c % 4 === 0) sparkAt(d.x, d.cy0 - 10, tl, -1.2 + (c % 5) * 0.4, 20, 0.8, c % 8 === 0);
      });
    })(cells[j]);
  }
  FX.at(tLand - 90, function(){ shake(2.4, tLand - 90, 240); });   // 整片落地：盤面震一下
  FX.at(tF + RAIN_JIT + 30, function(){ emit('rainFall', { result: res, dom: domCounts(), falling: fallingCoins() }); });
  for(j = 0; j < 14; j++){                                   // 雨絲：裝飾，只在落下的這一小段
    (function(j){
      var x = 20 + ((j * 83 + 17) % 335), y0 = 188 + ((j * 47) % 90), st = tF + (j % 7) * 18, dur = 300 + (j % 4) * 40, el = null;
      FX.at(st, function(){ el = getEl('rs'); el.style.opacity = '0'; });
      FX.tw(st, dur, function(p){ if(el) place(el, x, y0 + p * 250, 1, 0, 0.7 * Math.sin(p * Math.PI)); }, function(){ if(el){ putEl(el); el = null; } });
    })(j);
  }
  FX.at(tLand, function(){ emit('rainLanded', { result: res, dom: domCounts() }); });
  FX.tw(tLand + 60, 340, function(p){ beams.style.opacity = n2(1 - E.out(p)); }, function(){ beams.style.opacity = '0'; });
  /* —— rain.waves 逐波（和 main 同一套壓→彈→飛→落）；條從落下開始一路退到雨停 —— */
  var T1 = schedPart(rain, 'rain', tLand + 10), tEnd = Math.max(T1, tF + 900);
  schedDrain(tF, tEnd);
  FX.at(tEnd, function(){                                    // 雨停：條歸零後顯示新的值
    mtr.tok++; mvMode(false, false); meterSet(res.meterAfter);
    bump(mt, tEnd, 0.06, 220);
    emit('rainEnd', { result: res, meter: res.meterAfter });
  });
  cur.rainT.end = tEnd; cur.rainT.land = tLand;
  return tEnd;
}
function landFlash(i, t0){                                   // 落地的那一格發亮一下（不加元件）
  FX.tw(t0, 280, function(p){ bv[i].style.opacity = n2(0.55 * (1 - E.out(p))); }, function(){ bv[i].style.opacity = ''; });
}
function fallingCoins(){                                     // 讀畫面：現在空中有幾枚落下的幣、各在哪一欄（探針用）
  var kids = elFx.children, i, out = [], r, rw = elWorld.getBoundingClientRect(), k = rw.width / 375;
  for(i = 0; i < kids.length; i++){
    var el = kids[i];
    if(el.style.display === 'none' || !/(^| )fc( |$)/.test(el.className) || el.style.opacity === '0') continue;
    r = el.getBoundingClientRect();
    var cx = (r.left + r.width / 2 - rw.left) / k, cy = (r.top + r.height / 2 - rw.top) / k;
    if(cy > 170 && cy < 545) out.push({ x: n2(cx), y: n2(cy) });                  // 只算盤面範圍內（收集槽裡的幣不算）
  }
  return out;
}
/* 條邊退邊閃：從滿格線性退到 0（和雨同長），閃爍＝亮面層與外框明暗交替，火花從條的頭噴出 */
function schedDrain(tA, tB){
  var pulses = Math.max(8, Math.round((tB - tA) / 300)), lastSp = tA;
  FX.at(tA, function(){ mvMode(true, true); });
  meterAnim(tA, tB - tA, MAX, 0, E.lin, function(p){
    var w = Math.sin(p * Math.PI * 2 * pulses), now = FX.now();
    mtr.el.hot.style.opacity = n2(clamp(0.5 + 1.1 * w, 0.06, 1));
    mtr.el.ml.style.opacity = n2(clamp(0.6 + 0.8 * w, 0.3, 1));
    if(now - lastSp > 110){ lastSp = now; sparkAt(MT.x + MX0 + mtr.v * MDX, MT.y + MHY + (now % 2 ? -7 : 7), now, -1.6 + ((now | 0) % 3 - 1) * 0.8, 15, 0.7, (now | 0) % 2 === 0); }
  });
}

/* —— 分級回饋（門檻＝鐵表，由核心的 result.tier 給）—— */
function tierFx(F0, tier){
  var res = cur.res, bigWord = res.exitCount >= 4 || res.potWin > 0;
  if(tier === 'none') return;
  var pw = res.potWin > 0;                                 // 拿了獎池：金額的滾動與大跳由 schedPot 的「落下」負責，這裡只管顏色
  FX.at(F0, function(){
    setAmt(cur.amt, tier, pw);
    if(!pw) bump($('amt'), F0, tier === 'back' ? 0.25 : 0.4, 220);
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
      confetti(tier === 'huge' ? (res.hasRain ? 22 : 28) : 16, F0);
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
  putEl(it.f);
  setBal(cur.balBase + cur.paidAmt);
  if(t != null){ bump($('bal'), t, 0.07, 150); sparkAt(WAL.x, WAL.y, t, -0.6, 14, 0.6, true); }
}
function schedPay(i, t0){
  FX.at(t0, function(){
    var it = cur.tray[i];
    if(!it) return;                                        // 時間軸一次跳太遠（探針加速、分頁卡頓）時這枚還沒進槽：交給 finishRound 補齊
    var f = it.f, sx = it.x, sy = it.y, trayS = cur.trayS;
    FX.tw(t0, PAYDUR, function(p){
      if(it.paid) return;
      var e = E.in(p) * 0.55 + p * 0.45;
      place(f, lerp(sx, WAL.x, e), lerp(sy, WAL.y, e) - 70 * Math.sin(p * Math.PI) * (1 - p * 0.3), kscale(it.kind, 1 - p * 0.5) * lerp(trayS, 0.4, p), p * 40, p > 0.85 ? (1 - p) / 0.15 : 1);
    }, function(){ deliver(it, t0 + PAYDUR); });
  });
}

/* =========================================================================
 * 連鎖獎池（v2.3）：
 *   常駐：圖例那一排的左邊（setPot／potTick）。每丟一枚，丟下去落地的那一刻跳到「這一注之前＋這一注存的」並跳一下、冒一個 +15／+75／+150。
 *   拿到時（result.potWin > 0，自己連鎖炸到門檻或下雨）：連鎖／雨演完、最後一枚幣進槽之後——
 *     蓄力（獎池徽章放大、震波、火花）→ 整筆獎池變成一張橘金色的牌飛進收集槽的金額（飛的時候獎池數字倒數到 0）→
 *     落下：金額一次大跳（滾動＋放大彈一下）、閃光、震波、灑幣，槽的右上角留一顆爆炸徽章＝「這筆含獎池」→
 *     之後隨落袋，同一張牌再整筆飛進錢包（餘額一次大跳）。獎池從 0 重新開始。
 *   時間軸上的事件都能容忍前一步沒完成，finishRound 統一補齊（獎池數字、金額、餘額、飛行牌）。
 * ========================================================================= */
function potTick(res, t0){                                 // 丟入落地：獎池數字＝這一注之前＋這一注存的
  setPot(res.potBefore + res.potAdd);
  bump($('pot'), t0, 0.1, 180);
  popText(PX + 10, PY - 18, '+' + D.fmt(res.potAdd), t0, 'pp pq');
  sparkAt(PX - 20, PY - 4, t0, -1.2, 12, 0.6, true);
}
function lumpEl(amount){                                   // 拿獎池的飛行牌：爆炸徽章＋金額
  var el = getEl('plm');
  el.innerHTML = '<i class="ico bst"></i><span>' + D.fmt(amount) + '</span>';
  cur.lumps.push(el);
  return el;
}
function schedPot(F0){                                     // 回傳「獎池落進金額」的時間；分級回饋與落袋從這個時間算起
  var res = cur.res, win = res.potWin, tot = res.potBefore + res.potAdd, pot = $('pot');
  var tc = F0 + POT_PRE, tf = tc + POT_CHARGE, tl = tf + POT_FLY, lump = null;
  cur.potT = { charge: tc, fly: tf, land: tl, pay: 0, paid: 0 };
  /* 蓄力：徽章放大、震動、震波＋火花 */
  FX.at(tc, function(){
    emit('potCharge', { result: res, pot: shownPot });
    ring(PX, PY, 1.15, tc); ring(PX, PY, 1.5, tc + 130);
    glowBurst(PX - 20, PY, 0.9, tc);
    for(var j = 0; j < 8; j++) sparkAt(PX - 20 + Math.cos(j * 0.8) * 8, PY + Math.sin(j * 0.8) * 6, tc + j * 30, j * 0.8 - 0.4, 34, 0.9, j % 2 === 0);
  });
  FX.tw(tc, POT_CHARGE, function(p){
    var e = E.out(Math.min(1, p * 1.6)), sh = Math.sin(p * 38) * 2.2 * (1 - p);
    pot.style.transform = 'translate3d(' + n2(sh) + 'px,0,0) scale(' + n2(1 + 0.13 * e) + ')';
  }, function(){ pot.style.transform = ''; });
  /* 飛：整筆獎池（一張牌）飛進收集槽的金額；獎池數字同時倒數到 0 */
  FX.at(tf, function(){
    emit('potFly', { result: res });
    lump = lumpEl(win); lump.style.opacity = '0';
  });
  potRoll(tot, 0, tf, POT_FLY * 0.8, E.in);
  FX.tw(tf, POT_FLY, function(p){
    if(!lump || lump._free) return;
    var e = E.io(p), x = lerp(PX + 14, AX, e), y = lerp(PY, AY, e) - 82 * Math.sin(p * Math.PI);
    place(lump, x, y, lerp(0.85, 1.32, Math.sin(Math.min(1, p * 1.3) * Math.PI / 2)) * (p > 0.8 ? lerp(1, 0.9, (p - 0.8) / 0.2) : 1), lerp(-10, 6, e), Math.min(1, p * 6));
    if(p > 0.04 && p < 0.9 && ((p * 40) | 0) !== ((cur.lastTrail || 0) | 0)){ cur.lastTrail = p * 40; sparkAt(x - 14, y + 6, FX.now(), 2.6, 14, 0.7, ((p * 40) | 0) % 2 === 0); }
  }, function(){ if(lump){ putEl(lump); lump = null; } });
  /* 落：金額一次大跳 */
  FX.at(tl, function(){
    var a0 = cur.amt;
    if(!cur.potLanded){ cur.potLanded = true; cur.amt += win; }
    setPot(res.potAfter);
    $('amtB').style.opacity = '1';
    amtRoll(a0, cur.amt, tl, 460, cur.tier);
    $('amt').className = 'gold hud';
    bump($('amt'), tl, 0.75, 520);
    var mk = $('amtB');                                    // 蓋章：爆炸徽章從大縮到定位，表示「這筆含獎池」
    FX.tw(tl, 460, function(p){ var e = E.out(p); mk.style.opacity = n2(Math.min(1, p * 5)); mk.style.transform = 'scale(' + n2(lerp(3.4, 1, e)) + ') rotate(' + n2(lerp(-28, 0, e)) + 'deg)'; }, function(){ mk.style.transform = ''; });
    shake(5.2, tl, 320);
    ring(AX, AY, 1.5, tl); ring(AX, AY, 2.1, tl + 110);
    glowBurst(AX, AY, 1.9, tl);
    setTrayGold(1, 1);
    FX.tw(tl, 520, function(p){ setTrayGold(1 - 0.35 * p, 1 - p); }, function(){ setTrayGold(0.65, 0); });
    if(cur.tier === 'none' || cur.tier === 'back') FX.tw(tl, 300, function(p){ $('flash').style.opacity = n2(0.34 * (1 - E.out(p))); }, function(){ $('flash').style.opacity = '0'; });
    for(var j = 0; j < 12; j++) sparkAt(AX - 40 + (j % 6) * 16, AY - 8 + (j % 2) * 12, tl + j * 25, -1.57 + (j - 6) * 0.3, 34, 1, j % 2 === 0);
    if(cur.tier === 'none' || cur.tier === 'back') confetti(14, tl);
    emit('potLand', { result: res, amt: cur.amt });
  });
  return tl;
}
function deliverPot(t){                                    // 獎池那一筆到錢包：餘額一次大跳（idempotent）
  var c = cur, win = c.res.potWin;
  if(c.potPaid) return;
  c.potPaid = true; c.paidAmt += win;
  setBal(c.balBase + c.paidAmt);
  if(t != null){
    bump($('bal'), t, 0.18, 300);
    ring(WAL.x + 40, WAL.y, 1.0, t); glowBurst(WAL.x + 30, WAL.y, 1.1, t);
    popText(WAL.x + 92, WAL.y + 34, '+' + D.fmt(win), t, 'pp pb');
    for(var j = 0; j < 8; j++) sparkAt(WAL.x + 20 + (j % 4) * 22, WAL.y + (j % 2) * 10, t + j * 30, -0.4 + j * 0.2, 26, 0.9, j % 2 === 0);
    emit('potPaid', { result: c.res });
  }
}
function schedPotPay(PL){                                  // 獎池那一筆從金額飛進錢包
  var res = cur.res, win = res.potWin, c = cur;
  FX.at(PL, function(){
    var f = lumpEl(win);
    FX.tw(PL, POT_PAYDUR, function(p){
      if(f._free) return;
      var e = E.in(p) * 0.5 + p * 0.5, x = lerp(AX, WAL.x + 30, e), y = lerp(AY, WAL.y, e) - 90 * Math.sin(p * Math.PI) * (1 - p * 0.3);
      place(f, x, y, lerp(1.1, 0.7, p), p * -14, p > 0.9 ? (1 - p) / 0.1 : 1);
      if(((p * 22) | 0) !== ((c.lastTrail2 || 0) | 0)){ c.lastTrail2 = p * 22; sparkAt(x + 10, y + 8, FX.now(), 0.6, 12, 0.6, true); }
    }, function(){ putEl(f); deliverPot(PL + POT_PAYDUR); });
  });
}

/* —— 一注的總排程 —— */
function startRound(res, p){
  var o = (p && p.o) || {}, t0 = FX.now(), T0 = t0, i;
  var N = res.items.length;
  cur = { res: res, o: o, p: p, S: { h: res.boardBefore.h.slice(), g: res.boardBefore.g.map(function(x){ return x.slice(); }) },
          itemIdx: 0, lastArr: t0, amt: 0, exited: 0, balBase: 0, paidAmt: 0, wavesT: [], rwavesT: [], tray: [], rainT: null,
          lumps: [], potT: null, potLanded: false, potPaid: false, lastTrail: 0, lastTrail2: 0 };
  /* 收集槽：枚數多時排得更密；超過 15 枚排兩列（一列最擠 15 枚、間距 14.1，和兩列的間距上限 14 銜接；原本 24 枚才分列，21～24 枚會擠成間距 9 的一列） */
  cur.rows2 = N > 15;
  var per = cur.rows2 ? Math.ceil(N / 2) : N;
  cur.step = cur.rows2 ? Math.min(14, 198 / Math.max(1, per - 1)) : (N > 10 ? 198 / (N - 1) : SLOTW);
  cur.trayS = cur.rows2 ? 0.34 : TRAYS;
  FX.setSpeed(baseSpeed() * (o.fast ? HI / baseSpeed() : 1) * (o.speed || 1));
  hideBanner(); $('flash').style.opacity = '0';
  setTrayGold(0, 0); setAmt(0, null); payoutPhase = false;
  hideHints(); $('amtB').style.opacity = '0';
  setPot(res.potBefore); $('pot').style.transform = '';   // 獎池從這一注之前的值開始（丟下去落地才加上這一注存的）
  mtr.tok++; mvMode(false, false); meterSet(res.meterBefore);   // 能量條從這一注之前的值開始
  STATS.rounds++;
  emit('roundStart', { result: res });
  T0 = schedDrop(res.cell, res.kind, T0);
  if(res.quiet){                                           // 沒爆也沒金幣雨：立刻 ack，不鎖操作，可以連點
    var cq = cur;
    game.ack();
    cq.rec = game.getRecords(1)[0] || null;
    FX.at(T0 + 2, function(){ resolveRound(res, true, cq); });
    return;
  }
  busy = true;
  T0 = schedPart(res.main, 'main', T0);
  if(res.hasRain) T0 = schedRain(res, T0);
  var tier = res.hasRain ? 'huge' : res.tier;              // 金幣雨固定用最高一級的全畫面回饋
  var F0 = Math.max(T0, cur.lastArr) + 80, n = N;
  cur.F0 = F0; cur.tier = tier;
  FX.at(F0, function(){
    payoutPhase = true; cur.balBase = shownBal; cur.paidAmt = 0;
    emit('chainEnd', { result: res, tray: cur.tray.filter(Boolean).length, amt: cur.amt, potWin: res.potWin });
  });
  var TL = res.potWin > 0 ? schedPot(F0) : F0;             // 拿獎池：獎池落進金額的時間；分級回饋與落袋都從這裡算起
  cur.TL = TL;
  tierFx(TL, tier);
  var P0 = TL + TIER_DELAY[tier], gap = n ? clamp(PAYMAX / n, 30, 90) : 0;
  for(i = 0; i < n; i++) schedPay(i, P0 + i * gap);
  var payEnd = n ? P0 + (n - 1) * gap + PAYDUR : TL;
  var ackT = Math.max(payEnd, TL + TIER_DUR[tier]) + 120;
  if(res.potWin > 0){                                      // 獎池那一筆在最後幾枚幣落袋時整筆飛進錢包，餘額最後一次大跳
    var PL = n ? P0 + (n - 1) * gap + Math.round(PAYDUR * 0.4) : P0;
    schedPotPay(PL);
    cur.potT.pay = PL; cur.potT.paid = PL + POT_PAYDUR;
    ackT = Math.max(ackT, PL + POT_PAYDUR + 160);
  }
  cur.ackT = ackT;
  FX.at(ackT, function(){ finishRound(); });
  if(o.freeze) applyFreeze(o.freeze, p);
}

function applyFreeze(fz, p){                               // 截圖用：停在時間軸的某一點
  var t, R = cur.rainT;
  if(fz.wave != null) t = cur.wavesT[fz.wave] + (fz.frac || 0) * (PRESS + FLY);
  else if(fz.rwave != null) t = cur.rwavesT[fz.mid ? Math.floor(cur.rwavesT.length / 2) : Math.min(fz.rwave, cur.rwavesT.length - 1)] + (fz.frac || 0.55) * (PRESS + FLY);
  else if(fz.at === 'rainPre' && R) t = R.pre + (fz.add || 0);
  else if(fz.at === 'rainFall' && R) t = R.fall + (fz.add || 0);
  else if(fz.at === 'rainEnd' && R) t = R.end + (fz.add || 0);
  else if(fz.at === 'chainEnd') t = cur.F0 + (fz.add || 0);
  else if(fz.at === 'tier') t = cur.TL + (fz.add || 0);       // 分級回饋開始的時間（拿了獎池＝獎池落進金額的那一刻；沒拿＝連鎖結束）
  else if(fz.at && /^pot/.test(fz.at) && cur.potT){ var PT = cur.potT; t = ({ potCharge: PT.charge, potFly: PT.fly, potLand: PT.land, potPay: PT.pay, potPaid: PT.paid })[fz.at] + (fz.add || 0); }
  else t = cur.ackT;
  FX.freezeAt(t, function(){ if(p && p.res) p.res({ frozen: true, result: cur.res }); });
}

function finishRound(){
  var c = cur, res = c.res, q;
  for(q = 0; q < c.tray.length; q++) if(c.tray[q]) deliver(c.tray[q], null);   // 沒飛完的先補齊，餘額才不會被晚到的補間重複加
  if(res.potWin > 0){                                      // 獎池也統一補齊：金額＝拿回（含獎池）、飛行牌收掉、餘額加上獎池
    c.potLanded = true; c.amt = res.payout; setAmt(res.payout, c.tier); $('amtB').style.opacity = '1';
    deliverPot(null);
  }
  for(q = 0; q < c.lumps.length; q++) putEl(c.lumps[q]);
  $('pot').style.transform = '';
  setPot(res.potAfter);
  payoutPhase = false;
  $('dim').style.opacity = '0'; $('beams').style.opacity = '0';                 // 金幣雨的收尾也統一補齊：幕、光柱、能量條回到核心給的值
  mtr.tok++; mvMode(false, false); meterSet(res.meterAfter);
  var before = shownBal;
  game.ack();                                              // 'wallet' 事件會把餘額對齊核心
  busy = false;
  if(before !== game.getWallet()) STATS.balFix++;
  verifyBoard();
  updHints();
  resolveRound(res, false);
}
function resolveRound(res, quiet, c0){
  var c = c0 || cur, rec = (c && c.rec) || game.getRecords(1)[0] || null;
  var out = { orderId: res.orderId, stake: res.stake, pay: res.payout, payout: res.payout, net: res.net, mult: res.mult,
              tier: res.tier, rain: !!res.hasRain, potWin: res.potWin, quiet: quiet, result: res, record: rec, wallet: game.getWallet() };
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
    if(o.plan && DEV_OK) game.armNext(o.plan);       // 指定結果只在 ?dev／?shot 才認（預設網址不留後門）
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

function onDenom(){                                        // 換面額＝換一張盤面（連同它自己的能量條）：整盤落下再升起
  disp = game.getBoard();
  mtr.tok++; mvMode(false, false); meterSet(game.getMeter());
  setPot(game.getPot()); $('amtB').style.opacity = '0';     // 換面額：顯示那張盤面自己的獎池
  renderAll(); updTabs(); updLegend(); updateFirst(); updHints();
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
  mtr.tok++; mvMode(false, false); meterSet(game.getMeter());
  /* 重置後不再出現「只亮一格」（2026-11-26 用戶裁決：重置只是讓沒錢時能繼續測試）；firstSeen 維持原值 */
  hideBanner(); setAmt(0, null); setTrayGold(0, 0);
  setPot(game.getPot()); $('amtB').style.opacity = '0';     // 重置錢包不動獎池（clearSaved 才歸零，探針用）
  renderAll(); updTabs(); updLegend(); updateFirst(); updHints();
}
function resetWallet(){
  if(busy){ Toast.show(T('log.noReset')); return false; }
  if(window.Autobet && Autobet.isRunning && Autobet.isRunning()) Autobet.stop();
  if(!game.resetWallet()) return false;                 // 只補錢；盤面與能量條不動（2026-11-26 用戶「重置錢包不要刷新盤面啊」）
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

var hntBtn = $('hintBtn');
function renderHnt(){
  hntBtn.classList.toggle('on', hintOn);
  hntBtn.setAttribute('aria-pressed', hintOn ? 'true' : 'false');
  hntBtn.title = T(hintOn ? 'top.hint.on' : 'top.hint.off');
}
function setHint(v){
  v = !!v;
  if(v === hintOn) return;
  hintOn = v; D.ls('hint', v ? 'on' : 'off'); renderHnt(); updHints();
  emit('hint', { on: v });
}
hntBtn.onclick = function(){ setHint(!hintOn); };

game.on(function(type, d){
  if(type === 'wallet'){ if(!payoutPhase) setBal(d.wallet); }
  else if(type === 'result') onResult(d);
  else if(type === 'denom') onDenom(d);
  else if(type === 'reset') onReset(d);
  else if(type === 'pot'){                                 // 導演台改了獎池：目前面額的數字直接換
    if(d.denomIndex === game.getDenomIndex()){ setPot(d.pot); bump($('pot'), FX.now(), 0.12, 220); }
  }
  else if(type === 'meter'){                               // 導演台改了能量條：目前面額的條直接換，分頁小條跟著
    if(d.denomIndex === game.getDenomIndex()){ mtr.tok++; mvMode(false, false); meterSet(d.meter); }
    updTabs();
  }
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
buildStyles(); buildScene(); buildCols(); buildTray(); buildHud(); buildMeter();
meterSet(game.getMeter());
renderAll(); updTabs(); updLegend(); updateFirst();
setBal(game.getWallet()); setAmt(0, null); renderSpd(); renderHnt(); setPot(game.getPot()); fitWorld();
fitText($('wal'), 112, 20, 12);
updHints();

function snapshot(){
  var cells = [], i;
  for(i = 0; i < NN; i++) cells.push({ h: +cols[i].el.getAttribute('data-h'), g: cols[i].el.getAttribute('data-g') || '' });
  var gold = $('trayGold').style.opacity;
  return { meter: mtr.v, pot: $('potN').textContent, potMark: +$('amtB').style.opacity, cells: cells, wallet: $('wal').textContent, amt: $('amtN').textContent, amtCls: $('amt').className,
           tray: cur ? cur.tray.filter(Boolean).length : 0, banner: $('banner').textContent, bannerOn: $('banner').style.opacity, gold: gold };
}

D.ui = {
  on: on, off: off, play: play, busy: function(){ return busy; }, isBusy: function(){ return busy; },
  setDenom: setDenom, getDenom: function(){ return game.getDenomIndex(); },
  setFast: setFast, isFast: function(){ return hiSpeed; }, resetWallet: resetWallet,
  cellInfo: function(i){ return { h: +cols[i].el.getAttribute('data-h'), g: cols[i].el.getAttribute('data-g') || '' }; },
  snapshot: snapshot, stats: function(){ return { desync: STATS.desync, balFix: STATS.balFix, rounds: STATS.rounds }; },
  isFirstRun: function(){ return firstOn(); }, setTapGuard: function(fn){ tapGuard = fn; }, meterDom: meterDom,
  setHint: setHint, isHint: function(){ return hintOn; }, hintDom: hintDom, potDom: function(){ return { text: $('potN').textContent, zero: $('pot').classList.contains('z'), shown: shownPot }; },
  timeline: function(){ return cur ? { wavesT: cur.wavesT.slice(), rwavesT: cur.rwavesT.slice(), rainT: cur.rainT ? { pre: cur.rainT.pre, fall: cur.rainT.fall, land: cur.rainT.land, end: cur.rainT.end } : null, press: PRESS, fly: FLY, F0: cur.F0, TL: cur.TL, ackT: cur.ackT, tier: cur.tier, items: cur.res.items.length, potT: cur.potT ? { charge: cur.potT.charge, fly: cur.potT.fly, land: cur.potT.land, pay: cur.potT.pay, paid: cur.potT.paid } : null } : null; },   // 演出時間表（虛擬毫秒，截圖與探針量長度用）
  thaw: function(){ FX.thaw(); }, fx: FX
};

/* =========================================================================
 * ?shot= 截圖畫面（dev.js 的自動駕駛分派到這裡；這些畫面靠 ?shot 才有 setMeter／armNext，預設網址沒有）
 *   idle＝丟一枚沒爆的幣（盤面已不是起始）　first＝第一次進場　chain＝連爆停在第 3 波中途　win＝回本（這一注的第一下）
 *   big＝大連爆　huge＝全畫面　gem＝寶物在盤上　denom＝換面額後
 *   meter-mid＝能量條約一半　meter-near＝快滿（金框脈動＋追光）　rain＝金幣雨第 1 波炸開中　rain-done＝金幣雨結束（超級連爆）
 *   另有 seq-1…seq-6：同一注（起始發光格）逐波中途的序列圖；seq-rain-1…6：金幣雨逐段（預告、落下中、第 1 波、中段、進槽、結束）
 *   v2.3：pot-idle／pot-win／hint-off／seq-pot-1…6（見檔尾）
 * ========================================================================= */
var TURBO = 40;
function wait(ms, fn){ setTimeout(fn, ms); }
function quiet(cell, plan){ return play(cell, { plan: plan || { kind: 'coin' }, speed: TURBO }); }
function seqRun(list, cb){                                 // 依序跑 [fn() → Promise]
  var i = 0;
  (function next(){ if(i >= list.length){ cb(); return; } list[i++]().then(function(){ wait(30, next); }); })();
}
/* 把盤面養到「15 格左右疊到 3 枚」：反覆丟在剛好 2 枚的格（丟下去變 3 枚、不會爆）；能量條先壓在 0，養完再由各畫面設值 */
function growBoard(cb){
  game.setMeter(0);
  var steps = [], k;
  for(k = 0; k < 40; k++) steps.push(function(){
    var b = game.getBoard(), pick = -1, hot = 0, i;
    for(i = 0; i < NN; i++){ if(b.h[i] >= CAP - 1) hot++; else if(b.h[i] === CAP - 2 && pick < 0) pick = i; }
    if(hot >= 15 || pick < 0) return Promise.resolve();
    return quiet(pick);
  });
  seqRun(steps, function(){ game.setMeter(0); cb(); });
}
function rainCell(){ var b = game.getBoard(), i; for(i = 0; i < NN; i++) if(b.h[i] < CAP - 1) return i; return 0; }
D.shots = D.shots || {};
D.shots.first = function(done){ wait(80, done); };
D.shots.idle = function(done){ quiet(3).then(function(){ wait(120, done); }); };
D.shots['gem-mid'] = function(done){ quiet(8, { kind: 'diamond' }).then(function(){ wait(150, done); }); };   // 寶物不在邊上（箭頭較長）
D.shots.gem = function(done){ quiet(10, { kind: 'diamond' }).then(function(){ wait(150, done); }); };
D.shots.denom = function(done){ quiet(3).then(function(){ setDenom(1); wait(600, done); }); };
D.shots.chain = function(done){ play(game.glowCell(), { freeze: { wave: 2, frac: 0.5 } }).then(function(){ done(); }); };
D.shots.win = function(done){ play(game.glowCell(), { freeze: { at: 'tier', add: 280 } }).then(function(){ done(); }); };
D.shots.big = function(done){
  game.setMeter(0);
  quiet(0).then(function(){ return quiet(0); }).then(function(){ return play(0, { plan: { kind: 'coin' }, freeze: { at: 'tier', add: 420 } }); }).then(function(){ done(); });
};
D.shots.huge = function(done){
  game.setMeter(0);
  quiet(0).then(function(){ return quiet(0, { kind: 'diamond' }); }).then(function(){ return play(0, { plan: { kind: 'diamond' }, freeze: { at: 'tier', add: 760 } }); }).then(function(){ done(); });
};
D.shots['meter-mid'] = function(done){ quiet(3).then(function(){ game.setMeter(Math.round(MAX / 2)); wait(200, done); }); };
D.shots['meter-near'] = function(done){ growBoard(function(){ game.setMeter(MAX - NEAR_N); wait(250, done); }); };
D.shots.rain = function(done){
  growBoard(function(){ game.setMeter(MAX - 1); play(rainCell(), { plan: { kind: 'coin' }, speed: 3, freeze: { rwave: 0, frac: 0.55 } }).then(function(){ done(); }); });
};
D.shots['rain-done'] = function(done){
  growBoard(function(){ game.setMeter(MAX - 1); play(rainCell(), { plan: { kind: 'coin' }, speed: 3, freeze: { at: 'tier', add: 900 } }).then(function(){ done(); }); });
};
D.shots['seq-press'] = function(done){ play(game.glowCell(), { freeze: { wave: 2, frac: 0.3 } }).then(function(){ done(); }); };   // 第 3 波的「壓」
D.shots['seq-exit'] = function(done){ play(game.glowCell(), { freeze: { wave: 3, frac: 1.1 } }).then(function(){ done(); }); };   // 噴出的幣停在邊上
[1, 2, 3, 4, 5, 6].forEach(function(n){
  D.shots['seq-' + n] = function(done){ play(game.glowCell(), { freeze: { wave: n - 1, frac: 0.55 } }).then(function(){ done(); }); };
});
/* 金幣雨逐段序列：預告、落下中、第 1 波、中段、進槽、結束 */
var RAIN_SEQ = [{ at: 'rainPre', add: 400 }, { at: 'rainFall', add: 230 }, { rwave: 0, frac: 0.55 }, { rwave: 0, mid: true, frac: 0.55 }, { at: 'chainEnd', add: -200 }, { at: 'tier', add: 900 }];
[1, 2, 3, 4, 5, 6].forEach(function(n){
  D.shots['seq-rain-' + n] = function(done){
    var fz = {}, k; for(k in RAIN_SEQ[n - 1]) fz[k] = RAIN_SEQ[n - 1][k];
    growBoard(function(){
      game.setMeter(MAX - 1);
      play(rainCell(), { plan: { kind: 'coin' }, speed: 3, freeze: fz }).then(function(){ done(); });
    });
  };
});

/* —— v2.3 獎池與提示 ——
   pot-idle＝獎池累積到 6 倍面額、提示開著、盤面上有三格能炸 8 格以上（POT_SEQ 是從起始盤面丟 8 枚金幣得到的固定盤面：核心結果只取決於盤面與丟的是什麼）
   pot-win＝拿到獎池的那一刻（金額一次大跳）　hint-off＝提示關掉的待命畫面　seq-pot-1…6＝拿獎池逐段（連鎖結束、蓄力、飛行、金額大跳、飛進錢包、歸零） */
var POT_SEQ = [16, 5, 19, 6, 10, 17, 20, 19];
D.shots['pot-idle'] = function(done){
  seqRun(POT_SEQ.map(function(c){ return function(){ return quiet(c); }; }), function(){ game.setPot(6 * game.getDenom()); wait(600, done); });
};
D.shots['hint-off'] = function(done){ quiet(3).then(function(){ setHint(false); wait(300, done); }); };
function potRun(fz, done){ game.setPot(6 * game.getDenom()); play(game.glowCell(), { plan: { kind: 'coin' }, freeze: fz }).then(function(){ wait(200, done); }); }
D.shots['pot-win'] = function(done){ potRun({ at: 'potLand', add: 150 }, done); };
var POT_SEQS = [{ at: 'chainEnd', add: 0 }, { at: 'potCharge', add: 260 }, { at: 'potFly', add: 300 }, { at: 'potLand', add: 150 }, { at: 'potPay', add: 280 }, null];
[1, 2, 3, 4, 5, 6].forEach(function(n){
  D.shots['seq-pot-' + n] = function(done){ potRun(POT_SEQS[n - 1] || undefined, done); };
});

window.__demoReady = true;
})();
