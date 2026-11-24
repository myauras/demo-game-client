(() => {
  'use strict';

  const CONFIG = {
    maxBalls: 30,
    spawnGap: 230,
    spawnDelay: 560,
    spawnDuration: .22,
    difficulties: {
      easy: { label: '簡單', winWidth: .70, gapAngle: 59.90, superGapAngle: 90.50, max: 3, colorStops: [[4,'#42de84'],[7,'#2d9cff']] },
      normal: { label: '普通', winWidth: .50, gapAngle: 60.60, superGapAngle: 83.10, max: 7.5, colorStops: [[4,'#42de84'],[7,'#2d9cff'],[11,'#f156d9']] },
      hard: { label: '困難', winWidth: .30, gapAngle: 76.30, superGapAngle: 137.20, max: 38.85, colorStops: [[4,'#42de84'],[7,'#2d9cff'],[11,'#f156d9'],[16,'#ff8b35']] }
    },
    targetRtp: .95,
    maxHitBoostChance: .14,
    hitRange: { easy:[3,15], normal:[3,30], hard:[2,25] },
    superPool: [3,4,5,10,20],
    superColors: { 3:'#eef5ff',4:'#42de84',5:'#2d9cff',10:'#bd5cff',20:'#ff8b35' },
    modeCost: { normal:1, super:5, ten:10 },
    physics: {
      fixedTimestep: 1/45,
      gravity: 1430,
      spawnSpeed: 397,
      spawnSpeedSpread: 21,
      ringRadius: 225,
      ballRadius: 14,
      ringSpeed: -(162*Math.PI)/180,
      innerRestitution: 1.1,
      outerRestitution: .6,
      wallRestitution: .8,
      maxSpeed: 1048
    },
    antiStall: {
      softenStart: 600/45,
      lowBounceAt: 840/45,
      hardLimit: 1500/45,
      lowRestitution: .86,
      maxRecordedCollisions: 40
    }
  };

  const $ = (s) => document.querySelector(s);
  const canvas = $('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const ui = { balance:$('#balance'), history:$('#history'), input:$('#betInput'), inputWrap:$('.bet-input-wrap'), difficulty:$('#difficulty'), difficultyPicker:$('.difficulty-picker'), difficultyTrigger:$('#difficultyTrigger'), difficultyMenu:$('#difficultyMenu'), bet:$('#betButton'), bonus:$('#bonusButton'), modes:$('#modeSheet'), closeModes:$('#closeModes'), auto:$('#autoButton'), modal:$('#autoModal'), closeAuto:$('#closeAuto'), confirmAuto:$('#confirmAuto') };
  const state = { balance:100000, baseBet:10, mode:'normal', difficulty:'easy', balls:[], queue:[], history:[], particles:[], flashes:[], ringAngle:0, ringFlash:0, modeTransition:null, auto:null, selectedAuto:null, lastSpawn:0, locked:false };
  let lastTime = performance.now();

  const formatMoney = n => '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const rand = (a,b) => a + Math.random()*(b-a);
  const angleDelta = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const winWidth = difficulty => CONFIG.difficulties[difficulty].winWidth;
  const gapAngle = (difficulty,mode) => (mode==='super'?CONFIG.difficulties[difficulty].superGapAngle:CONFIG.difficulties[difficulty].gapAngle)*Math.PI/180;
  function innerRestitution(age){
    const guard=CONFIG.antiStall;
    if(age<=guard.softenStart)return CONFIG.physics.innerRestitution;
    if(age>=guard.lowBounceAt)return guard.lowRestitution;
    const p=(age-guard.softenStart)/(guard.lowBounceAt-guard.softenStart);
    return CONFIG.physics.innerRestitution+(guard.lowRestitution-CONFIG.physics.innerRestitution)*p;
  }
  function multiplier(diff, count){
    if(diff==='easy') return Math.min(count*.2,3);
    if(diff==='normal') return Math.min(count*.25,7.5);
    if(count<=0) return 0;
    if(count===1) return 1.15;
    if(count<=10) return 1.15+(count-1)*.3;
    if(count<=15) return 3.85+(count-10);
    if(count<=20) return 8.85+(count-15)*2;
    return Math.min(18.85+(count-20)*4,38.85);
  }
  function meanCollisionMultiplier(diff){
    const [min,max]=CONFIG.hitRange[diff];
    let total=0;
    for(let hits=min;hits<=max;hits++) total+=multiplier(diff,hits);
    const uniformMean=total/(max-min+1);
    return uniformMean*(1-CONFIG.maxHitBoostChance)+multiplier(diff,max)*CONFIG.maxHitBoostChance;
  }
  function rtpWinChance(diff,mode){
    const collisionMean=meanCollisionMultiplier(diff);
    const extraMean=mode==='super'?CONFIG.superPool.reduce((sum,value)=>sum+value,0)/CONFIG.superPool.length:1;
    const costPerBall=mode==='super'?CONFIG.modeCost.super:1;
    return clamp(CONFIG.targetRtp*costPerBall/(collisionMean*extraMean),0,1);
  }
  function showMessage(){ /* 操作提示依介面需求停用。 */ }
  function activeSlots(){ return state.balls.length + state.queue.length; }
  function baseBet(){ return state.baseBet; }
  function currentCost(){ return baseBet()*CONFIG.modeCost[state.mode]; }
  function updateUI(){
    ui.input.value=Number(currentCost().toFixed(2));
    ui.inputWrap.classList.toggle('boosted',state.mode!=='normal');
    ui.balance.textContent=formatMoney(state.balance);
    ui.bonus.innerHTML=state.mode==='normal'?'<span class="bonus-mark">✦</span><b>購買加成</b>':`<span class="bonus-mark">◆</span><b>${state.mode==='super'?'超級球':'10 球'}</b><span class="mode-switch" aria-hidden="true"><i></i></span>`;
    ui.bonus.classList.toggle('active',state.mode!=='normal');
    ui.bonus.disabled=activeSlots()>0||!!state.auto||state.locked;
    ui.input.disabled=!!state.auto||state.locked; ui.difficulty.disabled=!!state.auto || activeSlots()>0 || state.locked;
    ui.difficultyTrigger.disabled=ui.difficulty.disabled;
    ui.bet.disabled=state.locked || state.balance<currentCost() || activeSlots()+(state.mode==='ten'?10:1)>CONFIG.maxBalls;
    ui.auto.disabled=state.locked;
    document.querySelectorAll('#quickBets button').forEach(button=>button.disabled=!!state.auto||state.locked);
    ui.auto.textContent=state.auto ? `停止 ${state.auto.infinite?'∞':state.auto.left}` : '自動';
    ui.auto.classList.toggle('running',!!state.auto);
    renderHistory();
  }
  function renderHistory(){
    ui.history.innerHTML='';
    for(let i=0;i<5;i++){
      const h=state.history[i], el=document.createElement('span');
      if(h){el.textContent=h.mult.toFixed(2)+'X';if(h.extraMultiplier){const badge=document.createElement('b');badge.className='history-super-badge';badge.textContent='×'+h.extraMultiplier;el.appendChild(badge);}if(!h.win)el.classList.add('lose');}
      else{el.textContent='—';el.classList.add('empty');}
      ui.history.appendChild(el);
    }
  }

  function makePlan(betId, bet, diff, mode){
    const d=CONFIG.difficulties[diff], win=Math.random()<rtpWinChance(diff,mode);
    const [minHits,maxHits]=CONFIG.hitRange[diff];
    let hits=Math.floor(rand(minHits,maxHits+1));
    if(Math.random()<CONFIG.maxHitBoostChance) hits=maxHits;
    const inner=Math.min(hits,Math.floor(hits*rand(.58,.88)));
    const extra=mode==='super'?CONFIG.superPool[Math.floor(Math.random()*CONFIG.superPool.length)]:1;
    return { id:crypto.randomUUID?.()||Math.random().toString(36),betId,baseBet:bet,actualCost:bet*CONFIG.modeCost[mode],difficulty:diff,mode,effectiveCollisionCount:0,innerCollisionCount:0,targetHits:hits,targetInner:inner,collisionMultiplier:0,extraMultiplier:extra,displayAmount:0,finalReward:bet*multiplier(diff,hits)*extra,winOrLose:win?'win':'lose',status:'queued',color:mode==='super'?CONFIG.superColors[extra]:'#eef5ff',path:[],hitIndex:0 };
  }
  function placeBet(fromAuto=false){
    const count=state.mode==='ten'?10:1, cost=currentCost();
    if(activeSlots()+count>CONFIG.maxBalls){ if(!fromAuto)showMessage('場上小球已達上限'); return false; }
    if(state.balance<cost){ showMessage('餘額不足'); stopAuto(); return false; }
    state.balance-=cost;
    const bet=baseBet(), diff=state.difficulty, betId=Date.now()+'-'+Math.random(),firstSpawnAt=performance.now()+CONFIG.spawnDelay;
    for(let i=0;i<count;i++){const plan=makePlan(betId,bet,diff,state.mode==='ten'?'normal':state.mode);plan.readyAt=firstSpawnAt+i*CONFIG.spawnGap;state.queue.push(plan);}
    showMessage(count===10?'10 顆球依序進場！':'小球進場！');
    updateUI();
    return true;
  }
  function spawnQueued(now){
    if(!state.queue.length || now<state.queue[0].readyAt || now-state.lastSpawn<CONFIG.spawnGap) return;
    const b=state.queue.shift(),gap=gapAngle(b.difficulty,b.mode),gapCenter=state.ringAngle-Math.PI/2;let angle=rand(0,Math.PI*2);while(Math.abs(angleDelta(angle,gapCenter))<gap/2+.35)angle=rand(0,Math.PI*2);const speed=CONFIG.physics.spawnSpeed+rand(-CONFIG.physics.spawnSpeedSpread,CONFIG.physics.spawnSpeedSpread); state.lastSpawn=now; b.status='spawning'; b.age=0; b.spawnAge=0; b.x=375; b.y=420; b.vx=Math.cos(angle)*speed; b.vy=Math.sin(angle)*speed; b.nextHit=rand(.22,.42); b.hitCooldown=0; b.trail=[]; b.flash=0; state.balls.push(b); updateUI();
  }
  function spark(x,y,color='#5eeaff'){
    for(let i=0;i<9;i++){ const a=rand(0,Math.PI*2),s=rand(55,190); state.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.2,.48),max:.48,color}); }
  }
  function upwardSprayAngle(x,spread){const center=x<150?-1.05:x>600?-2.09:-Math.PI/2;return rand(center-spread,center+spread);}
  function debrisBurst(ball){
    const colors=['#7dff91','#e9fff0','#ffd94a','#9ab0be'];
    for(let i=0;i<14;i++){const a=upwardSprayAngle(ball.x,.58),s=rand(90,235),life=rand(.45,.85);state.particles.push({kind:'debris',x:ball.x+rand(-6,6),y:ball.y-4,vx:Math.cos(a)*s,vy:Math.sin(a)*s,gravity:430,rotation:rand(0,Math.PI*2),spin:rand(-9,9),w:rand(2,5),h:rand(2,6),life,max:life,color:colors[Math.floor(rand(0,colors.length))]});}
  }
  function confettiBurst(ball,deluxe=false){
    const colors=['#2cff74','#8cff55','#ffe34d','#ffffff','#65e7ff',ball.color],count=deluxe?72:34;
    for(let i=0;i<count;i++){const sourceOffset=deluxe?(i%2?-16:16):0,a=upwardSprayAngle(ball.x,deluxe?.88:.72),s=rand(deluxe?210:165,deluxe?540:390),life=rand(deluxe?1.45:1.05,deluxe?2.25:1.65);state.particles.push({kind:'confetti',x:ball.x+sourceOffset+rand(-9,9),y:ball.y-6-rand(0,8),vx:Math.cos(a)*s,vy:Math.sin(a)*s,gravity:deluxe?470:520,rotation:rand(0,Math.PI*2),spin:rand(-13,13),w:rand(deluxe?4:3,deluxe?9:7),h:rand(deluxe?7:5,deluxe?14:11),life,max:life,color:colors[Math.floor(rand(0,colors.length))]});}
    if(deluxe){state.flashes.push({x:ball.x,y:ball.y-18,life:.75,max:.75,color:'#fff3a1',win:true});for(let i=0;i<16;i++)spark(ball.x+rand(-35,35),ball.y-rand(15,75),'#ffe96a');}
  }
  function resultBurst(ball){
    const color=ball.winOrLose==='win'?'#42ff82':'#aeb7c8';
    state.flashes.push({x:ball.x,y:ball.y,life:1,max:1,color,win:ball.winOrLose==='win'});
    for(let i=0;i<20;i++){const a=rand(0,Math.PI*2),s=rand(70,230);state.particles.push({x:ball.x,y:ball.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-(ball.winOrLose==='win'?55:10),life:rand(.28,.65),max:.65,color});}
    if(ball.winOrLose==='win'){
      const returnRatio=ball.actualCost>0?ball.displayAmount/ball.actualCost:0;
      ball.winEffectTier=returnRatio>=2?'deluxe':returnRatio>1?'confetti':'debris';canvas.dataset.lastWinEffect=ball.winEffectTier;
      if(ball.winEffectTier==='debris')debrisBurst(ball);else confettiBurst(ball,ball.winEffectTier==='deluxe');
    }
    if(state.particles.length>1200)state.particles.splice(0,state.particles.length-1200);
  }
  function colorBurst(ball,color){
    state.flashes.push({x:ball.x,y:ball.y,life:.34,max:.34,color,win:false,compact:true});
    for(let i=0;i<10;i++){const a=rand(0,Math.PI*2),s=rand(45,125);state.particles.push({x:ball.x,y:ball.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.18,.36),max:.36,color});}
  }
  function registerHit(b, inner=true){
    const maxHits=CONFIG.hitRange[b.difficulty][1];
    if(b.hitIndex>=CONFIG.antiStall.maxRecordedCollisions || b.hitCooldown>0)return;
    b.hitCooldown=.14;
    b.hitIndex++; b.effectiveCollisionCount=b.hitIndex;
    if(inner)b.innerCollisionCount++;
    const rewardedHits=Math.min(b.hitIndex,maxHits),rawCollisionMultiplier=multiplier(b.difficulty,rewardedHits);
    b.rawCollisionMultiplier=rawCollisionMultiplier;b.collisionMultiplier=rawCollisionMultiplier;b.displayAmount=b.baseBet*b.collisionMultiplier*b.extraMultiplier;b.flash=.13;
    const previousColor=b.color;
    if(b.mode!=='super'){
      for(const [n,c] of CONFIG.difficulties[b.difficulty].colorStops) if(b.innerCollisionCount>=n)b.color=c;
    }
    b.rewardPulse=.28;b.collisionPulse=.16;
    if(previousColor!==b.color){b.colorPulse=.34;colorBurst(b,b.color);}
    spark(b.x,b.y,'#ffd94a');
  }
  function updateBall(b,dt){
    b.spawnAge=(b.spawnAge||0)+dt;b.flash=Math.max(0,b.flash-dt);b.hitCooldown=Math.max(0,(b.hitCooldown||0)-dt);b.rewardPulse=Math.max(0,(b.rewardPulse||0)-dt);b.collisionPulse=Math.max(0,(b.collisionPulse||0)-dt);b.colorPulse=Math.max(0,(b.colorPulse||0)-dt);
    if(b.status==='spawning'){if(b.spawnAge>=CONFIG.spawnDuration){b.spawnAge=CONFIG.spawnDuration;b.status='inside';}return;}
    b.age+=dt;
    b.trail.push({x:b.x,y:b.y,life:.5});b.trail.forEach(p=>p.life-=dt);b.trail=b.trail.filter(p=>p.life>0);while(b.trail.length>42)b.trail.shift();
    if((b.status==='inside'||b.status==='falling')&&b.age>=CONFIG.antiStall.hardLimit){b.x=clamp(b.x,42,708);b.y=835;const boundary=34+682*winWidth(b.difficulty);b.winOrLose=b.x<boundary?'win':'lose';b.status='settle';b.settle=0;b.forcedSettle=true;spark(b.x,b.y,b.winOrLose==='win'?'#2cff74':'#9aa3b5');settleBall(b);return;}
    if(b.status==='inside'){
      const cx=375,cy=420,R=CONFIG.physics.ringRadius,limit=R-20-CONFIG.physics.ballRadius;
      b.vy+=CONFIG.physics.gravity*dt; b.x+=b.vx*dt; b.y+=b.vy*dt;
      const dx=b.x-cx,dy=b.y-cy,nd=Math.hypot(dx,dy)||1,nx=dx/nd,ny=dy/nd,gap=gapAngle(b.difficulty,b.mode),gapCenter=state.ringAngle-Math.PI/2,ballClearance=Math.asin(Math.min(.95,(CONFIG.physics.ballRadius+5)/R)),insideGap=Math.abs(angleDelta(Math.atan2(dy,dx),gapCenter))<gap/2-ballClearance;
      if(nd>limit){
        if(insideGap){
          if(nd>R+CONFIG.physics.ballRadius+8){b.status='falling';b.hasExited=true;b.vy=Math.max(b.vy,120);}
        }else{
          b.x=cx+nx*limit;b.y=cy+ny*limit;const surfaceVx=-CONFIG.physics.ringSpeed*(b.y-cy),surfaceVy=CONFIG.physics.ringSpeed*(b.x-cx),rvx=b.vx-surfaceVx,rvy=b.vy-surfaceVy,dot=rvx*nx+rvy*ny,restitution=innerRestitution(b.age);if(dot>0){b.vx=rvx-(1+restitution)*dot*nx+surfaceVx;b.vy=rvy-(1+restitution)*dot*ny+surfaceVy;}const speed=Math.hypot(b.vx,b.vy);if(speed>CONFIG.physics.maxSpeed){b.vx=b.vx/speed*CONFIG.physics.maxSpeed;b.vy=b.vy/speed*CONFIG.physics.maxSpeed;}registerHit(b,true);
        }
      }
    } else if(b.status==='falling'){
      b.vy+=CONFIG.physics.gravity*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
      if(b.hasExited){const cx=375,cy=420,R=CONFIG.physics.ringRadius,outerLimit=R+20+CONFIG.physics.ballRadius,dx=b.x-cx,dy=b.y-cy,dist=Math.hypot(dx,dy)||1,nx=dx/dist,ny=dy/dist,gap=gapAngle(b.difficulty,b.mode),gapCenter=state.ringAngle-Math.PI/2,ballClearance=Math.asin(Math.min(.95,(CONFIG.physics.ballRadius+5)/R)),insideGap=Math.abs(angleDelta(Math.atan2(dy,dx),gapCenter))<gap/2-ballClearance;if(dist<outerLimit&&!insideGap){b.x=cx+nx*outerLimit;b.y=cy+ny*outerLimit;const surfaceVx=-CONFIG.physics.ringSpeed*(b.y-cy),surfaceVy=CONFIG.physics.ringSpeed*(b.x-cx),rvx=b.vx-surfaceVx,rvy=b.vy-surfaceVy,dot=rvx*nx+rvy*ny;if(dot<0){b.vx=rvx-(1+CONFIG.physics.outerRestitution)*dot*nx+surfaceVx;b.vy=rvy-(1+CONFIG.physics.outerRestitution)*dot*ny+surfaceVy;spark(b.x,b.y);}}}
      if(b.x<42||b.x>708){b.x=clamp(b.x,42,708);b.vx*=-CONFIG.physics.wallRestitution;}
      const left=34,right=716,boundary=left+(right-left)*winWidth(b.difficulty);
      if(b.y>835){b.y=835;b.winOrLose=b.x<boundary?'win':'lose';b.status='settle';b.settle=0;spark(b.x,b.y,b.winOrLose==='win'?'#2cff74':'#9aa3b5');settleBall(b);}
    } else if(b.status==='settle') b.settle+=dt;
  }
  function settleBall(b){
    const boundary=34+682*winWidth(b.difficulty),landingZone=b.x<boundary?'win':'lose';
    canvas.dataset.lastResult=b.winOrLose;canvas.dataset.lastLandingZone=landingZone;canvas.dataset.lastReward=b.displayAmount.toFixed(2);canvas.dataset.lastBaseBet=b.baseBet.toFixed(2);canvas.dataset.lastActualCost=b.actualCost.toFixed(2);canvas.dataset.lastCollisionMultiplier=b.collisionMultiplier.toFixed(6);canvas.dataset.lastExtraMultiplier=b.extraMultiplier.toFixed(2);
    if(b.winOrLose==='win')state.balance+=b.displayAmount;
    state.history.unshift({mult:b.collisionMultiplier,extraMultiplier:b.mode==='super'?b.extraMultiplier:null,win:b.winOrLose==='win'});state.history.length=Math.min(5,state.history.length);
    resultBurst(b);showMessage(b.winOrLose==='win'?`WIN +${formatMoney(b.displayAmount)}`:'LOSE · 再試一次');updateUI();
  }
  function removeDone(){ const before=state.balls.length; state.balls=state.balls.filter(b=>!(b.status==='settle'&&b.settle>(b.winOrLose==='lose'?.46:1.05))); if(before!==state.balls.length)updateUI(); }

  function drawMetalPath(){
    const special=state.mode!=='normal',cx=375,cy=420,R=CONFIG.physics.ringRadius,gap=gapAngle(state.difficulty,state.mode),start=state.ringAngle-Math.PI/2+gap/2,end=state.ringAngle-Math.PI/2+Math.PI*2-gap/2;
    const deep=special?'#39106d':'#073c78';
    ctx.save();ctx.lineCap='round';ctx.shadowBlur=0;ctx.shadowColor='transparent';
    ctx.beginPath();ctx.arc(cx,cy,R,start,end);ctx.strokeStyle='#05091a';ctx.lineWidth=18;ctx.stroke();
    ctx.beginPath();ctx.arc(cx,cy,R,start,end);ctx.strokeStyle=deep;ctx.lineWidth=12;ctx.stroke();
    const g=ctx.createLinearGradient(cx-R,cy-R,cx+R,cy+R);g.addColorStop(0,special?'#e5bdff':'#d8fbff');g.addColorStop(.23,special?'#9d3cff':'#16bfff');g.addColorStop(.5,'#f3fbff');g.addColorStop(.72,special?'#6921c5':'#1454e6');g.addColorStop(1,special?'#efbfff':'#4cecff');ctx.strokeStyle=g;ctx.lineWidth=8;ctx.stroke();
    ctx.strokeStyle='#f4fdff';ctx.globalAlpha=.9;ctx.lineWidth=2;ctx.stroke();ctx.globalAlpha=1;
    ctx.restore();
    if(state.modeTransition){
      const p=clamp(state.modeTransition.age/state.modeTransition.duration,0,1),fxColor=state.modeTransition.to==='normal'?'#5eeaff':'#c95cff';
      ctx.save();ctx.lineCap='round';ctx.shadowColor=fxColor;ctx.shadowBlur=18;
      for(let i=0;i<3;i++){const wave=clamp(p*1.45-i*.2,0,1);if(wave<=0||wave>=1)continue;ctx.globalAlpha=Math.sin(wave*Math.PI)*(.42-i*.07);ctx.strokeStyle=fxColor;ctx.lineWidth=5-2.5*wave;ctx.beginPath();ctx.arc(cx,cy,R+10+wave*58,0,Math.PI*2);ctx.stroke();}
      ctx.globalAlpha=Math.sin(Math.min(1,p)*Math.PI)*.7;ctx.strokeStyle='#f7f2ff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(cx,cy,R,start,end);ctx.stroke();ctx.restore();
    }
    if(state.ringFlash>0){const a=clamp(state.ringFlash/.3,0,1);ctx.save();ctx.globalAlpha=a*.78;ctx.strokeStyle=state.mode==='normal'?'#c8f8ff':'#f0d4ff';ctx.lineWidth=7;ctx.shadowBlur=24;ctx.shadowColor=state.mode==='normal'?'#36dfff':'#bd5cff';ctx.beginPath();ctx.arc(cx,cy,R,start,end);ctx.stroke();ctx.restore();}
  }
  function drawField(){
    ctx.clearRect(0,0,750,1020);
    const bg=ctx.createRadialGradient(375,390,0,375,430,520);bg.addColorStop(0,'#0d2947');bg.addColorStop(.48,'#07132c');bg.addColorStop(1,'#020511');ctx.fillStyle=bg;ctx.fillRect(0,0,750,1020);
    ctx.save();ctx.globalAlpha=.1;ctx.strokeStyle='#36cfff';ctx.lineWidth=1;const r=15;for(let y=90;y<720;y+=27){for(let x=95+(Math.floor(y/27)%2)*24;x<670;x+=48){ctx.beginPath();for(let k=0;k<6;k++){const a=Math.PI/3*k,xp=x+Math.cos(a)*r,yp=y+Math.sin(a)*r;k?ctx.lineTo(xp,yp):ctx.moveTo(xp,yp);}ctx.closePath();ctx.stroke();}}ctx.restore();
    const side=ctx.createLinearGradient(0,0,95,0);side.addColorStop(0,'#12195b');side.addColorStop(1,'#07112600');ctx.fillStyle=side;ctx.beginPath();ctx.moveTo(0,55);ctx.lineTo(78,105);ctx.lineTo(58,760);ctx.lineTo(0,820);ctx.closePath();ctx.fill();ctx.save();ctx.translate(750,0);ctx.scale(-1,1);ctx.fillStyle=side;ctx.beginPath();ctx.moveTo(0,55);ctx.lineTo(78,105);ctx.lineTo(58,760);ctx.lineTo(0,820);ctx.closePath();ctx.fill();ctx.restore();
    ctx.save();ctx.strokeStyle='#1d9cff';ctx.shadowBlur=16;ctx.shadowColor='#25d8ff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(25,120);ctx.lineTo(52,175);ctx.lineTo(42,650);ctx.lineTo(18,715);ctx.stroke();ctx.strokeStyle='#9d36ff';ctx.shadowColor='#a93cff';ctx.beginPath();ctx.moveTo(725,120);ctx.lineTo(698,175);ctx.lineTo(708,650);ctx.lineTo(732,715);ctx.stroke();ctx.restore();
    ctx.strokeStyle='#284987';ctx.globalAlpha=.65;ctx.setLineDash([13,18]);ctx.lineWidth=2;ctx.strokeRect(18,20,714,850);ctx.setLineDash([]);ctx.globalAlpha=1;
    drawMetalPath();
    ctx.fillStyle='#5b54ff';ctx.font='700 22px sans-serif';ctx.textAlign='center';ctx.shadowBlur=10;ctx.shadowColor='#7a42ff';ctx.fillText('▼',375,725);ctx.globalAlpha=.62;ctx.fillText('▼',375,752);ctx.globalAlpha=.3;ctx.fillText('▼',375,779);ctx.globalAlpha=1;ctx.shadowBlur=0;
    const left=34,right=716,y=850,h=70,boundary=left+(right-left)*winWidth(state.difficulty);
    let wg=ctx.createLinearGradient(0,y,0,y+h);wg.addColorStop(0,'#0a452d');wg.addColorStop(1,'#031b19');ctx.fillStyle=wg;roundRect(left,y,boundary-left-5,h,8);ctx.fill();ctx.strokeStyle='#2cff74';ctx.shadowBlur=15;ctx.shadowColor='#2cff74';ctx.lineWidth=5;ctx.stroke();
    let lg=ctx.createLinearGradient(0,y,0,y+h);lg.addColorStop(0,'#303746');lg.addColorStop(1,'#151a24');ctx.fillStyle=lg;roundRect(boundary+5,y,right-boundary-5,h,8);ctx.fill();ctx.strokeStyle='#8993a7';ctx.shadowColor='#aeb7c8';ctx.stroke();
    ctx.font='italic 900 27px Georgia';ctx.fillStyle='#baffc8';ctx.shadowColor='#2cff74';ctx.fillText('WIN',left+(boundary-left)/2,y+45);ctx.fillStyle='#e0e4eb';ctx.shadowColor='#8f99ac';ctx.fillText('LOSE',boundary+(right-boundary)/2,y+45);ctx.shadowBlur=0;
    ctx.fillStyle='#101b3a';ctx.fillRect(0,948,750,72);ctx.strokeStyle='#3454a2';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,949);ctx.lineTo(285,949);ctx.lineTo(330,986);ctx.lineTo(420,986);ctx.lineTo(465,949);ctx.lineTo(750,949);ctx.stroke();
  }
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):(ctx.rect(x,y,w,h));}
  function drawBall(b){
    const loseFade=b.status==='settle'&&b.winOrLose==='lose'?clamp(1-b.settle/.42,0,1):1,spawnProgress=clamp((b.spawnAge||0)/CONFIG.spawnDuration,0,1),spawnEase=spawnProgress*spawnProgress*(3-2*spawnProgress),spawnScale=.12+.88*spawnEase;ctx.save();ctx.globalAlpha=loseFade*(.18+.82*spawnEase);
    ctx.save();ctx.lineCap='round';for(let i=1;i<b.trail.length;i++){const p0=b.trail[i-1],p1=b.trail[i],t=i/Math.max(1,b.trail.length-1),a=clamp(p1.life/.5,0,1)*t;ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.strokeStyle=hexAlpha(b.color,a*.28);ctx.lineWidth=1+7*t;ctx.shadowBlur=5;ctx.shadowColor=b.color;ctx.stroke();}ctx.restore();
    const ballPulse=(1+(b.colorPulse?Math.sin((1-b.colorPulse/.34)*Math.PI)*.24:0)+(b.collisionPulse?Math.sin((1-b.collisionPulse/.16)*Math.PI)*.1:0))*spawnScale;
    ctx.save();ctx.translate(b.x,b.y);ctx.shadowBlur=b.flash?28:12;ctx.shadowColor=b.color;const radius=CONFIG.physics.ballRadius*ballPulse,g=ctx.createRadialGradient(-7,-8,2,0,0,radius+1);g.addColorStop(0,'#fff');g.addColorStop(.25,b.color);g.addColorStop(1,'#16091d');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#eafdff';ctx.globalAlpha=.82;ctx.lineWidth=2;ctx.stroke();if(b.colorPulse){ctx.globalAlpha=clamp(b.colorPulse/.34,0,1)*.7;ctx.strokeStyle=b.color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,radius+9*(1-b.colorPulse/.34),0,Math.PI*2);ctx.stroke();}ctx.restore();
    const settling=b.status==='settle',isLose=settling&&b.winOrLose==='lose',progress=settling?clamp(b.settle/(isLose?.46:1.05),0,1):0,rewardKick=b.rewardPulse?1+.38*Math.sin((1-b.rewardPulse/.28)*Math.PI):1,pop=settling?(isLose?1+.08*Math.sin(Math.min(1,progress*2)*Math.PI):1+.24*Math.sin(Math.min(1,progress*2.2)*Math.PI)):rewardKick,fontSize=settling?Math.round((isLose?33:37)*pop):Math.round(30*pop),label=settling&&!isLose?'+'+formatMoney(b.displayAmount):formatMoney(b.displayAmount),labelY=b.y-(settling?(isLose?28:34+progress*24):28),showReward=b.hitIndex>0,isSuper=b.mode==='super';
    ctx.save();ctx.textAlign='center';ctx.font=`900 ${fontSize}px "Microsoft JhengHei"`;const rewardWidth=showReward?ctx.measureText(label).width:0,badgeW=42,badgeH=24,badgeGap=5,groupWidth=(isSuper?badgeW:0)+(isSuper&&showReward?badgeGap:0)+rewardWidth,groupLeft=clamp(b.x-groupWidth/2,10,740-groupWidth),labelAlpha=settling?(isLose?loseFade:clamp(1-(progress-.68)/.32,0,1)):1;ctx.globalAlpha*=labelAlpha;
    if(showReward){const labelX=isSuper?groupLeft+badgeW+badgeGap+rewardWidth/2:groupLeft+rewardWidth/2;ctx.lineWidth=settling?8:6;ctx.strokeStyle='#07101d';ctx.strokeText(label,labelX,labelY);ctx.fillStyle=settling?(isLose?'#b8c0cf':'#6dff9a'):'#ffd900';ctx.shadowBlur=settling?12:0;ctx.shadowColor=settling?(isLose?'#8f99aa':'#2cff74'):'transparent';ctx.fillText(label,labelX,labelY);}
    if(isSuper){const badgeX=groupLeft,badgeY=labelY-badgeH+1,badgeColor=b.color;ctx.shadowBlur=10;ctx.shadowColor=badgeColor;ctx.fillStyle=badgeColor;roundRect(badgeX,badgeY,badgeW,badgeH,6);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#16051e';ctx.font='1000 18px "Arial Black","Microsoft JhengHei",sans-serif';ctx.fillText('×'+b.extraMultiplier,badgeX+badgeW/2,badgeY+19);}ctx.restore();ctx.restore();
  }
  function hexAlpha(hex,a){ const h=hex.replace('#',''); const n=parseInt(h.length===3?h.split('').map(x=>x+x).join(''):h,16); return `rgba(${n>>16},${n>>8&255},${n&255},${a})`; }
  function updateParticles(dt){for(const p of state.particles){p.life-=dt;if(p.kind==='confetti'||p.kind==='debris'){p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;const drag=Math.pow(p.kind==='confetti'?.988:.975,dt*60);p.vx*=drag;p.vy*=Math.pow(.996,dt*60);p.rotation+=p.spin*dt;}else{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.96;p.vy*=.96;}}state.particles=state.particles.filter(p=>p.life>0);for(const f of state.flashes)f.life-=dt;state.flashes=state.flashes.filter(f=>f.life>0);}
  function drawFlashes(){for(const f of state.flashes){const p=1-f.life/f.max,alpha=(1-p)*.72,maxRadius=f.compact?38:72;ctx.save();ctx.globalAlpha=alpha;const glow=ctx.createRadialGradient(f.x,f.y,2,f.x,f.y,maxRadius);glow.addColorStop(0,hexAlpha(f.color,.5));glow.addColorStop(.42,hexAlpha(f.color,.14));glow.addColorStop(1,hexAlpha(f.color,0));ctx.fillStyle=glow;ctx.beginPath();ctx.arc(f.x,f.y,maxRadius,0,Math.PI*2);ctx.fill();if(f.win||f.compact){ctx.strokeStyle=f.color;ctx.lineWidth=f.compact?2.5:3;ctx.shadowBlur=8;ctx.shadowColor=f.color;ctx.beginPath();ctx.arc(f.x,f.y,(f.compact?8:16)+(f.compact?25:48)*p,0,Math.PI*2);ctx.stroke();}if(f.win&&!f.compact){ctx.globalAlpha=alpha*.18;ctx.fillStyle=glow;ctx.fillRect(f.x-24,f.y-125,48,125);}ctx.restore();}}
  function drawParticles(){for(const p of state.particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);if(p.kind==='confetti'||p.kind==='debris'){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation);ctx.fillStyle=p.color;ctx.shadowBlur=p.kind==='confetti'?3:1;ctx.shadowColor=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();}else{ctx.strokeStyle=p.color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.035,p.y-p.vy*.035);ctx.stroke();}}ctx.globalAlpha=1;}
  function loop(now){ const dt=Math.min((now-lastTime)/1000,CONFIG.physics.fixedTimestep);lastTime=now;state.ringAngle=(state.ringAngle+dt*CONFIG.physics.ringSpeed)%(Math.PI*2);state.ringFlash=Math.max(0,state.ringFlash-dt);if(state.modeTransition){state.modeTransition.age+=dt;if(state.modeTransition.age>=state.modeTransition.duration){state.modeTransition=null;state.ringFlash=.3;state.locked=false;updateUI();}}spawnQueued(now);for(const b of state.balls){let remaining=dt;while(remaining>0){const step=Math.min(remaining,CONFIG.physics.fixedTimestep/4);updateBall(b,step);remaining-=step;}}removeDone();updateParticles(dt);drawField();drawFlashes();drawParticles();for(const b of state.balls)drawBall(b);handleAuto(now);requestAnimationFrame(loop); }

  function setMode(mode){
    if(activeSlots()>0||state.auto||state.locked){showMessage('等待場上小球全部結算後再切換');return;}
    const nextMode=state.mode===mode?'normal':mode,previousMode=state.mode;ui.modes.classList.remove('open');ui.modes.setAttribute('aria-hidden','true');state.mode=nextMode;state.modeTransition={from:previousMode,to:nextMode,age:0,duration:.62};state.locked=true;updateUI();
  }
  function stopAuto(){state.auto=null;updateUI();}
  function handleAuto(now){
    if(!state.auto||now-state.auto.last<520)return;
    const need=state.mode==='ten'?10:1;if(activeSlots()+need>CONFIG.maxBalls)return;
    if(state.balance<currentCost()){showMessage('餘額不足，自動下注結束');stopAuto();return;}
    if(placeBet(true)){state.auto.last=now;if(!state.auto.infinite){state.auto.left--;if(state.auto.left<=0)stopAuto();else updateUI();}}
  }

  ui.bet.addEventListener('click',()=>placeBet());
  ui.input.addEventListener('input',()=>{state.baseBet=Math.max(1,(Number(ui.input.value)||1)/CONFIG.modeCost[state.mode]);updateUI();});ui.difficulty.addEventListener('change',()=>{state.difficulty=ui.difficulty.value;ui.difficultyTrigger.querySelector('span').textContent=CONFIG.difficulties[state.difficulty].label;ui.difficultyMenu.querySelectorAll('button').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.value===state.difficulty)));updateUI();});
  ui.difficultyTrigger.addEventListener('click',()=>{if(ui.difficultyTrigger.disabled)return;const open=ui.difficultyPicker.classList.toggle('open');ui.difficultyTrigger.setAttribute('aria-expanded',String(open));});
  ui.difficultyMenu.addEventListener('click',event=>{const option=event.target.closest('button[data-value]');if(!option)return;ui.difficulty.value=option.dataset.value;ui.difficulty.dispatchEvent(new Event('change'));ui.difficultyPicker.classList.remove('open');ui.difficultyTrigger.setAttribute('aria-expanded','false');});
  document.addEventListener('click',event=>{if(!ui.difficultyPicker.contains(event.target)){ui.difficultyPicker.classList.remove('open');ui.difficultyTrigger.setAttribute('aria-expanded','false');}});
  $('#quickBets').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||state.auto)return;state.baseBet=Number(b.dataset.value);[...$('#quickBets').children].forEach(x=>x.classList.toggle('active',x===b));updateUI();});
  ui.bonus.addEventListener('click',()=>{if(state.locked||ui.bonus.classList.contains('switching-off'))return;if(state.mode!=='normal'){if(activeSlots()>0||state.auto)return;const activeMode=state.mode;ui.bonus.classList.add('switching-off');ui.bonus.disabled=true;setTimeout(()=>{ui.bonus.classList.remove('switching-off');ui.bonus.disabled=false;setMode(activeMode);},180);return;}if(activeSlots()>0||state.auto){showMessage('場上有小球時不可切換模式');return;}ui.modes.classList.toggle('open');ui.modes.setAttribute('aria-hidden',String(!ui.modes.classList.contains('open')));});
  ui.closeModes.addEventListener('click',()=>ui.modes.classList.remove('open'));document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  ui.auto.addEventListener('click',()=>{if(state.auto){showMessage('自動下注已結束');stopAuto();return;}ui.modal.classList.add('open');ui.modal.setAttribute('aria-hidden','false');});
  ui.closeAuto.addEventListener('click',()=>ui.modal.classList.remove('open'));
  $('#autoOptions').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;document.querySelectorAll('.auto-options button').forEach(x=>x.classList.toggle('selected',x===b));state.selectedAuto=b.dataset.count;ui.confirmAuto.disabled=false;});
  ui.confirmAuto.addEventListener('click',()=>{const inf=state.selectedAuto==='Infinity';state.auto={left:inf?Infinity:Number(state.selectedAuto),infinite:inf,last:0};ui.modal.classList.remove('open');updateUI();showMessage('自動下注開始');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lastTime=performance.now();});
  updateUI();requestAnimationFrame(loop);
})();
