'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type Outcome = 'spin' | 'ringout' | 'burst' | 'perfect' | 'lose';
type Phase = 'lobby' | 'intro' | 'countdown' | 'launch' | 'chase' | 'impact' | 'outcome' | 'result';
type MotionStops = { p1x:number; p1y:number; e1x:number; e1y:number; p2x:number; p2y:number; e2x:number; e2y:number; p3x:number; p3y:number; e3x:number; e3y:number };
type Stability = { player:number; enemy:number };
type EventId = 'power' | 'triple' | 'edge' | 'rescue' | 'counter' | 'fatal' | 'comeback' | 'dominance';
type EventMode = 'auto' | 'none' | 'manual';
type BattleEvent = { id:EventId; label:string; bonus:number; rarity:'common' | 'medium' | 'rare' };

const initialMotion: MotionStops = { p1x:-108,p1y:52,e1x:108,e1y:-52,p2x:-98,p2y:-56,e2x:98,e2y:56,p3x:-116,p3y:36,e3x:116,e3y:-36 };
const randomBetween = (min:number,max:number) => Math.round(min + Math.random() * (max - min));
const randomDifferent = (min:number,max:number,...previousValues:number[]) => { let value = randomBetween(min,max); while (previousValues.includes(value)) value = value < max ? value + 1 : min; return value; };
const createMotionStops = (): MotionStops => ({
  p1x:-randomBetween(88,126), p1y:randomBetween(34,70), e1x:randomBetween(88,126), e1y:-randomBetween(34,70),
  p2x:-randomBetween(82,120), p2y:-randomBetween(32,72), e2x:randomBetween(82,120), e2y:randomBetween(32,72),
  p3x:-randomBetween(86,124), p3y:randomBetween(-62,62), e3x:randomBetween(86,124), e3y:randomBetween(-62,62),
});
const createHitStability = (hit:number): Stability => { const ranges = [[78,94],[56,75],[34,53]]; const [min,max] = ranges[hit - 1]; const player = randomBetween(min,max); let enemy = randomBetween(min,max); if (Math.abs(player - enemy) < 3) enemy = enemy + 4 <= max ? enemy + 4 : enemy - 4; return { player,enemy }; };
const eventHitOffsets: Record<EventId,number[]> = { power:[760],triple:[230,740,1290],edge:[360,610,1290],rescue:[430,710,1290],counter:[300,1420],fatal:[165,495,825,1155,1470],comeback:[860,1290],dominance:[1120] };
const applyEventHit = (current:Stability,event:BattleEvent,hit:number): Stability => {
  if (event.id === 'comeback' && hit === eventHitOffsets.comeback.length - 1) return { player:Math.min(58,current.player + randomBetween(12,20)),enemy:Math.max(12,current.enemy - randomBetween(9,15)) };
  const playerLoss = event.id === 'dominance' ? randomBetween(1,3) : randomBetween(2,7);
  const enemyLoss = ['counter','fatal','dominance'].includes(event.id) ? randomBetween(5,10) : randomBetween(2,7);
  return { player:Math.max(8,current.player - playerLoss),enemy:Math.max(8,current.enemy - enemyLoss) };
};
const createFinalStability = (result:Outcome,previous:Stability,lastFinal:Stability | null): Stability => result === 'lose'
  ? { player:randomDifferent(0,7,previous.player,lastFinal?.player ?? -1),enemy:randomDifferent(18,46,previous.enemy,lastFinal?.enemy ?? -1) }
  : { player:randomDifferent(14,42,previous.player,lastFinal?.player ?? -1),enemy:randomDifferent(0,7,previous.enemy,lastFinal?.enemy ?? -1) };

