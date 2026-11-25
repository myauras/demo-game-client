/* 測試用 worker（由 _lib.runJobs 啟動）。workerData.kind：
 *   maps     ：產生 n 張地圖，做精確計算、暴力列舉對帳與結構檢查（mc-test A／C／F／G、stats）
 *   core     ：走 DemoCore.createGame 的 bet→ack 完整流程跑 n 局（mc-test B／D／E／G、stats）
 *   strategy ：玩家先看地圖再選路（挑精確期望值最高的一條）跑 n 局（mc-test F）
 *   poor     ：低餘額下跑 n 局，只收骰子統計（mc-test D：骰子不看餘額）
 *   session  ：玩 sessions 場、每場 len 局，回傳每場拿回比例（stats）
 * 地圖池：pool>0 時先產 pool 張地圖，核心換圖時從池裡取（加速；genMap 本身由 maps 工作驗證）；
 *         pool=0 時核心用真的 genMap 換圖。 */
const { workerData, parentPort } = require('worker_threads');
const { loadGame } = require('./_lib');
const { EV, DemoCore } = loadGame();
const W = workerData;
const CFG = EV.CFG;
const R = EV.mulberry32;

function mkPool(seed, k) {
  const pool = [], rg = R(seed);
  for (let i = 0; i < k; i++) {
    const m = EV.genMap(rg); m.seed = i;
    m._ev = m.routes.map(r => EV.routeEV(r));
    pool.push(m);
  }
  return pool;
}

/* 獨立的暴力列舉：不用 routeDist 的遞推，直接走「贏／輸」兩條分支（勝敗的組合數自己數 36 種骰子），回傳 { 倍率: 機率 } */
function bruteDist(route) {
  const out = {};
  const wins = need => { let c = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= need) c++; return c; };
  (function walk(i, hearts, p, sum) {
    if (i >= route.nodes.length) { const k = Math.round(sum * 100) / 100; out[k] = (out[k] || 0) + p; return; }
    const n = route.nodes[i];
    if (n.kind === 'prize') return walk(i + 1, hearts, p, sum + n.v);
    const w = wins(n.need), pw = w / 36, pl = (36 - w) / 36;
    if (w > 0) walk(i + 1, hearts, p * pw, sum);
    if (w < 36) {
      if (hearts <= 1) { const k = Math.round(sum * 100) / 100; out[k] = (out[k] || 0) + p * pl; }
      else walk(i, hearts - 1, p * pl, sum);
    }
  })(0, route.hearts, 1, 0);
  return out;
}
function grid0(v) { for (const g of CFG.GRID) if (v < g[0]) return g[1]; return 5; }
function onGrid(v) { const g = grid0(v), q = v / g; return Math.abs(q - Math.round(q)) < 1e-9; }

