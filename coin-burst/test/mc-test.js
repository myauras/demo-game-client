/* =========================================================================
 * 爆金連鎖——Node 無頭蒙地卡羅自測（對 values.js 的規則模型端到端複驗）
 * 執行：node game/test/mc-test.js [N]（預設 1,000,000 注／丟法；多執行緒，約 1 分鐘）
 *   --seed S        抽獎亂數種子（預設 20261125）
 *   --sessions K    每種丟法的「短時間體感」場數（預設 20000）
 *   --no-stats      不重算 stats.json（只跑測試）
 *   --workers W     執行緒數（預設 CPU 數−1）
 * 項目：A 理論 RTP 與抽獎機率　B 三種丟法的實測拿回比例（對進場總面值／對理論）與守恆逐項核對
 *       C 三種丟法彼此　D 防套利　E 演出自洽　F 寶物方向　G 各面額實付整數與自我檢查　H 抽獎入口可注入
 * 判定：|偏差| ≤ max(0.1pp, 3σ)；FAIL 時 exit code 1。另輸出 game/test/stats.json。
 * 註：本檔不得含頂層 'use strict'（直接 eval 需讓 var EV 落本模組作用域）。記號 burst 沒替換也能跑。
 * ========================================================================= */
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));
const lib = require('./sim-lib.js');
const ALT = lib.loadAlt(EV);

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const N = Math.floor(+argv.find(a => /^\d+$/.test(a))) || 1000000;
const SEED = +arg('--seed', 20261125);
const SESSIONS = +arg('--sessions', 20000);
const WORKERS = Math.max(1, +arg('--workers', os.cpus().length - 1));
const WRITE_STATS = !argv.includes('--no-stats');
const NAMES = lib.STRAT_NAMES, LABEL = lib.STRAT_LABEL;
const pp = (x, d = 3) => (x * 100).toFixed(d) + 'pp';
const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';

