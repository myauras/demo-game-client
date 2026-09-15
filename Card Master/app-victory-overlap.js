'use strict';
const $ = id => document.getElementById(id);
const suits = ['♣', '♦', '♥', '♠'];
const suitNames = ['梅花', '方塊', '紅心', '黑桃'];
const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const storageKey = 'card-master-demo-v1';
let balance = 10000, running = false;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Number.isFinite(saved.balance) && saved.balance >= 0) balance = Math.round(saved.balance * 100) / 100;
} catch (_) { /* A fresh session is also usable when storage is unavailable. */ }
const format = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = () => Number($('count').value);
const cardName = id => `${suitNames[Math.floor(id / 13)]} ${ranks[id % 13]}`;
for (let n = 5; n <= 36; n++) {
  const option = document.createElement('option');
  option.value = n; option.textContent = n; $('count').append(option);
  const menuOption = document.createElement('button');
  menuOption.type = 'button'; menuOption.dataset.count = n; menuOption.textContent = n;
  menuOption.setAttribute('role', 'option'); $('count-menu').append(menuOption);
}
function syncCountMenu() {
  $('count-value').textContent = $('count').value;
  document.querySelectorAll('[data-count]').forEach(option => {
    const selected = option.dataset.count === $('count').value;
    option.classList.toggle('selected', selected); option.setAttribute('aria-selected', selected);
  });
}
function closeCountMenu() { $('count-menu').hidden = true; $('count-trigger').setAttribute('aria-expanded', 'false'); }
$('count-trigger').onclick = () => {
  if (running) return;
  const opening = $('count-menu').hidden;
  $('count-menu').hidden = !opening; $('count-trigger').setAttribute('aria-expanded', String(opening));
  if (opening) document.querySelector('[data-count].selected')?.scrollIntoView({block:'center'});
};
$('count-menu').onclick = event => {
  const option = event.target.closest('[data-count]');
  if (!option || running) return;
  $('count').value = option.dataset.count; $('count').dispatchEvent(new Event('change', {bubbles:true}));
  closeCountMenu(); $('count-trigger').focus();
};
document.addEventListener('click', event => { if (!event.target.closest('.count-control')) closeCountMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeCountMenu(); $('count-trigger').focus(); } });
syncCountMenu();
// Keep card identities stable; render ranks as rows and suits in reference order.
for (let position = 0; position < 52; position++) {
  const id = [0, 3, 1, 2][position % 4] * 13 + Math.floor(position / 4);
  const suit = Math.floor(id / 13), card = document.createElement('div');
  card.className = `card${suit === 1 || suit === 2 ? ' red' : ''}`;
  card.id = `card-${id}`;
  card.setAttribute('aria-label', cardName(id));
  card.innerHTML = `<span class="rank">${ranks[id % 13]}</span><span class="suit">${suits[suit]}</span><span class="badge">×2</span>`;
  $('board').append(card);
}
function save() { try { localStorage.setItem(storageKey, JSON.stringify({ balance })); } catch (_) {} }
function renderBalance() {
  $('balance').textContent = format(balance);
}
function update() {
  const n = count(), stake = Number($('stake').value), m = CardMaster.multiplier(n);
  $('multiplier').innerHTML = `${m.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}<span>×</span>`;
  $('multiplier').classList.toggle('large-number',m >= 10000);
  document.querySelectorAll('[data-stake]').forEach(b => { b.classList.toggle('selected', Number(b.dataset.stake) === stake); b.setAttribute('aria-pressed', Number(b.dataset.stake) === stake); });
}
$('count').addEventListener('change', () => { syncCountMenu(); update(); });
$('stake').addEventListener('input', () => { $('validation').textContent = ''; update(); });
document.querySelectorAll('[data-stake]').forEach(b => b.onclick = () => { if (!running) { $('stake').value = b.dataset.stake; $('validation').textContent = ''; update(); } });
function adjustStake(factor) { if (!running) { $('stake').value = Math.max(1, Math.min(1000000, Math.floor((Number($('stake').value) || 100)*factor))); update(); } }
$('half').onclick = () => adjustStake(.5); $('double').onclick = () => adjustStake(2);
$('reset').onclick = () => { if (running) return; balance = 10000; save(); renderBalance(); $('validation').textContent = ''; };
function lock(value) {
  running = value;
  if (value) closeCountMenu();
  document.querySelectorAll('.controls input,.controls select,.controls button,#reset').forEach(el => el.disabled = value);
  $('play').innerHTML = value ? '翻牌中…' : '<span class="button-gem">◆</span>投注';
  update();
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function showVictoryGlow(cards) {
  cards.forEach((id, index) => {
    const card = $(`card-${id}`);
    card.style.setProperty('--glow-delay', `${index * 18}ms`);
    card.classList.add('victory-glow');
  });
  const finalGlowEnd = 820 + Math.max(0, cards.length - 1) * 18;
  await delay(Math.max(0, finalGlowEnd - 220));
}
function prepareFireworks() {
  const fireworks = $('fireworks');
  fireworks.replaceChildren();
  [
    ['22%', '35%', '0ms'], ['78%', '32%', '180ms'],
    ['30%', '66%', '390ms'], ['70%', '68%', '560ms']
  ].forEach(([x, y, burstDelay], burstIndex) => {
    const burst = document.createElement('span');
    burst.className = 'firework';
    burst.style.setProperty('--x', x); burst.style.setProperty('--y', y);
    burst.style.setProperty('--burst-delay', burstDelay);
    for (let index = 0; index < 12; index++) {
      const spark = document.createElement('i');
      spark.style.setProperty('--angle', `${index * 30}deg`);
      spark.style.setProperty('--distance', `${34 + (index % 3) * 8}px`);
      spark.style.setProperty('--spark-color', (index + burstIndex) % 3 === 0 ? '#66fff0' : '#f5d77e');
      burst.append(spark);
    }
    fireworks.append(burst);
  });
}
async function showSettlement(amount) {
  const settlement = $('win-settlement');
  $('win-amount').textContent = format(amount);
  prepareFireworks();
  settlement.classList.remove('show');
  void settlement.offsetWidth;
  settlement.setAttribute('aria-hidden', 'false');
  settlement.classList.add('show');
  await delay(1800);
  settlement.classList.remove('show');
  settlement.setAttribute('aria-hidden', 'true');
}
$('play').onclick = async () => {
  if (running) return;
  const n = count(), stake = Number($('stake').value);
  if (!Number.isInteger(stake) || stake < 1 || stake > 1000000) { $('validation').textContent = '請輸入 1～1,000,000 的整數點數。'; return; }
  if (stake > balance) { $('validation').textContent = '模擬點數不足，可按右上角 ＋ 重設。'; return; }
  lock(true); balance = Math.round((balance - stake)*100)/100; save(); renderBalance();
  $('validation').textContent = '';
  document.querySelectorAll('.card').forEach(c => { c.classList.remove('drawn','duplicate','victory-glow'); c.style.removeProperty('--glow-delay'); c.setAttribute('aria-label',cardName(Number(c.id.slice(5)))); });
  $('progress-track').classList.remove('failed');
  $('progress').style.width = '0%';
  const cards = []; let result;
  await delay(450);
  do {
    const id = CardMaster.draw(); cards.push(id);
    result = CardMaster.settle(stake,n,cards);
    const card = $(`card-${id}`); card.classList.add('drawn');
    if (result.complete && !result.win) { card.classList.add('duplicate'); $('progress-track').classList.add('failed'); }
    card.setAttribute('aria-label', `${cardName(id)}，${result.complete && !result.win ? '重複出現' : '已翻開'}`);
    $('progress').style.width = `${cards.length/n*100}%`;
    if (!result.complete) await delay(440);
  } while (!result.complete);
  balance = Math.round((balance + result.payout)*100)/100;
  save(); renderBalance();
  if (result.win) { await delay(260); await showVictoryGlow(cards); await showSettlement(result.payout); }
  lock(false);
};
renderBalance(); update();
