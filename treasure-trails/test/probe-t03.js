// T03 探針：自動下注（局數／停利／停損／餘額不足／手動停／重整中止）、勝負紀錄頁、導演台。
// 用法（兩種網址各跑一次）：
//   node shot.mjs --root game --out <out>  --probe game/test/probe-t03.js --query dev=1 --timeout 240000
//   node shot.mjs --root game --out <out2> --probe game/test/probe-t03.js --timeout 240000      （預設網址：只驗沒有把手、按鈕有反應、自動下注帳對）
// 內容是 async 函式本體（shot.mjs 會包起來執行），return 的 JSON 收進 checks.json 的 probe 欄。
const D = window.DEMO, ui = D.ui, t = window.t, dev = !!D.q.dev;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); return !!c; };
const waitFor = async (cond, limit = 120000, step = 40) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > limit) return false; await sleep(step); } return true; };
const untilIdle = () => waitFor(() => !ui.busy(), 90000);
const walletNow = () => dev ? D.game.getState().wallet : parseInt($('wal').textContent.replace(/,/g, ''), 10);
const coreSaved = () => JSON.parse(localStorage.getItem('trails.core') || '{}');
const IDS = EV.ids();

// 事件記錄（roundEnd 當下的核心餘額一併記）
const ends = [];
ui.on('roundEnd', d => ends.push({ d, wal: dev ? D.game.getState().wallet : null }));
// 一局開著大獎覆蓋層時自動點掉（跳過 2.3 秒停留）
const ovTimer = setInterval(() => { const o = $('ov'); if (o && o.classList.contains('on')) o.click(); }, 120);
// 自動下注進行中浮條文字不得出現 NaN／undefined
const barTexts = [];
const barTimer = setInterval(() => { barTexts.push($('abar').textContent); }, 150);
const out = { dev };

// ---------- 0. 預設網址／導演台顯隱、按鈕有反應 ----------
if (!dev) {
  check(typeof D.dev === 'undefined', '預設網址 DEMO.dev 應為 undefined，實際 ' + typeof D.dev);
  check(typeof D.game === 'undefined', '預設網址 DEMO.game 應為 undefined，實際 ' + typeof D.game);
  check(Object.keys(D.shots || {}).length === 0, '預設網址 DEMO.shots 應清空：' + Object.keys(D.shots || {}).join(','));
  check(!$('director').classList.contains('on') && !$('director').textContent.trim(), '預設網址不該有導演台');
  out.nodev = { dev: typeof D.dev, game: typeof D.game, shots: Object.keys(D.shots || {}).length };
} else {
  check(typeof D.dev === 'object' && D.dev.kinds.length === 7, 'dev=1 應有 DEMO.dev（7 種結果）');
  check($('director').classList.contains('on') && $('devTog'), 'dev=1 應顯示導演台');
}
$('logBtn').click(); await sleep(60);
check(LogUI.isOpen() && document.querySelector('.lgm.show'), '按紀錄鈕沒開紀錄頁');
LogUI.close();
$('autoBtn').click(); await sleep(60);
check(document.querySelector('.sheet.show'), '按自動鈕沒開彈窗');
Autobet.closeSheet(); await sleep(60);

// ---------- 1. 彈窗預設帶入目前路線與注額 ----------
ui.setRoute('risk'); ui.setStake(1000);
$('autoBtn').click(); await sleep(60);
const selChoice = document.querySelector('.sheet .seg[data-k="choice"] button.on');
const selStake = document.querySelector('.sheet .seg[data-k="stake"] button.on');
check(selChoice && selChoice.getAttribute('data-v') === 'risk', '彈窗路線沒帶入目前路線');
check(selStake && selStake.getAttribute('data-v') === '1000', '彈窗單注沒帶入目前注額');
out.sheetSync = { choice: selChoice && selChoice.getAttribute('data-v'), stake: selStake && selStake.getAttribute('data-v') };
Autobet.closeSheet(); await sleep(60);
ui.setRoute('mid'); ui.setStake(100);

