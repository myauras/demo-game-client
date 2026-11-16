import test from "node:test";
import assert from "node:assert/strict";
import { DIFFICULTIES } from "../src/config.js";
import { calculateOutcome, createSeededRandom, generateRoundEvents, settleRound } from "../src/engine.js";

const route = [
  { row: 0, col: 0 },
  { row: 1, col: 0 },
  { row: 2, col: 0 }
];

test("起點永不抽事件且終點會抽事件", () => {
  const { events } = generateRoundEvents(DIFFICULTIES.normal, route, () => 0.99);
  assert.equal(events.length, route.length - 1);
  assert.equal(events[0].routeIndex, 1);
  assert.equal(events.at(-1).routeIndex, route.length - 1);
});

test("未觸發警戒的有效圓格必定獲得四種獎勵之一", () => {
  const rewardIds = new Set(["coin", "coins", "bars", "diamond"]);
  const { events } = generateRoundEvents(DIFFICULTIES.normal, route, () => 0.99);
  assert.equal(events.length, route.length - 1);
  assert.ok(events.every((event) => event.type === "reward"));
  assert.ok(events.every((event) => rewardIds.has(event.rewardId)));
});

test("警戒立即停止並支付 0", () => {
  const { events } = generateRoundEvents(DIFFICULTIES.normal, route, () => 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "danger");
  assert.deepEqual(calculateOutcome(events, route.length, 100).payout, 0);
});

test("固定 seed 可重現相同事件", () => {
  const first = generateRoundEvents(DIFFICULTIES.normal, route, createSeededRandom(20261113));
  const second = generateRoundEvents(DIFFICULTIES.normal, route, createSeededRandom(20261113));
  assert.deepEqual(first.events, second.events);
});

test("重複結算不會再次支付", () => {
  const round = {
    route,
    bet: 100,
    paid: false,
    events: [
      { type: "reward", multiplier: 0.2, routeIndex: 1 },
      { type: "reward", multiplier: 0.5, routeIndex: 2 }
    ]
  };
  const first = settleRound(900, round);
  assert.equal(first.balance, 970);
  assert.equal(first.changed, true);
  const second = settleRound(first.balance, first.round);
  assert.equal(second.balance, 970);
  assert.equal(second.changed, false);
});

test("全盤成功只套用一次乘二獎勵", () => {
  const fullRoute = Array.from({ length: 9 }, (_, index) => ({
    row: Math.floor(index / 3),
    col: index % 3
  }));
  const events = Array.from({ length: 8 }, (_, index) => ({
    type: "reward",
    multiplier: 0.5,
    routeIndex: index + 1
  }));
  const outcome = calculateOutcome(events, fullRoute.length, 100, 2);
  assert.equal(outcome.baseMultiplier, 4);
  assert.equal(outcome.multiplier, 8);
  assert.equal(outcome.payout, 800);
  assert.equal(outcome.fullBoardBonusApplied, true);

  const settled = settleRound(0, { route: fullRoute, bet: 100, events, fullBoard: true, paid: false });
  assert.equal(settled.balance, 800);
  const repeated = settleRound(settled.balance, settled.round);
  assert.equal(repeated.balance, 800);
  assert.equal(repeated.changed, false);
});
