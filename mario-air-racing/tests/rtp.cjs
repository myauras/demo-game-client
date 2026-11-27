// Exercise the same fixed-step rules, course table and seat mapping shipped to browsers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
const start = html.indexOf('const Fleet=');
const end = html.indexOf('// Painted wooden forms', start);
assert(start !== -1 && end !== -1, 'Missing race simulation in the game page');
const { fleet, count, latest, seedAt, play, seat, newRace, stepRace, addItem, touchItem, chooseCoin, collectCoin, displayRate, tailContact, gustCollision, flightScale, flightYaw, raceLeader, payoutRate, sprint, extension, raceHz, secondsAtTick, ticksAtTime, finishPassTime, finishDuration, coinThrust } = new Function(html.slice(start, end) +
  '\nreturn { fleet:Fleet, count:COURSE_COUNT, latest:RACE_VERSION, seedAt:courseSeed, play(seed,version){const r=newRace(seed,version);while(!r.done)stepRace(r);return r}, seat:craftFor,newRace,stepRace,addItem,touchItem,chooseCoin,collectCoin,displayRate,tailContact,gustCollision,flightScale,flightYaw,raceLeader,payoutRate,sprint:SPRINT_TICKS,extension:EXTEND_RATE,raceHz,secondsAtTick,ticksAtTime,finishPassTime,finishDuration,coinThrust };')();
