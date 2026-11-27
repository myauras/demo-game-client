/* =========================================================================
 * 爆金連鎖——核心（js/core.js）Node 無頭單元測試　v3-1（單一盤面、換金額重來、刷新與冷卻）
 * 執行：node game/test/core-test.js    （零依賴；values.js 與 core.js 以 eval 載入，同 mc-test.js 的作法）
 * 對應任務卡 C01 驗收清單（含 v2-1、v2.3、v3-1）：
 *   S 常數　A 連丟 10,000 注逐注對帳（含換金額、刷新、獎池、每 RAIN_EVERY 注一場雨、影子盤面）　B 餘額不足
 *   C 下注後 ack 前重整（含金幣雨、拿獎池、剛刷新／剛換金額後重整）　D 換金額＝重來（peekDenomChange、事件、盤面）
 *   R 刷新與冷卻（逐注倒數、失敗不動盤面、枚數與寶物不變、重整）　E 重置　E2 重置錢包　F 同 rng 重跑相同＋刷新／換金額不影響抽到的幣種序列
 *   G rng／能量條／獎池／冷卻注入（導演台）　H 首次進場旗標　I 結果形狀　J 壞檔、舊版存檔與契約
 *   K 凍結檔 md5（core.js／core-test.js 自己除外：它們由本卡擁有、凍結清單由主對話更新）
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
const RE = EV.RAIN_EVERY, MS = DemoCore.METER_START, CD = DemoCore.REFRESH_COOLDOWN_BETS;
const SAVE_V = 6;                         // 存檔版本（core.js 的 v:）；v6＝單一盤面；規則或欄位變了就加一，舊存檔整份忽略
const KEY = DEMO_KEY + '.core';
const PC = EV.POT_CHAIN;
const ADDS = EV.PAY.map(p => p.pot);                       // 各金額每注存進獎池的實付（整數）
const gemsOf = (b) => { const o = { diamond: 0, crown: 0 }; b.g.forEach(a => a.forEach(k => { o[k]++; })); return o; };
const piecesOf = (b) => EV.total(b);
const START = () => EV.startBoard(EV.CFG.DENOM_DEFAULT);   // 新玩家的第一張盤面
/* 手工存檔：以起始盤面為底，可覆寫盤面／獎池／能量條／冷卻（寫成 v:SAVE_V 的完整存檔，丟給 createGame 的 storage 讀） */
function craftSave(o){ o = o || {}; return J({ v: SAVE_V, wallet: o.wallet != null ? o.wallet : 1e7, seq: 0, denom: o.denom || 0, fresh: !!o.fresh,
  board: o.board || START(), meter: o.meter != null ? o.meter : MS, pot: o.pot || 0, refreshLeft: o.refreshLeft || 0, records: [], pending: null }); }
const fullBoard = () => { const b = EV.emptyBoard(); for(let j = 0; j < EV.N; j++) b.h[j] = EV.CFG.CAP - 1; return b; };   // 每格 3 枚：丟一枚＝巨大連鎖
const gemBoard = () => { const b = START(); let n = 0; for(let j = 0; j < EV.N && n < 3; j++) if(b.h[j] >= 1){ b.g[j].push(n === 1 ? 'crown' : 'diamond'); n++; } return b; };   // 起始盤面上放 3 顆寶物（2 鑽 1 冠）
const allBelowCap = (b) => b.h.every(x => x >= 0 && x < EV.CFG.CAP);
const sameBoard = (a, b) => J(a) === J(b);
function mkGame(extra){ let t = 1700000000000; return DemoCore.createGame(Object.assign({ storage: false, now: () => t++ }, extra || {})); }
function evCollector(g){ const log = []; g.on((type, data) => log.push({ type, data })); return log; }
function lastResult(g){ const o = { r: null }; g.on((t, d) => { if(t === 'result') o.r = d.result; }); return o; }
const noRng = () => { throw new Error('不該用到這串亂數'); };

/* ---------- 前置：常數與 values.js 對得上 ---------- */
check('S', `METER_START＝EV.DEMO_METER_START＝${MS}（Demo 專用）、是 0～${RE - 1} 的整數、新玩家第 ${RE - MS} 注下第一場雨（第 30 注）`, MS === EV.DEMO_METER_START && Number.isInteger(MS) && MS >= 0 && MS < RE && RE - MS === EV.CFG.DEMO_FIRST_RAIN_BET);
check('S', `存檔版本 DemoCore.SAVE_V＝${SAVE_V}；刷新冷卻 REFRESH_COOLDOWN_BETS＝10；獎池每注存的實付是整數（${ADDS.join('／')}）、門檻 POT_CHAIN＝${PC}`, DemoCore.SAVE_V === SAVE_V && CD === 10 && ADDS.every(Number.isInteger) && Number.isInteger(PC) && PC >= 1);
check('S', '起始盤面與 fullBoard 都是合法盤面、gemBoard 是合法形狀（測試用盤面）', EV.isLegal(START()) && EV.isLegal(fullBoard()) && EV.isLegal(gemBoard()) && gemsOf(gemBoard()).diamond === 2 && gemsOf(gemBoard()).crown === 1);