// ---------- 2. 自動下注 ----------
async function runAuto(label, cfg, prep, onStart, noTopUp) {
  if (dev && !noTopUp && D.game.getState().wallet < cfg.stake * 12) D.game.addMoney(20000);
  if (prep) prep();
  const n0 = ends.length, w0 = walletNow();
  const ok = Autobet.start(cfg);
  check(ok, label + ' Autobet.start 回 false');
  if (onStart) await onStart();
  await waitFor(() => !Autobet.isRunning(), 200000);
  check(!Autobet.isRunning(), label + ' 沒自動停');
  const toast = $('toast').textContent;
  await untilIdle(); await sleep(150);
  const st = Autobet.state(), mine = ends.slice(n0);
  let exp = w0, bad = [], net = 0;
  mine.forEach((e, i) => {
    exp = exp - e.d.stake + e.d.total; net += e.d.total - e.d.stake;
    if (dev && (e.wal !== exp || e.d.wallet !== exp)) bad.push((i + 1) + ':' + e.wal + '/' + e.d.wallet + '≠' + exp);
    if (!isFinite(e.d.pay) || !isFinite(e.d.stake)) bad.push((i + 1) + ': pay/stake 不是數字');
  });
  check(bad.length === 0, label + ' 逐局餘額對不上 ' + bad.join(' '));
  check(walletNow() === exp && $('wal').textContent === fmt(exp), label + ' 最終餘額／畫面 ' + walletNow() + ' ' + $('wal').textContent + ' exp ' + exp);
  check(isFinite(st.pnl) && st.pnl === net && net === walletNow() - w0, label + ' Autobet 累計 ' + st.pnl + ' ≠ 錢包變化 ' + (walletNow() - w0));
  check(st.n === mine.length, label + ' state.n ' + st.n + ' ≠ 實際局數 ' + mine.length);
  check(!$('abar').classList.contains('on'), label + ' 結束後浮條沒收');
  return { mine, st, toast, w0, wEnd: exp, net };
}

// 2a. 局數到停：5 局輪流（穩→中→拚→穩→中），途中手點出發／換路線／換注額都被擋
const A5 = await runAuto('5局', { choice: 'alt', stake: 100, rounds: 5, tp: 0, sl: 0 }, null, async () => {
  await sleep(200);
  const nBefore = ends.length;
  $('goBtn').click(); $('tabs').querySelector('.tab:not(.on)').click(); $('stakes').querySelector('.bet:not(.on)').click();
  out.blockToast = $('toast').textContent;
  check(out.blockToast === t('wire.autoRunning'), '自動下注中手點沒被擋或沒提示「' + out.blockToast + '」');
  check(ui.getStake() === 100, '自動下注中換注額沒被擋');
  await waitFor(() => Autobet.state().n >= 1, 20000);
  check($('abar').classList.contains('on') && /1\/5/.test($('abar').textContent), '進行中浮條 ' + $('abar').textContent);
  out.barText = $('abar').textContent;
});
check(A5.mine.length === 5 && A5.st.n === 5, '5 局：實際局數 ' + A5.mine.length);
check(A5.toast === t('auto.end', { reason: t('auto.endDone', { n: 5 }), n: 5, pnl: D.signed(A5.st.pnl) }), '5 局：結束提示「' + A5.toast + '」');
const routeSeq = A5.mine.map(e => e.d.route).join(',');
check(routeSeq === 'safe,mid,risk,safe,mid', '輪流順序 ' + routeSeq);
out.auto5 = { rounds: A5.mine.length, pnl: A5.st.pnl, routes: routeSeq, toast: A5.toast };

