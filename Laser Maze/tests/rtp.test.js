import test from "node:test";
import assert from "node:assert/strict";
import { DIFFICULTIES } from "../src/config.js";
import { enumerateReachableLengths } from "../src/route.js";
import { conditionalMean, rtpParameters } from "../src/rtp.js";

test("難度條件平均倍率正確", () => {
  assert.ok(Math.abs(conditionalMean(DIFFICULTIES.normal) - 0.55) < 1e-12);
  assert.ok(Math.abs(conditionalMean(DIFFICULTIES.medium) - 1.1) < 1e-12);
  assert.ok(Math.abs(conditionalMean(DIFFICULTIES.hard) - 1.7) < 1e-12);
});

test("每個合法長度的警戒率都在範圍內且理論 RTP 精確為 95%", () => {
  for (const difficulty of Object.values(DIFFICULTIES)) {
    for (const length of enumerateReachableLengths(difficulty.size)) {
      const params = rtpParameters(difficulty, length);
      assert.ok(params.dangerChance >= 0 && params.dangerChance <= 1);
      assert.ok(Math.abs(params.theoreticalRtp - 0.95) < 1e-12);
    }
  }
});

test("代表性路線的警戒率由 RTP 公式反推", () => {
  for (const [difficulty, length] of [
    [DIFFICULTIES.normal, 3],
    [DIFFICULTIES.medium, 4],
    [DIFFICULTIES.hard, 5]
  ]) {
    const events = length - 1;
    const expected = 1 - (0.95 / (events * conditionalMean(difficulty))) ** (1 / events);
    assert.ok(Math.abs(rtpParameters(difficulty, length).dangerChance - expected) < 1e-12);
  }
});
