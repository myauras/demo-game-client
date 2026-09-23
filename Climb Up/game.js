const CONFIG = {
  difficultyConfig: {
    easy: { label: '簡單', minMultiplier: 1.0, maxMultiplier: 3.0, successRate: 0.85 },
    normal: { label: '普通', minMultiplier: 1.5, maxMultiplier: 6.0, successRate: 0.7 },
    hard: { label: '困難', minMultiplier: 2.0, maxMultiplier: 12.0, successRate: 0.55 }
  },
  platformMultipliers: [1.00, 1.30, 1.70, 2.20, 3.00, 4.00, 6.00, 8.00, 10.00, 12.00, 15.00, 18.00, 22.00],
  platformSwitchInterval: 800,
  specialCycleChance: 0.35,
  platformTypes: ['normal', 'spring', 'flight'],
  springJumpDistance: 2,
  flightJumpDistance: 4,
  jumpDuration: 580,
  cameraStepDuration: 390,
  boostLiftDuration: 270
};

const TYPE_INFO = {
  normal: { label: '普通平台', symbol: '◇', distance: 1 },
  spring: { label: '彈射平台', symbol: '▲', distance: CONFIG.springJumpDistance },
  flight: { label: '飛行平台', symbol: '⇈', distance: CONFIG.flightJumpDistance }
};

const state = {
  status: 'idle', difficulty: 'easy', currentFloor: 0, currentMultiplier: 1,
  previewPlatformType: 'normal', lockedPlatformType: null, isJumping: false,
  isAutoMoving: false, canCashout: false, gameOver: false, cycleIndex: 0,
  cycleTimer: null, specialCycleActive: false, platformGap: 118,
  balance: 3000, currentBet: 10
};

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('gameStage'), layer: $('platformLayer'), player: $('player'),
  balance: $('balanceValue'), addBalance: $('addBalanceButton'), betInput: $('betInput'),
  halfBet: $('halfBetButton'), doubleBet: $('doubleBetButton'), difficulty: $('difficultySelect'),
  bet: $('betButton'), cashout: $('cashoutButton'), jump: $('jumpButton'),
  idleActions: $('idleActions'), playActions: $('playActions')
};

function multiplierAt(floor) {
  const curveIndex = Math.min(floor, CONFIG.platformMultipliers.length - 1);
  const curveValue = CONFIG.platformMultipliers[curveIndex];
  const curveMin = CONFIG.platformMultipliers[0];
  const curveMax = CONFIG.platformMultipliers.at(-1);
  const progress = Math.min(1, Math.max(0, (curveValue - curveMin) / (curveMax - curveMin)));
  const config = CONFIG.difficultyConfig[state.difficulty];
  return Number((config.minMultiplier + (config.maxMultiplier - config.minMultiplier) * progress).toFixed(2));
}

function formatMultiplier(value) { return `${value.toFixed(2)}X`; }
function formatMoney(value) { return `$ ${value.toFixed(2)}`; }

function renderPlatforms() {
  els.layer.innerHTML = '';
  const viewportHeight = els.stage.clientHeight || 700;
  const baseY = viewportHeight - 102;
  const gap = Math.max(103, Math.min(132, viewportHeight * .18));
  state.platformGap = gap;
  els.player.style.setProperty('--platform-gap', `${gap}px`);
  for (let offset = -1; offset <= 6; offset += 1) {
    const floor = state.currentFloor + offset;
    if (floor < 0) continue;
    const platform = document.createElement('div');
    const isCurrent = offset === 0;
    const isNext = offset === 1;
    const type = isNext && !state.isAutoMoving ? state.previewPlatformType : 'normal';
    platform.className = `platform ${type}${isCurrent ? ' current' : ''}${isNext ? ' next' : ''}`;
    platform.dataset.offset = offset;
    platform.dataset.multiplier = formatMultiplier(multiplierAt(floor));
    platform.style.top = `${baseY - (offset + .42) * gap}px`;
    platform.style.setProperty('--scale', `${Math.max(.57, 1 - Math.max(0, offset) * .065)}`);
    platform.style.opacity = `${Math.max(.2, 1 - Math.max(0, offset) * .105)}`;
    platform.innerHTML = `<span class="platform-symbol">${isNext ? TYPE_INFO[type].symbol : ''}</span>`;
    els.layer.appendChild(platform);
  }
}

