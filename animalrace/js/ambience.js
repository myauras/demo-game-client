/* ============================================================
 * ambience.js ── B08 全服感氛圍【拋棄式演出層】
 *
 * ① 他人下注流（#abet-feed 嵌條）：下注階段滾動顯示匿名注單——
 *    暱稱打碼、金額/注別加權擬真、熱門跟注（目標按本局精確勝率
 *    排名加權，末 10 秒再銳化＋提頻，營造跟注氛圍）。
 * ② 跑馬燈（#ticker）：大額中獎（擬真捏造）/大冷門/全滅播報；
 *    玩家自己的事件由 game.js 呼叫 playerEvent() 即時插隊。
 *
 * 【決定性紅線】本檔全部隨機皆走自帶 mulberry32（開機以 Date.now()
 * 播種，純氛圍、無需決定性），完全不呼叫 Math.random——adapter-b
 * 的調度器只在其生命週期呼叫窗內換 rng，本檔計時器回呼與該窗
 * 天然互斥（單執行緒），但自帶 PRNG 讓「零污染」不靠時序保證。
 *
 * 冷熱資料源：與 roads-ui/卡片徽章同一管道——TablesB 折算心情後
 * 以 Roads.favOrder 精確勝率排名（零 MC、零噪音），僅讀不寫。
 * 動畫一律 transform/opacity；背景分頁不更新 DOM。
 * ============================================================ */

