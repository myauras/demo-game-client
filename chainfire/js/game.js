/* ============================================================
 * game.js ── 狀態機 + UI 綁定 + 演出 + localStorage【混合】
 *
 * 前半：GameState 狀態機【可移植規則】—— 零 DOM 依賴，
 *       轉 Cocos / Unity 時流轉規則照搬。
 * 後半：UI 綁定、結果演出、持久化、規則頁/跑馬燈【拋棄式】。
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

  // 演出時長（§1.2）。decision 是「規則」時限（§R4 = 3 秒），不隨演出壓縮。
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
    timeoutAction: "continue",     // continue | cash_out（§R4）
    firstPlayHintShown: false,     // 首次進決策前提示
    compressEnabled: true          // 連續遊玩演出壓縮開關
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

  function startRound(opts) {
    if (st) return false;
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
    emit("state", { state: "BURNING", node: n, compressed: st.compressed, burn_ms: scale(durations.burn) });
    after(scale(durations.burn), function () { resolveNode(n); });
  }

  /** 火勢抵達第 n 節：熄滅或燒穿（結果早已由 bet 抽定） */
  function resolveNode(n) {
    if (n >= st.round.outcome.extinguish_at) return finish("extinguished");
    emit("node_burned", { node: n, multiplier: ladder()[n - 1] });
    if (n === GameTables.MAX_NODES) return finish("cleared");
    enterDecision(n);
  }

  function enterDecision(n) {
    st.state = "DECISION";
    MockServer.saveProgress(st.round.round_id, n);

    if (!settings.firstPlayHintShown) {
      settings.firstPlayHintShown = true;
      emit("hint_first_decision", { timeoutAction: settings.timeoutAction });
    }

    emit("state", {
      state: "DECISION",
      node: n,
      multiplier: ladder()[n - 1],
      next_multiplier: ladder()[n],
      cash_value: Math.floor(st.round.bet_amount * ladder()[n - 1]),
      timeout_ms: durations.decision,
      timeout_action: settings.timeoutAction
    });

    if (st.auto === n) return cashOut(); // 自動收兵優先（§R3）

    var endsAt = Date.now() + durations.decision;
    tickInterval = setInterval(function () {
      emit("timer", { remaining_ms: Math.max(0, endsAt - Date.now()), total_ms: durations.decision });
    }, 100);
    after(durations.decision, function () {
      settings.timeoutAction === "cash_out" ? cashOut() : continueBurn();
    });
  }

  function continueBurn() {
    if (!st || st.state !== "DECISION") return false;
    clearTimers();
    emit("decision_made", { choice: "continue", node: st.node });
    burnTo(st.node + 1);
    return true;
  }

  function cashOut() {
    if (!st || st.state !== "DECISION") return false;
    clearTimers();
    emit("decision_made", { choice: "cash_out", node: st.node });
    var res = MockServer.action({ round_id: st.round.round_id, action: "cash_out", at_node: st.node });
    settle("cashed_out", res, scale(durations.settleWin));
    return true;
  }

  function finish(kind) {
    var res = MockServer.ack(st.round.round_id);
    var dur = kind === "cleared" ? durations.settleClear : scale(durations.settleLose);
    settle(kind, res, dur);
  }

  function settle(result, res, settleMs) {
    st.state = "SETTLING";
    emit("state", { state: "SETTLING", result: result });
    emit("settled", {
      result: result,
      node: res.node,
      multiplier: res.multiplier,
      payout: res.payout,
      balance_after: res.balance_after,
      jackpot_award: result === "cleared" ? st.round.outcome.jackpot_award : 0,
      extinguish_at: st.round.outcome.extinguish_at,
      wind: st.round.outcome.wind
    });
    after(settleMs, function () {
      after(durations.payout, endRound);
      emit("payout_anim", { duration_ms: durations.payout, balance_after: res.balance_after, payout: res.payout });
    });
  }

  function endRound() {
    clearTimers();
    st = null;
    lastRoundEndAt = Date.now();
    emit("state", { state: "IDLE" });
    emit("round_end", { balance: MockServer.getBalance(), jackpot: MockServer.getJackpot() });
  }

  return {
    configure: function (o) { if (o && o.onEvent) onEvent = o.onEvent; },
    setDurations: function (d) { Object.keys(d || {}).forEach(function (k) { if (k in durations) durations[k] = d[k]; }); },
    setSettings: function (s) { Object.keys(s || {}).forEach(function (k) { if (k in settings) settings[k] = s[k]; }); },
    getSettings: function () {
      return { timeoutAction: settings.timeoutAction, firstPlayHintShown: settings.firstPlayHintShown, compressEnabled: settings.compressEnabled };
    },
    startRound: startRound,
    continueBurn: continueBurn,
    cashOut: cashOut,
    getState: function () {
      return st ? { state: st.state, node: st.node, round_id: st.round.round_id, compressed: st.compressed }
                : { state: "IDLE" };
    },
    /** 重連還原（T08）：還原至原決策狀態，不重播演出（§1.1） */
    restore: function (p) {
      if (st || !p || p.status !== "pending") return false;
      st = {
        round: {
          round_id: p.round.round_id,
          bet_amount: p.round.bet_amount,
          balance_after: MockServer.getBalance(),
          outcome: p.round.outcome
        },
        node: p.current_node,
        state: "DECISION",
        auto: p.round.auto_cashout_node,
        compressed: false
      };
      emit("round_restored", {
        round_id: p.round.round_id,
        wind: p.round.outcome.wind,
        ladder: p.round.outcome.ladder,
        bet_amount: p.round.bet_amount,
        node: p.current_node
      });
      p.current_node >= 1 ? enterDecision(p.current_node) : burnTo(1);
      return true;
    },
    abort: function () { clearTimers(); st = null; },
    ping: function () { return "GameState OK"; }
  };
})();

