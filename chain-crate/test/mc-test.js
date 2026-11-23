/* =========================================================================
 * 連鎖開箱——Node 無頭蒙地卡羅自測（對 values.js／core.js 端到端複驗）
 * 執行：node test/mc-test.js [N]（預設每檔每注額 200000 局；驗收用 1000000）
 * 項目：A 三檔 RTP 對目標（實際核心 bet→ack，含取整與上限；注額 100 與 1000 各一次）
 *       B 極值上界（單局 ≤ 500 倍、連鎖 ≤ 30；極端盤面）
 *       C 演出自洽（重放 moves／spawns＝結尾盤面、各步賠付加總＝總賠、結尾無可爆的片…）
 *       D 防套利（單一注別：窮舉不適用；三檔 RTP 彼此差距）
 *       E 核心契約與存檔單元檢查
 * 判定：|偏差| ≤ max(0.1pp, 3σ)；FAIL 時 exit code 1。
 * 用 worker_threads 平行跑 A／B（_worker.js）；values.js／core.js 以 new Function 載入（同瀏覽器那兩支）。
 * ========================================================================= */
const { loadGame, runJobs, mergeSim, shardJobs, VALUES_PATH, PAY_RE } = require('./_lib');
const fs = require('fs');
const { EV, DemoCore } = loadGame();

const N = Math.floor(+(process.argv[2]) || 200000);
const SHARDS = 16;
let nPass = 0, nFail = 0;
const t0 = Date.now();

/* 判定：|偏差| ≤ max(0.1pp, 3σ)；name 與理論／實測／容許一併印出 */
function report(tag, name, theory, mean, se, sigma) {
  sigma = sigma || 3;
  const tol = Math.max(0.001, sigma * se);
  const ok = Math.abs(mean - theory) <= tol;
  ok ? nPass++ : nFail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${name}  理論 ${theory.toFixed(5)}  實測 ${mean.toFixed(5)}  容許 ±${tol.toFixed(5)}(${sigma}σ或0.1pp)`);
}
function unit(name, cond, detail) {
  cond ? nPass++ : nFail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${name[0]}] ${name}${detail ? '  ' + detail : ''}`);
}
function fakeStore() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m };
}
function mkGame(o) {
  let last = null;
  const g = DemoCore.createGame(Object.assign({ storage: false, wallet: Number.MAX_SAFE_INTEGER / 4 }, o || {}));
  g.on((t, d) => { if (t === 'settled') last = d; });
  return { g, last: () => last };
}
const IDS = EV.ids();
const CFG = EV.CFG;
const pct = v => (v * 100).toFixed(3) + '%';

/* ---------- 獨立的找片（不用核心的 findGroups，避免自己驗自己） ---------- */
function groupsOf(b, min) {
  const C = CFG.COLS, R = CFG.ROWS, seen = new Set(), out = [];
  for (let s = 0; s < C * R; s++) {
    if (seen.has(s)) continue;
    const k = b[s] & 7, comp = [], q = [s]; seen.add(s);
    while (q.length) {
      const x = q.pop(); comp.push(x);
      const r = Math.floor(x / C), c = x % C;
      const nb = [];
      if (r > 0) nb.push(x - C); if (r < R - 1) nb.push(x + C); if (c > 0) nb.push(x - 1); if (c < C - 1) nb.push(x + 1);
      for (const y of nb) if (!seen.has(y) && (b[y] & 7) === k) { seen.add(y); q.push(y); }
    }
    if (comp.length >= min) out.push(comp.sort((a, b) => a - b));
  }
  return out;
}
const key = cells => cells.slice().sort((a, b) => a - b).join(',');

