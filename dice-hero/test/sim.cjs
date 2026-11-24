// 機器人 RTP 模擬：在 dice-hero 資料夾執行 node test/sim.cjs [每種機器人走幾步] [亂數種子]
'use strict';
const G = require('../js/game.js');

const DIR_KEYS = ['N', 'S', 'E', 'W'];
const ORIENT_INDEX = new Map(G.ORIENTATIONS.map((die, index) => [die.top * 7 + die.front, index]));
const ORIENT_NEXT = G.ORIENTATIONS.map(die => DIR_KEYS.map(dir => {
  const next = G.rollDie(die, dir);
  return ORIENT_INDEX.get(next.top * 7 + next.front);
}));

function freeNeighbors(state, avoidObjects) {
  return DIR_KEYS.filter(dir => {
    const x = state.x + G.DIRS[dir][0], y = state.y + G.DIRS[dir][1];
    if (G.terrainAt(state, x, y)) return false;
    return !(avoidObjects && G.objectAt(state, x, y));
  });
}

function wander(state, random) {
  let options = freeNeighbors(state, true);
  if (!options.length) options = freeNeighbors(state, false);
  return options[Math.floor(random() * options.length)];
}

// 只看位置的最短路：回傳到每個物件的步數與第一步方向。
function pathsByPosition(state, limit) {
  const start = state.x + ',' + state.y;
  const seen = new Map([[start, null]]);
  let frontier = [[state.x, state.y, null]];
  const found = [];
  for (let depth = 1; depth <= limit && frontier.length; depth++) {
    const next = [];
    for (const [x, y, first] of frontier) {
      for (const dir of DIR_KEYS) {
        const nx = x + G.DIRS[dir][0], ny = y + G.DIRS[dir][1], key = nx + ',' + ny;
        if (seen.has(key) || G.terrainAt(state, nx, ny)) continue;
        seen.set(key, true);
        const object = G.objectAt(state, nx, ny);
        // 毒潭和重骰看得到又不會消失，沒有獎可拿，當成障礙繞開
        if (object && (object.type === 'swamp' || object.type === 'reroll')) continue;
        if (object) found.push({ object, depth, first: first || dir });
        else next.push([nx, ny, first || dir]);
      }
    }
    frontier = next;
  }
  return found;
}

// 亂走：完全不看目標。
function randomBot(state, random) {
  const options = freeNeighbors(state, false);
  return { move: options[Math.floor(random() * options.length)] };
}

// 憑感覺玩：走向最近的目標，不看骰面；場上沒目標了才去傳送點。
// options.skipTiers：看得出檔次的怪物裡，哪幾檔不去碰（例如 ['elite', 'boss']）。
function makeCasualBot(options) {
  const skip = (options && options.skipTiers) || [];
  return function (state, random) { return casualMove(state, random, skip); };
}
function casualBot(state, random) { return casualMove(state, random, []); }
function casualMove(state, random, skip) {
  const found = pathsByPosition(state, 16);
  const targets = found.filter(item => item.object.type !== 'teleport' &&
    !(item.object.type === 'monster' && !item.object.hidden && skip.includes(item.object.tier)));
  const list = targets.length ? targets : found;
  if (!list.length) return { move: wander(state, random) };
  let best = list[0];
  for (const item of list) if (item.depth < best.depth) best = item;
  return { move: best.first };
}

function monsterExpectation(config, value, factor) {
  let total = 0, expected = 0;
  config.monsterWeights.forEach((weight, index) => {
    total += weight;
    if (value > index + 1) expected += weight * config.monsterMults[index] * factor;
  });
  return expected / total;
}

// 會算的：追蹤整顆骰子，搜尋「到達時一定贏」的最短走法，挑每步期望報酬最高的目標。
// options.teleportValue：把傳送點當成值多少倍底注的目標（0＝不主動去）。
// options.switchBelow：最佳目標的每步報酬低於這個值且可以換注時，就換注刷新地圖。
function makeCalculatorBot(options) {
  const opts = Object.assign({ teleportValue: 0, switchBelow: 0, depth: 12 }, options);
  return function calculatorBot(state, random) {
    const config = state.config;
    const limit = opts.depth;
    const startOrient = ORIENT_INDEX.get(state.die.top * 7 + state.die.front);
    // 以骰子為中心的區域快取：0＝未查、1＝空地、2＝障礙、3＝有物件
    const R = opts.depth + 1, W = 2 * R + 1;
    const grid = new Uint8Array(W * W);
    const seenFlags = new Uint8Array(W * W * 24);
    const cellIndex = (x, y) => (x - state.x + R) * W + (y - state.y + R);
    const kindAt = (x, y) => {
      const index = cellIndex(x, y);
      if (!grid[index]) grid[index] = G.terrainAt(state, x, y) ? 2 : (G.objectAt(state, x, y) ? 3 : 1);
      return grid[index];
    };
    seenFlags[cellIndex(state.x, state.y) * 24 + startOrient] = 1;
    let frontier = [[state.x, state.y, startOrient, -1]];
    let best = null;
    for (let depth = 1; depth <= limit && frontier.length; depth++) {
      const next = [];
      const mod = (state.bless >= depth ? 1 : 0) - (state.curse >= depth ? 1 : 0);
      const cost = depth + Math.min(state.poison, depth);
      for (const [x, y, orient, first] of frontier) {
        for (let d = 0; d < 4; d++) {
          const dir = DIR_KEYS[d];
          const nx = x + G.DIRS[dir][0], ny = y + G.DIRS[dir][1];
          const kind = kindAt(nx, ny);
          if (kind === 2) continue;
          const nextOrient = ORIENT_NEXT[orient][d];
          const firstDir = first < 0 ? d : first;
          if (kind === 1) {
            const key = cellIndex(nx, ny) * 24 + nextOrient;
            if (!seenFlags[key]) { seenFlags[key] = 1; next.push([nx, ny, nextOrient, firstDir]); }
            continue;
          }
          const object = G.objectAt(state, nx, ny);
          const value = G.ORIENTATIONS[nextOrient].top + mod;
          let worth = 0;
          if (object.type === 'monster') {
            if (object.hidden) worth = monsterExpectation(config, value, config.hiddenMonsterFactor);
            else if (value > object.n) worth = object.mult;
          } else if (object.type === 'chest') {
            if (G.chestOpens(object.need, value)) worth = object.mult;
          } else if (object.type === 'teleport') worth = opts.teleportValue;
          if (worth <= 0) continue;
          const score = worth / cost;
          if (!best || score > best.score) best = { score, first: firstDir };
        }
      }
      frontier = next;
    }
    if (opts.switchBelow > 0 && state.betLock <= 0 && (!best || best.score < opts.switchBelow)) {
      const other = config.bets.find(bet => bet !== state.bet);
      return { bet: other };
    }
    if (best) return { move: DIR_KEYS[best.first] };
    return { move: wander(state, random) };
  };
}

