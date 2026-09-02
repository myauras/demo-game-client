/* ============================================================
 * race-fx.js ── B07 賽事演出【拋棄式演出層】
 *
 * 10 秒側視跟拍：賽段地形色帶（依本局組成鋪設）→ 起跑（LOCKED 2s
 * 發車倒數）→ 各賽段速度差與位次交換 → 出包喜劇（八隻專屬＋短特寫
 * ＋事件橫幅）→ 心情伏筆回收 → 衝線與前三名頒獎 → 交棒結算面板。
 *
 * ── 核心：結果先定、演出自洽（§10.3）──
 * 本層只讀已抽定的 outcome，用它「反推」編排，不含任何影響結果的
 * 邏輯。作法：
 *   1. 完賽者依最終名次分配衝線時刻（第 1 名 8.0s，其後每名遞延，
 *      最末 9.2s）——衝線順序＝名次，鐵定不穿幫。
 *   2. 每隻的走位曲線由「屬性 × 賽段」正推形狀（爆發高→草地快、
 *      地形高→泥灘快），再整條縮放到自己的衝線時刻——中途快慢有
 *      戲（位次自然交換），終點必然正確。
 *   3. 出包者曲線截斷在 out_at，出包時刻＝「領先者通過該點的時刻
 *      × 1.07 ＋ 140ms」——出包當下領先者必已跑在前面，出包者
 *      永遠不會看起來快贏（任務卡鐵則，_verify 有量化檢查）。
 *   4. 心情演出（亢奮開場暴衝／想睡中途打盹／怯場泥水段猶豫）以
 *      「保端點的曲線整形」實作：動中段、不動衝線時刻。
 *
 * 時間軸完全由牆鐘推導（與 round-engine 同 EPOCH/CYCLE）：每一幀
 * 從 Date.now() 重算進度，分頁休眠喚醒、中途重整都能無縫接上。
 *
 * 對外：run(round, outcome)（locked/racing 共用，冪等）、stop()、
 *       _verify(n)（自動化比對演出 vs 名次）、_preview(局號)（下注
 *       階段重播歷史局，驗收/截圖用）、_findOutRounds(id)。
 * ============================================================ */

