(() => {
  "use strict";

document.title = "金庫行動｜Operation Vault";

  const TARGET_RTP = .95;

  const CONFIG = {
    easy: {
      label: "簡單", shots: [10, 10, 10], obstacles: 5,
      multipliers: [
        [1.01,1.03,1.06,1.10,1.15,1.19,1.24,1.30,1.35,1.42],
        [1.48,1.56,1.65,1.75,1.85,1.98,2.12,2.28,2.47,2.70],
        [2.96,3.28,3.70,4.11,4.64,5.39,6.50,8.36,12.08,23.24]
      ], cashout: [1,2,3,5,8,12,16,20,24,28,30]
    },
    medium: {
      label: "普通", shots: [9, 8, 8], obstacles: 7,
      multipliers: [
        [1.08,1.21,1.37,1.56,1.78,2.05,2.37,2.77,3.24],
        [3.85,4.62,5.61,6.91,8.64,10.99,14.29,18.96],
        [26.07,37.24,53.82,82.36,137.59,265.35,638.82,2457.00]
      ], cashout: [1,2,3,5,8,12,16,20,24,25]
    },
    hard: {
      label: "困難", shots: [8, 7, 7], obstacles: 8,
      multipliers: [
        [1.18,1.46,1.83,2.31,2.95,3.82,5.02,6.66],
        [9.04,12.52,17.74,25.80,38.71,60.21,97.34],
        [166.87,305.94,595.86,1283.03,3267.64,10898.54,62162.09]
      ], cashout: [1,2,3,5,8,12,16,20,22]
    },
    hardcore: {
      label: "地獄", shots: [6, 6, 6], obstacles: 9,
      multipliers: [
        [1.44,2.21,3.45,5.53,9.09,15.30],
        [26.78,48.70,92.54,185.08,391.25,894.28],
        [2235.72,6096.15,18960.33,72432.75,379632.82,3608855.25]
      ], cashout: [1,2,3,5,8,12,16,18]
    }
  };

  const ROUND_OPTIONS = [10,20,30,50,75,100,150,200];
  const RIM_OBSTACLE_WIDTH = 14;
  const RIM_KEY_WIDTH = 14;
  const COLLISION_PADDING = 1;
  const $ = (selector) => document.querySelector(selector);
  const els = {
    balance: $("#balance"), balanceButton: $("#balanceButton"), betInput: $("#betInput"),
    fire: $("#fireButton"), fireText: $(".fire-button__inner"), cashout: $("#cashoutButton"),
    auto: $("#autoButton"), difficulty: $("#difficultyButton"), difficultyMenu: $("#difficultyMenu"),
    shotTrack: $("#shotTrack"), stage: $("#stage"), target: $("#target"), targetWrap: $("#targetWrap"),
    targetBullets: $("#targetBullets"), targetMultiplier: $("#targetMultiplier"),
    ammoList: $("#ammoList"), cartridge: $("#cartridge"), impact: $("#impact"),
    coins: $("#coinBurst"), failureFx: $("#failureFx"), toast: $("#resultToast"),
    autoModal: $("#autoModal"), cashoutOptions: $("#cashoutOptions"), roundOptions: $("#roundOptions"),
    startAuto: $("#startAuto"), settlement: $("#settlement"), settlementTitle: $("#settlementTitle"),
    settlementMultiplier: $("#settlementMultiplier"), settlementPrize: $("#settlementPrize")
  };

  let balance = 3000;
  let difficultyKey = "easy";
  let phase = "idle";
  let bet = 10;
  let targetIndex = 0;
  let targetShot = 0;
  let totalSuccess = 0;
  let currentMultiplier = 1;
  let obstacleAngles = [];
  let playerAngles = [];
  let progressOffset = 0;
  let progressAnimationId = 0;
  let rotationAngle = Math.random() * 360;
  const firstTargetDirection = Math.random() < .5 ? -1 : 1;
  let rotationDirection = firstTargetDirection;
  let lastFrame = performance.now();
  let nextBoost = lastFrame + random(3500, 8000);
  let boostUntil = 0;
  let autoActive = false;
  let autoStopRequested = false;
  let autoCashoutShots = 1;
  let autoRoundsSelected = 10;
  let autoRoundsRemaining = 0;
  let toastTimer = 0;
  let settlementTimer = 0;
  let coinBurstTimer = 0;
  let failureFxTimer = 0;
  let multiplierBreakTimer = 0;
  let audioContext;

  try {
    const savedRaw = sessionStorage.getItem("extreme-shot-balance");
    const saved = savedRaw === null ? NaN : Number(savedRaw);
    if (Number.isFinite(saved) && saved >= 0) balance = saved;
  } catch (_) {}

  function config() { return CONFIG[difficultyKey]; }
  function allMultipliers() { return config().multipliers.flat(); }
  function hitChance() {
    const multipliers = allMultipliers();
    const nextMultiplier = multipliers[totalSuccess];
    const previousValue = totalSuccess === 0 ? TARGET_RTP : multipliers[totalSuccess - 1];
    return Math.min(1, previousValue / nextMultiplier);
  }
  function money(value) {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
      .format(value).replace("US$", "$ ");
  }
  function random(min, max) { return min + Math.random() * (max - min); }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function persistBalance() {
    els.balance.textContent = money(balance);
    try { sessionStorage.setItem("extreme-shot-balance", String(balance)); } catch (_) {}
  }

  function setControls() {
    const locked = phase !== "idle";
    els.betInput.disabled = locked;
    els.difficulty.disabled = locked || autoActive;
    els.balanceButton.disabled = locked || autoActive;
    els.cashout.disabled = !(phase === "playing" && totalSuccess > 0 && !autoActive);
    els.fire.disabled = phase === "shooting" || phase === "transition" || phase === "settling" || autoActive;
    els.fireText.textContent = phase === "idle" ? "投注" : "破解";
    document.querySelectorAll("#quickBets button").forEach(button => { button.disabled = locked; });
  }

  function renderStage() {
    const needed = config().shots[targetIndex];
    els.stage.textContent = `${targetIndex + 1}/3`;
    els.shotTrack.innerHTML = "";
    for (let i = 0; i < needed; i += 1) {
      const dot = document.createElement("span");
      dot.className = `shot-dot${i < targetShot ? " is-hit" : i === targetShot ? " is-current" : ""}`;
      els.shotTrack.append(dot);
    }
    els.target.classList.toggle("is-tactical", targetIndex === 1);
    els.target.classList.toggle("is-armor", targetIndex === 2);
  }

  function getRimRadius() {
    return Math.max(66, Math.min(120, els.target.clientWidth * .5));
  }

  function angleDistance(first, second) {
    const difference = Math.abs(first - second) % 360;
    return Math.min(difference, 360 - difference);
  }

  function normalizeAngle(angle) {
    return (angle % 360 + 360) % 360;
  }

  function collisionAngle(radius, firstWidth, secondWidth) {
    const combinedHalfWidth = (firstWidth + secondWidth) / 2 + COLLISION_PADDING;
    const ratio = Math.min(1, combinedHalfWidth / (2 * radius));
    return 2 * Math.asin(ratio) * 180 / Math.PI;
  }

  function occupiedRimItems() {
    return [
      ...obstacleAngles.map(angle => ({ angle, width: RIM_OBSTACLE_WIDTH })),
      ...playerAngles.map(angle => ({ angle, width: RIM_KEY_WIDTH }))
    ];
  }

  function hasRimCollision(incomingAngle) {
    const radius = getRimRadius();
    const occupied = occupiedRimItems();
    return occupied.some(item =>
      angleDistance(incomingAngle, item.angle) <= collisionAngle(radius, RIM_KEY_WIDTH, item.width)
    );
  }

  function nearestCollisionAngle(preferredAngle) {
    const occupied = occupiedRimItems();
    if (!occupied.length) return normalizeAngle(preferredAngle);
    return occupied.reduce((nearest, item) =>
      angleDistance(preferredAngle, item.angle) < angleDistance(preferredAngle, nearest.angle) ? item : nearest
    ).angle;
  }

  function nearestSafeAngle(preferredAngle) {
    const preferred = normalizeAngle(preferredAngle);
    if (!hasRimCollision(preferred)) return preferred;
    for (let offset = 1; offset <= 180; offset += 1) {
      const clockwise = normalizeAngle(preferred + offset);
      if (!hasRimCollision(clockwise)) return clockwise;
      const counterclockwise = normalizeAngle(preferred - offset);
      if (!hasRimCollision(counterclockwise)) return counterclockwise;
    }
    return preferred;
  }

  function renderTargetBullets() {
    els.targetBullets.innerHTML = "";
    const radius = getRimRadius();
    [...obstacleAngles.map(angle => ({ angle, player: false })), ...playerAngles.map(angle => ({ angle, player: true }))]
      .forEach(item => {
        const bullet = document.createElement("span");
        bullet.className = `rim-bullet${item.player ? " is-player" : ""}`;
        bullet.style.transform = `rotate(${item.angle}deg) translateY(-${radius}px)`;
        els.targetBullets.append(bullet);
      });
  }

  function createAmmoTrack(values, start, count, current, advancing, sliding = false) {
    const track = document.createElement("div");
    track.className = `ammo-track${sliding ? " is-sliding" : ""}`;
    track.style.setProperty("--slot-count", String(count));
    values.slice(start, start + count).forEach((value, localIndex) => {
      const globalIndex = start + localIndex;
      const item = document.createElement("div");
      item.className = `ammo${globalIndex < current ? " is-done" : ""}${globalIndex === current ? " is-active" : ""}${globalIndex === current && advancing ? " is-advancing" : ""}`;
      item.innerHTML = `<span class="ammo__bullet"></span><strong>x${value.toFixed(2)}</strong>`;
      track.append(item);
    });
    return track;
  }

  function renderMultiplierProgress(animateAdvance = false) {
    const values = [1, ...allMultipliers()];
    const current = totalSuccess;
    const maxOffset = Math.max(0, values.length - 5);
    const autoStart = Math.max(0, Math.min(maxOffset, current - 1));
    const previousOffset = Math.max(0, Math.min(maxOffset, Number.isFinite(progressOffset) ? progressOffset : autoStart));
    progressOffset = animateAdvance ? autoStart : previousOffset;
    if (current < progressOffset || current >= progressOffset + 5) progressOffset = autoStart;
    const animationId = ++progressAnimationId;
    const shouldSlide = animateAdvance && progressOffset === previousOffset + 1;

    els.ammoList.replaceChildren(createAmmoTrack(
      values,
      shouldSlide ? previousOffset : progressOffset,
      shouldSlide ? 6 : 5,
      current,
      animateAdvance,
      shouldSlide
    ));

    if (shouldSlide) {
      setTimeout(() => {
        if (animationId !== progressAnimationId) return;
        els.ammoList.replaceChildren(createAmmoTrack(values, progressOffset, 5, current, false));
      }, 210);
    }
    const multiplierText = `x${currentMultiplier.toFixed(2)}`;
    els.targetMultiplier.textContent = multiplierText;
    els.targetMultiplier.dataset.value = multiplierText;
  }

  function createObstacleAngles() {
    const count = config().obstacles;
    const start = random(0, 360);
    obstacleAngles = Array.from({ length: count }, (_, i) => (start + i * (360 / count) + random(-8, 8)) % 360);
    playerAngles = [];
    renderTargetBullets();
  }

  function resetRoundVisuals() {
    targetIndex = 0;
    targetShot = 0;
    totalSuccess = 0;
    currentMultiplier = 1;
    progressOffset = 0;
    rotationDirection = firstTargetDirection;
    createObstacleAngles();
    renderStage();
    renderMultiplierProgress();
  }

  function getBet() {
    const amount = Math.floor(Number(String(els.betInput.value).replace(/[^0-9.]/g, "")) * 100) / 100;
    return Number.isFinite(amount) ? amount : 0;
  }

  function validateBet() {
    bet = getBet();
    if (bet <= 0) { showToast("請輸入下注金額", "lose"); return false; }
    if (bet > balance) { showToast("餘額不足", "lose"); return false; }
    return true;
  }

  function beginRound() {
    if (!validateBet()) { stopAuto(true); return false; }
    balance = Math.round((balance - bet) * 100) / 100;
    persistBalance();
    resetRoundVisuals();
    phase = "playing";
    setControls();
    return true;
  }

  async function handleMainButton() {
    if (phase === "idle") {
      if (!beginRound()) return;
      await wait(90);
      await shoot();
      return;
    }
    if (phase === "playing") await shoot();
  }

  async function shoot() {
    if (phase !== "playing") return;
    phase = "shooting";
    setControls();
    els.fire.classList.add("is-firing");
    els.target.classList.add("is-firing");
    els.cartridge.classList.remove("is-firing");
    void els.cartridge.offsetWidth;
    els.cartridge.classList.add("is-firing");
    gunshot();
    await wait(245);

    const localAngle = ((180 - rotationAngle) % 360 + 360) % 360;
    const hit = Math.random() < hitChance();
    const displayedAngle = hit ? nearestSafeAngle(localAngle) : nearestCollisionAngle(localAngle);
    els.target.classList.remove("is-firing");
    els.fire.classList.remove("is-firing");

    if (!hit) {
      playerAngles.push(displayedAngle);
      renderTargetBullets();
      const keys = els.targetBullets.querySelectorAll(".rim-bullet.is-player");
      keys[keys.length - 1]?.classList.add("is-collision");
      playFailureEffect();
      els.target.classList.add("is-miss");
      missSound();
      await wait(620);
      els.target.classList.remove("is-miss");
      await finishRound("failed", 0);
      return;
    }

    playSuccessEffects();
    playerAngles.push(displayedAngle);
    renderTargetBullets();
    targetShot += 1;
    totalSuccess += 1;
    currentMultiplier = allMultipliers()[totalSuccess - 1];
    rewardSound();
    renderStage();
    renderMultiplierProgress(true);
    animateMultiplierUpgrade();
    await wait(760);

    const completedTarget = targetShot >= config().shots[targetIndex];
    const completedAll = completedTarget && targetIndex === 2;
    if (completedAll) {
      const prize = Math.round(bet * currentMultiplier * 100) / 100;
      await finishRound("completed", prize);
      return;
    }

    if (autoActive && totalSuccess >= autoCashoutShots) {
      const prize = Math.round(bet * currentMultiplier * 100) / 100;
      await finishRound("cashout", prize);
      return;
    }

    if (completedTarget) {
      await transitionTarget();
    } else {
      phase = "playing";
      setControls();
    }

    if (autoActive) {
      if (autoStopRequested) { stopAuto(false); }
      else setTimeout(() => shoot(), 380);
    }
  }

  async function transitionTarget() {
    phase = "transition";
    setControls();
    els.target.classList.add("is-exiting");
    await wait(390);
    targetIndex += 1;
    targetShot = 0;
    rotationDirection = Math.random() < .5 ? -1 : 1;
    rotationAngle = Math.random() * 360;
    createObstacleAngles();
    renderStage();
    els.target.classList.remove("is-exiting");
    els.target.classList.add("is-entering");
    await wait(470);
    els.target.classList.remove("is-entering");
    phase = "playing";
    setControls();
  }

  async function cashout() {
    if (phase !== "playing" || totalSuccess < 1 || autoActive) return;
    const prize = Math.round(bet * currentMultiplier * 100) / 100;
    await finishRound("cashout", prize);
  }

  async function finishRound(type, prize) {
    phase = "settling";
    setControls();
    balance = Math.round((balance + prize) * 100) / 100;
    persistBalance();

    if (autoActive) {
      autoRoundsRemaining = Math.max(0, autoRoundsRemaining - 1);
      await wait(type === "failed" ? 240 : 100);
      const shouldStopAuto = autoStopRequested || autoRoundsRemaining <= 0 || balance < getBet();
      if (type !== "failed") await showAutoSettlement(prize);
      if (shouldStopAuto) {
        stopAuto(true);
        if (type === "failed") await resetFailedRound();
        else {
          phase = "idle";
          resetRoundVisuals();
          setControls();
        }
      } else {
        if (type === "failed") await resetFailedRound();
        else phase = "idle";
        updateAutoButton();
        if (beginRound()) setTimeout(() => shoot(), 420);
      }
      return;
    }

    if (type === "failed") await resetFailedRound();
    else showSettlement(prize);
  }

  async function resetFailedRound() {
    phase = "transition";
    setControls();
    els.target.classList.add("is-exiting");
    await wait(390);
    els.target.classList.remove("is-exiting");
    resetRoundVisuals();
    els.target.classList.add("is-entering");
    await wait(470);
    els.target.classList.remove("is-entering");
    phase = "idle";
    setControls();
  }

  function showSettlement(prize) {
    clearTimeout(settlementTimer);
    clearTimeout(coinBurstTimer);
    els.coins.replaceChildren();
    setSettlementContent(prize);
    els.settlement.hidden = false;
    settlementTimer = setTimeout(closeSettlement, 1050);
  }

  function setSettlementContent(prize) {
    els.settlementTitle.textContent = "贏得";
    els.settlementMultiplier.textContent = `x${currentMultiplier.toFixed(2)}`;
    els.settlementPrize.textContent = money(prize);
  }

  async function showAutoSettlement(prize) {
    clearTimeout(settlementTimer);
    clearTimeout(coinBurstTimer);
    els.coins.replaceChildren();
    setSettlementContent(prize);
    els.settlement.classList.add("is-auto-settlement");
    els.settlement.hidden = false;
    await wait(480);
    els.settlement.hidden = true;
    els.settlement.classList.remove("is-auto-settlement");
  }

  function closeSettlement() {
    clearTimeout(settlementTimer);
    els.settlement.hidden = true;
    phase = "idle";
    resetRoundVisuals();
    setControls();
  }

  function openDifficultyMenu() {
    if (phase !== "idle" || autoActive) return;
    els.difficultyMenu.hidden = !els.difficultyMenu.hidden;
    softClick();
  }

  function changeDifficulty(key) {
    if (phase !== "idle" || !CONFIG[key]) return;
    difficultyKey = key;
    els.difficulty.innerHTML = `${config().label} <span>▾</span>`;
    els.difficultyMenu.hidden = true;
    autoCashoutShots = 1;
    resetRoundVisuals();
    buildAutoOptions();
    softClick();
  }

  function buildAutoOptions() {
    els.cashoutOptions.innerHTML = "";
    config().cashout.forEach(value => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = value;
      button.className = value === autoCashoutShots ? "is-selected" : "";
      button.addEventListener("click", () => {
        autoCashoutShots = value;
        [...els.cashoutOptions.children].forEach(b => b.classList.toggle("is-selected", Number(b.textContent) === value));
        softClick();
      });
      els.cashoutOptions.append(button);
    });
    els.roundOptions.innerHTML = "";
    ROUND_OPTIONS.forEach(value => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = value;
      button.className = value === autoRoundsSelected ? "is-selected" : "";
      button.addEventListener("click", () => {
        autoRoundsSelected = value;
        [...els.roundOptions.children].forEach(b => b.classList.toggle("is-selected", Number(b.textContent) === value));
        els.startAuto.textContent = `開始（${value}）`;
        softClick();
      });
      els.roundOptions.append(button);
    });
    els.startAuto.textContent = `開始（${autoRoundsSelected}）`;
  }

  function openAuto() {
    if (autoActive) {
      autoStopRequested = true;
      updateAutoButton();
      if (phase === "playing") stopAuto(false);
      return;
    }
    if (phase !== "idle") return;
    buildAutoOptions();
    els.autoModal.hidden = false;
    softClick();
  }

  function startAuto() {
    if (phase !== "idle" || !validateBet()) return;
    els.autoModal.hidden = true;
    autoActive = true;
    autoStopRequested = false;
    autoRoundsRemaining = autoRoundsSelected;
    updateAutoButton();
    if (beginRound()) setTimeout(() => shoot(), 350);
  }

  function stopAuto(resetRounds) {
    autoActive = false;
    autoStopRequested = false;
    if (resetRounds) autoRoundsRemaining = 0;
    updateAutoButton();
    setControls();
  }

  function updateAutoButton() {
    els.auto.classList.toggle("is-active", autoActive);
    els.auto.textContent = autoActive ? (autoStopRequested ? "停止中" : `停止 ${autoRoundsRemaining}`) : "自動";
  }

  function showToast(message, type) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.className = `result-toast show ${type || ""}`;
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1200);
  }

  function playSuccessEffects() {
    els.impact.style.left = "50%";
    els.impact.style.top = "50%";
    els.impact.classList.remove("show");
    void els.impact.offsetWidth;
    els.impact.classList.add("show");

    const coinCount = 28;
    clearTimeout(coinBurstTimer);
    const particles = document.createDocumentFragment();

    const flash = document.createElement("i");
    flash.className = "coin-flash";
    particles.append(flash);

    for (let i = 0; i < coinCount; i += 1) {
      const angle = (Math.PI * 2 * i / coinCount) - Math.PI / 2 + random(-.075, .075);
      const distance = random(92, 198);
      const endX = Math.cos(angle) * distance;
      const endY = Math.sin(angle) * distance;
      const spin = random(-300, 300);
      const coin = document.createElement("i");
      coin.className = "coin-particle";
      coin.style.setProperty("--size", `${random(20, 27)}px`);
      coin.style.setProperty("--end-x", `${endX}px`);
      coin.style.setProperty("--end-y", `${endY}px`);
      coin.style.setProperty("--spin", `${spin}deg`);
      coin.style.setProperty("--delay", `${random(0, 24)}ms`);
      coin.style.setProperty("--duration", `${random(580, 660)}ms`);
      particles.append(coin);
    }
    els.coins.replaceChildren(particles);
    coinBurstTimer = setTimeout(() => els.coins.replaceChildren(), 730);
  }

  function animateMultiplierUpgrade() {
    els.targetMultiplier.classList.remove("is-upgrading");
    void els.targetMultiplier.offsetWidth;
    els.targetMultiplier.classList.add("is-upgrading");
    setTimeout(() => els.targetMultiplier.classList.remove("is-upgrading"), 520);
  }

  function playFailureEffect() {
    clearTimeout(failureFxTimer);
    clearTimeout(multiplierBreakTimer);
    els.failureFx.classList.remove("show");
    els.targetMultiplier.classList.remove("is-shattering");
    void els.failureFx.offsetWidth;
    els.failureFx.classList.add("show");
    els.targetMultiplier.dataset.value = els.targetMultiplier.textContent;
    els.targetMultiplier.classList.add("is-shattering");
    failureFxTimer = setTimeout(() => els.failureFx.classList.remove("show"), 860);
    multiplierBreakTimer = setTimeout(() => els.targetMultiplier.classList.remove("is-shattering"), 860);
  }

  function animate(now) {
    const delta = Math.min(.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (now >= nextBoost) {
      boostUntil = now + 2000;
      nextBoost = now + random(5500, 10000);
    }
    const speedMultiplier = now < boostUntil ? 1.7 : 1;
    rotationAngle = (rotationAngle + rotationDirection * 195 * speedMultiplier * delta + 360) % 360;
    els.target.style.setProperty("--target-angle", `${rotationAngle}deg`);
    requestAnimationFrame(animate);
  }

  function audio() {
    if (!audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) audioContext = new Context();
    }
    if (audioContext?.state === "suspended") audioContext.resume();
    return audioContext;
  }
  function tone(frequency, duration, type = "sine", gain = .04, delay = 0) {
    const ctx = audio(); if (!ctx) return;
    const osc = ctx.createOscillator(); const volume = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
    volume.gain.setValueAtTime(gain, ctx.currentTime + delay);
    volume.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + delay + duration);
    osc.connect(volume).connect(ctx.destination); osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + duration);
  }
  function softClick() { tone(420,.045,"square",.018); }
  function gunshot() {
    const ctx = audio(); if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * .12); const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<frames;i+=1) data[i]=(Math.random()*2-1)*Math.pow(1-i/frames,4);
    const source=ctx.createBufferSource(); const filter=ctx.createBiquadFilter(); const gain=ctx.createGain();
    filter.type="lowpass"; filter.frequency.value=1800; gain.gain.value=.28; source.buffer=buffer;
    source.connect(filter).connect(gain).connect(ctx.destination); source.start(); tone(95,.18,"sawtooth",.12);
  }
  function rewardSound() { tone(520,.12,"sine",.05); tone(690,.14,"sine",.05,.08); tone(880,.2,"sine",.06,.17); }
  function missSound() {
    tone(560,.12,"square",.035,0);
    tone(330,.14,"square",.04,.12);
    tone(560,.12,"square",.035,.27);
  }

  els.fire.addEventListener("click", handleMainButton);
  els.cashout.addEventListener("click", cashout);
  els.difficulty.addEventListener("click", openDifficultyMenu);
  els.difficultyMenu.addEventListener("click", event => {
    const button = event.target.closest("button[data-difficulty]");
    if (button) changeDifficulty(button.dataset.difficulty);
  });
  els.auto.addEventListener("click", openAuto);
  $("#closeAuto").addEventListener("click", () => { els.autoModal.hidden = true; });
  els.startAuto.addEventListener("click", startAuto);
  els.settlement.addEventListener("click", () => {
    if (!els.settlement.classList.contains("is-auto-settlement")) closeSettlement();
  });
  $("#quickBets").addEventListener("click", event => {
    const button = event.target.closest("button[data-bet]"); if (!button || phase !== "idle") return;
    els.betInput.value = String(Math.min(balance, Number(button.dataset.bet))); softClick();
  });
  els.betInput.addEventListener("change", () => {
    const value = Math.max(1, Math.min(balance, getBet())); els.betInput.value = String(value);
  });
  els.balanceButton.addEventListener("click", () => {
    if (phase !== "idle" || autoActive) return;
    balance = Math.round((balance + 1000) * 100) / 100; persistBalance(); showToast("測試金額 +$ 1,000.00", "win"); softClick();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && autoActive) autoStopRequested = true; });

  buildAutoOptions();
  resetRoundVisuals();
  persistBalance();
  updateAutoButton();
  setControls();
  requestAnimationFrame(animate);
})();
