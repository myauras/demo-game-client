// 探針（T02 主畫面與演出）：node D:\GameDemos\_skills\demo-kit\tools\shot.mjs --root game --out reports\shots\T02-probe --probe game\test\probe-t02.js --query dev=1 --timeout 120000
// （檔案內容是 async 函式本體，return 的 JSON 收進 checks.json）
// 1) 版位自查：300 張地圖 × 三條路，讀 DOM 量節點、門檻小標、結果小標：互蓋、蓋到別的節點、超出地圖區都要是 0（節點數 6～9 都涵蓋）。
// 2) 連玩 ≥ 20 局（三條路、含重打、撤退、走到底、大贏、大獎；前三局真的點分頁／注額／出發）：每局對帳
//    戰利品列加總＝拿回＝餘額變化；每一擲兩顆骰的朝上面＝結果物件、點數和小標＝結果；輸一次少一顆心；
//    心扣完後冒險者不再前進；結果小標最多留 2 個；回饋四級（沒回本不噴金幣不放大字、≥5 倍有大字、≥20 倍有覆蓋層）；
//    量每局時長、第一次擲與重打的時長；演出中分頁與出發不可點。
// 3) 點畫面加速：同一張圖同一組亂數演兩次，點畫面那次明顯較快。
// 4) 重整：未下注＝同一張圖同一個走向；演出中重整＝直接結算、新地圖、不重播。
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
const BR = el => el.getBoundingClientRect();
const ovl = (a, b, m = 0) => a.right > b.left + m && a.left < b.right - m && a.bottom > b.top + m && a.top < b.bottom - m;
const ui = DEMO.ui, game = DEMO.game;
const RIDS = ['safe', 'mid', 'risk'];
const out = { problems: [], geo: {}, games: [], notes: {} };
const bad = m => { if (out.problems.length < 80) out.problems.push(m); };
const walNow = () => parseInt($('wal').textContent.replace(/,/g, ''), 10);
const waitIdle = async ms => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!ui.busy()) return true; await sleep(50); } return false; };
const sum = a => a.reduce((x, y) => x + y, 0);

function faceUp(cube) {
  const m = new DOMMatrix(getComputedStyle(cube).transform);
  const N = { 1: [0, 0, 1], 6: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, -1, 0], 5: [0, 1, 0] };
  let best = 0, bz = 9;   // 朝上＝畫面座標 y 最小（CSS y 向下）；2026-11-24 修正：原本量的是朝向觀看者（+z）的面
  for (const k in N) { const p = m.transformPoint(new DOMPoint(N[k][0], N[k][1], N[k][2], 0)); if (p.y < bz) { bz = p.y; best = +k; } }
  return best;
}
const fullHearts = () => [...$('advh').querySelectorAll('i')].filter(i => i.querySelector('use').getAttribute('href') === '#ic-heart').length;

