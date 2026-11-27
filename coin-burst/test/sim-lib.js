/* =========================================================================
 * 爆金連鎖——模擬共用函式庫（v3：另有刷新／換金額套利模擬，見檔尾）（mc-test.js 與 mc-worker.js 共用；無頂層 'use strict'）
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

/* =========================================================================
 * v3 新增：刷新套利、刷新冷卻比較、單一盤面換金額套利
 * 共同約定：抽獎 rng（kindSeed）一注只取一次，與丟法、刷新（refSeed）的亂數分開，
 * 所以「同 kindSeed」的不同刷新／換金額丟法吃到同一串「是不是寶物、什麼時候下雨」。
 * ========================================================================= */
const countGems = (b) => { const o = { diamond: 0, crown: 0 }; for(const x of b.g) for(const k of x) o[k]++; return o; };
const sameGems = (a, b) => a.diamond === b.diamond && a.crown === b.crown;

/* 「有能炸到獎池門檻（8 格）的格子就點炸最多的那格，否則快滿就點（gold）」 */
function p8gold(EV, S, b, r){
  const c = EV.chainBest(b);
  if(c.cell >= 0 && c.topples >= EV.POT_CHAIN) return c.cell;
  return S.gold(b, r);
}
/* 「囤盤」：丟在還沒滿的格子（先 2 枚、再 1 枚、再 0 枚），不引爆；都滿（全是 3 枚）才被迫引爆 */
function hoardPick(EV, S, b, r){
  for(const want of [2, 1, 0]){ const t = []; for(let i = 0; i < EV.N; i++) if(b.h[i] === want) t.push(i); if(t.length) return t[Math.floor(r() * t.length)]; }
  return S.gold(b, r);
}
const maxExitOf = (EV, b) => { let m = 0; for(let i = 0; i < EV.N; i++) if(b.h[i] === EV.CFG.CAP - 1){ const p = EV.probe(b, i); if(p.exitCount > m) m = p.exitCount; } return m; };
const ejectsGem = (EV, b) => { for(let i = 0; i < EV.N; i++) if(b.h[i] === EV.CFG.CAP - 1){ const p = EV.preview(b, i, 'coin'); if(p.exits.diamond + p.exits.crown > 0) return true; } return false; };

/* ---- 刷新長跑：單一預設面額、從起始盤面連丟 o.n 注，逐注核對盤面合法／枚數／寶物，並統計獎池與 100 注拿回的分布。
   o.mode：'none'｜'every'（每次可刷就刷一次；o.untilHit8＝冷卻不限時再刷到有 8 格為止）｜'no8'（沒有任何能炸 8 格的格子才刷）｜
           'low'（盤面枚數 < o.lowBelow 才刷）｜'gemHunt'（刷到點下去會噴出寶物為止）｜'maxExit'（連刷 o.retry 次取噴最多枚的）
   o.cd：兩次刷新之間至少隔幾注（0＝不限，可以同一注連刷到滿意為止，最多 o.retry 次）；o.pick：丟法名（greedy／gold／builder／p8gold／hoard） ---- */
