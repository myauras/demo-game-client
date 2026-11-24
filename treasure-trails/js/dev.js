/* =========================================================================
 * 三路尋寶——導演台（?dev=1）＋截圖自動駕駛（?shot=）
 *
 * 導演台：指定「下一局」開出 什麼都沒拿到／小拿沒回本／回本／大贏／大獎／重打很多次／走到底；＋10,000；重置錢包；
 *   換一張地圖；固定地圖種子與骰子種子。
 *   作法只有一種：下注的瞬間，用核心的 DemoCore.simulate 對目前這張地圖、這條路、這個注額，一個個種子重算，
 *   挑到第一個符合條件的種子，把這一局的亂數換成 mulberry32(種子)（包在 game.setRng 外面，bet 一回來就還原）。
 *   整局結果仍由核心 draw 算出——沒有改核心、沒有改賠率、沒有改結果物件、沒有動骰子；
 *   叫出來的局可以用 DEMO.dev.replay(pick) 拿同一組（地圖種子、路線、注額、種子）經核心重算，結果必須逐項相同（probe-t03.js 驗）。
 *   只在 ?dev 或 ?shot 才掛 DEMO.dev／DEMO.game：預設網址兩者都是 undefined、也看不到面板、DEMO.shots 清空
 *   （正式網址不能從 console 指定開獎或加錢；demo-ship 交接抓到過的後門）。
 *
 * DEMO.dev（?dev／?shot 才有）：
 *   kinds                      ['none','small','back','big','jackpot','retry','end']
 *   force(kind, {sticky})      預約下一局（sticky＝每局都叫，直到 clear）；回傳 true／false（這條路不可能出這種結果）
 *   forceWhere(pred, o)        自訂條件預約（pred(核心結果)→boolean；o.start＝起始種子、o.sticky、o.label）
 *   clear()                    取消預約
 *   last / history             最近一次與全部「叫出來的局」：{ kind, seed, route, stake, mapSeed, orderId }
 *   replay(pick)               用同一組種子經核心重算整局結果（回傳結果物件）
 *   seek(map, routeIndex, stake, pred, start?) → 種子（0＝找不到）
 *   useSeed(seed)              下一局的骰子固定用這個種子（一次性）
 *   setMap(seed)               指定地圖種子（演出中不可）；randomMap() 換一張隨機的
 *   setBase(rngFn)             換掉沒預約時的亂數源
 * DEMO.shots[名] = function(done)：跑到該畫面呼叫 done() → window.__shotReady（tools/shot.mjs 靠它截圖）。
 *   沒帶 ?shot 時直接 __shotReady = true。?shot 模式不讀寫 localStorage（見 env.js）且亂數固定、地圖固定（種子 486）。
 * 畫面：idle／idle-safe／idle-risk／long／roll／land／retry／result-win／result-miss／bigwin／big／auto-modal／auto-run／log-list／log-detail
 * 最後載入（依賴 ui-main.js 已建好 DEMO.game／DEMO.ui，wire.js 已 mount LogUI／Autobet）。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO, T = window.t, g = D.game, ui = D.ui;
var CFG = EV.CFG;
var $ = function(id){ return document.getElementById(id); };
function wait(ms, fn){ setTimeout(fn, ms); }

D.shotDispatched = true;            // ui-main.js 的簡易分派讓位給本檔（它在 load 之後才看這個旗標）

D.addStrings({
  'dev.title'  : '導演台',
  'dev.add'    : '＋10,000',
  'dev.rand'   : '隨機',
  'dev.sticky' : '連續',
  'dev.idle'   : '下一局：隨機',
  'dev.armed'  : '下一局：{k}',
  'dev.armedAll': '每局：{k}',
  'dev.notfound': '找不到：{k}（這條路抽不到，換條路試試）',
  'dev.k.none' : '什麼都沒拿到',
  'dev.k.small': '小拿沒回本',
  'dev.k.back' : '回本',
  'dev.k.big'  : '大贏',
  'dev.k.jackpot': '大獎',
  'dev.k.retry': '重打很多次',
  'dev.k.end'  : '走到底',
  'dev.map'    : '換一張圖',
  'dev.seed'   : '種子',
  'dev.seedMap': '定圖',
  'dev.seedDice': '定骰',
  'dev.mapBusy': '演出中不能換圖'
});

/* ---------- 七種結果的條件（只讀核心結果；門檻讀 EV.CFG） ---------- */
var KINDS = ['none', 'small', 'back', 'big', 'jackpot', 'retry', 'end'];
function retries(r){                                     // 重打次數＝緊接在輸的那一擲之後、同一隻的再擲
  var n = 0;
  for(var i = 1; i < r.fights.length; i++) if(!r.fights[i - 1].win && r.fights[i - 1].idx === r.fights[i].idx) n++;
  return n;
}
var PRED = {
  none:    function(r){ return r.prizes.length === 0; },                                                 // 什麼都沒拿到
  small:   function(r){ return r.total > 0 && r.total < r.stake; },                                      // 拿到了但沒回本
  back:    function(r){ return r.total >= r.stake && r.total < r.stake * CFG.MID_X; },                   // 回本以上、未達大贏
  big:     function(r){ return r.total >= r.stake * CFG.MID_X && r.total < r.stake * CFG.BIG_X; },       // 大贏
  jackpot: function(r){ return r.total >= r.stake * CFG.BIG_X; },                                        // 大獎
  retry:   function(r){ return retries(r) >= Math.min(2, r.hearts - 1); },                               // 重打很多次（穩 ≥2、中 ≥1；拚只有 1 顆心不可能）
  end:     function(r){ return r.reachedEnd; }                                                           // 走到底
};
function maxX(route){ var s = 0; route.nodes.forEach(function(n){ if(n.kind === 'prize') s += n.v; }); return s; }
var FEAS = {                                              // 這條路根本不可能的情況，不用搜尋
  big:     function(route){ return maxX(route) >= CFG.MID_X; },
  jackpot: function(route){ return maxX(route) >= CFG.BIG_X; },
  retry:   function(route){ return route.hearts >= 2; }
};