/* ---------- A 連丟 10,000 注（金額每 1,000 注輪換、隨機落點、夾刷新），逐注對帳 ---------- */
{
  const BIG = 100000000, seed = 4242, BLOCK = 1000;
  const g = mkGame({ storage: memStore(), wallet: BIG, rng: EV.rng(seed) });
  const placeRng = EV.rng(99);                                  // 玩家挑格與要不要刷新（與抽獎 rng、盤面 rng 分開）
  const shadowRng = EV.rng(seed);                               // 影子：直接用 values.js 算，同一串抽獎 rng
  let shadow = g.getBoard(), shMeter = MS, shPot = 0, shLeft = 0, di = 0;
  const potIn = { v: 0 }, potOut = { v: 0 }, potLost = { v: 0 }, potBy = { chain: 0, rain: 0, both: 0 };   // 影子獎池（測試自己累加的整數）
  let wallet = BIG, bad = 0, badMsg = '', stakeSum = 0, backSum = 0, nRain = 0, nBig = 0, nRefresh = 0, nSwitch = 0, inBlock = 0;
  const rainPos = [[]], res = lastResult(g);
  function flag(msg){ if(!bad) badMsg = msg; bad++; }
  check('A', '新玩家第一張盤面＝起始盤面、沒丟過、能量條＝METER_START、獎池 0、冷卻 0（立刻可刷）', sameBoard(shadow, START()) && g.isFresh() && g.getMeter() === MS && g.getPot() === 0 && g.getRefreshLeft() === 0 && g.canRefresh());
  for(let n = 0; n < 10000; n++){
    if(n > 0 && n % BLOCK === 0){                                // 換金額＝重來
      const nd = Math.floor(n / BLOCK) % ND, pk = g.peekDenomChange(nd), preMeter = g.getMeter(), prePot = g.getPot(), preCnt = piecesOf(g.getBoard());
      potLost.v += shPot;
      const ok = g.setDenom(nd); di = nd; nSwitch++;
      const b = g.getBoard();
      if(!ok || !pk.changes || pk.lost.pot !== shPot || pk.lost.meter !== preMeter || pk.lost.pieces !== preCnt || prePot !== shPot) flag(`第 ${n} 注前換金額：peek／結果不對`);
      else if(!EV.isLegal(b) || piecesOf(b) !== EV.MIN_TOTAL || gemsOf(b).diamond + gemsOf(b).crown !== 0) flag(`第 ${n} 注前換金額後盤面不是 40 枚合法無寶物`);
      else if(g.getMeter() !== 0 || g.getPot() !== 0 || g.getRefreshLeft() !== 0 || g.isFresh() || g.getDenomIndex() !== nd) flag(`第 ${n} 注前換金額後能量條／獎池／冷卻／旗標不對`);
      shadow = b; shMeter = 0; shPot = 0; shLeft = 0; inBlock = 0; rainPos.push([]);
    }
    if(g.canRefresh() && placeRng() < 0.15){                     // 隨機刷新
      const b0 = g.getBoard(), w0 = g.getWallet(), m0 = g.getMeter(), p0 = g.getPot();
      const ok = g.refresh(), b1 = g.getBoard();
      if(!ok || piecesOf(b1) !== piecesOf(b0) || J(gemsOf(b1)) !== J(gemsOf(b0)) || !EV.isLegal(b1) || !allBelowCap(b1)) flag(`第 ${n + 1} 注前刷新：枚數／寶物／合法性不對`);
      else if(g.getWallet() !== w0 || g.getMeter() !== m0 || g.getPot() !== p0 || g.getRefreshLeft() !== CD) flag(`第 ${n + 1} 注前刷新動到錢／能量條／獎池，或冷卻沒設成 ${CD}`);
      shadow = b1; shLeft = CD; nRefresh++;
    }
    const stake = EV.CFG.DENOMS[di], cell = Math.floor(placeRng() * EV.N);
    const before = g.getBoard(), meterB = g.getMeter();
    res.r = null;
    const ok = g.bet(cell);
    const r = res.r;
    const afterBet = g.getWallet();
    const ph = g.getState().phase;
    const meterDuring = g.getMeter();
    g.ack();
    const afterAck = g.getWallet();
    const m = EV.meterAfter(shMeter); shMeter = m.meter;
    const sh = EV.play(shadow, cell, shadowRng, { rain: m.rain });   // 影子結果（同 rng、同能量條）
    const shBefore = shPot; shPot += ADDS[di]; potIn.v += ADDS[di];  // 影子獎池：先入池再判斷（測試自己算，不呼叫 EV.potAfter）
    const sChain = sh.main.topples >= PC, sRain = !!sh.rain, shWin = (sChain || sRain) ? shPot : 0;
    if(shWin > 0){ shPot = 0; potOut.v += shWin; if(sChain && sRain) potBy.both++; else if(sChain) potBy.chain++; else potBy.rain++; }
    const shPay = EV.cash(sh, di) + shWin;
    if(shLeft > 0) shLeft--;
    inBlock++; if(m.rain) rainPos[rainPos.length - 1].push(inBlock);
    let problem = '';
    if(!ok || !r) problem = '下注失敗';
    else if(afterBet !== wallet - stake) problem = '扣款不對';
    else if(ph !== 'ANIM') problem = '下注後不是 ANIM';
    else if(afterAck !== wallet - stake + r.payout) problem = '入帳不對';
    else if(r.payout !== shPay) problem = '拿回（含獎池）與影子不同';
    else if(r.denomIndex !== di || r.stake !== stake) problem = '金額欄位不對';
    else if(r.potBefore !== shBefore || r.potAdd !== ADDS[di] || r.potWin !== shWin || r.potAfter !== shPot || r.potBy !== (sChain ? 'chain' : sRain ? 'rain' : null)) problem = '獎池欄位與影子不同';
    else if(g.getPot() !== shPot || g.getState().pot !== shPot) problem = '獎池查詢與影子不同';
    else if(r.potWin > 0 && (r.potAfter !== 0 || r.potWin !== r.potBefore + r.potAdd)) problem = '拿獎池後沒歸零或金額不是（之前＋這一注存的）';
    else if(r.tier !== EV.tier(sh, di, shWin)) problem = '分級沒含獎池';
    else if(Math.abs(r.mult - r.payout / stake) > 1e-9) problem = 'mult≠payout÷stake';
    else if(!sameBoard(r.boardAfter, shadow) || !sameBoard(g.getBoard(), shadow)) problem = '盤面與影子不同';
    else if(!sameBoard(r.boardBefore, before)) problem = 'boardBefore 不對';
    else if(!allBelowCap(g.getBoard())) problem = '盤面有格 ≥4';
    else if(EV.total(r.boardAfter) < EV.MIN_TOTAL) problem = `盤面總數 ${EV.total(r.boardAfter)} 低於 ${EV.MIN_TOTAL}`;
    else if(!EV.isLegal(r.boardAfter)) problem = '丟完之後盤面不合法';
    else if(EV.total(r.boardAfter) !== EV.total(r.boardBefore) + (r.enter.coin + r.enter.diamond + r.enter.crown) - r.exitCount) problem = '枚數不守恆';
    else if(r.items.reduce((s, x) => s + x.amount, 0) + r.potWin !== r.payout) problem = '噴出清單金額加總＋獎池≠拿回';
    else if(r.hasRain !== m.rain || (r.rain !== null) !== m.rain) problem = '金幣雨與影子（EV.meterAfter）不同';
    else if(r.meterBefore !== meterB || r.meterAfter !== m.meter || meterDuring !== m.meter || g.getMeter() !== m.meter) problem = '能量條與影子不同';
    else if(r.refreshLeft !== shLeft || g.getRefreshLeft() !== shLeft || g.getState().refreshLeft !== shLeft) problem = '刷新冷卻與影子不同';
    else if(J(r.main) !== J(sh.main) || J(r.rain) !== J(sh.rain)) problem = '分波結果與影子不同';
    if(problem) flag(`第 ${n + 1} 注：${problem}`);
    wallet = wallet - stake + (r ? r.payout : 0);
    stakeSum += stake; backSum += r ? r.payout : 0;
    if(r && r.hasRain) nRain++;
    if(r && (r.tier === 'big' || r.tier === 'huge')) nBig++;
  }
  check('A', `連丟 10,000 注（金額每 ${BLOCK} 注輪換 ${nSwitch} 次、隨機刷新 ${nRefresh} 次）逐注：扣款／入帳／盤面／能量條／獎池（入池、拿走、歸零、原因）／刷新冷卻倒數／清單加總＋獎池＝拿回／枚數守恆／盤面恆合法／與直接呼叫 EV.play＋測試自己累加的獎池影子（同 rng、同能量條）完全一致（刷新與換金額沒動到抽獎那一串亂數）`, bad === 0 && nRefresh > 20, badMsg);
  check('A', `獎池守恆（實付整數）：Σ存入＝Σ拿走＋換金額時放棄的＋期末餘額；拿獎池的三種情形都測到（自己連鎖 ${potBy.chain}／只有下雨 ${potBy.rain}／同注兩者 ${potBy.both}）`,
    potIn.v === potOut.v + potLost.v + g.getPot() && g.getPot() === shPot && potBy.chain > 0 && potBy.rain > 0);
  check('A', `錢包＝起始 − 投入 ＋ 拿回（投入 ${stakeSum}、拿回 ${backSum}）；換金額與刷新不動錢包`, g.getWallet() === BIG - stakeSum + backSum);
  check('A', '10,000 注後盤面每格都 <4、總數 ≥40、合法', allBelowCap(g.getBoard()) && EV.total(g.getBoard()) >= EV.MIN_TOTAL && EV.isLegal(g.getBoard()));
  const gapsOk = rainPos.length === 10 && rainPos.every((a, b) => a.length === 10 && a.every((x, i) => x === (b === 0 ? RE - MS : RE) + i * RE));
  check('A', `每 ${RE} 注恰下一次雨：新玩家第一張盤面第 ${RE - MS} 注、${RE - MS + RE} 注…；換金額後的盤面（能量條從 0）第 ${RE} 注、${2 * RE} 注…；每個區段 10 場`, gapsOk, J(rainPos.map(a => a.slice(0, 3))));
  check('A', `能量條終值與注數一致（最後一段從 0 起丟 ${BLOCK} 注 → 0）`, g.getMeter() === (BLOCK % RE));
  check('A', `有金幣雨（${nRain}）與大連爆以上（${nBig}）出現，測到了這些路徑`, nRain === rainPos.reduce((s, a) => s + a.length, 0) && nRain > 0 && nBig > 0);
  check('A', '注單流水封頂 200 筆、流水號累計 10,000；換金額不清注單', g.getRecords().length === 200 && g.getState().seq === 10000);
  const rc = g.getRecords();
  check('A', '注單號唯一、紀錄時間順序', new Set(rc.map(r => r.orderId)).size === rc.length && rc.every((r, i) => i === 0 || r.ts > rc[i - 1].ts));
}

/* ---------- B 餘額不足 ---------- */
{
  let consumed = 0; const rng = () => { consumed++; return 0.5; };
  const g = mkGame({ wallet: 50, rng });
  const log = evCollector(g), b0 = g.getBoard(), st0 = g.getState(), m0 = g.getMeter(), l0 = g.getRefreshLeft();
  const r = g.bet(12);
  check('B', '餘額 50 < 金額 100：bet 回 false、錯誤碼 funds', r === false && g.getLastError().code === 'funds' && log.some(e => e.type === 'error' && e.data.code === 'funds'));
  check('B', '錢包不變、盤面不變、能量條不變、冷卻不倒數、仍可下注階段、沒消耗 rng、沒寫注單、盤面仍算「沒丟過」',
    g.getWallet() === 50 && sameBoard(g.getBoard(), b0) && g.getMeter() === m0 && g.getRefreshLeft() === l0 && g.getState().phase === 'BET' && consumed === 0 && g.getRecords().length === 0 && g.isFresh() === st0.fresh && g.canBet() === false);
  const g2 = mkGame({ wallet: 100, rng: EV.rng(1) });
  check('B', '餘額剛好等於金額可以下注（扣到 0）', g2.bet(12) === true && g2.getWallet() === 0 && (g2.ack(), g2.getWallet() === g2.getRecords()[0].payout));
  const g3 = mkGame({ wallet: 600, rng: EV.rng(1) });
  g3.setDenom(2); const b3 = g3.getBoard();
  check('B', '餘額 600 選金額 1,000 不能下；盤面（換金額後的新盤面）、能量條不變', g3.bet(0) === false && g3.getWallet() === 600 && sameBoard(g3.getBoard(), b3) && g3.getMeter() === 0);
  g3.setDenom(1);
  check('B', '同一個錢包改選 500 就可以', g3.bet(0) === true);
}

