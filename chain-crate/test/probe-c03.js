// C03 探針：自動下注、勝負紀錄頁、導演台（含「叫出來的局用同一組 seed 經核心重算結果相同」）。
// 用法（兩種網址各跑一次）：
//   node shot.mjs --root game --out <out> --probe game/test/probe-c03.js --query dev=1 --timeout 120000
//   node shot.mjs --root game --out <out2> --probe game/test/probe-c03.js            （預設網址：只驗看不到導演台、按鈕有反應）
// 內容是 async 函式本體（shot.mjs 會包起來執行），return 的 JSON 收進 checks.json 的 probe 欄。
// 不帶 ?shot，所以存檔照常寫（每張圖是獨立無痕 context，不會汙染別處）。
const D = window.DEMO, g = D.game, ui = D.ui, t = window.t;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); return !!c; };
const waitFor = async (cond, limit = 120000, step = 40) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > limit) return false; await sleep(step); } return true; };
const untilIdle = () => waitFor(() => !ui.busy(), 90000);
const coreRecords = () => (JSON.parse(localStorage.getItem('crate.core')) || {}).records || [];

// 事件記錄（roundEnd 當下的核心餘額一併記）
const starts = [], ends = [];
ui.on('roundStart', d => starts.push(d));
ui.on('roundEnd', d => ends.push({ d, core: g.getState().wallet }));
let uiWarn = 0; const _w = console.warn; console.warn = function (...a) { if (String(a[0]).indexOf('[ui]') === 0) uiWarn++; _w.apply(console, a); };

const out = { dev: D.q.dev };

// ---------- 0. 預設網址／導演台顯隱、按鈕有反應 ----------
const dirOn = $('director').classList.contains('on');
if (!D.q.dev) {
  check(typeof D.dev === 'undefined', '預設網址 DEMO.dev 應為 undefined，實際 ' + typeof D.dev);
  check(!dirOn, '預設網址不該顯示導演台');
  check(!$('director').textContent.trim(), '預設網址導演台容器應為空');
  out.nodev = { devType: typeof D.dev, directorOn: dirOn };
} else {
  check(typeof D.dev === 'object', 'dev=1 應有 DEMO.dev');
  check(dirOn, 'dev=1 應顯示導演台');
}
// 紀錄鈕、自動鈕要有反應（C02 留下的「按了沒反應」）
$('logBtn').click(); await sleep(60);
check(LogUI.isOpen() && document.querySelector('.lgm.show'), '按紀錄鈕沒開紀錄頁');
LogUI.close();
$('autoBtn').click(); await sleep(60);
check(document.querySelector('.sheet.show'), '按自動鈕沒開彈窗');
Autobet.closeSheet();
if (!D.q.dev) { out.fails = fails; out.ok = fails.length === 0; return out; }

// ---------- 1. 彈窗預設帶入目前檔位與注額 ----------
ui.setTier('wild'); ui.setStake(1000);
$('autoBtn').click(); await sleep(60);
const selChoice = document.querySelector('.sheet .seg[data-k="choice"] button.on');
const selStake = document.querySelector('.sheet .seg[data-k="stake"] button.on');
check(selChoice && selChoice.getAttribute('data-v') === 'wild', '彈窗選項沒帶入目前檔位');
check(selStake && selStake.getAttribute('data-v') === '1000', '彈窗單注沒帶入目前注額');
out.sheetSync = { choice: selChoice && selChoice.getAttribute('data-v'), stake: selStake && selStake.getAttribute('data-v') };
Autobet.closeSheet();
ui.setTier('mid'); ui.setStake(100);