/* 用核心一路重算，直到有一局符合 pred，回傳該局的種子（0＝找不到）。
 * 和 game.bet 同一條路：DemoCore.simulate(map, 路線序, 注額, 亂數)，亂數＝mulberry32(種子)。 */
function seek(map, ri, stake, pred, start, feas){
  if(ri < 0 || !map) return 0;
  if(feas && !feas(map.routes[ri])) return 0;
  var s0 = (start == null ? Math.floor(Math.random() * 4294967296) : start) >>> 0;
  for(var k = 0; k < 300000; k++){
    var sd = (s0 + k) >>> 0;
    if(sd && pred(DemoCore.simulate(map, ri, stake, EV.mulberry32(sd)))) return sd;
  }
  return 0;
}

if(D.q.dev || D.q.shot){
  var base = g.getRng();           // 沒預約時照原樣用它
  var cur = null;                  // 本局要用的種子亂數（bet 一回來就還原）
  var armed = null;                // { kind, label, pred, feas, start, sticky }
  var diceSeed = null;             // 「定骰」：下一局骰子固定用這個種子
  var pick = null, hist = [];
  var notFound = null;             // 上一次預約找不到時的 label
  var detStart = D.q.shot ? 1 : null;   // 截圖模式：從固定種子開始找，畫面可重現

  g.setRng(function(){ return cur ? cur() : base(); });
  if(D.q.shot) base = EV.mulberry32(20261123);      // 截圖：沒預約的局也固定（含結算後換的下一張圖）

  /* 包住 game.bet：下注的瞬間才知道路線與注額（手點、自動下注、截圖都走同一條路），此時找種子、接上亂數 */
  var origBet = g.bet;
  g.bet = function(route, stake){
    var info = null;
    if(g.getState().phase === 'BET'){
      var map = g.getState().map;
      if(armed){
        var sd = seek(map, EV.routeIndex(route), stake, armed.pred, armed.start != null ? armed.start : detStart, armed.feas);
        info = { kind:armed.kind, seed:sd, route:route, stake:stake, mapSeed:map.seed, orderId:null };
        if(sd) cur = EV.mulberry32(sd); else notFound = armed.label;
      }else if(diceSeed != null){
        info = { kind:'seed', seed:diceSeed, route:route, stake:stake, mapSeed:map.seed, orderId:null };
        cur = EV.mulberry32(diceSeed);
      }
    }
    pick = info;                               // 先掛上：bet 內部發 result 事件時，下面的 g.on 要靠它記注單號
    var ok = origBet.call(g, route, stake);
    cur = null;
    if(ok && info){
      if(info.kind === 'seed') diceSeed = null;
      else if(!armed.sticky) armed = null;
      if(notFound){ if(window.Toast) Toast.show(T('dev.notfound', { k:notFound })); notFound = null; }
    }else{ pick = null; if(!ok) notFound = null; }
    refreshStatus();
    return ok;
  };
  g.on(function(type, d){                      // 結果事件：把這一局的注單號記到 pick
    if(type === 'result' && pick){
      pick.orderId = d.orderId; hist.push(pick); D.dev.last = pick; pick = null;
    }
  });

  D.dev = {
    kinds:KINDS, seek:seek, last:null, history:hist,
    force:function(kind, o){
      if(!PRED[kind]) throw new Error('unknown kind: ' + kind);
      o = o || {};
      armed = { kind:kind, label:T('dev.k.' + kind), pred:PRED[kind], feas:FEAS[kind], start:o.start, sticky:!!o.sticky };
      notFound = null;
      refreshStatus();
      var ri = EV.routeIndex(ui.getRoute());
      return !armed.feas || armed.feas(g.getState().map.routes[ri]);      // 目前這條路抽不抽得到（換路線再下注時以下注當下為準）
    },
    forceWhere:function(pred, o){
      o = o || {};
      armed = { kind:o.label || 'custom', label:o.label || '?', pred:pred, feas:o.feas || null, start:o.start, sticky:!!o.sticky };
      notFound = null;
      refreshStatus();
    },
    armedInfo:function(){ return armed ? { kind:armed.kind, label:armed.label, sticky:armed.sticky } : null; },
    clear:function(){ armed = null; diceSeed = null; notFound = null; refreshStatus(); },
    useSeed:function(s){ diceSeed = s >>> 0; armed = null; refreshStatus(); },
    setMap:function(seed){ if(ui.busy()) return false; return g.devSetMap(seed >>> 0) !== false; },
    randomMap:function(){ return D.dev.setMap(Math.floor(Math.random() * 4294967296)); },
    setBase:function(fn){ base = fn; },
    replay:function(p){                         // 同一組（地圖種子、路線、注額、種子）經核心重算
      return DemoCore.simulate(EV.genMapSeed(p.mapSeed), EV.routeIndex(p.route), p.stake, EV.mulberry32(p.seed));
    }
  };
}

