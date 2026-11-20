/* =========================================================================
 * 連鎖開箱——數值單點（可移植・凍結）
 *
 * 紀律（改東西前先讀）：
 *  1. 禁手改單點：CFG 只放鐵表（TASKS.md「已定案數值」）的常數；其餘一律由程式導出。
 *  2. 嚴禁暗改機率（顏色種類數 kinds、金箱率 GOLD_P 都是真實機率，抽盤面與賠率都吃它）。
 *  3. 要調 RTP 只准動賠率表（PAY 區塊，由 test/tune.js 產生，禁手改）。
 *  4. 本檔零 DOM、零依賴；瀏覽器以 <script> 載入、Node 以 eval 載入（test/*.js）。
 *     不要加頂層 'use strict'：eval 時要讓 var EV／DEMO_KEY 落在呼叫端作用域。
 *
 * 玩法：6 欄 × 7 列，每格在該檔 K 種顏色中均勻抽（4% 是金箱）；同色上下左右連 ≥ 4 個為一片，
 * 一片的賠付＝依片大小的賠率 × 當次連鎖倍率 × 金箱倍率；爆完上面掉下來再連再爆；一局算完一次結算。
 * ========================================================================= */

/* 記號：新建腳本會把 crate 換成 [a-z][a-z0-9]{1,11} 短名；沒替換也能跑 */
var DEMO_KEY = 'crate';

var EV = (function(){

/* ---------- 鐵表（只放鐵表數字） ---------- */
var CFG = {
  COLS: 6, ROWS: 7,                      // 盤面 6 欄 × 7 列
  MIN_GROUP: 4,                          // 一片＝同色上下左右相連 ≥ 4 個
  MAX_SIZE: 10,                          // 賠率表的片大小 4、5、…、10（10 代表 10 以上）
  TIERS: [                               // 三檔（注別，上限 3 種）
    // kinds：顏色種類數；ladder：連鎖倍率階梯（第 1 次連鎖起，超過最後一格維持最後一格）；
    // shape：賠率表的相對比例（片大小 4～10+）。賠率表本身由 tune.js 校出，見 PAY 區塊。
    { id:'stable', kinds:5, ladder:[1, 2, 3, 4, 6, 10],  shape:[1, 1.4, 2, 3, 4.5, 7, 10] },
    { id:'mid',    kinds:6, ladder:[1, 2, 3, 5, 10, 25], shape:[1, 1.5, 2.5, 4, 7, 12, 20] },
    { id:'wild',   kinds:7, ladder:[1, 2, 4, 8, 20, 60], shape:[1, 1.6, 3, 6, 12, 25, 50] }
  ],
  GOLD_P: 0.04,                          // 每個箱子 4% 是金箱
  GOLD_MULT: 2,                          // 一片裡每有一個金箱，那片賠付 ×2
  MAX_CHAIN: 30,                         // 單局連鎖最多 30 次
  MAX_WIN_X: 500,                        // 單局最高 500 倍本金
  RTP: 0.965,                            // RTP 目標（三檔相同）
  RTP_MIN: 0.96, RTP_MAX: 0.97,          // 容許範圍 96%～97%
  BIG_X: 5, JACKPOT_X: 20,               // 演出分級：≥5 倍「大贏」、≥20 倍「大獎」
  STAKES: [100, 500, 1000],              // 注額
  DEFAULT_STAKE: 100,
  WALLET: 10000,                         // 起始錢包
  LOG_CAP: 50                            // 勝負 log 封頂筆數（公司規格）
};
var N_SIZES = CFG.MAX_SIZE - CFG.MIN_GROUP + 1;     // 賠率表格數（7）
var RTP_TOL = 0.001;                                // 載入自檢容許 ±0.1pp

/*PAY-START 賠率表區塊：由 test/tune.js 產生並寫入，禁手改*/
var TUNED = { untuned:false,
  generated:{ cmd:'node test/tune.js 30000000 12345', n:30000000, seed:12345, shards:32, date:'2026-11-19' },
  W:   { stable:[5.00662003, 2.05163653, 0.88302607, 0.3787696, 0.16247757, 0.06945323, 0.0516319],
           mid:[2.1801965, 0.76913667, 0.28412077, 0.10469983, 0.03879427, 0.01460407, 0.00886957],
           wild:[1.22821987, 0.38418277, 0.1253764, 0.0413812, 0.0136483, 0.0045856, 0.00235303] },
  pay: { stable:[0.077, 0.108, 0.155, 0.231, 0.346, 0.54, 0.771],
           mid:[0.19, 0.284, 0.473, 0.759, 1.329, 2.277, 3.795],
           wild:[0.337, 0.539, 1.012, 2.022, 4.043, 8.425, 16.85] } };
/*PAY-END*/

/* 載入自檢：用 tune 當時存下的每局各片加權次數 W 重算 Σ W·pay，須落在 RTP 目標 ±0.1pp 內，否則 throw */
function theoryRtp(id){
  var pay = TUNED.pay[id], W = TUNED.W[id], s = 0, i;
  for(i = 0; i < N_SIZES; i++) s += W[i] * pay[i];
  return s;
}
(function(){
  if(TUNED.untuned) return;
  CFG.TIERS.forEach(function(t){
    var pay = TUNED.pay && TUNED.pay[t.id], W = TUNED.W && TUNED.W[t.id], i;
    if(!pay || !W || pay.length !== N_SIZES || W.length !== N_SIZES)
      throw new Error('values.js：檔 ' + t.id + ' 缺賠率表或加權次數 W，請重跑 test/tune.js');
    for(i = 0; i < N_SIZES; i++){
      if(!(pay[i] > 0)) throw new Error('values.js：檔 ' + t.id + ' 賠率必須為正');
      if(i > 0 && pay[i] < pay[i - 1]) throw new Error('values.js：檔 ' + t.id + ' 賠率表必須不遞減');
    }
    var r = theoryRtp(t.id);
    if(Math.abs(r - CFG.RTP) > RTP_TOL + 1e-9 || r < CFG.RTP_MIN || r > CFG.RTP_MAX)
      throw new Error('values.js：檔 ' + t.id + ' 由 W×賠率算出的 RTP ' + (r * 100).toFixed(3) +
        '% 偏離目標 ' + (CFG.RTP * 100) + '% 超過 0.1pp，請重跑 test/tune.js');
  });
})();

/* 導出表：每檔 { id, kinds, ladder, pay }（pay 為倍本金，依片大小 4～10+） */
var TIERS = CFG.TIERS.map(function(t){
  return { id:t.id, kinds:t.kinds, ladder:t.ladder.slice(), pay:TUNED.pay[t.id].slice() };
});

function ids(){ return CFG.TIERS.map(function(t){ return t.id; }); }
function tierIndex(id){
  for(var i = 0; i < CFG.TIERS.length; i++) if(CFG.TIERS[i].id === id) return i;
  return -1;
}

/* 顯示：2 位無條件捨去（先四捨到 1e-6 吃浮點雜訊） */
function floor2(n){ return Math.floor(Math.round(n * 1e6) / 1e4) / 100; }
/* 顯示：最多 2 位小數、無條件捨去、尾端的 0 不補（12.40→12.4、2.00→2）。用戶 2026-11-19 裁決 */
function fmtX(n){ return String(floor2(n)); }

return { CFG:CFG, TIERS:TIERS, TUNED:TUNED, N_SIZES:N_SIZES, ids:ids, tierIndex:tierIndex,
         theoryRtp:theoryRtp, floor2:floor2, fmtX:fmtX };
})();