// ================= 1) 版位自查 =================
{
  const st0 = BR($('stage'));
  out.geo.stage = [Math.round(st0.width), Math.round(st0.height)];
  const cnt = { safe: {}, mid: {}, risk: {} }, picks = { sm1: 0, smLess: 0, cand0: 0, candOther: 0 }, minGap = { safe: 1e9, mid: 1e9, risk: 1e9 };
  let checked = 0, soft = 0, viol = 0;
  const t0 = performance.now();
  for (let seed = 1; seed <= 300; seed++) {
    game.devSetMap(seed);
    const map = game.getState().map;
    for (let r = 0; r < 3; r++) {
      ui.setRoute(RIDS[r]);
      if (ui.getRoute() !== RIDS[r]) { bad('setRoute 失敗 ' + RIDS[r]); continue; }
      const L = ui.layout(), n = map.routes[r].nodes.length;
      cnt[RIDS[r]][n] = (cnt[RIDS[r]][n] || 0) + 1;
      if (L.pick) { if (L.pick.sm === 1) picks.sm1++; else picks.smLess++; if (L.pick.cand === 0) picks.cand0++; else picks.candOther++; }
      if (L.viol.length) { viol++; bad('seed ' + seed + ' 路' + r + ' 內部自查：' + L.viol.slice(0, 2).join('、')); }
      checked++;
      const st = BR($('stage'));
      const nds = [...$('stage').querySelectorAll('.nd:not(.tent)')];
      const body = nds.map(x => BR(x.querySelector('.tok') || x.querySelector('.ico')));
      const badge = nds.map(x => x.querySelector('.bd') ? BR(x.querySelector('.bd')) : null);
      const chips = nds.map(x => x.querySelector('.cs') ? BR(x.querySelector('.cs')) : null);
      const tent = BR($('tent').firstChild.firstChild);
      const tag = 'seed ' + seed + ' 路' + r + '(' + n + '節點)';
      const inside = q => q.left >= st.left - .5 && q.right <= st.right + .5 && q.top >= st.top - .5 && q.bottom <= st.bottom + .5;
      for (let i = 0; i < nds.length; i++) {
        if (!inside(body[i])) bad(tag + ' 節點' + i + ' 超出地圖區');
        if (badge[i] && !inside(badge[i])) bad(tag + ' 節點' + i + ' 門檻小標超出地圖區');
        if (chips[i] && !inside(chips[i])) bad(tag + ' 節點' + i + ' 結果小標超出地圖區');
        if (ovl(body[i], tent, 2)) bad(tag + ' 節點' + i + ' 蓋到帳篷');
        if (i > 0) minGap[RIDS[r]] = Math.min(minGap[RIDS[r]], Math.hypot((body[i].left + body[i].right - body[i - 1].left - body[i - 1].right) / 2, (body[i].top + body[i].bottom - body[i - 1].top - body[i - 1].bottom) / 2));
        for (let j = 0; j < nds.length; j++) {
          if (i === j) continue;
          if (j > i && ovl(body[i], body[j], 2)) bad(tag + ' 節點' + i + '與' + j + ' 互蓋');
          if (badge[i] && ovl(badge[i], body[j], 1)) bad(tag + ' 門檻小標' + i + '蓋到節點' + j);
          if (chips[i] && ovl(chips[i], body[j], 1)) bad(tag + ' 結果小標' + i + '蓋到節點' + j);
          if (j > i && badge[i] && badge[j] && ovl(badge[i], badge[j], 1)) bad(tag + ' 門檻小標' + i + '與' + j + '互蓋');
        }
      }
      // 骰子落點（軟性）：兩顆骰＋點數和小標的框是否在地圖區內
      L.info.forEach(inf => { if (inf.land) { const cs = L.cs, fx = inf.land.x - cs - 4, fx2 = inf.land.x + cs + 4, fy = inf.land.y - cs / 2 - 30, fy2 = inf.land.y + cs / 2 + 6; if (fx < 0 || fy < 0 || fx2 > L.W || fy2 > L.H) soft++; } });
    }
  }
  out.geo.maps = 300; out.geo.layoutsChecked = checked; out.geo.internalViolations = viol; out.geo.nodeCounts = cnt; out.geo.picks = picks;
  out.geo.minConsecutiveGap = { safe: Math.round(minGap.safe), mid: Math.round(minGap.mid), risk: Math.round(minGap.risk) };
  out.geo.diceFootprintOutOfStage = soft; out.geo.ms = Math.round(performance.now() - t0);
  out.geo.problemsAfterGeo = out.problems.length;
  // 重新來一張乾淨地圖
  ui.setRoute('mid');
}

if (new URLSearchParams(location.search).get('part') === 'geo') { out.ok = out.problems.length === 0; return out; }   // --query "dev=1&part=geo"：只跑版位自查（換尺寸時用）