const bets = [10, 50, 100, 200];
const outcomeInfo: Record<Outcome, { label:string; kicker:string; multiplier:number }> = {
  spin:{ label:'停轉勝利',kicker:'最後旋轉！',multiplier:1.8 }, ringout:{ label:'擊飛勝利',kicker:'擊飛！',multiplier:3 }, burst:{ label:'裝甲擊破',kicker:'完全勝利',multiplier:5 }, perfect:{ label:'完美擊破',kicker:'完美勝利',multiplier:10 }, lose:{ label:'對戰失敗',kicker:'再接再厲！',multiplier:0 },
};
const eventInfo: Record<EventId,BattleEvent> = {
  power:{ id:'power',label:'強力撞擊',bonus:.2,rarity:'common' }, triple:{ id:'triple',label:'三連撞擊',bonus:.3,rarity:'common' }, edge:{ id:'edge',label:'邊緣反彈',bonus:.4,rarity:'medium' }, rescue:{ id:'rescue',label:'極限救回',bonus:.5,rarity:'medium' }, counter:{ id:'counter',label:'高速反擊',bonus:.5,rarity:'medium' }, fatal:{ id:'fatal',label:'致命連撞',bonus:.8,rarity:'rare' }, comeback:{ id:'comeback',label:'極限反殺',bonus:1,rarity:'rare' }, dominance:{ id:'dominance',label:'完美壓制',bonus:1,rarity:'rare' },
};
const eventIds = Object.keys(eventInfo) as EventId[];
const eventOptions = eventIds.map(id => eventInfo[id]);
const eventConflicts = (a:EventId,b:EventId) => (a === 'comeback' && b === 'dominance') || (a === 'dominance' && b === 'comeback');
const pickAutoEvents = (outcome:Outcome): BattleEvent[] => {
  const count = [0,0,1,1,1,2,2][randomBetween(0,6)];
  if (!count) return [];
  const allowed = eventOptions.filter(event => outcome !== 'lose' || !['comeback','dominance'].includes(event.id));
  const weighted = allowed.flatMap(event => Array(event.rarity === 'common' ? 5 : event.rarity === 'medium' ? 3 : 1).fill(event));
  const picked: BattleEvent[] = [];
  while (picked.length < count && weighted.length) { const candidate = weighted[randomBetween(0,weighted.length - 1)]; if (!picked.some(event => event.id === candidate.id) && !picked.some(event => eventConflicts(event.id,candidate.id))) picked.push(candidate); }
  return picked;
};
const getRating = (outcome:Outcome,events:BattleEvent[]) => { if (outcome === 'lose') return 'B'; if (outcome === 'perfect' && events.some(event => event.rarity === 'rare')) return 'SSS'; if (events.length >= 2) return 'SS'; if (events.some(event => event.rarity === 'rare')) return 'S'; if (events.length === 1) return 'A'; return 'B'; };
const ratingCopy: Record<string,string> = { B:'完成對決',A:'精彩交鋒',S:'超凡戰鬥',SS:'精彩對決',SSS:'傳奇對決' };

