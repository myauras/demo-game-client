/* ============================================================
 * roads-ui.js ── B06-R2 路子渲染與互動【拋棄式演出層】
 *
 * R2 版面重構（2026-09-02 驗收裁決）：
 *   ①詳細頁不再另開全頁 overlay——四頁籤（總覽/大小/奇偶/冷熱）
 *     放進 #road-slot 版位內就地切換；二元頁三段式（左珠盤・
 *     右上大路・右下三小路）縮放進版位，固定高度不因切換跳動。
 *   ②點珠詳情彈窗整組移除（點珠與點空白手感區隔不足）；
 *     roads.js 的資料結構保留給 B08 log 頁。總覽點珠盤空白處
 *     ⇄ 冠軍/出包計數 的既有行為保留。
 *
 * 分層取捨：獨立成檔（不併入 game.js）——路子渲染量體大且自成
 * 一格。演算法零 DOM 在 roads.js（可移植），本檔換引擎即重寫。
 *
 * 版位（stage 280px、rs-body ≈222px，切頁籤零跳動）：
 *   總覽＝珠盤 cell 33×6=198
 *   二元＝左珠盤 6×31=186 ‖ 右上大路 6×18=108 ＋右下三小路 6×13=78
 *
 * 互動鐵則（§7.5）：拖曳不用 setPointerCapture；pointerdown 掛
 * 容器、move/up 監聽 window；位移 >5px 抑制 click（捕獲階段）；
 * 頁籤切換後、面板顯示之後才捲到最新。
 *
 * 資料：adapter-b 賽果紀錄流（getRoadRecord / backfillRoadRecords）
 * ＋ localStorage 持久化（同前版，key 不變）。
 * ============================================================ */

