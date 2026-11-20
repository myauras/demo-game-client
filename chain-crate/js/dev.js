/* =========================================================================
 * 連鎖開箱——導演台（?dev=1）＋截圖自動駕駛（?shot=）
 *
 * 導演台：強制「下一局」開出 沒中／小連鎖／回本以上／大贏／大獎；＋10,000；重置錢包。
 *   作法只有一種：用核心的 rollRound 對一個個 seed 重算，挑到第一個符合條件的 seed，
 *   把那一局的亂數換成 makeRng(seed)（包在 game.setRng 外面，局一開始就還原）。
 *   整局結果仍由核心 draw／payout 算出——沒有改核心、沒有改賠率、沒有改結果物件；
 *   叫出來的局可以用 DEMO.dev.replay(pick) 拿同一個 seed 重算，結果必須逐項相同（test/probe-c03.js 驗）。
 *   只在 ?dev 或 ?shot 才掛 DEMO.dev：預設網址 DEMO.dev 是 undefined、也看不到面板
 *   （正式網址不能從 console 指定開獎，demo-ship 交接抓到過的後門）。
 *
 * DEMO.dev（?dev／?shot 才有）：
 *   kinds                      ['none','small','back','big','jackpot']
 *   force(kind, {sticky})      預約下一局（sticky＝每局都叫，直到 clear）
 *   forceWhere(pred, o)        自訂條件預約（pred(核心結果)→boolean；o.start＝起始 seed、o.sticky、o.label）
 *   clear()                    取消預約
 *   last / history             最近一次與全部「叫出來的局」：{ kind, seed, tier, stake, orderId }
 *   replay(pick)               用同一組 seed 經核心重算整局結果（回傳結果物件）
 *   seek(tierId, stake, pred, start?) → seed（0＝找不到）　useSeed(seed)　setBase(rngFn)
 * DEMO.shots[名] = function(done)：跑到該畫面呼叫 done() → window.__shotReady（tools/shot.mjs 靠它截圖）。
 *   沒帶 ?shot 時直接 __shotReady = true。?shot 模式不讀寫 localStorage（見 env.js）且亂數固定。
 * 內建畫面：idle／chain／open／result-win／result-miss／big／auto-modal／auto-run／log-list／log-detail
 *   （另有自看用的 idle-stable／idle-wild／fall／drop／nochain／long／bigwin）。
 * 最後載入（依賴 ui-main.js 已建好 DEMO.game／DEMO.ui，wire.js 已 mount LogUI／Autobet）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var CFG = EV.CFG;
var $ = function(id){ return document.getElementById(id); };
function wait(ms, fn){ setTimeout(fn, ms); }

D.addStrings({
  'dev.title'  : '導演台',
  'dev.add'    : '＋10,000',
  'dev.rand'   : '隨機',
  'dev.sticky' : '連續',
  'dev.idle'   : '下一局：隨機',
  'dev.armed'  : '下一局：{k}',
  'dev.armedAll': '每局：{k}',
  'dev.k.none' : '沒中',
  'dev.k.small': '小連鎖',
  'dev.k.back' : '回本以上',
  'dev.k.big'  : '大贏',
  'dev.k.jackpot': '大獎'
});

/* ---------- 五種結果的條件（只讀核心結果；門檻讀 EV.CFG） ---------- */
var KINDS = ['none', 'small', 'back', 'big', 'jackpot'];
var PRED = {
  none:    function(r){ return r.chains === 0; },                                      // 沒連到
  small:   function(r){ return r.chains >= 1 && r.totalX < 1; },                       // 有連鎖但沒回本
  back:    function(r){ return r.totalX >= 1 && r.totalX < CFG.BIG_X; },               // 回本以上、未達大贏
  big:     function(r){ return r.totalX >= CFG.BIG_X && r.totalX < CFG.JACKPOT_X; },   // 大贏
  jackpot: function(r){ return r.totalX >= CFG.JACKPOT_X; }                            // 大獎
};

/* 用核心一路重算，直到有一局符合 pred，回傳該局的 seed（0＝找不到）。
 * 搜尋用 lean 模式（核心註明：邏輯與亂數消耗和完整模式完全相同，只少了演出用紀錄），選定後再用完整模式複核。 */
function seek(tierId, stake, pred, start){
  var ti = EV.tierIndex(tierId);
  if(ti < 0) return 0;
  var s0 = (start == null ? Math.floor(Math.random() * 4294967296) : start) >>> 0;
  for(var k = 0; k < 2000000; k++){
    var sd = (s0 + k) >>> 0;
    var r = DemoCore.rollRound(ti, stake, DemoCore.makeRng(sd), true);
    if(pred(r) && pred(DemoCore.rollRound(ti, stake, DemoCore.makeRng(sd), false))) return sd;
  }
  return 0;
}

