/* ============================================================
 * roads.js ── B06 路子演算法【可移植邏輯層】
 * 唯一依據：reports/B規格書_v1.html §7（v1.3；冷熱門檻依 §12 Q3
 * 定案＝前三熱門）。演算法本體自 reports/路子模擬器.html v4 抽出
 * （大路排欄／龍尾佔位／大眼仔・小路・蟑螂路偏移 1/2/3）。
 *
 * 零 DOM、零計時器、無內部狀態──全部純函式：
 *   輸入＝賽果紀錄（條目）陣列，輸出＝各路的格子陣列資料結構，
 *   渲染歸拋棄式層（roads-ui.js）。轉 Cocos / Unity 時本檔照搬。
 *
 * 資料流形狀：
 *   紀錄 rec（adapter-b 賽果紀錄流）＝
 *     { n, seg:{grass,mud,water}, an:[{m,d,ow,oo,b,t,f}×8],
 *       ranking:[8], out:[bool×8], out_at:[8] }
 *   條目 entry（entry() 產出，路子的最小輸入）＝
 *     { n, shoe, sr, champion, outCount, big, odd, hot, longshot }
 *   二元序列 seq（project() 產出）＝ [{ v:"Y"|"B", gold, n }]
 *
 * 冷熱判定（§7.2／Q3）：
 *   守住＝冠軍屬勝率前 FAV_TOP(3) 熱門；大冷門＝勝率末
 *   LONG_BOTTOM(2) 奪冠（金斜線註記層，不斷路、不另成珠）。
 *   勝率不用蒙地卡羅估計，而由聯合分佈「精確枚舉」：出包集合
 *   共 2^8 種，逐一算 P(集合)×倖存者依權重奪冠機率——與
 *   mock-server drawVector 同一分佈的解析解，決定性、零噪音，
 *   任何裝置任何時刻重算必得同一排名（歷史回補的一致性基礎）。
 * ============================================================ */