/* ---------- C 下注後、ack 前重整 ---------- */
{
  const store = memStore();
  const g1 = mkGame({ storage: store, rng: EV.rng(7) });
  g1.armNext({ kind: 'diamond' });
  g1.setDenom(1);
  const w0 = g1.getWallet(), stake = 500;
  const res = lastResult(g1);
  g1.bet(6);                                                    // 6＝(1,1)；鑽石
  check('C', '下注後 ack 前：錢包已扣、階段 ANIM、存檔裡有進行中一單', g1.getWallet() === w0 - stake && g1.getState().phase === 'ANIM' && !!JSON.parse(store.getItem(KEY)).pending);
  const g2 = mkGame({ storage: store, rng: () => { throw new Error('接回時不得抽獎'); } });
  const rec = g2.getRestored();
  check('C', '重新載入後：錢包已入帳（起始 − 注額 ＋ 拿回）、階段回到 BET', g2.getWallet() === w0 - stake + res.r.payout && g2.getState().phase === 'BET');
  check('C', '重新載入後：盤面＝算完的盤面（逐格同 boardAfter）、能量條＝算完的值（換金額後從 0 ＋1）、金額保持、冷卻不變', sameBoard(g2.getBoard(), res.r.boardAfter) && g2.getMeter() === 1 && g2.getDenomIndex() === 1 && g2.getRefreshLeft() === 0);
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
  check('C', 'ack 之後重整：狀態（含能量條、冷卻）與重整前完全相同', gC.getWallet() === gB.getWallet() && J(gC.getRecords()) === J(gB.getRecords()) && sameBoard(gC.getBoard(), gB.getBoard()) && stA.wallet === gC.getWallet() && gC.getMeter() === gB.getMeter() && gC.getRefreshLeft() === gB.getRefreshLeft());
  const s5 = memStore(); const gD = mkGame({ storage: s5 }); const gE = mkGame({ storage: s5 });
  check('C', '沒下注就重整：盤面仍是起始盤面（沒丟過）、能量條仍是起始值', sameBoard(START(), gE.getBoard()) && sameBoard(gD.getBoard(), gE.getBoard()) && gE.getMeter() === MS && gE.isFresh());

  /* 金幣雨那一注：ack 前重整 */
  const sr = memStore(); const gr = mkGame({ storage: sr, rng: EV.rng(8) });
  gr.setDenom(2); gr.setMeter(RE - 1);                          // 下一注必下雨
  const wr = gr.getWallet(), rr = lastResult(gr);
  gr.bet(12);
  const R = rr.r;
  check('C', '金幣雨那一注（金額 1,000）：hasRain、meterBefore＝RAIN_EVERY−1、meterAfter＝0、下注後能量條立刻是 0', R.hasRain === true && R.rain !== null && R.meterBefore === RE - 1 && R.meterAfter === 0 && gr.getMeter() === 0 && gr.getState().phase === 'ANIM');
  check('C', '金幣雨那一注：存檔裡的進行中一單帶完整 rain、存檔的能量條已歸零', (() => { const d = JSON.parse(sr.getItem(KEY)); return d.v === SAVE_V && d.pending.result.rain.fall.length === 25 && d.meter === 0; })());
  const gr2 = mkGame({ storage: sr, rng: () => { throw new Error('接回時不得抽獎'); } });
  check('C', '金幣雨 ack 前重整：錢包已入帳一次（起始 − 注額 ＋ 拿回）、不重複入帳', gr2.getWallet() === wr - 1000 + R.payout && gr2.getRecords().length === 1 && gr2.getRecords()[0].hasRain === true && gr2.getState().phase === 'BET');
  check('C', '金幣雨 ack 前重整：盤面是下完雨的（＝boardAfter）、能量條已歸零', sameBoard(gr2.getBoard(), R.boardAfter) && gr2.getMeter() === 0);
  const gr3 = mkGame({ storage: sr });
  check('C', '金幣雨再重整一次：狀態不變、不重複入帳', gr3.getWallet() === gr2.getWallet() && gr3.getRecords().length === 1 && gr3.getMeter() === 0 && sameBoard(gr3.getBoard(), R.boardAfter));
  check('C', '金幣雨那一注一定拿獎池（potBy＝rain 或 chain）：重整前存檔裡獎池已歸零、入帳含獎池', R.potWin === ADDS[2] && R.potAfter === 0 && R.potBy !== null && JSON.parse(sr.getItem(KEY)).pot === 0 && R.payout === R.items.reduce((s, x) => s + x.amount, 0) + R.potWin);

  /* 拿獎池那一注（自己連鎖到門檻；用手工存檔：金額 500、每格 3 枚的盤面、獎池先放 6 注的量）：ack 前重整 */
  const sp = memStore({ [KEY]: craftSave({ board: fullBoard(), pot: 6 * ADDS[1], denom: 1 }) });
  const gp = mkGame({ storage: sp, rng: EV.rng(9) }); const rp = lastResult(gp);
  const wp = gp.getWallet();
  gp.armNext({ kind: 'coin' }); gp.bet(12);
  const PR = rp.r;
  check('C', `拿獎池那一注（自己連鎖，金額 500、獎池 6 注的量）：potBy＝chain、potWin＝（6＋1）注的量、potAfter＝0、payout 含獎池、下注後 getPot 已歸零`, PR.potBy === 'chain' && PR.main.topples >= PC && PR.potBefore === 6 * ADDS[1] && PR.potWin === 7 * ADDS[1] && PR.potAfter === 0 && gp.getPot() === 0 && PR.payout === PR.items.reduce((s, x) => s + x.amount, 0) + PR.potWin && !PR.hasRain);
  check('C', '拿獎池那一注：存檔裡的進行中一單帶 potWin、存檔的獎池已歸零', (() => { const d = JSON.parse(sp.getItem(KEY)); return d.v === SAVE_V && d.pending.result.potWin === PR.potWin && d.pot === 0; })());
  const gp2 = mkGame({ storage: sp, rng: () => { throw new Error('接回時不得抽獎'); } });
  check('C', '拿獎池那一注 ack 前重整：錢包已入帳一次（起始 − 注額 ＋ 含獎池的拿回）、獎池已歸零、不重複入帳、注單帶 potWin', gp2.getWallet() === wp - 500 + PR.payout && gp2.getPot() === 0 && gp2.getRecords().length === 1 && gp2.getRecords()[0].potWin === PR.potWin && gp2.getRecords()[0].payout === PR.payout && gp2.getState().phase === 'BET' && gp2.getRestored() !== null);
  const gp3 = mkGame({ storage: sp });
  check('C', '拿獎池那一注再重整一次：錢包、獎池、注單都不變（不重複）', gp3.getWallet() === gp2.getWallet() && gp3.getPot() === 0 && gp3.getRecords().length === 1 && gp3.getRestored() === null);
  /* 沒拿獎池的一注：ack 前重整，獎池是存進去之後的值 */
  const sq = memStore({ [KEY]: craftSave({ pot: 3 * ADDS[0] }) }); const gq = mkGame({ storage: sq, rng: EV.rng(10) }); const rq = lastResult(gq);
  const qc = Array.from({ length: EV.N }, (_, c) => c).find(c => EV.probe(START(), c).topples === 0);   // 丟下去不會爆的格
  gq.armNext({ kind: 'coin' }); gq.bet(qc);
  const gq2 = mkGame({ storage: sq });
  check('C', '沒拿獎池的一注 ack 前重整：獎池＝入池後的值（之前＋這一注存的）、入帳不含獎池', rq.r.potWin === 0 && rq.r.potAfter === 3 * ADDS[0] + ADDS[0] && gq2.getPot() === 4 * ADDS[0] && gq2.getRecords()[0].potWin === 0);

  /* 剛刷新、剛換金額後重整：拿到同一張盤面（不重抽） */
  const sf = memStore(); const gf = mkGame({ storage: sf, rng: EV.rng(12) });
  const bf0 = gf.getBoard(); gf.refresh(); const bf1 = gf.getBoard();
  const gf2 = mkGame({ storage: sf, rng: noRng, boardRng: noRng });
  check('C', '剛刷新後重整：拿到同一張（刷新後的）盤面、冷卻＝10、能量條／獎池不變、沒丟過旗標已關、重整不動亂數', !sameBoard(bf0, bf1) && sameBoard(gf2.getBoard(), bf1) && gf2.getRefreshLeft() === CD && gf2.getMeter() === MS && gf2.getPot() === 0 && !gf2.isFresh());
  gf2.setBoardRng(EV.rng(4)); gf2.setDenom(1); const bf2 = gf2.getBoard();
  const gf3 = mkGame({ storage: sf, rng: noRng, boardRng: noRng });
  check('C', '剛換金額後重整：拿到同一張（換金額後的）盤面、金額保持、能量條 0、獎池 0、冷卻 0', sameBoard(gf3.getBoard(), bf2) && gf3.getDenomIndex() === 1 && gf3.getMeter() === 0 && gf3.getPot() === 0 && gf3.getRefreshLeft() === 0 && piecesOf(gf3.getBoard()) === EV.MIN_TOTAL);
  /* 刷新後下一注 ack 前重整：冷卻已倒數 */
  const sc = memStore(); const gc = mkGame({ storage: sc, rng: EV.rng(13) }); gc.refresh(); gc.bet(0);
  const gc2 = mkGame({ storage: sc });
  check('C', '刷新後下一注 ack 前重整：冷卻已倒數成 9、盤面＝算完的盤面', gc2.getRefreshLeft() === CD - 1 && gc2.getRecords().length === 1 && gc2.getState().phase === 'BET');
}

