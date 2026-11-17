/* =========================================================================
 * 空投爭奪——數值單點（可移植・凍結）
 *
 * 紀律（改東西前先讀）：
 *  1. 禁手改單點：所有賠率、上限一律由 CFG 推導，其他檔案嚴禁硬編碼賠率或機率。
 *  2. 嚴禁暗改機率 p（p 是真實機率，抽獎與賠率都吃它）。
 *  3. 要調 RTP 只准動賠率表（CFG.RTP），不准動 p。
 *  4. 本檔零 DOM、零依賴；瀏覽器以 <script> 載入、Node 以 eval 載入（test/mc-test.js）。
 *     不要加頂層 'use strict'：eval 時要讓 var EV／DEMO_KEY 落在呼叫端作用域。
 *
 * 本作規則：1 玩家＋3 機器人（N=4），4 個落點（綠／藍／紫／金）。
 *  - 每局先「物資重抽」：每個落點各自從自己的候選清單等機率抽一個物資量 c_i。
 *  - 玩家選一個落點；3 個機器人各自獨立依機率 p 選落點。沒有任何機器人選到玩家的落點
 *    才算「獨佔」，獨佔後再開箱（最低 ×1）；撞車＝0（撞車也抽箱子，純演出用）。
 *  - 機器人照納許均衡出手（閉式解，見 derive）：令 e=1/(N-1)、x=(點數-1)/Σc_i^(-e)，
 *      獨佔率 q_i = x^(N-1)/c_i，機器人選 i 的機率 p_i = 1 - q_i^e（Σp_i = 1），
 *      基準賠率 m_i = RTP/(q_i·M)（M＝箱子平均倍率）。
 *    於是任何一局、任何落點：EV = q_i × m_i × M = RTP（恆等，與玩家怎麼選無關）。
 *  - 獨佔派彩 = 注額 × m_i × 箱倍率；撞車 = 0。
 *  - 亂數消耗固定（不論輸贏）：每局依序 4 個物資亂數、3 個機器人亂數、1 個箱子亂數。
 * ========================================================================= */

/* 記號：新建腳本會把 hotdrop 換成 [a-z][a-z0-9]{1,11} 短名；沒替換也能跑 */
var DEMO_KEY = 'hotdrop';

