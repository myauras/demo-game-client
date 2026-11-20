import {
  BET_STEP,
  DEFAULT_BET,
  DIFFICULTIES,
  formatMoney,
  formatMultiplier
} from "./config.js?v=20261116-full-board";
import {
  appendRouteNode,
  canReachUnvisitedGoal,
  enumerateReachableLengths,
  isAdjacent,
  routeEffectLevel,
  routeStatus,
  truncateRouteAtNode
} from "./route.js?v=20261120-route-effects";
import { validateReachableLengths } from "./rtp.js?v=20261116-full-board";
import {
  calculateOutcome,
  createRound,
  createSeededRandom,
  generateRoundEvents,
  settleRound
} from "./engine.js?v=20261116-test-mode";
import { loadStore, saveStore } from "./storage.js?v=20261116-full-board";

const elements = Object.fromEntries([
  "scene", "testModeToggle", "balanceDisplay", "balancePlus", "multiplierHud", "sceneMultiplier",
  "routeInstruction", "fullBoardBadge", "fullBoardConfetti", "boardWrap", "board", "routeLayer",
  "routeGlowLine", "routeLine", "routeSparkLine", "previewLine", "agent", "eventBubble", "difficultySelect",
  "betMinus", "betPlus", "betInput", "resetButton", "confirmButton", "resultModal", "resultMark",
  "resultTitle", "resultMultiplier", "resultPayout", "resultFullBoard", "toast"
].map((id) => [id, document.getElementById(id)]));

const speedModes = [
  { label: "x1", scale: 1 },
  { label: "x2", scale: 0.5 },
  { label: "略過", scale: 0.04 }
];

const store = loadStore();
const state = {
  difficultyId: "normal",
  route: [],
  phase: "IDLE",
  cumulativeMultiplier: 0,
  currentIndex: -1,
  dangerIndex: -1,
  fullBoardFailed: false,
  fullBoardAwarded: false,
  testMode: false,
  speedIndex: 0,
  dragging: false,
  lastDragKey: "",
  toastTimer: null,
  resultTimer: null
};

const difficulty = () => DIFFICULTIES[state.difficultyId];
const nodePosition = (node) => ({
  x: ((node.col + 0.5) / difficulty().size) * 100,
  y: ((node.row + 0.5) / difficulty().size) * 100
});

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 1800);
}

function renderDifficultySelect() {
  if (!elements.difficultySelect.options.length) {
    elements.difficultySelect.innerHTML = Object.values(DIFFICULTIES).map((item) =>
      `<option value="${item.id}">${item.label} ${item.size} × ${item.size}</option>`
    ).join("");
  }
  elements.difficultySelect.value = state.difficultyId;
  elements.difficultySelect.disabled = state.phase === "RUNNING";
}

function renderBoard() {
  const config = difficulty();
  const selected = new Map(state.route.map((node, index) => [`${node.row}:${node.col}`, index]));
  const tail = state.route.at(-1);
  elements.board.style.setProperty("--size", config.size);
  elements.board.classList.toggle("is-performing", state.phase === "RUNNING" || state.phase === "SETTLED");
  elements.board.innerHTML = "";

  for (let row = 0; row < config.size; row += 1) {
    for (let col = 0; col < config.size; col += 1) {
      const button = document.createElement("button");
      const key = `${row}:${col}`;
      const index = selected.get(key);
      const isGoal = state.route.length > 0 && row === config.size - 1;
      const isFinish = Boolean(tail && tail.row === config.size - 1 && tail.row === row && tail.col === col);
      button.type = "button";
      button.className = "node";
      button.dataset.row = row;
      button.dataset.col = col;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", `第 ${row + 1} 排，第 ${col + 1} 格`);
      if (state.route.length === 0 && row === 0) button.classList.add("is-entry");
      if (state.route.length === 0 && row !== 0) button.disabled = true;
      if (isGoal) button.classList.add("is-goal-row");
      if (index !== undefined) button.classList.add("is-selected");
      if (tail && tail.row === row && tail.col === col) button.classList.add("is-tail");
      if (isFinish) button.classList.add("is-finish");
      if (state.currentIndex === index) button.classList.add("is-current");
      if (state.dangerIndex === index) button.classList.add("is-danger");
      elements.board.append(button);
    }
  }
  renderRouteLine();
  renderAgent();
}

