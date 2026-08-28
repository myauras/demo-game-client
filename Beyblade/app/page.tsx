'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type Outcome = 'spin' | 'ringout' | 'burst' | 'perfect' | 'lose';
type Phase = 'lobby' | 'intro' | 'countdown' | 'launch' | 'chase' | 'impact' | 'suspense' | 'final' | 'outcome' | 'result';
type MotionStops = { p1x:number; p1y:number; e1x:number; e1y:number; p2x:number; p2y:number; e2x:number; e2y:number };
type Stability = { player:number; enemy:number };

const initialMotion: MotionStops = { p1x:-108,p1y:52,e1x:108,e1y:-52,p2x:-98,p2y:-56,e2x:98,e2y:56 };
const randomBetween = (min:number,max:number) => Math.round(min + Math.random() * (max - min));
const randomDifferent = (min:number,max:number,previous:number) => {
  let value = randomBetween(min,max);
  if (value === previous) value = value < max ? value + 1 : value - 1;
  return value;
};
const createMotionStops = (): MotionStops => ({
  p1x:-randomBetween(88,126), p1y:randomBetween(34,70),
  e1x:randomBetween(88,126), e1y:-randomBetween(34,70),
  p2x:-randomBetween(82,120), p2y:-randomBetween(32,72),
  e2x:randomBetween(82,120), e2y:randomBetween(32,72),
});
const createHitStability = (hit:number): Stability => {
  const ranges = [[78,94],[56,75],[34,53]];
  const [min,max] = ranges[hit - 1];
  const player = randomBetween(min,max);
  let enemy = randomBetween(min,max);
  if (Math.abs(player - enemy) < 3) enemy = enemy + 4 <= max ? enemy + 4 : enemy - 4;
  return { player,enemy };
};
const createFinalStability = (result:Outcome,previous:Stability): Stability => result === 'lose'
  ? { player:randomDifferent(0,7,previous.player),enemy:randomDifferent(18,46,previous.enemy) }
  : { player:randomDifferent(14,42,previous.player),enemy:randomDifferent(0,7,previous.enemy) };

const bets = [10, 50, 100, 200];
const outcomeInfo: Record<Outcome, { label: string; kicker: string; multiplier: number }> = {
  spin: { label: '停轉勝利', kicker: '最後旋轉！', multiplier: 1.8 },
  ringout: { label: '擊飛勝利', kicker: '擊飛！', multiplier: 3 },
  burst: { label: '裝甲擊破', kicker: '完全勝利', multiplier: 5 },
  perfect: { label: '完美擊破', kicker: '完美勝利', multiplier: 10 },
  lose: { label: '對戰失敗', kicker: '再接再厲！', multiplier: 0 },
};

const phaseCopy: Partial<Record<Phase, string>> = {
  chase: '高速追擊', impact: '強力碰撞', suspense: '誰能轉到最後？', final: 'FINAL CLASH',
};

