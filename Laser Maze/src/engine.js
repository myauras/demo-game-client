import { REWARD_TYPES } from "./config.js?v=20261116-full-board";
import { rtpParameters } from "./rtp.js?v=20261116-full-board";

export function createSeededRandom(seed = Date.now()) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickReward(random) {
  const roll = random();
  let cursor = 0;
  for (const reward of REWARD_TYPES) {
    cursor += reward.weight;
    if (roll < cursor) return reward;
  }
  return REWARD_TYPES.at(-1);
}

export function generateRoundEvents(difficulty, route, random = Math.random, forceSuccess = false) {
  const params = rtpParameters(difficulty, route.length);
  const events = [];
  for (let index = 1; index < route.length; index += 1) {
    if (!forceSuccess && random() < params.dangerChance) {
      events.push({ type: "danger", node: route[index], routeIndex: index, multiplier: 0 });
      break;
    }
    const reward = pickReward(random);
    events.push({
      type: "reward",
      rewardId: reward.id,
      label: reward.label,
      node: route[index],
      routeIndex: index,
      multiplier: difficulty.rewards[reward.id]
    });
  }
  return { events, params };
}

export function calculateOutcome(events, routeLength, bet, bonusFactor = 1) {
  const failedEvent = events.find((event) => event.type === "danger");
  if (failedEvent) {
    return {
      success: false,
      baseMultiplier: 0,
      multiplier: 0,
      payout: 0,
      fullBoardBonusApplied: false,
      failedEvent
    };
  }
  const reachedEnd = events.length === routeLength - 1;
  const baseMultiplier = reachedEnd
    ? events.reduce((sum, event) => sum + event.multiplier, 0)
    : 0;
  const multiplier = baseMultiplier * bonusFactor;
  return {
    success: reachedEnd,
    baseMultiplier,
    multiplier,
    payout: reachedEnd ? bet * multiplier : 0,
    fullBoardBonusApplied: reachedEnd && bonusFactor === 2,
    failedEvent: null
  };
}

export function settleRound(balance, round) {
  if (round.paid) return { balance, round, changed: false };
  const outcome = calculateOutcome(
    round.events,
    round.route.length,
    round.bet,
    round.fullBoard ? 2 : 1
  );
  return {
    balance: balance + outcome.payout,
    round: { ...round, paid: true, settled: true, outcome },
    changed: true
  };
}

export function createRound({ difficultyId, route, bet, events, seed, fullBoard = false }) {
  return {
    id: `${Date.now()}-${seed}`,
    difficultyId,
    route,
    bet,
    events,
    seed,
    fullBoard,
    deducted: true,
    paid: false,
    settled: false,
    createdAt: new Date().toISOString()
  };
}