/* ---------- D 換金額＝重來 ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(11), wallet: 1e9, boardRng: EV.rng(77) });
  const log = evCollector(g);
  for(let i = 0; i < 7; i++){ g.bet([3, 7, 12, 18, 24, 0, 11][i]); g.ack(); }
  g.setPot(5 * ADDS[0]);
  const S0 = g.getBoard(), m0 = g.getMeter(), p0 = g.getPot(), w0 = g.getWallet(), recs0 = J(g.getRecords());
  check('D', `丟過 7 注後：盤面不是起始盤面、能量條 ${MS}＋7、有獎池`, !sameBoard(S0, START()) && m0 === MS + 7 && p0 === 5 * ADDS[0] && !g.isFresh());
  const pk = g.peekDenomChange(1);
  check('D', 'peekDenomChange(1)：會變、能換、列出會清掉的獎池／能量條格數／枚數／寶物顆數（0 顆）、能量條長度、新盤面 40 枚', pk.valid && pk.can && pk.reason === null && pk.changes === true && pk.from === 0 && pk.to === 1 && pk.fromAmount === 100 && pk.toAmount === 500 && pk.lost.pot === g.getPot() && pk.lost.meter === m0 && pk.lost.pieces === piecesOf(S0) && pk.lost.gems.total === 0 && pk.meterMax === RE && pk.newPieces === EV.MIN_TOTAL);
  check('D', 'peekDenomChange 是純查詢：狀態與錢包不變、沒用任何亂數', (() => { const c = mkGame({ rng: noRng, boardRng: noRng }); const s0 = J(c.getState()); c.peekDenomChange(1); c.peekDenomChange(2); c.peekDenomChange(0); c.peekDenomChange(9); return J(c.getState()) === s0; })() && g.getWallet() === w0 && sameBoard(g.getBoard(), S0));
  const same = g.peekDenomChange(0), badp = g.peekDenomChange(7);
  check('D', 'peekDenomChange 同金額＝不會變（changes false、全 0）；不合法金額＝valid false、reason denom', same.valid && same.changes === false && same.lost.pot === 0 && same.lost.meter === 0 && same.lost.pieces === 0 && same.lost.gems.total === 0 && badp.valid === false && badp.can === false && badp.reason === 'denom' && badp.changes === false);
  check('D', 'setDenom 同一個金額：回 true、什麼都不做（盤面／能量條／獎池不變、不發 denom 事件）', (() => { const n = log.length; const ok = g.setDenom(0); return ok && sameBoard(g.getBoard(), S0) && g.getMeter() === m0 && g.getPot() === p0 && !log.slice(n).some(e => e.type === 'denom'); })());
  const nLog = log.length;
  const ok = g.setDenom(1);
  const B1 = g.getBoard(), ev = log.slice(nLog).filter(e => e.type === 'denom');
  check('D', '換金額 100→500：回 true、盤面＝40 枚、合法、沒有寶物、能量條 0（不預充）、獎池 0、冷卻 0、不算首次進場', ok && piecesOf(B1) === EV.MIN_TOTAL && EV.isLegal(B1) && gemsOf(B1).diamond + gemsOf(B1).crown === 0 && g.getMeter() === 0 && g.getPot() === 0 && g.getRefreshLeft() === 0 && !g.isFresh() && g.glowCell() === -1 && g.getDenomIndex() === 1 && g.getDenom() === 500 && !sameBoard(B1, S0));
  check('D', '換金額不動錢包與注單', g.getWallet() === w0 && J(g.getRecords()) === recs0);
  check('D', 'denom 事件只發一次，帶：新金額、舊金額、換好的盤面（拷貝）、meter 0／pot 0／refreshLeft 0、lost（獎池、能量條格數、原枚數、寶物顆數）＝peekDenomChange 的 lost', ev.length === 1 && ev[0].data.denomIndex === 1 && ev[0].data.denom === 500 && ev[0].data.prevIndex === 0 && ev[0].data.prevDenom === 100 && sameBoard(ev[0].data.board, B1) && ev[0].data.meter === 0 && ev[0].data.pot === 0 && ev[0].data.refreshLeft === 0 && J(ev[0].data.lost) === J(pk.lost));
  check('D', 'getState 反映換金額：denomIndex／denom／potAdd＝該金額每注存的／meter 0／pot 0／refreshLeft 0／canRefresh', (() => { const s = g.getState(); return s.denomIndex === 1 && s.denom === 500 && s.potAdd === ADDS[1] && s.meter === 0 && s.pot === 0 && s.refreshLeft === 0 && s.canRefresh === true && J(s.denoms) === J(EV.CFG.DENOMS) && !('meters' in s) && !('pots' in s); })());
  /* 換回原金額也是新盤面 */
  for(let i = 0; i < 4; i++){ g.bet(i * 6); g.ack(); }
  const S1 = g.getBoard(), m1 = g.getMeter();
  g.setPot(3 * ADDS[1]);
  const pk2 = g.peekDenomChange(0);
  g.setDenom(0);
  const B0 = g.getBoard();
  check('D', '換回原金額 100 也是新盤面：40 枚、合法、無寶物、不等於換走之前那張、也不是起始盤面；能量條 0、獎池 0（不還原）', piecesOf(B0) === EV.MIN_TOTAL && EV.isLegal(B0) && gemsOf(B0).diamond + gemsOf(B0).crown === 0 && !sameBoard(B0, S0) && !sameBoard(B0, S1) && !sameBoard(B0, START()) && g.getMeter() === 0 && g.getPot() === 0 && pk2.lost.meter === m1 && pk2.lost.pot === 3 * ADDS[1]);
  check('D', '連換幾次：每次的新盤面都是 40 枚合法盤面，且彼此不全相同（隨機底盤）', (() => { const set = new Set(); for(let i = 0; i < 12; i++){ g.setDenom(i % 2 ? 0 : 1); const b = g.getBoard(); if(piecesOf(b) !== EV.MIN_TOTAL || !EV.isLegal(b) || gemsOf(b).diamond + gemsOf(b).crown !== 0) return false; set.add(J(b)); } return set.size > 6; })());
  /* 寶物：換金額放棄盤面上的寶物 */
  const sg = memStore({ [KEY]: craftSave({ board: gemBoard(), meter: 37, pot: 9 * ADDS[0] }) }); const gg = mkGame({ storage: sg, boardRng: EV.rng(5) }); const lg = evCollector(gg);
  const pg = gg.peekDenomChange(2);
  check('D', 'peekDenomChange 數得到盤面上的寶物（2 鑽 1 冠）、獎池、能量條格數、枚數', pg.lost.gems.total === 3 && pg.lost.gems.diamond === 2 && pg.lost.gems.crown === 1 && pg.lost.pot === 9 * ADDS[0] && pg.lost.meter === 37 && pg.lost.pieces === piecesOf(gemBoard()));
  gg.setDenom(2);
  check('D', '換金額：寶物消失（新盤面無寶物）、denom 事件的 lost 帶寶物顆數', gemsOf(gg.getBoard()).diamond + gemsOf(gg.getBoard()).crown === 0 && J(lg.filter(e => e.type === 'denom')[0].data.lost) === J(pg.lost));
  /* 限制 */
  const gb = mkGame({ rng: EV.rng(2), wallet: 1e6 }); gb.bet(0);
  const ba = gb.getBoard(), pa = gb.peekDenomChange(1);
  check('D', '演出中（有進行中的單）不可換金額：回 false、code phase、盤面不動；peek 回 can false、reason phase', gb.setDenom(1) === false && gb.getLastError().code === 'phase' && gb.getDenomIndex() === 0 && sameBoard(gb.getBoard(), ba) && pa.can === false && pa.reason === 'phase' && pa.changes === true);
  gb.ack();
  check('D', '不合法金額索引被擋（回 false、code denom）', gb.setDenom(3) === false && gb.getLastError().code === 'denom' && gb.setDenom(-1) === false && gb.setDenom(0.5) === false && gb.setDenom('1') === false && gb.getDenomIndex() === 0);
  check('D', '重整後金額與盤面保持（換金額後的狀態）', (() => { const s = memStore(); const x = mkGame({ storage: s, rng: EV.rng(2), wallet: 1e6 }); x.setDenom(2); x.bet(5); x.ack(); x.setDenom(1); const y = mkGame({ storage: s }); return y.getDenomIndex() === 1 && sameBoard(y.getBoard(), x.getBoard()) && y.getMeter() === 0 && y.getPot() === 0; })());
  check('D', '換金額用的是盤面那一串亂數（boardRng）：不消耗抽獎 rng', (() => { let c = 0; const x = mkGame({ rng: () => { c++; return 0.9; } }); x.setDenom(1); x.setDenom(2); x.refresh(); return c === 0; })());
}

