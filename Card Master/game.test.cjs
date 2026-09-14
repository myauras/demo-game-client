const assert = require('node:assert/strict');
const {probability, multiplier, draw, settle} = require('./game.js');
const expectedMultipliers = [
  1.16,1.28,1.45,1.67,1.98,2.39,2.96,3.76,4.88,6.51,8.91,12.52,18.09,26.87,41.10,64.76,
  105.24,176.53,305.98,548.65,1018.92,1962.37,3924.74,8163.46,17687.51,39989.14,94519.80,
  234049.02,608527.45,1665443.55,4811281.37,14716860.65
];
assert.equal(probability(5), (51*50*49*48)/(52**4));
for(let n=5;n<=36;n++) {
  assert.ok(probability(n)>0 && probability(n)<1);
  if(n>5) { assert.ok(probability(n)<probability(n-1)); assert.ok(multiplier(n)>multiplier(n-1)); }
  assert.equal(multiplier(n),expectedMultipliers[n-5]);
  assert.ok(Math.abs(probability(n)*multiplier(n)-.95)<.0022);
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
console.log('PASS: all 32 RTP 0.95 multipliers, rounding tolerance, payout, duplicates, and boundaries.');
