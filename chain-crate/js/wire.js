/* =========================================================================
 * 連鎖開箱——接線（C03）：勝負紀錄頁、自動下注，與它們需要的橋接
 *
 * 做的事：
 *  ① LogUI.mount：每局結束（DEMO.ui 的 roundEnd）組一筆紀錄 push；重整接回補記（依 id 去重）
 *     紀錄列：檔位、下注、連鎖次數、拿回、倍數；詳細頁另列每次連鎖的倍率與賠付（只讀核心結果）
 *  ② Autobet.mount：adapter 每局用 DEMO.ui.play(檔位, 注額, { fast:true })；
 *     停利／停損／局數／餘額不足／重整中止都由 autobet.js 自己處理
 *  ③ 小橋接：打開自動下注彈窗時把「目前選的檔位與注額」帶進去（規格：每局用當下選的）、
 *     自動下注進行中擋掉手點開箱、錢包重置前先停自動下注
 * 不碰核心與 C02 的檔；取用 DEMO.ui 的公開介面（見 tasks/C02 完成註記）。
 * 載入順序：ui-main.js 之後、extras.js 與 dev.js 之前。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var $ = function(id){ return document.getElementById(id); };

/* ---------- 字串（紀錄詳細頁的「第 n 次連鎖」逐項標籤；LogUI 以 key 取字，所以每個序號一個 key） ---------- */
var strs = { 'wire.autoRunning':'自動下注進行中' };
for(var ci = 1; ci <= EV.CFG.MAX_CHAIN; ci++) strs['log.row.c' + ci] = '第 ' + ci + ' 次連鎖';
D.addStrings(strs);

/* ---------- 勝負紀錄 ---------- */
/* x＝總賠÷注額；steps（可省略）＝核心結果的 steps，有就逐次列出倍率與賠付 */
function rowsOf(o){
  var rows = [
    { k:'log.row.tier',   v:T('tier.' + o.tier) },
    { k:'log.row.stake',  v:D.fmt(o.stake) },
    { k:'log.row.chains', v:String(o.chains) },
    { k:'log.row.pay',    v:D.fmt(o.pay) },
    { k:'log.row.odds',   v:'×' + EV.fmtX(o.x) }
  ];
  (o.steps || []).forEach(function(s, i){
    rows.push({ k:'log.row.c' + (i + 1), v:'×' + EV.fmtX(s.mult) + '　+' + D.fmt(s.pay) });
  });
  return rows;
}
function toLog(rec, R){                      // rec＝核心注單摘要；R＝整局結果（只有剛打完的局才有）
  return { id:rec.orderId, ts:rec.ts, stake:rec.stake, pay:rec.payout,
           rows:rowsOf({ tier:rec.choice, stake:rec.stake, chains:rec.chains, pay:rec.payout,
                         x:rec.payout / rec.stake, steps:R ? R.steps : null }) };
}
function lastRecord(){ var a = g.getState().records; return a[a.length - 1] || null; }

function resetWallet(){
  if(Autobet.isRunning()) Autobet.stop();    // 停不下來（本局演完才停）時，下面 resetWallet 會因為 busy 回 false
  return ui.resetWallet();
}
LogUI.mount({ root:$('app'), openBtn:$('logBtn'), cap:EV.CFG.LOG_CAP, onReset:resetWallet });
g.getState().records.forEach(function(r){ LogUI.push(toLog(r, null)); });   // 重整接回：補記沒進 log 的注單（依 id 去重）

ui.on('roundEnd', function(d){
  var rec = d.record || lastRecord();
  if(rec && rec.orderId === d.orderId) LogUI.push(toLog(rec, d.result));
  Autobet.refresh();
});
ui.on('roundStart', function(){ Autobet.refresh(); });

/* ---------- 自動下注 ---------- */
Autobet.mount({
  root:$('app'), entryBtn:$('autoBtn'), slot:$('abar'),
  choices:EV.ids().map(function(id){ return { id:id, label:T('tier.' + id) }; }),
  stakes:EV.CFG.STAKES,
  /* Autobet 要 { stake, pay }；ui.play 正常路徑 resolve 的物件只有 payout（沒有 pay，C02 註記與實作不符），這裡統一補上 */
  placeOne:function(cfg){
    return ui.play(cfg.choice, cfg.stake, { fast:true }).then(function(r){
      return { stake:r.stake, pay:(r.payout != null ? r.payout : r.pay) || 0 };
    });
  },
  balance:function(){ return g.getState().wallet; },
  isIdle:function(){ return !ui.busy(); },
  toast:Toast.show
});

/* 打開設定彈窗時，選項與單注預設成目前主畫面選的（用彈窗自己的按鈕點，不碰 autobet.js 內部） */
$('autoBtn').addEventListener('click', function(){
  if(!document.querySelector('.sheet.show')) return;
  try{
    [['choice', ui.getTier()], ['stake', ui.getStake()]].forEach(function(p){
      var b = document.querySelector('.sheet .seg[data-k="' + p[0] + '"] button[data-v="' + p[1] + '"]');
      if(b && !b.classList.contains('on')) b.click();
    });
  }catch(e){ console.error('[wire] 同步彈窗預設失敗', e); }
});

/* 自動下注進行中：手點「開箱」會讓一局不計入自動下注的盈虧，直接擋掉 */
$('app').addEventListener('click', function(e){
  var n = e.target && e.target.closest ? e.target.closest('#goBtn') : null;
  if(n && Autobet.isRunning()){ e.stopPropagation(); e.preventDefault(); Toast.show(T('wire.autoRunning')); }
}, true);
})();
