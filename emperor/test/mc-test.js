/* =========================================================================
 * 專案E E02——Node 無頭 MC 自測（對 duel-core 引擎端到端複驗）
 * 執行：node test/mc-test.js [N]（預設 1,000,000／項；快跑可傳 100000）
 * 項目：A 兩引擎勝率＝p　B 抽樣收手深度 RTP=0.93　C 抽樣登頂路徑 RTP=0.96
 *       D N1 修正後決勝回合分佈 vs 密封序全等（逐格）　E 單元檢查
 * 判定：A–C 單統計量 3σ；D 多格聯合改 4σ（Bonferroni，~50 格）。
 * 註：本檔不得含頂層 'use strict'（直接 eval 需讓 var EV/DuelCore 落本模組作用域）
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'js', 'duel-core.js'), 'utf8'));

const N = Math.floor(+(process.argv[2]) || 1e6);
const STAKE = 1e6;                 // 大押額令取整偏差 <1e-6，遠低於 MC 噪音
const R = DuelCore.ROUNDS;
let nPass = 0, nFail = 0;
const t0 = Date.now();

function report(tag, name, theory, mean, se, sigma){
  sigma = sigma || 3;
  const z = se > 0 ? (mean - theory) / se : 0, ok = Math.abs(z) <= sigma;
  ok ? nPass++ : nFail++;
  console.log(`${ok?'PASS':'FAIL'} [${tag}] ${name}  理論 ${theory.toFixed(4)}  實測 ${mean.toFixed(4)} ±${(sigma*se).toFixed(4)}(${sigma}σ)  z=${z.toFixed(2)}`);
}
function unit(name, cond, detail){
  cond ? nPass++ : nFail++;
  console.log(`${cond?'PASS':'FAIL'} [E] ${name}${detail?'  '+detail:''}`);
}
function mkGame(o){
  let last = null, lastTrick = null;
  const g = DuelCore.createGame(Object.assign(
    { timers:false, storage:false, wallet:Number.MAX_SAFE_INTEGER/4 }, o||{}));
  g.on((t,d)=>{ if(t==='settle') last=d;
                if(t==='trick' && d.verdict) lastTrick={t:d.t, reason:d.verdict.reason, win:d.verdict.win}; });
  return { g, lastSettle:()=>last, lastTrick:()=>lastTrick };
}
function freeIdx(st, pred){
  for(let i=0;i<st.myCards.length;i++){
    const c=st.myCards[i];
    if(!c.used && (!pred || pred(c))) return i;
  }
  return -1;
}
function resolveAdvancedRandom(g){       // 隨機出牌打完一場（進階）
  while(g.getState().phase==='PLAY'){
    const st=g.getState().st, free=[];
    st.myCards.forEach((c,i)=>{ if(!c.used) free.push(i); });
    g.play(free[(Math.random()*free.length)|0]);
    g.ack();
  }
}

/* ============ A 兩引擎勝率＝p ============ */
console.log(`\n=== A 勝率＝p（單階，N=${N}／項） ===`);
for(const mode of ['normal','advanced']) for(const side of ['emp','slv']){
  const {g} = mkGame(); g.setMode(mode);
  let wins = 0;
  for(let i=0;i<N;i++){
    g.bet(side, 100);
    if(mode==='normal') g.ack(); else resolveAdvancedRandom(g);
    if(g.getState().phase==='LADDER'){ wins++; g.cashOut(); }
  }
  const p = wins/N;
  report('A', `${mode==='normal'?'普通':'進階'}・${side==='emp'?'皇帝側':'奴隸側'}`,
    EV.CFG.P[side], p, Math.sqrt(p*(1-p)/N));
}

