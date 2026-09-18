/* =========================================================================
 * 專案E「皇帝牌」E03——普通模式 UI 殼（觀賽機位＋結果反推自動演出）
 * 引擎：js/duel-core.js（DuelCore，零改動）；數值單點：values.js（EV）
 * 節拍：reports/皇帝牌示意稿.html §4（鎖定0.3s／平手~0.7s／決勝停頓0.4s＋
 *       對手延遲0.5s翻牌＋閃光／派彩0.4s滾動／滿貫1.5s金閃雙數字）
 * ?dev=1 導演台（劇本強制勝敗＝包一層 rng、不動 core）；?shot= 供截圖自動駕駛
 * ========================================================================= */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var fmt = function(n){ return n.toLocaleString('en-US'); };
var fmtX = DuelCore.fmtX;                       // Q1：面上 2 位無條件捨去
var NAME = { emp:'皇帝側', slv:'奴隸側' };
var qs = new URLSearchParams(location.search);
var DEV = qs.get('dev') === '1';
var SHOT = qs.get('shot') || '';                // 截圖自動駕駛：slam／ladder3（連押奴隸）、full／full9（連押皇帝）、adv-*（進階）
if(qs.get('vw')){                               // 截圖輔助：headless 有最小視窗寬，鎖 app 寬靠左供裁圖
  var appEl = document.getElementById('app');
  appEl.style.maxWidth = qs.get('vw') + 'px'; appEl.style.margin = '0';
}

/* ---------- 導演台 rng 包裝（強制勝敗只吃「鎖定抽勝負」那一次 rng） ---------- */
var forceOnce = null;                           // 'win'|'lose'，一次性
function rig(){
  if(SHOT) return 0;                            // 截圖模式（slam／adv-*）：恆勝＋首分支（決定性）
  if(forceOnce){ var v = (forceOnce==='win') ? 0 : 0.9999; forceOnce = null; return v; }
  return Math.random();
}
function armForce(){
  if(DEV){ var s = $('scriptSel').value; if(s !== 'rand') forceOnce = s; }
}

var game = DuelCore.createGame({ rng: rig, storage: SHOT ? false : undefined });

/* ---------- 錢包（派彩 0.4s 數字滾動） ---------- */
var walShown = 0, walTarget = 0, walRaf = null, walSnap = null;
function setWallet(v, roll){
  walTarget = v;
  if(walRaf){ cancelAnimationFrame(walRaf); walRaf = null; }
  if(walSnap){ clearTimeout(walSnap); walSnap = null; }
  if(!roll){ walShown = v; $('wal').textContent = fmt(v); return; }
  var from = walShown, t0 = performance.now();
  (function tick(t){
    var k = Math.max(0, Math.min(1, (t - t0) / 400));   // rAF 時戳可能略早於排程點
    walShown = Math.round(from + (v - from) * k);
    $('wal').textContent = fmt(walShown);
    if(k < 1) walRaf = requestAnimationFrame(tick); else walRaf = null;
  })(t0);
  walSnap = setTimeout(function(){        // 分頁不在前景時 rAF 停擺——保底補寫終值
    walSnap = null;
    if(walShown !== v){ walShown = v; $('wal').textContent = fmt(v); }
  }, 450);
}

/* ---------- 戰報帶 ---------- */
var bEl = $('banner');
function banner(t){ bEl.textContent = t; }
function bannerFade(t){                          // 鎖定節拍：0.3s 淡入
  bEl.classList.add('dim');
  setTimeout(function(){ bEl.textContent = t; bEl.classList.remove('dim'); }, 300);
}

