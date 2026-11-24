/* =========================================================================
 * 三路尋寶——接線（T03）：勝負紀錄頁、自動下注，與它們需要的橋接
 *
 * 做的事：
 *  ① LogUI.mount：每局結束（DEMO.ui 的 roundEnd）用核心注單摘要組一筆紀錄 push；重整接回補記（依 id 去重）
 *     紀錄列：路線色點＋時間＋注額、淨額（沒回本灰色、回本以上金色）
 *     詳細頁：路線、下注、派彩、倍數、結局（走到底／撤退）、剩餘心數、每顆收下的寶物（倍率與金額）、
 *             每一擲（門檻、兩顆點數與和、贏或輸）——全部只讀核心注單摘要（rec），和這局一致
 *  ② Autobet.mount：adapter 每局用 DEMO.ui.play(路線, 注額, { fast:true })（路線固定、地圖每局換）；
 *     停利／停損／局數／餘額不足／重整中止由 autobet.js 自己處理
 *  ③ 小橋接：打開自動下注彈窗時把「目前選的路線與注額」帶進去、自動下注進行中擋掉手點出發／換路線／換注額、
 *     錢包重置前先停自動下注、紀錄頁樣式對齊卷軸配色（樣式只在這個檔注入，不改 base.css／log-ui.css）
 * 不碰核心與主畫面的檔；取用 DEMO.ui 的公開介面（見 tasks/T02 完成註記）。
 * 載入順序：ui-main.js 之後、dev.js 之前（dev.js 會在預設網址拿掉 DEMO.game；這裡先留一份參照）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var $ = function(id){ return document.getElementById(id); };
var ROUTES = EV.ids();
var DOT = { safe:'#4f9a3e', mid:'#e7ae1c', risk:'#d63b2a' };

/* ---------- 字串（逐寶物、逐擲的標籤：LogUI 以 key 取字，所以每個序號一個 key） ---------- */
var strs = {
  'auto.pick'      : '路線',
  'wire.autoRunning': '自動下注進行中',
  'log.row.odds'   : '倍數',
  'log.row.end'    : '結局',
  'log.row.hearts' : '剩餘心數',
  'log.end.done'   : '走到底',
  'log.end.retreat': '撤退',
  'log.win'        : '贏',
  'log.lose'       : '輸'
};
ROUTES.forEach(function(id){ strs['log.row.r.' + id] = '路線'; });         // 第一列的 key 帶路線，列表的色點靠它認
for(var i = 1; i <= 12; i++){ strs['log.row.p' + i] = '寶物 ' + i; strs['log.row.f' + i] = '第 ' + i + ' 擲'; }
D.addStrings(strs);

/* ---------- 紀錄頁樣式：對齊卷軸配色（灰色換成暖灰、路線色點、注額小字） ---------- */
var css = document.createElement('style');
css.textContent =
  '.grey{color:#9a8a6e}' +
  '.lempty{color:#a8977a}' +
  '.lrowi .lt{display:flex;align-items:center;gap:6px;min-width:0}' +
  '.lrowi .rdot{flex:none;width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(0,0,0,.5)}' +
  '.lrowi .rst{color:var(--mute);opacity:.85;font-variant-numeric:tabular-nums;white-space:nowrap}';
document.head.appendChild(css);

/* ---------- 勝負紀錄 ---------- */
function rowsOf(rec){                         // rec＝核心注單摘要（重整接回的舊單也有同樣欄位）
  var ri = EV.routeIndex(rec.route), hearts = EV.CFG.ROUTES[ri].hearts, st = rec.stake;
  var rows = [
    { k:'log.row.r.' + rec.route, v:T('route.' + rec.route) },
    { k:'log.row.stake',  v:D.fmt(st) },
    { k:'log.row.pay',    v:D.fmt(rec.payout) },
    { k:'log.row.odds',   v:'×' + EV.fmtX(rec.payout / st) },
    { k:'log.row.end',    v:T(rec.reachedEnd ? 'log.end.done' : 'log.end.retreat') },
    { k:'log.row.hearts', v:rec.heartsLeft + '／' + hearts }
  ];
  (rec.mults || []).forEach(function(v, n){
    rows.push({ k:'log.row.p' + (n + 1), v:'×' + EV.fmtX(v) + '　+' + D.fmt(EV.payoutFloor(st, v)) });
  });
  (rec.rolls || []).forEach(function(f, n){   // f＝[門檻, 骰一, 骰二, 贏(1|0)]
    rows.push({ k:'log.row.f' + (n + 1),
      v:f[0] + '+　' + f[1] + '＋' + f[2] + '＝' + (f[1] + f[2]) + '　' + T(f[3] ? 'log.win' : 'log.lose') });
  });
  return rows;
}
function toLog(rec){ return { id:rec.orderId, ts:rec.ts, stake:rec.stake, pay:rec.payout, rows:rowsOf(rec) }; }
function lastRecord(){ var a = g.getState().records; return a[a.length - 1] || null; }

