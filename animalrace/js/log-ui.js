/* ============================================================
 * log-ui.js ── B08 勝負 log 頁【拋棄式演出層】
 *
 * 【定死規格（舊產品樣式，勿改設計）】：
 *   入口鈕 → 總覽頁：一列＝一個有下注的回合，顯示「金錢變化＋
 *   下注日期」——獲勝＝金色「+（派彩−下注額）」淨額、失敗＝灰色
 *   「−下注額」；同回合多注＝總派彩−總下注額，正金負灰。
 *   點列 → 詳細頁：該局詳細排名（含出包）＋下注單列表，每筆含
 *   隨機生成 order id ＋回報按鈕（Demo 假按鈕，點了顯示「已回報」）。
 *
 * 資料源（只讀，零生成）：
 *   - 引擎已結注單 RoundEngine.getBetHistory(50)（單一帳本）
 *   - adapter-b 賽果紀錄流 AdapterB.getRoadRecord(n)（詳細排名；
 *     B06 彈窗移除時留存的同一資料結構）
 *   紀錄僅保留當靴視窗（roadRecs 上限 420 局）＋近 50 筆注單；
 *   超窗的舊局詳細頁顯示過期提示（Demo 取捨）。
 *
 * 另含：
 *   - 點動物名走勢彈層（工作項 5，從簡：單隻近 20 局逐局一覽）
 *   - Demo 錢包重置鈕（工作項 8，藏於 log 頁底部工具列）
 * ============================================================ */

