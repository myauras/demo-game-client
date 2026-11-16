import test from "node:test";
import assert from "node:assert/strict";
import { appendRouteNode, enumerateReachableLengths, routeStatus } from "../src/route.js";

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
