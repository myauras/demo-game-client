/* =========================================================================
 * 三路尋寶——Node 無頭驗算（對 values.js／core.js 端到端複驗）
 * 執行：node test/mc-test.js [N]（預設 1000000：每條路線每個注額 N 局；約 1 分鐘，全核心平行）
 * 項目：A 精確計算  B 蒙地卡羅 RTP  C 設計目標（鐵表三組目標＋門檻錯落）  D 骰子誠實
 *       E 演出自洽  F 防套利  G 極值  H 核心契約
 * 判定：|偏差| ≤ max(0.1pp, 3σ)；FAIL 時 exit code 1。
 * 註：本檔不得含頂層 'use strict'；核心載入方式同瀏覽器（values.js＋core.js 普通 script）。
 * ========================================================================= */
const fs = require('fs');
const L = require('./_lib');
const { EV, DemoCore } = L.loadGame();
const CFG = EV.CFG;
const IDS = EV.ids();
const N = Math.floor(+(process.argv[2]) || 1000000);
const MAPS = 6000;                     // A／C 用的地圖張數（≥ 3000）
const TARGET = CFG.RTP;
let nPass = 0, nFail = 0;
const t0 = Date.now();

function line(ok, tag, text) { ok ? nPass++ : nFail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${text}`); }
function unit(tag, name, cond, detail) { line(!!cond, tag, name + (detail ? '  ' + detail : '')); }
const pp = x => (x * 100).toFixed(3) + 'pp';
const pc = x => (x * 100).toFixed(2) + '%';
/* 判定：|偏差| ≤ max(0.1pp, 3σ) */
function report(tag, name, theory, mean, se, sigma) {
  sigma = sigma || 3;
  const tol = Math.max(0.001, sigma * se);
  line(Math.abs(mean - theory) <= tol, tag,
    `${name}  理論 ${theory.toFixed(4)}  實測 ${mean.toFixed(4)}  容許 ±${tol.toFixed(4)}(${sigma}σ或0.1pp)`);
}
function fakeStore() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m };
}

/* ---- 骰子誠實檢查：吃合併後的骰子統計 T，回傳 [[ok, 名稱, 細節], ...]；真核心與「被動過手腳的核心」都用它 ---- */
function diceCheck(T) {
  const out = [], n = T.n;
  const tolOf = (p, m) => Math.max(0.001, 3 * Math.sqrt(p * (1 - p) / m));
  [['第一顆', T.die1], ['第二顆', T.die2]].forEach(([nm, arr]) => {
    for (let f = 1; f <= 6; f++) {
      const ph = arr[f] / n, tol = tolOf(1 / 6, n);
      out.push([Math.abs(ph - 1 / 6) <= tol, `${nm}骰 ${f} 點`, `比例 ${ph.toFixed(5)} 理論 ${(1 / 6).toFixed(5)} 容許 ±${tol.toFixed(5)}`]);
    }
  });
  for (let s = 2; s <= 12; s++) {
    const p = (6 - Math.abs(s - 7)) / 36, ph = T.sums[s] / n, tol = tolOf(p, n);
    out.push([Math.abs(ph - p) <= tol, `兩顆和 ${s}`, `比例 ${ph.toFixed(5)} 理論 ${p.toFixed(5)} 容許 ±${tol.toFixed(5)}`]);
  }
  for (let k = CFG.NEED_MIN; k <= CFG.NEED_MAX; k++) {
    if (!T.needN[k]) continue;
    const p = EV.winRate(k), ph = T.needW[k] / T.needN[k], tol = tolOf(p, T.needN[k]);
    out.push([Math.abs(ph - p) <= tol, `門檻 ${k}+ 實際勝率`, `${ph.toFixed(5)} 理論 ${p.toFixed(5)}（${T.needN[k]} 擲）容許 ±${tol.toFixed(5)}`]);
    if (T.retryN[k] > 1000) {                       // 重打（同一隻打輸後再擲）也不能偏
      const pr = T.retryW[k] / T.retryN[k], tr = tolOf(p, T.retryN[k]);
      out.push([Math.abs(pr - p) <= tr, `門檻 ${k}+ 重打時勝率`, `${pr.toFixed(5)} 理論 ${p.toFixed(5)}（${T.retryN[k]} 擲）容許 ±${tr.toFixed(5)}`]);
    }
  }
  const mx = T.sx / n, my = T.sy / n, vx = T.sxx / n - mx * mx, vy = T.syy / n - my * my, cv = T.sxy / n - mx * my;
  const r = cv / Math.sqrt(vx * vy), rtol = Math.max(0.001, 3 / Math.sqrt(n));
  out.push([Math.abs(r) <= rtol, '兩顆骰獨立（相關係數）', `r=${r.toFixed(5)} 容許 ±${rtol.toFixed(5)}`]);
  return out;
}

async function main() {
  /* ============ 先把要平行跑的工作一次排好 ============ */
  const jobs = [];
  const per = Math.ceil(MAPS / L.SHARDS);
  for (let s = 0; s < L.SHARDS; s++) jobs.push({ kind: 'maps', seed: L.mix32(20261123, 1, s + 1), n: per });
  const mapIdx = jobs.map((_, i) => i);
  const perShard = Math.ceil(N / L.SHARDS);
  const coreIdx = {};
  for (const route of IDS) for (const stake of [100, 1000]) {
    coreIdx[route + stake] = [];
    for (let s = 0; s < L.SHARDS; s++) {
      coreIdx[route + stake].push(jobs.length);
      jobs.push({ kind: 'core', route, stake, n: perShard, seed: L.mix32(777, stake + IDS.indexOf(route), s + 1), pool: 500 });
    }
  }
  const REAL_SHARDS = 10, REAL_N = 800;                      // 真 genMap 換圖：每條路線 8,000 局（注額 100）
  const realIdx = {};
  for (const route of IDS) {
    realIdx[route] = [];
    for (let s = 0; s < REAL_SHARDS; s++) {
      realIdx[route].push(jobs.length);
      jobs.push({ kind: 'core', route, stake: 100, n: REAL_N, seed: L.mix32(4242, IDS.indexOf(route), s + 1), pool: 0 });
    }
  }
  const stratIdx = [], poorIdx = [];
  const stratN = Math.max(1000, Math.floor(N / 2 / L.SHARDS));
  for (let s = 0; s < L.SHARDS; s++) { stratIdx.push(jobs.length); jobs.push({ kind: 'strategy', n: stratN, seed: L.mix32(31337, 5, s + 1), pool: 500 }); }
  const poorN = Math.max(1000, Math.floor(N / 16));   // 10 個 worker 共約 0.6N 局
  for (let s = 0; s < 10; s++) { poorIdx.push(jobs.length); jobs.push({ kind: 'poor', n: poorN, wallet: 100, seed: L.mix32(2468, 9, s + 1) }); }
  console.log(`工作 ${jobs.length} 個（地圖 ${per * L.SHARDS} 張、每路線每注額 ${perShard * L.SHARDS} 局、真換圖每路線 ${REAL_SHARDS * REAL_N} 局、看圖選路 ${stratN * L.SHARDS} 局），並行 ${L.cpuCount()} 個 worker…`);
  const R = await L.runJobs(jobs);
  const tJobs = ((Date.now() - t0) / 1000).toFixed(1);

  const M = L.mergeMaps(R, mapIdx);

  /* ============ A 精確計算 ============ */
  console.log('\n--- A 精確計算 ---');
  unit('A', `地圖張數 ≥ 3000`, M.n >= 3000, `${M.n} 張`);
  IDS.forEach((id, ri) => {
    const s = M.S[ri], mean = s.evSum / s.n;
    unit('A', `${id} 每張圖 EV 都在 ${pc(TARGET)} ± 0.15pp`, s.evMin >= TARGET - 0.0015 && s.evMax <= TARGET + 0.0015,
      `最低 ${pc(s.evMin)} 最高 ${pc(s.evMax)} 平均 ${pc(mean)}`);
    unit('A', `${id} 遞推法與暴力列舉一致（機率差＜1e-9，EV 差＜1e-9）`, s.bruteGap < 1e-9, `最大差 ${s.bruteGap.toExponential(2)}（${M.bruteMaps} 張圖）`);
  });
  unit('A', '同一張圖三條路 EV 最大差 ≤ 0.3pp', M.spreadMax <= 0.003, `最大差 ${pp(M.spreadMax)}`);
  /* 單點檢查：骰子勝率表（鐵表固定事實） */
  const wr = { 3: 35, 4: 33, 5: 30, 6: 26, 7: 21, 8: 15, 9: 10, 10: 6, 11: 3, 12: 1 };
  unit('A', '勝率表 3+～12+ ＝ 35/33/30/26/21/15/10/6/3/1 ÷ 36', Object.keys(wr).every(k => EV.ways(+k) === wr[k] && Math.abs(EV.winRate(+k) - wr[k] / 36) < 1e-12));
  /* 已知小例子手算：穩 3 心，[8+, ×1]：贏機率 15/36，連輸 3 次 (21/36)^3 */
  {
    const route = { hearts: 3, nodes: [{ kind: 'enemy', need: 8 }, { kind: 'prize', v: 1 }] };
    const st = EV.routeStats(route), lose = Math.pow(21 / 36, 3);
    unit('A', '手算小例子（3 心 8+ 後一顆 ×1）EV＝1−(21/36)^3', Math.abs(st.ev - (1 - lose)) < 1e-12, `EV ${st.ev.toFixed(6)} 手算 ${(1 - lose).toFixed(6)}`);
  }

  /* ============ B 蒙地卡羅 RTP ============ */
  console.log('\n--- B 蒙地卡羅 RTP（核心 bet→ack，含換地圖）---');
  const CO = {};
  for (const route of IDS) for (const stake of [100, 1000]) {
    const k = route + stake, c = L.mergeCore(R, coreIdx[k]).o;
    CO[k] = c;
    const mean = c.sum / c.n, se = Math.sqrt(Math.max(0, c.sumsq / c.n - mean * mean) / c.n), th = c.thSum / c.n;
    report('B', `${route} 注額${stake} RTP（${c.n} 局；理論＝所玩地圖的精確 EV 平均）`, th, mean, se);
    unit('B', `${route} 注額${stake} 所玩地圖的精確 EV 平均在 ${pc(TARGET)} ± 0.15pp`, Math.abs(th - TARGET) <= 0.0015, pc(th));
  }
  IDS.forEach(route => {
    const c = L.mergeCore(R, realIdx[route]).o;
    const mean = c.sum / c.n, se = Math.sqrt(Math.max(0, c.sumsq / c.n - mean * mean) / c.n), th = c.thSum / c.n;
    report('B', `${route} 真 genMap 換圖 RTP（${c.n} 局）`, th, mean, se);
    unit('B', `${route} 真 genMap 換圖：E 項檢查無違規`, c.bad === 0, c.badMsg.join('；'));
  });

  /* ============ C 設計目標 ============ */
  console.log('\n--- C 設計目標（鐵表三組目標逐張圖精確檢查）---');
  const bigAt = (s, f) => s.big[Math.min(s.big.length - 1, Math.floor(f * s.big.length))];
  IDS.forEach((id, ri) => {
    const s = M.S[ri], n = s.n;
    unit('C', `${id} 每張圖結構／倍率範圍／顯示格／寶物樣子／樣板吻合全對`, s.structBad + s.valBad + s.gridBad + s.tierBad + s.tplBad === 0,
      `structBad ${s.structBad} valBad ${s.valBad} gridBad ${s.gridBad} tierBad ${s.tierBad} tplBad ${s.tplBad} ${s.badMsg.slice(0, 2).join('；')}`);
    unit('C', `${id} 心數 ${CFG.ROUTES[ri].hearts}（穩 3／中 2／拚 1）`, CFG.ROUTES[ri].hearts === [3, 2, 1][ri]);
  });
  /* 鐵表目標：獨立寫在這裡（不經 CFG.band），逐張圖看最小／最大 */
  {
    const a = M.S[0], b = M.S[1], c = M.S[2];
    unit('C', `穩：每張圖 沒拿到 ≤ 10%`, a.p0Max <= 0.10 + 1e-9, `最高 ${pc(a.p0Max)}（平均 ${pc(a.p0 / a.n)}）`);
    unit('C', `穩：每張圖 拿回 ≥1 倍 35%～45%`, a.ge1Min >= 0.35 - 1e-9 && a.ge1Max <= 0.45 + 1e-9, `${pc(a.ge1Min)}～${pc(a.ge1Max)}（平均 ${pc(a.ge1 / a.n)}）`);
    unit('C', `穩：每張圖 最大寶物 ≥ ×2`, a.big[0] >= 2 - 1e-9, `最小 ×${a.big[0]} 中位 ×${bigAt(a, 0.5)} 最大 ×${a.big[a.big.length - 1]}`);
    unit('C', `穩：每張圖 每局標準差 1～1.5 倍`, a.sdMin >= 1 - 1e-9 && a.sdMax <= 1.5 + 1e-9, `${a.sdMin.toFixed(3)}～${a.sdMax.toFixed(3)}（平均 ${(a.sd / a.n).toFixed(3)}）`);
    unit('C', `中：每張圖 沒拿到 15%～25%`, b.p0Min >= 0.15 - 1e-9 && b.p0Max <= 0.25 + 1e-9, `${pc(b.p0Min)}～${pc(b.p0Max)}（平均 ${pc(b.p0 / b.n)}）`);
    unit('C', `中：每張圖 拿回 ≥1 倍 25%～35%`, b.ge1Min >= 0.25 - 1e-9 && b.ge1Max <= 0.35 + 1e-9, `${pc(b.ge1Min)}～${pc(b.ge1Max)}（平均 ${pc(b.ge1 / b.n)}）`);
    unit('C', `中：每張圖 最大寶物 ×5～×15`, b.big[0] >= 5 - 1e-9 && b.big[b.big.length - 1] <= 15 + 1e-9, `×${b.big[0]}～×${b.big[b.big.length - 1]} 中位 ×${bigAt(b, 0.5)}`);
    unit('C', `拚：每張圖 沒拿到 30%～45%`, c.p0Min >= 0.30 - 1e-9 && c.p0Max <= 0.45 + 1e-9, `${pc(c.p0Min)}～${pc(c.p0Max)}（平均 ${pc(c.p0 / c.n)}）`);
    unit('C', `拚：每張圖都有 ≥ ×20 的大寶藏`, c.big[0] >= 20 - 1e-9, `最小 ×${c.big[0]} 中位 ×${bigAt(c, 0.5)} 最大 ×${c.big[c.big.length - 1]}`);
    unit('C', `拚：每張圖 拿回 ≥20 倍機率 1.5%～3%`, c.ge20Min >= 0.015 - 1e-9 && c.ge20Max <= 0.03 + 1e-9, `${pc(c.ge20Min)}～${pc(c.ge20Max)}（平均 ${pc(c.ge20 / c.n)}）`);
    unit('C', `拚：單顆寶物最高 ≤ ×150`, c.maxPrize <= 150 + 1e-9, `最高 ×${c.maxPrize}`);
    IDS.forEach((id, ri) => unit('C', `${id} 每張圖落在 CFG 目標帶內（bandBad＝0）`, M.S[ri].bandBad === 0, `bandBad ${M.S[ri].bandBad} ${M.S[ri].badMsg.slice(0, 2).join('；')}`));
  }
  /* 節點數、樣板 */
  const allLens = new Set();
  IDS.forEach((id, ri) => {
    const s = M.S[ri], cls = CFG.ROUTES[ri];
    const seen = Object.keys(s.lenHist).map(Number).sort((x, y) => x - y);
    const tplLens = Array.from(new Set(cls.tpl.map(t => t.length))).sort((x, y) => x - y);
    seen.forEach(x => allLens.add(x));
    unit('C', `${id} 節點數都在 6～9、且與樣板長度一致`, seen.every(x => x >= 6 && x <= 9) && JSON.stringify(seen) === JSON.stringify(tplLens),
      `出現 ${JSON.stringify(s.lenHist)}`);
    const used = Object.keys(s.tpl).length;
    unit('C', `${id} 樣板 ≥ 8 種且每種都出現過`, cls.tpl.length >= 8 && used === cls.tpl.length, `${used}/${cls.tpl.length} 種（最少 ${Math.min(...Object.values(s.tpl))} 張、最多 ${Math.max(...Object.values(s.tpl))} 張）`);
    unit('C', `${id} 最後一個節點是這條路最大的寶物（嚴格最大）`, s.structBad === 0);
  });
  unit('C', '全部地圖節點數 6、7、8、9 各長度都出現', [6, 7, 8, 9].every(x => allLens.has(x)), `出現 ${Array.from(allLens).join('、')}`);
  /* 門檻高低錯落 */
  IDS.forEach((id, ri) => {
    const s = M.S[ri], g = CFG.ROUTES[ri].stag;
    unit('C', `${id} 門檻錯落：每張圖都過 stag（stagBad＝0）`, s.stagBad === 0, `stagBad ${s.stagBad} ${s.badMsg.slice(0, 1).join('')}`);
    unit('C', `${id} 門檻錯落：≥${g.high} 的敵人 ≤ ${g.hiMax} 隻、≥${g.red}（紅）≤ ${g.redMax} 隻、≤${g.green}（綠）≥ ${g.greenMin} 隻`,
      s.hiMax <= g.hiMax && s.redMax <= g.redMax && s.greenMin >= g.greenMin, `最多 ≥${g.high} ${s.hiMax} 隻、≥${g.red} ${s.redMax} 隻、≤${g.green} 最少 ${s.greenMin} 隻`);
    unit('C', `${id} 門檻錯落：最高與最低至少差 ${g.spread}、敵人 ≥3 隻時有「後面比前面好打 ${g.drop} 以上」、平均 ≤ ${g.meanMax}`,
      s.spreadMin >= g.spread && s.dropMax >= g.drop && s.meanMax <= g.meanMax + 1e-9,
      `最小差距 ${s.spreadMin}、最大落差 ${s.dropMax}、平均最高 ${s.meanMax.toFixed(2)}（全部地圖平均 ${(s.meanSum / s.n).toFixed(2)}）`);
  });

  /* ============ D 骰子誠實 ============ */
  console.log('\n--- D 骰子誠實 ---');
  {
    const all = L.mergeCore(R, [].concat(...Object.values(coreIdx))).T;
    const res = diceCheck(all);
    const failed = res.filter(x => !x[0]);
    res.forEach(x => { if (!x[0]) line(false, 'D', x[1] + '  ' + x[2]); });
    line(failed.length === 0, 'D', `核心 bet→ack 全部 ${all.n} 擲：每顆骰 1～6 各面、兩顆和 2～12、每個門檻勝率、重打勝率、兩顆骰相關係數，共 ${res.length} 項，失敗 ${failed.length} 項`);
    const worst = res.filter(x => /^比例|^\d|r=/.test(x[2]) || true).slice(0, 0);
    const poor = L.mergeCore(R.map((r, i) => (poorIdx.indexOf(i) >= 0 ? { o: {}, T: r.T } : null)), poorIdx).T;
    const resP = diceCheck(poor);
    const failedP = resP.filter(x => !x[0]);
    failedP.forEach(x => line(false, 'D', '低餘額 ' + x[1] + '  ' + x[2]));
    line(failedP.length === 0, 'D', `餘額壓在 100（輸光就補回）的 ${poor.n} 擲：骰子統計同樣全在範圍內（${resP.length} 項，失敗 ${failedP.length}）；骰子不看餘額`);
  }
  /* 程式路徑：rollDie 只吃 rng；擲骰區段不碰錢包／餘額／注單 */
  {
    const src = fs.readFileSync(L.CORE_PATH, 'utf8');
    const rd = (src.match(/function rollDie\(([^)]*)\)\{([^}]*)\}/) || [])[0] || '';
    unit('D', 'rollDie 只吃 rng 與 CFG.FACES（不看餘額、局面）', /^function rollDie\(rng\)\{ return 1 \+ Math\.floor\(rng\(\) \* EV\.CFG\.FACES\); \}$/.test(rd), rd);
    const sim = (src.match(/function simulate\([\s\S]*?\n\}\n/) || [])[0] || '';
    const rollPart = sim.slice(sim.indexOf('for(;;)'), sim.indexOf('if(!reached)'));
    unit('D', '擲骰迴圈只用 rollDie／need／心數，不碰 wallet／records／stake／balance', rollPart.length > 50 && !/wallet|records|stake|balance|getState|Math\.random/.test(rollPart), `迴圈 ${rollPart.length} 字元`);
    unit('D', '核心裡只有 rollDie 呼叫 rng 擲骰（simulate 內不直接呼叫 rng）', (sim.match(/rng\(/g) || []).length === 0 && (sim.match(/rollDie\(rng\)/g) || []).length === 2);
    let calls = 0;
    const cr = EV.mulberry32(99); const counting = () => { calls++; return cr(); };
    const pool = []; const rg = EV.mulberry32(5);
    for (let i = 0; i < 40; i++) pool.push(EV.genMap(rg));
    let rolls = 0;
    for (let g = 0; g < 5000; g++) rolls += DemoCore.simulate(pool[g % 40], g % 3, 100, counting).fights.length;
    unit('D', '每擲恰好消耗 2 次亂數（兩顆骰各一次），沒有別的亂數呼叫', calls === 2 * rolls, `${calls} 次 / ${rolls} 擲`);
    /* 自檢：被動過手腳的核心，檢查必須抓得到 */
    const mutants = [
      ['偏骰（每顆骰沒有 6 點）', c => c.replace('Math.floor(rng() * EV.CFG.FACES)', 'Math.floor(rng() * (EV.CFG.FACES - 1))')],
      ['兩顆骰綁在一起（5% 機率第二顆＝第一顆）', c => c.replace('var a = rollDie(rng), b = rollDie(rng),', 'var a = rollDie(rng), b = rng() < 0.05 ? a : rollDie(rng),')],
      ['注額高就偷減點數', c => c.replace('var a = rollDie(rng), b = rollDie(rng),', 'var a = rollDie(rng), b = rollDie(rng); if(stake >= 1000 && a > 1 && rng() < 0.1) a--;\n      var')]
    ];
    mutants.forEach(([name, fn]) => {
      const { DemoCore: MC, EV: ME } = L.loadGame({ coreSrc: fn(fs.readFileSync(L.CORE_PATH, 'utf8')) });
      const T = { die1: Array(7).fill(0), die2: Array(7).fill(0), sums: Array(13).fill(0), needN: Array(13).fill(0), needW: Array(13).fill(0),
        retryN: Array(13).fill(0), retryW: Array(13).fill(0), n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
      const rr = ME.mulberry32(7), pl = [];
      for (let i = 0; i < 30; i++) pl.push(ME.genMap(rr));
      for (let g = 0; g < 60000; g++) {
        const seen = new Set();
        MC.simulate(pl[g % 30], g % 3, g % 2 ? 1000 : 100, rr).fights.forEach(f => {
          const a = f.dice[0], b = f.dice[1];
          T.die1[a]++; T.die2[b]++; T.sums[a + b]++; T.needN[f.need]++; if (f.win) T.needW[f.need]++;
          if (seen.has(f.idx)) { T.retryN[f.need]++; if (f.win) T.retryW[f.need]++; } seen.add(f.idx);
          T.n++; T.sx += a; T.sy += b; T.sxx += a * a; T.syy += b * b; T.sxy += a * b;
        });
      }
      const bad = diceCheck(T).filter(x => !x[0]).length;
      unit('D', `自檢：動過手腳的骰子「${name}」會被抓到`, bad > 0, `${bad} 項不過`);
    });
  }

  /* ============ E 演出自洽 ============ */
  console.log('\n--- E 演出自洽（每局都檢查）---');
  {
    let total = 0, bad = 0, msg = [];
    for (const k in coreIdx) { const c = CO[k]; total += c.n; bad += c.bad; msg = msg.concat(c.badMsg); }
    unit('E', `事件表寶物加總＝total＝各寶物金額相加；每擲輸一次少一顆心；撤退後沒有事件；打贏才前進；fights 與 events 一致；骰面 1～6（${total} 局）`, bad === 0, `違規 ${bad} ${msg.slice(0, 3).join('；')}`);
  }

  /* ============ F 防套利 ============ */
  console.log('\n--- F 防套利 ---');
  {
    let n = 0, sum = 0, sumsq = 0, th = 0; const pick = [0, 0, 0];
    stratIdx.forEach(i => { const r = R[i].o; n += r.n; sum += r.sum; sumsq += r.sumsq; th += r.thSum; r.pick.forEach((v, j) => { pick[j] += v; }); });
    const mean = sum / n, se = Math.sqrt(sumsq / n - mean * mean) / Math.sqrt(n);
    report('F', `先看地圖再挑「精確 EV 最高」的那條路（${n} 局，所玩地圖最高 EV 平均 ${pc(th / n)}）`, th / n, mean, se);
    unit('F', '看地圖挑最划算的路也沒有優勢：所挑路線的平均 EV ≤ 96.5% + 0.14pp（所以 RTP 不會超過 100%）', th / n <= TARGET + 0.0014 + 1e-9 && th / n < 1, `平均 ${pc(th / n)}；選了 穩 ${pick[0]}／中 ${pick[1]}／拚 ${pick[2]}`);
    unit('F', '同圖三條路 EV 差 ≤ 0.3pp → 沒有「某條路明顯較賺」', M.spreadMax <= 0.003, pp(M.spreadMax));
    const g = DemoCore.createGame({ storage: false, rng: EV.mulberry32(3) });
    const w0 = g.getState().wallet;
    const r1 = g.bet(['safe', 'mid'], 100), r2 = g.bet('safe,mid', 100), r3 = g.bet('safe', 100), r4 = g.bet('mid', 100);
    unit('F', '一局只能選一條路（傳陣列／兩條路都拒絕；演出中不能再下第二注）', !r1 && !r2 && r3 && !r4 && g.getState().wallet === w0 - 100);
  }

  /* ============ G 極值 ============ */
  console.log('\n--- G 極值 ---');
  {
    let bound = 0, boundBad = 0, rbad = 0, maxX = 0, maxRolls = 0, maxPrize = 0;
    for (const k in coreIdx) { const c = CO[k]; boundBad += c.boundBad; rbad += c.rollsBoundBad; maxX = Math.max(maxX, c.maxTotalX); maxRolls = Math.max(maxRolls, c.maxRolls); maxPrize = Math.max(maxPrize, c.maxPrizeAny); }
    IDS.forEach((id, ri) => { bound = Math.max(bound, M.S[ri].sumAllMax); });
    unit('G', '單顆寶物 ≤ ×150', Math.max(...M.S.map(s => s.maxPrize)) <= 150 + 1e-9 && maxPrize <= 150 + 1e-9, `地圖最大 ×${Math.max(...M.S.map(s => s.maxPrize))}、實際收下最大 ×${maxPrize}`);
    unit('G', '每一局的拿回倍數 ≤ 該條路所有寶物倍率總和（理論上界）', boundBad === 0, `違規 ${boundBad}；實測單局最高 ×${maxX}；理論上界（所有地圖中最大的整條路寶物總和）×${bound.toFixed(1)}`);
    unit('G', '每局擲骰次數 ≤ 敵人數＋心數−1', rbad === 0, `違規 ${rbad}；實測最多 ${maxRolls} 擲；理論上界（所有地圖）${Math.max(...M.S.map(s => s.rollsMaxBound))} 擲`);
    IDS.forEach((id, ri) => unit('G', `${id} 一局最高倍數的實測 ≤ 該路各地圖最大寶物總和`, Math.max(...stratMax(ri)) <= M.S[ri].sumAllMax + 1e-9, `實測最高 ×${Math.max(...stratMax(ri))}、上界 ×${M.S[ri].sumAllMax.toFixed(1)}`));
    function stratMax(ri) { return [100, 1000].map(st => CO[IDS[ri] + st].maxTotalX); }
  }

  /* ============ H 核心契約 ============ */
  console.log('\n--- H 核心契約 ---');
  {
    const store = fakeStore();
    let g = DemoCore.createGame({ storage: store, rng: EV.mulberry32(11), now: () => 1700000000000 });
    let ev = []; g.on((t, d) => ev.push([t, d]));
    const seed0 = g.getState().mapSeed;
    unit('H', '起始錢包 10,000、狀態 BET', g.getState().wallet === 10000 && g.getState().phase === 'BET');
    unit('H', '不合法注額、不合法路線、餘額不足都拒絕且不扣錢', !g.bet('safe', 123) && !g.bet('nope', 100) && !g.bet('safe', '100') && g.getState().wallet === 10000);
    /* 未下注重整＝同一張圖 */
    const gR = DemoCore.createGame({ storage: store, rng: EV.mulberry32(12) });
    unit('H', '未下注重整＝同一張圖（種子相同、三條路內容相同）', gR.getState().mapSeed === seed0 && JSON.stringify(gR.getState().map.routes) === JSON.stringify(g.getState().map.routes));
    /* 扣注、演出中、ack 入帳、換地圖 */
    ev = [];
    const map0 = g.getState().map;
    unit('H', 'bet 成功', g.bet('mid', 500));
    const st = g.getState();
    unit('H', '扣注：演出中餘額＝10,000−500、phase ANIM、結果已定', st.wallet === 9500 && st.phase === 'ANIM' && st.st && st.st.result.route === 'mid' && st.st.result.map === map0);
    unit('H', '演出中不能再下注、不能重置、不能加錢、不能換圖', !g.bet('safe', 100) && !g.clearSaved() && !g.addMoney(100) && !g.devSetMap(5));
    const res = st.st.result;
    unit('H', '先發 wallet、result 事件，內含 result 物件（prizes／fights／events／heartsLeft／reachedEnd）',
      ev[0][0] === 'wallet' && ev[1][0] === 'result' && ev[1][1].result === res && Array.isArray(res.fights) && Array.isArray(res.events) && typeof res.reachedEnd === 'boolean' && typeof res.heartsLeft === 'number');
    /* 演出中重整＝直接結算、地圖換新 */
    const store2 = fakeStore(); Object.keys(store._m).forEach(k => { store2._m[k] = store._m[k]; });
    const gP = DemoCore.createGame({ storage: store2, rng: EV.mulberry32(13) });
    const sP = gP.getState();
    unit('H', '演出中重整＝直接結算（錢入帳、phase 回 BET）且地圖換新、注單記一筆', sP.phase === 'BET' && sP.wallet === 9500 + res.total && sP.mapSeed !== seed0 && sP.records.length === 1);
    ev = [];
    g.ack();
    const s1 = g.getState();
    unit('H', 'ack 後入帳：餘額＝9,500＋拿回、phase BET、換新地圖', s1.wallet === 9500 + res.total && s1.phase === 'BET' && s1.mapSeed !== seed0);
    unit('H', 'ack 後發 settled → wallet → map', ev.map(e => e[0]).join() === 'settled,wallet,map');
    unit('H', '結算入帳的金額＝結果抽定的 total（結果先定）', ev[0][1].payout === res.total && ev[0][1].net === res.total - 500);
    unit('H', '重複 ack 被拒絕', !g.ack());
    /* 注單摘要 */
    const rec = s1.records[s1.records.length - 1];
    const text = JSON.stringify(rec);
    unit('H', '注單摘要不含地圖（沒有 nodes／routes／map）', !/nodes|routes|"map"/.test(text) && !('map' in rec), `${text.length} 字元`);
    unit('H', '注單摘要欄位齊全：orderId／ts／route／choice／stake／payout／win／totalX／nPrizes／nRolls／heartsLeft／reachedEnd／maxX／mults／rolls',
      ['orderId', 'ts', 'route', 'choice', 'stake', 'payout', 'win', 'totalX', 'nPrizes', 'nRolls', 'heartsLeft', 'reachedEnd', 'maxX', 'mults', 'rolls'].every(k => k in rec) && !('near' in rec) &&
      rec.nRolls === res.fights.length && rec.rolls.length === res.fights.length && rec.mults.length === res.prizes.length &&
      rec.rolls.every((r, i) => r[0] === res.fights[i].need && r[1] === res.fights[i].dice[0] && r[2] === res.fights[i].dice[1] && r[3] === (res.fights[i].win ? 1 : 0)));
    unit('H', '存檔不含地圖本體、種子還在', !/"nodes"/.test(store._m['trails.core'] || '') && /mapSeed/.test(store._m['trails.core'] || ''));
    /* 舊版（v2）存檔忽略 */
    const store3 = fakeStore(); store3.setItem('trails.core', JSON.stringify({ v: 2, wallet: 1, seq: 9, records: [], mapSeed: 5 }));
    const g3 = DemoCore.createGame({ storage: store3, rng: EV.mulberry32(14) });
    unit('H', '舊版（v2）存檔忽略：錢包回到 10,000', g3.getState().wallet === 10000);
    /* 注單保留 200 筆 */
    const st4 = fakeStore(), g4b = DemoCore.createGame({ storage: st4, rng: EV.mulberry32(15), wallet: 1e9 });
    for (let i = 0; i < 230; i++) { g4b.bet('safe', 100); g4b.ack(); }
    const kept = JSON.parse(st4._m['trails.core']).records;
    unit('H', '核心只留最近 200 筆已結注單', kept.length === 200 && g4b.getState().records.length === 20, `存檔 ${kept.length} 筆`);
    /* devSetMap 與 clearSaved */
    const g5 = DemoCore.createGame({ storage: false, rng: EV.mulberry32(16) });
    g5.devSetMap(42);
    unit('H', 'devSetMap(seed) 指定地圖：同種子同地圖', JSON.stringify(g5.getState().map.routes) === JSON.stringify(EV.genMapSeed(42).routes) && g5.getState().mapSeed === 42);
    unit('H', 'clearSaved 重置錢包但保留地圖', (() => { g5.addMoney(500); const s = g5.getState().mapSeed; g5.clearSaved(); return g5.getState().wallet === 10000 && g5.getState().mapSeed === s; })());
    /* 結果先定：同種子同局結果相同，與演出無關 */
    const ga = DemoCore.createGame({ storage: false, rng: EV.mulberry32(77) }), gb = DemoCore.createGame({ storage: false, rng: EV.mulberry32(77) });
    let ra, rb; ga.on((t, d) => { if (t === 'result') ra = d.result; }); gb.on((t, d) => { if (t === 'result') rb = d.result; });
    ga.bet('risk', 100); gb.bet('risk', 100);
    unit('H', '結果先定：同亂數同地圖→同結果（核心不含演出變數）', JSON.stringify(ra.events) === JSON.stringify(rb.events));
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n共 PASS ${nPass}／FAIL ${nFail}　用時 ${secs} 秒（worker 階段 ${tJobs} 秒）　N=${N}`);
  process.exit(nFail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