/* ============ B 抽樣收手深度 RTP=0.93 ============ */
console.log(`\n=== B 收手 RTP=0.93（端到端含取整，N=${N}／項） ===`);
const rep = (s,k)=>Array(k).fill(s);
const PATHS = [
  ['純帝1', rep('emp',1)], ['純帝3', rep('emp',3)], ['純帝9', rep('emp',9)],
  ['純奴1', rep('slv',1)], ['純奴3', rep('slv',3)],
  ['帝→奴', ['emp','slv']], ['奴→帝→帝', ['slv','emp','emp']],
  ['帝帝奴帝', ['emp','emp','slv','emp']]
];
for(const [label, p] of PATHS){
  const {g,lastSettle} = mkGame(); g.setMode('normal');
  let sum=0, sumsq=0;
  for(let i=0;i<N;i++){
    g.bet(p[0], STAKE); g.ack();
    let k=1;
    while(g.getState().phase==='LADDER'){
      if(k<p.length){ g.continueRung(p[k]); g.ack(); k++; }
      else { g.cashOut(); break; }
    }
    const m = lastSettle().payout/STAKE;
    sum+=m; sumsq+=m*m;
  }
  const mean=sum/N, se=Math.sqrt(Math.max(0,sumsq/N-mean*mean)/N);
  report('B', `收手・${label}`, EV.CFG.RTP_CASH, mean, se);
}

/* ============ C 抽樣登頂路徑 RTP=0.96 ============ */
console.log(`\n=== C 登頂 RTP=0.96（玩到系統收，N=${N}／項） ===`);
const TOPS = [
  ['純奴隸', ()=> 'slv'], ['純皇帝', ()=> 'emp'],
  ['帝奴交替', r=> r%2===1?'emp':'slv'], ['奴帝交替', r=> r%2===1?'slv':'emp'],
  ['隨機換邊', ()=> Math.random()<0.5?'emp':'slv']
];
let maxPay = 0;
for(const [label, ch] of TOPS){
  const {g,lastSettle} = mkGame(); g.setMode('normal');
  let sum=0, sumsq=0;
  for(let i=0;i<N;i++){
    g.bet(ch(1), STAKE); g.ack();
    while(g.getState().phase==='LADDER'){
      g.continueRung(ch(g.getState().st.rung+1)); g.ack();
    }
    const m = lastSettle().payout/STAKE;
    if(m>maxPay) maxPay=m;
    sum+=m; sumsq+=m*m;
  }
  const mean=sum/N, se=Math.sqrt(Math.max(0,sumsq/N-mean*mean)/N);
  report('C', `登頂・${label}`, EV.CFG.RTP_TOP, mean, se);
}
unit('C 最大實付 ≤ 枚舉精確最大 600.00x ≤ 上界',
  maxPay<=600.0000001 && 600<=EV.maxPayoutBound(),
  `MC 最大 ${maxPay.toFixed(4)}x／上界 ${EV.maxPayoutBound().toFixed(2)}x`);

/* ============ D N1：決勝回合分佈 vs 密封序全等（逐格 4σ） ============ */
console.log(`\n=== D N1 分佈全等（進階引擎，特殊牌固定第 pp 張，N=${Math.floor(N/2)}／組） ===`);
/* 密封序精確格：對手特殊牌位置均勻 1..5（無條件機率，每格含勝負） */
function sealedCells(side, pp){
  const c = {}, p = 1/R;
  for(let t=1;t<pp;t++) c[t+'・'+(side==='slv'?'帝斬民！':'民擒奴！')] = p;
  c[pp+'・奴弒帝！'] = p;
  if(R-pp>0) c[pp+'・'+(side==='slv'?'民擒奴！':'帝斬民！')] = (R-pp)*p;
  return c;
}
for(const side of ['slv','emp']) for(let pp=1;pp<=R;pp++){
  const Nd = Math.floor(N/2);
  const {g,lastTrick} = mkGame(); g.setMode('advanced');
  const cnt = {};
  for(let i=0;i<Nd;i++){
    g.bet(side, 100);
    while(g.getState().phase==='PLAY'){
      const st = g.getState().st, t = st.trick+1;
      const idx = (t===pp) ? freeIdx(st, c=>c.t!=='民') : freeIdx(st, c=>c.t==='民');
      g.play(idx); g.ack();
    }
    const lt = lastTrick();
    const k = lt.t+'・'+lt.reason;
    cnt[k] = (cnt[k]||0)+1;
    if(g.getState().phase==='LADDER') g.cashOut();
  }
  const exact = sealedCells(side, pp);
  let maxZ = 0, worst = '';
  const keys = new Set([...Object.keys(exact), ...Object.keys(cnt)]);
  for(const k of keys){
    const th = exact[k]||0, ob = (cnt[k]||0)/Nd;
    const se = Math.sqrt(Math.max(th*(1-th), 1e-12)/Nd);
    const z = Math.abs(ob-th)/se;
    if(z>maxZ){ maxZ=z; worst=`${k} 理論 ${(th*100).toFixed(1)}% 實測 ${(ob*100).toFixed(2)}%`; }
  }
  const ok = maxZ<=4;
  ok?nPass++:nFail++;
  console.log(`${ok?'PASS':'FAIL'} [D] ${side==='slv'?'奴隸側':'皇帝側'}・特殊第${pp}張  格數 ${keys.size}  max|z|=${maxZ.toFixed(2)}（最偏格：${worst}）`);
}

