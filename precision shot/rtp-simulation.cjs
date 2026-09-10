#!/usr/bin/env node
const {GAME_CONFIG,simulateCombination}=require('./game-math.js');

const roundsArg=process.argv.find(arg=>arg.startsWith('--rounds='));
const rounds=roundsArg?Number(roundsArg.split('=')[1]):1000000;
if(!Number.isInteger(rounds)||rounds<1000000)throw new Error('rounds must be an integer of at least 1,000,000');

const columns=['difficulty','bulletCount','rounds','totalShots','totalBet','basePayout','luckyExtraPayout','totalPayout','luckyTimeTriggers','luckyHits','luckyTimeHitRate','rtp'];
console.log(columns.join(','));
let seed=0x51f15e;
for(const difficulty of Object.keys(GAME_CONFIG.luckyTime.triggerRate)){
  for(const bulletCount of GAME_CONFIG.bulletCounts){
    const result=simulateCombination({level:difficulty,bulletCount,rounds,seed:seed++});
    console.log(columns.map(key=>typeof result[key]==='number'&&!Number.isInteger(result[key])?result[key].toFixed(8):result[key]).join(','));
  }
}
