/* ============================================================
 * tables-b.js ── 專案 B「動物大賽跑」數值表【可移植資產】
 * 唯一依據：reports/B規格書_v1.html（v1.1 定稿）。
 * 轉 Cocos / Unity 時此檔邏輯照搬。禁止引用任何畫面相關程式。
 *
 * 【B04 數值驗證 2026-09-01】原標注【待B04】的參數已全數定案（詳見
 * reports/B04-數值驗證報告.html）。本次調整：W_SHARP=1.5（新增）、
 * ROAD_HOT 前三門檻（新增）、MC_RUNS 10萬→100萬（更正誤讀）；
 * ATTR/MOODS/P_OUT/心情抽選維持 B03 初值定案。
 * ============================================================ */

var TablesB = (function () {
  "use strict";

  var PARAM_VERSION = "b-demo-b04-01";

  // §1.1 八隻動物（編號、名稱、代表色固定，貫穿全遊戲）
  var ANIMALS = [
    { id: 1, name: "小兔", color: "#F2F2F0" },
    { id: 2, name: "阿汪", color: "#C98B5B" },
    { id: 3, name: "鴨鴨", color: "#FFD02F" },
    { id: 4, name: "山羊", color: "#AEB6BF" },
    { id: 5, name: "獵豹", color: "#E8B14C" },
    { id: 6, name: "袋鼠", color: "#D9814C" },
    { id: 7, name: "烏龜", color: "#7FA65A" },
    { id: 8, name: "小豬", color: "#D97BA6" }
  ];

  // §3.1 屬性：每局每隻均勻重抽 30–95【B04 定案 2026-09-01：維持】
  var ATTR_MIN = 30, ATTR_MAX = 95;

  /* §4 心情：守則③一心情一屬性（Q5 已裁決）。
   * 幅度【B04 定案 2026-09-01，Q2：維持 +15/−20/−20】——受控量測（γ=1.5 後）：
   * 亢奮勝率 +1.3pp（勝賠 7.59→6.86▼）、想睡出包率 +6.1pp（出包賠 5.59→4.10▼）、
   * 怯場勝率 −3.5pp／水多賽道 −4.2pp（勝賠 ▲ 至 10.6/11.4），偏移可讀、
   * 賠率修正方向與幅度一致（各盤 EV 均貼目標 RTP）。 */
  var MOODS = {
    hyper:   { label: "亢奮", emoji: "🔥", attr: "burst",   delta: +15 },
    sleepy:  { label: "想睡", emoji: "😪", attr: "focus",   delta: -20 },
    nervous: { label: "怯場", emoji: "😰", attr: "terrain", delta: -20 }
  };
  var MOOD_KEYS = ["hyper", "sleepy", "nervous"];

  /* Q6 心情抽選規則【B04 驗證通過定案 2026-09-01：維持 B03 初版】：
   *   每局均勻抽 2 或 3 隻（各 50%），洗牌取前 count；
   *   心情種類三選一均勻、彼此獨立；無跨局記憶（同隻可連續多局有心情）。
   *   4000 輪實測：2/3 隻各半、逐隻均勻（1226–1273/8000）、種類均勻、
   *   跨局重複率 31.7% ≈ 獨立期望 31.25%。 */
  var MOOD_COUNT_MIN = 2, MOOD_COUNT_MAX = 3;

  /* §5.1 出包率：p = BASE + SPAN × (REF − 專注)/RANGE，clamp [MIN, MAX]
   * 【B04 定案 2026-09-01，Q1：維持】——2000 萬局實測：出包 0/1/2 隻佔 86.8%
   * （演出負擔可控）、4+ 隻 2.97%（紅徽章有感稀有）、有出包:零出包 3.24:1
   * （合 §7.3 ~3:1 前提）、全滅 ~5.6e-7/局（每靴 200 局出現率 0.011%）。 */
  var P_OUT = { BASE: 0.06, SPAN: 0.20, REF: 95, RANGE: 65, MIN: 0.06, MAX: 0.26 };

  // §6.1 RTP 檔位（Q9 已裁決：維持 95/95/94/94，Demo 佔位，正式檔位由營運層定）
  var RTP = { win: 0.95, exacta: 0.95, out: 0.94, no_out: 0.94 };

  var TRACK_LEN = 1000;   // 賽道長（公尺）；out_at 取 1–TRACK_LEN，未出包＝0

  /* 每輪蒙地卡羅次數【B04 更正 2026-09-01】：規格 §6.2 要求「≥100 萬輪」，
   * B03 誤讀為「≥10 萬」。10 萬輪對稀有前二連盤口的命中率估計有 ±3–7% 相對
   * 噪音，會開出知情玩家 EV>100% 的賠率（B04 防套利掃描實測 0.77% 盤口翻正、
   * 最高 108.9%）；改 100 萬後噪音 3σ 壓進莊家邊際內，殘餘暴露僅極端尾部。 */
  var MC_RUNS = 1000000;
  var ODDS_CAP = 500;     // 賠率保險上限：命中率極低時封頂（封頂只會更利莊家，不破壞防套利）
  var BET_LIMITS = { min: 10, max: 5000, steps: [10, 50, 100, 500] };

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  /** §5.1 由專注（心情折算後）反推出包率 */
  function pOut(focus) {
    return clamp(P_OUT.BASE + P_OUT.SPAN * (P_OUT.REF - focus) / P_OUT.RANGE, P_OUT.MIN, P_OUT.MAX);
  }

  /* §3.2 勝率權重底值 = 爆發×直線占比 + 地形×泥水占比（屬性須先折算心情）。
   * W_SHARP【B04 調參 2026-09-01】：抽樣時取底值的 1.5 次方（Q3 權重銳利度）。
   *   γ=1 時冷熱守住率過低（前二 32.6%／前三 46.7% 貼帶緣）；γ=1.5 搭配
   *   ROAD_HOT.FAV_TOP=3 守住率 50.7% 落帶中心，賠率帶仍健康（勝賠約 3.3–85x）。
   *   γ 僅作用於抽樣銳利度，單調不變──屬性條讀法（越長越強）不受影響。 */
  var W_SHARP = 1.5;
  function weight(attrs, segments) {
    var base = attrs.burst * segments.grass + attrs.terrain * (segments.mud + segments.water);
    return Math.pow(base, W_SHARP);
  }

  /* §7.2 冷熱路門檻【B04 調參 2026-09-01，Q3 定案】：
   *   守住＝冠軍屬勝賠前 FAV_TOP 熱門（由規格初值「前二」改為「前三」）；
   *   大冷門＝勝賠末 LONG_BOTTOM 奪冠（維持「末二」，實測頻率約 15%）。
   *   供 B06 路子投影使用。 */
  var ROAD_HOT = { FAV_TOP: 3, LONG_BOTTOM: 2 };

  /** §10.4 前二連組合鍵：不計順序、小編號在前，例 "1-2"（共 28 組） */
  function exactaKey(a, b) { return a < b ? a + "-" + b : b + "-" + a; }

  return {
    PARAM_VERSION: PARAM_VERSION,
    ANIMALS: ANIMALS,
    ATTR_MIN: ATTR_MIN, ATTR_MAX: ATTR_MAX,
    W_SHARP: W_SHARP,
    ROAD_HOT: ROAD_HOT,
    MOODS: MOODS, MOOD_KEYS: MOOD_KEYS,
    MOOD_COUNT_MIN: MOOD_COUNT_MIN, MOOD_COUNT_MAX: MOOD_COUNT_MAX,
    P_OUT: P_OUT,
    RTP: RTP,
    TRACK_LEN: TRACK_LEN,
    MC_RUNS: MC_RUNS,
    ODDS_CAP: ODDS_CAP,
    BET_LIMITS: BET_LIMITS,
    pOut: pOut,
    weight: weight,
    exactaKey: exactaKey,
    ping: function () { return "tables-b.js OK（" + PARAM_VERSION + "）"; }
  };
})();

/* Node CLI 環境相容（瀏覽器忽略） */
if (typeof module !== "undefined" && module.exports) module.exports = TablesB;
