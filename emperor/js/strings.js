/* =========================================================================
 * 專案E「皇帝牌」E09——字串字典＋取字函式 t()（多語預留層）
 *
 * 設計約定（轉引擎時這層是唯一要搬的文案資產）：
 *  - 所有面向玩家的字串集中在 window.STR[lang]，key 用「區塊.用途」點式命名
 *  - UI 一律 t('key', vars) 取字，禁止在版面檔寫死中文
 *  - 骨架（index.html）的固定字掛 data-t="key"，本檔載入時一次填好（applyStatic）
 *  - 語言選取順序：?lang=xx 網址參數 → localStorage『ecard.lang』→ 預設 zh-TW
 *  - 偽語系 ?lang=xx：不是真語言，是「把每字串加長 30%」的版面壓力測試
 *    （做新字串時務必跑一次：按鈕／標籤／泡泡都不能溢出或撐破版）
 *  - 白話紀律：句子裡一律用「皇帝／奴隸／平民」全稱；單字「帝／奴／民」只用於
 *    卡面角落徽記與剋制環節點（走 glyph.* 三個 key，未來換語言一起換）
 *
 * 本檔零依賴、無框架，必須是第一支載入的 script（其餘 UI 檔取字時字典要先在）。
 * ========================================================================= */
(function(){
'use strict';

/* ---------- 字典：現階段只有 zh-TW；加語言就整包複製一份改 key 值 ---------- */
var ZH = {

  /* ===== 共用詞彙 ===== */
  'glyph.emp'     : '帝',              // 卡面角落徽記／剋制環節點專用單字
  'glyph.slv'     : '奴',
  'glyph.cit'     : '民',
  'name.emp'      : '皇帝',
  'name.slv'      : '奴隸',
  'name.cit'      : '平民',
  'side.emp'      : '皇帝側',
  'side.slv'      : '奴隸側',
  'mode.normal'   : '普通',
  'mode.adv'      : '進階',
  'btn.next'      : '下一步',
  'btn.done'      : '開始玩',
  'btn.skip'      : '跳過',
  'btn.close'     : '收合',
  'btn.back'      : '‹ 返回',
  'btn.cancel'    : '取消',

  /* ===== 決勝理由（核心回傳 code 查這裡；core 的 reason 原字串保留不顯示） ===== */
  'verdict.slv_emp' : '奴隸獲勝',
  'verdict.emp_cit' : '皇帝獲勝',
  'verdict.cit_slv' : '平民獲勝',
  'verdict.win'     : '（你押的）獲勝',
  'verdict.lose'    : '落敗',

  /* ===== 剋制環常駐 ===== */
  'ring.title'    : '押誰會贏？',
  'ring.short'    : '皇帝 > 平民 > 奴隸 > 皇帝',
  'ring.detail'   : '只有奴隸能贏皇帝，所以賠率高。',
  'ring.more'     : '看說明',
  'ring.aria'     : '相剋關係：皇帝勝過平民，平民勝過奴隸，奴隸勝過皇帝',

  /* ===== 首次四步引導（R2：第 2 步為相剋演示） ===== */
  'tut.step'      : '第 {n} 步／共 {total} 步',
  'tut.s1.title'  : '選一邊下注',
  'tut.s1.body'   : '挑皇帝側或奴隸側，再挑押多少，按「確認下注」開局。押皇帝常贏、賠得少；押奴隸少贏、賠得多。',
  'tut.s2.title'  : '相剋演示',
  'tut.s2.body'   : '看一次就懂：皇帝吃平民、平民吃奴隸、奴隸吃皇帝。',
  'tut.s2.odds'   : '皇帝勝率 {pe}%・賠 {oe}x　　奴隸勝率 {ps}%・賠 {os}x',
  'tut.s2.note'   : '只有奴隸能贏皇帝，所以賠率約 {ratio} 倍',
  'tut.s3.title'  : '看兩邊出牌對決',
  'tut.s3.body'   : '兩邊各五張牌輪流出。平民碰平民繼續；一碰上相剋，那一回合就定輸贏。',
  'tut.s4.title'  : '贏了就選：收手，還是續戰爬階',
  'tut.s4.body'   : '贏一局爬一階，倍率越爬越高。隨時可以收手把錢拿走；再賭輸了就全部歸零。這條進度條會告訴你爬到第幾階。',
  'tut.replay'    : '重看教學',
  'tut.replayed'  : '教學從第一步重播',
  'tut.blocked'   : '自動下注進行中，教學稍後再看',

  /* ===== 頂欄／骨架 ===== */
  'top.log'       : '勝負紀錄',
  'top.streak'    : '連勝 {n}',
  'top.streakHTML': '連勝 <b>{n}</b>',
  'dev.script'    : '劇本',
  'dev.rand'      : '照真實機率抽',
  'dev.win'       : '強制本階勝',
  'dev.lose'      : '強制本階敗',
  'dev.reset'     : '重置錢包',

  /* ===== 下注面板 ===== */
  'bet.odds'      : '{odds}x・勝率 {pct}%',
  'bet.stake'     : '押額',
  'bet.go'        : '確認下注',
  'bet.hint'      : '顯示賠率為保守下限（結算全精度）',
  'lock.title'    : '— 對局進行中 —',
  'lock.sub'      : '押 {side}・{stake}',

  /* ===== 階梯決策面板 ===== */
  'ladder.title'  : '第 {n} 階達成',
  'ladder.m'      : '{m}x　→　可收 {cash}',
  'ladder.emp'    : '續戰・皇帝側',
  'ladder.slv'    : '續戰・奴隸側',
  'ladder.cash'   : '收手',
  'ladder.next'   : '{x}x',
  'ladder.note'   : '滿貫線 {line}x・玩到頂（越線／連十勝）享頂端加成・逾時視同收手',
  'ladder.toSlam' : '→ 滿貫！',
  'ladder.toFull' : '→ 連十勝',

  /* ===== 階梯進度條 ===== */
  'rail.idle'     : '還沒開始爬',
  'rail.top'      : '滿貫 {line}x',
  'rail.topNone'  : '滿貫 —',
  'rail.cur'      : '{m}x・{n}階{word}',
  'rail.slam'     : '滿貫',
  'rail.full'     : '連十勝',
  'rail.climbing' : '挑戰中',
  'rail.reached'  : '達成',
  'rail.waiting'  : '待命',                 // R2 補裁決：進階機位沿用舊字（普通機位的 rail.idle 維持新字）
  'rail.rung'     : '{n}階',
  'rail.dash'     : '—',

  /* ===== 戰報帶 ===== */
  'banner.open'   : '選邊下注開局',
  'banner.normal' : '觀賽視角——選邊下注開局',
  'banner.adv'    : '第一人稱——選邊下注開局',
  'banner.trick'  : '第 {n} 回合',
  'banner.seal'   : '封盤・勝負已定（{side}・第 {n} 階）',
  'banner.verdict': '{reason}　{side}{res}',
  'banner.ladder' : '第 {n} 階達成——收手或者再賭一局',
  'banner.timeout': '逾時未選——自動收手',
  'banner.cash'   : '收手 +{n}。選邊下注開局',
  'banner.cashTo' : '逾時自動收手 +{n}。選邊下注開局',
  'banner.bust'   : '階梯重置，−{n}。',
  'banner.bustAgn': '再接再厲——選邊下注開局',
  'banner.reset'  : '已重置。選邊下注開局',
  'banner.slamIn' : '越過滿貫線 {line}x——滿貫入袋',
  'banner.fullIn' : '達 {max} 階上限——連十勝入袋',

  /* ===== 滿貫／完賭大演出 ===== */
  'grand.slam'    : '滿貫達成！',
  'grand.full'    : '連十勝！',
  'grand.slamSub' : '越過滿貫線 {line}x——系統代收，額外加成',
  'grand.fullSub' : '達 {max} 階上限——系統代收，額外加成',
  'grand.m'       : '收手值',
  'grand.boost'   : '＋頂端加成',
  'grand.final'   : '實付倍率',
  'grand.pay'     : '+{n} 自動入袋',

  /* ===== 進階機位 ===== */
  'adv.you'       : '你',
  'adv.oppTag'    : '對手・{tag}',
  'adv.turn'      : '第 {t} 回合・輪你出牌',
  'adv.turnSub'   : '{side}・押 {stake}',
  'adv.turnNote1' : '點下方手牌出牌；倒數歸零自動隨機出一張——出牌順序不影響勝率（1/5 定理）',
  'adv.turnNote2' : '第 {n} 階・累積 {m}x・滿貫線 {line}x',
  'adv.hint'      : '選一張牌打出',
  'adv.banTrick'  : '第 {t} 回合——點你的手牌出牌',
  'adv.banTimeout': '逾時——自動隨機出牌（第 {t} 回合）',
  'adv.declare'   : '這回合我出「{ch}」。',
  'adv.stillGo'   : '……還要繼續？',
  'adv.vTop'      : '滿貫<br>{line}x',
  'adv.vTopNone'  : '滿貫<br>—',

  /* 對手表情標籤（保留角色味，白話不文言） */
  'tag.idle'      : '從容',
  'tag.think'     : '審視',
  'tag.smirk'     : '嗤笑',
  'tag.sweat'     : '強裝鎮定',
  'tag.proud'     : '得意',
  'tag.shock'     : '破防',

  /* ===== 自動下注 ===== */
  'auto.title'    : '自動下注設定',
  'auto.btn'      : '自動下注',
  'auto.advOnly'  : '進階模式需親手出牌',
  'auto.advToast' : '進階模式需親手出牌，自動下注僅限普通模式',
  'auto.idle'     : '⟳ 自動下注待命',
  'auto.running'  : '⟳ 自動下注中　<span>第 {n}/{total} 局・累計 {pnl}{tail}</span>',
  'auto.stopping' : '・停止中…',
  'auto.stop'     : '■ 停止',
  'auto.side'     : '押邊',
  'auto.alt'      : '每局交替',
  'auto.climb'    : '自動爬階',
  'auto.noClimb'  : '不爬',
  'auto.climbTo'  : '爬到第 X 階',
  'auto.climbN'   : '第 {n} 階',
  'auto.rounds'   : '局數',
  'auto.tp'       : '停利',
  'auto.sl'       : '停損',
  'auto.off'      : '不設',
  'auto.note'     : '「不爬」＝每局單注贏了就收；爬階續戰一律押同一邊、到第 X 階收手；越過滿貫線 {line}x 或連十勝照常由系統代收（有額外加成）。停利／停損以每次入袋時的累計損益判定。RTP 明碼兩檔：提早收手 {rtpc}／玩到頂 {rtpt}。',
  'auto.go'       : '開始自動下注',
  'auto.end'      : '自動下注結束：{reason}　{n} 局・累計 {pnl}',
  'auto.endStop'  : '已手動停止',
  'auto.endTp'    : '達停利 +{n}',
  'auto.endSl'    : '達停損 −{n}',
  'auto.endDone'  : '跑滿 {n} 局',
  'auto.endFail'  : '下注失敗',
  'auto.endMode'  : '切換至進階模式',
  'auto.endReset' : '錢包重置',
  'auto.busy'     : '對局進行中，請稍候',
  'auto.noMoney'  : '餘額不足（{have} < {need}），無法開始',
  'auto.noMoney2' : '餘額不足（{have} < {need}）',
  'auto.aborted'  : '重整後自動下注已中止（原第 {n}/{total} 局・累計 {pnl}）',

  /* ===== 勝負紀錄頁 ===== */
  'log.title'     : '勝負紀錄',
  'log.detail'    : '對局詳細',
  'log.count'     : '{n}／{cap} 筆',
  'log.reset'     : '重置錢包',
  'log.resetAsk'  : '確認重置？',
  'log.resetDone' : '錢包已重置為 {n}，紀錄已清空',
  'log.noReset'   : '對局中不可重置',
  'log.empty'     : '尚無紀錄——選邊下注開局後，每局結果會列在這裡',
  'log.noteOv'    : '',                  // R2 使用者裁決：總覽註解移除（ui-atmos 已不輸出該區塊）
  'log.noteDt'    : '累積倍率＝收手值 M＝0.93×Π(1/p)；爬到頂（滿貫／連十勝）另有額外加成。',
  'log.time'      : '時間',
  'log.mode'      : '模式',
  'log.modeAdv'   : '進階（親手出牌）',
  'log.modeNor'   : '普通（觀賽）',
  'log.stake'     : '押額',
  'log.path'      : '路徑',
  'log.rungs'     : '{n} 階',
  'log.result'    : '結果',
  'log.m'         : '收手值',
  'log.boost'     : '頂端加成',
  'log.boostVal'  : '×{x} → 實付 {pay}x',
  'log.pay'       : '實付',
  'log.payNone'   : '0（押額 {n} 沒收）',
  'log.byRung'    : '逐階',
  'log.rung'      : '第 {n} 階',
  'log.win'       : '勝',
  'log.lose'      : '敗',
  'log.viaTo'     : '（逾時自動）',
  'log.viaAuto'   : '（系統代收）',
  'log.tagAdv'    : '進',
  'log.tagNor'    : '普',
  'kind.cash'     : '收手',
  'kind.slam'     : '滿貫',
  'kind.full'     : '連十勝',
  'kind.bust'     : '',                  // R2 使用者裁決：敗局不寫結果詞，靠損益灰字表示

  /* ===== 其他提示 ===== */
  'toast.noSwitch': '對局中不可切換模式',
  'lang.name'     : '繁體中文'
};

/* 對手台詞池（同樣走字典；保留狡詐紳士的角色味，但不用文言） */
var ZH_LIST = {
  'line.idle'     : ['願賭服輸？來吧。'],
  'line.think'    : ['哦……？'],
  'line.smirk'    : ['就這種程度？'],
  'line.sweat'    : ['……有趣。'],
  'line.proud'    : ['勝負早就定了。'],
  'line.shock'    : ['不可能──！'],
  'pool.wait'     : ['哦……？', '還不出那張？', '拖得夠久了。', '只剩最後機會了。', '最後一張——來吧。'],
  'pool.selMin'   : ['就這種程度？', '保守啊。', '試探我？', '哼，出平民啊？'],
  'pool.selSp'    : ['……那張？', '哦？你敢。', '終於忍不住了？'],
  'pool.playMin'  : ['哼。', '無趣。', '慢慢來。'],
  'pool.playSp'   : ['來了。', '……好。'],
  'pool.tellWin'  : ['……不會吧。', '……有趣。'],
  'pool.tellLose' : ['就等你這張。', '太天真。'],
  'pool.tie'      : ['無趣。', '再來。', '……'],
  'pool.hurry'    : ['時間不多了。', '再拖就替你出了。'],
  'pool.declTrue' : ['說了吧？', '我從不說謊……這次。'],
  'pool.declLie'  : ['騙你的。', '你還真信？'],
  'pool.shock'    : ['不可能──！', '……運氣罷了。', '再、再來一次！'],
  'pool.slam'     : ['全部……全被你拿走了？！', '滿貫……？不可能──！'],
  'pool.full'     : ['十階……你居然走完了。', '……輸得徹底。'],
  'pool.proud'    : ['勝負早就定了。', '早說了。', '回去練練吧。'],
  /* 等待閒聊（表情＋台詞成對；表情代號不進字典，只有台詞要翻） */
  'pool.idleChat' : ['慢慢想，我不急。', '猶豫這麼久，手在抖？', '你那張特殊牌……藏得挺深。',
                     '……別一直盯著我。', '我猜你會出平民。', '願賭服輸，記得吧？',
                     '換我的話，早就出了。', '你的表情全寫在臉上。']
};

var DICT = { 'zh-TW': ZH };
var LIST = { 'zh-TW': ZH_LIST };
var FALLBACK = 'zh-TW';

/* ---------- 語言選取：?lang= → localStorage → 預設 ---------- */
var LS_KEY = 'ecard.lang';
function qs(name){
  var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}
function readStored(){
  try{ return localStorage.getItem(LS_KEY); }catch(e){ return null; }
}
var PSEUDO = 'xx';                                   // 偽語系代號（版面壓力測試用，不是真語言）
var lang = qs('lang') || readStored() || FALLBACK;
if(lang !== PSEUDO && !DICT[lang]) lang = FALLBACK;   // 未知語言退回預設

/* ---------- 偽語系：每字串加長 30%，用來抓「寫死寬度」的版面 ---------- */
var PAD = '長';
function pseudo(s){
  if(typeof s !== 'string' || !s) return s;
  var tag = /<[^>]+>/.test(s);                       // 含標記的字串：只在尾端補，不插進標籤裡
  var n = Math.max(1, Math.ceil(s.replace(/<[^>]+>/g, '').length * 0.3));
  var tail = '';
  while(tail.length < n) tail += PAD;
  tail = tail.slice(0, n);
  return tag ? s + tail : s + tail;
}

/* ---------- 取字：t('key', {vars})／tList('key') ---------- */
function raw(key){
  var d = DICT[lang] || DICT[FALLBACK];
  var s = d[key];
  if(s == null) s = DICT[FALLBACK][key];
  return s == null ? key : s;                        // 查不到就回 key 本身（開發時一眼看見缺字）
}
function fill(s, vars){
  return vars ? s.replace(/\{(\w+)\}/g, function(m, k){ return vars[k] == null ? m : vars[k]; }) : s;
}
function t(key, vars){
  var s = fill(raw(key), vars);
  if(lang === PSEUDO) s = pseudo(s);
  return s;
}
function tList(key){
  var l = (LIST[lang] || LIST[FALLBACK])[key] || LIST[FALLBACK][key] || [key];
  return lang === PSEUDO ? l.map(pseudo) : l.slice();
}
/* 單字徽記：核心用的 帝／奴／民 字元 → 字典裡的顯示字（未來中／英／越三語都走這裡） */
var CH_KEY = { '帝':'glyph.emp', '奴':'glyph.slv', '民':'glyph.cit' };
function tch(ch){ return CH_KEY[ch] ? t(CH_KEY[ch]) : ch; }

/* ---------- 骨架靜態字：掛 data-t="key" 的元素一次填好 ----------
 * data-t-attr="title" 可改填屬性；data-t-html="1" 走 innerHTML（字串含 <br> 時用） */
function applyStatic(root){
  var ns = (root || document).querySelectorAll('[data-t]');
  for(var i = 0; i < ns.length; i++){
    var n = ns[i], s = t(n.getAttribute('data-t'));
    var at = n.getAttribute('data-t-attr');
    if(at) n.setAttribute(at, s);
    else if(n.getAttribute('data-t-html')) n.innerHTML = s;
    else n.textContent = s;
  }
}

/* ---------- 對外 ---------- */
window.STR = DICT;
window.t = t;
window.tList = tList;
window.tch = tch;
window.I18N = {
  lang     : lang,
  isPseudo : lang === PSEUDO,
  fallback : FALLBACK,
  list     : function(){ return Object.keys(DICT); },
  applyStatic : applyStatic,
  /* 切語言：寫 localStorage 後重整（Demo 階段不做熱替換，避免已渲染的字沒跟著換） */
  set      : function(code){
    try{ localStorage.setItem(LS_KEY, code); }catch(e){}
    location.reload();
  },
  t : t, tList : tList, tch : tch
};

/* 本檔是第一支 script、掛在 </body> 前，骨架已解析完 → 當場同步填。
 * 不可改用 DOMContentLoaded：那會晚於其他 UI 檔的初始化，把它們算好的動態值（如「滿貫 120x」）蓋回預設字。 */
applyStatic();
})();
