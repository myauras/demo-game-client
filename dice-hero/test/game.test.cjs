// 核心規則驗證：在 dice-hero 資料夾執行 node test/game.test.cjs
'use strict';
const assert = require('node:assert/strict');
const G = require('../js/game.js');
const { casualBot, simulate } = require('./sim.cjs');

const seeded = seed => G.mulberry32(seed);
// 在骰子旁邊找一個不是障礙的方向，並把場上清空，方便擺指定的格子。
function arena(options) {
  const state = G.createGame(Object.assign({ random: seeded(1) }, options));
  state.objects = new Map();
  const dir = Object.keys(G.DIRS).find(d => !G.terrainAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]));
  const tx = state.x + G.DIRS[dir][0], ty = state.y + G.DIRS[dir][1];
  return { state, dir, key: tx + ',' + ty };
}
// 把骰子擺成「往 dir 翻一步之後 want 朝上」。
function aimDie(state, dir, want) {
  state.die = Object.assign({}, G.ORIENTATIONS.find(die => G.rollDie(die, dir).top === want));
}
const find = (events, type) => events.find(event => event.type === type);
const FLAT = { mountainChance: 0, riverChance: 0, forestChance: 0 };
const EMPTY = Object.assign({ publicMonsters: 0, hiddenMonsters: 0, chests: 0, potions: 0, swamps: 0, rerolls: 0, publicTeleports: 0 }, FLAT);
const monster = (n, dark, mult) => {
  const tier = G.monsterTier(n);
  return { type: 'monster', n, tier, hidden: !!dark, dark: !!dark, mult: mult || G.CONFIG.monsterMults[n - 1] * (dark ? 1.5 : 1) };
};
const chest = (need, tier = 'wood') => ({ type: 'chest', tier, mult: G.CONFIG.chestTiers[tier].mult, need, tries: G.CONFIG.chestTiers[tier].tries });
// 在沒有地形的地圖上手動放一格山。
function wall(state, x, y) {
  G.terrainAt(state, x, y);
  const size = state.config.chunkSize, cx = Math.floor(x / size), cy = Math.floor(y / size);
  state.chunks.get(cx + ',' + cy).set((x - cx * size) + ',' + (y - cy * size), 'mountain');
}

// ---- 骰子 ----
assert.equal(G.ORIENTATIONS.length, 24);
for (const die of G.ORIENTATIONS) {
  for (const dir of Object.keys(G.DIRS)) {
    let rolled = die;
    for (let i = 0; i < 4; i++) rolled = G.rollDie(rolled, dir);
    assert.deepEqual(rolled, die, '同方向翻四次回到原樣');
    const faces = [rolled.top, 7 - rolled.top, rolled.front, 7 - rolled.front, rolled.right, 7 - rolled.right];
    assert.deepEqual(faces.slice().sort(), [1, 2, 3, 4, 5, 6], '六個面各一個點數');
  }
  assert.deepEqual(G.rollDie(G.rollDie(die, 'N'), 'S'), die);
  assert.deepEqual(G.rollDie(G.rollDie(die, 'E'), 'W'), die);
}
const sample = { top: 1, front: 2, right: 3 };
assert.equal(G.rollDie(sample, 'N').top, 2, '往遠處翻：前面翻上來');
assert.equal(G.rollDie(sample, 'S').top, 5, '往近處翻：背面翻上來');
assert.equal(G.rollDie(sample, 'E').top, 4, '往右翻：左面翻上來');
assert.equal(G.rollDie(sample, 'W').top, 3, '往左翻：右面翻上來');
assert.throws(() => G.rollDie(sample, 'X'));

// ---- 地形 ----
const flood = (start, passable, size) => {
  const seen = new Set([start]); const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift().split(',').map(Number);
    for (const [dx, dy] of Object.values(G.DIRS)) {
      const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || seen.has(key) || !passable(key)) continue;
      seen.add(key); queue.push(key);
    }
  }
  return seen.size;
};
let featureChunks = 0, forests = 0, forestCells = 0, mountains = 0, mountainCells = 0, uneven = 0;
const terrainKinds = new Set();
for (let seed = 0; seed < 300; seed++) {
  const size = G.CONFIG.chunkSize;
  const chunk = G.buildChunk(seed, seed % 7, -seed % 5, G.CONFIG);
  assert.deepEqual(Array.from(G.buildChunk(seed, seed % 7, -seed % 5, G.CONFIG)), Array.from(chunk), '同種子結果相同');
  if (!chunk.size) continue;
  featureChunks++;
  assert.equal(new Set(chunk.values()).size, 1, '一個區塊只有一種地形');
  const kind = chunk.values().next().value;
  terrainKinds.add(kind);
  // 河流跨區塊，另外用大區來驗；山和森林留在區塊裡面。
  if (kind === 'river') continue;
  for (const key of chunk.keys()) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(x >= 1 && y >= 1 && x <= size - 2 && y <= size - 2, '區塊邊緣留空當通道');
  }
  // 森林是一整片相連；山脈被隘口分成兩座（一大一小）。可走的格子全部互通（不圍死）。
  const parts = [];
  const left = new Set(chunk.keys());
  while (left.size) {
    const start = left.values().next().value;
    const seen = new Set([start]); const queue = [start];
    while (queue.length) {
      const [x, y] = queue.shift().split(',').map(Number);
      for (const [dx, dy] of Object.values(G.DIRS)) {
        const key = (x + dx) + ',' + (y + dy);
        if (left.has(key) && !seen.has(key)) { seen.add(key); queue.push(key); }
      }
    }
    for (const key of seen) left.delete(key);
    parts.push(seen);
  }
  if (kind === 'forest') {
    assert.equal(parts.length, 1, '森林是一整片');
    assert.ok(chunk.size >= G.CONFIG.forestSize[0], '森林夠大：' + chunk.size);
    forestCells += chunk.size; forests++;
  } else {
    assert.equal(parts.length, 2, '山脈被一個隘口分成兩座');
    // 隘口：有一整排（直或橫）沒有山，而且兩邊都有山。
    const xs = Array.from(chunk.keys()).map(key => Number(key.split(',')[0])), ys = Array.from(chunk.keys()).map(key => Number(key.split(',')[1]));
    const gap = list => { for (let v = Math.min(...list) + 1; v < Math.max(...list); v++) if (!list.includes(v)) return true; return false; };
    assert.ok(gap(xs) || gap(ys), '隘口整排是空的');
    if (parts[0].size !== parts[1].size) uneven++;
    mountainCells += chunk.size; mountains++;
  }
  assert.equal(flood('0,0', key => !chunk.has(key), size), size * size - chunk.size, '可走的格子全部互通');
}
assert.ok(featureChunks > 180, '六成以上的區塊有地形：' + featureChunks + '/300');
assert.deepEqual(Array.from(terrainKinds).sort(), ['forest', 'mountain', 'river']);
assert.ok(uneven > mountains * 0.7, '山脈多半是一大一小：' + uneven + '/' + mountains);
console.log('  森林平均 ' + (forestCells / forests).toFixed(1) + ' 格，山脈平均 ' + (mountainCells / mountains).toFixed(1) + ' 格');

