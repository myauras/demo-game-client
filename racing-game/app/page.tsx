"use client";

import { useMemo, useRef, useState } from "react";

type GameState = "setup" | "racing" | "duel" | "settling" | "won" | "lost" | "cashed";
type DuelPhase = "idle" | "race" | "player-win" | "collision" | "rival-win";
type PassDirection = "left" | "right";
type WeatherId = "sunny" | "rain" | "storm" | "fog" | "thunder";
type TestWeather = WeatherId | "auto";
type TestRival = "auto" | "none" | "1" | "2" | "3" | "4" | "5" | "6";
type TestOutcome = "auto" | "win" | "lose";
type ResultState = "won" | "cashed";

type WeatherEffect = "none" | "rivalMultiplier" | "streakMultiplier" | "rivalFlat" | "totalMultiplier";
type WeatherConfig = { label: string; shortLabel: string; rule: string; hudValue: string; weight: number; effect: WeatherEffect };
type EventAlert = { title: string; subtitle: string; tone: "cyan" | "gold" | "red"; variant: "panel" | "streak" };
type QueuedNotice = { kind: "event"; alert: EventAlert } | { kind: "champion" };
type ActiveNotice = QueuedNotice & { id: number; slot: number };
type SettlementRow = { key: "rank" | "rival" | "streak" | "subtotal" | "weather"; label: string; detail?: string; amount: number; total: number; displayAmount: string; nested?: boolean };
type SettlementData = { place: number; rows: SettlementRow[]; totalMultiplier: number; reward: number };

const rankMultipliers: Record<number, number> = { 8: 1, 7: 1.2, 6: 1.5, 5: 1.9, 4: 2.5, 3: 3.5, 2: 5, 1: 10 };
const GAME_CONFIG = {
  targetRtp: 0.95,
  rivalChance: 0.65,
  rivalBonus: 0.5,
  rivalRanks: [6, 5, 4, 3, 2, 1],
  streakBonuses: { 0: 0, 1: 0, 2: 0.2, 3: 0.4, 4: 0.6, 5: 0.8, 6: 1 } as Record<number, number>,
  weather: {
    sunny: { label: "晴天", shortLabel: "晴天", rule: "無額外效果", hudValue: "標準", weight: 60, effect: "none" },
    rain: { label: "雨天", shortLabel: "雨天", rule: "宿敵獎勵 x1.5", hudValue: "x1.5", weight: 20, effect: "rivalMultiplier" },
    storm: { label: "暴雨", shortLabel: "暴雨", rule: "連超獎勵 x2", hudValue: "x2", weight: 8, effect: "streakMultiplier" },
    fog: { label: "濃霧", shortLabel: "濃霧", rule: "擊敗宿敵 +0.3X", hudValue: "+0.3X", weight: 8, effect: "rivalFlat" },
    thunder: { label: "雷雨", shortLabel: "雷雨", rule: "4連超以上，最終倍率 x1.2", hudValue: "x1.2", weight: 4, effect: "totalMultiplier" },
  } satisfies Record<WeatherId, WeatherConfig>,
};

const weatherOrder: WeatherId[] = ["sunny", "rain", "storm", "fog", "thunder"];
const rivalColors = ["#ff3b5f", "#9a6cff", "#22d3ee", "#3cff9b", "#ff8a34", "#e6f0ff", "#ffd02f"];
const rivalHues: Record<string, number> = { "#ff3b5f": 18, "#9a6cff": 65, "#22d3ee": 145, "#3cff9b": 205, "#ff8a34": 315, "#e6f0ff": 110, "#ffd02f": 280 };
const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const credit = (value: number) => Math.floor(value).toLocaleString("zh-TW");
const multiplierLabel = (value: number) => Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0$/, "");
const settlementMultiplierLabel = (value: number) => `${Number.isInteger(value) ? value.toFixed(1) : multiplierLabel(value)}倍`;

