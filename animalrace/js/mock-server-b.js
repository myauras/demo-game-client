/* ============================================================
 * mock-server-b.js ── 專案 B 後台契約的本地實作【可移植資產】
 * 對齊 B規格書 §5（賽果生成）/ §6（賠率）/ §10.4（契約形狀）。
 * 依賴：TablesB（tables-b.js）。禁止引用任何畫面相關程式。
 *
 * 核心鐵律：
 *   §5.2 賽果向量一次抽定──先依 p_out 獨立擲出包集合（含 out_at），
 *        再從未出包者依權重無放回加權抽名次，出包者依 out_at 倒序沉底。
 *   §5.3 全滅局照 out_at 倒序結算、不退款（撐最久者為冠軍、同時計為出包）。
 *        路子模擬器舊 fallback（全體放回重抽）已依規格廢除。
 *   §6.2 賠率一律由同一聯合分佈跑蒙地卡羅（≥100 萬次/輪，同參數快取；次數由 tables-b MC_RUNS 定）
 *        反推命中率 × RTP，取整向莊家。不可用手算邊際機率。
 *   §10.3 賽果在封盤（lockRound）當下抽定完畢，演出只是播放。
 *
 * 輪次時序（30 秒狀態機）由 B02 round-engine 驅動；本檔只管
 * betting → locked → settled 三態與資料，不持有計時器。
 * ============================================================ */

