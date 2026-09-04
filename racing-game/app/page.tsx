"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type GameState = "setup" | "racing" | "duel" | "settling" | "won" | "lost" | "cashed";
type DuelPhase = "idle" | "race" | "player-win" | "collision" | "opponent-win";
type PassDirection = "left" | "right";
type TestOutcome = "auto" | "win" | "lose";
type ResultState = "won" | "cashed";
type MilestoneId = "topFive" | "podium" | "champion";

type EventAlert = { title: string; subtitle: string; tone: "cyan" | "gold" | "red"; variant: "panel" | "streak" | "special"; countUpValue?: number };
type QueuedNotice = { kind: "event"; alert: EventAlert } | { kind: "champion" };
type ActiveNotice = QueuedNotice & { id: number; slot: number };
type SettlementRow = { key: "rank" | "streak" | "milestone"; label: string; detail?: string; amount: number; total: number; displayAmount: string };
type SettlementData = { place: number; rows: SettlementRow[]; totalMultiplier: number; reward: number };

const GAME_CONFIG = {
  targetRtp: 0.95,
  rankMultipliers: { 8: 1, 7: 1.2, 6: 1.5, 5: 1.9, 4: 2.5, 3: 3.5, 2: 5, 1: 10 } as Record<number, number>,
  streakBonuses: { 0: 0, 1: 0, 2: 0.2, 3: 0.4, 4: 0.6, 5: 1, 6: 1.5 } as Record<number, number>,
  milestones: {
    topFive: { place: 5, title: "殺入前五！", previewTitle: "殺進前五", label: "前五里程碑", minBonus: 0.1, maxBonus: 0.4 },
    podium: { place: 3, title: "晉升前三！", previewTitle: "晉升前三", label: "前三里程碑", minBonus: 0.4, maxBonus: 0.8 },
    champion: { place: 1, title: "奪得冠軍！", previewTitle: "競爭冠軍", label: "冠軍里程碑", minBonus: 0.8, maxBonus: 1.5 },
  } as Record<MilestoneId, { place: number; title: string; previewTitle: string; label: string; minBonus: number; maxBonus: number }>,
};
const rankMultipliers = GAME_CONFIG.rankMultipliers;
const milestoneEntries = Object.entries(GAME_CONFIG.milestones) as [MilestoneId, (typeof GAME_CONFIG.milestones)[MilestoneId]][];
const milestoneByPlace: Record<number, MilestoneId> = { 5: "topFive", 3: "podium", 1: "champion" };
const defaultMilestoneRewards: Record<MilestoneId, number> = { topFive: 0.1, podium: 0.4, champion: 0.8 };
const rollMilestoneBonus = (min: number, max: number) => (Math.floor(Math.random() * (Math.round((max - min) * 10) + 1)) + Math.round(min * 10)) / 10;
const createMilestoneRewards = (): Record<MilestoneId, number> => ({
  topFive: rollMilestoneBonus(0.1, 0.4),
  podium: rollMilestoneBonus(0.4, 0.8),
  champion: rollMilestoneBonus(0.8, 1.5),
});

const opponentColors = ["#ff3b5f", "#9a6cff", "#22d3ee", "#3cff9b", "#ff8a34", "#e6f0ff", "#ffd02f"];
const opponentHues: Record<string, number> = { "#ff3b5f": 18, "#9a6cff": 65, "#22d3ee": 145, "#3cff9b": 205, "#ff8a34": 315, "#e6f0ff": 110, "#ffd02f": 280 };
const assetBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const credit = (value: number) => value.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const multiplierLabel = (value: number) => Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0$/, "");
const settlementMultiplierLabel = (value: number) => `${Number.isInteger(value) ? value.toFixed(1) : multiplierLabel(value)}倍`;
function AnimatedMultiplier({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => setDisplayValue(value));
      return () => window.cancelAnimationFrame(frame);
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 620);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Number((value * eased).toFixed(1)));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return <>+{settlementMultiplierLabel(displayValue)}</>;
}