export default function Home() {
  const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const [balance, setBalance] = useState(10000);
  const [bet, setBet] = useState(10);
  const [betInput, setBetInput] = useState('10');
  const [phase, setPhase] = useState<Phase>('lobby');
  const [count, setCount] = useState(3);
  const [forced, setForced] = useState<'auto' | Outcome>('auto');
  const [outcome, setOutcome] = useState<Outcome>('spin');
  const [notice, setNotice] = useState('');
  const [motionStops, setMotionStops] = useState<MotionStops>(initialMotion);
  const [stability, setStability] = useState<Stability>({ player:100,enemy:100 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const shell = useRef<HTMLElement>(null);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);
  useEffect(() => { if (shell.current) shell.current.scrollTop = 0; }, [phase]);

  const pickOutcome = (): Outcome => {
    if (forced !== 'auto') return forced;
    const roll = Math.random();
    if (roll < .36) return 'lose';
    if (roll < .68) return 'spin';
    if (roll < .84) return 'ringout';
    if (roll < .96) return 'burst';
    return 'perfect';
  };

  const startBattle = () => {
    if (balance < bet) { setNotice('點數不足，請選擇較低投入'); return; }
    clearTimers(); setNotice('');
    const selected = pickOutcome();
    setOutcome(selected); setMotionStops(createMotionStops()); setStability({ player:100,enemy:100 }); setBalance(value => value - bet); setCount(3); setPhase('intro');
    const cue = (delay: number, action: () => void) => timers.current.push(setTimeout(action, delay));
    cue(850, () => setPhase('countdown')); cue(1300, () => setCount(2)); cue(1750, () => setCount(1));
    cue(2200, () => setPhase('launch')); cue(3000, () => setPhase('chase')); cue(4550, () => setPhase('impact'));
    cue(5150, () => setStability(createHitStability(1))); cue(6650, () => setStability(createHitStability(2))); cue(8550, () => setStability(createHitStability(3)));
    cue(9550, () => { setStability(previous => createFinalStability(selected,previous)); setPhase('outcome'); });
    cue(11250, () => { setBalance(value => value + Math.round(bet * outcomeInfo[selected].multiplier)); setPhase('result'); });
  };

  const changeBet = () => { clearTimers(); setPhase('lobby'); };
  const selectBet = (value: number) => { setBet(value); setBetInput(String(value)); setNotice(''); };
  const editBet = (raw: string) => {
    setBetInput(raw);
    const value = Math.floor(Number(raw));
    if (raw !== '' && Number.isFinite(value) && value > 0) {
      setBet(Math.max(1, Math.min(balance, value)));
      setNotice('');
    }
  };
  const confirmBet = () => {
    const value = Math.max(1, Math.min(balance, Math.floor(Number(betInput)) || 1));
    setBet(value); setBetInput(String(value));
  };
  const payout = Math.round(bet * outcomeInfo[outcome].multiplier);
  const battlePhase = !['lobby', 'intro', 'countdown', 'launch', 'result'].includes(phase);

  return (
    <main
      ref={shell}
      className={`game-shell phase-${phase} outcome-${outcome}`}
      style={{
        '--player-top-image': `url("${assetBase}/tops/player-red.png")`,
        '--enemy-top-image': `url("${assetBase}/tops/enemy-blue.png")`,
        '--p-stop-1-x': `${motionStops.p1x}px`, '--p-stop-1-y': `${motionStops.p1y}px`,
        '--e-stop-1-x': `${motionStops.e1x}px`, '--e-stop-1-y': `${motionStops.e1y}px`,
        '--p-stop-2-x': `${motionStops.p2x}px`, '--p-stop-2-y': `${motionStops.p2y}px`,
        '--e-stop-2-x': `${motionStops.e2x}px`, '--e-stop-2-y': `${motionStops.e2y}px`,
      } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand-mark"><span>B</span></div>
        <div className="brand-title">戰鬥陀螺</div>
        <div className="balance-pill"><span>目前餘額</span><strong>{balance.toLocaleString()}</strong></div>
      </header>

      {phase === 'lobby' && <section className="lobby" aria-label="投入選擇">
        <div className="versus-card">
          <div className="fighter player-fighter"><div className="mini-top red"><span /></div><small>我方戰鬥陀螺</small></div>
          <div className="vs-badge">VS</div>
          <div className="fighter enemy-fighter"><div className="mini-top purple"><span /></div><small>敵方戰鬥陀螺</small></div>
        </div>
        <div className="control-deck">
          <div className="deck-heading"><span>選擇投入</span><small>虛擬測試點數</small></div>
          <div className="bet-grid">{bets.map(value => <button key={value} className={bet === value ? 'active' : ''} onClick={() => selectBet(value)}><b>{value}</b></button>)}</div>
          <label className="custom-bet"><span>自訂投入</span><input type="number" min="1" max={balance} step="1" inputMode="numeric" value={betInput} onChange={event => editBet(event.target.value)} onBlur={confirmBet} aria-label="自訂投入金額" /></label>
          <button className="battle-button" onClick={startBattle} disabled={balance < bet}><span>開始對戰</span><i>投入 {bet}</i></button>
          {notice && <p className="notice" role="alert">{notice}</p>}
        </div>
      </section>}

      {(phase === 'intro' || phase === 'countdown') && <section className="faceoff">
        <div className="faceoff-label player-faceoff-label">我方戰鬥陀螺</div>
        <div className="faceoff-label enemy-faceoff-label">敵方戰鬥陀螺</div>
        <div className="faceoff-side red-side"><div className="faceoff-top red-faceoff-top"><span /></div></div>
        <div className="faceoff-center">{phase === 'intro' ? <b>VS</b> : <b className="countdown" key={count}>{count}</b>}</div>
        <div className="faceoff-impact"><i /><i /><i /><i /></div>
        <div className="faceoff-side purple-side"><div className="faceoff-top purple-faceoff-top"><span /></div></div>
      </section>}

      {phase === 'launch' && <section className="launch-view"><div className="speed-lines" /><div className="launcher"><div className="launcher-core" /><div className="grip" /></div><div className="hand left-hand" /><div className="hand right-hand" /><div className="launcher enemy-launcher"><div className="launcher-core enemy-launcher-core" /><div className="grip enemy-grip" /></div><div className="hand enemy-hand" /><strong>發射！</strong></section>}

      {battlePhase && <section className="battle-view">
        <div className="battle-hud player-hud"><span>我方戰鬥陀螺</span><b>{stability.player}%</b><i><em style={{ width: `${stability.player}%` }} /></i></div>
        <div className="battle-hud enemy-hud"><span>敵方戰鬥陀螺</span><b>{stability.enemy}%</b><i><em style={{ width: `${stability.enemy}%` }} /></i></div>
        <div className="arena-wrap"><div className="arena"><div className="arena-grid" /><div className="arena-ring ring-a" /><div className="arena-ring ring-b" /><div className="trail player-trail" /><div className="trail enemy-trail" /><div className="battle-top player-top"><span className="top-core" /></div><div className="battle-top enemy-top"><span className="top-core" /></div><div className="impact-flash" /><div className="shockwave" /><div className="collision-sparks">{Array.from({ length: 12 }, (_, n) => <i key={n} />)}</div><div className="finish-effect" /><div className="debris">{Array.from({ length: 10 }, (_, n) => <i key={n} />)}</div></div></div>
        {phaseCopy[phase] && <div className="phase-label">{phaseCopy[phase]}</div>}
        {phase === 'outcome' && <div className="outcome-call"><small>{outcomeInfo[outcome].kicker}</small><strong>{outcomeInfo[outcome].label}</strong></div>}
      </section>}

      {phase === 'result' && <section className={`result-panel ${outcome === 'lose' ? 'loss' : ''}`}>
        {outcome !== 'lose' && outcome !== 'spin' && <p>{outcomeInfo[outcome].kicker}</p>}
        <h2 className={outcome === 'lose' || outcome === 'spin' ? 'emphasis' : ''}>{outcome === 'lose' ? outcomeInfo[outcome].kicker : outcomeInfo[outcome].label}</h2>
        <div className="multiplier"><span>獎勵倍率</span><strong>{outcomeInfo[outcome].multiplier}×</strong></div>
        <div className="result-ledger"><div><span>本局投入</span><b>{bet}</b></div><div><span>獲得獎勵</span><b className="gain">+{payout}</b></div></div>
        <button className="battle-button" onClick={startBattle} disabled={balance < bet}><span>再戰一次</span><i>{bet}</i></button>
        <button className="secondary-button" onClick={changeBet}>更換投注</button>
      </section>}

      <aside className="test-panel"><label htmlFor="result-mode">DEMO 測試模式</label><select id="result-mode" value={forced} onChange={e => setForced(e.target.value as 'auto' | Outcome)} disabled={phase !== 'lobby' && phase !== 'result'}><option value="auto">自動結果</option><option value="spin">指定停轉勝利</option><option value="ringout">指定擊飛勝利</option><option value="burst">指定裝甲擊破</option><option value="perfect">指定完美擊破</option><option value="lose">指定敗北</option></select><button onClick={() => { clearTimers(); setBalance(10000); setPhase('lobby'); setNotice('點數已重置'); }}>重置點數</button></aside>
    </main>
  );
}
