import { TARGET_RTP, REWARD_TYPES } from "./config.js?v=20261116-full-board";

export function conditionalMean(difficulty) {
  return REWARD_TYPES.reduce(
    (sum, reward) => sum + reward.weight * difficulty.rewards[reward.id],
    0
  );
}

export function rtpParameters(difficulty, routeLength) {
  const events = routeLength - 1;
  if (events < 1) throw new Error("路線至少需要一個事件格");
  const mean = conditionalMean(difficulty);
  const bonusFactor = routeLength === difficulty.size ** 2 ? 2 : 1;
  const safeChance = (TARGET_RTP / (events * mean * bonusFactor)) ** (1 / events);
  const dangerChance = 1 - safeChance;
  if (dangerChance < 0 || dangerChance > 1) {
    throw new Error(
      `${difficulty.label} ${routeLength} 格路線無法達成 RTP 95%（p=${dangerChance.toFixed(6)}）`
    );
  }
  const successRate = safeChance ** events;
  return {
    events,
    successRate,
    mean,
    bonusFactor,
    dangerChance,
    theoreticalRtp: successRate * events * mean * bonusFactor
  };
}

export function validateReachableLengths(difficulty, lengths) {
  return lengths.map((routeLength) => ({
    routeLength,
    ...rtpParameters(difficulty, routeLength)
  }));
}