// ================= 2) 連玩 =================
const search = (ri, stake, pred) => {
  const map = game.getState().map;
  for (let i = 1; i < 400000; i++) { const r = DemoCore.simulate(map, ri, stake, EV.mulberry32(i)); if (pred(r)) return i; }
  return -1;
};
const hasRetry = r => r.fights.some((f, i) => i > 0 && !r.fights[i - 1].win && r.fights[i - 1].idx === f.idx);
const PLAN = [
  { name: '點分頁·穩/100（隨機）', r: 0, stake: 100, click: true },
  { name: '點分頁·中/500（隨機）', r: 1, stake: 500, click: true },
  { name: '點分頁·拚/1000（隨機）', r: 2, stake: 1000, click: true },
  { name: '穩 重打後過關', r: 0, stake: 100, pred: r => hasRetry(r) && r.reachedEnd },
  { name: '穩 連輸撤退(3顆心扣完)', r: 0, stake: 500, pred: r => !r.reachedEnd && r.heartsLeft === 0 && r.fights.filter(f => !f.win).length === 3 && r.prizes.length >= 1 },
  { name: '穩 走到底', r: 0, stake: 100, pred: r => r.reachedEnd },
  { name: '穩 重打＋撤退', r: 0, stake: 1000, pred: r => hasRetry(r) && !r.reachedEnd },
  { name: '中 重打後過關', r: 1, stake: 100, pred: r => hasRetry(r) && r.reachedEnd },
  { name: '中 重打＋撤退', r: 1, stake: 500, pred: r => hasRetry(r) && !r.reachedEnd },
  { name: '中 走到底(大贏)', r: 1, stake: 100, pred: r => r.reachedEnd && r.total >= 500 && r.total < 2000 },
  { name: '中 沒回本撤退', r: 1, stake: 1000, pred: r => !r.reachedEnd && r.total > 0 && r.total < 1000 },
  { name: '中 一個寶物都沒拿(撤退)', r: 1, stake: 100, pred: r => !r.reachedEnd && r.prizes.length === 0 },
  { name: '拚 開場就輸撤退', r: 2, stake: 100, pred: r => !r.reachedEnd && r.prizes.length === 0 },
  { name: '拚 拿到小寶物後輸', r: 2, stake: 500, pred: r => !r.reachedEnd && r.prizes.length >= 1 },
  { name: '拚 大獎(≥20倍)', r: 2, stake: 100, pred: r => r.total >= 2000 },
  { name: '拚 大獎(≥20倍)1000', r: 2, stake: 1000, pred: r => r.total >= 20000 },
  { name: '拚 回本以上(<5倍)', r: 2, stake: 100, pred: r => r.total >= 100 && r.total < 500 },
  { name: '中 大贏(5~20倍)', r: 1, stake: 500, pred: r => r.total >= 2500 && r.total < 10000 },
  { name: '穩 回本以上', r: 0, stake: 500, pred: r => r.total >= 500 && !hasRetry(r) },
  { name: '穩 走到底 1000', r: 0, stake: 1000, pred: r => r.reachedEnd },
  { name: '隨機 穩', r: 0, stake: 100, rnd: true }, { name: '隨機 中', r: 1, stake: 100, rnd: true }, { name: '隨機 拚', r: 2, stake: 100, rnd: true },
  { name: '隨機 穩', r: 0, stake: 500, rnd: true }, { name: '隨機 中', r: 1, stake: 500, rnd: true }, { name: '隨機 拚', r: 2, stake: 500, rnd: true },
  { name: '隨機 穩', r: 0, stake: 100, rnd: true }, { name: '隨機 中', r: 1, stake: 100, rnd: true }
];
await sleep(1800);
// 先清乾淨：重置錢包、換一張地圖
game.clearSaved();
await sleep(100);

