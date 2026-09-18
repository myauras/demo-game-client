/* =========================================================================
 * 專案E「皇帝牌」E04——進階模式 UI（第一人稱透視牌桌＋手持手牌＋立繪差分）
 * 依賴：game-ui.js 對外共用 API window.EUI（面板／錢包／翻牌／斬牌／滿貫演出）
 *       ——本檔在 game-ui.js 之前載入，game-ui 於 boot 前呼叫 EAdv.init(EUI)。
 * 引擎：js/duel-core.js 進階模式接口（PLAY —play／Q3 逾時→ ANIM —ack→ …），零改動。
 * 節拍：R3–R5 語彙沿用（蓋牌拋物線飛入→落定 scaleX 翻面；決勝對面按住約 1s 才翻＋
 *       閃光震動；敗方牌斬半）；平手快進 ~1.06s；表情：從容→審視→嗤笑→強裝鎮定→得意／破防。
 * 透視：桌面 rotateX 平面（CSS）；飛牌內層卡片隨飛行轉成桌面傾角（分層，不與位移同字串）。
 * 紅線：動畫只動 transform／opacity；陰影靜態；禁 filter。
 * ========================================================================= */
window.EAdv = (function(){
'use strict';
var U, game, $, RM = false, SHOT = '';
var T = window.t;                                // panelPlay() 的參數 t＝回合數會遮住全域取字函式，故備一個別名
var TILT = 36;                                   // 與 css .tabletop rotateX 同值
/* R4：進階模式出牌倒數拉長（使用者直接需求「選牌時間加長、對手多講話」）。
 * 走 core 暴露的時間常數物件在 shell 端覆寫，core 檔案零修改；本檔先於 game-ui 載入，故 createGame／restore 皆吃到新值。
 * 註：規格 §Q3 原裁決 5s，此為使用者 2026-09-17 直接需求，口徑待管理補裁決。普通模式不用此常數。 */
var PLAY_MS_ADV = 12000, CHAT_MS = 3000;
DuelCore.TIMING.PLAY_MS = PLAY_MS_ADV;

/* ---------- 狡詐紳士 SVG 六幀差分（示意稿 FACES 搬用；一顆頭共用、只換五官） ---------- */
var HEAD = '<ellipse cx="32" cy="34" rx="17" ry="20" fill="#C9A87A"/>' +
  '<path d="M13,32 Q11,6 32,6 Q53,6 51,32 Q51,14 32,13 Q13,14 13,32 Z" fill="#241A12"/>' +
  '<path d="M32,31 l3,7 h-6 Z" fill="#B08F60"/>';
var STK = 'stroke="#2A1E12" stroke-width="2.4" fill="none" stroke-linecap="round"';
function svgFace(inner){ return '<svg viewBox="0 0 64 64" aria-hidden="true">' + HEAD + inner + '</svg>'; }
var FACES = {
  idle:  svgFace('<path d="M19,22 L29,25" '+STK+'/><path d="M45,22 L35,25" '+STK+'/><path d="M21,30 q4,2 8,0" '+STK+'/><path d="M35,30 q4,2 8,0" '+STK+'/><path d="M26,45 q7,4 12,-2" '+STK+'/>'),
  think: svgFace('<path d="M19,23 L29,26" '+STK+'/><path d="M45,23 L35,26" '+STK+'/><path d="M21,30 h9" '+STK+'/><path d="M34,30 h9" '+STK+'/><path d="M27,46 h10" '+STK+'/>'),
  smirk: svgFace('<path d="M18,19 L29,23" '+STK+'/><path d="M45,24 L35,26" '+STK+'/><path d="M21,29 q4,3 8,0" '+STK+'/><path d="M35,31 q4,1 8,-1" '+STK+'/><path d="M24,44 q9,6 15,-4" '+STK+'/>'),
  sweat: svgFace('<path d="M20,25 L29,22" '+STK+'/><path d="M44,25 L35,22" '+STK+'/><path d="M21,30 h8" '+STK+'/><path d="M35,30 h8" '+STK+'/><path d="M26,46 q6,-3 12,0" '+STK+'/><path d="M52,18 q4,6 0,9 q-4,-3 0,-9" fill="#7FB6D9"/>'),
  proud: svgFace('<path d="M19,20 q5,-3 10,1" '+STK+'/><path d="M45,20 q-5,-3 -10,1" '+STK+'/><path d="M21,29 q4,-4 8,0" '+STK+'/><path d="M35,29 q4,-4 8,0" '+STK+'/><path d="M23,42 q9,11 18,0 q-9,4 -18,0 Z" fill="#3B1F16"/>'),
  shock: svgFace('<path d="M17,17 L28,21" '+STK+'/><path d="M47,17 L36,21" '+STK+'/><circle cx="24" cy="29" r="4" fill="#FFF"/><circle cx="24" cy="29" r="1.8" fill="#2A1E12"/><circle cx="40" cy="29" r="4" fill="#FFF"/><circle cx="40" cy="29" r="1.8" fill="#2A1E12"/><ellipse cx="32" cy="47" rx="5" ry="6" fill="#3B1F16"/><path d="M12,24 l-4,-2 M12,30 h-4 M52,24 l4,-2 M52,30 h4" '+STK+'/>')
};
/* E09：表情標籤與定型台詞全走字典（tag.* / line.*），face 代號本身是程式識別碼、不翻 */
var FACE_KEYS = ['idle','think','smirk','sweat','proud','shock'];
var TAG = {}, LINES = {};
FACE_KEYS.forEach(function(k){ TAG[k] = t('tag.' + k); LINES[k] = tList('line.' + k)[0]; });
/* R3 反應池（演出層、零 EV）：對手隨你「亮哪張／出哪張／第幾回合」起不同反應；
 * 決勝懸置那一秒給一個帶虛張聲勢的破綻（誠實率 TELL_HONEST），讀臉是樂趣不是資訊優勢——勝負在下注時已鎖定。 */
function pair(faces, key){        // 表情＋台詞成對（等待期閒聊／催促）
  var L = tList(key);
  return faces.map(function(f, i){ return { f:f, l:L[i] }; });
}
var POOL = {                                     // E09：台詞全走字典 tList('pool.*')；表情代號留在程式碼裡
  wait:     tList('pool.wait'),                  // 依回合 1..5
  selMin:   tList('pool.selMin'),
  selSp:    tList('pool.selSp'),
  playMin:  tList('pool.playMin'),
  playSp:   tList('pool.playSp'),
  tellWin:  tList('pool.tellWin'),               // 他要輸（你贏）→ 強裝鎮定
  tellLose: tList('pool.tellLose'),              // 他要贏（你輸）→ 續嗤笑
  tie:      tList('pool.tie'),
  chat:     pair(['idle','smirk','think','sweat','smirk','idle','think','smirk'], 'pool.idleChat'),
  hurry:    pair(['think','smirk'], 'pool.hurry'),
  declTrue: tList('pool.declTrue'),
  declLie:  tList('pool.declLie'),
  shock:    tList('pool.shock'),
  slam:     tList('pool.slam'),                  // E05 滿貫：破防鎖定台詞
  full:     tList('pool.full'),                  // E05 完賭：破防鎖定台詞
  proud:    tList('pool.proud')
};
var TELL_HONEST = 0.75;                          // 破綻誠實率（演出層常數，非賠率）
function pick(arr){ return SHOT ? arr[0] : arr[Math.floor(Math.random() * arr.length)]; }

var curFace = null, busy = false, cdT = null, idleT = null, uiStake = 0;
var chatT = null, decl = null;                  // 閒聊計時器／本回合宣言（他說要出的牌，可能是謊）
var myW = [], opW = [];                          // 手牌外層元素（扇形定位）×5

/* ---------- 立繪差分＋泡泡（雙層 opacity 交叉淡化 0.2s） ---------- */
function setFace(k, line){
  if(curFace !== k){
    var a = $('faceA'), b = $('faceB');
    var show = a.classList.contains('on') ? b : a, hide = (show === a) ? b : a;
    show.innerHTML = FACES[k]; show.classList.add('on'); hide.classList.remove('on');
    curFace = k;
    $('bust').setAttribute('data-face', k);
    $('btag').textContent = t('adv.oppTag', { tag:TAG[k] });
  }
  bubble(line === undefined ? LINES[k] : line);
}
function bubble(t){
  var el = $('bubble');
  if(!t){ el.classList.remove('on'); return; }
  el.textContent = t; el.classList.add('on');
}

/* ---------- 手牌（❼ 玩家扇形 5 張／❸ 對手反向小扇 5 張；位置固定、出過變暗） ---------- */
function buildHands(){
  var fan = $('hfan'), of = $('ofan'), i, w, c, k;
  for(i = 0; i < DuelCore.ROUNDS; i++){
    k = i - 2;
    w = document.createElement('div'); w.className = 'hcw idle';
    w.dataset.i = i; w.dataset.a = (k * 8);
    w.style.transform = 'translateX(' + (k * 44) + 'px) translateY(' + (k*k*2) + 'px) rotate(' + (k * 8) + 'deg)';
    c = document.createElement('div'); c.className = 'hc dback'; w.appendChild(c);
    w.onclick = onPick; fan.appendChild(w); myW.push(w);
    w = document.createElement('div'); w.className = 'ow';
    w.style.transform = 'translateX(' + (k * 14) + 'px) translateY(' + (k*k*1.2) + 'px) rotate(' + (-k * 15) + 'deg)';   // 倒扇：軸心在上、每張 15°
    c = document.createElement('div'); c.className = 'oc'; w.appendChild(c);
    of.appendChild(w); opW.push(w);
  }
}
function renderMy(cards){
  for(var i = 0; i < myW.length; i++){
    var w = myW[i], c = cards ? cards[i] : null, inner = w.firstChild;
    if(!c){ w.className = 'hcw idle'; inner.className = 'hc dback'; inner.innerHTML = ''; }
    else { w.className = 'hcw' + (c.used ? ' gone' : ''); inner.className = 'hc ' + U.cls(c.t);
           inner.innerHTML = '<i class="rk">' + tch(c.t) + '</i>'; }                  // E08 卡面圖＋角落徽記；E09 徽記走字典
  }
}
function renderOpp(used){
  for(var i = 0; i < opW.length; i++) opW[i].className = 'ow' + (i < used ? ' gone' : '');
}
function setTurn(on){ $('myhand').classList.toggle('turn', !!on); }
function onPick(){                               // R4：一段式，點即出（R3 兩段式依使用者回饋撤回）
  if(busy || this.classList.contains('gone') || this.classList.contains('idle')) return;
  if(game.getState().phase !== 'PLAY') return;
  game.play(+this.dataset.i);
}
/* R4 等待期閒聊：第 1 句依回合遞進；第 2 句必為宣言「這回合我出Ｘ」（可能說謊，翻牌時對照）；
 * 之後從閒聊池輪替，剩 ≤3s 改催促句。每句換表情，讓等待期不是單一表情。 */
function stopChat(){ if(chatT){ clearInterval(chatT); chatT = null; } }
function startChat(trick, deadline){
  stopChat(); decl = null;
  var st = game.getState().st, n = 0, used = {};
  var opSp = (st.side === 'slv') ? '帝' : '奴';
  chatT = setInterval(function(){
    if(game.getState().phase !== 'PLAY'){ stopChat(); return; }
    n++;
    var remain = (deadline || 0) - Date.now();
    if(remain <= 3200){ var h = SHOT ? POOL.hurry[0] : pick(POOL.hurry); setFace(h.f, h.l); return; }
    if(n === 1){                                   // 宣言：偏向說「民」（他多半真的出民），偶爾放話特殊牌
      decl = (SHOT || Math.random() < 0.65) ? '民' : opSp;
      setFace(SHOT ? 'smirk' : (Math.random() < 0.5 ? 'smirk' : 'idle'), t('adv.declare', { ch:tch(decl) }));
      return;
    }
    var k, tries = 0;                              // 不重複的閒聊句
    do { k = Math.floor((SHOT ? n * 0.37 : Math.random()) * POOL.chat.length) % POOL.chat.length; } while(used[k] && tries++ < 8);
    used[k] = true; setFace(POOL.chat[k].f, POOL.chat[k].l);
  }, CHAT_MS);
}
function declLine(oc){                           // 翻牌對照宣言：真→「說了吧？」、假→「騙你的。」
  if(!decl) return null;
  var truth = (decl === oc); decl = null;
  return pick(truth ? POOL.declTrue : POOL.declLie);
}

/* ---------- 對決區（桌面上） ---------- */
function clearDuel(){
  U.slot($('slotP'), null); U.slot($('slotO'), null);
  var cuts = $('tduel').querySelectorAll('.cutfx');
  for(var i = 0; i < cuts.length; i++) cuts[i].remove();
  $('bust').classList.remove('lean');
}
/* 拋物線飛牌（3D 版）：起點＝扇形中該張的實際投影框（含該張旋轉角）、終點＝桌面槽的投影框；
 * 外層 translate（transition）＋中層垂直起伏（keyframes）＋內層 rotateX 轉成桌面傾角（transition），
 * 三層各自一條 transform，互不覆蓋；一律蓋牌飛行，落定後才 scaleX 翻面（R5）。 */
function flyAdv(srcW, slotEl, ch, done){
  if(RM){ U.slot(slotEl, ch, true); if(done) done(); return; }
  /* 量測全部在 append 之前完成、起點 transform 也在 append 前設好——
   * 若 append 後才讀排版（offsetWidth）會讓元素先以 transform:none 被計算，
   * 起點值反而變成一段 none→起點的過渡再被終點蓋掉（位移段消失，E04-R2 修正）。 */
  var app = $('app'), ar = app.getBoundingClientRect();
  var a = srcW.getBoundingClientRect(), b = slotEl.getBoundingClientRect();
  var w = slotEl.offsetWidth, h = slotEl.offsetHeight, sw = srcW.offsetWidth || w;
  var cx = b.left + b.width/2 - ar.left, cy = b.top + b.height/2 - ar.top;
  var dx = (a.left + a.width/2) - (b.left + b.width/2);
  var dy = (a.top + a.height/2) - (b.top + b.height/2);
  var s0 = Math.max(.3, Math.min(1.2, sw / w));
  var r  = Math.max(.5, Math.min(1.2, b.width / w));
  var fx = document.createElement('div'); fx.className = 'flyx';
  fx.style.left = (cx - w/2).toFixed(1) + 'px'; fx.style.top = (cy - h/2).toFixed(1) + 'px';
  fx.style.width = w + 'px'; fx.style.height = h + 'px';
  fx.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotate(' +
    (srcW.dataset.a || 0) + 'deg) scale(' + s0.toFixed(3) + ')';
  var arc = document.createElement('div'); arc.className = 'flyy p3d' + (dy < 0 ? ' far' : '');   // 對面來的牌：弧度較平
  var c3 = document.createElement('div'); c3.className = 'flyc';
  var card = document.createElement('div'); card.className = 'dslot filled dback';
  c3.appendChild(card); arc.appendChild(c3); fx.appendChild(arc); app.appendChild(fx);
  void fx.offsetWidth;                            // 首次計算＝起點（無過渡）
  fx.style.transform = 'translate(0,0) rotate(0) scale(' + r.toFixed(3) + ')';
  c3.style.transform = 'rotateX(' + TILT + 'deg)';
  setTimeout(function(){
    fx.remove();
    U.slot(slotEl, '?');                         // 落定仍蓋牌
    if(ch !== '?') U.flipTo(slotEl, ch, done); else if(done) done();
  }, 330);
}

/* ---------- 右緣直式階梯進度條（對數刻度＝core railPct；只動 scaleY 與綠點） ---------- */
function railRender(fin){                        // fin：結算快照（滿貫／完賭演出期間維持終值、標「滿貫／完賭」），語彙同普通機位 U.railWord
  var s = game.getState(), st = fin || s.st, rail = $('vrail');
  if(!st){
    rail.classList.add('idle');
    $('vlab').textContent = t('rail.waiting'); $('vrung').textContent = t('rail.dash');
    $('vfill').style.transform = 'scaleY(0)'; $('vdots').innerHTML = '';
    return;
  }
  rail.classList.remove('idle');
  $('vlab').textContent = U.fmtX(st.M) + 'x';
  $('vrung').innerHTML = t('rail.rung', { n:st.rung }) + '<br>' + U.railWord(st);
  $('vfill').style.transform = 'scaleY(' + (DuelCore.railPct(st.M) / 100).toFixed(4) + ')';
  $('vdots').innerHTML = st.hist.map(function(m){
    return '<span class="vdot" style="bottom:' + DuelCore.railPct(m).toFixed(1) + '%"></span>';
  }).join('');
}

/* ---------- ❽ 面板出牌態＋Q3 倒數 5s 圈（數字＋指針 rotate） ---------- */
function stopCd(){ if(cdT){ clearInterval(cdT); cdT = null; } }
function panelPlay(t, deadline, st){
  U.stopCountdown(); stopCd();
  $('panel').innerHTML =
    '<div class="playp">' +
      '<div class="cring" id="cring"><span class="cnum" id="cnum"></span><span class="chand" id="chand"></span></div>' +
      '<div class="ltitle">' + T('adv.turn', { t:t }) + '</div>' +
      '<div class="lm">' + T('adv.turnSub', { side:U.NAME[st.side], stake:U.fmt(st.stake0) }) + '</div>' +
      '<div class="lnote">' + T('adv.turnNote1') + '</div>' +
      '<div class="lnote">' + T('adv.turnNote2', { n:st.rung, m:U.fmtX(st.M), line:EV.CFG.SLAM_LINE }) + '</div>' +
    '</div>';
  var total = DuelCore.TIMING.PLAY_MS;   // 進階模式＝PLAY_MS_ADV（12s）
  function cd(){
    var num = $('cnum'), hand = $('chand'), ring = $('cring');
    if(!num){ stopCd(); return; }
    var remain = Math.max(0, (deadline || 0) - Date.now());
    num.textContent = Math.ceil(remain / 1000);
    hand.style.transform = 'rotate(' + ((1 - remain / total) * 360).toFixed(1) + 'deg)';
    if(remain <= 3000) ring.classList.add('hurry');
    if(remain <= 0) stopCd();
  }
  cd(); cdT = setInterval(cd, 100);
}

/* ---------- 版面重置（BET 態） ---------- */
function resetBoard(msg){
  stopCd(); stopChat(); busy = false;
  if(idleT){ clearTimeout(idleT); idleT = null; }
  renderMy(null); renderOpp(0); clearDuel(); railRender(); setTurn(false);
  setFace('idle');
  U.banner(msg || t('banner.adv'));
  U.panelBet();
}

/* ---------- 引擎事件 ---------- */
function onLock(d){
  var st = game.getState().st;
  stopCd(); busy = false; uiStake = st.stake0;
  if(idleT){ clearTimeout(idleT); idleT = null; }
  renderMy(st.myCards); renderOpp(0); clearDuel(); railRender();
  U.panelLock(d.side, st.stake0);
  setFace('idle');                               // 封盤：從容；隨後 await 轉審視
}
function onAwait(d){
  var st = game.getState().st;
  busy = false;
  renderMy(st.myCards); renderOpp(st.oppUsed); clearDuel();
  setTurn(true);
  U.banner(t('adv.banTrick', { t:d.trick }));
  panelPlay(d.trick, d.deadline, st);
  if(idleT){ clearTimeout(idleT); idleT = null; }
  var waitLine = POOL.wait[Math.min(d.trick, POOL.wait.length) - 1];
  if(d.trick === 1 && curFace === 'idle' && !RM){    // 待機從容→（0.6s）審視
    idleT = setTimeout(function(){ idleT = null; if(game.getState().phase === 'PLAY') setFace('think', waitLine); }, 600);
  }else setFace('think', waitLine);
  startChat(d.trick, d.deadline);
  if(SHOT === 'adv-flip' || SHOT === 'adv-shock' || SHOT === 'adv-slam') setTimeout(autoPick, 250);
  if(SHOT === 'adv-wait') setTimeout(function(){ decl = '民'; setFace('smirk', t('adv.declare', { ch:tch('民') })); }, 700);   // 截圖：宣言句
}
function onTrick(d){                             // d：{t,pc,oc,verdict,timeout}
  var st = game.getState().st, i, idx = -1;
  busy = true; setTurn(false); stopCd(); stopChat();
  if(idleT){ clearTimeout(idleT); idleT = null; }
  for(i = 0; i < st.myCards.length; i++)
    if(st.myCards[i].used && !myW[i].classList.contains('gone')){ idx = i; break; }
  if(idx < 0) idx = 0;
  var src = myW[idx], osrc = opW[Math.max(0, st.oppUsed - 1)];
  src.classList.add('gone'); osrc.classList.add('gone');   // 起飛即暗＝牌已打出（牌數自洽）
  U.banner(d.timeout ? t('adv.banTimeout', { t:d.t }) : t('banner.trick', { n:d.t }));
  if(d.pc === '民') setFace('smirk', pick(POOL.playMin)); else setFace('think', pick(POOL.playSp));
  var slotP = $('slotP'), slotO = $('slotO'), tduel = $('tduel');
  if(!d.verdict){                                // 平手（民民）快進：齊飛齊翻→對碰→清場
    flyAdv(src, slotP, d.pc);
    setTimeout(function(){ flyAdv(osrc, slotO, d.oc); }, 90);
    setTimeout(function(){ U.clash(tduel); var dl = declLine(d.oc); setFace(dl ? 'smirk' : 'idle', dl || pick(POOL.tie)); }, 680);
    setTimeout(function(){ clearDuel(); busy = false; game.ack(); }, 1060);
    return;
  }
  flyAdv(src, slotP, d.pc);                      // 決勝：你的牌落定即翻
  setTimeout(function(){ flyAdv(osrc, slotO, '?'); }, 90);   // 對面蓋牌飛入、按住不翻
  setTimeout(function(){                         // 破綻：多半誠實、偶爾虛張聲勢（讀臉樂趣，零 EV）
    var honest = SHOT ? true : (Math.random() < TELL_HONEST);
    var showLosing = honest ? d.verdict.win : !d.verdict.win;
    setFace(showLosing ? 'sweat' : 'smirk', pick(showLosing ? POOL.tellWin : POOL.tellLose));
    $('bust').classList.add('lean');
  }, 520);
  setTimeout(function(){
    U.flipTo(slotO, d.oc, function(){           // 懸念後翻面→閃光震動→表情→斬敗方牌
      var win = d.verdict.win;
      U.flash($('flashA')); U.clash(tduel);
      U.banner(t('banner.verdict', { reason:t('verdict.' + d.verdict.code), side:U.NAME[st.side],
        res:win ? t('verdict.win') : t('verdict.lose') }));   // E09：查 core 的 code
      $('bust').classList.remove('lean');
      var dl = declLine(d.oc);                 // 他贏且有宣言→回馬槍；他輸→破防台詞
      setFace(win ? 'shock' : 'proud', win ? pick(POOL.shock) : (dl || pick(POOL.proud)));
      (win ? slotP : slotO).classList.add('lift');
      if(SHOT === 'adv-flip'){ $('flashA').classList.add('hold'); return; }   // 截圖凍結在翻牌瞬間
      setTimeout(function(){ U.sliceCard(win ? slotO : slotP, win ? d.oc : d.pc, tduel); }, 180);
      setTimeout(function(){ busy = false; game.ack(); }, 1100);
    });
  }, 1050);
}
function onLadder(d){
  stopCd(); stopChat(); railRender();
  U.panelLadder(d);
  U.banner(t('banner.ladder', { n:d.rung }));
  setFace('shock', pick(POOL.shock) + t('adv.stillGo'));   // 破防鎖定至階梯決策
}
function onSettle(d){
  stopCd();
  if(d.kind === 'cash'){
    U.setWallet(d.wallet, true);
    resetBoard(t(d.via === 'timeout' ? 'banner.cashTo' : 'banner.cash', { n:U.fmt(d.payout) }));   // E05：同普通機位
  }else if(d.kind === 'bust'){
    U.setWallet(d.wallet, false);
    U.banner(t('banner.bust', { n:U.fmt(uiStake) }));
    setTimeout(function(){ resetBoard(t('banner.bustAgn')); }, 1400);
  }else{                                         // slam｜full：共用三段揭示大演出（錢包滾動併入第三段）；對手破防幀＋台詞鎖定至收幕
    var last = game.getState().records.slice(-1)[0] || {};
    railRender({ M:d.M, rung:last.rung || 0, hist:[], fin:true, kind:d.kind });
    stopChat(); if(idleT){ clearTimeout(idleT); idleT = null; }
    setFace('shock', pick(d.kind === 'slam' ? POOL.slam : POOL.full));
    $('bust').classList.add('lean');
    U.grandShow(d);
    if(!SHOT) setTimeout(function(){ U.grandHide(); resetBoard(); }, U.GRAND_MS);
  }
}
function onEvent(type, d){
  if(type === 'lock') onLock(d);
  else if(type === 'await') onAwait(d);
  else if(type === 'trick') onTrick(d);
  else if(type === 'ladder') onLadder(d);
  else if(type === 'timeout' && d.which === 'decide') U.banner(t('banner.timeout'));
  else if(type === 'settle') onSettle(d);
  else if(type === 'error'){ var m = $('pmsg'); if(m) m.textContent = d.msg; else U.banner(d.msg); }
}

/* ---------- 截圖自動駕駛（?shot=adv-flip｜adv-shock：先出民再出特殊牌） ---------- */
function autoPick(){
  var s = game.getState(), st = s.st, i;
  if(!st || s.phase !== 'PLAY') return;
  var want = (st.trick === 0) ? '民' : (st.side === 'slv' ? '奴' : '帝');
  for(i = 0; i < st.myCards.length; i++) if(!st.myCards[i].used && st.myCards[i].t === want){ game.play(i); return; }
  for(i = 0; i < st.myCards.length; i++) if(!st.myCards[i].used){ game.play(i); return; }
}

/* ---------- 開機／模式切換 ---------- */
function init(eui){
  U = eui; game = U.game; $ = U.$; RM = U.RM; SHOT = U.SHOT;
  $('vTop').innerHTML = t('adv.vTop', { line:EV.CFG.SLAM_LINE });
  buildHands();
  $('faceA').innerHTML = FACES.idle; $('faceA').classList.add('on'); curFace = 'idle';
  $('bust').setAttribute('data-face', 'idle'); $('btag').textContent = t('adv.oppTag', { tag:TAG.idle });
}
function enter(){ resetBoard(); }              // 由普通切進（BET 態）
function boot(s){                                // 重整接回（mode=advanced）
  railRender();
  if(s.phase === 'PLAY' && s.st){
    uiStake = s.st.stake0;
    onAwait({ trick:s.st.trick + 1, deadline:s.st.deadline });
  }else if(s.phase === 'LADDER' && s.st){
    uiStake = s.st.stake0;
    renderMy(s.st.myCards); renderOpp(s.st.oppUsed); clearDuel(); setTurn(false);
    onLadder({ M:s.st.M, rung:s.st.rung, cash:s.st.cash,
      nextEmp:s.st.M * EV.FAIR.emp, nextSlv:s.st.M * EV.FAIR.slv, deadline:s.st.deadline });
  }else{
    resetBoard();
    if(SHOT && SHOT.indexOf('adv') === 0) setTimeout(function(){ game.bet('slv', 500); }, 300);
  }
}
return { init:init, enter:enter, boot:boot, onEvent:onEvent, setFace:setFace,
         FACES:FACES, LINES:LINES, railRender:railRender,
         getFace:function(){ return curFace; }, isBusy:function(){ return busy; } };
})();
