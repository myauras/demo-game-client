/* ============================================================
 * game.js ── 狀態機 + UI 綁定 + 演出 + localStorage【混合】
 *
 * 前半：GameState 狀態機【可移植規則】—— 零 DOM 依賴，
 *       轉 Cocos / Unity 時流轉規則照搬。
 * 後半：開機自檢與 UI 綁定【拋棄式】（UI 於 T05、演出於 T06–T07）。
 *
 * 狀態流（規則書 §2.2）：
 *   IDLE ─ startRound() → BURNING(n) ─ 燒穿 → DECISION(n)
 *     DECISION：continueBurn() / cashOut() / 逾時（依設定）
 *     ─ 燒穿第 12 節 → CLEARED 強制結算
 *     ─ 到達熄滅節 → EXTINGUISHED
 *   → SETTLING → IDLE
 * ============================================================ */

var GameState = (function () {
  "use strict";

  // 演出時長（§1.2）。fx 層（T07）可用 setDurations 調整；
  // decision 是「規則」時限（§R4 = 3 秒），不隨演出壓縮。
  var durations = {
    burn: 900,          // 火勢燒向下一艘（可壓縮）
    decision: 3000,     // 決策時限（規則，不壓縮）
    settleWin: 1000,    // 收兵演出 0.8–1.2s（可壓縮）
    settleLose: 1350,   // 熄滅演出 1.2–1.5s（可壓縮）
    settleClear: 2800,  // 通關演出 2.5–3.0s（不可跳過、不壓縮）
    payout: 400         // 派彩入帳 0.4s（不可省略、不壓縮）
  };
  var COMPRESS_RATIO = 0.4;        // 連續遊玩演出壓縮至 40%（§1.2）
  var COMPRESS_WINDOW_MS = 10000;  // 前一局結束 10 秒內再開局 = 連續遊玩

  var settings = {
    timeoutAction: "continue",     // continue | cash_out（§R4，玩家可於設定改）
    firstPlayHintShown: false,     // 首次進決策前提示「逾時將自動續燒」
    compressEnabled: true          // 連續遊玩演出壓縮開關（設定面板可關）
  };

  var onEvent = function () {};
  var st = null;                   // 當前局 runtime；null = IDLE
  var lastRoundEndAt = 0;
  var timers = [];
  var tickInterval = null;

  function emit(type, data) { onEvent(type, data || {}); }

  function after(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  }

  function scale(ms) { return st && st.compressed ? Math.max(1, Math.round(ms * COMPRESS_RATIO)) : ms; }

  function uuid() {
    return "xxxxxxxx-4xxx".replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }) + "-" + Date.now();
  }

  function ladder() { return st.round.outcome.ladder; }

  // ── 流轉 ──

  function startRound(opts) {
    if (st) return false; // 已有局進行中
    var auto = opts && Number.isInteger(opts.autoCashoutNode) ? opts.autoCashoutNode : null;
    var resp = MockServer.bet({
      bet_amount: opts.betAmount,
      game_params: { auto_cashout_node: auto },
      idempotency_key: uuid()
    });
    st = {
      round: resp,
      node: 0,
      state: "BURNING",
      auto: auto,
      compressed: settings.compressEnabled && lastRoundEndAt > 0 && (Date.now() - lastRoundEndAt) < COMPRESS_WINDOW_MS
    };
    emit("round_start", {
      round_id: resp.round_id,
      wind: resp.outcome.wind,
      ladder: resp.outcome.ladder,
      bet_amount: resp.bet_amount,
      balance_after: resp.balance_after,
      auto_cashout_node: auto,
      compressed: st.compressed
    });
    burnTo(1);
    return true;
  }

  function burnTo(n) {
    st.state = "BURNING";
    st.node = n;
    emit("state", { state: "BURNING", node: n, compressed: st.compressed });
    after(scale(durations.burn), function () { resolveNode(n); });
  }

  /** 火勢抵達第 n 節：熄滅或燒穿（結果早已由 bet 抽定，這裡只是照著演） */
  function resolveNode(n) {
    if (n >= st.round.outcome.extinguish_at) return finish("extinguished");
    emit("node_burned", { node: n, multiplier: ladder()[n - 1] });
    if (n === GameTables.MAX_NODES) return finish("cleared"); // 燒穿第 12 艘 → 強制結算（§2.2）
    enterDecision(n);
  }

  function enterDecision(n) {
    st.state = "DECISION";
    MockServer.saveProgress(st.round.round_id, n); // 重連還原點（T08）

    if (!settings.firstPlayHintShown) {
      settings.firstPlayHintShown = true;
      emit("hint_first_decision", { timeoutAction: settings.timeoutAction });
    }

    emit("state", {
      state: "DECISION",
      node: n,
      multiplier: ladder()[n - 1],
      next_multiplier: ladder()[n],           // n ≤ 11 必存在
      cash_value: Math.floor(st.round.bet_amount * ladder()[n - 1]),
      timeout_ms: durations.decision,
      timeout_action: settings.timeoutAction
    });

    // 自動收兵優先於逾時邏輯（§R3）
    if (st.auto === n) return cashOut();

    var endsAt = Date.now() + durations.decision;
    tickInterval = setInterval(function () {
      emit("timer", { remaining_ms: Math.max(0, endsAt - Date.now()), total_ms: durations.decision });
    }, 100);
    after(durations.decision, function () {
      settings.timeoutAction === "cash_out" ? cashOut() : continueBurn();
    });
  }

  /** 玩家（或逾時）選擇續燒 */
  function continueBurn() {
    if (!st || st.state !== "DECISION") return false;
    clearTimers();
    emit("decision_made", { choice: "continue", node: st.node });
    burnTo(st.node + 1);
    return true;
  }

  /** 玩家（或逾時/自動收兵）選擇收兵 */
  function cashOut() {
    if (!st || st.state !== "DECISION") return false;
    clearTimers();
    emit("decision_made", { choice: "cash_out", node: st.node });
    var res = MockServer.action({ round_id: st.round.round_id, action: "cash_out", at_node: st.node });
    settle("cashed_out", res, scale(durations.settleWin));
    return true;
  }

  /** 熄滅 / 通關：ack 落帳 */
  function finish(kind) {
    var res = MockServer.ack(st.round.round_id);
    var dur = kind === "cleared" ? durations.settleClear /* 不可跳過不壓縮 */
                                 : scale(durations.settleLose);
    settle(kind, res, dur);
  }

  function settle(result, res, settleMs) {
    st.state = "SETTLING";
    emit("state", { state: "SETTLING", result: result });
    emit("settled", {
      result: result,                                  // cashed_out | extinguished | cleared
      node: res.node,
      multiplier: res.multiplier,
      payout: res.payout,
      balance_after: res.balance_after,
      jackpot_award: result === "cleared" ? st.round.outcome.jackpot_award : 0,
      extinguish_at: st.round.outcome.extinguish_at,   // 結算後可揭露
      wind: st.round.outcome.wind
    });
    after(settleMs, function () {
      after(durations.payout, endRound);               // 派彩入帳 0.4s 不可省略
      emit("payout_anim", { duration_ms: durations.payout });
    });
  }

  function endRound() {
    clearTimers();
    st = null;
    lastRoundEndAt = Date.now();
    emit("state", { state: "IDLE" });
    emit("round_end", { balance: MockServer.getBalance(), jackpot: MockServer.getJackpot() });
  }

  // ── 對外 ──

  return {
    configure: function (o) { if (o && o.onEvent) onEvent = o.onEvent; },
    setDurations: function (d) { Object.keys(d || {}).forEach(function (k) { if (k in durations) durations[k] = d[k]; }); },
    setSettings: function (s) { Object.keys(s || {}).forEach(function (k) { if (k in settings) settings[k] = s[k]; }); },
    getSettings: function () { return { timeoutAction: settings.timeoutAction, firstPlayHintShown: settings.firstPlayHintShown, compressEnabled: settings.compressEnabled }; },
    startRound: startRound,
    continueBurn: continueBurn,
    cashOut: cashOut,
    getState: function () {
      return st ? { state: st.state, node: st.node, round_id: st.round.round_id, compressed: st.compressed }
                : { state: "IDLE" };
    },
    /** 強制中止（重連還原前清場用，T08） */
    abort: function () { clearTimers(); st = null; },
    ping: function () { return "GameState OK"; }
  };
})();