let nPass = 0, nFail = 0;
const t0 = Date.now();
function unit(tag, name, cond, detail){
  cond ? nPass++ : nFail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? '  ' + detail : ''}`);
}

/* ---- 理論值與 σ：由各類東西的機率與面值自己算（不借用 values.js 的導出值） ---- */
function theory(M){
  const c = M.VALUE.coin, pd = M.CFG.DIAMOND.P, pc = M.CFG.CROWN.P, q = M.CFG.SKY_P;
  const items = [{ p: 1 - pd - pc, v: c }, { p: pd, v: M.VALUE.diamond }, { p: pc, v: M.VALUE.crown }];
  const mean = items.reduce((a, x) => a + x.p * x.v, 0) + q * c;                    // 每注進場東西的期望面值＝RTP
  const e2 = items.reduce((a, x) => a + x.p * x.v * x.v, 0);
  const variance = (e2 - (mean - q * c) ** 2) + q * (1 - q) * c * c;                // 玩家那一枚與天降（獨立）的變異數相加
  return { rtp: mean, variance };
}
const TH = theory(EV);
const sigmaMean = (n) => Math.sqrt(TH.variance / n);

/* ---- 先把重活丟給執行緒（長跑、演出重播、短時間體感），主執行緒同時跑輕量測試 ---- */
const REPLAY_N = Math.min(N, 200000), CHUNK = 1000;
const tasks = [];
for(const name of NAMES){
  tasks.push({ w: name === 'greedy' ? 12 : 3, type: 'long', name, n: N, kindSeed: SEED, stratSeed: 777 });
  tasks.push({ w: name === 'greedy' ? 3 : 1, type: 'replay', name, n: REPLAY_N, kindSeed: SEED + 1, stratSeed: 778 });
}
if(WRITE_STATS){
  let k = 0;
  for(const name of NAMES) for(let s = 0; s < SESSIONS; s += CHUNK)
    tasks.push({ w: name === 'greedy' ? 1.5 : 0.5, type: 'sessions', name, count: Math.min(CHUNK, SESSIONS - s), seed: SEED + 100 + (k++) });
}
tasks.sort((a, b) => b.w - a.w);
function runAll(list, size){
  return new Promise((resolve, reject) => {
    const results = new Array(list.length); let next = 0, done = 0;
    const feed = (w) => { if(next < list.length){ const i = next++; w.postMessage(Object.assign({ id: i }, list[i])); } else w.terminate(); };
    for(let k = 0; k < Math.min(size, list.length); k++){
      const w = new Worker(path.join(__dirname, 'mc-worker.js'));
      w.on('message', (m) => { results[m.id] = m.out; if(++done === list.length) resolve(results); feed(w); });
      w.on('error', reject);
      feed(w);
    }
  });
}
const heavy = runAll(tasks, WORKERS);

console.log(`爆金連鎖 mc-test｜N=${N.toLocaleString()} 注／丟法｜種子 ${SEED}｜${WORKERS} 條執行緒｜面額 ${EV.CFG.DENOMS.join('／')}`);

/* ============ A 理論 RTP 與抽獎機率 ============ */
console.log('\n=== A 理論值 ===');
unit('A', 'A1 理論 RTP 在 96%～97%', EV.RTP >= 0.96 && EV.RTP <= 0.97, `RTP=${pct(EV.RTP, 4)}（普通幣 ${EV.VALUE.coin}、天降 1/7）`);
unit('A', 'A2 RTP 與獨立算法相符、拆解加總＝RTP', Math.abs(EV.RTP - TH.rtp) < 1e-12 &&
  Math.abs(EV.RTP_PARTS.coin + EV.RTP_PARTS.sky + EV.RTP_PARTS.diamond + EV.RTP_PARTS.crown - EV.RTP) < 1e-12,
  `普通幣 ${pct(EV.RTP_PARTS.coin)}＋天降 ${pct(EV.RTP_PARTS.sky)}＋鑽石 ${pct(EV.RTP_PARTS.diamond)}＋皇冠 ${pct(EV.RTP_PARTS.crown)}`);
unit('A', 'A3 起始盤面最低總枚數＝相鄰格的邊數 40、起始總數 43', EV.MIN_TOTAL === 40 && EV.START_TOTAL === 43);

/* ============ D 防套利（主執行緒即可） ============ */
console.log('\n=== D 防套利 ===');
{
  const strats = lib.makeStrategies(EV), lim = 3 * EV.VALUE.coin;                // 上限：最多挖走 3 枚普通幣的值（2.1 個面額）
  let allMax = 0;
  for(let di = 0; di < EV.CFG.DENOMS.length; di++){
    const sb = EV.startBoard(di), cs = EV.checkStart(sb);
    unit('D', `D1 面額 ${EV.CFG.DENOMS[di]} 起始盤面：總數 43、穩定循環盤面（上界證明：之後永遠 ≥40 枚 → 最多挖走 3 枚）`,
      cs.total === 43 && cs.recurrent, `total=${cs.total} recurrent=${cs.recurrent}`);
    const per = {};
    for(const name of NAMES){
      const b = EV.startBoard(di), r = EV.rng(5 + di);
      let net = 0, best = 0, at = 0;
      for(let d = 1; d <= 300; d++){                                           // 不算天降、全部普通幣
        net += EV.drop(b, strats[name](b, r), 'coin').pay - 1;
        if(net > best + 1e-9){ best = net; at = d; }
      }
      per[name] = { best, at }; if(best > allMax) allMax = best;
    }
    const g = per.greedy;
    unit('D', `D2 面額 ${EV.CFG.DENOMS[di]} 連丟 300 注：累計淨賺最高 ≤ 3 枚普通幣（${lim.toFixed(1)} 個面額）`,
      NAMES.every(n => per[n].best <= lim + 1e-9),
      `挑最會爆 ${g.best.toFixed(1)}（第 ${g.at} 注）｜隨機 ${per.random.best.toFixed(1)}｜快滿格 ${per.gold.best.toFixed(1)}｜實額 ${(g.best * EV.CFG.DENOMS[di]).toFixed(0)}`);
  }
}

/* ============ F 寶物方向 ============ */
console.log('\n=== F 寶物方向（固定規則、沒有亂數） ===');
{
  const C = EV.CFG.COLS, R = EV.CFG.ROWS, N25 = EV.N;
  const expectOrder = (c) => {
    const r = Math.floor(c / C), col = c % C;
    const arr = [[col + 1, 0], [C - col, 1], [r + 1, 2], [R - r, 3]];             // 0左 1右 2上 3下：離盤面外幾步
    arr.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return arr.map(x => x[1]);
  };
  let tableOk = true; for(let c = 0; c < N25; c++) if(JSON.stringify(EV.DIRS[c]) !== JSON.stringify(expectOrder(c))) tableOk = false;
  unit('F', 'F1 方向表＝依「離盤面外最近」排序、同距離 左右先於上下（25 格逐格核對）', tableOk);
  unit('F', 'F2 幾個代表格的方向表（中心／角落／邊上）', JSON.stringify([EV.DIRS[12], EV.DIRS[0], EV.DIRS[4], EV.DIRS[20], EV.DIRS[7]]) ===
    JSON.stringify([[0, 1, 2, 3], [0, 2, 1, 3], [1, 2, 0, 3], [0, 3, 1, 2], [2, 0, 1, 3]]),
    '中心→左右上下；左上角→左上右下；右上角→右上左下；左下角→左下右上；(2,3)→上左右下');
  let ok1 = true, ok2 = true, ok3 = true, bad = '';
  for(let c = 0; c < N25; c++){
    // 單顆寶物：炸開時走最近的邊
    let b = EV.emptyBoard(); b.h[c] = 3; b.g[c] = ['crown'];
    let res = EV.drop(b, c, 'coin'), m = res.waves[0].moves;
    if(!(m[0].kind === 'crown' && m[0].dir === EV.DIRS[c][0] && m.slice(1).every(x => x.kind === 'coin'))){ ok1 = false; bad += ' 單顆@' + c; }
    // 同格兩顆（鑽石在前、後來丟的皇冠在後）：第一顆走最近、第二顆走第二近
    b = EV.emptyBoard(); b.h[c] = 3; b.g[c] = ['diamond'];
    res = EV.drop(b, c, 'crown'); m = res.waves[0].moves;
    if(!(m[0].kind === 'diamond' && m[0].dir === EV.DIRS[c][0] && m[1].kind === 'crown' && m[1].dir === EV.DIRS[c][1] && m[2].kind === 'coin' && m[3].kind === 'coin')){ ok2 = false; bad += ' 雙顆@' + c; }
    // 全盤都疊 3 枚、一顆寶物：一路直線（每一步方向相同）往最近的邊出去
    b = EV.emptyBoard(); for(let j = 0; j < N25; j++) b.h[j] = 3; b.g[c] = ['diamond'];
    res = EV.drop(b, c, 'coin');
    const path = []; for(const w of res.waves) for(const mv of w.moves) if(mv.kind === 'diamond') path.push(mv);
    if(!(res.exits.diamond === 1 && path.length >= 1 && path.every(mv => mv.dir === EV.DIRS[c][0]) && path[path.length - 1].to < 0)){ ok3 = false; bad += ' 直線@' + c; }
  }
  unit('F', 'F3 單顆寶物只往最近的邊走（25 格各測一次）', ok1, bad);
  unit('F', 'F4 同格第二顆走第二近的方向，其餘補普通幣', ok2, bad);
  unit('F', 'F5 寶物一路直線走出盤面、不拐彎（全盤 3 枚連鎖，25 格各測一次）', ok3, bad);
  // 沒有亂數：同一盤面、同一落點重跑兩次，結果（含分波明細）逐字相同
  let same = 0, trials = 3000;
  const r = EV.rng(99), kr = EV.rng(100), b = EV.startBoard(0);
  for(let t = 0; t < trials; t++){
    EV.play(b, Math.floor(r() * N25), kr, { rec: false });
    const kind = ['coin', 'coin', 'diamond', 'crown'][t % 4], cell = Math.floor(r() * N25);
    const b1 = EV.cloneBoard(b), b2 = EV.cloneBoard(b);
    const r1 = EV.drop(b1, cell, kind), r2 = EV.drop(b2, cell, kind), pv = EV.preview(b, cell, kind), pr = EV.probe(b, cell);
    if(JSON.stringify([r1, b1]) === JSON.stringify([r2, b2]) && JSON.stringify(pv) === JSON.stringify(r1) && pr.exitCount === r1.exitCount && pr.topples === r1.topples) same++;
  }
  unit('F', `F6 同一盤面同一落點重跑兩次結果相同（${trials} 組，含 preview／probe 與 drop 一致）`, same === trials, `${same}/${trials}`);
}

/* ============ G 各面額實付整數與自我檢查 ============ */
console.log('\n=== G 實付整數與自我檢查 ===');
{
  let allInt = true, detail = [];
  for(let d = 0; d < EV.CFG.DENOMS.length; d++){
    const p = EV.PAY[d], den = EV.CFG.DENOMS[d];
    for(const k of ['coin', 'diamond', 'crown']) if(!Number.isInteger(p[k]) || Math.abs(p[k] - den * EV.VALUE[k]) > 1e-9) allInt = false;
    detail.push(`${den}：${p.coin}／${p.diamond}／${p.crown}`);
  }
  unit('G', 'G1 各面額下 普通幣／鑽石／皇冠 實付皆整數（＝面額×值）', allInt, detail.join('；'));
  unit('G', 'G2 替代設定（鑽石 3、皇冠 25、普通幣 ' + ALT.VALUE.coin + '）各面額實付皆整數且 RTP 在範圍內',
    ALT.PAY.every(p => Number.isInteger(p.coin) && Number.isInteger(p.diamond) && Number.isInteger(p.crown)) && ALT.RTP >= 0.96 && ALT.RTP <= 0.97, `RTP=${pct(ALT.RTP, 3)}`);
  const thr = (over) => { try { EV.build(over); return false; } catch(e) { return true; } };
  unit('G', 'G3 自我檢查會擋：普通幣 0.705（實付非整數）／0.9（RTP 超過 97%）／0.5（RTP 低於 96%）', thr({ COIN_PAY: 0.705 }) && thr({ COIN_PAY: 0.9 }) && thr({ COIN_PAY: 0.5 }));
  unit('G', 'G4 start 種子被改壞時自我檢查會擋', thr({ START: [{ seed: 1, drops: 400, thin: 0 }, EV.CFG.START[1], EV.CFG.START[2]] }));
  let cashOk = true; const kr2 = EV.rng(7), pr2 = EV.rng(8), b = EV.startBoard(1);
  for(let t = 0; t < 2000; t++){
    const res = EV.play(b, Math.floor(pr2() * EV.N), kr2);
    for(let d = 0; d < EV.PAY.length; d++) if(!Number.isInteger(EV.cash(res, d)) || Math.abs(EV.cash(res, d) - res.pay * EV.CFG.DENOMS[d]) > 1e-6) cashOk = false;
  }
  unit('G', 'G5 每一注的實付金額（cash）為整數、等於 拿回倍數×面額', cashOk);
}

/* ============ H 抽獎入口可注入 ============ */
console.log('\n=== H 抽獎入口（rng 可注入） ===');
{
  const base = () => 0.5;
  const mk = () => EV.emptyBoard();
  let r = EV.play(mk(), 3, EV.scripted({ kind: 'diamond', sky: 7 }, base), { rec: true });
  unit('H', 'H1 指定「下一枚鑽石、天降落在第 7 格」', r.kind === 'diamond' && r.sky && r.sky.cell === 7 && r.enter.diamond === 1 && r.enter.coin === 1);
  r = EV.play(mk(), 3, EV.scripted({ kind: 'crown', sky: false }, () => 0), {});
  unit('H', 'H2 指定「下一枚皇冠、沒有天降」（base 恆為 0 也不會有天降）', r.kind === 'crown' && r.sky === null);
  r = EV.play(mk(), 3, EV.scripted({ kind: 'coin', sky: true }, () => 0.9), {});
  unit('H', 'H3 指定「普通幣、有天降、落點照 base」', r.kind === 'coin' && r.sky && r.sky.cell === EV.rollSkyCell(0.9));
  const seq = () => { const a = EV.rng(42); return a; };
  const pa = EV.play(EV.startBoard(0), 12, seq(), {}), pb = EV.play(EV.startBoard(0), 12, EV.scripted({}, seq()), {});
  unit('H', 'H4 不指定時與直接給 base 的結果逐字相同', JSON.stringify(pa) === JSON.stringify(pb));
  const sq = EV.scripted({ kind: 'diamond', sky: false }, () => 0.999), b0 = mk();
  const p1 = EV.play(b0, 0, sq, {}), p2 = EV.play(b0, 0, sq, {});
  unit('H', 'H5 指定只管一注（第二注回到 base）', p1.kind === 'diamond' && p2.kind === 'coin' && p2.sky === null);
  const e = 1e-12, pd = EV.CFG.DIAMOND.P, pc = EV.CFG.CROWN.P;
  unit('H', 'H6 抽獎區間邊界：鑽石 [0,1/40)、皇冠 [1/40,1/40+1/800)、其餘普通幣；天降 u<1/7',
    EV.rollKind(0) === 'diamond' && EV.rollKind(pd - e) === 'diamond' && EV.rollKind(pd) === 'crown' && EV.rollKind(pd + pc - e) === 'crown' && EV.rollKind(pd + pc) === 'coin' &&
    EV.rollSky(EV.CFG.SKY_P - e) === true && EV.rollSky(EV.CFG.SKY_P) === false &&
    ['coin', 'diamond', 'crown'].every(k => EV.rollKind(EV.uForKind(k)) === k) && EV.rollSky(EV.uForSky(true)) && !EV.rollSky(EV.uForSky(false)) &&
    Array.from({ length: EV.N }, (_, i) => EV.rollSkyCell(EV.uForCell(i)) === i).every(Boolean));
}

/* ============ 等執行緒的結果 ============ */
heavy.then((results) => {
  const L = {}, RP = {}, SS = {};
  tasks.forEach((t, i) => {
    if(t.type === 'long') L[t.name] = results[i];
    else if(t.type === 'replay') RP[t.name] = results[i];
    else (SS[t.name] = SS[t.name] || []).push(results[i]);
  });
  const lim = Math.max(0.001, 3 * sigmaMean(N));

  /* ============ A 抽獎機率（取自長跑裡進場的東西；三種丟法同一串，看一份即可） ============ */
  console.log('\n=== A（續）抽獎機率 ===');
  {
    const s = L.random, binom = (p) => 3 * Math.sqrt(p * (1 - p) / N);
    const f = { diamond: s.inK.diamond / N, crown: s.inK.crown / N, sky: s.sky / N };
    unit('A', `A4 鑽石機率＝1/40`, Math.abs(f.diamond - EV.CFG.DIAMOND.P) <= binom(EV.CFG.DIAMOND.P), `實測 ${pct(f.diamond, 4)}（${s.inK.diamond} 顆）理論 ${pct(EV.CFG.DIAMOND.P, 4)}`);
    unit('A', `A5 皇冠機率＝1/800`, Math.abs(f.crown - EV.CFG.CROWN.P) <= binom(EV.CFG.CROWN.P), `實測 ${pct(f.crown, 4)}（${s.inK.crown} 顆）理論 ${pct(EV.CFG.CROWN.P, 4)}`);
    unit('A', `A6 天降機率＝1/7`, Math.abs(f.sky - EV.CFG.SKY_P) <= binom(EV.CFG.SKY_P), `實測 ${pct(f.sky, 3)}（${s.sky} 次）理論 ${pct(EV.CFG.SKY_P, 3)}`);
  }

  /* ============ B 各丟法的實測拿回比例 ============ */
  console.log(`\n=== B 三種丟法各 ${N.toLocaleString()} 注（σ＝${pp(sigmaMean(N), 4)}，判準 max(0.1pp, 3σ)＝${pp(lim, 3)}） ===`);
  const bound = {};
  for(const name of NAMES){
    const s = L[name], lab = `[${LABEL[name]}]`;
    bound[name] = Math.max(s.startVal, s.maxBv);                                     // 盤面殘留造成的上界（個面額）
    const dRolled = s.got - s.rolled;
    unit('B', `B1 ${lab} 守恆逐項：進場＋起始＝噴出＋盤面殘留`,
      s.inK.coin + s.startCoins === s.outK.coin + s.coinsOn && s.inK.diamond === s.outK.diamond + s.gemsOn.diamond && s.inK.crown === s.outK.crown + s.gemsOn.crown,
      `普通幣 ${s.inK.coin}＋${s.startCoins}＝${s.outK.coin}＋${s.coinsOn}｜鑽石 ${s.inK.diamond}＝${s.outK.diamond}＋${s.gemsOn.diamond}｜皇冠 ${s.inK.crown}＝${s.outK.crown}＋${s.gemsOn.crown}`);
    unit('B', `B2 ${lab} 面值恆等式：拿回＝進場總面值＋起始盤面面值−殘留面值`,
      Math.abs(s.got - (s.rolled + s.startVal - s.endVal)) < 0.01 && Math.abs(s.trackedEndVal - s.endVal) < 0.01,
      `拿回 ${s.got.toFixed(1)}｜進場 ${s.rolled.toFixed(1)}＋起始 ${s.startVal.toFixed(1)}−殘留 ${s.endVal.toFixed(1)}`);
    unit('B', `B3 ${lab} 拿回比例與「這串亂數實際進場東西的總面值÷投入」相差 ≤ 盤面殘留上界`,
      Math.abs(dRolled) <= bound[name] + 1e-6,
      `拿回 ${pct(s.rtp, 4)}｜進場總面值 ${pct(s.rolledRtp, 4)}｜差 ${pp(s.rtp - s.rolledRtp, 4)}｜上界 ${pp(bound[name] / N, 4)}（盤面面值最高 ${s.maxBv.toFixed(1)}）`);
    unit('B', `B4 ${lab} 與理論 ${pct(EV.RTP, 3)} 的偏差 ≤ max(0.1pp, 3σ)`,
      Math.abs(s.rtp - EV.RTP) <= lim, `實測 ${pct(s.rtp, 3)}｜偏差 ${pp(s.rtp - EV.RTP, 3)}｜容許 ±${pp(lim, 3)}`);
    unit('B', `B5 ${lab} 極值上界：每一注拿回 ≤ 該注前盤面總面值＋該注進場面值（${N.toLocaleString()} 注）`,
      s.boundViolations === 0, `違反 ${s.boundViolations} 次｜最緊的一注餘裕 ${s.worstSlack.toFixed(2)} 個面額｜實測單注最高 ${s.maxPay.toFixed(1)} 倍面額｜盤面平均 ${s.avgTot.toFixed(1)} 枚（${s.minTot}～${s.maxTot}）`);
  }

  console.log('\n=== C 三種丟法彼此 ===');
  {
    const a = L.random, same = NAMES.every(n => L[n].rolled === a.rolled && L[n].sky === a.sky && L[n].inK.coin === a.inK.coin && L[n].inK.diamond === a.inK.diamond && L[n].inK.crown === a.inK.crown);
    unit('C', 'C1 三種丟法吃到同一串「是不是寶物、有沒有天降」（進場總面值逐位相同）', same, `進場 ${pct(a.rolledRtp, 4)}｜天降 ${a.sky} 次｜鑽石 ${a.inK.diamond}｜皇冠 ${a.inK.crown}`);
    for(const [x, y] of [['random', 'greedy'], ['random', 'gold'], ['greedy', 'gold']]){
      const diff = Math.abs(L[x].rtp - L[y].rtp), ub = (bound[x] + bound[y]) / N;
      unit('C', `C2 ${LABEL[x]} vs ${LABEL[y]}：拿回比例相差 ≤ 兩邊盤面殘留上界之和`, diff <= ub + 1e-9, `相差 ${pp(diff, 4)}｜上界 ${pp(ub, 4)}`);
    }
  }

  console.log('\n=== E 演出自洽（照 play 回傳的分波結果重播） ===');
  for(const name of NAMES){
    const r = RP[name], bad = r.boardBad + r.exitBad + r.cashBad + r.payBad + r.waveBad;
    unit('E', `E1 [${LABEL[name]}] ${r.plays.toLocaleString()} 注：重播盤面（逐格 h 與寶物清單）＝核心盤面；噴出枚數、金額（各面額實付）、波數／格數加總相符`, bad === 0,
      `盤面不符 ${r.boardBad}｜噴出不符 ${r.exitBad}｜金額不符 ${r.cashBad}｜倍數不符 ${r.payBad}｜波內不符 ${r.waveBad}｜單注最多 ${r.maxWaves} 波`);
  }

  console.log(`\n${nFail === 0 ? 'ALL PASS' : 'HAS FAIL'}：PASS ${nPass}／FAIL ${nFail}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  if(WRITE_STATS){
    const st = buildStats(L, SS);
    fs.writeFileSync(path.join(__dirname, 'stats.json'), JSON.stringify(st, null, 2));
    console.log(`stats.json 已輸出（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    printStats(st);
  }
  process.exit(nFail === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(2); });

/* ============ stats.json ============ */
function quant(a, p){ return a[Math.min(a.length - 1, Math.floor(a.length * p))]; }
function buildStats(L, SS){
  const mk = (M, alt) => {
    const sfx = alt ? 'Alt' : '', gem = (M.RTP_PARTS.diamond + M.RTP_PARTS.crown) / M.RTP;
    const out = {
      config: { coinPay: M.VALUE.coin, diamondPay: M.VALUE.diamond, crownPay: M.VALUE.crown, skyP: M.CFG.SKY_P, diamondP: M.CFG.DIAMOND.P, crownP: M.CFG.CROWN.P, pay: M.PAY },
      theory: { rtp: M.RTP, parts: M.RTP_PARTS, shareOfRtp: { coin: M.RTP_PARTS.coin / M.RTP, sky: M.RTP_PARTS.sky / M.RTP, diamond: M.RTP_PARTS.diamond / M.RTP, crown: M.RTP_PARTS.crown / M.RTP, gems: gem } },
      longRun: {}, sessions: {}
    };
    for(const name of NAMES){
      const s = L[name];
      out.longRun[name] = {
        n: s.n, rtp: alt ? s.rtpAlt : s.rtp, rolledRtp: alt ? s.rolledRtpAlt : s.rolledRtp,
        anyExit: s.anyExit, chain: s.hit, only1Exit: s.exits1,
        backOrMore: s['back' + sfx], ge4x: s['big' + sfx], ge10x: s['huge' + sfx],
        maxPay: alt ? s.maxPayAlt : s.maxPay, avgBoardCoins: s.avgTot, minBoardCoins: s.minTot, maxBoardCoins: s.maxTot, skyCount: s.sky
      };
      const chunks = SS[name] || [];
      if(chunks.length){
        out.sessions[name] = { sessions: chunks.reduce((a, c) => a + c.count, 0) };
        lib.MARKS.forEach((mk2, mi) => {
          const all = [].concat(...chunks.map(c => Array.from(c[alt ? 'alt' : 'main'][mi]))).sort((x, y) => x - y);
          out.sessions[name][mk2] = { p10: quant(all, 0.1), p50: quant(all, 0.5), p90: quant(all, 0.9), profitRate: all.filter(x => x > 1).length / all.length };
        });
      }
    }
    return out;
  };
  const st = { generatedAt: new Date().toISOString(), note: '每場 session＝新玩家從預設面額起始盤面連丟 500 注；alt 與主設定共用同一批模擬（盤面運動只看枚數、與各物的值無關），只是各物的值不同。', drops: N, seed: SEED, defaultDenom: EV.CFG.DENOMS[EV.CFG.DENOM_DEFAULT] };
  Object.assign(st, mk(EV, false));
  st.alt = mk(ALT, true);
  st.alt.description = '替代設定（給用戶裁決用，不改 CFG）：鑽石 3、皇冠 25、普通幣＝RTP 最接近 96.9% 且各面額實付為整數的值';
  return st;
}
function printStats(st){
  const row = (label, x) => `${label}｜10% ${pct(x.p10, 1)}｜中位 ${pct(x.p50, 1)}｜90% ${pct(x.p90, 1)}｜賺錢場次 ${pct(x.profitRate, 1)}`;
  for(const [title, o] of [['本版', st], ['替代設定', st.alt]]){
    console.log(`\n== ${title}：普通幣 ${o.config.coinPay}、鑽石 ${o.config.diamondPay}、皇冠 ${o.config.crownPay}、理論 RTP ${pct(o.theory.rtp, 2)}（寶物佔 ${pct(o.theory.shareOfRtp.gems, 1)}）==`);
    for(const name of NAMES){
      const l = o.longRun[name];
      console.log(`${LABEL[name]}：有幣噴出 ${pct(l.anyExit, 1)}｜回本以上 ${pct(l.backOrMore, 1)}｜≥4倍 ${pct(l.ge4x, 2)}｜≥10倍 ${pct(l.ge10x, 2)}｜單注最高 ${l.maxPay.toFixed(1)} 倍｜盤面平均 ${l.avgBoardCoins.toFixed(1)} 枚`);
      if(o.sessions[name]) for(const m of lib.MARKS) console.log('    ' + row(`丟 ${m} 注`, o.sessions[name][m]));
    }
  }
}