/* ---------- R 刷新與冷卻 ---------- */
{
  const g = mkGame({ storage: memStore(), rng: EV.rng(41), wallet: 1e9 }); const log = evCollector(g);
  check('R', '新玩家一開始就能刷：refreshLeft 0、canRefresh true、refreshEvery 10', g.getRefreshLeft() === 0 && g.canRefresh() === true && g.getState().refreshEvery === CD && g.getRefreshEvery() === CD && g.getState().canRefresh === true);
  const B0 = g.getBoard(), m0 = g.getMeter(), w0 = g.getWallet(), n0 = piecesOf(B0);
  const ok = g.refresh(), B1 = g.getBoard();
  const ev = log.filter(e => e.type === 'refresh');
  check('R', '刷新：回 true、盤面換了、枚數相同、合法、每格 <4；能量條／獎池／錢包／注單不動；冷卻＝10；不算首次進場（發光格沒了）', ok && !sameBoard(B0, B1) && piecesOf(B1) === n0 && EV.isLegal(B1) && allBelowCap(B1) && g.getMeter() === m0 && g.getPot() === 0 && g.getWallet() === w0 && g.getRecords().length === 0 && g.getRefreshLeft() === CD && g.canRefresh() === false && !g.isFresh() && g.glowCell() === -1);
  check('R', 'refresh 事件：新盤面、舊盤面、枚數、寶物顆數、冷卻 10、refreshEvery 10', ev.length === 1 && sameBoard(ev[0].data.board, B1) && sameBoard(ev[0].data.boardBefore, B0) && ev[0].data.pieces === n0 && ev[0].data.gems.total === 0 && ev[0].data.refreshLeft === CD && ev[0].data.refreshEvery === CD);
  /* 冷卻逐注倒數：冷卻中刷新失敗且盤面不變 */
  let okAll = true, why = '';
  for(let k = CD; k >= 1; k--){
    const bb = g.getBoard(), nE = log.length;
    const r1 = g.refresh();
    const err = g.getLastError();
    if(r1 !== false || err.code !== 'cooldown' || err.left !== k || g.getRefreshLeft() !== k || !sameBoard(g.getBoard(), bb) || g.canRefresh() || !log.slice(nE).some(e => e.type === 'error' && e.data.code === 'cooldown' && e.data.left === k) || log.slice(nE).some(e => e.type === 'refresh')){ okAll = false; why = `剩 ${k} 注時刷新沒被正確擋下`; break; }
    g.bet((k * 3) % 25); g.ack();
    if(g.getRefreshLeft() !== k - 1 || g.getState().refreshLeft !== k - 1){ okAll = false; why = `丟 1 注後冷卻應是 ${k - 1}，實際 ${g.getRefreshLeft()}`; break; }
  }
  check('R', `冷卻 ${CD} 注逐注倒數（10→9→…→0），冷卻中每次刷新都回 false（code cooldown、帶 left）、盤面不變、不發 refresh 事件`, okAll, why);
  check('R', '丟滿 10 注後冷卻 0、canRefresh true；可以再刷，刷完冷卻回 10', g.getRefreshLeft() === 0 && g.canRefresh() && g.refresh() === true && g.getRefreshLeft() === CD);
  check('R', '冷卻不倒數過頭：冷卻 0 時丟注仍是 0（不變負數）', (() => { const x = mkGame({ rng: EV.rng(1), wallet: 1e6 }); x.bet(0); x.ack(); x.bet(1); x.ack(); return x.getRefreshLeft() === 0; })());
  check('R', '失敗的下注（餘額不足）不倒數冷卻', (() => { const x = mkGame({ rng: EV.rng(1), wallet: 100 }); x.refresh(); x.bet(0); x.ack(); const l = x.getRefreshLeft(); const w = x.getWallet(); const ok2 = x.bet(1) === false && x.getWallet() === w; return l === CD - 1 && (x.getWallet() < 100 ? ok2 && x.getRefreshLeft() === l : true); })());
  /* 演出中不可刷新 */
  const gp = mkGame({ rng: EV.rng(3), wallet: 1e6 }); gp.bet(0);
  const bp = gp.getBoard();
  check('R', '演出中不可刷新：回 false、code phase、盤面不動、canRefresh false', gp.refresh() === false && gp.getLastError().code === 'phase' && sameBoard(gp.getBoard(), bp) && gp.canRefresh() === false && gp.getRefreshLeft() === 0);
  gp.ack();
  /* 枚數與寶物顆數不變、合法（含有寶物的盤面、很滿的盤面） */
  const sg = memStore({ [KEY]: craftSave({ board: gemBoard() }) }); const gg = mkGame({ storage: sg, boardRng: EV.rng(8) });
  let okG = true;
  for(let i = 0; i < 60; i++){
    gg.setRefreshLeft(0);
    const b0 = gg.getBoard(); gg.refresh(); const b1 = gg.getBoard();
    if(piecesOf(b1) !== piecesOf(b0) || J(gemsOf(b1)) !== J(gemsOf(b0)) || !EV.isLegal(b1) || b1.g.some((a, j) => a.length > b1.h[j])) { okG = false; break; }
    gg.getBoard();
    if(i === 0) gg.refresh();                                   // 冷卻中再刷一次：被擋
  }
  check('R', '有寶物的盤面連刷 60 次：枚數相同、寶物種類與顆數相同（2 鑽 1 冠）、合法、寶物只放在有幣的格子', okG && gemsOf(gg.getBoard()).diamond === 2 && gemsOf(gg.getBoard()).crown === 1);
  const sfull = memStore({ [KEY]: craftSave({ board: fullBoard() }) }); const gfu = mkGame({ storage: sfull, boardRng: EV.rng(2) });
  gfu.refresh();
  check('R', '每格 3 枚的滿盤面刷新：仍是 75 枚、合法', piecesOf(gfu.getBoard()) === 75 && EV.isLegal(gfu.getBoard()));
  /* 不合法盤面（理論上不會發生）：刷新被擋且不動冷卻 */
  const sx = memStore({ [KEY]: craftSave({ board: (() => { const b = EV.emptyBoard(); b.h[0] = 1; return b; })() }) }); const gx = mkGame({ storage: sx });
  const bx = gx.getBoard();
  check('R', '盤面不合法（不是穩定循環盤面）時刷新被擋：回 false、code board、盤面與冷卻不動', gx.refresh() === false && gx.getLastError().code === 'board' && sameBoard(gx.getBoard(), bx) && gx.getRefreshLeft() === 0);
  /* 亂數：用 boardRng；可重現 */
  const mkRun = (br) => { const x = mkGame({ rng: EV.rng(1), boardRng: br }); x.refresh(); return x.getBoard(); };
  check('R', '刷新用 boardRng：同一串 boardRng 同結果、不同串結果不同；刷新不消耗抽獎 rng', sameBoard(mkRun(EV.rng(6)), mkRun(EV.rng(6))) && !sameBoard(mkRun(EV.rng(6)), mkRun(EV.rng(7))) && (() => { let c = 0; const x = mkGame({ rng: () => { c++; return 0.5; } }); x.refresh(); return c === 0; })());
  check('R', '有注入 rng 但沒給 boardRng：盤面那一串用固定種子，兩個同設定的遊戲刷新結果相同（可重現）', (() => { const a = mkGame({ rng: EV.rng(1) }); const b = mkGame({ rng: EV.rng(999) }); a.refresh(); b.refresh(); return sameBoard(a.getBoard(), b.getBoard()); })());
  check('R', 'setBoardRng／getBoardRng 可換盤面那一串亂數', (() => { const x = mkGame({ rng: EV.rng(1) }); const f = EV.rng(3); x.setBoardRng(f); return x.getBoardRng() === f && typeof x.getRng() === 'function' && x.getRng() !== f; })());
  /* 重整後冷卻保留 */
  const s2 = memStore(); const g2 = mkGame({ storage: s2, rng: EV.rng(5), wallet: 1e6 }); g2.refresh(); g2.bet(0); g2.ack(); g2.bet(1); g2.ack();
  const g3 = mkGame({ storage: s2 });
  check('R', '冷卻剩餘注數跟著存檔（刷新後丟 2 注＝剩 8，重整後仍是 8）、盤面同', g3.getRefreshLeft() === CD - 2 && sameBoard(g3.getBoard(), g2.getBoard()) && JSON.parse(s2.getItem(KEY)).refreshLeft === CD - 2);
}

/* ---------- E 重置 ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(21) });
  g.addMoney(1e6);                                              // 預設起始錢包 10,000，先加錢才玩得夠；重置要回 10,000
  const log = evCollector(g);
  for(let i = 0; i < 6; i++){ g.bet((i * 7) % 25); g.ack(); }
  g.setDenom(1);
  for(let i = 0; i < 4; i++){ g.bet((i * 5 + 1) % 25); g.ack(); }
  g.refresh(); g.setMeter(5); g.setPot(2 * ADDS[1]);
  g.addMoney(12345);
  check('E', '重置前確實玩過（盤面不是起始盤面、能量條不是起始值、有獎池、冷卻在跑、金額不是預設、有注單、錢包不是 10,000）', !sameBoard(g.getBoard(), START()) && g.getMeter() !== MS && g.getPot() > 0 && g.getRefreshLeft() > 0 && g.getDenomIndex() === 1 && g.getRecords().length === 10 && g.getWallet() !== 10000);
  g.bet(0);
  check('E', '演出中不可重置', g.clearSaved() === false && g.getLastError().code === 'phase');
  g.ack();
  const ok = g.clearSaved();
  check('E', '重置：錢包 10,000、注單清空、金額回預設、發出 reset 事件（帶 meter／pot／refreshLeft）', ok && g.getWallet() === 10000 && g.getRecords().length === 0 && g.getDenomIndex() === EV.CFG.DENOM_DEFAULT && log.some(e => e.type === 'reset' && e.data.meter === MS && e.data.pot === 0 && e.data.refreshLeft === 0 && !e.data.walletOnly));
  check('E', '重置：獎池歸零、冷卻 0（立刻可刷）、getState().pot 也是 0', g.getPot() === 0 && g.getState().pot === 0 && g.getRefreshLeft() === 0 && g.canRefresh());
  check('E', `重置：能量條回起始值 ${MS}（新玩家預充）`, g.getMeter() === MS && g.getState().meter === MS);
  check('E', '重置：盤面逐格＝起始盤面（含發光格旗標）', sameBoard(g.getBoard(), START()) && g.isFresh() && g.glowCell() === EV.bestCell(START()));
  const g2 = mkGame({ storage: store });
  check('E', '重置後重整仍是重置後的狀態（含能量條、獎池、冷卻）', g2.getWallet() === 10000 && sameBoard(g2.getBoard(), START()) && g2.getMeter() === MS && g2.getPot() === 0 && g2.getRefreshLeft() === 0);
  g.bet(3); g.ack();
  check('E', '重置後流水號從頭、可繼續玩、能量條從起始值走、獎池從 0 存起（這一注存的、或被拿走）', g.getState().seq === 1 && g.getRecords().length === 1 && g.getMeter() === MS + 1 && (g.getPot() === ADDS[0] || g.getRecords()[0].potWin === ADDS[0]));
}

/* ---------- E2 重置錢包（只補錢，盤面與能量條不動；2026-11-26 用戶裁決） ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(22) });
  g.setDenom(1);
  for(let i = 0; i < 7; i++){ g.bet((i * 5 + 1) % 25); g.ack(); }
  g.refresh(); g.setPot(9 * ADDS[1]);
  g.bet(4);
  check('E2', '演出中不可重置錢包', g.resetWallet() === false && g.getLastError().code === 'phase');
  g.ack();
  const b2 = { board: J(g.getBoard()), meter: g.getMeter(), fresh: g.isFresh(), denom: g.getDenomIndex(), seq: g.getState().seq, pot: g.getPot(), left: g.getRefreshLeft() };
  const log = evCollector(g);
  const ok = g.resetWallet();
  check('E2', '重置錢包：錢包回 10,000、注單清空、reset 事件帶 walletOnly', ok && g.getWallet() === 10000 && g.getRecords().length === 0 && log.some(e => e.type === 'reset' && e.data.walletOnly === true));
  check('E2', '重置錢包：獎池不動（重置前確實有獎池）', g.getPot() === b2.pot && b2.pot > 0);
  check('E2', '重置錢包：盤面逐格不變、能量條不變、冷卻不變、「丟過沒」旗標不變、金額不變', J(g.getBoard()) === b2.board && g.getMeter() === b2.meter && g.getRefreshLeft() === b2.left && g.isFresh() === b2.fresh && g.getDenomIndex() === b2.denom && b2.left > 0);
  check('E2', '重置錢包前確實玩過（盤面不是起始盤面）', b2.board !== J(START()));
  const g2 = mkGame({ storage: store, rng: EV.rng(23) });
  check('E2', '重置錢包後重整：錢包 10,000、盤面、能量條、獎池、冷卻仍是重置前的', g2.getWallet() === 10000 && J(g2.getBoard()) === b2.board && g2.getMeter() === b2.meter && g2.getPot() === b2.pot && g2.getRefreshLeft() === b2.left);
  g.bet(6); g.ack();
  check('E2', '重置錢包後可繼續玩、能量條接著走', g.getRecords().length === 1 && g.getMeter() === b2.meter + 1);
}

/* ---------- F 同一 rng 序列重跑相同；刷新與換金額不影響之後抽到的幣種序列 ---------- */
{
  function run(seed){
    const g = mkGame({ storage: false, rng: EV.rng(seed), wallet: 1e9 }); const pr = EV.rng(8), out = [];
    g.on((t, d) => { if(t === 'result') out.push(d.result); });
    for(let n = 0; n < 2000; n++){
      if(n % 500 === 499) g.setDenom((g.getDenomIndex() + 1) % ND);
      if(n % 13 === 0 && g.canRefresh()) g.refresh();
      g.bet(Math.floor(pr() * 25)); g.ack();
    }
    return { out: J(out), wallet: g.getWallet(), board: J(g.getBoard()), recs: J(g.getRecords()), meter: g.getMeter(), pot: g.getPot(), left: g.getRefreshLeft(), nRain: out.filter(r => r.hasRain).length, nPot: out.filter(r => r.potWin > 0).length };
  }
  const a = run(31337), b = run(31337), c = run(31338);
  check('F', '同 rng 序列（含 now 固定、含換金額與刷新）重跑兩次：每注完整結果（含金幣雨）、錢包、盤面、能量條、獎池、冷卻、注單逐字相同', a.out === b.out && a.wallet === b.wallet && a.board === b.board && a.recs === b.recs && a.meter === b.meter && a.pot === b.pot && a.left === b.left && a.nRain > 0 && a.nPot > a.nRain);
  check('F', '換一個 rng 種子結果不同（確認測試不是空轉）', a.out !== c.out);
  function kinds(withActions){
    const g = mkGame({ storage: false, rng: EV.rng(555), wallet: 1e9 }); const pr = EV.rng(4), out = [];
    g.on((t, d) => { if(t === 'result') out.push(d.result.kind); });
    for(let n = 0; n < 1500; n++){
      if(withActions){
        if(n % 7 === 0 && g.canRefresh()) g.refresh();
        if(n % 50 === 25) g.setDenom((g.getDenomIndex() + 1) % ND);
      }
      g.bet(Math.floor(pr() * 25)); g.ack();
    }
    return out.join(',');
  }
  const kA = kinds(false), kB = kinds(true);
  check('F', '刷新與換金額「不會改變之後每一注抽到什麼幣」：同一個抽獎 rng，有／沒有刷新與換金額，1,500 注的幣種序列逐注相同（含鑽石與皇冠都有出現）', kA === kB && /diamond/.test(kA) && /crown|coin/.test(kA));
  let calls = 0; const counting = () => { calls++; return 0.9; };
  const g = mkGame({ rng: counting, wallet: 1e6 });
  g.bet(0); g.ack();
  check('F', '核心自己不抽號：一注只消耗 1 次 rng（EV.play 抽這枚是什麼）', calls === 1);
  calls = 0; g.setMeter(RE - 1); g.bet(1); g.ack();
  check('F', '金幣雨那一注也只消耗 1 次 rng（雨不抽）', calls === 1);
  calls = 0; g.refresh(); g.setDenom(2); g.setDenom(0); g.refresh();
  check('F', '刷新、換金額不消耗抽獎 rng', calls === 0);
}

