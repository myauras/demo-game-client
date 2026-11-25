/* 測試共用：載入核心（與瀏覽器同一份 values.js／core.js）、worker 工作池。 */
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const VALUES_PATH = path.join(ROOT, 'values.js');
const CORE_PATH = path.join(ROOT, 'js', 'core.js');

/* 載入 { EV, DemoCore }；valuesSrc／coreSrc：改用指定原始碼（測試自檢用） */
function loadGame(o) {
  o = o || {};
  const v = o.valuesSrc != null ? o.valuesSrc : fs.readFileSync(VALUES_PATH, 'utf8');
  const c = o.coreSrc != null ? o.coreSrc : fs.readFileSync(CORE_PATH, 'utf8');
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

/* 把 (seed, a, b) 打散成獨立的 32-bit 種子（切 shard 用；總局數固定、與機器核心數無關 → 結果可重現） */
function mix32(a, b, c) {
  let h = (a ^ Math.imul(b, 0x9E3779B1) ^ Math.imul(c, 0x85EBCA6B)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const SHARDS = 30;      // 固定切 30 份

/* 合併 maps 工作的統計（R＝全部結果、idx＝要合併的工作編號）→ { n, spreadMax, bruteMaps, S:[3 條路] } */
function mergeMaps(R, idx) {
  const sum = ['p0', 'lt05', 'ge1', 'ge5', 'ge20', 'sd', 'pEnd', 'rolls', 'evSum', 'sumAll', 'meanSum', 'maxNeedSum', 'minNeedSum', 'n',
    'structBad', 'valBad', 'bandBad', 'stagBad', 'tierBad', 'gridBad', 'tplBad'];
  const mn = ['evMin', 'p0Min', 'ge1Min', 'ge20Min', 'sdMin', 'greenMin', 'spreadMin'];
  const mx = ['evMax', 'p0Max', 'ge1Max', 'ge20Max', 'lt05Max', 'sdMax', 'maxPrize', 'sumAllMax', 'bruteGap', 'hiMax', 'redMax', 'dropMax', 'meanMax', 'rollsMaxBound'];
  const hist = ['lenHist', 'tpl', 'needHist', 'nEnemyHist', 'firstEnemyHist'];
  const out = { n: 0, spreadMax: 0, bruteMaps: 0, S: [0, 1, 2].map(() => ({ big: [], badMsg: [] })) };
  idx.forEach(i => {
    const r = R[i]; out.n += r.n; out.spreadMax = Math.max(out.spreadMax, r.spreadMax); out.bruteMaps += r.bruteMaps;
    r.S.forEach((s, ri) => {
      const m = out.S[ri];
      sum.forEach(k => { m[k] = (m[k] || 0) + s[k]; });
      mn.forEach(k => { m[k] = Math.min(m[k] === undefined ? 1e9 : m[k], s[k]); });
      mx.forEach(k => { m[k] = Math.max(m[k] === undefined ? -1e9 : m[k], s[k]); });
      hist.forEach(k => { m[k] = m[k] || {}; for (const key in s[k]) m[k][key] = (m[k][key] || 0) + s[k][key]; });
      s.big.forEach(v => m.big.push(v)); s.badMsg.forEach(x => m.badMsg.push(x));
    });
  });
  out.S.forEach(m => m.big.sort((a, b) => a - b));
  return out;
}
/* 合併 core 工作：o（數字相加；max 類取最大；hist 類逐鍵相加）與骰子統計 T */
function mergeCore(R, idx) {
  const o = { badMsg: [], rollsHist: {} }, T = {};
  const maxKeys = { maxX: 1, maxTotalX: 1, maxRolls: 1, maxPrizeAny: 1 };
  idx.forEach(i => {
    const a = R[i].o || {}, t = R[i].T;
    for (const k in a) {
      if (k === 'badMsg') a[k].forEach(x => o.badMsg.length < 8 && o.badMsg.push(x));
      else if (k === 'rollsHist') for (const key in a[k]) o.rollsHist[key] = (o.rollsHist[key] || 0) + a[k][key];
      else if (maxKeys[k]) o[k] = Math.max(o[k] || 0, a[k]);
      else o[k] = (o[k] || 0) + a[k];
    }
    if (t) for (const k in t) T[k] = Array.isArray(t[k]) ? t[k].map((v, j) => (T[k] ? T[k][j] : 0) + v) : (T[k] || 0) + t[k];
  });
  return { o, T };
}

module.exports = { mergeMaps, mergeCore, ROOT, VALUES_PATH, CORE_PATH, loadGame, runJobs, mix32, cpuCount, SHARDS };
