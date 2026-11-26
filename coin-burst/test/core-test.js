/* =========================================================================
 * 爆金連鎖——核心（js/core.js）Node 無頭單元測試
 * 執行：node game/test/core-test.js    （零依賴；values.js 與 core.js 以 eval 載入，同 mc-test.js 的作法）
 * 對應任務卡 C01 驗收清單：
 *   A 連丟 10,000 注逐注對帳　B 餘額不足　C 下注後 ack 前重整　D 換面額盤面互不影響　E 重置
 *   F 同 rng 序列重跑相同　G rng 注入（armNext／setRng）　H 首次進場旗標　I 結果形狀　J 壞檔與契約　K 凍結檔 md5
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
const allBelowCap = (b) => b.h.every(x => x >= 0 && x < EV.CFG.CAP);
const sameBoard = (a, b) => J(a) === J(b);
const startBoards = () => Array.from({ length: ND }, (_, d) => EV.startBoard(d));
function mkGame(extra){ let t = 1700000000000; return DemoCore.createGame(Object.assign({ storage: false, now: () => t++ }, extra || {})); }
function evCollector(g){ const log = []; g.on((type, data) => log.push({ type, data })); return log; }

/* ---------- A 連丟 10,000 注（三個面額輪流、隨機落點），逐注對帳 ---------- */
{
  const BIG = 100000000, seed = 4242;
  const g = mkGame({ storage: memStore(), wallet: BIG, rng: EV.rng(seed) });
  const placeRng = EV.rng(99);                                  // 玩家挑格（與抽獎 rng 分開）
  const shadowRng = EV.rng(seed), shadow = startBoards();       // 影子：直接用 values.js 算，同一串 rng
  let wallet = BIG, bad = 0, badMsg = '', stakeSum = 0, backSum = 0, maxCell = 0, nSky = 0, nBig = 0;
  const lastAfter = [null, null, null];
  let res = null; g.on((t, d) => { if(t === 'result') res = d.result; });
  for(let n = 0; n < 10000; n++){
    const di = n % ND; g.setDenom(di);
    const stake = EV.CFG.DENOMS[di], cell = Math.floor(placeRng() * EV.N);
    const before = g.getBoard(di);
    res = null;
    const ok = g.bet(cell);
    const afterBet = g.getWallet();
    const ph = g.getState().phase;
    g.ack();
    const afterAck = g.getWallet();
    const sh = EV.play(shadow[di], cell, shadowRng);            // 影子結果
    const shPay = EV.cash(sh, di);
    let problem = '';
    if(!ok || !res) problem = '下注失敗';
    else if(afterBet !== wallet - stake) problem = '扣款不對';
    else if(ph !== 'ANIM') problem = '下注後不是 ANIM';
    else if(afterAck !== wallet - stake + res.payout) problem = '入帳不對';
    else if(res.payout !== shPay) problem = '拿回與 EV.cash 不同';
    else if(!sameBoard(res.boardAfter, shadow[di]) || !sameBoard(g.getBoard(di), shadow[di])) problem = '盤面與影子不同';
    else if(!sameBoard(res.boardBefore, before)) problem = 'boardBefore 不對';
    else if(lastAfter[di] && !sameBoard(lastAfter[di], before)) problem = '同面額上一注後的盤面與這注前不一致';
    else if(!allBelowCap(g.getBoard(di))) problem = '盤面有格 ≥4';
    else if(EV.total(res.boardAfter) !== EV.total(res.boardBefore) + (res.enter.coin + res.enter.diamond + res.enter.crown) - res.exitCount) problem = '枚數不守恆';
    else if(res.items.reduce((s, x) => s + x.amount, 0) !== res.payout) problem = '噴出清單金額加總≠拿回';
    if(problem && !bad){ bad++; badMsg = `第 ${n + 1} 注：${problem}`; } else if(problem) bad++;
    wallet = wallet - stake + (res ? res.payout : 0);
    lastAfter[di] = g.getBoard(di);
    stakeSum += stake; backSum += res ? res.payout : 0;
    if(res && res.hasSky) nSky++;
    if(res && (res.tier === 'big' || res.tier === 'huge')) nBig++;
  }
  check('A', '連丟 10,000 注（三面額輪流、隨機落點）逐注：扣款／入帳／盤面／清單加總／枚數守恆／與直接呼叫 EV.play 完全一致', bad === 0, badMsg);
  check('A', `錢包＝起始 − 投入 ＋ 拿回（投入 ${stakeSum}、拿回 ${backSum}）`, g.getWallet() === BIG - stakeSum + backSum);
  check('A', '10,000 注後三張盤面每格都 <4', Array.from({ length: ND }, (_, d) => allBelowCap(g.getBoard(d))).every(Boolean));
  check('A', `有天降（${nSky}）與大連爆以上（${nBig}）出現，測到了這些路徑`, nSky > 0 && nBig > 0);
  check('A', '注單流水封頂 200 筆、流水號累計 10,000', g.getRecords().length === 200 && g.getState().seq === 10000);
  const rc = g.getRecords();
  check('A', '注單號唯一、紀錄時間順序', new Set(rc.map(r => r.orderId)).size === rc.length && rc.every((r, i) => i === 0 || r.ts > rc[i - 1].ts));
}