function refreshRun(EV, o){
  const N = EV.N, S = makeStrategies(EV), kr = EV.rng(o.kindSeed), pr = EV.rng(o.stratSeed), rf = EV.rng(o.refSeed || 1);
  const n = o.n, mode = o.mode || 'none', cd = o.cd || 0, retry = o.retry || 12, tries = o.tries, PC = EV.POT_CHAIN, RE = EV.RAIN_EVERY;
  const di = EV.CFG.DENOM_DEFAULT, DEN = EV.CFG.DENOMS[di], lowBelow = o.lowBelow || 48;
  const pickName = o.pick || 'greedy';
  const pick = pickName === 'p8gold' ? (b, r) => p8gold(EV, S, b, r) : pickName === 'hoard' ? (b, r) => hoardPick(EV, S, b, r) : S[pickName];
  const b = EV.startBoard(di), startVal = EV.boardValue(b);
  let tot = EV.total(b), minTot = tot, maxTot = tot, meter = 0, pot = 0, potIn = 0, potWon = 0, potMaxSeen = 0;
  let got = 0, gotExit = 0, rolled = 0, maxBv = startVal, bv = startVal;
  let actions = 0, calls = 0, bad = 0, afterHit8 = 0, sinceLast = 1e9, legalBad = 0, own8 = 0, lastTake = 0, blk = 0, maxPay = 0;
  const gaps = [], potAmts = [], blocks = [];
  const check = (nb) => { if(EV.total(nb) !== tot || !sameGems(countGems(b), countGems(nb)) || !EV.isLegal(nb)) bad++; };
  const doReshuffle = () => {
    const nb = EV.reshuffle(b, rf, { tries }); calls++;
    check(nb);
    b.h = nb.h; b.g = nb.g;
  };
  const has8 = () => EV.chainBest(b).topples >= PC;
  for(let d = 1; d <= n; d++){
    if(mode !== 'none' && sinceLast >= cd){
      let did = false;
      if(mode === 'every'){
        doReshuffle(); did = true;
        if(cd <= 0 && o.untilHit8) for(let k = 1; k < retry && !has8(); k++) doReshuffle();
      } else if(mode === 'no8'){
        if(!has8()){ doReshuffle(); did = true; if(cd <= 0) for(let k = 1; k < retry && !has8(); k++) doReshuffle(); }
      } else if(mode === 'low'){
        if(tot < lowBelow){ doReshuffle(); did = true; }
      } else if(mode === 'gemHunt'){
        if(!ejectsGem(EV, b)){ doReshuffle(); did = true; if(cd <= 0) for(let k = 1; k < retry && !ejectsGem(EV, b); k++) doReshuffle(); }
      } else if(mode === 'maxExit'){
        let best = null, bs = -1;
        const reps = cd <= 0 ? retry : 1;
        for(let k = 0; k < reps; k++){
          const nb = EV.reshuffle(b, rf, { tries }); calls++; check(nb);
          const s = maxExitOf(EV, nb); if(s > bs){ bs = s; best = nb; }
        }
        b.h = best.h; b.g = best.g; did = true;
      }
      if(did){ actions++; sinceLast = 0; if(has8()) afterHit8++; }
    }
    const left = RE - 1 - meter, mt = EV.meterAfter(meter);
    const res = EV.play(b, pick(b, pr, left), kr, { rec: false, rain: mt.rain });
    meter = mt.meter; sinceLast++;
    const pa = EV.potAfter(pot, res, di), potBefore = pot; pot = pa.pot; potIn += pa.add; potWon += pa.win;
    if(potBefore + pa.add > potMaxSeen) potMaxSeen = potBefore + pa.add;
    const pay = res.pay + pa.win / DEN;
    got += pay; gotExit += res.pay; rolled += res.inValue; blk += pay;
    if(pay > maxPay) maxPay = pay;
    if(res.main.topples >= PC) own8++;
    if(pa.win > 0){ gaps.push(d - lastTake); lastTake = d; potAmts.push(pa.win / DEN); }
    bv = bv + res.inValue - res.pay; if(bv > maxBv) maxBv = bv;
    tot += res.enter.coin + res.enter.diamond + res.enter.crown - res.exitCount;
    if(tot < minTot) minTot = tot;
    if(tot > maxTot) maxTot = tot;
    if(!EV.isLegal(b)) legalBad++;
    if(d % 100 === 0){ blocks.push(blk / 100); blk = 0; }
  }
  const endVal = EV.boardValue(b);
  return { mode, cd, pick: pickName, n, got, gotExit, rolled, startVal, endVal, trackedEndVal: bv, maxBv, tot: EV.total(b), trackedTot: tot, minTot, maxTot,
           actions, calls, bad, afterHit8, own8, legalBad, potIn, potWon, potEnd: pot, potMaxSeen, maxPay, gaps, potAmts, blocks, denom: DEN };
}
/* 合併同一組設定的多段 refreshRun（各段種子不同、各自從起始盤面開始） */
function summarizeRefresh(parts){
  const sum = (k) => parts.reduce((a, p) => a + p[k], 0), cat = (k) => [].concat(...parts.map(p => p[k])).sort((x, y) => x - y);
  const n = sum('n'), gaps = cat('gaps'), pa = cat('potAmts'), bl = cat('blocks');
  const ql = (a) => ({ count: a.length, p10: quant(a, 0.1), p50: quant(a, 0.5), p90: quant(a, 0.9), min: a.length ? a[0] : 0, max: a.length ? a[a.length - 1] : 0, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0 });
  return {
    mode: parts[0].mode, cd: parts[0].cd, pick: parts[0].pick, n, chunks: parts.length,
    rtp: sum('got') / n, rtpExit: sum('gotExit') / n, rolledRtp: sum('rolled') / n,
    refreshActions: sum('actions'), reshuffleCalls: sum('calls'), refreshPer100: sum('actions') / n * 100, callsPer100: sum('calls') / n * 100,
    afterRefreshHas8: sum('actions') ? sum('afterHit8') / sum('actions') : null,
    own8Share: sum('own8') / n, potTakes: gaps.length, potTakeEvery: ql(gaps), potAtTake: ql(pa), block100: ql(bl),
    bad: sum('bad'), legalBad: sum('legalBad'), minTot: Math.min(...parts.map(p => p.minTot)), maxTot: Math.max(...parts.map(p => p.maxTot)),
    totMismatch: parts.filter(p => p.tot !== p.trackedTot).length,
    valueIdentityErr: Math.max(...parts.map(p => Math.abs(p.gotExit - (p.rolled + p.startVal - p.endVal)))),
    potMismatch: parts.filter(p => p.potIn !== p.potWon + p.potEnd).length,
    /* 與「同一串抽獎亂數、不刷」的差距上界：各段（盤面最高面值＋獎池最高餘額）之和（個面額） */
    residualBound: parts.reduce((a, p) => a + Math.max(p.startVal, p.maxBv) + p.potMaxSeen / p.denom, 0),
    gotRaw: sum('got'), rolledRaw: sum('rolled'), maxPay: Math.max(...parts.map(p => p.maxPay))
  };
}

