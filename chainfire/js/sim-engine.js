/* ============================================================
 * sim-engine.js ── RTP 模擬引擎【驗證工具】
 * 直接呼叫 MockServer（同一套 RNG 與結算路徑，不另寫邏輯）。
 * 無 DOM 依賴：sim.html 與 Node CLI 共用。
 *
 * 口徑說明：
 *   - RTP（基準）：basePayout / bet，不含獎池彩金（§R6：抽水 1%
 *     不計入 96% RTP，獎池回流另計）。
 *   - 通關局的 payout 拆成 base（第12節倍率派彩）與 jackpot_award。
 * ============================================================ */

var SimEngine = (function () {
  "use strict";

  var WINDS = ["gentle", "standard", "east_wind"];

  function newWindStat() {
    return {
      rounds: 0, bet: 0, basePayout: 0, jackpotPaid: 0,
      clears: 0, sumSqMult: 0,
      extDist: new Array(14).fill(0)   // index 1–12 = 該節熄滅；13 = 通關
    };
  }

  /**
   * 建立一次模擬。opts:
   *   rounds     總局數
   *   strategy   'never' | 'fixed' | 'random' | 'auto'
   *   node       fixed / auto 的目標節點（1–12）
   *   betAmount  預設 100
   * 回傳 { step(n), progress(), stats, opts }；step 回傳是否完成。
   */
  function createRun(opts) {
    var total = opts.rounds;
    var done = 0;
    var bet = opts.betAmount || 100;
    var stats = {};
    WINDS.forEach(function (w) { stats[w] = newWindStat(); });

    MockServer._reset();

    function playOne() {
      if (MockServer.getBalance() < bet) MockServer._reset();

      var target =
        opts.strategy === "fixed" || opts.strategy === "auto" ? opts.node :
        opts.strategy === "random" ? 1 + Math.floor(Math.random() * 12) : null;

      var r, res;
      if (opts.strategy === "auto") {
        r = MockServer.bet({ bet_amount: bet, game_params: { auto_cashout_node: target } });
        res = MockServer.getPending().settlement; // 一定是 auto_settled
      } else {
        r = MockServer.bet({ bet_amount: bet });
        if (target !== null && r.outcome.extinguish_at > target) {
          res = MockServer.action({ round_id: r.round_id, action: "cash_out", at_node: target });
        } else {
          res = MockServer.ack(r.round_id); // 熄滅或（永不收時）通關
        }
      }

      var award = res.result === "cleared" ? r.outcome.jackpot_award : 0;
      var basePay = res.payout - award;

      var st = stats[r.outcome.wind];
      st.rounds++;
      st.bet += bet;
      st.basePayout += basePay;
      st.jackpotPaid += award;
      st.extDist[r.outcome.extinguish_at]++;
      if (r.outcome.extinguish_at === 13) st.clears++;
      var m = basePay / bet;
      st.sumSqMult += m * m;
    }

    return {
      step: function (n) {
        var k = Math.min(n, total - done);
        for (var i = 0; i < k; i++) playOne();
        done += k;
        return done >= total;
      },
      progress: function () { return total ? done / total : 1; },
      stats: stats,
      opts: opts
    };
  }

  /** 統計整理：每套風向的實測 RTP、±3σ、通關率、熄滅分佈（實測 vs 理論） */
  function summarize(stats) {
    var out = { winds: {}, overall: { rounds: 0, bet: 0, basePayout: 0, jackpotPaid: 0 } };
    WINDS.forEach(function (w) {
      var st = stats[w];
      var rows = GameTables.DERIVED[w];
      var mean = st.rounds ? st.basePayout / st.bet : 0;
      var meanPerRound = st.rounds ? (st.basePayout / st.rounds) / (st.bet / st.rounds) : 0;
      var variance = st.rounds ? Math.max(0, st.sumSqMult / st.rounds - meanPerRound * meanPerRound) : 0;
      var se = st.rounds ? Math.sqrt(variance / st.rounds) : 0;

      // 理論熄滅分佈：P(ext=n) = S_{n-1} − S_n；P(通關) = S_12
      var expDist = [];
      var prevS = 1;
      for (var i = 0; i < rows.length; i++) {
        expDist.push(prevS - rows[i].survival);
        prevS = rows[i].survival;
      }
      expDist.push(prevS); // 通關

      out.winds[w] = {
        label: GameTables.WIND_LABELS[w],
        rounds: st.rounds,
        rtp: mean * 100,
        rtp3sigma: se * 3 * 100,
        clearRate: st.rounds ? st.clears / st.rounds * 100 : 0,
        clearRateExpected: rows[rows.length - 1].survival * 100,
        jackpotPaid: st.jackpotPaid,
        extDistActual: st.extDist.slice(1).map(function (c) { return st.rounds ? c / st.rounds * 100 : 0; }),
        extDistExpected: expDist.map(function (p) { return p * 100; })
      };
      out.overall.rounds += st.rounds;
      out.overall.bet += st.bet;
      out.overall.basePayout += st.basePayout;
      out.overall.jackpotPaid += st.jackpotPaid;
    });
    out.overall.rtp = out.overall.bet ? out.overall.basePayout / out.overall.bet * 100 : 0;
    return out;
  }

  /** 恆定 EV 解析驗證：每節 M_n × S_n 應恰為 RTP（浮點容差內） */
  function analyticCheck() {
    var issues = [];
    WINDS.forEach(function (w) {
      GameTables.DERIVED[w].forEach(function (row) {
        var ev = row.multiplier * row.survival;
        if (Math.abs(ev - GameTables.RTP) > 1e-9) {
          issues.push(w + " 第 " + row.node + " 節 EV=" + ev);
        }
      });
    });
    return { pass: issues.length === 0, issues: issues };
  }

  return {
    WINDS: WINDS,
    createRun: createRun,
    summarize: summarize,
    analyticCheck: analyticCheck,
    ping: function () { return "sim-engine.js OK"; }
  };
})();

/* Node CLI 環境相容（瀏覽器忽略） */
if (typeof module !== "undefined" && module.exports) module.exports = SimEngine;
