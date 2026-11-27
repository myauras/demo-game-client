/* =========================================================================
 * 爆金連鎖——導演台（?dev=1）＋截圖自動駕駛（?shot=）
 *
 * 導演台（?dev=1 才出現；預設網址 DEMO.dev＝undefined、畫面沒有任何 dev 字樣）：
 *   下一枚是什麼（金幣／鑽石／皇冠）——走核心公開的 armNext({ kind })
 *   （EV.scripted：只替前幾次取值指定結果，其餘照 rng；不動 rng、不動核心、不動賠率）；
 *   能量條集到剩 1 格（core.setMeter(RAIN_EVERY−1)：下一注必下金幣雨；演出中不可）；
 *   獎池 ＋10 倍面額（core.setPot(目前獎池 ＋ 10×面額)：方便看拿獎池的演出；演出中不可、上限 EV.potMax）；
 *   ＋1,000（core.addMoney）、重置錢包（ui.resetWallet＋清紀錄，免二段確認）、取消預約、
 *   填滿盤面（把目前這張盤面寫成「幾乎每格 3 枚」的存檔再重整——只用核心存檔格式，核心不動；錢包與紀錄不動）。
 *   「下一枚」預約只對「下一次成功的下注」生效，用完自動清掉；面板的選中狀態跟著清。能量條改了就是改了（不是預約）。
 *
 * DEMO.dev（?dev／?shot 才有）：
 *   force(plan)       預約下一注（plan 形狀同 armNext：{ kind? }）；force(null)＝取消
 *   clear()           取消預約
 *   armedInfo()       目前預約 { kind }｜null
 *   meterNear()       把目前面額的能量條設成剩 1 格（回 true／false）
 *   potBoost(n?)      把目前面額的獎池加 n 倍面額（預設 10；回 true／false）
 *   fillBoard()       填滿目前面額的盤面（重整頁面）；演出中回 false
 *   plan 之外的導演台功能都在面板上，沒有別的把手
 *
 * 預設網址（沒有 ?dev／?shot）不留把手：DEMO.game 與 DEMO.shots 在這裡拿掉（各模組載入時已各自留了參照，
 *   不影響遊玩）；否則 console 可用 DEMO.game.setRng／armNext／addMoney 指定開獎或加錢。
 *
 * 自動駕駛：DEMO.shots[名] = function(done)，跑到該畫面呼叫 done() → window.__shotReady = true（tools/shot.mjs 靠它截圖）。
 *   ?shot 模式不讀寫 localStorage（見 env.js）。主畫面的畫面（idle／first／chain／win／big／huge／gem／denom／meter-mid／meter-near／rain／rain-done／seq-N／seq-rain-N）
 *   定義在 ui-main.js（v2.3 另有 pot-idle／pot-win／hint-off／seq-pot-N）；這裡補：auto-modal／auto-run／log-list／log-detail（log-detail 是有拿獎池的那一筆）。
 * 最後載入（依賴 ui-main.js、wire.js 已建好 DEMO.game／DEMO.ui、LogUI／Autobet 已 mount）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var COLS = EV.CFG.COLS, NN = EV.N, CAP = EV.CFG.CAP;
var $ = function(id){ return document.getElementById(id); };
function wait(ms, fn){ setTimeout(fn, ms); }

var DEV_ON = !!(D.q.dev || D.q.shot);
var armed = null;                          // 面板預約的狀態 { kind:'coin'|'diamond'|'crown' }（和核心的 nextPlan 同步）
var panelRefresh = function(){};

function setArmed(a){                      // a＝{ kind }｜null；沒有 kind 等於取消
  armed = a && a.kind != null ? { kind: a.kind } : null;
  g.armNext(armed ? { kind: armed.kind } : null);
  panelRefresh();
}
/* 能量條集到剩 1 格：下一注（這張盤面）必下金幣雨。核心只在 BET 階段肯改；失敗（演出中）回 false */
function meterNear(){ return g.setMeter(EV.RAIN_EVERY - 1) === true; }
/* 獎池加 n 倍面額（核心夾在 0～EV.potMax）：演出中核心不肯改、回 false */
function potBoost(n){ return g.setPot(g.getPot() + (n || 10) * g.getDenom()) === true; }