/* ------------------------------------------------------------------ maps */
function jobMaps() {
  const rng = R(W.seed);
  let spreadMax = 0, bruteMaps = 0;
  const S = [0, 1, 2].map(() => ({
    n: 0, evMin: 9, evMax: 0, evSum: 0, bruteGap: 0, p0: 0, ge1: 0, ge5: 0, ge20: 0, sd: 0, pEnd: 0, rolls: 0,
    p0Min: 9, p0Max: -1, ge1Min: 9, ge1Max: -1, ge20Min: 9, ge20Max: -1, lt05: 0, lt05Max: -1, sdMin: 99, sdMax: -1,
    big: [], maxPrize: 0, sumAll: 0, sumAllMax: 0, lenHist: {}, tpl: {}, needHist: {}, nEnemyHist: {},
    structBad: 0, valBad: 0, bandBad: 0, stagBad: 0, tierBad: 0, gridBad: 0, tplBad: 0,
    hiMax: 0, redMax: 0, greenMin: 99, dropMax: 0, spreadMin: 99, meanSum: 0, meanMax: 0, maxNeedSum: 0, minNeedSum: 0,
    firstEnemyHist: {}, rollsMaxBound: 0, badMsg: []
  }));
  for (let i = 0; i < W.n; i++) {
    const map = EV.genMap(rng);
    const evs = [];
    if (map.routes.length !== 3) S[0].structBad++;
    for (let ri = 0; ri < 3; ri++) {
      const s = S[ri], cls = CFG.ROUTES[ri], route = map.routes[ri];
      const bad = m => { if (s.badMsg.length < 4) s.badMsg.push(m); };
      const st = EV.routeStats(route), N = route.nodes, L = N.length;
      s.n++; s.evMin = Math.min(s.evMin, st.ev); s.evMax = Math.max(s.evMax, st.ev); s.evSum += st.ev; evs.push(st.ev);
      s.p0 += st.p0; s.ge1 += st.ge1; s.ge5 += st.ge5; s.ge20 += st.ge20; s.sd += st.sd; s.pEnd += st.pEnd; s.rolls += st.rolls;
      s.p0Min = Math.min(s.p0Min, st.p0); s.p0Max = Math.max(s.p0Max, st.p0);
      s.lt05 += st.lt05; s.lt05Max = Math.max(s.lt05Max, st.lt05);
      s.ge1Min = Math.min(s.ge1Min, st.ge1); s.ge1Max = Math.max(s.ge1Max, st.ge1);
      s.ge20Min = Math.min(s.ge20Min, st.ge20); s.ge20Max = Math.max(s.ge20Max, st.ge20);
      s.sdMin = Math.min(s.sdMin, st.sd); s.sdMax = Math.max(s.sdMax, st.sd);
      s.rollsMaxBound = Math.max(s.rollsMaxBound, st.maxRolls);
      // 暴力列舉對帳（每 8 張圖一次）
      if (i % 8 === 0) {
        const bd = bruteDist(route), d = EV.routeDist(route).D;
        let gap = 0, evb = 0;
        d.forEach(x => { gap = Math.max(gap, Math.abs((bd[x[0]] || 0) - x[1])); });
        Object.keys(bd).forEach(k => { evb += (+k) * bd[k]; if (!d.some(x => Math.abs(x[0] - +k) < 1e-9)) gap = Math.max(gap, bd[k]); });
        gap = Math.max(gap, Math.abs(evb - st.ev));
        s.bruteGap = Math.max(s.bruteGap, gap); if (ri === 0) bruteMaps++;
      }
      // 結構
      if (route.id !== cls.id || route.index !== ri || route.hearts !== cls.hearts || !Number.isInteger(route.shape) || route.shape < 0) { s.structBad++; bad('route 欄位'); }
      if (L < CFG.NODES_MIN || L > CFG.NODES_MAX) { s.structBad++; bad('節點數 ' + L); }
      s.lenHist[L] = (s.lenHist[L] || 0) + 1;
      const last = N[L - 1], jv = last.v;
      if (last.kind !== 'prize') { s.structBad++; bad('最後不是寶物'); }
      let prizeSum = 0, needs = [], bigOk = true;
      N.forEach((n, k) => {
        if (n.id !== ri * 10 + k || n.idx !== k || n.route !== ri) { s.structBad++; bad('id／idx'); }
        if (n.kind === 'enemy') {
          if (!Number.isInteger(n.need) || n.need < CFG.NEED_MIN || n.need > CFG.NEED_MAX) { s.structBad++; bad('need 範圍 ' + n.need); }
          needs.push(n.need);
          s.needHist[n.need] = (s.needHist[n.need] || 0) + 1;
        } else if (n.kind === 'prize') {
          prizeSum += n.v;
          if (k < L - 1 && n.v >= jv - 1e-9) bigOk = false;
          if (n.v > CFG.MAX_PRIZE_X + 1e-9) s.valBad++;
          const vr = cls.val[n.role];
          if (!vr || n.v < vr[0] - 1e-9 || n.v > vr[1] + 1e-9) { s.valBad++; bad('val 範圍'); }
          if (!onGrid(n.v)) s.gridBad++;
          if (n.tier !== (n.v < 1 ? 'coin' : n.v < 10 ? 'gem' : 'chest')) s.tierBad++;
        } else s.structBad++;
      });
      if (!bigOk) { s.structBad++; bad('J 不是嚴格最大'); }
      s.sumAll += prizeSum; s.sumAllMax = Math.max(s.sumAllMax, prizeSum);
      s.maxPrize = Math.max(s.maxPrize, jv);
      s.big.push(jv);
      // 樣板對得上
      const ts = route.tpl;
      if (cls.tpl[route.tplIndex] !== ts || ts.length !== L) { s.tplBad++; }
      else for (let k = 0; k < L; k++) {
        const ch = ts[k], n = N[k];
        if (cls.need[ch]) { if (n.kind !== 'enemy' || n.need < cls.need[ch][0] || n.need > cls.need[ch][1]) s.tplBad++; }
        else if (n.kind !== 'prize' || n.role !== ch) s.tplBad++;
      }
      s.tpl[ts] = (s.tpl[ts] || 0) + 1;
      // 目標帶（每張圖）
      for (const bk in cls.band) {
        const lim = cls.band[bk], x = bk === 'jmin' ? jv : st[bk];
        if (x < lim[0] - 1e-9 || x > lim[1] + 1e-9) { s.bandBad++; bad('band ' + bk + '=' + x); }
      }
      // 門檻錯落
      if (!EV.staggerOK(needs, cls.stag)) { s.stagBad++; bad('stag ' + needs.join(',')); }
      s.nEnemyHist[needs.length] = (s.nEnemyHist[needs.length] || 0) + 1;
      let hi = 0, red = 0, green = 0, drop = 0, mx = 0, mn = 99, sum = 0;
      needs.forEach((x, a) => { if (x >= cls.stag.high) hi++; if (x >= cls.stag.red) red++; if (x <= cls.stag.green) green++; mx = Math.max(mx, x); mn = Math.min(mn, x); sum += x; for (let b = a + 1; b < needs.length; b++) drop = Math.max(drop, x - needs[b]); });
      s.hiMax = Math.max(s.hiMax, hi); s.redMax = Math.max(s.redMax, red); s.greenMin = Math.min(s.greenMin, green);
      s.dropMax = Math.max(s.dropMax, drop); s.spreadMin = Math.min(s.spreadMin, mx - mn);
      s.meanSum += sum / needs.length; s.meanMax = Math.max(s.meanMax, sum / needs.length);
      s.maxNeedSum += mx; s.minNeedSum += mn;
      const fe = needs[0]; s.firstEnemyHist[fe] = (s.firstEnemyHist[fe] || 0) + 1;
    }
    spreadMax = Math.max(spreadMax, Math.max.apply(null, evs) - Math.min.apply(null, evs));
  }
  parentPort.postMessage({ n: W.n, S, spreadMax, bruteMaps });
}