export default function Home() {
  const [bet, setBet] = useState(10);
  const [place, setPlace] = useState(8);
  const [multiplier, setMultiplier] = useState(1);
  const [state, setState] = useState<GameState>("setup");
  const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
  const [normalCrash, setNormalCrash] = useState(false);
  const [testRun, setTestRun] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testOutcome, setTestOutcome] = useState<TestOutcome>("auto");
  const [isPassing, setIsPassing] = useState(false);
  const [passDirection, setPassDirection] = useState<PassDirection>("right");
  const [soundOn, setSoundOn] = useState(true);
  const [balance, setBalance] = useState(12800);
  const [opponentOrder, setOpponentOrder] = useState(opponentColors);
  const [streak, setStreak] = useState(0);
  const [highestStreak, setHighestStreak] = useState(0);
  const [milestones, setMilestones] = useState<MilestoneId[]>([]);
  const [milestoneRewards, setMilestoneRewards] = useState<Record<MilestoneId, number>>(defaultMilestoneRewards);
  const [testNextOutcome, setTestNextOutcome] = useState<TestOutcome>("auto");
  const [duelDistance, setDuelDistance] = useState(40);
  const [streakPulse, setStreakPulse] = useState(false);
  const [activeNotices, setActiveNotices] = useState<ActiveNotice[]>([]);
  const [settlement, setSettlement] = useState<SettlementData | null>(null);
  const [settlementStep, setSettlementStep] = useState(0);
  const [settlementComplete, setSettlementComplete] = useState(false);
  const [noticeLocked, setNoticeLocked] = useState(false);
  const noticeId = useRef(0);
  const noticeTimers = useRef<number[]>([]);

  const progress = ((8 - place) / 7) * 100;
  const nextPlace = Math.max(1, place - 1);
  const nextMultiplier = rankMultipliers[nextPlace];
  const activeOpponentColor = place > 1 ? opponentOrder[place - 2] : opponentOrder[0];
  const streakBonus = GAME_CONFIG.streakBonuses[Math.min(highestStreak, 6)];
  const milestoneBonus = milestones.reduce((total, id) => total + milestoneRewards[id], 0);
  const claimSubtotal = multiplier + streakBonus + milestoneBonus;
  const claimMultiplier = Number(claimSubtotal.toFixed(2));
  const claimAmount = Number((bet * claimMultiplier).toFixed(2));
  const standings = useMemo(() => [
    { id: "player", rank: place, color: "#20e0ff", isPlayer: true },
    ...opponentOrder.map((color, index) => {
      const startingRank = index + 1;
      return { id: `opponent-${startingRank}`, rank: startingRank >= place ? startingRank + 1 : startingRank, color, isPlayer: false };
    }),
  ], [place, opponentOrder]);
  const nextStreak = Math.min(6, streak + 1);
  const nextStreakBonus = GAME_CONFIG.streakBonuses[nextStreak];
  const nextMilestone = milestoneEntries.find(([id, item]) => item.place === nextPlace && !milestones.includes(id));

  const queueNotices = (notices: QueuedNotice[]) => {
    if (notices.length === 0) return;
    setNoticeLocked(true);
    let panelSlot = 0;
    let streakSlot = 0;
    let latestNoticeEnd = 0;
    notices.forEach((notice, index) => {
      const id = noticeId.current + 1;
      noticeId.current = id;
      const isStreakNotice = notice.kind === "event" && notice.alert.variant === "streak";
      const isSpecialNotice = notice.kind === "event" && notice.alert.variant === "special";
      const noticeDuration = isStreakNotice ? 900 : isSpecialNotice ? 1200 : 1500;
      const slot = isStreakNotice ? streakSlot++ : panelSlot++;
      latestNoticeEnd = Math.max(latestNoticeEnd, index * 500 + noticeDuration);
      const showTimer = window.setTimeout(() => {
        setActiveNotices((current) => [...current, { ...notice, id, slot }]);
        const hideTimer = window.setTimeout(() => {
          setActiveNotices((current) => current.filter((activeNotice) => activeNotice.id !== id));
        }, noticeDuration);
        noticeTimers.current.push(hideTimer);
      }, index * 500);
      noticeTimers.current.push(showTimer);
    });
    const unlockTimer = window.setTimeout(() => setNoticeLocked(false), latestNoticeEnd + 50);
    noticeTimers.current.push(unlockTimer);
  };

  const beginSettlement = (resultPlace: number, resultState: ResultState, maxStreak: number, earnedMilestones = milestones) => {
    const base = rankMultipliers[resultPlace];
    const bestStreak = Math.min(maxStreak, 6);
    const bestStreakBonus = GAME_CONFIG.streakBonuses[bestStreak];
    const rows: SettlementRow[] = [];
    let runningTotal = base;
    rows.push({ key: "rank", label: "最終名次", detail: `第${resultPlace}名`, amount: base, total: runningTotal, displayAmount: settlementMultiplierLabel(base) });
    if (bestStreakBonus > 0) {
      runningTotal += bestStreakBonus;
      rows.push({ key: "streak", label: "最高連超", detail: `${bestStreak}連超`, amount: bestStreakBonus, total: runningTotal, displayAmount: `+${settlementMultiplierLabel(bestStreakBonus)}` });
    }
    earnedMilestones.forEach((id, index) => {
      const item = GAME_CONFIG.milestones[id];
      const earnedBonus = milestoneRewards[id];
      runningTotal += earnedBonus;
      rows.push({ key: "milestone", label: index === 0 ? "里程碑" : "", detail: item.title.replace("！", ""), amount: earnedBonus, total: runningTotal, displayAmount: `+${settlementMultiplierLabel(earnedBonus)}` });
    });
    const totalMultiplier = Number(runningTotal.toFixed(2));
    const reward = Number((bet * totalMultiplier).toFixed(2));
    setSettlement({ place: resultPlace, rows, totalMultiplier, reward });
    setSettlementStep(1);
    setSettlementComplete(false);
    setState("settling");
    rows.slice(1).forEach((_, index) => window.setTimeout(() => setSettlementStep(index + 2), (index + 1) * 450));
    window.setTimeout(() => {
      setSettlementComplete(true);
      setBalance((value) => value + reward);
      setMultiplier(totalMultiplier);
      setState(resultState);
    }, Math.max(900, rows.length * 450 + 450));
  };

  const startRace = () => {
    if (balance < bet || bet < 10) return;
    setBalance((value) => value - bet);
    setPlace(8);
    setMultiplier(1);
    setState("racing");
    setStreak(0);
    setHighestStreak(0);
    setMilestones([]);
    setMilestoneRewards(createMilestoneRewards());
    setTestNextOutcome("auto");
    setDuelDistance(40);
    setActiveNotices([]);
    setNormalCrash(false);
    setSettlement(null);
    setSettlementComplete(false);
    setShowTestPanel(false);
    setOpponentOrder((currentOrder) => {
      const shuffled = [...currentOrder];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      if (shuffled.every((color, index) => color === currentOrder[index])) shuffled.push(shuffled.shift()!);
      return shuffled;
    });
  };

  const overtake = () => {
    if (state !== "racing" || isPassing || noticeLocked || place <= 2) return;
    setIsPassing(true);
    setPassDirection(Math.random() < 0.5 ? "left" : "right");
    const successRate = place === 8 ? GAME_CONFIG.targetRtp / nextMultiplier : multiplier / nextMultiplier;
    const forcedOutcome = testNextOutcome;
    setTestNextOutcome("auto");
    if (forcedOutcome === "lose" || (forcedOutcome !== "win" && !testRun && Math.random() >= successRate)) {
      setNormalCrash(true);
      window.setTimeout(() => { setNormalCrash(false); setIsPassing(false); setState("lost"); }, 1180);
      return;
    }
    const newStreak = Math.min(6, streak + 1);
    window.setTimeout(() => {
      setPlace(nextPlace);
      setMultiplier(nextMultiplier);
      setStreak(newStreak);
      setHighestStreak((value) => Math.max(value, newStreak));
      setIsPassing(false);
      const notices: QueuedNotice[] = [];
      if (nextPlace !== 2) {
        const usesSpecialRankText = [5, 3].includes(nextPlace);
        notices.push({ kind: "event", alert: usesSpecialRankText
          ? { title: `第${nextPlace}名！`, subtitle: `+${settlementMultiplierLabel(milestoneRewards[milestoneByPlace[nextPlace]])}`, tone: "gold", variant: "special", countUpValue: milestoneRewards[milestoneByPlace[nextPlace]] }
          : { title: `第${place}名 ↑ 第${nextPlace}名！`, subtitle: `${settlementMultiplierLabel(multiplier)} → ${settlementMultiplierLabel(nextMultiplier)}`, tone: nextPlace <= 3 ? "gold" : "cyan", variant: "panel" } });
      }
      notices.push({ kind: "event", alert: { title: `${newStreak}連超！`, subtitle: `+${multiplierLabel(GAME_CONFIG.streakBonuses[newStreak])}倍`, tone: newStreak >= 5 ? "red" : "cyan", variant: "streak" } });
      const reachedMilestone = milestoneEntries.find(([id, item]) => item.place === nextPlace && !milestones.includes(id));
      if (reachedMilestone) {
        const [id] = reachedMilestone;
        setMilestones((current) => [...current, id]);
      }
      const upcomingMilestone = milestoneEntries.find(([id, item]) => item.place === nextPlace - 1 && !milestones.includes(id));
      if (upcomingMilestone) {
        const [, item] = upcomingMilestone;
        notices.push({ kind: "event", alert: { title: item.previewTitle, subtitle: `+${multiplierLabel(item.minBonus)}～+${multiplierLabel(item.maxBonus)}倍`, tone: "gold", variant: "panel" } });
      }
      if (newStreak >= 3) {
        setStreakPulse(true);
        window.setTimeout(() => setStreakPulse(false), 650);
      }
      if (nextPlace === 2) {
        setTestRun(false);
      }
      queueNotices(notices);
    }, 1600);
  };

  const challengeChampion = () => {
    if (state !== "racing" || place !== 2 || isPassing || noticeLocked) return;
    setState("duel");
    setIsPassing(true);
    setDuelPhase("race");
    setDuelDistance(40);
    setActiveNotices([]);
    [30, 20, 10, 5].forEach((distance, index) => window.setTimeout(() => setDuelDistance(distance), (index + 1) * 180));
    window.setTimeout(() => {
      const success = testOutcome === "win" ? true : testOutcome === "lose" ? false : Math.random() < rankMultipliers[2] / rankMultipliers[1];
      if (success) {
        const nextStreak = Math.min(6, streak + 1);
        const championMilestones = milestones.includes("champion") ? milestones : [...milestones, "champion" as MilestoneId];
        setDuelPhase("player-win");
        setStreak(nextStreak);
        setHighestStreak((value) => Math.max(value, nextStreak));
        const championNotices: QueuedNotice[] = [{ kind: "event", alert: { title: "第1名！", subtitle: `+${settlementMultiplierLabel(milestoneRewards.champion)}`, tone: "gold", variant: "special", countUpValue: milestoneRewards.champion } }];
        queueNotices(championNotices);
        window.setTimeout(() => {
          setPlace(1);
          setMilestones(championMilestones);
          setIsPassing(false);
          beginSettlement(1, "won", Math.max(highestStreak, nextStreak), championMilestones);
        }, 1250);
      } else {
        setDuelPhase("collision");
        window.setTimeout(() => {
          setDuelPhase("opponent-win");
          window.setTimeout(() => { setIsPassing(false); setState("lost"); }, 1150);
        }, 850);
      }
    }, 900);
  };

  const cashOut = () => {
    if (state !== "racing" || multiplier <= 1 || isPassing || noticeLocked) return;
    setTestRun(false);
    beginSettlement(place, "cashed", highestStreak);
  };

  const reset = () => {
    setState("setup");
    setPlace(8);
    setMultiplier(1);
    setDuelPhase("idle");
    setActiveNotices([]);
    setNormalCrash(false);
    setTestRun(false);
    setSettlement(null);
    setSettlementStep(0);
    setSettlementComplete(false);
    setStreak(0);
    setHighestStreak(0);
    setMilestones([]);
    setMilestoneRewards(defaultMilestoneRewards);
    setTestNextOutcome("auto");
    setDuelDistance(40);
    noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
    noticeTimers.current = [];
    setNoticeLocked(false);
  };

  const primaryAction = place === 2 ? challengeChampion : overtake;
  const testButtonDisabled = state !== "setup" && (state !== "racing" || place <= 2 || isPassing);

  return (
    <main className="game-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="game-card" aria-label="決勝圈競速遊戲 V3">
        <header className="topbar">
          <div className="brand" aria-label="決勝圈極速反攻">
            <span className="brand-mark" aria-hidden="true">決</span>
            <div><strong>極速反攻</strong><small>決勝圈 V3</small></div>
            <button type="button" className={`test-button ${testRun || showTestPanel ? "active" : ""}`} onClick={() => setShowTestPanel((value) => !value)} disabled={testButtonDisabled} aria-label="開啟 V3 測試設定">V3</button>
          </div>
          <div className="topbar-center"><span />賽事系統已連線</div>
          <div className="topbar-actions"><button className="icon-button" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? "關閉音效" : "開啟音效"}>音效 {soundOn ? "開" : "關"}</button><div className="wallet"><strong>{credit(balance)}</strong></div></div>
        </header>

        {showTestPanel && (
          <div className="test-panel" aria-label="V3 測試設定">
            <div className="test-panel-title"><strong>V3 測試設定</strong><button onClick={() => setShowTestPanel(false)} aria-label="關閉測試設定">×</button></div>
            <label>冠軍結果<select value={testOutcome} onChange={(event) => setTestOutcome(event.target.value as TestOutcome)} disabled={state !== "setup"}><option value="auto">自動</option><option value="win">指定成功</option><option value="lose">指定失敗</option></select></label>
            <div className="test-streak"><span>當前連超 <b>{streak}</b></span><span>最高連超 <b>{highestStreak}</b></span></div>
            <div className="test-readout"><span>當前名次<b>第{place}名</b></span><span>連超獎勵<b>+{multiplierLabel(streakBonus)}倍</b></span><span>名次基礎<b>{settlementMultiplierLabel(multiplier)}</b></span><span>目前可領<b>{settlementMultiplierLabel(claimMultiplier)}</b></span><span>下一名次<b>{settlementMultiplierLabel(nextMultiplier)}</b></span><span>冠軍挑戰<b>{place === 2 || state === "duel" ? "已進入" : "未進入"}</b></span></div>
            <div className="test-milestones"><span>已取得里程碑</span><b>{milestones.length ? milestones.map((id) => `${GAME_CONFIG.milestones[id].title.replace("！", "")} +${settlementMultiplierLabel(milestoneRewards[id])}`).join("、") : "無"}</b><small>下次成功：{nextMilestone ? `${nextMilestone[1].title.replace("！", "")} +${multiplierLabel(nextMilestone[1].minBonus)}～+${multiplierLabel(nextMilestone[1].maxBonus)}倍` : "無里程碑"} · 連超 +{multiplierLabel(nextStreakBonus)}倍</small></div>
            {state === "racing" && place > 2 && <div className="test-force"><button onClick={() => setTestNextOutcome("win")} className={testNextOutcome === "win" ? "active" : ""}>強制下次成功</button><button onClick={() => setTestNextOutcome("lose")} className={testNextOutcome === "lose" ? "active" : ""}>強制下次失敗</button><button onClick={() => setTestRun(true)} className={testRun ? "active" : ""}>安全抵達第2名</button></div>}
          </div>
        )}

        <div className="content-grid">
          <section className={`race-scene streak-level-${Math.min(highestStreak, 6)} ${streakPulse ? "streak-pulse" : ""} ${isPassing ? "boosting" : ""} ${normalCrash ? "normal-crash" : ""} ${isPassing && state === "racing" ? `passing-${passDirection}` : ""} ${state === "duel" ? `final-duel duel-${duelPhase}` : ""}`} style={{ "--race-background": `url(${assetBase}/race-background.png)` } as React.CSSProperties}>
            <div className="city-glow" /><div className="cityline cityline-back" /><div className="cityline cityline-front" />

            {state !== "setup" && <div className="race-hud"><div className="standings-board" aria-label={`完整車輛排名，我方目前第 ${place} 名`}><div className="standings-title"><span>即時排名</span><b>8 輛車</b></div><div className="standings-list">{standings.map((entry) => <div key={entry.id} className={`standing-row ${entry.isPlayer ? "player" : ""}`} style={{ "--rank": entry.rank, "--car-color": entry.color, "--car-hue": entry.isPlayer ? "0deg" : `${opponentHues[entry.color]}deg` } as React.CSSProperties}><strong>{entry.rank}</strong><img className="standing-car" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" /><small>第{entry.rank}名</small></div>)}</div></div></div>}

            {state !== "setup" && <><div className={`scene-multiplier ${place <= 3 ? "podium" : ""}`}><span>目前可領</span><strong>×{multiplierLabel(claimMultiplier)}</strong><div className="progress-track"><i style={{ width: `${Math.max(4, progress)}%` }} /></div></div><div className={`streak-meter level-${Math.min(highestStreak, 6)}`}><span>連超</span><strong>{streak}</strong><small>+{multiplierLabel(streakBonus)}倍</small></div></>}
            {activeNotices.some((notice) => notice.kind === "champion" || notice.alert.variant === "panel") && <div className="notice-stack" aria-live="polite">{activeNotices.filter((notice) => notice.kind === "champion" || notice.alert.variant === "panel").map((notice) => notice.kind === "event" ? <div key={notice.id} className={`event-alert ${notice.alert.tone}`} style={{ "--notice-slot": notice.slot } as React.CSSProperties} role="status"><strong>{notice.alert.title}</strong><span>{notice.alert.subtitle}</span></div> : <div key={notice.id} className="champion-alert" style={{ "--notice-slot": notice.slot } as React.CSSProperties} role="status"><span>冠軍挑戰</span><strong>挑戰冠軍賽，獎勵10倍!</strong></div>)}</div>}
            {activeNotices.some((notice) => notice.kind === "event" && notice.alert.variant === "streak") && <div className="streak-notice-layer" aria-live="polite">{activeNotices.filter((notice) => notice.kind === "event" && notice.alert.variant === "streak").map((notice) => notice.kind === "event" && <div key={notice.id} className={`streak-alert ${notice.alert.tone}`} style={{ "--streak-slot": notice.slot } as React.CSSProperties} role="status"><strong>{notice.alert.title}</strong><span>{notice.alert.subtitle}</span></div>)}</div>}
            {activeNotices.some((notice) => notice.kind === "event" && notice.alert.variant === "special") && <div className="rank-special-layer" aria-live="polite">{activeNotices.filter((notice) => notice.kind === "event" && notice.alert.variant === "special").map((notice) => notice.kind === "event" && <div key={notice.id} className="rank-special" role="status"><strong>{notice.alert.title}</strong><span>{notice.alert.countUpValue === undefined ? notice.alert.subtitle : <AnimatedMultiplier value={notice.alert.countUpValue} />}</span></div>)}</div>}

            <div className="track-wrap"><div className="track"><div className="road-stream" /><div className="lane lane-one" /><div className="lane lane-two" /><div className="finish-line" />
              {state === "racing" && place > 1 && <div className={`target-kart ${normalCrash ? "crashing" : isPassing ? `being-passed pass-${passDirection}` : ""}`} style={{ "--kart-color": activeOpponentColor, "--car-hue": `${opponentHues[activeOpponentColor]}deg` } as React.CSSProperties} aria-label={`前方第 ${nextPlace} 名車輛`}><span className="target-label"><i />第{nextPlace}名</span><img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" /></div>}
              <div className="duel-champion" style={{ "--kart-color": opponentOrder[0], "--car-hue": `${opponentHues[opponentOrder[0]]}deg` } as React.CSSProperties} aria-label="第 1 名車輛"><span className="target-label"><i />🏆 冠軍・第1名</span><img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" /></div>
              <div className="impact-burst" aria-hidden="true"><span /><i /><b /></div><div className="player-kart"><span className="speed-lines" /><img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="我方車輛" /></div>
            </div></div>
            {state === "duel" && duelPhase === "race" && <div className="duel-distance" aria-live="polite"><span>距離冠軍</span><strong>{duelDistance}m</strong></div>}

            {state === "lost" && <div className="result-overlay"><div className="result-card lost"><div className="result-code">再接再厲!</div><p>最終名次 <strong>第 {place} 名 / 共 8 名</strong></p><div className="result-prize"><span>最終獎勵</span><strong>×0 · 0.00</strong></div><button onClick={reset}>再玩一局</button></div></div>}
          </section>

          <aside className="control-panel">{state === "setup" ? <div className="setup-panel"><div className="bet-card"><div><span>投注金額</span><small>餘額 {credit(balance)}</small></div><div className="bet-input-row"><input type="number" inputMode="numeric" min="10" max={balance} step="10" value={bet || ""} onChange={(event) => setBet(Math.max(0, Math.floor(Number(event.target.value))))} onBlur={() => setBet(Math.min(balance, Math.max(10, bet || 10)))} aria-label="下注金額" /></div><div className="quick-bets" aria-label="快速下注">{[10, 50, 100, 200].map((amount) => <button key={amount} className={bet === amount ? "selected" : ""} onClick={() => setBet(amount)}>{amount}</button>)}</div></div><button className="start-button" onClick={startRace} disabled={balance < bet || bet < 10}>開始投注 <span>確認</span></button><p className="risk-note">挑戰失敗，名次、連超與里程碑獎勵全部歸零</p></div> : <div className={`race-panel action-only ${place === 2 ? "champion-decision" : ""}`}><button className={`overtake-button ${place === 2 ? "champion-button" : ""}`} onClick={primaryAction} disabled={isPassing || noticeLocked || state !== "racing"}><span>{isPassing ? "全力衝刺" : place === 2 ? "挑戰冠軍" : `超越第${nextPlace}名`}</span></button><button className="cash-button" onClick={cashOut} disabled={multiplier <= 1 || isPassing || noticeLocked || state !== "racing"}>領取獎勵・{credit(claimAmount)}</button></div>}</aside>
        </div>
        {(state === "settling" || state === "won" || state === "cashed") && settlement && <div className="result-overlay settlement-overlay"><div className="result-card settlement-card"><div className="settlement-heading"><span>比賽結算</span>{settlement.place === 1 && <strong>🏆 冠軍</strong>}</div><div className="settlement-rows">{settlement.rows.slice(0, settlementStep).map((row, index) => <div key={`${row.key}-${index}`} className={`settlement-row ${row.key}`}><div><strong>{row.label}</strong>{row.detail && <small>{row.detail}</small>}</div><span>{row.displayAmount}</span></div>)}</div><div className={`settlement-total ${settlementComplete ? "revealed" : ""}`}><span>最終倍率</span><strong>{settlementMultiplierLabel(settlement.totalMultiplier)}</strong><small>獎勵 +{credit(settlement.reward)}</small></div>{settlementComplete && <button onClick={reset}>再玩一局</button>}</div></div>}
      </section>
      <p className="demo-caption">可玩展示 · 極速反攻 // 決勝圈 V3</p>
    </main>
  );
}