function setActionMode(mode) {
  els.idleActions.classList.toggle('hidden', mode !== 'idle');
  els.playActions.classList.toggle('hidden', mode !== 'playing');
}

function setSettingsLocked(locked) {
  els.betInput.disabled = locked;
  els.halfBet.disabled = locked;
  els.doubleBet.disabled = locked;
  els.difficulty.disabled = locked;
}

function updateUI() {
  els.balance.textContent = formatMoney(state.balance);
  els.cashout.disabled = !state.canCashout || state.isJumping || state.isAutoMoving;
  els.jump.disabled = state.status !== 'playing' || state.isJumping || state.isAutoMoving;
}

function cyclePlatform() {
  if (!state.specialCycleActive || state.status !== 'playing' || state.isJumping || state.isAutoMoving) return;
  state.cycleIndex = (state.cycleIndex + 1) % CONFIG.platformTypes.length;
  state.previewPlatformType = CONFIG.platformTypes[state.cycleIndex];
  renderPlatforms();
}

function startCycle() {
  stopCycle();
  if (!state.specialCycleActive) return;
  state.cycleTimer = setInterval(cyclePlatform, CONFIG.platformSwitchInterval);
}

function stopCycle() { clearInterval(state.cycleTimer); state.cycleTimer = null; }

function prepareNextPlatform() {
  stopCycle();
  state.cycleIndex = 0;
  state.previewPlatformType = 'normal';
  state.specialCycleActive = Math.random() < CONFIG.specialCycleChance;
  renderPlatforms();
  startCycle();
}

function wait(duration) { return new Promise((resolve) => setTimeout(resolve, duration)); }

function resetBoard() {
  stopCycle();
  Object.assign(state, {
    status: 'idle', currentFloor: 0, previewPlatformType: 'normal', lockedPlatformType: null,
    isJumping: false, isAutoMoving: false, canCashout: false, gameOver: false, cycleIndex: 0,
    specialCycleActive: false
  });
  state.currentMultiplier = multiplierAt(0);
  els.player.className = 'player-cube';
  els.player.removeAttribute('style');
  els.stage.classList.remove('screen-shake', 'flash');
  setActionMode('idle');
  setSettingsLocked(false);
  renderPlatforms(); updateUI();
}

function readBet() {
  const value = Number(els.betInput.value);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value * 100) / 100);
}

function startBet() {
  const amount = readBet();
  if (amount > state.balance) return;
  state.currentBet = amount;
  state.balance = Number((state.balance - amount).toFixed(2));
  Object.assign(state, {
    status: 'playing', currentFloor: 0, previewPlatformType: 'normal', lockedPlatformType: null,
    isJumping: false, isAutoMoving: false, canCashout: false, gameOver: false, cycleIndex: 0,
    specialCycleActive: false
  });
  state.currentMultiplier = multiplierAt(0);
  els.player.className = 'player-cube';
  els.player.removeAttribute('style');
  setActionMode('playing');
  setSettingsLocked(true);
  prepareNextPlatform(); updateUI();
}

function jump() {
  if (state.status !== 'playing' || state.isJumping || state.isAutoMoving) return;
  state.lockedPlatformType = state.previewPlatformType;
  state.isJumping = true; state.status = 'jumping'; stopCycle(); updateUI();
  const locked = TYPE_INFO[state.lockedPlatformType];
  els.player.classList.add('jumping');
  const success = Math.random() <= CONFIG.difficultyConfig[state.difficulty].successRate;
  setTimeout(() => {
    if (!success) {
      els.player.classList.remove('jumping');
      failRun();
      return;
    }
    advanceFloors(locked.distance, state.lockedPlatformType);
  }, CONFIG.jumpDuration);
}

