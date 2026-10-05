const roles = {
  warrior: { label: '戰士', icon: '⚔', values: ['3.9X','12.5X','28X','52X','85X','133X','200X','BONUS'], numbers: [3.9,12.5,28,52,85,133,200,0], step: 0 },
  archer: { label: '弓箭手', icon: '➶', values: ['2.5X','7.7X','16X','27.5X','44X','+20.5X'], numbers: [2.5,7.7,16,27.5,44,20.5], step: 0 },
  mage: { label: '法師', icon: '✦', values: ['1.55X','4.85X','10X','+7X'], numbers: [1.55,4.85,10,7], step: 0 },
};

const events = {
  WARRIOR: { label: '戰士突擊', image: './assets/event-warrior.webp', role: 'warrior', color: '#ff2f73', rgb: '255,47,115' },
  ARCHER: { label: '箭雨突襲', image: './assets/event-archer.webp', role: 'archer', color: '#20dd54', rgb: '32,221,84' },
  MAGE: { label: '秘法湧現', image: './assets/event-mage.webp', role: 'mage', color: '#00b8f4', rgb: '0,184,244' },
  SILENCE: { label: '沉默術', image: './assets/event-silence.webp', color: '#b9ddff', rgb: '185,221,255' },
  BOSS: { label: '魔王反擊', image: './assets/event-boss.webp', color: '#ed20ff', rgb: '237,32,255' },
};

const state = { balance: 3000, bet: 10, lastWin: 0, locked: false, hasProgress: false };
const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const balanceEl = $('#balance');
const resetBalanceButton = $('#resetBalanceButton');
const betAmountEl = $('#betAmount');
const betButton = $('#betButton');
const partialButton = $('#partialButton');
const cashoutButton = $('#cashoutButton');
const resultCore = $('#resultCore');
const resultIcon = $('#resultIcon');
const rewardPopup = $('#rewardPopup');
const rewardAmount = $('#rewardAmount');
const rewardMultiplier = $('#rewardMultiplier');

function buildNodes() {
  Object.entries(roles).forEach(([key, role]) => {
    const host = document.getElementById(`${key}Nodes`);
    host.innerHTML = '';

    const totalPositions = role.values.length;
    const start = document.createElement('span');
    start.className = 'node start-node';
    start.dataset.step = '0';
    start.style.setProperty('--angle', '0deg');
    start.textContent = role.icon;
    start.title = `${role.label}起點`;
    host.appendChild(start);

    role.values.forEach((value, index) => {
      const node = document.createElement('span');
      const step = index + 1;
      const angle = (360 / totalPositions) * step;
      const valueAngle = angle - (180 / totalPositions);
      node.className = 'node value-node';
      node.dataset.valueStep = String(step);
      node.style.setProperty('--angle', `${valueAngle}deg`);
      node.style.setProperty('--text-flip', valueAngle > 90 && valueAngle < 270 ? '180deg' : '0deg');
      node.textContent = value;
      host.appendChild(node);

      if (step < role.values.length) {
        const separator = document.createElement('span');
        separator.className = 'separator progress-node';
        separator.dataset.step = String(step);
        separator.style.setProperty('--angle', `${angle}deg`);
        separator.textContent = '☠';
        separator.setAttribute('aria-hidden', 'true');
        host.appendChild(separator);
      }
    });
  });
}

