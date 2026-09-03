/* ============================================================
 * round-engine.js ── 40 秒全服同步輪次引擎【可移植邏輯層】
 *（B05-R2 校註：時序自 30s 調為 40s——下注 25s，總循環 40s；
 *  以下敘述之秒數以本檔設定值為準）
 *
 * 零 DOM 依賴。轉 Cocos / Unity 時本檔邏輯照搬；正式版把
 * 「牆鐘推導」換成後台輪次調度＋WebSocket 推送，前端狀態機不變
 * （規格書 §2 Demo 範圍、§10.4）。
 *
 * ── 設計核心：輪次不是「跑出來的」，是「從牆鐘算出來的」──
 * 全服每 40 秒一輪、輪次不因任何玩家而停（§2）。因此引擎不用
 * setTimeout 串接階段（睡著就漏拍），而是以固定錨點 EPOCH 對
 * Date.now() 取模，隨時可從當下時刻推導出「現在是第幾局、什麼
 * 階段、剩幾毫秒」：
 *
 *   round_no = floor((now − EPOCH) / 40000) + 1
 *   階段     = 週期內偏移落在哪一段
 *     betting 00.0–25.0s → locked 25.0–27.0s
 *     → racing 27.0–37.0s → settled 37.0–40.0s
 *
 * 好處：
 *  1. 重整＝對時：重新推導即接回當前局的當前階段（同步輪次的
 *     重連本質，不還原個人決策）。
 *  2. 分頁休眠／計時器被節流：醒來後一次補記錯過的局，輪次編
 *     號與歷史必然連續。
 *  3. 倒數永不飄移：每 tick 都從牆鐘重算，非累加。
 *
 * 搭配「以局號為種子的決定性 RNG」：同一局號永遠抽出同一場比
 * 賽（屬性/賽段/心情/賽果），所有裝置、重整前後看到同一結果，
 * 單機即模擬出「全服同一場比賽」。
 *
 * 狀態流（§10.4 契約 state 命名）：
 *   betting(25s) → locked(2s，抽定賽果+拒單) → racing(10s，僅播放)
 *   → settled(3s，派彩+記史+預生成下一局) → 下一局 betting
 *
 * 事件（GameState 回呼風格：configure({ onEvent })）：
 *   round_start   { round, rejoin }        新局開盤（rejoin=重整接回）
 *   phase         { phase, round_no, remaining_ms, duration_ms }
 *   tick          { phase, round_no, remaining_ms, duration_ms }
 *   locked        { round_no, outcome }    賽果已一次抽定（§10.3 此後僅演出）
 *   race_start    { round, outcome }
 *   settled       { round, outcome, payouts, total_payout, wallet, record }
 *   next_preview  { round }                下一局預生成揭示（§2 結算段）
 *   bet_accepted  { bet, wallet }
 *   history_backfilled { count }           開機/醒來回補了幾局
 *
 * 對外 API：
 *   configure({ onEvent, store })  store = { load(), save(snapshot) }
 *   start() / stop()
 *   placeBet({ type, target, amount }) → { accepted, reason?, message? }
 *   getState() / getHistory(n) / getWallet() / ping()
 * ============================================================ */

