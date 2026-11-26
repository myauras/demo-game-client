/* =========================================================================
 * 爆金連鎖——模擬共用函式庫（mc-test.js 與 mc-worker.js 共用；無頂層 'use strict'）
 * 規則程式不是另外抄一份：一律 eval values.js 取得 EV。
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

/* 替代設定（給用戶裁決用的比較，不改 CFG）：鑽石 3、皇冠 25、普通幣＝RTP 最接近 96.9% 且各面額實付為整數的值 */
function loadAlt(EV){
  const sol = EV.solveCoinPay({ DIAMOND: { P: EV.CFG.DIAMOND.P, PAY: 3 }, CROWN: { P: EV.CFG.CROWN.P, PAY: 25 } }, 0.969);
  const ALT = EV.build({ DIAMOND: { P: EV.CFG.DIAMOND.P, PAY: 3 }, CROWN: { P: EV.CFG.CROWN.P, PAY: 25 }, COIN_PAY: sol.coinPay });
  return ALT;
}

/* ---- 三種丟法（strategy rng 與抽獎 rng 分開，所以三種丟法吃到同一串抽獎亂數） ---- */
function makeStrategies(EV){
  const N = EV.N;
  const rnd = (r) => Math.floor(r() * N);
  const threes = (b) => { const a = []; for(let i = 0; i < N; i++) if(b.h[i] === EV.CFG.CAP - 1) a.push(i); return a; };
  return {
    // 隨機丟
    random: (b, r) => rnd(r),
    // 有快滿格（疊 3 枚）就點快滿格（隨便一個），否則隨機
    gold: (b, r) => { const t = threes(b); return t.length ? t[Math.floor(r() * t.length)] : rnd(r); },
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
    }
  };
}
const STRAT_NAMES = ['random', 'greedy', 'gold'];
const STRAT_LABEL = { random: '隨機丟', greedy: '每次挑最會爆的格', gold: '有快滿格就點快滿格否則隨機' };

const EPS = 1e-9;