/* ---------- G rng、能量條、獎池與冷卻注入（導演台） ---------- */
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
  check('G', 'armNext 多給的欄位被忽略：結果沒有 sky／hasSky／skyCell', res.r.kind === 'coin' && !('sky' in res.r) && !('hasSky' in res.r) && !('skyCell' in res.r));
  g.ack();
  let kinds = new Set(); for(let i = 0; i < 400; i++){ g.bet(i % 25); kinds.add(res.r.kind); g.ack(); }
  check('G', 'armNext 只管下一注，之後照原 rng（又出現普通幣）', kinds.has('coin'));
  g.armNext({ kind: 'diamond' }); g.setDenom(2); g.bet(0); const k1 = res.r.kind; g.ack();
  check('G', '指定的結果跟金額無關（鑽石在金額 1,000 一樣兌現 5 倍金額）', k1 === 'diamond' && res.r.stake === 1000);
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
  check('G', 'setMeter(30)：能量條變 30，發 meter 事件', gm.setMeter(30) === true && gm.getMeter() === 30 && log.some(e => e.type === 'meter' && e.data.meter === 30));
  check('G', 'setMeter(v)：超出範圍夾回 0～RAIN_EVERY−1、小數取整；多給的第二個參數（舊 di）忽略', gm.setMeter(RE + 56) === true && gm.getMeter() === RE - 1 && gm.setMeter(-5) === true && gm.getMeter() === 0 && gm.setMeter(10.9) === true && gm.getMeter() === 10 && gm.setMeter(50, 2) === true && gm.getMeter() === 50);
  check('G', 'setMeter 不合法被擋：非數字 → meter，能量條不動', gm.setMeter('x') === false && gm.getLastError().code === 'meter' && gm.setMeter(NaN) === false && gm.getMeter() === 50);
  gm.setMeter(RE - 1);
  gm.bet(12);
  check('G', 'setMeter(RAIN_EVERY−1) 後下一注必下金幣雨，hasRain／meterBefore＝RAIN_EVERY−1／meterAfter 0', rm.r.hasRain === true && rm.r.meterBefore === RE - 1 && rm.r.meterAfter === 0 && rm.r.rain.coins === 25 && gm.getMeter() === 0);
  check('G', '演出中 setMeter 被擋、能量條不動', gm.setMeter(RE - 3) === false && gm.getLastError().code === 'phase' && gm.getMeter() === 0);
  gm.ack();
  gm.setMeter(RE - 2); gm.bet(3); const a1 = rm.r.hasRain; gm.ack(); gm.bet(4); const a2 = rm.r.hasRain; gm.ack();
  check('G', 'setMeter(RAIN_EVERY−2)：下一注不下雨（meterAfter＝RAIN_EVERY−1）、再下一注下雨', a1 === false && a2 === true);
  /* setPot */
  { const gp = mkGame({ storage: memStore(), rng: EV.rng(6), wallet: 1e6 }); const lg = evCollector(gp), rp = lastResult(gp);
    check('G', 'setPot(v)：獎池變 v（實付金額），發 pot 事件（帶 pot）', gp.setPot(3 * ADDS[0]) === true && gp.getPot() === 3 * ADDS[0] && gp.getState().pot === 3 * ADDS[0] && lg.some(e => e.type === 'pot' && e.data.pot === 3 * ADDS[0]));
    check('G', 'setPot(v)：超出範圍夾回 0～EV.potMax(目前金額)、小數取整、負數＝0；第二個參數（舊 di）忽略', gp.setPot(1e9) === true && gp.getPot() === EV.potMax(0) && gp.setPot(-5) === true && gp.getPot() === 0 && gp.setPot(40.9) === true && gp.getPot() === 40 && gp.setPot(7, 2) === true && gp.getPot() === 7);
    gp.setDenom(2);
    check('G', '換到金額 1,000 後上界用該金額的 EV.potMax', gp.setPot(1e9) === true && gp.getPot() === EV.potMax(2));
    gp.setDenom(0);
    check('G', 'setPot 不合法被擋：非數字／NaN → pot，不動原值', (() => { gp.setPot(40); return gp.setPot('x') === false && gp.getLastError().code === 'pot' && gp.setPot(NaN) === false && gp.getPot() === 40; })());
    gp.setPot(5 * ADDS[0]); gp.armNext({ kind: 'coin' }); gp.bet(0);
    check('G', '演出中 setPot 被擋、獎池不動', gp.setPot(1) === false && gp.getLastError().code === 'phase' && gp.getPot() === rp.r.potAfter);
    gp.ack();
    check('G', '導演台設的獎池下一注接著存（potBefore＝設的值）', rp.r.potBefore === 5 * ADDS[0] && rp.r.potAdd === ADDS[0]);
    check('G', 'settled 事件與注單 rec 帶 potWin', lg.some(e => e.type === 'settled' && e.data.potWin === rp.r.potWin && e.data.rec.potWin === rp.r.potWin) && gp.getRecords().slice(-1)[0].potWin === rp.r.potWin);
    const stp = memStore(); const gx = mkGame({ storage: stp }); gx.setPot(7 * ADDS[0]); const gy = mkGame({ storage: stp });
    check('G', '導演台設的獎池會存檔（重整保留）', gy.getPot() === 7 * ADDS[0]); }
  check('G', '導演台設的能量條會存檔（重整保留）', (() => { const st = memStore(); const x = mkGame({ storage: st }); x.setMeter(33); const y = mkGame({ storage: st }); return y.getMeter() === 33; })());
  /* setRefreshLeft */
  { const gc = mkGame({ storage: memStore(), rng: EV.rng(6), wallet: 1e6 }); const lg = evCollector(gc);
    gc.refresh();
    check('G', 'setRefreshLeft(0)：冷卻歸零（可立刻再刷），發 cooldown 事件', gc.setRefreshLeft(0) === true && gc.getRefreshLeft() === 0 && gc.canRefresh() && lg.some(e => e.type === 'cooldown' && e.data.refreshLeft === 0));
    check('G', 'setRefreshLeft：夾在 0～10、小數取整、非數字被擋（code refresh）', gc.setRefreshLeft(99) === true && gc.getRefreshLeft() === CD && gc.setRefreshLeft(-3) === true && gc.getRefreshLeft() === 0 && gc.setRefreshLeft(3.7) === true && gc.getRefreshLeft() === 3 && gc.setRefreshLeft('x') === false && gc.getLastError().code === 'refresh' && gc.getRefreshLeft() === 3);
    gc.bet(0);
    check('G', '演出中 setRefreshLeft 被擋', gc.setRefreshLeft(0) === false && gc.getLastError().code === 'phase');
    gc.ack();
    const st = memStore(); const x = mkGame({ storage: st }); x.setRefreshLeft(4); const y = mkGame({ storage: st });
    check('G', '導演台設的冷卻會存檔', y.getRefreshLeft() === 4); }
}