function renderRouteLine() {
  const points = state.route.map((node) => {
    const { x, y } = nodePosition(node);
    return `${x},${y}`;
  }).join(" ");
  elements.routeLine.setAttribute("points", points);
  elements.routeGlowLine.setAttribute("points", points);
  elements.routeSparkLine.setAttribute("points", points);
  elements.routeLayer.dataset.effect = routeEffectLevel(state.route.length, difficulty().size);
}

function renderAgent() {
  const isPerforming = state.phase === "RUNNING" || state.phase === "SETTLED";
  const agentNode = isPerforming && state.currentIndex >= 0
    ? state.route[state.currentIndex]
    : state.route[0];
  const { x, y } = agentNode ? nodePosition(agentNode) : { x: 50, y: 1 };
  elements.agent.style.left = `${x}%`;
  elements.agent.style.top = `${y}%`;
  elements.agent.classList.add("is-visible");
}

function validBet() {
  const value = Number(elements.betInput.value);
  return Number.isFinite(value) && value > 0 && value <= store.balance;
}

function currentRouteStatus() {
  return routeStatus(state.route, difficulty().size);
}

function isFullBoardRoute() {
  const config = difficulty();
  return state.route.length === config.size ** 2 && currentRouteStatus().ready;
}

function renderControls() {
  const status = currentRouteStatus();
  const running = state.phase === "RUNNING";
  const goalConnected = state.route.some((node) => node.row === difficulty().size - 1);
  const routeInstructionHidden = goalConnected
    || (state.route.length > 0 && !canReachUnvisitedGoal(state.route, difficulty().size));
  const betIsValid = validBet();
  const bet = Number(elements.betInput.value);
  const showFullBoard = isFullBoardRoute() && !state.fullBoardFailed;
  elements.balanceDisplay.textContent = formatMoney(store.balance);
  elements.balancePlus.disabled = running;
  elements.testModeToggle.disabled = state.phase !== "IDLE";
  elements.testModeToggle.classList.toggle("is-active", state.testMode);
  elements.testModeToggle.setAttribute("aria-pressed", String(state.testMode));
  elements.testModeToggle.setAttribute("aria-label", state.testMode
    ? "關閉不失敗測試模式"
    : "啟用不失敗測試模式");
  elements.testModeToggle.title = state.testMode ? "關閉測試模式" : "測試模式";
  elements.sceneMultiplier.textContent = formatMultiplier(state.cumulativeMultiplier);
  elements.routeInstruction.hidden = routeInstructionHidden;
  elements.routeInstruction.textContent = state.route.length === 0
    ? "拖曳任意起點進行連線"
    : "可連線至單個或多個終點進行投注";
  elements.fullBoardBadge.hidden = !showFullBoard;
  elements.multiplierHud.classList.toggle("has-full-board", showFullBoard);
  elements.multiplierHud.classList.toggle("is-awarded", showFullBoard && state.fullBoardAwarded);
  elements.betInput.classList.toggle("is-invalid", !betIsValid);
  elements.betInput.disabled = running;
  elements.betMinus.disabled = running || !Number.isFinite(bet) || bet <= 1;
  elements.betPlus.disabled = running || !Number.isFinite(bet) || bet + BET_STEP > store.balance;
  elements.resetButton.disabled = running || state.route.length === 0;
  elements.confirmButton.disabled = running || !status.ready || !betIsValid;
  elements.agent.classList.toggle("is-moving", running);
  renderDifficultySelect();
}

function renderAll({ rebuildBoard = true } = {}) {
  if (rebuildBoard) renderBoard();
  renderControls();
}

function selectDifficulty(id) {
  if (state.phase === "RUNNING" || !DIFFICULTIES[id] || id === state.difficultyId) return;
  state.difficultyId = id;
  state.route = [];
  state.currentIndex = -1;
  state.dangerIndex = -1;
  state.fullBoardFailed = false;
  state.fullBoardAwarded = false;
  state.cumulativeMultiplier = 0;
  state.phase = "IDLE";
  hideEventBubble();
  renderAll();
}