var Roads = (function () {
  "use strict";

  var N = 8;
  var SHOE_SIZE = 200;                       // §7.7 每 200 局換靴（tables-b/引擎同值）
  var FAV_TOP = 3, LONG_BOTTOM = 2;          // §12 Q3 定案（呼叫端可傳參覆寫）

  /* ── 靴（§7.7）── */
  function shoeOf(n) { return Math.floor((n - 1) / SHOE_SIZE) + 1; }
  function shoeRound(n) { return ((n - 1) % SHOE_SIZE) + 1; }        // 1-based 靴內局號

  /* ── 精確勝率：枚舉 2^8 出包集合 ──
   * P(i 奪冠) = Σ_集合 P(該出包集合) × [i 未出包] × w_i / Σ倖存 w
   * 全滅集合（機率 ~5.6e-7）：冠軍＝out_at 最大者，out_at 為
   * 同分佈獨立均勻 → 每隻 1/8（§5.3）。 */
  function winProbs(weights, pouts) {
    var probs = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var mask = 0; mask < 256; mask++) {
      var pm = 1, tw = 0, i;
      for (i = 0; i < N; i++) {
        if (mask & (1 << i)) pm *= pouts[i];
        else { pm *= 1 - pouts[i]; tw += weights[i]; }
      }
      if (pm === 0) continue;
      if (mask === 255) { for (i = 0; i < N; i++) probs[i] += pm / N; }
      else for (i = 0; i < N; i++) if (!(mask & (1 << i))) probs[i] += pm * weights[i] / tw;
    }
    return probs;
  }

  /** 勝率排名（高→低；同分小編號在前）→ 動物 id 陣列 */
  function favOrder(weights, pouts) {
    var probs = winProbs(weights, pouts);
    var ids = [1, 2, 3, 4, 5, 6, 7, 8];
    ids.sort(function (a, b) {
      return probs[b - 1] !== probs[a - 1] ? probs[b - 1] - probs[a - 1] : a - b;
    });
    return ids;
  }

  /** 冷熱旗標：hot＝冠軍屬前 favTop 熱門；longshot＝屬末 longBottom */
  function hotFlags(weights, pouts, champion, favTop, longBottom) {
    var order = favOrder(weights, pouts);
    var rank = order.indexOf(champion);              // 0-based 熱門名次
    return {
      hot: rank < (favTop || FAV_TOP),
      longshot: rank >= N - (longBottom || LONG_BOTTOM)
    };
  }

  /* ── 紀錄 → 條目（路子的最小輸入；weights/pouts 由呼叫端依
   *    數值表折算心情後代入，本模組不依賴 TablesB）── */
  function entry(rec, weights, pouts, favTop, longBottom) {
    var champ = rec.ranking[0];
    var outCount = 0;
    for (var i = 0; i < N; i++) if (rec.out[i]) outCount++;
    var f = hotFlags(weights, pouts, champ, favTop, longBottom);
    return {
      n: rec.n, shoe: shoeOf(rec.n), sr: shoeRound(rec.n),
      champion: champ, outCount: outCount,
      big: champ >= 5, odd: champ % 2 === 1,
      hot: f.hot, longshot: f.longshot
    };
  }

  function filterShoe(entries, shoe) {
    return entries.filter(function (e) { return e.shoe === shoe; });
  }

  /* ── 二元投影（§7.2）：kind = "bs" 大小 | "oe" 奇偶 | "hot" 冷熱 ── */
  function project(entries, kind) {
    return entries.map(function (e) {
      var v = kind === "bs" ? (e.big ? "Y" : "B")
            : kind === "oe" ? (e.odd ? "Y" : "B")
            : (e.hot ? "Y" : "B");
      return { v: v, gold: kind === "hot" && e.longshot, n: e.n };
    });
  }

  function counts(seq) {
    var y = 0, b = 0, gold = 0;
    seq.forEach(function (c) { if (c.v === "Y") y++; else b++; if (c.gold) gold++; });
    return { y: y, b: b, gold: gold };
  }

  /* ── 大路排欄：同結果往下疊、變色換新列（模擬器 v4 原式）── */
  function toColumns(seq) {
    var cols = [];
    seq.forEach(function (e) {
      var last = cols[cols.length - 1];
      if (!last || last.v !== e.v) cols.push({ v: e.v, items: [e] });
      else last.items.push(e);
    });
    return cols;
  }

  /* ── 大路座標：超過 maxRows 轉龍尾（向右折行、佔位判定）──
   * 回傳格子陣列 [{x, y, v, gold, n}]（模擬器 v4 原式）。 */
  function layoutBigRoad(cols, maxRows) {
    var occ = {}, cells = [], nextX = 0;
    cols.forEach(function (col) {
      var x = nextX; while (occ[x + ",0"]) x++;
      var px = x, py = 0;
      col.items.forEach(function (item, r) {
        if (r > 0) { if (py < maxRows - 1 && !occ[px + "," + (py + 1)]) py++; else px++; }
        occ[px + "," + py] = 1;
        cells.push({ x: px, y: py, v: col.v, gold: item.gold, n: item.n });
      });
      nextX = x + 1;
    });
    return cells;
  }

  /* ── 衍生路（大眼仔/小路/蟑螂路＝欄位偏移 1/2/3；模擬器 v4 原式）── */
  function derived(cols, off) {
    var out = [];
    for (var ci = 0; ci < cols.length; ci++) {
      for (var r = 0; r < cols[ci].items.length; r++) {
        if (r === 0) {
          if (ci - 1 - off < 0) continue;
          out.push({ v: cols[ci - 1].items.length === cols[ci - 1 - off].items.length ? "Y" : "B" });
        } else {
          if (ci - off < 0) continue;
          var L = cols[ci - off].items.length;
          out.push({ v: L >= r + 1 ? "Y" : (L === r ? "B" : "Y") });
        }
      }
    }
    return out;
  }

  /* ── 珠盤格（§7.3 讀法）：一局一珠、由上往下、滿 rows 換列。
   * 以「靴內局號」定位（跨裝置、回補先後皆對齊，不隨新局平移）。 */
  function beadCells(entries, rows) {
    rows = rows || 6;
    return entries.map(function (e) {
      var idx = e.sr - 1;
      return { x: Math.floor(idx / rows), y: idx % rows, e: e };
    });
  }

  /* ── 二元珠盤格：同靴內定位，帶投影值 ── */
  function binaryBeadCells(entries, kind, rows) {
    rows = rows || 6;
    var seq = project(entries, kind);
    return entries.map(function (e, i) {
      var idx = e.sr - 1;
      return { x: Math.floor(idx / rows), y: idx % rows, v: seq[i].v, gold: seq[i].gold, n: e.n };
    });
  }

  return {
    SHOE_SIZE: SHOE_SIZE,
    FAV_TOP: FAV_TOP, LONG_BOTTOM: LONG_BOTTOM,
    shoeOf: shoeOf, shoeRound: shoeRound,
    winProbs: winProbs, favOrder: favOrder, hotFlags: hotFlags,
    entry: entry, filterShoe: filterShoe,
    project: project, counts: counts,
    toColumns: toColumns, layoutBigRoad: layoutBigRoad, derived: derived,
    beadCells: beadCells, binaryBeadCells: binaryBeadCells,
    ping: function () { return "roads.js OK"; }
  };
})();

/* Node CLI 環境相容（瀏覽器忽略） */
if (typeof module !== "undefined" && module.exports) module.exports = Roads;