// ---- 河流：跨區塊的長河，偶爾分岔 ----
{
  const C = G.CONFIG, n = C.chunkSize * C.riverSpan;
  let rivers = 0, long = 0, forked = 0, total = 0;
  for (let seed = 0; seed < 400; seed++) {
    const sx = seed % 5 - 2, sy = seed % 3 - 1;
    const river = G.buildRiver(seed, sx, sy, C);
    assert.deepEqual(Array.from(G.buildRiver(seed, sx, sy, C)), Array.from(river), '同種子結果相同');
    if (!river.size) continue;
    rivers++; total += river.size;
    if (river.size >= C.riverLength[0]) long++;
    assert.ok(river.size <= C.riverLength[1] + C.riverBranchLength[1], '長度不超過主流加支流：' + river.size);
    let ends = 0;
    for (const key of river) {
      const [x, y] = key.split(',').map(Number);
      assert.ok(x >= 1 && y >= 1 && x <= n - 2 && y <= n - 2, '大區最外圈留空，河的兩頭繞得過去');
      const near = Object.values(G.DIRS).filter(([dx, dy]) => river.has((x + dx) + ',' + (y + dy))).length;
      assert.ok(near >= 1 && near <= 3, '河是一格寬的帶狀');
      if (near === 3) forked++;
      if (near === 1) ends++;
    }
    assert.ok(ends === 2 || ends === 3, '兩個端點，有支流時三個：' + ends);
    assert.equal(flood(river.values().next().value, key => river.has(key), n), river.size, '整條河相連');
    assert.equal(flood('0,0', key => !river.has(key), n), n * n - river.size, '可走的格子全部互通');
    // 切成區塊後跟大區的河對得上，而且河流經過的區塊沒有山和森林。
    let seen = 0;
    for (let cx = 0; cx < C.riverSpan; cx++) for (let cy = 0; cy < C.riverSpan; cy++) {
      const chunk = G.buildChunk(seed, sx * C.riverSpan + cx, sy * C.riverSpan + cy, C);
      for (const [key, kind] of chunk) {
        if (kind !== 'river') continue;
        const [x, y] = key.split(',').map(Number);
        assert.ok(river.has((cx * C.chunkSize + x) + ',' + (cy * C.chunkSize + y)));
        assert.equal(new Set(chunk.values()).size, 1, '河流經過的區塊沒有山和森林');
        seen++;
      }
    }
    assert.equal(seen, river.size);
  }
  assert.ok(rivers > 280 && rivers < 360, '約八成的大區有河：' + rivers + '/400');
  assert.ok(long > rivers * 0.6, '多數的河夠長：' + long + '/' + rivers);
  assert.ok(forked > rivers * 0.25 && forked < rivers * 0.55, '約四成的河有分岔：' + forked + '/' + rivers);
}

