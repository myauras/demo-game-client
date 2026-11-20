/* =========================================================================
 * 連鎖開箱——再玩動機與加分演出（C04）
 *
 * 兩樣東西，都只是「呈現」：不碰亂數、不碰結果、不碰賠付、不碰餘額。
 *   1. 最高紀錄徽章：每個檔位各記一個最高倍數，常駐顯示在 #recordBadge .rv，切檔跟著換；
 *      這局結算後（roundEnd）才更新；拿回 ≥ 1 倍而且破紀錄時，徽章播一次性的慶祝；
 *      沒回本的局就算創了紀錄也只安靜換數字，不慶祝；大獎覆蓋層蓋住畫面時，慶祝等覆蓋層收起才播。
 *      存檔 crate.best（{ stable, mid, wild }，值為顯示用倍數＝EV.floor2）；?shot= 模式不讀不寫（env.js 的 DEMO.ls 已處理）。
 *   2. 關鍵時刻停頓：這局已連 PAUSE_MIN_CHAINS 次以上時，箱子落定後多停 PAUSE_MS 毫秒才揭曉
 *      「還有沒有下一次連鎖」（用 DEMO.ui.setPace）；加速中（點畫面或自動下注 fast）不停。
 *
 * 取用 C02 的介面：DEMO.ui.on／setPace／getTier、DEMO.ls、EV.fmtX／floor2／ids。倍數顯示一律 EV.fmtX。
 * 動畫只動 transform／opacity（樣式在 css/extras.css）；本檔沒有任何亂數（噴星的方向是固定表）。
 * 載入順序：wire.js 之後、dev.js 之前。
 * ========================================================================= */
(function(){
'use strict';

/* ---------- 試玩後可調的常數 ---------- */
var PAUSE_MIN_CHAINS = 3;     // 這局已連幾次以上，才在箱子落定後多停一拍
var PAUSE_MS = 600;           // 多停多久（毫秒，正常速度；中途點畫面加速會跟著縮短）
var POP_MS = 1300;            // 破紀錄慶祝的總長（毫秒）；要和 css/extras.css 最長的動畫（.rk-sp 0.75s＋延遲）對得上
var JP_WAIT_MS = 8000;        // 大獎覆蓋層最多等多久（保險；正常 3 秒多就收起）
var SPARKS = [                // 噴星：[dx, dy, 延遲 ms]，固定表、不用亂數
  [-34, -22, 0], [-12, -34, 40], [14, -36, 20], [34, -20, 60], [-28, 14, 80], [28, 16, 30]
];

var D = window.DEMO;
var badge = document.getElementById('recordBadge');
var rv = badge && badge.querySelector('.rv');
if(!D || !D.ui || !window.EV || !rv) return;                  // 掛點不在就整個不啟動（不影響遊戲）
var ui = D.ui, bEl = rv.parentNode;

/* ---------- 最高紀錄 ---------- */
var best = load();

function load(){
  var raw = D.ls('best'), out = {};
  EV.ids().forEach(function(id){
    var v = (raw && typeof raw === 'object') ? +raw[id] : 0;
    out[id] = (isFinite(v) && v > 0) ? v : 0;
  });
  return out;
}
function save(){ D.ls('best', best); }

function render(){
  var v = best[ui.getTier()] || 0;
  var s = v > 0 ? '×' + EV.fmtX(v) : '—';                      // 還沒有紀錄：維持「—」
  rv.textContent = s;
  bEl.classList.toggle('rk-s6', s.length === 6);              // 長的數字縮一級字，不撐破框
  bEl.classList.toggle('rk-s7', s.length >= 7);
}

/* ---------- 慶祝（只動 transform／opacity） ---------- */
var fx = document.createElement('span');
fx.className = 'rk-fx';
fx.setAttribute('aria-hidden', 'true');
badge.appendChild(fx);
var popTimer = 0;

function celebrate(){
  clearTimeout(popTimer);
  badge.classList.remove('rk-on');
  fx.innerHTML = '';
  void badge.offsetWidth;                                      // 讓動畫能重播
  var h = '<i class="rk-glow"></i><i class="rk-ring"></i><i class="rk-ring r2"></i>';
  SPARKS.forEach(function(s){
    h += '<i class="rk-sp" style="--dx:' + s[0] + 'px;--dy:' + s[1] + 'px;--dl:' + s[2] + 'ms"></i>';
  });
  fx.innerHTML = h;
  badge.classList.add('rk-on');
  popTimer = setTimeout(function(){ badge.classList.remove('rk-on'); fx.innerHTML = ''; }, POP_MS);
}

/* 大獎覆蓋層（#jp.show）還蓋著畫面時，等它收起再慶祝；沒有覆蓋層就立刻做 */
function afterOverlay(fn){
  var jp = document.getElementById('jp');
  if(!jp || !jp.classList.contains('show')){ fn(); return; }
  var done = false, mo = null, to = 0;
  function fin(){
    if(done) return; done = true;
    if(mo) mo.disconnect();
    clearTimeout(to);
    fn();
  }
  if(window.MutationObserver){
    mo = new MutationObserver(function(){ if(!jp.classList.contains('show')) fin(); });
    mo.observe(jp, { attributes:true, attributeFilter:['class'] });
  }
  to = setTimeout(fin, JP_WAIT_MS);
}

/* ---------- 事件接線 ---------- */
ui.on('roundEnd', function(d){
  var fx2 = EV.floor2(d.x);                                    // 與畫面顯示同一個值；沒連到（0）或小到顯示成 0 的不記
  if(!(fx2 > 0)) return;
  if(fx2 <= (best[d.tier] || 0)) return;                       // 沒破紀錄（顯示值沒比較大）
  best[d.tier] = fx2;
  save();
  if(ui.getTier() === d.tier) render();                        // 安靜換數字
  if(d.grade === 'miss') return;                               // 沒回本：不慶祝
  afterOverlay(function(){
    if(ui.getTier() === d.tier) celebrate();
  });
});
ui.on('tierChange', render);

/* ---------- 關鍵時刻停頓 ---------- */
function pace(ctx){
  if(ctx.fast) return 0;                                       // 加速中不停
  return ctx.done >= PAUSE_MIN_CHAINS ? PAUSE_MS : 0;          // 已連 N 次以上：下一格揭曉前（含「到此為止」的結算前）多停一拍
}
ui.setPace(pace);

render();

/* 給探針／導演台唯讀查詢用 */
D.extras = {
  best:function(id){ return best[id] || 0; },
  pace:pace,
  cfg:{ PAUSE_MIN_CHAINS:PAUSE_MIN_CHAINS, PAUSE_MS:PAUSE_MS, POP_MS:POP_MS }
};
})();
