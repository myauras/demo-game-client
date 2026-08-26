/* ============================================================
 * tables.js ── 三套倍率階梯數值表【可移植資產】
 * 轉 Cocos / Unity 時此檔邏輯照搬。禁止 import / 引用任何畫面相關程式。
 *
 * 規則書 §2.4：
 *   - 恆定 RTP：任一節點收兵 EV 均為 RTP（0.96）
 *   - 存活率一律由 S_n = RTP / M_n 程式反推，不可手填、不可單點修改
 * ============================================================ */

var GameTables = (function () {
  "use strict";

  var RTP = 0.96;
  var MAX_NODES = 12;

  // 倍率表（規則書 §2.4 原文數值）
  var LADDERS = {
    gentle:    [1.10, 1.25, 1.42, 1.62, 1.85, 2.10, 2.40, 2.75, 3.15, 3.60, 4.10, 4.70],
    standard:  [1.20, 1.45, 1.75, 2.10, 2.55, 3.10, 3.80, 4.70, 5.90, 7.60, 10.20, 15.00],
    east_wind: [1.35, 1.85, 2.55, 3.50, 4.85, 6.70, 9.30, 12.90, 17.90, 24.80, 34.50, 48.00]
  };

  // 風向出現機率（%）
  var WIND_DISTRIBUTION = { gentle: 35, standard: 50, east_wind: 15 };

  var WIND_LABELS = { gentle: "微風", standard: "江風", east_wind: "東風大作" };

  /**
   * 由倍率表反推每節數據。
   * S_n = RTP / M_n（累積存活率）；p_n = S_n / S_{n-1}（該節續燃率）
   * TODO(T03)：sim.html 以大量模擬驗證本推導與實測 RTP。
   */
  function derive(ladder) {
    var rows = [];
    var prevS = 1;
    for (var i = 0; i < ladder.length; i++) {
      var S = RTP / ladder[i];
      rows.push({
        node: i + 1,
        multiplier: ladder[i],
        survival: S,        // 累積存活至本節機率
        burnRate: S / prevS // 該節續燃率 p_n
      });
      prevS = S;
    }
    return rows;
  }

  // 預先算好三套完整表
  var DERIVED = {};
  Object.keys(LADDERS).forEach(function (wind) {
    DERIVED[wind] = derive(LADDERS[wind]);
  });

  return {
    RTP: RTP,
    MAX_NODES: MAX_NODES,
    LADDERS: LADDERS,
    WIND_DISTRIBUTION: WIND_DISTRIBUTION,
    WIND_LABELS: WIND_LABELS,
    DERIVED: DERIVED,
    derive: derive,
    ping: function () { return "tables.js OK"; }
  };
})();
