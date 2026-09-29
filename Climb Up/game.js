const CONFIG = {
  rtp: 0.95,
  difficultyConfig: {
    easy: { label: '簡單', minMultiplier: 1.3, maxMultiplier: 3.0, tailStep: 0.2 },
    normal: { label: '普通', minMultiplier: 1.5, maxMultiplier: 6.0, tailStep: 0.5 },
    hard: { label: '困難', minMultiplier: 2.0, maxMultiplier: 12.0, tailStep: 1.0 }
  },
  platformMultipliers: [1.00, 1.30, 1.70, 2.20, 3.00, 4.00, 6.00, 8.00, 10.00, 12.00, 15.00, 18.00, 22.00],
  platformSwitchInterval: 420,
  specialCycleChance: 0.35,
  platformTypes: ['normal', 'spring', 'flight'],
  springJumpDistance: 2,
  flightJumpDistance: 4,
  jumpDuration: 580,
  cameraStepDuration: 390,
  boostLiftDuration: 270,
  flightTravelPerFloor: 230
};

const TYPE_INFO = {
  normal: { label: '普通平台', symbol: '', distance: 1 },
  spring: { label: '彈射平台', symbol: '▲', distance: CONFIG.springJumpDistance },
  flight: { label: '飛行平台', symbol: '⇈', distance: CONFIG.flightJumpDistance }
};

const state = {
  status: 'idle', difficulty: 'easy', currentFloor: 0, currentMultiplier: 1,
  previewPlatformType: 'normal', lockedPlatformType: null, isJumping: false,
  isAutoMoving: false, canCashout: false, gameOver: false,
  cycleTimer: null, specialCycleActive: false, platformGap: 118, hasSuccessfulLanding: false,
  balance: 3000, currentBet: 10
};

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('gameStage'), layer: $('platformLayer'), player: $('player'),
  balance: $('balanceValue'), addBalance: $('addBalanceButton'), betInput: $('betInput'),
  halfBet: $('halfBetButton'), doubleBet: $('doubleBetButton'), difficulty: $('difficultySelect'),
  bet: $('betButton'), cashout: $('cashoutButton'), jump: $('jumpButton'),
  idleActions: $('idleActions'), playActions: $('playActions'), resultModal: $('resultModal'),
  resultTitle: $('resultTitle'), resultSubtitle: $('resultSubtitle'),
  quickBets: Array.from(document.querySelectorAll('[data-bet-amount]'))
};

function multiplierAt(floor) {
  if (floor === 0) return 1;
  const config = CONFIG.difficultyConfig[state.difficulty];
  const curveLength = CONFIG.platformMultipliers.length;
  if (floor > curveLength) {
    const extraFloors = floor - curveLength;
    return Number((config.maxMultiplier + extraFloors * config.tailStep).toFixed(2));
  }
  const curveIndex = floor - 1;
  const curveValue = CONFIG.platformMultipliers[curveIndex];
  const curveMin = CONFIG.platformMultipliers[0];
  const curveMax = CONFIG.platformMultipliers.at(-1);
  const progress = Math.min(1, Math.max(0, (curveValue - curveMin) / (curveMax - curveMin)));
  return Number((config.minMultiplier + (config.maxMultiplier - config.minMultiplier) * progress).toFixed(2));
}

function landingSuccessRate(fromMultiplier, toMultiplier) {
  const edgeFactor = state.hasSuccessfulLanding ? 1 : CONFIG.rtp;
  return Math.min(1, edgeFactor * fromMultiplier / toMultiplier);
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
    platform.innerHTML = `<span class="platform-symbol">${isNext ? TYPE_INFO[type].symbol : ''}</span><span class="contact-glow"></span><span class="crack-overlay"></span><span class="platform-fragment fragment-left"></span><span class="platform-fragment fragment-right"></span>`;
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
  els.quickBets.forEach((button) => { button.disabled = locked; });
  els.difficulty.disabled = locked;
}