// ---------- 2. 自動下注：5 局跑完自動停，逐局餘額對帳 ----------
async function runAuto(label, cfg, prep) {
  if (g.getState().wallet < cfg.stake * 12) g.addMoney(20000);
  if (prep) prep();
  const n0 = ends.length, w0 = g.getState().wallet;
  const ok = Autobet.start(cfg);
  check(ok, label + ' Autobet.start 回 false');
  // 剛開始、還沒進局的空檔手點開箱必須被擋掉
  $('goBtn').click();
  check(!ui.busy(), label + ' 自動下注進行中手點開箱沒被擋');
  const toastAfterClick = $('toast') ? $('toast').textContent : '';
  await waitFor(() => Autobet.state().n >= 1, 20000);
  const barText = $('abar').textContent;
  check($('abar').classList.contains('on'), label + ' 進行中浮條沒顯示');
  await waitFor(() => !Autobet.isRunning(), 180000);
  check(!Autobet.isRunning(), label + ' 沒自動停');
  const toast = $('toast').textContent;
  await untilIdle(); await sleep(80);
  const st = Autobet.state();
  const mine = ends.slice(n0);
  // 逐局對帳：每局結束的核心餘額＝上一局結束 − 注額 ＋ 總賠
  let exp = w0, bad = [];
  mine.forEach((e, i) => {
    exp = exp - e.d.stake + e.d.total;
    if (e.core !== exp || e.d.wallet !== exp) bad.push((i + 1) + ':' + e.core + '/' + e.d.wallet + '≠' + exp);
  });
  check(bad.length === 0, label + ' 逐局餘額對不上 ' + bad.join(' '));
  check(g.getState().wallet === exp && $('wal').textContent === fmt(exp), label + ' 最終餘額／畫面不一致 ' + g.getState().wallet + ' ' + $('wal').textContent + ' exp ' + exp);
  check(st.pnl === exp - w0, label + ' Autobet 累計盈虧 ' + st.pnl + ' ≠ ' + (exp - w0));
  check(!$('abar').classList.contains('on'), label + ' 結束後浮條沒收');
  return { n0, w0, mine, st, toast, toastAfterClick, barText, wEnd: exp };
}
const A5 = await runAuto('5局', { choice: 'alt', stake: 100, rounds: 5, tp: 0, sl: 0 });
check(A5.mine.length === 5 && A5.st.n === 5, '5 局：實際局數 ' + A5.mine.length + '／state.n ' + A5.st.n);
check(A5.toast === t('auto.end', { reason: t('auto.endDone', { n: 5 }), n: 5, pnl: D.signed(A5.st.pnl) }), '5 局：結束提示不對「' + A5.toast + '」');
check(A5.toastAfterClick === t('wire.autoRunning'), '5 局：擋手點時沒提示「' + A5.toastAfterClick + '」');
check(/1\/5/.test(A5.barText), '5 局：浮條文字「' + A5.barText + '」');
const tierSeq = A5.mine.map(e => e.d.tier).join(',');
check(tierSeq === 'stable,mid,wild,stable,mid', '輪流順序不對 ' + tierSeq);
out.auto5 = { rounds: A5.mine.length, pnl: A5.st.pnl, tiers: tierSeq, toast: A5.toast, wallets: A5.mine.map(e => e.core) };

// ---------- 3. 停利、停損各觸發一次（用導演台叫結果，確保一定觸發） ----------
const TP = await runAuto('停利', { choice: 'mid', stake: 500, rounds: 10, tp: 1000, sl: 0 }, () => D.dev.force('big', { sticky: true }));
D.dev.clear();
check(TP.mine.length === 1 && TP.st.pnl >= 1000, '停利：局數 ' + TP.mine.length + ' pnl ' + TP.st.pnl);
check(TP.toast.indexOf(t('auto.endTp', { n: fmt(1000) })) >= 0, '停利：提示不對「' + TP.toast + '」');
const SL = await runAuto('停損', { choice: 'mid', stake: 500, rounds: 10, tp: 0, sl: 500 }, () => D.dev.force('none', { sticky: true }));
D.dev.clear();
check(SL.mine.length === 1 && SL.st.pnl <= -500, '停損：局數 ' + SL.mine.length + ' pnl ' + SL.st.pnl);
check(SL.toast.indexOf(t('auto.endSl', { n: fmt(500) })) >= 0, '停損：提示不對「' + SL.toast + '」');
out.tp = { rounds: TP.mine.length, pnl: TP.st.pnl, toast: TP.toast };
out.sl = { rounds: SL.mine.length, pnl: SL.st.pnl, toast: SL.toast };