async function liftToNextStep(type) {
  const upperBottom = 102 + state.platformGap;
  els.player.classList.toggle('boost-flight', type === 'flight');
  els.player.classList.toggle('boost-spring', type === 'spring');
  els.player.style.transition = `bottom ${CONFIG.boostLiftDuration}ms cubic-bezier(.18,.8,.25,1), transform ${CONFIG.boostLiftDuration}ms ease`;
  els.player.style.bottom = `${upperBottom}px`;
  els.player.style.transform = `translateX(-50%) rotate(${type === 'flight' ? 120 : 70}deg)`;
  await wait(CONFIG.boostLiftDuration + 25);
}

async function scrollOneFloor() {
  const upperBottom = 102 + state.platformGap;
  els.player.style.animation = 'none';
  els.player.style.bottom = `${upperBottom}px`;
  els.player.classList.remove('jumping');
  void els.player.offsetHeight;

  const duration = CONFIG.cameraStepDuration;
  els.layer.style.transition = `transform ${duration}ms cubic-bezier(.2,.82,.25,1)`;
  els.player.style.transition = `bottom ${duration}ms cubic-bezier(.2,.82,.25,1), transform ${duration}ms ease`;
  requestAnimationFrame(() => {
    Array.from(els.layer.children).forEach((platform) => {
      const nextOffset = Number(platform.dataset.offset) - 1;
      const nextScale = Math.max(.57, 1 - Math.max(0, nextOffset) * .065);
      platform.style.setProperty('--scale', `${nextScale}`);
      platform.style.width = `${nextOffset === 0 ? 284 : nextOffset === 1 ? 262 : 242}px`;
      platform.style.opacity = `${Math.max(.2, 1 - Math.max(0, nextOffset) * .105)}`;
    });
    els.layer.style.transform = `translateY(${state.platformGap}px)`;
    els.player.style.bottom = '102px';
    els.player.style.transform = 'translateX(-50%) rotate(0deg)';
  });
  await wait(duration + 25);

  state.currentFloor += 1;
  state.currentMultiplier = multiplierAt(state.currentFloor);
  els.layer.style.transition = 'none';
  els.layer.style.transform = 'none';
  els.player.style.transition = 'none';
  els.player.style.bottom = '102px';
  els.player.style.animation = 'none';
  renderPlatforms();
  void els.layer.offsetHeight;
}

async function advanceFloors(distance, type) {
  state.isAutoMoving = true;
  state.previewPlatformType = 'normal';
  state.specialCycleActive = false;
  if (type !== 'normal') {
    els.stage.classList.add('flash');
  }

  for (let step = 0; step < distance; step += 1) {
    if (step > 0) await liftToNextStep(type);
    await scrollOneFloor();
  }

  els.player.classList.remove('boost-flight', 'boost-spring');
  els.stage.classList.remove('flash');
  els.player.removeAttribute('style');
  state.isJumping = false;
  state.isAutoMoving = false;
  state.canCashout = true;
  state.status = 'playing';
  state.lockedPlatformType = null;
  prepareNextPlatform();
  updateUI();
}

function failRun() {
  state.status = 'failed'; state.isJumping = false;
  els.player.classList.add('failing');
  els.stage.classList.add('screen-shake');
  setTimeout(() => {
    resetBoard();
  }, 920);
}

function cashout() {
  if (!state.canCashout || state.isJumping || state.isAutoMoving) return;
  state.status = 'cashout';
  const reward = Number((state.currentBet * state.currentMultiplier).toFixed(2));
  state.balance = Number((state.balance + reward).toFixed(2));
  els.stage.classList.add('flash');
  setTimeout(() => {
    resetBoard();
  }, 520);
}

function changeBet(multiplier) {
  const next = Math.max(1, Math.min(state.balance || 1, readBet() * multiplier));
  els.betInput.value = Number(next.toFixed(2));
}

els.bet.addEventListener('click', startBet);
els.jump.addEventListener('click', jump);
els.cashout.addEventListener('click', cashout);
els.halfBet.addEventListener('click', () => changeBet(.5));
els.doubleBet.addEventListener('click', () => changeBet(2));
els.addBalance.addEventListener('click', () => { state.balance += 1000; updateUI(); });
els.difficulty.addEventListener('change', () => {
  state.difficulty = els.difficulty.value;
  state.currentMultiplier = multiplierAt(0);
  renderPlatforms();
});
window.addEventListener('resize', renderPlatforms);

resetBoard();