var RoundEngine = (function () {
  "use strict";

  /* ── 輪次時間軸（§2）── */
  var EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0); // 全服共同錨點（常數＝所有客戶端天然同步）
  var PHASES = [
    { key: "betting", dur: 25000 },
    { key: "locked",  dur: 2000  },
    { key: "racing",  dur: 10000 },
    { key: "settled", dur: 3000  }
  ];
  var CYCLE = 40000;
  var SHOE_SIZE = 200;      // §7.7 每 200 局換靴（已裁決）
  var HISTORY_KEEP = 200;   // 引擎保留的輪次歷史窗（靴內全量）
  var BACKFILL = 20;        // 冷開機回補局數（§8 近 20 局統計窗的最小需求）
  var STATS_WINDOW = 20;    // §8 個體統計窗
  var TRACK_LEN = 1000;     // 賽道長（公尺），out_at 用
  var TICK_MS = 100;

  /* ── 決定性 RNG：同一局號＋串流名 → 同一亂數序列 ── */
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
  // stream 把「屬性生成／賽果擲骰／賠率模擬」分成獨立序列，互不干擾
  function rngFor(round_no, stream) {
    return mulberry32((Math.imul(round_no, 2654435761) ^ strHash(stream)) >>> 0);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function floor2(x) { return Math.floor(x * 100) / 100; } // §6.2 取整向莊家有利

  /* ============================================================
   * StubProvider ── 賽果供給的最小佔位實作
   * STUB: B03 交付後替換。B03 的 js/mock-server-b.js 掛出全域
   *       MockServerB（含 generateRound / generateOutcome / settle）
   *       後，引擎於 start() 自動改用，本段即棄置不再執行。
   *
   * 介面契約（規格書 §10.4 形狀）：
   *   generateRound(round_no, rng, history) → round 封包
   *   generateOutcome(round, rng)           → outcome 向量
   *   settle(bets, round, outcome)          → { payouts, total_payout }
   *   （rng 由引擎注入＝以局號為種子；B03 沿用同一注入方式即可
   *     保住「重整接回同一場比賽」的決定性。）
   *
   * 注意：本 stub 的賠率是 3000 次小樣本蒙地卡羅佔位值，僅供版
   * 面有數字可排；§6.2 鐵律要求 ≥100 萬輪反推＋防套利驗證，由
   * B03/B04 落實。屬性/心情初值標記「待 B04」者見規格書 §12。
   * ============================================================ */
  var StubProvider = (function () {

    // §1.1 編號與名稱固定（正式資料表歸 B03 的 tables-b.js）
    var ANIMALS = ["小兔", "阿汪", "鴨鴨", "山羊", "獵豹", "袋鼠", "烏龜", "小豬"];

    // §4.1 心情初值（待 B04）；守則③一心情一屬性（Q5 已裁決）
    var MOODS = {
      hyper:   { attr: "burst",   delta: +15 },
      sleepy:  { attr: "focus",   delta: -20 },
      nervous: { attr: "terrain", delta: -20 }
    };
    var MOOD_KEYS = ["hyper", "sleepy", "nervous"];

    var RTP = { win: 0.95, exacta: 0.95, out: 0.94, no_out: 0.94 }; // Q9 已裁決佔位
    var MC_N = 3000; // STUB 佔位模擬次數（B03 為 ≥100 萬）

    // §5.1 出包率：由專注反向推得（初值公式，待 B04）
    function pOut(focus) {
      return clamp(0.06 + 0.20 * (95 - focus) / 65, 0.06, 0.26);
    }
    // 心情折算後的生效屬性（§4.2 已折算原則：計算用生效值、展示分開標）
    function effAttrs(a) {
      var e = { burst: a.attrs.burst, terrain: a.attrs.terrain, focus: a.attrs.focus };
      if (a.mood) e[MOODS[a.mood].attr] = clamp(e[MOODS[a.mood].attr] + a.mood_delta, 1, 120);
      return e;
    }
    // §3.2 勝率權重 = 屬性 × 賽段內積
    function weight(eff, seg) {
      return eff.burst * seg.grass + eff.terrain * (seg.mud + seg.water);
    }

    /* §5.2 鐵律：一次抽出完整賽果向量（out 擲骰 → 無放回加權抽名次 → 出包沉底依 out_at 倒序）
       全滅局（§5.3）：名次＝out_at 倒序，照結算不退款——本流程天然涵蓋，無特例。 */
    function drawRace(animals, seg, rng) {
      var out = [], out_at = [], survivors = [];
      for (var i = 0; i < 8; i++) {
        var eff = effAttrs(animals[i]);
        if (rng() < pOut(eff.focus)) {
          out[i] = true;
          out_at[i] = 20 + Math.floor(rng() * (TRACK_LEN - 40));
        } else {
          out[i] = false; out_at[i] = 0;
          survivors.push({ id: animals[i].id, w: weight(eff, seg) });
        }
      }
      var ranking = [];
      while (survivors.length) { // 無放回加權抽樣
        var total = 0, k;
        for (k = 0; k < survivors.length; k++) total += survivors[k].w;
        var roll = rng() * total;
        for (k = 0; k < survivors.length && roll >= survivors[k].w; k++) roll -= survivors[k].w;
        ranking.push(survivors[k].id);
        survivors.splice(k, 1);
      }
      animals.map(function (a) { return a.id; })
        .filter(function (id) { return out[id - 1]; })
        .sort(function (a, b) { return out_at[b - 1] - out_at[a - 1]; }) // 撐越久排越前
        .forEach(function (id) { ranking.push(id); });
      return { ranking: ranking, out: out, out_at: out_at };
    }

    function generateRound(round_no, rng, history) {
      // 賽段組成：連續重抽（Q4 已裁決；抽法細節待 B03/B04 定曲線）
      var r1 = 0.2 + rng(), r2 = 0.2 + rng(), r3 = 0.2 + rng(), sum = r1 + r2 + r3;
      var grass = Math.round(r1 / sum * 100) / 100;
      var mud = Math.round(r2 / sum * 100) / 100;
      var seg = { grass: grass, mud: mud, water: Math.round((1 - grass - mud) * 100) / 100 };

      // 屬性：每局每隻重抽，均勻 30–95（待 B04）
      var animals = [];
      for (var i = 0; i < 8; i++) {
        animals.push({
          id: i + 1, name: ANIMALS[i],
          attrs: {
            burst:   30 + Math.floor(rng() * 66),
            terrain: 30 + Math.floor(rng() * 66),
            focus:   30 + Math.floor(rng() * 66)
          },
          mood: null, mood_delta: 0,
          stats20: { wins: 0, outs: 0 },
          odds: { win: 0, out: 0 },
          available: { win: true, out: true } // §6.5 曝險封盤僅留接口，Demo 不實作額度
        });
      }

      // 心情：每局 2–3 隻、其餘中性（守則②稀疏）；抽法為 Q6 初版，B03/B04 定案
      var moodCount = 2 + Math.floor(rng() * 2);
      var pool = [0, 1, 2, 3, 4, 5, 6, 7];
      for (var m = 0; m < moodCount; m++) {
        var pick = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        var mk = MOOD_KEYS[Math.floor(rng() * 3)];
        animals[pick].mood = mk;
        animals[pick].mood_delta = MOODS[mk].delta;
      }

      // §8 近 20 局個體統計：由引擎維護的輪次歷史累計（全服流，不看玩家）
      var win20 = history.slice(-STATS_WINDOW);
      win20.forEach(function (rec) {
        animals[rec.ranking[0] - 1].stats20.wins++;
        rec.out.forEach(function (o, idx) { if (o) animals[idx].stats20.outs++; });
      });

      // 賠率：小樣本蒙地卡羅佔位（STUB，正式反推歸 B03，§6.2）
      var mcRng = rngFor(round_no, "odds");
      var champ = [0, 0, 0, 0, 0, 0, 0, 0], pairs = {}, noOut = 0;
      for (var t = 0; t < MC_N; t++) {
        var res = drawRace(animals, seg, mcRng);
        champ[res.ranking[0] - 1]++;
        var a = res.ranking[0], b = res.ranking[1], key = a < b ? a + "-" + b : b + "-" + a;
        pairs[key] = (pairs[key] || 0) + 1;
        if (res.out.indexOf(true) === -1) noOut++;
      }
      function toOdds(hits, rtp) { return hits ? Math.max(1.01, floor2(rtp / (hits / MC_N))) : 99.0; }
      animals.forEach(function (a, i) {
        a.odds.win = toOdds(champ[i], RTP.win);
        a.odds.out = floor2(RTP.out / pOut(effAttrs(a).focus)); // 出包為獨立擲骰，邊際即聯合
      });
      var odds_exacta = {};
      for (var x = 1; x <= 8; x++) for (var y = x + 1; y <= 8; y++)
        odds_exacta[x + "-" + y] = toOdds(pairs[x + "-" + y] || 0, RTP.exacta);

      return {
        round_no: round_no,
        state: "betting",
        betting_ends_at: EPOCH + (round_no - 1) * CYCLE + PHASES[0].dur,
        segments: seg,
        animals: animals,
        odds_exacta: odds_exacta,
        odds_no_out: toOdds(noOut, RTP.no_out)
      };
    }

    function generateOutcome(round, rng) {
      var res = drawRace(round.animals, round.segments, rng);
      return {
        round_no: round.round_no,
        ranking: res.ranking,
        out: res.out,
        out_at: res.out_at,
        payouts: [],       // 由 settle() 按玩家注單填入
        total_payout: 0
      };
    }

    // 注單結算（含全滅局：出包注全中、零出包注全輸、冠軍照 out_at 倒序判定）
    function settle(bets, round, outcome) {
      var allOut = outcome.out.indexOf(false) === -1;
      var payouts = [], total = 0;
      bets.forEach(function (bet, idx) {
        var hit = false, odds = 0;
        if (bet.type === "win") {
          hit = outcome.ranking[0] === bet.target;
          odds = round.animals[bet.target - 1].odds.win;
        } else if (bet.type === "exacta") {
          var p = bet.target.split("-").map(Number);
          var top2 = [outcome.ranking[0], outcome.ranking[1]];
          hit = top2.indexOf(p[0]) !== -1 && top2.indexOf(p[1]) !== -1;
          odds = round.odds_exacta[bet.target];
        } else if (bet.type === "out") {
          hit = outcome.out[bet.target - 1];
          odds = round.animals[bet.target - 1].odds.out;
        } else if (bet.type === "no_out") {
          hit = !allOut && outcome.out.indexOf(true) === -1;
          odds = round.odds_no_out;
        }
        var pay = hit ? Math.floor(bet.amount * odds) : 0;
        total += pay;
        payouts.push({ bet_index: idx, hit: hit, payout: pay });
      });
      return { payouts: payouts, total_payout: total };
    }

    return { generateRound: generateRound, generateOutcome: generateOutcome, settle: settle,
             ping: function () { return "StubProvider（B03 交付後替換）"; } };
  })();
  /* ── StubProvider 迄此 ── */

  /* ============================================================
   * 引擎本體
   * ============================================================ */
  var onEvent = function () {};
  var store = null;          // 持久化轉接器（由拋棄式層注入 localStorage 實作）
  var provider = StubProvider;
  var tickIv = null;
  var running = false;

  var S = {                  // 玩家側持久化狀態（正式版歸後台帳務）
    wallet: 100000,
    pending: null,           // { round_no, bets: [] } 當前局注單
    betHistory: [],          // 已結注單（近 50 筆）
    settings: { quickBet: 100 }
  };
  var history = [];          // 輪次歷史（全服流，近 HISTORY_KEEP 局；不論有無人下注都記，§2）
  var cur = null;            // { round, outcome|null, settledDone }
  var next = null;           // 預生成的下一局封包（§2 結算段揭示）
  var lastPhase = null;      // 上次 tick 所在階段（偵測轉場）

  function emit(type, data) { onEvent(type, data || {}); }

  /* 牆鐘 → 輪次座標。整個引擎的「現在」只來自這裡。 */
  function deriveNow(t) {
    var elapsed = t - EPOCH;
    var round_no = Math.floor(elapsed / CYCLE) + 1;
    var off = elapsed - (round_no - 1) * CYCLE;
    var acc = 0;
    for (var i = 0; i < PHASES.length; i++) {
      acc += PHASES[i].dur;
      if (off < acc) {
        return {
          round_no: round_no,
          phase: PHASES[i].key,
          phaseIndex: i,
          remaining_ms: acc - off,
          duration_ms: PHASES[i].dur,
          shoe: Math.floor((round_no - 1) / SHOE_SIZE) + 1,     // §7.7「第 N 靴」
          shoe_round: ((round_no - 1) % SHOE_SIZE) + 1
        };
      }
    }
  }

  function getRound(n) { return provider.generateRound(n, rngFor(n, "round"), history); }
  function getOutcome(round) { return provider.generateOutcome(round, rngFor(round.round_no, "outcome")); }

  function pushHistory(round, outcome) {
    var outCount = outcome.out.filter(Boolean).length;
    history.push({
      round_no: round.round_no,
      ranking: outcome.ranking,
      out: outcome.out,
      out_at: outcome.out_at,
      outCount: outCount,
      champion: outcome.ranking[0],
      segments: round.segments
    });
    if (history.length > HISTORY_KEEP) history.splice(0, history.length - HISTORY_KEEP);
  }

  /* 補記一整局（開機回補／分頁休眠醒來）：生成 → 抽賽果 → 記史 → 若壓著注單則結算 */
  function recordRound(n) {
    var round = (next && next.round_no === n) ? next : getRound(n);
    next = null;
    var outcome = getOutcome(round);
    settlePending(round, outcome, true);
    pushHistory(round, outcome);
  }

  function settlePending(round, outcome, silent) {
    var payouts = [], total = 0;
    if (S.pending && S.pending.round_no === round.round_no && S.pending.bets.length) {
      var res = provider.settle(S.pending.bets, round, outcome);
      payouts = res.payouts; total = res.total_payout;
      S.wallet += total;
      S.pending.bets.forEach(function (bet, i) {
        S.betHistory.push({
          round_no: round.round_no, type: bet.type, target: bet.target,
          amount: bet.amount, hit: payouts[i].hit, payout: payouts[i].payout,
          settled_at: Date.now()
        });
      });
      if (S.betHistory.length > 50) S.betHistory.splice(0, S.betHistory.length - 50);
    }
    if (S.pending && S.pending.round_no <= round.round_no) S.pending = null;
    save();
    if (!silent) {
      emit("settled", {
        round: round, outcome: outcome,
        payouts: payouts, total_payout: total,
        wallet: S.wallet,
        record: history[history.length - 1] || null
      });
    }
    return { payouts: payouts, total: total };
  }

  /* 每 tick：對時 → 回補漏局 → 處理轉場 → 發 tick。
     階段推進不靠 setTimeout 串接，睡再久醒來都能一次補齊。 */
  function tick() {
    var d = deriveNow(Date.now());

    // 1) 回補完全錯過的局（歷史連續無漏的保證）
    var lastRecorded = history.length ? history[history.length - 1].round_no : d.round_no - BACKFILL - 1;
    var gap = 0;
    for (var r = Math.max(lastRecorded + 1, d.round_no - HISTORY_KEEP); r < d.round_no; r++) {
      recordRound(r); gap++;
    }
    if (gap > 0 && cur) emit("history_backfilled", { count: gap });

    // 2) 換局
    var rejoin = !cur;
    if (!cur || cur.round.round_no !== d.round_no) {
      cur = {
        round: (next && next.round_no === d.round_no) ? next : getRound(d.round_no),
        outcome: null, settledDone: false
      };
      next = null;
      lastPhase = null;
      emit("round_start", { round: cur.round, rejoin: rejoin });
    }

    // 3) 階段轉場（含重整接回時直接落在中後段階段）
    if (lastPhase !== d.phase) {
      // 賽果在封盤當下一次抽定（§10.3 結算/演出分離）；racing/settled 接回時也先補抽
      if (d.phaseIndex >= 1 && !cur.outcome) {
        cur.outcome = getOutcome(cur.round);
        emit("locked", { round_no: d.round_no, outcome: cur.outcome });
      }
      if (d.phase === "racing") emit("race_start", { round: cur.round, outcome: cur.outcome });
      if (d.phase === "settled" && !cur.settledDone) {
        cur.settledDone = true;
        pushHistory(cur.round, cur.outcome);
        settlePending(cur.round, cur.outcome, false);
        next = getRound(d.round_no + 1);          // 下一輪動物卡預生成（§2 結算段揭示）
        emit("next_preview", { round: next });
      }
      cur.round.state = d.phase;
      lastPhase = d.phase;
      emit("phase", { phase: d.phase, round_no: d.round_no,
                      remaining_ms: d.remaining_ms, duration_ms: d.duration_ms });
    }

    emit("tick", { phase: d.phase, round_no: d.round_no,
                   remaining_ms: d.remaining_ms, duration_ms: d.duration_ms,
                   shoe: d.shoe, shoe_round: d.shoe_round });
  }

  function save() {
    if (!store) return;
    store.save({
      wallet: S.wallet,
      pending: S.pending,
      betHistory: S.betHistory,
      settings: S.settings,
      history: history           // 輪次歷史也入庫：B03 供給層若非決定性仍能接續
    });
  }

  return {
    configure: function (o) {
      if (o && o.onEvent) onEvent = o.onEvent;
      if (o && o.store) store = o.store;
    },

    start: function () {
      if (running) return false;
      running = true;

      // STUB 切換點：B03 的 MockServerB 就位即自動改用
      if (typeof MockServerB !== "undefined" &&
          MockServerB.generateRound && MockServerB.generateOutcome && MockServerB.settle) {
        provider = MockServerB;
      }

      // 載入持久化（錢包／注單／設定／輪次歷史）
      var saved = store ? store.load() : null;
      if (saved) {
        if (typeof saved.wallet === "number") S.wallet = saved.wallet;
        if (saved.betHistory) S.betHistory = saved.betHistory;
        if (saved.settings) S.settings = saved.settings;
        if (saved.pending) S.pending = saved.pending; // 同局內重整：注單仍在（後台記得你的注）
        if (saved.history) history = saved.history;
      }

      // 對時 + 回補：接回當前階段，而非從頭開始（同步輪次的重連＝對時）
      var d = deriveNow(Date.now());
      if (S.pending && S.pending.round_no < d.round_no) {
        // 掛單的那局在離線期間跑完了 → recordRound 補結（於 tick 的回補迴圈）
      }
      if (!history.length) {
        for (var r = Math.max(1, d.round_no - BACKFILL); r < d.round_no; r++) recordRound(r);
        emit("history_backfilled", { count: Math.min(BACKFILL, d.round_no - 1) });
      }
      tick();                                  // 立即對時發出 round_start / phase
      tickIv = setInterval(tick, TICK_MS);
      save();
      return true;
    },

    stop: function () {
      if (tickIv) { clearInterval(tickIv); tickIv = null; }
      running = false;
    },

    /* 下注：只在 betting 階段收單，封盤即拒（§2）。
       bet = { type: "win"|"exacta"|"out"|"no_out", target: id|"a-b"|null, amount } */
    placeBet: function (bet) {
      var d = deriveNow(Date.now());
      if (d.phase !== "betting")
        return { accepted: false, reason: "locked", message: "已封盤，本輪停止收注" };
      if (!bet || !(bet.amount > 0))
        return { accepted: false, reason: "bad_amount", message: "注額無效" };
      if (bet.amount > S.wallet)
        return { accepted: false, reason: "insufficient", message: "餘額不足" };
      if (bet.type === "win" || bet.type === "out") {
        var a = cur && cur.round.animals[bet.target - 1];
        if (!a) return { accepted: false, reason: "bad_target", message: "目標無效" };
        if (!a.available[bet.type])
          return { accepted: false, reason: "exposure", message: "本輪額度已滿" }; // §6.5 文案
      }
      if (!S.pending || S.pending.round_no !== d.round_no)
        S.pending = { round_no: d.round_no, bets: [] };
      S.pending.bets.push({ type: bet.type, target: bet.target, amount: bet.amount });
      S.wallet -= bet.amount;
      save();
      emit("bet_accepted", { bet: bet, round_no: d.round_no, wallet: S.wallet,
                             bets: S.pending.bets.slice() });
      return { accepted: true, wallet: S.wallet };
    },

    getState: function () {
      var d = deriveNow(Date.now());
      var fresh = cur && cur.round.round_no === d.round_no; // 換局後首個 tick 前 cur 可能仍是上一局
      return {
        round_no: d.round_no, phase: d.phase,
        remaining_ms: d.remaining_ms, duration_ms: d.duration_ms,
        shoe: d.shoe, shoe_round: d.shoe_round,
        round: fresh ? cur.round : null,
        outcome: fresh ? cur.outcome : null, // 封盤後才有值；演出層只讀不改（§10.3）
        pending: S.pending, wallet: S.wallet
      };
    },
    getHistory: function (n) { return history.slice(-(n || 20)); },
    getBetHistory: function (n) { return S.betHistory.slice(-(n || 20)); },
    getWallet: function () { return S.wallet; },
    getSettings: function () { return S.settings; },
    resetWallet: function () { S.wallet = 100000; S.pending = null; save(); return S.wallet; },
    _providerName: function () { return provider === StubProvider ? "stub" : "mock-server-b"; },
    ping: function () { return "RoundEngine OK（供給層：" + provider.ping() + "）"; }
  };
})();
