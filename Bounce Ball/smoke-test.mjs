import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9333;
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--window-size=460,900', '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  '--user-data-dir=D:\\Aura\\Bounce Ball\\.edge-smoke',
  'file:///D:/Aura/Bounce%20Ball/index.html'
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() {
  for (let i = 0; i < 30; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
    catch { await sleep(150); }
  }
  throw new Error('無法連接 Edge DevTools');
}

let seq = 0;
async function main() {
  const target = (await targets()).find(t => t.type === 'page');
  if (!target) throw new Error('找不到遊戲頁面');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const call = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
  await sleep(700);
  const initial = await evalJs(`({title:document.title, history:document.querySelectorAll('#history span').length, balance:document.querySelector('#balance').textContent, canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height],bonusWidth:getComputedStyle(document.querySelector('#bonusButton')).width})`);
  await evalJs(`document.querySelector('#autoButton').click()`);
  const autoCopy = await evalJs(`({title:document.querySelector('#autoModal h2').textContent,confirm:document.querySelector('#confirmAuto').textContent,eyebrow:document.querySelector('#autoModal .eyebrow')===null})`);
  await evalJs(`document.querySelector('#closeAuto').click()`);
  await evalJs(`document.querySelector('#difficultyTrigger').click()`);
  const difficultyMenu = await evalJs(`({open:document.querySelector('.difficulty-picker').classList.contains('open'),options:document.querySelectorAll('#difficultyMenu button').length,selected:document.querySelector('#difficultyMenu [aria-selected="true"]').textContent})`);
  await evalJs(`document.querySelector('#difficultyMenu [data-value="normal"]').click()`);
  const difficultySilent = await evalJs(`document.querySelector('#message')===null`);
  await evalJs(`document.querySelector('#bonusButton').click()`);
  const typography = await evalJs(`({difficulty:getComputedStyle(document.querySelector('#difficultyTrigger')).fontSize,auto:getComputedStyle(document.querySelector('#autoButton')).fontSize,modeDescription:getComputedStyle(document.querySelector('.mode-copy small')).fontSize})`);
  await evalJs(`document.querySelector('[data-mode="super"]').click()`);
  await sleep(750);
  const superMode = await evalJs(`({amount:document.querySelector('#betInput').value,yellow:document.querySelector('.bet-input-wrap').classList.contains('boosted'),bonusWidth:getComputedStyle(document.querySelector('#bonusButton')).width})`);
  await evalJs(`document.querySelector('#bonusButton').click()`);
  await sleep(900);
  await evalJs(`document.querySelector('#bonusButton').click();document.querySelector('[data-mode="ten"]').click()`);
  await sleep(750);
  const tenMode = await evalJs(`({amount:document.querySelector('#betInput').value,yellow:document.querySelector('.bet-input-wrap').classList.contains('boosted'),bonusWidth:getComputedStyle(document.querySelector('#bonusButton')).width})`);
  await evalJs(`document.querySelector('#bonusButton').click()`);
  await sleep(900);
  await evalJs(`document.querySelector('#betButton').click()`);
  await sleep(900);
  const afterBet = await evalJs(`({balance:document.querySelector('#balance').textContent,buttonDisabled:document.querySelector('#betButton').disabled,canvasRunning:document.querySelector('canvas')!==null})`);
  if (process.env.CAPTURE_SMOKE === '1') {
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('D:/Aura/ball-scale-check.png', Buffer.from(screenshot.result.data, 'base64'));
  }
  let settlement = null;
  if (process.env.CAPTURE_RESULT === '1') {
    for (let i=0;i<150;i++) {
      await sleep(100);
      settlement=await evalJs(`({latest:document.querySelector('#history span').textContent,balance:document.querySelector('#balance').textContent,result:document.querySelector('canvas').dataset.lastResult,landingZone:document.querySelector('canvas').dataset.lastLandingZone,reward:Number(document.querySelector('canvas').dataset.lastReward||0),baseBet:Number(document.querySelector('canvas').dataset.lastBaseBet||0),actualCost:Number(document.querySelector('canvas').dataset.lastActualCost||0),collisionMultiplier:Number(document.querySelector('canvas').dataset.lastCollisionMultiplier||0),extraMultiplier:Number(document.querySelector('canvas').dataset.lastExtraMultiplier||1),winEffect:document.querySelector('canvas').dataset.lastWinEffect||''})`);
      if(settlement.latest!=='—'){
        const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        await writeFile('D:/Aura/result-effect-check.png',Buffer.from(screenshot.result.data,'base64'));
        break;
      }
    }
  } else if (process.env.WAIT_FOR_SETTLE === '1') {
    await sleep(14000);
    settlement=await evalJs(`({latest:document.querySelector('#history span').textContent,balance:document.querySelector('#balance').textContent,result:document.querySelector('canvas').dataset.lastResult,landingZone:document.querySelector('canvas').dataset.lastLandingZone,reward:Number(document.querySelector('canvas').dataset.lastReward||0),baseBet:Number(document.querySelector('canvas').dataset.lastBaseBet||0),actualCost:Number(document.querySelector('canvas').dataset.lastActualCost||0),collisionMultiplier:Number(document.querySelector('canvas').dataset.lastCollisionMultiplier||0),extraMultiplier:Number(document.querySelector('canvas').dataset.lastExtraMultiplier||1),winEffect:document.querySelector('canvas').dataset.lastWinEffect||''})`);
  }
  if (process.env.WAIT_FOR_SETTLE !== '1' && process.env.CAPTURE_RESULT !== '1') {
    await evalJs(`document.querySelector('#bonusButton').click()`);
    await sleep(100);
  }
  const guard = await evalJs(`({sheetOpen:document.querySelector('#modeSheet').classList.contains('open'),messageRemoved:document.querySelector('#message')===null})`);
  ws.close();
  if (initial.title !== '彈跳球 Bounce Ball' || initial.history !== 5 || autoCopy.title !== '自動下注次數' || autoCopy.confirm !== '開始' || !autoCopy.eyebrow || !difficultyMenu.open || difficultyMenu.options !== 3 || difficultyMenu.selected !== '簡單' || !difficultySilent || typography.difficulty !== typography.auto || typography.modeDescription !== '12px' || superMode.amount !== '50' || !superMode.yellow || superMode.bonusWidth !== initial.bonusWidth || tenMode.amount !== '100' || !tenMode.yellow || tenMode.bonusWidth !== initial.bonusWidth || afterBet.balance !== '$99,990.00' || !afterBet.canvasRunning || guard.sheetOpen || !guard.messageRemoved || (settlement&&(settlement.latest==='—'||settlement.result!==settlement.landingZone||!Number.isFinite(settlement.reward)||Math.abs(parseFloat(settlement.latest)-settlement.collisionMultiplier)>.011||Math.abs(settlement.reward-settlement.baseBet*settlement.collisionMultiplier*settlement.extraMultiplier)>.011||(settlement.result==='win'&&settlement.winEffect!==(settlement.reward>=settlement.actualCost*2?'deluxe':settlement.reward>settlement.actualCost?'confetti':'debris'))))) {
    throw new Error('互動驗收失敗：' + JSON.stringify({ initial, autoCopy, difficultyMenu, difficultySilent, typography, superMode, tenMode, afterBet, settlement, guard }));
  }
  console.log(JSON.stringify({ initial, autoCopy, difficultyMenu, difficultySilent, typography, superMode, tenMode, afterBet, settlement, guard }, null, 2));
}

try { await main(); }
finally { browser.kill(); }