for (const sp of PLAN) {
  if (walNow() < sp.stake) { game.addMoney(10000); await sleep(600); }
  const g = { name: sp.name, route: RIDS[sp.r], stake: sp.stake, errs: [] };
  const err = m => { g.errs.push(m); bad('[' + sp.name + '] ' + m); };
  // 指定結果：找一組亂數種子讓核心照真實流程抽到（不繞過核心）
  if (sp.pred) {
    const seed = search(sp.r, sp.stake, sp.pred);
    if (seed < 0) { err('找不到符合的亂數種子（略過）'); out.games.push(g); continue; }
    game.setRng(EV.mulberry32(seed)); g.seed = seed;
  } else if (sp.rnd) game.setRng(EV.mulberry32(Math.floor(Math.random() * 1e9)));
  const evs = [], dom = [];
  const offs = ['roundStart', 'roll', 'prize', 'retreat', 'roundEnd'].map(k => ui.on(k, d => {
    const rec = { k, d };
    if (k === 'roll') {
      const cubes = [...document.querySelectorAll('.dl .cube')];
      rec.faces = cubes.map(faceUp); rec.sumTxt = document.querySelector('.dsum').textContent.trim(); rec.pillVis = document.querySelector('.dsum').style.opacity;
      rec.cls = document.querySelector('.dl').className; rec.hearts = fullHearts();
    }
    if (k === 'retreat') { const a = BR($('adv')); rec.adv = { x: a.left + a.width / 2, y: a.top + a.height }; rec.hearts = fullHearts(); }
    if (k === 'roundEnd') { rec.advOp = getComputedStyle($('adv')).opacity; const a = BR($('adv')); rec.adv = { x: a.left + a.width / 2, y: a.top + a.height }; rec.hearts = fullHearts(); rec.chips = {}; document.querySelectorAll('#stage .nd .cs').forEach(cs => { rec.chips[cs.parentNode.id.slice(2)] = [...cs.querySelectorAll('.chip')].map(c => c.querySelector('b').textContent); }); }
    if (k === 'prize') rec.slots = document.querySelectorAll('.slot:not(.empty)').length;
    evs.push(rec);
  }));
  // 回饋觀察
  const seen = { fly: 0, bw: 0, ov: 0, coinsAfter: 0 };
  const mo = new MutationObserver(ms => { ms.forEach(m => { m.addedNodes.forEach(n => { if (n.classList) { if (n.classList.contains('fly')) seen.fly++; if (n.classList.contains('bw')) seen.bw++; } }); if (m.target.id === 'ov' && m.target.classList.contains('on')) seen.ov++; }); });
  mo.observe($('fx'), { childList: true }); mo.observe($('ov'), { attributes: true, attributeFilter: ['class'] });
  const bal0 = walNow(), core0 = game.getState().wallet;
  let promise, lockChecks = null;
  const t0 = Date.now();
  if (sp.click) {
    $('tabs').querySelector('.tab[data-i="' + sp.r + '"]').click(); await sleep(60);
    [...$('stakes').querySelectorAll('.bet')].find(b => +b.dataset.v === sp.stake).click(); await sleep(60);
    if ($('tabs').querySelector('.tab.on').dataset.i !== String(sp.r)) err('點分頁沒切過去');
    if (!$('stakes').querySelector('.bet.on') || +$('stakes').querySelector('.bet.on').dataset.v !== sp.stake) err('點注額沒切過去');
    const done = new Promise(res => { const o = ui.on('roundEnd', d => { o(); res(d); }); });
    $('goBtn').click();
    promise = done.then(d => d);
    await sleep(350);
    // 演出中：分頁與出發不可點
    const tabNow = $('tabs').querySelector('.tab.on').dataset.i;
    $('tabs').querySelector('.tab[data-i="' + ((sp.r + 1) % 3) + '"]').click();
    lockChecks = { tabLocked: $('tabs').querySelector('.tab.on').dataset.i === tabNow, busy: ui.busy(), goPE: getComputedStyle($('goBtn')).pointerEvents };
    const nTries = evs.filter(e => e.k === 'roundStart').length;
    $('goBtn').click();
    if (evs.filter(e => e.k === 'roundStart').length !== nTries) err('演出中點出發又開了一局');
    if (!lockChecks.tabLocked) err('演出中分頁可點');
    if (lockChecks.goPE !== 'none') err('演出中出發鈕沒鎖');
  } else {
    promise = ui.play(RIDS[sp.r], sp.stake);
    if (sp.name.indexOf('撤退') >= 0 && !g.lockedTested) { await sleep(300); lockChecks = { busy: ui.busy() }; try { ui.play('mid', 100).then(() => err('演出中 play 沒被擋'), () => {}); } catch (e) {} }
  }
  let ended;
  try { ended = await Promise.race([promise, sleep(40000).then(() => null)]); } catch (e) { err('play 失敗 ' + e.message); }
  if (!ended) { err('40 秒內沒演完'); mo.disconnect(); offs.forEach(f => f()); out.games.push(g); continue; }
  const rs = evs.find(e => e.k === 'roundStart'), re = evs.find(e => e.k === 'roundEnd');
  // sp.click 的 promise 是 roundEnd 的 data；ui.play 的 promise 是 payload，兩者都有 result／payout
  const R = re.d.result, payout = re.d.payout;
  await waitIdle(6000);
  const idleMs = Date.now() - t0;
  g.ms = idleMs; g.total = payout; g.x = +(payout / sp.stake).toFixed(2); g.grade = re.d.grade; g.nPrizes = R.prizes.length; g.nRolls = R.fights.length; g.reachedEnd = R.reachedEnd; g.heartsLeft = R.heartsLeft;
  g.retries = R.fights.filter((f, i) => i > 0 && !R.fights[i - 1].win && R.fights[i - 1].idx === f.idx).length;
  g.nodes = R.map.routes[R.routeIndex].nodes.length;
  // 對帳：戰利品列加總＝拿回＝餘額變化
  const slots = [...document.querySelectorAll('#slots .slot:not(.empty)')];
  const slotSum = sum(slots.map(s => +s.getAttribute('data-a')));
  const totTxt = parseInt($('tot').querySelector('b').textContent.replace(/,/g, ''), 10);
  const bal1 = walNow(), core1 = game.getState().wallet;
  g.slotSum = slotSum; g.totTxt = totTxt; g.balDelta = bal1 - bal0;
  if (slots.length !== R.prizes.length) err('戰利品格數 ' + slots.length + ' ≠ 收下寶物數 ' + R.prizes.length);
  if (slotSum !== payout) err('戰利品加總 ' + slotSum + ' ≠ 拿回 ' + payout);
  if (totTxt !== payout) err('拿回數字 ' + totTxt + ' ≠ ' + payout);
  if (bal1 - bal0 !== payout - sp.stake) err('畫面餘額變化 ' + (bal1 - bal0) + ' ≠ 拿回−注額 ' + (payout - sp.stake));
  if (core1 - core0 !== payout - sp.stake) err('核心餘額變化 ' + (core1 - core0) + ' ≠ ' + (payout - sp.stake));
  if (bal1 !== core1) err('畫面餘額 ' + bal1 + ' ≠ 核心 ' + core1);
  if (sum(R.prizes.map(p => p.amount)) !== payout) err('prizes 加總 ≠ 拿回');
  // 事件順序與骰子
  const rolls = evs.filter(e => e.k === 'roll'), prizes = evs.filter(e => e.k === 'prize'), ret = evs.filter(e => e.k === 'retreat');
  if (rolls.length !== R.fights.length) err('roll 事件數 ' + rolls.length + ' ≠ 擲骰數 ' + R.fights.length);
  if (prizes.length !== R.prizes.length) err('prize 事件數 ' + prizes.length + ' ≠ 寶物數 ' + R.prizes.length);
  let leftBefore = R.hearts;
  rolls.forEach((e, i) => {
    const f = R.fights[i], d = e.d;
    if (!f) return;
    if (d.dice[0] !== f.dice[0] || d.dice[1] !== f.dice[1] || d.win !== f.win || d.need !== f.need) err('第' + (i + 1) + '擲 事件與結果物件不符');
    if (e.faces[0] !== f.dice[0] || e.faces[1] !== f.dice[1]) err('第' + (i + 1) + '擲 骰子朝上面 ' + e.faces + ' ≠ 結果 ' + f.dice);
    if (e.sumTxt.replace(/\s/g, '') !== String(f.sum)) err('第' + (i + 1) + '擲 點數和小標 ' + e.sumTxt + ' ≠ ' + f.sum);
    if (+e.pillVis < .5) err('第' + (i + 1) + '擲 點數和小標沒顯示');
    if (e.cls.indexOf(f.win ? 'win' : 'lose') < 0) err('第' + (i + 1) + '擲 骰子顏色與輸贏不符');
    const exp = f.win ? leftBefore : leftBefore - 1;
    if (d.heartsLeft !== exp) err('第' + (i + 1) + '擲 輸一次沒少一顆心（剩 ' + d.heartsLeft + '，應 ' + exp + '）');
    leftBefore = exp;
    // 心條在「下一個事件」時要是 exp 顆
    const next = evs[evs.indexOf(e) + 1];
    if (next && next.hearts != null && next.hearts !== exp) err('第' + (i + 1) + '擲後 心條 ' + next.hearts + ' 顆 ≠ ' + exp);
  });
  if (re.hearts !== R.heartsLeft) err('結算時心條 ' + re.hearts + ' ≠ 剩 ' + R.heartsLeft);
  // 撤退：心扣完之後冒險者不再前進
  if (!R.reachedEnd) {
    if (ret.length !== 1) err('撤退事件數 ' + ret.length);
    else {
      const idxRet = evs.indexOf(ret[0]);
      if (evs.slice(idxRet + 1).some(e => e.k === 'roll' || e.k === 'prize')) err('撤退後還有 roll／prize');
      const dd = Math.hypot(re.adv.x - ret[0].adv.x, re.adv.y - ret[0].adv.y);
      g.retreatDrift = Math.round(dd);
      if (dd > 22) err('撤退後冒險者又移動了 ' + Math.round(dd) + 'px');
      if (ret[0].hearts !== 0) err('撤退時心條不是 0');
      if (+re.advOp > .7) err('撤退後冒險者沒變淡（opacity ' + re.advOp + '）');
    }
  } else if (ret.length) err('走到底卻有撤退事件');
  // 結果小標：每隻敵人最多 2 個、且是最近 2 擲的點數和
  const byEnemy = {};
  R.fights.forEach(f => { (byEnemy[f.idx] = byEnemy[f.idx] || []).push(f); });
  Object.keys(byEnemy).forEach(k => {
    const chips = re.chips[k] || [], want = byEnemy[k].slice(-2).map(f => String(f.sum));
    if (chips.join() !== want.join()) err('敵人' + k + ' 結果小標 ' + chips + ' ≠ 最近兩擲 ' + want);
  });
  // 回饋分級
  g.fly = seen.fly; g.bw = seen.bw; g.ovSeen = seen.ov;
  if (re.d.grade === 'miss') { if (seen.fly || seen.bw || seen.ov) err('沒回本卻有金幣／大字／覆蓋層 ' + JSON.stringify(seen)); if ($('tot').className.indexOf('dn') < 0) err('沒回本拿回數字不是灰色'); }
  if (re.d.grade === 'back') { if (!seen.fly) err('回本以上沒有金幣'); if (seen.bw || seen.ov) err('回本以上不該有大字／覆蓋層'); if ($('tot').className.indexOf('up') < 0) err('回本以上拿回數字不是金色'); }
  if (re.d.grade === 'big') { if (!seen.bw) err('大贏沒有大字'); if (!seen.fly) err('大贏沒有金幣'); if (seen.ov) err('大贏不該有覆蓋層'); }
  if (re.d.grade === 'jackpot') { if (!seen.ov) err('大獎沒有覆蓋層'); }
  const wantGrade = payout / sp.stake >= 20 ? 'jackpot' : payout / sp.stake >= 5 ? 'big' : payout >= sp.stake ? 'back' : 'miss';
  if (re.d.grade !== wantGrade) err('等級 ' + re.d.grade + ' ≠ ' + wantGrade);
  // 時序
  const tm = re.d.timing && re.d.timing.rolls || [];
  g.firstMs = tm.filter(t => !t.retry).map(t => t.ms); g.retryMs = tm.filter(t => t.retry).map(t => t.ms);
  if (lockChecks) g.lock = lockChecks;
  mo.disconnect(); offs.forEach(f => f());
  out.games.push(g);
  await sleep(150);
}