var RaceFX = (function () {
  "use strict";

  /* ── 時間軸（與 round-engine 同步的常數）── */
  var EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);
  var CYCLE = 40000;
  var RACE_OFF = 27000;         // 25s 下注＋2s 封盤 → 演出起點
  var RACE_MS = 10000;          // §2 演出嚴格 10 秒
  var T_WIN = 8000;             // 冠軍衝線時刻
  var T_LAST = 9200;            // 最後完賽者衝線時刻
  var PODIUM_AT = 8650;         // 頒獎小演出起點（§5.4 收益類 0.8–1.2s）

  /* ── 舞台幾何 ── */
  var TRACK_LEN = 1000;         // 公尺（與 out_at 同單位）
  var SCALE = 2.2;              // px / 公尺
  var PAD_L = 70, PAD_R = 120;
  var WORLD_W = PAD_L + TRACK_LEN * SCALE + PAD_R;
  var TRACK_TOP = 64, LANE_H = 25;

  /* ── 畫面資產（演出層自帶，與 game.js/roads-ui.js 同值）── */
  var COLOR = { 1: "#F2F2F0", 2: "#C98B5B", 3: "#FFD02F", 4: "#AEB6BF",
                5: "#E8B14C", 6: "#D9814C", 7: "#7FA65A", 8: "#D97BA6" };
  var IMG = { 1: "rabbit", 2: "dog", 3: "duck", 4: "goat",
              5: "horse", 6: "monkey", 7: "sloth", 8: "pig" };
  var NAME = { 1: "小兔", 2: "阿汪", 3: "鴨鴨", 4: "山羊",
               5: "小馬", 6: "阿猴", 7: "樹懶", 8: "小豬" };
  var EMOJI = { 1: "🐰", 2: "🐶", 3: "🦆", 4: "🐐", 5: "🐴", 6: "🐵", 7: "🦥", 8: "🐷" };

  /* ── 出包演出名冊（§5.4 既定 4 隻＝1/2/7/8）──
   * Q11 四隻（3/4/5/6）之專屬提案於 R2 裁決（2026-09-02）Demo 暫緩，
   * 改通用「ZZZ 睡著」佔位；提案存查規格 §12 Q11，正式版再議。
   * 提案實作保留於 Q11_GAGS（停用）——啟用只需把對應項換回 GAGS。 */
  var Q11_GAGS = {
    3: { txt: "下水玩起來了",   cls: "gag-splash",   fx: "splash" },
    4: { txt: "跟柵欄槓上了",   cls: "gag-headbutt", fx: "fence" },
    5: { txt: "停下來擺 pose",  cls: "gag-pose",     fx: "sparkle" },
    6: { txt: "撿到香蕉開飯了", cls: "gag-banana",   fx: "banana" }
  };
  var GAGS = {
    1: { txt: "打瞌睡原地睡著了", cls: "gag-sleep",      fx: "zzz" },
    2: { txt: "追蝴蝶跑錯棚了",   cls: "gag-butterfly",  fx: "butterfly" },
    3: { txt: "睡著了",           cls: "gag-sleep",      fx: "zzz" },   // Q11 暫緩佔位
    4: { txt: "睡著了",           cls: "gag-sleep",      fx: "zzz" },   // Q11 暫緩佔位
    5: { txt: "睡著了",           cls: "gag-sleep",      fx: "zzz" },   // Q11 暫緩佔位
    6: { txt: "睡著了",           cls: "gag-sleep",      fx: "zzz" },   // Q11 暫緩佔位
    7: { txt: "站著睡著了",       cls: "gag-slothsleep", fx: "zzz" },
    8: { txt: "滾泥坑不走了",     cls: "gag-mud",        fx: "mud" }
  };
  void Q11_GAGS;   // 停用中（保留定義供正式版啟用）

  /* ── 演出專用決定性 RNG（僅供畫面點綴，不碰任何結果）── */
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

  var $id = function (id) { return document.getElementById(id); };
  function laneTop(id) { return TRACK_TOP + (id - 1) * LANE_H; }

  /* ══════════ 曲線工具：keypoints [{t,x}] 遞增，線性內插 ══════════ */

  function evalX(pts, t) {
    if (t <= pts[0].t) return pts[0].x;
    for (var i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        var a = pts[i - 1], b = pts[i];
        return b.t === a.t ? b.x : a.x + (b.x - a.x) * (t - a.t) / (b.t - a.t);
      }
    }
    return pts[pts.length - 1].x;
  }
  function tAt(pts, x) {                     // 首次到達距離 x 的時刻
    if (x <= pts[0].x) return pts[0].t;
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i].x) {
        var a = pts[i - 1], b = pts[i];
        return b.x === a.x ? b.t : a.t + (b.t - a.t) * (x - a.x) / (b.x - a.x);
      }
    }
    return pts[pts.length - 1].t;
  }
  function insertAt(pts, x) {                // 確保 x 處有 keypoint，回傳索引
    for (var i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i].x - x) < 1e-6) return i;
      if (pts[i].x > x) { pts.splice(i, 0, { t: tAt(pts, x), x: x }); return i; }
    }
    pts.push({ t: pts[pts.length - 1].t, x: x });
    return pts.length - 1;
  }

  /* 屬性 × 賽段 → 曲線形狀（單位：虛擬時間，之後整條縮放到目標時刻） */
  function foldMood(a) {
    var e = { burst: a.attrs.burst, terrain: a.attrs.terrain, focus: a.attrs.focus };
    if (a.mood && TablesB.MOODS[a.mood]) e[TablesB.MOODS[a.mood].attr] += a.mood_delta;
    return e;
  }
  function rawCurve(eff, seg) {
    var vG = 0.58 + 0.52 * Math.min(Math.max(eff.burst, 1), 115) / 115;    // 草地速度
    var vW = 0.58 + 0.52 * Math.min(Math.max(eff.terrain, 1), 115) / 115;  // 泥/灘速度
    var Lg = seg.grass * TRACK_LEN, Lm = seg.mud * TRACK_LEN;
    var Lw = TRACK_LEN - Lg - Lm;
    var pts = [{ t: 0, x: 0 }], t = 0;
    t += Lg / vG; pts.push({ t: t, x: Lg });
    t += Lm / vW; pts.push({ t: t, x: Lg + Lm });
    t += Lw / vW; pts.push({ t: t, x: TRACK_LEN });
    return pts;
  }

  /* 曲線整形（保端點：只動中段，不動衝線/出包時刻） */
  function shapeHyper(pts) {                 // 亢奮：開場暴衝（前段提早到位）
    var x = Math.min(130, pts[pts.length - 1].x * 0.35);
    if (x <= 0) return;
    var i = insertAt(pts, x);
    if (i > 0 && i < pts.length - 1)
      pts[i].t = Math.max(pts[i - 1].t + 40, pts[i].t * 0.68);
  }
  function shapePause(pts, x, pauseMax, events, id, kind) {  // 定點停頓（打盹/猶豫）
    if (x <= 0 || x >= pts[pts.length - 1].x) return;
    var i = insertAt(pts, x);
    if (i >= pts.length - 1) return;
    var pause = Math.min(pauseMax, (pts[i + 1].t - pts[i].t) * 0.45);
    if (pause < 60) return;
    pts.splice(i + 1, 0, { t: pts[i].t + pause, x: pts[i].x });
    if (events) events.push({ t: pts[i].t, kind: kind, id: id });
  }

  /* ══════════ 編排腳本：outcome 反推（本檔核心）══════════ */

  function buildScript(round, outcome) {
    var n = round.round_no, seg = round.segments;
    var rng = mulberry32((Math.imul(n, 2654435761) ^ strHash("fx")) >>> 0);
    var Lg = seg.grass * TRACK_LEN;
    var events = [], racers = {};
    var F = 0, i;
    for (i = 0; i < 8; i++) if (!outcome.out[i]) F++;

    /* 完賽者：名次 → 衝線時刻 → 曲線整條縮放（結果反推編排） */
    for (var pos = 0; pos < outcome.ranking.length; pos++) {
      var aid = outcome.ranking[pos];
      var a = round.animals[aid - 1];
      var pts = rawCurve(foldMood(a), seg);
      var r = { id: aid, out: !!outcome.out[aid - 1], mood: a.mood, pts: pts };
      racers[aid] = r;
      if (r.out) continue;                   // 出包者第二輪處理（需先有領先者曲線）
      r.rank = pos;
      r.tEnd = F === 1 ? T_WIN : T_WIN + pos * (T_LAST - T_WIN) / (F - 1);
      var f = r.tEnd / pts[pts.length - 1].t;
      pts.forEach(function (p) { p.t *= f; });
      if (a.mood === "hyper") shapeHyper(pts);
      if (a.mood === "nervous") shapePause(pts, Lg, 300, events, aid, "sweat");
      if (a.mood === "sleepy") {             // 想睡但沒出包＝驚險逃過（伏筆有演）
        shapePause(pts, 160 + rng() * 260, 220, events, aid, "zzz");
        shapePause(pts, 500 + rng() * 280, 220, events, aid, "zzz");
      }
      events.push({ t: r.tEnd, kind: "finish", id: aid, rank: pos });
    }

    /* 出包者：出包時刻由「領先者何時通過該點」反推——鐵則保證 */
    function leaderT(x) {
      var best = Infinity;
      for (var k = 1; k <= 8; k++)
        if (!racers[k].out) best = Math.min(best, tAt(racers[k].pts, x));
      return best;
    }
    for (i = 1; i <= 8; i++) {
      if (!racers[i].out) continue;
      var ro = racers[i], oa = outcome.out_at[i - 1];
      var tOut = F === 0
        ? 700 + oa / TRACK_LEN * 7300        // 全滅局：撐越久越晚出包
        : Math.min(8400, Math.max(900, leaderT(oa) * 1.07 + 140));
      var cut = insertAt(ro.pts, oa);
      ro.pts = ro.pts.slice(0, cut + 1);
      var fo = tOut / ro.pts[cut].t;
      ro.pts.forEach(function (p) { p.t *= fo; });
      if (round.animals[i - 1].mood === "hyper") shapeHyper(ro.pts);
      ro.tEnd = tOut;
      ro.outAt = oa;
      events.push({ t: tOut, kind: "out", id: i });
    }

    /* 亢奮開場衝刺特效（含出包者：暴衝完出包更有戲） */
    round.animals.forEach(function (a2) {
      if (a2.mood === "hyper") events.push({ t: 80, kind: "dash", id: a2.id });
    });
    events.push({ t: PODIUM_AT, kind: "podium" });
    if (F === 0) {
      var lastOut = 0;
      for (i = 1; i <= 8; i++) lastOut = Math.max(lastOut, racers[i].tEnd);
      events.push({ t: Math.min(lastOut + 450, 9200), kind: "allout" });
    }
    events.sort(function (x1, x2) { return x1.t - x2.t; });

    return { n: n, seg: seg, racers: racers, events: events, F: F,
             top3: outcome.ranking.slice(0, 3), allOut: F === 0, rng: rng };
  }

  /* ══════════ 場景 DOM ══════════ */

  function buildScene(round, script) {
    var stageEl = $id("race-stage");
    var seg = round.segments;
    var wG = seg.grass * TRACK_LEN * SCALE, wM = seg.mud * TRACK_LEN * SCALE;
    var wW = TRACK_LEN * SCALE - wG - wM;
    var rng = mulberry32((Math.imul(script.n, 40503) ^ 0x9E37) >>> 0);

    // 天空層（視差 0.22×）
    var skyW = Math.ceil(WORLD_W * 0.25) + 500, clouds = "";
    for (var cx = 30; cx < skyW; cx += 130 + rng() * 130) {
      clouds += '<img src="assets/animals/../bg/cloud' + (1 + Math.floor(rng() * 3)) +
        '.png" style="left:' + Math.round(cx) + "px;top:" + Math.round(3 + rng() * 24) +
        "px;width:" + Math.round(40 + rng() * 28) + 'px" alt="">';
    }

    // 地平線裝飾：樹叢只種在草段上（地形帶「這裡是草地」的呼應）
    var deco = "";
    for (var dx = PAD_L + 26; dx < PAD_L + wG - 24; dx += 110 + rng() * 140) {
      var kd = rng();
      var src = kd < 0.4 ? "tree" : kd < 0.7 ? "bush1" : "bush2";
      deco += '<img class="rdeco" src="assets/bg/' + src + '.png" style="left:' +
        Math.round(dx) + "px;width:" + (src === "tree" ? 30 : 22) + 'px" alt="">';
    }

    var lanes = "";
    for (var li = 1; li < 8; li++)
      lanes += '<i class="rlane" style="top:' + (TRACK_TOP + li * LANE_H) + 'px"></i>';

    var racersHtml = "";
    for (var id2 = 1; id2 <= 8; id2++) {
      racersHtml += '<div class="racer" id="rcr-' + id2 + '" style="top:' + (laneTop(id2) - 1) + 'px">' +
        '<span class="rname">' + NAME[id2] + "</span>" +
        '<div class="rzoom"><div class="rbob" style="animation-duration:' +
        (0.3 + (id2 % 4) * 0.035).toFixed(2) + 's;animation-delay:' + (id2 * 0.045).toFixed(2) + 's">' +
        '<span class="rring" style="background:' + COLOR[id2] + '">' +
        '<img src="assets/animals/' + IMG[id2] + '.png" alt=""></span>' +
        '<b class="rno">' + id2 + "</b></div></div></div>";
    }

    stageEl.innerHTML =
      '<div class="rsky" id="race-sky">' + clouds + "</div>" +
      '<img class="rsun" src="assets/bg/sun.png" alt="">' +
      '<div id="race-cam"><div class="rtrack" style="width:' + WORLD_W + 'px">' +
        '<div class="rhorizon"></div>' + deco +
        '<i class="rseg rs-grass" style="left:' + PAD_L + "px;width:" + wG + 'px"></i>' +
        '<i class="rseg rs-mud" style="left:' + (PAD_L + wG) + "px;width:" + wM + 'px"></i>' +
        '<i class="rseg rs-water" style="left:' + (PAD_L + wG + wM) + "px;width:" + (wW + 2) + 'px"></i>' +
        lanes +
        '<i class="rstart" style="left:' + PAD_L + 'px"></i>' +
        '<i class="rfinish" style="left:' + (PAD_L + TRACK_LEN * SCALE) + 'px"></i>' +
        '<span class="rflag" style="left:' + (PAD_L + TRACK_LEN * SCALE + 6) + 'px">🏁</span>' +
        '<div id="race-badges"></div>' +
        racersHtml +
      "</div></div>" +
      '<div class="rsegcap">🌿' + Math.round(seg.grass * 100) + "%・🟤" +
        Math.round(seg.mud * 100) + "%・💧" + Math.round(seg.water * 100) + "%</div>" +
      '<div id="race-banner"></div><div id="race-count"></div><div id="race-podium"></div>';

    var racerEls = {};
    for (var id3 = 1; id3 <= 8; id3++) racerEls[id3] = $id("rcr-" + id3);
    return {
      cam: $id("race-cam"), sky: $id("race-sky"),
      banner: $id("race-banner"), count: $id("race-count"),
      podium: $id("race-podium"), badges: $id("race-badges"),
      racers: racerEls
    };
  }

  /* ══════════ 執行狀態與主迴圈 ══════════ */

  var S = null;
  var bq = [], bShowing = false;

  function banner(html, cls) { bq.push({ html: html, cls: cls || "" }); pumpBanner(); }
  function pumpBanner() {
    if (bShowing || !bq.length || !S) return;
    bShowing = true;
    var b = bq.shift(), el = S.els.banner;
    el.innerHTML = b.html;
    el.className = "bshow " + b.cls;
    setTimeout(function () {
      el.className = "bhide";
      setTimeout(function () { bShowing = false; pumpBanner(); }, 240);
    }, 1150);
  }

  function fxSpan(e, cls) { return '<span class="rfx ' + cls + '">' + e + "</span>"; }

  function applyGag(id, silent) {
    var el = S.els.racers[id], g = GAGS[id];
    if (!el || el.classList.contains("out")) return;
    el.classList.add("out", g.cls);
    var prop = "";
    switch (g.fx) {
      case "zzz":       prop = fxSpan("💤", "fx-zzz d0") + fxSpan("💤", "fx-zzz d1"); break;
      case "butterfly": prop = '<span class="rfx prop-bfly">🦋</span>'; break;
      case "splash":    prop = '<i class="prop-puddle pp-water"></i>' +
                               fxSpan("💦", "fx-splash d0") + fxSpan("💦", "fx-splash d1"); break;
      case "fence":     prop = '<img class="prop-fence" src="assets/bg/fence.png" alt="">' +
                               fxSpan("💢", "fx-angry"); break;
      case "sparkle":   prop = fxSpan("✨", "fx-spark d0") + fxSpan("✨", "fx-spark d1") +
                               '<i class="prop-flash"></i>'; break;
      case "banana":    prop = '<span class="rfx prop-banana">🍌</span>' + fxSpan("😋", "fx-yum"); break;
      case "mud":       prop = '<i class="prop-puddle pp-mud"></i>' +
                               fxSpan("💦", "fx-splash d0") + fxSpan("💦", "fx-splash d1"); break;
    }
    el.insertAdjacentHTML("beforeend", prop);
    if (!silent) {
      el.classList.add("spot");
      setTimeout(function () { el.classList.remove("spot"); }, 1300);
    }
  }

  function oneShotFx(id, emoji, cls) {
    var el = S.els.racers[id];
    if (!el) return;
    var sp = document.createElement("span");
    sp.className = "rfx " + cls;
    sp.textContent = emoji;
    el.appendChild(sp);
    setTimeout(function () { sp.remove(); }, 1500);
  }

  function hyperDash(id) {
    var el = S.els.racers[id];
    if (!el) return;
    el.classList.add("m-dash");
    el.insertAdjacentHTML("beforeend", fxSpan("🔥", "fx-fire"));
    setTimeout(function () {
      el.classList.remove("m-dash");
      var f = el.querySelector(".fx-fire");
      if (f) f.remove();
    }, 2100);
  }

  function finishBadge(id, rank, silent) {
    var sp = document.createElement("span");
    sp.className = "fbadge" + (rank < 3 ? " top" : "") + (silent ? " still" : "");
    sp.textContent = rank < 3 ? ["🥇", "🥈", "🥉"][rank] : String(rank + 1);
    sp.style.left = (PAD_L + (TRACK_LEN + 15 - rank * 1.5) * SCALE - 6) + "px";
    sp.style.top = (laneTop(id) - 8) + "px";
    S.els.badges.appendChild(sp);
  }

  function confettiAt(px) {
    var c = document.createElement("div");
    c.className = "wconf";
    c.style.left = (px - 44) + "px";
    var h = "";
    for (var i = 0; i < 10; i++)
      h += '<i class="pconf" style="left:' + Math.round(S.script.rng() * 84) + "px;background:" +
        ["#FF8A3D", "#7BC24A", "#5BC8DE", "#FFD02F", "#E43D2E"][i % 5] +
        ";animation-delay:" + (S.script.rng() * 0.3).toFixed(2) + 's;animation-duration:1.2s"></i>';
    c.innerHTML = h;
    S.els.badges.appendChild(c);
    setTimeout(function () { c.remove(); }, 2300);
  }

  function avatarImg(id) {
    return '<span class="pava" style="background:' + COLOR[id] +
      (id === 1 ? ";box-shadow:inset 0 0 0 1.5px #8a94a6" : "") +
      '"><img src="assets/animals/' + IMG[id] + '.png" alt=""></span>';
  }

  function showPodium() {
    var sc = S.script, el = S.els.podium;
    var meds = ["🥇", "🥈", "🥉"], hs = [56, 40, 30];
    var cells = "";
    [1, 0, 2].forEach(function (ri) {       // 視覺順序 2‑1‑3
      var id = sc.top3[ri];
      cells += '<div class="pdcell r' + ri + '"><span class="pdmed">' + meds[ri] + "</span>" +
        avatarImg(id) + "<b>" + NAME[id] + '</b><i style="height:' + hs[ri] + 'px"></i></div>';
    });
    var conf = "";
    for (var c = 0; c < 14; c++)
      conf += '<i class="pconf" style="left:' + Math.round(4 + sc.rng() * 92) + "%;background:" +
        ["#FF8A3D", "#7BC24A", "#5BC8DE", "#FFD02F", "#E43D2E"][c % 5] +
        ";animation-delay:" + (sc.rng() * 0.9).toFixed(2) + "s;animation-duration:" +
        (1.1 + sc.rng() * 0.8).toFixed(2) + 's"></i>';
    el.innerHTML = '<div class="pdconf">' + conf + '</div><div class="pdrow">' + cells + "</div>" +
      (sc.allOut ? '<div class="pdnote">全滅局・依撐住距離判定名次（§5.3）</div>' : "");
    el.classList.add("on");
  }

  function fire(ev, silent) {
    if (ev.kind === "out") {
      applyGag(ev.id, silent);
      if (!silent) {
        banner("💥 出包！" + EMOJI[ev.id] + " <b>" + NAME[ev.id] + "</b> " + GAGS[ev.id].txt);
        if (ev.t < 7200) {
          var r = S.script.racers[ev.id];
          S.camOvr = { x: PAD_L + r.outAt * SCALE, until: Date.now() + 950 };
        }
      }
    } else if (ev.kind === "finish") {
      finishBadge(ev.id, ev.rank, silent);
      if (ev.rank === 0 && !silent) {
        banner("🏆 " + EMOJI[ev.id] + " <b>" + NAME[ev.id] + "</b> 率先衝線！", "bwin");
        confettiAt(PAD_L + TRACK_LEN * SCALE);
      }
    } else if (ev.kind === "dash") {
      if (!silent) hyperDash(ev.id);
    } else if (ev.kind === "zzz") {
      if (!silent) oneShotFx(ev.id, "💤", "fx-doze");
    } else if (ev.kind === "sweat") {
      if (!silent) oneShotFx(ev.id, "😰", "fx-doze");
    } else if (ev.kind === "podium") {
      showPodium();
    } else if (ev.kind === "allout") {
      if (!silent) banner("😵 全滅局！8 隻全數出包", "ballout");
    }
  }

  function glide(rank, dt) {                 // 衝線後緩滑（名次前者停更前，定格畫面同序）
    var u = Math.min(1, dt / 650);
    return (15 - rank * 1.5) * (1 - (1 - u) * (1 - u));
  }

  function updateCountdown(t) {
    var el = S.els.count;
    var key = t < -1000 ? "2" : t < 0 ? "1" : t < 600 ? "GO" : "";
    if (S.startElapsed > 600) key = "";      // 中途接回：不補倒數
    if (key === S.cdKey) return;
    S.cdKey = key;
    if (!key) { el.className = ""; el.innerHTML = ""; return; }
    el.className = "";
    void el.offsetWidth;                     // 重觸發 pop 動畫
    el.className = "show " + (key === "2" ? "c2" : key === "1" ? "c1" : "cgo");
    el.innerHTML = "<b>" + (key === "GO" ? "GO!" : key) + "</b><span>" +
      (key === "GO" ? "起跑！" : "封盤・發車") + "</span>";
  }

  function frame(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    var t = Date.now() - S.t0;               // 牆鐘推導：休眠喚醒/重整無縫接上
    if (S.preview && t > RACE_MS + 800) { stop(); return; }

    updateCountdown(t);

    var maxPx = 0;
    for (var id = 1; id <= 8; id++) {
      var r = S.script.racers[id];
      var x;
      if (t <= 0) x = 0;
      else if (!r.out && t > r.tEnd) x = TRACK_LEN + glide(r.rank, t - r.tEnd);
      else x = evalX(r.pts, t);
      var px = PAD_L + x * SCALE;
      S.els.racers[id].style.transform = "translate3d(" + (px - 13).toFixed(1) + "px,0,0)";
      if (px > maxPx) maxPx = px;
    }

    var evs = S.script.events;
    while (S.evIdx < evs.length && evs[S.evIdx].t <= t) {
      fire(evs[S.evIdx], evs[S.evIdx].t < S.startElapsed - 400);
      S.evIdx++;
    }

    /* 鏡頭：跟隨領先集團；出包短特寫時暫移焦點 */
    var target;
    if (t <= 0) target = 0;
    else if (S.camOvr && Date.now() < S.camOvr.until) target = S.camOvr.x - S.view * 0.5;
    else target = maxPx - S.view * 0.62;
    target = Math.max(0, Math.min(WORLD_W - S.view, target));
    var gap = now - S.lastNow;
    if (S.camX === null || gap > 400) S.camX = target;   // 首幀／休眠喚醒：鏡頭硬切到位
    var dt = Math.min(64, gap);
    S.lastNow = now;
    S.camX += (target - S.camX) * (1 - Math.exp(-dt / 170));
    S.els.cam.style.transform = "translate3d(" + (-S.camX).toFixed(1) + "px,0,0)";
    S.els.sky.style.transform = "translate3d(" + (-S.camX * 0.22).toFixed(1) + "px,0,0)";
  }

  function start(round, outcome, t0, preview) {
    stopCore();
    var script = buildScript(round, outcome);
    var stageBox = $id("stage");
    if (stageBox) stageBox.classList.add("race-on");
    var els = buildScene(round, script);
    S = { n: round.round_no, script: script, t0: t0, preview: !!preview,
          els: els, camX: null, camOvr: null, evIdx: 0, cdKey: "__",
          startElapsed: Date.now() - t0, lastNow: performance.now(),
          view: $id("race-stage").clientWidth || 348 };
    S.raf = requestAnimationFrame(frame);
  }

  function stopCore() {
    if (S) { cancelAnimationFrame(S.raf); S = null; }
    bq.length = 0;
    bShowing = false;
  }
  function stop() {
    stopCore();
    var rs = $id("race-stage");
    if (rs) rs.innerHTML = "";
    var stageBox = $id("stage");
    if (stageBox) stageBox.classList.remove("race-on");
  }

  /* ══════════ 驗證／預覽工具（dev；讀 adapter-b 賽果紀錄流）══════════ */

  function roundFromRecord(rec) {
    return {
      round_no: rec.n,
      segments: rec.seg,
      animals: rec.an.map(function (a, i) {
        return { id: i + 1, name: NAME[i + 1],
                 attrs: { burst: a.b, terrain: a.t, focus: a.f },
                 mood: a.m, mood_delta: a.d };
      })
    };
  }
  function outcomeFromRecord(rec) {
    return { round_no: rec.n, ranking: rec.ranking, out: rec.out, out_at: rec.out_at };
  }

  return {
    /** locked / racing 共用進場（冪等；時間軸自行由牆鐘對時） */
    run: function (round, outcome) {
      if (!round || !outcome) return;
      if (S && !S.preview && S.n === round.round_no) return;
      start(round, outcome, EPOCH + (round.round_no - 1) * CYCLE + RACE_OFF, false);
    },
    stop: stop,

    /** 自動化驗收：近 n 局逐局建腳本，比對演出 vs outcome（零矛盾線） */
    _verify: function (count) {
      var live = AdapterB.liveRoundNo(), fails = [], tested = 0;
      for (var n = Math.max(1, live - (count || 10)); n < live; n++) {
        var rec = AdapterB.getRoadRecord(n);
        if (!rec) continue;
        tested++;
        var sc = buildScript(roundFromRecord(rec), outcomeFromRecord(rec));
        var fins = rec.ranking.filter(function (id) { return !rec.out[id - 1]; });
        var byTime = fins.slice().sort(function (a, b) { return sc.racers[a].tEnd - sc.racers[b].tEnd; });
        if (byTime.join() !== fins.join()) fails.push(n + ": 衝線順序 ≠ 名次");
        fins.forEach(function (id) {
          var r = sc.racers[id];
          if (Math.abs(evalX(r.pts, r.tEnd) - TRACK_LEN) > 0.5) fails.push(n + ": #" + id + " 未達終點");
          if (r.tEnd < 7900 || r.tEnd > 9250) fails.push(n + ": #" + id + " 衝線時刻出界 " + Math.round(r.tEnd));
          for (var q = 1; q < r.pts.length; q++)
            if (r.pts[q].t < r.pts[q - 1].t - 1e-9) fails.push(n + ": #" + id + " 曲線非單調");
        });
        rec.ranking.forEach(function (id) {
          if (!rec.out[id - 1]) return;
          var r = sc.racers[id];
          var endX = r.pts[r.pts.length - 1].x;
          if (Math.abs(endX - rec.out_at[id - 1]) > 0.5) fails.push(n + ": #" + id + " 出包點錯位");
          if (r.tEnd > 8450) fails.push(n + ": #" + id + " 出包時刻過晚 " + Math.round(r.tEnd));
          if (sc.F > 0) {   // 鐵則量化檢查：出包當下領先者已跑在前面
            var lead = 0;
            for (var k = 1; k <= 8; k++)
              if (!sc.racers[k].out) lead = Math.max(lead, evalX(sc.racers[k].pts, r.tEnd));
            if (lead + 0.6 < endX) fails.push(n + ": #" + id + " 出包時仍領先（穿幫）");
          }
        });
      }
      return { rounds: tested, ok: tested > 0 && fails.length === 0, fails: fails };
    },

    /** 下注階段重播歷史局（驗收/截圖用；outcome 讀既有紀錄，不生成） */
    _preview: function (n) {
      var st = RoundEngine.getState();
      if (st.phase !== "betting") { console.warn("[race-fx] 僅下注階段可預覽"); return false; }
      var rec = AdapterB.getRoadRecord(n || st.round_no - 1);
      if (!rec) { console.warn("[race-fx] 局 " + n + " 無紀錄（僅當靴歷史局可預覽）"); return false; }
      start(roundFromRecord(rec), outcomeFromRecord(rec), Date.now() + 1200, true);
      return true;
    },

    /** 取局 n 的編排事件表（驗收/截圖工具：出包/衝線時刻） */
    _script: function (n) {
      var rec = AdapterB.getRoadRecord(n);
      if (!rec) return null;
      var sc = buildScript(roundFromRecord(rec), outcomeFromRecord(rec));
      return { n: n, events: sc.events.map(function (e) {
        return { t: Math.round(e.t), kind: e.kind, id: e.id || 0 };
      }) };
    },

    /** 找某動物出包的歷史局號（驗收工具） */
    _findOutRounds: function (id, span) {
      var live = AdapterB.liveRoundNo(), hits = [];
      for (var n = Math.max(1, live - (span || 200)); n < live; n++) {
        var rec = AdapterB.getRoadRecord(n);
        if (rec && rec.out[id - 1]) hits.push(n);
      }
      return hits;
    },

    ping: function () { return "race-fx.js OK"; }
  };
})();
