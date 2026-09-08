/* Precision Shot — local H5 prototype. No external libraries or requests. */
(() => {
  'use strict';
  const LEVELS = {easy:[0.5,2,5,10], medium:[0.2,3,10,50], hard:[0,10,100,1000]};
  const ZONES = ['外圈','中圈','內圈','靶心'];
  const COLORS = ['#aab798','#8cc8b6','#f0d780','#eeb278'];
  const $ = id => document.getElementById(id);
  const money = n => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const state = {level:'easy', bullets:1, balance:10000, running:false, settling:false, fired:0, reward:0, round:1, hits:[], aim:{x:0,y:0}, flash:0, sound:false};
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
  document.querySelectorAll('#difficulty button').forEach(b=>b.onclick=()=>{if(state.running)return;state.level=b.dataset.level;select('difficulty','level',state.level);state.hits=[];closePickers();$('difficulty-toggle').focus();update();});
  document.querySelectorAll('#bullets button').forEach(b=>b.onclick=()=>{if(state.running)return;state.bullets=Number(b.dataset.count);state.fired=0;select('bullets','count',state.bullets);closePickers();$('bullets-toggle').focus();update();});
  document.querySelectorAll('[data-bet]').forEach(b=>b.onclick=()=>{if(state.running)return;$('bet').value=b.dataset.bet;update();});
  $('bet').oninput=update;
  function scaleBet(factor){if(state.running)return;$('bet').value=String(Math.max(1,Math.min(1000,Math.floor((validBet()?bet():10)*factor))));update();}
  $('bet-minus').onclick=()=>scaleBet(.5);$('bet-plus').onclick=()=>scaleBet(2);
  $('rules-open').onclick=()=>$('rules').showModal();
  $('reward-dialog').addEventListener('cancel',event=>event.preventDefault());
  $('rules-close').onclick=$('rules-done').onclick=()=>$('rules').close();
  $('rules').onclick=e=>{if(e.target===$('rules')){const r=$('rules').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('rules').close();}};
  $('reset').onclick=()=>{if(state.running||state.settling)return;state.balance=10000;state.reward=0;state.fired=0;state.hits=[];state.round=1;$('shot-log').innerHTML='<div class="empty-log"><span>⌖</span><p>模擬點數已重設。<small>選擇設定，開始新回合。</small></p></div>';$('summary').textContent='等待開始新回合';$('range-status').textContent='靶場就緒';feedback('鎖定目標','READY TO FIRE',false);update();};
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
    closePickers();state.running=true;state.balance=Math.round((state.balance-cost)*100)/100;state.reward=0;state.fired=0;state.hits=[];
    $('shot-log').innerHTML='';$('summary').textContent=`本局投注 ${money(cost)} · 正在射擊`;$('range-status').textContent='射擊進行中';feedback('正在舉槍','ACQUIRING TARGET',false);if(state.sound)prepareSound();update();
    for(let i=0;i<count;i++){
      const zone=chooseZone(random()),point=pointFor(zone),start={...state.aim};
      const aimStart=performance.now(), aimDuration=i===0?450:100;
      while(performance.now()-aimStart<aimDuration){const t=Math.min(1,(performance.now()-aimStart)/aimDuration),ease=t*t*(3-2*t);state.aim={x:start.x+(point.x-start.x)*ease,y:start.y+(point.y-start.y)*ease};await wait(16);}
      state.aim=point;state.flash=1;state.hits.push({...point,zone});state.fired++;playShot();
      const payout=Math.round(stake*multipliers[zone]*100)/100;state.reward=Math.round((state.reward+payout)*100)/100;
      feedback(`命中${ZONES[zone]} · ${multipliers[zone]}×`,`+ ${money(payout)}`);
      const card=document.createElement('div');card.className='shot-card';card.style.setProperty('--zone-color',COLORS[zone]);card.innerHTML=`<small><span>SHOT ${String(i+1).padStart(2,'0')}</span><span>${ZONES[zone]}</span></small><strong>${multipliers[zone]}×</strong><span>+ ${money(payout)}</span>`;$('shot-log').append(card);$('shot-log').scrollLeft=$('shot-log').scrollWidth;update();if(i<count-1)await wait(200);
    }
    state.running=false;state.settling=true;state.round++;state.balance=Math.round((state.balance+state.reward)*100)/100;const net=Math.round((state.reward-cost)*100)/100;
    $('range-status').textContent='本局完成';feedback('本局總獎勵',money(state.reward));$('summary').textContent=`${count} 發射擊完成 · 總投注 ${money(cost)} · 總獎勵 ${money(state.reward)} · 淨${net>=0?'獲得':'損失'} ${money(Math.abs(net))}`;update();
    $('reward-amount').textContent=money(state.reward);
    await wait(900);
    $('reward-dialog').showModal();
    await wait(1500);
    $('reward-dialog').close();
    state.settling=false;
    update();
  }
  $('start').onclick=fireRound;

  function resize(){const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);width=rect.width;height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
  new ResizeObserver(resize).observe(canvas);
  function line(x1,y1,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function ellipse(x,y,rx,ry,fill,stroke){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function label(text,x,y,color,size=16){ctx.font=`600 ${size}px "Segoe UI",sans-serif`;ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,x,y);}
  function draw(now){
    const delta=Math.min((now-previousTime)/1000,.05);previousTime=now;state.flash=Math.max(0,state.flash-delta*12);
    ctx.clearRect(0,0,width,height);const cx=width/2;
    const bg=ctx.createRadialGradient(cx,height*.32,25,cx,height*.4,width*.95);
    bg.addColorStop(0,'#48533a');bg.addColorStop(.5,'#303b2b');bg.addColorStop(1,'#17221c');
    ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    const van={x:cx,y:height*.4};
    for(let i=-3;i<=3;i++){
      line(van.x+i*25,van.y+40,cx+i*width*.35,height,'#85916b18');
      line(van.x+i*25,van.y-40,cx+i*width*.35,0,'#99a47e12');
    }
    for(let i=0;i<5;i++){const y=height*.62+i*i*height*.018;line(0,y,width,y,'#b4c39410');}
    const scale=Math.min(width/310,(height*.53-55)/309,1.35),targetY=55+175*scale;
    ctx.save();ctx.translate(cx,targetY);ctx.scale(scale,scale);
    if(!reducedMotion&&state.flash>0)ctx.translate(Math.sin(now*.06)*state.flash*2,0);
    const body=new Path2D('M -24 -141 Q -27 -175 0 -175 Q 27 -175 24 -141 L 27 -141 L 26 -127 L 22 -127 L 17 -109 Q 30 -99 58 -89 Q 72 -84 76 -61 Q 93 29 77 71 L 67 116 Q 80 133 65 134 L -65 134 Q -80 133 -67 116 L -77 71 Q -93 29 -76 -61 Q -72 -84 -58 -89 Q -30 -99 -17 -109 L -22 -127 L -26 -127 L -27 -141 Z');
    ctx.shadowColor='#0008';ctx.shadowBlur=18;ctx.fillStyle='#263425';ctx.fill(body);ctx.shadowBlur=0;
    ctx.strokeStyle='#aab798';ctx.lineWidth=1;ctx.stroke(body);
    const m=LEVELS[state.level];
    [1,.75,.5,.27].forEach((r,i)=>ellipse(0,0,68*r,94*r,['#35422e','#315044','#5e5830','#765634'][i],COLORS[i]));
    for(let z=0;z<3;z++){
      const r=[.865,.62,.385][z];
      label(`X${m[z]}`,0,-94*r+3,COLORS[z],9);
      label(`X${m[z]}`,0,94*r+3,COLORS[z],9);
      label(String(m[z]),-68*r,3,COLORS[z],8);
      label(String(m[z]),68*r,3,COLORS[z],8);
    }
    ellipse(0,-2,5,9,'#ffe9bd');label(`X${m[3]}`,0,17,'#ffe9bd',10);
    for(const hit of state.hits){ellipse(hit.x,hit.y,4,4,'#141c16','#deddb6');line(hit.x-6,hit.y-2,hit.x+6,hit.y+2,'#182011',1);}
    const aimX=state.aim.x,aimY=state.aim.y;
    if(state.running){ctx.save();ctx.translate(aimX,aimY);ctx.strokeStyle='#e1ffae';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.stroke();line(-23,0,-6,0,'#e1ffae');line(6,0,23,0,'#e1ffae');line(0,-23,0,-6,'#e1ffae');line(0,6,0,23,'#e1ffae');ellipse(0,0,1.5,1.5,'#edffbd');ctx.restore();}
    if(state.flash>0){const hit=state.hits[state.hits.length-1];if(hit){ctx.globalAlpha=state.flash;ellipse(hit.x,hit.y,25*(1-state.flash)+6,25*(1-state.flash)+6,null,'#ffffc6');ctx.globalAlpha=1;}}
    ctx.restore();
    // The supplied rifle artwork tracks the aim and retains the recoil animation.
    const recoil=reducedMotion?0:state.flash;
    const sway=state.running&&!reducedMotion?state.aim.x*.04:0;
    $('weapon-image').style.transform=`translate(${18+sway}px, ${recoil*17}px) rotate(${-recoil*1.5}deg) scale(${1+recoil*.035})`;
    $('muzzle-flash').style.opacity=String(reducedMotion?0:Math.max(0,(state.flash-.45)*1.8));
    requestAnimationFrame(draw);
  }
  update();resize();requestAnimationFrame(draw);
})();