for (const version of [3,4,5,6,7,8,9,10,11,12,latest]) {
  const seeds = new Set();
  const totals = Array(5).fill(0);
  const zeroAfterTenSeconds = Array(5).fill(0);
  let minimum = Infinity;
  let maximum = 0;
  const finisherCounts=Array(6).fill(0);
  let bumps = 0, coursesWithBumps = 0, extended = 0, sprintFinishes = 0, highFinishes = 0;
  for (let index = 0; index < count; index++) {
    const seed = seedAt(index,version);
    assert(!seeds.has(seed), 'Duplicate course ' + seed);
    seeds.add(seed);
    const race = play(seed,version);
    assert(race.tick <= 1800);
    if(version === latest){
      assert.equal(race.winnerId,race.finishers[0]??null);
      if(race.finishers.length)assert.equal(race.winnerId,raceLeader(race).id);
      if(race.finishTick===1800){extended++;if(race.tick>sprint)highFinishes++}
      else {assert.equal(race.finishTick,sprint);assert(race.tick<=sprint);if(race.tick===sprint)sprintFinishes++}
      if(race.craft.some(p=>p.mult>=extension))assert.equal(race.finishTick,1800);
      const finishers=race.craft.filter(p=>p.alive);
      finisherCounts[finishers.length]++;
      assert.deepEqual(race.finishers.slice().sort(),finishers.map(p=>p.id));
      if(finishers.length){
        assert.equal(race.finishers[0],race.winnerId);
        for(let rank=1;rank<finishers.length;rank++)assert(finishPassTime(rank)>finishPassTime(rank-1));
        assert(finishDuration(race)>finishPassTime(finishers.length-1));
      }else assert(race.craft.every(p=>p.down&&p.finalTick<=race.tick));
      // Every explosion has exactly one physical source on its simulation tick.
      const hazardHits=new Set();
      for(const hit of race.events.filter(e=>e.type==='impact'&&e.hazard)){
        assert(!hazardHits.has(hit.hazard.key));hazardHits.add(hit.hazard.key);
      }
      for(const crash of race.events.filter(e=>e.type==='crash')){
        const sources=race.events.filter(e=>e.type==='impact'&&e.value===2&&e.time===crash.time&&
          (e.id===crash.id||e.target===crash.id));
        assert.equal(sources.length,1);
        const hit=sources[0],p=race.craft[crash.id];
        if(hit.hazard){
          assert.match(hit.hazard.type,/^(rock|bird|hail)$/);
          if(hit.hazard.type==='bird')assert(hit.time%24<6.5||hit.time%24>=22.5);
          if(hit.hazard.type==='hail')assert(hit.time%24>=6.5&&hit.time%24<14.5);
          assert.equal(p.hitTick,p.finalTick);assert(p.fatalImpact);
          assert(Math.abs(crash.x-hit.hazard.x)<20*flightScale(p)+.72*hit.hazard.rad);
          assert(Math.abs(crash.y-hit.hazard.y)<4*flightScale(p)+(hit.hazard.type==='rock'?.63:.42)*hit.hazard.rad);
        }else{
          const a=race.craft[hit.id],b=race.craft[hit.target];
          assert.equal(hit.reason,'ice');assert.equal(a.finalTick,b.finalTick);
          assert(a.gustUntil>hit.time||b.gustUntil>hit.time);
          assert(Math.abs(a.z-b.z)<=.055);assert(Math.abs(a.y-b.y)<=5*Math.min(flightScale(a),flightScale(b)));
        }
      }
      const contacts = race.events.filter(e => e.type === 'bump');
      for(const e of contacts){assert.equal(e.value,10);assert.notEqual(e.id,e.target)}
      bumps += contacts.length;
      if(contacts.length) coursesWithBumps++;
    }
    for (let offset = 0; offset < 5; offset++) {
      race.liveryOffset = offset;
      for (let choice = 0; choice < 5; choice++) {
        const craft = seat(race, choice);
        assert.equal((craft.id + offset) % 5, choice);
        assert(craft.finalTick !== null && Number.isInteger(craft.mult));
        assert(craft.mult >= 0 && craft.mult <= 10000);
        const paid=payoutRate(race,craft);
        const bonus=version>=13?race.finishers[0]===craft.id:version>=9&&craft.id===race.winnerId;
        assert.equal(paid,craft.mult*(bonus?2:1));
        totals[choice] += paid;
        if (paid === 0 && secondsAtTick(version,craft.finalTick) >= 10) zeroAfterTenSeconds[choice]++;
        minimum = Math.min(minimum, paid);
        if (version >= 7) assert(craft.mult >= 10 + Math.floor(craft.finalTick / 20));
        maximum = Math.max(maximum, paid);
      }
    }
  }
  for (const total of totals) assert.equal(total, 95 * count * 5);
  assert.equal(maximum, version>=9?20000:10000);
  if (version === latest) {
    assert(coursesWithBumps>0&&sprintFinishes>0&&highFinishes>0&&extended<count/5);
    assert.equal(finisherCounts[0],1120);
    assert(finisherCounts.slice(1).every(n=>n>0));
    console.log('Finisher counts, from zero to five: '+finisherCounts.join(', '));
    console.log(extended+' courses qualify for extra time; '+highFinishes+' fly past the sprint limit.');
    console.log(bumps + ' rear-end contacts across ' + coursesWithBumps + ' of ' + count + ' courses.');
    for (const [id, plane] of fleet.entries()) {
      assert.equal(zeroAfterTenSeconds[id], 0);
      console.log(plane.name + ': RTP ' + (totals[id] / (count * 5)).toFixed(2) +
        '%; final range ' + (minimum / 100).toFixed(2) + '–' + (maximum / 100) + '×; 10s+ flights paying zero: ' + zeroAfterTenSeconds[id]);
    }
  }
}
// Keep the champion's shot and settle each runner-up on its own quick pass.
assert.equal(finishPassTime(0),.83);
assert(finishPassTime(1)-finishPassTime(0)<1.1);
for(let rank=2;rank<5;rank++)assert(finishPassTime(rank)-finishPassTime(rank-1)<=.60);
assert(Math.abs(finishDuration({finishers:[0]})-1.76)<.000001);
assert(finishDuration({finishers:[0,1,2,3,4]})-finishPassTime(4)<=.65);