// ---- 開場與一波的擺放 ----
let farTeleports = 0;
for (let seed = 1; seed <= 200; seed++) {
  const state = G.createGame({ random: seeded(seed) });
  assert.equal(state.balance, 1000);
  assert.ok(!G.terrainAt(state, state.x, state.y));
  let teleports = 0, visibleWorth = 0;
  for (const [key, object] of state.objects) {
    const [x, y] = key.split(',').map(Number);
    const distance = Math.abs(x - state.x) + Math.abs(y - state.y);
    assert.ok(!G.terrainAt(state, x, y), '目標不擺在障礙上');
    assert.ok(distance >= 2, '目標不貼著骰子');
    if (object.type === 'teleport') { teleports++; if (distance >= 8) farTeleports++; else assert.ok(distance >= 6, '沒有夠遠的空格時放在最遠的空格'); }
    if (object.type === 'monster') {
      assert.ok(object.n >= 1 && object.n <= 5, '沒有 6 點怪');
      assert.equal(object.tier, G.monsterTier(object.n));
      assert.equal(object.mult, G.CONFIG.monsterMults[object.n - 1] * (object.dark ? 1.5 : 1));
      assert.equal(object.hidden, object.dark, '黑色版本開場時點數蓋著');
      visibleWorth += object.mult;
    }
    if (object.type === 'chest') assert.equal(object.tries, G.CONFIG.chestTiers[object.tier].tries);
    if (object.type === 'chest') { visibleWorth += object.mult; assert.equal(object.mult, G.CONFIG.chestTiers[object.tier].mult); }
  }
  assert.equal(teleports, 1);
  assert.ok(state.objects.size <= 31, '最多 30 個目標加 1 個傳送點；獎池付不起的怪物、寶箱先不擺');
  const kindCount = kind => Array.from(state.objects.values()).filter(object => object.type === kind).length;
  assert.ok(kindCount('potion') === 2 && kindCount('swamp') === 2, '藥水和毒潭不花獎池，開場就各有 2 個');
  assert.equal(kindCount('unknown'), 0, '沒有「？」了');
  assert.ok(visibleWorth <= 115 + 1e-9, '看得到的目標總額不超過獎池');
}
assert.ok(farTeleports >= 190, '公開傳送點幾乎都在 8 格以外：' + farTeleports + '/200');
assert.deepEqual([1, 2, 3, 4, 5].map(G.monsterTier), ['small', 'small', 'elite', 'elite', 'boss']);
assert.throws(() => G.createGame({ bet: 15 }));
assert.throws(() => G.createGame({ balance: -1 }));

// ---- 走一步：扣錢、倒數、獎池 ----
{
  const { state, dir } = arena();
  const events = G.move(state, dir);
  assert.equal(events[0].type, 'step');
  assert.equal(state.balance, 990);
  assert.equal(state.pool, 1150 + 9.5);
  assert.equal(state.spent, 10);
}

// ---- 撞山或撞河：不花錢、不算一步、不重骰 ----
{
  let state, dir;
  for (let seed = 1; !dir; seed++) {
    state = G.createGame({ random: seeded(seed) });
    for (let i = 0; i < 40 && !dir; i++) {
      dir = Object.keys(G.DIRS).find(d => G.terrainAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]));
      if (!dir) G.move(state, 'N');
    }
  }
  const before = { balance: state.balance, die: Object.assign({}, state.die), x: state.x, y: state.y };
  state.bless = 3;
  const events = G.move(state, dir);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'bump');
  assert.deepEqual({ balance: state.balance, die: state.die, x: state.x, y: state.y }, before);
  assert.equal(state.bless, 3, '撞到不扣狀態步數');
}

// ---- 怪物 ----
{
  // 獎金看點數：1～5 點是 2／3／6／10／30 倍，點數越高獎金越高，「獎金 × 亂打的勝率」也越高。
  assert.deepEqual(G.CONFIG.monsterMults, [2, 3, 6, 10, 30]);
  let lastMult = 0, lastValue = 0;
  for (let n = 1; n <= 5; n++) {
    const { state, dir, key } = arena({ config: EMPTY });
    state.objects.set(key, monster(n));
    aimDie(state, dir, 6);
    const fight = find(G.move(state, dir), 'fight');
    const mult = G.CONFIG.monsterMults[n - 1], value = mult * (6 - n) / 6;
    assert.equal(fight.payout, mult * 10, n + ' 點怪的獎金');
    assert.ok(mult > lastMult && value > lastValue, n + ' 點怪比前一級划算');
    lastMult = mult; lastValue = value;
  }
}
{
  const { state, dir, key } = arena();
  state.objects.set(key, monster(4));
  aimDie(state, dir, 5);
  const events = G.move(state, dir);
  const fight = find(events, 'fight');
  assert.ok(fight.win && fight.payout === 100 && fight.tier === 'elite' && !fight.bigWin, '4 點菁英 10 倍，不播大獎演出');
  assert.equal(state.balance, 1000 - 10 + 100);
  assert.ok(!state.objects.has(key), '打贏後那格變空地');
}
// 要大於怪物點數才贏：1～5 點怪 × 骰面 1～6 全部組合，平手算輸。
for (let n = 1; n <= 5; n++) for (let top = 1; top <= 6; top++) {
  const { state, dir, key } = arena({ config: EMPTY });
  state.objects.set(key, monster(n));
  aimDie(state, dir, top);
  assert.equal(find(G.move(state, dir), 'fight').win, top > n, top + ' 點對 ' + n + ' 點怪');
}
// 打輸被擊退：小怪退回上一格、菁英再多退 1 格、BOSS 再多退 2 格。
// 下面的 knock 是從怪物那格算起的距離（1／2／3）。錢照扣。
for (const [n, knock] of [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3]]) {
  const { state, dir, key } = arena({ config: EMPTY });
  const [mx, my] = key.split(',').map(Number), [dx, dy] = G.DIRS[dir];
  state.objects.set(key, monster(n, true));
  aimDie(state, dir, 1);
  const events = G.move(state, dir);
  assert.equal(find(events, 'fight').win, false);
  assert.equal(find(events, 'bounce').distance, knock);
  assert.deepEqual([state.x, state.y], [mx - dx * knock, my - dy * knock], n + ' 點怪擊退 ' + knock + ' 格');
  assert.equal(state.balance, 990, '打輸那一步的錢照扣');
  assert.equal(state.objects.get(key).hidden, false, '隱藏怪打輸後點數公開');
  assert.equal(state.objects.get(key).mult, G.CONFIG.monsterMults[n - 1] * 1.5);
}
{
  // 背後第 3 格是山：BOSS 只能把骰子打退到山前面（離怪物 2 格）。
  const { state, dir, key } = arena({ config: EMPTY });
  const [mx, my] = key.split(',').map(Number), [dx, dy] = G.DIRS[dir];
  wall(state, mx - dx * 3, my - dy * 3);
  state.objects.set(key, monster(5));
  aimDie(state, dir, 1);
  G.move(state, dir);
  assert.deepEqual([state.x, state.y], [mx - dx * 2, my - dy * 2], '撞到障礙就停');
}
{
  // 落點有東西：停在前一個空格，不會觸發那個東西。
  const { state, dir, key } = arena({ config: EMPTY });
  const [mx, my] = key.split(',').map(Number), [dx, dy] = G.DIRS[dir];
  state.objects.set((mx - dx * 3) + ',' + (my - dy * 3), chest('big'));
  state.objects.set(key, monster(5));
  aimDie(state, dir, 1);
  const events = G.move(state, dir);
  assert.deepEqual([state.x, state.y], [mx - dx * 2, my - dy * 2], '落點有東西就少退一格');
  assert.ok(!find(events, 'chest') && !find(events, 'potion') && !find(events, 'swamp'), '被擊退不會觸發路上的東西');
}
{
  const { state, dir, key } = arena();
  state.objects.set(key, monster(5));
  aimDie(state, dir, 6);
  const fight = find(G.move(state, dir), 'fight');
  assert.ok(fight.win && fight.payout === 300 && fight.bigWin, '打贏 BOSS 拿 30 倍並觸發大獎演出');
}

