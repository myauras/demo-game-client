/* =========================================================================
 * 三選一冒煙——導演台（?dev=1）＋截圖自動駕駛（?shot=）
 *
 * 導演台：強制下一局結果、重置錢包、加錢。只包裝 rng（核心的 setRng），
 *   不動核心程式、不影響賠率與 RTP；預設網址不出現。
 * 自動駕駛：DEMO.shots[名] = function(done)，跑到該畫面呼叫 done() →
 *   本檔設 window.__shotReady = true（tools/shot.mjs 靠它截圖）。
 *   沒帶 ?shot 時 init 完直接 __shotReady = true。?shot 模式不讀寫 localStorage（見 env.js）。
 *   新 demo 想加畫面：往 DEMO.shots 加一個函式即可（用 DEMO.dev.force 定結果、DEMO.ui.play 下注）。
 * 內建：idle／result／auto-modal／auto-run／log-list／log-detail／tut-1
 * 最後載入（依賴 ui-main.js 已建好 DEMO.game／DEMO.ui）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var oneShot = null, selVal = 'rand';

/* ---------- rng 包裝：一次性強制（自動駕駛）＞ 導演台下拉 ＞ 原 rng ---------- */
var base = g.getRng();
g.setRng(function(){
  var id = oneShot || (selVal !== 'rand' ? selVal : null);
  oneShot = null;
  return id ? EV.rngFor(id) : base();
});
D.dev = { force:function(id){ oneShot = id; } };

/* ---------- 導演台 ---------- */
if(D.q.dev){
  var dir = document.getElementById('director');
  var opt = '<option value="rand">' + T('dev.rand') + '</option>' +
    EV.ids().map(function(id){ return '<option value="' + id + '">' + T('choice.' + id) + '</option>'; }).join('');
  dir.innerHTML = '<span>' + T('dev.title') + '</span><label>' + T('dev.force') +
    ' <select id="devForce">' + opt + '</select></label>' +
    '<button id="devReset" type="button">' + T('dev.reset') + '</button>' +
    '<button id="devAdd" type="button">' + T('dev.add') + '</button>';
  dir.classList.add('on');
  document.getElementById('devForce').onchange = function(){ selVal = this.value; };
  document.getElementById('devReset').onclick = function(){ ui.resetWallet(); if(window.LogUI) LogUI.clear(); };
  document.getElementById('devAdd').onclick = function(){ g.addMoney(1000); };
}

/* ---------- 自動駕駛工具 ---------- */
function wait(ms, fn){ setTimeout(fn, ms); }
/* 依序跑幾局（固定結果，決定性）：[ [押什麼, 強制開什麼], ... ]，全部演完才呼叫 cb */
function seed(list, cb){
  var i = 0;
  (function nextBet(){
    if(i >= list.length){ cb(); return; }
    var it = list[i++];
    D.dev.force(it[1]);
    ui.play(it[0], 100, { fast:true }).then(function(){ wait(60, nextBet); }, function(){ wait(100, nextBet); });
  })();
}
var DEMO3 = [['A','A'], ['B','C'], ['C','C']];   // 贏、輸、贏

D.shots.idle = function(done){ wait(50, done); };
D.shots.result = function(done){
  D.dev.force('A');
  ui.play('A', 100, { fast:true, hold:true, onReveal:function(){ wait(350, done); } }).catch(function(){});
};
D.shots['auto-modal'] = function(done){ Autobet.openSheet(); wait(450, done); };
D.shots['auto-run'] = function(done){
  Autobet.start({ choice:'alt', stake:50, rounds:10, tp:0, sl:0 });
  var iv = setInterval(function(){
    if(Autobet.state().n >= 2){ clearInterval(iv); wait(300, done); }
  }, 100);
};
D.shots['log-list'] = function(done){ seed(DEMO3, function(){ LogUI.open(); wait(450, done); }); };
D.shots['log-detail'] = function(done){ seed(DEMO3, function(){ LogUI.openDetail(0); wait(450, done); }); };
D.shots['tut-1'] = function(done){ Onboard.start(); wait(450, done); };

/* ---------- 分派 ---------- */
if(D.q.shot){
  var fn = D.shots[D.q.shot];
  if(!fn){
    window.__shotError = 'unknown shot: ' + D.q.shot;
    window.__shotReady = true;
  }else{
    fn(function(){ window.__shotReady = true; });
  }
}else{
  window.__shotReady = true;
}
})();
