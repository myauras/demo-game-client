/* ============================================================
 * mock-server.js ── 後台契約的本地實作【可移植資產】
 * 對齊規則書 §5.2 / §5.3 端點。之後接真後台或轉引擎時，
 * 前端只認這幾個函式簽名，內部實作整包替換。
 * 依賴：GameTables（tables.js）。禁止引用任何畫面相關程式。
 *
 * 核心原則（規則書 §1.1 結算與演出分離）：
 *   bet() 當下就抽定完整結果（wind + extinguish_at），
 *   之後任何呼叫都不能改變它，前端只是把結果演出來。
 * ============================================================ */

var MockServer = (function () {
  "use strict";

  var PARAM_VERSION = "a-demo-t02-01";
  var INITIAL_BALANCE = 10000;   // 虛擬幣（整數最小單位）
  var INITIAL_JACKPOT = 50000;
  var JACKPOT_CUT = 0.01;        // 每注抽 1% 進獎池（§R6，不計入 96% RTP）

  /* 獎池派發：按風向分級（2026-08-26 設計決議）。
   * 派發比例 = 該套最終倍率 / 150 → 微風 3.13%、江風 10%、東風大作 32%。
   * 恆等式：每局獎池回流期望 = P(通關) × 比例 = (RTP/M12) × (M12/150) = RTP/150，
   * 與風向無關 → 含獎池的三套 RTP 保持一致。改階梯表或 RTP 時等化性質自動成立。 */
  var JACKPOT_AWARD_DIVISOR = 150;
  function jackpotAwardFraction(wind) {
    var ladder = GameTables.LADDERS[wind];
    return ladder[ladder.length - 1] / JACKPOT_AWARD_DIVISOR;
  }
  var BET_LIMITS = { min: 10, max: 5000, steps: [10, 50, 100, 500] };

  // ── 內部狀態（T08 以 _dump/_load 持久化）──
  var S = null;

  function freshState() {
    return {
      balance: INITIAL_BALANCE,
      jackpot: INITIAL_JACKPOT,
      rounds: {},          // round_id -> round
      settledQueue: [],    // 已結算局保留佇列（防大量模擬時記憶體無上限成長）
      pendingRoundId: null,
      idempotency: {},     // key -> round_id
      history: [],         // 已結算注單（新的在前）
      seq: 0
    };
  }

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  var rng = Math.random; // 集中一處，之後要換 seeded RNG（Provably Fair）只改這裡

  // ── 結果抽定 ──

  function drawWind() {
    var d = GameTables.WIND_DISTRIBUTION; // { gentle:35, standard:50, east_wind:15 }
    var roll = rng() * 100;
    var acc = 0;
    var winds = Object.keys(d);
    for (var i = 0; i < winds.length; i++) {
      acc += d[winds[i]];
      if (roll < acc) return winds[i];
    }
    return winds[winds.length - 1];
  }

  /** 逐節擲該節續燃率 p_n；失敗節即熄滅節。全過 = 13（通關） */
  function drawExtinguishAt(wind) {
    var rows = GameTables.DERIVED[wind];
    for (var n = 0; n < rows.length; n++) {
      if (rng() >= rows[n].burnRate) return n + 1;
    }
    return GameTables.MAX_NODES + 1; // 13 = 通關
  }

  // ── 結算（唯一入帳出口）──

  function settle(round, result, atNode) {
    var payout = 0;
    var multiplier = 0;
    if (result === "cashed_out") {
      multiplier = round.outcome.ladder[atNode - 1];
      payout = Math.floor(round.bet_amount * multiplier); // 取整對莊家有利
    } else if (result === "cleared") {
      atNode = GameTables.MAX_NODES;
      multiplier = round.outcome.ladder[GameTables.MAX_NODES - 1];
      payout = Math.floor(round.bet_amount * multiplier) + round.outcome.jackpot_award;
      S.jackpot -= round.outcome.jackpot_award; // 實際派發時才扣池（提早收兵則彩金留池）
    } // extinguished: payout 0

    S.balance += payout;
    round.status = "settled";
    round.result = result;
    round.settled_node = atNode || round.outcome.extinguish_at;
    round.payout = payout;
    if (S.pendingRoundId === round.round_id) S.pendingRoundId = null;

    S.history.unshift({
      round_id: round.round_id,
      wind: round.outcome.wind,
      bet: round.bet_amount,
      result: result,                 // cashed_out | extinguished | cleared
      node: round.settled_node,
      multiplier: multiplier,
      payout: payout,
      jackpot_award: round.outcome.jackpot_award && result === "cleared" ? round.outcome.jackpot_award : 0,
      created_at: round.created_at
    });
    if (S.history.length > 100) S.history.length = 100;

    // 只保留最近 50 局的完整 round 物件（ack 重入窗口足夠；再舊的查詢走 history）
    S.settledQueue.push(round.round_id);
    while (S.settledQueue.length > 50) delete S.rounds[S.settledQueue.shift()];

    return { round_id: round.round_id, result: result, node: round.settled_node,
             multiplier: multiplier, payout: payout, balance_after: S.balance };
  }

  // ── 對外 API（對齊 §5 端點）──

  return {

    /** GET /config */
    getConfig: function () {
      return {
        param_version: PARAM_VERSION,
        rtp: GameTables.RTP * 100,
        bet_limits: BET_LIMITS,
        game_config: {
          max_nodes: GameTables.MAX_NODES,
          wind_distribution: GameTables.WIND_DISTRIBUTION,
          wind_labels: GameTables.WIND_LABELS,
          ladders: GameTables.LADDERS,
          decision_timeout_ms: 3000,
          timeout_action: "continue",   // continue | cash_out（前端設定可覆寫演出行為）
          jackpot: {
            current_amount: S.jackpot,
            award_fractions: {
              gentle: jackpotAwardFraction("gentle"),
              standard: jackpotAwardFraction("standard"),
              east_wind: jackpotAwardFraction("east_wind")
            }
          }
        }
      };
    },

    /**
     * POST /bet ── 扣款 + 當下抽定完整結果。
     * @param {{bet_amount:number, game_params?:{auto_cashout_node?:number|null}, idempotency_key?:string}} p
     */
    bet: function (p) {
      // 冪等最優先：同 key 重試（含未結算局的重試）一律回傳原結果，不重複扣款（§5.2）
      if (p && p.idempotency_key && S.idempotency[p.idempotency_key]) {
        var existed = S.rounds[S.idempotency[p.idempotency_key]];
        return existed._betResponse;
      }

      if (!p || !Number.isInteger(p.bet_amount)) throw err("BAD_REQUEST", "bet_amount 須為整數");
      if (p.bet_amount < BET_LIMITS.min || p.bet_amount > BET_LIMITS.max)
        throw err("BET_OUT_OF_RANGE", "注額須在 " + BET_LIMITS.min + "–" + BET_LIMITS.max);
      if (S.pendingRoundId) throw err("ROUND_IN_PROGRESS", "尚有未結算局 " + S.pendingRoundId);

      if (p.bet_amount > S.balance) throw err("INSUFFICIENT_BALANCE", "餘額不足");

      S.balance -= p.bet_amount;
      S.jackpot += Math.floor(p.bet_amount * JACKPOT_CUT);

      var wind = drawWind();
      var extinguishAt = drawExtinguishAt(wind);
      var cleared = extinguishAt > GameTables.MAX_NODES;

      var auto = p.game_params && Number.isInteger(p.game_params.auto_cashout_node)
        ? p.game_params.auto_cashout_node : null;
      if (auto !== null && (auto < 1 || auto > GameTables.MAX_NODES))
        throw err("BAD_REQUEST", "auto_cashout_node 須在 1–12");

      var round = {
        round_id: "R-" + (++S.seq),
        status: "pending",
        bet_amount: p.bet_amount,
        auto_cashout_node: auto,
        current_node: 0,
        created_at: Date.now(),
        outcome: {
          wind: wind,
          ladder: GameTables.LADDERS[wind],
          extinguish_at: extinguishAt,   // 1–12 = 該節熄滅；13 = 通關
          cleared: cleared,
          // 通關可得的彩金額度於下注當下鎖定；實際扣池在結算時（提早收兵則不派發）
          jackpot_award: cleared ? Math.floor(S.jackpot * jackpotAwardFraction(wind)) : 0
        }
      };

      S.rounds[round.round_id] = round;
      S.pendingRoundId = round.round_id;

      round._betResponse = {
        round_id: round.round_id,
        param_version: PARAM_VERSION,
        bet_amount: round.bet_amount,
        balance_after: S.balance,
        outcome: round.outcome
      };
      if (p.idempotency_key) S.idempotency[p.idempotency_key] = round.round_id;
      return round._betResponse;
    },

    /**
     * POST /round/{id}/action ── 收兵。不改變已定結果，只記錄玩家停手的節點。
     * @param {{round_id:string, action:"cash_out", at_node:number}} p
     */
    action: function (p) {
      var round = S.rounds[p && p.round_id];
      if (!round) throw err("ROUND_NOT_FOUND", "查無此局");
      if (round.status !== "pending") throw err("ROUND_SETTLED", "此局已結算");
      if (p.action !== "cash_out") throw err("BAD_REQUEST", "未知 action");
      if (!Number.isInteger(p.at_node) || p.at_node < 1 || p.at_node > GameTables.MAX_NODES)
        throw err("BAD_REQUEST", "at_node 須在 1–12");
      if (p.at_node >= round.outcome.extinguish_at)
        throw err("NODE_NOT_SURVIVED", "第 " + p.at_node + " 節未存活（熄滅於第 " + round.outcome.extinguish_at + " 節），不可收兵");
      return settle(round, "cashed_out", p.at_node);
    },

    /** POST /round/{id}/ack ── 演出播畢；熄滅局/通關局在此落帳結案 */
    ack: function (roundId) {
      var round = S.rounds[roundId];
      if (!round) throw err("ROUND_NOT_FOUND", "查無此局");
      if (round.status === "settled")
        return { round_id: round.round_id, result: round.result, payout: round.payout, balance_after: S.balance };
      return settle(round, round.outcome.cleared ? "cleared" : "extinguished");
    },

    /** 前端演出推進時回寫當前節點（重連還原用；不影響結果） */
    saveProgress: function (roundId, node) {
      var round = S.rounds[roundId];
      if (round && round.status === "pending") round.current_node = node;
    },

    /**
     * GET /round/pending ── 斷線（重新整理）重連還原。
     * 回傳三態之一：
     *   null                                ── 無未結算局
     *   { status:"pending", round, current_node } ── 還原至決策狀態
     *   { status:"auto_settled", settlement }     ── 斷線期間自動收兵已由「後台」執行（§2.7-4）
     */
    getPending: function () {
      if (!S.pendingRoundId) return null;
      var round = S.rounds[S.pendingRoundId];

      if (round.auto_cashout_node !== null) {
        var settlement = (round.auto_cashout_node < round.outcome.extinguish_at)
          ? settle(round, "cashed_out", round.auto_cashout_node)
          : settle(round, round.outcome.cleared ? "cleared" : "extinguished");
        return { status: "auto_settled", settlement: settlement };
      }

      return {
        status: "pending",
        current_node: round.current_node,
        round: {
          round_id: round.round_id,
          bet_amount: round.bet_amount,
          auto_cashout_node: round.auto_cashout_node,
          outcome: round.outcome
        }
      };
    },

    /** GET /history */
    getHistory: function (limit) {
      return S.history.slice(0, limit || 50);
    },

    getBalance: function () { return S.balance; },
    getJackpot: function () { return S.jackpot; },

    // ── Demo / T08 專用 ──
    _dump: function () { return JSON.stringify(S); },
    _load: function (json) { if (json) S = JSON.parse(json); },
    _reset: function () { S = freshState(); },

    ping: function () { return "mock-server.js OK（deps: " + GameTables.ping() + "）"; },

    _init: function () { if (!S) S = freshState(); }
  };
})();

MockServer._init();
