/* Precision Shot — local H5 prototype. No external libraries or requests. */
(() => {
  'use strict';
  const LEVELS = {easy:[0.5,2,5,10], medium:[0.2,3,10,50], hard:[0,10,100,1000]};
  const ZONES = ['外圈','中圈','內圈','靶心'];
  const COLORS = ['#aab798','#8cc8b6','#f0d780','#eeb278'];
  const LUCKY_HIT = {chance:.1,multiplier:2};
  const REWARD_DISPLAY_MS = {normal:800,lucky:1100};
  const $ = id => document.getElementById(id);
  const money = n => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const compactNumber = n => n.toLocaleString('en-US',{maximumFractionDigits:2});
  const state = {level:'easy', bullets:1, balance:10000, running:false, settling:false, fired:0, reward:0, round:1, hits:[], hitRewards:[], luckyHits:0, luckyWeaponUntil:0, luckyBannerStartedAt:0, luckyBannerUntil:0, aimLucky:false, aim:{x:0,y:0}, flash:0, sound:false};
  const canvas = $('range'), ctx = canvas.getContext('2d');
  let width=800, height=620, audioContext, previousTime=0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function bet(){return Number($('bet').value);}
  function validBet(){return $('bet').value.trim()!=='' && Number.isInteger(bet()) && bet()>=1 && bet()<=1000;}
  function select(group, attr, value){document.querySelectorAll(`#${group} button`).forEach(b=>{const on=b.dataset[attr]===String(value);b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});}
  function update(){
    $('weapon-layer').classList.toggle('raised',state.running);
    document.querySelectorAll('[data-bet]').forEach(button=>{
      const selected=validBet() && Number(button.dataset.bet)===bet();
      button.classList.toggle('selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    const total=bet()*state.bullets;
    $('balance').textContent=money(state.balance);
    $('total-bet').textContent=validBet()?money(total):'—';
    $('round-reward').textContent=money(state.reward);
    $('round-number').textContent=`ROUND ${String(state.round).padStart(2,'0')}`;
    $('ammo-count').textContent=`${String(state.bullets-state.fired).padStart(2,'0')} / ${String(state.bullets).padStart(2,'0')}`;
    $('ammo-icons').innerHTML=Array.from({length:state.bullets},(_,i)=>`<span class="cartridge ${i<state.fired?'spent':''}"></span>`).join('');
    $('multipliers').innerHTML=LEVELS[state.level].map((m,i)=>`<div class="multiplier-item" style="--zone-color:${COLORS[i]}"><strong>${m}×</strong><span>${ZONES[i]}</span></div>`).join('');
    document.querySelectorAll('fieldset button, fieldset input, #reset').forEach(el=>el.disabled=state.running||state.settling);
    $('start').disabled=state.running || state.settling || !validBet() || total>state.balance;
    $('start').firstElementChild.textContent=state.running?`射擊中 ${state.fired} / ${state.bullets}`:'投注';
    $('difficulty-toggle').firstElementChild.textContent={easy:'簡單',medium:'中等',hard:'困難'}[state.level];
    $('bullets-toggle').firstElementChild.textContent=String(state.bullets);
    $('hint').classList.toggle('error',!state.running && (!validBet() || total>state.balance));
    $('hint').textContent=state.running?'正在完成本局射擊，設定暫時鎖定。':!validBet()?'請輸入 1～1,000 的整數投注。':total>state.balance?'點數不足，請降低投注或重設模擬點數。':'扣除總投注後，自動完成本局射擊。';
  }
  function closePickers(){for(const id of ['difficulty','bullets']){$(id).hidden=true;$(id+'-toggle').setAttribute('aria-expanded','false');}}
  for(const id of ['difficulty','bullets']){
    $(id+'-toggle').onclick=()=>{if(state.running)return;const open=$(id).hidden;closePickers();$(id).hidden=!open;$(id+'-toggle').setAttribute('aria-expanded',String(open));};
    $(id+'-toggle').onkeydown=e=>{if((e.key==='ArrowUp'||e.key==='ArrowDown')&&!state.running){e.preventDefault();closePickers();$(id).hidden=false;$(id+'-toggle').setAttribute('aria-expanded','true');$(id).querySelector('button.selected').focus();}};
    $(id).onkeydown=e=>{const items=[...$(id).querySelectorAll('button')],i=items.indexOf(document.activeElement);if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();items[(i+(e.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();}if(e.key==='Escape'){closePickers();$(id+'-toggle').focus();}};
  }
  document.addEventListener('click',e=>{if(!e.target.closest('.picker'))closePickers();});
  document.addEventListener('focusin',e=>{if(!e.target.closest('.picker'))closePickers();});
  document.querySelectorAll('#difficulty button').forEach(b=>b.onclick=()=>{if(state.running)return;state.level=b.dataset.level;select('difficulty','level',state.level);state.hits=[];state.hitRewards=[];closePickers();$('difficulty-toggle').focus();update();});
  document.querySelectorAll('#bullets button').forEach(b=>b.onclick=()=>{if(state.running)return;state.bullets=Number(b.dataset.count);state.fired=0;select('bullets','count',state.bullets);closePickers();$('bullets-toggle').focus();update();});
  document.querySelectorAll('[data-bet]').forEach(b=>b.onclick=()=>{if(state.running)return;$('bet').value=b.dataset.bet;update();});
  $('bet').oninput=update;
  function scaleBet(factor){if(state.running)return;$('bet').value=String(Math.max(1,Math.min(1000,Math.floor((validBet()?bet():10)*factor))));update();}
  $('bet-minus').onclick=()=>scaleBet(.5);$('bet-plus').onclick=()=>scaleBet(2);
  $('rules-open').onclick=()=>$('rules').showModal();
  $('reward-dialog').addEventListener('cancel',event=>event.preventDefault());
  $('rules-close').onclick=$('rules-done').onclick=()=>$('rules').close();
  $('rules').onclick=e=>{if(e.target===$('rules')){const r=$('rules').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('rules').close();}};
  $('reset').onclick=()=>{if(state.running||state.settling)return;state.balance=10000;state.reward=0;state.fired=0;state.hits=[];state.hitRewards=[];state.luckyHits=0;state.luckyWeaponUntil=0;state.luckyBannerStartedAt=0;state.luckyBannerUntil=0;state.aimLucky=false;state.round=1;$('shot-log').innerHTML='<div class="empty-log"><span>⌖</span><p>模擬點數已重設。<small>選擇設定，開始新回合。</small></p></div>';$('summary').textContent='等待開始新回合';$('range-status').textContent='靶場就緒';feedback('鎖定目標','READY TO FIRE',false);update();};
  function prepareSound(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){audioContext ||= new Audio();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});}}catch{state.sound=false;}}
  $('sound').onclick=()=>{state.sound=!state.sound;if(state.sound)prepareSound();$('sound').textContent=`音效：${state.sound?'開':'關'}`;$('sound').setAttribute('aria-pressed',String(state.sound));};
  function playShot(){if(!state.sound||!audioContext)return;try{const length=audioContext.sampleRate*.13,buffer=audioContext.createBuffer(1,length,audioContext.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/(length*.16));const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;gain.gain.value=.18;source.connect(gain).connect(audioContext.destination);source.start();}catch{/* Audio is optional. */}}
  function random(){if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296;}return Math.random();}
  function chooseZone(r){return r<.65?0:r<.9?1:r<.99?2:3;}
  function pointFor(zone){const angle=random()*Math.PI*2;const bands=[[.78,.94],[.55,.71],[.32,.48],[.03,.24]];const [lo,hi]=bands[zone],r=Math.sqrt(lo*lo+random()*(hi*hi-lo*lo));return{x:Math.cos(angle)*r*68,y:Math.sin(angle)*r*94};}
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function feedback(label,value,hit=true){$('shot-feedback').classList.toggle('hit',hit);$('shot-feedback').firstElementChild.textContent=label;$('shot-feedback').lastElementChild.textContent=value;}
  async function fireRound(){
    if(state.running||state.settling||$('reward-dialog').open||!validBet()||bet()*state.bullets>state.balance)return;
    const stake=bet(), count=state.bullets, multipliers=[...LEVELS[state.level]], cost=stake*count;
    closePickers();state.running=true;state.balance=Math.round((state.balance-cost)*100)/100;state.reward=0;state.fired=0;state.hits=[];state.hitRewards=[];state.luckyHits=0;state.luckyWeaponUntil=0;state.luckyBannerStartedAt=0;state.luckyBannerUntil=0;state.aimLucky=false;
    $('shot-log').innerHTML='';$('summary').textContent=`本局投注 ${money(cost)} · 正在射擊`;$('range-status').textContent='射擊進行中';feedback('正在舉槍','ACQUIRING TARGET',false);if(state.sound)prepareSound();update();
    for(let i=0;i<count;i++){
      const zone=chooseZone(random()),point=pointFor(zone),isLuckyHit=random()<LUCKY_HIT.chance,start={...state.aim};
      state.aimLucky=isLuckyHit;
      const aimStart=performance.now(), aimDuration=isLuckyHit?(i===0?800:420):(i===0?450:100);
      while(performance.now()-aimStart<aimDuration){const t=Math.min(1,(performance.now()-aimStart)/aimDuration),ease=t*t*(3-2*t);state.aim={x:start.x+(point.x-start.x)*ease,y:start.y+(point.y-start.y)*ease};await wait(16);}
      const impactAt=performance.now(),baseMultiplier=multipliers[zone],finalMultiplier=baseMultiplier*(isLuckyHit?LUCKY_HIT.multiplier:1);
      state.aim=point;state.flash=1;state.hits.push({...point,zone,impactAt,isLuckyHit,baseMultiplier,finalMultiplier});state.fired++;playShot();
      if(isLuckyHit){state.luckyHits++;state.luckyWeaponUntil=impactAt+350;state.luckyBannerStartedAt=impactAt;state.luckyBannerUntil=impactAt+900;}
      const payout=Math.round(stake*finalMultiplier*100)/100;state.reward=Math.round((state.reward+payout)*100)/100;
      state.hitRewards.push({x:point.x,y:point.y,amount:payout,createdAt:impactAt,expiresAt:impactAt+(isLuckyHit?REWARD_DISPLAY_MS.lucky:REWARD_DISPLAY_MS.normal),isLuckyHit,baseMultiplier,finalMultiplier});
      feedback(isLuckyHit?`LUCKY HIT · ${baseMultiplier}× ×2`:`命中${ZONES[zone]} · ${baseMultiplier}×`,`${finalMultiplier}× · + ${money(payout)}`);
      const card=document.createElement('div');card.className=`shot-card${isLuckyHit?' lucky':''}`;card.style.setProperty('--zone-color',isLuckyHit?'#f4c54f':COLORS[zone]);card.innerHTML=`<small><span>SHOT ${String(i+1).padStart(2,'0')}</span><span>${isLuckyHit?'LUCKY ×2':ZONES[zone]}</span></small><strong>${finalMultiplier}×</strong><span>+ ${money(payout)}</span>`;$('shot-log').append(card);$('shot-log').scrollLeft=$('shot-log').scrollWidth;update();if(i<count-1)await wait(400);
    }
    state.running=false;state.settling=true;state.aimLucky=false;state.round++;state.balance=Math.round((state.balance+state.reward)*100)/100;const net=Math.round((state.reward-cost)*100)/100;
    $('range-status').textContent='本局完成';feedback('本局總獎勵',money(state.reward));$('summary').textContent=`${count} 發射擊完成 · Lucky Hit ${state.luckyHits} 次 · 總投注 ${money(cost)} · 總獎勵 ${money(state.reward)} · 淨${net>=0?'獲得':'損失'} ${money(Math.abs(net))}`;update();
    $('reward-amount').textContent=money(state.reward);
    await wait(state.hits[state.hits.length-1]?.isLuckyHit?REWARD_DISPLAY_MS.lucky:REWARD_DISPLAY_MS.normal);
    const rewardDialog=$('reward-dialog');
    rewardDialog.showModal();
    void rewardDialog.offsetWidth;
    rewardDialog.classList.add('is-visible');
    await wait(1000);
    rewardDialog.classList.remove('is-visible');
    rewardDialog.classList.add('is-closing');
    await wait(240);
    rewardDialog.close();
    rewardDialog.classList.remove('is-closing');
    state.settling=false;
    update();
  }
  $('start').onclick=fireRound;

  function resize(){const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);width=rect.width;height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
  new ResizeObserver(resize).observe(canvas);
  function line(x1,y1,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function ellipse(x,y,rx,ry,fill,stroke){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function label(text,x,y,color,size=16){ctx.font=`600 ${size}px "Segoe UI",sans-serif`;ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,x,y);}
  function drawImpactSparks(hit,now){
    if(!hit)return;
    const counts=[0,6,11,18],lengths=[0,9,18,29];
    const progress=Math.min(1,(now-hit.impactAt)/500);
    if(progress>=1)return;
    const fade=(1-progress)*(1-progress),count=counts[hit.zone],travel=5+progress*(hit.zone===3?17:10);
    ctx.save();ctx.globalAlpha=fade;ctx.lineCap='round';ctx.shadowColor=hit.zone===3?'#ffb02e':'#ffe08a';ctx.shadowBlur=hit.zone===3?12:6;
    ellipse(hit.x,hit.y,6+progress*25,6+progress*25,null,'#ffffc6');
    if(hit.zone===0||reducedMotion){ctx.restore();return;}
    if(hit.zone===3){
      const glow=ctx.createRadialGradient(hit.x,hit.y,0,hit.x,hit.y,20+progress*12);
      glow.addColorStop(0,'#fffbd4');glow.addColorStop(.2,'#ffbd38dd');glow.addColorStop(1,'#f06a0000');
      ellipse(hit.x,hit.y,20+progress*12,20+progress*12,glow);
      ctx.lineWidth=2.4;ctx.strokeStyle='#ffd36a';ctx.beginPath();ctx.arc(hit.x,hit.y,8+progress*30,0,Math.PI*2);ctx.stroke();
    }
    for(let i=0;i<count;i++){
      const angle=Math.PI*2*i/count+Math.sin(i*9.7+hit.x*.13+hit.y*.07)*.18;
      const inner=travel+(i%3)*1.5,outer=inner+lengths[hit.zone]*(.72+(i%4)*.1);
      const x1=hit.x+Math.cos(angle)*inner,y1=hit.y+Math.sin(angle)*inner;
      const x2=hit.x+Math.cos(angle)*outer,y2=hit.y+Math.sin(angle)*outer;
      line(x1,y1,x2,y2,i%3===0?'#fff7bd':'#f2a63b',hit.zone===1?1:hit.zone===2?1.7:2.2);
      if(hit.zone>=2)ellipse(x2,y2,hit.zone===3?2.2:1.4,hit.zone===3?2.2:1.4,'#ffe9a0');
    }
    ctx.restore();
  }
  function drawLuckyImpact(hit,now){
    if(!hit?.isLuckyHit)return;
    const duration=hit.zone===3?780:650,progress=Math.min(1,(now-hit.impactAt)/duration);
    if(progress>=1)return;
    const fade=(1-progress)*(1-progress),radius=8+progress*(hit.zone===3?45:34),count=hit.zone===3?18:11;
    ctx.save();ctx.globalAlpha=fade;ctx.lineCap='round';ctx.shadowColor='#ffbd35';ctx.shadowBlur=hit.zone===3?18:12;
    const glow=ctx.createRadialGradient(hit.x,hit.y,0,hit.x,hit.y,18+progress*16);
    glow.addColorStop(0,'#fffbd8');glow.addColorStop(.2,'#ffd35cee');glow.addColorStop(1,'#d9820000');
    ellipse(hit.x,hit.y,18+progress*16,18+progress*16,glow);
    ctx.strokeStyle='#ffd65c';ctx.lineWidth=hit.zone===3?3:2;ctx.beginPath();ctx.arc(hit.x,hit.y,radius,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<count;i++){
      const angle=Math.PI*2*i/count+Math.sin(i*8.3+hit.x*.09)*.2,distance=10+progress*(hit.zone===3?42:30)+(i%3)*3;
      const px=hit.x+Math.cos(angle)*distance,py=hit.y+Math.sin(angle)*distance;
      ellipse(px,py,hit.zone===3?2.3:1.7,hit.zone===3?2.3:1.7,i%3===0?'#fff4af':'#efad32');
    }
    ctx.restore();
  }
  function drawLuckyBanner(now){
    if(now>=state.luckyBannerUntil)return;
    const age=now-state.luckyBannerStartedAt,remaining=state.luckyBannerUntil-now;
    const enter=Math.min(1,Math.max(0,age)/130),exit=Math.min(1,remaining/180),alpha=Math.min(enter,exit);
    const pop=1.12-.12*(1-Math.pow(1-enter,3));
    ctx.save();ctx.translate(width/2,height*.42);ctx.scale(pop,pop);ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.lineJoin='round';ctx.shadowColor='#f0a51d';ctx.shadowBlur=16;
    const gold=ctx.createLinearGradient(0,-38,0,25);gold.addColorStop(0,'#fff7b4');gold.addColorStop(.45,'#ffd04f');gold.addColorStop(1,'#d99016');
    ctx.strokeStyle='#3b2608';ctx.lineWidth=5;ctx.font='900 24px "Segoe UI",sans-serif';ctx.strokeText('LUCKY HIT',0,-8);ctx.fillStyle=gold;ctx.fillText('LUCKY HIT',0,-8);
    ctx.lineWidth=6;ctx.font='900 38px "Segoe UI",sans-serif';ctx.strokeText(`×${LUCKY_HIT.multiplier}`,0,29);ctx.fillText(`×${LUCKY_HIT.multiplier}`,0,29);
    ctx.restore();
  }
  function draw(now){
    const delta=Math.min((now-previousTime)/1000,.05);previousTime=now;state.flash=Math.max(0,state.flash-delta*12);
    ctx.clearRect(0,0,width,height);const cx=width/2;
    const scale=Math.min(width/310,(height*.53-55)/309,1.35),targetY=55+175*scale;
    ctx.save();ctx.translate(cx,targetY);ctx.scale(scale,scale);
    if(!reducedMotion&&state.flash>0)ctx.translate(Math.sin(now*.06)*state.flash*2,0);
    const body=new Path2D('M -24 -141 Q -27 -175 0 -175 Q 27 -175 24 -141 L 27 -141 L 26 -127 L 22 -127 L 17 -109 Q 30 -99 58 -89 Q 72 -84 76 -61 Q 93 29 77 71 L 67 116 Q 80 133 65 134 L -65 134 Q -80 133 -67 116 L -77 71 Q -93 29 -76 -61 Q -72 -84 -58 -89 Q -30 -99 -17 -109 L -22 -127 L -26 -127 L -27 -141 Z');
    // A weathered timber stake anchors the target to the ground.
    const post=ctx.createLinearGradient(-9,0,10,0);post.addColorStop(0,'#4a3422');post.addColorStop(.35,'#8a6844');post.addColorStop(.7,'#6c4b2f');post.addColorStop(1,'#38271b');
    ctx.shadowColor='#17120d99';ctx.shadowBlur=9;ctx.fillStyle=post;ctx.fillRect(-9,112,18,175);ctx.shadowBlur=0;
    ctx.strokeStyle='#2d2118';ctx.lineWidth=1.5;ctx.strokeRect(-9,112,18,175);
    line(-4,139,-3,272,'#b08a5a88',1);line(4,150,3,250,'#30211699',1);line(-7,211,7,207,'#c19a6766',1);
    // Muted paper and worn pigment match the sun-faded outdoor range.
    const targetFill=ctx.createLinearGradient(-70,-170,78,134);targetFill.addColorStop(0,'#4b453a');targetFill.addColorStop(.52,'#292b28');targetFill.addColorStop(1,'#51483b');
    ctx.shadowColor='#18140f99';ctx.shadowBlur=18;ctx.fillStyle=targetFill;ctx.fill(body);ctx.shadowBlur=0;
    ctx.strokeStyle='#b39c78';ctx.lineWidth=2;ctx.stroke(body);
    ctx.save();ctx.clip(body);ctx.globalAlpha=.22;
    line(-69,-72,56,-88,'#d8c29a',2);line(-77,48,66,29,'#121713',3);line(-47,103,54,112,'#c9ad7d',1);
    line(-23,-158,18,-151,'#cbb388',1);line(62,-51,73,18,'#d5bd91',2);line(-65,-34,-72,33,'#141816',2);
    ellipse(-43,-42,2.2,8,'#d5bd8b');ellipse(51,63,3,10,'#b69d74');ellipse(-30,85,5,2,'#d9c292');
    ctx.restore();
    const m=LEVELS[state.level];
    [1,.75,.5,.27].forEach((r,i)=>ellipse(0,0,68*r,94*r,['#3b3a32','#4b4738','#5c513b','#755b38'][i],['#d8c79e','#d2bd91','#ddc692','#f0d497'][i]));
    for(let z=0;z<3;z++){
      const r=[.865,.62,.385][z];
      label(`X${m[z]}`,0,-94*r+3,COLORS[z],9);
      label(`X${m[z]}`,0,94*r+3,COLORS[z],9);
      label(String(m[z]),-68*r,3,COLORS[z],8);
      label(String(m[z]),68*r,3,COLORS[z],8);
    }
    ellipse(0,-2,5,9,'#ffe9bd');label(`X${m[3]}`,0,17,'#ffe9bd',10);
    for(const hit of state.hits){ctx.save();if(hit.isLuckyHit){ctx.shadowColor='#ffc83d';ctx.shadowBlur=5;}ellipse(hit.x,hit.y,4,4,'#141c16',hit.isLuckyHit?'#ffe47a':'#deddb6');line(hit.x-6,hit.y-2,hit.x+6,hit.y+2,hit.isLuckyHit?'#d99a2b':'#182011',1);ctx.restore();}
    state.hitRewards=state.hitRewards.filter(reward=>now<reward.expiresAt);
    for(const reward of state.hitRewards){
      const remaining=reward.expiresAt-now,age=now-reward.createdAt;
      ctx.save();ctx.shadowColor='#000';ctx.shadowBlur=4;
      if(reward.isLuckyHit){
        ctx.globalAlpha=age<600?Math.min(1,(600-age)/120):0;ctx.shadowColor='#f1a91f';ctx.shadowBlur=7;label(`${reward.baseMultiplier} ×${LUCKY_HIT.multiplier}`,reward.x,reward.y-27,'#ffd45c',12);
        ctx.globalAlpha=age>330?Math.min(1,(age-330)/130,remaining/130):0;label(`+${compactNumber(reward.amount)}`,reward.x,reward.y-11,'#ffe47e',14);
      }else{
        ctx.globalAlpha=Math.min(1,remaining/70);label(`+${compactNumber(reward.amount)}`,reward.x,reward.y-12,'#d5f580',12);
      }
      ctx.restore();
    }
    const aimX=state.aim.x,aimY=state.aim.y;
    if(state.running){const aimColor=state.aimLucky?'#ffd45c':'#e1ffae';ctx.save();ctx.translate(aimX,aimY);if(state.aimLucky){ctx.shadowColor='#ffb52e';ctx.shadowBlur=8;}ctx.strokeStyle=aimColor;ctx.lineWidth=state.aimLucky?1.35:.8;ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.stroke();line(-23,0,-6,0,aimColor,state.aimLucky?1.35:1);line(6,0,23,0,aimColor,state.aimLucky?1.35:1);line(0,-23,0,-6,aimColor,state.aimLucky?1.35:1);line(0,6,0,23,aimColor,state.aimLucky?1.35:1);ellipse(0,0,1.5,1.5,state.aimLucky?'#fff0a3':'#edffbd');ctx.restore();}
    drawImpactSparks(state.hits[state.hits.length-1],now);
    for(const hit of state.hits)drawLuckyImpact(hit,now);
    ctx.restore();
    drawLuckyBanner(now);
    // The supplied rifle artwork tracks the aim and retains the recoil animation.
    const recoil=reducedMotion?0:state.flash;
    const sway=state.running&&!reducedMotion?state.aim.x*.04:0;
    const idleBob=!state.running&&!reducedMotion?Math.sin(now*.0022)*2.5:0;
    const idleTilt=!state.running&&!reducedMotion?Math.sin(now*.0017)*.18:0;
    $('weapon-layer').classList.toggle('lucky-hit',(state.running&&state.aimLucky)||now<state.luckyWeaponUntil);
    $('weapon-image').style.transform=`translate(${30+sway}px, ${idleBob+recoil*17}px) rotate(${idleTilt-recoil*1.5}deg) scale(${1+recoil*.035})`;
    $('muzzle-flash').style.opacity=String(reducedMotion?0:Math.max(0,(state.flash-.45)*1.8));
    requestAnimationFrame(draw);
  }
  update();resize();requestAnimationFrame(draw);
})();