/* ---------- B 餘額不足 ---------- */
{
  let consumed = 0; const rng = () => { consumed++; return 0.5; };
  const g = mkGame({ wallet: 50, rng });
  const log = evCollector(g), b0 = g.getBoard(), st0 = g.getState();
  const r = g.bet(12);
  check('B', '餘額 50 < 面額 100：bet 回 false、錯誤碼 funds', r === false && g.getLastError().code === 'funds' && log.some(e => e.type === 'error' && e.data.code === 'funds'));
  check('B', '錢包不變、盤面不變、仍可下注階段、沒消耗 rng、沒寫注單、盤面仍算「沒丟過」',
    g.getWallet() === 50 && sameBoard(g.getBoard(), b0) && g.getState().phase === 'BET' && consumed === 0 && g.getRecords().length === 0 && g.isFresh() === st0.fresh && g.canBet() === false);
  const g2 = mkGame({ wallet: 100, rng: EV.rng(1) });
  check('B', '餘額剛好等於面額可以下注（扣到 0）', g2.bet(12) === true && g2.getWallet() === 0 && (g2.ack(), g2.getWallet() === g2.getRecords()[0].payout));
  const g3 = mkGame({ wallet: 600, rng: EV.rng(1) });
  g3.setDenom(2); const b3 = g3.getBoard();
  check('B', '餘額 600 選面額 1,000 不能下', g3.bet(0) === false && g3.getWallet() === 600 && sameBoard(g3.getBoard(), b3));
  g3.setDenom(1);
  check('B', '同一個錢包改選 500 就可以', g3.bet(0) === true);
}

