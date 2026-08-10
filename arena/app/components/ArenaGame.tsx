"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FIGHTERS,
  DEFAULT_RULES,
  RULE_COPY,
  uid,
  type ArenaRules,
  type FighterConfig,
} from "../lib/arena";
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

type Panel = "fighters" | "rules" | "history" | "help" | null;
type MatchRecord = {
  id: string;
  winner: string;
  color: string;
  duration: number;
  contenders: number;
  playedAt: number;
};

const PLAYER_STORAGE = "arena-fighters-v1";
const RULE_STORAGE = "arena-rules-v1";
const HISTORY_STORAGE = "arena-history-v1";

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
  const shellRef = useRef<HTMLElement>(null);
  const engineRef = useRef<EngineState>(createEngine(DEFAULT_FIGHTERS));
  const statusRef = useRef<GameStatus>("idle");
  const rulesRef = useRef<ArenaRules>(DEFAULT_RULES);
  const lastFrameRef = useRef(0);
  const winnerRecordedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(true);

  const [fighters, setFighters] = useState<FighterConfig[]>(DEFAULT_FIGHTERS);
  const [draftFighters, setDraftFighters] = useState<FighterConfig[]>(DEFAULT_FIGHTERS);
  const [rules, setRules] = useState<ArenaRules>(DEFAULT_RULES);
  const [draftRules, setDraftRules] = useState<ArenaRules>(DEFAULT_RULES);
  const [status, setStatus] = useState<GameStatus>("idle");
  const [countdown, setCountdown] = useState(3);
  const [ranking, setRanking] = useState<RankingRow[]>(() => rankingRows(engineRef.current));
  const [winner, setWinner] = useState<Actor | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [history, setHistory] = useState<MatchRecord[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const activeCount = useMemo(() => ranking.filter((actor) => actor.alive).length, [ranking]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    try {
      const savedFighters = JSON.parse(localStorage.getItem(PLAYER_STORAGE) || "null") as FighterConfig[] | null;
      const savedRules = JSON.parse(localStorage.getItem(RULE_STORAGE) || "null") as ArenaRules | null;
      const savedHistory = JSON.parse(localStorage.getItem(HISTORY_STORAGE) || "[]") as MatchRecord[];
      if (Array.isArray(savedFighters) && savedFighters.length >= 2) {
        setFighters(savedFighters);
        setDraftFighters(savedFighters);
        engineRef.current = createEngine(savedFighters);
        setRanking(rankingRows(engineRef.current));
      }
      if (savedRules) {
        const nextRules = { ...DEFAULT_RULES, ...savedRules };
        setRules(nextRules);
        setDraftRules(nextRules);
      }
      if (Array.isArray(savedHistory)) setHistory(savedHistory.slice(0, 20));
    } catch {
      // Invalid local preferences are ignored so the game always remains playable.
    }
  }, []);

  const blip = useCallback((frequency: number, duration = 0.035, volume = 0.025) => {
    if (!soundOnRef.current || typeof window === "undefined") return;
    try {
      const AudioCtor = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const audio = audioContextRef.current || new AudioCtor();
      audioContextRef.current = audio;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration);
    } catch {
      // Browsers may block audio until the first explicit gesture.
    }
  }, []);

  const onEngineSound = useCallback((kind: "hit" | "item" | "out" | "bomb") => {
    if (kind === "hit") blip(135 + Math.random() * 45, 0.025, 0.014);
    if (kind === "item") blip(480, 0.06, 0.025);
    if (kind === "out") blip(72, 0.09, 0.045);
    if (kind === "bomb") blip(85, 0.15, 0.065);
  }, [blip]);

  const finishMatch = useCallback((champion: Actor) => {
    if (winnerRecordedRef.current) return;
    winnerRecordedRef.current = true;
    const engine = engineRef.current;
    setWinner({ ...champion });
    setStatus("finished");
    blip(620, 0.12, 0.055);
    window.setTimeout(() => blip(860, 0.16, 0.045), 120);
    const record: MatchRecord = {
      id: uid("match"),
      winner: champion.name,
      color: champion.color,
      duration: engine.elapsed,
      contenders: engine.actors.length,
      playedAt: Date.now(),
    };
    setHistory((current) => {
      const next = [record, ...current].slice(0, 20);
      localStorage.setItem(HISTORY_STORAGE, JSON.stringify(next));
      return next;
    });
  }, [blip]);

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
        const champion = stepEngine(engineRef.current, rulesRef.current, dt, onEngineSound);
        if (champion) finishMatch(champion);
      }
      const paintedWinner = statusRef.current === "finished"
        ? engineRef.current.actors.find((actor) => actor.alive) || winner
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
  }, [countdown, finishMatch, onEngineSound, winner]);

  useEffect(() => {
    if (status !== "countdown") return;
    if (countdown <= 0) {
      setStatus("running");
      blip(660, 0.08, 0.04);
      return;
    }
    const timer = window.setTimeout(() => {
      blip(260 + (3 - countdown) * 90, 0.04, 0.025);
      setCountdown((value) => value - 1);
    }, 620);
    return () => window.clearTimeout(timer);
  }, [blip, countdown, status]);

  const startRound = useCallback(() => {
    winnerRecordedRef.current = false;
    engineRef.current = createEngine(fighters);
    setRanking(rankingRows(engineRef.current));
    setWinner(null);
    setCountdown(3);
    setStatus("countdown");
    setPanel(null);
    lastFrameRef.current = 0;
  }, [fighters]);

  const togglePause = useCallback(() => {
    if (statusRef.current === "running") setStatus("paused");
    else if (statusRef.current === "paused") setStatus("running");
  }, []);

  const resetRound = useCallback(() => {
    engineRef.current = createEngine(fighters);
    setRanking(rankingRows(engineRef.current));
    setWinner(null);
    setCountdown(3);
    setStatus("idle");
    winnerRecordedRef.current = false;
  }, [fighters]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (statusRef.current === "idle" || statusRef.current === "finished") startRound();
        else togglePause();
      }
      if (event.key.toLowerCase() === "r") resetRound();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetRound, startRound, togglePause]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const openPanel = (next: Exclude<Panel, null>) => {
    if (next === "fighters") setDraftFighters(fighters.map((fighter) => ({ ...fighter })));
    if (next === "rules") setDraftRules({ ...rules });
    setPanel(next);
  };

  const saveFighters = () => {
    const clean = draftFighters.map((fighter, index) => ({
      ...fighter,
      name: fighter.name.trim() || `訊號 ${index + 1}`,
      weight: clamp(Number(fighter.weight) || 1, 1, 5),
    })).slice(0, 16);
    if (clean.length < 2) return;
    setFighters(clean);
    localStorage.setItem(PLAYER_STORAGE, JSON.stringify(clean));
    engineRef.current = createEngine(clean);
    setRanking(rankingRows(engineRef.current));
    setStatus("idle");
    setWinner(null);
    setPanel(null);
  };

  const saveRules = () => {
    setRules(draftRules);
    localStorage.setItem(RULE_STORAGE, JSON.stringify(draftRules));
    setPanel(null);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      setFullscreen(false);
    }
  };

  const actionLabel = status === "running" ? "暫停" : status === "paused" ? "繼續" : "開戰";

  return (
    <main className="arena-app" ref={shellRef}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="arena-header">
        <div className="brand-lockup" aria-label="Arena 自動亂鬥模擬器">
          <div className="brand-mark">A</div>
          <div><p className="eyebrow">AUTONOMOUS COMBAT LAB</p><h1>ARENA</h1></div>
        </div>
        <div className="header-status">
          <span className={`status-light ${status}`} />
          <span>{status === "running" ? "LIVE MATCH" : status === "paused" ? "SIMULATION PAUSED" : "SYSTEM READY"}</span>
          <span className="status-divider" />
          <span>{fighters.length.toString().padStart(2, "0")} SIGNALS</span>
        </div>
        <nav className="header-actions" aria-label="Arena 工具">
          <button className="icon-button" type="button" onClick={() => openPanel("history")} aria-label="戰績"><span aria-hidden="true">▦</span><span className="button-hint">戰績</span></button>
          <button className="icon-button" type="button" onClick={() => openPanel("help")} aria-label="玩法說明"><span aria-hidden="true">?</span><span className="button-hint">說明</span></button>
          <button className="icon-button" type="button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "關閉音效" : "開啟音效"}><span aria-hidden="true">{soundOn ? "♪" : "×"}</span><span className="button-hint">音效</span></button>
          <button className="icon-button" type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "離開全螢幕" : "全螢幕"}><span aria-hidden="true">{fullscreen ? "↙" : "↗"}</span><span className="button-hint">全屏</span></button>
        </nav>
      </header>

      <section className="battle-layout">
        <aside className="control-rail" aria-label="比賽設定">
          <div className="rail-label">MATCH CONTROL</div>
          <button type="button" className="rail-button" onClick={() => openPanel("fighters")} disabled={status === "running" || status === "countdown"}><span className="rail-icon">◎</span><span>參賽者</span><small>{fighters.length}</small></button>
          <button type="button" className="rail-button" onClick={() => openPanel("rules")} disabled={status === "running" || status === "countdown"}><span className="rail-icon">⌘</span><span>規則模組</span><small>{Object.values(rules).filter(Boolean).length}</small></button>
          <button type="button" className="rail-button" onClick={resetRound}><span className="rail-icon">↻</span><span>重置戰場</span></button>
          <div className="rail-keymap"><p>快捷操作</p><div><kbd>SPACE</kbd><span>開戰 / 暫停</span></div><div><kbd>R</kbd><span>重置</span></div></div>
        </aside>

        <div className="stage-column">
          <div className="stage-frame">
            <div className="stage-corner corner-a" /><div className="stage-corner corner-b" />
            <canvas ref={canvasRef} className="battle-canvas" aria-label="Arena 自動戰鬥場地" />
            <div className="round-chip">ROUND {String(history.length + 1).padStart(2, "0")}</div>
            <div className="survivor-chip"><span>{activeCount}</span> / {ranking.length} ACTIVE</div>
          </div>
          <div className="match-actions">
            <div className="match-note"><span className="note-pulse" /><p><strong>自動戰鬥</strong><small>傷害越高，受到撞擊時飛得越遠</small></p></div>
            <button className={`primary-action ${status === "running" ? "pause" : ""}`} type="button" onClick={status === "running" || status === "paused" ? togglePause : startRound} disabled={status === "countdown"}>
              <span className="action-symbol">{status === "running" ? "Ⅱ" : status === "paused" ? "▶" : "◆"}</span><span>{status === "countdown" ? "訊號同步中" : actionLabel}</span><small>{status === "running" ? "SPACE TO PAUSE" : "SPACE TO START"}</small>
            </button>
          </div>
        </div>

        <aside className="scoreboard" aria-label="即時排名">
          <div className="scoreboard-title"><div><p className="eyebrow">LIVE TELEMETRY</p><h2>即時排名</h2></div><span>{status === "running" ? "LIVE" : "STANDBY"}</span></div>
          <div className="ranking-list">
            {ranking.map((actor, index) => (
              <div className={`ranking-row ${!actor.alive ? "is-out" : ""}`} key={actor.id}>
                <div className="rank-number">{String(index + 1).padStart(2, "0")}</div>
                <span className="fighter-swatch" style={{ background: actor.color, boxShadow: `0 0 14px ${actor.color}88` }} />
                <div className="rank-name"><strong>{actor.name}</strong><small>{actor.alive ? "SIGNAL STABLE" : "DISCONNECTED"}</small></div>
                <div className={`damage-value ${actor.damage >= 100 ? "danger" : ""}`}>{actor.alive ? `${Math.round(actor.damage)}%` : "OUT"}</div>
              </div>
            ))}
          </div>
          <div className="score-legend"><span><i className="legend-dot safe" />0–59 穩定</span><span><i className="legend-dot warning" />60–99 危險</span><span><i className="legend-dot critical" />100+ 臨界</span></div>
        </aside>
      </section>

      <footer className="arena-footer"><span>ARENA / LOCAL SIMULATION</span><span>NO NETWORK · DEVICE-LOCAL SETTINGS</span></footer>

      {panel && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <header className="modal-header">
              <div><p className="eyebrow">ARENA CONFIGURATION</p><h2 id="modal-title">{panel === "fighters" ? "參賽訊號" : panel === "rules" ? "規則模組" : panel === "history" ? "比賽戰績" : "玩法說明"}</h2></div>
              <button className="modal-close" type="button" onClick={() => setPanel(null)} aria-label="關閉">×</button>
            </header>

            {panel === "fighters" && (
              <div className="modal-content">
                <div className="config-summary"><span>至少 2 位、最多 16 位</span><strong>{draftFighters.length} SIGNALS</strong></div>
                <div className="fighter-editor-list">
                  {draftFighters.map((fighter, index) => (
                    <div className="fighter-editor" key={fighter.id}>
                      <span className="editor-index">{String(index + 1).padStart(2, "0")}</span>
                      <label className="color-field" aria-label={`${fighter.name} 顏色`}><input type="color" value={fighter.color} onChange={(event) => setDraftFighters((items) => items.map((item) => item.id === fighter.id ? { ...item, color: event.target.value } : item))} /><span style={{ background: fighter.color }} /></label>
                      <label className="text-field"><span>代號</span><input value={fighter.name} maxLength={16} onChange={(event) => setDraftFighters((items) => items.map((item) => item.id === fighter.id ? { ...item, name: event.target.value } : item))} /></label>
                      <label className="weight-field"><span>質量</span><input type="number" min="1" max="5" value={fighter.weight} onChange={(event) => setDraftFighters((items) => items.map((item) => item.id === fighter.id ? { ...item, weight: clamp(Number(event.target.value), 1, 5) } : item))} /></label>
                      <button type="button" className="remove-button" disabled={draftFighters.length <= 2} onClick={() => setDraftFighters((items) => items.filter((item) => item.id !== fighter.id))} aria-label={`移除 ${fighter.name}`}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="add-fighter" disabled={draftFighters.length >= 16} onClick={() => {
                  const palette = ["#ff5d73", "#41b8ff", "#ffbd45", "#a77bff", "#45e0b7", "#ff8a45"];
                  setDraftFighters((items) => [...items, { id: uid(), name: `訊號 ${items.length + 1}`, color: palette[items.length % palette.length], weight: 1 }]);
                }}>＋ 新增參賽者</button>
              </div>
            )}

            {panel === "rules" && (
              <div className="modal-content rule-grid">
                {RULE_COPY.map((rule) => (
                  <label className={`rule-card ${draftRules[rule.key] ? "enabled" : ""}`} key={rule.key}>
                    <input type="checkbox" checked={draftRules[rule.key]} onChange={() => setDraftRules((current) => ({ ...current, [rule.key]: !current[rule.key] }))} />
                    <span className="rule-icon">{rule.icon}</span><span className="rule-copy"><strong>{rule.title}</strong><small>{rule.description}</small></span><span className="toggle"><i /></span>
                  </label>
                ))}
              </div>
            )}

            {panel === "history" && (
              <div className="modal-content">
                {history.length === 0 ? <div className="empty-state"><span>◇</span><h3>尚無比賽紀錄</h3><p>完成第一場亂鬥後，勝者會出現在這裡。</p></div> : (
                  <div className="history-list">{history.map((match, index) => (
                    <article className="history-row" key={match.id}><span className="history-rank">#{String(history.length - index).padStart(2, "0")}</span><span className="history-swatch" style={{ background: match.color }} /><div><strong>{match.winner}</strong><small>{new Date(match.playedAt).toLocaleString("zh-TW")}</small></div><div className="history-stat"><strong>{match.duration.toFixed(1)}s</strong><small>{match.contenders} 位參賽者</small></div></article>
                  ))}</div>
                )}
              </div>
            )}

            {panel === "help" && (
              <div className="modal-content help-content">
                <div className="help-hero"><span>碰撞</span><i>→</i><span>累積傷害</span><i>→</i><span>擊飛淘汰</span></div>
                <div className="help-steps"><article><b>01</b><h3>建立陣容</h3><p>設定參賽者代號、顏色與質量。質量越高越穩，但移動與轉向稍慢。</p></article><article><b>02</b><h3>高速交戰</h3><p>戰鬥 AI 會高速追擊與衝刺。撞擊會迅速累積傷害，百分比越高就越容易飛出場。</p></article><article><b>03</b><h3>撐到最後</h3><p>拾取場上的規則模組取得短暫優勢。最後一位留在能量環內的參賽者獲勝。</p></article></div>
                <div className="help-alert"><strong>決勝縮圈</strong><span>正式開戰後能量環會立即以較慢速度收縮，保留兩格同心圓後停止縮小。</span></div>
              </div>
            )}

            {(panel === "fighters" || panel === "rules") && (
              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => { if (panel === "fighters") setDraftFighters(DEFAULT_FIGHTERS.map((fighter) => ({ ...fighter }))); else setDraftRules({ ...DEFAULT_RULES }); }}>還原預設</button>
                <div><button type="button" className="secondary-button" onClick={() => setPanel(null)}>取消</button><button type="button" className="save-button" onClick={panel === "fighters" ? saveFighters : saveRules}>儲存設定</button></div>
              </footer>
            )}
          </section>
        </div>
      )}

      <div className="sr-only" aria-live="polite">{status === "finished" && winner ? `${winner.name} 獲勝` : status === "running" ? `比賽進行中，剩餘 ${activeCount} 位` : ""}</div>
    </main>
  );
}
