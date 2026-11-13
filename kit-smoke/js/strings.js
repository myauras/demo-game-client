/* =========================================================================
 * 三選一冒煙——字串字典＋取字函式 t()（可移植；轉引擎時文案整包照搬）
 *
 * 約定：
 *  - 所有面向玩家的字串集中在這（含 autobet／log／onboard／導演台），key 用「區塊.用途」。
 *  - UI 一律 t('key', {vars}) 取字，禁止在版面檔寫死中文。
 *  - 骨架（index.html）的固定字掛 data-t="key"，載入時自動填好：
 *      data-t-attr="title" 改填屬性；data-t-html="1" 走 innerHTML（字串含標記時）。
 *  - 語言選取：?lang=xx 網址參數 → localStorage『kitsmoke.lang』→ 預設 zh-TW。
 *  - 偽語系 ?lang=xx：不是真語言，是「每字串加長 30%」的版面壓力測試
 *    （做新字串時務必跑一次：按鈕／標籤／泡泡都不能溢出或撐破版）。
 *  - 查不到的 key 回 key 本身，開發時一眼看見缺字。
 * 載入順序：values.js → env.js → 本檔（其餘 UI 檔取字時字典要先在）。
 * ========================================================================= */
(function(){
'use strict';

var ZH = {

  /* ===== 共用 ===== */
  'btn.next'   : '下一步',
  'btn.done'   : '開始玩',
  'btn.skip'   : '跳過',
  'btn.close'  : '收合',
  'btn.back'   : '‹ 返回',
  'btn.cancel' : '取消',

  /* ===== 頂欄／骨架 ===== */
  'top.log'    : '勝負紀錄',

  /* ===== 範例玩法：三選一押注（換玩法時換掉這一區） ===== */
  'choice.A'   : 'A',
  'choice.B'   : 'B',
  'choice.C'   : 'C',
  'card.p'     : '機率 {p}%',
  'card.odds'  : '賠 {x}x',
  'bet.stake'  : '單注',
  'banner.idle'    : '選單注，再點一個選項下注',
  'banner.rolling' : '開獎中…',
  'banner.result'  : '開出 {r}（你押 {c}）',
  'net.win'    : '贏 {n}',
  'net.lose'   : '輸 {n}',
  'rej.insufficient' : '餘額不足',
  'rej.busy'   : '開獎中，請稍等',

  /* ===== 新手引導（常駐提示＋首次多步） ===== */
  'hint.title'  : '怎麼玩',
  'hint.short'  : '押一個選項，開中就拿「押額×賠率」',
  'hint.more'   : '看說明',
  'hint.detail' : '三個選項機率不同，機率越低賠率越高；開獎結果在你下注當下就已決定。',
  'tut.step'    : '第 {n} 步／共 {total} 步',
  'tut.s1.title': '選單注',
  'tut.s1.body' : '先挑每次要押多少。',
  'tut.s2.title': '點一個選項下注',
  'tut.s2.body' : '每個選項的機率與賠率都寫在卡上，機率越低賠得越多。點一下就下注。',
  'tut.s3.title': '看開獎結果',
  'tut.s3.body' : '開出你押的選項就贏，拿回「押額×賠率」；沒中就輸掉這一注。',
  'tut.replay'  : '重看教學',
  'tut.replayed': '教學從第一步重播',
  'tut.blocked' : '自動下注進行中，教學稍後再看',

  /* ===== 自動下注 ===== */
  'auto.btn'     : '自動下注',
  'auto.title'   : '自動下注設定',
  'auto.pick'    : '選項',
  'auto.alt'     : '輪流',
  'auto.stake'   : '單注',
  'auto.rounds'  : '局數',
  'auto.tp'      : '停利',
  'auto.sl'      : '停損',
  'auto.off'     : '關',
  'auto.note'    : '到局數、達停利或停損、餘額不足會自動停止；重整頁面也會中止。',
  'auto.go'      : '開始自動下注',
  'auto.idle'    : '⟳ 自動下注・待命',
  'auto.running' : '⟳ 第 {n}/{total} 局・累計 {pnl}{tail}',
  'auto.stopping': '（本局後停止）',
  'auto.stop'    : '■ 停止',
  'auto.busy'    : '目前不能開始自動下注',
  'auto.noMoney' : '餘額不足（{have} < {need}）',
  'auto.end'     : '自動下注結束：{reason}（共 {n} 局，累計 {pnl}）',
  'auto.endDone' : '已跑滿 {n} 局',
  'auto.endStop' : '手動停止',
  'auto.endTp'   : '達停利 +{n}',
  'auto.endSl'   : '達停損 −{n}',
  'auto.endMoney': '餘額不足',
  'auto.endFail' : '下注失敗',
  'auto.aborted' : '重整已中止自動下注（{n}/{total} 局，累計 {pnl}）',

  /* ===== 勝負 log ===== */
  'log.title'    : '勝負紀錄',
  'log.detail'   : '本局細節',
  'log.empty'    : '還沒有紀錄',
  'log.count'    : '{n}／{cap} 筆',
  'log.reset'    : '重置錢包',
  'log.resetAsk' : '確定重置？',
  'log.resetDone': '錢包已重置為 {n}',
  'log.noReset'  : '開獎中不能重置',
  'log.time'     : '時間',
  'log.order'    : '注單號',
  'log.report'   : '回報',
  'log.reported' : '已回報',
  'log.reportToast': '已送出回報（Demo）',
  'log.row.pick' : '你押',
  'log.row.result': '開出',
  'log.row.odds' : '賠率',
  'log.row.stake': '下注',
  'log.row.pay'  : '派彩',
  'log.row.hit'  : '結果',
  'log.hit'      : '押中',
  'log.miss'     : '沒中',

  /* ===== 導演台（?dev=1） ===== */
  'dev.title'    : '導演台',
  'dev.force'    : '下一局',
  'dev.rand'     : '照真實機率',
  'dev.reset'    : '重置錢包',
  'dev.add'      : '＋1,000'
};

var DICT = { 'zh-TW': ZH };
var FALLBACK = 'zh-TW';
var PSEUDO = 'xx';

var LS_KEY = DEMO_KEY + '.lang';
var stored = null;
try{ if(DEMO.persist) stored = localStorage.getItem(LS_KEY); }catch(e){}
var lang = DEMO.q.lang || stored || FALLBACK;
if(lang !== PSEUDO && !DICT[lang]) lang = FALLBACK;
if(DEMO.q.lang && DEMO.persist){ try{ localStorage.setItem(LS_KEY, lang); }catch(e){} }

/* 偽語系：每字串加長 30%（含標記的字串只在尾端補，不插進標籤裡） */
function pseudo(s){
  if(typeof s !== 'string' || !s) return s;
  var n = Math.max(1, Math.ceil(s.replace(/<[^>]+>/g, '').length * 0.3)), tail = '';
  while(tail.length < n) tail += '長';
  return s + tail;
}
function raw(key){
  var d = DICT[lang] || DICT[FALLBACK];
  var s = d[key];
  if(s == null) s = DICT[FALLBACK][key];
  return s == null ? key : s;
}
function fill(s, vars){
  return vars ? s.replace(/\{(\w+)\}/g, function(m, k){ return vars[k] == null ? m : vars[k]; }) : s;
}
function t(key, vars){
  var s = fill(raw(key), vars);
  return lang === PSEUDO ? pseudo(s) : s;
}

function applyStatic(root){
  var ns = (root || document).querySelectorAll('[data-t]');
  for(var i = 0; i < ns.length; i++){
    var n = ns[i], s = t(n.getAttribute('data-t')), at = n.getAttribute('data-t-attr');
    if(at) n.setAttribute(at, s);
    else if(n.getAttribute('data-t-html')) n.innerHTML = s;
    else n.textContent = s;
  }
}

window.STR = DICT;
window.t = t;
DEMO.t = t;
DEMO.lang = lang;
DEMO.isPseudo = (lang === PSEUDO);
DEMO.applyStatic = applyStatic;
applyStatic();
})();
