const items = [
  { code: "AK", name: "AK-47｜夜行", color: "#7a9cff", grade: "限制級", image: "assets/card-1.webp" },
  { code: "AWP", name: "AWP｜冷線", color: "#bd78ff", grade: "機密", image: "assets/card-2.webp" },
  { code: "M4", name: "M4A1-S｜灰燼", color: "#58b7d2", grade: "軍規級", image: "assets/card-3.webp" },
  { code: "USP", name: "USP-S｜靜默", color: "#5d89c7", grade: "軍規級", image: "assets/card-4.webp" },
  { code: "P90", name: "P90｜蜂巢", color: "#d26e8b", grade: "機密", image: "assets/card-5.webp" },
  { code: "DE", name: "沙漠之鷹｜熔核", color: "#e1973e", grade: "隱密", image: "assets/card-6.webp" },
  { code: "K", name: "戰術刀｜琥珀", color: "#f0bd4e", grade: "稀有特殊物品", image: "assets/card-7.webp" },
  { code: "HE", name: "高爆手雷｜警戒", color: "#7fb467", grade: "工業級", image: "assets/card-8.webp" }
];

const assetsReady = Promise.all([
  "assets/weapon-case.webp",
  ...items.map(item => item.image)
].map(source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(source);
  image.onerror = () => reject(new Error(`無法載入圖片：${source}`));
  image.src = source;
})));

const patterns = {
  "1,1,1,1,1": { key: "high-card", label: "各不相同", mult: 0 },
  "2,1,1,1": { key: "pair", label: "一對", mult: .1 },
  "2,2,1": { key: "two-pair", label: "兩對", mult: 2 },
  "3,1,1": { key: "three", label: "三同", mult: 4 },
  "3,2": { key: "full-house", label: "葫蘆", mult: 6 },
  "4,1": { key: "four", label: "四同", mult: 7 },
  "5": { key: "five", label: "五同", mult: 60 }
};

const $ = (selector) => document.querySelector(selector);
const cardsEl = $("#cards");
const playfield = $("#playfield");
const betInput = $("#bet-input");
const deployButton = $("#deploy-button");
const balanceEl = $("#balance");
const statusEl = $("#status");
const revealCount = $("#reveal-count");
const resultPanel = $("#result-panel");
const beamLayer = $("#beam-layer");
let balance = 10000;
let state = "IDLE";
let round = [];
let revealed = new Set();
let dragging = false;
let currentBet = 10;

function money(value) {
  return `$ ${value.toFixed(2)}`;
}

function setBalance(value) {
  balance = Math.max(0, Number(value.toFixed(2)));
  balanceEl.textContent = money(balance);
}

function setControls(disabled) {
  betInput.disabled = disabled;
  document.querySelectorAll(".bet-row button").forEach(button => button.disabled = disabled);
  deployButton.disabled = disabled;
}

function emptyField() {
  cardsEl.replaceChildren();
}

function weightedRound() {
  const roll = Math.random();
  let structure;
  if (roll < .004) structure = [5];
  else if (roll < .025) structure = [4, 1];
  else if (roll < .075) structure = [3, 2];
  else if (roll < .18) structure = [3, 1, 1];
  else if (roll < .4) structure = [2, 2, 1];
  else if (roll < .76) structure = [2, 1, 1, 1];
  else structure = [1, 1, 1, 1, 1];
  const pool = [...items].sort(() => Math.random() - .5);
  const result = [];
  structure.forEach((count, index) => { for (let i = 0; i < count; i++) result.push(pool[index]); });
  return result.sort(() => Math.random() - .5);
}

function getResult() {
  const counts = {};
  round.forEach(item => counts[item.code] = (counts[item.code] || 0) + 1);
  const signature = Object.values(counts).sort((a, b) => b - a).join(",");
  return patterns[signature];
}

function getWinningIndexes() {
  const counts = {};
  round.forEach(item => counts[item.code] = (counts[item.code] || 0) + 1);
  return round
    .map((item, index) => counts[item.code] > 1 ? index : -1)
    .filter(index => index !== -1);
}

