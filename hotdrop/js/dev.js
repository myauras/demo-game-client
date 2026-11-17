/* =========================================================================
 * 空投爭奪——導演台（?dev=1）＋截圖自動駕駛的分派（?shot=）
 *
 * 導演台（只在 ?dev=1 出現；不帶時頁面上看不到、DEMO.dev 是 undefined）：
 *   結果 照機率／強制獨佔／強制撞車　箱子 照機率／各級　🏆大獎　爆金幣 開／關　重置錢包　＋1,000
 *   原理：包裝 game.bet——下注當下依玩家選的落點算出三個機器人落點與箱子，交給 DEMO.ui.rig 餵核心
 *   下一次 bet 的 4 個亂數，bet 完立刻把亂數還原。核心程式、賠率、機率一個字都沒動，mc-test 不載入本檔。
 *   「結果」「箱子」兩個下拉是持續生效（每局都強制，直到切回「照機率」），方便自動下注連跑；
 *   「🏆 大獎」是一鍵：金點獨佔＋傳說箱（×5，必達大獎門檻）並立刻開一局，用目前單注。
 *
 * 截圖自動駕駛：DEMO.shots[名] = function(done)，跑到該畫面呼叫 done() → 本檔設 window.__shotReady
 *   （tools/shot.mjs 靠它截圖）。沒帶 ?shot 時 init 完直接 __shotReady = true。?shot 模式不讀寫 localStorage。
 *   全部 shots 登錄在 ui-main.js 區段 [E]：idle／lock／reveal／win／bigwin／crash／auto-modal／auto-run／
 *   log-list／log-detail／log-detail-crash／log-detail-old／recent。
 * 最後載入（依賴 ui-main.js 已建好 DEMO.game／DEMO.ui）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;

/* ---------- 導演台 ---------- */
if(D.q.dev){
  var base0 = g.getRng();                 // 原亂數（還原用）
  var mode = { res:'rand', box:'rand', big:false };
  var origBet = g.bet;
  var tiers = EV.BOX.tiers;

  function pickW(w, u){                   // 依權重抽（同核心的累加法）
    var acc = 0, i;
    for(i = 0; i < w.length; i++){ acc += w[i]; if(u < acc) return i; }
    return w.length - 1;
  }
  function othersOf(p){ var o = [], i; for(i = 0; i < EV.POINTS.length; i++) if(i !== p) o.push(i); return o; }
  function plan(p){                       // 依玩家落點 p 排出本局：{ bots:[…], box:n }；null＝完全照機率
    var res = mode.big ? 'solo' : mode.res, box = mode.big ? tiers.length - 1 : mode.box;
    if(res === 'rand' && box === 'rand') return null;
    var b = g.board(), bots = [], k, o = othersOf(p);
    for(k = 0; k < 3; k++) bots.push(pickW(b.botP, base0()));
    if(res === 'solo'){
      for(k = 0; k < 3; k++) if(bots[k] === p) bots[k] = o[Math.floor(Math.random() * o.length)];
    }else if(res === 'clash'){
      bots[Math.floor(Math.random() * 3)] = p;                                   // 至少一個對手跟你撞
      for(k = 0; k < 3; k++) if(Math.random() < 0.25) bots[k] = p;               // 偶爾多撞幾個
    }
    return { bots:bots, box:(box === 'rand' ? pickW(tiers.map(function(t){ return t.p; }), base0()) : box) };
  }
  g.bet = function(p, s){
    var pl = (p === (p | 0) && p >= 0 && p < EV.POINTS.length) ? plan(p) : null;
    if(pl) ui.rig(pl.bots, pl.box);
    var ok = origBet.call(g, p, s);
    if(pl) g.setRng(base0);               // 還原：下一局盤面、之後的局都照原亂數
    mode.big = false;
    return ok;
  };

  function big(){                         // 一鍵大獎
    if(Autobet.isRunning()){ Toast.show(T('auto.manualBlock')); return; }
    if(ui.isBusy()){ Toast.show(T('dev.busy')); return; }
    mode.big = true;
    ui.play(EV.POINTS.length - 1, ui.stake(), { skipLock:true }).catch(function(){ mode.big = false; });
  }
  function coins(on){ return ui.coins(on); }

  D.dev = {
    force:function(o){ o = o || {}; if(o.res !== undefined) mode.res = o.res; if(o.box !== undefined) mode.box = o.box; },
    big:big, coins:coins,
    mode:function(){ return { res:mode.res, box:mode.box }; }
  };

  var dir = document.getElementById('director');
  var opt = function(v, label){ return '<option value="' + v + '">' + label + '</option>'; };
  var resOpt = opt('rand', T('dev.res.rand')) + opt('solo', T('dev.res.solo')) + opt('clash', T('dev.res.clash'));
  var boxOpt = opt('rand', T('dev.box.rand')) + tiers.map(function(t, i){ return opt(i, t.name + ' ×' + t.mult); }).join('');
  dir.innerHTML = '<span>' + T('dev.title') + '</span>' +
    '<label>' + T('dev.res') + ' <select id="devRes">' + resOpt + '</select></label>' +
    '<label>' + T('dev.box') + ' <select id="devBox">' + boxOpt + '</select></label>' +
    '<button id="devBig" type="button" title="' + T('dev.big.tip') + '">' + T('dev.big') + '</button>' +
    '<button id="devCoin" type="button"></button>' +
    '<button id="devReset" type="button">' + T('dev.reset') + '</button>' +
    '<button id="devAdd" type="button">' + T('dev.add') + '</button>';
  dir.classList.add('on');
  var coinBtn = document.getElementById('devCoin');
  function coinLabel(){ coinBtn.textContent = T('dev.coins') + '：' + T(coins() ? 'dev.on' : 'dev.off'); }
  coinLabel();
  document.getElementById('devRes').onchange = function(){ mode.res = this.value; };
  document.getElementById('devBox').onchange = function(){ mode.box = this.value === 'rand' ? 'rand' : +this.value; };
  document.getElementById('devBig').onclick = big;
  coinBtn.onclick = function(){ coins(!coins()); coinLabel(); };
  document.getElementById('devReset').onclick = function(){ if(ui.resetWallet() && window.LogUI) LogUI.clear(); };
  document.getElementById('devAdd').onclick = function(){ g.addMoney(1000); };
}

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
