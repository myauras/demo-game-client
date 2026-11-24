/* 調參用：node test/tune.js [params.json|-] [N=2000]（不給 params 就量目前 values.js 的設定）
 * params.json：{ safe:{need,w,val,stag,band,jslack,tpl}, mid:{...}, risk:{...} }（只列要覆蓋的欄位），
 * 覆蓋 EV.CFG.ROUTES 後以精確分布統計 N 張圖。只用於定案參數；定案後的值寫回 values.js。 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));
const P = process.argv[2] && process.argv[2] !== '-' ? JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8')) : {};
const N = +(process.argv[3] || 2000);
EV.CFG.ROUTES.forEach(r => { if (P[r.id]) Object.assign(r, P[r.id]); });
EV.checkTemplates();
const pct = x => (x * 100).toFixed(1) + '%';
const rng = EV.mulberry32(20261123);
const t0 = Date.now();
const S = [0, 1, 2].map(() => ({ p0: [], ge1: [], ge5: [], ge20: [], sd: [], big: [], rolls: [], pEnd: [], evMin: 9, evMax: 0, tpl: {}, len: {}, need: {} }));
let fail = 0, spread = 0;
for (let i = 0; i < N; i++) {
  let map; try { map = EV.genMap(rng); } catch (e) { fail++; continue; }
  const evs = [];
  map.routes.forEach((route, ri) => {
    const D = EV.routeStats(route), s = S[ri];
    s.p0.push(D.p0); s.ge1.push(D.ge1); s.ge5.push(D.ge5); s.ge20.push(D.ge20); s.sd.push(D.sd); s.big.push(EV.bigPrize(route).v);
    s.rolls.push(D.rolls); s.pEnd.push(D.pEnd);
    s.evMin = Math.min(s.evMin, D.ev); s.evMax = Math.max(s.evMax, D.ev); evs.push(D.ev);
    s.tpl[route.tpl] = (s.tpl[route.tpl] || 0) + 1; s.len[route.nodes.length] = (s.len[route.nodes.length] || 0) + 1;
    route.nodes.forEach(n => { if (n.kind === 'enemy') s.need[n.need] = (s.need[n.need] || 0) + 1; });
  });
  spread = Math.max(spread, Math.max(...evs) - Math.min(...evs));
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const ok = N - fail;
console.log(`maps ${ok}/${N}  用時 ${((Date.now() - t0) / 1000).toFixed(1)}s（${((Date.now() - t0) / ok).toFixed(1)}ms／張）  三路 EV 最大差 ${(spread * 100).toFixed(3)}pp`);
EV.CFG.ROUTES.forEach((r, ri) => {
  const s = S[ri];
  console.log(`[${r.id}] EV ${(s.evMin * 100).toFixed(2)}~${(s.evMax * 100).toFixed(2)}  沒拿到 ${pct(avg(s.p0))} (${pct(q(s.p0, .05))}~${pct(q(s.p0, .95))})  ≥1 ${pct(avg(s.ge1))} (${pct(q(s.ge1, .05))}~${pct(q(s.ge1, .95))})  ≥5 ${pct(avg(s.ge5))}  ≥20 ${pct(avg(s.ge20))}  sd ${avg(s.sd).toFixed(2)} (${q(s.sd, .05).toFixed(2)}~${q(s.sd, .95).toFixed(2)})  走到底 ${pct(avg(s.pEnd))}  擲 ${avg(s.rolls).toFixed(2)}`);
  console.log(`      最大寶物 min ${Math.min(...s.big)} p10 ${q(s.big, .1)} 中位 ${q(s.big, .5)} p90 ${q(s.big, .9)} max ${Math.max(...s.big)}   長度 ${JSON.stringify(s.len)}`);
  console.log(`      門檻 ${JSON.stringify(s.need)}`);
  console.log(`      樣板 ${Object.keys(s.tpl).sort().map(k => k + ':' + s.tpl[k]).join(' ')}`);
});