export default function Home() {
  const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const [balance,setBalance] = useState(10000); const [bet,setBet] = useState(10); const [betInput,setBetInput] = useState('10');
  const [phase,setPhase] = useState<Phase>('lobby'); const [count,setCount] = useState(3); const [forced,setForced] = useState<'auto' | Outcome>('auto');
  const [eventMode,setEventMode] = useState<EventMode>('auto'); const [manualEvents,setManualEvents] = useState<Array<EventId | 'none'>>(['none','none']);
  const [outcome,setOutcome] = useState<Outcome>('spin'); const [notice,setNotice] = useState(''); const [motionStops,setMotionStops] = useState<MotionStops>(initialMotion);
  const [stability,setStability] = useState<Stability>({ player:100,enemy:100 }); const [selectedEvents,setSelectedEvents] = useState<BattleEvent[]>([]); const [battleEvents,setBattleEvents] = useState<BattleEvent[]>([]); const [activeEvent,setActiveEvent] = useState<BattleEvent | null>(null);
  const [settlementStep,setSettlementStep] = useState(0); const [settlementDone,setSettlementDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]); const lastFinalStability = useRef<Stability | null>(null); const shell = useRef<HTMLElement>(null);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers,[]); useEffect(() => { if (shell.current) shell.current.scrollTop = 0; },[phase]);

  const pickOutcome = (): Outcome => { if (forced !== 'auto') return forced; const roll = Math.random(); if (roll < .36) return 'lose'; if (roll < .68) return 'spin'; if (roll < .84) return 'ringout'; if (roll < .96) return 'burst'; return 'perfect'; };
  const chooseEvents = (selectedOutcome:Outcome) => { if (eventMode === 'none') return []; if (eventMode === 'auto') return pickAutoEvents(selectedOutcome); const ids = manualEvents.filter((id): id is EventId => id !== 'none').filter(id => selectedOutcome !== 'lose' || !['comeback','dominance'].includes(id)); return ids.filter((id,index) => ids.indexOf(id) === index).filter((id,index,array) => !array.slice(0,index).some(other => eventConflicts(other,id))).slice(0,2).map(id => eventInfo[id]); };

  const startBattle = () => {
    if (balance < bet) { setNotice('點數不足，請選擇較低投入'); return; }
    clearTimers(); setNotice(''); const selectedOutcome = pickOutcome(); const roundEvents = chooseEvents(selectedOutcome);
    const eventBonus = selectedOutcome === 'lose' ? 0 : roundEvents.reduce((sum,event) => sum + event.bonus,0); const finalPayout = Math.round(bet * (outcomeInfo[selectedOutcome].multiplier + eventBonus));
    setOutcome(selectedOutcome); setSelectedEvents(roundEvents); setBattleEvents([]); setActiveEvent(null); setSettlementStep(0); setSettlementDone(false); setMotionStops(createMotionStops()); setStability({ player:100,enemy:100 }); setBalance(value => value - bet); setCount(3); setPhase('intro');
    const cue = (delay:number,action:() => void) => timers.current.push(setTimeout(action,delay));
    const triggerEvent = (event:BattleEvent,delay:number) => { cue(delay,() => { setActiveEvent(event); if (event.id === 'comeback') setStability({ player:randomBetween(10,20),enemy:randomBetween(40,60) }); if (event.id === 'dominance') setStability({ player:randomBetween(62,76),enemy:randomBetween(10,20) }); }); eventHitOffsets[event.id].forEach((offset,index) => cue(delay + offset,() => setStability(current => applyEventHit(current,event,index)))); cue(delay + 800,() => setBattleEvents(current => current.some(item => item.id === event.id) ? current : [...current,event])); cue(delay + 1650,() => setActiveEvent(current => current?.id === event.id ? null : current)); };
    cue(850,() => setPhase('countdown')); cue(1300,() => setCount(2)); cue(1750,() => setCount(1)); cue(2200,() => setPhase('launch')); cue(3000,() => setPhase('chase')); cue(4700,() => setPhase('impact'));
    if (roundEvents[0]) triggerEvent(roundEvents[0],4700); else cue(5300,() => setStability(createHitStability(1)));
    if (roundEvents[1]) triggerEvent(roundEvents[1],6900); else cue(6800,() => setStability(createHitStability(2))); cue(8700,() => roundEvents.length ? setStability(current => ({ player:Math.max(8,current.player - randomBetween(3,8)),enemy:Math.max(8,current.enemy - randomBetween(3,8)) })) : setStability(createHitStability(3)));
    cue(10150,() => { setStability(previous => { const finalStability = createFinalStability(selectedOutcome,previous,lastFinalStability.current); lastFinalStability.current = finalStability; return finalStability; }); setPhase('outcome'); });
    const resultAt = 11750; cue(resultAt,() => { setPhase('result'); setSettlementStep(0); }); const stageDelay = roundEvents.length ? 560 : 430; roundEvents.forEach((_,index) => cue(resultAt + stageDelay * (index + 1),() => setSettlementStep(index + 1))); const finalStep = roundEvents.length + 1; cue(resultAt + stageDelay * finalStep,() => setSettlementStep(finalStep)); cue(resultAt + stageDelay * (finalStep + 1),() => { setSettlementStep(finalStep + 1); setBalance(value => value + finalPayout); if (selectedOutcome === 'lose') setSettlementDone(true); }); if (selectedOutcome !== 'lose') cue(resultAt + stageDelay * (finalStep + 2),() => { setSettlementStep(finalStep + 2); setSettlementDone(true); });
  };

  const changeBet = () => { clearTimers(); setActiveEvent(null); setPhase('lobby'); }; const selectBet = (value:number) => { setBet(value); setBetInput(String(value)); setNotice(''); };
  const editBet = (raw:string) => { setBetInput(raw); const value = Math.floor(Number(raw)); if (raw !== '' && Number.isFinite(value) && value > 0) { setBet(Math.max(1,Math.min(balance,value))); setNotice(''); } };
  const confirmBet = () => { const value = Math.max(1,Math.min(balance,Math.floor(Number(betInput)) || 1)); setBet(value); setBetInput(String(value)); };
  const updateManualEvent = (index:number,value:EventId | 'none') => { setManualEvents(current => { const next = [...current]; next[index] = value; const other = index === 0 ? 1 : 0; if (value !== 'none' && (next[other] === value || (next[other] !== 'none' && eventConflicts(value,next[other] as EventId)))) next[other] = 'none'; return next; }); };

  const baseMultiplier = outcomeInfo[outcome].multiplier; const eventBonus = outcome === 'lose' ? 0 : selectedEvents.reduce((sum,event) => sum + event.bonus,0); const finalMultiplier = baseMultiplier + eventBonus; const payout = Math.round(bet * finalMultiplier); const rating = getRating(outcome,selectedEvents); const revealedEvents = Math.min(selectedEvents.length,settlementStep); const displayedMultiplier = outcome === 'lose' ? 0 : baseMultiplier + selectedEvents.slice(0,revealedEvents).reduce((sum,event) => sum + event.bonus,0); const finalStep = selectedEvents.length + 1; const battlePhase = ['chase','impact','outcome'].includes(phase);

  return <main ref={shell} className={`game-shell phase-${phase} outcome-${outcome}${activeEvent ? ` event-active event-${activeEvent.id}` : ''}`} style={{ '--player-top-image':`url("${assetBase}/tops/player-red.png")`,'--enemy-top-image':`url("${assetBase}/tops/enemy-blue.png")`,'--p-stop-1-x':`${motionStops.p1x}px`,'--p-stop-1-y':`${motionStops.p1y}px`,'--e-stop-1-x':`${motionStops.e1x}px`,'--e-stop-1-y':`${motionStops.e1y}px`,'--p-stop-2-x':`${motionStops.p2x}px`,'--p-stop-2-y':`${motionStops.p2y}px`,'--e-stop-2-x':`${motionStops.e2x}px`,'--e-stop-2-y':`${motionStops.e2y}px`,'--p-stop-3-x':`${motionStops.p3x}px`,'--p-stop-3-y':`${motionStops.p3y}px`,'--e-stop-3-x':`${motionStops.e3x}px`,'--e-stop-3-y':`${motionStops.e3y}px` } as CSSProperties}>
    <header className="topbar"><div className="brand-mark"><span>B</span></div><div className="brand-title">戰鬥陀螺 <em>V2</em></div><div className="balance-pill"><span>目前餘額</span><strong>{balance.toLocaleString()}</strong></div></header>
    {phase === 'lobby' && <section className="lobby" aria-label="投入選擇"><div className="versus-card"><div className="fighter player-fighter"><div className="mini-top red"><span /></div><small>我方戰鬥陀螺</small></div><div className="vs-badge">VS</div><div className="fighter enemy-fighter"><div className="mini-top purple"><span /></div><small>敵方戰鬥陀螺</small></div></div><div className="control-deck"><div className="deck-heading"><span>選擇投入</span><small>虛擬測試點數</small></div><div className="bet-grid">{bets.map(value => <button key={value} className={bet === value ? 'active' : ''} onClick={() => selectBet(value)}><b>{value}</b></button>)}</div><label className="custom-bet"><span>自訂投入</span><input type="number" min="1" max={balance} step="1" inputMode="numeric" value={betInput} onChange={event => editBet(event.target.value)} onBlur={confirmBet} aria-label="自訂投入金額" /></label><button className="battle-button" onClick={startBattle} disabled={balance < bet}><span>開始對戰</span><i>投入 {bet}</i></button>{notice && <p className="notice" role="alert">{notice}</p>}</div></section>}
    {(phase === 'intro' || phase === 'countdown') && <section className="faceoff"><div className="faceoff-label player-faceoff-label">我方戰鬥陀螺</div><div className="faceoff-label enemy-faceoff-label">敵方戰鬥陀螺</div><div className="faceoff-side red-side"><div className="faceoff-top red-faceoff-top"><span /></div></div><div className="faceoff-center">{phase === 'intro' ? <b>VS</b> : <b className="countdown" key={count}>{count}</b>}</div><div className="faceoff-impact"><i /><i /><i /><i /></div><div className="faceoff-side purple-side"><div className="faceoff-top purple-faceoff-top"><span /></div></div></section>}
    {phase === 'launch' && <section className="launch-view"><div className="speed-lines" /><div className="launcher"><div className="launcher-core" /><div className="grip" /></div><div className="hand left-hand" /><div className="hand right-hand" /><div className="launcher enemy-launcher"><div className="launcher-core enemy-launcher-core" /><div className="grip enemy-grip" /></div><div className="hand enemy-hand" /><strong>發射！</strong></section>}
    {battlePhase && <section className="battle-view"><div className="battle-hud player-hud"><span>我方戰鬥陀螺</span><b>{stability.player}%</b><i><em style={{ width:`${stability.player}%` }} /></i></div><div className="battle-hud enemy-hud"><span>敵方戰鬥陀螺</span><b>{stability.enemy}%</b><i><em style={{ width:`${stability.enemy}%` }} /></i></div><div className="round-events"><strong>本局事件</strong>{battleEvents.length === 0 ? <small>等待事件</small> : battleEvents.map(event => <span key={event.id}>{event.label}<b>+{event.bonus.toFixed(1)}倍</b></span>)}</div><div className="arena-wrap"><div className="arena"><div className="arena-grid" /><div className="arena-ring ring-a" /><div className="arena-ring ring-b" /><div className="battle-top player-top"><span className="top-core" /></div><div className="battle-top enemy-top"><span className="top-core" /></div><div className="impact-flash" /><div className="shockwave" /><div className="collision-sparks">{Array.from({ length:18 },(_,n) => <i key={n} />)}</div><div className="event-rail" /><div className="finish-effect" /><div className="debris">{Array.from({ length:10 },(_,n) => <i key={n} />)}</div></div></div>{activeEvent && <div className="event-announcement" key={activeEvent.id}><small>{activeEvent.rarity === 'rare' ? 'RARE EVENT' : 'BATTLE EVENT'}</small><strong>{activeEvent.label}！</strong><b>+{activeEvent.bonus.toFixed(1)} 倍</b></div>}{phase === 'chase' && <div className="phase-label">高速追擊</div>}{phase === 'outcome' && <div className="outcome-call"><small>{outcomeInfo[outcome].kicker}</small><strong>{outcomeInfo[outcome].label}</strong></div>}</section>}
    {phase === 'result' && <section className={`result-panel v2-result ${outcome === 'lose' ? 'loss' : ''}`}><h2>{outcome === 'lose' ? outcomeInfo[outcome].kicker : outcomeInfo[outcome].label}</h2><div className="settlement-stack"><div className="settlement-base"><span>基礎結果</span><b>{baseMultiplier.toFixed(1)}×</b></div>{selectedEvents.map((event,index) => <div key={event.id} className={`settlement-event ${settlementStep > index ? 'shown' : ''} ${outcome === 'lose' ? 'disabled' : ''}`}><span>{event.label}</span><b>+{event.bonus.toFixed(1)}倍</b>{outcome === 'lose' && <small>勝利後生效</small>}</div>)}</div><div className={`multiplier final-multiplier ${settlementStep >= finalStep ? 'shown' : ''}`}><span>{settlementStep >= finalStep ? '最終倍率' : '目前倍率'}</span><strong key={displayedMultiplier}>{displayedMultiplier.toFixed(1)}×</strong></div><div className={`final-payout ${settlementStep >= finalStep + 1 ? 'shown' : ''}`}><span>最終獎勵</span><strong>+{payout.toLocaleString()}</strong></div>{outcome !== 'lose' && <div className={`battle-rating rating-${rating.toLowerCase()} ${settlementDone ? 'shown' : ''}`}><small>戰鬥評級</small><strong>{rating}</strong><span>{ratingCopy[rating]}</span></div>}{settlementDone && <div className="result-actions"><button className="battle-button" onClick={startBattle} disabled={balance < bet}><span>再戰一次</span><i>{bet}</i></button><button className="secondary-button" onClick={changeBet}>更換投注</button></div>}</section>}
    <aside className="test-panel v2-test-panel"><label htmlFor="result-mode">DEMO 測試模式</label><select id="result-mode" aria-label="指定結果" value={forced} onChange={e => setForced(e.target.value as 'auto' | Outcome)} disabled={phase !== 'lobby' && phase !== 'result'}><option value="auto">自動結果</option><option value="spin">指定停轉勝利</option><option value="ringout">指定擊飛勝利</option><option value="burst">指定裝甲擊破</option><option value="perfect">指定完美擊破</option><option value="lose">指定敗北</option></select><select aria-label="事件模式" value={eventMode} onChange={e => setEventMode(e.target.value as EventMode)} disabled={phase !== 'lobby' && phase !== 'result'}><option value="auto">自動事件</option><option value="none">無事件</option><option value="manual">指定事件</option></select>{eventMode === 'manual' && <><select aria-label="指定事件一" value={manualEvents[0]} onChange={e => updateManualEvent(0,e.target.value as EventId | 'none')} disabled={phase !== 'lobby' && phase !== 'result'}><option value="none">事件 1</option>{eventOptions.map(event => <option key={event.id} value={event.id}>{event.label}</option>)}</select><select aria-label="指定事件二" value={manualEvents[1]} onChange={e => updateManualEvent(1,e.target.value as EventId | 'none')} disabled={phase !== 'lobby' && phase !== 'result'}><option value="none">事件 2</option>{eventOptions.map(event => <option key={event.id} value={event.id}>{event.label}</option>)}</select></>}<button onClick={() => { clearTimers(); setBalance(10000); setPhase('lobby'); setNotice('點數已重置'); }}>重置點數</button></aside>
  </main>;
}
