/* =========================================================================
 * 專案E「皇帝牌」數值表——程式反推（E01）
 * 鐵表出處：TASKS-E.md「已定案數值」；規格：reports/E規格書_v1.html
 * 禁手改單點：所有數字一律由 CFG 推導，嚴禁在任何其他檔案硬編碼賠率。
 * ========================================================================= */
var EV = (function(){
'use strict';

var CFG = {
  RTP_CASH: 0.93,             // 提早收手檔 RTP（自己按收手）
  RTP_TOP:  0.96,             // 玩到頂檔 RTP（越滿貫線或完賭，系統幫你收）
  P: { emp: 0.8, slv: 0.2 },  // 真實機率（1/5 定理；嚴禁暗改）
  CITIZENS: 4,                // 標準局每邊市民張數（回合數 = CITIZENS + 1）
  SLAM_LINE: 120,             // 滿貫線：累積倍率 ≥ 線 → 自動滿貫入袋
  MAX_RUNG: 10                // 完賭階數上限
};

var FAIR = { emp: 1/CFG.P.emp, slv: 1/CFG.P.slv };  // 公平倍率 1.25x / 5x
var TOP_BOOST = CFG.RTP_TOP / CFG.RTP_CASH;          // 頂端加成 ≈ ×1.032258

// 基礎賠率（單注收手檔）：奴 4.65x／帝 1.1625x
function baseOdds(side){ return CFG.RTP_CASH * FAIR[side]; }

// 收手值 M = RTP_CASH × Π(1/p)，path 例：['emp','slv','emp']
function cashValue(path){
  var m = CFG.RTP_CASH;
  for(var i=0;i<path.length;i++) m *= FAIR[path[i]];
  return m;
}

function topPayout(m){ return m * TOP_BOOST; }        // 玩到頂實付 = 0.96×公平倍率
function isTop(m, rung){ return m >= CFG.SLAM_LINE || rung >= CFG.MAX_RUNG; }
function pathProb(path){
  var p = 1;
  for(var i=0;i<path.length;i++) p *= CFG.P[path[i]];
  return p;
}

// 純邊階梯表：逐階列 M／達成機率／是否觸頂／實付
function ladderTable(side){
  var rows = [], m = CFG.RTP_CASH;
  for(var k=1;k<=CFG.MAX_RUNG;k++){
    m *= FAIR[side];
    var top = isTop(m, k);
    rows.push({ rung:k, M:m, prob:Math.pow(CFG.P[side],k),
                top:top, slam:m>=CFG.SLAM_LINE, payout: top ? topPayout(m) : m });
    if(top) break;
  }
  return rows;
}

// 枚舉全部換邊路徑的觸頂終點（≤2^MAX_RUNG 節點）→ 理論最大賠付精確值
function enumerateTops(){
  var tops = [];
  (function walk(m, rung, path){
    if(rung > 0 && isTop(m, rung)){
      tops.push({ path:path.slice(), M:m, rung:rung,
                  payout:topPayout(m), prob:pathProb(path), slam:m>=CFG.SLAM_LINE });
      return;
    }
    if(rung >= CFG.MAX_RUNG) return;
    for(var i=0;i<2;i++){
      var s = i===0 ? 'emp' : 'slv';
      path.push(s); walk(m*FAIR[s], rung+1, path); path.pop();
    }
  })(CFG.RTP_CASH, 0, []);
  tops.sort(function(a,b){ return b.payout - a.payout; });
  return tops;
}

// 上界（鐵表 ≈619x）：滿貫線 × 奴公平倍率 × 頂端加成
function maxPayoutBound(){ return CFG.SLAM_LINE * FAIR.slv * TOP_BOOST; }

return { CFG:CFG, FAIR:FAIR, TOP_BOOST:TOP_BOOST,
         baseOdds:baseOdds, cashValue:cashValue, topPayout:topPayout,
         isTop:isTop, pathProb:pathProb, ladderTable:ladderTable,
         enumerateTops:enumerateTops, maxPayoutBound:maxPayoutBound };
})();