function flashInvalid(node) {
  const button = elements.board.querySelector(`[data-row="${node.row}"][data-col="${node.col}"]`);
  if (!button) return;
  button.classList.remove("is-invalid");
  requestAnimationFrame(() => button.classList.add("is-invalid"));
  setTimeout(() => button.classList.remove("is-invalid"), 260);
}

function applyNodeIntent(node) {
  if (state.phase === "RUNNING") return;
  const next = appendRouteNode(state.route, node, difficulty().size);
  if (next === state.route) {
    flashInvalid(node);
    return;
  }
  state.route = next;
  state.phase = routeStatus(state.route, difficulty().size).ready ? "READY" : "IDLE";
  renderBoard();
  renderControls();
}

function rewindRouteToNode(node) {
  const next = truncateRouteAtNode(state.route, node);
  if (next === state.route) return false;
  state.route = next;
  state.phase = routeStatus(state.route, difficulty().size).ready ? "READY" : "IDLE";
  renderBoard();
  renderControls();
  return true;
}

function nodeFromTarget(target) {
  const button = target?.closest?.(".node");
  if (!button || !elements.board.contains(button)) return null;
  return { row: Number(button.dataset.row), col: Number(button.dataset.col) };
}

function setPreview(pointerEvent) {
  const tail = state.route.at(-1);
  const hovered = nodeFromTarget(document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY));
  if (!tail || !hovered) {
    elements.previewLine.classList.remove("is-visible");
    return;
  }
  const isPrevious = state.route.length > 1 && state.route.at(-2).row === hovered.row && state.route.at(-2).col === hovered.col;
  const unused = !state.route.some((node) => node.row === hovered.row && node.col === hovered.col);
  if ((!isPrevious && !unused) || !isAdjacent(tail, hovered)) {
    elements.previewLine.classList.remove("is-visible");
    return;
  }
  const from = nodePosition(tail);
  const to = nodePosition(hovered);
  elements.previewLine.setAttribute("x1", from.x);
  elements.previewLine.setAttribute("y1", from.y);
  elements.previewLine.setAttribute("x2", to.x);
  elements.previewLine.setAttribute("y2", to.y);
  elements.previewLine.classList.add("is-visible");
}

function changeBet(delta) {
  if (state.phase === "RUNNING") return;
  const current = Number(elements.betInput.value) || 0;
  const next = Math.min(store.balance, Math.max(1, current + delta));
  elements.betInput.value = next;
  renderControls();
}

function hideEventBubble() {
  elements.eventBubble.className = "event-bubble";
  elements.eventBubble.removeAttribute("aria-label");
  elements.eventBubble.replaceChildren();
}

const rewardEffects = {
  coin: `
    <span class="reward-stage reward-stage--coin" aria-hidden="true">
      <i class="reward-coin reward-coin--single"></i>
    </span>`,
  coins: `
    <span class="reward-stage reward-stage--coins" aria-hidden="true">
      <i class="reward-coin reward-coin--one"></i><i class="reward-coin reward-coin--two"></i><i class="reward-coin reward-coin--three"></i>
      <i class="gold-particle particle-1"></i><i class="gold-particle particle-2"></i><i class="gold-particle particle-3"></i>
      <i class="gold-particle particle-4"></i><i class="gold-particle particle-5"></i><i class="gold-particle particle-6"></i>
    </span>`,
  bars: `
    <span class="reward-stage reward-stage--bars" aria-hidden="true">
      <i class="gold-burst"></i>
      <i class="reward-bar reward-bar--one"></i><i class="reward-bar reward-bar--two"></i><i class="reward-bar reward-bar--three"></i>
      <i class="gold-ray ray-1"></i><i class="gold-ray ray-2"></i><i class="gold-ray ray-3"></i><i class="gold-ray ray-4"></i>
    </span>`,
  diamond: `
    <span class="reward-stage reward-stage--diamond" aria-hidden="true">
      <i class="energy-ring energy-ring--one"></i><i class="energy-ring energy-ring--two"></i>
      <i class="diamond-gem"></i>
      <i class="energy-shard shard-1"></i><i class="energy-shard shard-2"></i><i class="energy-shard shard-3"></i>
      <i class="energy-shard shard-4"></i><i class="energy-shard shard-5"></i><i class="energy-shard shard-6"></i>
    </span>`
};