/* ---------- C 下注後、ack 前重整 ---------- */
{
  const store = memStore(), key = DEMO_KEY + '.core';
  const g1 = mkGame({ storage: store, rng: EV.scripted({ kind: 'diamond', sky: 12 }, EV.rng(7)) });
  g1.setDenom(1);
  const w0 = g1.getWallet(), stake = 500;
  let res = null; g1.on((t, d) => { if(t === 'result') res = d.result; });
  g1.bet(6);                                                    // 6＝(1,1)；鑽石＋天降 12
  check('C', '下注後 ack 前：錢包已扣、階段 ANIM、存檔裡有進行中一單', g1.getWallet() === w0 - stake && g1.getState().phase === 'ANIM' && !!JSON.parse(store.getItem(key)).pending);
  const g2 = mkGame({ storage: store, rng: () => { throw new Error('接回時不得抽獎'); } });
  const rec = g2.getRestored();
  check('C', '重新載入後：錢包已入帳（起始 − 注額 ＋ 拿回）、階段回到 BET', g2.getWallet() === w0 - stake + res.payout && g2.getState().phase === 'BET');
  check('C', '重新載入後：盤面＝算完的盤面（逐格同 boardAfter）、面額保持', sameBoard(g2.getBoard(1), res.boardAfter) && g2.getDenomIndex() === 1);
  check('C', '重新載入後：注單多 1 筆且就是那一注（restored 旗標、內容同結果）',
    g2.getRecords().length === 1 && !!rec && g2.getRecords()[0].orderId === res.orderId && g2.getRecords()[0].payout === res.payout && g2.getPending() === null);
  const g3 = mkGame({ storage: store });
  check('C', '再重整一次：不重複入帳、注單不重複', g3.getWallet() === g2.getWallet() && g3.getRecords().length === 1 && g3.getRestored() === null);
  check('C', '重整後 ack 不會誤入帳（非演出結算點）', g3.ack() === false && g3.getWallet() === g2.getWallet());
  const g4 = mkGame({ storage: store, rng: EV.rng(5) });
  check('C', '接回後可以繼續下注、注單號接續（流水號不撞）', g4.bet(0) === true && (g4.ack(), g4.getRecords().length === 2 && g4.getRecords()[0].orderId !== g4.getRecords()[1].orderId));
  const gA = mkGame({ storage: memStore(), rng: EV.rng(3) }); gA.bet(0); gA.ack();
  const stA = gA.getState();
  const store2 = memStore(); const gB = mkGame({ storage: store2, rng: EV.rng(3) }); gB.bet(0); gB.ack();
  const gC = mkGame({ storage: store2 });
  check('C', 'ack 之後重整：狀態與重整前完全相同', gC.getWallet() === gB.getWallet() && J(gC.getRecords()) === J(gB.getRecords()) && sameBoard(gC.getBoard(), gB.getBoard()) && stA.wallet === gC.getWallet());
  const s5 = memStore(); const gD = mkGame({ storage: s5 }); const gE = mkGame({ storage: s5 });
  check('C', '沒下注就重整：三張盤面仍是起始盤面', startBoards().every((b, d) => sameBoard(b, gE.getBoard(d))) && sameBoard(gD.getBoard(), gE.getBoard()));
}

/* ---------- D 換面額，盤面互不影響 ---------- */
{
  const g = mkGame({ storage: memStore(), rng: EV.rng(11), wallet: 1e9 });
  const cells = [3, 7, 12, 18, 24, 0, 11], snap = [];
  let ok = true, why = '';
  g.setDenom(0); for(let i = 0; i < 7; i++){ g.bet(cells[i]); g.ack(); }
  snap[0] = g.getBoard(0);
  const startedOthers = [sameBoard(g.getBoard(1), EV.startBoard(1)), sameBoard(g.getBoard(2), EV.startBoard(2))];
  check('D', '只丟面額 100：另外兩張盤面仍是起始盤面', startedOthers.every(Boolean));
  g.setDenom(1); for(let i = 0; i < 5; i++){ g.bet(cells[i]); g.ack(); if(!sameBoard(g.getBoard(0), snap[0])){ ok = false; why = '丟 500 動到 100 的盤面'; } }
  snap[1] = g.getBoard(1);
  g.setDenom(2); for(let i = 0; i < 6; i++){ g.bet(cells[(i + 2) % 7]); g.ack(); if(!sameBoard(g.getBoard(0), snap[0]) || !sameBoard(g.getBoard(1), snap[1])){ ok = false; why = '丟 1,000 動到別張盤面'; } }
  check('D', '輪流丟三個面額：每丟一注，另外兩張盤面逐格不變', ok, why);
  g.setDenom(0);
  check('D', '換回面額 100：原本那張盤面逐格不變、getBoard() 預設就是它', sameBoard(g.getBoard(), snap[0]) && sameBoard(g.getBoard(0), snap[0]));
  check('D', '三張盤面互不相同（各丟各的）', J(snap[0]) !== J(snap[1]));
  check('D', '換面額只改目前面額，不動錢包', (() => { const w = g.getWallet(); g.setDenom(1); g.setDenom(2); g.setDenom(0); return g.getWallet() === w; })());
  g.bet(1);
  check('D', '演出中不可換面額、不動盤面', g.setDenom(1) === false && g.getLastError().code === 'phase' && g.getDenomIndex() === 0);
  g.ack();
  check('D', '不合法面額索引被擋', g.setDenom(3) === false && g.setDenom(-1) === false && g.setDenom(0.5) === false && g.getDenomIndex() === 0);
  const store = memStore(); const gs = mkGame({ storage: store, rng: EV.rng(2), wallet: 1e6 });
  gs.setDenom(2); gs.bet(5); gs.ack(); gs.setDenom(1);
  const gr = mkGame({ storage: store });
  check('D', '重整後面額與三張盤面都保持', gr.getDenomIndex() === 1 && [0, 1, 2].every(d => sameBoard(gr.getBoard(d), gs.getBoard(d))));
}