// 彙整
{
  const gs = out.games.filter(g => g.ms);
  const ms = gs.map(g => g.ms);
  const fm = [].concat(...gs.map(g => g.firstMs || [])), rm = [].concat(...gs.map(g => g.retryMs || []));
  const avg = a => a.length ? Math.round(sum(a) / a.length) : null;
  const normal = gs.filter(g => g.grade !== 'jackpot');
  out.summary = {
    games: gs.length, avgMs: avg(ms), maxMs: Math.max(...ms), minMs: Math.min(...ms),
    avgMsExclJackpot: avg(normal.map(g => g.ms)), maxMsExclJackpot: Math.max(...normal.map(g => g.ms)),
    firstRollAvgMs: avg(fm), retryAvgMs: avg(rm), firstN: fm.length, retryN: rm.length,
    byRoute: ['safe', 'mid', 'risk'].map(r => { const q = gs.filter(g => g.route === r); return { r, n: q.length, avg: avg(q.map(g => g.ms)), max: q.length ? Math.max(...q.map(g => g.ms)) : 0 }; }),
    retreats: gs.filter(g => !g.reachedEnd).length, reachedEnd: gs.filter(g => g.reachedEnd).length, withRetry: gs.filter(g => g.retries > 0).length,
    grades: gs.reduce((o, g) => (o[g.grade] = (o[g.grade] || 0) + 1, o), {}), errs: gs.reduce((n, g) => n + g.errs.length, 0)
  };
}