function showEventBubble(node, event) {
  const { x, y } = nodePosition(node);
  elements.eventBubble.style.left = `${x}%`;
  elements.eventBubble.style.top = `${y}%`;
  if (event.type === "reward") {
    elements.eventBubble.className = `event-bubble is-visible is-reward reward-${event.rewardId}`;
    elements.eventBubble.setAttribute("aria-label", `${event.label}，獲得 ${formatMultiplier(event.multiplier)}`);
    elements.eventBubble.innerHTML = `${rewardEffects[event.rewardId]}
      <span class="reward-copy"><strong>+${formatMultiplier(event.multiplier)}</strong></span>`;
  } else {
    elements.eventBubble.className = "event-bubble is-visible is-danger";
    elements.eventBubble.removeAttribute("aria-label");
    elements.eventBubble.textContent = "警戒！已被發現";
  }
}

function rewardRevealDuration(event) {
  if (event.type !== "reward") return 900;
  return { coin: 720, coins: 880, bars: 1020, diamond: 1160 }[event.rewardId] || 780;
}

function delay(baseMilliseconds) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.12 : 1;
  return new Promise((resolve) => setTimeout(
    resolve,
    Math.max(20, baseMilliseconds * speedModes[state.speedIndex].scale * reduced)
  ));
}

function stopFullBoardParticles() {
  elements.fullBoardConfetti.classList.remove("is-active");
  elements.fullBoardConfetti.replaceChildren();
}

function startFullBoardParticles() {
  stopFullBoardParticles();
  const fragment = document.createDocumentFragment();
  const particleCount = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 12 : 40;
  for (let index = 0; index < particleCount; index += 1) {
    const particle = document.createElement("i");
    particle.className = `gold-confetti${index % 3 === 0 ? " is-round" : ""}`;
    particle.style.setProperty("--x", `${3 + Math.random() * 94}%`);
    particle.style.setProperty("--size", `${3 + Math.random() * 5}px`);
    particle.style.setProperty("--delay", `${Math.random() * 0.42}s`);
    particle.style.setProperty("--duration", `${1.05 + Math.random() * 0.58}s`);
    particle.style.setProperty("--drift", `${-34 + Math.random() * 68}px`);
    particle.style.setProperty("--rotate", `${240 + Math.random() * 620}deg`);
    fragment.append(particle);
  }
  elements.fullBoardConfetti.append(fragment);
  void elements.fullBoardConfetti.offsetWidth;
  elements.fullBoardConfetti.classList.add("is-active");
}

async function runRound(round) {
  if (state.phase === "RUNNING" && state.currentIndex >= 0) return;
  state.phase = "RUNNING";
  state.currentIndex = 0;
  state.dangerIndex = -1;
  state.fullBoardFailed = false;
  state.fullBoardAwarded = false;
  state.cumulativeMultiplier = 0;
  elements.resultModal.hidden = true;
  stopFullBoardParticles();
  elements.sceneMultiplier.classList.remove("is-boosted");
  renderAll();
  await delay(250);

  for (const event of round.events) {
    state.currentIndex = event.routeIndex;
    renderBoard();
    renderControls();
    await delay(430);

    showEventBubble(event.node, event);
    if (event.type === "reward") state.cumulativeMultiplier += event.multiplier;
    if (event.type === "danger") {
      state.dangerIndex = event.routeIndex;
      state.fullBoardFailed = true;
      state.cumulativeMultiplier = 0;
      elements.scene.classList.add("is-alert");
    }
    renderBoard();
    renderControls();
    await delay(rewardRevealDuration(event));
    hideEventBubble();
    if (event.type === "danger") break;
  }
  await finishRound(round);
}