// Extension must be earned during the flight, even on the original finish tick.
for(const value of [extension-1,extension]){
  const r=newRace(49);r.nextCoin=r.nextHazard=r.nextGust=Infinity;
  r.tick=sprint-1;r.craft[2].mult=value;stepRace(r);
  assert.equal(r.done,value<extension);assert.equal(r.finishTick,value<extension?sprint:1800);
  assert.equal(r.extensionTick,value<extension?undefined:sprint);
  if(!r.done){r.craft[2].mult=10;stepRace(r);assert.equal(r.finishTick,1800);assert.equal(r.extensionTick,sprint)}
}
// A survivor beats an eliminated plane. With no survivors the last elimination
// wins, with progress and seat breaking a simultaneous finish deterministically.
const ranking=newRace(49),[a,b,c]=ranking.craft;
for(const p of ranking.craft)Object.assign(p,{alive:false,finalTick:60,x:600});
Object.assign(b,{alive:true,x:280});assert.equal(raceLeader(ranking),b);
Object.assign(c,{alive:true,x:320});assert.equal(raceLeader(ranking),c);
b.alive=c.alive=false;c.finalTick=b.finalTick=90;assert.equal(raceLeader(ranking),c);
b.x=c.x;ranking.craft.reverse();assert.equal(raceLeader(ranking),b);
assert.equal(payoutRate(ranking,b),b.mult);
assert.equal(raceHz(8),60);assert.equal(secondsAtTick(9,1800),25);
for(const tick of [1,400,1000,sprint,1800]){
  const t=secondsAtTick(latest,tick);
  assert.equal(ticksAtTime(latest,t+.000001),tick);
}
assert(ticksAtTime(latest,5)<ticksAtTime(latest,10)-ticksAtTime(latest,5));
assert(ticksAtTime(latest,15)-ticksAtTime(latest,10)<ticksAtTime(latest,20)-ticksAtTime(latest,15));
// Every active hazard follows the same biome clock as the displayed stage.
const weatherRun=newRace(11,latest);
while(!weatherRun.done){
  stepRace(weatherRun);
  const phase=weatherRun.tick/60%24;
  for(const o of weatherRun.items){
    if(o.type==='bird')assert(phase<6.5||phase>=22.5);
    if(o.type==='hail')assert(phase>=6.5&&phase<14.5);
  }
}
const previousMeteor=newRace(19,12),currentMeteor=newRace(19,latest);
for(const r of [previousMeteor,currentMeteor])addItem(r,'rock',16);
assert(Math.abs(currentMeteor.items[0].vx/previousMeteor.items[0].vx-1.6)<1e-10);
assert(Math.abs(currentMeteor.items[0].vy/previousMeteor.items[0].vy-1.6)<1e-10);
// A gust alone, a near miss or two separating hulls must never cause a crash.
for(const miss of ['no wind','different depth','vertical gap','horizontal gap','separating','slow','contact']){
  const r=newRace(8,latest),[a,b]=r.craft;r.tick=600;
  Object.assign(a,{x:380,y:250,z:.5,vz:0,pitch:0,vx:150,vy:0,gustUntil:10.5});
  Object.assign(b,{x:399,y:250,z:.5,vz:0,pitch:0,vx:-30,vy:0});
  if(miss==='no wind')a.gustUntil=10;
  if(miss==='different depth')b.z+=.15;
  if(miss==='vertical gap')b.y+=14;
  if(miss==='horizontal gap')b.x+=42;
  if(miss==='separating')a.vx=-150;
  if(miss==='slow')a.vx=15;
  const collides=miss==='contact';
  assert.equal(gustCollision(r,a,b,10),collides,miss);
  assert.equal(a.alive,!collides);assert.equal(b.alive,!collides);
  assert.equal(r.events.filter(e=>e.type==='impact').length,collides?1:0);
}
// Both hulls must meet nose-to-tail in the same depth plane on a closing pass.
function contactFixture(){
  const race=newRace(49,latest);race.tick=240;
  race.nextCoin=race.nextHazard=race.nextGust=Infinity;
  const [rear,front]=race.craft;
  for(const p of race.craft){p.alive=p===rear||p===front;p.z=.5;p.vz=0;p.oldY=p.y=220;p.mult=p.rateFrom=60}
  Object.assign(rear,{oldX:147,x:150,vx:180});
  Object.assign(front,{oldX:207,x:207,vx:0});
  return {race,front,rear};
}
for(const variation of ['farther','different heading','other altitude','receding','gap','spent bonus','at cap']){
  const {race,rear,front}=contactFixture();
  if(variation==='farther')front.z=.75;
  if(variation==='different heading')front.vz=.28;
  if(variation==='other altitude')front.y+=25;
  if(variation==='receding')rear.oldX=rear.x+2;
  if(variation==='gap')front.x=front.oldX=250;
  if(variation==='spent bonus')front.mult=22;
  if(variation==='at cap')rear.mult=9998;
  tailContact(race,rear,front);
  assert(!race.events.some(e=>e.type==='bump'),variation);
  if(variation==='spent bonus'||variation==='at cap'){
    assert.deepEqual([rear.contactKind,front.contactKind],['strike','received']);
    race.tick++;tailContact(race,rear,front);
    assert.equal(rear.contactTick,race.tick-1);
  }else{
    assert.equal(rear.contactKind,null,variation);assert.equal(front.contactKind,null,variation);
  }
}
const {race:pass,rear,front}=contactFixture();
tailContact(pass,front,rear); // Craft array order does not decide who hits.
assert.deepEqual([rear.mult,front.mult],[70,50]);
assert.deepEqual([rear.contactKind,front.contactKind],['strike','received']);
const hit=pass.events.find(e=>e.type==='bump');
assert.equal(hit.id,rear.id);assert.equal(hit.target,front.id);
tailContact(pass,rear,front);
assert.equal(pass.events.filter(e=>e.type==='bump').length,1);
const beforeHit=front.x;
for(let i=0;i<14;i++)stepRace(pass);
assert(front.x<beforeHit-18&&rear.x>front.x);
assert(flightScale({z:.8})>flightScale({z:.2}));
assert(flightYaw({vz:.15})<0&&flightYaw({vz:-.15})>0);
// A real course must show the overtake too, including the autopilot after impact.
const replay=newRace(2,latest);
let contact;
while(!contact&&!replay.done){stepRace(replay);contact=replay.events.find(e=>e.type==='bump')}
assert(contact);
const pursuer=replay.craft[contact.id],overtaken=replay.craft[contact.target];
assert(pursuer.x<overtaken.x&&Math.abs(pursuer.z-overtaken.z)<=.055);
assert.equal(displayRate(pursuer,replay.tick),pursuer.mult);
assert.equal(displayRate(overtaken,replay.tick),overtaken.mult);
for(let i=0;i<25;i++)stepRace(replay);
assert(pursuer.x>overtaken.x);
// Accrual and the number shown on each plane keep rising between pickups.
const flight = newRace(49, latest);
flight.nextCoin = flight.nextHazard = flight.nextGust = Infinity;
const trackedPilot = flight.craft[0];
const previous = [trackedPilot.mult, displayRate(trackedPilot, 0)];
for (let tick = 1; tick <= 120; tick++) {
  stepRace(flight);
  if (tick === 30) touchItem(flight, trackedPilot, {type:'coin', value:25}, tick / 60);
  if (tick === 50) touchItem(flight, trackedPilot, {type:'bird', heavy:false, y:trackedPilot.y}, tick / 60);
  const shown = displayRate(trackedPilot, tick);
  assert.equal(trackedPilot.mult, 10 + Math.floor(tick / 20) + (tick >= 30 ? 25 : 0));
  assert(trackedPilot.mult >= previous[0] && shown >= previous[1] && shown <= trackedPilot.mult);
  previous[0] = trackedPilot.mult;
  previous[1] = shown;
}
touchItem(flight, trackedPilot, {type:'rock', heavy:true, y:trackedPilot.y}, flight.tick / 60);
for (let i = 0; i < 60; i++) stepRace(flight);
assert.equal(trackedPilot.finalTick, 120);
assert.equal(trackedPilot.mult, previous[0]);
assert.equal(displayRate(trackedPilot, flight.tick), trackedPilot.mult);
// Single-hit traces use the same autopilot and positions as the playable race.
for (const type of ['bird', 'rock']) {
  const r = newRace(49, latest);
  r.nextCoin = r.nextHazard = r.nextGust = Infinity;
  while (r.tick < 180) stepRace(r);
  const p = r.craft[0];
  const startX = p.x;
  touchItem(r, p, {type, heavy:false, y:p.y}, r.tick / 60);
  assert(p.alive && p.hitKind === type && p.vx < -300);
  for (let i = 0; i < 18; i++) stepRace(r);
  assert(p.x < startX - (type === 'rock' ? 105 : 78));
  touchItem(r, p, {type, heavy:true, y:p.y}, r.tick / 60);
  assert(p.fatalImpact && !p.alive && p.finalTick === r.tick);
}
// A saved version-five race retains its original diving autopilot.
const chase = newRace(33, 5);
const control = newRace(33, 5);
for (const r of [chase,control]) {
  r.tick = 240;
  r.nextCoin = r.nextHazard = r.nextGust = Infinity;
  for (const p of r.craft) p.alive = p.id === 0;
  Object.assign(r.craft[0], {x:420, y:266, vx:25, vy:0});
}
const prize = {type:'coin', key:17, x:634, y:327, baseY:327, vx:-295, vy:0, born:4, phase:0, rad:7, value:25, spent:false};
chase.items.push(prize);
assert.equal(chooseCoin(chase,chase.craft[0]),prize);
assert.equal(chooseCoin({...chase,items:[{...prize,y:30}]},chase.craft[0]),null);
for (let i = 0; i < 18; i++) { stepRace(chase); stepRace(control); }
assert(chase.craft[0].y > control.craft[0].y + 18);
for (let i = 0; i < 55; i++) stepRace(chase);
assert.equal(chase.craft[0].mult,125);
assert.equal(chase.events.filter(e=>e.type==='pickup').length,1);