var MockServerB = (function () {
  "use strict";

  var T = TablesB;
  var N = 8;                      // 動物數
  var INITIAL_BALANCE = 10000;    // 虛擬幣（整數最小單位）
  var SHOE_SIZE = 200;            // Q7 已裁決：路子每 200 局換靴
  var ODDS_CACHE_MAX = 64;        // 同參數賠率快取上限
  var RESULTS_MAX = 1000;         // 賽果紀錄保留上限（靴號用獨立計數器，不受影響）

  var rng = Math.random;          // 集中一處，之後換 seeded RNG（Provably Fair）只改這裡

  var S = null;
  var mcRuns = T.MC_RUNS;         // 每輪蒙地卡羅次數（sim 可經 _setMcRuns 調低跑快速冒煙）

  function freshState() {
    return {
      balance: INITIAL_BALANCE,
      seq: 0,
      round: null,          // 當前輪（全服同步、單一進行中輪次）
      results: [],          // 已結算輪紀錄──路子與個體統計資料流（供 B06）
      resultCount: 0,       // 累計已結算局數（靴號依此計，不受 RESULTS_MAX 裁剪影響）
      idempotency: {},      // key -> 下注回應
      idemKeys: [],
      oddsCache: {},        // 參數簽名 -> 賠率表（§6.2 同參數快取）
      oddsCacheKeys: []
    };
  }

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ── 輪次生成 ── */

  /** §3.2 賽段組成：每局連續重抽（Q4 已裁決），三段歸一化 */
  function genSegments() {
    var a = rng(), b = rng(), c = rng(), s = a + b + c;
    return { grass: a / s, mud: b / s, water: c / s };
  }

  /** §3.1 屬性均勻 30–95 ＋ §4 心情（Q6 B03 初版抽法，見 tables-b.js 註記） */
  function genAnimals() {
    var animals = T.ANIMALS.map(function (an) {
      return {
        id: an.id, name: an.name,
        attrs: {   // 心情折算前原值（§10.4：契約下發原值＋mood_delta，折算由公式吸收）
          burst:   T.ATTR_MIN + Math.floor(rng() * (T.ATTR_MAX - T.ATTR_MIN + 1)),
          terrain: T.ATTR_MIN + Math.floor(rng() * (T.ATTR_MAX - T.ATTR_MIN + 1)),
          focus:   T.ATTR_MIN + Math.floor(rng() * (T.ATTR_MAX - T.ATTR_MIN + 1))
        },
        mood: null,
        mood_delta: 0
      };
    });
    var count = T.MOOD_COUNT_MIN + Math.floor(rng() * (T.MOOD_COUNT_MAX - T.MOOD_COUNT_MIN + 1));
    var idx = [0, 1, 2, 3, 4, 5, 6, 7];
    for (var i = idx.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    for (var k = 0; k < count; k++) {
      var a = animals[idx[k]];
      var mk = T.MOOD_KEYS[Math.floor(rng() * T.MOOD_KEYS.length)];
      a.mood = mk;
      a.mood_delta = T.MOODS[mk].delta;   // 守則③：一心情只動一條屬性
    }
    return animals;
  }

  /** 心情折算後的生效屬性（§4.2 守則①：已折算進權重與出包率） */
  function effectiveAttrs(a) {
    var eff = { burst: a.attrs.burst, terrain: a.attrs.terrain, focus: a.attrs.focus };
    if (a.mood) eff[T.MOODS[a.mood].attr] += a.mood_delta;
    return eff;
  }

  /** 由動物＋賽段組成推出本輪聯合分佈參數：權重向量 w[8] 與出包率向量 p[8] */
  function roundParams(animals, segments, stripMood) {
    var weights = [], pouts = [];
    for (var i = 0; i < N; i++) {
      var eff = stripMood ? animals[i].attrs : effectiveAttrs(animals[i]);
      weights.push(T.weight(eff, segments));
      pouts.push(T.pOut(eff.focus));
    }
    return { weights: weights, pouts: pouts };
  }

  /* ── §5.2 賽果向量抽定（鐵律核心，正式抽定與蒙地卡羅共用同一支）── */

  /** 抽樣暫存區：蒙地卡羅每輪（次數見 tables-b MC_RUNS）共用，避免配置壓力 */
  function newScratch() {
    return {
      ranking: new Int32Array(N),  // 0-based 動物索引
      out:     new Uint8Array(N),
      outAt:   new Float64Array(N),// (0,1) 賽道進度；正式抽定再換算公尺
      pool:    new Int32Array(N)
    };
  }

  /**
   * 依 §5.2 順序一次抽出完整賽果向量（寫入 scratch，回傳未出包隻數）：
   *   1) 依 p_out 獨立擲骰決定出包集合，並為每隻出包者擲 out_at
   *   2) 未出包者依權重 w 無放回加權抽樣定完賽名次
   *   3) 出包者依 out_at 倒序沉底（撐越久排越前）
   * 全滅局：alive=0，整列名次即 out_at 倒序，照常回傳（§5.3 結算不退款）。
   */
  function drawVector(weights, pouts, rand, sc) {
    var i, k, ac = 0;
    for (i = 0; i < N; i++) {
      if (rand() < pouts[i]) { sc.out[i] = 1; sc.outAt[i] = rand(); }
      else { sc.out[i] = 0; sc.outAt[i] = 0; sc.pool[ac++] = i; }
    }
    var alive = ac;

    var total = 0;
    for (i = 0; i < ac; i++) total += weights[sc.pool[i]];
    var pos = 0;
    while (ac > 0) {
      var roll = rand() * total, pick = ac - 1;
      for (k = 0; k < ac; k++) {
        roll -= weights[sc.pool[k]];
        if (roll <= 0) { pick = k; break; }
      }
      var id = sc.pool[pick];
      sc.ranking[pos++] = id;
      total -= weights[id];
      sc.pool[pick] = sc.pool[--ac];
    }

    for (i = 0; i < N; i++) {              // 出包者插入沉底段（out_at 倒序；同值取小編號在前）
      if (!sc.out[i]) continue;
      var j = pos++;
      while (j > alive && sc.outAt[sc.ranking[j - 1]] < sc.outAt[i]) {
        sc.ranking[j] = sc.ranking[j - 1];
        j--;
      }
      sc.ranking[j] = i;
    }
    return alive;
  }

  /** 正式抽定：轉為契約形狀（1-based id、out_at 換算公尺，未出包＝0） */
  function drawOutcome(weights, pouts) {
    var sc = newScratch();
    drawVector(weights, pouts, rng, sc);
    var ranking = [], out = [], out_at = [];
    for (var i = 0; i < N; i++) {
      ranking.push(sc.ranking[i] + 1);
      out.push(sc.out[i] === 1);
      out_at.push(sc.out[i] ? 1 + Math.floor(sc.outAt[i] * (T.TRACK_LEN - 1)) : 0);
    }
    return { ranking: ranking, out: out, out_at: out_at };
  }

  /* ── §6.2 賠率：聯合分佈蒙地卡羅反推 ── */

  /** 取整向莊家：無條件捨去至小數點後兩位 */
  function floorTo2(x) { return Math.floor(x * 100) / 100; }

  /**
   * 跑 runs 次 drawVector，統計四注別命中率後反推賠率。
   * 與正式抽定共用同一支 drawVector──賠率所依據的分佈與實際開獎
   * 完全同源，防套利由此保證（含全滅局：冠軍/前二連照 out_at 判定）。
   */
  function runMC(weights, pouts, runs) {
    var sc = newScratch();
    var winC = new Float64Array(N);
    var outC = new Float64Array(N);
    var exC  = new Float64Array(N * N);   // 索引 i*8+j（i<j，0-based）
    var noOutC = 0;

    for (var r = 0; r < runs; r++) {
      var alive = drawVector(weights, pouts, rng, sc);
      var a = sc.ranking[0], b = sc.ranking[1];
      winC[a]++;
      exC[a < b ? a * N + b : b * N + a]++;
      if (alive === N) noOutC++;
      else for (var i = 0; i < N; i++) if (sc.out[i]) outC[i]++;
    }

    function toOdds(rtp, count) {
      if (!count) return null;   // MC 全程未命中 → 命中率過低，該注本輪不可押
      return Math.min(floorTo2(rtp * runs / count), T.ODDS_CAP);
    }

    var odds = { win: [], out: [], exacta: {}, no_out: toOdds(T.RTP.no_out, noOutC), runs: runs };
    for (var m = 0; m < N; m++) {
      odds.win.push(toOdds(T.RTP.win, winC[m]));
      odds.out.push(toOdds(T.RTP.out, outC[m]));
    }
    for (var x = 0; x < N; x++) {
      for (var y = x + 1; y < N; y++) {
        odds.exacta[T.exactaKey(x + 1, y + 1)] = toOdds(T.RTP.exacta, exC[x * N + y]);
      }
    }
    return odds;
  }

  /** 同參數快取（§6.2）：權重取 3 位、出包率取 4 位做簽名 */
  function paramKey(weights, pouts) {
    var parts = [mcRuns];
    for (var i = 0; i < N; i++) parts.push(weights[i].toFixed(3), pouts[i].toFixed(4));
    return parts.join("|");
  }

  function computeOdds(weights, pouts) {
    var key = paramKey(weights, pouts);
    if (S.oddsCache[key]) return S.oddsCache[key];
    var odds = runMC(weights, pouts, mcRuns);
    S.oddsCache[key] = odds;
    S.oddsCacheKeys.push(key);
    while (S.oddsCacheKeys.length > ODDS_CACHE_MAX) delete S.oddsCache[S.oddsCacheKeys.shift()];
    return odds;
  }

  /* ── 個體統計（§8）：近 20 局勝/包，由全服輪次流累計（不論是否有人下注）── */

  function currentStats20() {
    var st = [];
    for (var i = 0; i < N; i++) st.push({ wins: 0, outs: 0 });
    var recent = S.results.slice(-20);
    for (var r = 0; r < recent.length; r++) {
      st[recent[r].ranking[0] - 1].wins++;   // 全滅局冠軍照計（§5.3 冠軍照 out_at 判定）
      for (var k = 0; k < N; k++) if (recent[r].out[k]) st[k].outs++;
    }
    return st;
  }

  /* ── 結算 ── */

  function judgeHit(bet, oc, noOut) {
    if (bet.type === "win")    return bet.target === oc.ranking[0];
    if (bet.type === "exacta") return bet.target === T.exactaKey(oc.ranking[0], oc.ranking[1]);
    if (bet.type === "out")    return oc.out[bet.target - 1];
    return noOut;              // no_out
  }

  /* ── 對外 API（契約形狀沿 §10.4；錯誤碼風格沿 chainfire mock-server）── */

  var api = {

    /** GET /config */
    getConfig: function () {
      return {
        param_version: T.PARAM_VERSION,
        rtp: { win: T.RTP.win * 100, exacta: T.RTP.exacta * 100, out: T.RTP.out * 100, no_out: T.RTP.no_out * 100 },
        bet_limits: T.BET_LIMITS,
        game_config: {
          animals: T.ANIMALS,
          track_len: T.TRACK_LEN,
          mc_runs: mcRuns,
          shoe_size: SHOE_SIZE,
          p_out: T.P_OUT,
          moods: T.MOODS
        }
      };
    },

    /**
     * 開新一輪（由 B02 round-engine 於結算段呼叫）。
     * 生成賽段/屬性/心情 → 蒙地卡羅反推本輪賠率（另跑一次「無心情基準」
     * 供卡面 ▲▼ 比對——基準含連帶影響：別隻的心情也會動到你的賠率）。
     */
    newRound: function () {
      if (S.round && S.round.state !== "settled")
        throw err("ROUND_IN_PROGRESS", "當前輪 " + S.round.round_no + " 尚未結算");

      var segments = genSegments();
      var animals = genAnimals();
      var params = roundParams(animals, segments, false);
      var baseParams = roundParams(animals, segments, true);   // 心情全拔的同局基準

      S.round = {
        round_no: ++S.seq,
        state: "betting",
        created_at: Date.now(),
        betting_ends_at: Date.now() + 15000,  // 名目值；真正時序由 B02 輪次引擎驅動
        segments: segments,
        animals: animals,
        stats20: currentStats20(),
        params: params,
        odds: computeOdds(params.weights, params.pouts),
        odds_base: computeOdds(baseParams.weights, baseParams.pouts),
        bets: [],
        outcome: null
      };
      return api.getRound();
    },

    /** GET /round/current ── 開局下發封包（§10.4 round 形狀） */
    getRound: function () {
      var r = S.round;
      if (!r) return null;
      var packet = {
        round_no: r.round_no,
        state: r.state,
        betting_ends_at: r.betting_ends_at,
        segments: { grass: r.segments.grass, mud: r.segments.mud, water: r.segments.water },
        animals: r.animals.map(function (a, i) {
          return {
            id: a.id, name: a.name,
            attrs: { burst: a.attrs.burst, terrain: a.attrs.terrain, focus: a.attrs.focus },
            mood: a.mood,
            mood_delta: a.mood_delta,
            stats20: { wins: r.stats20[i].wins, outs: r.stats20[i].outs },
            odds: {
              win: r.odds.win[i], out: r.odds.out[i],
              win_base: r.odds_base.win[i], out_base: r.odds_base.out[i]   // ▲▼ 比對基準
            },
            available: { win: r.odds.win[i] !== null, out: r.odds.out[i] !== null }
          };
        }),
        odds_exacta: {},
        odds_no_out: r.odds.no_out
      };
      Object.keys(r.odds.exacta).forEach(function (k) { packet.odds_exacta[k] = r.odds.exacta[k]; });
      return packet;
    },

    /**
     * POST /bets ── 複押多注（同輪可多次呼叫、一次多注）。
     * p = { round_no, bets: [{ type: "win"|"exacta"|"out"|"no_out", target?, amount }], idempotency_key? }
     *   target：win/out ＝動物 id；exacta ＝ "i-j"（順序不拘，內部正規化）；no_out 免填。
     * 冪等最優先：同 key 重試一律回傳原結果、不重複扣款。封盤後一律拒單。
     */
    placeBets: function (p) {
      if (p && p.idempotency_key && S.idempotency[p.idempotency_key])
        return S.idempotency[p.idempotency_key];

      if (!p || !Array.isArray(p.bets) || !p.bets.length) throw err("BAD_REQUEST", "bets 不可為空");
      var r = S.round;
      if (!r || p.round_no !== r.round_no) throw err("ROUND_NOT_FOUND", "非當前輪次");
      if (r.state !== "betting") throw err("ROUND_LOCKED", "本輪已封盤");

      var total = 0;
      var staged = p.bets.map(function (b) {
        if (!b || !Number.isInteger(b.amount)) throw err("BAD_REQUEST", "amount 須為整數");
        if (b.amount < T.BET_LIMITS.min || b.amount > T.BET_LIMITS.max)
          throw err("BET_OUT_OF_RANGE", "注額須在 " + T.BET_LIMITS.min + "–" + T.BET_LIMITS.max);

        var odds, target = b.target;
        if (b.type === "win" || b.type === "out") {
          if (!Number.isInteger(target) || target < 1 || target > N) throw err("BAD_REQUEST", "target 須為動物 id 1–8");
          odds = b.type === "win" ? r.odds.win[target - 1] : r.odds.out[target - 1];
        } else if (b.type === "exacta") {
          var m = /^([1-8])-([1-8])$/.exec(String(target));
          if (!m || m[1] === m[2]) throw err("BAD_REQUEST", "exacta target 須為 \"i-j\"（兩隻不同動物）");
          target = T.exactaKey(+m[1], +m[2]);
          odds = r.odds.exacta[target];
        } else if (b.type === "no_out") {
          target = null;
          odds = r.odds.no_out;
        } else {
          throw err("BAD_REQUEST", "未知注別 " + b.type);
        }
        if (odds === null) throw err("MARKET_UNAVAILABLE", "本輪額度已滿");   // §6.5 文案鐵則

        total += b.amount;
        return { type: b.type, target: target, amount: b.amount, odds: odds };
      });
      if (total > S.balance) throw err("INSUFFICIENT_BALANCE", "餘額不足");

      S.balance -= total;
      var accepted = staged.map(function (b) {
        b.bet_index = r.bets.length;
        r.bets.push(b);
        return { bet_index: b.bet_index, type: b.type, target: b.target, amount: b.amount, odds: b.odds };
      });

      var resp = { round_no: r.round_no, accepted: accepted, balance_after: S.balance };
      if (p.idempotency_key) {
        S.idempotency[p.idempotency_key] = resp;
        S.idemKeys.push(p.idempotency_key);
        while (S.idemKeys.length > 500) delete S.idempotency[S.idemKeys.shift()];
      }
      return resp;
    },

    /** 封盤（§10.3）：停止收注＋當下一次抽定完整賽果，之後任何呼叫不能改變它 */
    lockRound: function () {
      var r = S.round;
      if (!r || r.state !== "betting") throw err("BAD_STATE", "非下注階段，無盤可封");
      r.state = "locked";
      r.outcome = drawOutcome(r.params.weights, r.params.pouts);
      return { round_no: r.round_no, state: r.state };
    },

    /** 賽果封包（演出開始前下發；payouts 於結算後補上） */
    getOutcome: function () {
      var r = S.round;
      if (!r || !r.outcome) throw err("NOT_LOCKED", "尚未封盤，賽果未抽定");
      return {
        round_no: r.round_no,
        ranking: r.outcome.ranking.slice(),
        out: r.outcome.out.slice(),
        out_at: r.outcome.out_at.slice(),
        payouts: r.outcome.payouts ? r.outcome.payouts.slice() : null,
        total_payout: r.outcome.payouts ? r.outcome.total_payout : null
      };
    },

    /**
     * 結算（由 B02 於結算段呼叫）：判定注單、派彩入帳、落賽果紀錄。
     * 全滅局照 §5.3：冠軍/前二連按 out_at 倒序名次判定、出包注全中、
     * 零出包注全輸、不退款。
     */
    settleRound: function () {
      var r = S.round;
      if (!r || r.state !== "locked") throw err("BAD_STATE", "非封盤狀態，不可結算");
      var oc = r.outcome;
      var noOut = oc.out.every(function (o) { return !o; });

      var totalPayout = 0;
      oc.payouts = r.bets.map(function (b, i) {
        var hit = judgeHit(b, oc, noOut);
        var pay = hit ? Math.floor(b.amount * b.odds) : 0;   // 取整向莊家
        totalPayout += pay;
        return { bet_index: i, hit: hit, payout: pay };
      });
      oc.total_payout = totalPayout;
      S.balance += totalPayout;
      r.state = "settled";

      // 路子與個體統計資料流（供 B06）：每輪照落，不論有無人下注
      var outCount = 0;
      for (var k = 0; k < N; k++) if (oc.out[k]) outCount++;
      S.results.push({
        round_no: r.round_no,
        shoe_no: Math.floor(S.resultCount / SHOE_SIZE) + 1,   // Q7：每 200 局換靴
        segments: r.segments,
        moods: r.animals.map(function (a) { return a.mood; }),
        ranking: oc.ranking.slice(),
        out: oc.out.slice(),
        out_at: oc.out_at.slice(),
        out_count: outCount
      });
      S.resultCount++;
      while (S.results.length > RESULTS_MAX) S.results.shift();

      return api.getOutcome();
    },

    /** 賽果紀錄流（B06 路子投影／動物卡走勢的資料來源） */
    getResults: function (limit) {
      return S.results.slice(-(limit || 50));
    },

    getBalance: function () { return S.balance; },

    /* ── Demo / 驗證專用 ── */
    _reset: function () { S = freshState(); },
    _dump: function () { return JSON.stringify(S); },
    _load: function (json) { if (json) S = JSON.parse(json); },
    _grant: function (n) { S.balance += Math.max(0, Math.floor(n) || 0); return S.balance; },
    _setMcRuns: function (n) { mcRuns = Math.max(1000, Math.floor(n) || T.MC_RUNS); return mcRuns; },
    /** 測試鉤：直接以指定參數抽一次賽果向量（sim.html 自洽抽查／全滅局驗證用） */
    _draw: function (weights, pouts) { return drawOutcome(weights, pouts); },
    /** 測試鉤：直接以指定參數反推賠率（sim.html 心情方向抽查用；走同一套快取） */
    _computeOdds: function (weights, pouts) { return computeOdds(weights, pouts); },

    ping: function () { return "mock-server-b.js OK（deps: " + T.ping() + "）"; },

    _init: function () { if (!S) S = freshState(); }
  };

  return api;
})();

MockServerB._init();

/* Node CLI 環境相容（瀏覽器忽略） */
if (typeof module !== "undefined" && module.exports) module.exports = MockServerB;
