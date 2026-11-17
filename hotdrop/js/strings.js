/* =========================================================================
 * 空投爭奪——字串字典＋取字函式 t()（可移植；轉引擎時文案整包照搬）
 *
 * 約定：
 *  - 所有面向玩家的字串集中在這（含 autobet／log／onboard／導演台），key 用「區塊.用途」。
 *  - UI 一律 t('key', {vars}) 取字，禁止在版面檔寫死中文。
 *  - 骨架（index.html）的固定字掛 data-t="key"，載入時自動填好：
 *      data-t-attr="title" 改填屬性；data-t-html="1" 走 innerHTML（字串含標記時）。
 *  - 語言選取：?lang=xx 網址參數 → localStorage『hotdrop.lang』→ 預設 zh-TW。
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
  'top.title'  : '空投爭奪',
  'top.wallet' : '錢包',
  'top.log'    : '勝負紀錄',
  'ph.art'     : '佔位美術',

  /* ===== 主畫面（H02）：地圖、落點、喊話 ===== */
  'bet.stake'  : '單注',
  'map.disc'   : '💬 對手喊話，不一定是真的',
  'map.land'   : '🛬 落地結果',
  'pt.name'    : '{n}點',
  'zone.info'  : '📦 {n} 箱 · 獨佔率 {p}%',
  'bot.0'      : '野狼',
  'bot.1'      : '狐狸',
  'bot.2'      : '阿熊',
  'shout.0.0'  : '綠點穩穩拿',
  'shout.0.1'  : '先拿個保底',
  'shout.0.2'  : '綠點沒人搶吧',
  'shout.1.0'  : '這把跳藍',
  'shout.1.1'  : '藍點最划算',
  'shout.1.2'  : '藍點我先佔',
  'shout.2.0'  : '紫點我的',
  'shout.2.1'  : '紫點走起',
  'shout.2.2'  : '賭一把紫點',
  'shout.3.0'  : '金點衝啊',
  'shout.3.1'  : '金點我來了',
  'shout.3.2'  : '金點拚一把',
  'rej.insufficient' : '餘額不足',
  'rej.busy'   : '演出中，請稍等',

  /* ===== 封盤倒數 ===== */
  'lock.title'  : '封盤倒數',
  'lock.sub'    : '{n} 秒後鎖定，鎖定後不能改',
  'lock.hidden' : '🔒 喊話已隱藏',
  'lock.tip'    : '點別的落點可改跳',
  'lock.tip2'   : '或按「立即跳傘」',
  'lock.me'     : '你已選這裡',
  'lock.picked' : '已選 {pt} · 下注',
  'lock.go'     : '立即跳傘',
  'lock.go2'    : '不用等倒數',
  'lock.flying' : '跳傘中…',
  'lock.flying2': '看誰獨自落地',

  /* ===== 落地揭曉（各落點就地） ===== */
  'who.you'     : '你',
  'who.solo'    : '{n} 獨佔',
  'who.soloYou' : '你 獨佔 ✓',
  'who.clash'   : '{n} 撞車',
  'who.none'    : '沒人落這裡',
  'who.join'    : '＋',

  /* ===== 結果彈窗 ===== */
  'pop.win'     : '🎉 獨佔成功',
  'pop.big'     : '🏆 大獎！',
  'pop.crash'   : '💥 撞車！',
  'pop.with'    : '跟 {who} 撞在{pt}',
  'pop.miss'    : '錯過：{box}',
  'pop.formula' : '{pt} <b>{odds}x</b> × {box} <b>{bm}</b>',
  'pop.pay'     : '下注 <b>{stake}</b> → 拿回 <b>{back}</b>',
  'pop.hint'    : '點任一處收起，再點落點開下一局',

  /* ===== 近況（H04 填內容；H02 只建字串鍵與掛點 #recent） ===== */
  'recent.title'  : '近況 · 每局最高獨佔落點',
  'recent.legend' : '灰＝全部撞車　右邊是最新',

  /* ===== 新手引導（常駐提示＋首次多步） ===== */
  'hint.title'  : '點落點就跳傘',
  'hint.short'  : '只有你一個人落在那裡才拿得到',
  'hint.more'   : '說明',
  'hint.detail' : '選一個落點跳傘，只有你一個人落在那裡才拿得到物資；跟別人撞在同一點就什麼都沒有。顏色越高賠越多，但對手也越愛去。',
  'tut.step'    : '{n}/{total}',
  'tut.s1.title': '選一個落點跳傘',
  'tut.s1.body' : '只有你一個人落在那裡才拿得到物資；跟別人撞在同一點就什麼都沒有。',
  'tut.s2.title': '顏色越高賠越多',
  'tut.s2.body' : '但對手也越愛去，越容易撞在一起。',
  'tut.s3.title': '獨佔之後會開箱',
  'tut.s3.body' : '運氣好開到稀有箱，拿回的錢會再往上加。',
  'tut.replay'  : '重看教學',
  'tut.replayed': '教學從第一步重播',
  'tut.blocked' : '自動下注進行中，教學稍後再看',

  /* ===== 自動下注 ===== */
  'auto.btn'     : '自動下注',
  'auto.entry'   : '自動',
  'auto.entryOn' : '進行中',
  'auto.manualBlock': '自動下注進行中，請先按「停止」',
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
  /* 詳細頁列名（LogUI 的列名不跳脫 HTML：落點列的小圓點色用 .ptd.pd0～pd3，色值＝base.css 的 --rc0～--rc3） */
  'log.row.pick.0': '<i class="ptd pd0"></i>落點',
  'log.row.pick.1': '<i class="ptd pd1"></i>落點',
  'log.row.pick.2': '<i class="ptd pd2"></i>落點',
  'log.row.pick.3': '<i class="ptd pd3"></i>落點',
  'log.row.board': '本局賠率',
  'log.row.bots' : '對手落點',
  'log.row.hit'  : '結果',
  'log.row.mates': '撞車對象',
  'log.row.box'  : '箱子',
  'log.row.boxMiss': '錯過的箱子',
  'log.row.result': '結果倍率',
  'log.row.stake': '下注',
  'log.row.pay'  : '拿回',
  'log.row.net'  : '淨額',
  'log.hit'      : '獨佔',
  'log.miss'     : '撞車',
  /* 詳細頁圖解（R2-1）：小地圖＋結論行；落點上的人／獨佔／撞車字樣沿用主畫面的 who.* */
  'log.fig.me'   : '你選這裡',
  'log.fig.alt'  : '本局落點圖解',
  'log.fig.solo' : '獨佔 · {box} ×{m} · {x}x',
  'log.fig.miss' : '跟 {who} 撞車 · 錯過 {box} ×{m}',

  /* ===== 導演台（?dev=1） ===== */
  'dev.title'    : '導演台',
  'dev.res'      : '結果',
  'dev.res.rand' : '照機率',
  'dev.res.solo' : '強制獨佔',
  'dev.res.clash': '強制撞車',
  'dev.box'      : '箱子',
  'dev.box.rand' : '照機率',
  'dev.big'      : '🏆 大獎',
  'dev.big.tip'  : '一鍵：金點獨佔＋傳說箱，立刻開一局看爆金幣',
  'dev.coins'    : '爆金幣',
  'dev.on'       : '開',
  'dev.off'      : '關',
  'dev.reset'    : '重置錢包',
  'dev.add'      : '＋1,000',
  'dev.busy'     : '演出中，等這局收起再按'
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
