/* =========================================================================
 * 爆金連鎖——模組接線（C03）：自動下注（Autobet）、勝負紀錄頁（LogUI）
 *
 * 底板的兩個模組不認識玩法，只吃 adapter／record；這裡把它們接到主畫面（DEMO.ui）與核心（DEMO.game）：
 *
 * 自動下注
 *   - 一局＝丟一枚。丟法兩種，設定面板第一列選（v2.3，用戶「G3 做成兩選項，8格引爆跟快速回收」）：
 *       快速回收（quick）：盤面上有疊 3 枚的格子 → 從中隨機挑一格；沒有 → 25 格隨機一格。
 *       N 格引爆（build，N＝EV.POT_CHAIN）：有格子現在點下去能炸到 N 格以上 → 點炸最多的那一格（拿獎池）；
 *         沒有 → 養盤：丟在疊 2 枚的格子（沒有就 1 枚、再沒有就空格；全盤都是 3 枚才點炸最多的那一格）。
 *     只看盤面「每格幾枚」與「會炸幾格」（＝畫面提示上的數字，EV.probe），不看寶物、不預看結果、不碰核心的 rng；
 *     選格用自己的小亂數（pickRng），和核心 rng 完全分開。
 *   - 每局等演出結束（ui.play 的 Promise）才下一局；速度沿用玩家當下的設定（不另外加速）。
 *     金幣雨那一局也一樣：ui.play 要等整場（玩家那枚連爆＋雨＋入帳）演完才 resolve，回傳的 payout 是整注合計（含雨），
 *     所以停利停損看到的就是整場的輸贏（沒有另外處理）。
 *   - 沿用目前的金額與盤面（v3 只有一張盤面）：設定面板是丟法／局數／停利／停損四項（autobet.js 的「單注」列與「輪流」鈕在這裡拿掉）。
 *     adapter 的 stakes 永遠只給「目前金額」（getter，每次畫彈窗都重讀），開面板時再把 cfg.stake 對到目前金額（autobet.js 是凍結檔，
 *     停利停損／餘額檢查看的是 cfg.stake），所以換金額後再開彈窗一定對得上。自動下注自己不刷新盤面、不換金額。
 *   - 自動進行中：手點格子、金額鈕、刷新鈕都擋掉並 toast「自動下注中，請先停止」（ui.setTapGuard 的 'cell'／'denom'／'refresh' 一律擋）；
 *     速度鈕照常可用；重置錢包會先停自動。
 *   - 重整＝中止並 toast（autobet.js 的行為）；核心把演出中的那一注直接結算，錢包與盤面不亂。
 * 勝負紀錄
 *   - 一筆＝一注（ui 的 roundEnd 事件，沒爆沒雨的那一注也會發）。總覽只看輸贏金額；詳細頁列：面額、拿回、
 *     丟在哪一格、丟的是什麼、連爆幾格、噴出什麼各幾枚；下雨的那一注多一列「其中金幣雨帶出」；拿了獎池的那一注多一列「獎池」（金額），
 *     「拿回」是含獎池的總額。內容全取自核心結果。
 *     口徑（v2）：連爆、噴出＝整注合計（玩家那一枚＋金幣雨）；「其中金幣雨帶出」＝合計裡雨那一段（result.rain.exits），
 *     是「含在噴出裡」的子集，不是另外加上去的。
 *   - 重整接回補記：演出中重整時核心直接結算，這一注由 core.getRestored() 補記（同注單號不會重複）。
 *   - 刷新盤面與換金額都不產生紀錄（紀錄只認 roundEnd＝一注）。
 *   - 重置錢包（紀錄頁底列、二段確認）：錢包補回 10,000、紀錄清空；盤面、能量條、獎池、冷卻、金額都不動（核心 resetWallet）。
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
/* 養盤到門檻才引爆：top(i)＝第 i 格現在點下去會炸幾格（只對疊 3 枚的格子問）。純函式 */
function pickBuild(h, top, rnd){
  var r = rnd || pickRng, best = -1, bt = -1, i, lv, pool;
  for(i = 0; i < NN; i++) if(h[i] >= CAP - 1){ var n = top(i); if(n > bt){ bt = n; best = i; } }
  if(bt >= EV.POT_CHAIN) return best;
  for(lv = CAP - 2; lv >= 0; lv--){
    pool = [];
    for(i = 0; i < NN; i++) if(h[i] === lv) pool.push(i);
    if(pool.length) return pool[Math.floor(r() * pool.length)];
  }
  return best;
}
function pickCell(mode){
  var b = g.getBoard();
  if(mode === 'build') return pickBuild(b.h, function(i){ return EV.probe(b, i).topples; });
  return pickFrom(b.h);
}

