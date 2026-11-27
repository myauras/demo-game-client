/* =========================================================================
 * 爆金連鎖——Node 無頭蒙地卡羅自測（對 values.js 的規則模型端到端複驗）　v3：單一盤面＋刷新盤面＋換金額；能量條＋全盤金幣雨＋連鎖獎池
 * 執行：node game/test/mc-test.js [N]（預設 1,000,000 注／丟法；多執行緒，約 1～2 分鐘）
 *   --seed S        抽獎亂數種子（預設 20261125）
 *   --sessions K    每種丟法的「短時間體感」場數（預設 20000）
 *   --no-stats      不重算 stats.json（只跑測試）
 *   --workers W     執行緒數（預設 CPU 數−1）
 * 項目：A 理論 RTP 與抽獎機率　B 五種丟法的實測拿回比例（含獎池；對進場總面值／對理論）與守恆逐項核對、盤面不低於最低總數
 *       C 五種丟法彼此　D 防套利（上界含獎池）　E 演出自洽（含金幣雨重播、獎池重判）　F 寶物方向　G 各面額實付整數與自我檢查
 *       H 抽獎入口可注入　R 能量條與金幣雨（每 RAIN_EVERY 注恰一次、rainAll＝25 次依序 drop）
 *       P 連鎖獎池（potAfter 純函式、守恆、上界、拿獎池時機只有兩種、逐注對影子）
 *       L 合法盤面（isLegal；起始盤面合法、從合法盤面丟幣永遠合法且 ≥40 枚）　S 刷新與換金額盤面（reshuffle／floorBoard）
 *       X 刷新套利（7 種狂刷丟法各 N 注：長期拿回與不刷相同、枚數與寶物不變、全程合法）　W 單一盤面換金額套利（9 種丟法、用錢算，只會虧）
 *       K 刷新冷卻比較表（K＝0／3／5／10／15／20／30 注 × 三種刷法（刷、只在沒有 8 格時刷、刷＋養盤）＋ 不刷對照，寫進 stats.json）
 * 常數一律讀 EV（RAIN_EVERY、POT_ADD、POT_CHAIN），不在這裡寫死。
 * 判定：|偏差| ≤ max(0.1pp, 3σ)；FAIL 時 exit code 1。另輸出 game/test/stats.json。
 * 註：本檔不得含頂層 'use strict'（直接 eval 需讓 var EV 落本模組作用域）。記號 burst 沒替換也能跑。
 * ========================================================================= */
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));
const lib = require('./sim-lib.js');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const N = Math.floor(+argv.find(a => /^\d+$/.test(a))) || 1000000;
const SEED = +arg('--seed', 20261125);
const SESSIONS = +arg('--sessions', 20000);
const WORKERS = Math.max(1, +arg('--workers', os.cpus().length - 1));
const WRITE_STATS = !argv.includes('--no-stats');
const NAMES = lib.STRAT_NAMES, LABEL = lib.STRAT_LABEL, SESS_NAMES = ['gold', 'builder'];
const RE = EV.RAIN_EVERY, N25 = EV.N, PC = EV.POT_CHAIN, DI0 = EV.CFG.DENOM_DEFAULT, DEN0 = EV.CFG.DENOMS[DI0];
const POT_ADD_CASH = (di) => Math.round(EV.CFG.DENOMS[di] * EV.CFG.POT_ADD);   // 測試自己算的「每注存進獎池的實付」（整數）
const pp = (x, d = 3) => (x * 100).toFixed(d) + 'pp';
const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';