// ---- 祝福與詛咒：對怪物和寶箱都有效，7 算大、0 算小 ----
{
  const { state, dir, key } = arena();
  state.objects.set(key, monster(5));
  aimDie(state, dir, 5); state.bless = 2;
  assert.ok(find(G.move(state, dir), 'fight').win, '5 點加祝福打得贏 5 點怪');
  assert.equal(state.bless, 1);
}
{
  const { state, dir, key } = arena();
  state.objects.set(key, monster(1));
  aimDie(state, dir, 2); state.curse = 1;
  assert.equal(find(G.move(state, dir), 'fight').win, false, '2 點加詛咒打不贏 1 點怪');
}
{
  const { state, dir, key } = arena();
  state.objects.set(key, monster(3));
  aimDie(state, dir, 4); state.bless = 3; state.curse = 3;
  assert.ok(find(G.move(state, dir), 'fight').win, '祝福和詛咒互相抵銷');
}
assert.ok(G.chestOpens('big', 7) && G.chestOpens('small', 0));
assert.ok(G.chestOpens('big', 4) && !G.chestOpens('big', 3) && G.chestOpens('small', 3) && !G.chestOpens('small', 4));
{
  const { state, dir, key } = arena();
  state.objects.set(key, chest('small'));
  aimDie(state, dir, 4); state.curse = 2;
  const opened = find(G.move(state, dir), 'chest');
  assert.ok(opened.win && opened.payout === 40 && opened.tier === 'wood' && !opened.bigWin, '詛咒讓 4 點開得了小寶箱，木箱 4 倍');
}
{
  // 鐵箱 6 倍、金箱 10 倍；寶箱裡只有金箱播大獎演出。
  for (const [tier, payout] of [['iron', 60], ['gold', 100]]) {
    const { state, dir, key } = arena();
    state.objects.set(key, chest('big', tier));
    aimDie(state, dir, 5);
    const opened = find(G.move(state, dir), 'chest');
    assert.ok(opened.win && opened.payout === payout && opened.tier === tier && opened.bigWin === (tier === 'gold'), tier + ' 寶箱獎金');
  }
}
{
  // 擺寶箱時只挑獎池付得起的檔次：獎池少只有木箱，獎池很滿才有鐵箱、金箱，而且仍比木箱少。
  const count = { poor: { wood: 0, iron: 0, gold: 0 }, rich: { wood: 0, iron: 0, gold: 0 } };
  for (let seed = 1; seed <= 200; seed++) {
    for (const [name, pool] of [['poor', 50], ['rich', 50000]]) {
      const state = G.createGame({ random: seeded(seed), pool });
      for (const object of state.objects.values()) if (object.type === 'chest') count[name][object.tier]++;
    }
  }
  assert.ok(count.poor.wood > 0 && count.poor.iron === 0 && count.poor.gold === 0, '獎池只有 5 倍底注時擺不出鐵箱、金箱');
  assert.ok(count.rich.iron > 0 && count.rich.gold > 0, '獎池很滿時有鐵箱、金箱');
  assert.ok(count.rich.wood > count.rich.iron && count.rich.iron > count.rich.gold, '越高檔越少見');
}
{
  const { state, dir, key } = arena();
  state.objects.set(key, chest('small'));
  aimDie(state, dir, 3); state.bless = 2;
  const events = G.move(state, dir);
  assert.equal(find(events, 'chest').win, false, '祝福讓 3 點開不了小寶箱');
  assert.ok(find(events, 'bounce') && state.objects.has(key), '開不了就退回，寶箱留著');
}
{
  // 木箱最多試 3 次，鐵箱和金箱 2 次；最後一次還開不了就消失。
  assert.deepEqual(['wood', 'iron', 'gold'].map(tier => G.CONFIG.chestTiers[tier].tries), [3, 2, 2]);
  for (const tier of ['iron', 'gold']) {
    const { state, dir, key } = arena({ config: EMPTY });
    state.objects.set(key, chest('big', tier));
    for (const left of [1, 0]) {
      aimDie(state, dir, 2);
      assert.equal(find(G.move(state, dir), 'chest').triesLeft, left);
      assert.equal(state.objects.has(key), left > 0, tier + ' 第 2 次開不了就消失');
    }
  }
  const { state, dir, key } = arena({ config: EMPTY });
  const from = [state.x, state.y];
  state.objects.set(key, chest('big'));
  for (const left of [2, 1, 0]) {
    aimDie(state, dir, 2);
    const events = G.move(state, dir);
    assert.equal(find(events, 'chest').triesLeft, left);
    assert.equal(find(events, 'bounce').distance, 1);
    assert.deepEqual([state.x, state.y], from, '開不了退回上一格');
    assert.equal(state.objects.has(key), left > 0);
  }
  assert.equal(state.balance, 970, '三次的步費都照扣');
}