function syncQuickBetSelection() {
  const currentAmount = readBet();
  els.quickBets.forEach((button) => {
    const selected = Number(button.dataset.betAmount) === currentAmount;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function updateUI() {
  els.balance.textContent = formatMoney(state.balance);
  els.cashout.disabled = state.status !== 'playing' || !state.canCashout || state.isJumping || state.isAutoMoving;
  els.jump.disabled = state.status !== 'playing' || state.isJumping || state.isAutoMoving;
  syncQuickBetSelection();
}

function cyclePlatform() {
  if (!state.specialCycleActive || !['playing', 'jumping'].includes(state.status) || state.isAutoMoving) return;
  const candidates = state.previewPlatformType === 'normal'
    ? CONFIG.platformTypes
    : CONFIG.platformTypes.filter((type) => type !== state.previewPlatformType);
  state.previewPlatformType = candidates[Math.floor(Math.random() * candidates.length)];
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
  state.specialCycleActive = Math.random() < CONFIG.specialCycleChance;
  if (state.specialCycleActive) {
    const specialTypes = CONFIG.platformTypes.filter((type) => type !== 'normal');
    state.previewPlatformType = specialTypes[Math.floor(Math.random() * specialTypes.length)];
  } else {
    state.previewPlatformType = 'normal';
  }
  renderPlatforms();
  startCycle();
}

function wait(duration) { return new Promise((resolve) => setTimeout(resolve, duration)); }

function playColorShiftEffect() {
  els.player.classList.remove('color-shift');
  void els.player.offsetHeight;
  els.player.classList.add('color-shift');
  setTimeout(() => els.player.classList.remove('color-shift'), 560);
}

function showResultModal(type, title, subtitle = '') {
  els.resultModal.className = `result-modal ${type} show`;
  els.resultModal.setAttribute('aria-hidden', 'false');
  els.resultTitle.textContent = title;
  els.resultSubtitle.textContent = subtitle;
  els.resultSubtitle.hidden = !subtitle;
}

function clearResultModal() {
  els.resultModal.className = 'result-modal';
  els.resultModal.setAttribute('aria-hidden', 'true');
}

function closeResultModal(onClosed) {
  els.resultModal.classList.remove('show');
  els.resultModal.classList.add('closing');
  setTimeout(() => {
    clearResultModal();
    onClosed?.();
  }, 280);
}

async function resetBoard(animated = false) {
  stopCycle();
  clearResultModal();
  els.stage.classList.remove('screen-shake');
  els.player.className = 'player-cube reset-hidden';
  els.player.removeAttribute('style');
  setSettingsLocked(true);

  const viewportHeight = els.stage.clientHeight || 700;
  const resetTravel = Math.max(280, viewportHeight * .62);
  if (animated) {
    els.layer.style.transition = 'transform 240ms cubic-bezier(.55,.02,.85,.45), opacity 190ms ease';
    els.layer.style.opacity = '1';
    void els.layer.offsetHeight;
    requestAnimationFrame(() => {
      els.layer.style.transform = `translateY(${-resetTravel}px)`;
      els.layer.style.opacity = '.08';
    });
    await wait(255);
  }

  Object.assign(state, {
    status: 'idle', currentFloor: 0, previewPlatformType: 'normal', lockedPlatformType: null,
    isJumping: false, isAutoMoving: false, canCashout: false, gameOver: false,
    specialCycleActive: false, hasSuccessfulLanding: false
  });
  state.currentMultiplier = multiplierAt(0);
  renderPlatforms();

  if (animated) {
    els.layer.style.transition = 'none';
    els.layer.style.transform = `translateY(${resetTravel}px)`;
    els.layer.style.opacity = '.08';
    void els.layer.offsetHeight;
    els.layer.style.transition = 'transform 360ms cubic-bezier(.16,.82,.24,1), opacity 250ms ease';
    requestAnimationFrame(() => {
      els.layer.style.transform = 'translateY(0)';
      els.layer.style.opacity = '1';
    });
    await wait(380);
  }

  els.layer.removeAttribute('style');
  setActionMode('idle');
  setSettingsLocked(false);
  updateUI();
  els.player.className = animated ? 'player-cube reset-enter' : 'player-cube';
  if (animated) setTimeout(() => els.player.classList.remove('reset-enter'), 360);
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
    isJumping: false, isAutoMoving: false, canCashout: false, gameOver: false,
    specialCycleActive: false, hasSuccessfulLanding: false
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
  state.isJumping = true; state.status = 'jumping'; updateUI();
  els.player.classList.add('jumping');
  setTimeout(() => {
    stopCycle();
    state.lockedPlatformType = state.previewPlatformType;
    const locked = TYPE_INFO[state.lockedPlatformType];
    const isSpring = state.lockedPlatformType === 'spring';
    const isFlight = state.lockedPlatformType === 'flight';
    const isSpecial = isSpring || isFlight;
    els.player.classList.toggle('boost-spring', isSpring);
    els.player.classList.toggle('boost-flight', isFlight);
    if (isSpecial) playColorShiftEffect();
    const targetFloor = state.currentFloor + (isSpecial ? locked.distance + 1 : locked.distance);
    const targetMultiplier = multiplierAt(targetFloor);
    const initialLandingSuccess = Math.random() <= landingSuccessRate(state.currentMultiplier, targetMultiplier);
    if (!isSpecial && !initialLandingSuccess) {
      failRun();
      return;
    }
    if (!isSpecial) state.hasSuccessfulLanding = true;
    const totalDistance = isSpecial ? locked.distance + 1 : locked.distance;
    advanceFloors(totalDistance, state.lockedPlatformType, isSpecial);
  }, CONFIG.jumpDuration);
}

async function liftToNextStep(type) {
  const upperBottom = 102 + state.platformGap;
  els.player.classList.toggle('boost-flight', type === 'flight');
  els.player.classList.toggle('boost-spring', type === 'spring');
  els.player.style.transition = `bottom ${CONFIG.boostLiftDuration}ms cubic-bezier(.18,.8,.25,1), transform ${CONFIG.boostLiftDuration}ms ease`;
  els.player.style.bottom = `${upperBottom}px`;
  els.player.style.transform = `translateX(-50%) rotate(${type === 'flight' ? 0 : 70}deg)`;
  await wait(CONFIG.boostLiftDuration + 25);
}

function playPlatformContactEffect(type, offset = 1, isFinalLanding = false) {
  const platform = els.layer.querySelector(`.platform[data-offset="${offset}"]`);
  if (!platform) return;
  const hasPlayerLandingEffect = type === 'normal' || isFinalLanding;
  const effectClass = isFinalLanding ? `${type}-landing` : type === 'spring' ? 'spring-contact' : 'normal-contact';
  platform.classList.remove('spring-contact', 'normal-contact', 'spring-landing', 'flight-landing');
  els.player.classList.remove('landing-normal', 'landing-spring', 'landing-flight');
  void platform.offsetHeight;
  platform.classList.add(effectClass);
  if (hasPlayerLandingEffect) {
    els.player.classList.add(`landing-${type}`);
  }
  const cleanupDelay = isFinalLanding ? 620 : type === 'normal' ? 440 : 480;
  if (isFinalLanding) {
    const colorRestoreDelay = type === 'spring' ? 560 : cleanupDelay;
    setTimeout(() => els.player.classList.remove(`boost-${type}`), colorRestoreDelay);
  }
  setTimeout(() => {
    platform.classList.remove(effectClass);
    if (hasPlayerLandingEffect) els.player.classList.remove(`landing-${type}`);
  }, cleanupDelay);
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

async function flyAcrossFloors(distance, landingSuccess) {
  const cameraFloors = landingSuccess ? distance : Math.max(0, distance - 1);
  const duration = Math.max(720, cameraFloors * CONFIG.flightTravelPerFloor);
  const upperBottom = 102 + state.platformGap;
  const cruiseBottom = 102 + state.platformGap * .78;
  const approachBottom = 102 + state.platformGap * .42;

  els.player.style.animation = 'none';
  els.player.classList.remove('jumping');
  els.player.classList.add('boost-flight');
  const playerFrames = landingSuccess ? [
    { bottom: '102px', transform: 'translateX(-50%) rotate(0deg)', offset: 0 },
    { bottom: `${cruiseBottom}px`, transform: 'translateX(-50%) rotate(0deg)', offset: .16 },
    { bottom: `${cruiseBottom}px`, transform: 'translateX(-50%) rotate(0deg)', offset: .5 },
    { bottom: `${approachBottom}px`, transform: 'translateX(-50%) rotate(0deg)', offset: .76 },
    { bottom: '102px', transform: 'translateX(-50%) rotate(0deg)', offset: 1 }
  ] : [
    { bottom: '102px', transform: 'translateX(-50%) rotate(0deg)', offset: 0 },
    { bottom: `${cruiseBottom}px`, transform: 'translateX(-50%) rotate(0deg)', offset: .16 },
    { bottom: `${cruiseBottom}px`, transform: 'translateX(-50%) rotate(0deg)', offset: .8 },
    { bottom: `${upperBottom}px`, transform: 'translateX(-50%) rotate(0deg)', offset: 1 }
  ];
  const playerMotion = els.player.animate(playerFrames, {
    duration,
    easing: landingSuccess ? 'cubic-bezier(.2,.58,.24,1)' : 'cubic-bezier(.22,.62,.28,1)',
    fill: 'forwards'
  });

  els.layer.style.transition = `transform ${duration}ms cubic-bezier(.22,.62,.28,1)`;
  requestAnimationFrame(() => {
    Array.from(els.layer.children).forEach((platform) => {
      const nextOffset = Number(platform.dataset.offset) - cameraFloors;
      const nextScale = Math.max(.57, 1 - Math.max(0, nextOffset) * .065);
      platform.style.transition = `transform ${duration}ms cubic-bezier(.22,.62,.28,1), width ${duration}ms cubic-bezier(.22,.62,.28,1), opacity ${duration}ms ease`;
      platform.style.setProperty('--scale', `${nextScale}`);
      platform.style.width = `${nextOffset === 0 ? 284 : nextOffset === 1 ? 262 : 242}px`;
      platform.style.opacity = `${Math.max(.2, 1 - Math.max(0, nextOffset) * .105)}`;
    });
    els.layer.style.transform = `translateY(${cameraFloors * state.platformGap}px)`;
  });

  await wait(duration + 20);
  playerMotion.cancel();
  state.currentFloor += cameraFloors;
  state.currentMultiplier = multiplierAt(state.currentFloor);
  els.layer.style.transition = 'none';
  els.layer.style.transform = 'none';
  renderPlatforms();
  void els.layer.offsetHeight;
  els.player.style.animation = 'none';
  els.player.style.transition = 'none';
  els.player.style.bottom = landingSuccess ? '102px' : `${upperBottom}px`;
  els.player.style.transform = 'translateX(-50%) rotate(0deg)';
  return landingSuccess;
}

async function advanceFloors(distance, type, checkFinalLanding = false) {
  const riskBaseMultiplier = state.currentMultiplier;
  const targetMultiplier = multiplierAt(state.currentFloor + distance);
  state.isAutoMoving = true;
  state.previewPlatformType = 'normal';
  state.specialCycleActive = false;
  if (type !== 'normal') {
    els.player.classList.toggle('boost-spring', type === 'spring');
    els.player.classList.toggle('boost-flight', type === 'flight');
  }

  if (type === 'flight') {
    await scrollOneFloor();
    const remainingDistance = distance - 1;
    const finalLandingSuccess = !checkFinalLanding || Math.random() <= landingSuccessRate(riskBaseMultiplier, targetMultiplier);
    const landed = await flyAcrossFloors(remainingDistance, finalLandingSuccess);
    if (!landed) {
      state.isAutoMoving = false;
      failRun();
      return;
    }
    state.hasSuccessfulLanding = true;
  } else {

    for (let step = 0; step < distance; step += 1) {
      if (step > 0) {
        await liftToNextStep(type);
        if (checkFinalLanding && step === distance - 1) {
          const finalLandingSuccess = Math.random() <= landingSuccessRate(riskBaseMultiplier, targetMultiplier);
          if (!finalLandingSuccess) {
            state.isAutoMoving = false;
            failRun();
            return;
          }
          state.hasSuccessfulLanding = true;
        }
      }
      if (type === 'normal') {
        playPlatformContactEffect(type);
      } else if (type === 'spring') {
        const isFinalSpringLanding = checkFinalLanding && step === distance - 1;
        playPlatformContactEffect(type, 1, isFinalSpringLanding);
      }
      await scrollOneFloor();
    }
  }

  els.player.classList.remove('boost-flight');
  if (!(checkFinalLanding && type === 'spring')) els.player.classList.remove('boost-spring');
  els.player.removeAttribute('style');
  state.isJumping = false;
  state.isAutoMoving = false;
  state.canCashout = true;
  state.status = 'playing';
  state.lockedPlatformType = null;
  prepareNextPlatform();
  if (checkFinalLanding && type === 'flight') playPlatformContactEffect(type, 0, true);
  updateUI();
}

function failRun() {
  state.status = 'failed'; state.isJumping = false;
  const brokenPlatform = els.layer.querySelector('.platform[data-offset="1"]');
  const upperBottom = 102 + state.platformGap;
  els.player.style.animation = 'none';
  els.player.style.bottom = `${upperBottom}px`;
  els.player.style.transform = 'translateX(-50%) rotate(94deg)';
  els.player.classList.remove('jumping');
  void els.player.offsetHeight;
  brokenPlatform?.classList.add('cracking');
  els.stage.classList.add('screen-shake');
  setTimeout(() => {
    brokenPlatform?.classList.remove('cracking');
    brokenPlatform?.classList.add('broken');
    els.player.style.animation = '';
    els.player.classList.add('falling-through');
  }, 520);
  setTimeout(() => showResultModal('failure', '再接再勵！'), 1420);
  setTimeout(() => closeResultModal(() => resetBoard(true)), 2920);
}

function cashout() {
  if (!state.canCashout || state.isJumping || state.isAutoMoving) return;
  state.status = 'cashout';
  const reward = Number((state.currentBet * state.currentMultiplier).toFixed(2));
  state.balance = Number((state.balance + reward).toFixed(2));
  updateUI();
  showResultModal('reward', formatMoney(reward), formatMultiplier(state.currentMultiplier));
  setTimeout(() => closeResultModal(() => resetBoard(true)), 1600);
}

function changeBet(multiplier) {
  const next = Math.max(1, Math.min(state.balance || 1, readBet() * multiplier));
  els.betInput.value = Number(next.toFixed(2));
  syncQuickBetSelection();
}

function setQuickBet(amount) {
  els.betInput.value = Number(Math.min(amount, state.balance || amount).toFixed(2));
  syncQuickBetSelection();
}

els.bet.addEventListener('click', startBet);
els.jump.addEventListener('click', jump);
els.cashout.addEventListener('click', cashout);
els.halfBet.addEventListener('click', () => changeBet(.5));
els.doubleBet.addEventListener('click', () => changeBet(2));
els.quickBets.forEach((button) => button.addEventListener('click', () => setQuickBet(Number(button.dataset.betAmount))));
els.betInput.addEventListener('input', syncQuickBetSelection);
els.addBalance.addEventListener('click', () => { state.balance += 1000; updateUI(); });
els.difficulty.addEventListener('change', () => {
  state.difficulty = els.difficulty.value;
  state.currentMultiplier = multiplierAt(0);
  renderPlatforms();
});
window.addEventListener('resize', renderPlatforms);

resetBoard();