(async () => {

/* ============ A 三檔 RTP ============ */
console.log(`\n=== A 三檔 RTP＝${pct(CFG.RTP)}（實際核心 bet→ack，含取整與單局上限；每檔每注額 ${N.toLocaleString('en-US')} 局） ===`);
const A = {};                 // A[tierId][bet] = merged
const BETS = [100, 1000];
for (let t = 0; t < IDS.length; t++) {
  A[IDS[t]] = {};
  for (let bi = 0; bi < BETS.length; bi++) {
    const bet = BETS[bi];
    const rs = await runJobs(shardJobs({ kind: 'core', tier: t, bet, seed: 20261119 + bi * 1000003 }, N, SHARDS));
    const o = mergeSim(rs);
    A[IDS[t]][bet] = o;
    report('A', `檔 ${IDS[t]}（${EV.TIERS[t].kinds} 色）注額 ${bet}（n=${o.n.toLocaleString('en-US')}）`, CFG.RTP, o.mean, o.se);
  }
}
// 同一批樣本的零雜訊對帳：沒撞上限的每一局，核心實付 ＝ Σ(該局各片加權次數 × 賠率表)，只差金額取整（≤ 0.5 元）
console.log('');
for (const id of IDS) for (const bet of BETS) {
  const o = A[id][bet];
  unit(`A2 檔 ${id} 注額 ${bet}：沒撞上限的每一局，實付與「該局 Σ w×賠率表」相差 ≤ 0.5 元（最大差 ${(o.maxRoundDiff * bet).toFixed(3)} 元）`,
    o.maxRoundDiff * bet <= 0.5 + 1e-6);
}
// 取整與上限對 RTP 的影響（只提示、不算 FAIL：Demo 重玩法，正式版由後台結算；用戶 2026-11-13）
for (const id of IDS) for (const bet of BETS) {
  const o = A[id][bet], pay = EV.TIERS[IDS.indexOf(id)].pay;
  const lin = o.Wavg.reduce((a, w, i) => a + w * pay[i], 0), capPart = -o.capLoss / o.n, rndPart = o.mean - lin - capPart;
  console.log(`INFO [A] A3 檔 ${id} 注額 ${bet}：實付 ${pct(o.mean)}＝同樣本線性值 ${pct(lin)} ${((o.mean - lin) * 100).toFixed(4)}pp（上限 ${(capPart * 100).toFixed(4)}pp＋取整 ${(rndPart * 100).toFixed(4)}pp）`);
}

/* ============ B 極值上界 ============ */
console.log('\n=== B 極值上界 ===');
{
  let maxX = 0, maxC = 0, over = 0, capN = 0, ccap = 0, nn = 0;
  for (const id of IDS) for (const bet of BETS) {
    const o = A[id][bet];
    maxX = Math.max(maxX, o.maxX); maxC = Math.max(maxC, o.maxChains); over += o.overCap; capN += o.cap; ccap += o.chainCapped; nn += o.n;
  }
  unit(`B1 抽樣 ${nn.toLocaleString('en-US')} 局：任何一局總賠 ≤ ${CFG.MAX_WIN_X} 倍（實測最高 ${maxX.toFixed(2)} 倍，打到上限 ${capN} 局，超過 ${over} 局）`, over === 0 && maxX <= CFG.MAX_WIN_X + 1e-9);
  unit(`B2 抽樣：連鎖 ≤ ${CFG.MAX_CHAIN}（實測最多 ${maxC} 次，連鎖滿 ${CFG.MAX_CHAIN} 次 ${ccap} 局）`, maxC <= CFG.MAX_CHAIN);
  // 極端盤面：rng 恆 0＝整盤同色且全是金箱；rng 恆 0.999999＝整盤同色無金箱（掉下來永遠再連）
  for (const [name, f] of [['全金箱同色', () => 0], ['整盤同色無金箱', () => 0.999999]]) {
    let ok = true, info = [];
    for (let t = 0; t < IDS.length; t++) for (const bet of [100, 1000]) {
      const r = DemoCore.rollRound(t, bet, f, false);
      const sumStep = r.steps.reduce((a, s) => a + s.pay, 0);
      if (!(r.total <= CFG.MAX_WIN_X * bet && r.chains === CFG.MAX_CHAIN && r.chainCapped && sumStep === r.total)) ok = false;
      info.push(`${IDS[t]}@${bet}=${r.totalX.toFixed(1)}x`);
    }
    unit(`B3 極端盤面（${name}）：連鎖停在 ${CFG.MAX_CHAIN} 次、總賠 ≤ ${CFG.MAX_WIN_X} 倍、各步加總＝總賠`, ok, info.join(' '));
  }
  const rcap = DemoCore.rollRound(2, 1000, () => 0, false);
  unit('B4 全金箱盤面撞上限：總賠＝500 倍、capped 旗標為真、上限後各步賠付為 0',
    rcap.total === 500 * 1000 && rcap.capped && rcap.steps.slice(1).every(s => s.pay === 0 || rcap.steps[0].pay < rcap.total), `首步 ${rcap.steps[0].pay}`);
}

/* ============ C 演出自洽 ============ */
console.log('\n=== C 演出自洽（抽樣重放） ===');
{
  const CN = Math.min(N, 30000), bad = [];
  let rounds = 0, stepsChecked = 0, withChain = 0, maxStepSeen = 0;
  for (let t = 0; t < IDS.length; t++) {
    const T = EV.TIERS[t], rnd = DemoCore.makeRng(777 + t);
    for (let i = 0; i < CN; i++) {
      const bet = i % 2 ? 1000 : 100;
      const r = DemoCore.rollRound(t, bet, rnd, false);
      rounds++;
      const fail = m => { if (bad.length < 8) bad.push(`${IDS[t]}#${i}：${m}`); };
      let b = r.init.slice(), cumRaw = 0, cumInt = 0, sumPay = 0;
      if (r.chains > 0) withChain++;
      if (r.chains !== r.steps.length) fail('chains≠steps.length');
      maxStepSeen = Math.max(maxStepSeen, r.chains);
      for (const s of r.steps) {
        stepsChecked++;
        // 該步可爆的片＝獨立找片的結果
        const exp = groupsOf(b, CFG.MIN_GROUP).map(c => c.join(',')).sort();
        const got = s.clusters.map(c => key(c.cells)).sort();
        if (exp.join('|') !== got.join('|')) fail(`第 ${s.chain} 步的片與獨立找片不一致`);
        const lm = T.ladder[Math.min(s.chain, T.ladder.length - 1)];
        if (s.mult !== lm) fail('連鎖倍率不是階梯值');
        let stepRaw = 0, cp = 0;
        for (const c of s.clusters) {
          let golds = 0;
          for (const x of c.cells) { if ((b[x] & 7) !== c.kind) fail('片內顏色不一致'); if (b[x] & 8) golds++; }
          if (c.size !== c.cells.length || c.golds !== golds) fail('size／golds 不符');
          if (c.mult !== lm * Math.pow(CFG.GOLD_MULT, golds)) fail('片倍率≠連鎖倍率×金箱倍率');
          stepRaw += T.pay[Math.min(c.size, CFG.MAX_SIZE) - CFG.MIN_GROUP] * c.mult;
          cp += c.pay;
        }
        if (cp !== s.pay) fail(`第 ${s.chain} 步各片賠付加總≠步賠付`);
        cumRaw = Math.min(cumRaw + stepRaw, CFG.MAX_WIN_X);
        cumInt = Math.round(bet * cumRaw);                       // 獨立重算累進取整與上限
        sumPay += s.pay;
        if (s.cum !== cumInt || sumPay !== cumInt) fail(`第 ${s.chain} 步累計賠付與獨立重算不符`);
        // 重放：爆開→掉落→補箱
        const nb = b.slice();
        for (const c of s.clusters) for (const x of c.cells) nb[x] = -1;
        for (const [from, to] of s.moves) { if (nb[from] < 0 || nb[to] !== -1) fail('moves 目的格非空或來源為空'); nb[to] = nb[from]; nb[from] = -1; }
        for (const sp of s.spawns) {
          if (nb[sp.to] !== -1) fail('spawn 目的格非空');
          if (!(sp.fromRow < 0) || (sp.v & 7) >= T.kinds) fail('spawn 欄位不合法');
          nb[sp.to] = sp.v;
        }
        if (nb.some(v => v < 0)) fail('重放後仍有空格');
        b = nb;
      }
      if (b.join() !== r.final.join()) fail('重放結尾盤面≠核心 final');
      if (sumPay !== r.total) fail('各步賠付加總≠總賠');
      if (r.total !== cumInt && r.chains > 0) fail('總賠≠最後累計');
      if (r.chains === 0 && r.total !== 0) fail('沒連鎖但有賠付');
      if (r.chains < CFG.MAX_CHAIN && groupsOf(r.final, CFG.MIN_GROUP).length) fail('結尾盤面還有可爆的片');
      const nearExp = groupsOf(r.final, CFG.MIN_GROUP - 1).filter(c => c.length === CFG.MIN_GROUP - 1).map(c => c.join(',')).sort();
      if (nearExp.join('|') !== r.near.map(n => key(n.cells)).sort().join('|')) fail('near 與獨立找片不一致');
      const nm = T.ladder[Math.min(r.chains, T.ladder.length - 1)];
      if (r.near.some(n => n.nextMult !== nm || n.size !== 3)) fail('near.nextMult 不是下一格階梯值');
      if (!Number.isInteger(r.total) || r.total < 0 || r.total > CFG.MAX_WIN_X * bet) fail('總賠非整數或超出範圍');
      if (r.init.length !== CFG.COLS * CFG.ROWS) fail('盤面長度不對');
    }
  }
  unit(`C1 抽樣 ${rounds.toLocaleString('en-US')} 局（${withChain} 局有連鎖、共 ${stepsChecked} 步，最長 ${maxStepSeen} 連）：` +
    '重放 moves／spawns＝結尾盤面；各片加總＝步賠付、各步加總＝總賠；每步的片＝獨立找片；賠付＝獨立重算（累進取整＋上限）；結尾無可爆片；near 正確', bad.length === 0, bad.join('；'));
}

/* ============ D 防套利 ============ */
console.log('\n=== D 防套利（本作一局只有一個注別：任意押注組合窮舉「不適用」；改驗三檔彼此一致與 EV < 1） ===');
{
  const means = IDS.map(id => A[id][1000]), ses = IDS.map(id => A[id][1000].se);
  let worst = null;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const diff = Math.abs(means[i].mean - means[j].mean), sig = Math.sqrt(ses[i] ** 2 + ses[j] ** 2), tol = Math.max(0.001, 3 * sig);
    if (!worst || diff / tol > worst.r) worst = { r: diff / tol, a: IDS[i], b: IDS[j], diff, tol };
  }
  unit(`D1 三檔實測 RTP 彼此差距 ≤ max(0.1pp, 3σ)（最大差 ${worst.a}↔${worst.b} ${(worst.diff * 100).toFixed(3)}pp，容許 ±${(worst.tol * 100).toFixed(3)}pp）`, worst.r <= 1);
  const th = IDS.map(id => EV.theoryRtp(id));
  const spread = Math.max(...th) - Math.min(...th);
  unit(`D2 校表理論 RTP（Σ W×賠率）三檔彼此差距 ≤ 0.1pp（${th.map(v => pct(v)).join('／')}，差 ${(spread * 100).toFixed(4)}pp）`, spread <= 0.001);
  unit('D3 任一檔期望回報 < 1（無正期望）：RTP 理論值皆 ≤ RTP_MAX 且 < 100%', th.every(v => v <= CFG.RTP_MAX + 1e-9 && v < 1));
}

/* ============ E 單元 ============ */
console.log('\n=== E 單元 ===');
{
  // E1 鐵表對照
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  unit('E1 CFG＝鐵表（6×7、片≥4、5/6/7 色、倍率階梯、金箱 4%×2、連鎖 30、上限 500、RTP 96.5%、演出門檻 5/20、注額 100/500/1000、錢包 10000）',
    CFG.COLS === 6 && CFG.ROWS === 7 && CFG.MIN_GROUP === 4 && CFG.GOLD_P === 0.04 && CFG.GOLD_MULT === 2 &&
    CFG.MAX_CHAIN === 30 && CFG.MAX_WIN_X === 500 && CFG.RTP === 0.965 && CFG.RTP_MIN === 0.96 && CFG.RTP_MAX === 0.97 &&
    CFG.BIG_X === 5 && CFG.JACKPOT_X === 20 && eq(CFG.STAKES, [100, 500, 1000]) && CFG.DEFAULT_STAKE === 100 && CFG.WALLET === 10000 &&
    eq(CFG.TIERS.map(t => t.id), ['stable', 'mid', 'wild']) && eq(CFG.TIERS.map(t => t.kinds), [5, 6, 7]) &&
    eq(CFG.TIERS.map(t => t.ladder), [[1, 1.5, 2, 2.5, 3, 4], [1, 2, 3, 5, 10, 25], [1, 2, 4, 8, 20, 60]]) &&
    eq(CFG.TIERS.map(t => t.shape), [[1, 1.2, 1.5, 2, 2.5, 3, 4], [1, 1.5, 2.5, 4, 7, 12, 20], [1, 1.6, 3, 6, 12, 25, 50]]));
  const G = EV.TUNED.generated;
  unit(`E2 賠率表區塊有產生紀錄且非占位（${G ? G.cmd + '，n=' + G.n.toLocaleString('en-US') + '，seed ' + G.seed + '，' + G.date : '無'}）`,
    !EV.TUNED.untuned && G && G.n >= 1e7 && G.cmd && G.date);
  unit('E3 載入自檢：由 W×賠率算出的 RTP 三檔皆在目標 ±0.1pp 內、賠率不遞減', IDS.every(id => {
    const p = EV.TIERS[IDS.indexOf(id)].pay;
    return Math.abs(EV.theoryRtp(id) - CFG.RTP) <= 0.001 + 1e-9 && p.every((v, i) => i === 0 || v >= p[i - 1]);
  }));
  {
    const src = fs.readFileSync(VALUES_PATH, 'utf8');
    const t = JSON.parse(JSON.stringify({ untuned: false, generated: EV.TUNED.generated, W: EV.TUNED.W, pay: EV.TUNED.pay }));
    t.pay.mid[3] *= 1.05;                                              // 把賠率表動一下手腳
    let msg = '';
    try { loadGame({ valuesSrc: src.replace(PAY_RE, () => 'var TUNED = ' + JSON.stringify(t) + ';') }); } catch (e) { msg = String(e.message); }
    unit('E4 賠率表被改動（RTP 偏離 0.1pp 以上）時載入自檢會 throw', /偏離目標/.test(msg), msg.slice(0, 60));
  }
  {
    const { g, last } = mkGame({ wallet: 100000, rng: DemoCore.makeRng(5) });
    const ev = []; g.on(t => ev.push(t));
    g.bet('mid', 500);
    const mid = g.getState();
    const res = mid.st.result;
    g.ack();
    const exp = 100000 - 500 + res.total;
    unit('E5 下注契約：扣注→result（結果已定）→ack 才入帳→settled',
      mid.phase === 'ANIM' && mid.wallet === 99500 && res.tierId === 'mid' && Array.isArray(res.steps) && res.init.length === 42 &&
      g.getState().wallet === exp && g.getState().phase === 'BET' && ev.join() === 'wallet,result,settled,wallet' &&
      last().payout === res.total && last().net === res.total - 500 && last().result === res);
  }
  {
    const { g } = mkGame({ wallet: 100 });
    let errs = 0; g.on(t => { if (t === 'error') errs++; });
    const r1 = g.bet('stable', 101), r2 = g.bet('nope', 10), r3 = g.bet('stable', 0), r4 = g.ack();
    g.bet('wild', 100); const r5 = g.bet('wild', 1);
    unit('E6 非法下注被擋（餘額不足／未知檔位／零額／非演出 ack／演出中再下注）', !r1 && !r2 && !r3 && !r4 && !r5 && errs === 5);
  }
  {
    const { g } = mkGame({ wallet: 10000, rng: DemoCore.makeRng(9) });
    g.bet('stable', 100); const a = g.getState().st.orderId;
    g.ack(); g.bet('stable', 100); const b = g.getState().st.orderId;
    unit('E7 注單號唯一且格式正確', a !== b && /^[A-Z0-9_]+-[0-9A-Z]+-\d{4}$/.test(a), `${a} / ${b}`);
  }
  {
    // 存檔：進行中存完整結果；已結注單只存摘要
    const store = fakeStore();
    const g1 = DemoCore.createGame({ storage: store, wallet: 10000, rng: DemoCore.makeRng(11) });
    g1.bet('wild', 1000);
    const pendRaw = JSON.parse(store._m['crate.core']);
    unit('E8 進行中那一單存完整結果（盤面＋步驟），重整可接回', !!(pendRaw.pending && pendRaw.pending.result && pendRaw.pending.result.init && Array.isArray(pendRaw.pending.result.steps)));
    const total1 = g1.getState().st.result.total;
    // 重整＝新建核心：rng 換掉也不能改結果
    const g2 = DemoCore.createGame({ storage: store, rng: () => 0 });
    const s2 = g2.getState(), rec = s2.records[s2.records.length - 1];
    unit('E9 演出中重整＝直接結算、不重抽（錢包＝起始−注額＋總賠）', s2.phase === 'BET' && s2.st === null && rec && rec.payout === total1 && s2.wallet === 10000 - 1000 + total1);
    const saved = JSON.parse(store._m['crate.core']);
    const recs = saved.records, forbidden = ['init', 'steps', 'final', 'near', 'result', 'w', 'cells'];
    unit('E10 已結注單只存摘要：無盤面／步驟／結果物件；pending 清空', saved.pending === null && recs.length === 1 &&
      forbidden.every(k => !(k in recs[0])) && JSON.stringify(recs[0]).length < 220,
      JSON.stringify(recs[0]));
  }
  {
    const store = fakeStore();
    const g = DemoCore.createGame({ storage: store, wallet: 1e9, rng: DemoCore.makeRng(13) });
    for (let i = 0; i < 260; i++) { g.bet(IDS[i % 3], 100); g.ack(); }
    const saved = JSON.parse(store._m['crate.core']);
    const bytes = store._m['crate.core'].length;
    unit(`E11 已結注單留 200 筆、存檔大小不爆（${bytes} 字元）`, saved.records.length === 200 && bytes < 60000 && saved.records.every(r => !('steps' in r)));
  }
  {
    // 結果與餘額無關、同 seed 可重現、lean 與完整模式邏輯一致
    const a = mkGame({ wallet: 5000, rng: DemoCore.makeRng(21) }), b = mkGame({ wallet: 987654321, rng: DemoCore.makeRng(21) });
    let same = true;
    for (let i = 0; i < 200; i++) {
      const id = IDS[i % 3];
      a.g.bet(id, 100); b.g.bet(id, 100);
      if (JSON.stringify(a.g.getState().st.result) !== JSON.stringify(b.g.getState().st.result)) same = false;
      a.g.ack(); b.g.ack();
    }
    unit('E12 結果只由 rng 與檔位決定：同 seed、錢包差很多，200 局整局結果逐一相同（無依餘額調機率）', same);
    let eqLean = true;
    for (let i = 0; i < 3000; i++) {
      const t = i % 3, r1 = DemoCore.makeRng(i), r2 = DemoCore.makeRng(i);
      const f = DemoCore.rollRound(t, 100, r1, false), l = DemoCore.rollRound(t, 100, r2, true);
      if (f.total !== l.total || f.chains !== l.chains || f.near.length !== l.near.length || f.w.join() !== l.w.join() || r1() !== r2()) eqLean = false;
    }
    unit('E13 lean 模式（模擬用）與完整模式：同 seed 3000 局的總賠、連鎖、near、W 與亂數消耗完全相同', eqLean);
  }
  {
    const { g } = mkGame({ wallet: 500, rng: DemoCore.makeRng(3) });
    g.bet('stable', 100);
    const c = g.clearSaved(), a = g.addMoney(100);
    g.ack();
    const gc = DemoCore.createGame({ storage: fakeStore() });
    gc.bet('stable', 100); gc.ack(); gc.clearSaved();
    unit('E14 演出中不可重置錢包／加錢；clearSaved 回起始錢包並清注單', c === false && a === false && gc.getState().wallet === CFG.WALLET && gc.getState().records.length === 0);
  }
  unit('E15 顯示最多 2 位無條件捨去、尾端 0 不補', EV.fmtX(1.9199) === '1.91' && EV.fmtX(1.9199999) === '1.92' && EV.fmtX(3.2) === '3.2' && EV.fmtX(24.82) === '24.82' && EV.fmtX(2) === '2' && EV.fmtX(12.409) === '12.4');
}

console.log(`\n${nFail === 0 ? 'ALL PASS' : 'HAS FAIL'}：PASS ${nPass}／FAIL ${nFail}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
process.exit(nFail === 0 ? 0 : 1);

})().catch(e => { console.error(e); process.exit(1); });