/* ------------------------------------------------------------------ core */
function newTally() {
  return {
    die1: new Float64Array(7), die2: new Float64Array(7), sums: new Float64Array(13),
    needN: new Float64Array(13), needW: new Float64Array(13),
    retryN: new Float64Array(13), retryW: new Float64Array(13),      // 同一隻打輸後的重打（第二擲起）
    firstN: new Float64Array(13), firstW: new Float64Array(13),      // 這隻的第一擲
    n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0                       // 兩顆骰的相關係數
  };
}
function tally(T, f, first) {
  const a = f.dice[0], b = f.dice[1];
  T.die1[a]++; T.die2[b]++; T.sums[a + b]++;
  T.needN[f.need]++; if (f.win) T.needW[f.need]++;
  if (first) { T.firstN[f.need]++; if (f.win) T.firstW[f.need]++; } else { T.retryN[f.need]++; if (f.win) T.retryW[f.need]++; }
  T.n++; T.sx += a; T.sy += b; T.sxx += a * a; T.syy += b * b; T.sxy += a * b;
}
const packT = T => { const o = {}; for (const k in T) o[k] = T[k] instanceof Float64Array ? Array.from(T[k]) : T[k]; return o; };

function jobCore() {
  const ri = EV.routeIndex(W.route), stake = W.stake, N = W.n;
  const rnd = R(W.seed);
  const pool = W.pool > 0 ? mkPool(W.seed ^ 0x5bd1e995, W.pool) : null;
  const game = DemoCore.createGame({
    storage: false, rng: rnd, wallet: Number.MAX_SAFE_INTEGER / 4,
    mapSource: pool ? (seed => pool[seed % pool.length]) : undefined
  });
  let res = null, rec = null;
  game.on((t, d) => { if (t === 'result') res = d.result; else if (t === 'settled') rec = d; });
  const T = newTally();
  const o = { n: 0, sum: 0, sumsq: 0, thSum: 0, ge0: 0, ge1: 0, ge5: 0, ge20: 0, maxX: 0, prizeSum: 0, rollSum: 0, ge6rolls: 0,
    reachEnd: 0, heartsLeftSum: 0, maxTotalX: 0, maxRolls: 0, boundBad: 0, rollsBoundBad: 0, bad: 0, badMsg: [], maxPrizeAny: 0,
    rollsHist: {}, nodesHist: {}, tooManyPrize: 0 };
  const bad = m => { o.bad++; if (o.badMsg.length < 5) o.badMsg.push(m); };
  const routeSum = new Map();
  for (let g = 0; g < N; g++) {
    const map0 = game.getState().map;
    if (!game.bet(W.route, stake)) { bad('bet 失敗'); break; }
    const r = res;
    if (r.map !== map0) bad('結果用的地圖不是下注當下的那張');
    game.ack();
    const x = rec.payout / stake, route = map0.routes[ri];
    o.n++; o.sum += x; o.sumsq += x * x;
    o.thSum += pool ? map0._ev[ri] : EV.routeEV(route);
    if (x > 0) o.ge0++; if (x >= 1) o.ge1++; if (x >= CFG.MID_X) o.ge5++; if (x >= CFG.BIG_X) o.ge20++;
    if (r.totalX > o.maxTotalX) o.maxTotalX = r.totalX;
    o.prizeSum += r.prizes.length; o.rollSum += r.fights.length;
    if (r.fights.length >= 6) o.ge6rolls++;
    o.rollsHist[r.fights.length] = (o.rollsHist[r.fights.length] || 0) + 1;
    if (r.reachedEnd) o.reachEnd++;
    o.heartsLeftSum += r.heartsLeft;
    if (r.fights.length > o.maxRolls) o.maxRolls = r.fights.length;
    // 極值（G）：一局最高倍數不超過這條路所有寶物倍率總和；擲骰次數不超過 敵人數＋心數−1
    let rs = routeSum.get(route); if (rs == null) { rs = route.nodes.reduce((a, n) => a + (n.kind === 'prize' ? n.v : 0), 0); routeSum.set(route, rs); }
    if (r.totalX > rs + 1e-9) o.boundBad++;
    const nEn = route.nodes.filter(n => n.kind === 'enemy').length;
    if (r.fights.length > nEn + route.hearts - 1) o.rollsBoundBad++;
    r.prizes.forEach(p => { if (p.v > o.maxPrizeAny) o.maxPrizeAny = p.v; });
    // —— 演出自洽（E）——
    let sm = 0, am = 0, nRollEv = 0, hearts = r.hearts, ended = false, retreated = false, pos = -1, fi = 0, pi = 0;
    r.prizes.forEach(p => { am += p.amount; });
    if (am !== r.total || rec.payout !== r.total || !Number.isInteger(r.total)) bad('金額加總 ≠ total');
    if (Math.abs(r.totalX * stake - r.total) > 1e-6) bad('total ≠ totalX×注額');
    r.events.forEach((e, k) => {
      if (ended) bad('end 之後還有事件');
      if (retreated && e.k !== 'end') bad('撤退之後還有事件 ' + e.k);
      if (e.k === 'move') {
        if (e.from !== pos || e.to !== pos + 1) bad('move 不連續');
        pos = e.to;
      } else if (e.k === 'prize') {
        const p = r.prizes[pi++];
        if (!p || p.idx !== pos || route.nodes[pos].kind !== 'prize' || route.nodes[pos].v !== e.v || p.id !== e.id) bad('prize 事件不對');
        sm = EV.r2(sm + e.v);
      } else if (e.k === 'roll') {
        const f = r.fights[fi++];
        nRollEv++;
        if (!f || f.idx !== pos || route.nodes[pos].kind !== 'enemy' || route.nodes[pos].need !== e.need || e.need !== f.need) bad('roll 事件不對');
        if (e.sum !== e.dice[0] + e.dice[1] || e.win !== (e.sum >= e.need)) bad('roll 判定不對');
        if (e.dice.some(d => !(d >= 1 && d <= 6 && Number.isInteger(d)))) bad('骰面超出 1～6');
        if (!e.win) hearts--;
        if (e.heartsLeft !== hearts) bad('心數不對');
        if (f.win !== e.win || f.sum !== e.sum || f.heartsLeft !== e.heartsLeft || f.dice[0] !== e.dice[0] || f.dice[1] !== e.dice[1]) bad('fights 與 events 不一致');
        if (hearts < 0) bad('心數為負');
      } else if (e.k === 'retreat') {
        retreated = true;
        if (hearts !== 0 || e.heartsLeft !== 0) bad('撤退時心不是 0');
      } else if (e.k === 'end') {
        ended = true;
        if (k !== r.events.length - 1) bad('end 不是最後');
        if (e.total !== r.total || e.totalX !== r.totalX || e.reachedEnd !== r.reachedEnd) bad('end 內容不符');
      } else bad('未知事件 ' + e.k);
      // 打贏才前進：move 到下一個節點之前，前一個敵人的最後一擲必須是贏
      if (e.k === 'move' && pos > 0 && route.nodes[pos - 1].kind === 'enemy') {
        const lastRoll = r.fights.filter(f => f.idx === pos - 1).pop();
        if (!lastRoll || !lastRoll.win) bad('沒打贏就前進');
      }
    });
    if (fi !== r.fights.length) bad('fights 筆數 ≠ roll 事件數');
    if (pi !== r.prizes.length) bad('prizes 筆數 ≠ prize 事件數');
    if (Math.abs(sm - r.totalX) > 1e-9) bad('事件寶物加總 ≠ totalX');
    if (r.reachedEnd !== (pos === route.nodes.length - 1 && !retreated)) bad('reachedEnd 不符');
    if (r.reachedEnd && hearts !== r.heartsLeft) bad('heartsLeft 不符');
    if (!r.reachedEnd && r.heartsLeft !== 0) bad('撤退但心不是 0');
    if (!ended) bad('沒有 end');
    // 注單摘要
    if (rec.rec.nRolls !== r.fights.length || rec.rec.rolls.length !== r.fights.length) bad('注單 rolls 筆數');
    if (rec.rec.heartsLeft !== r.heartsLeft || rec.rec.reachedEnd !== r.reachedEnd || rec.rec.mults.length !== r.prizes.length) bad('注單欄位不符');
    // 骰子統計（D）：同一隻的第一擲與重打分開記
    const seen = new Set();
    r.fights.forEach(f => { tally(T, f, !seen.has(f.idx)); seen.add(f.idx); });
  }
  parentPort.postMessage({ o, T: packT(T) });
}

