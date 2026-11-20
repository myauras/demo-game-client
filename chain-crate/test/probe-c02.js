// C02 對帳探針：在頁內「真的點開箱鈕」連玩多局，逐局驗帳與畫面；再驗演出中重整接回。
// 用法：node shot.mjs --root game --out <out> --probe game/test/probe-c02.js --query dev=1 --timeout 40000
//   （要帶 dev=1：才拿得到 DEMO.dev.seek／useSeed 來指定特殊結果；結果在 checks.json 的 probe 欄）
// 內容是 async 函式本體（shot.mjs 會包起來執行），return 的 JSON 收進結果。
const D = window.DEMO, g = D.game, ui = D.ui;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');
const num = s => +String(s).replace(/,/g, '');
const fails = [];
const rows = [];
function check(cond, msg) { if (!cond) fails.push(msg); return !!cond; }

// 偵測特效層裡有沒有出現金幣飛行（.fly）或大贏字（.bw）
let flyCount = 0, bwCount = 0;
new MutationObserver(ms => {
  for (const m of ms) for (const n of m.addedNodes) {
    if (n.classList && n.classList.contains('fly')) flyCount++;
    if (n.classList && n.classList.contains('bw')) bwCount++;
  }
}).observe($('fx'), { childList: true });

// 演出自己的盤面與核心結尾盤面不一致時會 console.warn('[ui] …') 並改畫核心盤面：這裡計數，必須為 0
let uiWarn = 0; const _w = console.warn; console.warn = function (...a) { if (String(a[0]).indexOf('[ui]') === 0) uiWarn++; _w.apply(console, a); };
// 事件記錄
let ev = null;
ui.on('roundStart', d => { ev = { start: d, steps: [], opens: [], end: null }; });
ui.on('stepStart', d => ev && ev.steps.push(d));
ui.on('stepOpen', d => ev && ev.opens.push(d));
ui.on('roundEnd', d => { if (ev) ev.end = d; });
let tierEvt = 0, stakeEvt = 0;
ui.on('tierChange', () => tierEvt++);
ui.on('stakeChange', () => stakeEvt++);

async function untilIdle(limit = 90000) {
  const t0 = Date.now();
  while (ui.busy()) {
    if (Date.now() - t0 > limit) return false;
    await sleep(40);
  }
  return true;
}
function chipSum() {
  let s = 0, more = false;
  document.querySelectorAll('#slots .slot').forEach(sl => {
    if (sl.querySelector('.more')) { more = true; return; }
    const em = sl.querySelector('em');
    if (em && em.textContent && sl.querySelector('.chip:not(.empty):not(.nxt)')) s += num(em.textContent);
  });
  return { s, more };
}

