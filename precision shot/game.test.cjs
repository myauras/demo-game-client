// Headless checks of the shipped game script's actual event handlers and accounting.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const gameSource=fs.readFileSync(__dirname+'/game.js','utf8');
function game(random=.2){
  const elements=new Map();
  function element(){return {value:'10',hidden:true,open:false,offsetWidth:330,textContent:'',innerHTML:'',disabled:false,dataset:{},style:{setProperty(){}},classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},focus(){},showModal(){this.open=true},close(){this.open=false},firstElementChild:{},lastElementChild:{},append(){},getBoundingClientRect(){return {width:420,height:740}},getContext(){return {setTransform(){}}}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const levels=['easy','medium','hard'].map(level=>Object.assign(element(),{dataset:{level}}));
  const counts=[1,2,3,5,10,20].map(count=>Object.assign(element(),{dataset:{count:String(count)}}));
  const presets=[10,50,100,200].map(bet=>Object.assign(element(),{dataset:{bet:String(bet)}}));
  let tick=0;
  vm.runInNewContext(gameSource,{
    document:{addEventListener(){},getElementById:get,createElement:element,querySelectorAll:s=>s==='#difficulty button'?levels:s==='#bullets button'?counts:s==='[data-bet]'?presets:[]},
    matchMedia:()=>({matches:false}),ResizeObserver:class{observe(){}},devicePixelRatio:1,
    requestAnimationFrame(){},performance:{now:()=>tick+=100},setTimeout:fn=>queueMicrotask(fn),
    crypto:{getRandomValues:a=>{a[0]=Math.floor(random*4294967296);return a;}},window:{},
  });
  return {get,levels,counts,presets};
}
for(const [level,multipliers,samples] of [
  ['easy',[.5,2,5,10],[.5,.9,.99,.9995]],
  ['medium',[.2,3,10,50],[.5,.9,.997,.9999]],
  ['hard',[0,10,100,1000],[.5,.95,.9995,.99999]],
]){
  for(const [zone,r] of samples.entries()){
    test(`${level}, zone ${zone}: five shots debit once and pay correct multiplier`,async()=>{
      const g=game(r);g.levels.find(b=>b.dataset.level===level).onclick();g.counts.find(b=>b.dataset.count==='5').onclick();
      const reward=50*multipliers[zone];
      const run=g.get('start').onclick();
      assert.equal(g.get('balance').textContent,'9,950.00');
      assert.equal(g.get('start').disabled,true);
      await g.get('start').onclick(); // Repeated activation must not start another round.
      await run;
      assert.equal(g.get('round-reward').textContent,reward.toLocaleString('en-US',{minimumFractionDigits:2}));
      assert.equal(g.get('balance').textContent,(9950+reward).toLocaleString('en-US',{minimumFractionDigits:2}));
      assert.equal(g.get('ammo-count').textContent,'00 / 05');
      assert.match(g.get('summary').textContent,/5 發射擊完成/);
      g.get('reset').onclick();assert.equal(g.get('balance').textContent,'10,000.00');
    });
  }
}
test('configured zone probabilities include Lucky Hit and produce 95% RTP',()=>{
  const probabilities=vm.runInNewContext(`(${gameSource.match(/const ZONE_PROBABILITIES = (\{[^;]+\});/)[1]})`);
  const levels=vm.runInNewContext(`(${gameSource.match(/const LEVELS = (\{[^;]+\});/)[1]})`);
  const lucky=vm.runInNewContext(`(${gameSource.match(/const LUCKY_HIT = (\{[^;]+\});/)[1]})`);
  for(const level of Object.keys(levels)){
    const baseRtp=probabilities[level].reduce((sum,p,index)=>sum+p*levels[level][index],0);
    const totalRtp=baseRtp*(1+lucky.chance*(lucky.multiplier-1));
    assert.ok(Math.abs(totalRtp-.95)<1e-9,`${level} RTP was ${totalRtp}`);
  }
});
test('Lucky Hit independently doubles the actual hit multiplier',async()=>{
  const g=game(.05);g.counts.find(b=>b.dataset.count==='2').onclick();
  await g.get('start').onclick();
  assert.equal(g.get('round-reward').textContent,'20.00');
  assert.equal(g.get('balance').textContent,'10,000.00');
  assert.match(g.get('summary').textContent,/Lucky Hit 2 次/);
});
test('invalid stakes are rejected without a deduction',async()=>{
  for(const value of ['','0','-10','1.5','1001','abc']){
    const g=game();g.get('bet').value=value;g.get('bet').oninput();
    assert.equal(g.get('start').disabled,true);await g.get('start').onclick();
    assert.equal(g.get('balance').textContent,'10,000.00');
  }
});
test('bullet count controls cost, full loss blocks unaffordable next round, reset restores play',async()=>{
  const g=game(.1);g.levels[2].onclick();g.counts.find(b=>b.dataset.count==='10').onclick();g.get('bet').value='1000';g.get('bet').oninput();
  assert.equal(g.get('total-bet').textContent,'10,000.00');
  await g.get('start').onclick();assert.equal(g.get('balance').textContent,'0.00');assert.equal(g.get('start').disabled,true);
  await g.get('start').onclick();assert.equal(g.get('balance').textContent,'0.00');
  g.get('reset').onclick();assert.equal(g.get('start').disabled,false);
});
test('quick bets update total and are ignored during an active round',async()=>{
  const g=game();g.counts.find(b=>b.dataset.count==='3').onclick();
  for(const b of g.presets){b.onclick();assert.equal(g.get('bet').value,b.dataset.bet);assert.equal(g.get('total-bet').textContent,(Number(b.dataset.bet)*3).toFixed(2));}
  const run=g.get('start').onclick();g.presets[0].onclick();assert.equal(g.get('bet').value,'200');await run;
  assert.equal(g.get('balance').textContent,'9,700.00');
});
test('completed round shows the reward and closes it automatically',async()=>{
  const g=game(.9);g.counts.find(b=>b.dataset.count==='2').onclick();
  await g.get('start').onclick();
  assert.equal(g.get('reward-dialog').open,false);
  assert.equal(g.get('reward-amount').textContent,'40.00');
  assert.equal(g.get('balance').textContent,'10,020.00');
});
for(const count of [1,2,3,5,10,20])test(`${count} bullets: correct cost, shot count and payout`,async()=>{
  const g=game(.9);g.counts.find(b=>b.dataset.count===String(count)).onclick();
  assert.equal(g.get('total-bet').textContent,(10*count).toFixed(2));
  await g.get('start').onclick();
  assert.equal(g.get('round-reward').textContent,(20*count).toFixed(2));
  assert.equal(g.get('ammo-count').textContent,`00 / ${String(count).padStart(2,'0')}`);
});
test('pickers toggle, exclude each other and close on selection; half/double clamp valid stakes',()=>{
  const g=game();g.get('difficulty-toggle').onclick();assert.equal(g.get('difficulty').hidden,false);
  g.get('bullets-toggle').onclick();assert.equal(g.get('difficulty').hidden,true);assert.equal(g.get('bullets').hidden,false);
  g.counts[5].onclick();assert.equal(g.get('bullets').hidden,true);assert.equal(g.get('bullets-toggle').firstElementChild.textContent,'20');
  g.get('bet-minus').onclick();assert.equal(Number(g.get('bet').value),5);
  g.get('bet-plus').onclick();assert.equal(Number(g.get('bet').value),10);
  g.get('bet').value='1';g.get('bet-minus').onclick();assert.equal(Number(g.get('bet').value),1);
  g.get('bet').value='1000';g.get('bet-plus').onclick();assert.equal(Number(g.get('bet').value),1000);
});
