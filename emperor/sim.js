/* =========================================================================
 * 專案E「皇帝牌」E01 驗證頁——蒙地卡羅（依 values.js 單點數值）
 * 驗證項：①1/5 定理（任意出牌序）＋原型反應式引擎
 *         ②各收手深度 RTP=0.93 ③各登頂路徑 RTP=0.96
 *         ④滿貫觸發分佈與最大賠付（枚舉精確值＋MC）
 * ========================================================================= */
(function(){
'use strict';
var CFG = EV.CFG, FAIR = EV.FAIR;
var R = CFG.CITIZENS + 1; // 回合數（標準局 5）
var $ = function(id){ return document.getElementById(id); };
var fmt = function(n,d){ return n.toFixed(d===undefined?4:d); };

/* ---------- 對局模型 ---------- */
// 密封序：雙方特殊牌位置各自均勻（對手恆隨機；玩家可指定位置＝任意出牌序）
function duelSealed(side, playerPos){
  var pp = playerPos || (1 + Math.floor(Math.random()*R));
  var op = 1 + Math.floor(Math.random()*R);
  var slvPos = side==='slv' ? pp : op;
  var empPos = side==='emp' ? pp : op;
  var slvWin = (slvPos === empPos);
  var dec = Math.min(slvPos, empPos), v;
  if(slvWin) v='奴弒帝';
  else v = (empPos < slvPos) ? '帝斬民' : '民擒奴';
  return { win: side==='slv' ? slvWin : !slvWin, dec:dec, verdict:v };
}
// 活原型反應式引擎（照示意稿 JS：先抽勝負、u 均勻 1..R 決定對手時點）
function duelProto(side, playerPos){
  var win = Math.random() < CFG.P[side];
  var u = 1 + Math.floor(Math.random()*R);
  var pp = playerPos || (1 + Math.floor(Math.random()*R));
  var dec, v;
  if(side==='slv'){
    if(win){ dec=pp; v='奴弒帝'; }
    else if(u < pp){ dec=u; v='帝斬民'; }
    else { dec=pp; v='民擒奴'; }
  }else{
    if(win){ if(u < pp){ dec=u; v='民擒奴'; } else { dec=pp; v='帝斬民'; } }
    else { dec=pp; v='奴弒帝'; }
  }
  return { win:win, dec:dec, verdict:v };
}

/* ---------- 階梯試行（每階＝一場密封對局，端到端不走捷徑） ---------- */
// 固定路徑收手於深度 k：回傳倍率回收（爆＝0）
function trialCashPath(path){
  var m = CFG.RTP_CASH;
  for(var i=0;i<path.length;i++){
    if(!duelSealed(path[i]).win) return 0;
    m *= FAIR[path[i]];
    if(EV.isTop(m, i+1) && i+1 < path.length) return EV.topPayout(m); // 防衛：中途觸頂
  }
  return m;
}
// 玩到頂：chooser(rung)→side，直到觸頂或爆
function trialToTop(chooser, stat){
  var m = CFG.RTP_CASH, rung = 0;
  for(;;){
    var s = chooser(rung+1);
    if(!duelSealed(s).win){ if(stat) stat.bust++; return 0; }
    rung++; m *= FAIR[s];
    if(EV.isTop(m, rung)){
      var pay = EV.topPayout(m);
      if(stat){
        if(m >= CFG.SLAM_LINE) stat.slam++; else stat.full++;
        if(pay > stat.maxPay){ stat.maxPay = pay; }
      }
      return pay;
    }
  }
}

/* ---------- MC 執行器（分塊避免卡頁） ---------- */
function mcStats(){ return { n:0, sum:0, sumsq:0 }; }
function mcAdd(st, x){ st.n++; st.sum += x; st.sumsq += x*x; }
function mcResult(st, theory){
  var mean = st.sum/st.n;
  var vr = Math.max(0, st.sumsq/st.n - mean*mean);
  var se = Math.sqrt(vr/st.n);
  var z = se > 0 ? (mean-theory)/se : 0;
  return { mean:mean, se:se, z:z, pass: Math.abs(z) <= 3 };
}
var QUEUE = [], running = false;
function enqueue(job){ QUEUE.push(job); if(!running) next(); }
function next(){
  var job = QUEUE.shift();
  if(!job){ running=false; $('prog').textContent = '全部完成 ✓'; return; }
  running = true;
  var st = mcStats(), done = 0, N = job.N, CH = 50000;
  (function chunk(){
    var end = Math.min(done+CH, N);
    for(; done<end; done++) mcAdd(st, job.trial());
    $('prog').textContent = job.name + '　' + Math.round(done/N*100) + '%（'+QUEUE.length+' 項排隊中）';
    if(done < N) setTimeout(chunk, 0);
    else { job.done(st); setTimeout(next, 0); }
  })();
}

/* ---------- 結果表渲染 ---------- */
function row(tbodyId, cells, pass){
  var tr = document.createElement('tr');
  for(var i=0;i<cells.length;i++){
    var td = document.createElement('td');
    td.innerHTML = cells[i];
    if(i>0) td.className = 'num';
    tr.appendChild(td);
  }
  if(pass !== undefined){
    var td2 = document.createElement('td');
    td2.innerHTML = pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>';
    tr.appendChild(td2);
  }
  $(tbodyId).appendChild(tr);
}
function mcRow(tbodyId, name, theory, N, trial, digits){
  enqueue({ name:name, N:N, trial:trial, done:function(st){
    var r = mcResult(st, theory);
    row(tbodyId, [name, fmt(theory, digits), fmt(r.mean, digits),
      '±'+fmt(3*r.se, digits), fmt(r.z,2)], r.pass);
  }});
}

/* ---------- 靜態表：數值反推（載入即渲染，非 MC） ---------- */
function renderDerived(){
  // 鐵表對照
  var c = CFG;
  var iron = [
    ['RTP 收手檔', '0.93', fmt(c.RTP_CASH,2)],
    ['RTP 玩到頂檔', '0.96', fmt(c.RTP_TOP,2)],
    ['奴隸側機率', '0.2', fmt(c.P.slv,1)],
    ['皇帝側機率', '0.8', fmt(c.P.emp,1)],
    ['奴隸基礎賠率', '4.65x', fmt(EV.baseOdds('slv'),4)+'x'],
    ['皇帝基礎賠率', '1.1625x', fmt(EV.baseOdds('emp'),4)+'x'],
    ['頂端加成', '×1.0323', '×'+fmt(EV.TOP_BOOST,6)],
    ['滿貫線', '120x', c.SLAM_LINE+'x'],
    ['完賭階數', '10', ''+c.MAX_RUNG],
    ['最大賠付上界', '≈619x', fmt(EV.maxPayoutBound(),2)+'x']
  ];
  iron.forEach(function(r0){
    var ok = true; // 對照由人工核，本表只列推導值
    row('tIron', r0);
  });
  // 純邊階梯
  ['emp','slv'].forEach(function(side){
    EV.ladderTable(side).forEach(function(r0){
      row('tLadder', [
        side==='emp'?'皇帝':'奴隸', ''+r0.rung, fmt(r0.M,4)+'x',
        r0.prob.toExponential(3),
        r0.top ? (r0.slam?'滿貫（越線）':'完賭（10階）') : '—',
        fmt(r0.payout,4)+'x'
      ]);
    });
  });
  // 枚舉觸頂終點
  var tops = EV.enumerateTops();
  var slamN = 0, fullN = 0, maxT = tops[0];
  tops.forEach(function(t){ if(t.slam) slamN++; else fullN++; });
  $('enumSummary').innerHTML =
    '換邊路徑觸頂終點共 <b>' + tops.length + '</b> 種（滿貫越線 ' + slamN + '、10 階完賭 ' + fullN + '）。' +
    '理論最大賠付 <b>' + fmt(maxT.payout,2) + 'x</b>（路徑：' + maxT.path.map(function(s){return s==='slv'?'奴':'帝';}).join('→') +
    '，收手值 ' + fmt(maxT.M,2) + 'x），上界 ' + fmt(EV.maxPayoutBound(),2) + 'x — ' +
    (maxT.payout <= EV.maxPayoutBound() ? '<span class="pass">≤ 上界 PASS</span>' : '<span class="fail">超界 FAIL</span>');
  tops.slice(0,8).forEach(function(t){
    row('tTops', [ t.path.map(function(s){return s==='slv'?'奴':'帝';}).join('→'),
      ''+t.rung, fmt(t.M,2)+'x', fmt(t.payout,2)+'x',
      t.prob.toExponential(3), t.slam?'越線':'完賭' ]);
  });
  window.__ENUM_MAX = maxT.payout; // 給 MC ④ 對照
}

/* ---------- ①b 決勝回合分佈對照（密封 vs 原型，玩家=奴隸側、特殊牌固定第3張） ---------- */
function renderDist(N){
  var pp = 3, sealed = {}, proto = {}, sL=0, pL=0;
  function bump(o,k){ o[k]=(o[k]||0)+1; }
  for(var i=0;i<N;i++){
    var a = duelSealed('slv', pp);
    if(!a.win){ sL++; bump(sealed, a.dec+'・'+a.verdict); }
    var b = duelProto('slv', pp);
    if(!b.win){ pL++; bump(proto, b.dec+'・'+b.verdict); }
  }
  var keys = {}; Object.keys(sealed).forEach(function(k){keys[k]=1});
  Object.keys(proto).forEach(function(k){keys[k]=1});
  Object.keys(keys).sort().forEach(function(k){
    row('tDist', [ k, fmt((sealed[k]||0)/sL*100,2)+'%', fmt((proto[k]||0)/pL*100,2)+'%' ]);
  });
}

/* ---------- 執行全部 MC ---------- */
function runAll(){
  ['t1','t1b','t2','t3','t4'].forEach(function(id){ $(id).innerHTML=''; });
  $('tDist').innerHTML='';
  var N = +$('selN').value;

  // ① 1/5 定理：玩家特殊牌固定各位置＋隨機序，對手隨機——奴隸側勝率恆 0.2
  for(var pos=1; pos<=R; pos++){
    (function(p0){
      mcRow('t1', '奴隸側・特殊牌固定第 '+p0+' 張', CFG.P.slv, N,
        function(){ return duelSealed('slv', p0).win ? 1 : 0; }, 4);
    })(pos);
  }
  mcRow('t1', '奴隸側・隨機出牌序', CFG.P.slv, N, function(){ return duelSealed('slv').win?1:0; }, 4);
  mcRow('t1', '皇帝側・隨機出牌序', CFG.P.emp, N, function(){ return duelSealed('emp').win?1:0; }, 4);

  // ①b 原型反應式引擎勝率（行為基準）
  mcRow('t1b', '原型引擎・奴隸側勝率', CFG.P.slv, N, function(){ return duelProto('slv').win?1:0; }, 4);
  mcRow('t1b', '原型引擎・皇帝側勝率', CFG.P.emp, N, function(){ return duelProto('emp').win?1:0; }, 4);
  enqueue({ name:'決勝回合分佈對照', N:1, trial:function(){ return 0; },
    done:function(){ renderDist(Math.min(N,1000000)); } });

  // ② 各收手深度 RTP = 0.93
  var depth = [];
  for(var k=1;k<=9;k++){ depth.push({ name:'純皇帝・第 '+k+' 階收手', path:rep('emp',k) }); }
  for(k=1;k<=3;k++){ depth.push({ name:'純奴隸・第 '+k+' 階收手', path:rep('slv',k) }); }
  depth.push({ name:'混邊 帝→奴（2 階收手）', path:['emp','slv'] });
  depth.push({ name:'混邊 奴→帝→帝（3 階收手）', path:['slv','emp','emp'] });
  depth.push({ name:'混邊 帝→帝→奴→帝（4 階收手）', path:['emp','emp','slv','emp'] });
  depth.forEach(function(d){
    mcRow('t2', d.name, CFG.RTP_CASH, N, function(){ return trialCashPath(d.path); }, 4);
  });

  // ③ 各登頂路徑 RTP = 0.96
  var tops = [
    { name:'純奴隸玩到頂（第 4 階滿貫）', ch:function(){ return 'slv'; } },
    { name:'純皇帝玩到頂（10 階完賭）', ch:function(){ return 'emp'; } },
    { name:'交替 帝奴帝奴…玩到頂', ch:function(r0){ return r0%2===1?'emp':'slv'; } },
    { name:'交替 奴帝奴帝…玩到頂', ch:function(r0){ return r0%2===1?'slv':'emp'; } },
    { name:'每階隨機換邊玩到頂', ch:function(){ return Math.random()<0.5?'emp':'slv'; } }
  ];
  tops.forEach(function(t){
    mcRow('t3', t.name, CFG.RTP_TOP, N, function(){ return trialToTop(t.ch); }, 4);
  });

  // ④ 滿貫觸發分佈與最大賠付（隨機換邊玩到頂）
  var stat = { bust:0, slam:0, full:0, maxPay:0 };
  enqueue({ name:'④ 觸發分佈統計', N:N,
    trial:function(){ return trialToTop(function(){ return Math.random()<0.5?'emp':'slv'; }, stat); },
    done:function(st){
      var tot = st.n;
      row('t4', ['爆掉（未登頂）', fmt(stat.bust/tot*100,3)+'%']);
      row('t4', ['滿貫（越線 120x）', fmt(stat.slam/tot*100,3)+'%']);
      row('t4', ['10 階完賭', fmt(stat.full/tot*100,3)+'%']);
      var okMax = stat.maxPay <= window.__ENUM_MAX + 1e-9 && stat.maxPay <= EV.maxPayoutBound();
      row('t4', ['MC 最大實付', fmt(stat.maxPay,2)+'x（枚舉精確最大 '+fmt(window.__ENUM_MAX,2)+
                 'x、上界 '+fmt(EV.maxPayoutBound(),2)+'x）'], okMax);
    }});
}
function rep(s,k){ var a=[]; while(k--) a.push(s); return a; }

renderDerived();
$('btnRun').onclick = runAll;
})();