function simulate(bot, steps, seed, configOverride) {
  const random = G.mulberry32(seed);
  const state = G.createGame({ random, balance: 1e12, config: configOverride });
  let taken = 0, guard = 0;
  // 各檔怪物的「不虧本擊殺」統計：從第一次出手算到打贏為止花了幾倍底注；
  // 中途改去碰別的東西、或怪物被換波收走，算放棄。
  const tiers = {};
  const tierRow = tier => tiers[tier] || (tiers[tier] = { fights: 0, kills: 0, noLoss: 0, abandoned: 0 });
  let engage = null;
  const drop = () => { if (engage) { tierRow(engage.tier).abandoned++; engage = null; } };
  while (taken < steps && guard < steps * 4) {
    guard++;
    const action = bot(state, random);
    if (action.bet !== undefined) { G.changeBet(state, action.bet); drop(); continue; }
    if (!action.move) break;
    const key = (state.x + G.DIRS[action.move][0]) + ',' + (state.y + G.DIRS[action.move][1]);
    const events = G.move(state, action.move);
    if (!events.length || events[0].type !== 'step') continue;
    taken++;
    const cost = events[0].cost / state.bet;
    if (engage) engage.cost += cost;
    const fight = events.find(event => event.type === 'fight');
    if (fight) {
      const tier = (fight.wasHidden ? 'dark-' : '') + fight.tier;
      if (!engage || engage.key !== key) { drop(); engage = { key, tier, cost }; tierRow(tier).fights++; }
      if (fight.win) {
        const row = tierRow(engage.tier);
        row.kills++;
        if (engage.cost <= fight.mult) row.noLoss++;
        engage = null;
      }
    } else if (events.some(event => ['chest', 'potion', 'teleport'].includes(event.type))) drop();
  }
  return { rtp: state.won / state.spent, spent: state.spent, won: state.won, waves: state.wave, tiers };
}

const BOTS = {
  '亂走': randomBot,
  '憑感覺玩': casualBot,
  '憑感覺＋不打 BOSS': makeCasualBot({ skipTiers: ['boss'] }),
  '憑感覺＋只打小怪': makeCasualBot({ skipTiers: ['elite', 'boss'] }),
  '會算的': makeCalculatorBot({}),
  '會算＋衝傳送點': makeCalculatorBot({ teleportValue: 6 }),
  '會算＋換注搭配傳送': makeCalculatorBot({ teleportValue: 6, switchBelow: 0.9 })
};

function runAll(steps, seed, configOverride) {
  const rows = {};
  for (const [name, bot] of Object.entries(BOTS)) rows[name] = simulate(bot, steps, seed, configOverride);
  return rows;
}

module.exports = { simulate, runAll, BOTS, randomBot, casualBot, makeCasualBot, makeCalculatorBot };

if (require.main === module) {
  const steps = Number(process.argv[2]) || 60000;
  const seed = Number(process.argv[3]) || 20261117;
  console.log('每種機器人走 ' + steps + ' 步，種子 ' + seed);
  const override = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
  const rows = runAll(steps, seed, override);
  for (const [name, row] of Object.entries(rows)) {
    console.log((row.rtp * 100).toFixed(1).padStart(6) + '%  ' + name + '（地圖重擺 ' + (row.waves - 1) + ' 次）');
  }
  console.log('憑感覺玩的各檔怪物（dark＝黑色版本）：出手幾隻／打贏比例／不虧本比例');
  for (const [tier, row] of Object.entries(rows['憑感覺玩'].tiers)) {
    console.log('  ' + tier.padEnd(11) + row.fights + ' 隻  打贏 ' + (row.kills / row.fights * 100).toFixed(0) + '%  不虧本 ' + (row.noLoss / row.fights * 100).toFixed(0) + '%');
  }
}
