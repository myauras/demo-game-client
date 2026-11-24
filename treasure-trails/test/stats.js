/* =========================================================================
 * 三路尋寶——體感統計（供規格書貼表）
 * 執行：node test/stats.js [N]（預設 600000：每條路線的核心局數；另跑「每場 50／200 局」各 20,000 場）
 * 輸出：test/stats.json、test/sample-maps.json
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const L = require('./_lib');
const { EV } = L.loadGame();
const CFG = EV.CFG, IDS = EV.ids();
const N = Math.floor(+(process.argv[2]) || 600000);
const MAPS = 6000, SESSIONS = 20000, SESS_SHARDS = 8;
const pc = x => (x * 100).toFixed(2) + '%';
const r4 = x => +x.toFixed(4);
const t0 = Date.now();

async function main() {
  const jobs = [], idx = { maps: [], core: {}, sess: {} };
  const per = Math.ceil(MAPS / L.SHARDS);
  for (let s = 0; s < L.SHARDS; s++) { idx.maps.push(jobs.length); jobs.push({ kind: 'maps', seed: L.mix32(20261123, 1, s + 1), n: per }); }
  const perShard = Math.ceil(N / L.SHARDS);
  for (const route of IDS) {
    idx.core[route] = [];
    for (let s = 0; s < L.SHARDS; s++) { idx.core[route].push(jobs.length); jobs.push({ kind: 'core', route, stake: 100, n: perShard, seed: L.mix32(555, IDS.indexOf(route), s + 1), pool: 500 }); }
    for (const len of [50, 200]) {
      const key = route + len; idx.sess[key] = [];
      for (let s = 0; s < SESS_SHARDS; s++) { idx.sess[key].push(jobs.length); jobs.push({ kind: 'session', route, stake: 100, len, sessions: SESSIONS / SESS_SHARDS, seed: L.mix32(888, len + IDS.indexOf(route), s + 1), pool: 500 }); }
    }
  }
  console.log(`工作 ${jobs.length} 個（每路線 ${perShard * L.SHARDS} 局、每場 50／200 局各 ${SESSIONS} 場），並行 ${L.cpuCount()} 個 worker…`);
  const R = await L.runJobs(jobs);
  const M = L.mergeMaps(R, idx.maps);

  const out = { generated: new Date().toISOString().slice(0, 10),
    params: { coreGamesPerRoute: perShard * L.SHARDS, maps: M.n, sessionsPerLen: SESSIONS, stake: 100 },
    note: '精確值＝每張圖精確分布的平均（不含抽樣誤差）；實測＝核心 bet→ack 玩出來的；每場拿回比例＝一場內總拿回÷總下注', routes: {} };
  IDS.forEach((route, ri) => {
    const s = M.S[ri], cls = CFG.ROUTES[ri], n = s.n;
    const q = f => s.big[Math.min(s.big.length - 1, Math.floor(f * s.big.length))];
    const share = h => { const t = Object.values(h).reduce((a, b) => a + b, 0), o = {}; Object.keys(h).sort((a, b) => a - b).forEach(k => { o[k] = r4(h[k] / t); }); return o; };
    const c = L.mergeCore(R, idx.core[route]).o;
    const mean = c.sum / c.n, sd = Math.sqrt(c.sumsq / c.n - mean * mean);
    const sessions = {};
    for (const len of [50, 200]) {
      const rets = []; idx.sess[route + len].forEach(i => R[i].rets.forEach(v => rets.push(v)));
      rets.sort((a, b) => a - b);
      const qq = f => rets[Math.min(rets.length - 1, Math.floor(f * rets.length))];
      sessions['len' + len] = { sessions: rets.length, medianReturn: r4(qq(0.5)), p10: r4(qq(0.1)), p90: r4(qq(0.9)),
        meanReturn: r4(rets.reduce((a, b) => a + b, 0) / rets.length), under80Rate: r4(rets.filter(v => v < 0.8).length / rets.length),
        under50Rate: r4(rets.filter(v => v < 0.5).length / rets.length), over100Rate: r4(rets.filter(v => v >= 1).length / rets.length) };
    }
    out.routes[route] = {
      label: cls.label, hearts: cls.hearts,
      exact: { maps: n, evRange: [r4(s.evMin * 100), r4(s.evMax * 100)], p0: r4(s.p0 / n), ge1: r4(s.ge1 / n), ge5: r4(s.ge5 / n), ge20: r4(s.ge20 / n),
        sdPerGame: +(s.sd / n).toFixed(3), sdRange: [+s.sdMin.toFixed(3), +s.sdMax.toFixed(3)], reachEnd: r4(s.pEnd / n), avgRolls: +(s.rolls / n).toFixed(3),
        p0Range: [r4(s.p0Min), r4(s.p0Max)], ge1Range: [r4(s.ge1Min), r4(s.ge1Max)], ge20Range: [r4(s.ge20Min), r4(s.ge20Max)],
        bigPrize: { min: s.big[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: s.big[s.big.length - 1] },
        nodeCount: share(s.lenHist), enemyCount: share(s.nEnemyHist) },
      thresholds: { share: share(s.needHist), firstEnemy: share(s.firstEnemyHist),
        avgMax: +(s.maxNeedSum / n).toFixed(2), avgMin: +(s.minNeedSum / n).toFixed(2), avgMean: +(s.meanSum / n).toFixed(2),
        stag: cls.stag, observed: { hiMax: s.hiMax, redMax: s.redMax, greenMin: s.greenMin, dropMax: s.dropMax, spreadMin: s.spreadMin, meanMax: +s.meanMax.toFixed(2) } },
      templates: cls.tpl.length,
      sim: { games: c.n, rtp: r4(mean), sdPerGame: +sd.toFixed(3), p0: r4(1 - c.ge0 / c.n), ge1: r4(c.ge1 / c.n), ge5: r4(c.ge5 / c.n), ge20: r4(c.ge20 / c.n),
        avgPrizes: +(c.prizeSum / c.n).toFixed(3), avgRolls: +(c.rollSum / c.n).toFixed(3), rolls6plusRate: r4(c.ge6rolls / c.n),
        reachEnd: r4(c.reachEnd / c.n), avgHeartsLeft: +(c.heartsLeftSum / c.n).toFixed(3), maxTotalX: c.maxTotalX, maxRolls: c.maxRolls,
        rollsDist: (() => { const o = {}, t = Object.values(c.rollsHist).reduce((a, b) => a + b, 0); Object.keys(c.rollsHist).sort((a, b) => a - b).forEach(k => { o[k] = r4(c.rollsHist[k] / t); }); return o; })() },
      sessions
    };
  });
  /* 三條路合併的門檻分布（每個門檻占所有敵人的幾 %；顏色分組） */
  const all = {}; let tot = 0;
  M.S.forEach(s => { for (const k in s.needHist) { all[k] = (all[k] || 0) + s.needHist[k]; tot += s.needHist[k]; } });
  const color = { green: 0, yellow: 0, red: 0 };
  for (const k in all) { const v = all[k] / tot; if (+k <= 6) color.green += v; else if (+k <= 8) color.yellow += v; else color.red += v; }
  out.thresholdsAll = { share: Object.fromEntries(Object.keys(all).sort((a, b) => a - b).map(k => [k, r4(all[k] / tot)])),
    color: { green_le6: r4(color.green), yellow_7to8: r4(color.yellow), red_ge9: r4(color.red) } };
  fs.writeFileSync(path.join(__dirname, 'stats.json'), JSON.stringify(out, null, 1));

  /* ---- 表格輸出 ---- */
  console.log('\n路線｜沒拿到｜≥1倍｜≥5倍｜≥20倍｜走到底｜平均寶物數｜平均擲幾次｜擲≥6次｜σ/局｜最大寶物 最小/中位/最大｜RTP');
  IDS.forEach(r => { const x = out.routes[r], s = x.sim, e = x.exact;
    console.log(`${x.label}｜${pc(s.p0)}｜${pc(s.ge1)}｜${pc(s.ge5)}｜${pc(s.ge20)}｜${pc(s.reachEnd)}｜${s.avgPrizes}｜${s.avgRolls}｜${pc(s.rolls6plusRate)}｜${s.sdPerGame}｜×${e.bigPrize.min}/×${e.bigPrize.median}/×${e.bigPrize.max}｜${pc(s.rtp)}`); });
  console.log('\n每條路的門檻：平均最高／平均最低／平均各敵人');
  IDS.forEach(r => { const t = out.routes[r].thresholds; console.log(`${out.routes[r].label}：${t.avgMax}／${t.avgMin}／${t.avgMean}　分布 ${JSON.stringify(t.share)}`); });
  console.log('三路合併顏色：', JSON.stringify(out.thresholdsAll.color));
  console.log('\n每場拿回比例（中位數／拿回不到 80% 的場次）：');
  IDS.forEach(r => { const x = out.routes[r];
    console.log(`${x.label}：50 局 中位 ${pc(x.sessions.len50.medianReturn)}／<80% ${pc(x.sessions.len50.under80Rate)}　200 局 中位 ${pc(x.sessions.len200.medianReturn)}／<80% ${pc(x.sessions.len200.under80Rate)}`); });

  /* ---- sample-maps.json：固定種子挑 3 張有代表性的地圖 ---- */
  const med = IDS.map((r, i) => out.routes[r].exact.bigPrize.median);
  const cand = [];
  for (let seed = 1; seed <= 3000; seed++) {
    const m = EV.genMapSeed(seed);
    const big = m.routes.map(r => EV.bigPrize(r).v);
    const lens = m.routes.map(r => r.nodes.length);
    const dstSeqs = new Set(m.routes.map(r => r.tpl.replace(/[a-z]/g, x => (/[cg]/.test(x) ? 'p' : 'e')))).size;
    cand.push({ seed, m, big, lens, total: lens.reduce((a, b) => a + b, 0), distinct: dstSeqs });
  }
  const dist = c => c.big.reduce((a, v, i) => a + Math.abs(Math.log(v / med[i])), 0);
  const typical = cand.filter(c => c.total >= 23 && c.total <= 25 && c.distinct === 3).sort((a, b) => dist(a) - dist(b))[0] || cand.sort((a, b) => dist(a) - dist(b))[0];
  const shortOne = cand.filter(c => c.seed !== typical.seed && c.lens[0] === 6 && c.lens[2] === 6).sort((a, b) => a.total - b.total || a.seed - b.seed)[0] || cand.sort((a, b) => a.total - b.total)[0];
  const longOne = cand.filter(c => c.seed !== typical.seed && c.seed !== shortOne.seed && c.lens.every(x => x === 9)).sort((a, b) => (b.big[2] + b.big[1]) - (a.big[2] + a.big[1]))[0] || cand.sort((a, b) => b.total - a.total)[0];
  const line = r => r.nodes.map(n => n.kind === 'enemy' ? n.need + '+' : '×' + n.v).join(' → ');
  function dump(label, c) {
    const m = c.m;
    return { label, seed: c.seed, howToRebuild: 'EV.genMapSeed(' + c.seed + ')',
      routes: m.routes.map((r, ri) => { const s = EV.routeStats(r);
        return { id: r.id, hearts: r.hearts, shape: r.shape, tpl: r.tpl, line: line(r),
          stats: { ev: r4(s.ev), p0: r4(s.p0), ge1: r4(s.ge1), ge5: r4(s.ge5), ge20: r4(s.ge20), sd: +s.sd.toFixed(2), reachEnd: r4(s.pEnd), avgRolls: +s.rolls.toFixed(2), biggest: c.big[ri] },
          nodes: r.nodes }; }) };
  }
  const samples = { note: '邏輯結構：map.routes[3]（穩／中／拚）；每條 route 有 hearts（心數）、shape（畫面決定走向用的整數種子）、tpl（樣板，僅供除錯）、nodes[]。節點：id＝route×10＋idx、idx（0 起算，由入口起的順序）、kind(enemy|prize)；enemy 有 need（兩顆骰和 ≥ need 贏）；prize 有 v（倍率）、role、tier(coin|gem|chest)。沒有版面座標，座標由 UI 依 shape 排。',
    maps: [dump('典型（總節點數約 24、三條路大寶物接近中位數）', typical), dump('最短（穩與拚都是 6 個節點）', shortOne), dump('最長（三條路都是 9 個節點，大寶物偏大）', longOne)] };
  fs.writeFileSync(path.join(__dirname, 'sample-maps.json'), JSON.stringify(samples, null, 1));
  console.log('\n樣本地圖：');
  samples.maps.forEach(x => { console.log(`  ${x.label} seed=${x.seed}`); x.routes.forEach(r => console.log(`    ${r.id.padEnd(5)} ${r.hearts}心  ${r.line}`)); });
  console.log(`\n完成（${((Date.now() - t0) / 1000).toFixed(1)}s）→ test/stats.json、test/sample-maps.json`);
}
main().catch(e => { console.error(e); process.exit(2); });
