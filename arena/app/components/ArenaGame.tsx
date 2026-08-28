"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FIGHTERS, type FighterConfig } from "../lib/arena";
import {
  BET_DEFINITIONS,
  getBetDefinition,
  isBetComplete,
  isWinningBet,
  simulatedPrize,
  type BetDefinition,
  type BetType,
} from "../lib/bets";
import {
  createEngine,
  drainSkillCastEvents,
  drawArena,
  rankActors,
  stepEngine,
  WORLD_H,
  WORLD_W,
  type Actor,
  type EngineState,
  type GameStatus,
  type RankingRow,
} from "../lib/engine";

const ENTRY_AMOUNT = 100;
const INITIAL_BALANCE = 1000;
const DESIGN_WIDTH = 1179;
const DESIGN_HEIGHT = 1977;
const SKILL_CAST_VISIBLE_DURATION_MS = 1500;
const SKILL_CAST_EXIT_DURATION_MS = 420;
const MAX_SKILL_CAST_NOTICES = 4;

type Settlement = {
  champion: Actor;
  bet: BetDefinition;
  picks: FighterConfig[];
  finishOrder: FighterConfig[];
  won: boolean;
  prize: number;
};

type SkillCastNotice = {
  id: number;
  fighterId: string;
  leaving: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rankingRows(engine: EngineState): RankingRow[] {
  return rankActors(engine.actors).map(({ id, name, color, damage, alive, outAt }) => ({
    id,
    name,
    color,
    damage,
    alive,
    outAt,
  }));
}

function normalizeChampion(champion: Actor): Actor {
  const fighter = DEFAULT_FIGHTERS.find(
    (entry) => entry.id === champion.teamId || entry.id === champion.id,
  );
  if (!fighter) return { ...champion };
  return {
    ...champion,
    ...fighter,
    id: fighter.id,
    teamId: fighter.id,
    isClone: false,
  };
}

function canonicalFinishOrder(actors: Actor[]) {
  return rankActors(actors)
    .map((actor) => DEFAULT_FIGHTERS.find((fighter) => fighter.id === actor.id))
    .filter((fighter): fighter is FighterConfig => Boolean(fighter));
}

function formatSelection(fighters: FighterConfig[], ordered: boolean) {
  if (ordered) {
    return fighters.map((fighter, index) => `${index + 1}. ${fighter.name}`).join("　");
  }
  return fighters.map((fighter) => fighter.name).join(" ＋ ");
}

export default function ArenaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineState>(createEngine(DEFAULT_FIGHTERS));
  const statusRef = useRef<GameStatus>("idle");
  const selectedIdsRef = useRef<string[]>([]);
  const betTypeRef = useRef<BetType>("win");
  const lastFrameRef = useRef(0);
  const winnerRecordedRef = useRef(false);
  const settlementTimerRef = useRef<number | null>(null);
  const skillCastNoticeTimersRef = useRef<number[]>([]);

  const [status, setStatus] = useState<GameStatus>("idle");
  const [betType, setBetType] = useState<BetType>("win");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [ranking, setRanking] = useState<RankingRow[]>(() => rankingRows(createEngine(DEFAULT_FIGHTERS)));
  const [winner, setWinner] = useState<Actor | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [skillFighterId, setSkillFighterId] = useState<string | null>(null);
  const [skillCastNotices, setSkillCastNotices] = useState<SkillCastNotice[]>([]);
  const [viewportScale, setViewportScale] = useState(1);

  const selectedFighter = useMemo(
    () => DEFAULT_FIGHTERS.find((fighter) => fighter.id === selectedId) ?? null,
    [selectedId],
  );
  const selectedFighters = useMemo(
    () => selectedIds
      .map((fighterId) => DEFAULT_FIGHTERS.find((fighter) => fighter.id === fighterId))
      .filter((fighter): fighter is FighterConfig => Boolean(fighter)),
    [selectedIds],
  );
  const activeBet = useMemo(() => getBetDefinition(betType), [betType]);
  const betReady = isBetComplete(betType, selectedIds);
  const canAffordEntry = balance >= ENTRY_AMOUNT;
  const skillFighter = useMemo(
    () => DEFAULT_FIGHTERS.find((fighter) => fighter.id === skillFighterId) ?? null,
    [skillFighterId],
  );
  const locked = status === "countdown" || status === "running";

  const announceSkillCast = useCallback((id: number, fighterId: string) => {
    if (!DEFAULT_FIGHTERS.some((fighter) => fighter.id === fighterId)) return;
    setSkillCastNotices((current) => [
      { id, fighterId, leaving: false },
      ...current,
    ].slice(0, MAX_SKILL_CAST_NOTICES));

    const fadeTimer = window.setTimeout(() => {
      setSkillCastNotices((current) => current.map((notice) => (
        notice.id === id ? { ...notice, leaving: true } : notice
      )));
    }, SKILL_CAST_VISIBLE_DURATION_MS);
    const removeTimer = window.setTimeout(() => {
      setSkillCastNotices((current) => current.filter((notice) => notice.id !== id));
    }, SKILL_CAST_VISIBLE_DURATION_MS + SKILL_CAST_EXIT_DURATION_MS);
    skillCastNoticeTimersRef.current.push(fadeTimer, removeTimer);
  }, []);

  const clearSkillCastNotices = () => {
    for (const timer of skillCastNoticeTimersRef.current) window.clearTimeout(timer);
    skillCastNoticeTimersRef.current = [];
    setSkillCastNotices([]);
  };

  useEffect(() => {
    if (!skillFighter) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSkillFighterId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [skillFighter]);

  useLayoutEffect(() => {
    const fitDesignToViewport = () => {
      const viewport = window.visualViewport;
      const availableWidth = viewport?.width ?? window.innerWidth;
      const availableHeight = viewport?.height ?? window.innerHeight;
      setViewportScale(Math.min(availableWidth / DESIGN_WIDTH, availableHeight / DESIGN_HEIGHT));
    };

    fitDesignToViewport();
    window.addEventListener("resize", fitDesignToViewport);
    window.visualViewport?.addEventListener("resize", fitDesignToViewport);
    return () => {
      window.removeEventListener("resize", fitDesignToViewport);
      window.visualViewport?.removeEventListener("resize", fitDesignToViewport);
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    betTypeRef.current = betType;
  }, [betType]);

  const finishMatch = useCallback((champion: Actor) => {
    if (winnerRecordedRef.current) return;
    winnerRecordedRef.current = true;
    const settledChampion = normalizeChampion(champion);
    const bet = getBetDefinition(betTypeRef.current);
    const finishOrder = canonicalFinishOrder(engineRef.current.actors);
    const picks = selectedIdsRef.current
      .map((fighterId) => DEFAULT_FIGHTERS.find((fighter) => fighter.id === fighterId))
      .filter((fighter): fighter is FighterConfig => Boolean(fighter));
    const won = isWinningBet(
      bet.id,
      picks.map((fighter) => fighter.id),
      finishOrder.map((fighter) => fighter.id),
    );
    const prize = won ? simulatedPrize(ENTRY_AMOUNT, bet.id) : 0;
    if (prize > 0) setBalance((current) => current + prize);
    setWinner(settledChampion);
    setStatus("finished");
    if (picks.length === bet.pickCount) {
      settlementTimerRef.current = window.setTimeout(() => {
        setSettlement({
          champion: { ...settledChampion },
          bet,
          picks,
          finishOrder,
          won,
          prize,
        });
      }, 650);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frameId = 0;
    let rankingTimer = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(WORLD_W * ratio);
      canvas.height = Math.round(WORLD_H * ratio);
      canvas.style.aspectRatio = `${WORLD_W} / ${WORLD_H}`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const frame = (time: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = time;
      const dt = clamp((time - lastFrameRef.current) / 1000, 0, 0.033);
      lastFrameRef.current = time;
      if (statusRef.current === "running") {
        const champion = stepEngine(engineRef.current, dt);
        for (const event of drainSkillCastEvents(engineRef.current)) {
          announceSkillCast(event.id, event.fighterId);
        }
        if (champion) finishMatch(champion);
      }
      drawArena(ctx, engineRef.current, statusRef.current, countdown, winner);
      rankingTimer += dt;
      if (rankingTimer > 0.12) {
        rankingTimer = 0;
        setRanking(rankingRows(engineRef.current));
      }
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, [announceSkillCast, countdown, finishMatch, winner]);

  useEffect(() => {
    if (status !== "countdown") return;
    const timer = window.setTimeout(() => {
      if (countdown <= 0) setStatus("running");
      else setCountdown((value) => value - 1);
    }, countdown <= 0 ? 0 : 620);
    return () => window.clearTimeout(timer);
  }, [countdown, status]);

  useEffect(() => () => {
    if (settlementTimerRef.current !== null) window.clearTimeout(settlementTimerRef.current);
    for (const timer of skillCastNoticeTimersRef.current) window.clearTimeout(timer);
  }, []);

  const chooseBetType = (nextType: BetType) => {
    if (locked || status === "finished" || nextType === betType) return;
    setBetType(nextType);
    setSelectedIds([]);
    setSelectedId(null);
  };

  const toggleFighterSelection = (fighterId: string) => {
    if (locked || status === "finished") return;
    const existingIndex = selectedIds.indexOf(fighterId);
    if (existingIndex >= 0) {
      const next = selectedIds.filter((id) => id !== fighterId);
      setSelectedIds(next);
      setSelectedId(next.at(-1) ?? null);
      return;
    }
    const next = activeBet.pickCount === 1
      ? [fighterId]
      : selectedIds.length < activeBet.pickCount
        ? [...selectedIds, fighterId]
        : [...selectedIds.slice(0, -1), fighterId];
    setSelectedIds(next);
    setSelectedId(fighterId);
  };

  const startMatch = () => {
    if (!betReady || !canAffordEntry || locked) return;
    if (settlementTimerRef.current !== null) window.clearTimeout(settlementTimerRef.current);
    settlementTimerRef.current = null;
    clearSkillCastNotices();
    winnerRecordedRef.current = false;
    engineRef.current = createEngine(DEFAULT_FIGHTERS);
    setRanking(rankingRows(engineRef.current));
    setWinner(null);
    setSettlement(null);
    setBalance((current) => current - ENTRY_AMOUNT);
    setCountdown(3);
    setStatus("countdown");
    lastFrameRef.current = 0;
  };

  const newMatch = () => {
    if (settlementTimerRef.current !== null) window.clearTimeout(settlementTimerRef.current);
    settlementTimerRef.current = null;
    clearSkillCastNotices();
    engineRef.current = createEngine(DEFAULT_FIGHTERS);
    setRanking(rankingRows(engineRef.current));
    setSelectedIds([]);
    setSelectedId(null);
    setWinner(null);
    setSettlement(null);
    setCountdown(3);
    setStatus("idle");
    winnerRecordedRef.current = false;
    lastFrameRef.current = 0;
  };

  return (
    <div className="arena-viewport">
      <div
        className="arena-design-surface"
        data-design-resolution={`${DESIGN_WIDTH}x${DESIGN_HEIGHT}`}
        style={{ transform: `translate(-50%, -50%) scale(${viewportScale})` }}
      >
        <main className="arena-app">
      <section className="match-shell">
        <div className="stage-frame">
          <canvas ref={canvasRef} className="battle-canvas" aria-label="Arena 亂鬥場地" />
          <div className="skill-cast-feed" role="log" aria-live="polite" aria-label="技能施放通知">
            {skillCastNotices.map((notice, index) => {
              const fighter = DEFAULT_FIGHTERS.find((entry) => entry.id === notice.fighterId);
              if (!fighter) return null;
              return (
                <div
                  className={`skill-cast-banner ${notice.leaving ? "leaving" : ""}`}
                  data-stack-index={Math.min(index, 3)}
                  key={notice.id}
                  aria-label={`${fighter.name} 施放 ${fighter.skillName}`}
                >
                  <span
                    className="skill-cast-accent"
                    aria-hidden="true"
                    style={{ backgroundColor: fighter.color, boxShadow: `0 0 12px ${fighter.color}` }}
                  />
                  <img className="skill-cast-portrait" src={fighter.icon} alt="" />
                  <img className="skill-cast-skill-icon" src={fighter.skillIcon} alt="" />
                  <strong>{fighter.skillName}</strong>
                </div>
              );
            })}
          </div>
          {selectedFighters.length > 0 && status === "idle" && (
            <div className="pick-indicator">
              <span>{activeBet.name}</span>
              <strong>{formatSelection(selectedFighters, activeBet.ordered)}</strong>
            </div>
          )}
        </div>

        <aside className="prediction-panel" aria-label="模擬下注選擇">
          {selectedFighter && status === "idle" && (
            <div
              className="selected-skill-preview"
              aria-live="polite"
              style={{
                borderColor: `${selectedFighter.color}70`,
                boxShadow: `inset 3px 0 ${selectedFighter.color}, 0 0 20px ${selectedFighter.color}16`,
              }}
            >
              <div className="selected-skill-icons">
                <img
                  className="selected-skill-fighter-icon"
                  src={selectedFighter.icon}
                  alt={`${selectedFighter.name} 角色圖示`}
                />
                <img
                  className="selected-skill-ability-icon"
                  src={selectedFighter.skillIcon}
                  alt=""
                />
              </div>
              <div>
                <strong>{selectedFighter.skillName}</strong>
                <p>{selectedFighter.skillDescription}</p>
              </div>
            </div>
          )}

          <div className="bet-methods" role="tablist" aria-label="下注玩法">
            {BET_DEFINITIONS.map((bet) => (
              <button
                className={`bet-method ${bet.id === betType ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={bet.id === betType}
                aria-label={`${bet.displayName}，${bet.name}，賠率 ${bet.decimalOdds.toFixed(2)} 倍`}
                key={bet.id}
                onClick={() => chooseBetType(bet.id)}
                disabled={locked || status === "finished"}
              >
                <strong>{bet.displayName}</strong>
                <span>賠率 {bet.decimalOdds.toFixed(2)}x</span>
              </button>
            ))}
          </div>

          <div className="bet-guide" aria-live="polite">
            <span>{activeBet.instruction}</span>
            <strong>{selectedIds.length} / {activeBet.pickCount}</strong>
          </div>

          <div className="fighter-options">
            {DEFAULT_FIGHTERS.map((fighter) => {
              const row = ranking.find((entry) => entry.id === fighter.id);
              const selectionIndex = selectedIds.indexOf(fighter.id);
              const selected = selectionIndex >= 0;
              return (
                <div className="fighter-card" key={fighter.id}>
                  <button
                    className={`fighter-option ${selected ? "selected" : ""} ${row && !row.alive ? "eliminated" : ""}`}
                    type="button"
                    onClick={() => toggleFighterSelection(fighter.id)}
                    disabled={locked || status === "finished"}
                    aria-pressed={selected}
                    aria-label={`${fighter.name}${selected ? `，已選為第 ${selectionIndex + 1} 位` : ""}`}
                  >
                    {selected && (
                      <span className={`selection-order ${activeBet.ordered ? "ordered" : "unordered"}`}>
                        {activeBet.ordered ? selectionIndex + 1 : "✓"}
                      </span>
                    )}
                    <img
                      className="fighter-avatar"
                      src={fighter.icon}
                      alt=""
                      style={{ borderColor: fighter.color, boxShadow: `0 0 18px ${fighter.color}66` }}
                    />
                    <span className="fighter-copy">
                      <strong>{fighter.name}</strong>
                    </span>
                  </button>
                  <button
                    className="skill-info-button"
                    type="button"
                    onClick={() => setSkillFighterId(fighter.id)}
                    aria-label={`查看 ${fighter.name} 技能`}
                    aria-haspopup="dialog"
                    title={`查看 ${fighter.name} 技能`}
                  >
                    <img src={fighter.skillIcon} alt="" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="entry-summary">
            <span>投注 <strong>NT$ {ENTRY_AMOUNT}</strong></span>
            <span>餘額 <strong>NT$ {balance.toLocaleString("zh-TW")}</strong></span>
          </div>

          <button
            className="start-button"
            type="button"
            onClick={startMatch}
            disabled={!betReady || !canAffordEntry || locked || status === "finished"}
          >
            {status === "countdown"
              ? "準備開戰"
              : status === "running"
                ? "戰鬥進行中"
                : !canAffordEntry
                  ? "餘額不足"
                  : "開始亂鬥"}
          </button>
          {status !== "idle" && (
            <button className="back-to-bet-button" type="button" onClick={newMatch}>
              回到下注
            </button>
          )}
        </aside>
      </section>

      {skillFighter && (
        <div
          className="skill-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSkillFighterId(null);
          }}
        >
          <section
            className="skill-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-dialog-title"
            aria-describedby="skill-dialog-description"
            style={{
              borderColor: `${skillFighter.color}99`,
              boxShadow: `0 30px 90px #000b, 0 0 44px ${skillFighter.color}22`,
            }}
          >
            <button
              className="skill-dialog-close"
              type="button"
              onClick={() => setSkillFighterId(null)}
              aria-label="關閉技能資訊"
              autoFocus
            >
              ×
            </button>
            <div className="skill-fighter-heading">
              <img className="skill-fighter-avatar" src={skillFighter.icon} alt="" />
              <div>
                <span>FIGHTER SKILL</span>
                <strong>{skillFighter.name}</strong>
              </div>
            </div>
            <img
              className="skill-dialog-icon"
              src={skillFighter.skillIcon}
              alt={`${skillFighter.name} ${skillFighter.skillName} 技能圖示`}
            />
            <h2 id="skill-dialog-title">{skillFighter.skillName}</h2>
            <p id="skill-dialog-description">{skillFighter.skillDescription}</p>
            <button className="skill-dialog-action" type="button" onClick={() => setSkillFighterId(null)}>
              關閉
            </button>
          </section>
        </div>
      )}

      {settlement && (
        <div className="result-backdrop" role="presentation">
          <section className={`result-dialog ${settlement.won ? "won" : "lost"}`} role="dialog" aria-modal="true" aria-labelledby="result-title">
            <div className="result-emblem" aria-hidden="true">
              <img src={settlement.champion.icon} alt="" />
            </div>
            <p className="result-kicker">{settlement.won ? "BET WON" : "MATCH COMPLETE"}</p>
            <h2 id="result-title">{settlement.champion.name} 成為冠軍</h2>
            <p className="result-copy">
              <strong>{settlement.bet.name}</strong> · {settlement.won ? "下注結果命中。" : "本局未命中。"}
            </p>
            <div className="result-bet-summary">
              <div>
                <span>你的選擇</span>
                <strong>{formatSelection(settlement.picks, settlement.bet.ordered)}</strong>
              </div>
              <div>
                <span>本局前三</span>
                <strong>{formatSelection(settlement.finishOrder.slice(0, 3), true)}</strong>
              </div>
            </div>
            <div className="prize-card">
              <span>{settlement.won ? "獲得模擬獎金" : "本局獎金"}</span>
              <strong>NT$ {settlement.prize.toLocaleString("zh-TW")}</strong>
            </div>
            <button type="button" className="play-again-button" onClick={newMatch}>回到下注</button>
          </section>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {settlement
          ? `${settlement.champion.name} 獲勝，${settlement.bet.name}${settlement.won ? `命中，獲得模擬獎金 ${settlement.prize} 元` : "未命中"}`
          : status === "running"
            ? "比賽進行中"
            : ""}
      </div>
        </main>
      </div>
    </div>
  );
}
