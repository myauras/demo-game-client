/* ============================================================
 * game.js ── B05 下注 UI【拋棄式演出層】
 *
 * 取代 B02 骨架畫面：頂欄／賽段組成條／路子總攬版位（B06 嵌入）
 * ／動物卡×8（心情疊加條＋賠率▲▼）／注別頁籤＋複押注單列
 * ／快捷籌碼＋確認下注／封盤鎖定。
 *
 * 下注流程＝「選注（staged，可撤單）→ 確認下注（逐筆送引擎）」。
 * 錢包/注單單一帳本在引擎側（adapter-b 裁決③），本層只讀事件。
 * 本層只讀 round / outcome，不持有任何影響結果的邏輯（§10.3）。
 * ============================================================ */

(function () {
  "use strict";

  function init() {
    var $ = function (id) { return document.getElementById(id); };

    /* ── 畫面資產（§1.1 代表色；emoji 頭像為佔位美術）── */
    var COLOR = { 1: "#F2F2F0", 2: "#C98B5B", 3: "#FFD02F", 4: "#AEB6BF",
                  5: "#E8B14C", 6: "#D9814C", 7: "#7FA65A", 8: "#D97BA6" };
    var DARK_TEXT = { 1: "#5a6472", 3: "#5a4a10" };
    var EMOJI = { 1: "🐰", 2: "🐶", 3: "🦆", 4: "🐐", 5: "🐆", 6: "🦘", 7: "🐢", 8: "🐷" };
    /* R2：Kenney CC0 頭像對映（assets/animals/*.png）。IMG 有值即用圖、
       否則回退 emoji；NAME_R2 為顯示層改名（名冊本體在凍結檔 tables-b.js，
       僅覆寫顯示名，編號/代表色不變）。素材就位後填值。 */
    var IMG = { 1: "rabbit", 2: "dog", 3: "duck", 4: "goat",
                5: "horse", 6: "monkey", 7: "sloth", 8: "pig" };
    var NAME_R2 = { 5: "小馬", 6: "阿猴", 7: "樹懶" };   // 使用者核准（2026-09-02）：素材包無獵豹/袋鼠/烏龜
    function displayName(a) { return NAME_R2[a.id] || a.name; }
    var MOOD = {
      hyper:   { cls: "m-hyper",   txt: "🔥 亢奮", attr: "burst",   mini: "爆▲" },
      sleepy:  { cls: "m-sleepy",  txt: "😪 想睡", attr: "focus",   mini: "專▼" },
      nervous: { cls: "m-nervous", txt: "😰 怯場", attr: "terrain", mini: "地▼" }
    };
    var PHASE_TXT = { betting: "下注", locked: "封盤", racing: "比賽", settled: "結算" };
    var ATTR_MAX_SCALE = 115;   // 條形滿版基準（30–95 ＋亢奮 +15 → 最高 110）
    var ARROW_EPS = 0.02;       // 賠率 ▲▼ 顯示門檻（±2%，濾 MC 噪音；心情連帶影響照標）

    function fmt(n) { return n.toLocaleString("en-US"); }
    var toastTimer = null;
    function toast(msg, ms) {
      var t = $("toast");
      t.textContent = msg; t.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.style.display = "none"; }, ms || 2400);
    }

    /* ── 持久化轉接器（R2 換新 key：輪長 30s→40s 使牆鐘局號整體重推導，
       舊存檔的局號/歷史全數失效，直接棄置並清理舊 key）── */
    var Store = {
      load: function () {
        try { localStorage.removeItem("gbr_save"); localStorage.removeItem("gbr_b05_save"); } catch (e) {}
        try { return JSON.parse(localStorage.getItem("gbr_b05r2_save") || "null"); }
        catch (e) { return null; }
      },
      save: function (snapshot) {
        try { localStorage.setItem("gbr_b05r2_save", JSON.stringify(snapshot)); } catch (e) {}
      }
    };

    /* ── 本層狀態 ── */
    var currentRound = null;
    var curPhase = null;
    var betTab = "win";              // win | exacta | out | no_out
    var pairSel = [];                // 前二連配對選取（動物 id ×2）
    var chipAmount = 100;
    var staged = [];                 // 待確認注單 [{type,target,amount,label}]

    function avatarHtml(id, size) {
      var border = id === 1 ? "border:1.5px solid #8a94a6;" : "";
      var face = IMG[id]
        ? '<img src="assets/animals/' + IMG[id] + '.png" alt="">'
        : '<i>' + EMOJI[id] + '</i>';
      return '<span class="avatar" style="background:' + COLOR[id] + ';' + border +
        (size ? "width:" + size + "px;height:" + size + "px;" : "") +
        '">' + face + '<b>' + id + '</b></span>';
    }

    /* ══════════ 頂欄／倒數（R2：末 5 秒壓迫演出）══════════ */
    var lastHurrySec = null;
    function onTick(d) {
      $("shoe-label").textContent = "第 " + d.shoe + " 靴・局 " + d.shoe_round;
      $("round-sub").textContent = "總局號 " + fmt(d.round_no);
      $("count-num").textContent = Math.ceil(d.remaining_ms / 1000);
      $("count-txt").textContent = PHASE_TXT[d.phase];
      var hurry = d.phase === "betting" && d.remaining_ms <= 5000;
      var pill = $("count-pill");
      pill.className = d.phase === "betting"
        ? (hurry ? "p-bet-hurry" : "")
        : "p-" + d.phase;
      $("bet-progress-fill").style.transform =
        "scaleX(" + (d.phase === "betting" ? d.remaining_ms / d.duration_ms : 0) + ")";

      // 末 5 秒：頂欄脈動＋舞台大數字逐秒彈出（純 transform/opacity 動畫）
      document.body.classList.toggle("hurry", hurry);
      if (hurry) {
        var sec = Math.ceil(d.remaining_ms / 1000);
        if (sec !== lastHurrySec) {
          lastHurrySec = sec;
          var hn = $("hurry-num");
          hn.textContent = sec;
          hn.classList.remove("pop");
          void hn.offsetWidth;            // 重觸發動畫
          hn.classList.add("pop");
        }
      } else {
        lastHurrySec = null;
      }
    }

    /* ══════════ 賽段組成條 ══════════ */
    function renderSegments(seg) {
      var defs = [["seg-grass", "草地", seg.grass], ["seg-mud", "泥沼", seg.mud], ["seg-water", "淺灘", seg.water]];
      defs.forEach(function (s) {
        var el = $(s[0]);
        el.style.flexGrow = Math.max(s[2], 0.001);
        el.firstElementChild.textContent = s[1] + " " + Math.round(s[2] * 100) + "%";
      });
    }

    /* ══════════ 路子總覽版位（B06：渲染歸 roads-ui.js，此處僅轉發）══════════ */

    /* ══════════ 動物卡（含心情疊加條＋賠率▲▼）══════════ */
    function pct(v) { return Math.max(0, Math.min(100, v / ATTR_MAX_SCALE * 100)); }

    function attrRow(label, cls, base, delta) {
      var eff = base + delta;
      var bar, val;
      if (delta > 0) {          // 加成：亮色延伸段接在原條後，白線標基準點
        bar = '<i class="fill ' + cls + '" style="width:' + pct(base) + '%"></i>' +
              '<i class="gain" style="left:' + pct(base) + '%;width:' + (pct(eff) - pct(base)) + '%"></i>';
        val = eff + " <b>▲+" + delta + "</b>";
      } else if (delta < 0) {   // 損失：原長輪廓保留，尾端斜紋段
        bar = '<i class="fill ' + cls + '" style="width:' + pct(eff) + '%"></i>' +
              '<i class="loss" style="left:' + pct(eff) + '%;width:' + (pct(base) - pct(eff)) + '%"></i>';
        val = eff + " <b>▼−" + (-delta) + "</b>";
      } else {
        bar = '<i class="fill ' + cls + '" style="width:' + pct(base) + '%"></i>';
        val = String(base);
      }
      return '<div class="arow"><label>' + label + '</label><div class="abar">' + bar +
             '</div><span class="aval">' + val + '</span></div>';
    }

    function arrow(odds, base, upCls, dnCls) {
      if (!odds || !base) return "";
      if (odds > base * (1 + ARROW_EPS)) return ' <span class="' + upCls + '">▲</span>';
      if (odds < base * (1 - ARROW_EPS)) return ' <span class="' + dnCls + '">▼</span>';
      return "";
    }

    /* B06-R2：點卡成注──冠軍/出包頁籤卡上不再有按鈕，整張卡＝下注
       目標；賠率改為卡上「非按鈕樣式」標籤（含 ▲▼），額度滿標灰。 */
    function oddsTag(kind, a) {
      var o = a.odds[kind], base = a.odds[kind + "_base"];
      var name = kind === "win" ? "勝" : "包";
      var cls = kind === "win" ? "ot-win" : "ot-out";
      if (o === null || o === undefined)
        return '<span class="otag full">' + name + " 額度滿</span>";
      return '<span class="otag ' + cls + '">' + name + " <b>" + o.toFixed(2) + "x</b>" +
        arrow(o, base, "up", "dn") + "</span>";
    }

    /* B06-R2：卡片壓縮成緊湊兩列（省下的高度全數讓給路子/演出區）。
       列 1＝頭像/名/▾；列 2＝心情迷你徽章＋賠率標籤（僅冠軍/出包頁籤）。
       手勢統一：點卡＝下注動作（零出包除外，卡維持純資訊）、▾＝展開屬性
       （手風琴，一次僅一張；展開後高度增加靠卡片區捲動）。 */
    var expandedId = null;
    function renderCards(round) {
      var h = "";
      round.animals.forEach(function (a) {
        var m = a.mood ? MOOD[a.mood] : null;
        var d = function (attr) { return (m && m.attr === attr) ? a.mood_delta : 0; };
        var open = expandedId === a.id;
        var detail = !open ? "" :
          '<div class="cdetail">' +
          attrRow("爆發", "f-burst", a.attrs.burst, d("burst")) +
          attrRow("地形", "f-terrain", a.attrs.terrain, d("terrain")) +
          attrRow("專注", "f-focus", a.attrs.focus, d("focus")) +
          '<div class="cstats">近 20 局：勝 <b>' + a.stats20.wins + '</b>・包 <b>' + a.stats20.outs + '</b></div></div>';
        var tag = "";
        if (betTab === "win")         tag = oddsTag("win", a);
        else if (betTab === "out")    tag = oddsTag("out", a);
        else if (betTab === "exacta") tag = exactaTag(a);
        h += '<div class="card' + (pairSel.indexOf(a.id) !== -1 ? " sel" : "") +
          (open ? " open" : "") + '" data-id="' + a.id + '">' +
          '<div class="chead">' + avatarHtml(a.id) +
          '<span class="cname">' + displayName(a) + '</span>' +
          '<i class="chev">' + (open ? "▴" : "▾") + '</i></div>' +
          '<div class="csub">' +
          (m ? '<span class="mood ' + m.cls + '">' + m.txt.split(" ")[0] +
               '<b class="mmini">' + m.mini + '</b></span>' : '<span class="mood-none"></span>') +
          tag + '</div>' + detail + '</div>';
      });
      var wrap = $("cards");
      wrap.className = "mode-" + betTab;      // 模式標記（CSS 依此調整卡片互動感）
      wrap.innerHTML = h;
    }

    /* R2.1：前二連賠率上卡──未選時顯示該動物全部配對的賠率區間，
       選定第一隻後其餘卡換成與它配對的精確賠率，選中卡標「已選」。 */
    function exactaTag(a) {
      var ex = currentRound.odds_exacta;
      if (pairSel.length === 1) {
        if (a.id === pairSel[0]) return '<span class="otag ot-ex picked">已選 ✓</span>';
        var o = ex[TablesB.exactaKey(pairSel[0], a.id)];
        return (o === null || o === undefined)
          ? '<span class="otag full">連 額度滿</span>'
          : '<span class="otag ot-ex">連 <b>' + o.toFixed(2) + "x</b></span>";
      }
      var min = Infinity, max = -Infinity;
      for (var i = 1; i <= 8; i++) {
        if (i === a.id) continue;
        var v = ex[TablesB.exactaKey(a.id, i)];
        if (v === null || v === undefined) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min === Infinity) return '<span class="otag full">連 額度滿</span>';
      return '<span class="otag ot-ex">連 <b>' + min.toFixed(1) + "–" + max.toFixed(1) + "x</b></span>";
    }

    /* ══════════ 注別頁籤與情境列 ══════════ */
    function setTab(t) {
      betTab = t;
      pairSel = [];
      var btns = $("tabs").children;
      for (var i = 0; i < btns.length; i++)
        btns[i].classList.toggle("on", btns[i].dataset.tab === t);
      if (currentRound) renderCards(currentRound);   // R3：切頁籤只改卡片呈現，staged 不清
      renderTabBar();
    }

    function renderTabBar() {
      var bar = $("tab-bar");
      bar.classList.toggle("hero", betTab === "no_out");
      if (betTab === "exacta") {
        // R2 一步到位：第一張標記、第二張點下即成注（用當前籌碼額），無中繼按鈕
        bar.innerHTML = pairSel.length
          ? "🔗 已選 <b>#" + pairSel[0] + "</b>・再點一張卡即成注（每注 " + fmt(chipAmount) + "）"
          : "🔗 前二連：連點兩張動物卡，第二張點下即入注單（不計順序）";
        bar.classList.add("show");
      } else if (betTab === "no_out") {
        // R3：零出包主打面板──大字賠率＋單一大按鈕，卡片區轉純資訊
        var no = currentRound && currentRound.odds_no_out;
        bar.innerHTML = '<span class="hero-ico">🛡</span><div class="hero-txt">' +
          (no ? '<b class="hero-odds">@' + no.toFixed(2) + "x</b>"
              : '<b class="hero-odds full">額度滿</b>') +
          '<span class="hero-sub">押 8 隻全數平安完賽</span></div>' +
          '<button class="tb-add hero-btn" data-act="add-noout"' + (no ? "" : " disabled") +
          ">押零出包 " + fmt(chipAmount) + "</button>";
        bar.classList.add("show");
      } else {
        bar.classList.remove("show");
        bar.innerHTML = "";
      }
    }

    /* ══════════ 注單（staged 可撤單 → 確認送引擎）══════════ */
    function betLabel(b) {
      if (b.type === "win") return "🏆#" + b.target;
      if (b.type === "out") return "💥#" + b.target;
      if (b.type === "exacta") return "🔗" + b.target;
      return "🛡零出包";
    }

    function placedBets() {
      var st = RoundEngine.getState();
      return (st.pending && st.pending.round_no === st.round_no) ? st.pending.bets : [];
    }

    function renderSlip() {
      var placed = placedBets();
      var h = "";
      placed.forEach(function (b) {
        h += '<span class="sbet placed">✓ ' + betLabel(b) + " " + fmt(b.amount) + "</span>";
      });
      staged.forEach(function (b, i) {
        h += '<span class="sbet staged">' + betLabel(b) + " " + fmt(b.amount) +
             '<i class="x" data-i="' + i + '">✕</i></span>';
      });
      $("slip-list").innerHTML = h ||
        '<span class="empty">點動物卡即下注（可複押多注別）</span>';

      var pTotal = placed.reduce(function (s, b) { return s + b.amount; }, 0);
      var sTotal = staged.reduce(function (s, b) { return s + b.amount; }, 0);
      var parts = [];
      if (placed.length) parts.push("已押 " + placed.length + " 注／" + fmt(pTotal));
      if (staged.length) parts.push("待確認 <b>" + staged.length + " 注／" + fmt(sTotal) + "</b>");
      $("slip-sum").innerHTML = parts.join("　") || "尚未選注";

      var btn = $("confirm");
      btn.classList.remove("placed-state");
      if (curPhase !== "betting") {
        btn.disabled = true;
        btn.textContent = placed.length ? "本輪已投注 ✓（" + placed.length + " 注）" : "已封盤";
        if (placed.length) btn.classList.add("placed-state");
      } else if (staged.length) {
        btn.disabled = false;
        btn.textContent = "確認下注（" + staged.length + "注/" + fmt(sTotal) + "）";
      } else if (placed.length) {
        btn.disabled = true;
        btn.textContent = "本輪已投注 ✓（可續押）";
        btn.classList.add("placed-state");
      } else {
        btn.disabled = true;
        btn.textContent = "選注後確認";
      }
    }

    function stagedTotal() { return staged.reduce(function (s, b) { return s + b.amount; }, 0); }

    function stageBet(type, target) {
      if (curPhase !== "betting") { toast("⛔ 已封盤，本輪停止收注"); return; }
      if (!currentRound) return;
      var odds;
      if (type === "win" || type === "out") {
        var a = currentRound.animals[target - 1];
        odds = a.odds[type];
        if (odds === null || odds === undefined) { toast("⛔ 本輪額度已滿"); return; }
      } else if (type === "exacta") {
        odds = currentRound.odds_exacta[target];
        if (!odds) { toast("⛔ 本輪額度已滿"); return; }
      } else {
        odds = currentRound.odds_no_out;
        if (!odds) { toast("⛔ 本輪額度已滿"); return; }
      }
      // 已押注額已自錢包扣除，故只需驗「待確認總額 ≦ 現餘額」
      if (stagedTotal() + chipAmount > RoundEngine.getWallet()) { toast("⛔ 餘額不足"); return; }
      staged.push({ type: type, target: target, amount: chipAmount });
      renderSlip();
    }

    function confirmBets() {
      if (!staged.length) return;
      var ok = 0;
      while (staged.length) {
        var b = staged[0];
        var res = RoundEngine.placeBet({ type: b.type, target: b.target, amount: b.amount });
        if (!res.accepted) { toast("⛔ " + res.message); break; }
        staged.shift();
        ok++;
      }
      renderSlip();
      if (ok) toast("✅ 下注成功：" + ok + " 注");
    }

    /* 成注回饋（R3.1 前二連版 → B06-R2 四頁籤共用）：
       卡 ✓ 脈衝＋賠率藥丸飛入注單列＋注單列閃光（transform/opacity） */
    function pulsePair(ids) {
      ids.forEach(function (aid) {
        var el = document.querySelector('#cards .card[data-id="' + aid + '"]');
        if (!el) return;
        el.classList.add("paired");
        setTimeout(function () { el.classList.remove("paired"); }, 700);
      });
    }
    function flyToSlip(fromEl, label) {
      var f = document.createElement("div");
      f.className = "flybet";
      f.textContent = label;
      var r = fromEl.getBoundingClientRect();
      f.style.left = (r.left + r.width / 2) + "px";
      f.style.top = (r.top + r.height / 2) + "px";
      document.body.appendChild(f);
      var t = $("slip-list").getBoundingClientRect();
      var dx = (t.left + 48) - (r.left + r.width / 2);
      var dy = (t.top + t.height / 2) - (r.top + r.height / 2);
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        f.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px)) scale(.55)";
        f.style.opacity = "0.1";
      }); });
      setTimeout(function () {
        f.remove();
        $("slip-list").classList.add("flash");
        setTimeout(function () { $("slip-list").classList.remove("flash"); }, 500);
      }, 700);
    }

    /* ══════════ 演出區覆蓋層（封盤/演出/結算）══════════ */
    function overlay(html) {
      $("stage").classList.add("covered");
      $("stage-overlay").innerHTML = html;
    }
    function uncover() { $("stage").classList.remove("covered"); }

    function overlayForPhase(phase) {
      if (phase === "betting") {
        RaceFX.stop();                       // B07：清演出場景、還路子版位
        uncover();
        RoadsUI.renderOverview();
        return;
      }
      if (phase === "locked" || phase === "racing") {
        // B07：封盤（發車倒數）與 10s 演出同一場景；RaceFX 以牆鐘自行
        // 對時，重整/休眠喚醒接回時從當下進度續播（§10.3 只讀 outcome）
        uncover();
        var st = RoundEngine.getState();
        if (st.round && st.outcome) RaceFX.run(st.round, st.outcome);
      }
    }

    function overlaySettle(d) {
      var o = d.outcome, champ = o.ranking[0];
      var allOut = o.out.indexOf(false) === -1;
      var ranks = o.ranking.map(function (id, i) {
        var isOut = o.out[id - 1];
        return '<span class="rk' + (i === 0 ? " rk-win" : "") + (isOut ? " rk-out" : "") + '">' +
          (i + 1) + '<span class="mini" style="background:' + COLOR[id] +
          (id === 1 ? ";box-shadow:inset 0 0 0 1px #8a94a6" : "") +
          ';color:' + (DARK_TEXT[id] || "#fff") + '">' + id + "</span>" +
          (isOut ? "包" : "") + "</span>";
      }).join("");
      var pay = "";
      if (d.payouts.length) {
        var hits = d.payouts.filter(function (p) { return p.hit; }).length;
        pay = d.total_payout > 0
          ? '<div class="settle-pay won">🎉 中 ' + hits + " 注・派彩 +" + fmt(d.total_payout) + "</div>"
          : '<div class="settle-pay lost">本局 ' + d.payouts.length + " 注未中，下局再來</div>";
      }
      overlay('<div class="settle-panel">' +
        '<div class="settle-champ">🏆 ' + avatarHtml(champ) + " " +
        displayName(d.round.animals[champ - 1]) + " 奪冠" +
        (allOut ? "（全滅局・依 out_at 判定）" : "") + "</div>" +
        '<div class="settle-ranks">' + ranks + "</div>" + pay + "</div>");
    }

    /* ══════════ 事件接線 ══════════ */
    RoundEngine.configure({
      store: Store,
      onEvent: function (t, d) {
        switch (t) {
          case "round_start":
            currentRound = d.round;
            staged = [];
            pairSel = [];
            renderSegments(d.round.segments);
            renderCards(d.round);
            renderTabBar();
            renderSlip();
            if (d.rejoin) {
              var st = RoundEngine.getState();
              toast("已對時接回：第 " + fmt(st.round_no) + " 局・" + PHASE_TXT[st.phase], 3000);
            }
            break;

          case "phase":
            curPhase = d.phase;
            document.body.classList.toggle("locked-mode", d.phase !== "betting");
            if (d.phase === "locked" && staged.length) {
              staged = [];
              toast("⏱ 封盤：未確認的選注已清除");
            }
            if (d.phase !== "settled") overlayForPhase(d.phase);
            renderSlip();
            break;

          case "tick": onTick(d); break;

          case "settled":
            RaceFX.stop();                   // 名次板落定 → 交棒結算面板
            overlaySettle(d);
            RoadsUI.onSettled(d);              // 路子落新珠（下個下注階段播落珠動畫）
            $("wallet").textContent = fmt(d.wallet);
            renderSlip();
            break;

          case "bet_accepted":
            $("wallet").textContent = fmt(d.wallet);
            renderSlip();
            break;

          case "history_backfilled":
            RoadsUI.onBackfill();
            if (curPhase === "betting") RoadsUI.renderOverview();
            break;
        }
      }
    });

    /* ══════════ 互動綁定 ══════════ */
    $("tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tab]");
      if (b) setTab(b.dataset.tab);
    });

    $("tab-bar").addEventListener("click", function (e) {
      var b = e.target.closest(".tb-add");
      if (!b || b.disabled) return;
      if (b.dataset.act === "add-noout") stageBet("no_out", null);
    });

    $("cards").addEventListener("click", function (e) {
      var card = e.target.closest(".card");
      if (!card) return;
      var id = +card.dataset.id;
      function toggleExpand() {               // 手風琴：一次僅展開一張
        expandedId = expandedId === id ? null : id;
        if (currentRound) renderCards(currentRound);
      }
      if (e.target.closest(".chev")) { toggleExpand(); return; }  // ▾＝四頁籤統一的展開入口
      if (betTab === "win" || betTab === "out") {
        // B06-R2 點卡成注：整張卡＝以當前籌碼直接成注（誤點靠注單列 ✕ 撤單）
        var a = currentRound && currentRound.animals[id - 1];
        var o = a && a.odds[betTab];
        var before = staged.length;
        stageBet(betTab, id);
        if (staged.length > before) {         // 成注才演出：✓脈衝＋賠率藥丸飛入注單列
          pulsePair([id]);
          flyToSlip(card, (betTab === "win" ? "🏆#" : "💥#") + id + " @" + o.toFixed(2));
        }
      } else if (betTab === "exacta") {       // 前二連：點第一張標記、第二張直接成注
        var idx = pairSel.indexOf(id);
        if (idx !== -1) {
          pairSel.splice(idx, 1);
          if (currentRound) renderCards(currentRound);   // R2.1：賠率標籤回到區間態
        } else if (pairSel.length === 0) {
          pairSel.push(id);
          if (currentRound) renderCards(currentRound);   // R2.1：其餘卡換精確配對賠率
        } else {
          var firstId = pairSel[0];
          var key = TablesB.exactaKey(firstId, id);
          pairSel = [];
          var b4 = staged.length;
          stageBet("exacta", key);
          if (staged.length > b4) {
            pulsePair([firstId, id]);
            flyToSlip(card, "🔗" + key + " @" + currentRound.odds_exacta[key]);
          }
          // 成注演出（✓ 脈衝 700ms）結束後才重繪，避免動畫被重繪打斷
          setTimeout(function () {
            if (currentRound && betTab === "exacta") renderCards(currentRound);
          }, 720);
        }
        renderTabBar();
      } else {                                // 零出包：卡＝純資訊，點卡展開/收合
        toggleExpand();
      }
    });

    $("slip-list").addEventListener("click", function (e) {
      var x = e.target.closest(".x");
      if (!x) return;
      staged.splice(+x.dataset.i, 1);         // 撤單（未確認前）
      renderSlip();
    });

    $("confirm").addEventListener("click", confirmBets);

    // 快捷籌碼
    (function () {
      var h = "";
      TablesB.BET_LIMITS.steps.forEach(function (v) {
        h += '<button data-v="' + v + '"' + (v === chipAmount ? ' class="on"' : "") + ">" + v + "</button>";
      });
      $("chips").innerHTML = h;
      $("chips").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-v]");
        if (!b) return;
        chipAmount = +b.dataset.v;
        var btns = $("chips").children;
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i] === b);
        RoundEngine.getSettings().quickBet = chipAmount;   // 隨下次 save 持久化
        renderTabBar();                                    // 前二連提示含籌碼額，同步刷新
      });
    })();

    // 隱藏工具：連點餘額 5 次重置錢包（Demo 測試用，不佔版面）
    (function () {
      var taps = 0, timer = null;
      $("wallet-box").addEventListener("click", function () {
        taps++;
        clearTimeout(timer);
        timer = setTimeout(function () { taps = 0; }, 900);
        if (taps >= 5) {
          taps = 0;
          $("wallet").textContent = fmt(RoundEngine.resetWallet());
          renderSlip();
          toast("錢包已重置");
        }
      });
    })();

    /* ══════════ 開機：先畫載入遮罩，再回補路子歷史（當靴全量、
       決定性重放）→ 引擎對時（首局全量 MC 同步阻塞 ~1s；
       setTimeout 讓遮罩先上屏）══════════ */
    AdapterB.install();
    setTimeout(function () {
      var bt0 = performance.now();
      var rb = RoadsUI.boot();                 // 須在引擎 start() 前（results 流時序）
      console.log("[boot] 路子回補：當靴 " + rb.total + " 局（重放 " + rb.replayed +
                  "・" + Math.round(performance.now() - bt0) + "ms）");
      RoundEngine.start();
      $("wallet").textContent = fmt(RoundEngine.getWallet());
      chipAmount = RoundEngine.getSettings().quickBet || 100;
      var btns = $("chips").children;
      for (var i = 0; i < btns.length; i++)
        btns[i].classList.toggle("on", +btns[i].dataset.v === chipAmount);
      $("boot").classList.add("off");
      var boot = RoundEngine.getState();
      console.log("[boot]", RoundEngine.ping(), "| B05 UI ready | 局", boot.round_no, boot.phase);
    }, 60);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