var LogUI = (function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var COLOR = { 1: "#F2F2F0", 2: "#C98B5B", 3: "#FFD02F", 4: "#AEB6BF",
                5: "#E8B14C", 6: "#D9814C", 7: "#7FA65A", 8: "#D97BA6" };
  var DARK_TEXT = { 1: "#5a6472", 3: "#5a4a10" };
  var NAME_DISP = { 1: "小兔", 2: "阿汪", 3: "鴨鴨", 4: "山羊",
                    5: "小馬", 6: "阿猴", 7: "樹懶", 8: "小豬" };
  var TYPE_TXT = { win: "🏆 冠軍", exacta: "🔗 前二連", out: "💥 出包", no_out: "🛡 零出包",
                   /* B10 特殊注別（押路） */
                   big: "🛣 特殊・大", small: "🛣 特殊・小", odd: "🛣 特殊・奇", even: "🛣 特殊・偶",
                   hot: "🛣 特殊・熱門", cold: "🛣 特殊・冷門", longshot: "🛣 特殊・爆冷門" };

  var opts = { toast: function () {} };

  function fmt(n) { return n.toLocaleString("en-US"); }
  function fmtDate(ts) {
    var d = new Date(ts);
    function p(x) { return (x < 10 ? "0" : "") + x; }
    return p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function beadHtml(id, size) {
    return '<i class="lg-bead" style="width:' + size + "px;height:" + size + "px;background:" + COLOR[id] +
      (id === 1 ? ";box-shadow:inset 0 0 0 1px #8a94a6" : "") +
      ";color:" + (DARK_TEXT[id] || "#fff") + ";font-size:" + Math.round(size * 0.58) + 'px">' + id + "</i>";
  }
  function betLabel(b) {
    if (b.type === "win") return TYPE_TXT.win + " #" + b.target;
    if (b.type === "out") return TYPE_TXT.out + " #" + b.target;
    if (b.type === "exacta") return TYPE_TXT.exacta + " " + b.target;
    return TYPE_TXT[b.type] || TYPE_TXT.no_out;
  }

  /* order id：Demo 隨機格式但由（局號,序）決定性派生——每筆必唯一 */
  function orderId(n, idx) {
    var h = (Math.imul(n, 2654435761) ^ Math.imul(idx + 1, 40503)) >>> 0;
    return "GB" + n.toString(36).toUpperCase() + "-" + (idx + 1) + "-" +
           ("000" + (h % 46656).toString(36).toUpperCase()).slice(-3);
  }

  /* 已結注單 → 依回合分組（新局在前） */
  function groups() {
    var hist = RoundEngine.getBetHistory(50);
    var byN = {}, order = [];
    hist.forEach(function (b) {
      if (!byN[b.round_no]) { byN[b.round_no] = []; order.push(b.round_no); }
      byN[b.round_no].push(b);
    });
    order.sort(function (a, b) { return b - a; });
    return order.map(function (n) {
      var bets = byN[n], stake = 0, pay = 0;
      bets.forEach(function (b) { stake += b.amount; pay += b.payout; });
      return { n: n, bets: bets, stake: stake, pay: pay, net: pay - stake,
               at: bets[bets.length - 1].settled_at };
    });
  }

  /* ══════════ 總覽頁 ══════════ */
  function renderOverview() {
    var gs = groups();
    var h = "";
    gs.forEach(function (g) {
      // 定死規格：正=金色「+淨額」、負=灰色「−額」
      var cls = g.net > 0 ? "gold" : "gray";
      var txt = (g.net > 0 ? "+" : g.net < 0 ? "−" : "±") + fmt(Math.abs(g.net));
      h += '<div class="lg-row" data-n="' + g.n + '">' +
        '<span class="lg-date">' + fmtDate(g.at) + "</span>" +
        '<span class="lg-round">局 ' + fmt(g.n) + "・" + g.bets.length + " 注</span>" +
        '<b class="lg-net ' + cls + '">' + txt + '</b><i class="lg-chev">›</i></div>';
    });
    if (!h) h = '<div class="lg-empty">尚無已結算的下注紀錄<br><span>下注並看完一局比賽後，結果會列在這裡</span></div>';
    h += '<div class="lg-tools"><button id="lg-reset">🔄 重置錢包（Demo・回復 100,000）</button>' +
         '<span class="lg-note">紀錄保留近 50 筆注單</span></div>';
    $("lg-body-ov").innerHTML = h;
  }

  /* ══════════ 詳細頁 ══════════ */
  function renderDetail(n) {
    var g = groups().filter(function (x) { return x.n === n; })[0];
    var rec = AdapterB.getRoadRecord(n);
    var h = '<div class="lg-sub">局 ' + fmt(n) + (g ? "・" + fmtDate(g.at) : "") + "</div>";

    // 該局詳細排名（含出包）
    if (rec) {
      h += '<div class="lg-sec">🏁 詳細排名</div><div class="lg-ranks">';
      rec.ranking.forEach(function (id, i) {
        var isOut = rec.out[id - 1];
        var med = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".";
        h += '<div class="lg-rank' + (isOut ? " lo" : "") + '">' +
          '<span class="lg-med">' + med + "</span>" + beadHtml(id, 18) +
          '<span class="lg-anm">' + NAME_DISP[id] + "</span>" +
          (isOut ? '<span class="lg-out">💥 出包 @' + rec.out_at[id - 1] + "m</span>" : "") +
          "</div>";
      });
      h += "</div>";
      if (rec.out.indexOf(false) === -1) h += '<div class="lg-allout">全滅局・名次依撐住距離判定（§5.3）</div>';
    } else {
      h += '<div class="lg-expired">該局詳細賽果已超出保留視窗（僅保留當靴），注單明細如下</div>';
    }

    // 下注單列表：order id ＋ 回報假按鈕
    h += '<div class="lg-sec">🧾 下注單</div>';
    if (g) {
      g.bets.forEach(function (b, idx) {
        var oid = orderId(n, idx);
        h += '<div class="lg-bet">' +
          '<div class="lg-bet-l"><b>' + betLabel(b) + "</b>" +
          '<span class="lg-oid">單號 ' + oid + "</span></div>" +
          '<div class="lg-bet-r"><span class="lg-bamt">' + fmt(b.amount) + "</span>" +
          (b.hit ? '<b class="lg-bpay">+' + fmt(b.payout) + "</b>" : '<span class="lg-bmiss">未中</span>') +
          '<button class="lg-report" data-oid="' + oid + '">回報</button></div></div>';
      });
      var cls = g.net > 0 ? "gold" : "gray";
      h += '<div class="lg-dsum">合計下注 ' + fmt(g.stake) + "・派彩 " + fmt(g.pay) +
           '・<b class="lg-net ' + cls + '">' + (g.net > 0 ? "+" : g.net < 0 ? "−" : "±") +
           fmt(Math.abs(g.net)) + "</b></div>";
    }
    $("lg-body-dt").innerHTML = h;
  }

  function show(view, n) {
    var ov = view === "ov";
    $("lg-body-ov").hidden = !ov;
    $("lg-body-dt").hidden = ov;
    $("lg-back").hidden = ov;
    $("lg-title").textContent = ov ? "勝負紀錄" : "回合詳情";
    if (ov) renderOverview(); else renderDetail(n);
  }

  /* （R2：動物走勢改為路子區第五頁籤，見 roads-ui.js；彈層版已移除） */

  /* ══════════ 綁定 ══════════ */
  function init(o) {
    if (o) { if (o.toast) opts.toast = o.toast; }

    $("log-btn").addEventListener("click", function () {
      $("log-modal").hidden = false;
      show("ov");
    });
    $("lg-close").addEventListener("click", function () { $("log-modal").hidden = true; });
    $("lg-back").addEventListener("click", function () { show("ov"); });

    $("lg-body-ov").addEventListener("click", function (e) {
      if (e.target.closest("#lg-reset")) {
        var w = RoundEngine.resetWallet();
        $("wallet").textContent = fmt(w);
        opts.toast("💰 錢包已重置為 " + fmt(w) + "（Demo）");
        return;
      }
      var row = e.target.closest(".lg-row");
      if (row) show("dt", +row.dataset.n);
    });

    $("lg-body-dt").addEventListener("click", function (e) {
      var btn = e.target.closest(".lg-report");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "已回報 ✓";       // Demo 假按鈕（定死規格）
      opts.toast("✅ 已回報：" + btn.dataset.oid);
    });

  }

  return {
    init: init,
    ping: function () { return "log-ui.js OK"; }
  };
})();
