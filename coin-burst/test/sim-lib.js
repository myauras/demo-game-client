/* =========================================================================
 * 爆金連鎖——模擬共用函式庫（mc-test.js 與 mc-worker.js 共用；無頂層 'use strict'）
 * 規則程式不是另外抄一份：一律 eval values.js 取得 EV。
 * v2：能量條（每 RAIN_EVERY 注一場全盤金幣雨）；丟法多了 smart（會養盤的人）。
 * v2.3：連鎖獎池（每注存 POT_ADD、玩家自己炸到 POT_CHAIN 格或下雨就整個拿走）；丟法多了 builder（養盤到能炸 POT_CHAIN 格才引爆）。
 *   獎池金額一律用「實付整數」累加（面額 DENOM_DEFAULT 的 PAY.pot／注）；拿回倍數＝噴出的 pay ＋ 拿走的獎池÷面額。
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

/* 載入 values.js。opts.skipStartCheck＝找起始盤面種子時用（種子還沒填，略過自我檢查）。
   直接 eval 在函式作用域：values.js 的 var EV／DEMO_KEY 落在這裡 */
function loadEV(opts){
  let src = fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8');
  if(opts && opts.skipStartCheck) src = 'var EV_SKIP_START_CHECK = true;\n' + src;
  eval(src);
  return EV;
}

const SMART_LEFT = 12;                            // smart 丟法：能量條快滿的最後 12 注（left≤12）改養盤；與能量條長度無關

/* ---- 五種丟法（strategy rng 與抽獎 rng 分開，所以五種丟法吃到同一串抽獎亂數）
   丟法簽名 (b, r, left)：left＝這一注之後、金幣雨那一注之前還剩幾注（能量條 RAIN_EVERY−1−已丟數；0＝這一注就是金幣雨那注） ---- */
function makeStrategies(EV){
  const N = EV.N;
  const rnd = (r) => Math.floor(r() * N);
  const cellsAt = (b, h) => { const a = []; for(let i = 0; i < N; i++) if(b.h[i] === h) a.push(i); return a; };
  const threes = (b) => cellsAt(b, EV.CFG.CAP - 1);
  const gold = (b, r) => { const t = threes(b); return t.length ? t[Math.floor(r() * t.length)] : rnd(r); };
  /* 快滿格（疊 3 枚）裡「連爆格數最多」的那格（同分取編號小的）；沒有快滿格＝{ cell:-1, top:-1 } */
  const bestTop = (b) => {
    let cell = -1, top = -1;
    for(const i of threes(b)){ const p = EV.probe(b, i); if(p.topples > top){ top = p.topples; cell = i; } }
    return { cell, top };
  };
  return {
    // 隨機丟
    random: (b, r) => rnd(r),
    // 有快滿格（疊 3 枚）就點快滿格（隨便一個），否則隨機
    gold: (b, r) => gold(b, r),
    // 每次挑「這一下噴出最多」的格（所有快滿格試算；其餘格丟下去不會爆，不必試），同分比連爆格數，再同分隨機
    greedy: (b, r) => {
      const t = threes(b);
      if(!t.length) return rnd(r);
      let best = [], bs = -1;
      for(const i of t){
        const p = EV.probe(b, i), s = p.exitCount * 1000 + p.topples;
        if(s > bs){ bs = s; best = [i]; } else if(s === bs) best.push(i);
      }
      return best[Math.floor(r() * best.length)];
    },
    // 會養盤的人（照 reports/sim-bonus.mjs）：平常同 gold；能量條快滿的 left≤SMART_LEFT（12）那幾注改丟 2 枚的格子
    // （其次 1 枚、0 枚），把盤面疊成快滿、先不引爆，等金幣雨一次炸；都沒有才退回 gold
    smart: (b, r, left) => {
      if(left !== undefined && left <= SMART_LEFT){
        for(const want of [2, 1, 0]){ const t = cellsAt(b, want); if(t.length) return t[Math.floor(r() * t.length)]; }
      }
      return gold(b, r);
    },
    // 養盤到門檻才引爆（照 reports/sim-pot.mjs「養盤到門檻才引爆」）：有快滿格能炸到 POT_CHAIN 格以上就引爆（挑炸最多的）；
    // 否則把幣丟在 2 枚的格子（其次 1 枚、0 枚）養盤；都沒得養（全盤都是 3 枚）才被迫引爆
    builder: (b, r) => {
      const x = bestTop(b);
      if(x.cell >= 0 && x.top >= EV.POT_CHAIN) return x.cell;
      for(const want of [2, 1, 0]){ const t = cellsAt(b, want); if(t.length) return t[Math.floor(r() * t.length)]; }
      return x.cell >= 0 ? x.cell : rnd(r);
    }
  };
}
const STRAT_NAMES = ['random', 'greedy', 'gold', 'smart', 'builder'];
const STRAT_LABEL = { random: '隨機丟', greedy: '每次挑最會爆的格', gold: '有快滿格就點快滿格否則隨機', smart: '會養盤（能量條快滿時改丟 2 枚格）',
                      builder: '養盤到能炸到獎池門檻才引爆（否則丟 2 枚格）' };

