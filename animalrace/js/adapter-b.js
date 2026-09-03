/* ============================================================
 * adapter-b.js ── MockServerB → RoundEngine provider 轉接層【B05 前置】
 *
 * 裁決依據（TASKS-B 2026-09-02）：
 *   1. 局號以引擎牆鐘推導為準；MockServerB 內部序號（S.seq）降為
 *      一致性檢查──本層把封包 round_no 改寫成引擎局號，並驗證
 *      內部序號每次 +1，不符即 console.warn。
 *   2. MC 100 萬次使 newRound 約 0.65s：下一輪生成移到 RACING 段
 *      預跑（generateOutcome 後 setTimeout 排程），結算段直接取快取。
 *   3. 錢包/注單記帳「擇一」：取引擎＋localStorage 轉接器。
 *      取捨：引擎已有錢包持久化、同局重整注單保留、離線回補結算；
 *      MockServerB 錢包無持久化。故本層【不呼叫 placeBets】、
 *      settle 由本層以純函數實作（依 round 封包賠率判定），
 *      MockServerB 的 balance/bets/idempotency 閒置不用──單一帳本，
 *      不會重複記帳。
 *
 * 決定性（同一局所有裝置、重整前後同一賽果）的達成方式：
 *   MockServerB 內部 `rng = Math.random` 於載入時捕捉、無注入口，
 *   而 B03 檔案已凍結。本層因此【必須先於 mock-server-b.js 載入】，
 *   在頂層把 Math.random 換成可切換的調度器；呼叫 MockServerB 的
 *   生命週期方法時，臨時掛上「以引擎局號為種子」的 mulberry32
 *   （與 round-engine 同款、同流名派生），呼叫結束即還原。
 *   - "round" 流：newRound（賽段/屬性/心情/兩次 MC 賠率）
 *   - "outcome" 流：lockRound（賽果抽定）──與 MC 消耗量無關，
 *     所以歷史回補用低 MC、當局用全量 MC，賽果仍逐 bit 一致。
 *
 * 回補效能：非當局（round_no < 牆鐘當前局）的 newRound 以
 * _setMcRuns(2000) 低量跑（歷史局的賠率無人下注、僅需賽果與
 * 統計流），當局／下一局才用全量 MC_RUNS。
 *
 * stats20 決定性：首次被要求生成局 n 前，先靜默重放 n−20…n−1
 * （低 MC），使 MockServerB 內部 results 流補滿 20 局──任何裝置
 * 任何時刻開機，同一局的「近 20 局」統計必然相同。
 *
 * 載入順序：tables-b → 【adapter-b】 → mock-server-b → round-engine
 * → game（game.js 於 RoundEngine.start() 前呼叫 AdapterB.install()，
 * 把 generateRound/generateOutcome/settle 掛上全域 MockServerB，
 * 引擎偵測到即棄用內建 STUB）。
 * ============================================================ */

