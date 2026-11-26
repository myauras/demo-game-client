/* =========================================================================
 * 爆金連鎖——模組接線（C03）：自動下注（Autobet）、勝負紀錄頁（LogUI）
 *
 * 底板的兩個模組不認識玩法，只吃 adapter／record；這裡把它們接到主畫面（DEMO.ui）與核心（DEMO.game）：
 *
 * 自動下注
 *   - 一局＝丟一枚。選格固定一種（用戶定案），設定面板不給選：
 *       盤面上有疊 3 枚的格子 → 從中隨機挑一格；沒有 → 25 格隨機一格。
 *     只看盤面「每格幾枚」（玩家畫面上也看得到的資訊），不看寶物、不預看結果、不碰核心的 rng；
 *     選格用自己的小亂數（pickRng），和核心 rng 完全分開。
 *   - 每局等演出結束（ui.play 的 Promise）才下一局；速度沿用玩家當下的設定（不另外加速）。
 *   - 沿用目前的面額（＝目前那張盤面）：設定面板只剩局數／停利／停損三項（autobet.js 的「選項」「單注」兩列在這裡拿掉，
 *     開面板時先把「單注」對到目前面額，再把兩列從畫面移除）。
 *   - 自動進行中：手點格子、換面額都擋掉並 toast「自動下注中，請先停止」；速度鈕照常可用；重置錢包會先停自動。
 *   - 重整＝中止並 toast（autobet.js 的行為）；核心把演出中的那一注直接結算，錢包與盤面不亂。
 * 勝負紀錄
 *   - 一筆＝一注（ui 的 roundEnd 事件，沒爆沒天降的那一注也會發）。總覽只看輸贏金額；詳細頁列：面額、拿回、
 *     丟在哪一格、丟的是什麼、連爆幾格、噴出什麼各幾枚、有沒有天降（落在哪格、它帶出什麼）。內容全取自核心結果。
 *   - 重整接回補記：演出中重整時核心直接結算，這一注由 core.getRestored() 補記（同注單號不會重複）。
 *   - 重置錢包（紀錄頁底列、二段確認）：錢包 10,000、三張盤面回起始、紀錄清空。
 *
 * 對外：DEMO.wire = { pickFrom(h, rnd?) → 格號（純函式：只吃每格枚數）, pickCell() → 格號（讀目前盤面）, rowsOf(result) }
 * 依賴：values.js、env.js、strings.js、toast.js、core.js、log-ui.js、autobet.js、ui-main.js（DEMO.ui）。須在 ui-main.js 之後、dev.js 之前載入。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var $ = function(id){ return document.getElementById(id); };
var NN = EV.N, COLS = EV.CFG.COLS, CAP = EV.CFG.CAP;

/* ---------- 自動選格 ---------- */
/* 選格專用的小亂數（mulberry32）：種子取時間，不碰 Math.random 也不碰核心 rng */
function mkRng(seed){
  var a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var pickRng = mkRng((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);

/* 只吃「每格幾枚」：有疊 3 枚（CAP−1）的格子就從中挑一格，沒有就 25 格挑一格 */
function pickFrom(h, rnd){
  var r = rnd || pickRng, hot = [], i;
  for(i = 0; i < NN; i++) if(h[i] >= CAP - 1) hot.push(i);
  return hot.length ? hot[Math.floor(r() * hot.length)] : Math.floor(r() * NN);
}
function pickCell(){ return pickFrom(g.getBoard().h); }

/* ---------- 紀錄的詳細頁 ---------- */
function cellText(i){ return T('log.d.cellAt', { r: ((i / COLS) | 0) + 1, c: (i % COLS) + 1 }); }
function exitsText(e){
  var out = [], k;
  ['coin', 'diamond', 'crown'].forEach(function(k){
    if(e && e[k] > 0) out.push(T('log.d.item', { name: T('log.k.' + k), n: e[k] }));
  });
  return out.length ? out.join(T('log.d.sep')) : T('log.d.none');
}
/* r＝核心的 result（一注）或 rec（重整接回補記，沒有分波）；兩者都有這幾個欄位 */
function rowsOf(r){
  var rows = [
    { k: 'log.d.stake',  v: D.fmt(r.stake) },
    { k: 'log.d.pay',    v: D.fmt(r.payout) },
    { k: 'log.d.cell',   v: cellText(r.cell) },
    { k: 'log.d.kind',   v: T('log.k.' + r.kind) },
    { k: 'log.d.burst',  v: T('log.d.burstN', { n: r.topples }) },
    { k: 'log.d.out',    v: exitsText(r.exits) },
    { k: 'log.d.sky',    v: r.hasSky ? cellText(r.skyCell) : T('log.d.none') }
  ];
  if(r.hasSky && r.sky) rows.push({ k: 'log.d.skyOut', v: exitsText(r.sky.exits) });
  return rows;
}
function pushRec(r){
  LogUI.push({ id: r.orderId, ts: r.ts, stake: r.stake, pay: r.payout, rows: rowsOf(r) });
}

LogUI.mount({
  root: $('app'), openBtn: $('logBtn'), cap: EV.CFG.LOG_CAP,
  onReset: function(){ return ui.resetWallet(); }          // 回 false＝不能重置（演出中）：紀錄不清
});
ui.on('roundEnd', function(d){ pushRec(d.result); });
(function(){ var rs = g.getRestored(); if(rs) pushRec(rs); })();   // 演出中重整：核心已直接結算，補記這一注

/* ---------- 自動下注 ---------- */
Autobet.mount({
  root: $('app'), entryBtn: $('autoBtn'), slot: $('abar'),
  choices: [{ id: 'auto', label: 'auto' }],                 // 選格固定一種，面板不顯示（見下面 trimSheet）
  stakes: EV.CFG.DENOMS.slice(),                            // 只用來對齊目前面額，面板不顯示
  placeOne: function(){
    return ui.play(pickCell(), {}).then(function(r){ return { stake: r.stake, pay: r.payout }; });
  },
  balance: function(){ return g.getWallet(); },
  isIdle: function(){ return !ui.isBusy() && g.getState().phase === 'BET' && !ui.isFirstRun(); },
  toast: function(m, ms){ Toast.show(m, ms); }
});

/* 設定面板只留局數／停利／停損：拿掉「選項」「單注」兩列（autobet.js 每次重畫都會帶回來，所以用觀察器補拿） */
var sheetBody = document.querySelector('#app .sheet .sbody');
function trimSheet(){
  var rows = sheetBody.querySelectorAll('.srow'), i, seg, k;
  for(i = 0; i < rows.length; i++){
    seg = rows[i].querySelector('.seg'); k = seg && seg.getAttribute('data-k');
    if(k === 'choice' || k === 'stake') rows[i].parentNode.removeChild(rows[i]);
  }
}
new MutationObserver(trimSheet).observe(sheetBody, { childList: true });
/* 開面板時把「單注」對到目前面額（面板一開就同步完成，觀察器隨後才把這列拿掉） */
var entry = $('autoBtn'), openOrig = entry.onclick;
entry.onclick = function(){
  var r = openOrig.apply(this, arguments);
  var b = sheetBody.querySelector('.seg[data-k="stake"] button[data-v="' + g.getDenom() + '"]');
  if(b && !b.classList.contains('on')) b.click();
  return r;
};

/* 進行中：自動鈕變淡、擋手點（格子、換面額） */
var abar = $('abar');
function syncRunning(){ entry.classList.toggle('running', abar.classList.contains('on')); }
new MutationObserver(syncRunning).observe(abar, { attributes: true, attributeFilter: ['class'] });
syncRunning();
ui.setTapGuard(function(){
  if(!Autobet.isRunning()) return false;
  Toast.show(T('auto.lock'));
  return true;
});

D.wire = { pickFrom: pickFrom, pickCell: pickCell, rowsOf: rowsOf };
})();