function fitResultPayout() {
  const payoutEl = $("#result-payout");
  const panelStyle = getComputedStyle(resultPanel);
  const availableWidth = resultPanel.clientWidth
    - parseFloat(panelStyle.paddingLeft)
    - parseFloat(panelStyle.paddingRight);
  payoutEl.style.fontSize = "";
  let fontSize = parseFloat(getComputedStyle(payoutEl).fontSize);
  while (payoutEl.scrollWidth > availableWidth && fontSize > 26) {
    fontSize -= 1;
    payoutEl.style.fontSize = `${fontSize}px`;
  }
}

function renderCards() {
  cardsEl.innerHTML = round.map((item, index) => `
    <button class="case-card" data-index="${index}" type="button" aria-label="第 ${index + 1} 個軍火箱，點擊翻開" style="--rarity:${item.color}">
      <span class="card-inner">
        <span class="card-face card-back"></span>
        <span class="card-face card-front" style="background-image:url('${item.image}')"></span>
      </span>
    </button>`).join("");
  requestAnimationFrame(() => document.querySelectorAll(".case-card").forEach((card, index) => {
    setTimeout(() => card.classList.add("dealt"), index * 140);
  }));
}

function drawBeams() {
  const fieldRect = playfield.getBoundingClientRect();
  const buttonRect = deployButton.getBoundingClientRect();
  const startX = buttonRect.left + buttonRect.width / 2 - fieldRect.left;
  const startY = fieldRect.height;
  beamLayer.setAttribute("viewBox", `0 0 ${fieldRect.width} ${fieldRect.height}`);
  beamLayer.innerHTML = [...document.querySelectorAll(".case-card")].map(card => {
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - fieldRect.left;
    const y = rect.top + rect.height / 2 - fieldRect.top;
    return `<path class="beam" d="M ${startX} ${startY} Q ${(startX+x)/2} ${Math.min(startY,y)+80} ${x} ${y}"/>`;
  }).join("");
  setTimeout(() => beamLayer.innerHTML = "", 850);
}

async function startRound() {
  if (state !== "IDLE") return;
  state = "LOADING";
  setControls(true);
  try {
    await assetsReady;
  } catch {
    state = "IDLE";
    setControls(false);
    return;
  }
  currentBet = Math.max(1, Number(betInput.value) || 1);
  if (currentBet > balance) {
    statusEl.textContent = "資金不足，請降低下注額";
    betInput.classList.remove("shake");
    void betInput.offsetWidth;
    betInput.classList.add("shake");
    state = "IDLE";
    setControls(false);
    return;
  }
  state = "DEALING";
  setBalance(balance - currentBet);
  setControls(true);
  playfield.classList.add("live");
  resultPanel.classList.remove("show");
  resultPanel.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".paytable article").forEach(item => item.classList.remove("active"));
  revealed.clear();
  round = weightedRound();
  statusEl.textContent = "投放中… 目標已鎖定";
  revealCount.textContent = "DEPLOYING";
  renderCards();
  requestAnimationFrame(drawBeams);
  setTimeout(() => {
    state = "WAITING_FOR_REVEAL";
    statusEl.textContent = "點擊卡牌，或按住並滑過連續揭曉";
    revealCount.textContent = "0 / 5";
  }, 800);
}

function revealCard(index) {
  if (!["WAITING_FOR_REVEAL", "REVEALING"].includes(state) || revealed.has(index)) return;
  state = "REVEALING";
  revealed.add(index);
  const card = document.querySelector(`.case-card[data-index="${index}"]`);
  card.classList.add("revealed");
  card.setAttribute("aria-label", `${round[index].name}，已翻開`);
  revealCount.textContent = `${revealed.size} / 5`;
  if (revealed.size === 5) {
    state = "RESULT";
    statusEl.textContent = "戰果分析中…";
    setTimeout(showResult, 650);
  } else {
    state = "WAITING_FOR_REVEAL";
  }
}

function showResult() {
  const result = getResult();
  const payout = currentBet * result.mult;
  state = "PAYOUT";
  document.querySelector(`[data-pattern="${result.key}"]`).classList.add("active");
  $("#result-multiplier").textContent = `${result.mult}×`;
  $("#result-payout").textContent = money(payout).replace(" ", "\u00a0");
  resultPanel.classList.add("show");
  fitResultPayout();
  resultPanel.setAttribute("aria-hidden", "false");
  statusEl.textContent = `${result.label}｜本局結算完成`;
  revealCount.textContent = `${result.mult}×`;
  if (result.mult > 0) {
    getWinningIndexes().forEach(index => {
      document.querySelector(`.case-card[data-index="${index}"]`)?.classList.add("win");
    });
    setBalance(balance + payout);
  }
  setTimeout(resetRound, result.mult >= 6 ? 3600 : 2800);
}