async function finishRound(round) {
  const settlement = settleRound(store.balance, round);
  if (settlement.changed) {
    store.balance = settlement.balance;
    store.history.push({
      id: settlement.round.id,
      createdAt: settlement.round.createdAt,
      bet: settlement.round.bet,
      difficultyId: settlement.round.difficultyId,
      outcome: settlement.round.outcome
    });
    store.activeRound = null;
    saveStore(store);
  }
  const outcome = settlement.round.outcome || calculateOutcome(
    round.events,
    round.route.length,
    round.bet,
    round.fullBoard ? 2 : 1
  );
  const fullBoardWin = outcome.success && outcome.fullBoardBonusApplied;
  state.phase = "SETTLED";
  state.testMode = false;
  state.cumulativeMultiplier = fullBoardWin ? outcome.baseMultiplier : outcome.multiplier;
  elements.scene.classList.remove("is-alert");
  renderBoard();
  renderControls();
  if (fullBoardWin) {
    await delay(260);
    state.fullBoardAwarded = true;
    state.cumulativeMultiplier = outcome.multiplier;
    elements.sceneMultiplier.classList.remove("is-boosted");
    void elements.sceneMultiplier.offsetWidth;
    elements.sceneMultiplier.classList.add("is-boosted");
    renderControls();
    startFullBoardParticles();
    await delay(1450);
    stopFullBoardParticles();
    await delay(180);
  } else {
    await delay(outcome.success ? 500 : 180);
  }
  showResult(outcome);
}

function showResult(outcome) {
  const card = elements.resultModal.querySelector(".result-card");
  card.classList.toggle("is-fail", !outcome.success);
  card.classList.toggle("is-full-board", outcome.success && outcome.fullBoardBonusApplied);
  elements.resultMark.textContent = outcome.success ? "✓" : "!";
  elements.resultTitle.textContent = outcome.fullBoardBonusApplied
    ? "全盤贏得"
    : outcome.success ? "贏得" : "再接再厲!";
  elements.resultMultiplier.textContent = outcome.fullBoardBonusApplied
    ? `${formatMultiplier(outcome.baseMultiplier)} → ${formatMultiplier(outcome.multiplier)}`
    : formatMultiplier(outcome.multiplier);
  elements.resultPayout.textContent = formatMoney(outcome.payout);
  elements.resultFullBoard.hidden = !outcome.fullBoardBonusApplied;
  elements.resultModal.hidden = false;
  clearTimeout(state.resultTimer);
  state.resultTimer = setTimeout(playAgain, 2500);
}

function confirmRound() {
  const status = currentRouteStatus();
  const bet = Number(elements.betInput.value);
  if (!status.ready || !validBet() || state.phase === "RUNNING") return;
  let seed;
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    [seed] = values;
  } else {
    seed = Date.now() >>> 0;
  }
  const random = createSeededRandom(seed);
  const { events } = generateRoundEvents(difficulty(), state.route, random, state.testMode);
  const fullBoard = isFullBoardRoute();
  const round = createRound({
    difficultyId: state.difficultyId,
    route: state.route.map((node) => ({ ...node })),
    bet,
    events,
    seed,
    fullBoard
  });
  store.balance -= bet;
  store.activeRound = round;
  saveStore(store);
  runRound(round);
}

function playAgain() {
  clearTimeout(state.resultTimer);
  state.resultTimer = null;
  elements.resultModal.hidden = true;
  elements.scene.classList.remove("is-alert");
  state.route = [];
  state.phase = "IDLE";
  state.currentIndex = -1;
  state.dangerIndex = -1;
  state.fullBoardFailed = false;
  state.fullBoardAwarded = false;
  state.cumulativeMultiplier = 0;
  elements.sceneMultiplier.classList.remove("is-boosted");
  stopFullBoardParticles();
  hideEventBubble();
  renderAll();
}