/* 填滿盤面：把目前面額那張盤面寫成幾乎每格 3 枚（對角線留 2 枚），標成「丟過了」，再重整讓核心接回。 */
function fillBoard(){
  if(ui.isBusy() || g.getPending()){ if(window.Toast) Toast.show(T('dev.fillBusy')); return false; }
  var d = D.ls('core'), di = g.getDenomIndex(), h = [], gm = [], i;
  if(!d || !d.boards) return false;
  for(i = 0; i < NN; i++){ h.push(i % (COLS + 1) === 0 ? CAP - 2 : CAP - 1); gm.push([]); }
  d.boards[di] = { h: h, g: gm };
  if(!d.fresh) d.fresh = [];
  d.fresh[di] = false;
  D.ls('core', d); D.ls('first', 1);
  location.reload();
  return true;
}

if(DEV_ON){
  D.dev = {
    force: function(plan){ setArmed(plan ? { kind: plan.kind === undefined ? null : plan.kind } : null); },
    clear: function(){ setArmed(null); },
    armedInfo: function(){ return armed ? { kind: armed.kind } : null; },
    meterNear: meterNear,
    potBoost: potBoost,
    fillBoard: fillBoard
  };
  g.on(function(type){                     // 預約用掉（下一次成功的下注）或重置：面板狀態跟著清；能量條、面額變了：狀態列跟著換
    if(type === 'result' || type === 'reset') armed = null;
    if(type === 'result' || type === 'reset' || type === 'meter' || type === 'denom' || type === 'pot') panelRefresh();
  });
}

/* ---------- 導演台面板（?dev=1） ---------- */
if(D.q.dev){
  var css = document.createElement('style');
  css.textContent =
    '#app #director{left:0;right:0;top:0;width:auto;height:0;padding:0;border:0;background:none;display:none;z-index:32;pointer-events:none}' +
    '#app #director.on{display:block}' +
    '#director .dtog{pointer-events:auto;position:absolute;left:12px;top:789px;height:21px;padding:0 10px;white-space:nowrap;font-size:11px;line-height:1;border-radius:11px}' +   // 頂欄放了提示鈕，導演台的開關改放最底下那條空白
    
    '#director .dtog.armed{border-color:#ffd24a;color:#ffd24a}' +
    '#director .dpanel{pointer-events:auto;position:absolute;left:8px;right:8px;top:46px;display:none;flex-direction:column;gap:6px;' +
      'padding:8px;border:1px dashed #6B4E2A;border-radius:8px;background:rgba(30,20,6,.97)}' +
    '#director.open .dpanel{display:flex}' +
    '#director .dst{font-size:12px;color:#E7B97A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#director .drow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}' +
    '#director .dlb{flex:none;min-width:44px;font-size:11.5px;color:#a89a7a}' +
    '#director .drow button{flex:1 1 0;min-width:0;padding:6px 2px;line-height:1.25}' +
    '#director .drow button.on{border-color:#ffd24a;color:#ffd24a}' +
    '#director .drow button.near{border-color:#ffd24a;color:#ffd24a}';
  document.head.appendChild(css);

  var dir = $('director');
  dir.innerHTML = '<button class="dtog" id="devTog" type="button">' + T('dev.title') + ' ▾</button>' +
    '<div class="dpanel" id="devPanel"><div class="dst" id="devStatus"></div>' +
    '<div class="drow" id="devKind"><span class="dlb">' + T('dev.kind') + '</span></div>' +
    '<div class="drow" id="devMeter"><span class="dlb">' + T('dev.meter') + '</span></div>' +
    '<div class="drow" id="devPotRow"><span class="dlb">' + T('dev.pot') + '</span></div>' +
    '<div class="drow" id="devTools"></div></div>';
  var mk = function(host, id, text, fn){
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.textContent = text; b.onclick = fn; $(host).appendChild(b); return b;
  };
  var setKind = function(k){ setArmed({ kind: k }); };
  var kinds = [[null, 'dev.any', 'any'], ['coin', 'log.k.coin', 'coin'], ['diamond', 'log.k.diamond', 'diamond'], ['crown', 'log.k.crown', 'crown']];
  kinds.forEach(function(k){ mk('devKind', 'devK-' + k[2], T(k[1]), function(){ setKind(k[0]); }); });
  mk('devMeter', 'devMeterNear', T('dev.meterNear'), function(){ if(!meterNear() && window.Toast) Toast.show(T('dev.meterBusy')); });
  mk('devPotRow', 'devPotPlus', T('dev.potPlus'), function(){ if(!potBoost(10) && window.Toast) Toast.show(T('dev.potBusy')); });
  mk('devTools', 'devAdd', T('dev.add'), function(){ g.addMoney(1000) || (window.Toast && Toast.show(T('dev.addBusy'))); });
  mk('devTools', 'devReset', T('dev.reset'), function(){
    if(ui.resetWallet() !== false) LogUI.clear();
  });
  mk('devTools', 'devFill', T('dev.fill'), function(){ fillBoard(); });
  mk('devTools', 'devCancel', T('dev.cancel'), function(){ setArmed(null); });
  $('devTog').onclick = function(){ dir.classList.toggle('open'); };

  panelRefresh = function(){
    var a = armed, st = $('devStatus'), parts = [], rainNext = g.getMeter() >= EV.RAIN_EVERY - 1;
    if(a && a.kind != null) parts.push(T('log.k.' + a.kind));
    if(rainNext) parts.push(T('dev.rainNext'));
    st.textContent = parts.length ? T('dev.armed', { k: parts.join('・') }) : T('dev.idle');
    $('devTog').classList.toggle('armed', !!a || rainNext);
    var ak = a ? a.kind : null;
    [[null, 'any'], ['coin', 'coin'], ['diamond', 'diamond'], ['crown', 'crown']].forEach(function(k){ $('devK-' + k[1]).classList.toggle('on', ak === k[0]); });
    $('devMeterNear').classList.toggle('near', rainNext);
  };
  dir.classList.add('on');
  panelRefresh();
}