// ================= 3) 點畫面加速 =================
{
  const test = async (tap) => {
    if (walNow() < 100) { game.addMoney(10000); await sleep(600); }
    game.devSetMap(777);
    ui.setRoute('safe');
    const map = game.getState().map;
    let seedR = -1;
    for (let i = 1; i < 100000; i++) { const r = DemoCore.simulate(map, 0, 100, EV.mulberry32(i)); if (r.fights.length >= 5) { seedR = i; break; } }
    game.setRng(EV.mulberry32(seedR));
    const t0 = Date.now(), p = ui.play('safe', 100);
    let tapped = null;
    if (tap) { await sleep(400); tapped = getComputedStyle($('app')).getPropertyValue('--sp'); $('stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(50); tapped = [tapped, getComputedStyle($('app')).getPropertyValue('--sp')]; }
    const r = await p;
    await waitIdle(5000);
    return { ms: Date.now() - t0, tapped, rolls: r.result.fights.length };
  };
  const a = await test(false), b = await test(true);
  out.speedup = { normalMs: a.ms, tapMs: b.ms, ratio: +(a.ms / b.ms).toFixed(2), sameRolls: a.rolls === b.rolls, sp: b.tapped };
  if (!(a.ms / b.ms >= 1.8)) bad('點畫面加速不夠明顯：' + JSON.stringify(out.speedup));
  if (!b.tapped || Number(b.tapped[1]) < 3) bad('點畫面後 --sp 不到 3 倍：' + JSON.stringify(b.tapped));
}

// ================= 4) 重整 =================
const frame = async () => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:0;top:0;width:' + innerWidth + 'px;height:' + innerHeight + 'px;z-index:99999;border:0;background:#000';
  f.src = location.href; document.body.appendChild(f);
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) { try { if (f.contentWindow.__demoReady && f.contentWindow.DEMO && f.contentWindow.DEMO.ui) break; } catch (e) {} await sleep(50); }
  await sleep(200);
  return f;
};
{
  await waitIdle(5000);
  if (walNow() < 100) { game.addMoney(10000); await sleep(600); }
  // (a) 未下注重整：同一張圖、同一個走向（三條路各比一次）
  const st = game.getState(), res = { idle: [] };
  const f = await frame();
  try {
    const w = f.contentWindow, g2 = w.DEMO.game.getState();
    if (g2.mapSeed !== st.mapSeed) bad('未下注重整：地圖種子變了 ' + st.mapSeed + '→' + g2.mapSeed);
    for (const r of RIDS) {
      ui.setRoute(r); w.DEMO.ui.setRoute(r);
      await sleep(80);
      const d1 = [...document.querySelectorAll('#stage .pb')].map(p => p.getAttribute('d')).join('|'), d2 = [...w.document.querySelectorAll('#stage .pb')].map(p => p.getAttribute('d')).join('|');
      const n1 = [...document.querySelectorAll('#stage .nd')].map(p => p.className + p.style.transform).join('|'), n2 = [...w.document.querySelectorAll('#stage .nd')].map(p => p.className + p.style.transform).join('|');
      const same = d1 === d2 && n1 === n2;
      res.idle.push({ r, same });
      if (!same) bad('未下注重整：' + r + ' 的走向／節點位置不同');
    }
  } finally { f.remove(); }
  ui.setRoute('mid');
  await sleep(100);
  // (b) 演出中重整：直接結算、不重播、新地圖、餘額正確
  const bal0 = game.getState().wallet, seed0 = game.getState().mapSeed;
  game.setRng(EV.mulberry32(5));
  const p = ui.play('mid', 500);
  await sleep(700);
  const pend = game.getState().st, wantBal = bal0 - 500 + pend.total, pendSeed = game.getState().mapSeed;
  const f2 = await frame();
  try {
    const w = f2.contentWindow, g2 = w.DEMO.game.getState();
    res.mid = { wantBal, coreBal: g2.wallet, shown: parseInt(w.document.getElementById('wal').textContent.replace(/,/g, ''), 10), phase: g2.phase, newSeed: g2.mapSeed !== pendSeed, busy: w.DEMO.ui.busy(),
      chips: w.document.querySelectorAll('.chip').length, dice: [...w.document.querySelectorAll('.dp')].map(x => getComputedStyle(x).opacity).join() };
    if (g2.wallet !== wantBal) bad('演出中重整：核心餘額 ' + g2.wallet + ' ≠ ' + wantBal);
    if (res.mid.shown !== wantBal) bad('演出中重整：畫面餘額 ' + res.mid.shown + ' ≠ ' + wantBal);
    if (g2.phase !== 'BET') bad('演出中重整：phase ' + g2.phase);
    if (!res.mid.newSeed) bad('演出中重整：沒換新地圖');
    if (res.mid.busy || res.mid.chips || /1/.test(res.mid.dice)) bad('演出中重整：畫面像是重播了 ' + JSON.stringify(res.mid));
  } finally { f2.remove(); }
  await p.catch(() => {});
  await waitIdle(15000);
  out.reload = res;
}
out.notes.consoleErrors = 'shot.mjs 另外收集';
out.ok = out.problems.length === 0;
return out;