/* ============ E 單元檢查：持久化接回／Q2Q3 逾時／滿貫取整 ============ */
console.log('\n=== E 單元檢查 ===');
function memStore(){ const m={}; return {
  getItem:k=>(k in m ? m[k] : null), setItem:(k,v)=>{m[k]=String(v);},
  removeItem:k=>{delete m[k];} }; }

// E1 進階：中斷於 ANIM（已出牌未 ack）→ 重載自動推進，狀態與 ack 後全等
{
  const s1 = memStore();
  const {g:g1} = mkGame({storage:s1, wallet:5000});
  g1.setMode('advanced'); g1.bet('slv', 500);
  g1.play(freeIdx(g1.getState().st));          // 出第一張，停在 ANIM 不 ack
  const {g:g2} = mkGame({storage:s1, wallet:5000});   // 重載＝自動 afterAck
  g1.ack();
  const a = g1.getState(), b = g2.getState();
  const norm = s => JSON.stringify({ph:s.phase, w:s.wallet, st: s.st ? {
    side:s.st.side, M:s.st.M, rung:s.st.rung, trick:s.st.trick,
    my:s.st.myCards, win:s.st.win} : null});
  unit('E1 進階中斷接回（ANIM 自動推進）', norm(a)===norm(b),
       `phase ${a.phase}→重載 ${b.phase}`);
}
// E2 普通：中斷於 ANIM → 重載保留腳本供重播，ack 後可正常推進
{
  const s2 = memStore();
  const {g:g1} = mkGame({storage:s2, wallet:5000});
  g1.setMode('normal'); g1.bet('emp', 500);
  const sc1 = JSON.stringify(g1.getState().st.script);
  const {g:g2} = mkGame({storage:s2, wallet:5000});
  const st2 = g2.getState();
  const okScript = st2.phase==='ANIM' && JSON.stringify(st2.st.script)===sc1;
  g2.ack();
  const ph = g2.getState().phase;
  unit('E2 普通中斷接回（腳本保留、ack 可推進）',
       okScript && (ph==='LADDER'||ph==='BET'), `重播後 phase=${ph}`);
}
// E3 Q2 逾時＝視同收手（金額＝floor(押額×M)、via=timeout）
{
  const rng0 = ()=>0;   // 恆贏（0<p）、腳本 d=2
  const {g,lastSettle} = mkGame({rng:rng0, wallet:5000});
  g.setMode('normal'); g.bet('emp', 1000); g.ack();       // LADDER，M=1.1625
  const w0 = g.getState().wallet;
  g.fireTimeout('decide');
  const s = lastSettle();
  unit('E3 Q2 逾時視同收手', s && s.kind==='cash' && s.via==='timeout' &&
       s.payout===1162 && g.getState().wallet===w0+1162,
       `payout=${s&&s.payout}（floor(1000×1.1625)=1162）`);
}
// E4 Q3 逾時＝隨機出一張
{
  const {g} = mkGame({wallet:5000});
  g.setMode('advanced'); g.bet('emp', 500);
  g.fireTimeout('play');
  const st = g.getState();
  unit('E4 Q3 逾時隨機出牌', st.phase==='ANIM' && st.st.trick===1,
       `phase=${st.phase} trick=${st.st.trick}`);
}
// E5 滿貫取整：純奴 4 階＝實付精確 600x（浮點防衛下 floor 不掉 1）
{
  const rng0 = ()=>0;
  const {g,lastSettle} = mkGame({rng:rng0, wallet:5000});
  g.setMode('normal'); g.bet('slv', 1000); g.ack();
  for(let k=0;k<3;k++){ g.continueRung('slv'); g.ack(); }   // 第4階勝→自動滿貫
  const s = lastSettle();
  unit('E5 滿貫自動結算＝600.00x', s && s.kind==='slam' && s.payout===600000,
       `kind=${s&&s.kind} payout=${s&&s.payout}（期望 600000）`);
}
// E6 純帝 10 階完賭＝實付 8.9407x（floor(1000×8.94070…)＝8940）
{
  const rng0 = ()=>0;
  const {g,lastSettle} = mkGame({rng:rng0, wallet:5000});
  g.setMode('normal'); g.bet('emp', 1000); g.ack();
  while(g.getState().phase==='LADDER'){ g.continueRung('emp'); g.ack(); }
  const s = lastSettle();
  unit('E6 十階完賭＝頂端加成實付', s && s.kind==='full' && s.payout===8940,
       `kind=${s&&s.kind} payout=${s&&s.payout}（期望 floor(8940.70…)=8940）`);
}
// E7 普通腳本自洽：決勝牌面裁決＝抽定勝負（1 萬局全數一致）
{
  let ok = true;
  for(let i=0;i<10000 && ok;i++){
    const side = Math.random()<0.5?'emp':'slv', win = Math.random()<0.5;
    const sc = DuelCore.buildScript(side, win, Math.random);
    const last = sc[sc.length-1];
    ok = last.decisive && last.verdict.win===win &&
         sc.slice(0,-1).every(t=>!t.decisive && t.p==='民' && t.o==='民') &&
         sc.length>=2 && sc.length<=5;
  }
  unit('E7 腳本自洽（裁決＝抽定、前段全民民、長度 2–5）', ok);
}
// E7b 腳本牌數自洽（E03-R4 回歸）：每側民≤4；決勝第 5 回合必為帝奴對撞
{
  let ok = true;
  for(let i=0;i<10000 && ok;i++){
    const side = Math.random()<0.5?'emp':'slv', win = Math.random()<0.5;
    const sc = DuelCore.buildScript(side, win, Math.random);
    const last = sc[sc.length-1];
    const collide = (last.p!=='民' && last.o!=='民');
    const pMin = sc.filter(t=>t.p==='民').length, oMin = sc.filter(t=>t.o==='民').length;
    ok = pMin<=4 && oMin<=4 && (sc.length<5 || collide);
  }
  unit('E7b 腳本牌數自洽（民≤4、第5回合決勝必對撞）', ok);
}
// E8 顯示格式（Q1 捨去 2 位）＋進度條端點
{
  const f = DuelCore.fmtX;
  unit('E8 顯示捨去 2 位＋railPct 端點',
    f(EV.baseOdds('emp'))==='1.16' && f(EV.baseOdds('slv'))==='4.65' &&
    f(8.6613)==='8.66' && f(1.9999)==='1.99' && f(599.999)==='599.99' &&
    Math.abs(DuelCore.railPct(EV.CFG.RTP_CASH))<1e-9 &&
    Math.abs(DuelCore.railPct(EV.CFG.SLAM_LINE)-100)<1e-9,
    `帝 ${f(EV.baseOdds('emp'))}／奴 ${f(EV.baseOdds('slv'))}`);
}

console.log(`\n合計 PASS ${nPass}／FAIL ${nFail}　耗時 ${((Date.now()-t0)/1000).toFixed(1)}s　N=${N}`);
process.exit(nFail?1:0);