const chooseWeather = (): WeatherId => {
  const roll = Math.random() * 100;
  let cursor = 0;
  for (const weather of weatherOrder) {
    cursor += GAME_CONFIG.weather[weather].weight;
    if (roll < cursor) return weather;
  }
  return "sunny";
};

const chooseRivalRank = (): number | null => {
  if (Math.random() >= GAME_CONFIG.rivalChance) return null;
  return GAME_CONFIG.rivalRanks[Math.floor(Math.random() * GAME_CONFIG.rivalRanks.length)];
};

export default function Home() {
  const [bet, setBet] = useState(10);
  const [place, setPlace] = useState(8);
  const [multiplier, setMultiplier] = useState(1);
  const [state, setState] = useState<GameState>("setup");
  const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
  const [normalCrash, setNormalCrash] = useState(false);
  const [testRun, setTestRun] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testWeather, setTestWeather] = useState<TestWeather>("auto");
  const [testRival, setTestRival] = useState<TestRival>("auto");
  const [testOutcome, setTestOutcome] = useState<TestOutcome>("auto");
  const [isPassing, setIsPassing] = useState(false);
  const [passDirection, setPassDirection] = useState<PassDirection>("right");
  const [soundOn, setSoundOn] = useState(true);
  const [balance, setBalance] = useState(12800);
  const [rivalOrder, setRivalOrder] = useState(rivalColors);
  const [weather, setWeather] = useState<WeatherId>("sunny");
  const [weatherNotice, setWeatherNotice] = useState(false);
  const [raceReady, setRaceReady] = useState(false);
  const [rivalPlace, setRivalPlace] = useState<number | null>(null);
  const [rivalDefeated, setRivalDefeated] = useState(false);
  const [streak, setStreak] = useState(0);
  const [highestStreak, setHighestStreak] = useState(0);
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
  const activeRivalColor = place > 1 ? rivalOrder[place - 2] : rivalOrder[0];
  const activeTargetIsRival = rivalPlace === nextPlace && !rivalDefeated;
  const championIsRival = rivalPlace === 1 && !rivalDefeated;
  const weatherConfig = GAME_CONFIG.weather[weather];
  const streakBonus = GAME_CONFIG.streakBonuses[Math.min(highestStreak, 6)];
  const weatherBonusFor = (subtotal: number, didDefeatRival: boolean, maxStreak: number) => {
    const bestStreakBonus = GAME_CONFIG.streakBonuses[Math.min(maxStreak, 6)];
    if (weatherConfig.effect === "rivalMultiplier" && didDefeatRival) return GAME_CONFIG.rivalBonus * 0.5;
    if (weatherConfig.effect === "streakMultiplier") return bestStreakBonus;
    if (weatherConfig.effect === "rivalFlat" && didDefeatRival) return 0.3;
    if (weatherConfig.effect === "totalMultiplier" && maxStreak >= 4) return subtotal * 0.2;
    return 0;
  };
  const claimSubtotal = multiplier + (rivalDefeated ? GAME_CONFIG.rivalBonus : 0) + streakBonus;
  const earnedWeatherBonus = weatherBonusFor(claimSubtotal, rivalDefeated, highestStreak);
  const claimMultiplier = Number((claimSubtotal + earnedWeatherBonus).toFixed(2));
  const claimAmount = Math.floor(bet * claimMultiplier);
  const standings = useMemo(() => [
    { id: "player", rank: place, color: "#20e0ff", isPlayer: true, isRival: false },
    ...rivalOrder.map((color, index) => {
      const startingRank = index + 1;
      return { id: `rival-${startingRank}`, rank: startingRank >= place ? startingRank + 1 : startingRank, color, isPlayer: false, isRival: startingRank === rivalPlace && !rivalDefeated };
    }),
  ], [place, rivalOrder, rivalPlace, rivalDefeated]);

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
      const noticeDuration = isStreakNotice ? 900 : 1500;
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

  const beginSettlement = (resultPlace: number, resultState: ResultState, didDefeatRival: boolean, maxStreak: number) => {
    const base = rankMultipliers[resultPlace];
    const rivalBonus = didDefeatRival ? GAME_CONFIG.rivalBonus : 0;
    const bestStreak = Math.min(maxStreak, 6);
    const bestStreakBonus = GAME_CONFIG.streakBonuses[bestStreak];
    const subtotal = base + rivalBonus + bestStreakBonus;
    const weatherBonus = weatherBonusFor(subtotal, didDefeatRival, bestStreak);
    const rows: SettlementRow[] = [];
    let runningTotal = base;
    const weatherRow = (): SettlementRow => ({
      key: "weather",
      label: weatherConfig.effect === "rivalMultiplier"
        ? "└ 🌧 雨天 ×1.5"
        : weatherConfig.effect === "streakMultiplier"
          ? "└ 🌧 暴雨 ×2"
          : weatherConfig.effect === "rivalFlat"
            ? "└ 🌫 濃霧加成"
            : "└ ⚡ 雷雨爆發 ×1.2",
      amount: weatherBonus,
      total: Number((runningTotal + weatherBonus).toFixed(2)),
      displayAmount: `+${settlementMultiplierLabel(weatherBonus)}`,
      nested: true,
    });
    rows.push({ key: "rank", label: "最終名次", detail: `第${resultPlace}名`, amount: base, total: runningTotal, displayAmount: settlementMultiplierLabel(base) });
    if (rivalBonus > 0) {
      runningTotal += rivalBonus;
      rows.push({ key: "rival", label: "擊敗宿敵", amount: rivalBonus, total: runningTotal, displayAmount: `+${settlementMultiplierLabel(rivalBonus)}` });
      if (weatherBonus > 0 && ["rivalMultiplier", "rivalFlat"].includes(weatherConfig.effect)) {
        rows.push(weatherRow());
        runningTotal = Number((runningTotal + weatherBonus).toFixed(2));
      }
    }
    if (bestStreakBonus > 0) {
      runningTotal += bestStreakBonus;
      rows.push({ key: "streak", label: "最高連超", detail: `${bestStreak}連超`, amount: bestStreakBonus, total: runningTotal, displayAmount: `+${settlementMultiplierLabel(bestStreakBonus)}` });
      if (weatherBonus > 0 && weatherConfig.effect === "streakMultiplier") {
        rows.push(weatherRow());
        runningTotal = Number((runningTotal + weatherBonus).toFixed(2));
      }
    }
    if (weatherBonus > 0 && weatherConfig.effect === "totalMultiplier") {
      rows.push({ key: "subtotal", label: "小計", amount: subtotal, total: subtotal, displayAmount: settlementMultiplierLabel(subtotal) });
      rows.push(weatherRow());
      runningTotal = Number((runningTotal + weatherBonus).toFixed(2));
    }
    const totalMultiplier = Number(runningTotal.toFixed(2));
    const reward = Math.floor(bet * totalMultiplier);
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
    const selectedWeather = testWeather === "auto" ? chooseWeather() : testWeather;
    const weatherRequiresRival = ["rivalMultiplier", "rivalFlat"].includes(GAME_CONFIG.weather[selectedWeather].effect);
    const selectedRival = weatherRequiresRival
      ? testRival !== "auto" && testRival !== "none"
        ? Number(testRival)
        : GAME_CONFIG.rivalRanks[Math.floor(Math.random() * GAME_CONFIG.rivalRanks.length)]
      : testRival === "auto"
        ? chooseRivalRank()
        : testRival === "none"
          ? null
          : Number(testRival);
    setBalance((value) => value - bet);
    setPlace(8);
    setMultiplier(1);
    setState("racing");
    setWeather(selectedWeather);
    setRivalPlace(selectedRival);
    setRivalDefeated(false);
    setStreak(0);
    setHighestStreak(0);
    setRaceReady(selectedWeather === "sunny");
    setWeatherNotice(selectedWeather !== "sunny");
    setActiveNotices([]);
    setNormalCrash(false);
    setSettlement(null);
    setSettlementComplete(false);
    setShowTestPanel(false);
    setRivalOrder((currentOrder) => {
      const shuffled = [...currentOrder];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      if (shuffled.every((color, index) => color === currentOrder[index])) shuffled.push(shuffled.shift()!);
      return shuffled;
    });
    if (selectedWeather !== "sunny") window.setTimeout(() => { setWeatherNotice(false); setRaceReady(true); }, 1500);
  };

  const overtake = () => {
    if (state !== "racing" || isPassing || noticeLocked || place <= 2 || !raceReady) return;
    setIsPassing(true);
    setPassDirection(Math.random() < 0.5 ? "left" : "right");
    const successRate = place === 8 ? GAME_CONFIG.targetRtp / nextMultiplier : multiplier / nextMultiplier;
    if (!testRun && Math.random() >= successRate) {
      setNormalCrash(true);
      window.setTimeout(() => { setNormalCrash(false); setIsPassing(false); setState("lost"); }, 1180);
      return;
    }
    const passedRival = activeTargetIsRival;
    const nextStreak = Math.min(6, streak + 1);
    window.setTimeout(() => {
      setPlace(nextPlace);
      setMultiplier(nextMultiplier);
      setStreak(nextStreak);
      setHighestStreak((value) => Math.max(value, nextStreak));
      setIsPassing(false);
      const notices: QueuedNotice[] = [];
      notices.push({ kind: "event", alert: { title: `${nextStreak}連超！`, subtitle: `+${multiplierLabel(GAME_CONFIG.streakBonuses[nextStreak])}倍`, tone: nextStreak >= 6 ? "red" : "cyan", variant: "streak" } });
      if (passedRival) {
        setRivalDefeated(true);
        notices.push({ kind: "event", alert: { title: "擊敗宿敵！", subtitle: "宿敵獎勵 +0.5倍", tone: "gold", variant: "panel" } });
      }
      if (nextStreak >= 3) {
        setStreakPulse(true);
        window.setTimeout(() => setStreakPulse(false), 650);
      }
      if (nextPlace === 2) {
        setTestRun(false);
        notices.push({ kind: "champion" });
      } else if (rivalPlace === nextPlace - 1 && !passedRival) {
        notices.push({ kind: "event", alert: { title: "宿敵就在前方！", subtitle: `第${nextPlace - 1}名 · 擊敗額外 +0.5倍`, tone: "gold", variant: "panel" } });
      }
      queueNotices(notices);
    }, 1600);
  };

  const challengeChampion = () => {
    if (state !== "racing" || place !== 2 || isPassing || noticeLocked || !raceReady) return;
    setState("duel");
    setIsPassing(true);
    setDuelPhase("race");
    setActiveNotices([]);
    window.setTimeout(() => {
      const success = testOutcome === "win" ? true : testOutcome === "lose" ? false : Math.random() < rankMultipliers[2] / rankMultipliers[1];
      if (success) {
        const defeatedChampionRival = championIsRival;
        const nextStreak = Math.min(6, streak + 1);
        setDuelPhase("player-win");
        setStreak(nextStreak);
        setHighestStreak((value) => Math.max(value, nextStreak));
        if (defeatedChampionRival) setRivalDefeated(true);
        window.setTimeout(() => {
          setPlace(1);
          setIsPassing(false);
          beginSettlement(1, "won", rivalDefeated || defeatedChampionRival, Math.max(highestStreak, nextStreak));
        }, 1150);
      } else {
        setDuelPhase("collision");
        window.setTimeout(() => {
          setDuelPhase("rival-win");
          window.setTimeout(() => { setIsPassing(false); setState("lost"); }, 1150);
        }, 850);
      }
    }, 900);
  };

  const cashOut = () => {
    if (state !== "racing" || multiplier <= 1 || isPassing || noticeLocked || !raceReady) return;
    setTestRun(false);
    beginSettlement(place, "cashed", rivalDefeated, highestStreak);
  };

  const reset = () => {
    setState("setup");
    setWeather("sunny");
    setPlace(8);
    setMultiplier(1);
    setDuelPhase("idle");
    setActiveNotices([]);
    setNormalCrash(false);
    setTestRun(false);
    setRaceReady(false);
    setWeatherNotice(false);
    setSettlement(null);
    setSettlementStep(0);
    setSettlementComplete(false);
    setStreak(0);
    setHighestStreak(0);
    setRivalDefeated(false);
    noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
    noticeTimers.current = [];
    setNoticeLocked(false);
  };

  const primaryAction = place === 2 ? challengeChampion : overtake;
  const testButtonDisabled = state !== "setup" && (state !== "racing" || place <= 2 || isPassing);

  return (
    <main className="game-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="game-card" aria-label="決勝圈競速遊戲 V2">
        <header className="topbar">
          <div className="brand" aria-label="決勝圈極速反攻">
            <span className="brand-mark" aria-hidden="true">決</span>
            <div><strong>極速反攻</strong><small>決勝圈 V2</small></div>
            <button type="button" className={`test-button ${testRun || showTestPanel ? "active" : ""}`} onClick={() => state === "setup" ? setShowTestPanel((value) => !value) : setTestRun(true)} disabled={testButtonDisabled} aria-label={state === "setup" ? "開啟 V2 測試設定" : testRun ? "本局冠軍賽測試已啟用" : "啟用本局冠軍賽測試"}>{state === "setup" ? "V2" : testRun ? "已啟用" : "測試"}</button>
          </div>
          <div className="topbar-center"><span />賽事系統已連線</div>
          <div className="topbar-actions"><button className="icon-button" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? "關閉音效" : "開啟音效"}>音效 {soundOn ? "開" : "關"}</button><div className="wallet"><strong>{credit(balance)}</strong></div></div>
        </header>

        {showTestPanel && (
          <div className="test-panel" aria-label="V2 測試設定">
            <div className="test-panel-title"><strong>V2 測試設定</strong><button onClick={() => setShowTestPanel(false)} aria-label="關閉測試設定">×</button></div>
            <label>天氣控制<select value={testWeather} onChange={(event) => setTestWeather(event.target.value as TestWeather)} disabled={state !== "setup"}><option value="auto">自動</option>{weatherOrder.map((id) => <option key={id} value={id}>{GAME_CONFIG.weather[id].shortLabel}</option>)}</select></label>
            <label>宿敵控制<select value={testRival} onChange={(event) => setTestRival(event.target.value as TestRival)} disabled={state !== "setup"}><option value="auto">自動</option><option value="none">無宿敵</option>{[6, 5, 4, 3, 2, 1].map((rank) => <option key={rank} value={rank}>指定第{rank}名</option>)}</select></label>
            <label>冠軍結果<select value={testOutcome} onChange={(event) => setTestOutcome(event.target.value as TestOutcome)} disabled={state !== "setup"}><option value="auto">自動</option><option value="win">指定成功</option><option value="lose">指定失敗</option></select></label>
            <div className="test-streak"><span>當前連超 <b>{streak}</b></span><span>最高連超 <b>{highestStreak}</b></span></div>
            <small>賽事中點擊 LOGO 旁「測試」可保證安全抵達冠軍賽。</small>
          </div>
        )}

        <div className="content-grid">
          <section className={`race-scene weather-${weather} streak-level-${Math.min(highestStreak, 6)} ${streakPulse ? "streak-pulse" : ""} ${isPassing ? "boosting" : ""} ${normalCrash ? "normal-crash" : ""} ${isPassing && state === "racing" ? `passing-${passDirection}` : ""} ${state === "duel" ? `final-duel duel-${duelPhase}` : ""}`} style={{ "--race-background": `url(${assetBase}/race-background.png)` } as React.CSSProperties}>
            <div className="weather-fx" aria-hidden="true"><i /><i /><b /><span /></div>
            <div className="city-glow" /><div className="cityline cityline-back" /><div className="cityline cityline-front" />

            {state !== "setup" && <div className="race-hud"><div className="standings-board" aria-label={`完整車輛排名，我方目前第 ${place} 名`}><div className="standings-title"><span>即時排名</span><b>8 輛車</b></div><div className="standings-list">{standings.map((entry) => <div key={entry.id} className={`standing-row ${entry.isPlayer ? "player" : ""} ${entry.isRival ? "rival" : ""}`} style={{ "--rank": entry.rank, "--car-color": entry.color, "--car-hue": entry.isPlayer ? "0deg" : `${rivalHues[entry.color]}deg` } as React.CSSProperties}><strong>{entry.rank}</strong><img className="standing-car" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" /><small>{entry.isRival ? "宿敵" : `第${entry.rank}名`}</small></div>)}</div></div></div>}

            {state !== "setup" && <><div className={`scene-multiplier ${place <= 3 ? "podium" : ""}`}><span>獎勵倍率</span><strong>×{multiplierLabel(multiplier)}</strong><div className="progress-track"><i style={{ width: `${Math.max(4, progress)}%` }} /></div></div><div className={`weather-chip ${weatherConfig.effect !== "none" ? "bonus" : ""}`}><span>{weatherConfig.shortLabel}</span><b>{weatherConfig.hudValue}</b></div><div className={`streak-meter level-${Math.min(highestStreak, 6)}`}><span>連超</span><strong>{streak}</strong><small>+{multiplierLabel(streakBonus)}倍</small></div></>}
            {weatherNotice && <div className="weather-notice" role="status"><span>本場天氣</span><strong>{weatherConfig.label}</strong><small>{weatherConfig.rule}</small></div>}
            {activeNotices.some((notice) => notice.kind === "champion" || notice.alert.variant === "panel") && <div className="notice-stack" aria-live="polite">{activeNotices.filter((notice) => notice.kind === "champion" || notice.alert.variant === "panel").map((notice) => notice.kind === "event" ? <div key={notice.id} className={`event-alert ${notice.alert.tone}`} style={{ "--notice-slot": notice.slot } as React.CSSProperties} role="status"><strong>{notice.alert.title}</strong><span>{notice.alert.subtitle}</span></div> : <div key={notice.id} className={`champion-alert ${championIsRival ? "rival-final" : ""}`} style={{ "--notice-slot": notice.slot } as React.CSSProperties} role="status"><span>{championIsRival ? "最終宿敵" : "冠軍挑戰"}</span><strong>{championIsRival ? "冠軍就在前方" : "挑戰冠軍賽，獎勵10倍!"}</strong></div>)}</div>}
            {activeNotices.some((notice) => notice.kind === "event" && notice.alert.variant === "streak") && <div className="streak-notice-layer" aria-live="polite">{activeNotices.filter((notice) => notice.kind === "event" && notice.alert.variant === "streak").map((notice) => notice.kind === "event" && <div key={notice.id} className={`streak-alert ${notice.alert.tone}`} style={{ "--streak-slot": notice.slot } as React.CSSProperties} role="status"><strong>{notice.alert.title}</strong><span>{notice.alert.subtitle}</span></div>)}</div>}

            <div className="track-wrap"><div className="track"><div className="road-stream" /><div className="lane lane-one" /><div className="lane lane-two" /><div className="finish-line" />
              {state === "racing" && place > 1 && <div className={`target-kart ${activeTargetIsRival ? "rival-kart" : ""} ${normalCrash ? "crashing" : isPassing ? `being-passed pass-${passDirection}` : ""}`} style={{ "--kart-color": activeTargetIsRival ? "#ffc928" : activeRivalColor, "--car-hue": `${rivalHues[activeRivalColor]}deg` } as React.CSSProperties} aria-label={`前方第 ${nextPlace} 名${activeTargetIsRival ? "宿敵" : "車輛"}`}><span className="target-label">{activeTargetIsRival && <b className="rival-tag">宿敵</b>}<i />第{nextPlace}名</span><img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" /></div>}
              <div className={`duel-champion ${championIsRival ? "rival-kart" : ""}`} style={{ "--kart-color": championIsRival ? "#ffc928" : rivalOrder[0], "--car-hue": `${rivalHues[rivalOrder[0]]}deg` } as React.CSSProperties} aria-label={`第 1 名${championIsRival ? "宿敵" : "車輛"}`}><span className="target-label">{championIsRival && <b className="rival-tag">宿敵</b>}<i />第1名</span><img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" /></div>
              <div className="impact-burst" aria-hidden="true"><span /><i /><b /></div><div className="player-kart"><span className="speed-lines" /><img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="我方車輛" /></div>
            </div></div>

            {(state === "settling" || state === "won" || state === "cashed") && settlement && <div className="result-overlay settlement-overlay"><div className="result-card settlement-card"><div className="settlement-heading"><span>比賽結算</span></div><div className="settlement-rows">{settlement.rows.slice(0, settlementStep).map((row) => <div key={row.key} className={`settlement-row ${row.key} ${row.nested ? "weather-child" : ""}`}><div><strong>{row.label}</strong>{row.detail && <small>{row.detail}</small>}</div><span>{row.displayAmount}</span></div>)}</div><div className={`settlement-total ${settlementComplete ? "revealed" : ""}`}><span>最終倍率</span><strong>{settlementMultiplierLabel(settlement.totalMultiplier)}</strong><small>獎勵 +{credit(settlement.reward)}點</small></div>{settlementComplete && <button onClick={reset}>再玩一局</button>}</div></div>}
            {state === "lost" && <div className="result-overlay"><div className="result-card lost"><div className="result-code">再接再厲!</div><p>最終名次 <strong>第 {place} 名 / 共 8 名</strong></p><div className="result-prize"><span>最終獎勵</span><strong>×0 · 0</strong></div><button onClick={reset}>再玩一局</button></div></div>}
          </section>

          <aside className="control-panel">{state === "setup" ? <div className="setup-panel"><div className="bet-card"><div><span>投注金額</span><small>餘額 {credit(balance)}</small></div><div className="bet-input-row"><input type="number" inputMode="numeric" min="10" max={balance} step="10" value={bet || ""} onChange={(event) => setBet(Math.max(0, Math.floor(Number(event.target.value))))} onBlur={() => setBet(Math.min(balance, Math.max(10, bet || 10)))} aria-label="下注金額" /></div><div className="quick-bets" aria-label="快速下注">{[10, 50, 100, 200].map((amount) => <button key={amount} className={bet === amount ? "selected" : ""} onClick={() => setBet(amount)}>{amount}</button>)}</div></div><button className="start-button" onClick={startRace} disabled={balance < bet || bet < 10}>開始投注 <span>確認</span></button><p className="risk-note">挑戰失敗，宿敵、連超與天氣加成全部歸零</p></div> : <div className="race-panel"><div className="panel-heading"><div className="live-title"><h1>第{place}名 <small>/ 共 8 名</small></h1><span>{state === "duel" ? "冠軍賽" : "追擊中"}</span></div></div><button className={`overtake-button ${place === 2 ? "champion-button" : ""}`} onClick={primaryAction} disabled={isPassing || noticeLocked || state !== "racing" || !raceReady}><span>{isPassing ? "全力衝刺" : place === 2 ? "挑戰冠軍" : `超越第${nextPlace}名`}</span><small>{place === 2 ? "最高 ×10 · 最後直線" : `成功獎勵 ×${multiplierLabel(nextMultiplier)}`}</small></button><button className="cash-button" onClick={cashOut} disabled={multiplier <= 1 || isPassing || noticeLocked || state !== "racing" || !raceReady}>領取獎勵・{credit(claimAmount)}</button><p className="chance-note"><span />額外加成將於領取時逐層揭曉</p></div>}</aside>
        </div>
      </section>
      <p className="demo-caption">可玩展示 · 極速反攻 // 決勝圈 V2</p>
    </main>
  );
}