var EV = (function(){

var CFG = {
  RTP: 0.96,                                   // 整體回報率；調 RTP 只動這個
  PLAYERS: 4,                                  // 1 玩家＋3 機器人（N）
  SUPPLY: [                                    // 各落點物資候選（暫用建議值，規格書 §Q 待裁決）；每局各自等機率抽一個
    [5, 6],                                    // 綠
    [7, 8],                                    // 藍
    [9, 10, 11],                               // 紫
    [12, 14, 18]                               // 金
  ],
  BOX: [                                       // 箱子（暫用建議值）；p 加總必須為 1、mult 必須 ≥ 1
    { id:'army',   name:'軍用箱', mult:1,   p:0.72 },
    { id:'fine',   name:'精良箱', mult:1.5, p:0.20 },
    { id:'rare',   name:'稀有箱', mult:2,   p:0.06 },
    { id:'legend', name:'傳說箱', mult:5,   p:0.02 }
  ],
  STAKES: [10, 50, 100, 500],                  // 下注面板可選單注
  WALLET: 10000,                               // 起始錢包
  LOG_CAP: 50                                  // 勝負 log 封頂筆數（公司規格）
};

/* 落點（由低到高）；顏色名給 UI 對應佔位美術 */
var POINTS = [
  { id:'green',  name:'綠', color:'green'  },
  { id:'blue',   name:'藍', color:'blue'   },
  { id:'purple', name:'紫', color:'purple' },
  { id:'gold',   name:'金', color:'gold'   }
];

var K = POINTS.length;              // 落點數
var N = CFG.PLAYERS;                // 總人數
var NBOT = N - 1;                   // 機器人數
var E = 1 / (N - 1);                // 納許均衡指數 e

/* 箱子：平均倍率 M 由程式算（不手寫） */
var BOX = { tiers: CFG.BOX, M: 0 };
(function(){
  var m = 0;
  for(var i = 0; i < CFG.BOX.length; i++) m += CFG.BOX[i].p * CFG.BOX[i].mult;
  BOX.M = m;
})();
var M = BOX.M;

/* ---------- 取整：先四捨到 1e-6 吃掉浮點雜訊，再無條件捨去（顯示與結算同口徑，實付恆 ≥ 顯示） ---------- */
function payoutFloor(stake, odds){ return Math.floor(Math.round(stake * odds * 1e6) / 1e6); }
function floor2(n){ return Math.floor(Math.round(n * 1e6) / 1e4) / 100; }
function fmtX(n){ return floor2(n).toFixed(2); }

/* ---------- 納許均衡：給定一局的物資向量 c（長度 K），反推獨佔率／機器人機率／基準賠率 ---------- */
function derive(c){
  var s = 0, i;
  for(i = 0; i < K; i++) s += Math.pow(c[i], -E);
  var x = (K - 1) / s;
  var q = [], botP = [], odds = [];
  for(i = 0; i < K; i++){
    q.push(Math.pow(x, N - 1) / c[i]);
    botP.push(1 - Math.pow(q[i], E));
    odds.push(CFG.RTP / (q[i] * M));
  }
  return { c: c.slice(), x: x, q: q, botP: botP, odds: odds };
}

/* ---------- 窮舉全部物資組合（各落點候選的笛卡兒積），idx 為混合進位編碼（抽樣時 O(1) 查表） ---------- */
var BOARDS = [];
(function(){
  var sizes = CFG.SUPPLY.map(function(l){ return l.length; });
  var total = sizes.reduce(function(a, b){ return a * b; }, 1);
  for(var idx = 0; idx < total; idx++){
    var rem = idx, js = new Array(K), c = new Array(K), w = 1, i;
    for(i = K - 1; i >= 0; i--){ js[i] = rem % sizes[i]; rem = (rem - js[i]) / sizes[i]; }
    for(i = 0; i < K; i++){ c[i] = CFG.SUPPLY[i][js[i]]; w /= sizes[i]; }
    BOARDS.push({ idx: idx, c: c, weight: w, board: derive(c) });
  }
})();
function allBoards(){ return BOARDS; }

/* ---------- 極值與區間（全由窮舉算出，快取） ---------- */
var LIM = null;
function limits(){
  if(LIM) return LIM;
  var oddsMin = [], oddsMax = [], soloMin = [], soloMax = [], soloAvg = [], i, b;
  for(i = 0; i < K; i++){ oddsMin.push(Infinity); oddsMax.push(-Infinity); soloMin.push(Infinity); soloMax.push(-Infinity); soloAvg.push(0); }
  var maxBoxMult = 0, k;
  for(k = 0; k < BOX.tiers.length; k++) if(BOX.tiers[k].mult > maxBoxMult) maxBoxMult = BOX.tiers[k].mult;
  var maxMult = -Infinity, maxMultPoint = -1, maxMultBoard = null;
  for(b = 0; b < BOARDS.length; b++){
    var bd = BOARDS[b].board;
    for(i = 0; i < K; i++){
      if(bd.odds[i] < oddsMin[i]) oddsMin[i] = bd.odds[i];
      if(bd.odds[i] > oddsMax[i]) oddsMax[i] = bd.odds[i];
      if(bd.q[i] < soloMin[i]) soloMin[i] = bd.q[i];
      if(bd.q[i] > soloMax[i]) soloMax[i] = bd.q[i];
      soloAvg[i] += BOARDS[b].weight * bd.q[i];
      if(bd.odds[i] * maxBoxMult > maxMult){ maxMult = bd.odds[i] * maxBoxMult; maxMultPoint = i; maxMultBoard = BOARDS[b].c.slice(); }
    }
  }
  LIM = { oddsMin: oddsMin, oddsMax: oddsMax, soloMin: soloMin, soloMax: soloMax, soloAvg: soloAvg,
          maxBoxMult: maxBoxMult, maxMult: maxMult, maxMultPoint: maxMultPoint, maxMultBoard: maxMultBoard,
          boards: BOARDS.length };
  return LIM;
}

/* ---------- 載入時自我檢查（防手滑）；不符就 throw ---------- */
(function(){
  var i, j, b, s;
  // 箱子：機率和＝1、倍率 ≥ 1
  s = 0;
  for(i = 0; i < CFG.BOX.length; i++){
    s += CFG.BOX[i].p;
    if(!(CFG.BOX[i].mult >= 1)) throw new Error('values.js：箱倍率必須 ≥ 1（最低 ×1），' + CFG.BOX[i].id + ' = ' + CFG.BOX[i].mult);
    if(!(CFG.BOX[i].p >= 0)) throw new Error('values.js：箱機率不得為負：' + CFG.BOX[i].id);
  }
  if(Math.abs(s - 1) > 1e-9) throw new Error('values.js：箱子機率和必須為 1，現為 ' + s);
  if(CFG.SUPPLY.length !== K) throw new Error('values.js：SUPPLY 長度必須等於落點數 ' + K);
  if(N < 2) throw new Error('values.js：PLAYERS 至少 2');
  // 每個組合：c 嚴格遞增、botP ∈[0,1] 且和＝1、綠點基準賠率 ≥ 1.00
  for(b = 0; b < BOARDS.length; b++){
    var bd = BOARDS[b].board, c = bd.c, ps = 0;
    for(i = 1; i < K; i++)
      if(!(c[i] > c[i - 1])) throw new Error('values.js：物資組合 [' + c.join(',') + '] 必須嚴格遞增（綠<藍<紫<金）');
    for(j = 0; j < K; j++){
      if(!(bd.botP[j] >= 0 && bd.botP[j] <= 1)) throw new Error('values.js：組合 [' + c.join(',') + '] 機器人機率無解（落點 ' + j + ' = ' + bd.botP[j] + '）');
      ps += bd.botP[j];
    }
    if(Math.abs(ps - 1) > 1e-9) throw new Error('values.js：組合 [' + c.join(',') + '] 機器人機率和 ≠ 1：' + ps);
    if(!(bd.odds[0] >= 1)) throw new Error('values.js：組合 [' + c.join(',') + '] 綠點基準賠率 ' + bd.odds[0] + ' < 1.00（獨佔必不虧護欄）');
  }
})();

/* ---------- 抽一局（結果先定；rng 注入，正式用 Math.random） ---------- */
function pickBy(weights, u){
  var acc = 0, i;
  for(i = 0; i < weights.length; i++){ acc += weights[i]; if(u < acc) return i; }
  return weights.length - 1;                    // 浮點尾差
}
var BOXP = CFG.BOX.map(function(t){ return t.p; });

/* 亂數消耗固定：4 物資 → 3 機器人 → 1 箱子（不論輸贏） */
function drawRound(pointIdx, rng){
  var supply = [], idx = 0, i, j, list;
  for(i = 0; i < K; i++){
    list = CFG.SUPPLY[i];
    j = Math.floor(rng() * list.length);
    if(j >= list.length) j = list.length - 1;
    supply.push(list[j]);
    idx = idx * list.length + j;
  }
  var board = BOARDS[idx].board;
  var botPicks = [], counts = [], b;
  for(i = 0; i < K; i++) counts.push(0);
  counts[pointIdx]++;
  for(b = 0; b < NBOT; b++){
    var pk = pickBy(board.botP, rng());
    botPicks.push(pk);
    counts[pk]++;
  }
  var boxIdx = pickBy(BOXP, rng());
  var solo = counts[pointIdx] === 1;
  var baseOdds = board.odds[pointIdx];
  var mult = solo ? baseOdds * CFG.BOX[boxIdx].mult : 0;
  var top = -1;                                 // 本局獨佔成功且基準賠率最高的落點
  for(i = 0; i < K; i++)
    if(counts[i] === 1 && (top < 0 || board.odds[i] > board.odds[top])) top = i;
  return { pointIdx: pointIdx, supply: supply, board: board, botPicks: botPicks, counts: counts,
           solo: solo, boxIdx: boxIdx, baseOdds: baseOdds, mult: mult, topSoloPoint: top };
}

return { CFG: CFG, POINTS: POINTS, BOX: BOX, derive: derive, allBoards: allBoards, drawRound: drawRound,
         limits: limits, payoutFloor: payoutFloor, floor2: floor2, fmtX: fmtX };
})();
