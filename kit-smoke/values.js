/* =========================================================================
 * 三選一冒煙——數值單點（可移植・凍結）
 *
 * 紀律（改東西前先讀）：
 *  1. 禁手改單點：所有賠率、上限一律由 CFG 推導，其他檔案嚴禁硬編碼賠率或機率。
 *  2. 嚴禁暗改機率 p（p 是真實機率，抽獎與賠率都吃它）。
 *  3. 要調 RTP 只准動賠率表（CFG.RTP），不准動 p。
 *  4. 本檔零 DOM、零依賴；瀏覽器以 <script> 載入、Node 以 eval 載入（test/mc-test.js）。
 *     不要加頂層 'use strict'：eval 時要讓 var EV／DEMO_KEY 落在呼叫端作用域。
 *
 * 範例玩法（換玩法時整段換掉）：三選一押注。押 A／B／C 其中一個，
 * 各有機率 p，賠率＝RTP÷p，押中拿 floor(押額×賠率)、沒中拿 0。
 * ========================================================================= */

/* 記號：新建腳本會把 kitsmoke 換成 [a-z][a-z0-9]{1,11} 短名；沒替換也能跑 */
var DEMO_KEY = 'kitsmoke';

var EV = (function(){

var CFG = {
  RTP: 0.96,                                   // 整體回報率；調 RTP 只動這個
  CHOICES: [                                   // 範例，換掉：p 加總必須為 1
    { id:'A', p:0.5 },
    { id:'B', p:0.3 },
    { id:'C', p:0.2 }
  ],
  STAKES: [10, 50, 100, 500],                  // 下注面板可選單注
  WALLET: 10000,                               // 起始錢包
  LOG_CAP: 50                                  // 勝負 log 封頂筆數（公司規格）
};

/* 自我檢查：p 加總＝1（防手滑） */
(function(){
  var s = 0, i;
  for(i = 0; i < CFG.CHOICES.length; i++) s += CFG.CHOICES[i].p;
  if(Math.abs(s - 1) > 1e-9) throw new Error('values.js：CHOICES 的 p 加總必須為 1，現為 ' + s);
})();

/* 賠率表：全由 RTP÷p 導出（單點） */
var ODDS = {}, P = {};
(function(){
  for(var i = 0; i < CFG.CHOICES.length; i++){
    var c = CFG.CHOICES[i];
    P[c.id] = c.p;
    ODDS[c.id] = CFG.RTP / c.p;
  }
})();

function ids(){ return CFG.CHOICES.map(function(c){ return c.id; }); }

/* 取整：先四捨到 1e-6 吃掉浮點雜訊，再無條件捨去（顯示與結算同口徑，實付恆 ≥ 顯示） */
function payoutFloor(stake, odds){ return Math.floor(Math.round(stake * odds * 1e6) / 1e6); }
function floor2(n){ return Math.floor(Math.round(n * 1e6) / 1e4) / 100; }
function fmtX(n){ return floor2(n).toFixed(2); }

/* 依 u∈[0,1) 在累積機率上挑出結果 id（抽獎唯一入口） */
function pick(u){
  var acc = 0, i;
  for(i = 0; i < CFG.CHOICES.length; i++){
    acc += CFG.CHOICES[i].p;
    if(u < acc) return CFG.CHOICES[i].id;
  }
  return CFG.CHOICES[CFG.CHOICES.length - 1].id;  // 浮點尾差
}

/* 反查：回傳一個必落在 id 區間中點的 u（導演台強制結果、測試用） */
function rngFor(id){
  var acc = 0, i;
  for(i = 0; i < CFG.CHOICES.length; i++){
    var c = CFG.CHOICES[i];
    if(c.id === id) return acc + c.p / 2;
    acc += c.p;
  }
  throw new Error('rngFor：未知選項 ' + id);
}

return { CFG:CFG, ODDS:ODDS, P:P, ids:ids, payoutFloor:payoutFloor,
         floor2:floor2, fmtX:fmtX, pick:pick, rngFor:rngFor };
})();
