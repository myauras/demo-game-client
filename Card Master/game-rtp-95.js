(function (root) {
  'use strict';
  const targetRtp = 0.95;
  function probability(count) {
    if (!Number.isInteger(count) || count < 5 || count > 36) throw new RangeError('張數必須介於 5 至 36');
    let p = 1;
    for (let i = 0; i < count; i++) p *= (52 - i) / 52;
    return p;
  }
  function multiplier(count) { return Math.round(targetRtp / probability(count) * 100) / 100; }
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
