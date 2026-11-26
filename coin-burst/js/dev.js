/* =========================================================================
 * 爆金連鎖——導演台（?dev=1）＋截圖自動駕駛（?shot=）
 *
 * 導演台（?dev=1 才出現；預設網址 DEMO.dev＝undefined、畫面沒有任何 dev 字樣）：
 *   下一枚是什麼（金幣／鑽石／皇冠）、下一注有沒有天降（無／有／指定落點）——都走核心公開的 armNext(plan)
 *   （EV.scripted：只替前幾次取值指定結果，其餘照 rng；不動 rng、不動核心、不動賠率）；
 *   ＋1,000（core.addMoney）、重置錢包（ui.resetWallet＋清紀錄，免二段確認）、取消預約、
 *   填滿盤面（把目前這張盤面寫成「幾乎每格 3 枚」的存檔再重整——只用核心存檔格式，核心不動；錢包與紀錄不動）。
 *   預約只對「下一次成功的下注」生效，用完自動清掉；面板的選中狀態跟著清。
 *
 * DEMO.dev（?dev／?shot 才有）：
 *   force(plan)       預約下一注（plan 形狀同 armNext：{ kind?, sky? }）；force(null)＝取消
 *   clear()           取消預約
 *   armedInfo()       目前預約 { kind, sky }｜null
 *   fillBoard()       填滿目前面額的盤面（重整頁面）；演出中回 false
 *   plan 之外的導演台功能都在面板上，沒有別的把手
 *
 * 預設網址（沒有 ?dev／?shot）不留把手：DEMO.game 與 DEMO.shots 在這裡拿掉（各模組載入時已各自留了參照，
 *   不影響遊玩）；否則 console 可用 DEMO.game.setRng／armNext／addMoney 指定開獎或加錢。
 *
 * 自動駕駛：DEMO.shots[名] = function(done)，跑到該畫面呼叫 done() → window.__shotReady = true（tools/shot.mjs 靠它截圖）。
 *   ?shot 模式不讀寫 localStorage（見 env.js）。主畫面的畫面（idle／first／chain／win／big／huge／sky／gem／denom／seq-N）
 *   定義在 ui-main.js；這裡補：auto-modal／auto-run／log-list／log-detail。
 * 最後載入（依賴 ui-main.js、wire.js 已建好 DEMO.game／DEMO.ui、LogUI／Autobet 已 mount）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var COLS = EV.CFG.COLS, NN = EV.N, CAP = EV.CFG.CAP;
var $ = function(id){ return document.getElementById(id); };
function wait(ms, fn){ setTimeout(fn, ms); }

var DEV_ON = !!(D.q.dev || D.q.shot);
var armed = null;                          // 面板預約的狀態 { kind:null|'coin'|…, sky:null|false|true|格號 }（和核心的 nextPlan 同步）
var panelRefresh = function(){};

function planOf(a){
  var p = {};
  if(a && a.kind != null) p.kind = a.kind;
  if(a && a.sky != null) p.sky = a.sky;
  return p;
}
function setArmed(a){                      // a＝{ kind, sky }｜null；空預約等於取消
  if(a && a.kind == null && a.sky == null) a = null;
  armed = a ? { kind: a.kind == null ? null : a.kind, sky: a.sky == null ? null : a.sky } : null;
  g.armNext(armed ? planOf(armed) : null);
  panelRefresh();
}

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
    force: function(plan){ setArmed(plan ? { kind: plan.kind === undefined ? null : plan.kind, sky: plan.sky === undefined ? null : plan.sky } : null); },
    clear: function(){ setArmed(null); },
    armedInfo: function(){ return armed ? { kind: armed.kind, sky: armed.sky } : null; },
    fillBoard: fillBoard
  };
  g.on(function(type){                     // 預約用掉（下一次成功的下注）或重置：面板狀態跟著清
    if(type === 'result' || type === 'reset'){ armed = null; panelRefresh(); }
  });
}

/* ---------- 導演台面板（?dev=1） ---------- */
if(D.q.dev){
  var css = document.createElement('style');
  css.textContent =
    '#app #director{left:0;right:0;top:0;width:auto;height:0;padding:0;border:0;background:none;display:none;z-index:32;pointer-events:none}' +
    '#app #director.on{display:block}' +
    '#director .dtog{pointer-events:auto;position:absolute;left:156px;top:8px;height:32px;padding:0 10px;white-space:nowrap;font-size:12px;border-radius:16px}' +
    '#director .dtog.armed{border-color:#ffd24a;color:#ffd24a}' +
    '#director .dpanel{pointer-events:auto;position:absolute;left:8px;right:8px;top:46px;display:none;flex-direction:column;gap:6px;' +
      'padding:8px;border:1px dashed #6B4E2A;border-radius:8px;background:rgba(30,20,6,.97)}' +
    '#director.open .dpanel{display:flex}' +
    '#director .dst{font-size:12px;color:#E7B97A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#director .drow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}' +
    '#director .dlb{flex:none;width:44px;font-size:11.5px;color:#a89a7a}' +
    '#director .drow button{flex:1 1 0;min-width:0;padding:6px 2px;line-height:1.25}' +
    '#director .drow button.on{border-color:#ffd24a;color:#ffd24a}' +
    '#director .drow select{flex:2 1 0;min-width:0;font-size:12px;padding:5px 2px}';
  document.head.appendChild(css);

  var dir = $('director');
  dir.innerHTML = '<button class="dtog" id="devTog" type="button">' + T('dev.title') + ' ▾</button>' +
    '<div class="dpanel" id="devPanel"><div class="dst" id="devStatus"></div>' +
    '<div class="drow" id="devKind"><span class="dlb">' + T('dev.kind') + '</span></div>' +
    '<div class="drow" id="devSky"><span class="dlb">' + T('dev.sky') + '</span></div>' +
    '<div class="drow" id="devTools"></div></div>';
  var mk = function(host, id, text, fn){
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.textContent = text; b.onclick = fn; $(host).appendChild(b); return b;
  };
  var cur = function(){ return armed || { kind: null, sky: null }; };
  var setKind = function(k){ setArmed({ kind: k, sky: cur().sky }); };
  var setSky = function(s){ setArmed({ kind: cur().kind, sky: s }); };
  var kinds = [[null, 'dev.any', 'any'], ['coin', 'log.k.coin', 'coin'], ['diamond', 'log.k.diamond', 'diamond'], ['crown', 'log.k.crown', 'crown']];
  kinds.forEach(function(k){ mk('devKind', 'devK-' + k[2], T(k[1]), function(){ setKind(k[0]); }); });
  var skys = [[null, 'dev.any', 'any'], [false, 'dev.no', 'no'], [true, 'dev.yes', 'yes']];
  skys.forEach(function(s){ mk('devSky', 'devS-' + s[2], T(s[1]), function(){ setSky(s[0]); }); });
  var sel = document.createElement('select');
  sel.id = 'devSkyCell';
  sel.innerHTML = '<option value="">' + T('dev.cell') + '</option>';
  for(var ci = 0; ci < NN; ci++) sel.innerHTML += '<option value="' + ci + '">' + T('log.d.cellAt', { r: ((ci / COLS) | 0) + 1, c: (ci % COLS) + 1 }) + '</option>';
  sel.onchange = function(){ if(sel.value !== '') setSky(+sel.value); else if(typeof cur().sky === 'number') setSky(true); };
  $('devSky').appendChild(sel);
  mk('devTools', 'devAdd', T('dev.add'), function(){ g.addMoney(1000) || (window.Toast && Toast.show(T('dev.fillBusy'))); });
  mk('devTools', 'devReset', T('dev.reset'), function(){
    if(ui.resetWallet() !== false) LogUI.clear();
  });
  mk('devTools', 'devFill', T('dev.fill'), function(){ fillBoard(); });
  mk('devTools', 'devCancel', T('dev.cancel'), function(){ setArmed(null); });
  $('devTog').onclick = function(){ dir.classList.toggle('open'); };

  panelRefresh = function(){
    var a = armed, st = $('devStatus'), parts = [];
    if(a && a.kind != null) parts.push(T('log.k.' + a.kind));
    if(a && a.sky === false) parts.push(T('dev.skyNone'));
    else if(a && a.sky === true) parts.push(T('dev.skyAny'));
    else if(a && typeof a.sky === 'number') parts.push(T('dev.skyAt', { c: T('log.d.cellAt', { r: ((a.sky / COLS) | 0) + 1, c: (a.sky % COLS) + 1 }) }));
    st.textContent = a ? T('dev.armed', { k: parts.join('・') }) : T('dev.idle');
    $('devTog').classList.toggle('armed', !!a);
    var ak = a ? a.kind : null, as = a ? a.sky : null;
    [[null, 'any'], ['coin', 'coin'], ['diamond', 'diamond'], ['crown', 'crown']].forEach(function(k){ $('devK-' + k[1]).classList.toggle('on', ak === k[0]); });
    [[null, 'any'], [false, 'no'], [true, 'yes']].forEach(function(s){ $('devS-' + s[1]).classList.toggle('on', as === s[0]); });
    sel.value = typeof as === 'number' ? String(as) : '';
  };
  dir.classList.add('on');
  panelRefresh();
}

/* ---------- 自動駕駛（?shot=） ---------- */
var TURBO = 40;
function fastPlay(cell, plan, extra){
  var o = { plan: plan || { kind: 'coin', sky: false }, speed: TURBO }, k;
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
/* 紀錄畫面用的幾注：100 面額（連爆贏、沒爆輸、再一個連爆）→ 切到 500 面額丟起始發光格（連爆＋天降） */
function logSeq(cb){
  seq([
    function(){ return fastPlay(g.glowCell()); },
    function(){ return fastPlay(coldCell()); },
    function(){ return fastPlay(coldCell()); },
    function(){ return fastPlay(hotCell()); },
    function(){ return fastPlay(coldCell()); },
    function(){ ui.setDenom(1); return new Promise(function(r){ wait(900, r); }); },
    function(){ return fastPlay(g.glowCell(), { kind: 'coin', sky: 9 }); }
  ], cb);
}
D.shots = D.shots || {};
D.shots['auto-modal'] = function(done){
  fastPlay(coldCell()).then(function(){ wait(60, function(){ $('autoBtn').click(); wait(500, done); }); });
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
      Autobet.start({ stake: 500, rounds: 10, tp: 0, sl: 0 });
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