if (dev) {
  // 2b. 停利：中路線 500、導演台連叫大贏，一局就觸發
  const TP = await runAuto('停利', { choice: 'mid', stake: 500, rounds: 10, tp: 1000, sl: 0 }, () => D.dev.force('big', { sticky: true }));
  D.dev.clear();
  check(TP.mine.length === 1 && TP.st.pnl >= 1000, '停利：局數 ' + TP.mine.length + ' pnl ' + TP.st.pnl);
  check(TP.toast.indexOf(t('auto.endTp', { n: fmt(1000) })) >= 0, '停利提示「' + TP.toast + '」');
  // 2c. 停損：連叫什麼都沒拿到
  const SL = await runAuto('停損', { choice: 'mid', stake: 500, rounds: 10, tp: 0, sl: 500 }, () => D.dev.force('none', { sticky: true }));
  D.dev.clear();
  check(SL.mine.length === 1 && SL.st.pnl <= -500, '停損：局數 ' + SL.mine.length + ' pnl ' + SL.st.pnl);
  check(SL.toast.indexOf(t('auto.endSl', { n: fmt(500) })) >= 0, '停損提示「' + SL.toast + '」');
  // 2d. 餘額不足：重置成 10,000，拚路線 1,000 連叫什麼都沒拿到，賠光自動停
  await untilIdle(); $('devReset').click(); await sleep(150);
  check(D.game.getState().wallet === EV.CFG.WALLET, '重置錢包後餘額 ' + D.game.getState().wallet);
  const MN = await runAuto('餘額不足', { choice: 'risk', stake: 1000, rounds: 50, tp: 0, sl: 0 }, () => D.dev.force('none', { sticky: true }), null, true);
  D.dev.clear();
  check(MN.mine.length === 10 && MN.wEnd === 0, '餘額不足：局數 ' + MN.mine.length + ' 最終 ' + MN.wEnd);
  check(MN.toast.indexOf(t('auto.endMoney')) >= 0, '餘額不足提示「' + MN.toast + '」');
  // 沒錢時按「自動」也不能開跑
  const refused = Autobet.start({ choice: 'mid', stake: 100, rounds: 5, tp: 0, sl: 0 });
  check(refused === false && !Autobet.isRunning(), '餘額 0 不該開得了自動下注');
  D.game.addMoney(20000); await sleep(100);
  // 2e. 手動停止：本局演完才停
  const nS0 = ends.length;
  Autobet.start({ choice: 'mid', stake: 100, rounds: 50, tp: 0, sl: 0 });
  await waitFor(() => Autobet.state().n >= 1 && ui.busy(), 30000);
  document.querySelector('#abar .astop').click(); await sleep(60);
  check(/本局後停止/.test($('abar').textContent) || !Autobet.isRunning(), '按停止後浮條沒顯示「本局後停止」：' + $('abar').textContent);
  await waitFor(() => !Autobet.isRunning(), 60000); await untilIdle(); await sleep(100);
  const toastStop = $('toast').textContent;
  check(ends.length - nS0 === Autobet.state().n && ends.length - nS0 >= 1, '手動停止：局數 ' + (ends.length - nS0) + ' vs state.n ' + Autobet.state().n);
  check(toastStop.indexOf(t('auto.endStop')) >= 0, '手動停止提示「' + toastStop + '」');
  out.stop = { rounds: ends.length - nS0, toast: toastStop };
  out.tp = { rounds: TP.mine.length, pnl: TP.st.pnl }; out.sl = { rounds: SL.mine.length, pnl: SL.st.pnl };
  out.money = { rounds: MN.mine.length, end: MN.wEnd, toast: MN.toast };
} else {
  // 預設網址：多跑一個 3 局自動下注（拚路線 500），帳要對、能手動停
  const R3 = await runAuto('預設3局', { choice: 'risk', stake: 500, rounds: 3, tp: 0, sl: 0 });
  check(R3.mine.length === 3, '預設網址 3 局：實際 ' + R3.mine.length);
  out.default3 = { rounds: R3.mine.length, pnl: R3.st.pnl };
}

