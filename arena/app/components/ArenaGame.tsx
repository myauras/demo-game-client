"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FIGHTERS, type FighterConfig } from "../lib/arena";
import {
  createEngine,
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
const WIN_PROBABILITY = 1 / DEFAULT_FIGHTERS.length;
const DECIMAL_ODDS = 1 / WIN_PROBABILITY;
const WIN_PRIZE = ENTRY_AMOUNT * DECIMAL_ODDS;
const DESIGN_WIDTH = 1179;
const DESIGN_HEIGHT = 1977;

type Settlement = {
  champion: Actor;
  pick: FighterConfig;
  won: boolean;
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

export default function ArenaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineState>(createEngine(DEFAULT_FIGHTERS));
  const statusRef = useRef<GameStatus>("idle");
  const selectedIdRef = useRef<string | null>(null);
  const lastFrameRef = useRef(0);
  const winnerRecordedRef = useRef(false);
  const settlementTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState<GameStatus>("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [ranking, setRanking] = useState<RankingRow[]>(() => rankingRows(engineRef.current));
  const [winner, setWinner] = useState<Actor | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [skillFighterId, setSkillFighterId] = useState<string | null>(null);
  const [viewportScale, setViewportScale] = useState(1);

  const selectedFighter = useMemo(
    () => DEFAULT_FIGHTERS.find((fighter) => fighter.id === selectedId) ?? null,
    [selectedId],
  );
  const skillFighter = useMemo(
    () => DEFAULT_FIGHTERS.find((fighter) => fighter.id === skillFighterId) ?? null,
    [skillFighterId],
  );
  const locked = status === "countdown" || status === "running";

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
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const finishMatch = useCallback((champion: Actor) => {
    if (winnerRecordedRef.current) return;
    winnerRecordedRef.current = true;
    const settledChampion = normalizeChampion(champion);
    const pick = DEFAULT_FIGHTERS.find((fighter) => fighter.id === selectedIdRef.current);
    setWinner(settledChampion);
    setStatus("finished");
    if (pick) {
      settlementTimerRef.current = window.setTimeout(() => {
        setSettlement({
          champion: { ...settledChampion },
          pick,
          won: pick.id === settledChampion.id,
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
  }, [countdown, finishMatch, winner]);

  useEffect(() => {
    if (status !== "countdown") return;
    if (countdown <= 0) {
      setStatus("running");
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 620);
    return () => window.clearTimeout(timer);
  }, [countdown, status]);

  useEffect(() => () => {
    if (settlementTimerRef.current !== null) window.clearTimeout(settlementTimerRef.current);
  }, []);

  const startMatch = () => {
    if (!selectedId || locked) return;
    if (settlementTimerRef.current !== null) window.clearTimeout(settlementTimerRef.current);
    settlementTimerRef.current = null;
    winnerRecordedRef.current = false;
    engineRef.current = createEngine(DEFAULT_FIGHTERS);
    setRanking(rankingRows(engineRef.current));
    setWinner(null);
    setSettlement(null);
    setCountdown(3);
    setStatus("countdown");
    lastFrameRef.current = 0;
  };

  const newMatch = () => {
    if (settlementTimerRef.current !== null) window.clearTimeout(settlementTimerRef.current);
    settlementTimerRef.current = null;
    engineRef.current = createEngine(DEFAULT_FIGHTERS);
    setRanking(rankingRows(engineRef.current));
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
          {selectedFighter && status === "idle" && (
            <div className="pick-indicator">
              <img src={selectedFighter.icon} alt="" />
              冠軍預測：<strong>{selectedFighter.name}</strong>
            </div>
          )}
        </div>

        <aside className="prediction-panel" aria-label="冠軍預測">
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
          <div className="fighter-options">
            {DEFAULT_FIGHTERS.map((fighter) => {
              const row = ranking.find((entry) => entry.id === fighter.id);
              const selected = selectedId === fighter.id;
              return (
                <div className="fighter-card" key={fighter.id}>
                  <button
                    className={`fighter-option ${selected ? "selected" : ""} ${row && !row.alive ? "eliminated" : ""}`}
                    type="button"
                    onClick={() => setSelectedId(fighter.id)}
                    disabled={locked || status === "finished"}
                    aria-pressed={selected}
                  >
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
            <span>模擬投注 <strong>NT$ {ENTRY_AMOUNT}</strong></span>
            <span>賠率 <strong>{DECIMAL_ODDS.toFixed(2)}x</strong></span>
          </div>

          <button
            className="start-button"
            type="button"
            onClick={startMatch}
            disabled={!selectedFighter || locked || status === "finished"}
          >
            {status === "countdown" ? "準備開戰" : status === "running" ? "戰鬥進行中" : "開始亂鬥"}
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
            <p className="result-kicker">{settlement.won ? "PREDICTION WON" : "MATCH COMPLETE"}</p>
            <h2 id="result-title">{settlement.champion.name} 成為冠軍</h2>
            <p className="result-copy">
              你選擇了 <strong>{settlement.pick.name}</strong>，{settlement.won ? "預測完全命中。" : "這次沒有預測成功。"}
            </p>
            <div className="prize-card">
              <span>{settlement.won ? "獲得模擬獎金" : "本局獎金"}</span>
              <strong>NT$ {settlement.won ? WIN_PRIZE.toLocaleString("zh-TW") : "0"}</strong>
            </div>
            <button type="button" className="play-again-button" onClick={newMatch}>回到下注</button>
          </section>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {settlement
          ? `${settlement.champion.name} 獲勝，${settlement.won ? `獲得模擬獎金 ${WIN_PRIZE} 元` : "預測未命中"}`
          : status === "running"
            ? "比賽進行中"
            : ""}
      </div>
        </main>
      </div>
    </div>
  );
}