// ---- 中毒：步費翻倍，持續 5 步 ----
{
  const { state, dir } = arena();
  state.poison = 2;
  G.move(state, dir);
  assert.equal(state.balance, 980);
  assert.equal(state.poison, 1);
}

// ---- 隨機藥水 ----
{
  // 喝下去隨機得到祝福或詛咒（大約各半），從 15 步起算；藥水消失、骰子留在那格、只收步費。
  const counts = { bless: 0, curse: 0 };
  for (let seed = 1; seed <= 400; seed++) {
    const { state, dir, key } = arena({ random: seeded(seed), config: EMPTY });
    state.objects.set(key, { type: 'potion' });
    const events = G.move(state, dir);
    const outcome = find(events, 'potion').outcome;
    counts[outcome] += 1;
    assert.equal(state[outcome], 15);
    assert.equal(state[outcome === 'bless' ? 'curse' : 'bless'], 0);
    assert.equal(find(events, 'status').kind, outcome);
    assert.ok(!state.objects.has(key), '喝完的藥水變空地');
    assert.equal(state.x + ',' + state.y, key, '骰子留在藥水那格');
    assert.equal(state.balance, 990);
    assert.ok(!find(events, 'bounce'));
  }
  assert.ok(counts.bless > 150 && counts.curse > 150, JSON.stringify(counts));
}
{
  // 祝福和詛咒互相取代：身上有其中一個時喝到另一個，舊的立刻消失；喝到同一個就重新算 15 步。
  let swapped = 0, renewed = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { state, dir, key } = arena({ random: seeded(seed), config: EMPTY });
    const had = seed % 2 ? 'bless' : 'curse', other = had === 'bless' ? 'curse' : 'bless';
    state[had] = 9;
    state.objects.set(key, { type: 'potion' });
    const outcome = find(G.move(state, dir), 'potion').outcome;
    assert.equal(state[outcome], 15);
    if (outcome === had) { renewed++; assert.equal(state[other], 0); }
    else { swapped++; assert.equal(state[had], 0, '舊的狀態被取代'); }
    assert.equal(G.modifier(state), outcome === 'bless' ? 1 : -1);
  }
  assert.ok(swapped > 50 && renewed > 50);
}
// ---- 鄉村、城鎮：地圖上固定的地標，目前沒有作用 ----
{
  const span = G.CONFIG.siteSpan, kinds = { village: 0, town: 0 };
  let visited = 0, wheatSites = 0, wheatCells = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const state = G.createGame({ random: seeded(seed), balance: 1e9 });
    // 密度：每 span × span 格最多一個，絕大多數的範圍都有。
    const blocks = 12;
    let sites = 0;
    for (let bx = -blocks; bx < blocks; bx++) for (let by = -blocks; by < blocks; by++) {
      let here = 0;
      for (let x = bx * span; x < (bx + 1) * span; x++) for (let y = by * span; y < (by + 1) * span; y++) {
        const kind = G.siteAt(state, x, y);
        if (!kind) continue;
        here++; kinds[kind]++;
        assert.ok(!G.terrainAt(state, x, y), '地標在可以走的格子上');
        assert.ok(!G.isNook(state, x, y), '地標不佔死角');
        assert.equal(G.siteAt(state, x, y), kind, '同一格每次問結果都一樣');
        // 麥田：只在周圍八格裡，不壓在障礙上，數量在範圍內，而且連成一片。
        const wheat = [];
        for (let ax = -2; ax <= 2; ax++) for (let ay = -2; ay <= 2; ay++) {
          if (!G.wheatAt(state, x + ax, y + ay)) continue;
          assert.ok(Math.max(Math.abs(ax), Math.abs(ay)) === 1, '麥田只在地標周圍八格');
          assert.ok(!G.terrainAt(state, x + ax, y + ay), '麥田不壓在山、河、森林上');
          wheat.push((x + ax) + ',' + (y + ay));
        }
        assert.ok(wheat.length <= G.CONFIG.wheatCount[1], '麥田數量不超過上限：' + wheat.length);
        if (wheat.length) {
          const linked = new Set([wheat[0]]), todo = [wheat[0]];
          while (todo.length) {
            const [wx, wy] = todo.pop().split(',').map(Number);
            for (const [ax, ay] of Object.values(G.DIRS)) {
              const key = (wx + ax) + ',' + (wy + ay);
              if (wheat.includes(key) && !linked.has(key)) { linked.add(key); todo.push(key); }
            }
          }
          assert.equal(linked.size, wheat.length, '麥田連成一片');
          wheatSites++; wheatCells += wheat.length;
        }
      }
      assert.ok(here <= 1, '一個範圍最多一個地標');
      sites += here;
    }
    assert.ok(sites > blocks * blocks * 4 * 0.97, '幾乎每個範圍都有地標：' + sites);
    // 走上去：只收步費，沒有任何效果，地標還在；怪物、寶箱那些不會擺在地標上。
    for (const key of state.objects.keys()) {
      const [x, y] = key.split(',').map(Number);
      assert.ok(!G.siteAt(state, x, y), '東西不會擺在地標上');
    }
    let done = false;
    for (let x = -60; x <= 60 && !done; x++) for (let y = -60; y <= 60 && !done; y++) {
      const kind = G.siteAt(state, x, y);
      if (!kind || G.terrainAt(state, x - 1, y)) continue;
      state.objects.clear();
      state.x = x - 1; state.y = y; state.bless = 3; state.curse = 0; state.poison = 0;
      const before = state.balance;
      const events = G.move(state, 'E');
      assert.equal(find(events, 'place').kind, kind);
      assert.ok(!find(events, 'bounce') && !find(events, 'status'));
      assert.equal(before - state.balance, state.bet, '只收步費');
      assert.ok(state.x === x && state.y === y, '骰子可以走上去');
      assert.equal(G.siteAt(state, x, y), kind, '踩過不會消失');
      assert.equal(state.bless, 2, '狀態照常遞減，沒有別的效果');
      visited++; done = true;
    }
  }
  assert.equal(visited, 6);
  assert.ok(wheatSites > (kinds.town + kinds.village) * 0.95, '幾乎每個地標都有麥田');
  console.log('  地標 ' + (kinds.town + kinds.village) + ' 個，麥田平均 ' + (wheatCells / wheatSites).toFixed(1) + ' 格');
  const share = kinds.town / (kinds.town + kinds.village);
  assert.ok(share > 0.25 && share < 0.35, '約三成是城鎮：' + share.toFixed(2));
}
// ---- 重骰 ----
{
  // 踩上去骰子換成隨機的新朝向、只收步費、不彈回；地塊不會消失，可以走開再踩回來。
  const tops = new Set(), back = { N: 'S', S: 'N', E: 'W', W: 'E' };
  let changed = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const { state, dir, key } = arena({ random: seeded(seed), config: EMPTY });
    state.objects.set(key, { type: 'reroll' });
    const events = G.move(state, dir);
    const rolled = find(events, 'step').die, reroll = find(events, 'reroll');
    assert.ok(reroll && !find(events, 'bounce') && !find(events, 'status'));
    assert.deepEqual(state.die, reroll.die, '骰子變成重骰出來的朝向');
    assert.ok(G.ORIENTATIONS.some(o => o.top === state.die.top && o.front === state.die.front && o.right === state.die.right), '重骰出來的是合法的朝向');
    if (state.die.top !== rolled.top || state.die.front !== rolled.front) changed++;
    tops.add(state.die.top);
    assert.equal(state.balance, 990, '只收步費');
    assert.equal(state.x + ',' + state.y, key, '骰子留在重骰那格');
    assert.equal(state.objects.get(key).type, 'reroll', '踩過不會消失');
    G.move(state, back[dir]);
    const again = G.move(state, dir);
    assert.ok(find(again, 'reroll'), '走開再踩回來可以再重骰');
    assert.equal(state.balance, 970);
    assert.equal(state.objects.get(key).type, 'reroll');
  }
  assert.equal(tops.size, 6, '六種點數都骰得出來');
  assert.ok(changed > 100, '多數時候朝向會變：' + changed);
}
{
  // 兩個重骰之間至少隔 10 格（直線距離）；因此場上有時只有一個。
  let pairs = 0, two = 0, samples = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const state = G.createGame({ random: seeded(seed), balance: 1e9, pool: 1e7 });
    for (let i = 0; i < 300; i++) {
      const dir = ['N', 'E', 'W', 'S'].find(d => !G.terrainAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]) &&
        !G.objectAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]));
      if (!dir) break;
      G.move(state, dir);
      const spots = [];
      for (const [key, object] of state.objects) if (object.type === 'reroll') spots.push(key.split(',').map(Number));
      assert.ok(spots.length <= 2);
      samples++;
      if (spots.length === 2) {
        two++; pairs++;
        const gap = Math.hypot(spots[0][0] - spots[1][0], spots[0][1] - spots[1][1]);
        assert.ok(gap >= G.CONFIG.rerollMinDistance, '兩個重骰相距 ' + gap.toFixed(1) + ' 格');
      }
    }
  }
  assert.ok(pairs > 100, '有檢查到同時存在兩個重骰的情況：' + pairs);
  console.log('  重骰：' + (two / samples * 100).toFixed(0) + '% 的時間場上有兩個，其餘只有一個或沒有');
}
// ---- 毒潭 ----
{
  // 踩上去中毒 5 步、只收步費、不彈回；毒潭不會消失，再踩一次重新算 5 步。
  const { state, dir, key } = arena({ config: EMPTY });
  state.objects.set(key, { type: 'swamp' });
  const events = G.move(state, dir);
  assert.ok(find(events, 'swamp') && find(events, 'status').kind === 'poison');
  assert.ok(!find(events, 'bounce'));
  assert.equal(state.poison, 5);
  assert.equal(state.balance, 990, '踩上去那一步只收一倍步費');
  assert.equal(state.x + ',' + state.y, key, '骰子留在毒潭上');
  assert.equal(state.objects.get(key).type, 'swamp', '踩過的毒潭還在');
  const back = { N: 'S', S: 'N', E: 'W', W: 'E' }[dir];
  G.move(state, back);
  assert.equal(state.balance, 970, '中毒後步費加倍');
  assert.equal(state.poison, 4);
  G.move(state, dir);
  assert.equal(state.poison, 5, '再踩一次重新算 5 步');
  assert.equal(state.objects.get(key).type, 'swamp');
}
{
  // 被擊退時不會落在毒潭上：落點有東西就少退一點。
  const { state, dir, key } = arena({ config: EMPTY });
  const [mx, my] = key.split(',').map(Number), dx = G.DIRS[dir][0], dy = G.DIRS[dir][1];
  state.objects.set(key, monster(5));
  state.objects.set((mx - dx * 3) + ',' + (my - dy * 3), { type: 'swamp' });
  aimDie(state, dir, 1);
  const events = G.move(state, dir);
  assert.ok(!find(events, 'swamp'));
  assert.equal(state.poison, 0);
  assert.notEqual(state.x + ',' + state.y, (mx - dx * 3) + ',' + (my - dy * 3));
}