// ---------- 4. 導演台五種結果 × 三個檔位：叫出來的局用同一個 seed 經核心重算，結果必須逐項相同 ----------
const KIND_OK = {
  none:    (R, e) => R.chains === 0 && e.grade === 'miss',
  small:   (R, e) => R.chains >= 1 && R.totalX < 1 && e.grade === 'miss',
  back:    (R, e) => R.totalX >= 1 && R.totalX < EV.CFG.BIG_X && e.grade === 'back',
  big:     (R, e) => R.totalX >= EV.CFG.BIG_X && R.totalX < EV.CFG.JACKPOT_X && e.grade === 'big',
  jackpot: (R, e) => R.totalX >= EV.CFG.JACKPOT_X && e.grade === 'jackpot',
};
const dirRows = [];
const sameResult = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const [ti, tid] of EV.ids().entries()) {
  for (const kind of D.dev.kinds) {
    if (g.getState().wallet < 5000) g.addMoney(20000);
    ui.setTier(tid); ui.setStake(500);
    const nH = D.dev.history.length, n0 = ends.length, w0 = g.getState().wallet;
    // 中檔用真的按導演台面板的鈕；其他檔位走 API
    if (tid === 'mid') { $('devTog').click(); $('devK-' + kind).click(); check(!$('director').classList.contains('open'), '按了導演台鈕面板沒收起'); }
    else D.dev.force(kind);
    const info = D.dev.armedInfo();
    check(info && info.label, kind + ' 預約後 armedInfo 空');
    $('goBtn').click();
    await sleep(30);
    if (kind === 'jackpot') { await waitFor(() => $('jp').classList.contains('on'), 20000); await sleep(300); $('jp').click(); }
    await untilIdle(); await sleep(60);
    const lab = tid + '/' + kind;
    check(ends.length === n0 + 1, lab + ' 沒收到 roundEnd');
    const e = ends[ends.length - 1].d, R = e.result;
    const pick = D.dev.last;
    check(D.dev.history.length === nH + 1 && pick && pick.orderId === e.orderId && pick.kind === kind, lab + ' 叫出來的紀錄對不上 ' + JSON.stringify(pick));
    check(pick && pick.seed > 0 && pick.tier === tid && pick.stake === 500, lab + ' pick 內容不對 ' + JSON.stringify(pick));
    check(KIND_OK[kind](R, e), lab + ' 結果不符種類：chains ' + R.chains + ' x ' + R.totalX.toFixed(2) + ' grade ' + e.grade);
    // 重算：同檔位、同注額、同 seed，經核心 rollRound（不經導演台任何程式）
    const again = DemoCore.rollRound(ti, 500, DemoCore.makeRng(pick.seed), false);
    check(sameResult(again, R), lab + ' 重算結果與叫出來的那局不同');
    check(sameResult(D.dev.replay(pick), R), lab + ' D.dev.replay 與那局不同');
    check(R.total === again.total && e.payout === again.total, lab + ' 派彩與重算總賠不同');
    check(g.getState().wallet === w0 - 500 + R.total && $('wal').textContent === fmt(g.getState().wallet), lab + ' 餘額對帳失敗');
    // 一次性：預約已消耗，下一局不該再被叫
    check(D.dev.armedInfo() === null, lab + ' 預約沒消耗（應一次性）');
    dirRows.push({ tier: tid, kind, seed: pick.seed, chains: R.chains, x: +R.totalX.toFixed(2), grade: e.grade, replayEqual: sameResult(again, R) });
  }
}
// 沒預約的一局：不該被記成「叫出來的」
{
  const nH = D.dev.history.length; ui.setTier('mid'); ui.setStake(100);
  $('goBtn').click(); await sleep(30); await untilIdle(); await sleep(60);
  check(D.dev.history.length === nH, '沒預約的局被記成導演台叫的');
}
out.director = { rounds: dirRows.length, rows: dirRows };

