/* =========================================================================
 * 三選一冒煙——Node 無頭蒙地卡羅自測（對 core.js 端到端複驗）
 * 執行：node test/mc-test.js [N]（預設 200000／項）
 * 項目：A 各選項命中率＝p　B 各選項 RTP＝設定值　C 整體 RTP
 *       D 防套利窮舉（任意押注組合 EV ≤ 1、無保證獲利）　E 單元檢查
 * 判定：|偏差| ≤ max(0.1pp, 3σ)（單統計量）；FAIL 時 exit code 1。
 * 註：本檔不得含頂層 'use strict'（直接 eval 需讓 var EV／DemoCore 落本模組作用域）。
 *     記號 kitsmoke 沒替換也能跑。
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8'));

const N = Math.floor(+(process.argv[2]) || 200000);
const STAKE = 1e6;               // 大押額令取整偏差 <1e-6，遠低於 MC 噪音
let nPass = 0, nFail = 0;
const t0 = Date.now();

/* 判定：|偏差| ≤ max(0.1pp, 3σ)；name 與理論／實測／σ 一併印出 */
function report(tag, name, theory, mean, se, sigma){
  sigma = sigma || 3;
  const tol = Math.max(0.001, sigma * se);
  const ok = Math.abs(mean - theory) <= tol;
  ok ? nPass++ : nFail++;
  console.log(`${ok?'PASS':'FAIL'} [${tag}] ${name}  理論 ${theory.toFixed(4)}  實測 ${mean.toFixed(4)}  容許 ±${tol.toFixed(4)}(${sigma}σ或0.1pp)`);
}
function unit(name, cond, detail){
  cond ? nPass++ : nFail++;
  console.log(`${cond?'PASS':'FAIL'} [${name[0]}] ${name}${detail?'  '+detail:''}`);
}
function mkGame(o){
  let last = null;
  const g = DemoCore.createGame(Object.assign(
    { storage:false, wallet:Number.MAX_SAFE_INTEGER/4 }, o||{}));
  g.on((t,d)=>{ if(t==='settled') last = d; });
  return { g, last:()=>last };
}
function fakeStore(){
  const m = {};
  return { getItem:k=>(k in m?m[k]:null), setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];}, _m:m };
}
const IDS = EV.ids();

/* ============ A 各選項命中率＝p ============ */
console.log(`\n=== A 命中率＝p（N=${N}／項） ===`);
for(const id of IDS){
  const { g, last } = mkGame();
  let wins = 0;
  for(let i=0;i<N;i++){ g.bet(id, 100); g.ack(); if(last().win) wins++; }
  const p = wins/N;
  report('A', `選項 ${id}`, EV.P[id], p, Math.sqrt(p*(1-p)/N));
}

/* ============ B 各選項 RTP ============ */
console.log(`\n=== B 單選項 RTP＝${EV.CFG.RTP}（端到端含取整，N=${N}／項） ===`);
for(const id of IDS){
  const { g, last } = mkGame();
  let sum=0, sumsq=0;
  for(let i=0;i<N;i++){
    g.bet(id, STAKE); g.ack();
    const m = last().payout/STAKE;
    sum+=m; sumsq+=m*m;
  }
  const mean=sum/N, se=Math.sqrt(Math.max(0,sumsq/N-mean*mean)/N);
  report('B', `選項 ${id}（p=${EV.P[id]}，賠 ${EV.fmtX(EV.ODDS[id])}x）`, EV.CFG.RTP, mean, se);
}

/* ============ C 整體 RTP（每注隨機選項） ============ */
console.log(`\n=== C 整體 RTP（隨機選項，N=${N}） ===`);
{
  const { g, last } = mkGame();
  let sum=0, sumsq=0;
  for(let i=0;i<N;i++){
    g.bet(IDS[(Math.random()*IDS.length)|0], STAKE); g.ack();
    const m = last().payout/STAKE;
    sum+=m; sumsq+=m*m;
  }
  const mean=sum/N, se=Math.sqrt(Math.max(0,sumsq/N-mean*mean)/N);
  report('C', '整體', EV.CFG.RTP, mean, se);
}

/* ============ D 防套利窮舉 ============
 * 把「同一局同時押多個選項」當一個組合：各選項押 0..K 單位。
 * 期望回報＝Σ p_i×floor(s_i×odds_i)，不得超過總押額；
 * 且任一結果下的實得都不得高於總押額（否則＝保證獲利）。 */
console.log('\n=== D 防套利窮舉 ===');
{
  const K = 12, UNIT = 7;            // 刻意用奇數單位，讓取整真的捨去
  let worstEV = 0, worstMin = -Infinity, combos = 0, evBad = 0, sureBad = 0;
  const n = IDS.length;
  const s = new Array(n).fill(0);
  (function walk(i){
    if(i === n){
      const total = s.reduce((a,b)=>a+b,0)*UNIT;
      if(total === 0) return;
      combos++;
      let ev = 0, minPay = Infinity;
      for(let r=0;r<n;r++){
        const pay = EV.payoutFloor(s[r]*UNIT, EV.ODDS[IDS[r]]);   // 結果 r 出現時只有押 r 的那部分中獎
        ev += EV.P[IDS[r]] * pay;
        minPay = Math.min(minPay, pay);
      }
      if(ev/total > worstEV) worstEV = ev/total;
      if(minPay - total > worstMin) worstMin = minPay - total;
      if(ev > total + 1e-9) evBad++;
      if(minPay > total) sureBad++;                                // 每種結果都賺＝保證獲利
      return;
    }
    for(let k=0;k<=K;k++){ s[i]=k; walk(i+1); }
  })(0);
  unit(`D1 任意押注組合 EV ≤ 1（窮舉 ${combos} 組，最高 ${worstEV.toFixed(4)}）`, evBad === 0 && worstEV <= EV.CFG.RTP + 1e-9);
  unit('D2 無保證獲利組合（每種結果實得都 > 總押額）', sureBad === 0);
  const invSum = IDS.reduce((a,id)=>a+1/EV.ODDS[id],0);
  unit(`D3 Σ(1/賠率)＝1/RTP ≥ 1（${invSum.toFixed(4)}）`, invSum >= 1 - 1e-12 && Math.abs(invSum - 1/EV.CFG.RTP) < 1e-9);
}