const EPS = 1e-9;
const quant = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

/* 「這一注玩家自己那枚炸幾格」的分桶（拿回對照用）：沒炸／1 格／2～4／5～(POT_CHAIN−1)／POT_CHAIN 以上 */
function buckets(EV){
  const pc = EV.POT_CHAIN;
  return [
    { id: 'b0', label: '沒炸', test: (t) => t === 0 },
    { id: 'b1', label: '1 格', test: (t) => t === 1 },
    { id: 'b2_4', label: '2～4 格', test: (t) => t >= 2 && t <= 4 },
    { id: 'b5_x', label: '5～' + (pc - 1) + ' 格', test: (t) => t >= 5 && t < pc },
    { id: 'bPot', label: pc + ' 格以上', test: (t) => t >= pc }
  ];
}

/* ---- 長跑：從預設面額的起始盤面開始連丟 n 注（能量條、獎池從 0 開始），逐注核對 ---- */
function longRun(EV, name, n, kindSeed, stratSeed){
  const N = EV.N, pick = makeStrategies(EV)[name], pr = EV.rng(stratSeed), kr = EV.rng(kindSeed);
  const di = EV.CFG.DENOM_DEFAULT, DEN = EV.CFG.DENOMS[di], ADD = Math.round(EV.CFG.DENOMS[di] * EV.CFG.POT_ADD);   // 獎池每注存的實付（整數）
  const b = EV.startBoard(di);
  const T = EV.CFG.TIERS, RE = EV.RAIN_EVERY, PC = EV.POT_CHAIN, BK = buckets(EV);
  const startVal = EV.boardValue(b), startTotal = EV.total(b), startCoins = startTotal;
  let bv = startVal, maxBv = startVal, tot = startTotal, sumTot = 0, minTot = startTotal, maxTot = startTotal;
  let gotExit = 0, rolled = 0, maxPay = 0, maxPayNR = 0, hit = 0, anyExit = 0, exits1 = 0, nNR = 0, anyPay = 0;
  const m = { back: 0, big: 0, huge: 0 }, mNR = { back: 0, big: 0, huge: 0 }, heights = [0, 0, 0, 0];
  let anyExitNR = 0;
  let boundViolations = 0, worstSlack = Infinity, meter = 0, rainCount = 0, rainBad = 0, rainCoinsIn = 0;
  const rainPays = [];
  const inK = { coin: 0, diamond: 0, crown: 0 }, outK = { coin: 0, diamond: 0, crown: 0 };
  /* 獎池 */
  let pot = 0, shadow = 0, potIn = 0, potWonCash = 0, potBad = 0, potBy = { chain: 0, rain: 0, both: 0 }, potMaxBefore = 0, potMaxRest = 0, lastTake = 0;
  const gaps = [], potAmts = [], takeTotals = [];
  const bk = BK.map(() => ({ n: 0, vals: [] }));
  for(let d = 1; d <= n; d++){
    const left = RE - 1 - meter, mt = EV.meterAfter(meter), bh = b.h;
    for(let j = 0; j < N; j++) heights[bh[j]]++;                               // 玩家下注前看到的盤面
    const res = EV.play(b, pick(b, pr, left), kr, { rec: false, rain: mt.rain });
    meter = mt.meter;
    if(!!res.rain !== (d % RE === 0)) rainBad++;                              // 每 RE 注恰一次、且正好在第 RE、2RE… 注
    if(res.rain){ rainCount++; rainPays.push(res.rain.pay); rainCoinsIn += res.rain.coins; }
    /* 獎池：EV.potAfter 與「測試自己另外累加的整數影子」逐注核對（拿獎池的時機只有 main.topples≥POT_CHAIN 與下雨兩種） */
    const pa = EV.potAfter(pot, res, di);
    const byChain = res.main.topples >= PC, byRain = !!res.rain, cond = byChain || byRain;
    shadow += ADD;
    const sWin = cond ? shadow : 0; if(cond) shadow = 0;
    if(pa.add !== ADD || pa.win !== sWin || pa.pot !== shadow || (pa.win > 0) !== cond || pa.by !== (byChain ? 'chain' : byRain ? 'rain' : null)) potBad++;
    const potBefore = pot; pot = pa.pot;
    potIn += pa.add;
    if(pot > potMaxRest) potMaxRest = pot;
    if(potBefore + pa.add > potMaxBefore) potMaxBefore = potBefore + pa.add;
    const pw = pa.win / DEN, pay = res.pay + pw;                              // pay＝這一注含獎池的拿回（倍面額）
    if(pa.win > 0){
      potWonCash += pa.win; gaps.push(d - lastTake); lastTake = d; potAmts.push(pw); takeTotals.push(pay);
      if(byChain && byRain) potBy.both++; else if(byChain) potBy.chain++; else potBy.rain++;
    }
    // 極值上界：這一注拿回（含獎池）≤ 這一注之前盤面上所有東西的面值＋這一注進場東西的面值（含金幣雨的免費幣）＋這一注入池後的獎池
    const cap = bv + res.inValue + (potBefore + pa.add) / DEN, slack = cap - pay;
    if(slack < -1e-7) boundViolations++;
    if(slack < worstSlack) worstSlack = slack;
    bv = bv + res.inValue - res.pay; if(bv > maxBv) maxBv = bv;              // 盤面面值（獎池不在盤面上）
    gotExit += res.pay; rolled += res.inValue;
    inK.coin += res.enter.coin; inK.diamond += res.enter.diamond; inK.crown += res.enter.crown;
    outK.coin += res.exits.coin; outK.diamond += res.exits.diamond; outK.crown += res.exits.crown;
    tot += res.enter.coin + res.enter.diamond + res.enter.crown - res.exitCount;
    sumTot += tot; if(tot < minTot) minTot = tot; if(tot > maxTot) maxTot = tot;
    if(pay > maxPay) maxPay = pay;
    if(res.topples) hit++;
    if(res.exitCount) anyExit++;
    if(pay > EPS) anyPay++;
    if(res.exitCount === 1) exits1++;
    if(pay + EPS >= T.BACK) m.back++;
    if(pay + EPS >= T.BIG) m.big++;
    if(pay + EPS >= T.HUGE) m.huge++;
    if(!res.rain){                                                             // 不含金幣雨那一注（rain 那注一次拿十幾倍，會把大獎比例墊高）
      nNR++;
      if(pay > maxPayNR) maxPayNR = pay;
      if(res.exitCount) anyExitNR++;
      if(pay + EPS >= T.BACK) mNR.back++;
      if(pay + EPS >= T.BIG) mNR.big++;
      if(pay + EPS >= T.HUGE) mNR.huge++;
      const t = res.main.topples;                                              // 「這一注炸幾格 → 拿回」對照（不含金幣雨那一注）
      for(let k = 0; k < BK.length; k++) if(BK[k].test(t)){ bk[k].n++; bk[k].vals.push(pay); break; }
    }
  }
  const gemsOn = { diamond: 0, crown: 0 };
  for(let i = 0; i < N; i++) for(const k of b.g[i]) gemsOn[k]++;
  const endTotal = EV.total(b), coinsOn = endTotal - gemsOn.diamond - gemsOn.crown;
  const endVal = EV.boardValue(b), hs = heights[0] + heights[1] + heights[2] + heights[3];
  const gotAll = gotExit + potWonCash / DEN;                                   // 總拿回（倍面額）＝噴出的 ＋ 獎池
  for(const a of [gaps, potAmts, takeTotals, rainPays]) a.sort((x, y) => x - y);
  const ql = (a) => ({ count: a.length, p10: quant(a, 0.1), p50: quant(a, 0.5), p90: quant(a, 0.9), max: a.length ? a[a.length - 1] : 0, min: a.length ? a[0] : 0, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0 });
  const bucketTable = BK.map((k, i) => { const v = bk[i].vals; v.sort((x, y) => x - y); return { id: k.id, label: k.label, n: v.length, share: v.length / nNR, p50: quant(v, 0.5), p90: quant(v, 0.9), avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0 }; });
  return {
    name, n, got: gotExit, gotAll, rolled, rtp: gotAll / n, rtpExit: gotExit / n, rolledRtp: rolled / n,
    startTotal, startCoins, startVal, endVal, trackedEndVal: bv, maxBv, endTotal, trackedTotal: tot, coinsOn, gemsOn,
    avgTot: sumTot / n, minTot, maxTot, maxPay, maxPayNR,
    hit: hit / n, anyExit: anyExit / n, anyPay: anyPay / n, exits1: exits1 / n, anyExitNR: anyExitNR / nNR,
    back: m.back / n, big: m.big / n, huge: m.huge / n,
    backNR: mNR.back / nNR, bigNR: mNR.big / nNR, hugeNR: mNR.huge / nNR,
    heights: heights.map(x => x / hs), rainCount, rainBad, rainCoinsIn, rainStats: ql(rainPays), meterEnd: meter,
    inK, outK, boundViolations, worstSlack,
    pot: { add: ADD, denom: DEN, potIn, potWonCash, potEnd: pot, shadowEnd: shadow, potBad, takes: gaps.length, by: potBy, maxBefore: potMaxBefore, maxRest: potMaxRest,
           gaps: ql(gaps), potAmounts: ql(potAmts), takeTotals: ql(takeTotals) },
    buckets: bucketTable
  };
}