/* ---- 長跑：從預設面額的起始盤面開始連丟 n 注，逐注核對 ---- */
function longRun(EV, ALT, name, n, kindSeed, stratSeed){
  const N = EV.N, pick = makeStrategies(EV)[name], pr = EV.rng(stratSeed), kr = EV.rng(kindSeed);
  const b = EV.startBoard(EV.CFG.DENOM_DEFAULT);
  const V = EV.VALUE, AV = ALT.VALUE, T = EV.CFG.TIERS;
  const startVal = EV.boardValue(b), startTotal = EV.total(b), startCoins = startTotal;
  let bv = startVal, maxBv = startVal, tot = startTotal, sumTot = 0, minTot = 1e9, maxTot = 0;
  let got = 0, rolled = 0, gotAlt = 0, rolledAlt = 0, sky = 0;
  let maxPay = 0, maxPayAlt = 0, hit = 0, anyExit = 0, exits1 = 0;
  const m = { back: 0, big: 0, huge: 0 }, ma = { back: 0, big: 0, huge: 0 };
  let boundViolations = 0, worstSlack = Infinity;
  const inK = { coin: 0, diamond: 0, crown: 0 }, outK = { coin: 0, diamond: 0, crown: 0 };
  for(let d = 0; d < n; d++){
    const res = EV.play(b, pick(b, pr), kr, { rec: false });
    // 極值上界：這一注拿回 ≤ 這一注之前盤面上所有東西的面值＋這一注進場東西的面值
    const cap = bv + res.inValue, slack = cap - res.pay;
    if(slack < -EPS) boundViolations++;
    if(slack < worstSlack) worstSlack = slack;
    bv = cap - res.pay; if(bv > maxBv) maxBv = bv;
    got += res.pay; rolled += res.inValue;
    const pa = res.exits.coin * AV.coin + res.exits.diamond * AV.diamond + res.exits.crown * AV.crown;
    gotAlt += pa; rolledAlt += res.enter.coin * AV.coin + res.enter.diamond * AV.diamond + res.enter.crown * AV.crown;
    inK.coin += res.enter.coin; inK.diamond += res.enter.diamond; inK.crown += res.enter.crown;
    outK.coin += res.exits.coin; outK.diamond += res.exits.diamond; outK.crown += res.exits.crown;
    if(res.sky) sky++;
    tot += 1 + (res.sky ? 1 : 0) - res.exitCount;
    sumTot += tot; if(tot < minTot) minTot = tot; if(tot > maxTot) maxTot = tot;
    if(res.pay > maxPay) maxPay = res.pay;
    if(pa > maxPayAlt) maxPayAlt = pa;
    if(res.topples) hit++;
    if(res.exitCount) anyExit++;
    if(res.exitCount === 1) exits1++;
    if(res.pay + EPS >= T.BACK) m.back++;
    if(res.pay + EPS >= T.BIG) m.big++;
    if(res.pay + EPS >= T.HUGE) m.huge++;
    if(pa + EPS >= T.BACK) ma.back++;
    if(pa + EPS >= T.BIG) ma.big++;
    if(pa + EPS >= T.HUGE) ma.huge++;
  }
  const gemsOn = { diamond: 0, crown: 0 };
  for(let i = 0; i < N; i++) for(const k of b.g[i]) gemsOn[k]++;
  const endTotal = EV.total(b), coinsOn = endTotal - gemsOn.diamond - gemsOn.crown;
  const endVal = EV.boardValue(b);
  return {
    name, n, got, rolled, rtp: got / n, rolledRtp: rolled / n, gotAlt, rtpAlt: gotAlt / n, rolledRtpAlt: rolledAlt / n,
    sky, startTotal, startCoins, startVal, endVal, trackedEndVal: bv, maxBv, endTotal, coinsOn, gemsOn,
    avgTot: sumTot / n, minTot, maxTot, maxPay, maxPayAlt,
    hit: hit / n, anyExit: anyExit / n, exits1: exits1 / n,
    back: m.back / n, big: m.big / n, huge: m.huge / n,
    backAlt: ma.back / n, bigAlt: ma.big / n, hugeAlt: ma.huge / n,
    inK, outK, boundViolations, worstSlack
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
  const N = EV.N, pick = makeStrategies(EV)[name], pr = EV.rng(stratSeed), kr = EV.rng(kindSeed);
  const b = EV.startBoard(EV.CFG.DENOM_DEFAULT);
  let boardBad = 0, exitBad = 0, cashBad = 0, payBad = 0, waveBad = 0, plays = 0, maxWaves = 0;
  for(let d = 0; d < n; d++){
    const h = b.h.slice(), g = b.g.map(x => x.slice());
    const res = EV.play(b, pick(b, pr), kr);        // 預設 rec＝true，帶完整分波
    plays++;
    // 重播
    const tally = { coin: 0, diamond: 0, crown: 0 };
    h[res.main.cell]++; if(res.main.kind !== 'coin') g[res.main.cell].push(res.main.kind);
    let ok = replayWaves(h, g, res.main.waves, tally);
    if(res.sky){ h[res.sky.cell]++; ok = ok && replayWaves(h, g, res.sky.waves, tally); }
    if(!ok || JSON.stringify(h) !== JSON.stringify(b.h) || JSON.stringify(g) !== JSON.stringify(b.g)) boardBad++;
    // 噴出枚數與金額加總相符（每個面額都核）
    if(tally.coin !== res.exits.coin || tally.diamond !== res.exits.diamond || tally.crown !== res.exits.crown) exitBad++;
    let wsum = 0, tp = 0;
    for(const part of [res.main, res.sky]) if(part){ for(const w of part.waves){ wsum += w.exitCount; tp += w.cells.length; if(w.moves.length !== 4 * w.cells.length) waveBad++; } if(part.waves.length > maxWaves) maxWaves = part.waves.length; }
    if(wsum !== res.exitCount || tp !== res.topples) waveBad++;
    for(let di = 0; di < EV.PAY.length; di++){
      const p = EV.PAY[di];
      if(EV.cash(res, di) !== tally.coin * p.coin + tally.diamond * p.diamond + tally.crown * p.crown) cashBad++;
    }
    const expectPay = tally.coin * EV.VALUE.coin + tally.diamond * EV.VALUE.diamond + tally.crown * EV.VALUE.crown;
    if(Math.abs(expectPay - res.pay) > 1e-9) payBad++;
  }
  return { name, plays, boardBad, exitBad, cashBad, payBad, waveBad, maxWaves };
}

/* ---- 短時間體感：每場都是新玩家從起始盤面開始，丟到 500 注；回報 100／200／500 注時的拿回比例 ---- */
const MARKS = [100, 200, 500];
function sessions(EV, ALT, name, count, seed){
  const pick = makeStrategies(EV)[name], pr = EV.rng(seed * 2 + 1), kr = EV.rng(seed * 2 + 2);
  const V = EV.VALUE, AV = ALT.VALUE;
  const main = MARKS.map(() => new Float64Array(count)), alt = MARKS.map(() => new Float64Array(count));
  for(let s = 0; s < count; s++){
    const b = EV.startBoard(EV.CFG.DENOM_DEFAULT);
    let got = 0, ga = 0;
    for(let d = 1; d <= 500; d++){
      const res = EV.play(b, pick(b, pr), kr, { rec: false });
      got += res.pay; ga += res.exits.coin * AV.coin + res.exits.diamond * AV.diamond + res.exits.crown * AV.crown;
      const mi = MARKS.indexOf(d);
      if(mi >= 0){ main[mi][s] = got / d; alt[mi][s] = ga / d; }
    }
  }
  return { name, count, main, alt };
}

module.exports = { loadEV, loadAlt, makeStrategies, STRAT_NAMES, STRAT_LABEL, longRun, replayCheck, sessions, MARKS };