// ---- 沒有每波倒數：走再久地圖也不會整批重擺，狀態照常遞減 ----
{
  const { state } = arena({ config: EMPTY, balance: 100000 });
  state.die = { top: 1, front: 2, right: 3 };
  state.bless = 140;
  let steps = 0;
  while (steps < 150) {
    const dir = ['N', 'E', 'S', 'W'].find(d => !G.terrainAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]));
    const events = G.move(state, dir);
    assert.ok(!find(events, 'wave'));
    if (events[0].type === 'step') steps++;
  }
  assert.equal(state.wave, 1, '走 150 步沒有整批重擺');
  assert.equal(state.bless, 0, '祝福只算 15 步，早就結束');
}

// ---- 隨走隨補：場上維持定額，被拋到遠處的回收，新的只補在畫面外 ----
{
  const state = G.createGame({ random: seeded(5), balance: 1e9, pool: 1e7, config: FLAT });
  let checked = 0;
  for (let i = 0; i < 60; i++) {
    const before = new Set(state.objects.keys());
    const events = G.move(state, 'N');
    if (find(events, 'teleport')) break;
    const counts = { monster: 0, chest: 0, potion: 0, swamp: 0, reroll: 0, teleport: 0 };
    for (const [key, object] of state.objects) {
      const [x, y] = key.split(',').map(Number), dx = x - state.x, dy = y - state.y;
      counts[object.type]++;
      assert.ok(Math.abs(dx) <= 6 && dy <= 13 && dy >= -8, '離太遠的目標已回收');
      if (!before.has(key)) assert.ok(Math.abs(dx) > 5 || dy > 12 || dy < -7, '新補的目標只出現在畫面外');
    }
    assert.ok(counts.chest === 9 && counts.teleport === 1 && counts.potion === 2 && counts.swamp === 2 && counts.reroll >= 1 && counts.reroll <= 2 && counts.monster === 15,
      '獎池充足時維持 15 隻怪、9 箱、2 瓶藥水、2 個毒潭、1 個傳送點：' + JSON.stringify(counts));
    checked++;
  }
  assert.ok(checked >= 5);
}
{
  // 獎池付不起時，怪物和寶箱先不擺（那格留空）；藥水和毒潭不花獎池，照樣出現。
  const state = G.createGame({ random: seeded(6), balance: 1e9, pool: 0, config: FLAT });
  const kinds = Array.from(state.objects.values()).filter(object => object.type !== 'teleport').map(object => object.type).sort();
  assert.deepEqual(kinds.filter(kind => kind !== 'reroll'), ['potion', 'potion', 'swamp', 'swamp']);
  assert.ok(kinds.filter(kind => kind === 'reroll').length >= 1);
}
{
  // 站在原地打掉怪物：畫面內不會冒出新目標。
  const { state, dir, key } = arena({ config: FLAT, pool: 1e7 });
  state.objects.set(key, monster(2));
  aimDie(state, dir, 6);
  G.move(state, dir);
  for (const objectKey of state.objects.keys()) {
    const [x, y] = objectKey.split(',').map(Number), dx = x - state.x, dy = y - state.y;
    assert.ok(Math.abs(dx) > 5 || dy > 12 || dy < -7, '打掉怪物後補的目標都在畫面外');
  }
  assert.ok(state.objects.size === 31 || state.objects.size === 30, '缺的目標照樣補滿，只是補在看不到的地方（重骰要隔得夠遠，偶爾只擺得下一個）');
}