/* ---------- E 重置 ---------- */
{
  const store = memStore(); const g = mkGame({ storage: store, rng: EV.rng(21) });
  g.addMoney(1e6);                                              // 預設起始錢包 10,000，先加錢才玩得夠；重置要回 10,000
  const log = evCollector(g);
  for(let d = 0; d < ND; d++){ g.setDenom(d); for(let i = 0; i < 6; i++){ g.bet((i * 7 + d) % 25); g.ack(); } }
  g.addMoney(12345);
  check('E', '重置前確實玩過（盤面不是起始盤面、有注單、錢包不是 10,000）', !sameBoard(g.getBoard(0), EV.startBoard(0)) && g.getRecords().length === 18 && g.getWallet() !== 10000);
  g.bet(0);
  check('E', '演出中不可重置', g.clearSaved() === false && g.getLastError().code === 'phase');
  g.ack();
  const ok = g.clearSaved();
  check('E', '重置：錢包 10,000、注單清空、面額回預設、發出 reset 事件', ok && g.getWallet() === 10000 && g.getRecords().length === 0 && g.getDenomIndex() === EV.CFG.DENOM_DEFAULT && log.some(e => e.type === 'reset'));
  check('E', '重置：三張盤面逐格＝起始盤面（含發光格旗標）', startBoards().every((b, d) => sameBoard(b, g.getBoard(d)) && g.isFresh(d) && g.glowCell(d) === EV.bestCell(b)));
  const g2 = mkGame({ storage: store });
  check('E', '重置後重整仍是重置後的狀態', g2.getWallet() === 10000 && startBoards().every((b, d) => sameBoard(b, g2.getBoard(d))));
  g.bet(3); g.ack();
  check('E', '重置後流水號從頭、可繼續玩', g.getState().seq === 1 && g.getRecords().length === 1);
}

/* ---------- F 同一 rng 序列重跑相同 ---------- */
{
  function run(seed){
    const g = mkGame({ storage: false, rng: EV.rng(seed), wallet: 1e9 }); const pr = EV.rng(8), out = [];
    g.on((t, d) => { if(t === 'result') out.push(d.result); });
    for(let n = 0; n < 2000; n++){ g.setDenom(n % ND); g.bet(Math.floor(pr() * 25)); g.ack(); }
    return { out: J(out), wallet: g.getWallet(), boards: J([0, 1, 2].map(d => g.getBoard(d))), recs: J(g.getRecords()) };
  }
  const a = run(31337), b = run(31337), c = run(31338);
  check('F', '同 rng 序列（含 now 固定）重跑兩次：每注完整結果、錢包、盤面、注單逐字相同', a.out === b.out && a.wallet === b.wallet && a.boards === b.boards && a.recs === b.recs);
  check('F', '換一個 rng 種子結果不同（確認測試不是空轉）', a.out !== c.out);
  let calls = 0; const counting = () => { calls++; return 0.9; };
  const g = mkGame({ rng: counting, wallet: 1e6 });
  g.bet(0); g.ack();
  check('F', '核心自己不抽號：一注只消耗 EV.play 的 2 次（沒天降時）', calls === 2);
}