// 用「真的點」換檔位、換注額、按開箱
async function playOne(label, tierI, stake, opt = {}) {
  if (g.getState().wallet < stake * 2) g.addMoney(20000);
  document.querySelector('.tier[data-i="' + tierI + '"]').click();
  const stakeBtn = [...document.querySelectorAll('#stakes .bet')].find(b => +b.getAttribute('data-v') === stake);
  stakeBtn.click();
  if (opt.seed) D.dev.useSeed(opt.seed);
  await sleep(30);
  const w0 = g.getState().wallet;
  const selOk = check(document.querySelector('.tier.on') && +document.querySelector('.tier.on').getAttribute('data-i') === tierI, label + ' 檔位沒切到');
  check(ui.getStake() === stake && ui.getTier() === EV.ids()[tierI], label + ' 注額／檔位狀態不對');
  flyCount = 0; bwCount = 0;
  $('goBtn').click();
  await sleep(20);
  check(ui.busy(), label + ' 按開箱後沒進入演出');
  // 演出中再點開箱鈕／檔位不該有反應
  $('goBtn').click(); document.querySelector('.tier[data-i="0"]').click();
  if (opt.fast !== false) { await sleep(opt.tap || 350); $('app').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }
  const done = await untilIdle();
  check(done, label + ' 演出逾時');
  await sleep(60);
  const w1 = g.getState().wallet;
  const e = ev && ev.end;
  check(!!e, label + ' 沒收到 roundEnd');
  if (!e) return;
  const R = e.result;
  const expect = w0 - stake + R.total;
  check(w1 === expect, label + ' 核心餘額不對 ' + w1 + ' vs ' + expect);
  check($('wal').textContent === fmt(w1), label + ' 畫面餘額 ' + $('wal').textContent + ' 與核心 ' + fmt(w1) + ' 不一致');
  check(e.payout === R.total && e.net === R.total - stake, label + ' roundEnd 的 payout／net 不對');
  // 清單累計＝核心總賠；各步賠付加總＝總賠；階梯與 stepStart 一致
  check($('totv').textContent === fmt(R.total), label + ' 清單累計 ' + $('totv').textContent + ' ≠ 總賠 ' + fmt(R.total));
  let sumSteps = 0, sumClusters = 0;
  R.steps.forEach(st => { sumSteps += st.pay; st.clusters.forEach(c => { sumClusters += c.pay; }); });
  check(sumSteps === R.total && sumClusters === R.total, label + ' 各步／各片賠付加總 ≠ 總賠');
  check(ev.steps.length === R.chains && ev.opens.length === R.chains, label + ' stepStart／stepOpen 次數 ≠ 連鎖次數');
  if (R.chains) check(ev.steps[R.chains - 1].cum === R.total, label + ' 最後一步 cum ≠ 總賠');
  const cs = chipSum();
  const nChips = document.querySelectorAll('#slots .chip:not(.empty):not(.nxt):not(.more)').length;
  const nCl = R.steps.reduce((a, st) => a + st.clusters.length, 0);
  if (!cs.more) { check(cs.s === R.total && nChips === nCl, label + ' 清單各格加總 ' + cs.s + '（' + nChips + ' 格）≠ 總賠 ' + R.total + '（' + nCl + ' 片）'); }
  else check(cs.s <= R.total && nChips === 4, label + ' 長連鎖清單收納不對（格數 ' + nChips + '）');
  // 清單語氣與回饋等級
  const lootCls = $('loot').className;
  const grade = ui.gradeOf(R.totalX);
  check(e.grade === grade, label + ' grade 不一致');
  if (R.chains === 0) check(!/win|mute/.test(lootCls), label + ' 沒連到卻有語氣 ' + lootCls);
  else if (R.totalX < 1) check(/mute/.test(lootCls) && !/win/.test(lootCls) && /mute/.test($('ladder').className), label + ' 沒回本沒有低調 ' + lootCls);
  else check(/win/.test(lootCls) && !/mute/.test(lootCls), label + ' 回本以上沒有 win ' + lootCls);
  if (R.totalX < 1) check(flyCount === 0 && bwCount === 0 && !$('jp').classList.contains('on'), label + ' 沒回本卻噴金幣／放大字／覆蓋層（fly ' + flyCount + ' bw ' + bwCount + '）');
  if (R.totalX >= 1 && R.totalX < 5) check(flyCount > 0 && bwCount === 0, label + ' 回本以上應有金幣、無大字（fly ' + flyCount + ' bw ' + bwCount + '）');
  if (R.totalX >= 5 && R.totalX < 20) check(flyCount > 0 && bwCount === 1, label + ' 大贏應有金幣與大字（fly ' + flyCount + ' bw ' + bwCount + '）');
  // 盤面：畫面上 42 個箱子，顏色與核心結尾盤面一致
  const crates = [...document.querySelectorAll('#grid .cw')];
  check(crates.length === 42, label + ' 盤面箱數 ' + crates.length);
  const colors = new Array(42).fill(-1), golds = new Array(42).fill(0);
  crates.forEach(cw => {   // DOM 順序不是格序（補進來的箱子在後面），用 --x／--y 換回格序
    const x = parseFloat(cw.style.getPropertyValue('--x')), y = parseFloat(cw.style.getPropertyValue('--y'));
    const idx = (y / 58) * 6 + x / 58;
    colors[idx] = +/\bk(\d)\b/.exec(cw.firstChild.className)[1];
    golds[idx] = cw.firstChild.classList.contains('isg') ? 1 : 0;
  });
  const bad = colors.some((c, i) => c !== (R.final[i] & 7)) || golds.some((gd, i) => gd !== ((R.final[i] & 8) ? 1 : 0));
  // 位置（--x/--y）對應格序
  const posBad = crates.some(cw => {
    const x = parseFloat(cw.style.getPropertyValue('--x')), y = parseFloat(cw.style.getPropertyValue('--y'));
    return !crates.length || (x % 58 !== 0 || y % 58 !== 0);
  });
  check(!bad, label + ' 畫面盤面顏色與核心結尾盤面不符');
  check(!posBad, label + ' 箱子位置不在格點上');
  check(!document.querySelector('.crate.hot') && !document.querySelector('.crate.dim'), label + ' 結算後還有圈出／變暗殘留');
  rows.push({ label, tier: R.tierId, stake, chains: R.chains, total: R.total, x: +R.totalX.toFixed(2), grade, w0, w1, fly: flyCount, bw: bwCount });
}