/* ---- 單一盤面換金額長跑：三種面額共用一張盤面；換金額＝盤面換成 floorBoard（40 枚合法、無寶物）、能量條 0、獎池 0。
   一律用「錢」記帳（投入 Σ面額、拿回 Σ實付＋拿走的獎池）。o.policy 見 switchPolicy ---- */
function switchPolicy(EV, name, S){
  const D = EV.CFG.DENOMS.length - 1, potHalf = (di) => EV.potMax(di) * 0.5, RE = EV.RAIN_EVERY;
  const near = (st) => st.meter >= RE - 10 || st.pot >= potHalf(st.di);
  const g = (b, r) => S.greedy(b, r);
  const P = {
    fixed0: { start: 0, pick: () => g, next: () => -1 },
    fixed1: { start: 1, pick: () => g, next: () => -1 },
    fixed2: { start: D, pick: () => g, next: () => -1 },
    /* 每 N 注來回切（100↔1000；cycle30 輪流切三種面額） */
    cycle1: { start: 0, pick: () => g, next: (st) => st.segBets >= 1 ? (st.di === 0 ? D : 0) : -1 },
    cycle5: { start: 0, pick: () => g, next: (st) => st.segBets >= 5 ? (st.di === 0 ? D : 0) : -1 },
    cycle30: { start: 0, pick: () => g, next: (st) => st.segBets >= 30 ? (st.di + 1) % (D + 1) : -1 },
    /* 小額養盤→切大額引爆：100 上囤盤 50 注，切 1000 引爆 15 注，再切回 100 */
    hoardBlast: { start: 0, pick: (st) => st.di === 0 ? (b, r) => hoardPick(EV, S, b, r) : g, next: (st) => st.di === 0 ? (st.segBets >= 50 ? D : -1) : (st.segBets >= 15 ? 0 : -1) },
    /* 獎池或能量條快滿時切：100 上養到（能量條剩 10 注內或獎池過半）→切 1000 引爆 20 注→切回 100 */
    nearFullUp: { start: 0, pick: (st) => st.di === 0 ? S.builder : g, next: (st) => st.di === 0 ? (near(st) ? D : -1) : (st.segBets >= 20 ? 0 : -1) },
    /* 反過來：1000 上養到快滿→切 100 去領→切回 1000 */
    nearFullDown: { start: D, pick: (st) => st.di === D ? S.builder : g, next: (st) => st.di === D ? (near(st) ? 0 : -1) : (st.segBets >= 20 ? D : -1) }
  };
  return P[name];
}
function switchRun(EV, o){
  const DENS = EV.CFG.DENOMS, S = makeStrategies(EV), kr = EV.rng(o.kindSeed), pr = EV.rng(o.stratSeed), fr = EV.rng(o.floorSeed || 5);
  const pol = switchPolicy(EV, o.policy, S), n = o.n, RE = EV.RAIN_EVERY, COIN = EV.VALUE.coin, MINV = EV.MIN_TOTAL * COIN, RTP = EV.RTP;
  let di = pol.start, b = EV.floorBoard(fr), meter = 0, pot = 0, tot = EV.total(b);
  let seg = { n: 0, entries: 0, exits: 0, potWon: 0, potDep: 0, got: 0 };
  let moneyIn = 0, moneyOut = 0, sumDen2 = 0, switches = 0, pathBad = 0, minTot = tot, legalBad = 0, floorBad = 0, segs = 0;
  const A = { pot: 0, board: 0, meter: 0, actual: 0, money: 0 };           // 換金額離開的那些段：被丟掉的東西（個面額；money＝換算成錢）
  const perDenom = DENS.map(() => ({ switches: 0, est: 0, actual: 0 }));
  const endSeg = (isSwitch) => {
    segs++;
    const DEN = DENS[di], endVal = EV.boardValue(b), pathErr = Math.abs(seg.exits + endVal - (seg.entries + MINV));
    if(pathErr > 1e-6 || endVal < MINV - 1e-9 || seg.exits > seg.entries + 1e-9 || seg.potWon + pot !== seg.potDep) pathBad++;
    if(isSwitch){
      const lp = pot / DEN, lb = endVal - MINV, lm = meter * (EV.N / RE) * COIN, est = lp + lb + lm, actual = RTP * seg.n - seg.got;
      A.pot += lp; A.board += lb; A.meter += lm; A.actual += actual; A.money += est * DEN; switches++;
      perDenom[di].switches++; perDenom[di].est += est; perDenom[di].actual += actual;
    }
  };
  const st = { di, segBets: 0, meter: 0, pot: 0 };
  for(let d = 1; d <= n; d++){
    st.di = di; st.meter = meter; st.pot = pot; st.segBets = seg.n;
    const to = d > 1 ? pol.next(st) : -1;
    if(to >= 0 && to !== di){
      endSeg(true);
      di = to; b = EV.floorBoard(fr); meter = 0; pot = 0; tot = EV.total(b);
      if(tot !== EV.MIN_TOTAL || !EV.isLegal(b) || b.g.some(x => x.length)) floorBad++;
      seg = { n: 0, entries: 0, exits: 0, potWon: 0, potDep: 0, got: 0 };
    }
    const DEN = DENS[di], left = RE - 1 - meter, mt = EV.meterAfter(meter);
    st.di = di; st.meter = meter; st.pot = pot; st.segBets = seg.n;
    const res = EV.play(b, pol.pick(st)(b, pr, left), kr, { rec: false, rain: mt.rain });
    meter = mt.meter;
    const pa = EV.potAfter(pot, res, di); pot = pa.pot;
    moneyIn += DEN; sumDen2 += DEN * DEN; moneyOut += EV.cash(res, di) + pa.win;
    seg.n++; seg.entries += res.inValue; seg.exits += res.pay; seg.potWon += pa.win; seg.potDep += pa.add; seg.got += res.pay + pa.win / DEN;
    tot += res.enter.coin + res.enter.diamond + res.enter.crown - res.exitCount;
    if(tot < minTot) minTot = tot;
    if(!EV.isLegal(b)) legalBad++;
  }
  endSeg(false);
  return { policy: o.policy, n, moneyIn, moneyOut, sumDen2, switches, segs, pathBad, minTot, legalBad, floorBad, loss: A, perDenom };
}
function summarizeSwitch(parts){
  const sum = (k) => parts.reduce((a, p) => a + p[k], 0);
  const sw = sum('switches'), L = (k) => parts.reduce((a, p) => a + p.loss[k], 0);
  const pd = parts[0].perDenom.map((_, i) => { const s = parts.reduce((a, p) => a + p.perDenom[i].switches, 0); return { switches: s, estDenoms: s ? parts.reduce((a, p) => a + p.perDenom[i].est, 0) / s : 0, measuredDenoms: s ? parts.reduce((a, p) => a + p.perDenom[i].actual, 0) / s : 0 }; });
  return { policy: parts[0].policy, n: sum('n'), moneyIn: sum('moneyIn'), moneyOut: sum('moneyOut'), sumDen2: sum('sumDen2'), switches: sw, segs: sum('segs'),
           pathBad: sum('pathBad'), minTot: Math.min(...parts.map(p => p.minTot)), legalBad: sum('legalBad'), floorBad: sum('floorBad'),
           perSwitch: sw ? { potDenoms: L('pot') / sw, boardExcessDenoms: L('board') / sw, meterDenoms: L('meter') / sw, estTotalDenoms: (L('pot') + L('board') + L('meter')) / sw, measuredDenoms: L('actual') / sw, money: L('money') / sw, byLeavingDenom: pd } : null };
}

Object.assign(module.exports, { refreshRun, summarizeRefresh, switchRun, summarizeSwitch, switchPolicy, p8gold, hoardPick, countGems });