/* ---------- 導演台面板（?dev=1） ---------- */
function refreshStatus(){
  var st = $('devStatus'), tg = $('devTog');
  if(!st || !D.dev) return;
  var a = D.dev.armedInfo();
  st.textContent = a ? T(a.sticky ? 'dev.armedAll' : 'dev.armed', { k:a.label }) : T('dev.idle');
  if(tg) tg.classList.toggle('armed', !!a);
}
if(D.q.dev){
  var css = document.createElement('style');
  css.textContent =
    '#app #director{left:6px;right:6px;top:6px;width:auto;height:36px;padding:0;border:0;background:none;display:none;z-index:34;pointer-events:none}' +
    '#app #director.on{display:block}' +
    '#director .dtog{pointer-events:auto;position:absolute;left:146px;top:1px;height:34px;padding:0 8px;white-space:nowrap;font-size:11.5px}' +
    '#director .dtog.armed{border-color:var(--gold);color:var(--gold)}' +
    '#director .dpanel{pointer-events:auto;position:absolute;left:0;right:0;top:40px;display:none;flex-direction:column;gap:6px;' +
      'padding:8px;box-sizing:border-box;border:1px dashed #6B4E2A;border-radius:8px;background:rgba(30,20,6,.97)}' +
    '#director.open .dpanel{display:flex}' +
    '#director .dst{font-size:11.5px;color:#E7B97A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#director .drow{display:flex;flex-wrap:wrap;gap:6px}' +
    '#director .drow button{flex:1 1 22%;min-width:0;padding:6px 2px;line-height:1.25}' +
    '#director .drow button.on{border-color:var(--gold);color:var(--gold)}' +
    '#director .drow input{flex:1 1 30%;min-width:0;box-sizing:border-box;padding:5px 6px;font-size:11.5px;color:var(--fg);' +
      'background:#1d130b;border:1px solid var(--edge);border-radius:5px}';
  document.head.appendChild(css);

  var dir = $('director'), sticky = false;
  dir.innerHTML = '<button class="dtog" id="devTog" type="button">' + T('dev.title') + ' ▾</button>' +
    '<div class="dpanel" id="devPanel"><div class="dst" id="devStatus"></div>' +
    '<div class="drow" id="devKinds"></div><div class="drow" id="devTools"></div><div class="drow" id="devSeeds"></div></div>';
  function mk(host, id, text, fn){
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.textContent = text; b.onclick = fn; $(host).appendChild(b); return b;
  }
  KINDS.forEach(function(k){
    mk('devKinds', 'devK-' + k, T('dev.k.' + k), function(){
      D.dev.force(k, { sticky:sticky });
      dir.classList.remove('open');
    });
  });
  var stBtn = mk('devTools', 'devSticky', T('dev.sticky'), function(){ sticky = !sticky; stBtn.classList.toggle('on', sticky); });
  mk('devTools', 'devRand', T('dev.rand'), function(){ D.dev.clear(); dir.classList.remove('open'); });
  mk('devTools', 'devAdd', T('dev.add'), function(){ g.addMoney(10000); });
  mk('devTools', 'devReset', T('dev.reset'), function(){
    if(Autobet.isRunning()) Autobet.stop();
    if(ui.resetWallet() !== false && window.LogUI) LogUI.clear();
  });
  mk('devSeeds', 'devMap', T('dev.map'), function(){
    if(!D.dev.randomMap() && window.Toast) Toast.show(T('dev.mapBusy'));
  });
  var inp = document.createElement('input');
  inp.type = 'number'; inp.id = 'devSeed'; inp.placeholder = T('dev.seed'); inp.min = 1; $('devSeeds').appendChild(inp);
  mk('devSeeds', 'devSeedMap', T('dev.seedMap'), function(){
    if(inp.value && !D.dev.setMap(+inp.value) && window.Toast) Toast.show(T('dev.mapBusy'));
  });
  mk('devSeeds', 'devSeedDice', T('dev.seedDice'), function(){
    if(inp.value){ D.dev.useSeed(+inp.value); dir.classList.remove('open'); }
  });
  $('devTog').onclick = function(){ dir.classList.toggle('open'); };
  dir.classList.add('on');
  refreshStatus();
}