var AdapterB = (function () {
  "use strict";

  /* ── Math.random 調度器（頂層立即安裝：必須先於 mock-server-b.js 捕捉）── */
  var nativeRandom = Math.random;
  var rngOverride = null;
  Math.random = function () { return rngOverride ? rngOverride() : nativeRandom.call(Math); };

  function withRng(rng, fn) {
    rngOverride = rng;
    try { return fn(); } finally { rngOverride = null; }
  }

  /* ── 與 round-engine.js 完全同款的局號種子 RNG 派生（常數不可漂移）── */
  var EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);   // 引擎同一錨點
  var CYCLE = 40000;      // R2：25s 下注＋2s 封盤＋10s 演出＋3s 結算（與 round-engine PHASES 同步）
  var BET_WINDOW = 25000;

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* 引擎的 generateRound/generateOutcome 也會傳入 rng 參數，但預跑
   * 時拿不到引擎的實例；本層一律自行以同式派生（同種子＝同序列），
   * 保證「預跑」與「現場生成」逐 bit 一致，引擎傳入的 rng 不消耗。 */
  function rngFor(round_no, stream) {
    return mulberry32((Math.imul(round_no, 2654435761) ^ strHash(stream)) >>> 0);
  }

  function liveRoundNo() { return Math.floor((Date.now() - EPOCH) / CYCLE) + 1; }

  /* ── 設定 ── */
  var LOW_MC = 2000;        // 歷史回補用（賠率無人下注，只求賽果與統計流）
  var WARMUP = 20;          // stats20 視窗：首局前先重放的局數
  var PREGEN_DELAY = 2500;  // 封盤(25s)後 2.5s ＝ 演出段開頭，預跑下一局
  var CACHE_MAX = 60;

  /* ── 快取（round_no → 封包／賽果）── */
  var roundCache = {}, roundKeys = [];
  var outcomeCache = {}, outcomeKeys = [];
  function cachePut(map, keys, n, v) {
    if (!(n in map)) { keys.push(n); }
    map[n] = v;
    while (keys.length > CACHE_MAX) delete map[keys.shift()];
  }

  var lastEngineRound = 0;   // 最近一次 newRound 對應的引擎局號
  var lastInternalSeq = 0;   // 一致性檢查：MockServerB 內部序號應每次 +1
  var warmedUp = false;
  var pregenTimer = null;

  /* ── B07 Worker 化：全量 MC 預跑移出主執行緒（收掉 B05/B06 遺留）──
   * mock-server-b 為凍結檔但零 DOM 可移植：js/mc-worker.js 內以同款
   * Math.random 調度器＋importScripts 原封載入。主執行緒把當下狀態
   * _dump 寄去，Worker 以同一「局號種子 round 流」跑 newRound（全量
   * MC），回傳封包＋新狀態 _load 回寫——同狀態＋同種子＋同程式，與
   * 主執行緒自跑逐 bit 一致，決定性不破。
   * mutSeq 防競態：寄出後主執行緒若又動過 MockServerB（醒來回補、
   * 同步後備先跑完等），回包 tag 不符即整包丟棄，走原同步路徑。
   * Worker 不可用（file:// 等）時自動回退原 setTimeout 主執行緒預跑。 */
  var mcWorker = null, workerReady = false, workerBusy = false, mutSeq = 0;

  function initWorker() {
    if (mcWorker !== null || typeof Worker === "undefined") return;
    try { mcWorker = new Worker("js/mc-worker.js"); }
    catch (e) { mcWorker = false; return; }
    mcWorker.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === "ready") { workerReady = true; return; }
      workerBusy = false;
      if (m.type === "pregen_fail") {
        console.warn("[adapter-b] Worker 預跑失敗，回退主執行緒：" + m.message);
        return;
      }
      if (m.type !== "pregen_done") return;
      if (m.tag !== mutSeq || roundCache[m.n]) return;   // 已過期／主執行緒已自跑
      MockServerB._load(m.dump);
      lastInternalSeq = m.packet.round_no;
      lastEngineRound = m.n;
      m.packet.round_no = m.n;                           // 局號改寫規則同 ensureRound
      m.packet.betting_ends_at = EPOCH + (m.n - 1) * CYCLE + BET_WINDOW;
      cachePut(roundCache, roundKeys, m.n, m.packet);
    };
    mcWorker.onerror = function (e) {
      console.warn("[adapter-b] Worker 異常，改回主執行緒預跑：" + (e.message || e));
      try { mcWorker.terminate(); } catch (e2) {}
      mcWorker = false; workerReady = false; workerBusy = false;
    };
  }

  /* ── B06 最小擴充：賽果紀錄流（路子/詳情彈窗資料來源）──
   * 每局於賽果抽定（ensureOutcome）當下落一筆精簡紀錄：純資料、
   * 不含任何路子邏輯（投影/冷熱歸 roads.js）。歷史局由
   * backfillRoadRecords 依局號【升冪】決定性重放補齊（低 MC），
   * 升冪＝維持 MockServerB 內部 results 流的時序，stats20 不受擾。
   * 注意：重放局的賠率以 LOW_MC 重估，與現場全量 MC 有 ±數 % 取樣
   * 噪音（賽果向量不受影響——outcome 流與 MC 消耗量無關）。 */
  var ROADREC_MAX = 420;                 // 當靴 200 局＋跨靴餘裕
  var roadRecs = {}, roadRecKeys = [];
  function captureRoadRec(n, packet, oc) {
    if (roadRecs[n]) return;
    roadRecs[n] = {
      n: n,
      seg: { grass: packet.segments.grass, mud: packet.segments.mud, water: packet.segments.water },
      an: packet.animals.map(function (a) {
        return { m: a.mood, d: a.mood_delta, ow: a.odds.win, oo: a.odds.out,
                 b: a.attrs.burst, t: a.attrs.terrain, f: a.attrs.focus };
      }),
      no: packet.odds_no_out,
      ranking: oc.ranking.slice(), out: oc.out.slice(), out_at: oc.out_at.slice()
    };
    roadRecKeys.push(n);
    while (roadRecKeys.length > ROADREC_MAX) delete roadRecs[roadRecKeys.shift()];
  }

  /* 把 MockServerB 卡在 betting/locked 的內部輪強制走完（安全網：
   * 例如預跑了 n+1 但引擎醒來直接要 n+2）。賽果仍用該局的
   * "outcome" 流抽定並入快取──即使走安全網，決定性不破。 */
  function forceComplete() {
    var r = MockServerB.getRound();
    if (!r || r.state === "settled") return;
    if (r.state === "betting") {
      withRng(rngFor(lastEngineRound, "outcome"), function () { MockServerB.lockRound(); });
    }
    var oc = MockServerB.settleRound();
    var shaped = shapeOutcome(lastEngineRound, oc);
    cachePut(outcomeCache, outcomeKeys, lastEngineRound, shaped);
    captureRoadRec(lastEngineRound, r, shaped);   // B10-R2：安全網局也落紀錄（珠盤空格根因①）
  }

  function shapeOutcome(n, oc) {
    return { round_no: n, ranking: oc.ranking, out: oc.out, out_at: oc.out_at,
             payouts: [], total_payout: 0 };  // 玩家注單由本層 settle() 純函數判定
  }

  /* 生成（或取快取）局 n 的 round 封包：newRound 走 "round" 流 */
  function ensureRound(n) {
    if (roundCache[n]) return roundCache[n];

    if (!warmedUp) {          // 首局前靜默重放 20 局，補滿 stats20 統計流
      warmedUp = true;
      for (var w = Math.max(1, n - WARMUP); w < n; w++) { ensureRound(w); ensureOutcome(w); }
    }

    mutSeq++;                 // 主執行緒即將變異 MockServerB：作廢在途 Worker 回包
    forceComplete();
    MockServerB._setMcRuns(n < liveRoundNo() ? LOW_MC : TablesB.MC_RUNS);
    withRng(rngFor(n, "round"), function () { MockServerB.newRound(); });

    var raw = MockServerB.getRound();
    if (lastInternalSeq && raw.round_no !== lastInternalSeq + 1)
      console.warn("[adapter-b] 一致性檢查失敗：內部序號 " + raw.round_no +
                   "（預期 " + (lastInternalSeq + 1) + "）");
    lastInternalSeq = raw.round_no;
    lastEngineRound = n;

    raw.round_no = n;                                    // 局號以牆鐘推導為準（裁決①）
    raw.betting_ends_at = EPOCH + (n - 1) * CYCLE + BET_WINDOW;
    cachePut(roundCache, roundKeys, n, raw);
    return raw;
  }

  /* 抽定（或取快取）局 n 的賽果：lockRound 走 "outcome" 流，隨即
   * settleRound 讓內部生命週期歸位並落 results 流（stats20 來源）。
   * MockServerB 內部無注單（本層不呼叫 placeBets），settleRound
   * 派彩恆為 0，不會動到任何錢包。 */
  function ensureOutcome(n) {
    if (outcomeCache[n]) {
      // B10-R2：快取命中但紀錄缺（走過安全網或紀錄被裁剪）→ 補 capture，
      // 使 backfillRoadRecords 對這類局也能補齊（珠盤空格根因②）
      if (!roadRecs[n]) captureRoadRec(n, ensureRound(n), outcomeCache[n]);
      return outcomeCache[n];
    }
    var packet = ensureRound(n);
    mutSeq++;                 // lock/settle 亦屬變異：作廢在途 Worker 回包
    withRng(rngFor(n, "outcome"), function () { MockServerB.lockRound(); });
    var oc = MockServerB.settleRound();
    var shaped = shapeOutcome(n, oc);
    cachePut(outcomeCache, outcomeKeys, n, shaped);
    captureRoadRec(n, packet, shaped);       // B06 賽果紀錄流
    return shaped;
  }

  /* ── 引擎 provider 介面（§10.4 純函數形狀）── */

  function generateRound(round_no /*, rng, history ─ 不使用，見 rngFor 註 */) {
    return ensureRound(round_no);
  }

  function generateOutcome(round /*, rng */) {
    var n = round.round_no;
    var oc = ensureOutcome(n);

    // 裁決②＋B07 Worker 化：當局封盤後即把下一局（全量 MC ~0.65s）
    // 丟給 Worker 預跑（主執行緒零阻塞，演出段不掉幀）；Worker 不可用
    // 或忙碌時回退原 setTimeout 主執行緒預跑。引擎於結算段呼叫
    // generateRound(n+1) 時直接取快取。
    if (n + 1 > liveRoundNo() && !roundCache[n + 1]) {
      if (mcWorker && workerReady && !workerBusy) {
        workerBusy = true;
        mcWorker.postMessage({ type: "pregen", n: n + 1, tag: mutSeq,
                               mcRuns: TablesB.MC_RUNS, dump: MockServerB._dump() });
      } else {
        clearTimeout(pregenTimer);
        pregenTimer = setTimeout(function () {
          try { ensureRound(n + 1); } catch (e) { console.warn("[adapter-b] 預跑失敗", e); }
        }, PREGEN_DELAY);
      }
    }
    return oc;
  }

  /* ── B10 特殊注別（大小/奇偶/熱門度）：定價與結算純函數 ──
   * 裁決 1-a（TASKS-B 2026-09-03）：機率＝roads.js 既有 2⁸ 解析勝率
   * 分組加總——與冷熱頁/卡片徽章同一管道（TablesB 折算心情後的
   * weight/pOut 餵 Roads.winProbs/favOrder），零 MC 零隨機、
   * 跨裝置決定性天生成立；賠率＝0.95/P 向下取兩位（向莊家有利），
   * 每局隨屬性/心情自然浮動。零出包不在此列（沿用封包 odds_no_out）。
   * RTP 未經 MC 複驗一事記規格 §12（正式版補驗）。 */
  var SP_RTP = 0.95;
  var SP_TYPES = { big: 1, small: 1, odd: 1, even: 1, hot: 1, cold: 1, longshot: 1 };
  var spCache = { n: 0 };
  function specialInfo(round) {
    if (spCache.n === round.round_no) return spCache;
    var w = [], p = [];
    round.animals.forEach(function (a) {
      var e = { burst: a.attrs.burst, terrain: a.attrs.terrain, focus: a.attrs.focus };
      if (a.mood) e[TablesB.MOODS[a.mood].attr] += a.mood_delta;
      w.push(TablesB.weight(e, round.segments));
      p.push(TablesB.pOut(e.focus));
    });
    var probs = Roads.winProbs(w, p);
    var order = Roads.favOrder(w, p);        // 熱→冷（與冷熱頁判定同源）
    var hotIds = order.slice(0, TablesB.ROAD_HOT.FAV_TOP);
    var longIds = order.slice(8 - TablesB.ROAD_HOT.LONG_BOTTOM);
    var coldIds = order.slice(TablesB.ROAD_HOT.FAV_TOP, 8 - TablesB.ROAD_HOT.LONG_BOTTOM);
    function pSum(ids) { var s = 0; ids.forEach(function (id) { s += probs[id - 1]; }); return s; }
    var prob = { big: pSum([5, 6, 7, 8]), small: pSum([1, 2, 3, 4]),
                 odd: pSum([1, 3, 5, 7]), even: pSum([2, 4, 6, 8]),
                 hot: pSum(hotIds), cold: pSum(coldIds), longshot: pSum(longIds) };
    var odds = {};
    Object.keys(prob).forEach(function (k) {
      odds[k] = Math.floor(SP_RTP / prob[k] * 100) / 100;   // 向下取兩位（§6.2 取整向莊家）
    });
    spCache = { n: round.round_no, prob: prob, odds: odds,
                hotIds: hotIds, coldIds: coldIds, longIds: longIds, order: order };
    return spCache;
  }
  /* 結算判定：只看「冠軍編號屬哪組」（三分互斥由 favOrder 切片保證） */
  function specialHit(type, champ, sp) {
    if (type === "big") return champ >= 5;
    if (type === "small") return champ <= 4;
    if (type === "odd") return champ % 2 === 1;
    if (type === "even") return champ % 2 === 0;
    if (type === "hot") return sp.hotIds.indexOf(champ) !== -1;
    if (type === "cold") return sp.coldIds.indexOf(champ) !== -1;
    return sp.longIds.indexOf(champ) !== -1;   // longshot
  }

  /* 結算：純函數，依 round 封包賠率判定（裁決③：單一帳本在引擎側）。
   * 全滅局照 §5.3：冠軍/前二連按 out_at 倒序名次判定（ranking 已含）、
   * 出包注全中、零出包注全輸──ranking/out 向量天然涵蓋，無特例。 */
  function settle(bets, round, outcome) {
    var noOut = true, i;
    for (i = 0; i < outcome.out.length; i++) if (outcome.out[i]) { noOut = false; break; }
    var top2key = TablesB.exactaKey(outcome.ranking[0], outcome.ranking[1]);

    var payouts = [], total = 0;
    for (i = 0; i < bets.length; i++) {
      var bet = bets[i], hit = false, odds = 0;
      if (bet.type === "win") {
        hit = outcome.ranking[0] === bet.target;
        odds = round.animals[bet.target - 1].odds.win;
      } else if (bet.type === "exacta") {
        var p = String(bet.target).split("-");
        hit = TablesB.exactaKey(+p[0], +p[1]) === top2key;
        odds = round.odds_exacta[TablesB.exactaKey(+p[0], +p[1])];
      } else if (bet.type === "out") {
        hit = outcome.out[bet.target - 1];
        odds = round.animals[bet.target - 1].odds.out;
      } else if (SP_TYPES[bet.type]) {   // B10 特殊注別：判冠軍屬組＋公式賠率
        var sp = specialInfo(round);
        hit = specialHit(bet.type, outcome.ranking[0], sp);
        odds = sp.odds[bet.type];
      } else {  // no_out
        hit = noOut;
        odds = round.odds_no_out;
      }
      var pay = (hit && odds) ? Math.floor(bet.amount * odds) : 0;  // 取整向莊家
      total += pay;
      payouts.push({ bet_index: i, hit: hit, payout: pay });
    }
    return { payouts: payouts, total_payout: total };
  }

  return {
    /** game.js 於 RoundEngine.start() 前呼叫：把 provider 介面掛上
     *  全域 MockServerB，引擎偵測到即自動棄用內建 STUB。 */
    install: function () {
      if (typeof MockServerB === "undefined") throw new Error("adapter-b：MockServerB 未載入");
      initWorker();                          // B07：MC 預跑 Worker（失敗自動回退）
      MockServerB.generateRound = generateRound;
      MockServerB.generateOutcome = generateOutcome;
      MockServerB.settle = settle;
      var origPing = MockServerB.ping;
      MockServerB.ping = function () { return "adapter-b ⇄ " + origPing(); };
      return true;
    },

    /* ── B06 最小擴充 API：賽果紀錄流 ── */
    /** 取局 n 的精簡賽果紀錄（僅回快取，不觸發重放） */
    getRoadRecord: function (n) { return roadRecs[n] || null; },
    /** 依局號升冪決定性重放 [from, to]，補齊紀錄；回傳重放局數。
     *  須於引擎 start() 前呼叫（或確保無並行生成），保 results 流時序。 */
    backfillRoadRecords: function (from, to) {
      var c = 0;
      for (var n = Math.max(1, from); n <= to; n++) {
        if (!roadRecs[n]) { ensureOutcome(n); c++; }
      }
      return c;
    },
    /** 牆鐘當前局號（與引擎同式推導） */
    liveRoundNo: liveRoundNo,

    /** B10：特殊注別定價資訊（odds/prob/熱門度分組；round 封包純函數） */
    specialInfo: specialInfo,

    ping: function () { return "adapter-b.js OK"; }
  };
})();