/* ---------- 自動駕駛（?shot=） ---------- */
var TURBO = 40;
function fastPlay(cell, plan, extra){
  var o = { plan: plan || { kind: 'coin' }, speed: TURBO }, k;
  if(extra) for(k in extra) o[k] = extra[k];
  return ui.play(cell, o);
}
function coldCell(){ var b = g.getBoard(), best = 0, i; for(i = 1; i < NN; i++) if(b.h[i] < b.h[best]) best = i; return best; }   // 最空的格（丟下去不會爆）
function hotCell(){ var b = g.getBoard(), i; for(i = 0; i < NN; i++) if(b.h[i] === CAP - 1) return i; return coldCell(); }
function seq(list, cb){                                    // 依序跑 [fn() → Promise]，全部演完呼叫 cb
  var i = 0;
  (function next(){
    if(i >= list.length){ cb(); return; }
    var p = list[i++]();
    (p && p.then ? p : Promise.resolve()).then(function(){ wait(40, next); }, function(){ window.__shotError = 'seq failed at ' + i; cb(); });
  })();
}
/* 紀錄畫面用的幾注：100 面額（連爆贏、沒爆輸、再一個連爆）→ 切到 500 面額、把能量條設成剩 1 格、獎池設成 8 倍面額，丟起始發光格（連爆＋金幣雨＋拿獎池） */
function logSeq(cb){
  seq([
    function(){ return fastPlay(g.glowCell()); },
    function(){ return fastPlay(coldCell()); },
    function(){ return fastPlay(coldCell()); },
    function(){ return fastPlay(hotCell()); },
    function(){ return fastPlay(coldCell()); },
    function(){ ui.setDenom(1); return new Promise(function(r){ wait(900, r); }); },
    function(){ g.setMeter(EV.RAIN_EVERY - 1); g.setPot(8 * g.getDenom()); return fastPlay(g.glowCell(), { kind: 'coin' }); }   // 連鎖＋金幣雨＋拿獎池
  ], cb);
}
D.shots = D.shots || {};
D.shots['auto-modal'] = function(done){
  fastPlay(coldCell()).then(function(){ wait(60, function(){ $('autoBtn').click(); wait(1400, done); }); });
};
D.shots['auto-run'] = function(done){                      // 自動下注進行中：第 3/10 局，停在第 2 波炸開（浮條：局數與累計）
  fastPlay(coldCell()).then(function(){
    ui.setDenom(1);                                        // 500 面額那張還沒丟過：起始盤面有發光格，自動會挑到會爆的
    wait(900, function(){
      var play0 = ui.play, n = 0;
      ui.play = function(cell, o){                         // 截圖專用：前兩局加速、第 3 局停在連爆中（Autobet 的 adapter 每局呼叫 ui.play）
        n++; o = o || {};
        if(n < 3){ o.speed = TURBO; return play0.call(ui, cell, o); }
        o.freeze = { wave: 1, frac: 0.5 };
        play0.call(ui, cell, o).then(function(){ ui.play = play0; done(); });
        return new Promise(function(){});                  // 不回覆：自動下注停在「第 3 局進行中」
      };
      Autobet.start({ choice: 'quick', stake: 500, rounds: 10, tp: 0, sl: 0 });
    });
  });
};
D.shots['log-list'] = function(done){ logSeq(function(){ LogUI.open(); wait(500, done); }); };
D.shots['log-detail'] = function(done){ logSeq(function(){ LogUI.openDetail(0); wait(500, done); }); };

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
if(!DEV_ON){ delete D.game; D.shots = {}; }
})();
