"use client";

import { useMemo, useState } from "react";

type GameState = "setup" | "racing" | "duel" | "won" | "lost" | "cashed";
type DuelPhase = "idle" | "race" | "player-win" | "collision" | "rival-win";
type PassDirection = "left" | "right";

const rankMultipliers: Record<number, number> = {
  8: 1,
  7: 1.2,
  6: 1.5,
  5: 1.9,
  4: 2.5,
  3: 3.5,
  2: 5,
  1: 10,
};

const rivalColors = ["#ff3b5f", "#9a6cff", "#22d3ee", "#3cff9b", "#ff8a34", "#e6f0ff", "#ffd02f"];
const rivalHues: Record<string, number> = {
  "#ff3b5f": 18,
  "#9a6cff": 65,
  "#22d3ee": 145,
  "#3cff9b": 205,
  "#ff8a34": 315,
  "#e6f0ff": 110,
  "#ffd02f": 280,
};
const targetRtp = 0.95;
const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const credit = (value: number) => Math.floor(value).toLocaleString("zh-TW");
const multiplierLabel = (value: number) => Number.isInteger(value) ? `${value}` : value.toFixed(1);

export default function Home() {
  const [bet, setBet] = useState(10);
  const [place, setPlace] = useState(8);
  const [multiplier, setMultiplier] = useState(1);
  const [state, setState] = useState<GameState>("setup");
  const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
  const [championAlert, setChampionAlert] = useState(false);
  const [normalCrash, setNormalCrash] = useState(false);
  const [testRun, setTestRun] = useState(false);
  const [isPassing, setIsPassing] = useState(false);
  const [passDirection, setPassDirection] = useState<PassDirection>("right");
  const [soundOn, setSoundOn] = useState(true);
  const [balance, setBalance] = useState(12800);
  const [rivalOrder, setRivalOrder] = useState(rivalColors);

  const prize = useMemo(() => Math.floor(bet * multiplier), [bet, multiplier]);
  const progress = ((8 - place) / 7) * 100;
  const nextPlace = Math.max(1, place - 1);
  const nextMultiplier = rankMultipliers[nextPlace];
  const activeRivalColor = place > 1 ? rivalOrder[place - 2] : rivalOrder[0];
  const standings = useMemo(() => [
    { id: "player", rank: place, color: "#20e0ff", isPlayer: true },
    ...rivalOrder.map((color, index) => {
      const startingRank = index + 1;
      return {
        id: `rival-${startingRank}`,
        rank: startingRank >= place ? startingRank + 1 : startingRank,
        color,
        isPlayer: false,
      };
    }),
  ], [place, rivalOrder]);

  const startRace = () => {
    if (balance < bet || bet < 10) return;
    setBalance((value) => value - bet);
    setPlace(8);
    setMultiplier(1);
    setState("racing");
    setChampionAlert(false);
    setNormalCrash(false);
    setTestRun(false);
    setRivalOrder((currentOrder) => {
      const shuffled = [...currentOrder];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      if (shuffled.every((color, index) => color === currentOrder[index])) {
        shuffled.push(shuffled.shift()!);
      }
      return shuffled;
    });
  };

  const overtake = () => {
    if (state !== "racing" || isPassing || place <= 2) return;
    setIsPassing(true);
    setPassDirection(Math.random() < 0.5 ? "left" : "right");
    const successRate = place === 8 ? targetRtp / nextMultiplier : multiplier / nextMultiplier;

    if (!testRun && Math.random() >= successRate) {
      setNormalCrash(true);
      window.setTimeout(() => {
        setNormalCrash(false);
        setIsPassing(false);
        setState("lost");
      }, 900);
      return;
    }

    window.setTimeout(() => {
      setPlace(nextPlace);
      setMultiplier(nextMultiplier);
      setIsPassing(false);
      if (nextPlace === 2) {
        setTestRun(false);
        setChampionAlert(true);
        window.setTimeout(() => setChampionAlert(false), 1900);
      }
    }, 1250);
  };

  const challengeChampion = () => {
    if (state !== "racing" || place !== 2 || isPassing) return;
    setState("duel");
    setIsPassing(true);
    setDuelPhase("race");
    setChampionAlert(false);

    window.setTimeout(() => {
      const success = Math.random() < rankMultipliers[2] / rankMultipliers[1];
      if (success) {
        setDuelPhase("player-win");
        window.setTimeout(() => {
          const championPrize = bet * rankMultipliers[1];
          setPlace(1);
          setMultiplier(rankMultipliers[1]);
          setBalance((value) => value + championPrize);
          setIsPassing(false);
          setState("won");
        }, 1150);
      } else {
        setDuelPhase("collision");
        window.setTimeout(() => {
          setDuelPhase("rival-win");
          window.setTimeout(() => {
            setIsPassing(false);
            setState("lost");
          }, 1150);
        }, 850);
      }
    }, 900);
  };

  const cashOut = () => {
    if (state !== "racing" || multiplier <= 1) return;
    setBalance((value) => value + prize);
    setTestRun(false);
    setState("cashed");
  };

  const reset = () => {
    setState("setup");
    setPlace(8);
    setMultiplier(1);
    setDuelPhase("idle");
    setChampionAlert(false);
    setNormalCrash(false);
    setTestRun(false);
  };

  const primaryAction = place === 2 ? challengeChampion : overtake;

  return (
    <main className="game-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="game-card" aria-label="決勝圈競速遊戲">
        <header className="topbar">
          <div className="brand" aria-label="決勝圈極速反攻">
            <span className="brand-mark" aria-hidden="true">決</span>
            <div><strong>極速反攻</strong><small>決勝圈</small></div>
            <button
              type="button"
              className={`test-button ${testRun ? "active" : ""}`}
              onClick={() => setTestRun(true)}
              disabled={state !== "racing" || place <= 2 || isPassing}
              aria-label={testRun ? "本局冠軍賽測試已啟用" : "啟用本局冠軍賽測試"}
            >
              {testRun ? "已啟用" : "測試"}
            </button>
          </div>
          <div className="topbar-center"><span />賽事系統已連線</div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? "關閉音效" : "開啟音效"}>
              音效 {soundOn ? "開" : "關"}
            </button>
            <div className="wallet"><strong>{credit(balance)}</strong></div>
          </div>
        </header>

        <div className="content-grid">
          <section
            className={`race-scene ${isPassing ? "boosting" : ""} ${normalCrash ? "normal-crash" : ""} ${isPassing && state === "racing" ? `passing-${passDirection}` : ""} ${state === "duel" ? `final-duel duel-${duelPhase}` : ""}`}
            style={{ "--race-background": `url(${assetBase}/race-background.png)` } as React.CSSProperties}
          >
            <div className="city-glow" />
            <div className="cityline cityline-back" />
            <div className="cityline cityline-front" />
            {state !== "setup" && (
              <div className="race-hud">
                <div className="standings-board" aria-label={`完整車輛排名，我方目前第 ${place} 名`}>
                  <div className="standings-title"><span>即時排名</span><b>8 輛車</b></div>
                  <div className="standings-list">
                    {standings.map((entry) => (
                      <div
                        key={entry.id}
                        className={`standing-row ${entry.isPlayer ? "player" : ""}`}
                        style={{
                          "--rank": entry.rank,
                          "--car-color": entry.color,
                          "--car-hue": entry.isPlayer ? "0deg" : `${rivalHues[entry.color]}deg`,
                        } as React.CSSProperties}
                      >
                        <strong>{entry.rank}</strong>
                        <img className="standing-car" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" />
                        <small>第{entry.rank}名</small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {state !== "setup" && (
              <div className={`scene-multiplier ${place <= 3 ? "podium" : ""}`}>
                <span>{place === 2 ? "保住第二名" : "獎勵倍率"}</span>
                <strong>×{multiplierLabel(multiplier)}</strong>
                <div className="progress-track"><i style={{ width: `${Math.max(4, progress)}%` }} /></div>
              </div>
            )}

            {championAlert && (
              <div className="champion-alert" role="status">
                <span>冠軍挑戰</span>
                <strong>挑戰冠軍賽，獎勵10倍!</strong>
              </div>
            )}

            <div className="track-wrap">
              <div className="track">
                <div className="road-stream" />
                <div className="lane lane-one" />
                <div className="lane lane-two" />
                <div className="finish-line" />

                {state === "racing" && place > 1 && (
                  <div
                    className={`target-kart ${normalCrash ? "crashing" : isPassing ? `being-passed pass-${passDirection}` : ""}`}
                    style={{ "--kart-color": activeRivalColor, "--car-hue": `${rivalHues[activeRivalColor]}deg` } as React.CSSProperties}
                    aria-label={`前方第 ${nextPlace} 名車輛`}
                  >
                    <span className="target-label"><i />第{nextPlace}名</span>
                    <img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" />
                  </div>
                )}

                <div className="duel-champion" style={{ "--kart-color": rivalOrder[0], "--car-hue": `${rivalHues[rivalOrder[0]]}deg` } as React.CSSProperties} aria-label="第 1 名車輛">
                  <span className="target-label"><i />第1名</span>
                  <img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="" aria-hidden="true" />
                </div>

                <div className="impact-burst" aria-hidden="true"><span /><i /><b /></div>

                <div className="player-kart">
                  <span className="speed-lines" />
                  <img className="racer-image" src={`${assetBase}/neon-racer.png`} alt="我方車輛" />
                </div>
              </div>
            </div>

            {(state === "won" || state === "lost" || state === "cashed") && (
              <div className="result-overlay">
                <div className={`result-card ${state}`}>
                  <div className="result-code">{state === "lost" ? "再接再厲!" : state === "won" ? "冠軍" : `第${place}名`}</div>
                  <p>最終名次 <strong>第 {place} 名 / 共 8 名</strong></p>
                  <div className="result-prize"><span>最終獎勵</span><strong>×{state === "lost" ? "0" : multiplierLabel(multiplier)} · {state === "lost" ? "0" : credit(prize)}</strong></div>
                  <button onClick={reset}>再玩一局</button>
                </div>
              </div>
            )}
          </section>

          <aside className="control-panel">
            {state === "setup" ? (
              <div className="setup-panel">
                <div className="bet-card">
                  <div><span>投注金額</span><small>餘額 {credit(balance)}</small></div>
                  <div className="bet-input-row">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="10"
                      max={balance}
                      step="10"
                      value={bet || ""}
                      onChange={(event) => setBet(Math.max(0, Math.floor(Number(event.target.value))))}
                      onBlur={() => setBet(Math.min(balance, Math.max(10, bet || 10)))}
                      aria-label="下注金額"
                    />
                  </div>
                  <div className="quick-bets" aria-label="快速下注">
                    {[10, 50, 100, 200].map((amount) => (
                      <button key={amount} className={bet === amount ? "selected" : ""} onClick={() => setBet(amount)}>{amount}</button>
                    ))}
                  </div>
                </div>

                <button className="start-button" onClick={startRace} disabled={balance < bet || bet < 10}>開始投注 <span>確認</span></button>
                <p className="risk-note">挑戰冠軍失敗，本局獎勵將全部歸零</p>
              </div>
            ) : (
              <div className="race-panel">
                <div className="panel-heading">
                  <div className="live-title"><h1>第{place}名 <small>/ 共 8 名</small></h1><span>{state === "duel" ? "冠軍賽" : "追擊中"}</span></div>
                </div>

                <div className="payout-row"><span>目前可領</span><strong>{multiplier > 1 ? credit(prize) : "0"}</strong></div>

                <button className={`overtake-button ${place === 2 ? "champion-button" : ""}`} onClick={primaryAction} disabled={isPassing || state !== "racing"}>
                  <span>{isPassing ? "全力衝刺" : place === 2 ? "挑戰冠軍" : `超越第${nextPlace}名`}</span>
                  <small>{place === 2 ? "最高 ×10 · 最後直線" : `成功獎勵 ×${multiplierLabel(nextMultiplier)}`}</small>
                </button>
                <button className="cash-button" onClick={cashOut} disabled={multiplier <= 1 || isPassing || state !== "racing"}>
                  {place === 2 ? "保住第二名・領取 5 倍" : `保住戰果・領取 ${multiplierLabel(multiplier)} 倍`}
                </button>
                <p className="chance-note"><span />超越目標、鎖定戰果，或向冠軍發起最後攻勢</p>
              </div>
            )}
          </aside>
        </div>
      </section>

      <p className="demo-caption">可玩展示 · 極速反攻 // 決勝圈</p>
    </main>
  );
}
