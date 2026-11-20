/* =========================================================================
 * 連鎖開箱——分佈統計：node test/stats.js [N=5000000] [seed=2026]
 * 每檔跑 N 局（注額 100、實際核心 rollRound），輸出 test/stats.json 供規格書貼表。
 * 欄位（皆為「佔全部局數的百分比」，除非另註）：
 *   rtp 實測 RTP（%，注額 100，含取整與上限）　capLossPp 單局上限讓 RTP 少掉幾 pp
 *   pHit 有連鎖（至少爆一次）　avgChain 平均連鎖次數（全部局）　avgChainWhenHit 有連鎖的局平均連鎖次數
 *   avgSteps 平均一局演出幾步（＝連鎖次數；沒連鎖的局只有「掉落→沒爆」0 步）
 *   pWin 有賠（>0）　pGE1／5／20／100 賠 ≥ 該倍數本金　maxX 實測最高倍數　capRounds 打到單局上限的局數
 *   near.any 結尾盤面有 3 連片
 *   near.a 沒回本且結尾有 3 連片　near.b 連鎖 ≥2 次且結尾有 3 連片　near.c 連鎖 ≥1 次且結尾有 3 連片且下一格倍率 ≥ ×3
 *   chainDist[i]＝連鎖剛好 i 次的百分比（最後一格為 ≥ 12 次）
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const { loadGame, runJobs, mergeSim, shardJobs } = require('./_lib');

const N = Math.floor(+process.argv[2] || 5000000);
const SEED = Math.floor(+process.argv[3] || 2026);
const SHARDS = 32;
const r4 = v => +v.toFixed(4);
const pc = (a, n) => r4(a / n * 100);

(async () => {
  const t0 = Date.now();
  const { EV } = loadGame();
  const out = { generated: { cmd: `node test/stats.js ${N} ${SEED}`, n: Math.ceil(N / SHARDS) * SHARDS, seed: SEED, bet: 100,
    date: new Date().toISOString().slice(0, 10) }, tiers: {} };
  for (let t = 0; t < EV.TIERS.length; t++) {
    const T = EV.TIERS[t];
    const o = mergeSim(await runJobs(shardJobs({ kind: 'sim', tier: t, bet: 100, seed: SEED, lean: true }, N, SHARDS)));
    const n = o.n, hist = o.chainHist, dist = [];
    for (let i = 0; i < 12; i++) dist.push(pc(hist[i], n));
    dist.push(pc(hist.slice(12).reduce((a, v) => a + v, 0), n));
    out.tiers[T.id] = {
      kinds: T.kinds, ladder: T.ladder, pay: T.pay, n,
      rtp: r4(o.mean * 100), rtpSePp: r4(o.se * 100),
      capLossPp: r4(o.capLoss / o.n * 100),             // 單局上限讓 RTP 少掉的量（同樣本、相對於不設上限的線性值）
      pHit: pc(o.hit, n), avgChain: r4(o.steps / n), avgChainWhenHit: r4(o.steps / o.hit), avgSteps: r4(o.steps / n),
      pWin: pc(o.ge[0], n), pGE1: pc(o.ge[1], n), pGE5: pc(o.ge[2], n), pGE20: pc(o.ge[3], n), pGE100: pc(o.ge[4], n),
      maxX: r4(o.maxX), capRounds: o.cap, chainCapRounds: o.chainCapped, maxChains: o.maxChains,
      near: { any: pc(o.nearAny, n), a: pc(o.nearA, n), b: pc(o.nearB, n), c: pc(o.nearC, n) },
      chainDist: dist,
    };
    const s = out.tiers[T.id];
    console.log(`${T.id}（${T.kinds} 色）n=${n.toLocaleString('en-US')} RTP ${s.rtp}%±${s.rtpSePp}pp 有連鎖 ${s.pHit}% 平均連鎖 ${s.avgChain}（有連鎖時 ${s.avgChainWhenHit}）` +
      ` 賠≥1/5/20/100：${s.pGE1}/${s.pGE5}/${s.pGE20}/${s.pGE100}% 最高 ${s.maxX}x 上限 ${s.capRounds} 局 差一點 any/a/b/c：${s.near.any}/${s.near.a}/${s.near.b}/${s.near.c}%`);
  }
  fs.writeFileSync(path.join(__dirname, 'stats.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`已寫入 test/stats.json（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
})().catch(e => { console.error(e); process.exit(1); });