function resetRound() {
  state = "RESET";
  resultPanel.classList.remove("show");
  document.querySelectorAll(".paytable article.active").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".case-card").forEach((card, index) => setTimeout(() => {
    card.style.opacity = "0";
    card.style.transform = "translateY(-25px) scale(.8)";
  }, index * 60));
  setTimeout(() => {
    state = "IDLE";
    playfield.classList.remove("live");
    emptyField("選擇下注額，啟動本次投放");
    statusEl.textContent = "選擇下注額，啟動本次投放";
    revealCount.textContent = "待命";
    setControls(false);
  }, 520);
}

function registerAgentTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = tool => Promise.resolve(context.registerTool(tool)).catch(() => {});
  register({
    name: "set_case_bet",
    title: "設定下注金額",
    description: "在待命狀態設定下一局軍火開箱的下注金額，不會開始遊戲。",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number", minimum: 1 } },
      required: ["amount"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute({ amount }) {
      if (state !== "IDLE") throw new Error("目前不是待命狀態");
      if (!Number.isFinite(amount) || amount < 1 || amount > balance) throw new Error("下注金額無效或超過資金");
      betInput.value = Math.floor(amount);
      return { bet: Number(betInput.value), balance };
    }
  });
  register({
    name: "start_case_drop",
    title: "啟動軍火投放",
    description: "使用目前下注額開始一局並產生五張背面朝上的卡牌。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute() {
      if (state !== "IDLE") throw new Error("遊戲進行中");
      await startRound();
      return { state, bet: currentBet, balance };
    }
  });
  register({
    name: "reveal_case_card",
    title: "翻開軍火卡牌",
    description: "翻開目前回合中指定位置的單張卡牌。位置為 1 到 5。",
    inputSchema: {
      type: "object",
      properties: { position: { type: "integer", minimum: 1, maximum: 5 } },
      required: ["position"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute({ position }) {
      if (!["WAITING_FOR_REVEAL", "REVEALING"].includes(state)) throw new Error("目前沒有可翻開的卡牌");
      if (!Number.isInteger(position) || position < 1 || position > 5) throw new Error("卡牌位置必須是 1 到 5");
      revealCard(position - 1);
      return { position, item: round[position - 1].name, revealed: revealed.size, total: 5 };
    }
  });
}

deployButton.addEventListener("click", startRound);
function cardAtPointer(event) {
  return document.elementFromPoint(event.clientX, event.clientY)?.closest(".case-card");
}

playfield.addEventListener("pointerdown", event => {
  if (!["WAITING_FOR_REVEAL", "REVEALING"].includes(state)) return;
  dragging = true;
  playfield.setPointerCapture?.(event.pointerId);
  const card = cardAtPointer(event);
  if (card) revealCard(Number(card.dataset.index));
});
playfield.addEventListener("pointermove", event => {
  if (!dragging) return;
  const card = cardAtPointer(event);
  if (card) revealCard(Number(card.dataset.index));
});
window.addEventListener("pointerup", () => dragging = false);
window.addEventListener("pointercancel", () => dragging = false);

document.querySelectorAll("[data-bet]").forEach(button => button.addEventListener("click", () => {
  betInput.value = button.dataset.bet;
  document.querySelectorAll("[data-bet]").forEach(item => item.classList.toggle("selected", item === button));
}));
document.querySelector("[data-action='half']").addEventListener("click", () => betInput.value = Math.max(1, Math.floor((Number(betInput.value) || 1) / 2)));
document.querySelector("[data-action='double']").addEventListener("click", () => betInput.value = Math.min(balance, Math.max(1, (Number(betInput.value) || 1) * 2)));
$("#add-balance").addEventListener("click", () => {
  setBalance(10000);
  statusEl.textContent = "測試資金已重置";
});

emptyField();
setBalance(balance);
registerAgentTools();
