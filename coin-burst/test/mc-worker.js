/* mc-test.js 的工作執行緒：收任務、跑模擬、回結果（無頂層 'use strict'） */
const { parentPort } = require('worker_threads');
const lib = require('./sim-lib.js');
const EV = lib.loadEV();

parentPort.on('message', (t) => {
  let out;
  if(t.type === 'long') out = lib.longRun(EV, t.name, t.n, t.kindSeed, t.stratSeed);
  else if(t.type === 'replay') out = lib.replayCheck(EV, t.name, t.n, t.kindSeed, t.stratSeed);
  else if(t.type === 'sessions') out = lib.sessions(EV, t.name, t.count, t.seed);
  else throw new Error('未知任務 ' + t.type);
  parentPort.postMessage({ id: t.id, out });
});
