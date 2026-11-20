export const keyOf = ({ row, col }) => `${row}:${col}`;

export const isAdjacent = (a, b) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

export function routeStatus(route, size) {
  if (!Array.isArray(route) || route.length === 0) {
    return { valid: false, ready: false, reason: "請從最上排選擇起點" };
  }
  if (route[0].row !== 0) {
    return { valid: false, ready: false, reason: "起點必須位於最上排" };
  }

  const seen = new Set();
  for (let index = 0; index < route.length; index += 1) {
    const node = route[index];
    if (!Number.isInteger(node.row) || !Number.isInteger(node.col)
      || node.row < 0 || node.row >= size || node.col < 0 || node.col >= size) {
      return { valid: false, ready: false, reason: "路線超出盤面" };
    }
    const key = keyOf(node);
    if (seen.has(key)) return { valid: false, ready: false, reason: "不可重複經過圓格" };
    seen.add(key);
    if (index > 0 && !isAdjacent(route[index - 1], node)) {
      return { valid: false, ready: false, reason: "只能連接上下左右相鄰圓格" };
    }
  }

  const tail = route.at(-1);
  if (tail.row !== size - 1) {
    return { valid: true, ready: false, reason: "最後一格需停在最下排" };
  }
  return { valid: true, ready: true, reason: "路線完成，可以確認潛入" };
}

export function appendRouteNode(route, node, size) {
  if (!route.length) return node.row === 0 ? [node] : route;
  const tail = route.at(-1);
  if (tail.row === node.row && tail.col === node.col) return route;
  if (route.length > 1) {
    const previous = route.at(-2);
    if (previous.row === node.row && previous.col === node.col) return route.slice(0, -1);
  }
  if (!isAdjacent(tail, node)) return route;
  if (route.some((item) => item.row === node.row && item.col === node.col)) return route;
  if (route.length >= size * size) return route;
  return [...route, node];
}

export function truncateRouteAtNode(route, node) {
  const index = route.findIndex((item) => item.row === node.row && item.col === node.col);
  if (index < 0 || index === route.length - 1) return route;
  return route.slice(0, index + 1);
}

export function routeEffectLevel(routeLength, size) {
  if (!Number.isInteger(routeLength) || !Number.isInteger(size) || routeLength <= 1 || size <= 1) {
    return "none";
  }
  const total = size ** 2;
  if (routeLength >= total) return "full";
  const progress = (routeLength - 1) / (total - 1);
  if (progress < 0.25) return "low";
  if (progress < 0.5) return "medium";
  if (progress < 0.75) return "high";
  return "ultra";
}

export function canReachUnvisitedGoal(route, size) {
  if (!Array.isArray(route) || route.length === 0) return true;
  const visited = new Set(route.map(keyOf));
  const queue = [route.at(-1)];
  const reachable = new Set([keyOf(route.at(-1))]);

  for (let index = 0; index < queue.length; index += 1) {
    for (const next of neighbors(queue[index], size)) {
      const key = keyOf(next);
      if (visited.has(key) || reachable.has(key)) continue;
      if (next.row === size - 1) return true;
      reachable.add(key);
      queue.push(next);
    }
  }
  return false;
}

const directions = [
  { row: 1, col: 0 },
  { row: 0, col: 1 },
  { row: 0, col: -1 },
  { row: -1, col: 0 }
];

function neighbors(node, size) {
  return directions
    .map((delta) => ({ row: node.row + delta.row, col: node.col + delta.col }))
    .filter((next) => next.row >= 0 && next.row < size && next.col >= 0 && next.col < size);
}

export function canReachLength(size, targetLength) {
  if (targetLength < size || targetLength > size * size) return false;
  const visited = new Uint8Array(size * size);
  const toIndex = (node) => node.row * size + node.col;

  function search(node, depth) {
    if (depth === targetLength) return node.row === size - 1;
    const remaining = targetLength - depth;
    const minToBottom = size - 1 - node.row;
    if (minToBottom > remaining) return false;

    const options = neighbors(node, size)
      .filter((next) => !visited[toIndex(next)])
      .sort((a, b) => {
        const aDegree = neighbors(a, size).filter((n) => !visited[toIndex(n)]).length;
        const bDegree = neighbors(b, size).filter((n) => !visited[toIndex(n)]).length;
        return aDegree - bDegree || b.row - a.row;
      });

    for (const next of options) {
      visited[toIndex(next)] = 1;
      if (search(next, depth + 1)) return true;
      visited[toIndex(next)] = 0;
    }
    return false;
  }

  for (let col = 0; col < size; col += 1) {
    visited.fill(0);
    const start = { row: 0, col };
    visited[toIndex(start)] = 1;
    if (search(start, 1)) return true;
  }
  return false;
}

export function enumerateReachableLengths(size) {
  const lengths = [];
  for (let length = size; length <= size * size; length += 1) {
    if (canReachLength(size, length)) lengths.push(length);
  }
  return lengths;
}
