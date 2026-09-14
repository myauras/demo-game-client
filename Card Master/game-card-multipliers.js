(function (root) {
  'use strict';
  const multipliers = Object.freeze([
    1.19, 1.32, 1.49, 1.73, 2.04, 2.47, 3.06, 3.87,
    5.04, 6.72, 9.19, 12.92, 18.66, 27.72, 42.40, 66.81,
    108.56, 182.10, 315.64, 565.98, 1051.10, 2024.34, 4048.68, 8421.26,
    18246.06, 41251.96, 97504.63, 241440.04, 627744.11, 1718036.50,
    4963216.57, 15181603.62
  ]);
  function probability(count) {
    if (!Number.isInteger(count) || count < 5 || count > 36) throw new RangeError('張數必須介於 5 至 36');
    let p = 1;
    for (let i = 0; i < count; i++) p *= (52 - i) / 52;
    return p;
  }
  function multiplier(count) { probability(count); return multipliers[count - 5]; }
  function draw(random = Math.random) { return Math.floor(random() * 52); }
  function settle(stake, count, cards) {
    if (!Number.isInteger(stake) || stake < 1 || stake > 1000000) throw new RangeError('點數無效');
    probability(count);
    if (cards.length > count || cards.some(c => !Number.isInteger(c) || c < 0 || c > 51)) throw new RangeError('牌局無效');
    const duplicate = new Set(cards).size !== cards.length;
    const complete = duplicate || cards.length === count;
    const win = complete && !duplicate;
    return { complete, win, payout: win ? Math.round(stake * multiplier(count) * 100) / 100 : 0 };
  }
  const api = { probability, multiplier, draw, settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardMaster = api;
})(typeof window === 'undefined' ? globalThis : window);