// ---------- 3. 預設網址：手點出發一局、紀錄頁一致，然後結束 ----------
async function checkDetail(e, label) {            // 開詳細頁，逐項對 roundEnd 的結果物件
  const R = e.d.result, rec = e.d.record;
  LogUI.openDetail(0); await sleep(80);
  const kvs = [...document.querySelectorAll('.lgm .kv')].map(k => [k.children[0].textContent, k.children[1].textContent]);
  const big = document.querySelector('.lgm .ldh .big');
  const net = e.d.pay - e.d.stake;
  check(big.textContent === D.signed(net), label + ' 詳細頁大字 ' + big.textContent + ' vs ' + D.signed(net));
  check(big.classList.contains(net >= 0 ? 'gold' : 'grey') && !big.classList.contains(net >= 0 ? 'grey' : 'gold'), label + ' 詳細頁配色（淨額 ' + net + '）：' + big.className);
  const want = [[t('log.time'), D.fmtTime(rec.ts)],
    [t('log.row.r.' + R.route), t('route.' + R.route)], [t('log.row.stake'), fmt(R.stake)], [t('log.row.pay'), fmt(R.total)],
    [t('log.row.odds'), '×' + EV.fmtX(R.total / R.stake)], [t('log.row.end'), t(R.reachedEnd ? 'log.end.done' : 'log.end.retreat')],
    [t('log.row.hearts'), R.heartsLeft + '／' + R.hearts]];
  R.prizes.forEach((p, i) => want.push([t('log.row.p' + (i + 1)), '×' + EV.fmtX(p.v) + '　+' + fmt(p.amount)]));
  R.fights.forEach((f, i) => want.push([t('log.row.f' + (i + 1)), f.need + '+　' + f.dice[0] + '＋' + f.dice[1] + '＝' + f.sum + '　' + t(f.win ? 'log.win' : 'log.lose')]));
  want.push([t('log.order'), e.d.orderId]);
  const bad = [];
  want.forEach((w, i) => { if (!kvs[i] || kvs[i][0] !== w[0] || kvs[i][1] !== w[1]) bad.push(i + ':' + JSON.stringify(kvs[i]) + '≠' + JSON.stringify(w)); });
  check(bad.length === 0 && kvs.length === want.length, label + ' 詳細頁與該局不一致：' + bad.slice(0, 4).join('；') + '／列數 ' + kvs.length + ' vs ' + want.length);
  check(R.prizes.reduce((a, p) => a + p.amount, 0) === R.total, label + ' 寶物金額加總 ≠ 拿回');
  LogUI.close();
  return { rows: kvs.length, prizes: R.prizes.length, rolls: R.fights.length };
}
async function checkOverviewTop(e, label) {       // 總覽最新一列：色點、注額、淨額與配色
  LogUI.open(); await sleep(80);
  const row = document.querySelector('.lgm .lrowi'), v = row.querySelector('.lv');
  const net = e.d.pay - e.d.stake, dot = row.querySelector('.rdot'), st = row.querySelector('.rst');
  check(v.textContent === D.signed(net) && v.classList.contains(net >= 0 ? 'gold' : 'grey'), label + ' 總覽金額／配色 ' + v.textContent + ' ' + v.className);
  const rgb = { safe: 'rgb(79, 154, 62)', mid: 'rgb(231, 174, 28)', risk: 'rgb(214, 59, 42)' }[e.d.route];
  check(dot && dot.style.backgroundColor === rgb, label + ' 路線色點 ' + (dot && dot.style.backgroundColor) + ' 應為 ' + rgb);
  check(st && st.textContent === fmt(e.d.stake), label + ' 總覽注額 ' + (st && st.textContent));
  LogUI.close();
}
{
  ui.setRoute('safe'); ui.setStake(500); await sleep(60);
  const n0 = ends.length, w0 = walletNow();
  $('goBtn').click();
  check(ui.busy(), '手點出發後應進入演出');
  await sleep(300); await untilIdle(); await sleep(120);
  check(ends.length === n0 + 1, '手點出發沒有一局');
  const e = ends[ends.length - 1];
  check(walletNow() === w0 - 500 + e.d.total && $('wal').textContent === fmt(walletNow()), '手點一局：餘額對不上');
  out.manual = await checkDetail(e, '手點一局');
  await checkOverviewTop(e, '手點一局');
}