if(D.q.dev || D.q.shot){
  var base = g.getRng();           // 沒預約時照原樣用它
  var cur = null;                  // 本局要用的 seed 亂數（roundStart 一到就還原）
  var armed = null;                // { kind, pred, start, sticky }
  var pick = null;                 // 正在叫的這一局：{ kind, seed, tier, stake, orderId }
  var hist = [];
  var detStart = D.q.shot ? 1 : null;   // 截圖模式：從固定 seed 開始找，畫面可重現

  /* 預約是「下一次核心抽結果時」才依當下檔位／注額去找 seed：
     手點、自動下注（play 會先切檔位／注額再 bet）、截圖都走同一條路 */
  g.setRng(function(){
    if(!cur && armed){
      var tid = ui.getTier(), st = ui.getStake();
      var sd = seek(tid, st, armed.pred, armed.start != null ? armed.start : detStart);
      pick = { kind:armed.kind, seed:sd, tier:tid, stake:st, orderId:null };
      if(sd) cur = DemoCore.makeRng(sd);
      if(!armed.sticky) armed = null;
      refreshStatus();
    }
    return cur ? cur() : base();
  });
  ui.on('roundStart', function(d){      // 核心已抽完這局 → 還原
    if(pick){ pick.orderId = d.orderId; pick.tier = d.tier; pick.stake = d.stake; hist.push(pick); D.dev.last = pick; }
    cur = null; pick = null;
    refreshStatus();
  });

  D.dev = {
    kinds:KINDS, seek:seek, last:null, history:hist,
    force:function(kind, o){
      if(!PRED[kind]) throw new Error('unknown kind: ' + kind);
      o = o || {};
      armed = { kind:kind, label:T('dev.k.' + kind), pred:PRED[kind], start:o.start, sticky:!!o.sticky };
      refreshStatus();
    },
    forceWhere:function(pred, o){
      o = o || {};
      armed = { kind:o.label || 'custom', label:o.label || '?', pred:pred, start:o.start, sticky:!!o.sticky };
      refreshStatus();
    },
    armedInfo:function(){ return armed ? { label:armed.label, sticky:armed.sticky } : null; },
    clear:function(){ armed = null; cur = null; pick = null; refreshStatus(); },
    useSeed:function(s){ cur = DemoCore.makeRng(s); pick = { kind:'seed', seed:s, tier:null, stake:null, orderId:null }; },
    setBase:function(fn){ base = fn; },
    replay:function(p){ return DemoCore.rollRound(EV.tierIndex(p.tier), p.stake, DemoCore.makeRng(p.seed), false); }
  };
  if(D.q.shot) base = DemoCore.makeRng(20261120);   // 截圖：沒預約的局也固定
}

/* ---------- 導演台面板（?dev=1） ---------- */
function refreshStatus(){
  var st = $('devStatus');
  if(!st || !D.dev) return;
  var a = D.dev.armedInfo();
  st.textContent = a ? T(a.sticky ? 'dev.armedAll' : 'dev.armed', { k:a.label }) : T('dev.idle');
}
if(D.q.dev){
  var css = document.createElement('style');
  css.textContent =
    '#app #director{left:146px;top:10px;right:auto;width:172px;height:34px;padding:0 4px 0 6px;gap:4px;box-sizing:border-box;' +
      'flex-wrap:nowrap;z-index:36;font-size:11px;align-items:center}' +
    '#director .dtog{flex:none;padding:3px 6px}' +
    '#director .dst{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#director .dpanel{position:absolute;left:-136px;top:38px;width:355px;box-sizing:border-box;display:none;flex-wrap:wrap;' +
      'gap:6px;padding:8px;border:1px dashed #6B4E2A;border-radius:8px;background:rgba(30,20,6,.97)}' +
    '#director.open .dpanel{display:flex}' +
    '#director .dpanel button{flex:1 1 28%;min-width:0;padding:6px 2px;line-height:1.25}' +
    '#director .dpanel button.on{border-color:#ffcf5a;color:#ffe9a6}';
  document.head.appendChild(css);

  var dir = $('director');
  dir.innerHTML = '<button class="dtog" id="devTog" type="button">' + T('dev.title') + ' ▾</button>' +
    '<span class="dst" id="devStatus"></span><div class="dpanel" id="devPanel"></div>';
  var panel = $('devPanel');
  KINDS.forEach(function(k){
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'devK-' + k; b.textContent = T('dev.k.' + k);
    b.onclick = function(){ D.dev.force(k, { sticky:sticky }); dir.classList.remove('open'); };
    panel.appendChild(b);
  });
  var sticky = false;
  function mk(id, text, fn){
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.textContent = text; b.onclick = fn; panel.appendChild(b); return b;
  }
  var stBtn = mk('devSticky', T('dev.sticky'), function(){
    sticky = !sticky; stBtn.classList.toggle('on', sticky);
  });
  mk('devRand', T('dev.rand'), function(){ D.dev.clear(); dir.classList.remove('open'); });
  mk('devAdd', T('dev.add'), function(){ g.addMoney(10000); });
  mk('devReset', T('dev.reset'), function(){
    if(Autobet.isRunning()) Autobet.stop();
    if(ui.resetWallet() !== false && window.LogUI) LogUI.clear();
  });
  $('devTog').onclick = function(){ dir.classList.toggle('open'); };
  dir.classList.add('on');

  refreshStatus();
}