// ---- 死角：三面被障礙包住的空格，留給 BOSS 和金箱 ----
{
  const nookSet = new Set(), filledSet = new Set();
  let bosses = 0, golds = 0, swamps = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const state = G.createGame({ random: seeded(seed), balance: 1e9, pool: 1e7 });
    for (let i = 0; i < 400; i++) {
      const dir = ['N', 'E', 'W', 'S'].find(d => !G.terrainAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]) &&
        !G.objectAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]));
      if (!dir) break;
      G.move(state, dir);
      for (let dx = -6; dx <= 6; dx++) for (let dy = -8; dy <= 13; dy++) {
        const x = state.x + dx, y = state.y + dy;
        const here = G.objectAt(state, x, y);
        if (here && (here.type === 'swamp' || here.type === 'reroll')) {
          for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) assert.ok(!G.terrainAt(state, x + ax, y + ay), '毒潭周圍八格都沒有障礙，不會堵住通道');
          swamps++;
        }
        if (!G.isNook(state, x, y)) continue;
        const id = seed + ':' + x + ',' + y; nookSet.add(id);
        assert.equal(Object.values(G.DIRS).filter(([ax, ay]) => G.terrainAt(state, x + ax, y + ay)).length, 3);
        const object = G.objectAt(state, x, y);
        // 傳送點是另外擺的，不受這條規則管。
        if (!object || object.type === 'teleport') continue;
        const boss = object.type === 'monster' && object.tier === 'boss' && !object.dark;
        const gold = object.type === 'chest' && object.tier === 'gold';
        assert.ok(boss || gold, '死角只會有 BOSS 或金箱：' + JSON.stringify(object));
        if (!filledSet.has(id)) { filledSet.add(id); if (boss) bosses++; else golds++; }
      }
    }
  }
  assert.ok(nookSet.size > 60, '走得到的範圍內有死角：' + nookSet.size);
  assert.ok(swamps > 1000, '有檢查到毒潭：' + swamps);
  assert.ok(bosses > 0 && golds > 0, 'BOSS 和金箱都會出現在死角：' + bosses + '／' + golds);
  console.log('  死角 ' + nookSet.size + ' 個，其中 ' + filledSet.size + ' 個擺了東西（BOSS ' + bosses + '、金箱 ' + golds + '）');
}