let nPass = 0, nFail = 0;
const t0 = Date.now();
function unit(tag, name, cond, detail){
  cond ? nPass++ : nFail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? '  ' + detail : ''}`);
}

/* ---- 理論值與 σ：由各類東西的機率與面值自己算（不借用 values.js 的導出值） ----
   一個完整能量條週期（RE 注）：RE 枚玩家丟的東西（各依機率）＋ N25 枚免費普通幣；噴出的東西的拿回＝週期內進場總面值÷RE。
   獎池：每注存 POT_ADD、遲早全數發還（最慢在下雨那一注）→ 每注平均再拿回 POT_ADD（確定的，不增加變異數）。
   變異數只來自「玩家那一枚是什麼」（金幣雨的免費幣與獎池都是固定的），所以每注的變異數＝item 的變異數 */
function theory(M){
  const c = M.VALUE.coin, pd = M.CFG.DIAMOND.P, pc = M.CFG.CROWN.P;
  const items = [{ p: 1 - pd - pc, v: c }, { p: pd, v: M.VALUE.diamond }, { p: pc, v: M.VALUE.crown }];
  const itemMean = items.reduce((a, x) => a + x.p * x.v, 0);
  const e2 = items.reduce((a, x) => a + x.p * x.v * x.v, 0);
  const cycle = RE * itemMean + N25 * c;
  return { rtp: cycle / RE + M.CFG.POT_ADD, itemMean, variance: e2 - itemMean * itemMean };
}
const TH = theory(EV);
const sigmaMean = (n) => Math.sqrt(TH.variance / n);

/* ---- 先把重活丟給執行緒（長跑、演出重播、短時間體感），主執行緒同時跑輕量測試 ---- */
const REPLAY_N = Math.min(N, 200000), CHUNK = 1000;
const tasks = [];
for(const name of NAMES){
  const heavyStrat = name === 'greedy' || name === 'builder';                 // 這兩種每注要試算所有快滿格
  tasks.push({ w: heavyStrat ? 12 : 3, type: 'long', name, n: N, kindSeed: SEED, stratSeed: 777 });
  tasks.push({ w: heavyStrat ? 3 : 1, type: 'replay', name, n: REPLAY_N, kindSeed: SEED + 1, stratSeed: 778 });
}
if(WRITE_STATS){
  let k = 0;
  for(const name of SESS_NAMES) for(let s = 0; s < SESSIONS; s += CHUNK)
    tasks.push({ w: 0.7, type: 'sessions', name, count: Math.min(CHUNK, SESSIONS - s), seed: SEED + 100 + (k++) });
}
/* ---- v3：刷新套利（狂刷丟法×8 段）、刷新冷卻比較表、單一盤面換金額套利 ----
   每一組「同設定」切成幾段獨立長跑（各段種子不同、各從起始盤面／floorBoard 開始），總注數＝N；同一段的各組吃同一串抽獎亂數 */
const STRESS_CH = 8, KCH = 3, SWCH = 4, KN = Math.ceil(Math.min(N, 300000) / KCH);
const STRESS = [
  { tag: 'every', base: 'greedy', w: 2, label: '每注都刷（刷完挑最會爆的格丟）', o: { mode: 'every', pick: 'greedy' } },
  { tag: 'every10', base: 'greedy', w: 1, label: '每 10 注刷一次', o: { mode: 'every', cd: 10, pick: 'greedy' } },
  { tag: 'no8', base: 'greedy', w: 8, label: '沒有能炸 8 格的就刷（同一注最多連刷 6 次）', o: { mode: 'no8', cd: 0, retry: 6, pick: 'greedy' } },
  { tag: 'low', base: 'greedy', w: 2, label: '盤面枚數低於 48 就刷', o: { mode: 'low', lowBelow: 48, pick: 'greedy' } },
  { tag: 'gemHunt', base: 'greedy', w: 6, label: '刷到「點下去會噴出寶物」為止（同一注最多 4 次）', o: { mode: 'gemHunt', cd: 0, retry: 4, pick: 'greedy' } },
  { tag: 'maxExit', base: 'greedy', w: 5, label: '同一注連刷 3 次、取「噴最多枚」的盤面', o: { mode: 'maxExit', cd: 0, retry: 3, pick: 'greedy' } },
  { tag: 'every8', base: 'p8gold', w: 8, label: '每注刷到有能炸 8 格的格子為止（最多 6 次）、有就炸', o: { mode: 'every', cd: 0, untilHit8: true, retry: 6, pick: 'p8gold' } }
];
const KS = [0, 3, 5, 10, 15, 20, 30];
for(let c = 0; c < STRESS_CH; c++){
  const common = { n: Math.ceil(N / STRESS_CH), kindSeed: SEED + 31000 + c, stratSeed: 900 + c, refSeed: 700 + c };
  for(const s of STRESS) tasks.push({ w: s.w, type: 'refresh', tag: 'S:' + s.tag, o: Object.assign({}, common, s.o) });
  for(const bp of ['greedy', 'p8gold']) tasks.push({ w: 0.6, type: 'refresh', tag: 'S:base-' + bp, o: Object.assign({}, common, { mode: 'none', pick: bp }) });
}
if(WRITE_STATS){
  for(let c = 0; c < KCH; c++){
    const common = { n: KN, kindSeed: SEED + 41000 + c, stratSeed: 950 + c, refSeed: 750 + c };
    for(const K of KS){
      tasks.push({ w: K === 0 ? 6 : 2, type: 'refresh', tag: 'K:A:' + K, o: Object.assign({}, common, { mode: 'every', cd: K, untilHit8: K === 0, retry: 6, pick: 'p8gold' }) });
      tasks.push({ w: K === 0 ? 8 : 3, type: 'refresh', tag: 'K:C:' + K, o: Object.assign({}, common, { mode: 'no8', cd: K, retry: 6, pick: 'builder' }) });
      tasks.push({ w: K === 0 ? 6 : 2, type: 'refresh', tag: 'K:B:' + K, o: Object.assign({}, common, { mode: 'no8', cd: K, retry: 6, pick: 'p8gold' }) });
    }
    for(const bp of ['builder', 'gold', 'p8gold']) tasks.push({ w: 1, type: 'refresh', tag: 'K:base-' + bp, o: Object.assign({}, common, { mode: 'none', pick: bp }) });
  }
}
const SWITCHES = ['fixed0', 'fixed1', 'fixed2', 'cycle1', 'cycle5', 'cycle30', 'hoardBlast', 'nearFullUp', 'nearFullDown'];
for(let c = 0; c < SWCH; c++)
  for(const p of SWITCHES) tasks.push({ w: p === 'cycle1' ? 3 : 1.5, type: 'switch', tag: 'W:' + p, o: { policy: p, n: Math.ceil(N / SWCH), kindSeed: SEED + 51000 + c, stratSeed: 970 + c, floorSeed: 5 + c } });

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

console.log(`爆金連鎖 mc-test（v3 單一盤面＋刷新＋換金額；能量條＋金幣雨＋連鎖獎池）｜N=${N.toLocaleString()} 注／丟法｜種子 ${SEED}｜${WORKERS} 條執行緒｜面額 ${EV.CFG.DENOMS.join('／')}｜能量條 ${RE}｜獎池每注存 ${EV.CFG.POT_ADD} 個面額、炸 ${PC} 格拿走`);

/* ============ A 理論 RTP 與抽獎機率 ============ */
console.log('\n=== A 理論值 ===');
unit('A', `A1 理論 RTP 在 ${pct(EV.CFG.RTP_MIN, 0)}～${pct(EV.CFG.RTP_MAX, 0)} 且＝鐵表 94.9375%`, EV.RTP >= EV.CFG.RTP_MIN && EV.RTP <= EV.CFG.RTP_MAX && Math.abs(EV.RTP - 0.949375) < 1e-9, `RTP=${pct(EV.RTP, 4)}（普通幣 ${EV.VALUE.coin}、能量條 ${RE}、每場金幣雨 ${N25} 枚、獎池每注存 ${EV.CFG.POT_ADD}）`);
unit('A', 'A2 RTP 與另一種算法（週期內進場總面值÷週期長＋獎池每注存的）相符、拆解加總＝RTP',
  Math.abs(EV.RTP - TH.rtp) < 1e-12 &&
  Math.abs(EV.RTP_PARTS.coin + EV.RTP_PARTS.rain + EV.RTP_PARTS.diamond + EV.RTP_PARTS.crown + EV.RTP_PARTS.pot - EV.RTP) < 1e-12 && EV.RTP_PARTS.pot === EV.CFG.POT_ADD,
  `普通幣 ${pct(EV.RTP_PARTS.coin)}＋金幣雨 ${pct(EV.RTP_PARTS.rain)}＋鑽石 ${pct(EV.RTP_PARTS.diamond)}＋皇冠 ${pct(EV.RTP_PARTS.crown)}＋獎池 ${pct(EV.RTP_PARTS.pot)}`);
unit('A', 'A3 起始盤面最低總枚數＝相鄰格的邊數 40、起始總數 43', EV.MIN_TOTAL === 40 && EV.START_TOTAL === 43);
unit('A', 'A7 單枚天降已整個移除（CFG.SKY_P／rollSky／rollSkyCell／uForSky／uForCell／RTP_PARTS.sky／play 的 sky 欄位都不存在）',
  EV.CFG.SKY_P === undefined && EV.rollSky === undefined && EV.rollSkyCell === undefined && EV.uForSky === undefined && EV.uForCell === undefined &&
  EV.RTP_PARTS.sky === undefined && !('sky' in EV.play(EV.emptyBoard(), 0, () => 0.5, { rec: false })));
unit('A', `A8 能量條常數：RAIN_EVERY＝CFG 的 ${EV.CFG.RAIN_EVERY}（≥1 的整數）、金幣雨＝全盤 25 格`, Number.isInteger(RE) && RE >= 1 && EV.CFG.RAIN_EVERY === RE && EV.RAIN_EVERY === RE && EV.N === 25);

/* ============ D 防套利（主執行緒即可） ============ */
console.log('\n=== D 防套利 ===');
{
  const strats = lib.makeStrategies(EV), CP = EV.VALUE.coin, slackCoins = EV.START_TOTAL - EV.MIN_TOTAL;   // 起始盤面比最低多 3 枚
  /* 上界：全部丟普通幣時，d 注後噴出枚數 ≤ 進場枚數（d＋25×金幣雨次數）＋起始多出的 3 枚（盤面永遠 ≥ 40）。
     噴出的累計淨賺 ＝ 普通幣值×噴出 − d ≤ 普通幣值×(d＋25×⌊(d＋m0)/RE⌋＋3) − d（m0＝起始能量條，第一場雨在第 RE−m0 注）。
     獎池：是玩家自己存的錢（每注 POT_ADD），累計拿走的獎池 ≤ 累計存入 ＝ POT_ADD×d，所以上界再加 POT_ADD×d。
     金幣雨的免費幣與獎池都是 RTP 的一部分、不是漏洞。m0 取 0 與 RE−1（最壞的預充＝第一注就下雨，涵蓋核心 Demo 用的任何預充值） */
  const bound = (d, m0) => CP * (d + N25 * Math.floor((d + m0) / RE) + slackCoins) - d + EV.CFG.POT_ADD * d;
  const M0S = [0, RE - 1];
  let allMax = 0, ub = 0; for(const m0 of M0S) for(let d = 0; d <= 300; d++) ub = Math.max(ub, bound(d, m0));
  const coinOnly = () => 0.99;                                                  // 恆為普通幣
  for(let di = 0; di < EV.CFG.DENOMS.length; di++){
    const sb = EV.startBoard(di), cs = EV.checkStart(sb), DEN = EV.CFG.DENOMS[di];
    unit('D', `D1 面額 ${DEN} 起始盤面：總數 43、穩定循環盤面（上界證明：之後永遠 ≥40 枚 → 最多挖走 3 枚）`,
      cs.total === 43 && cs.recurrent, `total=${cs.total} recurrent=${cs.recurrent}`);
    const per = {}; let viol = 0, potViol = 0, rainN = 0;
    for(const name of NAMES) for(const m0 of M0S){
      const b = EV.startBoard(di), r = EV.rng(5 + di);
      let net = 0, best = 0, at = 0, meter = m0, minT = 1e9, pot = 0, potWonSum = 0, potInSum = 0;
      for(let d = 1; d <= 300; d++){                                           // 全部普通幣、含金幣雨、含獎池
        const mt = EV.meterAfter(meter), left = RE - 1 - meter;
        const res = EV.play(b, strats[name](b, r, left), coinOnly, { rec: false, rain: mt.rain });
        const pa = EV.potAfter(pot, res, di); pot = pa.pot; potWonSum += pa.win; potInSum += pa.add;
        if(res.rain) rainN++;
        net += res.pay + pa.win / DEN - 1;
        meter = mt.meter;
        if(net > bound(d, m0) + 1e-9) viol++;
        if(potWonSum + pot !== potInSum || potWonSum > potInSum) potViol++;   // 拿走的獎池不會超過自己存進去的
        const t = EV.total(b); if(t < minT) minT = t;
        if(net > best + 1e-9){ best = net; at = d; }
      }
      const key = name + '@' + m0;
      per[key] = { best, at, minT }; if(best > allMax) allMax = best;
    }
    const k0 = (n) => per[n + '@0'], keys = Object.keys(per);
    unit('D', `D2 面額 ${DEN} 五種丟法各連丟 300 注（起始能量條 0 與 ${RE - 1} 各一輪；含獎池）：每一注累計淨賺（噴出的＋獎池）都 ≤ 該注的理論上界，且最高 ≤ ${ub.toFixed(2)} 個面額（含起始多出的 3 枚普通幣 ${(3 * CP).toFixed(1)}）`,
      viol === 0 && potViol === 0 && keys.every(n => per[n].best <= ub + 1e-9 && per[n].minT >= EV.MIN_TOTAL),
      `最高淨賺（能量條 0 起）：挑最會爆 ${k0('greedy').best.toFixed(1)}（第 ${k0('greedy').at} 注）｜隨機 ${k0('random').best.toFixed(1)}｜快滿格 ${k0('gold').best.toFixed(1)}｜養盤 ${k0('smart').best.toFixed(1)}｜養盤到門檻 ${k0('builder').best.toFixed(1)}｜實額（挑最會爆）${(k0('greedy').best * DEN).toFixed(0)}｜上界違反 ${viol} 次｜獎池超領 ${potViol} 次｜盤面最低 ${Math.min(...keys.map(n => per[n].minT))} 枚`);
  }
}

/* ============ F 寶物方向 ============ */
console.log('\n=== F 寶物方向（固定規則、沒有亂數） ===');
{
  const C = EV.CFG.COLS, R = EV.CFG.ROWS;
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
  let ok1 = true, ok2 = true, ok3 = true, ok4 = true, bad = '';
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
    // 金幣雨：盤上原有的寶物照同一套方向規則走（全盤 3 枚＋一顆寶物，金幣雨讓 25 格同時 +1 → 第一波全炸）
    b = EV.emptyBoard(); for(let j = 0; j < N25; j++) b.h[j] = 3; b.g[c] = ['crown'];
    res = EV.rainAll(b);
    const w0 = res.waves[0], mv0 = w0.moves.filter(mv => mv.from === c)[0];
    const cp = []; for(const w of res.waves) for(const mv of w.moves) if(mv.kind === 'crown') cp.push(mv);
    if(!(w0.cells.length === N25 && mv0.kind === 'crown' && mv0.dir === EV.DIRS[c][0] && res.exits.crown === 1 && cp.every(mv => mv.dir === EV.DIRS[c][0]) && cp[cp.length - 1].to < 0)){ ok4 = false; bad += ' 金幣雨@' + c; }
  }
  unit('F', 'F3 單顆寶物只往最近的邊走（25 格各測一次）', ok1, bad);
  unit('F', 'F4 同格第二顆走第二近的方向，其餘補普通幣', ok2, bad);
  unit('F', 'F5 寶物一路直線走出盤面、不拐彎（全盤 3 枚連鎖，25 格各測一次）', ok3, bad);
  unit('F', 'F7 金幣雨時盤上原有寶物照既有方向規則走（全盤 3 枚＋一顆皇冠、25 格各測一次；金幣雨的幣不是寶物）', ok4, bad);
  // 沒有亂數：同一盤面、同一落點重跑兩次，結果（含分波明細）逐字相同
  let same = 0, sameRain = 0, trials = 3000;
  const r = EV.rng(99), kr = EV.rng(100), b = EV.startBoard(0);
  for(let t = 0; t < trials; t++){
    EV.play(b, Math.floor(r() * N25), kr, { rec: false, rain: t % 9 === 0 });
    const kind = ['coin', 'coin', 'diamond', 'crown'][t % 4], cell = Math.floor(r() * N25);
    const b1 = EV.cloneBoard(b), b2 = EV.cloneBoard(b);
    const r1 = EV.drop(b1, cell, kind), r2 = EV.drop(b2, cell, kind), pv = EV.preview(b, cell, kind), pr = EV.probe(b, cell);
    if(JSON.stringify([r1, b1]) === JSON.stringify([r2, b2]) && JSON.stringify(pv) === JSON.stringify(r1) && pr.exitCount === r1.exitCount && pr.topples === r1.topples) same++;
    const b3 = EV.cloneBoard(b), b4 = EV.cloneBoard(b);
    if(JSON.stringify([EV.rainAll(b3), b3]) === JSON.stringify([EV.rainAll(b4), b4])) sameRain++;
  }
  unit('F', `F6 同一盤面同一落點重跑兩次結果相同（${trials} 組，含 preview／probe 與 drop 一致；rainAll 重跑也相同）`, same === trials && sameRain === trials, `drop ${same}/${trials}｜rainAll ${sameRain}/${trials}`);
}

/* ============ G 各面額實付整數與自我檢查 ============ */
console.log('\n=== G 實付整數與自我檢查 ===');
{
  let allInt = true, detail = [];
  for(let d = 0; d < EV.CFG.DENOMS.length; d++){
    const p = EV.PAY[d], den = EV.CFG.DENOMS[d];
    for(const k of ['coin', 'diamond', 'crown']) if(!Number.isInteger(p[k]) || Math.abs(p[k] - den * EV.VALUE[k]) > 1e-9) allInt = false;
    if(!Number.isInteger(p.pot) || Math.abs(p.pot - den * EV.CFG.POT_ADD) > 1e-9 || p.pot !== POT_ADD_CASH(d) || p.pot <= 0) allInt = false;   // 獎池每注存的實付也要整數（15／75／150）
    detail.push(`${den}：${p.coin}／${p.diamond}／${p.crown}／獎池每注 ${p.pot}`);
  }
  unit('G', 'G1 各面額下 普通幣／鑽石／皇冠／獎池每注存入 實付皆整數（＝面額×值）', allInt, detail.join('；'));
  const sol = EV.solveCoinPay({}, (EV.CFG.RTP_MIN + EV.CFG.RTP_MAX) / 2);
  unit('G', `G2 solveCoinPay：以目前能量條與寶物值，掃「各面額實付皆整數」的格點，最接近 ${pct((EV.CFG.RTP_MIN + EV.CFG.RTP_MAX) / 2, 1)}（範圍中點）的普通幣值就是目前的 ${EV.VALUE.coin}`, sol.coinPay === EV.VALUE.coin && Math.abs(sol.rtp - EV.RTP) < 1e-12, `coinPay=${sol.coinPay} rtp=${pct(sol.rtp, 3)}`);
  const thr = (over) => { try { EV.build(over); return false; } catch(e) { return true; } };
  unit('G', 'G3 自我檢查會擋：普通幣 0.705（實付非整數）／0.9（RTP 超過 96%）／0.49（RTP 低於 94%）', thr({ COIN_PAY: 0.705 }) && thr({ COIN_PAY: 0.9 }) && thr({ COIN_PAY: 0.49 }));
  unit('G', 'G6 自我檢查會擋：能量條 40（RTP 超過 96%）／1000（RTP 低於 94%）／0／1.5／NaN（不是 ≥1 的整數）',
    thr({ RAIN_EVERY: 40 }) && thr({ RAIN_EVERY: 1000 }) && thr({ RAIN_EVERY: 0 }) && thr({ RAIN_EVERY: 1.5 }) && thr({ RAIN_EVERY: NaN }));
  unit('G', 'G4 start 種子被改壞時自我檢查會擋', thr({ START: [{ seed: 1, drops: 400, thin: 0 }, EV.CFG.START[1], EV.CFG.START[2]] }));
  unit('G', 'G8 自我檢查會擋：獎池每注存入 0.155（面額 100 實付 15.5 非整數）／0.2（RTP 超過 96%）／0.1（RTP 低於 94%）／負數／NaN；獎池門檻 0／2.5／NaN（不是 ≥1 的整數）',
    thr({ POT_ADD: 0.155 }) && thr({ POT_ADD: 0.2 }) && thr({ POT_ADD: 0.1 }) && thr({ POT_ADD: -0.15 }) && thr({ POT_ADD: NaN }) && thr({ POT_CHAIN: 0 }) && thr({ POT_CHAIN: 2.5 }) && thr({ POT_CHAIN: NaN }));
  unit('G', 'G9 EV.POT_ADD／EV.POT_CHAIN 可讀且＝CFG；EV.potMax(di)＝RAIN_EVERY×每注存的', EV.POT_ADD === EV.CFG.POT_ADD && EV.POT_CHAIN === EV.CFG.POT_CHAIN && EV.PAY.every((p, d) => EV.potMax(d) === RE * p.pot));
  let cashOk = true; const kr2 = EV.rng(7), pr2 = EV.rng(8), b = EV.startBoard(1);
  for(let t = 0; t < 2000; t++){
    const res = EV.play(b, Math.floor(pr2() * EV.N), kr2, { rain: t % 11 === 10 });
    for(let d = 0; d < EV.PAY.length; d++) if(!Number.isInteger(EV.cash(res, d)) || Math.abs(EV.cash(res, d) - res.pay * EV.CFG.DENOMS[d]) > 1e-6) cashOk = false;
  }
  unit('G', 'G5 每一注（含金幣雨）的實付金額（cash）為整數、等於 拿回倍數×面額', cashOk);
}

/* ============ H 抽獎入口 ============ */
console.log('\n=== H 抽獎入口（rng 可注入、一注只取一次） ===');
{
  const base = () => 0.5, mk = () => EV.emptyBoard();
  let r = EV.play(mk(), 3, EV.scripted({ kind: 'diamond' }, base), { rec: true, rain: true });
  unit('H', 'H1 指定「這枚鑽石」＋金幣雨：enter＝鑽石 1＋普通幣 25、inValue＝鑽石值＋25×普通幣值', r.kind === 'diamond' && r.rain && r.enter.diamond === 1 && r.enter.coin === N25 && Math.abs(r.inValue - (EV.VALUE.diamond + N25 * EV.VALUE.coin)) < 1e-9);
  r = EV.play(mk(), 3, EV.scripted({ kind: 'crown' }, () => 0), {});
  unit('H', 'H2 指定「這枚皇冠」、沒給 rain → 沒有金幣雨（rain＝null、enter 普通幣 0）', r.kind === 'crown' && r.rain === null && r.enter.coin === 0 && r.enter.crown === 1);
  r = EV.play(mk(), 3, EV.scripted({ kind: 'coin' }, () => 0), { rain: true });
  unit('H', 'H3 指定「普通幣」＋金幣雨：enter 普通幣 26', r.kind === 'coin' && r.rain && r.enter.coin === N25 + 1);
  const seq = () => EV.rng(42);
  const pa = EV.play(EV.startBoard(0), 12, seq(), {}), pb = EV.play(EV.startBoard(0), 12, EV.scripted({}, seq()), {});
  const pc = EV.play(EV.startBoard(0), 12, seq(), { rain: true }), pd2 = EV.play(EV.startBoard(0), 12, EV.scripted({}, seq()), { rain: true });
  unit('H', 'H4 不指定時與直接給 base 的結果逐字相同（有／無金幣雨各一）', JSON.stringify(pa) === JSON.stringify(pb) && JSON.stringify(pc) === JSON.stringify(pd2));
  const sq = EV.scripted({ kind: 'diamond' }, () => 0.999), b0 = mk();
  const p1 = EV.play(b0, 0, sq, {}), p2 = EV.play(b0, 0, sq, {});
  unit('H', 'H5 指定只管一注（第二注回到 base）', p1.kind === 'diamond' && p2.kind === 'coin' && p2.rain === null);
  const e = 1e-12, pd = EV.CFG.DIAMOND.P, pcr = EV.CFG.CROWN.P;
  unit('H', 'H6 抽獎區間邊界：鑽石 [0,1/40)、皇冠 [1/40,1/40+1/800)、其餘普通幣；uForKind 反查',
    EV.rollKind(0) === 'diamond' && EV.rollKind(pd - e) === 'diamond' && EV.rollKind(pd) === 'crown' && EV.rollKind(pd + pcr - e) === 'crown' && EV.rollKind(pd + pcr) === 'coin' &&
    ['coin', 'diamond', 'crown'].every(k => EV.rollKind(EV.uForKind(k)) === k));
  let calls = 0; const cnt = () => { calls++; return 0.9; };
  EV.play(mk(), 5, cnt, { rain: false }); const c1 = calls; EV.play(mk(), 5, cnt, { rain: true }); const c2 = calls - c1;
  unit('H', 'H7 一注的 rng 只取一次（有或沒有金幣雨都一樣；金幣雨不抽）', c1 === 1 && c2 === 1, `無雨 ${c1} 次｜有雨 ${c2} 次`);
  const eb = mk(); r = EV.play(eb, 7, EV.scripted({ kind: 'coin' }, base), { rain: true });
  unit('H', 'H8 空盤 + 這枚落第 7 格 + 金幣雨：25 格各 1 枚、第 7 格 2 枚，總 26 枚、沒有噴出、沒有分波', eb.h.every((x, j) => x === (j === 7 ? 2 : 1)) && r.exitCount === 0 && r.rain.waves.length === 0 && r.rain.fall.length === 25 && EV.total(eb) === 26);
}

/* ============ R 能量條與金幣雨（主執行緒部分） ============ */
console.log('\n=== R 能量條與金幣雨 ===');
{
  // R1 meterAfter：從 0 開始每丟一枚＋1、第 RE 注觸發並歸零
  let m = 0, rains = [], bad = 0, meters = [];
  for(let d = 1; d <= RE * 4 + 10; d++){
    const x = EV.meterAfter(m);
    if(x.rain) rains.push(d);
    if(x.rain !== (m === RE - 1) || x.meter !== (m === RE - 1 ? 0 : m + 1)) bad++;
    m = x.meter; meters.push(m);
  }
  unit('R', `R1 meterAfter：每丟一枚＋1，第 ${[1, 2, 3, 4].map(k => k * RE).join('、')} 注觸發金幣雨並歸零，其餘注都不觸發`, JSON.stringify(rains) === JSON.stringify([RE, 2 * RE, 3 * RE, 4 * RE]) && bad === 0 && Math.max(...meters) === RE - 1 && m === 10, `觸發於第 ${rains.join('、')} 注`);
  unit('R', `R1b meterAfter 邊角：(0)→1／(${RE - 2})→${RE - 1}／(${RE - 1})→歸零＋雨／壞值（NaN、負數、超過）不炸`,
    JSON.stringify(EV.meterAfter(0)) === '{"meter":1,"rain":false}' && JSON.stringify(EV.meterAfter(RE - 2)) === `{"meter":${RE - 1},"rain":false}` && JSON.stringify(EV.meterAfter(RE - 1)) === '{"meter":0,"rain":true}' &&
    JSON.stringify(EV.meterAfter(NaN)) === '{"meter":1,"rain":false}' && JSON.stringify(EV.meterAfter(-5)) === '{"meter":1,"rain":false}' && JSON.stringify(EV.meterAfter(RE + 124)) === '{"meter":0,"rain":true}' && JSON.stringify(EV.meterAfter(undefined)) === '{"meter":1,"rain":false}');

  // R2 rainAll ＝ 25 次依序 drop：純普通幣盤面逐格相同；有寶物時 h／噴出總數／連爆格數相同、寶物落點只在「同格多顆」時可能不同
  const rr = EV.rng(31337), kr = EV.rng(4242), TOT = 10000;
  const boards = [];
  for(let i = 0; i < 4000; i++){                                                // 隨機穩定盤面（每格 0～3，純普通幣；不一定是穩定循環盤面）
    const b = EV.emptyBoard(); for(let j = 0; j < N25; j++) b.h[j] = Math.floor(rr() * 4); boards.push({ b, gems: false });
  }
  const coinOnly = () => 0.99, strats = lib.makeStrategies(EV);
  for(const name of ['random', 'gold', 'smart']){                              // 實際玩出來的盤面（純普通幣、含金幣雨之後的盤面）
    const b = EV.startBoard(1), pr = EV.rng(900 + name.length); let meter = 0;
    for(let d = 1; d <= 1000; d++){
      const mt = EV.meterAfter(meter);
      EV.play(b, strats[name](b, pr, RE - 1 - meter), coinOnly, { rec: false, rain: mt.rain }); meter = mt.meter;
      if(d % 1 === 0 && boards.length < 4000 + 3000 && d > 20) boards.push({ b: EV.cloneBoard(b), gems: false });
    }
  }
  while(boards.length < 7000){ const b = EV.startBoard(0), pr = EV.rng(boards.length); for(let t = 0; t < 30; t++) EV.play(b, strats.random(b, pr), coinOnly, { rec: false }); boards.push({ b, gems: false }); }
  for(let i = 0; i < 3000; i++){                                                // 有寶物的盤面：隨機盤面上隨手放寶物（每格寶物數 ≤ 該格枚數，同格可多顆）
    const b = EV.emptyBoard(); for(let j = 0; j < N25; j++){ b.h[j] = Math.floor(rr() * 4); const k = rr() < 0.35 ? Math.floor(rr() * (b.h[j] + 1)) : 0; for(let q = 0; q < k; q++) b.g[j].push(rr() < 0.5 ? 'diamond' : 'crown'); }
    boards.push({ b, gems: true });
  }
  let hBad = 0, exBad = 0, tpBad = 0, gemTotBad = 0, gemExact = 0, gemN = 0, coinFullBad = 0, coinN = 0, stableBad = 0, shapeBad = 0;
  for(const { b, gems } of boards){
    const A = EV.cloneBoard(b), S = EV.cloneBoard(b);
    const ra = EV.rainAll(A, false), ra2 = EV.rainAll(EV.cloneBoard(b), true);
    const ex = { coin: 0, diamond: 0, crown: 0 }; let tp = 0;
    for(let j = 0; j < N25; j++){ const d = EV.drop(S, j, 'coin'); for(const k in ex) ex[k] += d.exits[k]; tp += d.topples; }
    if(JSON.stringify(A.h) !== JSON.stringify(S.h)) hBad++;
    if(ra.exitCount !== ex.coin + ex.diamond + ex.crown) exBad++;
    if(ra.topples !== tp) tpBad++;
    if(A.h.some(x => x >= 4 || x < 0)) stableBad++;
    if(ra.waves !== null || ra2.waves === null || ra2.exitCount !== ra.exitCount || ra.cell !== -1 || ra.kind !== 'coin' || ra.fall.length !== N25) shapeBad++;
    const gOn = (B) => { const o = { diamond: 0, crown: 0 }; for(const x of B.g) for(const k of x) o[k]++; return o; };
    const g0 = gOn(b), gA = gOn(A), gS = gOn(S);
    if(g0.diamond !== gA.diamond + ra.exits.diamond || g0.crown !== gA.crown + ra.exits.crown || g0.diamond !== gS.diamond + ex.diamond || g0.crown !== gS.crown + ex.crown) gemTotBad++;
    if(gems){ gemN++; if(JSON.stringify(A.g) === JSON.stringify(S.g) && ra.exits.diamond === ex.diamond && ra.exits.crown === ex.crown) gemExact++; }
    else { coinN++; if(JSON.stringify(A.g) !== JSON.stringify(S.g) || ra.exits.coin !== ex.coin) coinFullBad++; }
  }
  unit('R', `R2 rainAll 與「25 格依序各丟一枚」比對（${boards.length.toLocaleString()} 個盤面：隨機盤面、實際玩出來的盤面、有寶物的盤面）：最後盤面逐格相同`, hBad === 0, `不符 ${hBad}`);
  unit('R', 'R2b 噴出總枚數、連爆格數（總次數）相同；寶物總數守恆（盤上＋噴出）；結果都是穩定盤面（每格 <4）', exBad === 0 && tpBad === 0 && gemTotBad === 0 && stableBad === 0, `噴出不符 ${exBad}｜連爆格數不符 ${tpBad}｜寶物守恆不符 ${gemTotBad}｜不穩定 ${stableBad}`);
  unit('R', `R2c 純普通幣盤面（${coinN} 個）：噴出普通幣數、寶物欄位也逐格相同`, coinFullBad === 0, `不符 ${coinFullBad}`);
  console.log(`     （資訊）有寶物的 ${gemN} 個盤面中，寶物落點與各種類噴出數也和依序 drop 完全相同的有 ${gemExact} 個（${pct(gemExact / gemN, 1)}）；其餘只差在同格多顆寶物的出場順序，總枚數與面額不變`);
  unit('R', 'R2d rainAll 回傳形狀：cell＝−1、kind＝coin、fall＝[0..24]、rec＝false 時 waves＝null、預設有分波', shapeBad === 0, `不符 ${shapeBad}`);
}

/* ============ P 連鎖獎池（主執行緒部分：potAfter 純函式、probe 提示、tier 含獎池） ============ */
console.log('\n=== P 連鎖獎池 ===');
{
  const fake = (topples, rain) => ({ main: { topples }, rain: rain ? { topples: 99 } : null, topples: topples + (rain ? 99 : 0) });
  let bad = '';
  for(let di = 0; di < EV.CFG.DENOMS.length; di++){
    const add = POT_ADD_CASH(di), mk = (pot, res) => EV.potAfter(pot, res, di), J = JSON.stringify;
    const cases = [
      ['沒炸到門檻也沒雨：入池、不拿', mk(0, fake(PC - 1, false)), { pot: add, win: 0, add, by: null }],
      ['已有獎池、沒到門檻：累加', mk(5 * add, fake(0, false)), { pot: 6 * add, win: 0, add, by: null }],
      ['剛好門檻格數：拿走（含這一注存的）', mk(7 * add, fake(PC, false)), { pot: 0, win: 8 * add, add, by: 'chain' }],
      ['超過門檻：拿走', mk(0, fake(PC + 5, false)), { pot: 0, win: add, add, by: 'chain' }],
      ['下雨（自己沒炸）：拿走', mk(RE * add - add, fake(0, true)), { pot: 0, win: RE * add, add, by: 'rain' }],
      ['下雨且自己炸到門檻：拿一次、算自己的', mk(3 * add, fake(PC, true)), { pot: 0, win: 4 * add, add, by: 'chain' }],
      ['金幣雨帶出的連鎖不算進門檻（res.topples 很大、main 只有門檻少一格、沒下雨）', mk(2 * add, fake(PC - 1, false)), { pot: 3 * add, win: 0, add, by: null }],
      ['壞值（NaN／負數）當 0', mk(NaN, fake(0, false)), { pot: add, win: 0, add, by: null }]
    ];
    for(const [nm, got, want] of cases) if(J(got) !== J(want)) bad += ` [面額${EV.CFG.DENOMS[di]} ${nm}：${J(got)}≠${J(want)}]`;
  }
  unit('P', 'P1 EV.potAfter 手算案例（每個面額：入池、累加、剛好門檻、超過、下雨、同注兩者、res.topples 的雨連鎖不算、壞值）', bad === '', bad);
  /* 連續 RE−1 注都沒到門檻，第 RE 注下雨：拿走的剛好是 RE×每注存的（＝上界） */
  { let pot = 0, win = 0; for(let k = 1; k <= RE; k++){ const pa = EV.potAfter(pot, fake(0, k === RE), DI0); pot = pa.pot; win = pa.win; }
    unit('P', 'P2 連丟 RE 注都沒炸到門檻：第 RE 注（雨）拿走 RE×每注存的＝EV.potMax，之後獎池 0', win === EV.potMax(DI0) && pot === 0, `拿走 ${win}（上界 ${EV.potMax(DI0)}）`); }

  /* probe 提示：「這一格現在丟普通幣會炸幾格」＝ preview 的 topples ＝ 真的丟下去 main.topples（同一個定義，畫面拿它提示） */
  let diff = 0, probes = 0, ge = 0, lt = 0, potFire = 0, potNo = 0, rr = EV.rng(2718), kr0 = EV.rng(3141);
  const strats = lib.makeStrategies(EV), b = EV.startBoard(0); let pot = 0;
  for(let t = 0; t < 600; t++){
    for(let cell = 0; cell < N25; cell++){                                       // 這個盤面的 25 個落點都試
      const pr = EV.probe(b, cell), pv = EV.preview(b, cell, 'coin');
      probes++; if(pr.topples !== pv.topples || pr.exitCount !== pv.exitCount) diff++;
      const b2 = EV.cloneBoard(b), res = EV.play(b2, cell, EV.scripted({ kind: 'coin' }, kr0), { rec: false });   // 真的丟普通幣（不下雨）
      const pa = EV.potAfter(pot, res, 0);
      if(res.main.topples !== pr.topples) diff++;
      if(pr.topples >= PC){ ge++; if(pa.by === 'chain' && pa.win === pot + pa.add) potFire++; } else { lt++; if(pa.win === 0 && pa.by === null) potNo++; }
    }
    // 推進真正的盤面：交替用「挑最會爆」與隨機丟，讓測試涵蓋各種盤面
    const cell2 = t % 2 ? strats.greedy(b, rr) : strats.random(b, rr), r2 = EV.play(b, cell2, kr0, { rec: false }); pot = EV.potAfter(pot, r2, 0).pot;
  }
  unit('P', `P3 EV.probe(board, i).topples（畫面提示用）＝EV.preview 的 topples＝真的丟普通幣的 main.topples；且 probe≥${PC} 才拿獎池（${probes} 個落點：≥${PC} 有 ${ge}、<${PC} 有 ${lt}）`,
    diff === 0 && potFire === ge && potNo === lt && ge > 0 && lt > 0, `不一致 ${diff}｜≥門檻且拿走 ${potFire}/${ge}｜<門檻且沒拿 ${potNo}/${lt}`);

  /* 分級含獎池 */
  const DEN = EV.CFG.DENOMS[1], base = { pay: 0.5, exits: { coin: 1, diamond: 0, crown: 0 } };
  unit('P', 'P4 EV.tier(res, di, potWin)：獎池算進拿回；不給 potWin 時與舊的行為相同（只看噴出）；皇冠落袋仍是 huge',
    EV.tier(base) === 'none' && EV.tier(base, 1, 0) === 'none' && EV.tier(base, 1, DEN * (EV.CFG.TIERS.BACK - 0.5)) === 'back' && EV.tier(base, 1, DEN * (EV.CFG.TIERS.BIG - 0.5)) === 'big' &&
    EV.tier(base, 1, DEN * (EV.CFG.TIERS.HUGE - 0.5)) === 'huge' && EV.tier(base, 1, DEN * (EV.CFG.TIERS.HUGE - 0.51)) === 'big' && EV.tier({ pay: 5, exits: { coin: 0, diamond: 0, crown: 1 } }, 1, 0) === 'huge');
}

/* ============ L 合法盤面（isLegal）：起始盤面合法、從合法盤面照規則丟幣永遠還是合法、永遠 ≥40 枚 ============ */
console.log('\n=== L 合法盤面 ===');
const V3 = { legal: {}, reshuffle: {}, floor: {} };
/* 不借用 values.js 的導出：測試自己用另一種寫法（直接逐步「燒」）判斷穩定循環 */
function burnLegal(h){
  if(h.length !== 25 || h.some(x => x < 0 || x > 3 || x !== Math.floor(x))) return false;
  const burnt = new Array(25).fill(false); let n = 0, prog = true;
  while(prog){
    prog = false;
    for(let v = 0; v < 25; v++){
      if(burnt[v]) continue;
      const r = Math.floor(v / 5), c = v % 5; let un = 0;
      for(const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]){ const rr = r + dr, cc = c + dc; if(rr >= 0 && rr < 5 && cc >= 0 && cc < 5 && !burnt[rr * 5 + cc]) un++; }
      if(h[v] >= un){ burnt[v] = true; n++; prog = true; }                         // 枚數 ≥ 還沒燒到的鄰格數：燒得起來（出界的邊視為已燒）
    }
  }
  return n === 25;
}
const gemCount = (b) => { const o = { diamond: 0, crown: 0 }; for(const x of b.g) for(const k of x) o[k]++; return o; };
const rl = EV.rng(8675309);
function randLegal(T, ngem){                                                   // 隨機合法盤面：floorBoard 逐枚補到 T（合法盤面加幣仍合法），再隨手放寶物
  const b = EV.floorBoard(rl);
  while(EV.total(b) < T){ const i = Math.floor(rl() * N25); if(b.h[i] < 3) b.h[i]++; }
  for(let q = 0; q < ngem; q++){ const fr = []; for(let i = 0; i < N25; i++) if(b.h[i] > b.g[i].length) fr.push(i); b.g[fr[Math.floor(rl() * fr.length)]].push(rl() < 0.5 ? 'diamond' : 'crown'); }
  return b;
}
{
  const starts = EV.CFG.DENOMS.map((_, d) => EV.startBoard(d));
  unit('L', 'L1 三張起始盤面都是合法盤面（isLegal；且測試自己的另一種燒法也同意）、總枚數 43', starts.every(b => EV.isLegal(b) && burnLegal(b.h) && EV.total(b) === EV.START_TOTAL));
  /* 判定正確性：與測試自己的獨立實作在大量隨機盤面上逐一相同；總枚數 <40 的盤面一定不合法 */
  let agree = 0, legalN = 0, bad = 0, lowN = 0, lowLegal = 0, mx = 0;
  for(let t = 0; t < 40000; t++){
    const b = EV.emptyBoard(), bias = 0.6 + rl() * 1.2;
    for(let j = 0; j < N25; j++) b.h[j] = Math.min(3, Math.floor(rl() * 4 * bias / 1.5 + rl() * 0.99));
    const a = EV.isLegal(b), c = burnLegal(b.h);
    if(a === c) agree++; else bad++;
    if(a) legalN++;
    if(EV.total(b) < 40){ lowN++; if(a) lowLegal++; }
    mx = Math.max(mx, EV.total(b));
  }
  unit('L', 'L2 isLegal 與測試自己的獨立燒法在 40000 張隨機盤面上逐張相同；總枚數 <40 的一律不合法（合法與不合法兩類都有）', bad === 0 && lowLegal === 0 && legalN > 500 && legalN < 39500, `合法 ${legalN}／不合法 ${40000 - legalN}｜總枚數 <40 共 ${lowN} 張、其中判合法 ${lowLegal} 張｜不一致 ${bad}`);
  const e = EV.emptyBoard(), f = EV.floorBoard(rl), f2 = EV.cloneBoard(f); const k0 = f2.h.findIndex(x => x > 0); f2.h[k0]--;
  const f3 = EV.cloneBoard(f); f3.g[f3.h.findIndex(x => x > 0)] = ['diamond', 'diamond', 'diamond', 'diamond'];
  const f4 = EV.cloneBoard(f); f4.h[0] = 4;
  unit('L', 'L3 不合法的樣子：空盤、40 枚盤面拿掉一枚（39 枚）、格子寶物數多過枚數、某格 4 枚、缺格／null 都判不合法；合法的 floorBoard 判合法',
    !EV.isLegal(e) && !EV.isLegal(f2) && !EV.isLegal(f3) && !EV.isLegal(f4) && !EV.isLegal({ h: [], g: [] }) && !EV.isLegal(null) && EV.isLegal(f));
  /* 合法盤面丟幣永遠合法：五種丟法×長跑（含金幣雨、寶物）、逐注檢查；另從 3000 張隨機合法盤面（各種總枚數、含寶物）各丟 40 枚（含雨） */
  const strats = lib.makeStrategies(EV), kr = EV.rng(123), per = [];
  let stepsBad = 0, stepsMin = 1e9, steps = 0;
  const LEG_N = Math.min(N, 100000);
  for(const name of NAMES){
    const b = EV.startBoard(DI0), pr = EV.rng(55 + name.length); let meter = 0, bad2 = 0, minT = 1e9;
    for(let d = 1; d <= LEG_N; d++){
      const mt = EV.meterAfter(meter);
      EV.play(b, strats[name](b, pr, RE - 1 - meter), kr, { rec: false, rain: mt.rain }); meter = mt.meter;
      steps++; if(!EV.isLegal(b) || !burnLegal(b.h)) bad2++;
      const t = EV.total(b); if(t < minT) minT = t;
    }
    stepsBad += bad2; stepsMin = Math.min(stepsMin, minT); per.push(`${name} ${minT}`);
  }
  unit('L', `L4 從起始盤面照規則丟幣（五種丟法 × ${LEG_N.toLocaleString()} 注，含金幣雨、寶物）：每一注結算後都還是合法盤面、枚數 ≥40`, stepsBad === 0 && stepsMin >= EV.MIN_TOTAL, `檢查 ${steps.toLocaleString()} 次｜不合法 ${stepsBad}｜各丟法盤面最低：${per.join('、')}`);
  let rb = 0, rmin = 1e9, rsteps = 0;
  for(let t = 0; t < 3000; t++){
    const T = 40 + Math.floor(rl() * 36), b = randLegal(T, Math.floor(rl() * 4)), pr = EV.rng(t + 1);
    if(!EV.isLegal(b)){ rb++; continue; }
    for(let d = 0; d < 40; d++){
      EV.play(b, Math.floor(pr() * N25), kr, { rec: false, rain: d % 13 === 12 });
      rsteps++; if(!EV.isLegal(b)) rb++; rmin = Math.min(rmin, EV.total(b));
    }
  }
  unit('L', 'L5 從 3000 張隨機合法盤面（總枚數 40～75、含寶物）各隨機丟 40 枚（含金幣雨）：每一步都還是合法、枚數 ≥40', rb === 0 && rmin >= 40, `步數 ${rsteps}｜不合法 ${rb}｜最低 ${rmin} 枚`);
  V3.legal = { starts: starts.map(b => ({ total: EV.total(b), legal: EV.isLegal(b) })), randomBoards: 40000, randomLegal: legalN, followedSteps: steps + rsteps, minTotalSeen: Math.min(stepsMin, rmin) };
}

/* ============ S 刷新盤面（reshuffle）與換金額盤面（floorBoard） ============ */
console.log('\n=== S 刷新與換金額盤面 ===');
{
  const J = JSON.stringify, snap = (b) => J({ h: b.h, g: b.g });
  let n = 0, badTot = 0, badLegal = 0, badGem = 0, badCap = 0, badMut = 0, same = 0, noGemCell = 0;
  const byT = {}, rr = EV.rng(4242), t0r = Date.now();
  for(let t = 0; t < 20000; t++){
    const T = t < 400 ? (t % 2 ? 75 : 40) : 40 + Math.floor(rl() * 36), ng = Math.floor(rl() * 6);
    const b = randLegal(T, Math.min(ng, T)), before = snap(b), g0 = gemCount(b), c = EV.reshuffle(b, rr);
    n++;
    if(EV.total(c) !== EV.total(b)) badTot++;
    if(!EV.isLegal(c) || !burnLegal(c.h)) badLegal++;
    const g1 = gemCount(c); if(g0.diamond !== g1.diamond || g0.crown !== g1.crown) badGem++;
    if(c.h.some(x => x < 0 || x > 3) || c.g.some((x, i) => x.length > c.h[i])) badCap++;
    if(snap(b) !== before || c === b || c.h === b.h) badMut++;
    if(J(c.h) === J(b.h)) same++;
    (byT[T] = byT[T] || { n: 0, same: 0 }).n++; if(J(c.h) === J(b.h)) byT[T].same++;
  }
  const refreshMs = (Date.now() - t0r) / n;
  unit('S', `S1 reshuffle ${n} 次（總枚數 40～75 各種、含寶物 0～5 顆、含最極端的 40 枚與 75 枚全 3）：總枚數完全相同、結果合法、寶物種類與數量不變、每格 ≤3 且寶物只放在有幣的格子、傳入的盤面沒被改`,
    badTot === 0 && badLegal === 0 && badGem === 0 && badCap === 0 && badMut === 0, `枚數不符 ${badTot}｜不合法 ${badLegal}｜寶物不符 ${badGem}｜越界 ${badCap}｜改到原盤面 ${badMut}｜與原盤面完全相同 ${same} 次（僅 75 枚全 3 盤面的唯一解）`);
  const mid = Object.keys(byT).filter(T => T > 41 && T < 74).reduce((a, T) => a + byT[T].same, 0);
  unit('S', 'S2 總枚數 42～73 時，刷新結果幾乎不會與原盤面相同（確實換了位置）', mid <= 5, `相同 ${mid} 次`);
  const ill = EV.emptyBoard(); ill.h[3] = 2; ill.h[4] = 1; const out = EV.reshuffle(ill, rr);
  unit('S', 'S3 傳入不合法盤面：原樣（複製）回傳，不增不減、不是同一個物件', J(out) === J(ill) && out !== ill && out.h !== ill.h);
  const a1 = EV.reshuffle(starts0(), EV.rng(9)), a2 = EV.reshuffle(starts0(), EV.rng(9)), a3 = EV.reshuffle(starts0(), EV.rng(10));
  unit('S', 'S4 相同亂數種子 → 相同結果（可重現）；不同種子 → 不同結果', J(a1) === J(a2) && J(a1) !== J(a3));
  /* floorBoard */
  let fOk = 0, fGem = 0; const seen = new Set(), f3 = [];
  for(let t = 0; t < 20000; t++){
    const f = EV.floorBoard(rr);
    if(EV.total(f) === 40 && EV.isLegal(f) && burnLegal(f.h) && f.h.every(x => x >= 0 && x <= 3)) fOk++;
    if(f.g.some(x => x.length)) fGem++;
    seen.add(f.h.join('')); f3.push(f.h.filter(x => x === 3).length);
  }
  unit('S', `S5 floorBoard 20000 次：恰好 40 枚、合法、每格 0～3、沒有寶物；每次不同（${seen.size} 種不同盤面）`, fOk === 20000 && fGem === 0 && seen.size > 15000, `合格 ${fOk}｜帶寶物 ${fGem}｜不同盤面 ${seen.size}`);
  /* 抽 tries 張取「現在點下去炸最多格」的那張：資訊（不影響長期拿回，見 X） */
  const info = {};
  for(const T of [43, 50, 60]) for(const tries of [1, EV.CFG.RESHUFFLE_TRIES, 24]){
    const b = randLegal(T, 0); let hit = 0, tp = 0; const M = 3000;
    for(let t = 0; t < M; t++){ const c = EV.chainBest(EV.reshuffle(b, rr, { tries })); if(c.topples >= PC) hit++; tp += c.topples; }
    info[`T${T}_tries${tries}`] = { hit8: hit / M, avgChain: tp / M };
  }
  console.log('     （資訊）刷新後「現在點下去能炸 ≥' + PC + ' 格」的機率（總枚數 43／50／60；抽 1／' + EV.CFG.RESHUFFLE_TRIES + '／24 張）：' +
    [43, 50, 60].map(T => `${T} 枚：` + [1, EV.CFG.RESHUFFLE_TRIES, 24].map(k => pct(info[`T${T}_tries${k}`].hit8, 0)).join('／')).join('｜') + `｜每次刷新約 ${(refreshMs * 1000).toFixed(0)} µs（含抽 ${EV.CFG.RESHUFFLE_TRIES} 張）`);
  V3.reshuffle = { checked: n, tries: EV.CFG.RESHUFFLE_TRIES, microsecondsEach: Math.round(refreshMs * 1000), hit8ByTotalAndTries: info, method: '隨機燃燒順序→最小穩定循環盤面（40 枚）＋隨機補滿到原總枚數，抽 tries 張取最會炸的；構造上必合法' };
  V3.floor = { checked: 20000, distinct: seen.size, avg3Cells: f3.reduce((a, x) => a + x, 0) / f3.length };
}
function starts0(){ const b = EV.startBoard(0); b.g[b.h.findIndex(x => x > 0)] = ['diamond']; return b; }

/* ============ 等執行緒的結果 ============ */
heavy.then((results) => {
  const L = {}, RP = {}, SS = {};
  tasks.forEach((t, i) => {
    if(t.type === 'long') L[t.name] = results[i];
    else if(t.type === 'replay') RP[t.name] = results[i];
    else if(t.type === 'refresh' || t.type === 'switch') { /* v3：另外分組（見 X／W／K） */ }
    else (SS[t.name] = SS[t.name] || []).push(results[i]);
  });
  const lim = Math.max(0.001, 3 * sigmaMean(N));

  /* ============ A 抽獎機率（取自長跑裡進場的東西；四種丟法同一串，看一份即可） ============ */
  console.log('\n=== A（續）抽獎機率 ===');
  {
    const s = L.random, binom = (p) => 3 * Math.sqrt(p * (1 - p) / N);
    const f = { diamond: s.inK.diamond / N, crown: s.inK.crown / N };
    unit('A', `A4 鑽石機率＝1/40`, Math.abs(f.diamond - EV.CFG.DIAMOND.P) <= binom(EV.CFG.DIAMOND.P), `實測 ${pct(f.diamond, 4)}（${s.inK.diamond} 顆）理論 ${pct(EV.CFG.DIAMOND.P, 4)}`);
    unit('A', `A5 皇冠機率＝1/800`, Math.abs(f.crown - EV.CFG.CROWN.P) <= binom(EV.CFG.CROWN.P), `實測 ${pct(f.crown, 4)}（${s.inK.crown} 顆）理論 ${pct(EV.CFG.CROWN.P, 4)}`);
  }

  /* ============ B 各丟法的實測拿回比例 ============ */
  console.log(`\n=== B 五種丟法各 ${N.toLocaleString()} 注（含獎池；σ＝${pp(sigmaMean(N), 4)}，判準 max(0.1pp, 3σ)＝${pp(lim, 3)}） ===`);
  const bound = {}, bound2 = {};
  for(const name of NAMES){
    const s = L[name], lab = `[${LABEL[name]}]`;
    bound[name] = Math.max(s.startVal, s.maxBv);                                     // 盤面殘留造成的上界（個面額）
    bound2[name] = bound[name] + s.pot.potEnd / s.pot.denom;                         // 再加期末獎池殘留（拿回含獎池的比較用）
    const dRolled = s.got - s.rolled;                                                // s.got＝只算噴出的東西
    unit('B', `B1 ${lab} 守恆逐項：進場（含金幣雨的免費幣）＋起始＝噴出＋盤面殘留`,
      s.inK.coin + s.startCoins === s.outK.coin + s.coinsOn && s.inK.diamond === s.outK.diamond + s.gemsOn.diamond && s.inK.crown === s.outK.crown + s.gemsOn.crown && s.trackedTotal === s.endTotal,
      `普通幣 ${s.inK.coin}＋${s.startCoins}＝${s.outK.coin}＋${s.coinsOn}｜鑽石 ${s.inK.diamond}＝${s.outK.diamond}＋${s.gemsOn.diamond}｜皇冠 ${s.inK.crown}＝${s.outK.crown}＋${s.gemsOn.crown}`);
    unit('B', `B2 ${lab} 面值恆等式：拿回＝進場總面值＋起始盤面面值−殘留面值`,
      Math.abs(s.got - (s.rolled + s.startVal - s.endVal)) < 0.01 && Math.abs(s.trackedEndVal - s.endVal) < 0.01,
      `拿回 ${s.got.toFixed(1)}｜進場 ${s.rolled.toFixed(1)}＋起始 ${s.startVal.toFixed(1)}−殘留 ${s.endVal.toFixed(1)}`);
    unit('B', `B3 ${lab} 噴出的拿回比例與「這串亂數實際進場東西的總面值÷投入」相差 ≤ 盤面殘留上界`,
      Math.abs(dRolled) <= bound[name] + 1e-6,
      `噴出拿回 ${pct(s.rtpExit, 4)}｜進場總面值 ${pct(s.rolledRtp, 4)}｜差 ${pp(s.rtpExit - s.rolledRtp, 4)}｜上界 ${pp(bound[name] / N, 4)}（盤面面值最高 ${s.maxBv.toFixed(1)}）`);
    unit('B', `B4 ${lab} 含獎池的拿回與理論 ${pct(EV.RTP, 3)} 的偏差 ≤ max(0.1pp, 3σ)`,
      Math.abs(s.rtp - EV.RTP) <= lim, `實測 ${pct(s.rtp, 3)}（噴出 ${pct(s.rtpExit, 3)}＋獎池 ${pct(s.rtp - s.rtpExit, 3)}）｜偏差 ${pp(s.rtp - EV.RTP, 3)}｜容許 ±${pp(lim, 3)}`);
    unit('B', `B5 ${lab} 極值上界：每一注拿回（含獎池）≤ 該注前盤面總面值＋該注進場面值＋該注入池後的獎池（${N.toLocaleString()} 注）`,
      s.boundViolations === 0, `違反 ${s.boundViolations} 次｜最緊的一注餘裕 ${s.worstSlack.toFixed(2)} 個面額｜實測單注最高 ${s.maxPay.toFixed(1)} 倍面額（含獎池）｜盤面平均 ${s.avgTot.toFixed(1)} 枚（${s.minTot}～${s.maxTot}）`);
    unit('B', `B6 ${lab} 盤面永遠不低於最低總數 ${EV.MIN_TOTAL}（每注結算後，含金幣雨之後）`, s.minTot >= EV.MIN_TOTAL, `最低 ${s.minTot} 枚｜最高 ${s.maxTot} 枚｜平均 ${s.avgTot.toFixed(1)} 枚`);
    unit('B', `B7 ${lab} 金幣雨每 ${RE} 注恰一次（第 ${RE}、${2 * RE}、… 注，不多不少）`,
      s.rainBad === 0 && s.rainCount === Math.floor(N / RE) && s.rainCoinsIn === s.rainCount * N25 && s.meterEnd === N % RE,
      `金幣雨 ${s.rainCount} 次（應 ${Math.floor(N / RE)}）｜時機不符 ${s.rainBad}｜免費幣 ${s.rainCoinsIn}｜結束時能量條 ${s.meterEnd}（應 ${N % RE}）`);
    /* ---- 連鎖獎池 ---- */
    const P = s.pot, cap = EV.potMax(DI0);
    unit('P', `P5 ${lab} 獎池守恆（實付整數）：Σ存入＝Σ拿走＋期末餘額；存入＝注數×每注存的；EV.potAfter 逐注與測試自己累加的整數影子相同（金額、餘額、拿走的原因）`,
      P.potIn === P.potWonCash + P.potEnd && P.potIn === N * P.add && P.potEnd === P.shadowEnd && P.potBad === 0,
      `存入 ${P.potIn}＝拿走 ${P.potWonCash}＋餘額 ${P.potEnd}｜逐注不符 ${P.potBad}`);
    unit('P', `P6 ${lab} 獎池有上界：入池後（拿走前）最多 RAIN_EVERY×每注存的 ＝ ${cap}（因為下雨一定拿走）；平常餘額最多 ${cap - P.add}`,
      P.maxBefore <= cap && P.maxRest <= cap - P.add, `入池後最大 ${P.maxBefore}（${(P.maxBefore / P.denom).toFixed(2)} 倍面額）｜餘額最大 ${P.maxRest}`);
    unit('P', `P7 ${lab} 拿獎池的時機只有兩種（自己那一枚連鎖炸到門檻、下雨）：每一次下雨都拿、其餘的拿都是自己連鎖；次數相加相符`,
      P.takes === P.by.chain + P.by.rain + P.by.both && s.rainCount === P.by.rain + P.by.both && P.takes >= s.rainCount,
      `拿了 ${P.takes} 次＝自己連鎖 ${P.by.chain}＋只有下雨 ${P.by.rain}＋兩者同注 ${P.by.both}｜金幣雨 ${s.rainCount} 次`);
  }

  console.log('\n=== C 五種丟法彼此 ===');
  {
    const a = L.random, same = NAMES.every(n => L[n].rolled === a.rolled && L[n].rainCount === a.rainCount && L[n].inK.coin === a.inK.coin && L[n].inK.diamond === a.inK.diamond && L[n].inK.crown === a.inK.crown);
    unit('C', 'C1 五種丟法吃到同一串「是不是寶物、什麼時候金幣雨」（進場總面值逐位相同）', same, `進場 ${pct(a.rolledRtp, 4)}｜金幣雨 ${a.rainCount} 次｜鑽石 ${a.inK.diamond}｜皇冠 ${a.inK.crown}`);
    const pairs = []; for(let i = 0; i < NAMES.length; i++) for(let j = i + 1; j < NAMES.length; j++) pairs.push([NAMES[i], NAMES[j]]);
    for(const [x, y] of pairs){
      const diff = Math.abs(L[x].rtp - L[y].rtp), ub = (bound2[x] + bound2[y]) / N;
      unit('C', `C2 ${LABEL[x]} vs ${LABEL[y]}：含獎池的拿回比例相差 ≤ 兩邊（盤面殘留＋期末獎池餘額）上界之和`, diff <= ub + 1e-9, `相差 ${pp(diff, 4)}｜上界 ${pp(ub, 4)}`);
    }
    const rs = NAMES.map(n => L[n].rtp), spread = Math.max(...rs) - Math.min(...rs);
    unit('C', 'C3 五種丟法（含獎池）長期拿回的最大差距 ≤ 0.1pp（賣點「不管怎麼丟長期一樣」）', spread <= 0.001, `最高 ${pct(Math.max(...rs), 4)}｜最低 ${pct(Math.min(...rs), 4)}｜差 ${pp(spread, 4)}｜` + NAMES.map(n => `${n} ${pct(L[n].rtp, 3)}`).join('、'));
  }

  console.log('\n=== E 演出自洽（照 play 回傳的分波結果重播；金幣雨＝第一波前 25 格各落一枚） ===');
  for(const name of NAMES){
    const r = RP[name], bad = r.boardBad + r.exitBad + r.cashBad + r.payBad + r.waveBad + r.rainShapeBad + r.potBad;
    unit('E', `E1 [${LABEL[name]}] ${r.plays.toLocaleString()} 注（含金幣雨 ${r.rains} 場、拿獎池 ${r.potTakes} 次）：重播盤面（逐格 h 與寶物清單）＝核心盤面；噴出枚數、金額（各面額實付）、波數／格數加總相符；獎池用重播出的炸開格數重判＝EV.potAfter`, bad === 0 && r.rains === Math.floor(r.plays / RE) && r.potTakes >= r.rains,
      `盤面不符 ${r.boardBad}｜噴出不符 ${r.exitBad}｜金額不符 ${r.cashBad}｜倍數不符 ${r.payBad}｜波內不符 ${r.waveBad}｜金幣雨形狀不符 ${r.rainShapeBad}｜獎池不符 ${r.potBad}｜單注（單段）最多 ${r.maxWaves} 波`);
  }

  /* ============ X 刷新套利：狂刷丟法 ============ */
  const G = {};
  tasks.forEach((t, i) => { if(t.type === 'refresh' || t.type === 'switch') (G[t.tag] = G[t.tag] || []).push(results[i]); });
  const RS = {};
  for(const k of Object.keys(G)) if(k[0] === 'S' || k[0] === 'K') RS[k] = lib.summarizeRefresh(G[k]);
  const rowOf = (r) => ({ n: r.n, rtp: r.rtp, rtpExit: r.rtpExit, refreshActionsPer100: r.refreshPer100, reshuffleCallsPer100: r.callsPer100, afterRefreshHas8: r.afterRefreshHas8,
    own8Share: r.own8Share, potTakeEvery: { p10: r.potTakeEvery.p10, p50: r.potTakeEvery.p50, p90: r.potTakeEvery.p90, avg: r.potTakeEvery.avg }, potAtTake: { p10: r.potAtTake.p10, p50: r.potAtTake.p50, p90: r.potAtTake.p90, avg: r.potAtTake.avg },
    return100: { p10: r.block100.p10, p50: r.block100.p50, p90: r.block100.p90, min: r.block100.min, max: r.block100.max }, minBoardCoins: r.minTot, maxBoardCoins: r.maxTot });
  console.log(`\n=== X 刷新套利：狂刷丟法各 ${N.toLocaleString()} 注（切 ${STRESS_CH} 段）；判準 |拿回−理論| ≤ max(0.1pp, 3σ)＝${pp(lim, 3)}，且與「同一串抽獎亂數、不刷」的差距 ≤ 兩邊盤面／獎池殘留上界 ===`);
  const stressOut = {};
  for(const bp of ['greedy', 'p8gold']){
    const b0 = RS['S:base-' + bp];
    unit('X', `X0 對照組 [不刷・${bp === 'greedy' ? '每次挑最會爆的格' : '有能炸 8 格就點、否則快滿就點'}] ${b0.n.toLocaleString()} 注：拿回與理論 ${pct(EV.RTP, 3)} 的偏差 ≤ 容許；盤面枚數 ≥40、全程合法`,
      Math.abs(b0.rtp - EV.RTP) <= lim && b0.minTot >= 40 && b0.legalBad === 0, `實測 ${pct(b0.rtp, 3)}｜偏差 ${pp(b0.rtp - EV.RTP, 3)}｜獎池中位 ${b0.potTakeEvery.p50} 注拿一次｜100 注拿回 10／50／90 分位 ${pct(b0.block100.p10, 1)}／${pct(b0.block100.p50, 1)}／${pct(b0.block100.p90, 1)}`);
    stressOut['none-' + bp] = rowOf(b0);
  }
  for(const s of STRESS){
    const r = RS['S:' + s.tag], b0 = RS['S:base-' + s.base], tolB = (r.residualBound + b0.residualBound) / r.n;
    unit('X', `X1 [狂刷：${s.label}] ${r.n.toLocaleString()} 注、刷新 ${r.reshuffleCalls.toLocaleString()} 次：每次刷新前後總枚數相同、寶物種類數量相同、刷新後合法；盤面全程合法、枚數 ≥40；守恆恆等式與獎池守恆成立`,
      r.bad === 0 && r.legalBad === 0 && r.minTot >= EV.MIN_TOTAL && r.totMismatch === 0 && r.potMismatch === 0 && r.valueIdentityErr < 1e-3 && r.n >= N && r.reshuffleCalls > 0,
      `刷新不符 ${r.bad}｜不合法 ${r.legalBad}｜盤面最低 ${r.minTot} 枚、最高 ${r.maxTot}｜恆等式誤差 ${r.valueIdentityErr.toExponential(1)}｜獎池不守恆 ${r.potMismatch} 段`);
    unit('X', `X2 [狂刷：${s.label}] 長期拿回 ${pct(r.rtp, 3)}：與理論 ${pct(EV.RTP, 3)} 偏差 ≤ ${pp(lim, 3)}；與不刷（${s.base}、同一串抽獎亂數）相差 ≤ 殘留上界 ${pp(tolB, 4)}`,
      Math.abs(r.rtp - EV.RTP) <= lim && Math.abs(r.rtp - b0.rtp) <= tolB + 1e-9,
      `偏差 ${pp(r.rtp - EV.RTP, 3)}｜相差 ${pp(r.rtp - b0.rtp, 4)}｜每 100 注刷 ${r.refreshPer100.toFixed(1)} 次（呼叫 ${r.callsPer100.toFixed(1)} 次）｜刷完立刻有 ≥${PC} 格可炸 ${r.afterRefreshHas8 === null ? '—' : pct(r.afterRefreshHas8, 1)}｜自己炸到 ≥${PC} 格的注 ${pct(r.own8Share, 2)}（不刷 ${pct(b0.own8Share, 2)}）｜獎池每 ${r.potTakeEvery.p50} 注拿一次（不刷 ${b0.potTakeEvery.p50}）、拿到中位 ${r.potAtTake.p50.toFixed(2)} 倍｜100 注拿回 10／50／90 分位 ${pct(r.block100.p10, 1)}／${pct(r.block100.p50, 1)}／${pct(r.block100.p90, 1)}（最高 ${pct(r.block100.max, 0)}）`);
    stressOut[s.tag] = Object.assign({ label: s.label, base: s.base, rtpMinusBase: r.rtp - b0.rtp, rtpMinusTheory: r.rtp - EV.RTP }, rowOf(r));
  }

  /* ============ W 單一盤面換金額套利（用「錢」算） ============ */
  console.log('\n=== W 單一盤面換金額：換金額＝盤面換 floorBoard（40 枚）、能量條 0、獎池 0、寶物消失；用錢（不是倍數）算總投入與總拿回 ===');
  const swOut = {};
  for(const p of SWITCHES){
    const s = lib.summarizeSwitch(G['W:' + p]), ratio = s.moneyOut / s.moneyIn, sigR = Math.sqrt(TH.variance * s.sumDen2) / s.moneyIn, tol = Math.max(0.001, 3 * sigR), fixed = p.startsWith('fixed');
    const ps = s.perSwitch;
    unit('W', `W1 [${p}] ${s.n.toLocaleString()} 注、換金額 ${s.switches.toLocaleString()} 次：每段「拿回＋段末盤面面值＝進場面值＋起始 40 枚」恆等、段末盤面 ≥40 枚且合法、換完的盤面恰 40 枚合法無寶物、獎池不超領`,
      s.pathBad === 0 && s.minTot >= 40 && s.legalBad === 0 && s.floorBad === 0, `恆等式不符 ${s.pathBad} 段｜盤面最低 ${s.minTot}｜不合法 ${s.legalBad}｜換盤不符 ${s.floorBad}`);
    unit('W', `W2 [${p}] 總投入 ${s.moneyIn.toLocaleString()} → 總拿回 ${s.moneyOut.toLocaleString()}：長期拿回 ${pct(ratio, 3)} ${fixed ? '與理論 ' + pct(EV.RTP, 3) + ' 偏差 ≤ ' + pp(tol, 3) : '≤ 理論 ' + pct(EV.RTP, 3) + '（換金額只會讓玩家損失）'}`,
      fixed ? Math.abs(ratio - EV.RTP) <= tol : ratio <= EV.RTP + tol,
      `${fixed ? '偏差' : '比理論少'} ${pp(fixed ? ratio - EV.RTP : EV.RTP - ratio, 3)}（容許 ${pp(tol, 3)}）` + (ps ? `｜每次換金額平均損失 ${ps.measuredDenoms.toFixed(2)} 個面額（約 ${Math.round(ps.money)} 元）＝獎池 ${ps.potDenoms.toFixed(2)}＋盤面多出的幣 ${ps.boardExcessDenoms.toFixed(2)}＋能量條進度 ${ps.meterDenoms.toFixed(2)}（拆項合計 ${ps.estTotalDenoms.toFixed(2)}）` : ''));
    if(ps){
      const dif = Math.abs(ps.measuredDenoms - ps.estTotalDenoms) * s.switches, noise = 4 * Math.sqrt(TH.variance * s.n);
      unit('W', `W3 [${p}] 損失可以逐項解釋：實測損失（理論拿回−實際拿回，個面額）≈ 獎池＋盤面多出的幣＋能量條進度，差 ≤ 4σ`, dif <= noise, `差 ${dif.toFixed(1)} 個面額（4σ＝${noise.toFixed(1)}）`);
    }
    swOut[p] = { n: s.n, switches: s.switches, moneyIn: s.moneyIn, moneyOut: s.moneyOut, ratio, theory: EV.RTP, shortfallPP: (EV.RTP - ratio) * 100, sigmaPP: sigR * 100, perSwitch: ps };
  }

  /* ============ K 刷新冷卻比較表（寫進 stats.json，供主對話決定冷卻幾注） ============ */
  const ktOut = {};
  if(WRITE_STATS){
    console.log(`\n=== K 刷新冷卻比較（每格 ${(KN * KCH).toLocaleString()} 注；(1)＝能刷就刷、有能炸 ${PC} 格就點否則快滿就點；(2)＝只有沒有任何能炸 ${PC} 格的格子才刷、其餘同(1)；K＝兩次刷新之間至少隔幾注，0＝不限（可同一注連刷到滿意，最多 6 次）） ===`);
    const bP = RS['K:base-p8gold'];
    const fmt = (r) => `拿回 ${pct(r.rtp, 2)}｜獎池每 ${r.potTakeEvery.p50} 注拿一次（均 ${r.potTakeEvery.avg.toFixed(1)}）｜拿到中位 ${r.potAtTake.p50.toFixed(2)} 倍｜自己炸≥${PC}格 ${pct(r.own8Share, 1)}｜每100注刷 ${r.refreshPer100.toFixed(1)} 次｜100注拿回 ${pct(r.block100.p10, 0)}／${pct(r.block100.p50, 0)}／${pct(r.block100.p90, 0)}｜刷後立刻有≥${PC}格 ${r.afterRefreshHas8 === null ? '—' : pct(r.afterRefreshHas8, 0)}`;
    for(const P of ['A', 'B', 'C']){
      for(const K of KS){
        const r = RS[`K:${P}:${K}`], tolB = (r.residualBound + bP.residualBound) / r.n, limK = Math.max(0.001, 3 * sigmaMean(r.n));
        unit('K', `K${P}${K} [(${P === 'A' ? '1' : P === 'B' ? '2' : '4 刷＋養'}) 冷卻 K=${K === 0 ? '不限' : K}] 長期拿回與理論、與不刷（同一串抽獎亂數）一致；盤面全程合法、枚數 ≥40、刷新逐次守恆`,
          Math.abs(r.rtp - EV.RTP) <= limK && Math.abs(r.rtp - bP.rtp) <= tolB + 1e-9 && r.bad === 0 && r.legalBad === 0 && r.minTot >= 40, fmt(r));
        ktOut[`${P}_K${K}`] = rowOf(r);
      }
    }
    for(const [k, lab] of [['builder', '(3) 不刷・養到 8 格才引爆'], ['gold', '(3) 不刷・有快滿就點'], ['p8gold', '(3) 不刷・有能炸 8 格就點、否則快滿就點']]){
      const r = RS['K:base-' + k];
      unit('K', `K-對照 [${lab}] 長期拿回與理論一致、盤面全程合法`, Math.abs(r.rtp - EV.RTP) <= Math.max(0.001, 3 * sigmaMean(r.n)) && r.legalBad === 0 && r.minTot >= 40, fmt(r));
      ktOut['none_' + k] = rowOf(r);
    }
  }
  const v3Stats = { legal: V3.legal, reshuffle: V3.reshuffle, floorBoard: V3.floor, refreshStress: stressOut, switchArbitrage: swOut, cooldownTable: { note: `K＝兩次刷新之間至少隔幾注（0＝不限）。A＝(1) 能刷就刷、有能炸 ${PC} 格就點否則快滿就點；B＝(2) 只有沒有任何能炸 ${PC} 格的格子才刷、其餘同 A；C＝(4) 養盤＋刷：沒有能炸 ${PC} 格的格子才刷、丟法是「養到 ${PC} 格才引爆、否則丟 2 枚格」；none_＝(3) 不刷的對照。afterRefreshHas8＝刷新後立刻有能炸 ${PC} 格以上的格子的機率；return100＝連續 100 注拿回（含獎池）的分位。每格 ${KN * KCH} 注`, ks: KS, cells: ktOut } };

  /* ============ 金幣雨拿回的分布 ============ */
  const rainDist = {};
  for(const name of NAMES) rainDist[name] = L[name].rainStats;
  console.log('\n=== 金幣雨拿回（倍面額，僅金幣雨那一段，不含獎池） ===');
  for(const name of NAMES){ const d = rainDist[name]; console.log(`${LABEL[name]}：${d.count} 場｜一成 ${d.p10.toFixed(1)}｜中位 ${d.p50.toFixed(1)}｜九成 ${d.p90.toFixed(1)}｜最高 ${d.max.toFixed(1)}｜平均 ${d.avg.toFixed(2)}`); }
  console.log(`     （資訊）25 枚免費幣的面值＝${(N25 * EV.VALUE.coin).toFixed(1)} 倍面額。每場雨拿回因丟法而異（養盤的人把幣留給雨、雨拿得多，雨前那幾注就拿得少），長期總拿回不變（見 C3）`);

  console.log(`\n${nFail === 0 ? 'ALL PASS' : 'HAS FAIL'}：PASS ${nPass}／FAIL ${nFail}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  if(WRITE_STATS){
    const st = buildStats(L, SS, rainDist, v3Stats);
    fs.writeFileSync(path.join(__dirname, 'stats.json'), JSON.stringify(st, null, 2));
    console.log(`stats.json 已輸出（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    printStats(st);
  }
  process.exit(nFail === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(2); });

/* ============ stats.json ============ */
function quant(a, p){ return a[Math.min(a.length - 1, Math.floor(a.length * p))]; }
function buildStats(L, SS, rainDist, v3){
  const M = EV, gem = (M.RTP_PARTS.diamond + M.RTP_PARTS.crown) / M.RTP;
  const st = {
    generatedAt: new Date().toISOString(),
    note: `v3（單一盤面＋刷新＋換金額）：能量條集滿 ${RE} 注→全盤金幣雨、普通幣 ${M.VALUE.coin}、連鎖獎池（每注存 ${M.POT_ADD} 個面額，自己連鎖炸到 ${PC} 格以上或下雨就整個拿走）。longRun` + '＝從預設面額起始盤面連丟 drops 注（能量條與獎池從 0）；sessions＝每場新玩家從預設面額起始盤面、能量條與獎池 0 連丟 500 注、回報第 50／100／200／500 注時的拿回比例（拿回÷投入，含獎池）；gotPot＝到那時拿過獎池（任何金額；新盤面第一注就會炸到門檻、只拿到那一注存的 0.15）的場次比例，gotPot1x＝拿過 ≥1 倍面額獎池的比例。' +
          '所有「拿回」「≥N 倍」都含獎池。NoRain 欄位＝不含金幣雨那一注（那一注一次拿十幾倍，會墊高大獎比例）；rain＝只算金幣雨那一段的拿回（倍面額，不含獎池）。' +
          'smart＝能量條快滿的最後 ' + (lib.SMART_LEFT + 1) + ' 注（left≤' + lib.SMART_LEFT + '）改丟 2 枚格、養盤等雨；builder＝能炸到 ' + PC + ' 格才引爆、否則丟 2 枚的格子。' +
          'pot＝拿獎池的統計（takeEvery＝每隔幾注拿一次，中位／九成；potAtTake＝拿走的獎池金額（倍面額）；takeTotal＝拿獎池那一注的總拿回（倍面額，含噴出的）；shareByChain＝靠自己連鎖拿（含同注下雨）的比例）。' +
          'byChain＝「這一注自己那一枚炸幾格→拿回」，不含金幣雨那一注（share＝佔不含雨的注數比例，p50／p90／avg 為含獎池的拿回，倍面額）。',
    drops: N, seed: SEED, defaultDenom: EV.CFG.DENOMS[EV.CFG.DENOM_DEFAULT],
    config: { coinPay: M.VALUE.coin, diamondPay: M.VALUE.diamond, crownPay: M.VALUE.crown, diamondP: M.CFG.DIAMOND.P, crownP: M.CFG.CROWN.P, rainEvery: RE, rainCells: N25,
              potAdd: M.POT_ADD, potChain: M.POT_CHAIN, potMax: M.PAY.map((p, d) => M.potMax(d)), pay: M.PAY },
    theory: { rtp: M.RTP, parts: M.RTP_PARTS, shareOfRtp: { coin: M.RTP_PARTS.coin / M.RTP, rain: M.RTP_PARTS.rain / M.RTP, diamond: M.RTP_PARTS.diamond / M.RTP, crown: M.RTP_PARTS.crown / M.RTP, gems: gem, pot: M.RTP_PARTS.pot / M.RTP } },
    longRun: {}, sessions: {}, v3: v3
  };
  for(const name of NAMES){
    const s = L[name], P = s.pot, own = P.by.chain + P.by.both;
    st.longRun[name] = {
      n: s.n, rtp: s.rtp, rtpExit: s.rtpExit, rtpPot: s.rtp - s.rtpExit, rolledRtp: s.rolledRtp,
      anyExit: s.anyExit, anyExitNoRain: s.anyExitNR, anyPayout: s.anyPay, chain: s.hit, only1Exit: s.exits1,
      backOrMore: s.back, ge4x: s.big, ge10x: s.huge,
      backOrMoreNoRain: s.backNR, ge4xNoRain: s.bigNR, ge10xNoRain: s.hugeNR,
      maxPay: s.maxPay, maxPayNoRain: s.maxPayNR,
      avgBoardCoins: s.avgTot, minBoardCoins: s.minTot, maxBoardCoins: s.maxTot,
      cellHeights: { note: '玩家每次下注前，25 格中疊 0／1／2／3 枚的比例', h0: s.heights[0], h1: s.heights[1], h2: s.heights[2], h3: s.heights[3] },
      rain: rainDist[name],
      pot: {
        takes: P.takes, takeEvery: { p10: P.gaps.p10, p50: P.gaps.p50, p90: P.gaps.p90, max: P.gaps.max, avg: P.gaps.avg },
        potAtTake: { p10: P.potAmounts.p10, p50: P.potAmounts.p50, p90: P.potAmounts.p90, max: P.potAmounts.max, avg: P.potAmounts.avg },
        takeTotal: { p10: P.takeTotals.p10, p50: P.takeTotals.p50, p90: P.takeTotals.p90, max: P.takeTotals.max, avg: P.takeTotals.avg },
        shareByChain: own / P.takes, shareRainOnly: P.by.rain / P.takes, takesByChainOnly: P.by.chain, takesRainOnly: P.by.rain, takesBoth: P.by.both,
        maxPotCash: P.maxBefore, maxPotMult: P.maxBefore / P.denom, potMaxCash: M.potMax(EV.CFG.DENOM_DEFAULT)
      },
      byChain: s.buckets
    };
  }
  for(const name of SESS_NAMES){
    const chunks = SS[name] || [];
    if(!chunks.length) continue;
    st.sessions[name] = { sessions: chunks.reduce((a, c) => a + c.count, 0) };
    lib.MARKS.forEach((mk2, mi) => {
      const all = [].concat(...chunks.map(c => Array.from(c.main[mi]))).sort((x, y) => x - y);
      const sum = (key) => chunks.reduce((a, c) => a + c[key][mi].reduce((s, x) => s + x, 0), 0) / st.sessions[name].sessions;
      st.sessions[name][mk2] = { p10: quant(all, 0.1), p50: quant(all, 0.5), p90: quant(all, 0.9), profitRate: all.filter(x => x > 1).length / all.length, sawRain: sum('rainSeen'), gotPot: sum('potSeen'), gotPot1x: sum('potBigSeen') };
    });
  }
  return st;
}
function printStats(st){
  const row = (label, x) => `${label}｜10% ${pct(x.p10, 1)}｜中位 ${pct(x.p50, 1)}｜90% ${pct(x.p90, 1)}｜賺錢場次 ${pct(x.profitRate, 1)}｜已下過雨 ${pct(x.sawRain, 0)}｜已拿過獎池 ${pct(x.gotPot, 0)}（≥1 倍面額的 ${pct(x.gotPot1x, 0)}）`;
  console.log(`\n== v3：普通幣 ${st.config.coinPay}、鑽石 ${st.config.diamondPay}、皇冠 ${st.config.crownPay}、能量條 ${st.config.rainEvery}、獎池每注 ${st.config.potAdd}（炸 ${st.config.potChain} 格拿）、理論 RTP ${pct(st.theory.rtp, 2)}（金幣雨佔 ${pct(st.theory.shareOfRtp.rain, 1)}、寶物佔 ${pct(st.theory.shareOfRtp.gems, 1)}、獎池佔 ${pct(st.theory.shareOfRtp.pot, 1)}）==`);
  for(const name of NAMES){
    const l = st.longRun[name], h = l.cellHeights, p = l.pot;
    console.log(`${LABEL[name]}：實測 ${pct(l.rtp, 3)}（噴出 ${pct(l.rtpExit, 3)}＋獎池 ${pct(l.rtpPot, 3)}）｜有噴出 ${pct(l.anyExit, 1)}（不含雨 ${pct(l.anyExitNoRain, 1)}）｜≥1倍 ${pct(l.backOrMore, 1)}｜≥4倍 ${pct(l.ge4x, 2)}｜≥10倍 ${pct(l.ge10x, 2)}（不含雨 ${pct(l.ge10xNoRain, 2)}）｜單注最高 ${l.maxPay.toFixed(1)} 倍（不含雨 ${l.maxPayNoRain.toFixed(1)}）｜盤面平均 ${l.avgBoardCoins.toFixed(1)} 枚（最低 ${l.minBoardCoins}）｜格高 0/1/2/3：${[h.h0, h.h1, h.h2, h.h3].map(x => pct(x, 1)).join(' ')}`);
    console.log(`    獎池：每 ${p.takeEvery.p50} 注拿一次（九成 ${p.takeEvery.p90} 注內）｜共 ${p.takes} 次，靠自己連鎖 ${pct(p.shareByChain, 0)}｜拿走的獎池 中位 ${p.potAtTake.p50.toFixed(1)} 九成 ${p.potAtTake.p90.toFixed(1)} 倍面額（最高 ${p.maxPotMult.toFixed(2)}／上限 ${(p.potMaxCash / EV.CFG.DENOMS[EV.CFG.DENOM_DEFAULT]).toFixed(2)}）｜拿獎池那一注總拿回 中位 ${p.takeTotal.p50.toFixed(1)} 九成 ${p.takeTotal.p90.toFixed(1)} 倍面額`);
    console.log('    炸幾格→拿回（不含雨）：' + l.byChain.map(k => `${k.label} 佔 ${pct(k.share, 1)} 中位 ${k.p50.toFixed(2)} 倍`).join('｜'));
    if(st.sessions[name]) for(const m of lib.MARKS) console.log('    ' + row(`丟 ${m} 注`, st.sessions[name][m]));
  }
}