// ---- 1. 初始狀態：待命只有開箱鈕在發光 ----
check($('goBtn').classList.contains('off') === false, '待命時開箱鈕不該是 off');
check(!document.getElementById('hint').textContent, '#hint 不該有內容');
const idleBoard = [...document.querySelectorAll('#grid .crate')].map(c => +/\bk(\d)\b/.exec(c.className)[1]);
const groups0 = DemoCore.findGroups(idleBoard, 6, 7, 4);
check(groups0.length === 0, '待命盤面不該有可爆的片');
check(!document.querySelector('.lseg.cur') && !document.querySelector('.lseg.done'), '待命時階梯應全暗');
// 切檔：色數＝kinds、階梯標籤＝核心的 ladder、待命盤面只用該檔的顏色
const tierInfo = [];
for (let i = 0; i < 3; i++) {
  document.querySelector('.tier[data-i="' + i + '"]').click();
  await sleep(30);
  const T = EV.TIERS[i];
  const dots = document.querySelectorAll('.tier.on .dots i').length;
  const labels = [...document.querySelectorAll('#ladder .lseg span')].map(s => s.textContent);
  const want = T.ladder.map(m => '×' + EV.fmtX(m));
  const ks = [...document.querySelectorAll('#grid .crate')].map(c => +/\bk(\d)\b/.exec(c.className)[1]);
  check(dots === T.kinds, '檔位 ' + T.id + ' 色塊數 ' + dots);
  check(JSON.stringify(labels) === JSON.stringify(want), '檔位 ' + T.id + ' 階梯 ' + labels.join(' '));
  check(Math.max(...ks) < T.kinds, '檔位 ' + T.id + ' 待命盤面出現超過 ' + T.kinds + ' 色');
  tierInfo.push({ id: T.id, dots, labels: labels.join(' '), maxColor: Math.max(...ks) });
}
check(tierEvt >= 3, 'tierChange 事件沒發');
// ---- 2. 連玩：真實亂數（固定 seed 序列）換檔位與注額 ----
const plan = [];
const stakes = EV.CFG.STAKES;
for (let i = 0; i < 12; i++) plan.push({ t: i % 3, s: stakes[(i * 2 + (i >> 1)) % 3], seed: 7000 + i * 13 });
for (const [i, p] of plan.entries()) await playOne('R' + (i + 1), p.t, p.s, { seed: p.seed, fast: i !== 3 && i !== 8 });
// ---- 3. 特殊結果：沒連到、沒回本、長連鎖（≥6）、大贏、大獎 ----
const sp = [
  ['沒連到', 'stable', r => r.chains === 0],
  ['沒回本', 'mid', r => r.chains >= 1 && r.totalX < 1],
  ['長連鎖', 'stable', r => r.chains >= 6],
  ['大贏', 'wild', r => r.totalX >= 6 && r.totalX < 15],
  ['大獎', 'mid', r => r.totalX >= 22 && r.totalX < 80],
];
for (const [name, tier, pred] of sp) {
  const ti = EV.tierIndex(tier);
  const seed = D.dev.seek(tier, 500, pred);
  check(seed > 0, name + ' 找不到 seed');
  await playOne(name, ti, 500, { seed });
}
const longRow = rows.find(r => r.label === '長連鎖');
// ---- 4. 演出中重整：用同源 iframe 模擬重開頁（共用 localStorage），結果必須直接結算、餘額正確 ----
const wBefore = g.getState().wallet;
document.querySelector('.tier[data-i="1"]').click();
D.dev.useSeed(D.dev.seek('mid', 500, r => r.chains >= 3 && r.totalX >= 1));
ui.setStake(500);
const p = ui.play('mid', 500, {});
await sleep(900);            // 演到一半
const stored = JSON.parse(localStorage.getItem('crate.core'));
const pend = stored && stored.pending;
check(pend && pend.result && pend.result.total >= 0, '演出中存檔沒有進行中那一單');
const expectW = wBefore - 500 + (pend ? pend.result.total : 0);
const ifr = document.createElement('iframe');
ifr.style.cssText = 'position:absolute;left:-9999px;top:0;width:375px;height:812px';
ifr.src = 'index.html?dev=1';   /* 預設網址不留 DEMO.game，探針要讀核心就走 dev 模式 */
document.body.appendChild(ifr);
await new Promise(r => ifr.addEventListener('load', r));
const t0 = Date.now();
while (!(ifr.contentWindow.__demoReady) && Date.now() - t0 < 8000) await sleep(50);
const iw = ifr.contentWindow;
const reload = {
  ready: !!iw.__demoReady,
  wallet: iw.DEMO.game.getState().wallet, shown: iw.document.getElementById('wal').textContent,
  phase: iw.DEMO.game.getState().phase, busy: iw.DEMO.ui.busy(), expectW,
  pendingAfter: (JSON.parse(localStorage.getItem('crate.core')) || {}).pending || null,
  records: iw.DEMO.game.getState().records.length,
};
check(reload.ready, '重整後頁面沒就緒');
check(reload.wallet === expectW, '重整接回餘額 ' + reload.wallet + ' ≠ ' + expectW);
check(reload.shown === fmt(expectW), '重整後畫面餘額 ' + reload.shown + ' ≠ ' + fmt(expectW));
check(reload.phase === 'BET' && !reload.busy && !reload.pendingAfter, '重整後應直接結算、回到待命');
ifr.remove();
await p.catch(() => {});
await untilIdle();
await sleep(100);
check(g.getState().wallet === expectW && $('wal').textContent === fmt(expectW), '原頁演完後餘額 ' + g.getState().wallet + ' ≠ ' + expectW);

check(uiWarn === 0, '演出盤面與核心結尾盤面不一致（被迫改畫）' + uiWarn + ' 次');
return {
  ok: fails.length === 0, fails, uiWarn, rounds: rows.length, tierEvt, stakeEvt,
  grades: rows.reduce((a, r) => (a[r.grade] = (a[r.grade] || 0) + 1, a), {}),
  longChain: longRow && longRow.chains, tierInfo, reload, rows,
};
