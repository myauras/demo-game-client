/* =========================================================================
 * 爆金連鎖——核心（js/core.js）Node 無頭單元測試　v2.3（能量條、金幣雨與連鎖獎池）
 * 執行：node game/test/core-test.js    （零依賴；values.js 與 core.js 以 eval 載入，同 mc-test.js 的作法）
 * 對應任務卡 C01 驗收清單（含 v2-1）：
 *   A 連丟 10,000 注逐注對帳＋每 RAIN_EVERY 注恰一場雨＋影子盤面　B 餘額不足　C 下注後 ack 前重整（含金幣雨那一注）
 *   D 換面額盤面與能量條互不影響　E 重置（三條能量條回起始值）　F 同 rng 序列重跑相同　G rng／能量條注入
 *   H 首次進場旗標　I 結果形狀　J 壞檔、舊版存檔與契約　K 凍結檔 md5
 *   P 連鎖獎池（逐注對帳、拿獎池那一注 ack 前重整不重複、重置錢包不動獎池、setPot、存檔 v5）
 * 判定：全 PASS＝exit 0；有 FAIL＝exit 1。
 * 註：本檔不得含頂層 'use strict'（eval 要讓 var EV／DemoCore 落在本模組作用域）。
 * ========================================================================= */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8'));

let nPass = 0, nFail = 0;
function check(tag, name, cond, detail){
  cond ? nPass++ : nFail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${!cond && detail ? '  ' + detail : ''}`);
}
const memStore = (init) => { const m = Object.assign({}, init || {}); return {
  getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };
const J = (x) => JSON.stringify(x);
const ND = EV.CFG.DENOMS.length;
const RE = EV.RAIN_EVERY, MS = DemoCore.METER_START;
const SAVE_V = 5;                         // 存檔版本（core.js 的 v:）；v5＝加了獎池（v4 沒有獎池）；規則或欄位變了就加一，舊存檔整份忽略
const PC = EV.POT_CHAIN;
const ADDS = EV.PAY.map(p => p.pot);                       // 各面額每注存進獎池的實付（整數）
const allPots = (g) => Array.from({ length: ND }, (_, d) => g.getPot(d));
/* 手工存檔：以起始盤面為底，可覆寫盤面／獎池／能量條（寫成 v:SAVE_V 的完整存檔，丟給 createGame 的 storage 讀） */
function craftSave(o){ o = o || {}; return J({ v: SAVE_V, wallet: o.wallet != null ? o.wallet : 1e7, seq: 0, denom: o.denom || 0, fresh: [false, false, false],
  boards: o.boards || startBoards(), meters: o.meters || [MS, MS, MS], pots: o.pots || [0, 0, 0], records: [], pending: null }); }
const fullBoard = () => { const b = EV.emptyBoard(); for(let j = 0; j < EV.N; j++) b.h[j] = EV.CFG.CAP - 1; return b; };   // 每格 3 枚：丟一枚＝巨大連鎖
const allBelowCap = (b) => b.h.every(x => x >= 0 && x < EV.CFG.CAP);
const sameBoard = (a, b) => J(a) === J(b);
const startBoards = () => Array.from({ length: ND }, (_, d) => EV.startBoard(d));
const allMeters = (g) => Array.from({ length: ND }, (_, d) => g.getMeter(d));
function mkGame(extra){ let t = 1700000000000; return DemoCore.createGame(Object.assign({ storage: false, now: () => t++ }, extra || {})); }
function evCollector(g){ const log = []; g.on((type, data) => log.push({ type, data })); return log; }
function lastResult(g){ const o = { r: null }; g.on((t, d) => { if(t === 'result') o.r = d.result; }); return o; }

/* ---------- 前置：起始值常數與 values.js 對得上 ---------- */
check('S', `METER_START＝${MS}（Demo 專用）、是 0～${RE - 1} 的整數（小於能量條長度 ${RE}）、第 ${RE - MS} 注下第一場雨（第 30 注）`, Number.isInteger(MS) && MS >= 0 && MS < RE && RE - MS === 30);
check('S', `存檔版本 DemoCore.SAVE_V＝${SAVE_V}；獎池每注存的實付是整數（${ADDS.join('／')}）、門檻 POT_CHAIN＝${PC}`, DemoCore.SAVE_V === SAVE_V && ADDS.every(Number.isInteger) && Number.isInteger(PC) && PC >= 1);

/* ---------- A 連丟 10,000 注（三個面額輪流、隨機落點），逐注對帳 ---------- */
{
  const BIG = 100000000, seed = 4242;
  const g = mkGame({ storage: memStore(), wallet: BIG, rng: EV.rng(seed) });
  const placeRng = EV.rng(99);                                  // 玩家挑格（與抽獎 rng 分開）
  const shadowRng = EV.rng(seed), shadow = startBoards();       // 影子：直接用 values.js 算，同一串 rng
  const shMeter = [MS, MS, MS];                                 // 影子能量條（用 EV.meterAfter）
  const shPot = [0, 0, 0], potIn = [0, 0, 0], potOut = [0, 0, 0], potBy = { chain: 0, rain: 0, both: 0 };   // 影子獎池（用測試自己累加的整數）、存入／拿走合計
  let wallet = BIG, bad = 0, badMsg = '', stakeSum = 0, backSum = 0, nRain = 0, nBig = 0;
  const lastAfter = [null, null, null], cnt = [0, 0, 0], rainAt = [[], [], []];
  const res = lastResult(g);
  for(let n = 0; n < 10000; n++){
    const di = n % ND; g.setDenom(di);
    const stake = EV.CFG.DENOMS[di], cell = Math.floor(placeRng() * EV.N);
    const before = g.getBoard(di), meterB = g.getMeter(di);
    res.r = null;
    const ok = g.bet(cell);
    const r = res.r;
    const afterBet = g.getWallet();
    const ph = g.getState().phase;
    const meterDuring = g.getMeter(di);
    g.ack();
    const afterAck = g.getWallet();
    const m = EV.meterAfter(shMeter[di]); shMeter[di] = m.meter;
    const sh = EV.play(shadow[di], cell, shadowRng, { rain: m.rain });   // 影子結果（同 rng、同能量條）
    const shBefore = shPot[di]; shPot[di] += ADDS[di]; potIn[di] += ADDS[di];                  // 影子獎池：先入池再判斷（測試自己算，不呼叫 EV.potAfter）
    const sChain = sh.main.topples >= PC, sRain = !!sh.rain, shWin = (sChain || sRain) ? shPot[di] : 0;
    if(shWin > 0){ shPot[di] = 0; potOut[di] += shWin; if(sChain && sRain) potBy.both++; else if(sChain) potBy.chain++; else potBy.rain++; }
    const shPay = EV.cash(sh, di) + shWin;
    cnt[di]++; if(m.rain) rainAt[di].push(cnt[di]);
    let problem = '';
    if(!ok || !r) problem = '下注失敗';
    else if(afterBet !== wallet - stake) problem = '扣款不對';
    else if(ph !== 'ANIM') problem = '下注後不是 ANIM';
    else if(afterAck !== wallet - stake + r.payout) problem = '入帳不對';
    else if(r.payout !== shPay) problem = '拿回（含獎池）與影子不同';
    else if(r.potBefore !== shBefore || r.potAdd !== ADDS[di] || r.potWin !== shWin || r.potAfter !== shPot[di] || r.potBy !== (sChain ? 'chain' : sRain ? 'rain' : null)) problem = '獎池欄位與影子不同';
    else if(g.getPot(di) !== shPot[di] || g.getState().pot !== shPot[di] || g.getState().pots[di] !== shPot[di]) problem = '獎池查詢與影子不同';
    else if(r.potWin > 0 && (r.potAfter !== 0 || r.potWin !== r.potBefore + r.potAdd)) problem = '拿獎池後沒歸零或金額不是（之前＋這一注存的）';
    else if(r.tier !== EV.tier(sh, di, shWin)) problem = '分級沒含獎池';
    else if(Math.abs(r.mult - r.payout / stake) > 1e-9) problem = 'mult≠payout÷stake';
    else if(!sameBoard(r.boardAfter, shadow[di]) || !sameBoard(g.getBoard(di), shadow[di])) problem = '盤面與影子不同';
    else if(!sameBoard(r.boardBefore, before)) problem = 'boardBefore 不對';
    else if(lastAfter[di] && !sameBoard(lastAfter[di], before)) problem = '同面額上一注後的盤面與這注前不一致';
    else if(!allBelowCap(g.getBoard(di))) problem = '盤面有格 ≥4';
    else if(EV.total(r.boardAfter) < EV.MIN_TOTAL) problem = `盤面總數 ${EV.total(r.boardAfter)} 低於 ${EV.MIN_TOTAL}`;
    else if(EV.total(r.boardAfter) !== EV.total(r.boardBefore) + (r.enter.coin + r.enter.diamond + r.enter.crown) - r.exitCount) problem = '枚數不守恆';
    else if(r.items.reduce((s, x) => s + x.amount, 0) + r.potWin !== r.payout) problem = '噴出清單金額加總＋獎池≠拿回';
    else if(r.hasRain !== m.rain || (r.rain !== null) !== m.rain) problem = '金幣雨與影子（EV.meterAfter）不同';
    else if(r.meterBefore !== meterB || r.meterAfter !== m.meter || meterDuring !== m.meter || g.getMeter(di) !== m.meter) problem = '能量條與影子不同';
    else if(J(r.main) !== J(sh.main) || J(r.rain) !== J(sh.rain)) problem = '分波結果與影子不同';
    if(problem && !bad){ bad++; badMsg = `第 ${n + 1} 注：${problem}`; } else if(problem) bad++;
    wallet = wallet - stake + (r ? r.payout : 0);
    lastAfter[di] = g.getBoard(di);
    stakeSum += stake; backSum += r ? r.payout : 0;
    if(r && r.hasRain) nRain++;
    if(r && (r.tier === 'big' || r.tier === 'huge')) nBig++;
  }
  check('A', '連丟 10,000 注（三面額輪流、隨機落點）逐注：扣款／入帳／盤面／能量條／獎池（入池、拿走、歸零、原因）／清單加總＋獎池＝拿回／枚數守恆／總數不低於 40／與直接呼叫 EV.play＋測試自己累加的獎池影子（同 rng、同能量條）完全一致', bad === 0, badMsg);
  check('A', `獎池逐面額守恆（實付整數）：Σ存入＝Σ拿走＋期末餘額；三面額期末餘額＝影子；拿獎池的三種情形都測到（自己連鎖 ${potBy.chain}／只有下雨 ${potBy.rain}／同注兩者 ${potBy.both}）`,
    [0, 1, 2].every(d => potIn[d] === cnt[d] * ADDS[d] && potIn[d] === potOut[d] + g.getPot(d) && g.getPot(d) === shPot[d]) && potBy.chain > 0 && potBy.rain > 0);
  check('A', `錢包＝起始 − 投入 ＋ 拿回（投入 ${stakeSum}、拿回 ${backSum}）`, g.getWallet() === BIG - stakeSum + backSum);
  check('A', '10,000 注後三張盤面每格都 <4、總數 ≥40', Array.from({ length: ND }, (_, d) => allBelowCap(g.getBoard(d)) && EV.total(g.getBoard(d)) >= EV.MIN_TOTAL).every(Boolean));
  const gapsOk = rainAt.every(a => a.length > 30 && a.every((x, i) => i === 0 ? x === RE - MS : x - a[i - 1] === RE));
  check('A', `每張盤面各自每 ${RE} 注恰下一次雨（第一場在第 ${RE - MS} 注；三面額各 ${rainAt.map(a => a.length).join('／')} 場）`, gapsOk);
  check('A', `三條能量條終值與注數一致：(${MS}＋注數) mod ${RE}`, allMeters(g).every((m, d) => m === (MS + cnt[d]) % RE));
  check('A', `有金幣雨（${nRain}）與大連爆以上（${nBig}）出現，測到了這些路徑`, nRain === rainAt.reduce((s, a) => s + a.length, 0) && nRain > 0 && nBig > 0);
  check('A', '注單流水封頂 200 筆、流水號累計 10,000', g.getRecords().length === 200 && g.getState().seq === 10000);
  const rc = g.getRecords();
  check('A', '注單號唯一、紀錄時間順序', new Set(rc.map(r => r.orderId)).size === rc.length && rc.every((r, i) => i === 0 || r.ts > rc[i - 1].ts));
}

/* ---------- B 餘額不足 ---------- */
{
  let consumed = 0; const rng = () => { consumed++; return 0.5; };
  const g = mkGame({ wallet: 50, rng });
  const log = evCollector(g), b0 = g.getBoard(), st0 = g.getState(), m0 = allMeters(g);
  const r = g.bet(12);
  check('B', '餘額 50 < 面額 100：bet 回 false、錯誤碼 funds', r === false && g.getLastError().code === 'funds' && log.some(e => e.type === 'error' && e.data.code === 'funds'));
  check('B', '錢包不變、盤面不變、能量條不變、仍可下注階段、沒消耗 rng、沒寫注單、盤面仍算「沒丟過」',
    g.getWallet() === 50 && sameBoard(g.getBoard(), b0) && J(allMeters(g)) === J(m0) && g.getState().phase === 'BET' && consumed === 0 && g.getRecords().length === 0 && g.isFresh() === st0.fresh && g.canBet() === false);
  const g2 = mkGame({ wallet: 100, rng: EV.rng(1) });
  check('B', '餘額剛好等於面額可以下注（扣到 0）', g2.bet(12) === true && g2.getWallet() === 0 && (g2.ack(), g2.getWallet() === g2.getRecords()[0].payout));
  const g3 = mkGame({ wallet: 600, rng: EV.rng(1) });
  g3.setDenom(2); const b3 = g3.getBoard();
  check('B', '餘額 600 選面額 1,000 不能下', g3.bet(0) === false && g3.getWallet() === 600 && sameBoard(g3.getBoard(), b3) && g3.getMeter() === MS);
  g3.setDenom(1);
  check('B', '同一個錢包改選 500 就可以', g3.bet(0) === true);
}

/* ---------- C 下注後、ack 前重整 ---------- */
{
  const store = memStore(), key = DEMO_KEY + '.core';
  const g1 = mkGame({ storage: store, rng: EV.rng(7) });
  g1.armNext({ kind: 'diamond' });
  g1.setDenom(1);
  const w0 = g1.getWallet(), stake = 500;
  const res = lastResult(g1);
  g1.bet(6);                                                    // 6＝(1,1)；鑽石
  check('C', '下注後 ack 前：錢包已扣、階段 ANIM、存檔裡有進行中一單', g1.getWallet() === w0 - stake && g1.getState().phase === 'ANIM' && !!JSON.parse(store.getItem(key)).pending);
  const g2 = mkGame({ storage: store, rng: () => { throw new Error('接回時不得抽獎'); } });
  const rec = g2.getRestored();
  check('C', '重新載入後：錢包已入帳（起始 − 注額 ＋ 拿回）、階段回到 BET', g2.getWallet() === w0 - stake + res.r.payout && g2.getState().phase === 'BET');
  check('C', '重新載入後：盤面＝算完的盤面（逐格同 boardAfter）、能量條＝算完的值、面額保持', sameBoard(g2.getBoard(1), res.r.boardAfter) && g2.getMeter(1) === MS + 1 && g2.getDenomIndex() === 1);
  check('C', '重新載入後：注單多 1 筆且就是那一注（內容同結果）',
    g2.getRecords().length === 1 && !!rec && g2.getRecords()[0].orderId === res.r.orderId && g2.getRecords()[0].payout === res.r.payout && g2.getPending() === null);
  const g3 = mkGame({ storage: store });
  check('C', '再重整一次：不重複入帳、注單不重複', g3.getWallet() === g2.getWallet() && g3.getRecords().length === 1 && g3.getRestored() === null);
  check('C', '重整後 ack 不會誤入帳（非演出結算點）', g3.ack() === false && g3.getWallet() === g2.getWallet());
  const g4 = mkGame({ storage: store, rng: EV.rng(5) });
  check('C', '接回後可以繼續下注、注單號接續（流水號不撞）', g4.bet(0) === true && (g4.ack(), g4.getRecords().length === 2 && g4.getRecords()[0].orderId !== g4.getRecords()[1].orderId));
  const gA = mkGame({ storage: memStore(), rng: EV.rng(3) }); gA.bet(0); gA.ack();
  const stA = gA.getState();
  const store2 = memStore(); const gB = mkGame({ storage: store2, rng: EV.rng(3) }); gB.bet(0); gB.ack();
  const gC = mkGame({ storage: store2 });
  check('C', 'ack 之後重整：狀態（含能量條）與重整前完全相同', gC.getWallet() === gB.getWallet() && J(gC.getRecords()) === J(gB.getRecords()) && sameBoard(gC.getBoard(), gB.getBoard()) && stA.wallet === gC.getWallet() && J(allMeters(gC)) === J(allMeters(gB)));
  const s5 = memStore(); const gD = mkGame({ storage: s5 }); const gE = mkGame({ storage: s5 });
  check('C', '沒下注就重整：三張盤面仍是起始盤面、三條能量條仍是起始值', startBoards().every((b, d) => sameBoard(b, gE.getBoard(d))) && sameBoard(gD.getBoard(), gE.getBoard()) && allMeters(gE).every(m => m === MS));

  /* 金幣雨那一注：ack 前重整 */
  const sr = memStore(); const gr = mkGame({ storage: sr, rng: EV.rng(8) });
  gr.setDenom(2); gr.setMeter(RE - 1);                          // 下一注必下雨
  const wr = gr.getWallet(), rr = lastResult(gr);
  gr.bet(12);
  const R = rr.r;
  check('C', '金幣雨那一注（面額 1,000）：hasRain、meterBefore＝RAIN_EVERY−1、meterAfter＝0、下注後能量條立刻是 0', R.hasRain === true && R.rain !== null && R.meterBefore === RE - 1 && R.meterAfter === 0 && gr.getMeter() === 0 && gr.getState().phase === 'ANIM');
  check('C', '金幣雨那一注：存檔裡的進行中一單帶完整 rain、存檔的能量條已歸零', (() => { const d = JSON.parse(sr.getItem(key)); return d.v === SAVE_V && d.pending.result.rain.fall.length === 25 && d.meters[2] === 0; })());
  const gr2 = mkGame({ storage: sr, rng: () => { throw new Error('接回時不得抽獎'); } });
  check('C', '金幣雨 ack 前重整：錢包已入帳一次（起始 − 注額 ＋ 拿回）、不重複入帳', gr2.getWallet() === wr - 1000 + R.payout && gr2.getRecords().length === 1 && gr2.getRecords()[0].hasRain === true && gr2.getState().phase === 'BET');
  check('C', '金幣雨 ack 前重整：盤面是下完雨的（＝boardAfter）、能量條已歸零、其他面額能量條不動', sameBoard(gr2.getBoard(2), R.boardAfter) && gr2.getMeter(2) === 0 && gr2.getMeter(0) === MS && gr2.getMeter(1) === MS);
  const gr3 = mkGame({ storage: sr });
  check('C', '金幣雨再重整一次：狀態不變、不重複入帳', gr3.getWallet() === gr2.getWallet() && gr3.getRecords().length === 1 && gr3.getMeter(2) === 0 && sameBoard(gr3.getBoard(2), R.boardAfter));
  check('C', '金幣雨那一注一定拿獎池（potBy＝rain 或 chain）：重整前存檔裡獎池已歸零、入帳含獎池', R.potWin === ADDS[2] && R.potAfter === 0 && R.potBy !== null && JSON.parse(sr.getItem(key)).pots[2] === 0 && R.payout === R.items.reduce((s, x) => s + x.amount, 0) + R.potWin);

  /* 拿獎池那一注（自己連鎖到門檻；用手工存檔：面額 500 那張是每格 3 枚的盤面、獎池先放 6 注的量）：ack 前重整 */
  const sp = memStore({ [key]: craftSave({ boards: [EV.startBoard(0), fullBoard(), EV.startBoard(2)], pots: [0, 6 * ADDS[1], 0], denom: 1 }) });
  const gp = mkGame({ storage: sp, rng: EV.rng(9) }); const rp = lastResult(gp);
  const wp = gp.getWallet();
  gp.armNext({ kind: 'coin' }); gp.bet(12);
  const PR = rp.r;
  check('C', `拿獎池那一注（自己連鎖，面額 500、獎池 6 注的量）：potBy＝chain、potWin＝（6＋1）注的量、potAfter＝0、payout 含獎池、下注後 getPot 已歸零`, PR.potBy === 'chain' && PR.main.topples >= PC && PR.potBefore === 6 * ADDS[1] && PR.potWin === 7 * ADDS[1] && PR.potAfter === 0 && gp.getPot() === 0 && PR.payout === PR.items.reduce((s, x) => s + x.amount, 0) + PR.potWin && !PR.hasRain);
  check('C', '拿獎池那一注：存檔裡的進行中一單帶 potWin、存檔的獎池已歸零', (() => { const d = JSON.parse(sp.getItem(key)); return d.v === SAVE_V && d.pending.result.potWin === PR.potWin && d.pots[1] === 0; })());
  const gp2 = mkGame({ storage: sp, rng: () => { throw new Error('接回時不得抽獎'); } });
  check('C', '拿獎池那一注 ack 前重整：錢包已入帳一次（起始 − 注額 ＋ 含獎池的拿回）、獎池已歸零、不重複入帳、注單帶 potWin', gp2.getWallet() === wp - 500 + PR.payout && gp2.getPot(1) === 0 && gp2.getRecords().length === 1 && gp2.getRecords()[0].potWin === PR.potWin && gp2.getRecords()[0].payout === PR.payout && gp2.getState().phase === 'BET' && gp2.getRestored() !== null);
  const gp3 = mkGame({ storage: sp });
  check('C', '拿獎池那一注再重整一次：錢包、獎池、注單都不變（不重複）', gp3.getWallet() === gp2.getWallet() && gp3.getPot(1) === 0 && gp3.getRecords().length === 1 && gp3.getRestored() === null && J(allPots(gp3)) === J([0, 0, 0]));
  /* 沒拿獎池的一注：ack 前重整，獎池是存進去之後的值 */
  const sq = memStore({ [key]: craftSave({ pots: [3 * ADDS[0], 0, 0] }) }); const gq = mkGame({ storage: sq, rng: EV.rng(10) }); const rq = lastResult(gq);
  const qc = Array.from({ length: EV.N }, (_, c) => c).find(c => EV.probe(EV.startBoard(0), c).topples === 0);   // 丟下去不會爆的格
  gq.armNext({ kind: 'coin' }); gq.bet(qc);
  const gq2 = mkGame({ storage: sq });
  check('C', '沒拿獎池的一注 ack 前重整：獎池＝入池後的值（之前＋這一注存的）、入帳不含獎池', rq.r.potWin === 0 && rq.r.potAfter === 3 * ADDS[0] + ADDS[0] && gq2.getPot(0) === 4 * ADDS[0] && gq2.getRecords()[0].potWin === 0);
}

/* ---------- D 換面額，盤面與能量條互不影響 ---------- */
{
  const g = mkGame({ storage: memStore(), rng: EV.rng(11), wallet: 1e9 });
  const cells = [3, 7, 12, 18, 24, 0, 11], snap = [];
  let ok = true, why = '', okM = true, whyM = '';
  g.setDenom(0); for(let i = 0; i < 7; i++){ g.bet(cells[i]); g.ack(); }
  snap[0] = g.getBoard(0);
  const startedOthers = [sameBoard(g.getBoard(1), EV.startBoard(1)), sameBoard(g.getBoard(2), EV.startBoard(2))];
  check('D', '只丟面額 100：另外兩張盤面仍是起始盤面', startedOthers.every(Boolean));
  check('D', `只丟面額 100：能量條 ${MS}＋7，另外兩條仍是起始值`, J(allMeters(g)) === J([MS + 7, MS, MS]));
  const m0 = g.getMeter(0);
  g.setDenom(1); for(let i = 0; i < 5; i++){ g.bet(cells[i]); g.ack(); if(!sameBoard(g.getBoard(0), snap[0])){ ok = false; why = '丟 500 動到 100 的盤面'; } if(g.getMeter(0) !== m0){ okM = false; whyM = '丟 500 動到 100 的能量條'; } }
  snap[1] = g.getBoard(1);
  const m1 = g.getMeter(1);
  g.setDenom(2); for(let i = 0; i < 6; i++){ g.bet(cells[(i + 2) % 7]); g.ack();
    if(!sameBoard(g.getBoard(0), snap[0]) || !sameBoard(g.getBoard(1), snap[1])){ ok = false; why = '丟 1,000 動到別張盤面'; }
    if(g.getMeter(0) !== m0 || g.getMeter(1) !== m1){ okM = false; whyM = '丟 1,000 動到別條能量條'; } }
  check('D', '輪流丟三個面額：每丟一注，另外兩張盤面逐格不變', ok, why);
  check('D', '輪流丟三個面額：每丟一注，另外兩條能量條不變', okM, whyM);
  g.setDenom(0);
  check('D', '換回面額 100：原本那張盤面逐格不變、getBoard() 預設就是它；能量條也回到它自己的值', sameBoard(g.getBoard(), snap[0]) && sameBoard(g.getBoard(0), snap[0]) && g.getMeter() === m0 && g.getState().meter === m0);
  check('D', '三張盤面互不相同（各丟各的）', J(snap[0]) !== J(snap[1]));
  check('D', '換面額只改目前面額，不動錢包、不動任何能量條', (() => { const w = g.getWallet(), ms = J(allMeters(g)); g.setDenom(1); g.setDenom(2); g.setDenom(0); return g.getWallet() === w && J(allMeters(g)) === ms; })());
  check('D', 'getState().meters 帶三條能量條的值（與 getMeter 一致）、rainEvery＝RAIN_EVERY', J(g.getState().meters) === J(allMeters(g)) && g.getState().rainEvery === RE);
  g.bet(1);
  check('D', '演出中不可換面額、不動盤面', g.setDenom(1) === false && g.getLastError().code === 'phase' && g.getDenomIndex() === 0);
  g.ack();
  check('D', '不合法面額索引被擋', g.setDenom(3) === false && g.setDenom(-1) === false && g.setDenom(0.5) === false && g.getDenomIndex() === 0);
  const store = memStore(); const gs = mkGame({ storage: store, rng: EV.rng(2), wallet: 1e6 });
  gs.setDenom(2); gs.bet(5); gs.ack(); gs.setDenom(1);
  const gr = mkGame({ storage: store });
  check('D', '重整後面額、三張盤面、三條能量條都保持', gr.getDenomIndex() === 1 && [0, 1, 2].every(d => sameBoard(gr.getBoard(d), gs.getBoard(d)) && gr.getMeter(d) === gs.getMeter(d)) && gr.getMeter(2) === MS + 1);
  check('D', 'getMeter／getBoard 給不合法面額＝-1／null', gs.getMeter(5) === -1 && gs.getBoard(5) === null);
}

/* ---------- E 重置 ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(21) });
  g.addMoney(1e6);                                              // 預設起始錢包 10,000，先加錢才玩得夠；重置要回 10,000
  const log = evCollector(g);
  for(let d = 0; d < ND; d++){ g.setDenom(d); for(let i = 0; i < 6; i++){ g.bet((i * 7 + d) % 25); g.ack(); } }
  g.setMeter(5, 1);
  g.setPot(2 * ADDS[1], 1);
  g.addMoney(12345);
  check('E', '重置前確實玩過（盤面不是起始盤面、能量條不是起始值、有獎池、有注單、錢包不是 10,000）', !sameBoard(g.getBoard(0), EV.startBoard(0)) && allMeters(g).every(m => m !== MS) && g.getPot(1) > 0 && g.getRecords().length === 18 && g.getWallet() !== 10000);
  g.bet(0);
  check('E', '演出中不可重置', g.clearSaved() === false && g.getLastError().code === 'phase');
  g.ack();
  const ok = g.clearSaved();
  check('E', '重置：錢包 10,000、注單清空、面額回預設、發出 reset 事件（帶三條能量條）', ok && g.getWallet() === 10000 && g.getRecords().length === 0 && g.getDenomIndex() === EV.CFG.DENOM_DEFAULT && log.some(e => e.type === 'reset' && J(e.data.meters) === J([MS, MS, MS]) && J(e.data.pots) === J([0, 0, 0])));
  check('E', '重置：三個獎池歸零（clearSaved 整份回到新玩家）、getState().pot／pots 也是 0', J(allPots(g)) === J([0, 0, 0]) && g.getState().pot === 0 && J(g.getState().pots) === J([0, 0, 0]));
  check('E', `重置：三條能量條都回起始值 ${MS}`, allMeters(g).every(m => m === MS) && J(g.getState().meters) === J([MS, MS, MS]));
  check('E', '重置：三張盤面逐格＝起始盤面（含發光格旗標）', startBoards().every((b, d) => sameBoard(b, g.getBoard(d)) && g.isFresh(d) && g.glowCell(d) === EV.bestCell(b)));
  const g2 = mkGame({ storage: store });
  check('E', '重置後重整仍是重置後的狀態（含能量條、獎池）', g2.getWallet() === 10000 && startBoards().every((b, d) => sameBoard(b, g2.getBoard(d))) && allMeters(g2).every(m => m === MS) && J(allPots(g2)) === J([0, 0, 0]));
  g.bet(3); g.ack();
  check('E', '重置後流水號從頭、可繼續玩、能量條從起始值走、獎池從 0 存起（這一注存的、或被拿走）', g.getState().seq === 1 && g.getRecords().length === 1 && g.getMeter() === MS + 1 && (g.getPot() === ADDS[0] || g.getRecords()[0].potWin === ADDS[0]));
}

/* ---------- E2 重置錢包（只補錢，盤面與能量條不動；2026-11-26 用戶裁決） ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(22) });
  for(let d = 0; d < ND; d++){ g.setDenom(d); for(let i = 0; i < 7; i++){ g.bet((i * 5 + d) % 25); g.ack(); } }
  g.setPot(4 * ADDS[0], 0); g.setPot(9 * ADDS[1], 1); g.setPot(2 * ADDS[2], 2);                 // 三個獎池都放點錢（導演台）
  g.setDenom(1);
  const before = { boards: [0, 1, 2].map(d => J(g.getBoard(d))), meters: J(allMeters(g)), fresh: [0, 1, 2].map(d => g.isFresh(d)), denom: g.getDenomIndex(), seq: g.getState().seq, pots: J(allPots(g)) };
  g.bet(4);
  check('E2', '演出中不可重置錢包', g.resetWallet() === false && g.getLastError().code === 'phase');
  g.ack();
  const b2 = { boards: [0, 1, 2].map(d => J(g.getBoard(d))), meters: J(allMeters(g)), fresh: [0, 1, 2].map(d => g.isFresh(d)), denom: g.getDenomIndex(), seq: g.getState().seq, pots: J(allPots(g)) };
  const ok = g.resetWallet();
  check('E2', '重置錢包：錢包回 10,000、注單清空', ok && g.getWallet() === 10000 && g.getRecords().length === 0);
  check('E2', '重置錢包：三個獎池不動（重置前確實有獎池、重置後逐個相同）', J(allPots(g)) === b2.pots && JSON.parse(b2.pots).some(x => x > 0));
  check('E2', '重置錢包：三張盤面逐格不變、三條能量條不變、「丟過沒」旗標不變、面額不變', J([0, 1, 2].map(d => J(g.getBoard(d)))) === J(b2.boards) && J(allMeters(g)) === b2.meters && J([0, 1, 2].map(d => g.isFresh(d))) === J(b2.fresh) && g.getDenomIndex() === b2.denom);
  check('E2', '重置錢包前確實玩過（盤面不是起始盤面）', before.boards.some((b, d) => b !== J(EV.startBoard(d))));
  const g2 = mkGame({ storage: store, rng: EV.rng(23) });
  check('E2', '重置錢包後重整：錢包 10,000、盤面、能量條與獎池仍是重置前的', g2.getWallet() === 10000 && J([0, 1, 2].map(d => J(g2.getBoard(d)))) === J(b2.boards) && J(allMeters(g2)) === b2.meters && J(allPots(g2)) === b2.pots);
  g.bet(6); g.ack();
  check('E2', '重置錢包後可繼續玩、能量條接著走', g.getRecords().length === 1 && g.getMeter() === JSON.parse(b2.meters)[b2.denom] + 1 || g.getMeter() === 0);
}

/* ---------- F 同一 rng 序列重跑相同 ---------- */
{
  function run(seed){
    const g = mkGame({ storage: false, rng: EV.rng(seed), wallet: 1e9 }); const pr = EV.rng(8), out = [];
    g.on((t, d) => { if(t === 'result') out.push(d.result); });
    for(let n = 0; n < 2000; n++){ g.setDenom(n % ND); g.bet(Math.floor(pr() * 25)); g.ack(); }
    return { out: J(out), wallet: g.getWallet(), boards: J([0, 1, 2].map(d => g.getBoard(d))), recs: J(g.getRecords()), meters: J(allMeters(g)), pots: J(allPots(g)), nRain: out.filter(r => r.hasRain).length, nPot: out.filter(r => r.potWin > 0).length };
  }
  const a = run(31337), b = run(31337), c = run(31338);
  check('F', '同 rng 序列（含 now 固定）重跑兩次：每注完整結果（含金幣雨）、錢包、盤面、能量條、注單逐字相同', a.out === b.out && a.wallet === b.wallet && a.boards === b.boards && a.recs === b.recs && a.meters === b.meters && a.pots === b.pots && a.nRain > 0 && a.nPot > a.nRain);
  check('F', '換一個 rng 種子結果不同（確認測試不是空轉）', a.out !== c.out);
  let calls = 0; const counting = () => { calls++; return 0.9; };
  const g = mkGame({ rng: counting, wallet: 1e6 });
  g.bet(0); g.ack();
  check('F', '核心自己不抽號：一注只消耗 1 次 rng（EV.play 抽這枚是什麼）', calls === 1);
  calls = 0; g.setMeter(RE - 1); g.bet(1); g.ack();
  check('F', '金幣雨那一注也只消耗 1 次 rng（雨不抽）', calls === 1);
}

/* ---------- G rng 與能量條注入（導演台） ---------- */
{
  const g = mkGame({ storage: false, rng: EV.rng(5), wallet: 1e6 });
  const res = lastResult(g);
  g.armNext({ kind: 'diamond' }); g.bet(0);
  check('G', 'armNext 指定下一枚鑽石', res.r.kind === 'diamond' && res.r.enter.diamond === 1);
  g.ack();
  g.armNext({ kind: 'crown' }); g.bet(1);
  check('G', 'armNext 指定皇冠', res.r.kind === 'crown' && res.r.enter.crown === 1);
  g.ack();
  g.armNext({ kind: 'coin', sky: 12 }); g.bet(2);
  check('G', 'armNext 多給的 sky 欄位（v1 遺留）被忽略：結果沒有 sky／hasSky／skyCell', res.r.kind === 'coin' && !('sky' in res.r) && !('hasSky' in res.r) && !('skyCell' in res.r));
  g.ack();
  let kinds = new Set(); for(let i = 0; i < 400; i++){ g.bet(i % 25); kinds.add(res.r.kind); g.ack(); }
  check('G', 'armNext 只管下一注，之後照原 rng（又出現普通幣）', kinds.has('coin'));
  g.armNext({ kind: 'diamond' }); g.setDenom(2); g.bet(0); const k1 = res.r.kind; g.ack();
  check('G', '指定的結果跟面額無關（鑽石在面額 1,000 一樣兌現 5 倍面額）', k1 === 'diamond' && res.r.stake === 1000);
  check('G', 'armNext 的 kind 不合法被擋（回 false、code plan），且不影響之後的下注', g.armNext({ kind: 'gold' }) === false && g.getLastError().code === 'plan' && g.bet(0) === true);
  g.ack();
  { const mk = () => { const x = mkGame({ rng: EV.rng(9), wallet: 1e6 }); const o = lastResult(x); return { x, o }; };
    const p = mk(), q = mk(); p.x.armNext({ kind: 'crown' }); p.x.armNext(null); p.x.bet(3); q.x.bet(3);
    check('G', 'armNext(null) 取消指定（結果與沒指定的同 rng 相同）', J(p.o.r) === J(q.o.r)); }
  const fixed = mkGame({ rng: EV.rng(1), wallet: 1e6 }); const seen = [];
  fixed.on((t, d) => { if(t === 'result') seen.push(d.result.kind); });
  fixed.setRng(() => EV.uForKind('crown')); fixed.bet(0); fixed.ack();
  check('G', 'setRng 換整串 rng 生效、getRng 取得目前的 rng', seen[0] === 'crown' && typeof fixed.getRng() === 'function');
  const blocked = mkGame({ rng: EV.rng(1), wallet: 50 }); blocked.armNext({ kind: 'crown' }); blocked.bet(0); blocked.setRng(EV.rng(1)); blocked.addMoney(500);
  const r2 = lastResult(blocked); blocked.bet(0);
  check('G', '失敗的下注不消耗 armNext（餘額補足後的下一注才套用）', r2.r && r2.r.kind === 'crown');

  /* setMeter */
  const gm = mkGame({ storage: memStore(), rng: EV.rng(6), wallet: 1e6 }); const rm = lastResult(gm); const log = evCollector(gm);
  check('G', 'setMeter(30)：目前面額的能量條變 30，發 meter 事件，其他兩條不動', gm.setMeter(30) === true && J(allMeters(gm)) === J([30, MS, MS]) && log.some(e => e.type === 'meter' && e.data.denomIndex === 0 && e.data.meter === 30 && J(e.data.meters) === J([30, MS, MS])));
  check('G', 'setMeter(v, di)：指定面額；超出範圍夾回 0～RAIN_EVERY−1、小數取整', gm.setMeter(RE + 56, 1) === true && gm.getMeter(1) === RE - 1 && gm.setMeter(-5, 2) === true && gm.getMeter(2) === 0 && gm.setMeter(10.9) === true && gm.getMeter(0) === 10);
  check('G', 'setMeter 不合法被擋：非數字 → meter、不合法面額 → denom', gm.setMeter('x') === false && gm.getLastError().code === 'meter' && gm.setMeter(NaN) === false && gm.setMeter(5, 9) === false && gm.getLastError().code === 'denom' && gm.getMeter(0) === 10);
  gm.setDenom(1);                                               // 面額 500 的能量條＝RAIN_EVERY−1
  gm.bet(12);
  check('G', 'setMeter(RAIN_EVERY−1) 後下一注必下金幣雨，hasRain／meterBefore＝RAIN_EVERY−1／meterAfter 0', rm.r.hasRain === true && rm.r.meterBefore === RE - 1 && rm.r.meterAfter === 0 && rm.r.rain.coins === 25 && gm.getMeter(1) === 0);
  check('G', '演出中 setMeter 被擋、能量條不動', gm.setMeter(RE - 3) === false && gm.getLastError().code === 'phase' && gm.getMeter(1) === 0);
  gm.ack();
  gm.setMeter(RE - 2); gm.bet(3); const a1 = rm.r.hasRain; gm.ack(); gm.bet(4); const a2 = rm.r.hasRain; gm.ack();
  check('G', 'setMeter(RAIN_EVERY−2)：下一注不下雨（meterAfter＝RAIN_EVERY−1）、再下一注下雨', a1 === false && a2 === true);
  /* setPot */
  { const gp = mkGame({ storage: memStore(), rng: EV.rng(6), wallet: 1e6 }); const lg = evCollector(gp), rp = lastResult(gp);
    check('G', 'setPot(v)：目前面額的獎池變 v（實付金額），發 pot 事件（帶 denomIndex／pot／pots），其他兩個不動', gp.setPot(3 * ADDS[0]) === true && J(allPots(gp)) === J([3 * ADDS[0], 0, 0]) && gp.getState().pot === 3 * ADDS[0] && lg.some(e => e.type === 'pot' && e.data.denomIndex === 0 && e.data.pot === 3 * ADDS[0] && J(e.data.pots) === J([3 * ADDS[0], 0, 0])));
    check('G', 'setPot(v, di)：指定面額；超出範圍夾回 0～EV.potMax(di)、小數取整、負數＝0', gp.setPot(1e9, 1) === true && gp.getPot(1) === EV.potMax(1) && gp.setPot(-5, 2) === true && gp.getPot(2) === 0 && gp.setPot(40.9) === true && gp.getPot(0) === 40);
    check('G', 'setPot 不合法被擋：非數字／NaN → pot、不合法面額 → denom，不動原值', gp.setPot('x') === false && gp.getLastError().code === 'pot' && gp.setPot(NaN) === false && gp.setPot(5, 9) === false && gp.getLastError().code === 'denom' && gp.getPot(0) === 40);
    check('G', 'getPot 給不合法面額＝-1', gp.getPot(7) === -1 && gp.getPot(-1) === -1);
    gp.setPot(5 * ADDS[0]); gp.armNext({ kind: 'coin' }); gp.bet(0);
    check('G', '演出中 setPot 被擋、獎池不動', gp.setPot(1) === false && gp.getLastError().code === 'phase' && gp.getPot(0) === rp.r.potAfter);
    gp.ack();
    check('G', '導演台設的獎池下一注接著存（potBefore＝設的值）', rp.r.potBefore === 5 * ADDS[0] && rp.r.potAdd === ADDS[0]);
    check('G', 'settled 事件與注單 rec 帶 potWin', lg.some(e => e.type === 'settled' && e.data.potWin === rp.r.potWin && e.data.rec.potWin === rp.r.potWin) && gp.getRecords().slice(-1)[0].potWin === rp.r.potWin);
    const stp = memStore(); const gx = mkGame({ storage: stp }); gx.setPot(7 * ADDS[0]); const gy = mkGame({ storage: stp });
    check('G', '導演台設的獎池會存檔（重整保留）', gy.getPot() === 7 * ADDS[0]); }
  check('G', '導演台設的能量條會存檔（重整保留）', (() => { const st = memStore(); const x = mkGame({ storage: st }); x.setMeter(33); const y = mkGame({ storage: st }); return y.getMeter() === 33; })());
}

/* ---------- H 首次進場旗標 ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(77) });
  const okGlow = [0, 1, 2].every(d => { const c = g.glowCell(d); return g.isFresh(d) && c >= 0 && c === EV.bestCell(EV.startBoard(d)) && g.getBoard(d).h[c] === EV.CFG.CAP - 1; });
  check('H', '三張盤面一開始都「沒丟過」，發光格＝起始盤面最會爆的那格（疊 3 枚）', okGlow);
  check('H', 'getState 帶出 fresh／glow（目前面額）', g.getState().fresh === true && g.getState().glow === g.glowCell(0));
  g.setDenom(1); g.bet(g.glowCell(1)); g.ack();
  check('H', '丟過的盤面 isFresh＝false、glowCell＝-1；沒丟的另兩張不受影響', !g.isFresh(1) && g.glowCell(1) === -1 && g.isFresh(0) && g.isFresh(2) && g.glowCell(0) >= 0);
  const g2 = mkGame({ storage: store });
  check('H', '重整後旗標保持', !g2.isFresh(1) && g2.isFresh(0) && g2.isFresh(2));
  g2.clearSaved();
  check('H', '重置後三張都回到「沒丟過」', [0, 1, 2].every(d => g2.isFresh(d) && g2.glowCell(d) >= 0));
  check('H', '丟發光格＝第一下噴 4 枚（起始盤面條件）', (() => { const gg = mkGame({ rng: EV.scripted({ kind: 'coin' }, EV.rng(1)) }); const o = lastResult(gg); gg.bet(gg.glowCell(0)); return o.r.main.exitCount === EV.START_RULE.EXITS; })());
  check('H', '查詢回的是拷貝：改了不影響核心（盤面與能量條陣列）', (() => { const b = g2.getBoard(0); b.h[0] = 3; b.g[0].push('crown'); const s = g2.getState(); s.meters[0] = 1; s.pots[0] = 999; return !sameBoard(b, g2.getBoard(0)) && sameBoard(g2.getBoard(0), EV.startBoard(0)) && g2.getMeter(0) === MS && g2.getPot(0) === 0; })());
}

/* ---------- I 一注結果的形狀（給 UI 與紀錄頁） ---------- */
{
  const g = mkGame({ rng: EV.rng(123), wallet: 1e7 }); const all = [];
  g.on((t, d) => { if(t === 'result') all.push(d); });
  for(let n = 0; n < 3000; n++){ g.setDenom(n % ND); g.bet((n * 7) % 25); g.ack(); }
  const KEYS = ['orderId', 'ts', 'denomIndex', 'stake', 'cell', 'kind', 'main', 'rain', 'hasRain', 'meterBefore', 'meterAfter', 'exits', 'enter', 'inValue', 'pay', 'topples', 'exitCount',
    'items', 'payout', 'mult', 'net', 'tier', 'quiet', 'boardBefore', 'boardAfter', 'potBefore', 'potAdd', 'potWin', 'potAfter', 'potBy'];
  let bad = '';
  for(const e of all){
    const r = e.result;
    for(const k of KEYS) if(!(k in r)) bad = bad || '缺欄位 ' + k;
    for(const k of ['sky', 'hasSky', 'skyCell']) if(k in r) bad = bad || '不該有 v1 欄位 ' + k;
    if(r.stake !== EV.CFG.DENOMS[r.denomIndex]) bad = bad || 'stake≠面額';
    if(r.payout !== EV.cash(r, r.denomIndex) + r.potWin) bad = bad || 'payout≠EV.cash＋potWin';
    if(r.tier !== EV.tier(r, r.denomIndex, r.potWin)) bad = bad || 'tier≠EV.tier（含獎池）';
    if(r.potAdd !== EV.PAY[r.denomIndex].pot || r.potAfter !== (r.potWin > 0 ? 0 : r.potBefore + r.potAdd) || (r.potWin > 0 && r.potWin !== r.potBefore + r.potAdd)) bad = bad || '獎池欄位算術';
    if(r.potBy !== (r.main.topples >= PC ? 'chain' : (r.hasRain ? 'rain' : null)) || (r.potWin > 0) !== (r.potBy !== null)) bad = bad || 'potBy／potWin 與規則不符';
    if(!(r.potBefore >= 0 && r.potBefore <= EV.potMax(r.denomIndex) && r.potAfter >= 0 && r.potAfter <= EV.potMax(r.denomIndex) && Number.isInteger(r.potBefore) && Number.isInteger(r.potWin) && Number.isInteger(r.potAfter))) bad = bad || '獎池不是整數或超過上界';
    if(r.quiet && r.potWin !== 0) bad = bad || 'quiet 的注拿了獎池';
    if(Math.abs(r.mult * r.stake - r.payout) > 1e-6) bad = bad || 'mult×stake≠payout';
    if(r.net !== r.payout - r.stake) bad = bad || 'net';
    if(r.items.length !== r.exitCount) bad = bad || '噴出清單長度≠噴出枚數';
    if(r.items.reduce((s, x) => s + x.amount, 0) + r.potWin !== r.payout) bad = bad || '清單加總＋獎池≠payout';
    if(r.items.some(x => x.src !== 'main' && x.src !== 'rain')) bad = bad || 'items.src 值域';
    if(r.items.filter(x => x.src === 'rain').length !== (r.rain ? r.rain.exitCount : 0)) bad = bad || '雨的 items 數≠rain.exitCount';
    if(r.items.filter(x => x.src === 'main').length !== r.main.exitCount) bad = bad || '主的 items 數≠main.exitCount';
    if(r.items.findIndex(x => x.src === 'rain') >= 0 && r.items.slice(r.items.findIndex(x => x.src === 'rain')).some(x => x.src === 'main')) bad = bad || 'items 順序：先 main 後 rain';
    if(r.hasRain !== (r.rain !== null)) bad = bad || 'hasRain';
    if(r.hasRain && (r.rain.kind !== 'coin' || r.rain.cell !== -1 || r.rain.coins !== 25 || r.rain.fall.length !== 25)) bad = bad || '雨的欄位';
    if(r.hasRain && r.rain.waves.some(w => w.moves.length !== w.cells.length * 4)) bad = bad || '雨每格炸開應有 4 筆 moves';
    if(r.hasRain && r.rain.waves.reduce((s, w) => s + w.cells.length, 0) !== r.rain.topples) bad = bad || '雨分波格數≠連爆格數';
    if(r.hasRain && (r.meterBefore !== RE - 1 || r.meterAfter !== 0)) bad = bad || '雨那一注能量條';
    if(!r.hasRain && r.meterAfter !== r.meterBefore + 1) bad = bad || '沒雨能量條 +1';
    if(r.enter.coin !== (r.kind === 'coin' ? 1 : 0) + (r.hasRain ? 25 : 0)) bad = bad || 'enter.coin 沒算雨的 25 枚';
    if(r.topples !== r.main.topples + (r.rain ? r.rain.topples : 0)) bad = bad || 'topples≠主＋雨';
    if(r.quiet !== (r.topples === 0 && !r.rain)) bad = bad || 'quiet';
    if(r.hasRain && r.quiet) bad = bad || '有雨不該 quiet';
    if(r.main.waves.reduce((s, w) => s + w.cells.length, 0) !== r.main.topples) bad = bad || '分波格數≠連爆格數';
    if(r.main.waves.some(w => w.moves.length !== w.cells.length * 4)) bad = bad || '每格炸開應有 4 筆 moves';
    if(e.win !== (r.payout > 0) || e.payout !== r.payout || e.tier !== r.tier || e.cell !== r.cell || e.hasRain !== r.hasRain || e.meterBefore !== r.meterBefore || e.meterAfter !== r.meterAfter) bad = bad || 'result 事件欄位';
    if(e.potWin !== r.potWin || e.potBefore !== r.potBefore || e.potAfter !== r.potAfter || e.potAdd !== r.potAdd || e.potBy !== r.potBy) bad = bad || 'result 事件的獎池欄位';
    if(r.cell < 0 || r.cell >= 25 || r.kind !== EV.rollKind(EV.uForKind(r.kind))) bad = bad || 'cell/kind';
    const cnt = r.items.reduce((o, x) => { o[x.kind]++; return o; }, { coin: 0, diamond: 0, crown: 0 });
    if(cnt.coin !== r.exits.coin || cnt.diamond !== r.exits.diamond || cnt.crown !== r.exits.crown) bad = bad || '清單種類數≠exits';
    if(JSON.parse(JSON.stringify(r)).payout !== r.payout) bad = bad || '不可序列化';
  }
  check('I', `3,000 注的結果物件欄位齊全、金額／分級／倍數／噴出清單（src main／rain）／分波／能量條與 values.js 一致（${bad}）`, bad === '');
  const t = {}; all.forEach(e => { t[e.tier] = (t[e.tier] || 0) + 1; });
  check('I', '分級四種都出現過（none／back／big／huge），來源是 EV.tier：' + J(t), ['none', 'back', 'big', 'huge'].every(k => t[k] > 0));
  const nr = all.filter(e => e.result.hasRain).length;
  check('I', `有金幣雨的注（${nr}）：items 含 src:'rain'、雨那一注一定有拿回（免費 25 枚幣的錢）`, nr > 0 && all.filter(e => e.result.hasRain).every(e => e.result.items.some(x => x.src === 'rain') && e.result.pay > 0));
  check('I', '有 quiet（沒爆沒雨）的注，且 quiet 的注 payout＝0、items 空', all.some(e => e.result.quiet) && all.filter(e => e.result.quiet).every(e => e.result.payout === 0 && e.result.items.length === 0 && e.result.main.waves.length === 0));
  const rec = g.getRecords()[0], RK = ['orderId', 'ts', 'denomIndex', 'stake', 'cell', 'kind', 'hasRain', 'payout', 'net', 'mult', 'tier', 'win', 'potWin', 'exits', 'exitCount', 'topples'];
  check('I', '注單紀錄欄位齊全（hasRain）、不含分波與 v1 的 hasSky／skyCell（體積小）', RK.every(k => k in rec) && !('main' in rec) && !('boardBefore' in rec) && !('hasSky' in rec) && !('skyCell' in rec));
  const g2 = mkGame({ rng: EV.scripted({ kind: 'crown' }, EV.rng(1)), wallet: 1e6 });
  const cr = lastResult(g2);
  g2.setDenom(2); const gl = g2.glowCell(2); g2.bet(gl);
  check('I', '皇冠＋實付：皇冠被擠出的那枚金額＝50×面額，tier huge（若有噴出）或 none', cr.r.items.filter(x => x.kind === 'crown').every(x => x.amount === 50000) && (cr.r.exits.crown > 0 ? cr.r.tier === 'huge' : true));
  check('I', '進行中一單可由 getPending／getState().st 查到同一份結果', g2.getPending() === g2.getState().st || J(g2.getPending()) === J(cr.r));
}

/* ---------- J 壞檔、舊版存檔與契約 ---------- */
{
  const key = DEMO_KEY + '.core';
  const sb = startBoards();
  const v2full = J({ v: 2, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, records: [], pending: null });   // v1 核心（v:2）寫的完整存檔
  const v3full = J({ v: 3, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, meters: [60, 60, 60], records: [], pending: null });   // v2.1（能量條長 76）寫的完整存檔，能量條值可超過現在的長度
  const v4full = J({ v: 4, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, meters: [30, 30, 30], records: [], pending: null });   // v2.2（能量條長 43、沒有獎池）寫的完整存檔
  const bads = { 垃圾: 'not json{', 舊版v1: J({ v: 1, wallet: 123, seq: 1, records: [], pending: null }), 舊版v2完整存檔: v2full, 舊版v3完整存檔: v3full, 舊版v4完整存檔: v4full, 空物件: '{}',
                 錢包壞: J({ v: SAVE_V, wallet: 'x', boards: [] }) };
  for(const [name, raw] of Object.entries(bads)){
    const g = mkGame({ storage: memStore({ [key]: raw }) });
    check('J', `壞檔／舊版「${name}」：不報錯、忽略、以新玩家狀態開局（錢包 10,000、起始盤面、能量條 ${MS}、面額預設、沒丟過）`,
      g.getWallet() === 10000 && startBoards().every((b, d) => sameBoard(b, g.getBoard(d)) && g.isFresh(d)) && allMeters(g).every(m => m === MS) && allPots(g).every(p => p === 0) && g.getDenomIndex() === EV.CFG.DENOM_DEFAULT && g.getRecords().length === 0 && g.getPending() === null);
  }
  { const st = memStore({ [key]: v2full }); const g = mkGame({ storage: st, rng: EV.rng(4) }); g.bet(0); g.ack();
    check('J', '舊版存檔被忽略後可正常下注，並覆寫成最新版存檔', JSON.parse(st.getItem(key)).v === SAVE_V && g.getRecords().length === 1 && g.getMeter() === MS + 1); }
  const s = memStore(); const g1 = mkGame({ storage: s, rng: EV.rng(2), wallet: 5000 }); g1.bet(0); g1.ack();
  check('J', `存檔 v＝${SAVE_V}、帶 meters 三條、pots 三個（整數）`, (() => { const d = JSON.parse(s.getItem(key)); return d.v === SAVE_V && Array.isArray(d.meters) && d.meters.length === ND && Array.isArray(d.pots) && d.pots.length === ND && d.pots.every(Number.isInteger); })());
  const d = JSON.parse(s.getItem(key)); d.boards[1] = { h: [9], g: [] }; s.setItem(key, J(d));
  const g2 = mkGame({ storage: s });
  check('J', '單張盤面損壞：只有那張回到起始盤面，其他與錢包、能量條保留', sameBoard(g2.getBoard(1), EV.startBoard(1)) && sameBoard(g2.getBoard(0), g1.getBoard(0)) && g2.getWallet() === g1.getWallet() && g2.getMeter(0) === g1.getMeter(0));
  const d2 = JSON.parse(s.getItem(key)); d2.meters = [20, 'x', RE + 956]; s.setItem(key, J(d2));
  const g2b = mkGame({ storage: s });
  check('J', '能量條損壞（非數字／超範圍）：只那條回起始值，好的保留', g2b.getMeter(0) === 20 && g2b.getMeter(1) === MS && g2b.getMeter(2) === MS);
  { const dp = JSON.parse(s.getItem(key)); dp.pots = [3 * ADDS[0], -4, 1.5]; s.setItem(key, J(dp));
    const gpa = mkGame({ storage: s });
    check('J', '獎池損壞（負數／小數）：只那個回 0，好的保留', gpa.getPot(0) === 3 * ADDS[0] && gpa.getPot(1) === 0 && gpa.getPot(2) === 0 && gpa.getWallet() === g1.getWallet());
    dp.pots = [EV.potMax(0) + 1, 'x', 4 * ADDS[2]]; s.setItem(key, J(dp));
    const gpb = mkGame({ storage: s });
    check('J', '獎池損壞（超過上界、非數字）：只那個回 0，好的保留', gpb.getPot(0) === 0 && gpb.getPot(1) === 0 && gpb.getPot(2) === 4 * ADDS[2]);
    delete dp.pots; s.setItem(key, J(dp));
    check('J', '最新版存檔缺 pots：三個獎池回 0、其他保留', (() => { const x = mkGame({ storage: s }); return allPots(x).every(p => p === 0) && x.getWallet() === g1.getWallet(); })()); }
  const d3 = JSON.parse(s.getItem(key)); delete d3.meters; s.setItem(key, J(d3));
  check('J', '最新版存檔缺 meters：三條回起始值、其他保留', (() => { const x = mkGame({ storage: s }); return allMeters(x).every(m => m === MS) && x.getWallet() === g1.getWallet(); })());
  const g = mkGame({ rng: EV.rng(1), wallet: 1e6 });
  check('J', '非法格號被擋（-1、25、1.5、字串、undefined）不扣款', [-1, 25, 1.5, '3', undefined, NaN].every(c => g.bet(c) === false && g.getLastError().code === 'cell') && g.getWallet() === 1e6 && g.getState().phase === 'BET' && g.getMeter() === MS);
  check('J', 'BET 階段 ack 被擋', g.ack() === false && g.getLastError().code === 'phase');
  g.bet(0);
  check('J', 'ANIM 階段不能再下注（上一單 ack 才能下一單）、不能加錢', g.bet(1) === false && g.getLastError().code === 'phase' && g.addMoney(100) === false && g.getRecords().length === 0);
  g.ack();
  check('J', 'ack 後才可下一單', g.bet(1) === true);
  const gn = DemoCore.createGame({ storage: false }); gn.bet(0); gn.ack();
  check('J', '不給 rng／now 也能跑（預設 Math.random／Date.now）', gn.getRecords().length === 1);
  const noStore = DemoCore.createGame({ storage: false, rng: EV.rng(3) });
  check('J', 'storage:false 不碰任何儲存也能玩', noStore.bet(0) === true && noStore.ack() === true);
  const src = fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  check('J', 'core.js 零 DOM（無 window／document）、不自帶亂數（Math.random 只出現在預設 rng 那一處）',
    !/\b(window|document|navigator)\b/.test(code) && (code.match(/Math\.random/g) || []).length === 1);
  check('J', 'core.js 沒有硬編碼的機率／賠率／能量條長度／獎池數字（1/40、1/800、普通幣值、目前的能量條長度、COIN_PAY、SKY_P、CFG.POT_*、0.15 等只能出在 values.js；起始值 METER_START 與存檔版本 SAVE_V 是僅有的常數）',
    !/(1\s*\/\s*(40|800|7)\b|COIN_PAY|SKY_P|DIAMOND|CROWN|CFG\.POT|\b0\.15\b)/.test(code) && !new RegExp('\\b(' + RE + '|' + String(EV.VALUE.coin).replace('.', '\\.') + ')\\b').test(code) && new RegExp('var METER_START = ' + MS + ';').test(code));
}

/* ---------- K 凍結檔 md5 ---------- */
{
  const lines = fs.readFileSync(path.join(ROOT, '..', 'reports', 'frozen.md5'), 'utf8').split(/\r?\n/).filter(Boolean);
  let all = true, bad = [];
  for(const ln of lines){
    const m = ln.match(/^([0-9a-f]{32}) \*(.+)$/); if(!m) continue;
    const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, '..', m[2]))).digest('hex');
    if(h !== m[1]){ all = false; bad.push(m[2]); }
  }
  check('K', `frozen.md5 列出的 ${lines.length} 個凍結檔 md5 全部一致` + (bad.length ? '：' + bad.join(',') : ''), all && lines.length >= 7);
}

console.log(`\ncore-test：PASS ${nPass}／FAIL ${nFail}`);
process.exit(nFail ? 1 : 0);