// ---------- 5. 紀錄頁：內容與核心注單一致（含詳細頁逐次連鎖）、封頂 50 筆 ----------
// 5a. 叫一局 ≥3 連鎖且回本以上的，開詳細頁逐項比對
D.dev.forceWhere(r => r.chains >= 3 && r.totalX >= 1 && r.totalX < EV.CFG.BIG_X, { label: 'detail', sticky: false });
ui.setTier('mid'); ui.setStake(500);
$('goBtn').click(); await sleep(30); await untilIdle(); await sleep(60);
const eD = ends[ends.length - 1].d, RD = eD.result;
LogUI.openDetail(0); await sleep(80);
const kvs = [...document.querySelectorAll('.lgm .kv')].map(k => [k.children[0].textContent, k.children[1].textContent]);
const kvMap = Object.fromEntries(kvs);
const bigTxt = document.querySelector('.lgm .ldh .big').textContent;
check(bigTxt === D.signed(eD.payout - eD.stake), '詳細頁大字 ' + bigTxt);
check(kvMap[t('log.row.tier')] === t('tier.mid'), '詳細頁檔位 ' + kvMap[t('log.row.tier')]);
check(kvMap[t('log.row.stake')] === fmt(500), '詳細頁下注');
check(kvMap[t('log.row.chains')] === String(RD.chains), '詳細頁連鎖數');
check(kvMap[t('log.row.pay')] === fmt(RD.total), '詳細頁拿回');
check(kvMap[t('log.row.odds')] === '×' + EV.fmtX(RD.totalX), '詳細頁倍數 ' + kvMap[t('log.row.odds')]);
check(kvMap[t('log.order')] === eD.orderId, '詳細頁注單號');
let stepOk = RD.steps.length >= 3;
RD.steps.forEach((s, i) => { if (kvMap[t('log.row.c' + (i + 1))] !== '×' + EV.fmtX(s.mult) + '　+' + fmt(s.pay)) stepOk = false; });
check(stepOk, '詳細頁逐次連鎖與核心不符 ' + JSON.stringify(kvs));
const stepSum = RD.steps.reduce((a, s) => a + s.pay, 0);
check(stepSum === RD.total, '逐次賠付加總 ≠ 總賠');
check(document.querySelectorAll('.lgm .kv').length === 1 + 5 + RD.chains + 1, '詳細頁列數 ' + document.querySelectorAll('.lgm .kv').length);
out.detail = { chains: RD.chains, total: RD.total, rows: kvs.length };
LogUI.close();

// 5b. 補到 >50 局（導演台連續叫「沒中」最快），驗封頂與每筆內容
D.dev.force('none', { sticky: true });
ui.setTier('mid'); ui.setStake(100);
const playedIds = ends.map(e => e.d.orderId);
let guard = 0;
while (ends.length < 58 && guard++ < 80) {
  if (g.getState().wallet < 300) g.addMoney(20000);
  $('goBtn').click(); await sleep(30); await untilIdle(); await sleep(20);
}
D.dev.clear();
await sleep(80);
const L = LogUI.list(), core = coreRecords(), byId = {};
core.forEach(r => byId[r.orderId] = r);
check(ends.length >= 58, '補局數不夠 ' + ends.length);
check(L.length === EV.CFG.LOG_CAP, '紀錄筆數 ' + L.length + ' ≠ ' + EV.CFG.LOG_CAP);
const want = ends.slice(-EV.CFG.LOG_CAP).map(e => e.d.orderId).reverse();
check(JSON.stringify(L.map(r => r.id)) === JSON.stringify(want), '紀錄的注單（最新在前）≠ 最近 50 局');
let rowBad = [];
L.forEach(r => {
  const c = byId[r.id];
  if (!c) { rowBad.push(r.id + ' 核心找不到'); return; }
  const rm = Object.fromEntries(r.rows.map(x => [x.k, x.v]));
  if (r.stake !== c.stake || r.pay !== c.payout || r.ts !== c.ts) rowBad.push(r.id + ' 金額／時間');
  if (rm['log.row.tier'] !== t('tier.' + c.choice) || rm['log.row.stake'] !== fmt(c.stake) || rm['log.row.chains'] !== String(c.chains) ||
      rm['log.row.pay'] !== fmt(c.payout) || rm['log.row.odds'] !== '×' + EV.fmtX(c.payout / c.stake)) rowBad.push(r.id + ' 欄位');
  if (r.rows.length !== 5 + c.chains) rowBad.push(r.id + ' 逐次連鎖列數 ' + r.rows.length + ' vs 連鎖 ' + c.chains);
});
check(rowBad.length === 0, '紀錄與核心注單不一致：' + rowBad.slice(0, 5).join('；'));
const stored = JSON.parse(localStorage.getItem('crate.log') || '[]');
check(stored.length === EV.CFG.LOG_CAP, 'localStorage 的 crate.log 筆數 ' + stored.length);
LogUI.open(); await sleep(80);
const domRows = document.querySelectorAll('.lgm .lrowi').length;
const countTxt = document.querySelector('.lgm .lgcount').textContent;
check(domRows === 50 && countTxt === t('log.count', { n: 50, cap: 50 }), '總覽頁列數 ' + domRows + '／' + countTxt);
const firstTxt = document.querySelector('.lgm .lrowi .lv').textContent;
const last = ends[ends.length - 1].d;
check(firstTxt === D.signed(last.payout > 0 ? last.payout - last.stake : -last.stake), '總覽第一列金額 ' + firstTxt);
LogUI.close();
out.log = { listLen: L.length, cap: EV.CFG.LOG_CAP, played: ends.length, storedLen: stored.length, domRows, countTxt, mismatches: rowBad.length };

