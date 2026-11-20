/* 測試共用：載入核心（與瀏覽器同一份 values.js／core.js）、worker 工作池。 */
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const VALUES_PATH = path.join(ROOT, 'values.js');
const CORE_PATH = path.join(ROOT, 'js', 'core.js');
const PAY_RE = /\/\*PAY-START[\s\S]*?\/\*PAY-END\*\//;
const STUB_BLOCK = '/*PAY-START stub*/ var TUNED = { untuned:true, generated:null, ' +
  'W:{stable:[0,0,0,0,0,0,0],mid:[0,0,0,0,0,0,0],wild:[0,0,0,0,0,0,0]}, ' +
  'pay:{stable:[0,0,0,0,0,0,0],mid:[0,0,0,0,0,0,0],wild:[0,0,0,0,0,0,0]} }; /*PAY-END*/';

/* 載入 { EV, DemoCore }。stub＝true：把賠率表區塊換成占位（tune.js 校表時用，不受自檢影響）。
 * valuesSrc：改用指定的 values.js 原始碼（測試自檢 throw 用）。 */
function loadGame(o) {
  o = o || {};
  let v = o.valuesSrc != null ? o.valuesSrc : fs.readFileSync(VALUES_PATH, 'utf8');
  if (o.stub) v = v.replace(PAY_RE, STUB_BLOCK);
  const c = fs.readFileSync(CORE_PATH, 'utf8');
  return new Function(v + '\n' + c + '\nreturn { EV:EV, DemoCore:DemoCore };')();
}

function cpuCount() { return Math.max(1, Math.min(os.cpus().length - 1, 15)); }

/* 並行跑 jobs（每個 job 一個 worker，同時最多 cpuCount 個），回傳依序的結果陣列 */
function runJobs(jobs, conc) {
  conc = conc || cpuCount();
  const results = new Array(jobs.length);
  let next = 0, running = 0, failed = false;
  return new Promise((resolve, reject) => {
    function pump() {
      if (failed) return;
      if (next >= jobs.length && running === 0) return resolve(results);
      while (running < conc && next < jobs.length) {
        const i = next++;
        running++;
        const wk = new Worker(path.join(__dirname, '_worker.js'), { workerData: jobs[i] });
        wk.once('message', r => { results[i] = r; });
        wk.once('error', e => { failed = true; reject(e); });
        wk.once('exit', () => { running--; pump(); });
      }
    }
    pump();
  });
}

/* 把同一檔多個 shard 的統計合併 */
function mergeSim(rs) {
  const o = { n: 0, sum: 0, sumSq: 0, hit: 0, nearAny: 0, nearA: 0, nearB: 0, nearC: 0, maxX: 0, cap: 0,
    maxChains: 0, overCap: 0, maxRoundDiff: 0, capLoss: 0, chainCapped: 0, steps: 0, W: new Array(7).fill(0),
    ge: rs[0].ge.map(() => 0), chainHist: rs[0].chainHist.map(() => 0), X: rs[0].X };
  for (const r of rs) {
    o.n += r.n; o.sum += r.sum; o.sumSq += r.sumSq; o.hit += r.hit; o.nearAny += r.nearAny;
    o.nearA += r.nearA; o.nearB += r.nearB; o.nearC += r.nearC; o.cap += r.cap; o.steps += r.steps;
    o.overCap += r.overCap; o.capLoss += r.capLoss; o.maxRoundDiff = Math.max(o.maxRoundDiff, r.maxRoundDiff); o.chainCapped += r.chainCapped;
    o.maxX = Math.max(o.maxX, r.maxX); o.maxChains = Math.max(o.maxChains, r.maxChains);
    r.W.forEach((v, i) => o.W[i] += v);
    r.ge.forEach((v, i) => o.ge[i] += v);
    r.chainHist.forEach((v, i) => o.chainHist[i] += v);
  }
  const mean = o.sum / o.n, sd = Math.sqrt(Math.max(0, o.sumSq / o.n - mean * mean));
  o.mean = mean; o.sd = sd; o.se = sd / Math.sqrt(o.n);
  o.Wavg = o.W.map(v => v / o.n);
  return o;
}

/* 切 shard：總局數固定切成 shards 份（與機器核心數無關，seed 固定 → 結果可重現） */
function mix32(a, b, c) {                       // 把 (seed, 檔, shard) 打散成獨立的 32-bit 種子
  let h = (a ^ Math.imul(b, 0x9E3779B1) ^ Math.imul(c, 0x85EBCA6B)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function shardJobs(base, n, shards) {
  const per = Math.ceil(n / shards), jobs = [];
  for (let s = 0; s < shards; s++) jobs.push(Object.assign({}, base, { n: per, seed: mix32(base.seed, base.tier + 1, s + 1) }));
  return jobs;
}

module.exports = { ROOT, VALUES_PATH, CORE_PATH, PAY_RE, STUB_BLOCK, loadGame, runJobs, mergeSim, shardJobs, cpuCount };
