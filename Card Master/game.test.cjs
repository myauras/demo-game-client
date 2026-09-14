const assert = require('node:assert/strict');
const {probability, multiplier, draw, settle} = require('./game.js');
const expectedMultipliers = [
  1.19,1.32,1.49,1.73,2.04,2.47,3.06,3.87,5.04,6.72,9.19,12.92,18.66,27.72,42.40,66.81,
  108.56,182.10,315.64,565.98,1051.10,2024.34,4048.68,8421.26,18246.06,41251.96,97504.63,
  241440.04,627744.11,1718036.50,4963216.57,15181603.62
];
assert.equal(probability(5), (51*50*49*48)/(52**4));
for(let n=5;n<=36;n++) {
  assert.ok(probability(n)>0 && probability(n)<1);
  if(n>5) { assert.ok(probability(n)<probability(n-1)); assert.ok(multiplier(n)>multiplier(n-1)); }
  assert.equal(multiplier(n),expectedMultipliers[n-5]);
  const result=settle(100,n,Array.from({length:n},(_,i)=>i));
  assert.ok(result.complete && result.win);
  assert.equal(result.payout,Math.round(100*multiplier(n)*100)/100);
}
assert.deepEqual(settle(100,5,[0,13,26,39]),{complete:false,win:false,payout:0});
assert.deepEqual(settle(100,5,[0,13,26,39,0]),{complete:true,win:false,payout:0});
assert.deepEqual(settle(100,36,[51,51]),{complete:true,win:false,payout:0});
assert.equal(draw(()=>0),0); assert.equal(draw(()=>.999999),51);
assert.throws(()=>probability(4)); assert.throws(()=>probability(37));
assert.throws(()=>settle(-1,5,[1])); assert.throws(()=>settle(1.5,5,[1]));
assert.throws(()=>settle(100,5,[52]));
console.log('PASS: all 32 sheet multipliers, monotonic odds/multipliers, payout, same-rank different-suit, duplicate loss, boundaries.');