/* ============================================================
 * 以下為拋棄式資產：UI 綁定 + 結果演出 + 持久化 + 規則頁/跑馬燈
 * （T05–T09）。效能守則：動畫 transform/opacity、JS 不逐幀跑。
 * ============================================================ */

(function () {
  "use strict";

  function init() {
    var $ = function (id) { return document.getElementById(id); };
    var cfg = MockServer.getConfig();
    var LIM = cfg.bet_limits;
    var STEP = 10;
    var betAmount = 100;
    var autoOn = false;
    var toastTimer = null;
    var shownBalance = 0;
    var WIND_TXT = cfg.game_config.wind_labels;

    RiverFX.init();

    // 震動需在使用者實際觸碰後才允許（瀏覽器政策）
    var hasInteracted = false;
    document.addEventListener("pointerdown", function () { hasInteracted = true; }, { once: true, capture: true });
    function buzz(pattern) { if (hasInteracted && navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {} }

    function fmt(n) { return n.toLocaleString("en-US"); }
    function fx2(x) { return x.toFixed(2) + "x"; }

    /* ── 持久化（T08）── */
    var Store = {
      saveServer: function () { try { localStorage.setItem("cf_server", MockServer._dump()); } catch (e) {} },
      savePrefs: function () {
        try {
          var s = GameState.getSettings();
          localStorage.setItem("cf_prefs", JSON.stringify({
            bet: betAmount, autoOn: autoOn, autoNode: $("auto-node").value,
            timeoutAction: s.timeoutAction, compressEnabled: s.compressEnabled,
            firstPlayHintShown: s.firstPlayHintShown
          }));
        } catch (e) {}
      },
      load: function () {
        var out = { prefs: null, server: null };
        try {
          out.prefs = JSON.parse(localStorage.getItem("cf_prefs") || "null");
          out.server = localStorage.getItem("cf_server");
        } catch (e) {}
        return out;
      },
      clearServer: function () { try { localStorage.removeItem("cf_server"); } catch (e) {} }
    };

    /* ── 階梯 ── */
    var ladderEl = $("ladder-scroll");
    for (var i = 1; i <= GameTables.MAX_NODES; i++) {
      var c = document.createElement("div"); c.className = "lcell"; ladderEl.appendChild(c);
    }
    function lcells() { return ladderEl.children; }
    function setLadder(l) {
      for (var i = 0; i < 12; i++) { lcells()[i].textContent = fx2(l[i]); lcells()[i].className = "lcell"; }
    }
    function ladderHi(node) {
      for (var i = 0; i < 12; i++) lcells()[i].className = "lcell" + (i + 1 < node ? " past" : i + 1 === node ? " cur" : "");
      var cell = lcells()[node - 1];
      $("ladder").scrollTo({ left: Math.max(0, cell.offsetLeft - 140), behavior: "smooth" });
    }

    /* ── 倍率色彩曲線（T07）：金 → 橙 → 紅 ── */
    var GOLD = [255, 181, 71], ORG = [255, 138, 61], RED = [232, 83, 31];
    function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
    function multColor(node) {
      var t = (node - 1) / 11;
      var c = t < 0.5
        ? [lerp(GOLD[0], ORG[0], t * 2), lerp(GOLD[1], ORG[1], t * 2), lerp(GOLD[2], ORG[2], t * 2)]
        : [lerp(ORG[0], RED[0], (t - .5) * 2), lerp(ORG[1], RED[1], (t - .5) * 2), lerp(ORG[2], RED[2], (t - .5) * 2)];
      return "rgb(" + c.join(",") + ")";
    }
    function popMult() {
      $("mult").classList.remove("pop");
      void $("mult").offsetWidth; // 重新觸發動畫
      $("mult").classList.add("pop");
    }

    function toast(msg, ms) {
      var t = $("toast");
      t.textContent = msg; t.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.style.display = "none"; }, ms || 2800);
    }

    function setBalanceText(v) { shownBalance = v; $("balance").textContent = fmt(v); }
    function refreshMoney() { setBalanceText(MockServer.getBalance()); $("jackpot").textContent = fmt(MockServer.getJackpot()); }

    /** 派彩入帳動畫（0.4s，不可省略）：餘額滾動 + 飄字 */
    function payoutAnim(target, payout, ms) {
      if (payout > 0) {
        var fly = $("payout-fly");
        fly.textContent = "+" + fmt(payout);
        fly.classList.remove("go"); void fly.offsetWidth; fly.classList.add("go");
      }
      var from = shownBalance, t0 = Date.now();
      var iv = setInterval(function () {
        var t = Math.min(1, (Date.now() - t0) / ms);
        setBalanceText(Math.round(from + (target - from) * t));
        if (t >= 1) clearInterval(iv);
      }, 40);
    }

    /* ── 注額 ── */
    function setBet(v) {
      betAmount = Math.min(LIM.max, Math.max(LIM.min, Math.round(v / STEP) * STEP || LIM.min));
      $("bet-amount").textContent = fmt(betAmount);
      updateIgnite(); Store.savePrefs();
    }
    $("bet-minus").onclick = function () { setBet(betAmount - STEP); };
    $("bet-plus").onclick = function () { setBet(betAmount + STEP); };
    $("bet-half").onclick = function () { setBet(Math.floor(betAmount / 2 / STEP) * STEP); };
    $("bet-max").onclick = function () { setBet(Math.min(LIM.max, MockServer.getBalance())); };

    function updateIgnite() {
      var ok = betAmount <= MockServer.getBalance();
      $("btn-ignite").disabled = !ok;
      $("ignite-sub").textContent = ok ? "注額 " + fmt(betAmount) : "餘額不足（設定內可重置錢包）";
    }

    /* ── 自動收兵 ── */
    $("auto-toggle").onclick = function () {
      autoOn = !autoOn;
      this.classList.toggle("on", autoOn);
      Store.savePrefs();
    };
    $("auto-node").onchange = function () { Store.savePrefs(); };
    function autoNode() {
      var n = parseInt($("auto-node").value, 10);
      return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 8;
    }

    /* ── 模式 ── */
    function setMode(mode) {
      var idle = mode === "idle";
      $("btn-ignite").style.display = idle ? "flex" : "none";
      $("btn-continue").style.display = idle ? "none" : "flex";
      $("btn-cash").style.display = idle ? "none" : "flex";
      ["bet-minus", "bet-plus", "bet-half", "bet-max"].forEach(function (id) { $(id).disabled = !idle; });
      $("auto-row").classList.toggle("disabled", !idle);
      if (idle) updateIgnite();
    }
    function setDecisionEnabled(on) { $("btn-continue").disabled = !on; $("btn-cash").disabled = !on; }
    function timerShow(on) {
      $("timer-wrap").style.visibility = on ? "visible" : "hidden";
      if (on) $("timer-bar").style.transform = "scaleX(1)";
    }

    /* ── 操作 ── */
    $("btn-ignite").onclick = function () {
      if (betAmount > MockServer.getBalance()) return toast("餘額不足");
      GameState.startRound({ betAmount: betAmount, autoCashoutNode: autoOn ? autoNode() : null });
    };
    $("btn-continue").onclick = function () { GameState.continueBurn(); };
    $("btn-cash").onclick = function () { GameState.cashOut(); };

    /* ── 設定面板 ── */
    $("btn-settings").onclick = function (e) { e.stopPropagation(); $("settings-panel").classList.toggle("open"); };
    document.addEventListener("click", function (e) {
      if (!$("settings-panel").contains(e.target) && e.target.id !== "btn-settings")
        $("settings-panel").classList.remove("open");
    });
    Array.prototype.forEach.call(document.querySelectorAll("input[name=timeout]"), function (r) {
      r.onchange = function () { GameState.setSettings({ timeoutAction: this.value }); Store.savePrefs(); };
    });
    $("opt-compress").onchange = function () { GameState.setSettings({ compressEnabled: this.checked }); Store.savePrefs(); };
    $("btn-reset-wallet").onclick = function () {
      if (GameState.getState().state !== "IDLE") return toast("局進行中不可重置");
      MockServer._reset(); Store.saveServer();
      RiverFX.reset(); refreshMoney(); updateIgnite();
      $("wind-badge").textContent = "待點火"; $("wind-badge").className = "";
      $("mult").textContent = "--"; $("mult").className = ""; $("mult").style.color = "";
      $("mult-sub").textContent = "設定注額後點火出擊";
      toast("錢包已重置");
    };

    /* ── 規則頁（T09；表格由 tables.js 程式生成，非手抄）── */
    function buildRules() {
      var winds = ["gentle", "standard", "east_wind"];
      var h = '<button class="close" id="rules-close">✕</button><h3>遊戲規則</h3>' +
        '<p>點火燒鐵索連環船，每燒穿一艘可選「續燒」搏更高倍率、或「收兵」按當前倍率落袋。火勢隨時可能被江風吹熄——熄滅則本局全損。燒穿全部 12 艘觸發「火燒連營」，按最高倍率結算並派發獎池彩金。</p>' +
        '<h4>理論 RTP（返還率）揭露</h4><p>本遊戲理論 RTP 為 <b>' + cfg.rtp + '%</b>。三套風向的 RTP 完全相同，任一節點收兵的期望值一致；差異僅在波動度。結果由亂數決定。</p>' +
        '<h4>風向與倍率階梯（出現機率 35% / 50% / 15%）</h4>' +
        '<table><tr><th>節</th>';
      winds.forEach(function (w) { h += "<th>" + WIND_TXT[w] + "</th>"; });
      h += "</tr>";
      for (var n = 0; n < 12; n++) {
        h += "<tr><td>" + (n + 1) + "</td>";
        winds.forEach(function (w) { h += "<td>" + GameTables.LADDERS[w][n].toFixed(2) + "x</td>"; });
        h += "</tr>";
      }
      h += "<tr><th>通關率</th>";
      winds.forEach(function (w) {
        h += "<th>" + (GameTables.DERIVED[w][11].survival * 100).toFixed(2) + "%</th>";
      });
      h += "</tr></table>" +
        '<h4>決策時限</h4><p>每節有 3 秒決策時間，逾時預設「自動續燒」（可於設定改為自動收兵）。可預設「燒到第 N 節自動收兵」。</p>' +
        '<h4>獎池</h4><p>平台於每注抽出注額的 1% 撥入全服獎池——<b>由平台自毛利支付，玩家不需額外付費</b>（獎池回流不計入上述 RTP，屬額外回饋）。通關時按風向派發獎池：微風 3.13%／江風 10%／東風大作 32%（比例＝最終倍率÷150，各風向期望回流相等），餘額滾存。</p>' +
        '<h4>斷線保障</h4><p>斷線重連後自動還原未結算局至原決策狀態；已設定的自動收兵在斷線期間仍會執行。</p>' +
        '<button class="fair-btn" id="fair-btn">公平性驗證（Provably Fair）</button>';
      $("rules-modal").innerHTML = h;
      $("rules-close").onclick = function () { $("rules-mask").classList.remove("open"); };
      $("fair-btn").onclick = function () { toast("Demo 版未實作 Provably Fair（正式版提供 server seed 驗算）"); };
    }
    $("btn-rules").onclick = function () { buildRules(); $("rules-mask").classList.add("open"); };
    $("rules-mask").onclick = function (e) { if (e.target === this) this.classList.remove("open"); };

    /* ── 歷史（T08）── */
    var RESULT_TXT = { cashed_out: "收兵", extinguished: "熄滅", cleared: "火燒連營" };
    $("btn-history").onclick = function () {
      var rows = MockServer.getHistory(50);
      var h = '<button class="close" id="hist-close">✕</button><h3>注單歷史</h3>';
      if (!rows.length) h += "<p>尚無紀錄</p>";
      else {
        h += "<table><tr><th>時間</th><th>風向</th><th>結果</th><th>節</th><th>倍率</th><th>派彩</th></tr>";
        rows.forEach(function (r) {
          var t = new Date(r.created_at);
          h += "<tr><td>" + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) +
            "</td><td>" + WIND_TXT[r.wind] + "</td><td>" + RESULT_TXT[r.result] + "</td><td>" + r.node +
            "</td><td>" + (r.multiplier ? r.multiplier.toFixed(2) + "x" : "—") +
            "</td><td>" + fmt(r.payout) + "</td></tr>";
        });
        h += "</table>";
      }
      $("history-modal").innerHTML = h;
      $("hist-close").onclick = function () { $("history-mask").classList.remove("open"); };
      $("history-mask").classList.add("open");
    };
    $("history-mask").onclick = function (e) { if (e.target === this) this.classList.remove("open"); };

    /* ── 跑馬燈 + 獎池氛圍（T09）── */
    var pendingTicks = [];
    function fakeTick() {
      var names = ["周***", "黃***", "甘***", "呂***", "陸***", "太史**", "程***", "凌***"];
      var winds = ["standard", "standard", "gentle", "east_wind"];
      var w = winds[Math.random() * winds.length | 0];
      // 偏向低節點才像真的
      var node = 1 + Math.floor(Math.pow(Math.random(), 2.2) * 11);
      var m = GameTables.LADDERS[w][node - 1];
      var amt = [100, 200, 500, 1000][Math.random() * 4 | 0] * m;
      return "🔥 " + names[Math.random() * names.length | 0] + " 於" + WIND_TXT[w] + "第 " + node + " 節收兵 " + m.toFixed(2) + "x，落袋 " + fmt(Math.floor(amt));
    }
    var ticker = $("ticker");
    ticker.textContent = fakeTick();
    ticker.addEventListener("animationiteration", function () {
      ticker.textContent = pendingTicks.length ? pendingTicks.shift() : fakeTick();
    });
    setInterval(function () {
      // 模擬他池注水：讓獎池緩慢遞增（顯示值 = 池的真值）
      $("jackpot").textContent = fmt(MockServer._ambientJackpot(3 + Math.random() * 30 | 0));
    }, 4000);

    /* ── 結果演出（T07）── */
    function showClearOverlay(payout, award) {
      $("clear-amount").textContent = "+" + fmt(payout) + "（含彩金 " + fmt(award) + "）";
      $("clear-overlay").classList.add("show");
      buzz([120, 60, 240]);
    }

    /* ── 狀態機事件 → 畫面 ── */
    GameState.configure({ onEvent: function (t, d) {
      switch (t) {
        case "round_start":
          setLadder(d.ladder);
          RiverFX.reset();
          RiverFX.setWind(d.wind);
          $("wind-badge").textContent = "風向：" + WIND_TXT[d.wind];
          $("wind-badge").className = d.wind;
          setBalanceText(d.balance_after);
          $("mult").textContent = "1.00x";
          $("mult").className = ""; $("mult").style.color = "";
          $("mult-sub").textContent = d.compressed ? "點火！（演出加速中）" : "點火！";
          setMode("playing");
          setDecisionEnabled(false);
          Store.saveServer();
          break;

        case "round_restored":
          setLadder(d.ladder);
          RiverFX.restore(d.node, d.wind);
          $("wind-badge").textContent = "風向：" + WIND_TXT[d.wind];
          $("wind-badge").className = d.wind;
          setBalanceText(MockServer.getBalance());
          if (d.node >= 1) {
            $("mult").textContent = fx2(d.ladder[d.node - 1]);
            $("mult").style.color = multColor(d.node);
            ladderHi(d.node);
          }
          setMode("playing");
          $("restore-bar").style.display = "block";
          setTimeout(function () { $("restore-bar").style.display = "none"; }, 3200);
          break;

        case "state":
          if (d.state === "BURNING") {
            setDecisionEnabled(false);
            timerShow(false);
            RiverFX.burning(d.node, d.burn_ms);
            $("mult-sub").textContent = "火勢燒向第 " + d.node + " 艘…";
          } else if (d.state === "DECISION") {
            $("mult").textContent = fx2(d.multiplier);
            $("mult").style.color = multColor(d.node);
            $("mult-sub").textContent = "第 " + d.node + " 節｜3 秒內決定";
            $("cont-sub").textContent = "下一節 " + fx2(d.next_multiplier);
            $("cash-sub").textContent = "落袋 " + fmt(d.cash_value);
            setDecisionEnabled(true);
            timerShow(true);
            Store.saveServer(); // 決策點快照（重連還原）
          } else if (d.state === "SETTLING") {
            setDecisionEnabled(false);
            timerShow(false);
          } else if (d.state === "IDLE") {
            setMode("idle");
          }
          break;

        case "node_burned":
          RiverFX.burned(d.node);
          $("mult").textContent = fx2(d.multiplier);
          $("mult").style.color = multColor(d.node);
          popMult();
          ladderHi(d.node);
          break;

        case "timer":
          $("timer-bar").style.transform = "scaleX(" + (d.remaining_ms / d.total_ms) + ")";
          break;

        case "decision_made":
          setDecisionEnabled(false);
          timerShow(false);
          break;

        case "settled":
          if (d.result === "cashed_out") {
            $("mult").style.color = "#c9a227";
            $("mult-sub").textContent = "收兵成功　+" + fmt(d.payout);
            if (d.node >= 9) buzz(40);
          } else if (d.result === "extinguished") {
            RiverFX.burning(d.extinguish_at, 300);
            RiverFX.extinguished(d.extinguish_at);
            $("mult").className = "lose"; $("mult").style.color = "";
            $("mult").textContent = "熄滅";
            $("mult-sub").textContent = "火勢熄滅於第 " + d.extinguish_at + " 節，本局全損";
            buzz(60);
          } else if (d.result === "cleared") {
            RiverFX.clearAll();
            $("mult").style.color = "#ffe28a";
            $("mult-sub").textContent = "火燒連營！+" + fmt(d.payout);
            showClearOverlay(d.payout, d.jackpot_award);
          }
          Store.saveServer();
          break;

        case "payout_anim":
          payoutAnim(d.balance_after, d.payout, d.duration_ms);
          break;

        case "round_end":
          $("clear-overlay").classList.remove("show");
          $("jackpot").textContent = fmt(d.jackpot);
          updateIgnite();
          Store.saveServer();
          break;

        case "hint_first_decision":
          toast(d.timeoutAction === "continue"
            ? "提示：3 秒未操作將自動「續燒」，可於右上設定改為自動收兵"
            : "提示：3 秒未操作將自動「收兵」", 3500);
          Store.savePrefs();
          break;
      }
    }});

    /* ── 開機：載入持久化 → 重連還原（T08）── */
    var saved = Store.load();
    if (saved.prefs) {
      var p = saved.prefs;
      if (p.bet) { betAmount = p.bet; $("bet-amount").textContent = fmt(betAmount); }
      if (p.autoOn) { autoOn = true; $("auto-toggle").classList.add("on"); }
      if (p.autoNode) $("auto-node").value = p.autoNode;
      var timeoutRadio = document.querySelector('input[name=timeout][value="' + (p.timeoutAction || "continue") + '"]');
      if (timeoutRadio) timeoutRadio.checked = true;
      $("opt-compress").checked = p.compressEnabled !== false;
      GameState.setSettings({
        timeoutAction: p.timeoutAction || "continue",
        compressEnabled: p.compressEnabled !== false,
        firstPlayHintShown: !!p.firstPlayHintShown
      });
    }
    if (saved.server) MockServer._load(saved.server);

    setLadder(cfg.game_config.ladders.standard);
    refreshMoney();

    var pending = MockServer.getPending();
    if (pending && pending.status === "pending") {
      GameState.restore(pending);
    } else {
      if (pending && pending.status === "auto_settled") {
        var s = pending.settlement;
        Store.saveServer();
        refreshMoney();
        toast(s.result === "cashed_out"
          ? "斷線期間已自動收兵於第 " + s.node + " 節，+" + fmt(s.payout)
          : "斷線期間火勢熄滅，該局全損", 4200);
        if (s.payout > 0) pendingTicks.unshift("🔥 你 於第 " + s.node + " 節自動收兵 " + s.multiplier.toFixed(2) + "x");
      }
      setMode("idle");
    }

    console.log("[boot]", GameTables.ping(), "|", MockServer.ping(), "|", GameState.ping(), "|", RiverFX.ping(), "| UI ready");
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