/* -------------------------------------------------------------- strategy */
function jobStrategy() {
  const rnd = R(W.seed), stake = 100;
  const pool = mkPool(W.seed ^ 0x7f4a7c15, W.pool || 500);
  const game = DemoCore.createGame({ storage: false, rng: rnd, wallet: Number.MAX_SAFE_INTEGER / 4,
    mapSource: seed => pool[seed % pool.length] });
  let rec = null;
  game.on((t, d) => { if (t === 'settled') rec = d; });
  const o = { n: 0, sum: 0, sumsq: 0, thSum: 0, pick: [0, 0, 0] };
  for (let g = 0; g < W.n; g++) {
    const m = game.getState().map;
    let best = 0;
    for (let ri = 1; ri < 3; ri++) if (m._ev[ri] > m._ev[best]) best = ri;
    o.pick[best]++; o.thSum += m._ev[best];
    game.bet(CFG.ROUTES[best].id, stake); game.ack();
    const x = rec.payout / stake; o.n++; o.sum += x; o.sumsq += x * x;
  }
  parentPort.postMessage({ o });
}

/* ------------------------------------------------------------------ poor */
function jobPoor() {
  const rnd = R(W.seed), stake = 100;
  const pool = mkPool(W.seed ^ 0x2545f491, 300);
  const game = DemoCore.createGame({ storage: false, rng: rnd, wallet: W.wallet,
    mapSource: seed => pool[seed % pool.length] });
  let res = null;
  game.on((t, d) => { if (t === 'result') res = d.result; });
  const T = newTally();
  let played = 0;
  for (let g = 0; g < W.n; g++) {
    if (game.getState().wallet < stake) game.addMoney(W.wallet - game.getState().wallet);      // 餘額快見底就補回（導演台加錢），維持低餘額
    const route = CFG.ROUTES[g % 3].id;
    if (!game.bet(route, stake)) break;
    const seen = new Set();
    res.fights.forEach(f => { tally(T, f, !seen.has(f.idx)); seen.add(f.idx); });
    game.ack(); played++;
  }
  parentPort.postMessage({ T: packT(T), played });
}

/* --------------------------------------------------------------- session */
function jobSession() {
  const ri = EV.routeIndex(W.route), stake = W.stake, rnd = R(W.seed);
  const pool = mkPool(W.seed ^ 0x9e3779b9, W.pool || 600);
  const rets = new Float32Array(W.sessions);
  for (let s = 0; s < W.sessions; s++) {
    let back = 0;
    for (let g = 0; g < W.len; g++) {
      const m = pool[Math.floor(rnd() * pool.length)];
      back += DemoCore.simulate(m, ri, stake, rnd).total;
    }
    rets[s] = back / (W.len * stake);
  }
  parentPort.postMessage({ rets: Array.from(rets) });
}

({ maps: jobMaps, core: jobCore, strategy: jobStrategy, poor: jobPoor, session: jobSession })[W.kind]();
