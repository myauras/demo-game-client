import { TARGET_RTP, REWARD_TYPES } from "./config.js";

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
  const safeChance = (TARGET_RTP / (events * mean)) ** (1 / events);
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
    dangerChance,
    theoreticalRtp: successRate * events * mean
  };
}

export function validateReachableLengths(difficulty, lengths) {
  return lengths.map((routeLength) => ({
    routeLength,
    ...rtpParameters(difficulty, routeLength)
  }));
}