/* ---------- G rng 注入（導演台） ---------- */
{
  const g = mkGame({ storage: false, rng: EV.rng(5), wallet: 1e6 });
  let res = null; g.on((t, d) => { if(t === 'result') res = d.result; });
  g.armNext({ kind: 'diamond', sky: 12 }); g.bet(0);
  check('G', 'armNext 指定下一枚鑽石＋天降落 12', res.kind === 'diamond' && res.hasSky === true && res.skyCell === 12 && res.enter.diamond === 1);
  g.ack();
  g.armNext({ kind: 'crown', sky: false }); g.bet(1);
  check('G', 'armNext 指定皇冠、沒天降', res.kind === 'crown' && res.hasSky === false && res.skyCell === -1 && res.sky === null);
  g.ack();
  g.armNext({ kind: 'coin', sky: true }); g.bet(2);
  check('G', 'armNext 指定普通幣、有天降（落點照 rng）', res.kind === 'coin' && res.hasSky === true && res.skyCell >= 0 && res.skyCell < 25);
  g.ack();
  let kinds = new Set(); for(let i = 0; i < 400; i++){ g.bet(i % 25); kinds.add(res.kind); g.ack(); }
  check('G', 'armNext 只管下一注，之後照原 rng（又出現普通幣）', kinds.has('coin'));
  g.armNext({ kind: 'diamond' }); g.setDenom(2); g.bet(0); const k1 = res.kind; g.ack();
  check('G', '指定的結果跟面額無關（鑽石在面額 1,000 一樣兌現 5 倍面額）', k1 === 'diamond' && res.stake === 1000);
  { const mk = () => { const x = mkGame({ rng: EV.rng(9), wallet: 1e6 }); let rr; x.on((t, d) => { if(t === 'result') rr = d.result; }); return { x, get: () => rr }; };
    const p = mk(), q = mk(); p.x.armNext({ kind: 'crown' }); p.x.armNext(null); p.x.bet(3); q.x.bet(3);
    check('G', 'armNext(null) 取消指定（結果與沒指定的同 rng 相同）', J(p.get()) === J(q.get())); }
  const fixed = mkGame({ rng: EV.rng(1), wallet: 1e6 }); const seen = [];
  fixed.on((t, d) => { if(t === 'result') seen.push(d.result.kind); });
  fixed.setRng(() => EV.uForKind('crown')); fixed.bet(0); fixed.ack();
  check('G', 'setRng 換整串 rng 生效、getRng 取得目前的 rng', seen[0] === 'crown' && typeof fixed.getRng() === 'function');
  const blocked = mkGame({ rng: EV.rng(1), wallet: 50 }); blocked.armNext({ kind: 'crown' }); blocked.bet(0); blocked.setRng(EV.rng(1)); blocked.addMoney(500);
  let r2 = null; blocked.on((t, d) => { if(t === 'result') r2 = d.result; }); blocked.bet(0);
  check('G', '失敗的下注不消耗 armNext（餘額補足後的下一注才套用）', r2 && r2.kind === 'crown');
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
  check('H', '丟發光格＝第一下噴 4 枚（起始盤面條件）', (() => { const gg = mkGame({ rng: EV.scripted({ kind: 'coin', sky: false }, EV.rng(1)) }); let r; gg.on((t, d) => { if(t === 'result') r = d.result; }); gg.bet(gg.glowCell(0)); return r.main.exitCount === EV.START_RULE.EXITS; })());
  check('H', '查詢回的是拷貝：改了不影響核心', (() => { const b = g2.getBoard(0); b.h[0] = 3; b.g[0].push('crown'); return !sameBoard(b, g2.getBoard(0)) && sameBoard(g2.getBoard(0), EV.startBoard(0)); })());
}

