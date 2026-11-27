/* =========================================================================
 * 爆金連鎖——字串字典＋取字函式 t()（可移植；轉引擎時文案整包照搬）
 *
 * 約定：
 *  - 所有面向玩家的字串集中在這（含 autobet／log／onboard／導演台），key 用「區塊.用途」。
 *  - UI 一律 t('key', {vars}) 取字，禁止在版面檔寫死中文。
 *  - 骨架（index.html）的固定字掛 data-t="key"，載入時自動填好：
 *      data-t-attr="title" 改填屬性；data-t-html="1" 走 innerHTML（字串含標記時）。
 *  - 語言選取：?lang=xx 網址參數 → localStorage『burst.lang』→ 預設 zh-TW。
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

  /* ===== 主畫面（只放圖示＋數字，字只有這幾個；能量條不寫字） ===== */
  'top.log'    : '勝負紀錄',
  'top.logShort': '紀錄',
  'top.speed.normal': '普通速度',
  'top.speed.fast'  : '高速',
  'top.hint.on'     : '提示：開',
  'top.hint.off'    : '提示：關',
  'auto.short' : '自動',
  'tier.big'   : '大連爆',
  'tier.huge'  : '超級連爆',
  'rej.insufficient' : '餘額不足',

  /* ===== 自動下注 ===== */
  'auto.btn'     : '自動下注',
  'auto.title'   : '自動下注設定',
  'auto.pick'    : '丟法',
  'auto.c.build' : '{n} 格引爆',
  'auto.c.quick' : '快速回收',
  'auto.alt'     : '輪流',
  'auto.stake'   : '單注',
  'auto.rounds'  : '局數',
  'auto.tp'      : '停利',
  'auto.sl'      : '停損',
  'auto.off'     : '關',
  'auto.inf'     : '不限',
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
  'auto.lock'    : '自動下注中，請先停止',

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
  'log.d.stake'  : '面額',
  'log.d.pay'    : '拿回',
  'log.d.pot'    : '獎池',
  'log.d.cell'   : '丟在',
  'log.d.kind'   : '丟的是',
  'log.d.burst'  : '連爆',
  'log.d.out'    : '噴出',
  'log.d.rainOut': '其中金幣雨帶出',
  'log.d.rainNa' : '重整接回，無明細',
  'log.d.cellAt' : '第 {r} 列・第 {c} 欄',
  'log.d.burstN' : '{n} 格',
  'log.d.none'   : '無',
  'log.d.item'   : '{name}×{n}',
  'log.d.sep'    : '・',
  'log.k.coin'   : '金幣',
  'log.k.diamond': '鑽石',
  'log.k.crown'  : '皇冠',

  /* ===== 導演台（?dev=1） ===== */
  'dev.title'    : '導演台',
  'dev.kind'     : '下一枚',
  'dev.meter'    : '能量條',
  'dev.meterNear': '集到剩 1 格',
  'dev.meterBusy': '演出中不能改能量條',
  'dev.rainNext' : '金幣雨',
  'dev.pot'      : '獎池',
  'dev.potPlus'  : '＋10 倍面額',
  'dev.potBusy'  : '演出中不能改獎池',
  'dev.any'      : '隨機',
  'dev.fill'     : '填滿盤面',
  'dev.fillBusy' : '演出中不能填盤面',
  'dev.addBusy'  : '演出中不能加錢',
  'dev.cancel'   : '取消預約',
  'dev.idle'     : '下一注：照真實機率',
  'dev.armed'    : '下一注：{k}',
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
