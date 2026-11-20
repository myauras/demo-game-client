/* =========================================================================
 * 連鎖開箱——校表：node test/tune.js [N=30000000] [seed=12345]
 * 量每檔「每局各片大小的倍率加權次數 W」（RTP＝Σ W·賠率，對賠率表是線性的），
 * 依鐵表的 shape（賠率相對比例）縮放到 RTP 目標、取三位小數、微調到最接近目標，
 * 把結果寫回 values.js 的 /*PAY-START … PAY-END* / 區塊（附產生紀錄），再重載一次確認自檢通過。
 * 只調賠率，不動機率。用 worker_threads 平行；固定切 32 個 shard，同 N 同 seed 結果可重現。
 * ========================================================================= */
const fs = require('fs');
const { VALUES_PATH, PAY_RE, loadGame, runJobs, mergeSim, shardJobs } = require('./_lib');

const N = Math.floor(+process.argv[2] || 30000000);
const SEED = Math.floor(+process.argv[3] || 12345);
const SHARDS = 32;
const PROTO = {                      // 原型 rationale.md 的賠率表（只用來印差距）
  stable: [0.077, 0.108, 0.154, 0.232, 0.347, 0.541, 0.771],
  mid:    [0.19, 0.284, 0.474, 0.758, 1.328, 2.276, 3.793],
  wild:   [0.337, 0.54, 1.011, 2.024, 4.047, 8.43, 16.858],
};

(async () => {
  const t0 = Date.now();
  const { EV } = loadGame({ stub: true });          // 賠率表換成占位載入（W 不依賴賠率）
  const TARGET = EV.CFG.RTP;
  const out = { W: {}, pay: {} };
  for (let t = 0; t < EV.CFG.TIERS.length; t++) {
    const T = EV.CFG.TIERS[t];
    const rs = await runJobs(shardJobs({ kind: 'sim', stub: true, tier: t, bet: 100, seed: SEED, lean: 2 }, N, SHARDS));
    const o = mergeSim(rs);
    const W = o.Wavg;
    const rtp = p => p.reduce((a, v, i) => a + v * W[i], 0);
    const base = rtp(T.shape), k = TARGET / base;
    let p = T.shape.map(v => Math.round(v * k * 1000) / 1000);
    // 微調：每次 ±0.001 挑讓 RTP 最接近目標的一格（維持不遞減、片越大賠率不降）
    for (let it = 0; it < 400; it++) {
      const cur = rtp(p), err = Math.abs(cur - TARGET);
      let best = null;
      for (let i = 0; i < 7; i++) for (const d of [-0.001, 0.001]) {
        const q = p.slice(); q[i] = Math.round((q[i] + d) * 1000) / 1000;
        if (q[i] <= 0 || (i > 0 && q[i] < q[i - 1]) || (i < 6 && q[i] > q[i + 1])) continue;
        const e = Math.abs(rtp(q) - TARGET);
        if (e < err - 1e-9 && (!best || e < best.e)) best = { q, e };
      }
      if (!best) break;
      p = best.q;
    }
    out.W[T.id] = W.map(v => +v.toFixed(8));
    out.pay[T.id] = p;
    console.log(`檔 ${T.id}（${T.kinds} 色）n=${o.n.toLocaleString('en-US')}  W/局 = ${W.map(v => v.toFixed(4)).join(' ')}`);
    console.log(`  賠率 = [${p.join(', ')}]  推算 RTP = ${(rtp(p) * 100).toFixed(4)}%`);
    console.log(`  原型 = [${PROTO[T.id].join(', ')}]  差距 = ${p.map((v, i) => ((v / PROTO[T.id][i] - 1) * 100).toFixed(2) + '%').join(' ')}`);
  }
  const date = new Date().toISOString().slice(0, 10);
  const fmt = o => '{ ' + Object.keys(o).map(id => `${id}:[${o[id].join(', ')}]`).join(',\n           ') + ' }';
  const block =
`/*PAY-START 賠率表區塊：由 test/tune.js 產生並寫入，禁手改*/
var TUNED = { untuned:false,
  generated:{ cmd:'node test/tune.js ${N} ${SEED}', n:${o_n(SHARDS, N)}, seed:${SEED}, shards:${SHARDS}, date:'${date}' },
  W:   ${fmt(out.W)},
  pay: ${fmt(out.pay)} };
/*PAY-END*/`;
  const src = fs.readFileSync(VALUES_PATH, 'utf8');
  if (!PAY_RE.test(src)) throw new Error('values.js 找不到 PAY-START／PAY-END 區塊');
  fs.writeFileSync(VALUES_PATH, src.replace(PAY_RE, () => block));
  // 重載：自檢通過才算成功
  const chk = loadGame({});
  console.log('\n已寫入 values.js，重載自檢通過。各檔由 W×賠率算出的 RTP：');
  for (const id of chk.EV.ids()) console.log(`  ${id}: ${(chk.EV.theoryRtp(id) * 100).toFixed(4)}%  賠率 ${chk.EV.TIERS.find(x => x.id === id).pay.join(' ')}`);
  console.log(`耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch(e => { console.error(e); process.exit(1); });

function o_n(shards, n) { return Math.ceil(n / shards) * shards; }   // 每檔實際局數