/* ---------- I 一注結果的形狀（給 UI 與紀錄頁） ---------- */
{
  const g = mkGame({ rng: EV.rng(123), wallet: 1e7 }); const all = [];
  g.on((t, d) => { if(t === 'result') all.push(d); });
  for(let n = 0; n < 3000; n++){ g.setDenom(n % ND); g.bet((n * 7) % 25); g.ack(); }
  const KEYS = ['orderId', 'ts', 'denomIndex', 'stake', 'cell', 'kind', 'main', 'sky', 'hasSky', 'skyCell', 'exits', 'enter', 'inValue', 'pay', 'topples', 'exitCount',
    'items', 'payout', 'mult', 'net', 'tier', 'quiet', 'boardBefore', 'boardAfter'];
  let bad = '';
  for(const e of all){
    const r = e.result;
    for(const k of KEYS) if(!(k in r)) bad = bad || '缺欄位 ' + k;
    if(r.stake !== EV.CFG.DENOMS[r.denomIndex]) bad = bad || 'stake≠面額';
    if(r.payout !== EV.cash(r, r.denomIndex)) bad = bad || 'payout≠EV.cash';
    if(r.tier !== EV.tier(r)) bad = bad || 'tier≠EV.tier';
    if(Math.abs(r.mult * r.stake - r.payout) > 1e-6) bad = bad || 'mult×stake≠payout';
    if(r.net !== r.payout - r.stake) bad = bad || 'net';
    if(r.items.length !== r.exitCount) bad = bad || '噴出清單長度≠噴出枚數';
    if(r.items.reduce((s, x) => s + x.amount, 0) !== r.payout) bad = bad || '清單加總≠payout';
    if(r.hasSky !== (r.sky !== null) || (r.hasSky && r.skyCell !== r.sky.cell) || (!r.hasSky && r.skyCell !== -1)) bad = bad || '天降欄位';
    if(r.hasSky && r.sky.kind !== 'coin') bad = bad || '天降不是普通幣';
    if(r.quiet !== (r.topples === 0 && !r.sky)) bad = bad || 'quiet';
    if(r.main.waves.reduce((s, w) => s + w.cells.length, 0) !== r.main.topples) bad = bad || '分波格數≠連爆格數';
    if(r.main.waves.some(w => w.moves.length !== w.cells.length * 4)) bad = bad || '每格炸開應有 4 筆 moves';
    if(e.win !== (r.payout > 0) || e.payout !== r.payout || e.tier !== r.tier || e.cell !== r.cell) bad = bad || 'result 事件欄位';
    if(r.cell < 0 || r.cell >= 25 || r.kind !== EV.rollKind(EV.uForKind(r.kind))) bad = bad || 'cell/kind';
    const cnt = r.items.reduce((o, x) => { o[x.kind]++; return o; }, { coin: 0, diamond: 0, crown: 0 });
    if(cnt.coin !== r.exits.coin || cnt.diamond !== r.exits.diamond || cnt.crown !== r.exits.crown) bad = bad || '清單種類數≠exits';
    if(JSON.parse(JSON.stringify(r)).payout !== r.payout) bad = bad || '不可序列化';
  }
  check('I', `3,000 注的結果物件欄位齊全、金額／分級／倍數／噴出清單／分波與 values.js 一致（${bad}）`, bad === '');
  const t = {}; all.forEach(e => { t[e.tier] = (t[e.tier] || 0) + 1; });
  check('I', '分級四種都出現過（none／back／big／huge），來源是 EV.tier：' + J(t), ['none', 'back', 'big', 'huge'].every(k => t[k] > 0));
  check('I', '有 quiet（沒爆沒天降）的注，且 quiet 的注 payout＝0、items 空', all.some(e => e.result.quiet) && all.filter(e => e.result.quiet).every(e => e.result.payout === 0 && e.result.items.length === 0 && e.result.main.waves.length === 0));
  const rec = g.getRecords()[0], RK = ['orderId', 'ts', 'denomIndex', 'stake', 'cell', 'kind', 'hasSky', 'skyCell', 'payout', 'net', 'mult', 'tier', 'win', 'exits', 'exitCount', 'topples'];
  check('I', '注單紀錄欄位齊全且不含分波（體積小）', RK.every(k => k in rec) && !('main' in rec) && !('boardBefore' in rec));
  const g2 = mkGame({ rng: EV.scripted({ kind: 'crown', sky: false }, EV.rng(1)), wallet: 1e6 });
  let cr; g2.on((tt, d) => { if(tt === 'result') cr = d.result; });
  g2.setDenom(2); const gl = g2.glowCell(2); g2.bet(gl);
  check('I', '皇冠＋實付：皇冠被擠出的那枚金額＝50×面額，tier huge（若有噴出）或 none', cr.items.filter(x => x.kind === 'crown').every(x => x.amount === 50000) && (cr.exits.crown > 0 ? cr.tier === 'huge' : true));
  check('I', '進行中一單可由 getPending／getState().st 查到同一份結果', g2.getPending() === g2.getState().st || J(g2.getPending()) === J(cr));
}

