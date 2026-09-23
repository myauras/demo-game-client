const CONFIG = {
  difficultyConfig: {
    easy: { label: '簡單', minMultiplier: 1.0, maxMultiplier: 3.0, successRate: 0.85 },
    normal: { label: '普通', minMultiplier: 1.5, maxMultiplier: 6.0, successRate: 0.7 },
    hard: { label: '困難', minMultiplier: 2.0, maxMultiplier: 12.0, successRate: 0.55 }
  },
  platformMultipliers: [1.00, 1.30, 1.70, 2.20, 3.00, 4.00, 6.00, 8.00, 10.00, 12.00, 15.00, 18.00, 22.00],
  platformSwitchInterval: 800,
  platformTypes: ['normal', 'spring', 'flight'],
  springJumpDistance: 2,
  flightJumpDistance: 4,
  jumpDuration: 580,
  animationDuration: 850
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
  cycleTimer: null, balance: 3000, currentBet: 10
};

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('gameStage'), layer: $('platformLayer'), player: $('player'), toast: $('statusToast'),
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
  for (let offset = -1; offset <= 6; offset += 1) {
    const floor = state.currentFloor + offset;
    if (floor < 0) continue;
    const platform = document.createElement('div');
    const isCurrent = offset === 0;
    const isNext = offset === 1;
    const type = isNext ? state.previewPlatformType : 'normal';
    platform.className = `platform ${type}${isCurrent ? ' current' : ''}${isNext ? ' next' : ''}`;
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
  if (state.status !== 'playing' || state.isJumping || state.isAutoMoving) return;
  state.cycleIndex = (state.cycleIndex + 1) % CONFIG.platformTypes.length;
  state.previewPlatformType = CONFIG.platformTypes[state.cycleIndex];
  renderPlatforms();
}

function startCycle() {
  stopCycle();
  state.cycleTimer = setInterval(cyclePlatform, CONFIG.platformSwitchInterval);
}

function stopCycle() { clearInterval(state.cycleTimer); state.cycleTimer = null; }

function toast(message, accent = false, hold = 950) {
  els.toast.textContent = message;
  els.toast.classList.toggle('accent', accent);
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), hold);
}

function resetBoard() {
  stopCycle();
  Object.assign(state, {
    status: 'idle', currentFloor: 0, previewPlatformType: 'normal', lockedPlatformType: null,
    isJumping: false, isAutoMoving: false, canCashout: false, gameOver: false, cycleIndex: 0
  });
  state.currentMultiplier = multiplierAt(0);
  els.player.className = 'player-cube';
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
  if (amount > state.balance) { toast('餘額不足，請調整下注金額', true, 1200); return; }
  state.currentBet = amount;
  state.balance = Number((state.balance - amount).toFixed(2));
  Object.assign(state, {
    status: 'playing', currentFloor: 0, previewPlatformType: 'normal', lockedPlatformType: null,
    isJumping: false, isAutoMoving: false, canCashout: false, gameOver: false, cycleIndex: 0
  });
  state.currentMultiplier = multiplierAt(0);
  els.player.className = 'player-cube';
  setActionMode('playing');
  setSettingsLocked(true);
  renderPlatforms(); updateUI(); startCycle();
  toast(`已投注 ${formatMoney(amount)} · 抓準時機跳躍`, false, 1300);
}

function jump() {
  if (state.status !== 'playing' || state.isJumping || state.isAutoMoving) return;
  state.lockedPlatformType = state.previewPlatformType;
  state.isJumping = true; state.status = 'jumping'; stopCycle(); updateUI();
  const locked = TYPE_INFO[state.lockedPlatformType];
  toast(`已鎖定 · ${locked.label}`, state.lockedPlatformType !== 'normal');
  els.player.classList.add('jumping');
  const success = Math.random() <= CONFIG.difficultyConfig[state.difficulty].successRate;
  setTimeout(() => {
    els.player.classList.remove('jumping');
    if (!success) { failRun(); return; }
    if (state.lockedPlatformType === 'normal') landAt(state.currentFloor + 1);
    else boost(state.lockedPlatformType);
  }, CONFIG.jumpDuration);
}

function boost(type) {
  const distance = TYPE_INFO[type].distance;
  state.status = type === 'spring' ? 'springBoost' : 'flightBoost';
  state.isAutoMoving = true;
  els.player.classList.add(type === 'spring' ? 'springing' : 'flying');
  els.stage.classList.add('flash');
  toast(type === 'spring' ? '彈射啟動 · 上升 2 格' : '飛行啟動 · 上升 4 格', true, 1200);
  setTimeout(() => {
    els.player.classList.remove('springing', 'flying');
    els.stage.classList.remove('flash');
    landAt(state.currentFloor + distance);
  }, type === 'spring' ? CONFIG.animationDuration : CONFIG.animationDuration + 420);
}

function landAt(targetFloor) {
  state.currentFloor = targetFloor;
  state.currentMultiplier = multiplierAt(targetFloor);
  state.isJumping = false; state.isAutoMoving = false; state.canCashout = true;
  state.status = 'playing'; state.lockedPlatformType = null;
  state.cycleIndex = 0; state.previewPlatformType = 'normal';
  renderPlatforms(); updateUI();
  els.stage.classList.add('screen-shake');
  setTimeout(() => els.stage.classList.remove('screen-shake'), 470);
  toast(`抵達 ${targetFloor} 樓 · ${formatMultiplier(state.currentMultiplier)}`, false, 1150);
  startCycle();
}

function failRun() {
  state.status = 'failed'; state.isJumping = false;
  els.player.classList.add('failing');
  els.stage.classList.add('screen-shake');
  toast('挑戰失敗 · 本局獎勵歸零', true, 1200);
  setTimeout(() => {
    resetBoard();
    toast('挑戰失敗 · 獎勵歸零 · 可再次投注', true, 1600);
  }, 920);
}

function cashout() {
  if (!state.canCashout || state.isJumping || state.isAutoMoving) return;
  state.status = 'cashout';
  const reward = Number((state.currentBet * state.currentMultiplier).toFixed(2));
  state.balance = Number((state.balance + reward).toFixed(2));
  els.stage.classList.add('flash');
  toast(`提現成功 · ${formatMultiplier(state.currentMultiplier)}`, true, 1000);
  setTimeout(() => {
    resetBoard();
    toast(`提現成功 · +${formatMoney(reward)} · 可再次投注`, true, 1600);
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
els.addBalance.addEventListener('click', () => { state.balance += 1000; updateUI(); toast('已增加 $ 1000.00 測試餘額'); });
els.difficulty.addEventListener('change', () => {
  state.difficulty = els.difficulty.value;
  state.currentMultiplier = multiplierAt(0);
  renderPlatforms();
});
window.addEventListener('resize', renderPlatforms);

resetBoard();
setTimeout(() => toast('設定下注金額與難度後開始挑戰', false, 1600), 250);