/* ---------- 紀錄的詳細頁 ---------- */
function cellText(i){ return T('log.d.cellAt', { r: ((i / COLS) | 0) + 1, c: (i % COLS) + 1 }); }
function exitsText(e){
  var out = [], k;
  ['coin', 'diamond', 'crown'].forEach(function(k){
    if(e && e[k] > 0) out.push(T('log.d.item', { name: T('log.k.' + k), n: e[k] }));
  });
  return out.length ? out.join(T('log.d.sep')) : T('log.d.none');
}
/* r＝核心的 result（一注）或 rec（重整接回補記，沒有分波、沒有 rain 明細）；兩者都有 hasRain 與其餘欄位 */
function rowsOf(r){
  var rows = [
    { k: 'log.d.stake',  v: D.fmt(r.stake) },
    { k: 'log.d.pay',    v: D.fmt(r.payout) },
    r.potWin > 0 ? { k: 'log.d.pot', v: D.fmt(r.potWin) } : null,       // 有拿獎池：拿回（含獎池的總額）底下多一列「獎池」＝拿走的那一筆
    { k: 'log.d.cell',   v: cellText(r.cell) },
    { k: 'log.d.kind',   v: T('log.k.' + r.kind) },
    { k: 'log.d.burst',  v: T('log.d.burstN', { n: r.topples }) },
    { k: 'log.d.out',    v: exitsText(r.exits) }
  ];
  /* 下雨的那一注：噴出（合計）底下多一列「其中金幣雨帶出」；重整接回補記的那一注核心只留摘要，標「無明細」 */
  if(r.hasRain) rows.push({ k: 'log.d.rainOut', v: r.rain ? exitsText(r.rain.exits) : T('log.d.rainNa') });
  return rows.filter(Boolean);
}
function pushRec(r){
  LogUI.push({ id: r.orderId, ts: r.ts, stake: r.stake, pay: r.payout, rows: rowsOf(r) });
}

/* v1 存檔的舊紀錄（同網址玩過 v1 的人）帶著「天降」列，字串已刪：掛載前先把那兩列拿掉，免得畫面出現 log.d.sky 這種 key */
(function(){
  var old = D.ls('log'), dirty = false;
  if(!old || !old.length) return;
  old.forEach(function(r){
    var n = (r.rows || []).length;
    r.rows = (r.rows || []).filter(function(w){ return w.k !== 'log.d.sky' && w.k !== 'log.d.skyOut'; });
    if(r.rows.length !== n) dirty = true;
  });
  if(dirty) D.ls('log', old);
})();
LogUI.mount({
  root: $('app'), openBtn: $('logBtn'), cap: EV.CFG.LOG_CAP,
  onReset: function(){ return ui.resetWallet(); }          // 回 false＝不能重置（演出中）：紀錄不清
});
ui.on('roundEnd', function(d){ pushRec(d.result); });
(function(){ var rs = g.getRestored(); if(rs) pushRec(rs); })();   // 演出中重整：核心已直接結算，補記這一注

/* ---------- 自動下注 ---------- */
Autobet.mount({
  root: $('app'), entryBtn: $('autoBtn'), slot: $('abar'),
  choices: [{ id: 'build', label: T('auto.c.build', { n: EV.POT_CHAIN }) }, { id: 'quick', label: T('auto.c.quick') }],   // 丟法兩種（「輪流」鈕在 trimSheet 拿掉）
  rounds: [10, 50, 100, 0],                                 // 局數：10／50／100／不限（0）。用戶「50局太快了，幫我加上限或者有個無限制。」
  get stakes(){ return [g.getDenom()]; },                   // 只用來對齊目前金額（autobet.js 每次畫彈窗都讀它），面板不顯示
  placeOne: function(o){
    return ui.play(pickCell(o && o.choice), {}).then(function(r){ return { stake: r.stake, pay: r.payout }; });
  },
  balance: function(){ return g.getWallet(); },
  isIdle: function(){ return !ui.isBusy() && g.getState().phase === 'BET' && !ui.isFirstRun(); },
  toast: function(m, ms){ Toast.show(m, ms); }
});

/* 設定面板留丟法／局數／停利／停損：拿掉「單注」列與丟法裡的「輪流」鈕（autobet.js 每次重畫都會帶回來，所以用觀察器補拿） */
var sheetBody = document.querySelector('#app .sheet .sbody');
function trimSheet(){
  var rows = sheetBody.querySelectorAll('.srow'), i, seg, k;
  for(i = 0; i < rows.length; i++){
    seg = rows[i].querySelector('.seg'); k = seg && seg.getAttribute('data-k');
    if(k === 'stake') rows[i].parentNode.removeChild(rows[i]);
    else if(k === 'choice'){ var alt = seg.querySelector('button[data-v="alt"]'); if(alt) seg.removeChild(alt); }
  }
}
new MutationObserver(trimSheet).observe(sheetBody, { childList: true });
/* 開面板時把「單注」對到目前金額（面板一開就同步完成，觀察器隨後才把這列拿掉）；金額是 getter 現讀的，換過金額再開也對得上 */
var entry = $('autoBtn'), openOrig = entry.onclick;
entry.onclick = function(){
  var r = openOrig.apply(this, arguments);
  var b = sheetBody.querySelector('.seg[data-k="stake"] button[data-v="' + g.getDenom() + '"]');
  if(b && !b.classList.contains('on')) b.click();
  return r;
};

/* 進行中：自動鈕變淡、擋手點（格子、金額鈕、刷新鈕；ui-main 另外讓金額鈕與刷新鈕在 #abar.on 時變淡） */
var abar = $('abar');
function syncRunning(){ entry.classList.toggle('running', abar.classList.contains('on')); }
new MutationObserver(syncRunning).observe(abar, { attributes: true, attributeFilter: ['class'] });
syncRunning();
ui.setTapGuard(function(){
  if(!Autobet.isRunning()) return false;
  Toast.show(T('auto.lock'));
  return true;
});

D.wire = { pickFrom: pickFrom, pickBuild: pickBuild, pickCell: pickCell, rowsOf: rowsOf };
})();