/* ---------- 自動駕駛工具（?shot=） ---------- */
/* 指定條件的一局：pred 為函式或五種 kind 的名字；stopAt＝停在某瞬間（見 ui-main.js maybeStop），否則演完再等 after ms */
function drive(done, tierId, spec, o){
  o = o || {};
  var pred = typeof spec === 'string' ? PRED[spec] : spec;
  var stake = o.stake || 100;
  D.dev.forceWhere(pred, { label:'shot', start:o.start });
  var opt = { fast:!!o.fast };
  var oops = function(e){ window.__shotError = 'play failed: ' + (e && e.message); done(); };
  if(o.stopAt){
    opt.stopAt = o.stopAt;
    opt.onStop = function(){ done(); };
    ui.play(tierId, stake, opt).catch(oops);
  }else{
    ui.play(tierId, stake, opt).then(function(){ wait(o.after || 250, done); }, oops);
  }
}
/* 依序打幾局 [[檔位, 條件, 起始 seed], ...]（快速、決定性），全部演完呼叫 cb */
function seq(list, cb){
  var i = 0;
  (function next(){
    if(i >= list.length){ cb(); return; }
    var it = list[i++];
    D.dev.forceWhere(typeof it[1] === 'string' ? PRED[it[1]] : it[1], { label:'shot', start:it[2] });
    ui.play(it[0], 100, { fast:true }).then(function(){ wait(60, next); }, function(){ wait(100, next); });
  })();
}
var CH3 = function(r){ return r.chains >= 3 && r.totalX >= 1; };
var WIN = function(r){ return r.chains >= 3 && r.totalX >= 1.2 && r.totalX < CFG.BIG_X; };
var MISS = function(r){ return r.chains >= 2 && r.totalX < 1; };
var LOGSEQ = [['mid', 'none', 11], ['mid', MISS, 21], ['mid', 'big', 31], ['stable', 'small', 41], ['mid', WIN, 51]];

D.shots.idle = function(done){ wait(50, done); };
D.shots['idle-stable'] = function(done){ ui.setTier('stable'); wait(400, done); };
D.shots['idle-wild'] = function(done){ ui.setTier('wild'); wait(400, done); };
D.shots.chain = function(done){ drive(done, 'mid', CH3, { stopAt:{ phase:'circle', step:2, delay:380 } }); };
D.shots.open = function(done){ drive(done, 'mid', CH3, { stopAt:{ phase:'open', step:2, delay:210 } }); };
D.shots['result-win'] = function(done){ drive(done, 'mid', WIN, { fast:true, stopAt:{ phase:'settle', delay:350 } }); };
D.shots['result-miss'] = function(done){ drive(done, 'mid', MISS, { fast:true, stopAt:{ phase:'settle', delay:350 } }); };
D.shots.big = function(done){
  drive(done, 'mid', function(r){ return r.totalX >= 22 && r.totalX < 60; }, { fast:true, stopAt:{ phase:'jackpot', delay:1000 } });
};
D.shots['auto-modal'] = function(done){ ui.setTier('mid'); ui.setStake(500); $('autoBtn').click(); wait(450, done); };
D.shots['auto-run'] = function(done){
  ui.setTier('mid');
  Autobet.start({ choice:'alt', stake:100, rounds:10, tp:1000, sl:500 });
  var iv = setInterval(function(){
    if(Autobet.state().n >= 2){
      clearInterval(iv);
      wait(1300, function(){ try{ document.getAnimations().forEach(function(a){ a.pause(); }); }catch(e){} done(); });
    }
  }, 100);
};
D.shots['log-list'] = function(done){ seq(LOGSEQ, function(){ LogUI.open(); wait(450, done); }); };
D.shots['log-detail'] = function(done){ seq(LOGSEQ, function(){ LogUI.openDetail(0); wait(450, done); }); };
/* 自看用 */
D.shots.fall = function(done){            // 無頭瀏覽器剛載入約 1 秒內動畫時鐘不走，先等一下再開局
  wait(1500, function(){ drive(done, 'mid', function(r){ return r.chains >= 2; }, { stopAt:{ phase:'init', delay:260 } }); });
};
D.shots.drop = function(done){ drive(done, 'mid', function(r){ return r.chains >= 2; }, { stopAt:{ phase:'drop', step:0, delay:170 } }); };
D.shots.nochain = function(done){ drive(done, 'mid', 'none', { fast:true, after:150 }); };
D.shots.long = function(done){ drive(done, 'stable', function(r){ return r.chains >= 7; }, { fast:true, after:200 }); };
D.shots.bigwin = function(done){ drive(done, 'mid', 'big', { stopAt:{ phase:'settle', delay:450 }, fast:true }); };

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
/* 預設網址（沒有 ?dev／?shot）不留核心把手：否則 console 可用 DEMO.game.setRng 指定開獎、addMoney 加錢。
 * 各模組載入時已各自留了一份參照（ui-main 的 game、wire 的 g），拿掉這個全域入口不影響遊玩。 */
if(!(D.q.dev || D.q.shot)) delete D.game;
})();
