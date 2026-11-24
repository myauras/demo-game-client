/* 紀錄頁回歸探針（T03）。用法：
 *   node <kit>/tools/shot.mjs --root game --out reports/shots/T03-log --query dev=1 --probe game/test/probe-log.js --timeout 120000
 * 驗：L1 沒回本的局是灰色淨額、回本以上才金色（總覽與詳細頁）
 *     L2 詳細頁開著時有新紀錄進來，不跳到別筆、回報鈕狀態不被洗掉（未封頂）
 *     L3 封頂 50 筆後同上，即使那一筆已被擠出清單
 *     L4 真的開自動下注、詳細頁開著跑完，仍是同一筆
 *     L5 返回總覽後清單是最新的、封頂 50
 * 本檔內容是 async 函式本體；丟例外＝失敗。 */
const fails = [];
const ok = (name, cond, info) => { if (!cond) fails.push(name + (info ? '：' + JSON.stringify(info) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const body = () => document.querySelector('.lgm .lgb');
const oid = () => { const e = body().querySelector('.oid'); return e ? e.textContent : null; };
const big = () => body().querySelector('.ldh .big');
const now = Date.now();
const mk = (i, stake, pay) => ({ id: 'T' + i, ts: now + i * 1000, stake, pay, rows: [] });
const D = window.DEMO;

LogUI.clear();
/* L1 配色與數字 */
LogUI.push(mk(1, 100, 0));     // 沒拿到
LogUI.push(mk(2, 100, 23));    // 拿了但沒回本
LogUI.push(mk(3, 100, 100));   // 剛好回本
LogUI.push(mk(4, 100, 228));   // 有賺
LogUI.open();
const rows = [...body().querySelectorAll('.lrowi')].map(r => { const v = r.querySelector('.lv'); return { cls: v.className, txt: v.textContent.replace(/−/g, '-') }; });
// 最新在前：T4、T3、T2、T1
ok('L1 有賺＝金色 +128', /gold/.test(rows[0].cls) && /\+128/.test(rows[0].txt), rows[0]);
ok('L1 剛好回本＝金色 ±0（回本以上）', /gold/.test(rows[1].cls) && !/grey/.test(rows[1].cls) && /±0/.test(rows[1].txt), rows[1]);
ok('L1 拿了但沒回本＝灰色 -77', /grey/.test(rows[2].cls) && !/gold/.test(rows[2].cls) && /-77/.test(rows[2].txt), rows[2]);
ok('L1 沒拿到＝灰色 -100', /grey/.test(rows[3].cls) && /-100/.test(rows[3].txt), rows[3]);
LogUI.openDetail(2);           // T2
ok('L1 詳細頁沒回本＝灰色 -77', oid() === 'T2' && /grey/.test(big().className) && !/gold/.test(big().className) && /-77/.test(big().textContent.replace(/−/g, '-')), { oid: oid(), cls: big().className, txt: big().textContent });
LogUI.openDetail(1);           // T3 剛好回本
ok('L1 詳細頁回本＝金色', oid() === 'T3' && /gold/.test(big().className), { oid: oid(), cls: big().className });
LogUI.openDetail(2);

/* L2 未封頂：詳細頁開著時 push，不跳、回報鈕狀態保留 */
body().querySelector('.lreport').click();
const repTxt = body().querySelector('.lreport').textContent;
for (let i = 5; i <= 12; i++) LogUI.push(mk(i, 100, i * 10));
ok('L2 未封頂不跳', oid() === 'T2', { oid: oid() });
ok('L2 回報鈕狀態保留', body().querySelector('.lreport').disabled === true && body().querySelector('.lreport').textContent === repTxt);
ok('L2 筆數有更新', /12/.test(document.querySelector('.lgm .lgcount').textContent), document.querySelector('.lgm .lgcount').textContent);

/* L3 封頂後：T2 被擠出清單，詳細頁仍是 T2 */
for (let i = 13; i <= 70; i++) LogUI.push(mk(i, 100, 0));
ok('L3 封頂後不跳', oid() === 'T2', { oid: oid() });
ok('L3 清單封頂 50 且 T2 已不在', LogUI.list().length === 50 && !LogUI.has('T2'), { n: LogUI.list().length });
document.querySelector('.lgm .lgback').click();
ok('L5 返回總覽：50 列、最新在最上', body().querySelectorAll('.lrowi').length === 50 && LogUI.list()[0].id === 'T70');
await sleep(60);   // MutationObserver 補色點是微任務，等一下
ok('L5 總覽 50 列都補上路線色點位置（無路線資料的給預設色）', body().querySelectorAll('.lrowi .rdot').length === 50);

/* L4 真的自動下注：開著詳細頁跑 3 局 */
LogUI.close(); LogUI.clear();
await D.ui.play('mid', 100, { fast: true });
await sleep(300);
LogUI.openDetail(0);
const pinned = oid();
ok('L4 有釘住一筆真實注單', !!pinned && pinned !== 'T70', { pinned });
const rowsBefore = body().querySelectorAll('.kv').length;
Autobet.start({ choice: 'mid', stake: 100, rounds: 3, tp: 0, sl: 0 });
const t0 = Date.now();
while (Date.now() - t0 < 80000) { await sleep(300); if (LogUI.list().length >= 4 && !D.ui.busy()) break; }
await sleep(500);
ok('L4 自動下注跑了 3 局', LogUI.list().length === 4, { n: LogUI.list().length });
ok('L4 自動下注中詳細頁不跳', oid() === pinned, { pinned, now: oid() });
ok('L4 詳細頁內容沒被洗掉', body().querySelectorAll('.kv').length === rowsBefore, { before: rowsBefore, now: body().querySelectorAll('.kv').length });
LogUI.close();

if (fails.length) throw new Error('probe-log 失敗：' + fails.join('｜'));
return { ok: true, fails, checks: 16, pinned };