// ---------- 6. 導演台面板：位置、加 1 萬、重置錢包 ----------
$('devTog').click();
const pr = $('devPanel').getBoundingClientRect(), tr = $('devTog').getBoundingClientRect(), app = $('app').getBoundingClientRect();
check($('director').classList.contains('open') && pr.left >= app.left - 0.5 && pr.right <= app.right + 0.5 && pr.bottom <= app.bottom, '導演台面板超出畫面 ' + JSON.stringify([pr.left, pr.right, pr.bottom]));
check(tr.top >= 0 && tr.right <= app.right, '導演台開關鈕位置不對');
$('devTog').click();
const wA = g.getState().wallet;
$('devAdd').click(); await sleep(50);
check(g.getState().wallet === wA + 10000, '＋10,000 沒加到 ' + g.getState().wallet + ' vs ' + (wA + 10000));
$('devReset').click(); await sleep(100);
check(g.getState().wallet === EV.CFG.WALLET && $('wal').textContent === fmt(EV.CFG.WALLET), '重置錢包後餘額 ' + g.getState().wallet);
check(LogUI.list().length === 0, '重置錢包後紀錄沒清');
check(coreRecords().length === 0, '重置錢包後核心注單沒清');
out.panel = { open: true, panelRect: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.right), Math.round(pr.bottom)] };

// ---------- 7. 自動下注進行中重整：中止並提示（同源 iframe 模擬重開頁） ----------
D.dev.force('small', { sticky: true });
ui.setTier('mid'); ui.setStake(100);
Autobet.start({ choice: 'mid', stake: 100, rounds: 10, tp: 0, sl: 0 });
await waitFor(() => Autobet.state().n >= 2 && ui.busy(), 60000);
await sleep(500);
const storedCore = JSON.parse(localStorage.getItem('crate.core'));
const pend = storedCore && storedCore.pending;
check(pend && pend.orderId, '重整前存檔沒有進行中那一單');
check(JSON.parse(localStorage.getItem('crate.auto')), '重整前沒有自動下注進行中旗標');
const ifr = document.createElement('iframe');
ifr.style.cssText = 'position:absolute;left:-9999px;top:0;width:375px;height:812px';
ifr.src = 'index.html?dev=1';   /* 預設網址不留 DEMO.game，探針要讀核心就走 dev 模式 */
document.body.appendChild(ifr);
await new Promise(r => ifr.addEventListener('load', r));
await waitFor(() => ifr.contentWindow.__demoReady, 8000);
await sleep(900);
const iw = ifr.contentWindow;
const re = {
  ready: !!iw.__demoReady,
  autoRunning: iw.Autobet.isRunning(),
  toast: iw.document.getElementById('toast') ? iw.document.getElementById('toast').textContent : '',
  phase: iw.DEMO.game.getState().phase,
  hasPending: pend && iw.LogUI.has(pend.orderId),
};
check(re.ready && !re.autoRunning, '重整後自動下注應中止');
check(/^重整已中止自動下注（\d+\/10 局，累計 /.test(re.toast), '重整後沒有中止提示「' + re.toast + '」');
check(re.phase === 'BET', '重整後核心應直接結算回待命');
check(re.hasPending, '重整接回的那一局沒補記進紀錄');
const iLog = iw.LogUI.list().find(r => pend && r.id === pend.orderId);
check(iLog && iLog.rows.length >= 5 && iLog.stake === 100, '接回補記的紀錄內容不對 ' + JSON.stringify(iLog));
ifr.remove();
Autobet.stop();
await waitFor(() => !Autobet.isRunning(), 60000);
await untilIdle();
D.dev.clear();
out.reload = re;

check(uiWarn === 0, '演出盤面與核心結尾盤面不一致 ' + uiWarn + ' 次');
out.uiWarn = uiWarn;
out.fails = fails;
out.ok = fails.length === 0;
return out;
