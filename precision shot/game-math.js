/* Shared Precision Shot outcome model for the browser game and RTP simulation. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PrecisionShotMath=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LEVELS={easy:[.5,2,5,10],medium:[.2,3,10,50],hard:[0,10,100,1000]};
  // Base distributions are calibrated to 90% RTP. Lucky Time contributes the remaining 5%.
  const ZONE_PROBABILITIES={
    easy:[.7786666666666666,.2003333333333333,.02,.001],
    medium:[.7658571428571428,.2289428571428572,.005,.0002],
    hard:[.92395,.075,.001,.00005]
  };
  const GAME_CONFIG={
    targetRTP:.95,
    rtpTolerance:.01,
    bulletCounts:[1,2,3,5,10,20],
    luckyTime:{
      enabled:true,
      rewardMultiplier:2,
      introPauseMs:180,
      introDurationMs:520,
      hitEffectDurationMs:500,
      expireDurationMs:300,
      triggerRate:{
        easy:{1:.168387965873,2:.139027749433,3:.122517881993,5:.103681980977,10:.083459131862,20:.070501924193},
        medium:{1:.179651168759,2:.139553625724,3:.118052065410,5:.095500977069,10:.074858732476,20:.064936062031},
        hard:{1:.206185567010,2:.144390944343,3:.112284718196,5:.079428832713,10:.049048203422,20:.031721597117}
      },
      luckyZoneWeight:{easy:[4,3,2,1],medium:[4,3,2,1],hard:[5,3,1.5,.5]}
    }
  };
  function chooseZone(level,r){
    const [outer,middle,inner]=ZONE_PROBABILITIES[level];
    return r<outer?0:r<outer+middle?1:r<outer+middle+inner?2:3;
  }
  function selectLuckyZone(level,r){
    const weights=GAME_CONFIG.luckyTime.luckyZoneWeight[level],total=weights.reduce((sum,value)=>sum+value,0);
    let cursor=r*total;
    for(let zone=0;zone<weights.length;zone++){cursor-=weights[zone];if(cursor<0)return zone;}
    return weights.length-1;
  }
  function createRoundState(bulletCount){return {bulletCount,currentShot:0,luckyTimeActive:false,luckyZoneId:null,shotResults:[]};}
  function rollLuckyTime(level,roundState,random=Math.random){
    const lucky=GAME_CONFIG.luckyTime;
    let luckyTimeTriggered=false;
    if(lucky.enabled&&!roundState.luckyTimeActive&&random()<lucky.triggerRate[level][roundState.bulletCount]){
      roundState.luckyTimeActive=true;
      roundState.luckyZoneId=selectLuckyZone(level,random());
      luckyTimeTriggered=true;
    }
    return luckyTimeTriggered;
  }
  function resolveShot(level,roundState,random=Math.random,luckyAlreadyChecked=false){
    const lucky=GAME_CONFIG.luckyTime;
    const luckyTimeTriggered=luckyAlreadyChecked?false:rollLuckyTime(level,roundState,random);
    const luckyTimeActiveAtShot=roundState.luckyTimeActive,luckyZoneIdAtShot=roundState.luckyZoneId;
    const hitZoneId=chooseZone(level,random()),baseMultiplier=LEVELS[level][hitZoneId];
    const isLuckyHit=luckyTimeActiveAtShot&&hitZoneId===luckyZoneIdAtShot;
    const finalMultiplier=baseMultiplier*(isLuckyHit?lucky.rewardMultiplier:1);
    const result={shotIndex:roundState.currentShot,hitZoneId,baseMultiplier,luckyTimeTriggered,luckyTimeActiveAtShot,luckyZoneIdAtShot,isLuckyHit,finalMultiplier,bulletHoleType:isLuckyHit?'lucky':'normal'};
    roundState.currentShot++;
    roundState.shotResults.push(result);
    if(isLuckyHit){roundState.luckyTimeActive=false;roundState.luckyZoneId=null;}
    return result;
  }
  function exactRtp(level,bulletCount){
    const probabilities=ZONE_PROBABILITIES[level],multipliers=LEVELS[level],weights=GAME_CONFIG.luckyTime.luckyZoneWeight[level];
    const weightTotal=weights.reduce((sum,value)=>sum+value,0),triggerRate=GAME_CONFIG.luckyTime.triggerRate[level][bulletCount];
    let states=[1,0,0,0,0],luckyExtra=0;
    for(let shot=0;shot<bulletCount;shot++){
      const before=[states[0]*(1-triggerRate),states[1],states[2],states[3],states[4]];
      for(let zone=0;zone<4;zone++)before[zone+1]+=states[0]*triggerRate*weights[zone]/weightTotal;
      const after=[before[0],0,0,0,0];
      for(let zone=0;zone<4;zone++){
        luckyExtra+=before[zone+1]*probabilities[zone]*multipliers[zone]*(GAME_CONFIG.luckyTime.rewardMultiplier-1);
        after[0]+=before[zone+1]*probabilities[zone];
        after[zone+1]+=before[zone+1]*(1-probabilities[zone]);
      }
      states=after;
    }
    const baseRtp=probabilities.reduce((sum,p,index)=>sum+p*multipliers[index],0);
    return {baseRtp,luckyExtraRtp:luckyExtra/bulletCount,rtp:baseRtp+luckyExtra/bulletCount};
  }
  function seededRandom(seed){let value=seed>>>0;return()=>{value=(value+0x6D2B79F5)|0;let t=Math.imul(value^value>>>15,1|value);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function simulateCombination({level,bulletCount,rounds=1000000,bet=1,seed=0x51f15e}){
    const random=seededRandom(seed),totals={difficulty:level,bulletCount,rounds,totalShots:rounds*bulletCount,totalBet:rounds*bulletCount*bet,basePayout:0,luckyExtraPayout:0,totalPayout:0,luckyTimeTriggers:0,luckyHits:0,luckyTimeHitRate:0,rtp:0};
    for(let round=0;round<rounds;round++){
      const roundState=createRoundState(bulletCount);
      for(let shot=0;shot<bulletCount;shot++){
        const result=resolveShot(level,roundState,random),base=result.baseMultiplier*bet;
        totals.basePayout+=base;
        totals.luckyExtraPayout+=result.isLuckyHit?base*(GAME_CONFIG.luckyTime.rewardMultiplier-1):0;
        if(result.luckyTimeTriggered)totals.luckyTimeTriggers++;
        if(result.isLuckyHit)totals.luckyHits++;
      }
    }
    totals.totalPayout=totals.basePayout+totals.luckyExtraPayout;
    totals.luckyTimeHitRate=totals.luckyTimeTriggers?totals.luckyHits/totals.luckyTimeTriggers:0;
    totals.rtp=totals.totalPayout/totals.totalBet;
    return totals;
  }
  return {LEVELS,ZONE_PROBABILITIES,GAME_CONFIG,chooseZone,selectLuckyZone,createRoundState,rollLuckyTime,resolveShot,exactRtp,simulateCombination};
});
