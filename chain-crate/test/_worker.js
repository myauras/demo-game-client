/* 測試用 worker：跑一段局數，回傳統計量（由 _lib.runJobs 啟動）。
 * workerData：{ kind:'sim'|'core', stub, tier, n, seed, bet, lean }
 *   sim ：直接呼叫 rollRound（lean 模式），快；tune／stats 用。
 *   core：走 DemoCore.createGame 的 bet→ack 完整流程（含錢包、注單），mc-test 的 RTP 驗證用。 */
const { workerData, parentPort } = require('worker_threads');
const { loadGame } = require('./_lib');
const { EV, DemoCore } = loadGame({ stub: !!workerData.stub });
const { kind, tier, n, seed, bet } = workerData;
const lean = workerData.lean === undefined ? true : workerData.lean;
const rnd = DemoCore.makeRng(seed);
const CAPX = EV.CFG.MAX_WIN_X, MAXC = EV.CFG.MAX_CHAIN;
const X = [0, 1, 5, 20, 100];                       // 總賠 / 本金：>0、≥1、≥5、≥20、≥100
const ge = new Array(X.length).fill(0), chainHist = new Array(MAXC + 2).fill(0), W = new Array(7).fill(0);
let sum = 0, sumSq = 0, hit = 0, nearAny = 0, nearA = 0, nearB = 0, nearC = 0, maxX = 0, cap = 0,
  maxChains = 0, overCap = 0, chainCapped = 0, steps = 0, maxRoundDiff = 0, capLoss = 0;
const PAYT = EV.TIERS[tier].pay;

let game = null, last = null;
if (kind === 'core') {
  game = DemoCore.createGame({ storage: false, rng: rnd, wallet: Number.MAX_SAFE_INTEGER / 4 });
  game.on((t, d) => { if (t === 'settled') last = d; });
}
const id = EV.TIERS[tier].id;
for (let i = 0; i < n; i++) {
  let r, total;
  if (kind === 'core') { game.bet(id, bet); game.ack(); r = last.result; total = last.payout; }
  else { r = DemoCore.rollRound(tier, bet, rnd, lean); total = r.total; }
  const x = total / bet;
  let lin = 0;
  for (let s = 0; s < 7; s++) lin += r.w[s] * PAYT[s];
  if (r.capped) capLoss += lin - x; else if (Math.abs(x - lin) > maxRoundDiff) maxRoundDiff = Math.abs(x - lin);   // 沒撞上限的局：實付與線性值只差取整
  sum += x; sumSq += x * x;
  for (let s = 0; s < 7; s++) W[s] += r.w[s];
  if (r.chains > 0) hit++;
  chainHist[Math.min(r.chains, MAXC + 1)]++;
  steps += r.chains;
  if (r.chains > maxChains) maxChains = r.chains;
  if (r.chainCapped) chainCapped++;
  if (x > maxX) maxX = x;
  if (x >= CAPX) cap++;
  if (x > CAPX + 1e-9) overCap++;
  for (let k = 0; k < X.length; k++) if (k === 0 ? x > 0 : x >= X[k]) ge[k]++;
  if (r.near.length) {
    nearAny++;
    if (total < bet) nearA++;                                   // (a) 沒回本且結尾有 3 連片
    if (r.chains >= 2) nearB++;                                 // (b) 連鎖 ≥2 次且結尾有 3 連片
    if (r.chains >= 1 && r.near[0].nextMult >= 3) nearC++;      // (c) 連鎖 ≥1 次且結尾有 3 連片且下一格倍率 ≥ ×3
  }
}
parentPort.postMessage({ n, sum, sumSq, hit, nearAny, nearA, nearB, nearC, maxX, cap, maxChains, overCap,
  chainCapped, steps, maxRoundDiff, capLoss, W, ge, chainHist, X });