var Ambience = (function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  /* ── 自帶 PRNG（非決定性、僅氛圍）── */
  var seed = (Date.now() ^ 0x5DEECE6D) >>> 0;
  function rng() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
  function pickW(weights) {              // 權重表 → 索引
    var s = 0, i;
    for (i = 0; i < weights.length; i++) s += weights[i];
    var roll = rng() * s;
    for (i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll < 0) return i; }
    return weights.length - 1;
  }
  function fmt(n) { return n.toLocaleString("en-US"); }

  /* ── 匿名暱稱：頭尾實字＋中段打碼（組合空間大，長跑不重複）── */
  var NICK_A = ["財", "旺", "金", "發", "阿", "小", "大", "老", "幸", "福", "龍", "虎",
                "豹", "鷹", "風", "雷", "皮", "萌", "狂", "夜", "星", "月", "板", "衝"];
  var NICK_B = ["爺", "哥", "姐", "王", "神", "俠", "仔", "妹", "皇", "帝", "霸", "客",
                "手", "迷", "咖", "魚", "貓", "熊", "隊", "主", "友", "拉", "醬", "蛋"];
  var recentNicks = [];
  function nick() {
    for (var tries = 0; tries < 8; tries++) {
      var s2 = NICK_A[Math.floor(rng() * NICK_A.length)] +
               (rng() < 0.5 ? "*" : "**") +
               NICK_B[Math.floor(rng() * NICK_B.length)];
      if (recentNicks.indexOf(s2) === -1) {
        recentNicks.push(s2);
        if (recentNicks.length > 14) recentNicks.shift();
        return s2;
      }
    }
    return s2;
  }

  /* ── 金額擬真：籌碼步進加權 × 倍數，偶發大額 ── */
  function amount(big) {
    if (big || rng() < 0.03) return (10 + Math.floor(rng() * 41)) * 100;   // 1,000–5,000
    var step = [10, 50, 100, 500][pickW([0.30, 0.30, 0.25, 0.15])];
    return step * (1 + Math.floor(rng() * 4));
  }

  /* ── 本局冷熱排名（與卡片徽章/路子同源：精確勝率）── */
  var curRound = null, favIds = null, poutsW = null;
  function prepRound(round) {
    curRound = round;
    var w = [], p = [];
    round.animals.forEach(function (a) {
      var e = { burst: a.attrs.burst, terrain: a.attrs.terrain, focus: a.attrs.focus };
      if (a.mood) e[TablesB.MOODS[a.mood].attr] += a.mood_delta;
      w.push(TablesB.weight(e, round.segments));
      p.push(TablesB.pOut(e.focus));
    });
    favIds = Roads.favOrder(w, p);           // 熱→冷 動物 id
    poutsW = p;
  }

  var NAME_DISP = { 1: "小兔", 2: "阿汪", 3: "鴨鴨", 4: "山羊",
                    5: "小馬", 6: "阿猴", 7: "樹懶", 8: "小豬" };

  /* ── 他人下注流 ── */
  var feedTimer = null, feedOn = false, feedCount = 0;
  var HOT_W      = [0.24, 0.18, 0.14, 0.11, 0.09, 0.09, 0.08, 0.07];  // 依熱門名次
  var HOT_W_LATE = [0.34, 0.24, 0.16, 0.08, 0.06, 0.05, 0.04, 0.03]; // 末 10 秒跟注銳化

  function fakeBet(lateBias) {
    var kind = pickW([0.62, 0.16, 0.14, 0.08]);   // win/out/exacta/no_out
    var hotW = lateBias ? HOT_W_LATE : HOT_W;
    var t1 = favIds[pickW(hotW)];
    if (kind === 0) return { txt: "🏆 冠軍 #" + t1 + " " + NAME_DISP[t1], amt: amount() };
    if (kind === 1) {
      var oi = pickW(poutsW);                     // 出包注偏押高出包率者
      return { txt: "💥 出包 #" + (oi + 1) + " " + NAME_DISP[oi + 1], amt: amount() };
    }
    if (kind === 2) {
      var t2 = t1;
      while (t2 === t1) t2 = favIds[pickW(hotW)];
      return { txt: "🔗 前二連 " + TablesB.exactaKey(t1, t2), amt: amount() };
    }
    return { txt: "🛡 零出包", amt: amount() };
  }

  function pushFeed() {
    if (!feedOn || !curRound) return;
    var st = RoundEngine.getState();
    if (st.phase !== "betting") { stopFeed(); return; }
    var late = st.remaining_ms < 10000;
    if (!document.hidden) {
      var b = fakeBet(late);
      feedCount++;
      var line = $("abet-line"), cnt = $("abet-count");
      if (line) {
        line.classList.remove("empty");
        line.innerHTML = '<b class="an">' + nick() + "</b> 押 " + b.txt +
                         ' <b class="aa">' + fmt(b.amt) + "</b>";
        line.classList.remove("in");
        void line.offsetWidth;
        line.classList.add("in");
      }
      if (cnt) cnt.textContent = "本局 " + feedCount + " 注";
    }
    var base = late ? 380 + rng() * 720 : 550 + rng() * 1350;
    feedTimer = setTimeout(pushFeed, base);
  }
  function startFeed() {
    if (feedOn) return;
    feedOn = true;
    feedCount = 3 + Math.floor(rng() * 8);       // 開盤前已有零星單（全服感）
    var f = $("abet-feed");
    if (f) f.classList.add("on");
    clearTimeout(feedTimer);
    feedTimer = setTimeout(pushFeed, 250 + rng() * 500);
  }
  function stopFeed() {
    feedOn = false;
    clearTimeout(feedTimer);
    var f = $("abet-feed");
    if (f) f.classList.remove("on");
  }

  /* ── 跑馬燈：佇列滾動；玩家事件插隊 ── */
  var tq = [], tRunning = false;
  function tickerRun() {
    if (tRunning) return;
    var item = tq.shift();
    if (!item) return;
    tRunning = true;
    var box = $("ticker"), msg = $("ticker-msg");
    if (!box || !msg) { tRunning = false; return; }
    msg.className = item.cls || "";
    msg.innerHTML = item.html;
    msg.style.transition = "none";
    msg.style.transform = "translateX(" + box.clientWidth + "px)";
    void msg.offsetWidth;
    var dist = box.clientWidth + msg.scrollWidth + 20;
    var dur = Math.max(4.5, dist / 75);          // ~75px/s
    msg.style.transition = "transform " + dur.toFixed(1) + "s linear";
    msg.style.transform = "translateX(" + (-msg.scrollWidth - 20) + "px)";
    setTimeout(function () {
      tRunning = false;
      if (tq.length) tickerRun();
    }, dur * 1000 + 400);
  }
  function tickerPush(html, cls, front) {
    var item = { html: html, cls: cls };
    if (front) tq.unshift(item); else tq.push(item);
    while (tq.length > 8) tq.pop();
    tickerRun();
  }

  /* 結算 → 產生播報（大冷門/全滅/擬真大額中獎） */
  function onSettled(d) {
    var o = d.outcome, round = d.round, champ = o.ranking[0];
    var allOut = o.out.indexOf(false) === -1;
    if (allOut) {
      tickerPush("😵 <b>全滅局！</b>局 " + fmt(round.round_no) + " 八隻全數出包，零出包注全輸", "t-cold");
      return;                                    // 全滅已夠戲劇性，不再疊大額
    }
    // 冷熱旗標與路子同源（favIds 為當局排名——onSettled 時 curRound 仍是本局）
    if (favIds && curRound && curRound.round_no === round.round_no) {
      var rank = favIds.indexOf(champ);
      if (rank >= 8 - TablesB.ROAD_HOT.LONG_BOTTOM) {
        var wodds = round.animals[champ - 1].odds.win;
        tickerPush("❄ <b>爆大冷！</b>#" + champ + " " + NAME_DISP[champ] +
                   " 大冷門奪冠" + (wodds ? "（勝賠 " + wodds.toFixed(2) + "x）" : ""), "t-cold");
      }
    }
    if (rng() < 0.38) {                          // 擬真大額中獎（捏造玩家）
      var amt = amount(true), odds2, label;
      if (rng() < 0.45 && round.odds_exacta) {
        var key = TablesB.exactaKey(o.ranking[0], o.ranking[1]);
        odds2 = round.odds_exacta[key];
        label = "前二連 " + key;
      } else {
        odds2 = round.animals[champ - 1].odds.win;
        label = "冠軍 #" + champ;
      }
      if (odds2) {
        var winAmt = Math.floor(amt * odds2);
        if (winAmt >= 3000)
          tickerPush("💰 玩家 <b>" + nick() + "</b> 命中 " + label + " @" + odds2.toFixed(2) +
                     "，贏得 <b>" + fmt(winAmt) + "</b>！", "t-win");
      }
    }
  }

  return {
    init: function () {
      tickerPush("📣 歡迎來到動物大賽跑！每 40 秒一局全服同步開賽", "");
    },
    onRound: function (round) { prepRound(round); },
    onPhase: function (phase) {
      if (phase === "betting") startFeed(); else stopFeed();
    },
    onSettled: onSettled,
    /** 玩家自己的事件：即時插隊到跑馬燈最前 */
    playerEvent: function (html, cls) { tickerPush(html, cls || "t-me", true); },
    ping: function () { return "ambience.js OK"; }
  };
})();