/* ---------- H 首次進場旗標 ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(77) });
  const c = g.glowCell();
  check('H', '新玩家的盤面「沒丟過」，發光格＝起始盤面最會爆的那格（疊 3 枚）', g.isFresh() && c >= 0 && c === EV.bestCell(START()) && g.getBoard().h[c] === EV.CFG.CAP - 1);
  check('H', 'getState 帶出 fresh／glow', g.getState().fresh === true && g.getState().glow === c);
  g.bet(c); g.ack();
  check('H', '丟過 isFresh＝false、glowCell＝-1', !g.isFresh() && g.glowCell() === -1);
  const g2 = mkGame({ storage: store });
  check('H', '重整後旗標保持', !g2.isFresh());
  g2.clearSaved();
  check('H', '重置後回到「沒丟過」', g2.isFresh() && g2.glowCell() >= 0);
  g2.setDenom(1);
  check('H', '換金額後的新盤面不算第一次進場：isFresh false、沒有發光格', !g2.isFresh() && g2.glowCell() === -1 && g2.getState().glow === -1);
  const g3 = mkGame({ storage: false }); g3.refresh();
  check('H', '刷新後也沒有發光格（那是起始盤面的設計）', !g3.isFresh() && g3.glowCell() === -1);
  check('H', '丟發光格＝第一下噴 4 枚（起始盤面條件）', (() => { const gg = mkGame({ rng: EV.scripted({ kind: 'coin' }, EV.rng(1)) }); const o = lastResult(gg); gg.bet(gg.glowCell()); return o.r.main.exitCount === EV.START_RULE.EXITS; })());
  check('H', '查詢回的是拷貝：改了不影響核心（盤面與 getState 的欄位）', (() => { const gg = mkGame({ storage: false }); const b = gg.getBoard(); b.h[0] = 3; b.g[0].push('crown'); const s = gg.getState(); s.board.h[1] = 3; s.pot = 999; s.meter = 1; s.denoms[0] = 5; return !sameBoard(b, gg.getBoard()) && sameBoard(gg.getBoard(), START()) && gg.getMeter() === MS && gg.getPot() === 0 && gg.getState().denoms[0] === 100; })());
}

/* ---------- I 一注結果的形狀（給 UI 與紀錄頁） ---------- */
{
  const g = mkGame({ rng: EV.rng(123), wallet: 1e7 }); const all = [];
  g.on((t, d) => { if(t === 'result') all.push(d); });
  for(let n = 0; n < 3000; n++){ if(n % 400 === 0 && n > 0) g.setDenom((g.getDenomIndex() + 1) % ND); g.bet((n * 7) % 25); g.ack(); }
  const KEYS = ['orderId', 'ts', 'denomIndex', 'stake', 'cell', 'kind', 'main', 'rain', 'hasRain', 'meterBefore', 'meterAfter', 'exits', 'enter', 'inValue', 'pay', 'topples', 'exitCount',
    'items', 'payout', 'mult', 'net', 'tier', 'quiet', 'boardBefore', 'boardAfter', 'potBefore', 'potAdd', 'potWin', 'potAfter', 'potBy', 'refreshLeft'];
  let bad = '';
  for(const e of all){
    const r = e.result;
    for(const k of KEYS) if(!(k in r)) bad = bad || '缺欄位 ' + k;
    for(const k of ['sky', 'hasSky', 'skyCell']) if(k in r) bad = bad || '不該有 v1 欄位 ' + k;
    if(r.stake !== EV.CFG.DENOMS[r.denomIndex]) bad = bad || 'stake≠金額';
    if(r.payout !== EV.cash(r, r.denomIndex) + r.potWin) bad = bad || 'payout≠EV.cash＋potWin';
    if(r.tier !== EV.tier(r, r.denomIndex, r.potWin)) bad = bad || 'tier≠EV.tier（含獎池）';
    if(r.potAdd !== EV.PAY[r.denomIndex].pot || r.potAfter !== (r.potWin > 0 ? 0 : r.potBefore + r.potAdd) || (r.potWin > 0 && r.potWin !== r.potBefore + r.potAdd)) bad = bad || '獎池欄位算術';
    if(r.potBy !== (r.main.topples >= PC ? 'chain' : (r.hasRain ? 'rain' : null)) || (r.potWin > 0) !== (r.potBy !== null)) bad = bad || 'potBy／potWin 與規則不符';
    if(!(r.potBefore >= 0 && r.potBefore <= EV.potMax(r.denomIndex) && r.potAfter >= 0 && r.potAfter <= EV.potMax(r.denomIndex) && Number.isInteger(r.potBefore) && Number.isInteger(r.potWin) && Number.isInteger(r.potAfter))) bad = bad || '獎池不是整數或超過上界';
    if(r.quiet && r.potWin !== 0) bad = bad || 'quiet 的注拿了獎池';
    if(!(Number.isInteger(r.refreshLeft) && r.refreshLeft >= 0 && r.refreshLeft <= CD)) bad = bad || 'refreshLeft';
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
    if(e.potWin !== r.potWin || e.potBefore !== r.potBefore || e.potAfter !== r.potAfter || e.potAdd !== r.potAdd || e.potBy !== r.potBy || e.refreshLeft !== r.refreshLeft) bad = bad || 'result 事件的獎池／冷卻欄位';
    if(r.cell < 0 || r.cell >= 25 || r.kind !== EV.rollKind(EV.uForKind(r.kind))) bad = bad || 'cell/kind';
    const cnt = r.items.reduce((o, x) => { o[x.kind]++; return o; }, { coin: 0, diamond: 0, crown: 0 });
    if(cnt.coin !== r.exits.coin || cnt.diamond !== r.exits.diamond || cnt.crown !== r.exits.crown) bad = bad || '清單種類數≠exits';
    if(JSON.parse(JSON.stringify(r)).payout !== r.payout) bad = bad || '不可序列化';
  }
  check('I', `3,000 注的結果物件欄位齊全、金額／分級／倍數／噴出清單（src main／rain）／分波／能量條／冷卻與 values.js 一致（${bad}）`, bad === '');
  const t = {}; all.forEach(e => { t[e.tier] = (t[e.tier] || 0) + 1; });
  check('I', '分級四種都出現過（none／back／big／huge），來源是 EV.tier：' + J(t), ['none', 'back', 'big', 'huge'].every(k => t[k] > 0));
  const nr = all.filter(e => e.result.hasRain).length;
  check('I', `有金幣雨的注（${nr}）：items 含 src:'rain'、雨那一注一定有拿回（免費 25 枚幣的錢）`, nr > 0 && all.filter(e => e.result.hasRain).every(e => e.result.items.some(x => x.src === 'rain') && e.result.pay > 0));
  check('I', '有 quiet（沒爆沒雨）的注，且 quiet 的注 payout＝0、items 空', all.some(e => e.result.quiet) && all.filter(e => e.result.quiet).every(e => e.result.payout === 0 && e.result.items.length === 0 && e.result.main.waves.length === 0));
  const rec = g.getRecords()[0], RK = ['orderId', 'ts', 'denomIndex', 'stake', 'cell', 'kind', 'hasRain', 'payout', 'net', 'mult', 'tier', 'win', 'potWin', 'exits', 'exitCount', 'topples'];
  check('I', '注單紀錄欄位齊全（hasRain）、不含分波與 v1 的 hasSky／skyCell（體積小）', RK.every(k => k in rec) && !('main' in rec) && !('boardBefore' in rec) && !('hasSky' in rec) && !('skyCell' in rec));
  const g2 = mkGame({ rng: EV.scripted({ kind: 'crown' }, EV.rng(1)), wallet: 1e6 });
  const cr = lastResult(g2);
  g2.setDenom(2); g2.setBoardRng(EV.rng(3));
  const sg = memStore({ [KEY]: craftSave({ denom: 2, fresh: true }) }); const g3 = mkGame({ storage: sg, rng: EV.scripted({ kind: 'crown' }, EV.rng(1)), wallet: 1e6 }); const cr3 = lastResult(g3);
  g3.bet(g3.glowCell());
  check('I', '皇冠＋實付：皇冠被擠出的那枚金額＝50×金額，tier huge（若有噴出）或 none', cr3.r.items.filter(x => x.kind === 'crown').every(x => x.amount === 50000) && (cr3.r.exits.crown > 0 ? cr3.r.tier === 'huge' : true));
  check('I', '進行中一單可由 getPending／getState().st 查到同一份結果', g3.getPending() === g3.getState().st || J(g3.getPending()) === J(cr3.r));
}