var RoadsUI = (function () {
  "use strict";

  var KEY = "gbr_b06_roads";
  var T = null, R = null;                    // TablesB / Roads（init 時取全域）

  /* §1.1 代表色＋ R2 顯示名（拋棄式層自帶，與 game.js 同值） */
  var COLOR = { 1: "#F2F2F0", 2: "#C98B5B", 3: "#FFD02F", 4: "#AEB6BF",
                5: "#E8B14C", 6: "#D9814C", 7: "#7FA65A", 8: "#D97BA6" };
  var DARK_TEXT = { 1: "#5a6472", 3: "#5a4a10" };
  var NAME_DISP = { 1: "小兔", 2: "阿汪", 3: "鴨鴨", 4: "山羊",
                    5: "小馬", 6: "阿猴", 7: "樹懶", 8: "小豬" };
  var YEL = "#FF8A3D", BLU = "#2E6B8A", GOLD = "#D4A017", GRID = "#E3EEF5";

  /* ── 狀態 ── */
  var recs = {};            // n → 賽果紀錄（roads.js 條目原料；B08 log 頁沿用）
  var entries = {};         // n → 路子條目（含冷熱旗標，算一次快取）
  var lastKnown = 0;        // 已有紀錄的最新局號
  var ovMode = "winner";    // 總覽珠盤雙模式
  var rsTab = "ov";         // 版位內當前頁籤（ov | bs | oe | hot | tr）
  var trSel = 0;            // B08-R2 走勢頁：0＝八宮格、其餘＝單隻詳細（動物 id）
  var pendingDropN = 0;     // 待播落珠動畫的局號

  var $ = function (id) { return document.getElementById(id); };

  /* ══════════ 紀錄 → 條目 ══════════ */

  function effOf(a) {       // 心情折算後生效屬性（與 mock-server 同式）
    var e = { burst: a.b, terrain: a.t, focus: a.f };
    if (a.m) e[T.MOODS[a.m].attr] += a.d;
    return e;
  }

  function makeEntry(rec) {
    var w = [], p = [];
    for (var i = 0; i < 8; i++) {
      var eff = effOf(rec.an[i]);
      w.push(T.weight(eff, rec.seg));
      p.push(T.pOut(eff.focus));
    }
    return R.entry(rec, w, p, T.ROAD_HOT.FAV_TOP, T.ROAD_HOT.LONG_BOTTOM);
  }

  function mergeRec(rec) {
    if (!rec || recs[rec.n]) return;
    recs[rec.n] = rec;
    entries[rec.n] = makeEntry(rec);
    if (rec.n > lastKnown) lastKnown = rec.n;
  }

  function shoeEntries() {  // 當靴條目（升冪；靴＝最新紀錄所屬靴）
    if (!lastKnown) return [];
    var shoe = R.shoeOf(lastKnown);
    var from = (shoe - 1) * R.SHOE_SIZE + 1;
    var list = [];
    for (var n = from; n <= lastKnown; n++) if (entries[n]) list.push(entries[n]);
    return list;
  }

  /* ══════════ 持久化 ══════════ */

  function persist() {
    if (!lastKnown) return;
    var shoe = R.shoeOf(lastKnown);
    var from = (shoe - 1) * R.SHOE_SIZE + 1;
    var list = [];
    for (var n = from; n <= lastKnown; n++) if (recs[n]) list.push(recs[n]);
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, recs: list })); } catch (e) {}
  }

  function restore(liveN) {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (!data || data.v !== 1 || !Array.isArray(data.recs)) return;
    var shoe = R.shoeOf(liveN);
    data.recs.forEach(function (rec) {
      if (rec && rec.n && rec.n < liveN && R.shoeOf(rec.n) === shoe &&
          rec.an && rec.an.length === 8 && rec.ranking && rec.out && rec.out_at && rec.seg)
        mergeRec(rec);
    });
  }

  /* ══════════ 開機回補（引擎 start() 前、同步）══════════
   * 範圍＝當靴開頭到上一局（§7.7 靴內全量）。持久檔已涵蓋的不重放；
   * 從第一個缺口起一路補到最新（升冪，保 MockServerB results 流時序）。 */
  function boot() {
    T = TablesB; R = Roads;
    var st = RoundEngine.getState();
    var liveN = st.round_no;
    restore(liveN);
    var from = (R.shoeOf(liveN) - 1) * R.SHOE_SIZE + 1;
    var firstMissing = 0;
    for (var n = from; n < liveN; n++) if (!recs[n]) { firstMissing = n; break; }
    var replayed = 0;
    if (firstMissing) {
      replayed = AdapterB.backfillRoadRecords(firstMissing, liveN - 1);
      for (var k = firstMissing; k < liveN; k++) mergeRec(AdapterB.getRoadRecord(k));
    }
    persist();
    buildDom();

    /* B10-R2：回前景自癒——背景分頁期間漏掉的珠（節流下事件缺席）
       於 visibilitychange 一次補齊並重繪，珠盤不留洞。 */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !lastKnown) return;
      var liveN = AdapterB.liveRoundNo();
      for (var n = lastKnown + 1; n < liveN; n++) {   // 引擎可能尚未醒來回補→主動決定性補生
        var rec = AdapterB.getRoadRecord(n);
        if (!rec) { AdapterB.backfillRoadRecords(n, n); rec = AdapterB.getRoadRecord(n); }
        mergeRec(rec);
      }
      healShoe();
      persist();
      renderActive();
    });

    return { total: shoeEntries().length, replayed: replayed };
  }

  /* ══════════ 引擎事件掛鉤（由 game.js 轉發）══════════ */

  /* B10-R2 自癒（珠盤空格保險②）：掃當靴範圍，缺局向 adapter 補生
   * （決定性重放，任何裝置補出同一珠）。正常情況全為 O(1) 快取查找。 */
  function healShoe() {
    if (!lastKnown) return 0;
    var from = (R.shoeOf(lastKnown) - 1) * R.SHOE_SIZE + 1, healed = 0;
    for (var n = from; n <= lastKnown; n++) {
      if (recs[n]) continue;
      var rec = AdapterB.getRoadRecord(n);
      if (!rec) { AdapterB.backfillRoadRecords(n, n); rec = AdapterB.getRoadRecord(n); }
      if (rec) { mergeRec(rec); healed++; }
    }
    if (healed) { console.warn("[roads-ui] 自癒補珠 " + healed + " 局"); persist(); }
    return healed;
  }

  /* B10-R2：珠的 DOM 插入改為結算事件驅動、同步完成（渲染不依賴
   * 下個下注階段才刷新；落珠動畫仍留待下注階段重繪時疊加播放）。 */
  function onSettled(d) {
    var n = d.round.round_no;
    var rec = AdapterB.getRoadRecord(n);
    if (!rec) { AdapterB.backfillRoadRecords(n, n); rec = AdapterB.getRoadRecord(n); }  // 保險
    mergeRec(rec);
    healShoe();
    persist();
    renderActive();          // 同步插珠（此刻 stage 被結算面板覆蓋，但 DOM 已就位）
    pendingDropN = n;        // 動畫標記留給下注階段重繪（純疊加效果）
  }

  function onBackfill() {   // 休眠醒來：引擎已依序重放漏局，取回其紀錄
    var liveN = AdapterB.liveRoundNo();
    for (var n = lastKnown + 1; n < liveN; n++) mergeRec(AdapterB.getRoadRecord(n));
    healShoe();
    persist();
  }

  /* ══════════ 共用繪製 ══════════ */

  function gridBg(w, h, cell) {
    var html = "";
    for (var gx = cell; gx < w; gx += cell)
      html += '<div style="position:absolute;top:0;bottom:0;left:' + gx + 'px;width:1px;background:' + GRID + '"></div>';
    for (var gy = cell; gy < h; gy += cell)
      html += '<div style="position:absolute;left:0;right:0;top:' + gy + 'px;height:1px;background:' + GRID + '"></div>';
    return html;
  }

  function goldSlash(d, inset) {
    return '<div style="position:absolute;left:' + (-inset) + 'px;top:' + (d / 2 - 1.5) +
      'px;width:' + (d + inset * 2) + 'px;height:3px;background:' + GOLD +
      ';transform:rotate(-45deg);border-radius:2px;pointer-events:none"></div>';
  }

  /** 總覽珠盤（冠軍 ⇄ 出包計數） */
  function renderOverviewPlate(el, ents, cell, minCols) {
    var pad = cell >= 32 ? 3 : 2, d = cell - pad * 2;
    var colsN = Math.max(ents.length ? Math.ceil(ents[ents.length - 1].sr / 6) : 0, minCols);
    var w = colsN * cell, h = 6 * cell;
    var html = gridBg(w, h, cell);
    var fs = cell >= 32 ? 13 : 9.5;
    ents.forEach(function (e) {
      var x = Math.floor((e.sr - 1) / 6) * cell + pad, y = ((e.sr - 1) % 6) * cell + pad;
      var cls = "rbead" + (e.n === lastKnown ? " latest" : "") +
                (e.n === pendingDropN ? " bead-drop" : "");
      var badge = "";
      if (ovMode === "winner") {
        var stroke = e.champion === 1 ? "box-shadow:inset 0 0 0 1.5px #8a94a6;" : "";
        var txt = DARK_TEXT[e.champion] || "#fff";
        if (e.outCount >= 4) {
          var bd = cell >= 32 ? 15 : 11;
          badge = '<i style="position:absolute;right:' + (-pad + 1) + 'px;bottom:' + (-pad + 1) +
            'px;min-width:' + bd + 'px;height:' + bd + 'px;border-radius:' + bd + 'px;background:#E43D2E;color:#fff;font-style:normal;font-size:' +
            (bd - 3) + 'px;line-height:' + (bd - 1) + 'px;text-align:center;border:1px solid #fff;padding:0 1px">' + e.outCount + "</i>";
        } else {
          for (var k = 0; k < e.outCount; k++) {
            var od = cell >= 32 ? 8 : 5;
            badge += '<i style="position:absolute;right:' + (-pad + 1) + 'px;top:' + (d / 2 - od - 1 + k * (od + 1)) +
              'px;width:' + od + 'px;height:' + od + 'px;border-radius:50%;background:#FF8A3D;border:1px solid #fff"></i>';
          }
        }
        html += '<div class="' + cls + '" data-n="' + e.n + '" style="position:absolute;left:' + x + 'px;top:' + y +
          'px;width:' + d + 'px;height:' + d + 'px;border-radius:50%;background:' + COLOR[e.champion] + ";" + stroke +
          'color:' + txt + ';font-size:' + fs + 'px;font-weight:800;display:flex;align-items:center;justify-content:center">' +
          e.champion + badge + "</div>";
      } else {
        var c = e.outCount === 0 ? ["transparent", "#C5D2DE", "#8096A8"] :
                e.outCount === 1 ? ["transparent", "#E8B14C", "#8a6510"] :
                e.outCount === 2 ? ["transparent", "#FF8A3D", "#C9631E"] : ["#E43D2E", "#E43D2E", "#fff"];
        var bw = cell >= 32 ? 3 : 2.5;
        html += '<div class="' + cls + '" data-n="' + e.n + '" style="position:absolute;left:' + x + 'px;top:' + y +
          'px;width:' + d + 'px;height:' + d + 'px;border-radius:50%;background:' + c[0] + ';border:' + bw + 'px solid ' + c[1] +
          ';color:' + c[2] + ';font-size:' + fs + 'px;font-weight:800;display:flex;align-items:center;justify-content:center">' +
          e.outCount + "</div>";
      }
    });
    el.style.width = w + "px"; el.style.height = h + "px";
    el.innerHTML = html;
  }

  /** 二元珠盤（實心珠＋單字；大冷門金斜線） */
  function renderBinaryBead(el, ents, kind, labelY, labelB, cell, minCols) {
    var cells = R.binaryBeadCells(ents, kind, 6);
    var pad = 3, d = cell - pad * 2;
    var colsN = Math.max(cells.length ? cells[cells.length - 1].x + 1 : 0, minCols);
    var w = colsN * cell, h = 6 * cell;
    var html = gridBg(w, h, cell);
    cells.forEach(function (c) {
      var x = c.x * cell + pad, y = c.y * cell + pad;
      var color = c.v === "Y" ? YEL : BLU;
      html += '<div class="rbead' + (c.n === lastKnown ? " latest" : "") + '" data-n="' + c.n +
        '" style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + d + 'px;height:' + d +
        'px;border-radius:50%;background:' + color +
        ';display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:#fff">' +
        (c.v === "Y" ? labelY : labelB) + (c.gold ? goldSlash(d, 3) : "") + "</div>";
    });
    el.style.width = w + "px"; el.style.height = h + "px";
    el.innerHTML = html;
  }

  /** 大路／衍生路（style: big=空心 | hollow=空心 | solid=實心 | slash=斜線） */
  function renderRoad(el, seq, cell, minCols, style) {
    var cells = R.layoutBigRoad(R.toColumns(seq), 6);
    var maxX = cells.reduce(function (m, c) { return Math.max(m, c.x); }, -1);
    var colsN = Math.max(maxX + 1, minCols);
    var w = colsN * cell, h = 6 * cell;
    var html = gridBg(w, h, cell);
    cells.forEach(function (c) {
      var color = c.v === "Y" ? YEL : BLU;
      var l = c.x * cell + 3, t = c.y * cell + 3, d = cell - 6;
      if (style === "solid")
        html += '<div style="position:absolute;left:' + l + "px;top:" + t + "px;width:" + d + "px;height:" + d +
          'px;background:' + color + ';border-radius:50%"></div>';
      else if (style === "slash")
        html += '<div style="position:absolute;left:' + l + "px;top:" + (t + d / 2 - 1.5) + "px;width:" + d +
          'px;height:3px;background:' + color + ';transform:rotate(-45deg);border-radius:2px"></div>';
      else {
        var bw = cell >= 20 ? 3 : 2.5;
        html += '<div style="position:absolute;left:' + l + "px;top:" + t + "px;width:" + d + "px;height:" + d +
          'px;border:' + bw + 'px solid ' + color + ';border-radius:50%">' +
          (c.gold ? goldSlash(d - bw * 2, 4) : "") + "</div>";
      }
    });
    el.style.width = w + "px"; el.style.height = h + "px";
    el.innerHTML = html;
  }

  /* ══════════ 拖曳平移（§7.5 鐵則實作，照模擬器 v4）══════════ */
  function bindDrag(sc) {
    var down = false, sx = 0, sl = 0, moved = 0;
    sc.addEventListener("pointerdown", function (e) {
      down = true; moved = 0; sx = e.clientX; sl = sc.scrollLeft;
      sc.classList.add("dragging");
    });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - sx;
      moved = Math.max(moved, Math.abs(dx));
      sc.scrollLeft = sl - dx;
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      window.addEventListener(ev, function () {
        if (down) { down = false; sc.classList.remove("dragging"); }
      });
    });
    sc.addEventListener("click", function (e) {
      if (moved > 5) { e.stopPropagation(); e.preventDefault(); moved = 0; }
    }, true);
  }

  function scrollToLatest(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".road-scroll"), function (sc) {
      sc.scrollLeft = sc.scrollWidth;
    });
  }

  /* ══════════ 版位 DOM（二元三段式面板就地建構）══════════ */

  var BIN = {
    bs:  { name: "大小", ly: "大", lb: "小", hint: "冠軍 5–8＝大（橘）・1–4＝小（藍）" },
    oe:  { name: "奇偶", ly: "奇", lb: "偶", hint: "冠軍號碼奇＝橘・偶＝藍" },
    hot: { name: "冷熱", ly: "熱", lb: "失", hint: "前三熱門守住＝橘・金斜線＝爆冷" }
  };

  function buildDom() {
    var body = $("rs-body");
    var html = "";
    Object.keys(BIN).forEach(function (k) {
      var b = BIN[k];
      html +=
        '<section class="rs-panel" id="rsp-' + k + '">' +
          '<div class="phead">' +
            '<span class="chip"><i class="dotY"></i>' + b.ly + ' <b id="rsc-' + k + '-y">0</b></span>' +
            '<span class="chip"><i class="dotB"></i>' + b.lb + ' <b id="rsc-' + k + '-b">0</b></span>' +
            (k === "hot" ? '<span class="chip gold">Ø <b id="rsc-hot-g">0</b></span>' : "") +
            '<span class="phint">' + b.hint + '</span>' +
          '</div>' +
          '<div class="pbody">' +
            '<div class="pleft rwrap"><span class="rtag">珠盤</span>' +
              '<div class="road-scroll"><div class="roadbox" id="rs-' + k + '-bead"></div></div></div>' +
            '<div class="pright">' +
              '<div class="rwrap bigwrap"><span class="rtag">大路</span>' +
                '<div class="road-scroll"><div class="roadbox" id="rs-' + k + '-big"></div></div></div>' +
              '<div class="mini3">' +
                '<div class="rwrap"><span class="rtag">大眼仔</span><div class="road-scroll"><div class="roadbox" id="rs-' + k + '-d1"></div></div></div>' +
                '<div class="rwrap"><span class="rtag">小路</span><div class="road-scroll"><div class="roadbox" id="rs-' + k + '-d2"></div></div></div>' +
                '<div class="rwrap"><span class="rtag">蟑螂路</span><div class="road-scroll"><div class="roadbox" id="rs-' + k + '-d3"></div></div></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>';
    });
    /* B08-R2 走勢頁（第五頁籤）：八宮格迷你折線 ⇄ 單隻詳細，就地切換 */
    html += '<section class="rs-panel" id="rsp-tr">' +
              '<div id="tr-grid"></div>' +
              '<div id="tr-detail" hidden></div>' +
            '</section>';
    body.insertAdjacentHTML("beforeend", html);

    /* 綁互動：拖曳（版位內所有捲區）＋頁籤就地切換＋總覽空白處切模式 */
    Array.prototype.forEach.call(document.querySelectorAll("#road-slot .road-scroll"), bindDrag);

    $("rs-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-rt]");
      if (!b || b.dataset.rt === rsTab) return;
      rsTab = b.dataset.rt;
      Array.prototype.forEach.call($("rs-tabs").children, function (el) {
        el.classList.toggle("on", el.dataset.rt === rsTab);
      });
      ["ov", "bs", "oe", "hot", "tr"].forEach(function (k) {
        $("rsp-" + k).classList.toggle("on", k === rsTab);
      });
      renderActive();   // 面板顯示之後才渲染＋捲到最新（§7.5）
    });

    /* 走勢頁互動：點迷你圖→單隻詳細、返回→八宮格 */
    $("rsp-tr").addEventListener("click", function (e) {
      if (e.target.closest(".trd-back")) { trSel = 0; renderActive(); return; }
      var m = e.target.closest(".trm");
      if (m) { trSel = +m.dataset.id; renderActive(); }
    });

    /* 點珠盤空白處 ⇄ 冠軍/出包計數（§7.2；R2 彈窗已移除，點珠=點空白同義） */
    $("ov-road").addEventListener("click", function () {
      ovMode = ovMode === "winner" ? "outs" : "winner";
      renderActive();
    });
  }

  /* ══════════ B08-R2 走勢頁（迷你折線八宮格 ⇄ 單隻詳細）══════════
   * 資料＝本模組 recs（賽果紀錄流）近 20 局：名次折線（Y 軸 1 上
   * 8 下）、出包局標紅點。靜態 SVG、零外部庫；版位高度不變。 */

  function trendData(id) {
    var list = [];
    for (var n = Math.max(1, lastKnown - 19); n <= lastKnown; n++) {
      var rec = recs[n];
      if (!rec) continue;
      list.push({ n: n, pos: rec.ranking.indexOf(id) + 1,
                  out: !!rec.out[id - 1], at: rec.out_at[id - 1] });
    }
    return list;
  }

  function beadMini(id, size) {
    return '<i class="trbead" style="width:' + size + "px;height:" + size + "px;background:" + COLOR[id] +
      (id === 1 ? ";box-shadow:inset 0 0 0 1px #8a94a6" : "") +
      ";color:" + (DARK_TEXT[id] || "#fff") + ";font-size:" + Math.round(size * 0.6) + 'px">' + id + "</i>";
  }

  /** 單張迷你折線 SVG（W×H 固定座標系；名次 1→上、8→下） */
  function miniSvg(list, W, H) {
    var padT = 4, padB = 5, padX = 4;
    var yOf = function (pos) { return padT + (pos - 1) / 7 * (H - padT - padB); };
    var xOf = function (i) {
      return list.length === 1 ? W / 2 : padX + i / (list.length - 1) * (W - padX * 2);
    };
    var grid = "", g;
    for (g = 1; g <= 8; g += 7)   // 名次 1 與 8 兩條淡線（上下界）
      grid += '<line x1="0" y1="' + yOf(g) + '" x2="' + W + '" y2="' + yOf(g) +
              '" stroke="' + GRID + '" stroke-width="1"/>';
    var pts = list.map(function (d, i) { return xOf(i).toFixed(1) + "," + yOf(d.pos).toFixed(1); });
    var line = list.length > 1
      ? '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + BLU +
        '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' : "";
    var dots = "";
    list.forEach(function (d, i) {
      if (d.out) dots += '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(d.pos).toFixed(1) +
        '" r="2.6" fill="#E43D2E" stroke="#fff" stroke-width="1"/>';
      else if (d.pos === 1) dots += '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(d.pos).toFixed(1) +
        '" r="2" fill="' + YEL + '"/>';
    });
    return '<svg width="100%" height="' + H + '" viewBox="0 0 ' + W + " " + H +
           '" preserveAspectRatio="none">' + grid + line + dots + "</svg>";
  }

  function renderTrendPanel() {
    var grid = $("tr-grid"), det = $("tr-detail");
    if (!trSel) {
      det.hidden = true;
      grid.hidden = false;
      var html = "";
      for (var id = 1; id <= 8; id++) {
        var list = trendData(id);
        html += '<div class="trm" data-id="' + id + '">' +
          '<div class="trm-head">' + beadMini(id, 13) +
          '<span>' + NAME_DISP[id] + "</span></div>" + miniSvg(list, 74, 66) + "</div>";
      }
      grid.innerHTML = html;
      return;
    }
    grid.hidden = true;
    det.hidden = false;
    var listD = trendData(trSel).reverse();   // 新局在前
    var wins = 0, outs = 0;
    listD.forEach(function (d) { if (d.out) outs++; else if (d.pos === 1) wins++; });
    var rows = listD.map(function (d) {
      return '<div class="trd-row' + (d.out ? " lo" : d.pos === 1 ? " hi" : "") + '">' +
        '<span class="trd-n">局 ' + d.n.toLocaleString("en-US") + "</span>" +
        (d.out ? '<b class="trd-out">💥 出包 @' + d.at + "m</b>"
               : '<b class="trd-pos">第 ' + d.pos + " 名" + (d.pos === 1 ? " 🏆" : "") + "</b>") +
        "</div>";
    }).join("") || '<div class="trd-empty">尚無歷史紀錄</div>';
    det.innerHTML =
      '<div class="trd-head"><button class="trd-back">‹ 返回</button>' +
      beadMini(trSel, 17) + "<b>" + NAME_DISP[trSel] + "</b>" +
      '<span class="trd-stat">近 ' + listD.length + " 局：勝 " + wins + "・出包 " + outs + "</span></div>" +
      '<div class="trd-list">' + rows + "</div>";
  }

  /* ══════════ 就地渲染（當前頁籤）══════════ */

  function renderActive() {
    var ents = shoeEntries();
    var shoeNo = lastKnown ? R.shoeOf(lastKnown) : 1;
    $("road-shoe").textContent = "第 " + shoeNo + " 靴・" + ents.length + " 局";
    if (rsTab === "ov") {
      $("road-mode").textContent = ovMode === "winner" ? "珠盤：冠軍" : "珠盤：出包計數";
      var sc = $("ov-scroll");
      renderOverviewPlate($("ov-road"), ents, 33, Math.floor((sc.clientWidth || 306) / 33) || 9);
      $("ov-hint").textContent = ovMode === "winner"
        ? "點珠盤 ⇄ 出包計數・角標點＝出包隻數（4+ 紅徽章）"
        : "點珠盤 ⇄ 冠軍・珠＝出包隻數：0 灰框・1 黃框・2 橘框・3+ 紅實心";
      sc.scrollLeft = sc.scrollWidth;
      pendingDropN = 0;   // 落珠動畫一次性
    } else if (rsTab === "tr") {
      $("road-mode").textContent = trSel ? "走勢・" + NAME_DISP[trSel] : "走勢";
      renderTrendPanel();
    } else {
      var k = rsTab;
      $("road-mode").textContent = BIN[k].name;
      var seq = R.project(ents, k);
      var c = R.counts(seq);
      $("rsc-" + k + "-y").textContent = c.y;
      $("rsc-" + k + "-b").textContent = c.b;
      if (k === "hot") $("rsc-hot-g").textContent = c.gold;
      renderBinaryBead($("rs-" + k + "-bead"), ents, k, BIN[k].ly, BIN[k].lb, 31, 4);
      renderRoad($("rs-" + k + "-big"), seq, 18, 12, "big");
      var cols = R.toColumns(seq);
      renderRoad($("rs-" + k + "-d1"), R.derived(cols, 1), 13, 5, "hollow");
      renderRoad($("rs-" + k + "-d2"), R.derived(cols, 2), 13, 5, "solid");
      renderRoad($("rs-" + k + "-d3"), R.derived(cols, 3), 13, 5, "slash");
      /* 面板 display 已同步切換完成，scrollWidth 可讀（§7.5）；
         不用 rAF——隱藏分頁的 rAF 會被瀏覽器凍結，捲動會被無限期擱置 */
      scrollToLatest($("rsp-" + k));
    }
  }

  return {
    boot: boot,
    onSettled: onSettled,
    onBackfill: onBackfill,
    renderOverview: renderActive,   // game.js 沿用舊名：下注階段刷新當前頁籤
    ping: function () { return "roads-ui.js R2 OK"; }
  };
})();