// ---- 傳送點 ----
{
  const { state, dir, key } = arena();
  state.objects.set(key, { type: 'teleport' });
  state.betLock = 7;
  const die = G.rollDie(state.die, dir), region = state.region;
  const events = G.move(state, dir);
  assert.ok(find(events, 'teleport'));
  assert.notEqual(state.region, region, '傳到新的區域');
  assert.deepEqual(state.die, die, '傳送不改骰子朝向');
  assert.equal(state.betLock, 0, '傳送會解開換注鎖');
  assert.ok(!G.terrainAt(state, state.x, state.y));
}

// ---- 換注 ----
{
  const state = G.createGame({ random: seeded(3), balance: 100000 });
  for (let i = 0; i < 5; i++) G.move(state, ['N', 'E', 'S', 'W'].find(d => !G.terrainAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1]) && !G.objectAt(state, state.x + G.DIRS[d][0], state.y + G.DIRS[d][1])));
  const wave = state.wave, pool = state.pool, region = state.region;
  assert.ok(!G.canChangeBet(state, 10), '不能換成同一個底注');
  assert.ok(!G.canChangeBet(state, 15));
  assert.ok(G.changeBet(state, 50));
  assert.equal(state.bet, 50);
  assert.equal(state.wave, wave + 1, '換注立刻刷新整張地圖');
  assert.notEqual(state.region, region, '換注連山、河、森林也一起換');
  assert.ok(!G.terrainAt(state, state.x, state.y), '換完地形後骰子不會卡在障礙裡');
  for (const key of state.objects.keys()) assert.ok(!G.terrainAt(state, ...key.split(',').map(Number)), '新目標不擺在新地形的障礙上');
  assert.equal(state.pool, pool, '換注不改獎池');
  assert.ok(state.betLock === 10 && !G.canChangeBet(state, 10) && !G.changeBet(state, 10), '換注後 10 步內不能再換');
  let steps = 0;
  while (state.betLock > 0 && steps < 400) {
    const dir = ['N', 'E', 'S', 'W'].find(d => {
      const x = state.x + G.DIRS[d][0], y = state.y + G.DIRS[d][1];
      return !G.terrainAt(state, x, y) && !G.objectAt(state, x, y);
    });
    if (G.move(state, dir)[0].type === 'step') steps++;
  }
  assert.equal(steps, 10, '走滿 10 步解鎖');
  assert.ok(G.canChangeBet(state, 10));
}

// ---- 錢不夠 ----
{
  const { state, dir } = arena({ balance: 5 });
  const events = G.move(state, dir);
  assert.equal(events[0].type, 'broke');
  assert.equal(state.balance, 5);
  G.topUp(state);
  assert.equal(state.balance, 1000);
}

// ---- 獎池的帳：派彩不超過花費的 95% 加上開場那一份 ----
{
  const random = seeded(99);
  const state = G.createGame({ random, balance: 1e9 });
  for (let i = 0; i < 20000; i++) {
    const action = casualBot(state, random);
    if (i % 97 === 0) G.changeBet(state, G.CONFIG.bets[Math.floor(random() * 4)]);
    G.move(state, action.move);
    assert.ok(state.pool >= -1e-6, '獎池不透支');
  }
  assert.ok(state.won <= state.spent * 0.95 + 115 * 10 + 1e-6);
}

// ---- RTP：憑感覺玩的機器人落在 95% 附近 ----
{
  const result = simulate(casualBot, 40000, 2026);
  // 上限是 95% 再加上開場獎池那一份攤到總花費的比例。
  assert.ok(result.rtp > 0.93 && result.rtp <= 0.95 + 1150 / result.spent + 1e-9, '憑感覺玩 RTP ' + result.rtp);
}

console.log('PASS: 骰子翻滾、地形、擺放、怪物三檔與擊退、寶箱次數、狀態、隨機藥水、重骰、毒潭、隨走隨補、沒有換波、傳送、換注鎖、獎池帳、RTP。');