/* ---------- 對決區與手牌 ---------- */
var slotL = $('slotL'), slotR = $('slotR'), duelZ = $('duelZ'), flashZ = $('flashZ');
var RM = false;
try{ RM = matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
if(qs.get('rm') === '1') RM = true;             // 測試用：強制 reduced-motion 降級路徑
if(qs.get('fx') === '1'){                       // 測試／截圖用：強制開啟演出（覆蓋 reduced-motion）
  RM = false;
  document.documentElement.setAttribute('data-fx', '1');
}
function cls(ch){ return ch==='帝' ? 'demp' : (ch==='奴' ? 'dslv' : 'dmin'); }
function slot(el, ch, noPop){
  el.className = 'dslot'; el.textContent = '';
  if(ch === null) return;
  if(ch === '?'){ el.classList.add('filled','dback'); return; }
  el.classList.add('filled', cls(ch));
  if(!noPop) el.classList.add('pop');
  el.textContent = ch;
}
function clearDuel(){
  slot(slotL, null); slot(slotR, null);
  var cuts = duelZ.querySelectorAll('.cutfx');
  for(var i=0;i<cuts.length;i++) cuts[i].remove();
}
/* R3/R5 拋物線出牌：一律蓋牌（背面）弧線飛進對決槽，落定後才翻面 */
function flyIn(fromLeft, slotEl, ch){
  var hand = $(fromLeft ? 'lHand' : 'rHand');
  var src = hand.querySelector('.gcard:not(.gone)');
  if(src) src.classList.add('gone');                   // 手牌即刻變暗＝牌被打出
  if(RM){ slot(slotEl, ch, true); return; }
  var app = $('app'), ar = app.getBoundingClientRect();
  var a = (src || hand).getBoundingClientRect(), b = slotEl.getBoundingClientRect();
  var fx = document.createElement('div'); fx.className = 'flyx';
  fx.style.left = (b.left - ar.left) + 'px'; fx.style.top = (b.top - ar.top) + 'px';
  fx.style.width = b.width + 'px'; fx.style.height = b.height + 'px';
  var arc = document.createElement('div'); arc.className = 'flyy';
  var card = document.createElement('div');
  card.className = 'dslot filled dback';               // R5：飛行中恆為牌背
  arc.appendChild(card); fx.appendChild(arc); app.appendChild(fx);
  var dx = (a.left + a.width/2) - (b.left + b.width/2);
  var dy = (a.top + a.height/2) - (b.top + b.height/2);
  fx.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(.62)';
  void fx.offsetWidth;
  fx.style.transform = 'translate(0,0) scale(1)';
  setTimeout(function(){
    fx.remove();
    slot(slotEl, '?');                                 // 落定仍蓋牌
    if(ch !== '?') flipTo(slotEl, ch);                 // 到定點才 scale 翻面
  }, 330);
}
/* R5 翻牌：scaleX 壓扁→換面→展開（純 transform；'?'＝維持蓋牌等懸念） */
function flipTo(slotEl, ch, done){
  if(RM){ slot(slotEl, ch, true); if(done) done(); return; }
  slotEl.style.transition = 'transform .14s ease-in';
  slotEl.style.transform = 'scaleX(0.02)';
  setTimeout(function(){
    slot(slotEl, ch, true);                            // 側緣瞬間換面
    slotEl.style.transition = 'transform .16s ease-out';
    slotEl.style.transform = 'scaleX(1)';
    setTimeout(function(){
      slotEl.style.transition = ''; slotEl.style.transform = '';
      if(done) done();
    }, 170);
  }, 150);
}
/* R3 斬牌：敗方牌原位隱形，覆蓋兩片半牌斜切分離＋斬擊光痕 */
function sliceCard(slotEl, ch, host){            // host：對決區容器（E04 可傳桌面上的 #tduel）
  if(RM) return;
  host = host || duelZ;
  var fx = document.createElement('div'); fx.className = 'cutfx';
  fx.style.left = slotEl.offsetLeft + 'px'; fx.style.top = slotEl.offsetTop + 'px';   // 版面座標（3D 平面內亦正確）
  fx.style.width = slotEl.offsetWidth + 'px'; fx.style.height = slotEl.offsetHeight + 'px';
  fx.innerHTML = '<div class="half hT ' + cls(ch) + '">' + ch + '</div>' +
                 '<div class="half hB ' + cls(ch) + '">' + ch + '</div>' +
                 '<div class="slash"></div>';
  host.appendChild(fx);
  slotEl.classList.add('ghosted');
  void fx.offsetWidth;
  fx.classList.add('go');
}
function clash(el){
  el = el || duelZ;
  el.classList.add('clash');
  setTimeout(function(){ el.classList.remove('clash'); }, 350);
}
function flash(el){
  el = el || flashZ;
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}
function renderHands(used){                      // 每回合雙方各消耗一張（上→下變暗）
  var l = $('lHand'), r = $('rHand'); l.innerHTML = ''; r.innerHTML = '';
  for(var i = 0; i < DuelCore.ROUNDS; i++){
    var a = document.createElement('div'); a.className = 'gcard back' + (i < used ? ' gone' : '');
    var b = document.createElement('div'); b.className = 'gcard back' + (i < used ? ' gone' : '');
    l.appendChild(a); r.appendChild(b);
  }
}

/* ---------- 橫式階梯進度條（對數刻度＝core railPct；填充只動 transform） ---------- */
$('railTop').textContent = '滿貫 ' + EV.CFG.SLAM_LINE + 'x';
function railWord(st){                          // 兩機位共用語彙：挑戰中／達成／滿貫／完賭
  if(st.fin) return st.kind === 'slam' ? '滿貫' : '完賭';
  return st.hist.length < st.rung ? '挑戰中' : '達成';
}
function railRender(fin){                        // fin：結算快照 {M,rung,hist,fin,kind}——滿貫／完賭演出期間維持滿格、不掉回待命
  var s = game.getState(), st = fin || s.st, rail = $('hrail'), dots = $('railDots');
  if(!st){
    rail.classList.add('idle');
    $('railLab').textContent = '階梯待命';
    $('railFill').style.transform = 'scaleX(0)';
    dots.innerHTML = '';
    return;
  }
  rail.classList.remove('idle');
  var p = DuelCore.railPct(st.M);
  $('railLab').textContent = fmtX(st.M) + 'x・' + st.rung + '階' + railWord(st);
  $('railFill').style.transform = 'scaleX(' + (p / 100).toFixed(4) + ')';
  dots.innerHTML = st.hist.map(function(m){
    return '<span class="phdot" style="left:' + DuelCore.railPct(m).toFixed(1) + '%"></span>';
  }).join('');
}

/* ---------- ⑥操作面板三態 ---------- */
var panel = $('panel');
var pickSide = null, pickChip = 500;
var cdTimer = null;                              // Q2 倒數計時器
function stopCountdown(){ if(cdTimer){ clearInterval(cdTimer); cdTimer = null; } }

function panelBet(){
  stopCountdown();
  pickSide = null;
  var oE = fmtX(EV.baseOdds('emp')), oS = fmtX(EV.baseOdds('slv'));
  panel.innerHTML =
    '<div class="siderow">' +
      '<button class="sidebtn" id="sbE"><b>皇帝側</b><small>' + oE + 'x・勝率 ' + (EV.CFG.P.emp*100) + '%</small></button>' +
      '<button class="sidebtn" id="sbS"><b>奴隸側</b><small>' + oS + 'x・勝率 ' + (EV.CFG.P.slv*100) + '%</small></button></div>' +
    '<div class="chiprow"><span class="chiplab">押額</span>' +
      [100,500,1000].map(function(v){
        return '<button class="chip' + (v===pickChip?' on':'') + '" data-v="' + v + '">' + fmt(v) + '</button>';
      }).join('') + '</div>' +
    '<button class="gobtn" id="goBet" disabled>確認下注</button>' +
    '<div class="msg" id="pmsg">顯示賠率為保守下限（結算全精度）</div>';
  $('sbE').onclick = function(){ pickSide='emp'; this.classList.add('selE'); $('sbS').classList.remove('selS'); $('goBet').disabled=false; };
  $('sbS').onclick = function(){ pickSide='slv'; this.classList.add('selS'); $('sbE').classList.remove('selE'); $('goBet').disabled=false; };
  Array.prototype.forEach.call(panel.querySelectorAll('.chip'), function(c){
    c.onclick = function(){
      Array.prototype.forEach.call(panel.querySelectorAll('.chip'), function(x){ x.classList.remove('on'); });
      c.classList.add('on'); pickChip = +c.dataset.v;
    };
  });
  $('goBet').onclick = function(){
    if(!pickSide) return;
    armForce();
    game.bet(pickSide, pickChip);
  };
}
function panelLock(side, stake){
  stopCountdown();
  panel.innerHTML = '<div class="lockmsg">— 對局進行中 —<br>' +
    '<span style="font-size:11.5px">押 ' + NAME[side] + '・' + fmt(stake) + '</span></div>';
}
/* E05 決策提示：下一階若觸頂——越滿貫線標「→ 滿貫！」、第 MAX_RUNG 階標「→ 完賭」（皆走 EV.isTop，零硬編碼） */
function hintTag(next, rung){
  if(!EV.isTop(next, rung + 1)) return '';
  return next >= EV.CFG.SLAM_LINE ? '<em class="slam">→ 滿貫！</em>' : '<em class="full">→ 完賭</em>';
}
function pathChips(path){                        // 本局路徑小條：帝／奴序列（選配）
  if(!path || !path.length) return '';
  return '<span class="lpath">' + path.map(function(s){
    return '<i class="' + (s==='emp' ? 'pe' : 'ps') + '">' + (s==='emp' ? '帝' : '奴') + '</i>'; }).join('') + '</span>';
}
function shotAuto(rung){                          // 截圖自動駕駛：階梯決策態自動續戰（null＝凍結在決策態）
  if(SHOT === 'slam' || SHOT === 'adv-slam') return 'slv';
  if(SHOT === 'ladder3') return rung < 3 ? 'slv' : null;
  if(SHOT === 'full9')   return rung < 9 ? 'emp' : null;
  if(SHOT === 'full')    return 'emp';
  return null;
}
function panelLadder(d){                          // d：{M,rung,cash,nextEmp,nextSlv,deadline}
  stopCountdown();
  var st = game.getState().st || {};
  panel.innerHTML =
    '<div class="ladder">' +
      '<div class="cring" id="cring"><span class="cnum" id="cnum"></span><span class="chand" id="chand"></span></div>' +
      '<div class="ltitle">第 ' + d.rung + ' 階達成' + pathChips(st.path) + '</div>' +
      '<div class="lm">' + fmtX(d.M) + 'x　→　可收 ' + fmt(d.cash) + '</div>' +
      '<div class="lrow">' +
        '<button class="bt-emp" id="lcE">續戰・皇帝側<br>成 ' + fmtX(d.nextEmp) + 'x' + hintTag(d.nextEmp, d.rung) + '</button>' +
        '<button class="bt-slv" id="lcS">續戰・奴隸側<br>成 ' + fmtX(d.nextSlv) + 'x' + hintTag(d.nextSlv, d.rung) + '</button>' +
        '<button class="bt-cash" id="lcC">收手入袋<br>+' + fmt(d.cash) + '</button></div>' +
      '<div class="lnote">滿貫線 ' + EV.CFG.SLAM_LINE + 'x・玩到頂（越線／' + EV.CFG.MAX_RUNG +
        ' 階完賭）享頂端加成・逾時視同收手</div></div>';
  $('lcE').onclick = function(){ armForce(); game.continueRung('emp'); };
  $('lcS').onclick = function(){ armForce(); game.continueRung('slv'); };
  $('lcC').onclick = function(){ game.cashOut(); };
  // Q2 倒數 10s 圈：數字＋指針旋轉（只動 transform）
  var total = DuelCore.TIMING.DECIDE_MS;
  function cd(){
    var remain = Math.max(0, (d.deadline || 0) - Date.now());
    var num = $('cnum'), hand = $('chand'), ring = $('cring');
    if(!num){ stopCountdown(); return; }
    num.textContent = Math.ceil(remain / 1000);
    hand.style.transform = 'rotate(' + ((1 - remain / total) * 360).toFixed(1) + 'deg)';
    if(remain <= 3000) ring.classList.add('hurry');
    if(remain <= 0) stopCountdown();
  }
  cd();
  cdTimer = setInterval(cd, 100);
  var auto = shotAuto(d.rung);
  if(auto) setTimeout(function(){ game.continueRung(auto); }, 400);
}

/* ---------- 結果反推自動演出（照 §4 節拍） ---------- */
var pb = null;                                    // {side,rung,script,i,used}
function beginPlayback(side, rung, script, stake){
  pb = { side:side, script:script, i:0, used:0 };
  clearDuel(); renderHands(0); railRender();
  panelLock(side, stake);
  bannerFade('封盤・勝負已定（' + NAME[side] + '・第 ' + rung + ' 階）');
  setTimeout(step, 1000);                         // 鎖定 0.3s 淡入＋停留
}
function step(){
  if(!pb) return;
  var tr = pb.script[pb.i];
  var lc = pb.side==='emp' ? tr.p : tr.o;         // 觀賽固定：左＝皇帝側、右＝奴隸側
  var rc = pb.side==='emp' ? tr.o : tr.p;
  banner('第 ' + (pb.i + 1) + ' 回合');
  if(!tr.decisive){                               // 平手：蓋牌齊飛→落定齊翻→對碰快切
    flyIn(true, slotL, lc); flyIn(false, slotR, rc);
    pb.used++;
    setTimeout(function(){ if(!pb) return; clash(); }, 680);
    setTimeout(function(){ if(!pb) return; clearDuel(); pb.i++; step(); }, 1060);
    return;
  }
  clearDuel();                                    // 決勝前停頓 0.4s（對決區聚焦）
  setTimeout(function(){
    if(!pb) return;
    var firstIsL = (pb.side==='emp');                   // 下注側先出
    var first = firstIsL ? slotL : slotR, later = firstIsL ? slotR : slotL;
    var firstCh = firstIsL ? lc : rc,    laterCh = firstIsL ? rc : lc;
    flyIn(firstIsL, first, firstCh);                    // 蓋牌飛入、落定即翻
    setTimeout(function(){ if(pb) flyIn(!firstIsL, later, '?'); }, 90);   // 對面蓋牌飛入、按住不翻
    pb.used++;
    setTimeout(function(){                        // 懸念後：後翻那張 scale 翻面→閃光震動→斬牌
      if(!pb) return;
      flipTo(later, laterCh, function(){
        if(!pb) return;
        flash(); clash();
        banner(tr.verdict.reason + '　' + NAME[pb.side] + (tr.verdict.win ? '（你押的）獲勝' : '落敗'));
        var loserSlot = tr.verdict.win ? later : first; // 敗方牌：斬切兩半
        var loserCh   = tr.verdict.win ? laterCh : firstCh;
        setTimeout(function(){ if(pb) sliceCard(loserSlot, loserCh); }, 180);
        setTimeout(function(){ if(!pb) return; pb = null; game.ack(); }, 1100);
      });
    }, 1050);
  }, 400);
}

/* ---------- 滿貫／完賭大演出（E05 三段揭示：收手值 → ＋頂端加成 → 實付滾動；1.5s 金閃照 §4）
 * 兩機位共用（進階經 EUI.grandShow）；錢包滾動併入第三段；結束由呼叫端於 GRAND_MS 收幕。 ---------- */
var GRAND_MS = 3400;                              // 0s 收手值／0.7s 加成／1.3s 實付滾 0.5s／停留至 3.4s 回下注態
var grandT = [];
function grandShow(d){                            // d：{kind:slam|full, M, boosted, payout, wallet}
  var g = $('grand'), slam = (d.kind === 'slam');
  grandT.forEach(clearTimeout); grandT = [];
  $('gTitle').textContent = slam ? '滿貫達成！' : '十階完賭！';
  $('gSub').textContent = slam ? '越過滿貫線 ' + EV.CFG.SLAM_LINE + 'x——系統代收、享頂端加成'
                               : '達 ' + EV.CFG.MAX_RUNG + ' 階上限——系統代收、享頂端加成';
  $('gM').textContent = fmtX(d.M) + 'x';
  $('gBoost').textContent = '×' + EV.TOP_BOOST.toFixed(4);
  $('gFinal').textContent = fmtX(d.M) + 'x';
  $('gPay').textContent = '+0 自動入袋';
  g.classList.remove('show', 's2', 's3'); void g.offsetWidth; g.classList.add('show');
  banner(slam ? '越過滿貫線 ' + EV.CFG.SLAM_LINE + 'x——滿貫入袋' : '達 ' + EV.CFG.MAX_RUNG + ' 階上限——完賭入袋');
  if(SHOT){                                       // 截圖凍結：直接停在終幕
    g.classList.add('s2', 's3');
    $('gFinal').textContent = fmtX(d.boosted) + 'x';
    $('gPay').textContent = '+' + fmt(d.payout) + ' 自動入袋';
    setWallet(d.wallet, false);
    return;
  }
  grandT.push(setTimeout(function(){ g.classList.add('s2'); }, 700));          // 第二段：＋頂端加成
  grandT.push(setTimeout(function(){                                            // 第三段：實付倍率＋派彩＋錢包同步滾動
    g.classList.add('s3');
    rollText($('gFinal'), d.M, d.boosted, 500, function(v){ return fmtX(v) + 'x'; });
    rollText($('gPay'), 0, d.payout, 500, function(v){ return '+' + fmt(Math.round(v)) + ' 自動入袋'; });
    setWallet(d.wallet, true);
  }, 1300));
}
function rollText(el, from, to, ms, f){           // 數字滾動：純文字改寫（不動排版動畫）；背景分頁 rAF 停擺以 setTimeout 保底
  var t0 = performance.now();
  (function tick(t){
    var k = Math.max(0, Math.min(1, (t - t0) / ms));
    el.textContent = f(from + (to - from) * k);
    if(k < 1) requestAnimationFrame(tick);
  })(t0);
  setTimeout(function(){ el.textContent = f(to); }, ms + 60);
}
function grandHide(){ $('grand').classList.remove('show', 's2', 's3'); }
function boardReset(msg){
  stopCountdown();
  pb = null;
  $('colE').classList.remove('hi'); $('colS').classList.remove('hi');
  clearDuel(); renderHands(0); railRender();
  banner(msg || '選邊下注開局');
  panelBet();
}

/* ---------- 引擎事件 ---------- */
var uiStake = 0;
game.on(function(type, d){
  if(type === 'wallet'){
    if(d.wallet !== walTarget) setWallet(d.wallet, false);
    return;
  }
  if(type === 'mode'){ applyMode(d.mode); return; }
  if(game.getState().mode === 'advanced' && window.EAdv){   // E04：進階模式事件交給 ui-advanced.js
    EAdv.onEvent(type, d); return;
  }
  if(type === 'lock'){
    var st = game.getState().st;
    uiStake = st.stake0;
    beginPlayback(d.side, d.rung, d.script, st.stake0);
  }
  else if(type === 'ladder'){
    railRender();
    panelLadder(d);
    banner('第 ' + d.rung + ' 階達成——續戰或收手？');
  }
  else if(type === 'timeout' && d.which === 'decide'){
    banner('逾時未選——自動收手');
  }
  else if(type === 'settle'){
    stopCountdown();
    if(d.kind === 'cash'){
      setWallet(d.wallet, true);                  // 派彩 0.4s 滾動
      boardReset((d.via === 'timeout' ? '逾時自動收手 +' : '落袋為安 +') + fmt(d.payout) + '。選邊下注開局');   // E05：Q2 逾時收手文案不被重置蓋掉
    }else if(d.kind === 'bust'){
      setWallet(d.wallet, false);
      banner('本階失利，−' + fmt(uiStake) + '。');
      setTimeout(function(){ boardReset('勝敗兵家常事——選邊下注開局'); }, 1400);
    }else{                                        // slam｜full：三段揭示大演出（錢包滾動併入第三段）
      var last = game.getState().records.slice(-1)[0] || {};
      railRender({ M:d.M, rung:last.rung || 0, hist:[], fin:true, kind:d.kind });   // 進度條停在終值、標「滿貫／完賭」
      $(last.path && last.path[last.path.length - 1] === 'slv' ? 'colS' : 'colE').classList.add('hi');   // 下注側頭像高光（浮於暗幕之上）
      grandShow(d);
      if(!SHOT) setTimeout(function(){ grandHide(); boardReset(); }, GRAND_MS);   // 截圖模式凍結在終幕
    }
  }
  else if(type === 'error'){
    var m = $('pmsg');
    if(m) m.textContent = d.msg; else banner(d.msg);
  }
});

/* ---------- 導演台 ---------- */
if(DEV){
  document.body.classList.add('dev');
  $('director').classList.add('on');
  $('devReset').onclick = function(){
    if(game.getState().st){ banner('對局中不可重置'); return; }
    game.clearSaved();
    boardReset('已重置。選邊下注開局');
  };
}

/* ---------- 頂欄普通⇄進階切換（僅 BET 態可切；模式偏好由 core 存檔） ---------- */
function applyMode(m){
  var adv = (m === 'advanced');
  document.body.classList.toggle('adv', adv);
  $('mNormal').classList.toggle('on', !adv);
  $('mAdv').classList.toggle('on', adv);
  if(adv){ if(window.EAdv) EAdv.enter(); }
  else boardReset('觀賽視角——選邊下注開局');
}
function switchMode(m){
  var s = game.getState();
  if(s.mode === m) return;
  if(s.st || s.phase !== 'BET'){ banner('對局中不可切換模式'); return; }
  game.setMode(m);
}
$('mNormal').onclick = function(){ switchMode('normal'); };
$('mAdv').onclick    = function(){ switchMode('advanced'); };

/* ---------- 對外共用 API（E04 ui-advanced.js 沿用面板／錢包／翻牌／斬牌／滿貫演出） ---------- */
window.EUI = { game:game, $:$, fmt:fmt, fmtX:fmtX, NAME:NAME, RM:RM, DEV:DEV, SHOT:SHOT,
  armForce:armForce, setWallet:setWallet, banner:banner, bannerFade:bannerFade,
  panelBet:panelBet, panelLock:panelLock, panelLadder:panelLadder, stopCountdown:stopCountdown,
  grandShow:grandShow, grandHide:grandHide, GRAND_MS:GRAND_MS, railWord:railWord,
  slot:slot, cls:cls, flipTo:flipTo, sliceCard:sliceCard, flash:flash, clash:clash };
if(window.EAdv) EAdv.init(window.EUI);

/* ---------- 開機＋重整接回 ---------- */
(function boot(){
  var s = game.getState(), guard = 0;
  if(SHOT && SHOT.indexOf('adv') === 0){ game.setMode('advanced'); s = game.getState(); }   // 截圖自動駕駛：進階
  if(s.mode === 'advanced' && !window.EAdv){
    // 無進階殼（如舊頁）卻留有進階殘局：快轉結清回普通，避免卡死
    while(s.st && guard++ < 12){
      if(s.phase === 'PLAY') game.fireTimeout('play');
      else if(s.phase === 'ANIM') game.ack();
      else if(s.phase === 'LADDER') game.cashOut();
      else break;
      s = game.getState();
    }
    if(!s.st) game.setMode('normal');
  }
  s = game.getState();
  setWallet(s.wallet, false);
  if(s.mode === 'advanced'){                        // E04：進階模式接回交給 ui-advanced.js
    document.body.classList.add('adv');
    $('mNormal').classList.remove('on'); $('mAdv').classList.add('on');
    renderHands(0); railRender();
    EAdv.boot(s);
    return;
  }
  renderHands(0); railRender();
  if(s.phase === 'ANIM' && s.st && s.st.script){   // 重整接回：重播本階演出後 ack
    uiStake = s.st.stake0;
    beginPlayback(s.st.side, s.st.rung, s.st.script, s.st.stake0);
  }else if(s.phase === 'LADDER' && s.st){          // 重整接回：階梯決策（倒數沿存檔 deadline；手牌消耗數與決勝牌面照存檔還原）
    var sc = s.st.script || [], lt = sc[sc.length - 1];
    renderHands(sc.length);
    if(lt){ slot(slotL, s.st.side === 'emp' ? lt.p : lt.o, true); slot(slotR, s.st.side === 'emp' ? lt.o : lt.p, true); }
    railRender();
    panelLadder({ M:s.st.M, rung:s.st.rung, cash:s.st.cash,
      nextEmp:s.st.M * EV.FAIR.emp, nextSlv:s.st.M * EV.FAIR.slv, deadline:s.st.deadline });
    banner('第 ' + s.st.rung + ' 階達成——續戰或收手？');
  }else{
    panelBet();
  }
  if(SHOT === 'slam' || SHOT === 'ladder3') setTimeout(function(){ game.bet('slv', 500); }, 300);   // 截圖：連押奴隸（滿貫／第 3 階決策態）
  if(SHOT === 'full' || SHOT === 'full9')   setTimeout(function(){ game.bet('emp', 500); }, 300);   // 截圖：連押皇帝（完賭／第 9 階決策態）
})();
})();