/* ---- 演出自洽：只讀 play 回傳的分波結果重播，與核心改完的盤面逐格比對 ---- */
function replayWaves(h, g, waves, exitTally){
  for(const w of waves){
    for(const c of w.cells) h[c] -= 4;
    for(const mv of w.moves){                      // 先全部離格（寶物離格），再發放
      if(mv.kind !== 'coin'){ const k = g[mv.from].indexOf(mv.kind); if(k < 0) return false; g[mv.from].splice(k, 1); }
    }
    for(const mv of w.moves){
      if(mv.to < 0) exitTally[mv.kind]++;
      else { h[mv.to]++; if(mv.kind !== 'coin') g[mv.to].push(mv.kind); }
    }
  }
  return true;
}
function replayCheck(EV, name, n, kindSeed, stratSeed){
  const N = EV.N, pick = makeStrategies(EV)[name], pr = EV.rng(stratSeed), kr = EV.rng(kindSeed), RE = EV.RAIN_EVERY;
  const di = EV.CFG.DENOM_DEFAULT, b = EV.startBoard(di);
  let boardBad = 0, exitBad = 0, cashBad = 0, payBad = 0, waveBad = 0, plays = 0, maxWaves = 0, rains = 0, rainShapeBad = 0, meter = 0, potBad = 0, pot = 0, potTakes = 0;
  for(let d = 0; d < n; d++){
    const h = b.h.slice(), g = b.g.map(x => x.slice());
    const left = RE - 1 - meter, mt = EV.meterAfter(meter);
    const res = EV.play(b, pick(b, pr, left), kr, { rain: mt.rain });        // rec 預設為真，帶完整分波
    meter = mt.meter;
    plays++;
    // 重播：玩家那一枚 → 連鎖；金幣雨：fall 列的格子各 +1（同時）→ 連鎖
    const tally = { coin: 0, diamond: 0, crown: 0 };
    h[res.main.cell]++; if(res.main.kind !== 'coin') g[res.main.cell].push(res.main.kind);
    let ok = replayWaves(h, g, res.main.waves, tally);
    const mainTally = { coin: tally.coin, diamond: tally.diamond, crown: tally.crown };
    if(res.rain){
      rains++;
      const f = res.rain.fall;
      if(!Array.isArray(f) || f.length !== N || f.some((c, j) => c !== j) || res.rain.coins !== N) rainShapeBad++;
      for(const c of f) h[c]++;
      ok = ok && replayWaves(h, g, res.rain.waves, tally);
    }
    if(!ok || JSON.stringify(h) !== JSON.stringify(b.h) || JSON.stringify(g) !== JSON.stringify(b.g)) boardBad++;
    // 噴出枚數與金額加總相符（每個面額都核）
    if(tally.coin !== res.exits.coin || tally.diamond !== res.exits.diamond || tally.crown !== res.exits.crown) exitBad++;
    let wsum = 0, tp = 0;
    for(const part of [res.main, res.rain]) if(part){ for(const w of part.waves){ wsum += w.exitCount; tp += w.cells.length; if(w.moves.length !== 4 * w.cells.length) waveBad++; } if(part.waves.length > maxWaves) maxWaves = part.waves.length; }
    if(wsum !== res.exitCount || tp !== res.topples) waveBad++;
    for(let k = 0; k < EV.PAY.length; k++){
      const p = EV.PAY[k];
      if(EV.cash(res, k) !== tally.coin * p.coin + tally.diamond * p.diamond + tally.crown * p.crown) cashBad++;
    }
    const expectPay = tally.coin * EV.VALUE.coin + tally.diamond * EV.VALUE.diamond + tally.crown * EV.VALUE.crown;
    if(Math.abs(expectPay - res.pay) > 1e-9) payBad++;
    // 獎池：用「重播出來的玩家那一枚炸幾格（各波炸開格數加總）」與「有沒有雨」重新判斷，對照 EV.potAfter
    let mainTopples = 0; for(const w of res.main.waves) mainTopples += w.cells.length;
    const pa = EV.potAfter(pot, res, di), want = mainTopples >= EV.POT_CHAIN || res.rain !== null;
    if((pa.win > 0) !== want || (want && pa.win !== pot + pa.add) || (!want && pa.pot !== pot + pa.add) || (want && pa.pot !== 0) || mainTally.coin + mainTally.diamond + mainTally.crown !== res.main.exitCount) potBad++;
    if(pa.win > 0) potTakes++;
    pot = pa.pot;
  }
  return { name, plays, rains, rainShapeBad, boardBad, exitBad, cashBad, payBad, waveBad, maxWaves, potBad, potTakes };
}

