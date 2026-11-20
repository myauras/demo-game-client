// C04 探針：最高紀錄（三檔各自記、切檔換、重整還在、?shot= 不讀不寫、破紀錄慶祝出現條件）、
//          關鍵時刻停頓（只在已連 3 次以上的步、加速不停；量時間差）、
//          同 seed 100 局總賠與核心直接重算完全一致（證明加料不影響結果）。
// 用法：node shot.mjs --root game --out <out> --probe game/test/probe-c04.js --timeout 120000
//   可加 --query "mode=pop|rec|wide|none"（另截圖用：慶祝瞬間／有紀錄／最寬的紀錄文字／無紀錄），可再加 lang=xx。
//   不依賴 dev.js 的 ?shot= 名稱與 DEMO.dev：自己用 DEMO.ui.play() 與 game.setRng(DemoCore.makeRng(seed)) 驅動。
// 內容是 async 函式本體（shot.mjs 會包起來執行），return 的 JSON 收進結果。
const D = window.DEMO, g = D.game, ui = D.ui;
const mode = new URLSearchParams(location.search).get('mode') || 'full';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); return !!cond; }
const ids = EV.ids();
const badge = $('recordBadge'), rvEl = badge.querySelector('.rv');
const badgeText = () => rvEl.textContent;
const T = () => performance.now();
const stored = () => { try { return JSON.parse(localStorage.getItem('crate.best')); } catch (e) { return null; } };

