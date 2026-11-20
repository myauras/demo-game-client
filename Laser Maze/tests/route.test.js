import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRouteNode,
  canReachUnvisitedGoal,
  enumerateReachableLengths,
  routeStatus,
  truncateRouteAtNode
} from "../src/route.js";

test("三種盤面可達路線長度完整", () => {
  for (const size of [3, 4, 5]) {
    assert.deepEqual(
      enumerateReachableLengths(size),
      Array.from({ length: size * size - size + 1 }, (_, index) => size + index)
    );
  }
});

test("合法路線必須從頂排開始並停在底排", () => {
  assert.equal(routeStatus([{ row: 1, col: 0 }], 3).valid, false);
  assert.equal(routeStatus([
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }
  ], 3).ready, true);
  assert.equal(routeStatus([
    { row: 0, col: 0 }, { row: 1, col: 0 }
  ], 3).ready, false);
});

test("拒絕斜向與重複格", () => {
  assert.equal(routeStatus([
    { row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 1 }
  ], 3).valid, false);
  assert.equal(routeStatus([
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 0, col: 0 }
  ], 3).valid, false);
});

test("抵達底排後可以繼續延伸，尾端離開底排後暫不可確認", () => {
  const route = [
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }
  ];
  assert.equal(routeStatus(route, 3).ready, true);
  const extended = appendRouteNode(route, { row: 2, col: 1 }, 3);
  assert.equal(routeStatus(extended, 3).ready, true);
  const leftBottom = appendRouteNode(extended, { row: 1, col: 1 }, 3);
  assert.equal(routeStatus(leftBottom, 3).ready, false);
});

test("回拖上一格只撤銷最後一段", () => {
  const route = [
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }
  ];
  assert.deepEqual(appendRouteNode(route, { row: 1, col: 0 }, 3), route.slice(0, -1));
});

test("點擊連線內圓格可將路線退回該格", () => {
  const route = [
    { row: 0, col: 0 }, { row: 1, col: 0 },
    { row: 1, col: 1 }, { row: 2, col: 1 }
  ];
  assert.deepEqual(truncateRouteAtNode(route, { row: 1, col: 0 }), route.slice(0, 2));
  assert.equal(truncateRouteAtNode(route, { row: 2, col: 1 }), route);
  assert.equal(truncateRouteAtNode(route, { row: 0, col: 2 }), route);
});

test("判斷拖曳尾端是否仍可抵達未連線終點", () => {
  assert.equal(canReachUnvisitedGoal([
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }
  ], 3), true);
  assert.equal(canReachUnvisitedGoal([
    { row: 0, col: 0 }, { row: 1, col: 0 },
    { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }
  ], 3), false);

  const trapped = [
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 },
    { row: 3, col: 0 }, { row: 4, col: 0 }, { row: 4, col: 1 },
    { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 3, col: 3 },
    { row: 3, col: 4 }, { row: 2, col: 4 }, { row: 2, col: 3 },
    { row: 2, col: 2 }, { row: 3, col: 2 }, { row: 3, col: 1 },
    { row: 2, col: 1 }, { row: 1, col: 1 }, { row: 1, col: 2 },
    { row: 1, col: 3 }, { row: 1, col: 4 }, { row: 0, col: 4 },
    { row: 0, col: 3 }, { row: 0, col: 2 }, { row: 0, col: 1 }
  ];
  assert.equal(routeStatus(trapped, 5).valid, true);
  assert.equal(canReachUnvisitedGoal(trapped, 5), false);
});