/* ---------- 自動駕駛工具（?shot=） ---------- */
/* 指定條件的一局：stopAt＝停在某瞬間（見 ui-main.js maybeStop），否則演完再等 after ms */
function drive(done, route, stake, pred, o){
  o = o || {};
  D.dev.forceWhere(pred, { label:'shot', start:1 });
  var opt = { fast:!!o.fast };
  var oops = function(e){ window.__shotError = 'play failed: ' + (e && e.message); done(); };
  if(o.stopAt){
    opt.stopAt = o.stopAt;
    opt.onStop = function(){ done(); };
    ui.play(route, stake, opt).catch(oops);
  }else{
    ui.play(route, stake, opt).then(function(){ wait(o.after || 250, done); }, oops);
  }
}
/* 依序打幾局 [[路線, 注額, 條件, 起始種子], ...]（快速、決定性），全部演完呼叫 cb */
function seq(list, cb){
  var i = 0;
  (function next(){
    if(i >= list.length){ cb(); return; }
    var it = list[i++];
    D.dev.forceWhere(typeof it[2] === 'string' ? PRED[it[2]] : it[2], { label:'shot', start:it[3] || 1 });
    ui.play(it[0], it[1], { fast:true }).then(function(){ wait(60, next); }, function(){ wait(100, next); });
  })();
}
function retryNo(r, hearts){             // 第一個「同一隻重打」的那一擲的序；hearts 給了就要求「打輸之後剛好剩這麼多顆心」
  for(var i = 1; i < r.fights.length; i++){
    var p = r.fights[i - 1];
    if(!p.win && p.idx === r.fights[i].idx && (hearts == null || p.heartsLeft === hearts)) return i;
  }
  return -1;
}
var SHOT_MAP = 486;                      // 與 ui-main.js 的 SHOT_SEED 同一張（核心 sample-maps 的典型圖）
function onMap(seed, done){ if(g.getState().mapSeed !== seed) g.devSetMap(seed); done(); }

var LOGSEQ = [
  ['mid', 100, 'none'],
  ['safe', 500, 'small'],
  ['mid', 500, 'big', 7],
  ['risk', 100, 'none'],
  ['safe', 100, function(r){ return r.total >= r.stake && r.total < r.stake * CFG.MID_X && r.prizes.length >= 2 && retries(r) >= 1; }]
];

