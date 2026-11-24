'use strict';
(function () {
  const G = window.DiceHero;
  const $ = id => document.getElementById(id);
  const storageKey = 'dice-hero-demo-v1';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const format = value => Math.round(value).toLocaleString('en-US');

  // ---- 讀檔：點數、獎池、底注、風格存在本機；地圖每次重新開始 ----
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch (_) { /* 不能儲存時當次仍可玩 */ }
  const options = {};
  if (Number.isFinite(saved.balance) && saved.balance >= 0) options.balance = saved.balance;
  if (Number.isFinite(saved.pool)) options.pool = saved.pool;
  if (G.CONFIG.bets.includes(saved.bet)) options.bet = saved.bet;
  const state = G.createGame(options);
  let theme = saved.theme === 'pixel' ? 'pixel' : 'geo';
  let busy = false;
  let shownBalance = state.balance;
  const view = { x: state.x, y: state.y };

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ balance: state.balance, pool: state.pool, bet: state.bet, theme }));
    } catch (_) { /* 忽略 */ }
  }

  // ---- 圖示：幾何風用向量圖，像素風用 8×8 點陣 ----
  const PIXELS = {
    small: ['........', '..XXXX..', '.XXXXXX.', '.XwXXwX.', '.XkXXkX.', '.XXXXXX.', '.XXXXXX.', '.X.XX.X.'],
    elite: ['X......X', 'XX....XX', '.XXXXXX.', 'XXwXXwXX', 'XXkXXkXX', 'XXXXXXXX', 'XXXXXXXX', 'XX.XX.XX'],
    boss: ['g.g..g.g', 'gggggggg', 'XXXXXXXX', 'XwwXXwwX', 'XkkXXkkX', 'XXXXXXXX', 'XXXXXXXX', 'XX.XX.XX'],
    chest: ['........', '.dddddd.', 'dXXXXXXd', 'dXXXXXXd', 'dddkkddd', 'dXXkkXXd', 'dXXXXXXd', 'dddddddd'],
    potion: ['..kkkk..', '...ww...', '...XX...', '..XXXX..', '.XwXXXX.', '.XXXXXX.', '.XXXXXX.', '..XXXX..'],
    village: ['...XX.k.', '..XXXXk.', '.XXXXXX.', 'XXXXXXXX', '.wwwwww.', '.wkwwkw.', '.wwkkww.', '.wwkkww.'],
    town: ['...bb...', '..bbbb..', '...wk...', '.r.ww.r.', 'rrrwwrrr', 'wwwwwwww', 'wkwkkwkw', 'wwwkkwww'],
    teleport: ['..XXXX..', '.X....X.', 'X..XX..X', 'X.X..X.X', 'X.X..X.X', 'X..XX..X', '.X....X.', '..XXXX..'],
    mountain: ['...ww...', '...ww...', '..wXXw..', '..XXXX..', '.XXXXXX.', '.XXdXXX.', 'XXddXXXX', 'XdddXXXX'],
    forest: ['..XX....', '.XXXX.X.', 'XXXXXXXX', '.XXXXXXX', '..kk.XXX', '..kk..k.', '..kk..k.', '........'],
    reroll: ['..XXXX..', '.X....XX', 'X..kk..X', 'X.kwwk..', '..kwwk.X', 'X..kk..X', 'XX....X.', '..XXXX..'],
    swamp: ['........', '..XXXX..', '.XXpXXX.', 'XXXXXXpX', 'XpXXXXXX', 'XXXXpXX.', '.XXXXX..', '........'],
    river: ['........', 'ww...ww.', '..www..w', '........', '.ww...ww', 'w..www..', '........', '........']
  };
  function pixelIcon(name, color) {
    const palette = { X: color, w: '#ffffff', k: '#16161e', d: 'rgba(0,0,0,0.35)', g: '#ffd040', p: '#b6ff5c', r: '#d9534f', b: '#4a7fc1' };
    let rects = '';
    PIXELS[name].forEach((row, y) => {
      for (let x = 0; x < 8; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        if (ch === 'd') rects += '<rect x="' + x + '" y="' + y + '" width="1.02" height="1.02" fill="' + color + '"/>';
        rects += '<rect x="' + x + '" y="' + y + '" width="1.02" height="1.02" fill="' + palette[ch] + '"/>';
      }
    });
    return '<svg viewBox="0 0 8 8" shape-rendering="crispEdges">' + rects + '</svg>';
  }
  const GEO = {
    small: c => '<g transform="translate(3.2 6.4) scale(0.8)">' + GHOST(c) + '</g>',
    elite: c => '<path d="M8.5 8.5L5.5 1l7 4.5zM23.5 8.5l3-7.5-7 4.5z" fill="' + c + '"/>' + GHOST(c),
    boss: c => '<g transform="translate(-1.6 -2.8) scale(1.1)"><path d="M8.5 8.5L5.5 1l7 4.5zM23.5 8.5l3-7.5-7 4.5z" fill="' + c + '"/>' + GHOST(c) +
      '<path d="M10 4.6l1-5 2.6 2.8L16-1.2l2.4 3.6L21-.4l1 5z" fill="#ffd166" stroke="#7a4a00" stroke-width=".6"/></g>',
    chest: c => '<rect x="4" y="9" width="24" height="19" rx="3" fill="' + c + '"/><path d="M4 16h24" stroke="rgba(0,0,0,.35)" stroke-width="2"/><rect x="14" y="13" width="4" height="6" rx="1" fill="rgba(0,0,0,.45)"/>',
    potion: c => '<rect x="12.5" y="3" width="7" height="3.5" rx="1" fill="#c9a06a"/><path d="M13.5 6.5h5v6a9 9 0 1 1-5 0z" fill="' + c + '"/>' +
      '<path d="M9.2 20a7 7 0 0 1 3-5.4" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.8" stroke-linecap="round"/>',
    village: c => '<rect x="21" y="5" width="3.5" height="7" fill="#8a5a3a"/><path d="M2 16L16 3l14 13z" fill="' + c + '"/>' +
      '<rect x="6" y="16" width="20" height="12" fill="#f3e6c8"/><rect x="13.5" y="20" width="5" height="8" fill="#6b4a2b"/>' +
      '<rect x="8" y="18.5" width="3.5" height="3.5" fill="#7fb7e6"/><rect x="20.5" y="18.5" width="3.5" height="3.5" fill="#7fb7e6"/>',
    // 城鎮：中間一座鐘樓，兩旁各一間房子
    town: () => '<rect x="13" y="8" width="6" height="20" fill="#e9d9b0"/><path d="M12 8l4-7 4 7z" fill="#4a7fc1"/><circle cx="16" cy="12.5" r="2" fill="#fff" stroke="#6b4a2b" stroke-width=".6"/>' +
      '<rect x="3" y="18" width="10" height="10" fill="#f3e6c8"/><path d="M2 18l6-5 6 5z" fill="#d9534f"/><rect x="19" y="18" width="10" height="10" fill="#f3e6c8"/><path d="M18 18l6-5 6 5z" fill="#d9534f"/>' +
      '<rect x="14.5" y="22" width="3" height="6" fill="#6b4a2b"/><rect x="6" y="21" width="3" height="3" fill="#7fb7e6"/><rect x="23" y="21" width="3" height="3" fill="#7fb7e6"/>',
    teleport: c => '<circle cx="16" cy="17" r="11" fill="none" stroke="' + c + '" stroke-width="3"/><circle cx="16" cy="17" r="5.5" fill="none" stroke="' + c + '" stroke-width="3"/><circle cx="16" cy="17" r="1.5" fill="' + c + '"/>',
    mountain: c => '<path d="M2 28L12 8l6 10 3-5 9 15z" fill="' + c + '"/><path d="M12 8l-3 6 3-1.5 3 2z" fill="#fff"/>',
    forest: c => '<path d="M10 28v-5H3.5l4.5-6H5.5L11 9.5 16.5 17H14l4.5 6H12v5z" fill="' + c + '"/>' +
      '<path d="M21.5 28v-4h-5l3.6-5h-2l4.4-6 4.4 6h-2l3.6 5h-5v4z" fill="' + c + '" opacity=".8"/>',
    // 重骰：兩個繞圈的箭頭圍著一顆小骰子
    reroll: c => '<g fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"><path d="M26 14a10.5 10.5 0 0 0-19-4.5"/><path d="M6 18a10.5 10.5 0 0 0 19 4.5"/></g>' +
      '<path d="M4.2 4.5l2.4 6 5.6-2.6z" fill="' + c + '"/><path d="M27.8 27.5l-2.4-6-5.6 2.6z" fill="' + c + '"/>' +
      '<rect x="11.5" y="11.5" width="9" height="9" rx="1.6" fill="' + c + '"/><circle cx="14" cy="14" r="1.1" fill="#16161e"/><circle cx="18" cy="18" r="1.1" fill="#16161e"/><circle cx="16" cy="16" r="1.1" fill="#16161e"/>',
    swamp: c => '<path d="M5 18c-2-6 3-11 9-10 3-4 11-2 12 3 4 2 4 9-1 11-2 5-10 5-13 2-4 1-7-2-7-6z" fill="' + c + '" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>' +
      '<g fill="#b6ff5c"><circle cx="12" cy="17" r="2.4"/><circle cx="20" cy="13" r="1.7"/><circle cx="19" cy="20.5" r="1.3"/></g>',
    river: () => '<path d="M3 11q5-5 10 0t10 0 6 0M3 21q5-5 10 0t10 0 6 0" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2.4" stroke-linecap="round"/>'
  };
  function GHOST(c) {
    return '<path d="M5 28V15a11 11 0 0 1 22 0v13l-3.7-3-3.6 3-3.7-3-3.7 3-3.6-3z" fill="' + c + '"/><circle cx="12" cy="11.5" r="2" fill="#fff"/><circle cx="20" cy="11.5" r="2" fill="#fff"/>';
  }
  // colorName：顏色用哪個 CSS 變數，省略時跟圖示同名。
  function icon(name, colorName) {
    const color = getComputedStyle($('shell')).getPropertyValue('--' + (colorName || name)).trim() || '#fff';
    if (theme === 'pixel') return pixelIcon(name, color);
    return '<svg viewBox="0 0 32 32">' + GEO[name](color) + '</svg>';
  }
  // 怪物三檔各有樣式。點數還蓋著的怪（隱藏怪）一律畫成黑色小怪；
  // 點數揭曉後換回它實際檔次的樣式和顏色（獎金仍是 1.5 倍）。
  function monsterLook(tier, dark, hidden) {
    const shape = hidden ? 'small' : tier;
    return {
      classes: 'prop monster ' + shape + (hidden ? ' dark' : ''),
      html: icon(shape, hidden ? 'monster-dark' : 'monster-' + shape)
    };
  }
  function triesHtml(left, tier) {
    let dots = '';
    for (let i = 0; i < G.CONFIG.chestTiers[tier].tries; i++) dots += '<i' + (i < left ? ' class="on"' : '') + '></i>';
    return '<span class="tries" aria-label="還能試 ' + left + ' 次">' + dots + '</span>';
  }
  const CHEST_NAMES = { wood: '木箱', iron: '鐵箱', gold: '金箱' };
  function propClass(object) {
    if (object.type === 'chest') return 'prop chest ' + object.tier;
    return object.type === 'monster' ? monsterLook(object.tier, object.dark, object.hidden).classes : 'prop ' + object.type;
  }
  function propHtml(object) {
    if (object.type === 'monster') return monsterLook(object.tier, object.dark, object.hidden).html + '<span class="label">' + (object.hidden ? '?' : object.n) + '</span>';
    if (object.type === 'chest') return icon('chest', 'chest-' + object.tier) + '<span class="label">' + (object.need === 'big' ? '大' : '小') + '</span>' + triesHtml(object.tries, object.tier);
    if (object.type === 'potion') return icon('potion') + '<span class="label">?</span>';
    return icon('teleport');
  }

  // ---- 地圖 ----
  const world = $('world');
  const place = (x, y) => 'left:calc(var(--cell)*' + x + ');top:calc(var(--cell)*' + (-y) + ');';
  function setWorld(instant) {
    world.classList.toggle('instant', !!instant);
    world.style.transform = 'translate(calc(var(--cell)*' + (-view.x) + '),calc(var(--cell)*' + view.y + '))';
    if (instant) void world.offsetWidth;
  }
  // entering＝所有目標都播落下動畫（換波、傳送、換注）。走路途中補的目標都在畫面外，不播。
  // keepView＝不移動鏡頭（被擊退時先把落點附近畫出來，再讓鏡頭滑過去）。
  // origin＝藍色虛線（可以走的格子）圍著哪一格畫，省略時是骰子現在的位置。
  function renderWorld(entering, keepView, origin) {
    const centre = origin || state;
    let html = '';
    const adjacent = {};
    for (const [dir, delta] of Object.entries(G.DIRS)) adjacent[(centre.x + delta[0]) + ',' + (centre.y + delta[1])] = dir;
    for (let y = state.y + 13; y >= state.y - 8; y--) {
      for (let x = state.x - 6; x <= state.x + 6; x++) {
        const key = x + ',' + y;
        const terrain = G.terrainAt(state, x, y);
        const object = G.objectAt(state, x, y);
        let classes = 'cell', attrs = '', inner = '';
        if (terrain) classes += ' ' + terrain;
        else if (G.wheatAt(state, x, y)) classes += ' wheat';
        if (adjacent[key]) { classes += ' adj'; attrs = ' data-dir="' + adjacent[key] + '"'; }
        if (terrain === 'mountain' || terrain === 'forest') inner = '<div class="prop mountain">' + icon(terrain) + '</div>';
        else if (terrain === 'river') inner = icon('river');
        // 鄉村、城鎮：地圖上固定的地標，立起來畫
        else if (!object && G.siteAt(state, x, y)) inner = '<div class="prop site">' + icon(G.siteAt(state, x, y)) + '</div>';
        // 毒潭平貼在地上，踩過不會消失
        else if (object && object.type === 'swamp') { classes += ' swamp'; inner = icon('swamp'); }
        // 重骰也是平貼在地上、踩過不會消失
        else if (object && object.type === 'reroll') { classes += ' reroll'; inner = icon('reroll'); }
        else if (object) inner = '<div class="' + propClass(object) + (entering ? ' enter' : '') + '" data-key="' + key + '">' + propHtml(object) + '</div>';
        html += '<div class="' + classes + '"' + attrs + ' style="' + place(x, y) + '">' + inner + '</div>';
      }
    }
    world.innerHTML = html;
    if (keepView) return;
    view.x = state.x; view.y = state.y;
    setWorld(true);
  }
  const propAt = (x, y) => world.querySelector('.prop[data-key="' + x + ',' + y + '"]');

  // ---- 骰子 ----
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const cube = $('cube');
  const faces = {};
  for (const name of ['top', 'bottom', 'south', 'north', 'east', 'west']) faces[name] = cube.querySelector('.f-' + name);
  function setFace(element, value) {
    let html = '';
    for (let i = 0; i < 9; i++) html += '<i' + (PIPS[value].includes(i) ? ' class="on"' : '') + '></i>';
    element.innerHTML = html;
  }
  const BASE = 'translateZ(calc(var(--die) / 2))';
  // 六個面的點數只畫一次、之後不再重畫；骰子朝哪邊，靠整顆的立體朝向（一個旋轉矩陣）來表現。
  // 這樣滾完之後每一面的點數排列會維持滾過去的樣子，不會跳回預設的排法。
  const BODY = G.ORIENTATIONS[0];
  setFace(faces.top, BODY.top); setFace(faces.bottom, 7 - BODY.top);
  setFace(faces.south, BODY.front); setFace(faces.north, 7 - BODY.front);
  setFace(faces.east, BODY.right); setFace(faces.west, 7 - BODY.right);
  // 點數 v 在這個朝向下指向哪裡（畫面座標：x 往東、y 往南、z 往上）。
  function facing(die, value) {
    if (value === die.right) return [1, 0, 0];
    if (value === 7 - die.right) return [-1, 0, 0];
    if (value === die.front) return [0, 1, 0];
    if (value === 7 - die.front) return [0, -1, 0];
    return value === die.top ? [0, 0, 1] : [0, 0, -1];
  }
  // 把骰子本體轉到這個朝向的旋轉矩陣（寫成 CSS 的 matrix3d）。
  function orientOf(die) {
    const cx = facing(die, BODY.right), cy = facing(die, BODY.front), cz = facing(die, BODY.top);
    return 'matrix3d(' + cx.join(',') + ',0,' + cy.join(',') + ',0,' + cz.join(',') + ',0,0,0,0,1)';
  }
  let orient = orientOf(BODY);
  function renderDie(die) {
    orient = orientOf(die);
    cube.style.transform = BASE + ' ' + orient;
  }
  // 骰子的動畫都經過這裡：每個影格後面接上骰子的朝向（影格自己帶 orient 的用它的，否則用現在的）。
  function animateCube(frames, options) {
    return cube.animate(frames.map(frame => {
      const copy = Object.assign({}, frame);
      copy.transform = frame.transform + ' ' + (frame.orient || orient);
      delete copy.orient;
      return copy;
    }), options);
  }
  const ROLL = { N: 'rotateX(90deg)', S: 'rotateX(-90deg)', E: 'rotateY(90deg)', W: 'rotateY(-90deg)' };
  const HALF = { N: 'rotateX(45deg)', S: 'rotateX(-45deg)', E: 'rotateY(45deg)', W: 'rotateY(-45deg)' };
  const LIFT = 'translateZ(calc(var(--die) * 0.21))';
  // 滾到 p 成（0～1）時骰子的姿勢
  function rollPose(dir, p) {
    const axis = dir === 'N' || dir === 'S' ? 'rotateX' : 'rotateY';
    const sign = dir === 'N' || dir === 'E' ? 1 : -1;
    // 繞著貼地的那條邊翻，中心高度照實算（慢動作時邊才會一直貼著地）
    const lift = Math.SQRT1_2 * Math.sin((45 + 90 * p) * Math.PI / 180) - 0.5;
    return 'translateZ(calc(var(--die) * ' + lift.toFixed(4) + ')) ' + BASE + ' ' + axis + '(' + (90 * p * sign) + 'deg)';
  }
  // 只滾其中一段（a 成到 b 成），滾完停在那個姿勢，等下一段接手。
  let held = null;
  function release() { if (held) held.cancel(); held = null; }
  async function rollPart(dir, a, b, ms, easing) {
    const frames = [{ transform: rollPose(dir, a), offset: 0 }];
    if (a < 0.5 && b > 0.5) frames.push({ transform: rollPose(dir, 0.5), offset: (0.5 - a) / (b - a) });
    frames.push({ transform: rollPose(dir, b), offset: 1 });
    const animation = animateCube(frames, { duration: ms, easing: easing || 'linear', fill: 'forwards' });
    release();
    held = animation;
    await animation.finished;
  }
  async function rollAnimation(dir, die) {
    await animateCube([
      { transform: BASE }, { transform: LIFT + ' ' + BASE + ' ' + HALF[dir] }, { transform: BASE + ' ' + ROLL[dir] }
    ], { duration: ROLL_MS, easing: 'linear' }).finished;
    renderDie(die);
  }
  // 撞到山、河、森林：骰子以貼地的那條邊為支點往前翻到一半，再倒回來。
  // 這時地圖不動，所以骰子中心要跟著往前移，支點那條邊才會留在原地。
  const BUMP_TILT = 0.4;   // 最多翻到幾成（1＝翻滿 90 度）
  async function bumpAnimation(dir) {
    const axis = dir === 'N' || dir === 'S' ? 'rotateX' : 'rotateY';
    const sign = dir === 'N' || dir === 'E' ? 1 : -1;
    const dx = G.DIRS[dir][0], dy = -G.DIRS[dir][1];
    const pose = p => {
      const angle = (45 + 90 * p) * Math.PI / 180;
      const forward = 0.5 - Math.SQRT1_2 * Math.cos(angle), lift = Math.SQRT1_2 * Math.sin(angle) - 0.5;
      return 'translate3d(calc(var(--die) * ' + (dx * forward).toFixed(4) + '), calc(var(--die) * ' + (dy * forward).toFixed(4) + '), calc(var(--die) * ' + lift.toFixed(4) + ')) ' +
        BASE + ' ' + axis + '(' + (90 * p * sign).toFixed(2) + 'deg)';
    };
    const frames = [], HALF_STEPS = 6;
    for (let i = 0; i <= HALF_STEPS * 2; i++) {
      const t = i / (HALF_STEPS * 2);
      // 往前翻漸慢、倒回來漸快
      const k = t <= 0.5 ? 1 - Math.pow(1 - t * 2, 2) : 1 - Math.pow((t - 0.5) * 2, 2);
      frames.push({ transform: pose(BUMP_TILT * k), offset: t });
    }
    await animateCube(frames, { duration: 260, easing: 'linear' }).finished;
  }
  async function spinAnimation(die) {
    // 跳起來翻一圈落下。重骰的新朝向在最高點（中間）換上去，前半用舊的、後半用新的。
    const before = orient, after = orientOf(die), frames = [], STEPS = 12;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      frames.push({ transform: 'translateZ(calc(var(--die) * ' + (5.6 * t * (1 - t)).toFixed(4) + ')) ' + BASE +
        ' rotateX(' + (360 * t) + 'deg) rotateY(' + (360 * t) + 'deg)', orient: i <= STEPS / 2 ? before : after });
    }
    await animateCube(frames, { duration: 520, easing: 'ease-in-out' }).finished;
    renderDie(die);
  }
  // 滾到一半（progress＝滾了幾成）被怪物頂飛：繞著一根隨機的軸轉 KNOCK_TURNS 圈飛回去。
  // 整趟只繞同一根軸、等速轉（軸每次隨機），被撞當下的傾斜在飛行途中慢慢扶正。
  // 不能用三個軸各轉各的：疊起來的轉向會在半空中變來變去，像中途被人另外推了一把。
  const KNOCK_TURNS = 1;
  async function knockAnimation(die, dir, progress, ms, peak) {
    const axis = dir === 'N' || dir === 'S' ? 'rotateX' : 'rotateY';
    const sign = dir === 'N' || dir === 'E' ? 1 : -1;
    const angle = 90 * progress * sign;
    const lift = Math.SQRT1_2 * Math.sin((45 + 90 * progress) * Math.PI / 180) - 0.5;
    let x, y, z, length;
    do {
      x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
      length = Math.hypot(x, y, z);
    } while (length < 0.2 || length > 1);
    const spin = 'rotate3d(' + (x / length).toFixed(4) + ',' + (y / length).toFixed(4) + ',' + (z / length).toFixed(4) + ',';
    // 高度走拋物線（上升漸慢、下降漸快），轉動全程等速，切成小段才不會在最高點停一下。
    // 重骰的新朝向在飛到一半時換上去，前半用舊的、後半用新的。
    const before = orient, after = orientOf(die);
    const frames = [], PEAK = peak, STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const height = lift * (1 - t) + 4 * PEAK * t * (1 - t);
      frames.push({ transform: 'translateZ(calc(var(--die) * ' + height + ')) ' + BASE + ' ' +
        spin + (360 * KNOCK_TURNS * t) + 'deg) ' + axis + '(' + (angle * (1 - t)) + 'deg)', orient: i <= STEPS / 2 ? before : after });
    }
    const animation = animateCube(frames, { duration: ms, easing: 'linear' });
    release();
    await animation.finished;
    renderDie(die);
  }
  // 打贏時全畫面震動的毫秒數
  const QUAKE_MS = 350;
  const ROLL_MS = 250;
  // 踩上怪物：骰子照常滾到 at 成，接著花 hold 毫秒只再滾 creep 成（極慢），這段結束才分勝負。
  const SLOW = { at: 0.7, creep: 0.06, hold: { small: 200, elite: 200, boss: 200 } };
  // 打贏：照原本的滾動速度把剩下的滾完，落地時全畫面震動。
  // 打輸：怪物在慢動作期間往下壓扁（squash＝高度剩幾成、wide＝變寬幾倍），
  // 然後花 spring 毫秒往上彈 jump 格高把骰子頂飛，再花 settle 毫秒落回原位。
  // late＝骰子已經落地才開打時（目前沒有這種情況，留著備用）壓扁要花的毫秒數。
  const POP = { squash: 0.55, wide: 1.18, spring: 80, jump: 0.55, settle: 240, late: 220 };
  // 被頂飛：飛行毫秒數＝base＋每多退一格加 perCell；最高點（骰子邊長的倍數）＝peak＋每多退一格加 peakPerCell。
  const FLY = { base: 460, perCell: 0, peak: 1.3, peakPerCell: 0.4 };
  function propBase(element) {
    return 'rotateX(calc(var(--tilt) * -1))';
  }
  async function squashAnimation(element, ms) {
    const base = propBase(element);
    const animation = element.animate([
      { transform: base }, { transform: base + ' scale(' + POP.wide + ',' + POP.squash + ')' }
    ], { duration: ms, easing: 'ease-out', fill: 'forwards' });
    await animation.finished;
    return animation;
  }
  // 往上彈：彈到最高點（頂到骰子）就回來，落回原位不等。
  async function springAnimation(element, squashed) {
    const base = propBase(element), total = POP.spring + POP.settle;
    element.animate([
      { transform: base + ' scale(' + POP.wide + ',' + POP.squash + ')', offset: 0, easing: 'ease-out' },
      { transform: base + ' translateY(calc(var(--cell) * ' + (-POP.jump) + ')) scale(0.88,1.22)', offset: POP.spring / total, easing: 'ease-in' },
      { transform: base, offset: 1 }
    ], { duration: total });
    if (squashed) squashed.cancel();
    await wait(POP.spring);
  }
  function quake() {
    const shell = $('shell');
    shell.style.setProperty('--quake', QUAKE_MS + 'ms');
    restart(shell, 'quake');
    setTimeout(() => shell.classList.remove('quake'), QUAKE_MS + 50);
  }

  // ---- HUD ----
  function renderHud() {
    $('balance').textContent = format(shownBalance);
    const labels = { bless: '祝福 +1', curse: '詛咒 −1', poison: '中毒 步費×2' };
    let html = '';
    for (const kind of ['bless', 'curse', 'poison']) {
      if (state[kind] > 0) html += '<span class="status ' + kind + '">' + labels[kind] + '　剩 ' + state[kind] + ' 步</span>';
    }
    $('statuses').innerHTML = html;
    // 骰子右上角的 +1／−1；祝福和詛咒同時有就互相抵銷，不顯示。
    const mod = G.modifier(state), badge = $('dieMod');
    badge.hidden = !mod;
    badge.className = 'die-mod ' + (mod > 0 ? 'bless' : 'curse');
    badge.textContent = mod > 0 ? '+1' : '−1';
    $('topupBtn').disabled = state.balance >= G.stepCost(state);
    const lock = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    let bets = '<span>' + (state.betLock > 0 ? '再 ' + state.betLock + ' 步可換' : '底注') + '</span>';
    for (const bet of state.config.bets) {
      const current = bet === state.bet, locked = !current && state.betLock > 0;
      bets += '<button type="button" data-bet="' + bet + '" class="' + (current ? 'current' : locked ? 'locked' : '') + '"' +
        (locked ? ' aria-label="底注 ' + bet + '，再走 ' + state.betLock + ' 步才能更改"' : '') + '>' + (locked ? lock : '') + bet + '</button>';
    }
    $('bets').innerHTML = bets;
  }
  function message(html) { $('message').innerHTML = html; }
  function float(text, kind) {
    const element = document.createElement('span');
    element.className = 'float ' + kind;
    element.textContent = text;
    $('floats').append(element);
    setTimeout(() => element.remove(), 950);
  }
  function restart(element, name) { element.classList.remove(name); void element.offsetWidth; element.classList.add(name); }

  function modal(title, bodyHtml, okText, cancelText) {
    return new Promise(resolve => {
      $('modalTitle').textContent = title;
      $('modalBody').innerHTML = bodyHtml;
      $('modalOk').textContent = okText || '確定';
      $('modalCancel').textContent = cancelText || '取消';
      $('modalCancel').hidden = cancelText === null;
      $('modal').hidden = false;
      const close = result => { $('modal').hidden = true; $('modalOk').onclick = $('modalCancel').onclick = null; resolve(result); };
      $('modalOk').onclick = () => close(true);
      $('modalCancel').onclick = () => close(false);
    });
  }
  function bigWin(amount) {
    return new Promise(resolve => {
      $('bigwinAmount').textContent = '+' + format(amount);
      let coins = '';
      for (let i = 0; i < 36; i++) coins += '<i style="left:' + Math.round(Math.random() * 96) + '%;animation-delay:' + (Math.random() * 0.5).toFixed(2) + 's"></i>';
      $('coins').innerHTML = coins;
      $('bigwin').hidden = false;
      let done = false;
      const finish = () => { if (done) return; done = true; $('bigwin').hidden = true; $('bigwin').onclick = null; resolve(); };
      $('bigwin').onclick = finish;
      setTimeout(finish, 1500);
    });
  }

  // ---- 演出：把規則回傳的事件依序播出來 ----
  const STEPS = state.config.statusSteps;
  const OUTCOME = {
    chest: '開出寶箱', bless: '祝福：' + STEPS.bless + ' 步內點數 +1', curse: '詛咒：' + STEPS.curse + ' 步內點數 −1',
    poison: '中毒：' + STEPS.poison + ' 步內步費加倍', monster: '跳出怪物', teleport: '是傳送門'
  };
  const TERRAIN = { river: '河流', mountain: '山脈', forest: '森林' };
  const TIER = { small: '小怪', elite: '菁英', boss: 'BOSS' };
  async function payout(event) {
    shownBalance += event.payout;
    float('+' + format(event.payout), 'win');
    renderHud();
    if (event.bigWin) await bigWin(event.payout);
  }
  async function play(events, from) {
    let target = null, stepDir = null, stepDie = null, dest = null, slowed = false, knocked = null, spent = null;
    const moveWorld = (x, y, ms) => { world.style.transitionDuration = (ms / 1000) + 's'; view.x = x; view.y = y; setWorld(false); };
    const far = events.some(item => item.type === 'bounce' && item.distance > 1);
    for (const event of events) {
      if (event.type === 'bump') {
        await bumpAnimation(event.dir);
        message('被' + TERRAIN[event.terrain] + '擋住了，沒有花錢');
      } else if (event.type === 'broke') {
        message('<span class="bad">點數不夠走這一步（需要 ' + format(event.cost) + '），請按「補點數」</span>');
      } else if (event.type === 'step') {
        const delta = G.DIRS[event.dir];
        stepDir = event.dir; stepDie = event.die;
        dest = { x: from.x + delta[0], y: from.y + delta[1] };
        const next = events[events.indexOf(event) + 1];
        // 會被擊退超過一格：先把落點附近的格子畫出來（之後才重畫會切掉怪物的動畫）。
        // 點數還蓋著的黑色怪物要等骰子到了才揭曉，重畫後先蓋回去（已經現形的不用蓋）。
        // 藍色虛線先留在出發的那一格，等彈飛演完才挪到落點。
        if (far) {
          renderWorld(false, true, from);
          const covered = next && next.type === 'fight' && next.wasHidden && propAt(dest.x, dest.y);
          if (covered) {
            const look = monsterLook(next.tier, true, true);
            covered.className = look.classes;
            covered.innerHTML = look.html + '<span class="label">?</span>';
          }
        }
        target = propAt(dest.x, dest.y);
        shownBalance -= event.cost;
        float('−' + format(event.cost), 'cost');
        $('balance').textContent = format(shownBalance);
        if (target && next && next.type === 'fight') {
          // 踩上怪物：先滾到 at 成，剩下的交給戰鬥演出（慢動作後蓋下去或被頂飛）。
          moveWorld(from.x + delta[0] * SLOW.at, from.y + delta[1] * SLOW.at, ROLL_MS * SLOW.at);
          await rollPart(event.dir, 0, SLOW.at, ROLL_MS * SLOW.at);
          slowed = true;
        } else {
          view.x = dest.x; view.y = dest.y;
          setWorld(false);
          await rollAnimation(event.dir, event.die);
          message('走了一步');
        }
      } else if (event.type === 'potion') {
        if (target) restart(target, 'shatter');
        message('喝下藥水，' + OUTCOME[event.outcome]);
      } else if (event.type === 'place') {
        message('來到' + (event.kind === 'town' ? '城鎮' : '鄉村'));
      } else if (event.type === 'reroll') {
        message('踩到重骰，骰子重新骰一次');
        await spinAnimation(event.die);
        message('重骰成 <span class="gold">' + event.die.top + ' 點</span>');
      } else if (event.type === 'swamp') {
        message('踩進毒潭，' + OUTCOME.poison);
      } else if (event.type === 'status') {
        renderHud();
        await wait(350);
      } else if (event.type === 'fight') {
        if (target) {
          const look = monsterLook(event.tier, event.dark, false);
          target.className = look.classes;
          target.innerHTML = look.html + '<span class="label">' + event.n + '</span>';
        }
        const versus = '你 ' + event.points + ' 點 對 ' + event.n + ' 點' + TIER[event.tier];
        const delta = G.DIRS[stepDir];
        message(versus + '…');
        if (slowed) {
          // 慢動作：滾動突然變得極慢，勝負從這裡分岔。打輸的話怪物同時往下壓扁蓄力。
          const hold = SLOW.hold[event.tier], stop = SLOW.at + SLOW.creep;
          let squashing = null;
          if (!event.win && target) {
            squashing = squashAnimation(target, hold);
          }
          moveWorld(from.x + delta[0] * stop, from.y + delta[1] * stop, hold);
          await rollPart(stepDir, SLOW.at, stop, hold);
          if (event.win) {
            // 打贏：照原本的速度把剩下的滾完，那一面落地的瞬間震動。
            const rest = ROLL_MS * (1 - stop);
            moveWorld(dest.x, dest.y, rest);
            await rollPart(stepDir, stop, 1, rest);
            renderDie(stepDie);
            release();
            world.style.transitionDuration = '';
          } else {
            message(versus + '：<span class="bad">打輸</span>');
            if (target) await springAnimation(target, await squashing);
            knocked = stop;
          }
        } else if (!event.win) {
          message(versus + '：<span class="bad">打輸</span>');
          if (target) {
            await springAnimation(target, await squashAnimation(target, POP.late));
          }
          knocked = 0;
        }
        if (event.win) {
          if (target) restart(target, 'shatter');
          quake();
          message(versus + '：<span class="good">打贏</span> <span class="gold">+' + format(event.payout) + '</span>');
          await payout(event);
          await wait(250);
        }
      } else if (event.type === 'chest') {
        const need = event.need === 'big' ? '大（4～6）' : '小（1～3）';
        const box = CHEST_NAMES[event.tier];
        if (event.win) {
          if (target) restart(target, 'shatter');
          message('你 ' + event.points + ' 點，' + box + '要' + need + '：<span class="good">打開</span> <span class="gold">+' + format(event.payout) + '</span>');
          await payout(event);
          await wait(250);
        } else {
          if (target) {
            const tries = target.querySelector('.tries');
            if (tries) tries.outerHTML = triesHtml(event.triesLeft, event.tier);
            restart(target, 'shake');
          }
          message('你 ' + event.points + ' 點，' + box + '要' + need + '：<span class="bad">開不了</span>，' +
            (event.triesLeft > 0 ? '還能試 ' + event.triesLeft + ' 次' : '試了 ' + G.CONFIG.chestTiers[event.tier].tries + ' 次，' + box + '消失了'));
          // 次數用完：等骰子彈回原位後寶箱才消失
          if (target && event.triesLeft <= 0) spent = target;
        }
      } else if (event.type === 'bounce') {
        if (event.distance > 1) $('message').innerHTML += '，被擊退 ' + (event.distance - 1) + ' 格';
        else if (!events.some(item => item.type === 'chest')) $('message').innerHTML += '，退回重骰';
        if (knocked === null) {
          // 寶箱開不了：原地跳起來重骰
          moveWorld(event.x, event.y, event.distance > 1 ? 250 + 70 * event.distance : 250);
          await spinAnimation(event.die);
          if (event.distance > 1) await wait(70 * event.distance);
        } else {
          // 被怪物頂飛：退幾格就飛幾格，鏡頭跟骰子同時到。
          const ms = FLY.base + FLY.perCell * (event.distance - 1);
          moveWorld(event.x, event.y, ms);
          await knockAnimation(event.die, stepDir, knocked, ms, FLY.peak + FLY.peakPerCell * (event.distance - 1));
        }
        world.style.transitionDuration = '';
        if (spent) { spent.classList.add('leave'); await wait(250); }
      } else if (event.type === 'teleport') {
        if (target) target.classList.add('leave');
        restart($('flash'), 'on');
        await wait(180);
        renderWorld(true); renderHud();
        message('傳送到遠方，周圍換了一批新的');
        await wait(350);
      }
    }
  }

  async function tryMove(dir) {
    if (busy || !$('modal').hidden || !$('bigwin').hidden) return null;
    busy = true;
    const from = { x: state.x, y: state.y };
    const events = G.move(state, dir);
    await play(events, from);
    shownBalance = state.balance;
    if (!events.some(event => event.type === 'teleport')) renderWorld(false);
    renderDie(state.die); renderHud();
    save();
    busy = false;
    return events;
  }

  // ---- 操作 ----
  // 按住藍色虛線的格子會一直往那個方向走（跟按住方向鍵一樣），放開就停。
  // 每走一步地圖都會重畫，所以記的是按下去那一刻的方向，不是滑鼠底下的元素。
  let holdDir = null, holding = false;
  async function holdLoop() {
    if (holding) return;
    holding = true;
    while (holdDir) {
      const events = await tryMove(holdDir);
      // 跳出視窗（規則、換注、大獎）或點數不夠時停下來，不然會空轉。
      if (!events || events.some(event => event.type === 'broke')) break;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    holding = false;
  }
  world.addEventListener('pointerdown', event => {
    if (event.button) return;
    const cell = event.target.closest('.cell.adj');
    if (!cell) return;
    event.preventDefault();
    holdDir = cell.dataset.dir;
    holdLoop();
  });
  const stopHold = () => { holdDir = null; };
  for (const name of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(name, stopHold);
  document.addEventListener('visibilitychange', stopHold);
  world.addEventListener('contextmenu', event => event.preventDefault());
  const KEYS = { ArrowUp: 'N', ArrowDown: 'S', ArrowRight: 'E', ArrowLeft: 'W', w: 'N', s: 'S', d: 'E', a: 'W' };
  document.addEventListener('keydown', event => {
    const dir = KEYS[event.key];
    if (dir) { event.preventDefault(); tryMove(dir); }
  });
  $('bets').addEventListener('click', async event => {
    const button = event.target.closest('[data-bet]');
    if (!button || busy) return;
    const bet = Number(button.dataset.bet);
    if (bet === state.bet) return;
    if (state.betLock > 0) { message('換注後要再走 ' + state.betLock + ' 步才能再換'); return; }
    const ok = await modal('更換底注為 ' + bet + '？',
      '<ul><li>地圖會<b>立刻刷新</b>，場上的怪物、寶箱、藥水、毒潭、重骰和山、河、森林全部換一批。</li><li>換注後要<b>再走 ' + state.config.betLockSteps + ' 步</b>才能再次更改。</li></ul>',
      '確定更換', '取消');
    if (!ok || !G.changeBet(state, bet)) return;
    busy = true;
    world.querySelectorAll('.prop').forEach(element => element.classList.add('leave'));
    await wait(260);
    renderWorld(true); renderHud();
    message('底注改為 ' + bet + '，地圖已刷新');
    save();
    busy = false;
  });
  $('topupBtn').onclick = () => {
    if (busy || state.balance >= G.stepCost(state)) return;
    G.topUp(state);
    shownBalance = state.balance;
    renderHud(); save();
    message('已補回 ' + format(state.balance) + ' 模擬點數');
  };
  $('themeBtn').onclick = () => {
    if (busy) return;
    theme = theme === 'geo' ? 'pixel' : 'geo';
    applyTheme(); renderWorld(false); save();
  };
  function applyTheme() {
    $('shell').dataset.theme = theme;
    $('themeBtn').textContent = '風格：' + (theme === 'geo' ? '幾何' : '像素');
  }
  $('rulesBtn').onclick = () => {
    const config = state.config;
    const rows = config.monsterMults.map((mult, index) => {
      const tier = G.monsterTier(index + 1), knock = config.monsterTiers[tier].knock;
      return '<tr><td>' + (index + 1) + ' 點' + TIER[tier] + '</td><td>' + mult + ' 倍</td><td>' + mult * config.hiddenMonsterFactor + ' 倍</td><td>' + (knock ? '再多退 ' + knock + ' 格' : '退回上一格') + '</td></tr>';
    }).join('');
    modal('規則', [
      '<h3>怎麼玩</h3><ul><li>點骰子旁邊的格子（或鍵盤方向鍵）往那邊翻一格，每步花一次底注。</li><li>骰子是真的在滾：朝上的點數照翻滾方向變化。</li><li>走遠之後，被拋在後面的東西會收走；新的只會出現在畫面外，往前走才遇得到。</li></ul>',
      '<h3>格子</h3><ul><li><b>怪物</b>：你的點數要<b>大於</b>怪物點數才贏，一樣大算輸。怪物是 1～5 點。分小怪（1～2 點）、菁英（3～4 點）、BOSS（5 點）三檔；點數越高獎金越多，越高檔打輸被擊退得越遠。</li><li><b>黑色怪物</b>：標「?」，踩上去才知道幾點，獎金是 ' + config.hiddenMonsterFactor + ' 倍。點數揭曉後換回一般顏色，獎金不變。</li><li><b>寶箱</b>：標「大」要 4～6 點，標「小」要 1～3 點，符合就開。分三種：' + Object.keys(config.chestTiers).map(tier => CHEST_NAMES[tier] + ' ' + config.chestTiers[tier].mult + ' 倍').join('、') + '；鐵箱和金箱很少見，獎池累積得多時比較容易出現。木箱最多試 ' + config.chestTiers.wood.tries + ' 次，鐵箱和金箱最多試 ' + config.chestTiers.gold.tries + ' 次，用完寶箱就消失。</li><li><b>隨機藥水</b>：喝下去隨機得到祝福或詛咒，機率各半。祝福和詛咒會互相取代，身上只會有其中一個。</li><li><b>毒潭</b>：踩上去就中毒。踩過不會消失，可以繞開。</li><li><b>重骰</b>：踩上去骰子重新骰一次。踩過不會消失，走開再踩回來可以一直重骰。</li><li><b>鄉村、城鎮</b>：可以走上去，目前沒有作用。</li><li><b>傳送點</b>：傳到遠方，周圍換一批新的，換注鎖也解開。</li><li><b>山脈、河流、森林</b>：過不去，撞到不花錢。</li></ul>',
      '<h3>打輸或開不了</h3><ul><li>骰子被彈回去並重骰，那一步的錢照扣。怪物留在原地，可以走回去再打。</li><li>被擊退時撞到山、河、森林就停下來。</li></ul>',
      '<h3>狀態</h3><ul><li>祝福：' + STEPS.bless + ' 步內點數 +1。詛咒：' + STEPS.curse + ' 步內點數 −1。對怪物和寶箱都算，所以詛咒有時反而開得了「小」寶箱。</li><li>中毒：' + STEPS.poison + ' 步內步費加倍。</li></ul>',
      '<h3>怪物獎金（底注的倍數）</h3><table><tr><th></th><th>一般</th><th>原本是黑色的</th><th>打輸擊退</th></tr>' + rows + '</table>',
      '<h3>底注</h3><ul><li>換注會立刻刷新整張地圖，換完要再走 ' + config.betLockSteps + ' 步才能再換。</li></ul>',
      '<h3>其他</h3><ul><li>地圖上的寶物多寡會隨遊玩情況變化。</li><li>這是模擬點數的試玩版，沒有真實金流。點數不夠時可按「補點數」。</li></ul>'
    ].join(''), '知道了', null);
  };

  applyTheme();
  renderWorld(true);
  renderDie(state.die); renderHud();
  // 測試用的後門：只有在本機開（localhost）才有，放上網站的版本沒有。
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) window.DiceHeroDebug = { state, tryMove, orientOf };
})();