// ---- 偵測：慶祝（徽章 class 出現 rk-on 的次數與時間）、大獎覆蓋層收起的時間、每局的節拍時間 ----
const pops = [];
new MutationObserver(ms => {
  const t = T();
  for (let k = 0; k < ms.length; k++) {
    const before = ms[k].oldValue || '';
    const after = k + 1 < ms.length ? (ms[k + 1].oldValue || '') : (badge.getAttribute('class') || '');
    if (!/\brk-on\b/.test(before) && /\brk-on\b/.test(after)) pops.push({ t });
  }
}).observe(badge, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
let jpOn = 0, jpOff = 0;
new MutationObserver(ms => {
  const on = $('jp').classList.contains('show');
  if (on && !jpOn) jpOn = T();
  if (!on && jpOn && !jpOff) jpOff = T();
}).observe($('jp'), { attributes: true, attributeFilter: ['class'] });
let rd = null;
ui.on('roundStart', () => { rd = { start: T(), ss: [], se: [], end: null, d: null }; });
ui.on('stepStart', () => rd && rd.ss.push(T()));
ui.on('stepEnd', () => rd && rd.se.push(T()));
ui.on('roundEnd', d => { if (rd) { rd.end = T(); rd.d = d; } });
let uiWarn = 0; const _w = console.warn; console.warn = function (...a) { if (String(a[0]).indexOf('[ui]') === 0) uiWarn++; _w.apply(console, a); };

// ---- 工具 ----
const RULES = DemoCore.RULES;
function find(tierId, stake, pred, from = 1) {
  const ti = EV.tierIndex(tierId);
  for (let s = from; s < 400000; s++) {
    const r = DemoCore.rollRound(ti, stake, DemoCore.makeRng(s), false);
    if (pred(r)) return s;
  }
  return 0;
}
function topUp() { if (g.getState().wallet < 30000) g.addMoney(100000); }
// 固定 seed 的一局；resolve＝一局演完（含結算停留）
async function round(tierId, stake, seed, o = {}) {
  topUp();
  g.setRng(DemoCore.makeRng(seed));
  const p0 = pops.length;
  const r = await ui.play(tierId, stake, { fast: o.fast !== false });
  if (o.after) await sleep(o.after);                            // 大獎覆蓋層淡出（280ms）在 play resolve 之後才結束，慶祝在那之後
  return { r, rd, newPops: pops.slice(p0) };
}
const click = i => document.querySelector('.tier[data-i="' + i + '"]').click();
const tapApp = () => $('app').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
const expBest = { stable: 0, mid: 0, wild: 0 };
const fmtBest = id => expBest[id] > 0 ? '×' + EV.fmtX(expBest[id]) : '—';
// 獨立的期望值：破紀錄＝顯示值（floor2）> 目前最高且 > 0；慶祝＝破紀錄且回本（≥1 倍）
function oracle(tierId, x) {
  const fx = EV.floor2(x), rec = fx > 0 && fx > (expBest[tierId] || 0);
  if (rec) expBest[tierId] = fx;
  return { rec, pop: rec && x >= 1 };
}

// ======== 另截圖用的模式（不跑驗證，只把畫面擺到位） ========
if (mode === 'none') { await sleep(300); return { ok: true, mode, badge: badgeText() }; }
if (mode === 'rec' || mode === 'pop' || mode === 'wide') {
  const pred = mode === 'wide' ? (r => EV.floor2(r.totalX) >= 100 && String(EV.floor2(r.totalX)).length >= 6)
    : (r => r.chains >= 2 && r.totalX >= 1.2 && r.totalX < 5);
  const tier = mode === 'wide' ? 'wild' : 'mid';
  let seed = find(tier, 100, pred);
  if (!seed && mode === 'wide') seed = find(tier, 100, r => EV.floor2(r.totalX) >= 10);
  topUp(); g.setRng(DemoCore.makeRng(seed));
  const pr = ui.play(tier, 100, { fast: true });
  if (mode === 'pop') {
    const t0 = Date.now();
    while (!pops.length && Date.now() - t0 < 20000) await sleep(20);
    await sleep(260);                                           // 慶祝進行到一半時凍住，給截圖用
    document.getAnimations().forEach(a => { try { a.pause(); } catch (e) {} });
    return { ok: pops.length === 1, mode, badge: badgeText(), seed, pops: pops.length };
  }
  await pr; await sleep(1700);                                  // 慶祝跑完、回到待命
  const br = badge.getBoundingClientRect(), bb = badge.querySelector('b').getBoundingClientRect();
  return { ok: true, mode, badge: badgeText(), seed, fits: bb.left >= br.left && bb.right <= br.right, bw: [bb.width, br.width] };
}

// ======== 0. 掛點與初始狀態 ========
check(D.extras && D.extras.cfg.PAUSE_MS === 600 && D.extras.cfg.PAUSE_MIN_CHAINS === 3, 'DEMO.extras.cfg 不對');
check(localStorage.getItem('crate.best') === null, '起始就有 crate.best（探針要在乾淨 context 跑）');
for (let i = 0; i < 3; i++) { click(i); await sleep(20); check(badgeText() === '—', ids[i] + ' 起始徽章應是「—」，實際 ' + badgeText()); }

// ======== 1. 最高紀錄：三檔各自記、破紀錄慶祝的出現條件 ========
const recRows = [];
async function recRound(label, tierId, pred) {
  const stake = 100, seed = find(tierId, stake, pred);
  if (!check(seed > 0, label + ' 找不到 seed')) return;
  const ti = EV.tierIndex(tierId), R = DemoCore.rollRound(ti, stake, DemoCore.makeRng(seed), false);
  const o = oracle(tierId, R.totalX);
  topUp();
  const w0 = g.getState().wallet;
  const { r, rd: m, newPops } = await round(tierId, stake, seed, { after: 450 });
  check(r.result.total === R.total, label + ' 總賠與核心重算不同');
  check(g.getState().wallet === w0 - stake + R.total, label + ' 餘額不對');
  check(badgeText() === fmtBest(tierId), label + ' 徽章 ' + badgeText() + ' ≠ 期望 ' + fmtBest(tierId));
  const sv = stored();
  check((sv ? (sv[tierId] || 0) : 0) === (expBest[tierId] || 0), label + ' 存檔 ' + JSON.stringify(sv) + ' ≠ 期望 ' + expBest[tierId]);
  check(newPops.length === (o.pop ? 1 : 0), label + ' 慶祝次數 ' + newPops.length + '，期望 ' + (o.pop ? 1 : 0) + '（rec=' + o.rec + ' x=' + R.totalX.toFixed(3) + '）');
  if (newPops.length) check(newPops[0].t >= m.end, label + ' 慶祝早於結算（roundEnd）');
  recRows.push({ label, tier: tierId, chains: R.chains, x: +R.totalX.toFixed(3), shown: badgeText(), rec: o.rec, pop: newPops.length });
  return { R, m, newPops };
}
// 穩：沒連到 → 不記；沒回本但第一筆 → 安靜更新；回本破紀錄 → 慶祝；較低 → 不變；大贏破紀錄 → 慶祝
await recRound('穩-沒連到', 'stable', r => r.chains === 0);
await recRound('穩-沒回本第一筆', 'stable', r => r.chains >= 1 && r.totalX < 1 && EV.floor2(r.totalX) > 0);
await recRound('穩-回本破紀錄', 'stable', r => r.totalX >= 1 && r.totalX < 5);
await recRound('穩-較低不變', 'stable', r => r.chains >= 1 && EV.floor2(r.totalX) > 0 && EV.floor2(r.totalX) < expBest.stable);
await recRound('穩-大贏破紀錄', 'stable', r => r.totalX >= 5 && r.totalX < 20);
await recRound('穩-沒回本不破紀錄', 'stable', r => r.chains >= 1 && r.totalX < 1);
// 中：沒連到時仍是「—」（各檔分開）；大獎覆蓋層的局，慶祝要等覆蓋層收起
await recRound('中-沒連到', 'mid', r => r.chains === 0);
check(badgeText() === '—', '中檔沒有紀錄卻顯示 ' + badgeText());
jpOn = 0; jpOff = 0;
const jp = await recRound('中-大獎破紀錄', 'mid', r => r.totalX >= 20 && r.totalX < 80);
check(jp && jpOn > 0 && jpOff > 0, '大獎局沒看到覆蓋層開關');
if (jp && jp.newPops[0]) check(jp.newPops[0].t >= jpOff - 5, '大獎局的慶祝早於覆蓋層收起 pop=' + jp.newPops[0].t.toFixed(0) + ' jpOff=' + jpOff.toFixed(0));
await recRound('中-沒回本較低', 'mid', r => r.chains >= 1 && r.totalX < 1);
// 拚：第一筆就回本 → 慶祝
await recRound('拚-第一筆回本', 'wild', r => r.totalX >= 1 && r.totalX < 3);
// 切檔跟著換
const switchRows = [];
for (const i of [2, 0, 1, 2, 0]) { click(i); await sleep(20); switchRows.push([ids[i], badgeText()]); check(badgeText() === fmtBest(ids[i]), '切到 ' + ids[i] + ' 徽章 ' + badgeText() + ' ≠ ' + fmtBest(ids[i])); }
// 點畫面不會誤觸慶祝；三檔紀錄互不相同才有意義
check(new Set(ids.map(id => expBest[id])).size === 3, '三檔紀錄應互不相同（測試資料）');

// ======== 2. 重整後還在（同源 iframe 模擬重開頁）；?shot= 模式不讀不寫 ========
const before = localStorage.getItem('crate.best');
async function openFrame(src) {
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:absolute;left:-9999px;top:0;width:375px;height:812px';
  ifr.src = src; document.body.appendChild(ifr);
  await new Promise(r => ifr.addEventListener('load', r));
  const t0 = Date.now();
  while (!ifr.contentWindow.__demoReady && Date.now() - t0 < 8000) await sleep(50);
  return ifr;
}
const reloadRows = [];
{
  const ifr = await openFrame('index.html?dev=1');
  const iw = ifr.contentWindow, idoc = iw.document;
  for (const i of [0, 1, 2]) {
    idoc.querySelector('.tier[data-i="' + i + '"]').click(); await sleep(20);
    const txt = idoc.querySelector('#recordBadge .rv').textContent;
    reloadRows.push([ids[i], txt]);
    check(txt === fmtBest(ids[i]), '重整後 ' + ids[i] + ' 徽章 ' + txt + ' ≠ ' + fmtBest(ids[i]));
  }
  ifr.remove();
}
const shotRows = [];
{
  const ifr = await openFrame('index.html?shot=c04-none');
  const iw = ifr.contentWindow, idoc = iw.document;
  check(!!iw.DEMO.q.shot, 'iframe 沒進 ?shot= 模式');
  await sleep(300);
  for (const i of [0, 1, 2]) {
    idoc.querySelector('.tier[data-i="' + i + '"]').click(); await sleep(20);
    const txt = idoc.querySelector('#recordBadge .rv').textContent;
    shotRows.push([ids[i], txt]);
    check(txt === '—', '?shot= 模式不該讀存檔：' + ids[i] + ' 顯示 ' + txt);
  }
  // 在 shot 模式玩一局：畫面（記憶體內）會更新，但存檔不能被動
  const iui = iw.DEMO.ui, ig = iw.DEMO.game;
  const sd = find('stable', 100, r => r.totalX >= 1.5 && r.totalX < 5);
  const t0 = Date.now(); while (iui.busy() && Date.now() - t0 < 30000) await sleep(40);
  idoc.querySelector('.tier[data-i="0"]').click();
  ig.setRng(iw.DemoCore.makeRng(sd));
  await iui.play('stable', 100, { fast: true });
  const txt = idoc.querySelector('#recordBadge .rv').textContent;
  shotRows.push(['shot 內玩一局後', txt]);
  check(txt !== '—', '?shot= 模式玩一局後徽章應在記憶體內更新');
  check(localStorage.getItem('crate.best') === before, '?shot= 模式動了 crate.best 存檔');
  ifr.remove();
}

// ======== 3. 關鍵時刻停頓：量時間差 ========
const pauseRows = [];
async function timed(label, seed, o) {
  const { r, rd: m } = await round('mid', 100, seed, o);
  const n = m.ss.length, gaps = [];
  for (let i = 1; i < n; i++) gaps.push(Math.round(m.ss[i] - m.se[i - 1]));         // 第 i+1 次連鎖揭曉前的間隔
  const endGap = n ? Math.round(m.end - m.se[n - 1]) : 0;                            // 最後一次下落到結算的間隔
  pauseRows.push({ label, chains: n, gaps, endGap, total: Math.round(m.end - m.start) });
  return { n, gaps, endGap, m };
}
const IN = (v, lo, hi) => v >= lo && v <= hi;
const sd0 = find('mid', 100, r => r.chains === 0);
const sd2 = find('mid', 100, r => r.chains === 2);
const sd3 = find('mid', 100, r => r.chains === 3);
const sd5 = find('mid', 100, r => r.chains >= 5 && r.chains <= 6);
check(sd0 && sd2 && sd3 && sd5, '停頓測試找不到 seed');
{
  const a = await timed('0 連鎖', sd0, { fast: false });
  check(a.n === 0 && a.endGap < 60, '0 連鎖不該有停頓');
  const b = await timed('2 連鎖', sd2, { fast: false });
  check(b.n === 2 && b.gaps.every(v => v < 60) && b.endGap < 60, '2 連鎖不該有停頓 ' + JSON.stringify(b));
  const c = await timed('3 連鎖', sd3, { fast: false });
  check(c.n === 3 && c.gaps.every(v => v < 60) && IN(c.endGap, 570, 780), '3 連鎖：第 4 步前（結算前）應停 ~600ms ' + JSON.stringify(c));
  const d = await timed('5～6 連鎖', sd5, { fast: false });
  check(d.n >= 5 && d.gaps.every((v, i) => (i + 1 < 3) ? v < 60 : IN(v, 570, 780)) && IN(d.endGap, 570, 780), '5～6 連鎖：已連 3 次以上的每一步都該停 ~600ms ' + JSON.stringify(d));
  // 加速（play fast:true，同自動下注）：全不停
  const f = await timed('同局 fast', sd5, { fast: true });
  check(f.gaps.every(v => v < 60) && f.endGap < 60, '加速中不該停頓 ' + JSON.stringify(f));
  // 中途點畫面加速：第 2 次連鎖圈出時點一下 → 之後全不停
  topUp(); g.setRng(DemoCore.makeRng(sd5));
  const off = ui.on('stepStart', dd => { if (dd.chainNo === 2) setTimeout(tapApp, 30); });
  await ui.play('mid', 100, { fast: false }); off();
  {
    const m = rd, gaps = []; for (let i = 1; i < m.ss.length; i++) gaps.push(Math.round(m.ss[i] - m.se[i - 1]));
    const endGap = Math.round(m.end - m.se[m.se.length - 1]);
    pauseRows.push({ label: '第2次連鎖時點畫面', chains: m.ss.length, gaps, endGap, total: Math.round(m.end - m.start) });
    check(gaps.every(v => v < 60) && endGap < 60, '點畫面加速後不該再停頓 ' + JSON.stringify({ gaps, endGap }));
  }
  // 停頓進行中才點：剩下的停頓會跟著加速縮短（不應仍是完整 600ms）
  topUp(); g.setRng(DemoCore.makeRng(sd5));
  const off2 = ui.on('stepEnd', dd => { if (dd.chainNo === 3) setTimeout(tapApp, 150); });
  await ui.play('mid', 100, { fast: false }); off2();
  {
    const m = rd, gap = Math.round(m.ss[3] - m.se[2]);
    pauseRows.push({ label: '停頓中才點畫面', gap3to4: gap });
    check(gap < 560, '停頓中點畫面，剩餘停頓應縮短，實際間隔 ' + gap);
  }
}

// ======== 4. 最寬的紀錄文字不撐破框 ========
const wideRows = [];
{
  const tests = [['wild', r => EV.floor2(r.totalX) >= 100 && String(EV.floor2(r.totalX)).length >= 6], ['mid', r => EV.floor2(r.totalX) >= 10 && String(EV.floor2(r.totalX)).length >= 5]];
  for (const [tier, pred] of tests) {
    const sd = find(tier, 100, pred);
    if (!sd) { wideRows.push({ tier, note: '找不到 seed' }); continue; }
    const R = DemoCore.rollRound(EV.tierIndex(tier), 100, DemoCore.makeRng(sd), false);
    oracle(tier, R.totalX);
    await round(tier, 100, sd);
    await sleep(1500);
    const br = badge.getBoundingClientRect(), bb = badge.querySelector('b').getBoundingClientRect();
    wideRows.push({ tier, text: badgeText(), fits: bb.left >= br.left && bb.right <= br.right, bw: Math.round(bb.width), badge: Math.round(br.width) });
    check(bb.left >= br.left + 1 && bb.right <= br.right - 1, '寬數字 ' + badgeText() + ' 撐出徽章框（' + Math.round(bb.width) + '／' + Math.round(br.width) + '）');
  }
}

// ======== 5. 同一個 seed 連玩 100 局：總賠與核心直接重算完全一致 ========
// 在乾淨的 iframe 跑（先清掉 crate.best，三檔紀錄從零開始，慶祝次數才有意義）；重算只用核心（RULES.draw＋同一條 makeRng），不經任何 UI／extras。
const SEED = 20261120, N = 100;
const det = { rounds: 0, mismatches: 0, expPops: 0, pops: 0 };
{
  localStorage.removeItem('crate.best');
  const ifr = await openFrame('index.html?dev=1');
  const iw = ifr.contentWindow, iui = iw.DEMO.ui, ig = iw.DEMO.game, ibadge = iw.document.getElementById('recordBadge');
  check(ibadge.querySelector('.rv').textContent === '—', '清掉存檔後 iframe 徽章應是「—」');
  let ipops = 0, last = null;
  new iw.MutationObserver(ms => {
    for (let k = 0; k < ms.length; k++) {
      const before = ms[k].oldValue || '', after = k + 1 < ms.length ? (ms[k + 1].oldValue || '') : (ibadge.getAttribute('class') || '');
      if (!/rk-on/.test(before) && /rk-on/.test(after)) ipops++;
    }
  }).observe(ibadge, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  iui.on('roundEnd', d => { last = d; });
  const ref = DemoCore.makeRng(SEED);                          // 純核心重算用的同一條亂數流
  ig.setRng(iw.DemoCore.makeRng(SEED));
  ids.forEach(id => { expBest[id] = 0; });
  ig.addMoney(1000000);
  const wStart = ig.getState().wallet, stakes = EV.CFG.STAKES;
  let sumStake = 0, sumTotal = 0;
  const tc = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const tid = ids[i % 3], st = stakes[(i * 2 + (i >> 1)) % 3];
    const exp = RULES.draw(ref, tid, st);
    const o = oracle(tid, exp.totalX);
    if (o.pop) det.expPops++;
    const r = await iui.play(tid, st, { fast: true });
    const R = last.result;
    sumStake += st; sumTotal += exp.total; tc[i % 3]++;
    const same = R.total === exp.total && r.payout === exp.total && R.chains === exp.chains && JSON.stringify(R.final) === JSON.stringify(exp.final) && JSON.stringify(R.init) === JSON.stringify(exp.init);
    if (!same) { det.mismatches++; if (det.mismatches <= 3) fails.push('第 ' + (i + 1) + ' 局與核心重算不同：畫面局 ' + R.total + '／重算 ' + exp.total); }
    det.rounds++;
  }
  await sleep(500);
  det.pops = ipops;
  check(det.mismatches === 0, '100 局有 ' + det.mismatches + ' 局與核心重算不同');
  check(ig.getState().wallet === wStart - sumStake + sumTotal, '100 局餘額 ≠ 起始−下注＋重算總賠');
  check(det.expPops > 0, '100 局應該至少有一次破紀錄慶祝（測試才有意義）');
  check(det.pops === det.expPops, '100 局慶祝次數 ' + det.pops + ' ≠ 重算期望 ' + det.expPops);
  ids.forEach(id => check(iw.DEMO.extras.best(id) === expBest[id], '100 局後 ' + id + ' 最高 ' + iw.DEMO.extras.best(id) + ' ≠ 重算 ' + expBest[id]));
  const sv = stored(); ids.forEach(id => check(sv && sv[id] === expBest[id], '100 局後存檔 ' + id));
  det.perTier = tc; det.finalBest = { ...expBest };
  ifr.remove();
}
check(uiWarn === 0, '演出盤面與核心不一致 ' + uiWarn + ' 次');

return { ok: fails.length === 0, fails, uiWarn, recRows, switchRows, reloadRows, shotRows, pauseRows, wideRows, det, popsTotal: pops.length };
