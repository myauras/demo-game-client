/* =========================================================================
 * 專案E「皇帝牌」E06——氛圍層（自動下注三件套含自動爬階／勝負 log 頁／連勝標籤）
 * R2：結果珠條移除（使用者裁決）、連勝改頂欄小標籤；浮條改 in-flow 專屬槽；z 序定死
 * R3：log 頁／彈窗內容區無原生捲軸、滑鼠拖曳滾動（5px 門檻、window 監聽、拖後抑制點擊）；觸控保留原生
 * 依賴：window.EUI（game-ui.js 共用 API）；引擎 duel-core.js 零改動——
 *       自動下注只透過 game.bet / continueRung / cashOut 代按，數字全走 core 事件與 EV.*
 * 版面：reports/皇帝牌示意稿.html §2「自動下注 UI 示意」（⟳ 入口→底部設定彈窗→進行中浮條）
 * 持久化（§8）：ecard.autocfg 自動下注設定／ecard.auto 進行中旗標（重整＝中止並提示）／
 *       ecard.log 勝負紀錄（封頂 50 筆）／ecard.logcur 進行中一局的逐階記錄
 * 顯示格式一律 Q1（fmtX：2 位無條件捨去）；金額取整由 core 結算
 * ?shot=auto-modal｜auto-run｜log-list｜log-detail｜auto-adv 截圖自動駕駛
 * ========================================================================= */