function validateMathAtStartup() {
  const report = [];
  for (const config of Object.values(DIFFICULTIES)) {
    const lengths = enumerateReachableLengths(config.size);
    const results = validateReachableLengths(config, lengths);
    if (results.some((item) => Math.abs(item.theoreticalRtp - 0.95) > 1e-12)) {
      throw new Error(`${config.label} RTP 驗算失敗`);
    }
    report.push(...results.map((item) => ({
      難度: config.label,
      路線格數: item.routeLength,
      警戒機率: item.dangerChance.toFixed(8),
      理論RTP: item.theoreticalRtp.toFixed(8)
    })));
  }
  console.table(report);
}

elements.difficultySelect.addEventListener("change", (event) => selectDifficulty(event.target.value));

elements.testModeToggle.addEventListener("click", () => {
  if (state.phase !== "IDLE") return;
  state.testMode = !state.testMode;
  renderControls();
  showToast(state.testMode ? "不失敗測試模式已啟用" : "不失敗測試模式已關閉");
});

elements.board.addEventListener("pointerdown", (event) => {
  const node = nodeFromTarget(event.target);
  if (!node || state.phase === "RUNNING") return;
  event.preventDefault();
  state.dragging = true;
  state.lastDragKey = `${node.row}:${node.col}`;
  const isRouteNode = state.route.some((item) => item.row === node.row && item.col === node.col);
  if (isRouteNode) rewindRouteToNode(node);
  else applyNodeIntent(node);
});

elements.boardWrap.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  event.preventDefault();
  const node = nodeFromTarget(document.elementFromPoint(event.clientX, event.clientY));
  if (node) {
    const key = `${node.row}:${node.col}`;
    if (key !== state.lastDragKey) {
      state.lastDragKey = key;
      applyNodeIntent(node);
    }
  }
  setPreview(event);
});

window.addEventListener("pointerup", () => {
  state.dragging = false;
  state.lastDragKey = "";
  elements.previewLine.classList.remove("is-visible");
});

elements.betMinus.addEventListener("click", () => changeBet(-BET_STEP));
elements.betPlus.addEventListener("click", () => changeBet(BET_STEP));
elements.balancePlus.addEventListener("click", () => {
  if (state.phase === "RUNNING") return;
  store.balance += 1000;
  saveStore(store);
  renderControls();
  showToast("餘額增加 1,000");
});
elements.betInput.addEventListener("input", renderControls);
elements.betInput.addEventListener("blur", () => {
  const value = Number(elements.betInput.value);
  if (Number.isFinite(value)) elements.betInput.value = Math.max(1, Math.min(store.balance, value));
  renderControls();
});
elements.resetButton.addEventListener("click", () => {
  if (state.phase === "RUNNING") return;
  state.route = [];
  state.currentIndex = -1;
  state.dangerIndex = -1;
  state.fullBoardFailed = false;
  state.fullBoardAwarded = false;
  state.cumulativeMultiplier = 0;
  state.phase = "IDLE";
  hideEventBubble();
  renderAll();
});
elements.confirmButton.addEventListener("click", confirmRound);
try {
  validateMathAtStartup();
} catch (error) {
  console.error(error);
  showToast(error.message);
}

if (store.activeRound && !store.activeRound.paid) {
  let round = store.activeRound;
  const config = DIFFICULTIES[round.difficultyId];
  const fullBoard = round.route.length === config.size ** 2;
  const needsRegeneration = round.events.some((event) => event.type === "safe")
    || (fullBoard && round.fullBoard !== true);
  if (needsRegeneration) {
    const random = createSeededRandom(round.seed);
    const { events } = generateRoundEvents(config, round.route, random);
    round = { ...round, events, fullBoard };
    store.activeRound = round;
    saveStore(store);
  } else if (round.fullBoard !== fullBoard) {
    round = { ...round, fullBoard };
    store.activeRound = round;
    saveStore(store);
  }
  state.difficultyId = round.difficultyId;
  state.route = round.route;
  elements.betInput.value = round.bet;
  renderAll();
  showToast("偵測到未完成行動，繼續既有結算");
  setTimeout(() => runRound(round), 450);
} else {
  elements.betInput.value = DEFAULT_BET;
  renderAll();
}