function money(value) { return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function render() {
  balanceEl.textContent = money(state.balance);
  if (document.activeElement !== betAmountEl) betAmountEl.value = state.bet;

  Object.entries(roles).forEach(([key, role]) => {
    const ring = document.querySelector(`[data-role="${key}"]`);
    const degrees = (role.step / role.values.length) * 360;
    ring.style.setProperty('--progress', `${degrees}deg`);
    ring.querySelectorAll('[data-step]').forEach((node) => {
      const nodeStep = Number(node.dataset.step);
      node.classList.toggle('reached', nodeStep > 0 && nodeStep <= role.step);
      node.classList.toggle('current', nodeStep === role.step);
    });
    ring.querySelectorAll('[data-value-step]').forEach((node) => {
      const valueStep = Number(node.dataset.valueStep);
      node.classList.toggle('reached', valueStep <= role.step);
      node.classList.toggle('current', valueStep === role.step);
    });
  });

  state.hasProgress = Object.values(roles).some(role => role.step > 0);
  const canPartial = Object.values(roles).some(role => role.step >= 2);
  betButton.disabled = state.locked || state.balance < state.bet;
  partialButton.disabled = state.locked || !canPartial;
  cashoutButton.disabled = state.locked || !state.hasProgress;
  document.querySelectorAll('.bet-row button').forEach(button => button.disabled = state.locked);
}

function pickEvent() {
  const roll = Math.random();
  if (roll < .29) return 'WARRIOR';
  if (roll < .54) return 'ARCHER';
  if (roll < .78) return 'MAGE';
  if (roll < .89) return 'SILENCE';
  return 'BOSS';
}

function setResult(type) {
  const event = events[type];
  resultIcon.textContent = '';
  resultIcon.dataset.icon = '';
  resultIcon.style.setProperty('--icon-image', `url("${event.image}")`);
  resultCore.style.setProperty('--event-color', event.color);
  resultCore.style.setProperty('--event-rgb', event.rgb);
  resultIcon.setAttribute('aria-label', event.label);
}

function formatMultiplier(value) {
  return Number(value.toFixed(2)).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

async function showReward(amount, multiplier, variant) {
  rewardAmount.textContent = `+${money(amount)}`;
  rewardMultiplier.textContent = `${formatMultiplier(multiplier)}X`;
  rewardPopup.className = `reward-popup reward-${variant}`;
  rewardPopup.hidden = false;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  rewardPopup.classList.add('show');

  await sleep(variant === 'bonus' ? 1450 : variant === 'all' ? 1250 : 950);

  if (variant === 'partial') {
    const cardRect = rewardPopup.querySelector('.reward-card').getBoundingClientRect();
    const balanceRect = document.querySelector('.balance-card').getBoundingClientRect();
    rewardPopup.style.setProperty('--reward-fly-x', `${balanceRect.left + balanceRect.width / 2 - (cardRect.left + cardRect.width / 2)}px`);
    rewardPopup.style.setProperty('--reward-fly-y', `${balanceRect.bottom + 10 + cardRect.height / 2 - (cardRect.top + cardRect.height / 2)}px`);
  }

  rewardPopup.classList.add('exit');
  await sleep(variant === 'partial' ? 950 : variant === 'bonus' ? 720 : 560);
  rewardPopup.hidden = true;
  rewardPopup.className = 'reward-popup';
  rewardPopup.style.removeProperty('--reward-fly-x');
  rewardPopup.style.removeProperty('--reward-fly-y');
}

function restartIconAnimation(className, duration) {
  resultIcon.classList.remove('reel-spin', 'reel-stop');
  void resultIcon.offsetWidth;
  resultIcon.style.setProperty('--reel-speed', `${duration}ms`);
  resultIcon.classList.add(className);
}

async function animateResult(finalType) {
  resultCore.classList.add('rolling');
  const keys = Object.keys(events);
  for (let i = 0; i < 11; i++) {
    const speed = 92 + i * 13;
    setResult(keys[i % keys.length]);
    restartIconAnimation('reel-spin', speed);
    await sleep(speed);
  }
  setResult(finalType);
  restartIconAnimation('reel-stop', 360);
  await sleep(360);
  resultCore.classList.remove('rolling');
}

function payoutFor(role) { return role.step === 0 ? 0 : state.bet * role.numbers[role.step - 1]; }

async function resolveAdvance(roleKey) {
  const role = roles[roleKey];
  role.step = Math.min(role.step + 1, role.values.length);
  const ring = document.querySelector(`[data-role="${roleKey}"]`);
  ring.classList.add('active');
  render();
  await sleep(430);
  ring.classList.remove('active');

  const reachedEnd = role.step === role.values.length;
  if (!reachedEnd) return;

  if (roleKey === 'warrior') {
    await runBonus();
    return;
  }

  const win = payoutFor(role);
  const multiplier = role.numbers[role.step - 1];
  await showReward(win, multiplier, 'partial');
  state.balance += win;
  state.lastWin = win;
  render();
  role.step = Math.max(0, role.step - 1);
  await sleep(600);
}

async function runBonus() {
  const options = [100, 200, 300, 400];
  const result = options[Math.floor(Math.random() * options.length)];
  resultCore.classList.add('rolling');
  resultCore.style.setProperty('--event-color', '#e6b94c');
  resultCore.style.setProperty('--event-rgb', '230,185,76');
  resultIcon.style.setProperty('--icon-image', 'none');
  resultIcon.removeAttribute('aria-label');
  for (let i = 0; i < 15; i++) {
    const value = options[i % options.length];
    const speed = 70 + i * 14;
    resultIcon.textContent = `${value}×`;
    resultIcon.dataset.icon = `${value}×`;
    resultIcon.style.fontSize = 'clamp(16px,5vw,24px)';
    restartIconAnimation('reel-spin', speed);
    await sleep(speed);
  }
  resultCore.classList.remove('rolling');
  resultIcon.textContent = `${result}×`;
  resultIcon.dataset.icon = `${result}×`;
  restartIconAnimation('reel-stop', 360);
  await sleep(720);
  const win = state.bet * result;
  await showReward(win, result, 'bonus');
  state.balance += win;
  state.lastWin = win;
  render();
  roles.warrior.step = 0;
  await sleep(800);
  resultIcon.style.fontSize = '';
}

async function placeBet() {
  if (state.locked || state.balance < state.bet) return;
  state.locked = true;
  state.balance -= state.bet;
  state.lastWin = 0;
  render();

  const type = pickEvent();
  await animateResult(type);
  if (events[type].role) {
    await resolveAdvance(events[type].role);
  } else if (type === 'BOSS') {
    Object.values(roles).forEach(role => role.step = Math.max(0, role.step - 1));
    await sleep(450);
  } else {
    await sleep(300);
  }

  state.locked = false;
  render();
}

async function settle(mode) {
  if (state.locked || !state.hasProgress) return;
  state.locked = true;
  render();
  const total = Object.values(roles).reduce((sum, role) => sum + payoutFor(role), 0);
  const multiplier = total / state.bet;
  await showReward(total, multiplier, mode === 'partial' ? 'partial' : 'all');
  state.balance += total;
  state.lastWin = total;
  render();

  if (mode === 'partial') {
    Object.values(roles).forEach(role => role.step = Math.max(0, role.step - 1));
  } else {
    Object.values(roles).forEach(role => role.step = 0);
  }
  await sleep(650);
  state.locked = false;
  render();
}

function setBet(next) {
  const parsed = Number(next);
  state.bet = Number.isFinite(parsed) ? Math.max(1, Math.min(100000, Math.round(parsed))) : 10;
  document.querySelectorAll('[data-bet]').forEach(button => button.classList.toggle('active', Number(button.dataset.bet) === state.bet));
  render();
}

document.querySelectorAll('[data-bet]').forEach(button => button.addEventListener('click', () => setBet(Number(button.dataset.bet))));
document.querySelector('[data-bet-action="half"]').addEventListener('click', () => setBet(state.bet / 2));
document.querySelector('[data-bet-action="double"]').addEventListener('click', () => setBet(state.bet * 2));
betAmountEl.addEventListener('input', () => setBet(betAmountEl.value));
betAmountEl.addEventListener('change', () => setBet(betAmountEl.value));
betAmountEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') betAmountEl.blur();
});
resetBalanceButton.addEventListener('click', () => {
  state.balance = 3000;
  state.lastWin = 0;
  render();
});
betButton.addEventListener('click', placeBet);
partialButton.addEventListener('click', () => settle('partial'));
cashoutButton.addEventListener('click', () => settle('all'));

buildNodes();
setResult('BOSS');
render();