/* ============ E 單元檢查 ============ */
console.log('\n=== E 單元 ===');
{
  unit('E1 p 加總＝1', Math.abs(IDS.reduce((a,id)=>a+EV.P[id],0)-1) < 1e-12);
  unit('E2 每個選項 p×賠率＝RTP', IDS.every(id=>Math.abs(EV.P[id]*EV.ODDS[id]-EV.CFG.RTP)<1e-12));
  unit('E3 pick／rngFor 互逆、邊界落對區間',
    IDS.every(id=>EV.pick(EV.rngFor(id))===id) && EV.pick(0)===IDS[0] && EV.pick(0.999999999)===IDS[IDS.length-1]);
  let ok = true;
  for(const st of [1,7,13,99,1234]) for(const id of IDS){
    const pay = EV.payoutFloor(st, EV.ODDS[id]), exact = st*EV.ODDS[id];
    if(!(pay <= exact + 1e-9 && pay > exact - 1)) ok = false;       // 無條件捨去：不高估、至多差 1
    if(!Number.isInteger(pay)) ok = false;
  }
  unit('E4 結算取整：整數、不高估、至多少 1', ok);
  unit('E5 顯示 2 位無條件捨去', EV.fmtX(1.9199)==='1.91' && EV.fmtX(1.9199999)==='1.92' && EV.fmtX(3.2)==='3.20' && EV.fmtX(4.8)==='4.80');
  {
    const { g } = mkGame({ wallet:100 });
    let errs = 0; g.on((t)=>{ if(t==='error') errs++; });
    const r1 = g.bet('A', 101), r2 = g.bet('Z', 10), r3 = g.bet('A', 0), r4 = g.ack();
    unit('E6 非法下注被擋（餘額不足／未知選項／零額／非演出 ack）', !r1 && !r2 && !r3 && !r4 && errs===4);
  }
  {
    const { g, last } = mkGame({ wallet:1000, rng:()=>EV.rngFor('B') });
    const ev = []; g.on((t)=>ev.push(t));
    g.bet('B', 100);
    const mid = g.getState();
    g.ack();
    const exp = 1000 - 100 + EV.payoutFloor(100, EV.ODDS.B);
    unit('E7 先抽定再演出再結算：扣注→result→ack 才派彩',
      mid.phase==='ANIM' && mid.wallet===900 && mid.st.result==='B' &&
      g.getState().wallet===exp && ev.join()==='wallet,result,settled,wallet' && last().net===exp-1000);
  }
  {
    const { g } = mkGame({ wallet:1000, rng:()=>EV.rngFor('A') });
    g.bet('A',10); g.ack(); g.bet('A',10);
    const a = g.getState().st.orderId;
    g.ack(); g.bet('A',10); const b = g.getState().st.orderId;
    unit('E8 注單號唯一', a !== b && /^[A-Z0-9_]+-[0-9A-Z]+-\d{4}$/.test(a), `${a} / ${b}`);
  }
  {
    const store = fakeStore();
    const g1 = DemoCore.createGame({ storage:store, wallet:1000, rng:()=>EV.rngFor('A') });
    g1.bet('A', 100); g1.ack();
    const after1 = g1.getState().wallet;
    const g2 = DemoCore.createGame({ storage:store, rng:()=>0.5 });
    unit('E9 存檔接回：錢包與注單保留', g2.getState().wallet===after1 && g2.getState().records.length===1 &&
      g2.getState().records[0].orderId===g1.getState().records[0].orderId);
    // 演出中重整＝直接結算（結果已定，不重抽）
    const store2 = fakeStore();
    const g3 = DemoCore.createGame({ storage:store2, wallet:1000, rng:()=>EV.rngFor('C') });
    g3.bet('C', 50);                                              // 不 ack，模擬重整
    const g4 = DemoCore.createGame({ storage:store2, rng:()=>EV.rngFor('A') });   // rng 換掉也不能改結果
    const rec = g4.getState().records.slice(-1)[0];
    unit('E10 演出中重整＝直接結算、不重抽', g4.getState().phase==='BET' && rec && rec.result==='C' &&
      g4.getState().wallet === 1000-50+EV.payoutFloor(50, EV.ODDS.C));
    const gc = DemoCore.createGame({ storage:store2 });
    gc.clearSaved();
    unit('E11 clearSaved 回起始錢包並清注單', gc.getState().wallet===EV.CFG.WALLET && gc.getState().records.length===0);
  }
  {
    const { g } = mkGame({ wallet:500, rng:()=>EV.rngFor('A') });
    g.bet('A', 10);
    unit('E12 演出中不可重置錢包／加錢', g.clearSaved()===false && g.addMoney(100)===false);
  }
}

console.log(`\n${nFail===0?'ALL PASS':'HAS FAIL'}：PASS ${nPass}／FAIL ${nFail}（${((Date.now()-t0)/1000).toFixed(1)}s）`);
process.exit(nFail === 0 ? 0 : 1);