/* ---------- J 壞檔、舊版存檔與契約 ---------- */
{
  const sb = [EV.startBoard(0), EV.startBoard(1), EV.startBoard(2)];
  const v2full = J({ v: 2, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, records: [], pending: null });
  const v3full = J({ v: 3, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, meters: [60, 60, 60], records: [], pending: null });
  const v4full = J({ v: 4, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, meters: [30, 30, 30], records: [], pending: null });
  const v5full = J({ v: 5, wallet: 123, seq: 5, denom: 1, fresh: [false, false, false], boards: sb, meters: [30, 30, 30], pots: [0, 150, 0], records: [], pending: null });   // v2.3～v3 之前（每金額一張盤面）寫的完整存檔
  const bads = { 垃圾: 'not json{', 舊版v1: J({ v: 1, wallet: 123, seq: 1, records: [], pending: null }), 舊版v2完整存檔: v2full, 舊版v3完整存檔: v3full, 舊版v4完整存檔: v4full, 舊版v5完整存檔: v5full, 空物件: '{}',
                 錢包壞: J({ v: SAVE_V, wallet: 'x', board: START() }), 缺盤面: J({ v: SAVE_V, wallet: 5, seq: 0, denom: 0, fresh: false, meter: 3, pot: 0, refreshLeft: 0, records: [], pending: null }) };
  for(const [name, raw] of Object.entries(bads)){
    const g = mkGame({ storage: memStore({ [KEY]: raw }) });
    check('J', `壞檔／舊版「${name}」：不報錯、忽略、以新玩家狀態開局（錢包 10,000、起始盤面、能量條 ${MS}、冷卻 0、金額預設、沒丟過）`,
      g.getWallet() === 10000 && sameBoard(START(), g.getBoard()) && g.isFresh() && g.getMeter() === MS && g.getPot() === 0 && g.getRefreshLeft() === 0 && g.getDenomIndex() === EV.CFG.DENOM_DEFAULT && g.getRecords().length === 0 && g.getPending() === null);
  }
  { const st = memStore({ [KEY]: v5full }); const g = mkGame({ storage: st, rng: EV.rng(4) }); g.bet(0); g.ack();
    check('J', '舊版（v5）存檔被忽略後可正常下注，並覆寫成最新版存檔（v6：單一盤面欄位）', (() => { const d = JSON.parse(st.getItem(KEY)); return d.v === SAVE_V && !('boards' in d) && !('meters' in d) && !('pots' in d) && 'board' in d && 'meter' in d && 'pot' in d && 'refreshLeft' in d; })() && g.getRecords().length === 1 && g.getMeter() === MS + 1); }
  const s = memStore(); const g1 = mkGame({ storage: s, rng: EV.rng(2), wallet: 5000 }); g1.bet(0); g1.ack();
  check('J', `存檔 v＝${SAVE_V}、單一 board／meter／pot（整數）／refreshLeft`, (() => { const d = JSON.parse(s.getItem(KEY)); return d.v === SAVE_V && sameBoard(d.board, g1.getBoard()) && d.meter === g1.getMeter() && Number.isInteger(d.pot) && d.refreshLeft === 0 && typeof d.fresh === 'boolean'; })());
  const d = JSON.parse(s.getItem(KEY)); d.board = { h: [9], g: [] }; s.setItem(KEY, J(d));
  const g2 = mkGame({ storage: s });
  check('J', '盤面損壞：回到起始盤面（沒丟過），錢包、注單保留', sameBoard(g2.getBoard(), START()) && g2.isFresh() && g2.getWallet() === g1.getWallet() && g2.getRecords().length === 1);
  const d2 = JSON.parse(s.getItem(KEY)); d2.board = g1.getBoard(); d2.meter = RE + 956; s.setItem(KEY, J(d2));
  const g2b = mkGame({ storage: s });
  check('J', '能量條損壞（超範圍）：回起始值、盤面保留', g2b.getMeter() === MS && sameBoard(g2b.getBoard(), g1.getBoard()));
  { const dp = JSON.parse(s.getItem(KEY)); dp.meter = 20; dp.pot = 3 * ADDS[0]; s.setItem(KEY, J(dp));
    const gpa = mkGame({ storage: s });
    check('J', '好的存檔：能量條、獎池、盤面原樣保留', gpa.getMeter() === 20 && gpa.getPot() === 3 * ADDS[0] && sameBoard(gpa.getBoard(), g1.getBoard()));
    for(const bad of [-4, 1.5, 'x', EV.potMax(0) + 1, null]){
      dp.pot = bad; s.setItem(KEY, J(dp));
      const x = mkGame({ storage: s });
      check('J', `獎池損壞（${J(bad)}）：回 0，其他保留`, x.getPot() === 0 && x.getMeter() === 20 && x.getWallet() === g1.getWallet());
    }
    dp.pot = 3 * ADDS[0]; for(const bad of [-1, CD + 1, 2.5, 'x', null]){
      dp.refreshLeft = bad; s.setItem(KEY, J(dp));
      const x = mkGame({ storage: s });
      check('J', `冷卻損壞（${J(bad)}）：回 0，其他保留`, x.getRefreshLeft() === 0 && x.getPot() === 3 * ADDS[0]);
    }
    delete dp.pot; delete dp.refreshLeft; delete dp.meter; s.setItem(KEY, J(dp));
    check('J', '最新版存檔缺 pot／refreshLeft／meter：獎池 0、冷卻 0、能量條回起始值，其他保留', (() => { const x = mkGame({ storage: s }); return x.getPot() === 0 && x.getRefreshLeft() === 0 && x.getMeter() === MS && x.getWallet() === g1.getWallet() && sameBoard(x.getBoard(), g1.getBoard()); })()); }
  const g = mkGame({ rng: EV.rng(1), wallet: 1e6 });
  check('J', '非法格號被擋（-1、25、1.5、字串、undefined）不扣款', [-1, 25, 1.5, '3', undefined, NaN].every(c => g.bet(c) === false && g.getLastError().code === 'cell') && g.getWallet() === 1e6 && g.getState().phase === 'BET' && g.getMeter() === MS);
  check('J', 'BET 階段 ack 被擋', g.ack() === false && g.getLastError().code === 'phase');
  g.bet(0);
  check('J', 'ANIM 階段不能再下注（上一單 ack 才能下一單）、不能加錢', g.bet(1) === false && g.getLastError().code === 'phase' && g.addMoney(100) === false && g.getRecords().length === 0);
  g.ack();
  check('J', 'ack 後才可下一單', g.bet(1) === true);
  const gn = DemoCore.createGame({ storage: false }); gn.bet(0); gn.ack();
  check('J', '不給 rng／now 也能跑（預設 Math.random／Date.now）；刷新與換金額也能跑', gn.getRecords().length === 1 && gn.setDenom(1) === true && gn.refresh() === true);
  const noStore = DemoCore.createGame({ storage: false, rng: EV.rng(3) });
  check('J', 'storage:false 不碰任何儲存也能玩', noStore.bet(0) === true && noStore.ack() === true);
  check('J', '介面：沒有 v2 的每金額陣列欄位（getState 的 meters／pots）；舊函式簽名仍可呼叫（getBoard(di)／getMeter(di)／getPot(di)／isFresh(di)／glowCell(di) 忽略參數）', (() => { const x = mkGame(); const s = x.getState(); return !('meters' in s) && !('pots' in s) && sameBoard(x.getBoard(2), x.getBoard()) && x.getMeter(1) === x.getMeter() && x.getPot(2) === x.getPot() && x.isFresh(1) === x.isFresh() && x.glowCell(2) === x.glowCell(); })());
  const src = fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  check('J', 'core.js 零 DOM（無 window／document）、不自帶亂數（Math.random 只出現在預設 rng 那一處）',
    !/\b(window|document|navigator)\b/.test(code) && (code.match(/Math\.random/g) || []).length === 1);
  check('J', 'core.js 沒有硬編碼的機率／賠率／能量條長度／獎池數字（1/40、1/800、普通幣值、目前的能量條長度、COIN_PAY、SKY_P、CFG.POT_*、0.15 等只能出在 values.js；METER_START 讀 EV.DEMO_METER_START，其餘只有冷卻 REFRESH_COOLDOWN_BETS＝10 與存檔版本 SAVE_V）',
    !/(1\s*\/\s*(40|800|7)\b|COIN_PAY|SKY_P|DIAMOND|CROWN|CFG\.POT|\b0\.15\b)/.test(code) && !new RegExp('\\b(' + RE + '|' + String(EV.VALUE.coin).replace('.', '\\.') + ')\\b').test(code) && /var METER_START = EV\.DEMO_METER_START;/.test(code) && /var REFRESH_COOLDOWN_BETS = 10;/.test(code));
  check('J', 'core.js 不再有每金額各一份的結構（boards／meters／pots 陣列）', !/\b(boards|meters|pots)\b/.test(code));
}

/* ---------- K 凍結檔 md5（core.js、core-test.js 是本卡擁有的檔案，凍結清單由主對話更新，這裡跳過它們） ---------- */
{
  const SELF = ['game/js/core.js', 'game/test/core-test.js'];
  const lines = fs.readFileSync(path.join(ROOT, '..', 'reports', 'frozen.md5'), 'utf8').split(/\r?\n/).filter(Boolean);
  let all = true, bad = [], n = 0;
  for(const ln of lines){
    const m = ln.match(/^([0-9a-f]{32}) \*(.+)$/); if(!m) continue;
    if(SELF.includes(m[2])) continue;
    n++;
    const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, '..', m[2]))).digest('hex');
    if(h !== m[1]){ all = false; bad.push(m[2]); }
  }
  check('K', `frozen.md5 列出的凍結檔（扣掉 core.js／core-test.js 自己，共 ${n} 個）md5 全部一致` + (bad.length ? '：' + bad.join(',') : ''), all && n >= 6);
}

console.log(`\ncore-test：PASS ${nPass}／FAIL ${nFail}`);
process.exit(nFail ? 1 : 0);