// Steering toward an uncollected coin only trims altitude. The collecting aircraft
// gains forward speed on the contact tick, then pulls ahead of the control flight.
const baseline = newRace(33,latest);
const flyby = newRace(33,latest);
for (const r of [baseline,flyby]) {
  r.nextCoin = r.nextHazard = r.nextGust = Infinity;
  for (const p of r.craft) p.alive = p.id === 0;
  while (r.tick < 240) stepRace(r);
}
const f = flyby.craft[0], leader = baseline.craft[0];
flyby.items.push({...prize,x:f.x+124,y:f.y+17,baseY:f.y+17,value:1000,spent:false});
let tracked = false, kicked = false, leadDistance = 0;
for (let i = 0; i < 80; i++) {
  const lastTrim = f.coinTrim;
  stepRace(baseline);stepRace(flyby);
  tracked ||= f.coinAim === prize.key;
  if(f.coinTick==null){
    assert.equal(f.x,leader.x);assert.equal(f.vx,leader.vx);
  }else{
    leadDistance=Math.max(leadDistance,f.x-leader.x);
    if(f.coinTick===flyby.tick)kicked=f.vx>leader.vx+100;
  }
  assert(Math.abs(f.coinTrim-lastTrim) <= 23/60+1e-9);
  assert(Math.abs(f.y-leader.y)<15);
  if(f.coinTick===flyby.tick)assert(!flyby.items.some(o=>o.key===prize.key));
}
assert(tracked&&kicked&&leadDistance>45);
assert.equal(coinThrust(f,f.coinTick),1);
assert.equal(coinThrust(f,f.coinTick+40),0);
assert.equal(coinThrust({...f,hitTick:f.coinTick+1},f.coinTick+2),0);
assert.equal(coinThrust({...f,bumpDelta:-10,bumpTick:f.coinTick+1},f.coinTick+2),0);
assert.equal(coinThrust({...f,alive:false},f.coinTick+2),0);
assert.equal(flyby.events.filter(e=>e.type==='pickup').length,1);