(function(){
'use strict';
var U = window.EUI; if(!U) return;
var game = U.game, $ = U.$, fmt = U.fmt, fmtX = U.fmtX, NAME = U.NAME, SHOT = U.SHOT;
var PERSIST = !SHOT;                                   // 截圖模式與 game-ui 同步：不落地
var K = { auto:'ecard.auto', cfg:'ecard.autocfg', log:'ecard.log', cur:'ecard.logcur' };
var LOG_CAP = 50;
var SIDE_CH = { emp:t('glyph.emp'), slv:t('glyph.slv') };   // E09：路徑小條徽記走字典
var KIND = { cash:t('kind.cash'), slam:t('kind.slam'), full:t('kind.full'), bust:t('kind.bust') };

function load(k, d){ if(!PERSIST) return d; try{ var r = localStorage.getItem(k); return r ? JSON.parse(r) : d; }catch(e){ return d; } }
function save(k, v){ if(!PERSIST) return; try{ if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function merge(a, b){ var o = {}, k; for(k in a) o[k] = a[k]; for(k in b) if(b[k] !== undefined) o[k] = b[k]; return o; }
function signed(n){ return n > 0 ? '+' + fmt(n) : n < 0 ? '−' + fmt(-n) : '±0'; }
function pad(x){ return (x < 10 ? '0' : '') + x; }
function fmtTime(ts){ var d = new Date(ts); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function esc(s){ return String(s).replace(/[&<>]/g, function(c){ return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }
function pathChips(path){
  return '<span class="lpath">' + path.map(function(s){
    return '<i class="' + (s === 'emp' ? 'pe' : 'ps') + '">' + SIDE_CH[s] + '</i>'; }).join('') + '</span>';
}

/* ---------- toast ---------- */
var toastT = null;
function toast(msg, ms){
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  if(toastT) clearTimeout(toastT);
  toastT = setTimeout(function(){ t.classList.remove('show'); }, ms || 2600);
}

/* =========================================================================
 * ② 勝負 log 儲存（自建 ecard.log，封頂 50 筆；逐階細節由事件累積）
 * ========================================================================= */
var log = load(K.log, []);                             // 舊→新
var cur = load(K.cur, null);                           // 進行中一局：{ts,mode,stake,rungs:[{side,win,M,v}]}
function saveLog(){ if(log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP); save(K.log, log); }
function rebuildCur(){                                 // 重整接回：存檔一致則沿用，否則由 core 狀態重建
  var s = game.getState(), st = s.st;
  if(!st){ return; }
  if(cur && cur.stake === st.stake0 && cur.rungs.length === st.path.length) return;
  cur = { ts:Date.now(), mode:s.mode, stake:st.stake0, rungs:[] };
  for(var i = 0; i < st.path.length; i++)
    cur.rungs.push({ side:st.path[i], win:(i < st.won.length) ? true : null, M:st.hist[i] || null, v:null });
  var sc = st.script, lt = sc ? sc[sc.length - 1] : null, r = cur.rungs[cur.rungs.length - 1];
  if(r && lt && lt.verdict) r.v = { p:lt.p, o:lt.o, reason:lt.verdict.reason, code:lt.verdict.code };
  else if(r && st.lastVerdict) r.v = { p:null, o:null, reason:st.lastVerdict.reason };
  save(K.cur, cur);
}
function logLock(d){
  var s = game.getState(), st = s.st;
  if(d.rung === 1 || !cur) cur = { ts:Date.now(), mode:s.mode, stake:st.stake0, rungs:[] };
  var r = { side:d.side, win:null, M:null, v:null };
  if(d.script){ var lt = d.script[d.script.length - 1]; r.v = { p:lt.p, o:lt.o, reason:lt.verdict.reason, code:lt.verdict.code }; }
  cur.rungs.push(r); save(K.cur, cur);
}
function logTrick(d){
  if(!cur || !d.verdict) return;
  var r = cur.rungs[cur.rungs.length - 1];
  if(r){ r.v = { p:d.pc, o:d.oc, reason:d.verdict.reason, code:d.verdict.code }; save(K.cur, cur); }
}
function logLadder(d){
  if(!cur) rebuildCur();
  if(!cur) return;
  var r = cur.rungs[cur.rungs.length - 1];
  if(r){ r.win = true; r.M = d.M; }
  save(K.cur, cur);
}
function logSettle(d){
  var rec = game.getState().records.slice(-1)[0] || {};
  if(!cur) cur = { ts:rec.ts || Date.now(), mode:rec.mode || game.getState().mode, stake:rec.stake || 0,
    rungs:(rec.path || []).map(function(s){ return { side:s, win:true, M:null, v:null }; }) };
  var last = cur.rungs[cur.rungs.length - 1];
  if(last){ last.win = (d.kind !== 'bust'); if(last.win && last.M == null) last.M = d.M; }
  log.push({ ts:cur.ts, mode:cur.mode, stake:cur.stake, rungs:cur.rungs, kind:d.kind, via:d.via,
             payout:d.payout, M:d.M, boosted:d.boosted || null, pnl:d.payout - cur.stake });
  saveLog(); cur = null; save(K.cur, null);
  renderStreak();
  if(lgOpen) renderLog();
}

/* ---------- R3 拖曳滾動（滑鼠專用；觸控／筆保留原生滾動，不攔截避免雙重滾動）
 * pointerdown 起算，位移 >5px 才視為拖曳（改 scrollTop、指標 grabbing）；move／up 掛 window（拖出容器不中斷）；
 * 拖曳過的那次放開，其後的 click 以捕獲階段吞掉（<5px 放開＝點擊照舊）。 ---------- */
function dragScroll(el){
  var active = false, moved = false, y0 = 0, top0 = 0, suppress = false;
  el.addEventListener('pointerdown', function(e){
    if(e.pointerType !== 'mouse' || e.button !== 0) return;
    active = true; moved = false; suppress = false; y0 = e.clientY; top0 = el.scrollTop;   // 新手勢起算，清前次抑制
  });
  function mv(e){
    if(!active) return;
    var dy = e.clientY - y0;
    if(!moved){ if(Math.abs(dy) <= 5) return; moved = true; el.classList.add('dragging'); }
    el.scrollTop = top0 - dy;
    e.preventDefault();
  }
  function up(){
    if(!active) return;
    active = false;
    if(moved){ moved = false; suppress = true; el.classList.remove('dragging'); setTimeout(function(){ suppress = false; }, 0); }
  }
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  el.addEventListener('click', function(e){ if(suppress){ suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);
}
dragScroll($('lgBody')); dragScroll($('sheetBody'));

/* ---------- log 頁（總覽→詳細；錢包重置二段確認） ---------- */
var lgOpen = false, lgView = 'ov', lgIdx = -1, resetArmed = false;
function renderLog(){
  var body = $('lgBody'), back = $('lgBack'), title = $('lgTitle');
  if(lgView === 'dt' && log[lgIdx]){ back.classList.remove('hid'); title.textContent = t('log.detail'); body.innerHTML = htmlDetail(log[lgIdx]); }
  else { lgView = 'ov'; back.classList.add('hid'); title.textContent = t('log.title'); body.innerHTML = htmlOverview(); }
  $('lgCount').textContent = t('log.count', { n:log.length, cap:LOG_CAP });
  var rb = $('lgReset');
  rb.textContent = resetArmed ? t('log.resetAsk') : t('log.reset');
  rb.className = resetArmed ? 'warnb' : '';
  $('lgCancel').style.display = resetArmed ? '' : 'none';
}
function htmlOverview(){
  if(!log.length) return '<div class="lempty">' + t('log.empty') + '</div>';
  var h = '';
  for(var i = log.length - 1; i >= 0; i--){
    var e = log[i], win = e.kind !== 'bust', top = (e.kind === 'slam' || e.kind === 'full');
    h += '<div class="lrowi" data-i="' + i + '">' +
      '<div class="lt">' + fmtTime(e.ts) + '<i>' + t(e.mode === 'advanced' ? 'log.tagAdv' : 'log.tagNor') + '</i></div>' +
      '<div class="lp">' + pathChips(e.rungs.map(function(r){ return r.side; })) + '</div>' +
      '<div class="ls">' + fmt(e.stake) + '</div>' +
      '<div class="lk ' + (top ? 'kt' : win ? 'kc' : '') + '">' + KIND[e.kind] + '</div>' +
      '<div class="lv ' + (win ? 'gold' : 'grey') + '">' + signed(e.pnl) + '</div></div>';
  }
  return h;                                            // R2 使用者裁決：總覽底部註解移除
}
function htmlDetail(e){
  var win = e.kind !== 'bust', top = (e.kind === 'slam' || e.kind === 'full');
  var h = '<div class="ldh">' +
    '<div class="big ' + (win ? 'gold' : 'grey') + '">' + signed(e.pnl) + '</div>' +
    '<div class="kv"><span>' + t('log.time') + '</span><span>' + fmtTime(e.ts) + '</span></div>' +
    '<div class="kv"><span>' + t('log.mode') + '</span><span>' + t(e.mode === 'advanced' ? 'log.modeAdv' : 'log.modeNor') + '</span></div>' +
    '<div class="kv"><span>' + t('log.stake') + '</span><span>' + fmt(e.stake) + '</span></div>' +
    '<div class="kv"><span>' + t('log.path') + '</span><span>' + pathChips(e.rungs.map(function(r){ return r.side; })) + '　' + t('log.rungs', { n:e.rungs.length }) + '</span></div>' +
    '<div class="kv"><span>' + t('log.result') + '</span><span>' + KIND[e.kind] + (e.via === 'timeout' ? t('log.viaTo') : e.via === 'auto' && e.kind !== 'bust' ? t('log.viaAuto') : '') + '</span></div>';
  if(win){
    if(top){
      h += '<div class="kv"><span>' + t('log.m') + '</span><span>' + fmtX(e.M) + 'x</span></div>' +
           '<div class="kv"><span>' + t('log.boost') + '</span><span>' + t('log.boostVal', { x:EV.TOP_BOOST.toFixed(4), pay:fmtX(e.boosted) }) + '</span></div>';
    } else h += '<div class="kv"><span>' + t('log.m') + '</span><span>' + fmtX(e.M) + 'x</span></div>';
    h += '<div class="kv"><span>' + t('log.pay') + '</span><span>' + fmt(e.payout) + '</span></div>';
  } else h += '<div class="kv"><span>' + t('log.pay') + '</span><span>' + t('log.payNone', { n:fmt(e.stake) }) + '</span></div>';
  h += '</div><div class="ldt">' + t('log.byRung') + '</div>';
  for(var i = 0; i < e.rungs.length; i++){
    var r = e.rungs[i], v = r.v;
    var vt = v ? (v.code ? t('verdict.' + v.code) : (v.reason || t('rail.dash'))) +          // E09：新紀錄查 code；舊存檔沒有 code 就退回原 reason
      (v.p ? '<small>' + tch(v.p) + ' vs ' + tch(v.o) + '</small>' : '') : t('rail.dash');
    h += '<div class="rg"><div class="rn">' + t('log.rung', { n:i + 1 }) + '</div>' +
      '<div>' + NAME[r.side] + '</div>' +
      '<div class="rw ' + (r.win ? 'w' : 'l') + '">' + t(r.win ? 'log.win' : 'log.lose') + '</div>' +
      '<div class="rv">' + vt + '</div>' +
      '<div class="rm">' + (r.win && r.M != null ? fmtX(r.M) + 'x' : '—') + '</div></div>';
  }
  return h + '<div class="lnotef">' + t('log.noteDt') + '</div>';
}
function lgShow(on){
  lgOpen = on; resetArmed = false;
  if(on){ lgView = 'ov'; renderLog(); }
  $('lgm').classList.toggle('show', on);
}
function walletReset(){
  if(game.getState().st){ toast(t('log.noReset')); resetArmed = false; renderLog(); return; }
  if(A.on) autoEnd(t('auto.endReset'));
  game.clearSaved();
  log = []; saveLog(); cur = null; save(K.cur, null);
  resetArmed = false; lgView = 'ov'; renderLog(); renderStreak();
  toast(t('log.resetDone', { n:fmt(game.getState().wallet) }));
}

/* =========================================================================
 * ③ 連勝標籤（頂欄錢包旁，兩機位共用）：連勝＝由最新一局往前數的連續入袋局數
 * ========================================================================= */
function renderStreak(){
  var i, streak = 0;
  for(i = log.length - 1; i >= 0 && log[i].kind !== 'bust'; i--) streak++;
  $('streak').innerHTML = t('top.streakHTML', { n:streak });
}

/* =========================================================================
 * ① 自動下注三件套（僅普通模式）：⟳ 入口→底部設定彈窗→進行中浮條
 * ========================================================================= */
var DEF = { side:'emp', stake:500, climb:0, rounds:10, tp:0, sl:0 };
var cfg = merge(DEF, load(K.cfg, {}));
var A = { on:false, stopping:false, cfg:null, n:0, pnl:0, side:null, t:null };

/* ⟳ 入口鈕：BET 態顯示；進階模式／非 BET 態灰化＋點擊提示 */
function setBtn(){
  var s = game.getState(), b = $('autoBtn');
  var bet = (s.phase === 'BET' && !s.st && !A.on);
  b.classList.toggle('show', bet);
  var dis = (s.mode !== 'normal');
  b.classList.toggle('dis', dis);
  b.title = dis ? t('auto.advOnly') : t('auto.btn');
}
$('autoBtn').onclick = function(){
  var s = game.getState();
  if(s.mode !== 'normal'){ toast(t('auto.advToast')); return; }
  if(s.phase !== 'BET' || s.st || A.on) return;
  sheetShow(true);
};

/* 底部設定彈窗 */
var TP = [0, 1000, 2000, 5000], SL = [0, 500, 1500, 3000];
function seg(key, list, labels, onCls){
  return '<div class="seg" data-k="' + key + '">' + list.map(function(v, i){
    return '<button data-v="' + v + '" class="' + (cfg[key] === v ? (onCls || 'on') : '') + '">' + labels[i] + '</button>'; }).join('') + '</div>';
}
function renderSheet(){
  var climbOn = cfg.climb > 0;
  $('sheetBody').innerHTML =
    '<div class="srow"><span class="slab">' + t('auto.side') + '</span>' + seg('side', ['emp','slv','alt'], [t('side.emp'), t('side.slv'), t('auto.alt')]) + '</div>' +
    '<div class="srow"><span class="slab">' + t('bet.stake') + '</span>' + seg('stake', [100,500,1000], ['100','500','1,000']) + '</div>' +
    '<div class="srow"><span class="slab">' + t('auto.climb') + '</span>' +
      '<div class="seg" data-k="climbmode"><button data-v="0" class="' + (climbOn ? '' : 'on') + '">' + t('auto.noClimb') + '</button>' +
      '<button data-v="1" class="' + (climbOn ? 'onG' : '') + '">' + t('auto.climbTo') + '</button></div>' +
      '<div class="stepr"><button id="clMinus"' + (climbOn && cfg.climb > 2 ? '' : ' disabled') + '>−</button>' +
      '<b>' + (climbOn ? t('auto.climbN', { n:cfg.climb }) : t('auto.noClimb')) + '</b>' +
      '<button id="clPlus"' + (climbOn && cfg.climb < EV.CFG.MAX_RUNG ? '' : ' disabled') + '>＋</button></div></div>' +
    '<div class="srow"><span class="slab">' + t('auto.rounds') + '</span>' + seg('rounds', [10,20,50], ['10','20','50']) + '</div>' +
    '<div class="srow"><span class="slab">' + t('auto.tp') + '</span>' + seg('tp', TP, [t('auto.off'),'+1,000','+2,000','+5,000'], 'onG') + '</div>' +
    '<div class="srow"><span class="slab">' + t('auto.sl') + '</span>' + seg('sl', SL, [t('auto.off'),'−500','−1,500','−3,000'], 'onS') + '</div>' +
    '<div class="snote">' + t('auto.note', { line:EV.CFG.SLAM_LINE, max:EV.CFG.MAX_RUNG, rtpc:EV.CFG.RTP_CASH, rtpt:EV.CFG.RTP_TOP }) + '</div>' +
    '<button class="sgo" id="sheetGo">' + t('auto.go') + '</button>';
  var segs = $('sheetBody').querySelectorAll('.seg button');
  Array.prototype.forEach.call(segs, function(b){
    b.onclick = function(){
      var k = b.parentNode.getAttribute('data-k'), v = b.getAttribute('data-v');
      if(k === 'climbmode') cfg.climb = (v === '1') ? Math.max(2, cfg.climb || 2) : 0;
      else if(k === 'side') cfg.side = v;
      else cfg[k] = +v;
      renderSheet();
    };
  });
  $('clMinus').onclick = function(){ if(cfg.climb > 2){ cfg.climb--; renderSheet(); } };
  $('clPlus').onclick  = function(){ if(cfg.climb < EV.CFG.MAX_RUNG){ cfg.climb++; renderSheet(); } };
  $('sheetGo').onclick = autoStart;
}
function sheetShow(on){
  if(on) renderSheet();
  $('veil').classList.toggle('show', on);
  $('sheet').classList.toggle('show', on);
}
$('veil').onclick = function(){ sheetShow(false); };
$('sheetX').onclick = function(){ sheetShow(false); };

/* R2 自動下注專屬槽（in-flow）：進行中橘條；待命淡化占位「⟳ 自動下注待命」 */
function barRender(){
  var b = $('abar');
  $('abarTxt').innerHTML = t('auto.running', { n:A.n, total:A.cfg.rounds, pnl:signed(A.pnl),
    tail:A.stopping ? t('auto.stopping') : '' });
  b.classList.toggle('stopping', A.stopping);
}
function barShow(on){
  $('abar').classList.toggle('on', on);
  if(!on) $('abarTxt').textContent = t('auto.idle');
}
$('abarStop').onclick = function(){
  if(!A.on || A.stopping) return;
  if(game.getState().st){ A.stopping = true; barRender(); }   // 本局由 core 照常結清（階梯時程式代按收手）
  else autoEnd(t('auto.endStop'));
};

function autoSave(){ save(K.auto, A.on ? { n:A.n, N:A.cfg.rounds, pnl:A.pnl } : null); }
function autoStart(){
  var s = game.getState();
  if(s.mode !== 'normal'){ toast(t('auto.advOnly')); return; }
  if(s.phase !== 'BET' || s.st){ toast(t('auto.busy')); return; }
  if(s.wallet < cfg.stake){ toast(t('auto.noMoney', { have:fmt(s.wallet), need:fmt(cfg.stake) })); return; }
  save(K.cfg, cfg);
  A.on = true; A.stopping = false; A.cfg = merge({}, cfg); A.n = 0; A.pnl = 0; A.side = null;
  sheetShow(false); barRender(); barShow(true); autoSave(); setBtn();
  nextRound(150);
}
function pickSide(){ return A.cfg.side === 'alt' ? (A.n % 2 === 0 ? 'emp' : 'slv') : A.cfg.side; }
function nextRound(delay){
  if(A.t) clearTimeout(A.t);
  A.t = setTimeout(function(){
    A.t = null;
    if(!A.on || A.stopping) return;
    var s = game.getState();
    if(s.phase !== 'BET' || s.st){ nextRound(400); return; }             // 面板尚未歸位再等
    if(A.n >= A.cfg.rounds){ autoEnd(t('auto.endDone', { n:A.cfg.rounds })); return; }
    if(s.wallet < A.cfg.stake){ autoEnd(t('auto.noMoney2', { have:fmt(s.wallet), need:fmt(A.cfg.stake) })); return; }
    var side = pickSide();
    A.n++; A.side = side; barRender(); autoSave();
    U.armForce();                                                         // 導演台劇本照常生效（測試用）
    if(!game.bet(side, A.cfg.stake)){ A.n--; autoEnd(t('auto.endFail')); }
  }, delay || 0);
}
function autoLadder(d){                                                   // Q2 決策由程式代按（不靠逾時）
  if(A.t) clearTimeout(A.t);
  A.t = setTimeout(function(){
    A.t = null;
    if(game.getState().phase !== 'LADDER') return;
    var climb = A.on && !A.stopping && A.cfg.climb > 0 && d.rung < A.cfg.climb;
    if(climb){ U.armForce(); game.continueRung(A.side); }                 // 續戰一律同邊
    else game.cashOut();
  }, 800);
}
function autoSettle(d){
  A.pnl += d.payout - A.cfg.stake; barRender(); autoSave();
  var wait = d.kind === 'cash' ? 900 : d.kind === 'bust' ? 2000 : U.GRAND_MS + 500;   // 等 game-ui 收幕再開下一局
  if(A.stopping){ autoEnd(t('auto.endStop'), wait); return; }
  if(A.cfg.tp > 0 && A.pnl >= A.cfg.tp){ autoEnd(t('auto.endTp', { n:fmt(A.cfg.tp) }), wait); return; }
  if(A.cfg.sl > 0 && A.pnl <= -A.cfg.sl){ autoEnd(t('auto.endSl', { n:fmt(A.cfg.sl) }), wait); return; }
  if(A.n >= A.cfg.rounds){ autoEnd(t('auto.endDone', { n:A.cfg.rounds }), wait); return; }
  nextRound(wait);
}
function autoEnd(reason, delay){
  var summary = t('auto.end', { reason:reason, n:A.n, pnl:signed(A.pnl) });
  A.on = false; A.stopping = false;
  if(A.t){ clearTimeout(A.t); A.t = null; }
  autoSave();
  setTimeout(function(){ barShow(false); $('abar').classList.remove('stopping'); toast(summary, 3800); setBtn(); }, delay || 0);
  window.EAtmosLast = { reason:reason, n:A.n, pnl:A.pnl };               // 自測讀取用
}

/* =========================================================================
 * 引擎事件（在 game-ui 之後訂閱：面板先歸位、本層再代按）
 * ========================================================================= */
game.on(function(type, d){
  if(type === 'lock') logLock(d);
  else if(type === 'trick') logTrick(d);
  else if(type === 'ladder'){ logLadder(d); if(A.on) autoLadder(d); }
  else if(type === 'settle'){ logSettle(d); if(A.on) autoSettle(d); }
  else if(type === 'mode' && A.on && d.mode !== 'normal') autoEnd(t('auto.endMode'));
  setBtn();
});
$('logBtn').onclick = function(){ lgShow(true); };
$('lgX').onclick = function(){ lgShow(false); };
$('lgBack').onclick = function(){ lgView = 'ov'; resetArmed = false; renderLog(); };
$('lgBody').onclick = function(e){
  var row = e.target.closest ? e.target.closest('.lrowi') : null;
  if(row){ lgIdx = +row.getAttribute('data-i'); lgView = 'dt'; resetArmed = false; renderLog(); }
};
$('lgReset').onclick = function(){ if(resetArmed) walletReset(); else { resetArmed = true; renderLog(); } };
$('lgCancel').onclick = function(){ resetArmed = false; renderLog(); };

/* ---------- 開機：重整＝自動下注中止並提示（安全預設）；進行中一局由 core 接回、log 續記 ---------- */
(function boot(){
  var ab = load(K.auto, null);
  if(ab){ save(K.auto, null); setTimeout(function(){
    toast(t('auto.aborted', { n:ab.n, total:ab.N, pnl:signed(ab.pnl) }), 4200); }, 400); }
  if(game.getState().st) rebuildCur(); else if(cur){ cur = null; save(K.cur, null); }
  renderStreak(); setBtn();
  setInterval(setBtn, 500);                            // 面板三態切換無事件可掛（如 timeout 收手），輪詢補位
  if(SHOT === 'auto-modal') setTimeout(function(){ sheetShow(true); }, 200);
  if(SHOT === 'auto-run'){ cfg = merge(cfg, { side:'alt', stake:500, climb:0, rounds:10, tp:0, sl:0 }); setTimeout(autoStart, 300); }
  if(SHOT === 'auto-adv'){ game.setMode('advanced'); setTimeout(function(){ $('autoBtn').onclick(); }, 400); }
  if(SHOT === 'log-full'){                            // R3 截圖：50 局滿載 log（真跑 50 局）
    cfg = merge(cfg, { side:'alt', stake:100, climb:0, rounds:50, tp:0, sl:0 });
    setTimeout(autoStart, 300);
    var w2 = setInterval(function(){ if(!A.on && log.length >= 50){ clearInterval(w2); lgShow(true); } }, 300);
  }
  if(SHOT === 'log-list' || SHOT === 'log-detail'){
    cfg = merge(cfg, { side:'alt', stake:500, climb:2, rounds:3, tp:0, sl:0 });
    setTimeout(autoStart, 300);
    var w = setInterval(function(){ if(!A.on && log.length >= 3){ clearInterval(w); lgShow(true); if(SHOT === 'log-detail'){ lgIdx = log.length - 1; lgView = 'dt'; renderLog(); } } }, 300);
  }
})();

window.EAtmos = { toast:toast, getLog:function(){ return log.slice(); }, auto:A, cfg:cfg,
  start:autoStart, stop:function(){ $('abarStop').onclick(); }, openSheet:function(){ sheetShow(true); },
  openLog:lgShow, setCfg:function(o){ cfg = merge(cfg, o); return cfg; } };
})();
