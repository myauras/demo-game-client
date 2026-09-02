/* ============================================================
 * mc-worker.js ── 全量 MC 預跑 Web Worker【B07 前置技術項】
 *
 * 動機：newRound（兩次 100 萬次蒙地卡羅 ≈ 0.7–1s）原在主執行緒
 * 演出段預跑，動畫進場後會吃幀。mock-server-b.js 為凍結檔但零 DOM
 * 可移植——本 Worker 以 importScripts 原封載入，跑完把結果交回。
 *
 * 決定性（與主執行緒自跑逐 bit 一致）的達成方式與 adapter-b 同款：
 *   1. 先安裝 Math.random 調度器，再 importScripts mock-server-b
 *      （它載入時捕捉 rng = Math.random，之後可被調度器接管）。
 *   2. 每次 pregen 請求附上主執行緒當下的完整狀態 _dump——Worker
 *      _load 後與主執行緒同狀態；再以同一「局號種子 round 流」跑
 *      newRound。同狀態＋同種子＋同程式 ⇒ 同封包、同新狀態。
 *   3. 回傳封包與跑完後的 _dump，主執行緒驗證未過期後整份回寫。
 *
 * 協定：
 *   收 { type:"pregen", n, tag, mcRuns, dump }
 *   回 { type:"pregen_done", n, tag, packet, dump }
 *      | { type:"pregen_fail", n, tag, message }
 *   開機自報 { type:"ready" }
 * ============================================================ */

"use strict";

/* Math.random 調度器：必須先於 mock-server-b.js 安裝（同 adapter-b） */
var nativeRandom = Math.random;
var rngOverride = null;
Math.random = function () { return rngOverride ? rngOverride() : nativeRandom.call(Math); };

importScripts("tables-b.js", "mock-server-b.js");

function withRng(rng, fn) {
  rngOverride = rng;
  try { return fn(); } finally { rngOverride = null; }
}

/* 與 round-engine / adapter-b 完全同款的局號種子派生（常數不可漂移） */
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
function rngFor(round_no, stream) {
  return mulberry32((Math.imul(round_no, 2654435761) ^ strHash(stream)) >>> 0);
}

onmessage = function (e) {
  var m = e.data || {};
  if (m.type !== "pregen") return;
  try {
    MockServerB._load(m.dump);          // 與主執行緒對齊狀態（上一局已 settled）
    MockServerB._setMcRuns(m.mcRuns);
    withRng(rngFor(m.n, "round"), function () { MockServerB.newRound(); });
    postMessage({
      type: "pregen_done", n: m.n, tag: m.tag,
      packet: MockServerB.getRound(),
      dump: MockServerB._dump()
    });
  } catch (err) {
    postMessage({ type: "pregen_fail", n: m.n, tag: m.tag,
                  message: String((err && err.message) || err) });
  }
};

postMessage({ type: "ready" });
