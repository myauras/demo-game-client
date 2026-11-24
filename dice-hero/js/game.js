(function (root) {
  'use strict';

  // 所有可調數值集中在這裡；獎金一律是底注的倍數。
  const CONFIG = {
    bets: [10, 20, 50, 100],
    startBalance: 1000,
    // 換注後幾步內不能再換（傳送會提前解鎖）
    betLockSteps: 10,
    statusSteps: { bless: 15, curse: 15, poison: 5 },
    // 怪物分三檔：1～2 點小怪、3～4 點菁英、5 點 BOSS。要「大於」怪物點數才贏，平手算輸，
    // 所以沒有 6 點怪（永遠打不贏）；1 點怪要 2 點以上才贏，不是送錢。
    // knock＝打輸時除了退回上一格，還要再多退幾格。檔次只管外觀、擊退和大獎演出，獎金看點數。
    monsterTiers: {
      small: { knock: 0 },
      elite: { knock: 1 },
      boss: { knock: 2 }
    },
    // 怪物獎金倍數，依點數 1～5。小怪大約補路費、菁英有感、BOSS 是大獎；
    // 點數越高獎金越高，而且「獎金 × 亂打的勝率」也越高（1.7、2、3、3.3、5），越難打越划算。
    monsterMults: [2, 3, 6, 10, 30],
    hiddenMonsterFactor: 1.5,
    // 地圖寶箱三檔。weight 是基本權重；boost 是可發金額每多 richnessUnit 倍底注再加多少（最多算 3 份）。
    // 可發金額＝獎池扣掉場上已佔用的獎金：玩家拿回的比例偏低時獎池較滿，鐵箱、金箱才比較常出現。
    // tries＝最多嘗試幾次，用完就消失。
    chestTiers: {
      wood: { mult: 4, weight: 100, boost: 0, tries: 3 },
      iron: { mult: 6, weight: 0, boost: 12, tries: 2 },
      gold: { mult: 10, weight: 0, boost: 6, tries: 2 }
    },
    // 場上維持的數量。算的是骰子周圍一大圈（比畫面大），畫面內大約看得到四成。
    // 被吃掉或被拋到遠處的，只會補在畫面外。
    publicMonsters: 13,
    hiddenMonsters: 2,
    chests: 9,
    // 隨機藥水：看得到，喝下去隨機得到祝福或詛咒（各半）
    potions: 2,
    // 毒潭：看得到，踩上去中毒；踩過不會消失
    swamps: 2,
    // 重骰：看得到，踩上去骰子重骰成隨機的新朝向；踩過不會消失，可以重複踩
    rerolls: 2,
    // 兩個重骰之間至少隔幾格（直線距離）；找不到夠遠的空位就先不補
    rerollMinDistance: 10,
    publicTeleports: 1,
    teleportMinDistance: 8,
    // 怪物點數 1～6 的出現權重（6 點不出現）
    monsterWeights: [4, 4, 2, 2, 1, 0],
    // 獎池：每步花費的 poolRate 進獎池，派彩從獎池扣；每波目標的總額不超過獎池
    // poolMode：'unknown'＝獎池付不起的怪物、寶箱就先不擺（那格留空），等獎池回來再補；（名稱是舊的，以前付不起時改放「？」）
    //           'off'＝不用獎池
    poolMode: 'unknown',
    poolRate: 0.95,
    // 開場獎池設在獎池穩定時的水位附近（實測約 135～150 倍），不然開場擺不出足夠的怪物和寶箱
    poolStart: 115,
    // 獎池最多撥多少比例給場上的怪物和寶箱
    visibleShare: 1,
    // 獎池每多 richnessUnit 倍底注，鐵箱、金箱的出現權重多算一份（最多 3 份）
    richnessUnit: 60,
    // field＝維持目標的範圍（以骰子為中心：左右、前方、後方各幾格），超出就回收。
    // view＝畫面上可能看得到的範圍（照最高的直式畫面 430×880 量的，立起來的圖示會多露出一排）；
    // 走路途中補目標只補在 view 之外、field 之內。
    fieldHalfWidth: 6,
    fieldAhead: 13,
    fieldBehind: 8,
    viewHalfWidth: 5,
    viewAhead: 12,
    viewBehind: 7,
    spawnMinDistance: 2,
    // 地形：每個區塊最多一組山或森林，區塊邊緣留空當通道。
    chunkSize: 7,
    mountainChance: 0.4,
    forestChance: 0.4,
    // 森林：一整片相連，forestSize 格。
    forestSize: [8, 13],
    // 山脈：橫貫區塊的一段，中間留一格寬的隘口，把山脈分成一大一小兩座。
    // mountainBig／mountainSmall＝大山、小山那一側每一排的厚度（格）。
    mountainBig: [2, 3],
    mountainSmall: [1, 2],
    // 鄉村、城鎮：地圖上固定的地標，可以走上去，目前沒有任何作用。
    // 每 siteSpan × siteSpan 格放一個（大約每半徑 siteSpan／2 格遇到一個），其中 townShare 的比例是城鎮，其餘是鄉村。
    siteSpan: 24,
    townShare: 0.3,
    // 麥田：地標周圍那一圈八格裡連續的一段，wheatCount 格。純裝飾，可以走、可以擺東西。
    wheatCount: [2, 6],
    // 河流：每 riverSpan × riverSpan 個區塊算一個大區，每個大區有 riverChance 的機率出現一條河。
    // 河順著一個方向蜿蜒 riverLength 格，有 riverBranchChance 的機率從中段岔出一條 riverBranchLength 格的支流。
    // 河流經過的區塊不放山和森林。
    riverSpan: 3,
    riverChance: 0.8,
    riverLength: [14, 22],
    riverBranchChance: 0.4,
    riverBranchLength: [4, 8]
  };

  const DIRS = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

  // ---- 骰子：top＝朝上、front＝朝玩家（南）、right＝朝右（東）；對面相加為 7 ----
  function rollDie(die, dir) {
    const { top, front, right } = die;
    if (dir === 'N') return { top: front, front: 7 - top, right };
    if (dir === 'S') return { top: 7 - front, front: top, right };
    if (dir === 'E') return { top: 7 - right, front, right: top };
    if (dir === 'W') return { top: right, front, right: 7 - top };
    throw new RangeError('方向無效');
  }

  const ORIENTATIONS = (function () {
    const seen = new Map();
    const queue = [{ top: 1, front: 2, right: 3 }];
    seen.set('1,2', queue[0]);
    while (queue.length) {
      const die = queue.shift();
      for (const dir of Object.keys(DIRS)) {
        const next = rollDie(die, dir);
        const key = next.top + ',' + next.front;
        if (!seen.has(key)) { seen.set(key, next); queue.push(next); }
      }
    }
    return Array.from(seen.values());
  })();

  function randomDie(random) {
    return Object.assign({}, ORIENTATIONS[Math.floor(random() * ORIENTATIONS.length)]);
  }

  // ---- 地形 ----
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashChunk(region, cx, cy) {
    let h = (region ^ Math.imul(cx, 0x9E3779B1) ^ Math.imul(cy, 0x85EBCA77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function between(rand, range) {
    return range[0] + Math.floor(rand() * (range[1] - range[0] + 1));
  }

  // 一個大區（riverSpan × riverSpan 個區塊）裡的河：回傳 Set<"x,y">，座標是大區內的格子（0 起算）。
  // 河只往主流向前進或往兩旁拐，不回頭，所以是一條長帶；最外圈留空，河的兩頭一定繞得過去。
  function buildRiver(region, sx, sy, config) {
    const n = config.chunkSize * config.riverSpan;
    const rand = mulberry32(hashChunk((region ^ 0x51ED270B) >>> 0, sx, sy));
    const cells = new Set();
    if (rand() >= config.riverChance) return cells;
    const inside = (x, y) => x >= 1 && y >= 1 && x <= n - 2 && y <= n - 2;
    const horizontal = rand() < 0.5, sign = rand() < 0.5 ? 1 : -1;
    const forward = horizontal ? [sign, 0] : [0, sign];
    const sides = horizontal ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const around = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    // 新的一格周圍八格不能有別的河格（allow 列的除外：上一格、上上格）。
    // 這樣河維持一格寬，也不會自己或跟支流圍成圈。
    const fits = (x, y, allow) => {
      if (!inside(x, y) || cells.has(x + ',' + y)) return false;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const key = (x + dx) + ',' + (y + dy);
        if ((dx || dy) && cells.has(key) && !allow.includes(key)) return false;
      }
      return true;
    };
    // 從 (x, y) 的下一格開始走 length 格，回傳走出來的格子。
    // allow＝起點周圍可以貼著的河格；lean＝只往這一側拐（支流用，而且頭兩步一定先往旁邊走開）。
    const walk = (x, y, length, allow, lean) => {
      const path = [];
      let side = lean || null, run = 0, last = [x + ',' + y].concat(allow);
      for (let guard = 0; path.length < length && guard < length * 6; guard++) {
        let step = forward;
        if ((lean && path.length < 2) || (run < 3 && rand() < (lean ? 0.5 : 0.45))) {
          if (!side || (!lean && !run && rand() < 0.35)) side = sides[rand() < 0.5 ? 0 : 1];
          step = side;
        }
        if (!fits(x + step[0], y + step[1], last)) {
          if (step === forward || (lean && path.length < 2)) break;
          continue;
        }
        run = step === forward ? 0 : run + 1;
        const from = x + ',' + y;
        x += step[0]; y += step[1];
        cells.add(x + ',' + y);
        path.push([x, y]);
        last = [x + ',' + y, from];
      }
      return path;
    };
    // 起點靠主流向的上游那一側
    const along = sign > 0 ? 1 + Math.floor(rand() * 3) : n - 2 - Math.floor(rand() * 3);
    const across = 3 + Math.floor(rand() * (n - 6));
    const start = horizontal ? [along, across] : [across, along];
    cells.add(start.join(','));
    const main = [start].concat(walk(start[0], start[1], between(rand, config.riverLength) - 1, []));
    if (rand() < config.riverBranchChance && main.length >= 8) {
      // 支流：從中段挑一格往旁邊岔出去；長不出來（太短）就換個位置再試。
      const want = between(rand, config.riverBranchLength);
      for (let attempt = 0; attempt < 12; attempt++) {
        const index = Math.floor(main.length * (0.25 + rand() * 0.5));
        const from = main[index];
        const allow = [main[index - 1], main[index + 1]].filter(Boolean).map(cell => cell.join(','));
        const branch = walk(from[0], from[1], want, allow, sides[rand() < 0.5 ? 0 : 1]);
        if (branch.length >= config.riverBranchLength[0]) break;
        for (const cell of branch) cells.delete(cell.join(','));
      }
    }
    // 保險：被河圍住的空格也填成河，保證可走的格子互通。
    const reach = new Set(['0,0']);
    const queue = [[0, 0]];
    while (queue.length) {
      const [qx, qy] = queue.shift();
      for (const [dx, dy] of around) {
        const nx = qx + dx, ny = qy + dy, key = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || reach.has(key) || cells.has(key)) continue;
        reach.add(key); queue.push([nx, ny]);
      }
    }
    for (let ix = 0; ix < n; ix++) for (let iy = 0; iy < n; iy++) {
      if (!reach.has(ix + ',' + iy)) cells.add(ix + ',' + iy);
    }
    return cells;
  }

  // 回傳區塊內的障礙：Map<"lx,ly", 'mountain' | 'river' | 'forest'>
  function buildChunk(region, cx, cy, config) {
    const size = config.chunkSize;
    const cells = new Map();
    if (config.riverChance > 0) {
      const span = config.riverSpan, sx = Math.floor(cx / span), sy = Math.floor(cy / span);
      const ox = (cx - sx * span) * size, oy = (cy - sy * span) * size;
      for (const key of buildRiver(region, sx, sy, config)) {
        const [x, y] = key.split(',').map(Number);
        if (x >= ox && y >= oy && x < ox + size && y < oy + size) cells.set((x - ox) + ',' + (y - oy), 'river');
      }
      // 河流經過的區塊不放山和森林（山、河不相鄰，就不會合起來圍出走不進去的死角）。
      if (cells.size) return cells;
    }
    const rand = mulberry32(hashChunk(region, cx, cy));
    const inside = (x, y) => x >= 1 && y >= 1 && x <= size - 2 && y <= size - 2;
    const pick = rand();
    const steps = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let kind = null;
    if (pick < config.mountainChance + config.forestChance) {
      kind = pick < config.mountainChance ? 'mountain' : 'forest';
      if (kind === 'forest') {
        const target = between(rand, config.forestSize);
        const list = [[1 + Math.floor(rand() * (size - 2)), 1 + Math.floor(rand() * (size - 2))]];
        cells.set(list[0].join(','), kind);
        for (let guard = 0; cells.size < target && guard < 400; guard++) {
          const base = list[Math.floor(rand() * list.length)];
          const step = steps[Math.floor(rand() * 4)];
          const x = base[0] + step[0], y = base[1] + step[1];
          if (inside(x, y) && !cells.has(x + ',' + y)) { cells.set(x + ',' + y, kind); list.push([x, y]); }
        }
      } else {
        // 山脈沿著一個方向排過去，一排一排決定厚度和位置（相鄰兩排一定有重疊，山才連得起來）；
        // 隘口那一排整排留空，兩邊分別是大山和小山。
        const horizontal = rand() < 0.5, last = size - 2;
        const pass = 2 + Math.floor(rand() * (last - 2));
        const bigFirst = rand() < 0.5;
        let lo = null, hi = null;
        for (let a = 1; a <= last; a++) {
          if (a === pass) continue;
          const thick = between(rand, (a < pass) === bigFirst ? config.mountainBig : config.mountainSmall);
          const from = lo === null ? 1 : Math.max(1, lo - thick + 1), to = lo === null ? last - thick + 1 : Math.min(last - thick + 1, hi);
          lo = from + Math.floor(rand() * (to - from + 1)); hi = lo + thick - 1;
          for (let c = lo; c <= hi; c++) cells.set(horizontal ? a + ',' + c : c + ',' + a, kind);
        }
      }
    }
    if (kind) {
      // 被障礙完全圍住的空格也填成障礙，保證所有可走的格子互通。
      const reach = new Set(['0,0']);
      const queue = [[0, 0]];
      while (queue.length) {
        const [qx, qy] = queue.shift();
        for (const [dx, dy] of steps) {
          const nx = qx + dx, ny = qy + dy, key = nx + ',' + ny;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || reach.has(key) || cells.has(key)) continue;
          reach.add(key); queue.push([nx, ny]);
        }
      }
      for (let ix = 0; ix < size; ix++) for (let iy = 0; iy < size; iy++) {
        const key = ix + ',' + iy;
        if (!reach.has(key) && !cells.has(key)) cells.set(key, kind);
      }
    }
    return cells;
  }

  function terrainAt(state, x, y) {
    const size = state.config.chunkSize;
    const cx = Math.floor(x / size), cy = Math.floor(y / size);
    const key = cx + ',' + cy;
    let chunk = state.chunks.get(key);
    if (!chunk) { chunk = buildChunk(state.region, cx, cy, state.config); state.chunks.set(key, chunk); }
    return chunk.get((x - cx * size) + ',' + (y - cy * size)) || null;
  }

  // ---- 鄉村、城鎮 ----
  // 每 siteSpan × siteSpan 格的範圍裡有一個地標，位置和種類由區域種子決定（同一張地圖永遠在同一格）。
  // 只會落在可以走的格子上，而且不佔死角；怪物、寶箱那些東西不會擺在地標上。
  function siteIn(state, bx, by) {
    const sites = state.sites || (state.sites = new Map());
    const key = state.region + ':' + bx + ',' + by;
    if (sites.has(key)) return sites.get(key);
    const span = state.config.siteSpan;
    const rand = mulberry32(hashChunk((state.region ^ 0x7A3C91D5) >>> 0, bx, by));
    const kind = rand() < state.config.townShare ? 'town' : 'village';
    let site = null;
    for (let attempt = 0; attempt < 30 && !site; attempt++) {
      const x = bx * span + 2 + Math.floor(rand() * (span - 4)), y = by * span + 2 + Math.floor(rand() * (span - 4));
      if (!terrainAt(state, x, y) && !isNook(state, x, y)) site = { x, y, kind };
    }
    if (site) {
      // 麥田沿著周圍那一圈順著鋪（圈上相鄰的兩格一定邊靠邊），遇到山、河、森林就停，所以一定連成一片。
      const ring = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
      const want = between(rand, state.config.wheatCount), first = Math.floor(rand() * 8);
      site.wheat = new Set();
      for (let offset = 0; offset < 8 && !site.wheat.size; offset++) {
        for (let i = 0; i < want; i++) {
          const step = ring[(first + offset + i) % 8], wx = site.x + step[0], wy = site.y + step[1];
          if (terrainAt(state, wx, wy)) break;
          site.wheat.add(wx + ',' + wy);
        }
      }
    }
    sites.set(key, site);
    return site;
  }
  // 這一格是不是地標：回傳 'village'、'town' 或 null。
  function siteAt(state, x, y) {
    const span = state.config.siteSpan;
    if (!(span > 0)) return null;
    const site = siteIn(state, Math.floor(x / span), Math.floor(y / span));
    return site && site.x === x && site.y === y ? site.kind : null;
  }

  // 這一格是不是麥田。
  function wheatAt(state, x, y) {
    const span = state.config.siteSpan;
    if (!(span > 0)) return false;
    const site = siteIn(state, Math.floor(x / span), Math.floor(y / span));
    return !!site && site.wheat.has(x + ',' + y);
  }

  // ---- 一波的擺放 ----
  function weightedPick(random, entries) {
    let total = 0;
    for (const [, weight] of entries) total += weight;
    let roll = random() * total;
    for (const [value, weight] of entries) { roll -= weight; if (roll < 0) return value; }
    return entries[entries.length - 1][0];
  }

  function randomMonsterNumber(state) {
    return weightedPick(state.random, state.config.monsterWeights.map((weight, index) => [index + 1, weight]));
  }

  function monsterTier(n) { return n >= 5 ? 'boss' : n >= 3 ? 'elite' : 'small'; }

  // dark＝黑色版本（點數蓋著的隱藏怪），獎金乘 hiddenMonsterFactor。
  function makeMonster(state, dark, n) {
    const config = state.config;
    const number = n || randomMonsterNumber(state);
    const tier = monsterTier(number);
    return {
      type: 'monster', n: number, tier, hidden: dark, dark,
      mult: config.monsterMults[number - 1] * (dark ? config.hiddenMonsterFactor : 1)
    };
  }

  function shuffle(random, list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function inView(config, dx, dy) {
    return Math.abs(dx) <= config.viewHalfWidth && dy <= config.viewAhead && dy >= -config.viewBehind;
  }

  // field 範圍內可以擺目標的空格（不含障礙和已有東西的格子）；accept(dx, dy) 再篩一次。
  function freeCells(state, accept) {
    const config = state.config, cells = [];
    for (let dx = -config.fieldHalfWidth; dx <= config.fieldHalfWidth; dx++) {
      for (let dy = -config.fieldBehind; dy <= config.fieldAhead; dy++) {
        if (!accept(dx, dy)) continue;
        const x = state.x + dx, y = state.y + dy;
        if (terrainAt(state, x, y) || state.objects.has(x + ',' + y) || siteAt(state, x, y)) continue;
        cells.push([x, y]);
      }
    }
    return cells;
  }

  // 場上看得到的目標已經佔用的獎金（底注倍數）。
  function reservedOnBoard(state) {
    let sum = 0;
    for (const object of state.objects.values()) {
      if (object.type === 'monster') sum += object.mult;
      else if (object.type === 'chest') sum += object.mult;
    }
    return sum;
  }

  // 擺一個地圖寶箱：只挑獎池付得起的檔次，都付不起回傳 null。
  function makeChest(state, budget) {
    const config = state.config, random = state.random;
    const richness = budget === Infinity ? 1 : Math.min(3, Math.max(0, budget) / config.richnessUnit);
    const tiers = Object.keys(config.chestTiers).filter(tier => config.chestTiers[tier].mult <= budget)
      .map(tier => [tier, config.chestTiers[tier].weight + config.chestTiers[tier].boost * richness]);
    if (!tiers.length) return null;
    const tier = weightedPick(random, tiers);
    return { type: 'chest', tier, mult: config.chestTiers[tier].mult, need: random() < 0.5 ? 'big' : 'small', tries: config.chestTiers[tier].tries };
  }

  // 這一格是不是死角（本身可走，四個鄰格有三格是山、河或森林）。
  // 死角留給 BOSS 和金箱：照平常的機率抽到它們時優先擺進死角，其他東西不會放進去。
  function isNook(state, x, y) {
    if (terrainAt(state, x, y)) return false;
    let walls = 0;
    for (const dir in DIRS) if (terrainAt(state, x + DIRS[dir][0], y + DIRS[dir][1])) walls += 1;
    return walls === 3;
  }
  // 把怪物、寶箱、藥水、毒潭補到定額，從 cells 尾端取格子。
  // 怪物和寶箱的獎金總額不超過獎池撥給它們的份額；付不起的怪物先試小怪，再不行就先不擺。
  function fillTargets(state, cells) {
    const config = state.config, random = state.random;
    const quota = { public: config.publicMonsters, hidden: config.hiddenMonsters, chest: config.chests, potion: config.potions, swamp: config.swamps, reroll: config.rerolls };
    const counts = { public: 0, hidden: 0, chest: 0, potion: 0, swamp: 0, reroll: 0 };
    for (const object of state.objects.values()) {
      if (object.type === 'monster') counts[object.dark ? 'hidden' : 'public'] += 1;
      else if (object.type in counts) counts[object.type] += 1;
    }
    let budget = config.poolMode === 'off' ? Infinity
      : Math.max(0, state.pool) / state.bet * config.visibleShare - reservedOnBoard(state);
    const nooks = [];
    for (let i = cells.length - 1; i >= 0; i--) {
      if (isNook(state, cells[i][0], cells[i][1])) nooks.push(cells.splice(i, 1)[0]);
    }
    while (cells.length) {
      const lacking = Object.keys(quota).filter(kind => counts[kind] < quota[kind]).map(kind => [kind, quota[kind] - counts[kind]]);
      if (!lacking.length) break;
      const kind = weightedPick(random, lacking);
      let object, worth = 0;
      if (kind === 'chest') {
        object = makeChest(state, budget);
        worth = object ? object.mult : Infinity;
      } else if (kind === 'potion' || kind === 'swamp' || kind === 'reroll') {
        object = { type: kind };
      } else {
        // 抽到付不起的怪物就先記著，等獎池夠了再擺同一隻（不換成便宜的，不然場上只會剩小怪）。
        const waiting = state.waiting || (state.waiting = {});
        object = waiting[kind] || makeMonster(state, kind === 'hidden');
        worth = object.mult;
        waiting[kind] = worth > budget ? object : null;
      }
      // 獎池付不起：這一種這次先不補（那格留空），等獎池回來再補。
      if (worth > budget) { quota[kind] = counts[kind]; continue; }
      if (kind === 'swamp' || kind === 'reroll') {
        // 毒潭和重骰不會消失，所以只擺在空曠的地方（周圍八格都沒有山、河、森林），不然可能堵住唯一的通道，逼玩家非踩不可。
        // 重骰另外要跟場上其他重骰保持距離，不然兩個靠在一起等於隨時都能重骰。
        const others = [];
        if (kind === 'reroll') {
          for (const [key, other] of state.objects) if (other.type === 'reroll') others.push(key.split(',').map(Number));
        }
        const apart = config.rerollMinDistance * config.rerollMinDistance;
        let at = -1;
        for (let i = cells.length - 1; i >= 0 && at < 0; i--) {
          let open = !others.some(o => (o[0] - cells[i][0]) ** 2 + (o[1] - cells[i][1]) ** 2 < apart);
          for (let dx = -1; dx <= 1 && open; dx++) for (let dy = -1; dy <= 1; dy++) {
            if (terrainAt(state, cells[i][0] + dx, cells[i][1] + dy)) { open = false; break; }
          }
          if (open) at = i;
        }
        if (at < 0) { quota[kind] = counts[kind]; continue; }
        counts[kind] += 1;
        state.objects.set(cells.splice(at, 1)[0].join(','), object);
        continue;
      }
      budget -= worth;
      counts[kind] += 1;
      const prize = (object.type === 'monster' && object.tier === 'boss' && !object.dark) || (object.type === 'chest' && object.tier === 'gold');
      state.objects.set((prize && nooks.length ? nooks : cells).pop().join(','), object);
    }
  }

  // 走完一步後：回收被拋到遠處的目標，再把缺的補在畫面外，優先補在前進方向那一側。
  function refreshTargets(state, dir) {
    const config = state.config, random = state.random;
    let teleports = 0;
    for (const [key, object] of state.objects) {
      const [x, y] = key.split(',').map(Number);
      const dx = x - state.x, dy = y - state.y;
      if (Math.abs(dx) > config.fieldHalfWidth || dy > config.fieldAhead || dy < -config.fieldBehind) state.objects.delete(key);
      else if (object.type === 'teleport') teleports += 1;
    }
    const delta = DIRS[dir];
    const ahead = cell => {
      const dx = cell[0] - state.x, dy = cell[1] - state.y;
      if (delta[0]) return dx * delta[0] > config.viewHalfWidth;
      return delta[1] > 0 ? dy > config.viewAhead : dy < -config.viewBehind;
    };
    const all = freeCells(state, (dx, dy) => !inView(config, dx, dy));
    // 取用順序從尾端開始，所以前進方向外側的格子排在後面。
    const cells = shuffle(random, all.filter(cell => !ahead(cell))).concat(shuffle(random, all.filter(ahead)));
    for (; teleports < config.publicTeleports && cells.length; teleports++) {
      state.objects.set(cells.pop().join(','), { type: 'teleport' });
    }
    fillTargets(state, cells);
  }

  function startWave(state, reason) {
    const config = state.config, random = state.random;
    state.objects = new Map();
    state.wave += 1;
    if (reason !== 'bet') state.betLock = 0;
    // 開場整個範圍一起擺（畫面內也擺）。公開傳送點要讓玩家看得到，所以只挑畫面中間那一塊的遠處。
    const near = [], far = [];
    for (const cell of freeCells(state, (dx, dy) => Math.abs(dx) + Math.abs(dy) >= config.spawnMinDistance)) {
      const dx = cell[0] - state.x, dy = cell[1] - state.y;
      const core = Math.abs(dx) <= config.viewHalfWidth - 2 && dy <= config.viewAhead - 2 && dy >= 1 - config.viewBehind;
      (core && Math.abs(dx) + Math.abs(dy) >= config.teleportMinDistance ? far : near).push(cell);
    }
    shuffle(random, near); shuffle(random, far);
    for (let i = 0; i < config.publicTeleports; i++) {
      // 沒有合適的空格時，退而求其次放在整個範圍裡最遠的空格。
      if (!far.length) near.sort((p, q) => (Math.abs(p[0] - state.x) + Math.abs(p[1] - state.y)) - (Math.abs(q[0] - state.x) + Math.abs(q[1] - state.y)));
      const cell = far.pop() || near.pop();
      if (cell) state.objects.set(cell.join(','), { type: 'teleport' });
    }
    fillTargets(state, shuffle(random, near.concat(far)));
  }

  function createGame(options) {
    const opts = options || {};
    const config = Object.assign({}, CONFIG, opts.config || {});
    const random = opts.random || Math.random;
    const bet = opts.bet === undefined ? config.bets[0] : opts.bet;
    if (!config.bets.includes(bet)) throw new RangeError('底注無效');
    const balance = opts.balance === undefined ? config.startBalance : opts.balance;
    if (!Number.isFinite(balance) || balance < 0) throw new RangeError('點數無效');
    const state = {
      config, random, bet, balance,
      betLock: 0,
      x: 0, y: 0,
      die: randomDie(random),
      region: Math.floor(random() * 4294967296) >>> 0,
      chunks: new Map(),
      objects: new Map(),
      wave: 0,
      bless: 0, curse: 0, poison: 0,
      spent: 0, won: 0,
      pool: opts.pool === undefined ? config.poolStart * bet : opts.pool
    };
    startWave(state, 'start');
    return state;
  }

  function modifier(state) { return (state.bless > 0 ? 1 : 0) - (state.curse > 0 ? 1 : 0); }
  function points(state) { return state.die.top + modifier(state); }
  function stepCost(state) { return state.bet * (state.poison > 0 ? 2 : 1); }
  function objectAt(state, x, y) { return state.objects.get(x + ',' + y) || null; }
  function chestOpens(need, value) { return need === 'big' ? value >= 4 : value <= 3; }

  // big＝要不要播大獎演出：只有打贏 BOSS 和開出金箱才播，跟獎金倍數無關。
  function pay(state, mult, events, event, big) {
    const payout = Math.round(state.bet * mult);
    state.balance += payout; state.won += payout; state.pool -= payout;
    event.payout = payout; event.mult = mult;
    event.bigWin = !!big;
    events.push(event);
  }

  // 換一塊新區域：山、河、森林全部重新產生。
  function newRegion(state) {
    state.region = Math.floor(state.random() * 4294967296) >>> 0;
    state.chunks = new Map();
    // 新區域的落點若剛好是障礙，往東找第一個空格。
    while (terrainAt(state, state.x, state.y)) state.x += 1;
  }

  function teleport(state, events) {
    newRegion(state);
    startWave(state, 'teleport');
    events.push({ type: 'teleport' });
  }

  // 走一步。回傳事件清單給畫面演出；規則全部在這裡結算。
  function move(state, dir) {
    const delta = DIRS[dir];
    if (!delta) throw new RangeError('方向無效');
    const events = [];
    const tx = state.x + delta[0], ty = state.y + delta[1];
    const terrain = terrainAt(state, tx, ty);
    if (terrain) { events.push({ type: 'bump', dir, terrain }); return events; }
    const cost = stepCost(state);
    if (state.balance < cost) { events.push({ type: 'broke', cost }); return events; }

    const fromX = state.x, fromY = state.y;
    state.balance -= cost; state.spent += cost; state.pool += cost * state.config.poolRate;
    if (state.betLock > 0) state.betLock -= 1;
    state.die = rollDie(state.die, dir);
    state.x = tx; state.y = ty;
    events.push({ type: 'step', dir, cost, die: Object.assign({}, state.die) });

    const key = tx + ',' + ty;
    let object = state.objects.get(key) || null;
    const gained = {};
    let teleported = false;
    const value = points(state);

    // 退回去並重骰。distance＝最多退幾格（1＝上一格）：撞到障礙就停，落點有東西就少退一點。
    const bounce = distance => {
      let x = fromX, y = fromY;
      for (let i = 2; i <= distance; i++) {
        const nx = tx - delta[0] * i, ny = ty - delta[1] * i;
        if (terrainAt(state, nx, ny)) break;
        if (!state.objects.has(nx + ',' + ny)) { x = nx; y = ny; }
      }
      state.x = x; state.y = y;
      state.die = randomDie(state.random);
      events.push({ type: 'bounce', die: Object.assign({}, state.die), x, y, distance: Math.abs(x - tx) + Math.abs(y - ty) });
    };
    const fight = monster => {
      const win = value > monster.n;
      const wasHidden = monster.hidden;
      monster.hidden = false;
      const info = { type: 'fight', win, n: monster.n, tier: monster.tier, dark: monster.dark, points: value, wasHidden };
      if (win) {
        state.objects.delete(key);
        pay(state, monster.mult, events, info, monster.tier === 'boss');
      } else {
        events.push(info);
        bounce(1 + state.config.monsterTiers[monster.tier].knock);
      }
    };

    if (object && object.type === 'monster') {
      fight(object);
    } else if (object && object.type === 'chest') {
      const win = chestOpens(object.need, value);
      if (win) {
        state.objects.delete(key);
        pay(state, object.mult, events, { type: 'chest', win: true, tier: object.tier, need: object.need, points: value }, object.tier === 'gold');
      } else {
        object.tries -= 1;
        if (object.tries <= 0) state.objects.delete(key);
        events.push({ type: 'chest', win: false, tier: object.tier, need: object.need, points: value, triesLeft: object.tries });
        bounce(1);
      }
    } else if (object && object.type === 'potion') {
      const outcome = state.random() < 0.5 ? 'bless' : 'curse';
      state.objects.delete(key);
      gained[outcome] = true;
      events.push({ type: 'potion', outcome });
      events.push({ type: 'status', kind: outcome, steps: state.config.statusSteps[outcome] });
    } else if (!object && siteAt(state, tx, ty)) {
      // 鄉村、城鎮：目前沒有作用，只回報走到了哪裡。
      events.push({ type: 'place', kind: siteAt(state, tx, ty) });
    } else if (object && object.type === 'reroll') {
      // 重骰：骰子換成隨機的新朝向，地塊留著，可以走開再踩回來
      state.die = randomDie(state.random);
      events.push({ type: 'reroll', die: Object.assign({}, state.die) });
    } else if (object && object.type === 'swamp') {
      // 毒潭：踩上去中毒，踩過不會消失
      gained.poison = true;
      events.push({ type: 'swamp' });
      events.push({ type: 'status', kind: 'poison', steps: state.config.statusSteps.poison });
    } else if (object && object.type === 'teleport') {
      state.objects.delete(key);
      teleported = true;
    }

    // 祝福和詛咒互相取代：拿到其中一個，另一個立刻消失。
    if (gained.bless) state.curse = 0;
    if (gained.curse) state.bless = 0;
    for (const kind of ['bless', 'curse', 'poison']) {
      if (gained[kind]) state[kind] = state.config.statusSteps[kind];
      else if (state[kind] > 0) state[kind] -= 1;
    }

    if (teleported) teleport(state, events);
    else refreshTargets(state, dir);
    return events;
  }

  function canChangeBet(state, bet) {
    return state.config.bets.includes(bet) && bet !== state.bet && state.betLock <= 0;
  }

  // 換注：立刻刷新整張地圖（目標和地形都換），之後 betLockSteps 步內不能再換（傳送會提前解鎖）。
  function changeBet(state, bet) {
    if (!canChangeBet(state, bet)) return false;
    state.bet = bet;
    newRegion(state);
    startWave(state, 'bet');
    state.betLock = state.config.betLockSteps;
    return true;
  }

  function topUp(state) { state.balance = state.config.startBalance; }

  const api = {
    CONFIG, DIRS, ORIENTATIONS,
    rollDie, randomDie, mulberry32, buildChunk, buildRiver, isNook, siteAt, wheatAt,
    createGame, move, changeBet, canChangeBet, topUp,
    terrainAt, objectAt, points, modifier, stepCost, chestOpens, monsterTier
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiceHero = api;
})(typeof window === 'undefined' ? globalThis : window);
