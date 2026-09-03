/* ============================================================
 * sfx.js ── B08-R2 音效骨架【拋棄式演出層・目前全域停用】
 *
 * R2 裁決（2026-09-03）：Demo 不採用音效（B08 初版的 Kenney CC0
 * 音檔實聽不合，使用者後續自找資源）。本檔留骨架：
 *   - DISABLED = true → init/play 全部 no-op（零 fetch、零監聽、
 *     零 AudioContext），呼叫端（game.js / race-fx.js 鉤子）不需拆。
 *   - 之後換資源：把音檔放 assets/sfx/、FILES 填上檔名、
 *     DISABLED 改 false 即恢復整套播放（預解碼／首次互動解鎖／
 *     背景分頁不播／靜音記憶 gbr_b08_mute）。
 *
 * 觸發點（已接好，停用中）：
 *   bet   下注確認（game.js confirmBets）
 *   coins 派彩滾動起點（game.js overlaySettle）
 *   tick / go  發車倒數 2/1／GO（race-fx updateCountdown 鉤子）
 *   gag   出包（race-fx fire 鉤子）
 *   cheer 冠軍衝線（race-fx fire 鉤子）
 * ============================================================ */

var SFX = (function () {
  "use strict";

  var DISABLED = true;                  // R2 裁決：Demo 不出聲（換資源時改 false）

  /* 檔名表：換資源時填 assets/sfx/ 下的檔名（建議 WAV/MP3，iOS 不解 OGG） */
  var FILES = { bet: "", coins: "", tick: "", go: "", gag: "", cheer: "" };
  var GAIN = { bet: 0.9, coins: 1.0, tick: 0.8, go: 0.9, gag: 0.85, cheer: 0.9 };
  var KEY = "gbr_b08_mute";

  var ctx = null, buffers = {}, unlocked = false;
  var muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) {}

  function init() {
    if (DISABLED) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    Object.keys(FILES).forEach(function (name) {
      if (!FILES[name]) return;
      fetch("assets/sfx/" + FILES[name])
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) {
          ctx.decodeAudioData(ab, function (buf) { buffers[name] = buf; }, function () {});
        })
        .catch(function () {});
    });
    var unlock = function () {
      unlocked = true;
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
  }

  function play(name) {
    if (DISABLED || muted || !ctx || !unlocked || document.hidden) return;
    var buf = buffers[name];
    if (!buf || ctx.state !== "running") return;
    try {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.value = GAIN[name] || 1;
      src.connect(g); g.connect(ctx.destination);
      src.start();
    } catch (e) {}
  }

  return {
    init: init,
    play: play,
    countdown: function (key) { play(key === "GO" ? "go" : "tick"); },
    raceEvent: function (kind, ev) {
      if (kind === "out") play("gag");
      else if (kind === "finish" && ev && ev.rank === 0) play("cheer");
    },
    isMuted: function () { return muted; },
    toggleMute: function () {
      muted = !muted;
      try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) {}
      return muted;
    },
    ping: function () { return "sfx.js OK（DISABLED＝" + DISABLED + "）"; }
  };
})();