function resetWallet(){
  if(Autobet.isRunning()) Autobet.stop();    // 本局演完才停時，下面 resetWallet 會因為 busy 回 false（頁面不清 log）
  return ui.resetWallet();
}
LogUI.mount({ root:$('app'), openBtn:$('logBtn'), cap:EV.CFG.LOG_CAP, onReset:resetWallet });
g.getState().records.forEach(function(r){ LogUI.push(toLog(r)); });   // 重整接回：補記沒進 log 的注單（依 id 去重）

ui.on('roundEnd', function(d){
  var rec = d.record || lastRecord();
  if(rec && rec.orderId === d.orderId) LogUI.push(toLog(rec));
  Autobet.refresh();
});
ui.on('roundStart', function(){ Autobet.refresh(); });

/* 總覽列的路線色點與注額：LogUI 每次重畫都換掉整個內容，所以重畫後補上（只看 childList，補色點不會再觸發） */
function decorate(body){
  var rows = body.querySelectorAll('.lrowi:not([data-dec])');
  if(!rows.length) return;
  var list = LogUI.list(), n = list.length;                // list 最新在前；data-i 是由舊到新的序
  for(var k = 0; k < rows.length; k++){
    var row = rows[k], rec = list[n - 1 - (+row.getAttribute('data-i'))], lt = row.querySelector('.lt');
    row.setAttribute('data-dec', '1');
    if(!rec || !lt) continue;
    var m = /^log\.row\.r\.(\w+)$/.exec(rec.rows && rec.rows[0] ? rec.rows[0].k : '');
    lt.insertAdjacentHTML('afterbegin', '<i class="rdot" style="background:' + (m && DOT[m[1]] || '#7a5a3a') + '"></i>');
    lt.insertAdjacentHTML('beforeend', '<span class="rst">' + D.fmt(rec.stake) + '</span>');
  }
}
(function(){
  var body = document.querySelector('.lgm .lgb');
  if(!body || !window.MutationObserver) return;
  new MutationObserver(function(){ decorate(body); }).observe(body, { childList:true });
  decorate(body);
})();

/* ---------- 自動下注 ---------- */
Autobet.mount({
  root:$('app'), entryBtn:$('autoBtn'), slot:$('abar'),
  choices:ROUTES.map(function(id){ return { id:id, label:T('route.' + id) }; }),
  stakes:EV.CFG.STAKES,
  /* Autobet 要 { stake, pay }：缺欄位時累計會變 NaN（上一款踩過），這裡一律轉成數字並補預設 */
  placeOne:function(cfg){
    return ui.play(cfg.choice, cfg.stake, { fast:true }).then(function(r){
      var pay = Number(r && (r.pay != null ? r.pay : r.payout));
      var stake = Number(r && r.stake);
      return { stake:isFinite(stake) ? stake : cfg.stake, pay:isFinite(pay) ? pay : 0 };
    });
  },
  balance:function(){ return g.getState().wallet; },
  isIdle:function(){ return !ui.busy(); },
  toast:Toast.show
});

/* 打開設定彈窗時，路線與單注預設成目前主畫面選的（用彈窗自己的按鈕點，不碰 autobet.js 內部） */
$('autoBtn').addEventListener('click', function(){
  if(!document.querySelector('.sheet.show')) return;
  try{
    [['choice', ui.getRoute()], ['stake', ui.getStake()]].forEach(function(p){
      var b = document.querySelector('.sheet .seg[data-k="' + p[0] + '"] button[data-v="' + p[1] + '"]');
      if(b && !b.classList.contains('on')) b.click();
    });
  }catch(e){ console.error('[wire] 同步彈窗預設失敗', e); }
});

/* 自動下注進行中：手點出發、換路線、換注額都會讓一局不計入自動下注的盈虧或被它改回去，直接擋掉 */
$('app').addEventListener('click', function(e){
  var n = e.target && e.target.closest ? e.target.closest('#goBtn,#tabs,#stakes') : null;
  if(n && Autobet.isRunning()){ e.stopPropagation(); e.preventDefault(); Toast.show(T('wire.autoRunning')); }
}, true);
})();