// Wings can pick up a coin already alongside, even without an active target.
const beside = newRace(11,latest);
const pilot = beside.craft[2];
Object.assign(pilot,{oldX:400,oldY:250,x:401,y:250,coinAim:null});
const wingCoin = {...prize, key:21, x:383, y:258, value:10, spent:false};
collectCoin(beside,wingCoin,[pilot],386,258,1);
assert(wingCoin.spent && pilot.mult === 10 + wingCoin.value);

// The higher ID reaches a swept coin first irrespective of craft array ordering.
for (const reverse of [false,true]) {
  const r = newRace(11,latest);
  const racers = r.craft.slice(0,2);
  for (const p of racers) Object.assign(p,{x:300+12*p.id,oldX:300+12*p.id,oldY:200,y:200,coinAim:7});
  const coin={...prize,key:7,spent:false,x:301,y:200};
  const live=reverse?racers.reverse():racers;
  collectCoin(r,coin,live,365,200,1);
  assert(coin.spent);
  collectCoin(r,coin,live,365,200,1);
  assert.equal(r.craft[1].mult,10 + coin.value);
  assert.equal(r.craft[0].mult,10);
  assert.equal(r.events.filter(e=>e.type==='pickup'&&e.chasers===2&&e.id===1).length,1);
}
console.log('Versions 3–13: 2,048 courses × 5 seats per aircraft. Flight accrual, legacy payouts, pickups and collisions passed.');