/* ---- 短時間體感：每場都是新玩家從起始盤面開始、能量條與獎池從 0，丟到 500 注；回報 50／100／200／500 注時的拿回比例（含獎池） ---- */
const MARKS = [50, 100, 200, 500];
function sessions(EV, name, count, seed){
  const pick = makeStrategies(EV)[name], pr = EV.rng(seed * 2 + 1), kr = EV.rng(seed * 2 + 2), RE = EV.RAIN_EVERY;
  const di = EV.CFG.DENOM_DEFAULT, DEN = EV.CFG.DENOMS[di];
  const main = MARKS.map(() => new Float64Array(count));
  const rainSeen = MARKS.map(() => new Uint8Array(count));                       // 到這一標記時有沒有已經下過金幣雨
  const potSeen = MARKS.map(() => new Uint8Array(count));                        // 到這一標記時有沒有已經拿過獎池（任何金額；新盤面第一注就可能炸到門檻、只拿到那一注存的 0.15）
  const potBigSeen = MARKS.map(() => new Uint8Array(count));                     // 到這一標記時有沒有拿過「≥1 倍面額」的獎池（有感的獎池）
  for(let s = 0; s < count; s++){
    const b = EV.startBoard(di);
    let got = 0, meter = 0, rains = 0, pot = 0, takes = 0, bigTakes = 0;
    for(let d = 1; d <= 500; d++){
      const left = RE - 1 - meter, mt = EV.meterAfter(meter);
      const res = EV.play(b, pick(b, pr, left), kr, { rec: false, rain: mt.rain });
      meter = mt.meter; if(res.rain) rains++;
      const pa = EV.potAfter(pot, res, di); pot = pa.pot; if(pa.win > 0) takes++; if(pa.win >= DEN) bigTakes++;
      got += res.pay + pa.win / DEN;
      const mi = MARKS.indexOf(d);
      if(mi >= 0){ main[mi][s] = got / d; rainSeen[mi][s] = rains > 0 ? 1 : 0; potSeen[mi][s] = takes > 0 ? 1 : 0; potBigSeen[mi][s] = bigTakes > 0 ? 1 : 0; }
    }
  }
  return { name, count, main, rainSeen, potSeen, potBigSeen };
}

module.exports = { loadEV, makeStrategies, STRAT_NAMES, STRAT_LABEL, longRun, replayCheck, sessions, MARKS, SMART_LEFT, buckets, quant };
