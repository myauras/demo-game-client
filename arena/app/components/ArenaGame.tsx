"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FIGHTERS, DEFAULT_RULES, type FighterConfig } from "../lib/arena";
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
const WIN_PRIZE = 500;

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

export default function ArenaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineState>(createEngine(DEFAULT_FIGHTERS));
  const statusRef = useRef<GameStatus>("idle");
  const selectedIdRef = useRef<string | null>(null);
  const lastFrameRef = useRef(0);
  const winnerRecordedRef = useRef(false);

  const [status, setStatus] = useState<GameStatus>("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [ranking, setRanking] = useState<RankingRow[]>(() => rankingRows(engineRef.current));
  const [winner, setWinner] = useState<Actor | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);

  const selectedFighter = useMemo(
    () => DEFAULT_FIGHTERS.find((fighter) => fighter.id === selectedId) ?? null,
    [selectedId],
  );
  const locked = status === "countdown" || status === "running";

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const finishMatch = useCallback((champion: Actor) => {
    if (winnerRecordedRef.current) return;
    winnerRecordedRef.current = true;
    const pick = DEFAULT_FIGHTERS.find((fighter) => fighter.id === selectedIdRef.current);
    setWinner({ ...champion });
    setStatus("finished");
    if (pick) {
      window.setTimeout(() => {
        setSettlement({ champion: { ...champion }, pick, won: pick.id === champion.id });
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
        const champion = stepEngine(engineRef.current, DEFAULT_RULES, dt, () => undefined);
        if (champion) finishMatch(champion);
      }
      const paintedWinner = statusRef.current === "finished"
        ? engineRef.current.actors.find((actor) => actor.alive) ?? winner
        : winner;
      drawArena(ctx, engineRef.current, statusRef.current, countdown, paintedWinner);
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

  const startMatch = () => {
    if (!selectedId || locked) return;
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
    <main className="arena-app">
      <header className="arena-header">
        <div className="brand-lockup" aria-label="Arena 冠軍預測亂鬥">
          <span className="brand-mark">A</span>
          <div>
            <p>CHAMPION PICK</p>
            <h1>ARENA</h1>
          </div>
        </div>
        <div className="prize-display">
          <span>本局模擬獎金</span>
          <strong>NT$ {WIN_PRIZE.toLocaleString("zh-TW")}</strong>
        </div>
      </header>

      <section className="match-shell">
        <div className="stage-frame">
          <canvas ref={canvasRef} className="battle-canvas" aria-label="Arena 亂鬥場地" />
          {selectedFighter && status === "idle" && (
            <div className="pick-indicator">
              <span style={{ background: selectedFighter.color }} />
              冠軍預測：<strong>{selectedFighter.name}</strong>
            </div>
          )}
        </div>

        <aside className="prediction-panel" aria-label="冠軍預測">
          <div className="prediction-heading">
            <span>YOUR PICK</span>
            <h2>選擇冠軍</h2>
            <p>選一位你看好的英雄，再開始這場亂鬥。</p>
          </div>

          <div className="fighter-options">
            {DEFAULT_FIGHTERS.map((fighter, index) => {
              const row = ranking.find((entry) => entry.id === fighter.id);
              const selected = selectedId === fighter.id;
              return (
                <button
                  className={`fighter-option ${selected ? "selected" : ""} ${row && !row.alive ? "eliminated" : ""}`}
                  type="button"
                  key={fighter.id}
                  onClick={() => setSelectedId(fighter.id)}
                  disabled={locked || status === "finished"}
                  aria-pressed={selected}
                >
                  <span className="fighter-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="fighter-dot" style={{ background: fighter.color, boxShadow: `0 0 18px ${fighter.color}88` }} />
                  <span className="fighter-copy">
                    <strong>{fighter.name}</strong>
                    <small>{row && status !== "idle" ? (row.alive ? `${Math.round(row.damage)}% DAMAGE` : "OUT") : "5.00× ODDS"}</small>
                  </span>
                  <span className="pick-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>

          <div className="entry-summary">
            <span>模擬投入 <strong>NT$ {ENTRY_AMOUNT}</strong></span>
            <span>預測成功 <strong>NT$ {WIN_PRIZE}</strong></span>
          </div>

          <button
            className="start-button"
            type="button"
            onClick={startMatch}
            disabled={!selectedFighter || locked || status === "finished"}
          >
            {status === "countdown" ? "準備開戰" : status === "running" ? "戰鬥進行中" : "開始亂鬥"}
          </button>
          {!selectedFighter && status === "idle" && <p className="selection-hint">請先選擇一位冠軍</p>}
        </aside>
      </section>

      {settlement && (
        <div className="result-backdrop" role="presentation">
          <section className={`result-dialog ${settlement.won ? "won" : "lost"}`} role="dialog" aria-modal="true" aria-labelledby="result-title">
            <div className="result-emblem" aria-hidden="true">{settlement.won ? "★" : "◆"}</div>
            <p className="result-kicker">{settlement.won ? "PREDICTION WON" : "MATCH COMPLETE"}</p>
            <h2 id="result-title">{settlement.champion.name} 成為冠軍</h2>
            <p className="result-copy">
              你選擇了 <strong>{settlement.pick.name}</strong>，{settlement.won ? "預測完全命中。" : "這次沒有預測成功。"}
            </p>
            <div className="prize-card">
              <span>{settlement.won ? "獲得模擬獎金" : "本局獎金"}</span>
              <strong>NT$ {settlement.won ? WIN_PRIZE.toLocaleString("zh-TW") : "0"}</strong>
            </div>
            <button type="button" className="play-again-button" onClick={newMatch}>再玩一場</button>
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
  );
}
