import { DIFFICULTIES, TARGET_RTP } from "../src/config.js";
import { createSeededRandom, generateRoundEvents, calculateOutcome } from "../src/engine.js";
import { enumerateReachableLengths } from "../src/route.js";
import { rtpParameters } from "../src/rtp.js";

const trials = Math.max(1, Number(process.argv[2] || 100_000));
const seed = Number(process.argv[3] || 20261113);
const random = createSeededRandom(seed);
const rows = [];

for (const difficulty of Object.values(DIFFICULTIES)) {
  for (const length of enumerateReachableLengths(difficulty.size)) {
    const route = Array.from({ length }, (_, index) => ({ row: index, col: 0 }));
    let totalReturn = 0;
    let successes = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      const { events, params } = generateRoundEvents(difficulty, route, random);
      const outcome = calculateOutcome(events, length, 1, params.bonusFactor);
      totalReturn += outcome.payout;
      if (outcome.success) successes += 1;
    }
    const params = rtpParameters(difficulty, length);
    const measuredRtp = totalReturn / trials;
    rows.push({
      難度: difficulty.label,
      格數: length,
      局數: trials,
      實測RTP: measuredRtp.toFixed(5),
      理論RTP: params.theoreticalRtp.toFixed(5),
      實測成功率: (successes / trials).toFixed(5),
      理論成功率: params.successRate.toFixed(5),
      偏差: (measuredRtp - TARGET_RTP).toFixed(5)
    });
  }
}

console.log(`seed=${seed}, trials=${trials}（每難度／每合法長度）`);
console.table(rows);
