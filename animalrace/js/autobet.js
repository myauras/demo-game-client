/* ============================================================
 * autobet.js ── B10 自動下注（續押）【拋棄式演出層】
 *
 * 唯一依據：reports/押路與自動下注示意.html（v2）。
 *   入口＝注單列旁 ⟳ 鈕（有已確認注單時亮起）→ 底部彈窗設定
 *   （範本＝本局已確認注單、局數 5/10/20/∞、停利/停損可關）→
 *   進行中頂部常駐橘色浮條（第 n/N 局・累計損益・停止鈕）。
 *
 * 排程原理：本檔不自帶計時器──掛在引擎既有事件流上（game.js 的
 * onEvent 轉發）。每逢新局 betting 階段事件，把「範本注單」逐筆走
 * RoundEngine.placeBet 重押：與手動下注同一管道，錢包/注單/order id
 * /派彩動畫/log 全沿用。placeBet 不消耗任何決定性 RNG──自動下注
 * 零觸碰 Math.random 種子流（決定性紅線）。
 *
 * 損益口徑：只計範本注單。自動放單發生在 betting 轉場事件當下
 * （同步、先於任何手動操作），範本恆佔該局注單列前 T 筆──結算
 * 事件 payouts 依 bet_index 取前 T 筆即範本損益；手動加注併入當局
 * 照常結算，但不改範本、不計入停利停損。
 *
 * 停止四法＋餘額不足：跑滿局數／觸停利／觸停損／手動點停止；
 * 開盤時餘額 < 範本總額 → 當局自動終止＋跑馬燈提示（Ambience）。
 *
 * 重整接回：狀態存 localStorage（gbr_b10_autobet）。lastPlaced 局號
 * 防同局重複下單（引擎自身也會還原 pending 注單）；離線期間結掉的
 * 最後一局，由引擎注單歷史（round_no 比對、前 T 筆）補記損益。
 * ============================================================ */

