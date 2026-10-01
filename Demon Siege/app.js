const roles = {
  warrior: { label: '戰士', icon: '⚔', values: ['3.9X','12.5X','28X','52X','85X','133X','200X','BONUS'], numbers: [3.9,12.5,28,52,85,133,200,0], step: 0 },
  archer: { label: '弓箭手', icon: '➶', values: ['2.5X','7.7X','16X','27.5X','44X','+20.5X'], numbers: [2.5,7.7,16,27.5,44,20.5], step: 0 },
  mage: { label: '法師', icon: '✦', values: ['1.55X','4.85X','10X','+7X'], numbers: [1.55,4.85,10,7], step: 0 },
};

const events = {
  WARRIOR: { label: '戰士突擊', icon: '⚔', role: 'warrior', color: '#df493f' },
  ARCHER: { label: '箭雨突襲', icon: '➶', role: 'archer', color: '#6fc36b' },
  MAGE: { label: '秘法湧現', icon: '✦', role: 'mage', color: '#54a9d7' },
  SILENCE: { label: '沉默術', icon: '◉', color: '#9c89b8' },
  BOSS: { label: '魔王反擊', icon: '♜', color: '#ff734c' },
};

const state = { balance: 3000, bet: 10, lastWin: 0, locked: false, hasProgress: false };
const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const balanceEl = $('#balance');
const betAmountEl = $('#betAmount');
const lastWinEl = $('#lastWin');
const betButton = $('#betButton');
const partialButton = $('#partialButton');
const cashoutButton = $('#cashoutButton');
const resultCore = $('#resultCore');
const resultIcon = $('#resultIcon');
const resultName = $('#resultName');
const resultHint = $('#resultHint');
const roundStatus = $('#roundStatus');
const toast = $('#toast');

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
      node.className = 'node value-node';
      node.dataset.valueStep = String(step);
      node.style.setProperty('--angle', `${angle - (180 / totalPositions)}deg`);
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
  betAmountEl.textContent = state.bet;
  lastWinEl.textContent = money(state.lastWin);

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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1900);
}

function setResult(type, hint = '') {
  const event = events[type];
  resultIcon.textContent = event.icon;
  resultIcon.dataset.icon = event.icon;
  resultIcon.style.color = event.color;
  resultIcon.style.textShadow = `0 0 16px ${event.color}`;
  resultName.textContent = event.label;
  resultHint.textContent = hint;
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
  state.balance += win;
  state.lastWin = win;
  showToast(`${role.label}最終倍率，自動獲得 ${money(win)}`);
  role.step = Math.max(0, role.step - 1);
  await sleep(600);
}

async function runBonus() {
  const options = [100, 200, 300, 400];
  const result = options[Math.floor(Math.random() * options.length)];
  roundStatus.textContent = '戰士 BONUS 啟動';
  resultCore.classList.add('rolling');
  for (let i = 0; i < 15; i++) {
    const value = options[i % options.length];
    const speed = 70 + i * 14;
    resultIcon.textContent = `${value}×`;
    resultIcon.dataset.icon = `${value}×`;
    resultIcon.style.fontSize = 'clamp(16px,5vw,24px)';
    resultName.textContent = 'BONUS';
    restartIconAnimation('reel-spin', speed);
    await sleep(speed);
  }
  resultCore.classList.remove('rolling');
  resultIcon.textContent = `${result}×`;
  resultIcon.dataset.icon = `${result}×`;
  restartIconAnimation('reel-stop', 360);
  const win = state.bet * result;
  state.balance += win;
  state.lastWin = win;
  roles.warrior.step = 0;
  showToast(`BONUS 戰果 +${money(win)}`);
  await sleep(800);
  resultIcon.style.fontSize = '';
}

async function placeBet() {
  if (state.locked || state.balance < state.bet) return;
  state.locked = true;
  state.balance -= state.bet;
  state.lastWin = 0;
  roundStatus.textContent = '戰況推演中…';
  render();

  const type = pickEvent();
  await animateResult(type);
  roundStatus.textContent = events[type].label;

  if (events[type].role) {
    await resolveAdvance(events[type].role);
  } else if (type === 'BOSS') {
    Object.values(roles).forEach(role => role.step = Math.max(0, role.step - 1));
    showToast('魔王反擊：三軍各後退一階');
    await sleep(450);
  } else {
    showToast('沉默術籠罩戰場，本回合無事發生');
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
  state.balance += total;
  state.lastWin = total;
  setResult('WARRIOR');
  resultName.textContent = mode === 'partial' ? '部分結算' : '凱旋結算';
  resultIcon.textContent = '◆';
  showToast(`戰果入帳 +${money(total)}`);

  if (mode === 'partial') {
    Object.values(roles).forEach(role => role.step = Math.max(0, role.step - 1));
  } else {
    Object.values(roles).forEach(role => role.step = 0);
  }
  await sleep(650);
  state.locked = false;
  roundStatus.textContent = mode === 'partial' ? '整軍再戰' : '新戰役待命';
  render();
}

function setBet(next) {
  state.bet = Math.max(1, Math.min(200, Math.round(next)));
  document.querySelectorAll('[data-bet]').forEach(button => button.classList.toggle('active', Number(button.dataset.bet) === state.bet));
  render();
}

document.querySelectorAll('[data-bet]').forEach(button => button.addEventListener('click', () => setBet(Number(button.dataset.bet))));
document.querySelector('[data-bet-action="half"]').addEventListener('click', () => setBet(state.bet / 2));
document.querySelector('[data-bet-action="double"]').addEventListener('click', () => setBet(state.bet * 2));
betButton.addEventListener('click', placeBet);
partialButton.addEventListener('click', () => settle('partial'));
cashoutButton.addEventListener('click', () => settle('all'));

const helpDialog = $('#helpDialog');
$('#helpButton').addEventListener('click', () => helpDialog.showModal());
$('#closeHelp').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (event) => { if (event.target === helpDialog) helpDialog.close(); });
$('#soundButton').addEventListener('click', (event) => {
  event.currentTarget.classList.toggle('sound-on');
  showToast(event.currentTarget.classList.contains('sound-on') ? '音效已開啟' : '音效已關閉');
});

buildNodes();
render();