/* ============================================================
 * 以下為拋棄式資產：UI 綁定（T05）。演出質感於 T06–T07 升級。
 * ============================================================ */

(function () {
  "use strict";

  function init() {
    var $ = function (id) { return document.getElementById(id); };
    var cfg = MockServer.getConfig();
    var LIM = cfg.bet_limits;
    var STEP = 10;
    var betAmount = 100;
    var toastTimer = null;

    function fmt(n) { return n.toLocaleString("en-US"); }
    function fx2(x) { return x.toFixed(2) + "x"; }

    // ── 建立 12 艘船與 12 節階梯 ──
    var shipsEl = $("ships"), ladderEl = $("ladder-scroll");
    for (var i = 1; i <= GameTables.MAX_NODES; i++) {
      var s = document.createElement("div"); s.className = "ship"; shipsEl.appendChild(s);
      var c = document.createElement("div"); c.className = "lcell"; ladderEl.appendChild(c);
    }
    function ships() { return shipsEl.children; }
    function lcells() { return ladderEl.children; }

    function setLadder(l) {
      for (var i = 0; i < 12; i++) { lcells()[i].textContent = fx2(l[i]); lcells()[i].className = "lcell"; }
    }
    function ladderHi(node) {
      for (var i = 0; i < 12; i++) lcells()[i].className = "lcell" + (i + 1 < node ? " past" : i + 1 === node ? " cur" : "");
      var cell = lcells()[node - 1];
      $("ladder").scrollTo({ left: Math.max(0, cell.offsetLeft - 140), behavior: "smooth" });
    }
    function resetShips() { for (var i = 0; i < 12; i++) ships()[i].className = "ship"; }
    function shipCls(node, cls) { ships()[node - 1].className = "ship " + cls; }

    function toast(msg, ms) {
      var t = $("toast");
      t.textContent = msg; t.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.style.display = "none"; }, ms || 2800);
    }

    function refreshMoney() {
      $("balance").textContent = fmt(MockServer.getBalance());
      $("jackpot").textContent = fmt(MockServer.getJackpot());
    }

    // ── 注額控制 ──
    function setBet(v) {
      betAmount = Math.min(LIM.max, Math.max(LIM.min, Math.round(v / STEP) * STEP || LIM.min));
      $("bet-amount").textContent = fmt(betAmount);
      updateIgnite();
    }
    $("bet-minus").onclick = function () { setBet(betAmount - STEP); };
    $("bet-plus").onclick = function () { setBet(betAmount + STEP); };
    $("bet-half").onclick = function () { setBet(Math.floor(betAmount / 2 / STEP) * STEP); };
    $("bet-max").onclick = function () { setBet(Math.min(LIM.max, MockServer.getBalance())); };

    function updateIgnite() {
      var bal = MockServer.getBalance();
      var ok = betAmount <= bal;
      $("btn-ignite").disabled = !ok;
      $("ignite-sub").textContent = ok ? "注額 " + fmt(betAmount) : "餘額不足（設定內可重置錢包）";
    }

    // ── 自動收兵 ──
    var autoOn = false;
    $("auto-toggle").onclick = function () {
      autoOn = !autoOn;
      this.classList.toggle("on", autoOn);
    };
    function autoNode() {
      var n = parseInt($("auto-node").value, 10);
      return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 8;
    }

    // ── 模式切換 ──
    function setMode(mode) { // idle | playing
      var idle = mode === "idle";
      $("btn-ignite").style.display = idle ? "flex" : "none";
      $("btn-continue").style.display = idle ? "none" : "flex";
      $("btn-cash").style.display = idle ? "none" : "flex";
      ["bet-minus", "bet-plus", "bet-half", "bet-max"].forEach(function (id) { $(id).disabled = !idle; });
      $("auto-row").classList.toggle("disabled", !idle);
      if (idle) updateIgnite();
    }
    function setDecisionEnabled(on) {
      $("btn-continue").disabled = !on;
      $("btn-cash").disabled = !on;
    }
    function timerShow(on) {
      $("timer-wrap").style.visibility = on ? "visible" : "hidden";
      if (on) $("timer-bar").style.width = "100%";
    }

    // ── 操作 ──
    $("btn-ignite").onclick = function () {
      if (betAmount > MockServer.getBalance()) return toast("餘額不足");
      GameState.startRound({ betAmount: betAmount, autoCashoutNode: autoOn ? autoNode() : null });
    };
    $("btn-continue").onclick = function () { GameState.continueBurn(); };
    $("btn-cash").onclick = function () { GameState.cashOut(); };

    // ── 設定面板 ──
    $("btn-settings").onclick = function (e) {
      e.stopPropagation();
      $("settings-panel").classList.toggle("open");
    };
    document.addEventListener("click", function (e) {
      if (!$("settings-panel").contains(e.target) && e.target.id !== "btn-settings")
        $("settings-panel").classList.remove("open");
    });
    Array.prototype.forEach.call(document.querySelectorAll("input[name=timeout]"), function (r) {
      r.onchange = function () { GameState.setSettings({ timeoutAction: this.value }); };
    });
    $("opt-compress").onchange = function () { GameState.setSettings({ compressEnabled: this.checked }); };
    $("btn-reset-wallet").onclick = function () {
      if (GameState.getState().state !== "IDLE") return toast("局進行中不可重置");
      MockServer._reset();
      refreshMoney(); updateIgnite();
      toast("錢包已重置");
    };

    // ── 狀態機事件 → 畫面 ──
    var WIND_TXT = cfg.game_config.wind_labels;

    GameState.configure({ onEvent: function (t, d) {
      switch (t) {
        case "round_start":
          setLadder(d.ladder);
          resetShips();
          $("wind-badge").textContent = "風向：" + WIND_TXT[d.wind];
          $("wind-badge").className = d.wind;
          $("river").className = "wind-" + d.wind;
          $("river-msg").textContent = d.compressed ? "連續遊玩・演出加速中" : "";
          $("balance").textContent = fmt(d.balance_after);
          $("mult").textContent = "1.00x";
          $("mult").className = "";
          $("mult-sub").textContent = "點火！";
          setMode("playing");
          setDecisionEnabled(false);
          break;

        case "state":
          if (d.state === "BURNING") {
            setDecisionEnabled(false);
            timerShow(false);
            shipCls(d.node, "cur");
            $("mult-sub").textContent = "火勢燒向第 " + d.node + " 艘…";
          } else if (d.state === "DECISION") {
            $("mult").textContent = fx2(d.multiplier);
            $("mult").className = d.node >= 9 ? "hot" : "";
            $("mult-sub").textContent = "第 " + d.node + " 節｜3 秒內決定";
            $("cont-sub").textContent = "下一節 " + fx2(d.next_multiplier);
            $("cash-sub").textContent = "落袋 " + fmt(d.cash_value);
            setDecisionEnabled(true);
            timerShow(true);
          } else if (d.state === "SETTLING") {
            setDecisionEnabled(false);
            timerShow(false);
          } else if (d.state === "IDLE") {
            setMode("idle");
          }
          break;

        case "node_burned":
          shipCls(d.node, "burned");
          $("mult").textContent = fx2(d.multiplier);
          ladderHi(d.node);
          break;

        case "timer":
          $("timer-bar").style.width = (d.remaining_ms / d.total_ms * 100) + "%";
          break;

        case "decision_made":
          setDecisionEnabled(false);
          timerShow(false);
          break;

        case "settled":
          $("balance").textContent = fmt(d.balance_after);
          if (d.result === "cashed_out") {
            $("mult").className = "win";
            $("mult-sub").textContent = "收兵成功　+" + fmt(d.payout);
            $("river-msg").textContent = "鳴金收兵，落袋為安";
          } else if (d.result === "extinguished") {
            shipCls(d.extinguish_at, "ext");
            $("mult").className = "lose";
            $("mult").textContent = "熄滅";
            $("mult-sub").textContent = "江風吹熄於第 " + d.extinguish_at + " 節，本局全損";
            $("river-msg").textContent = "風向突變，火勢已熄";
          } else if (d.result === "cleared") {
            $("mult").className = "hot";
            $("mult-sub").textContent = "火燒連營！+" + fmt(d.payout) + "（含彩金 " + fmt(d.jackpot_award) + "）";
            $("river-msg").textContent = "燒穿十二艘，火燒連營！";
          }
          break;

        case "round_end":
          $("balance").textContent = fmt(d.balance);
          $("jackpot").textContent = fmt(d.jackpot);
          updateIgnite();
          break;

        case "hint_first_decision":
          toast(d.timeoutAction === "continue"
            ? "提示：3 秒未操作將自動「續燒」，可於右上設定改為自動收兵"
            : "提示：3 秒未操作將自動「收兵」", 3500);
          break;
      }
    }});

    // ── 初始畫面 ──
    setLadder(cfg.game_config.ladders.standard);
    refreshMoney();
    setMode("idle");
    console.log("[boot]", GameTables.ping(), "|", MockServer.ping(), "|", GameState.ping(), "| UI ready");
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