var AutoBet = (function () {
  "use strict";

  var KEY = "gbr_b10_autobet";
  var $ = function (id) { return document.getElementById(id); };

  var opts = { toast: function () {}, betLabel: function () { return ""; },
               fmt: function (n) { return String(n); } };

  /* st = { on, tpl:[{type,target,amount}], total(0=∞), placed, done, cum,
   *        tp(0=關), sl(0=關), lastPlaced, open:[已放單未入帳局號] } */
  var st = null;
  var booted = false;          // 首個引擎事件時才做離線補記（等引擎載完存檔）
  var sel = { total: 10, tp: 0, sl: 0 };   // 彈窗選取暫存

  function save() {
    try {
      if (st && st.on) localStorage.setItem(KEY, JSON.stringify(st));
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && !Array.isArray(v.open)) v.open = [];   // 舊存檔相容
      return v;
    } catch (e) { return null; }
  }

  function placedBets() {
    var s = RoundEngine.getState();
    return (s.pending && s.pending.round_no === s.round_no) ? s.pending.bets : [];
  }
  function tplTotal() {
    return st.tpl.reduce(function (s, b) { return s + b.amount; }, 0);
  }
  function tplText(tpl) {
    return tpl.map(function (b) {
      return opts.betLabel(b) + " " + opts.fmt(b.amount);
    }).join("・");
  }

  /* ══════════ 進行中浮條 ══════════ */
  function renderPill() {
    var pill = $("auto-pill");
    if (!st || !st.on) { pill.hidden = true; return; }
    var nTxt = st.total ? st.placed + "/" + st.total : st.placed + "/∞";
    var cumCls = st.cum >= 0 ? "gain" : "lose";
    var cumTxt = (st.cum >= 0 ? "+" : "−") + opts.fmt(Math.abs(st.cum));
    $("auto-pill-txt").innerHTML = "⟳ <b>自動下注中</b>　第 " + nTxt +
      ' 局・累計 <span class="' + cumCls + '">' + cumTxt + "</span>";
    pill.hidden = false;
  }

  function refreshEntry() {
    var btn = $("auto-btn");
    if (!btn) return;
    var running = !!(st && st.on);
    var armed = !running && placedBets().length > 0;
    btn.disabled = !armed;                  // 進行中入口鎖住（停止鈕在浮條上）
    btn.classList.toggle("armed", armed);
    btn.classList.toggle("running", running);
  }

  /* ══════════ 停止（四法＋餘額不足共用出口）══════════ */
  function stop(reason, tickerMsg) {
    if (!st) return;
    var cumTxt = (st.cum >= 0 ? "+" : "−") + opts.fmt(Math.abs(st.cum));
    st.on = false;
    save();
    renderPill();
    refreshEntry();
    opts.toast("⟳ 自動下注結束（" + reason + "）・共 " + st.done + " 局・累計 " + cumTxt, 3600);
    if (typeof Ambience !== "undefined")
      Ambience.playerEvent("⟳ 自動下注<b>" + (tickerMsg || reason) + "</b>，共 " +
                           st.done + " 局・累計損益 <b>" + cumTxt + "</b>");
    st = null;
  }

  /* ══════════ 每局自動放單（betting 轉場事件觸發）══════════ */
  function maybePlace() {
    if (!st || !st.on) return;
    var s = RoundEngine.getState();
    if (s.phase !== "betting") return;
    if (st.lastPlaced >= s.round_no) return;        // 同局重整不重複下單
    var need = tplTotal();
    if (RoundEngine.getWallet() < need) {           // 餘額不足：當局自動終止＋跑馬燈
      stop("餘額不足終止", "因餘額不足終止");
      return;
    }
    for (var i = 0; i < st.tpl.length; i++) {
      var b = st.tpl[i];
      var res = RoundEngine.placeBet({ type: b.type, target: b.target, amount: b.amount });
      if (!res.accepted) { stop("下單失敗終止（" + (res.message || "") + "）"); return; }
    }
    st.placed++;
    st.lastPlaced = s.round_no;
    st.open.push(s.round_no);
    save();
    renderPill();
    opts.toast("⟳ 自動下注：第 " + st.placed + (st.total ? "/" + st.total : "/∞") +
               " 局已下單（" + st.tpl.length + " 注/" + opts.fmt(need) + "）", 2000);
  }

  /* ══════════ 結算入帳＋四種停法判定 ══════════ */
  function account(roundNo, pay) {                  // pay＝範本注單該局總派彩
    var idx = st.open.indexOf(roundNo);
    if (idx === -1) return;
    st.open.splice(idx, 1);
    st.cum += pay - tplTotal();
    st.done++;
    save();
    renderPill();
    if (st.total && st.done >= st.total) { stop("跑滿局數", "跑滿局數結束"); return; }
    if (st.tp && st.cum >= st.tp) { stop("停利達成", "停利達成結束"); return; }
    if (st.sl && st.cum <= -st.sl) { stop("停損觸發", "停損觸發結束"); return; }
  }

  function onSettled(d) {
    if (!st || !st.on) return;
    var pay = 0;                                    // 範本＝該局前 T 筆（見頭註損益口徑）
    (d.payouts || []).forEach(function (p) {
      if (p.bet_index < st.tpl.length) pay += p.payout;
    });
    account(d.round.round_no, pay);
  }

  /* 靜默結算補記（常駐對帳）：重整接回、或分頁節流/休眠期間，
   * 已放單的局可能由引擎 recordRound 靜默結掉（不發 settled 事件）
   * ——每個引擎事件先跑本函數，把 open 清單裡已成過去局的，從注單
   * 歷史補記損益，確保四種停法照樣觸發（否則 done 卡住、放單會
   * 超過設定局數）。引擎歷史僅留近 50 筆注單，超窗以 0 派彩補記
   * （Demo 取捨：長時間休眠的極端情形）。 */
  function reconcile() {
    if (!st || !st.on) return;
    var live = RoundEngine.getState().round_no;
    var hist = null;
    st.open.slice().forEach(function (n) {
      if (!st || !st.on || n >= live) return;
      if (!hist) hist = RoundEngine.getBetHistory(50);
      var pay = 0;
      hist.filter(function (b) { return b.round_no === n; })
          .slice(0, st.tpl.length)
          .forEach(function (b) { pay += b.payout; });
      account(n, pay);
    });
  }

  /* ══════════ 底部彈窗（設定）══════════ */
  var SEG = {
    rounds: { el: "auto-rounds", opts: [5, 10, 20, 0],
              lbl: function (v) { return v ? String(v) : "∞"; } },
    tp: { el: "auto-tp", opts: [0, 2000, 5000],
          lbl: function (v) { return v ? "+" + opts.fmt(v) : "關"; } },
    sl: { el: "auto-sl", opts: [0, 1000, 3000],
          lbl: function (v) { return v ? "−" + opts.fmt(v) : "關"; } }
  };

  function renderSeg(key, cur) {
    var g = SEG[key];
    $(g.el).innerHTML = g.opts.map(function (v) {
      return '<button data-v="' + v + '"' + (v === cur ? ' class="on"' : "") + ">" +
             g.lbl(v) + "</button>";
    }).join("");
  }

  function openModal() {
    var tpl = placedBets();
    if (!tpl.length) { opts.toast("先確認本局注單，才能設定自動續押"); return; }
    $("auto-tpl").innerHTML = "本局注單：" + tplText(tpl) +
      ' <span class="mut">（以當前注單為準）</span>';
    renderSeg("rounds", sel.total);
    renderSeg("tp", sel.tp);
    renderSeg("sl", sel.sl);
    $("auto-modal").hidden = false;
  }

  function start() {
    var tpl = placedBets();
    if (!tpl.length) { $("auto-modal").hidden = true; return; }
    var s = RoundEngine.getState();
    /* 本局已確認注單＝範本＝第 1 局（已成注，不重複下單），下局起自動重押 */
    st = { on: true,
           tpl: tpl.map(function (b) { return { type: b.type, target: b.target, amount: b.amount }; }),
           total: sel.total, placed: 1, done: 0, cum: 0,
           tp: sel.tp, sl: sel.sl,
           lastPlaced: s.round_no, open: [s.round_no] };
    save();
    $("auto-modal").hidden = true;
    renderPill();
    refreshEntry();
    opts.toast("⟳ 自動下注啟動：本局起 " + (st.total ? st.total + " 局" : "無限局") +
               "・每局 " + st.tpl.length + " 注/" + opts.fmt(tplTotal()), 3000);
  }

  /* ══════════ 對外 ══════════ */
  return {
    init: function (o) {
      if (o) {
        if (o.toast) opts.toast = o.toast;
        if (o.betLabel) opts.betLabel = o.betLabel;
        if (o.fmt) opts.fmt = o.fmt;
      }
      $("auto-btn").addEventListener("click", openModal);
      $("auto-backdrop").addEventListener("click", function () { $("auto-modal").hidden = true; });
      $("auto-go").addEventListener("click", start);
      $("auto-stop").addEventListener("click", function () { stop("手動停止", "手動停止"); });
      ["rounds", "tp", "sl"].forEach(function (key) {
        $(SEG[key].el).addEventListener("click", function (e) {
          var b = e.target.closest("button[data-v]");
          if (!b) return;
          sel[key === "rounds" ? "total" : key] = +b.dataset.v;
          renderSeg(key, +b.dataset.v);
        });
      });
    },

    /** game.js onEvent 轉發：betting 轉場放單、settled 入帳 */
    onEvent: function (t, d) {
      if (!booted && (t === "round_start" || t === "phase")) {
        booted = true;                       // 引擎已 start：載入存檔
        st = load();
        if (st && st.on) { renderPill(); refreshEntry(); }
      }
      reconcile();                           // 靜默結算先入帳（可能觸發停止）
      if (t === "phase" && d.phase === "betting") maybePlace();
      else if (t === "settled") onSettled(d);
    },

    refreshEntry: refreshEntry,
    /** 驗證用：目前自動狀態快照 */
    _state: function () { return st; },
    ping: function () { return "autobet.js OK"; }
  };
})();