// ---------- 4. 導演台：每條路 × 每種結果，叫出來的局用同一組種子經核心重算要逐項相同 ----------
if (dev) {
  const KIND_OK = {
    none:    R => R.prizes.length === 0,
    small:   R => R.total > 0 && R.total < R.stake,
    back:    R => R.total >= R.stake && R.total < R.stake * EV.CFG.MID_X,
    big:     R => R.total >= R.stake * EV.CFG.MID_X && R.total < R.stake * EV.CFG.BIG_X,
    jackpot: R => R.total >= R.stake * EV.CFG.BIG_X,
    retry:   R => { let n = 0; for (let i = 1; i < R.fights.length; i++) if (!R.fights[i - 1].win && R.fights[i - 1].idx === R.fights[i].idx) n++; return n >= Math.min(2, R.hearts - 1) && n >= 1; },
    end:     R => R.reachedEnd
  };
  const core = R => JSON.stringify({ route: R.route, stake: R.stake, total: R.total, totalX: R.totalX, heartsLeft: R.heartsLeft, reachedEnd: R.reachedEnd, prizes: R.prizes, fights: R.fights, events: R.events });
  const rows = [], skipped = [];
  let detailChecked = 0;
  for (const [ri, tid] of IDS.entries()) {
    for (const kind of D.dev.kinds) {
      if (D.game.getState().wallet < 6000) D.game.addMoney(20000);
      await untilIdle();
      ui.setRoute(tid); ui.setStake(500);
      let feas;
      if (tid === 'mid') { $('devTog').click(); $('devK-' + kind).click(); check(!$('director').classList.contains('open'), '按了導演台鈕面板沒收起'); feas = true; }
      else feas = D.dev.force(kind);
      const info = D.dev.armedInfo();
      check(info && info.kind === kind, tid + '/' + kind + ' 預約後 armedInfo ' + JSON.stringify(info));
      const nH = D.dev.history.length, n0 = ends.length, w0 = D.game.getState().wallet, map0 = D.game.getState().map;
      const lab = tid + '/' + kind;
      // 這條路根本不可能的（FEAS 擋下），只記一筆跳過，下面專門挑一個實際打一局驗「找不到」的處理
      if (feas === false) { skipped.push(lab); D.dev.clear(); continue; }
      await ui.play(tid, 500, { fast: true });
      await sleep(100); await untilIdle();
      const e = ends[ends.length - 1], R = e.d.result, pick = D.dev.last;
      check(ends.length === n0 + 1 && D.dev.history.length === nH + 1 && pick && pick.orderId === e.d.orderId && pick.kind === kind, lab + ' 叫出來的紀錄對不上 ' + JSON.stringify(pick));
      check(D.dev.armedInfo() === null, lab + ' 預約沒消耗（應一次性）');
      check(D.game.getState().wallet === w0 - 500 + R.total && $('wal').textContent === fmt(D.game.getState().wallet), lab + ' 餘額對帳失敗');
      if (!pick || !pick.seed) { rows.push({ route: tid, kind, found: false, mapSeed: map0.seed }); continue; }
      check(pick.route === tid && pick.stake === 500 && pick.mapSeed === map0.seed && R.mapSeed === map0.seed, lab + ' pick 內容不對 ' + JSON.stringify(pick));
      check(KIND_OK[kind](R), lab + ' 結果不符種類：total ' + R.total + ' prizes ' + R.prizes.length + ' fights ' + R.fights.length + ' end ' + R.reachedEnd);
      // 重算：同地圖、同路線、同注額、同種子，經核心 simulate（不經導演台任何程式）
      const again = DemoCore.simulate(EV.genMapSeed(pick.mapSeed), ri, 500, EV.mulberry32(pick.seed));
      const eq = core(again) === core(R);
      check(eq, lab + ' 重算結果與叫出來的那局不同');
      check(core(D.dev.replay(pick)) === core(R), lab + ' D.dev.replay 與那局不同');
      check(again.total === e.d.pay && e.d.pay === e.d.payout, lab + ' 派彩與重算不同');
      rows.push({ route: tid, kind, found: true, seed: pick.seed, x: +(R.total / 500).toFixed(2), rolls: R.fights.length, prizes: R.prizes.length, eq });
      // 挑幾筆驗詳細頁（有重打、有多顆寶物的最有看頭）
      if (detailChecked < 4 && (kind === 'retry' || kind === 'end' || kind === 'big')) { await checkDetail(e, lab); detailChecked++; }
    }
  }
  // 預期一定找得到的（這些組合在每張圖都有解）
  const mustFind = [];
  IDS.forEach(id => ['small', 'back', 'end'].forEach(k => { if (id + '/' + k !== 'risk/back') mustFind.push(id + '/' + k); }));   // 2026-11-24：拚路線有些圖只有拿到大寶藏才回本（1～5 倍不存在），不列入   // 穩路線不一定有「什麼都沒拿到」（第一個節點是寶物的圖不可能），不列入
  mustFind.push('mid/none', 'risk/none', 'safe/retry', 'mid/retry', 'mid/big', 'risk/jackpot');
  mustFind.forEach(k => { const r = rows.find(x => x.route + '/' + x.kind === k); check(r && r.found, '預期找得到卻沒有：' + k + ' ' + JSON.stringify(r)); });
  ['safe/big', 'safe/jackpot', 'mid/jackpot', 'risk/retry'].forEach(k => check(skipped.indexOf(k) >= 0 || rows.some(x => x.route + '/' + x.kind === k), '預期被擋或找到：' + k));
  out.director = { rounds: rows.filter(r => r.found).length, notFound: rows.filter(r => !r.found).map(r => r.route + '/' + r.kind), skipped, rows };

  // 4b. 抽不到的（拚路線叫重打）：照常打一局、提示一次、沒被記成「叫出來的」
  {
    ui.setRoute('risk'); ui.setStake(100);
    const feas = D.dev.force('retry');
    check(feas === false, 'risk/retry 應判定抽不到');
    const nH = D.dev.history.length, n0 = ends.length;
    await ui.play('risk', 100, { fast: true }); await sleep(100); await untilIdle();
    check(ends.length === n0 + 1, '抽不到時應照常打完一局');
    const last = D.dev.history[D.dev.history.length - 1];
    check(D.dev.history.length === nH + 1 && last.seed === 0, '抽不到的預約應記 seed 0：' + JSON.stringify(last));
    check(D.dev.armedInfo() === null, '抽不到時預約也要消耗');
  }
  // 4c. 沒預約的局不被記成導演台叫的；定骰、換圖、連續模式
  {
    const nH = D.dev.history.length;
    ui.setRoute('mid'); ui.setStake(100);
    await ui.play('mid', 100, { fast: true }); await untilIdle();
    check(D.dev.history.length === nH, '沒預約的局被記成導演台叫的');
    // 定骰：下一局骰子固定用種子 4242，結果等於同地圖同種子重算
    const map = D.game.getState().map;
    D.dev.useSeed(4242);
    await ui.play('mid', 100, { fast: true }); await sleep(100); await untilIdle();
    const R = ends[ends.length - 1].d.result, again = DemoCore.simulate(map, 1, 100, EV.mulberry32(4242));
    check(core(R) === core(again), '定骰：結果與同種子重算不同');
    // 換圖：定圖 777，畫面與核心都換
    check(D.dev.setMap(777) === true && D.game.getState().mapSeed === 777 && ui.shownMap().seed === 777, '定圖 777 失敗');
    const m0 = D.game.getState().mapSeed;
    check(D.dev.randomMap() === true && D.game.getState().mapSeed !== m0 && ui.shownMap().seed === D.game.getState().mapSeed, '換一張圖失敗');
    // 演出中不能換圖
    const pp = ui.play('mid', 100, { fast: true });
    await sleep(100);
    check(D.dev.setMap(5) === false, '演出中不應能換圖');
    await pp; await untilIdle();
    out.devExtra = { seedReplay: true, map: 'ok' };
  }
  // 4d. 面板：開關、位置不超出畫面、加錢、重置錢包（清紀錄）
  {
    $('devTog').click();
    const pr = $('devPanel').getBoundingClientRect(), app = $('app').getBoundingClientRect();
    check($('director').classList.contains('open') && pr.left >= app.left - 0.5 && pr.right <= app.right + 0.5 && pr.bottom <= app.bottom, '導演台面板超出畫面 ' + JSON.stringify([pr.left, pr.right, pr.bottom]));
    $('devTog').click();
    const wA = D.game.getState().wallet;
    $('devAdd').click(); await sleep(50);
    check(D.game.getState().wallet === wA + 10000, '＋10,000 沒加到');
    check(LogUI.list().length > 0, '重置前紀錄應有東西');
    $('devReset').click(); await sleep(120);
    check(D.game.getState().wallet === EV.CFG.WALLET && $('wal').textContent === fmt(EV.CFG.WALLET), '重置後餘額 ' + D.game.getState().wallet);
    check(LogUI.list().length === 0 && (coreSaved().records || []).length === 0, '重置後紀錄／核心注單沒清');
    out.panel = { rect: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.right), Math.round(pr.bottom)] };
  }

  // ---------- 5. 紀錄頁與核心注單逐筆一致、落地筆數 ----------
  {
    ui.setRoute('mid'); ui.setStake(100);
    for (let i = 0; i < 6; i++) { await ui.play(IDS[i % 3], 100, { fast: true }); await sleep(40); }
    await untilIdle(); await sleep(100);
    const L = LogUI.list(), byId = {};
    (coreSaved().records || []).forEach(r => byId[r.orderId] = r);
    const bad = [];
    L.forEach(r => {
      const c = byId[r.id];
      if (!c) { bad.push(r.id + ' 核心找不到'); return; }
      if (r.stake !== c.stake || r.pay !== c.payout || r.ts !== c.ts) bad.push(r.id + ' 金額／時間');
      if (r.rows.length !== 6 + c.nPrizes + c.nRolls) bad.push(r.id + ' 列數 ' + r.rows.length + ' vs ' + (6 + c.nPrizes + c.nRolls));
      if (r.rows[0].k !== 'log.row.r.' + c.route) bad.push(r.id + ' 路線列');
    });
    check(L.length === 6 && bad.length === 0, '紀錄與核心注單不一致：' + bad.slice(0, 4).join('；') + '／筆數 ' + L.length);
    const stored = JSON.parse(localStorage.getItem('trails.log') || '[]');
    check(stored.length === L.length, 'trails.log 筆數 ' + stored.length);
    out.log = { listLen: L.length, mismatches: bad.length, storedLen: stored.length };
  }

  // ---------- 6. 自動下注進行中重整：中止並提示、那一局補記進紀錄 ----------
  {
    D.dev.force('small', { sticky: true });
    ui.setRoute('mid'); ui.setStake(100);
    Autobet.start({ choice: 'mid', stake: 100, rounds: 10, tp: 0, sl: 0 });
    await waitFor(() => Autobet.state().n >= 2 && ui.busy(), 60000);
    await sleep(500);
    const pend = coreSaved().pending;
    check(pend && pend.orderId, '重整前存檔沒有進行中那一單');
    check(JSON.parse(localStorage.getItem('trails.auto')), '重整前沒有自動下注進行中旗標');
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'position:absolute;left:-9999px;top:0;width:375px;height:812px';
    ifr.src = 'index.html?dev=1';
    document.body.appendChild(ifr);
    await new Promise(r => ifr.addEventListener('load', r));
    await waitFor(() => ifr.contentWindow.__demoReady, 8000);
    await sleep(900);
    const iw = ifr.contentWindow;
    const re = { ready: !!iw.__demoReady, autoRunning: iw.Autobet.isRunning(), toast: iw.document.getElementById('toast') ? iw.document.getElementById('toast').textContent : '',
      phase: iw.DEMO.game.getState().phase, hasPending: !!(pend && iw.LogUI.has(pend.orderId)) };
    check(re.ready && !re.autoRunning, '重整後自動下注應中止');
    check(/^重整已中止自動下注（\d+\/10 局，累計 /.test(re.toast) && re.toast.indexOf('NaN') < 0, '重整後沒有中止提示「' + re.toast + '」');
    check(re.phase === 'BET', '重整後核心應直接結算回待命');
    check(re.hasPending, '重整接回的那一局沒補記進紀錄');
    const iLog = iw.LogUI.list().find(r => pend && r.id === pend.orderId);
    check(iLog && iLog.rows.length >= 6 && iLog.stake === 100 && iLog.rows[0].k === 'log.row.r.mid', '接回補記的紀錄內容不對 ' + JSON.stringify(iLog && iLog.rows.slice(0, 2)));
    ifr.remove();
    Autobet.stop();
    await waitFor(() => !Autobet.isRunning(), 60000); await untilIdle();
    D.dev.clear();
    out.reload = re;
  }
} else {
  // 預設網址：重置錢包鈕（紀錄頁內二段確認）有效
  LogUI.open(); await sleep(60);
  document.querySelector('.lgm .lgreset').click(); await sleep(40);
  document.querySelector('.lgm .lgreset').click(); await sleep(1200);      // 餘額數字有滾動動畫
  check(walletNow() === EV.CFG.WALLET && LogUI.list().length === 0, '預設網址：紀錄頁重置鈕沒作用 ' + walletNow() + '／' + LogUI.list().length);
  LogUI.close();
}

clearInterval(ovTimer); clearInterval(barTimer);
const badBar = barTexts.filter(s => /NaN|undefined|null/.test(s));
check(badBar.length === 0, '浮條出現 NaN／undefined：' + badBar.slice(0, 2).join('｜'));
out.rounds = ends.length;
out.fails = fails;
out.ok = fails.length === 0;
return out;