D.shots = {};
D.shots.idle = function(done){ ui.setRoute('mid'); wait(80, done); };
D.shots['idle-safe'] = function(done){ ui.setRoute('safe'); wait(80, done); };
D.shots['idle-risk'] = function(done){ ui.setRoute('risk'); wait(80, done); };
D.shots.long = function(done){                        // 穩路線 9 個節點的路
  for(var s = 1; s < 3000; s++){ if(EV.genMapSeed(s).routes[0].nodes.length === 9){ g.devSetMap(s); break; } }
  ui.setRoute('safe'); wait(80, done);
};
D.shots.roll = function(done){                        // 第一次擲骰翻滾中
  onMap(SHOT_MAP, function(){
    drive(done, 'mid', 100, function(r){ return r.fights.length > 1; }, { stopAt:{ phase:'fly', n:0, at:330 } });
  });
};
D.shots.land = function(done){                        // 兩顆骰落定、點數和小標出現
  onMap(SHOT_MAP, function(){
    drive(done, 'mid', 100, function(r){ return r.fights.length > 1 && r.fights[0].win; }, { stopAt:{ phase:'land', n:0, delay:170 } });
  });
};
D.shots.retry = function(done){                       // 重打同一隻、剩最後一顆心（中路線：輸一次後再擲），前面收過寶物
  onMap(SHOT_MAP, function(){
    var ok = function(r){
      var n = retryNo(r, 1);
      return n > 0 && r.prizes.some(function(p){ return p.idx < r.fights[n].idx; });
    };
    var sd = D.dev.seek(g.getState().map, 1, 100, ok, 1);          // 先找到種子，才知道第幾擲要停
    var r = DemoCore.simulate(g.getState().map, 1, 100, EV.mulberry32(sd));
    drive(done, 'mid', 100, ok, { stopAt:{ phase:'fly', n:retryNo(r, 1), at:260 } });
  });
};
D.shots['result-win'] = function(done){               // 回本以上、結算停留中
  onMap(SHOT_MAP, function(){
    drive(done, 'safe', 100, function(r){ return r.total >= 100 && r.total < 500 && r.fights.length >= 3; },
      { stopAt:{ phase:'settle', delay:350 } });
  });
};
D.shots['result-miss'] = function(done){              // 撤退、沒回本（結算停留中）
  onMap(SHOT_MAP, function(){
    drive(done, 'mid', 100, function(r){ return !r.reachedEnd && r.total > 0 && r.total < 100 && r.prizes.length >= 1; },
      { stopAt:{ phase:'settle', delay:350 } });
  });
};
D.shots.bigwin = function(done){                      // 大贏（≥5 倍）
  onMap(SHOT_MAP, function(){
    drive(done, 'mid', 500, PRED.big, { stopAt:{ phase:'settle', delay:350 } });
  });
};
D.shots.big = function(done){                         // 大獎（≥20 倍）全畫面
  onMap(SHOT_MAP, function(){
    drive(done, 'risk', 100, PRED.jackpot, { stopAt:{ phase:'jackpot', delay:1500 } });
  });
};
D.shots['auto-modal'] = function(done){
  ui.setRoute('mid'); ui.setStake(500);
  $('autoBtn').click();
  wait(450, done);
};
D.shots['auto-run'] = function(done){                 // 自動下注第 2 局擲骰飛行中（浮條：第 2/10 局・累計）
  onMap(SHOT_MAP, function(){
    ui.setRoute('mid'); ui.setStake(100);
    var play0 = ui.play, n = 0;
    ui.play = function(route, stake, o){            // 截圖專用：第 2 局停在擲骰飛行中（Autobet 的 adapter 每次呼叫 ui.play）
      n++;
      if(n === 1) D.dev.forceWhere(function(r){ return r.total > r.stake; }, { label:'shot', start:1 });
      if(n === 2){
        D.dev.forceWhere(function(r){ return r.fights.length > 1; }, { label:'shot', start:1 });
        o = { fast:true, stopAt:{ phase:'fly', n:0, at:330 }, onStop:function(){ ui.play = play0; done(); } };
      }
      return play0.call(ui, route, stake, o);
    };
    Autobet.start({ choice:'mid', stake:100, rounds:10, tp:0, sl:0 });
  });
};
D.shots['log-list'] = function(done){ seq(LOGSEQ, function(){ LogUI.open(); wait(450, done); }); };
D.shots['log-detail'] = function(done){ seq(LOGSEQ, function(){ LogUI.openDetail(0); wait(450, done); }); };

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
/* 預設網址（沒有 ?dev／?shot）不留把手：否則 console 可用 DEMO.game.setRng／bet 指定開獎、addMoney 加錢，
 * DEMO.shots 裡 ui-main 留的截圖函式也能指定開獎。各模組載入時已各自留了一份參照（ui-main 的 game、wire 的 g），
 * 拿掉這兩個全域入口不影響遊玩。 */
if(!(D.q.dev || D.q.shot)){ delete D.game; D.shots = {}; }
})();