/* ---------- J 壞檔與契約 ---------- */
{
  const key = DEMO_KEY + '.core';
  const bads = { 垃圾: 'not json{', 舊版: J({ v: 1, wallet: 123, seq: 1, records: [], pending: null }), 空物件: '{}', 錢包壞: J({ v: 2, wallet: 'x', boards: [] }) };
  for(const [name, raw] of Object.entries(bads)){
    const g = mkGame({ storage: memStore({ [key]: raw }) });
    check('J', `壞檔「${name}」：忽略、以初始狀態開局`, g.getWallet() === 10000 && startBoards().every((b, d) => sameBoard(b, g.getBoard(d))));
  }
  const s = memStore(); const g1 = mkGame({ storage: s, rng: EV.rng(2), wallet: 5000 }); g1.bet(0); g1.ack();
  const d = JSON.parse(s.getItem(key)); d.boards[1] = { h: [9], g: [] }; s.setItem(key, J(d));
  const g2 = mkGame({ storage: s });
  check('J', '單張盤面損壞：只有那張回到起始盤面，其他與錢包保留', sameBoard(g2.getBoard(1), EV.startBoard(1)) && sameBoard(g2.getBoard(0), g1.getBoard(0)) && g2.getWallet() === g1.getWallet());
  const g = mkGame({ rng: EV.rng(1), wallet: 1e6 });
  check('J', '非法格號被擋（-1、25、1.5、字串、undefined）不扣款', [-1, 25, 1.5, '3', undefined, NaN].every(c => g.bet(c) === false && g.getLastError().code === 'cell') && g.getWallet() === 1e6 && g.getState().phase === 'BET');
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
  check('J', 'core.js 零 DOM（無 window／document／localStorage 以外的 DOM 字）、不自帶亂數（Math.random 只出現在預設 rng 那一處）',
    !/\b(window|document|navigator)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')) && (src.match(/Math\.random/g) || []).length === 1);
  check('J', 'core.js 沒有硬編碼的機率／賠率數字（1/40、1/800、1/7、0.7 等只能出在 values.js）', !/(1\s*\/\s*(40|800|7)\b|0\.7\b|COIN_PAY|SKY_P|DIAMOND|CROWN)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
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
  check('K', `frozen.md5 列出的 ${lines.length} 個凍結檔 md5 全部一致` + (bad.length ? '：' + bad.join(',') : ''), all && lines.length >= 8);
}

console.log(`\ncore-test：PASS ${nPass}／FAIL ${nFail}`);
process.exit(nFail ? 1 : 0);
