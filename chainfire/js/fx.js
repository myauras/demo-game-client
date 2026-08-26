/* ============================================================
 * fx.js ── 江面捲動場景【拋棄式資產】（T06 look-dev）
 * 倒梯形大船 + 鏡頭跟隨火線。轉引擎時整檔重做，本檔僅作
 * 「演出設計決策」的活分鏡：鏡頭距離、構圖比例、三態表現。
 *
 * 效能守則（舊手機）：動畫全部 transform/opacity（CSS keyframes），
 * JS 只在節點事件時改 class / transform，不逐幀執行。
 * 同時動畫元素：波 2 + 旗 12 + 火 3 + 煙 2 + 小艇 1 ≈ 20。
 * ============================================================ */

var RiverFX = (function () {
  "use strict";

  var SHIP_W = 88;
  var SPACING = 122;          // 船距（中心到中心）
  var OFFSET = 150;           // 第 1 艘船左緣的世界座標
  var CAM_ANCHOR = 0.42;      // 燃燒中的船保持在畫面寬的 42% 處
  var N = 12;

  var river, world, progressEl;
  var ships = [];
  var worldW = OFFSET + N * SPACING + 80;

  function el(cls, parent, html) {
    var d = document.createElement("div");
    d.className = cls;
    if (html) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  }

  function init() {
    river = document.getElementById("river");
    world = document.getElementById("world");
    progressEl = document.getElementById("progress");
    world.style.width = worldW + "px";

    el("wave", world).style.width = worldW * 2 + "px";
    el("wave w2", world).style.width = worldW * 2 + "px";

    var chain = el("", world);
    chain.id = "chain";
    chain.style.cssText = "position:absolute;bottom:58px;left:" + (OFFSET - 40) + "px;width:" + (N * SPACING) + "px;border-top:3px dashed #7a6420;opacity:.8;";

    var boat = el("", world);
    boat.id = "boat";
    boat.style.left = "40px";

    for (var i = 1; i <= N; i++) {
      var w = el("shipwrap", world);
      w.style.left = (OFFSET + (i - 1) * SPACING) + "px";
      el("hull", w, "<b>" + i + "</b>");
      el("mast", w);
      el("sail", w);
      el("flag", w);
      el("glow", w);
      el("flames", w, "<i></i><i></i><i></i>");
      el("smoke", w, "<i></i><i></i>");
      ships.push(w);
    }
    reset();
  }

  function viewW() { return river.clientWidth; }

  /** 鏡頭移到第 n 艘（0 = 起點看小艇與第 1 艘）；ms = 移動時長 */
  function cameraTo(n, ms) {
    var shipX = n <= 0 ? 0 : OFFSET + (n - 1) * SPACING + SHIP_W / 2;
    var x = Math.max(0, Math.min(shipX - viewW() * CAM_ANCHOR, worldW - viewW()));
    world.style.transitionDuration = (ms === 0 ? 0 : (ms || 900)) + "ms";
    world.style.transform = "translateX(" + (-x) + "px)";
  }

  function setProgress(n) { progressEl.textContent = n + " / " + N; }

  function setState(n, cls) { ships[n - 1].className = "shipwrap" + (cls ? " " + cls : ""); }

  /** 新局：全船未燒、鏡頭回起點 */
  function reset() {
    for (var i = 1; i <= N; i++) setState(i, "");
    cameraTo(0, 600);
    setProgress(0);
    document.getElementById("dim").style.opacity = "0";
  }

  return {
    init: init,
    reset: reset,

    setWind: function (wind) { river.className = "wind-" + wind; },

    /** 火勢燒向第 n 艘（BURNING 開始）：該船起火、鏡頭跟進；前一艘餘焰轉焦黑 */
    burning: function (n, ms) {
      if (n > 1) setState(n - 1, "burned");
      setState(n, "burning");
      cameraTo(n, ms || 900);
    },

    /** 燒穿第 n 艘：轉焦黑但保留餘焰（決策等待期間火不熄） */
    burned: function (n) {
      setState(n, "burned hot");
      setProgress(n);
    },

    /** 火在第 n 艘熄滅：白煙 + 畫面壓暗；前一艘餘焰同步熄 */
    extinguished: function (n) {
      if (n > 1) setState(n - 1, "burned");
      setState(n, "ext");
      document.getElementById("dim").style.opacity = ".45";
    },

    /** 通關：十二艘全燃 + 鏡頭拉遠看全景 */
    clearAll: function () {
      for (var i = 1; i <= N; i++) setState(i, "burned");
      setProgress(N);
      var s = (viewW() - 16) / worldW;
      world.style.transitionDuration = "1000ms";
      world.style.transform = "translateX(8px) scale(" + s + ")";
    },

    /** 重連還原：前 node 艘已燒、鏡頭直接跳到位（不重播） */
    restore: function (node, wind) {
      river.className = "wind-" + wind;
      for (var i = 1; i <= N; i++) setState(i, i <= node ? "burned" : "");
      setProgress(node);
      cameraTo(node, 0);
    },

    ping: function () { return "fx.js OK"; }
  };
})();
