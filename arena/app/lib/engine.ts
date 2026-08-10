import type { ArenaRules, FighterConfig, ItemKind } from "./arena";

export type GameStatus = "idle" | "countdown" | "running" | "paused" | "finished";

export type Actor = FighterConfig & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  damage: number;
  alive: boolean;
  outAt: number;
  heading: number;
  aiTimer: number;
  targetAngle: number;
  powerUntil: number;
  shieldUntil: number;
  hasteUntil: number;
  giantUntil: number;
  hitFlash: number;
};

type ArenaItem = {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  radius: number;
  explodeAt: number;
};

export type EngineState = {
  actors: Actor[];
  items: ArenaItem[];
  elapsed: number;
  itemTimer: number;
  sequence: number;
  arenaRadius: number;
};

export type RankingRow = Pick<Actor, "id" | "name" | "color" | "damage" | "alive" | "outAt">;

export const WORLD_W = 1000;
export const WORLD_H = 650;
const CX = WORLD_W / 2;
const CY = 326;
const BASE_RADIUS = 238;
const MIN_RADIUS = 120;
const SHRINK_DELAY = 0;
const SHRINK_SPEED = 5.5;
const MOVE_ACCEL = 210;
const MAX_MOVE_SPEED = 350;
const DASH_MIN = 165;
const DASH_VARIANCE = 135;
const HIT_DAMAGE_BASE = 5;
const HIT_DAMAGE_SPEED = 0.038;
const KNOCKBACK_SPEED = 0.52;
const KNOCKBACK_BASE = 110;
const KNOCKBACK_DAMAGE = 2.6;

const ITEM_STYLE: Record<ItemKind, { color: string; glyph: string }> = {
  heal: { color: "#45e0b7", glyph: "+" },
  power: { color: "#ff5d73", glyph: "×" },
  shield: { color: "#41b8ff", glyph: "◈" },
  haste: { color: "#ffe066", glyph: "»" },
  giant: { color: "#a77bff", glyph: "⬡" },
  bomb: { color: "#ff7a45", glyph: "!" },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function randomPoint(radius: number) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radius;
  return { x: CX + Math.cos(angle) * distance, y: CY + Math.sin(angle) * distance };
}

export function createEngine(fighters: FighterConfig[]): EngineState {
  const offset = Math.random() * Math.PI * 2;
  const spread = Math.min(142, 45 + fighters.length * 16);
  return {
    actors: fighters.map((fighter, index) => {
      const angle = offset + (index / fighters.length) * Math.PI * 2;
      const baseRadius = 18 + clamp(fighter.weight, 1, 5) * 1.8;
      return {
        ...fighter,
        x: CX + Math.cos(angle) * spread,
        y: CY + Math.sin(angle) * spread,
        vx: Math.cos(angle + Math.PI) * 40,
        vy: Math.sin(angle + Math.PI) * 40,
        radius: baseRadius,
        baseRadius,
        damage: 0,
        alive: true,
        outAt: Number.POSITIVE_INFINITY,
        heading: angle + Math.PI,
        aiTimer: Math.random() * 0.8,
        targetAngle: angle + Math.PI,
        powerUntil: 0,
        shieldUntil: 0,
        hasteUntil: 0,
        giantUntil: 0,
        hitFlash: 0,
      };
    }),
    items: [],
    elapsed: 0,
    itemTimer: 2.8,
    sequence: 0,
    arenaRadius: BASE_RADIUS,
  };
}

export function rankActors(actors: Actor[]): Actor[] {
  return [...actors].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (!a.alive && !b.alive) return b.outAt - a.outAt;
    return a.damage - b.damage;
  });
}

function explodeBomb(item: ArenaItem, engine: EngineState) {
  for (const actor of engine.actors) {
    if (!actor.alive) continue;
    const dx = actor.x - item.x;
    const dy = actor.y - item.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    if (distance > 112) continue;
    const force = (1 - distance / 112) * (390 + actor.damage * 3.4);
    actor.vx += (dx / distance) * force;
    actor.vy += (dy / distance) * force;
    actor.damage = clamp(actor.damage + (1 - distance / 112) * 36, 0, 999);
    actor.hitFlash = 0.14;
  }
}

export function stepEngine(
  engine: EngineState,
  rules: ArenaRules,
  dt: number,
  onSound: (kind: "hit" | "item" | "out" | "bomb") => void,
) {
  engine.elapsed += dt;
  engine.itemTimer -= dt;
  // Close from the first live frame at half speed until two 60 px arena grid
  // bands remain.
  const shrinkElapsed = Math.max(0, engine.elapsed - SHRINK_DELAY);
  engine.arenaRadius = Math.max(MIN_RADIUS, BASE_RADIUS - shrinkElapsed * SHRINK_SPEED);

  const enabled: ItemKind[] = [];
  if (rules.heal) enabled.push("heal");
  if (rules.power) enabled.push("power");
  if (rules.shield) enabled.push("shield");
  if (rules.haste) enabled.push("haste");
  if (rules.giant) enabled.push("giant");
  if (rules.bombs) enabled.push("bomb");
  if (engine.itemTimer <= 0 && enabled.length > 0 && engine.items.length < 3) {
    const point = randomPoint(engine.arenaRadius * 0.68);
    const kind = enabled[Math.floor(Math.random() * enabled.length)];
    engine.items.push({
      id: engine.sequence += 1,
      kind,
      x: point.x,
      y: point.y,
      radius: kind === "bomb" ? 17 : 15,
      explodeAt: kind === "bomb" ? engine.elapsed + 2.35 : Number.POSITIVE_INFINITY,
    });
    engine.itemTimer = 3.2 + Math.random() * 2.4;
  }

  for (const item of [...engine.items]) {
    if (item.kind === "bomb" && engine.elapsed >= item.explodeAt) {
      explodeBomb(item, engine);
      engine.items = engine.items.filter((entry) => entry.id !== item.id);
      onSound("bomb");
    }
  }

  const alive = engine.actors.filter((actor) => actor.alive);
  for (const actor of alive) {
    actor.aiTimer -= dt;
    actor.hitFlash = Math.max(0, actor.hitFlash - dt);
    actor.radius = actor.giantUntil > engine.elapsed ? actor.baseRadius * 1.55 : actor.baseRadius;
    if (actor.aiTimer <= 0) {
      const opponents = alive.filter((entry) => entry.id !== actor.id);
      const target = opponents[Math.floor(Math.random() * opponents.length)];
      const homeAngle = Math.atan2(CY - actor.y, CX - actor.x);
      const targetAngle = target ? Math.atan2(target.y - actor.y, target.x - actor.x) : homeAngle;
      const edge = Math.hypot(actor.x - CX, actor.y - CY) / engine.arenaRadius;
      actor.targetAngle = edge > 0.72 ? homeAngle : targetAngle + (Math.random() - 0.5) * 1.2;
      actor.aiTimer = 0.18 + Math.random() * 0.32;
      if (Math.random() < 0.55) {
        const dash = DASH_MIN + Math.random() * DASH_VARIANCE;
        actor.vx += Math.cos(actor.targetAngle) * dash;
        actor.vy += Math.sin(actor.targetAngle) * dash;
      }
    }

    const speedBoost = actor.hasteUntil > engine.elapsed ? 1.55 : 1;
    const giantDrag = actor.giantUntil > engine.elapsed ? 0.82 : 1;
    actor.vx += Math.cos(actor.targetAngle) * MOVE_ACCEL * speedBoost * giantDrag * dt;
    actor.vy += Math.sin(actor.targetAngle) * MOVE_ACCEL * speedBoost * giantDrag * dt;
    const friction = Math.pow(0.974, dt * 60);
    actor.vx *= friction;
    actor.vy *= friction;
    const maxSpeed = MAX_MOVE_SPEED * speedBoost;
    const speed = Math.hypot(actor.vx, actor.vy);
    if (speed > maxSpeed) {
      actor.vx = (actor.vx / speed) * maxSpeed;
      actor.vy = (actor.vy / speed) * maxSpeed;
    }
    actor.x += actor.vx * dt;
    actor.y += actor.vy * dt;
    if (speed > 12) actor.heading = Math.atan2(actor.vy, actor.vx);

    for (const item of [...engine.items]) {
      if (item.kind === "bomb") continue;
      if (Math.hypot(actor.x - item.x, actor.y - item.y) > actor.radius + item.radius) continue;
      if (item.kind === "heal") actor.damage = Math.max(0, actor.damage - 42);
      if (item.kind === "power") actor.powerUntil = engine.elapsed + 5.5;
      if (item.kind === "shield") actor.shieldUntil = engine.elapsed + 5.5;
      if (item.kind === "haste") actor.hasteUntil = engine.elapsed + 6;
      if (item.kind === "giant") actor.giantUntil = engine.elapsed + 5;
      engine.items = engine.items.filter((entry) => entry.id !== item.id);
      onSound("item");
    }
  }

  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const minDistance = a.radius + b.radius;
      if (distance >= minDistance) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      const relative = Math.max(0, (a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
      if (relative < 14) continue;
      const aPower = a.powerUntil > engine.elapsed ? 1.75 : 1;
      const bPower = b.powerUntil > engine.elapsed ? 1.75 : 1;
      const aShield = a.shieldUntil > engine.elapsed ? 0.48 : 1;
      const bShield = b.shieldUntil > engine.elapsed ? 0.48 : 1;
      const aMass = a.weight * (a.giantUntil > engine.elapsed ? 2.1 : 1);
      const bMass = b.weight * (b.giantUntil > engine.elapsed ? 2.1 : 1);
      a.damage = clamp(a.damage + (HIT_DAMAGE_BASE + relative * HIT_DAMAGE_SPEED) * bPower * aShield, 0, 999);
      b.damage = clamp(b.damage + (HIT_DAMAGE_BASE + relative * HIT_DAMAGE_SPEED) * aPower * bShield, 0, 999);
      const impulseA = (relative * KNOCKBACK_SPEED + KNOCKBACK_BASE + a.damage * KNOCKBACK_DAMAGE) * bPower / Math.sqrt(aMass);
      const impulseB = (relative * KNOCKBACK_SPEED + KNOCKBACK_BASE + b.damage * KNOCKBACK_DAMAGE) * aPower / Math.sqrt(bMass);
      a.vx -= nx * impulseA;
      a.vy -= ny * impulseA;
      b.vx += nx * impulseB;
      b.vy += ny * impulseB;
      a.hitFlash = 0.1;
      b.hitFlash = 0.1;
      if (relative > 48) onSound("hit");
    }
  }

  for (const actor of engine.actors) {
    if (!actor.alive) continue;
    if (Math.hypot(actor.x - CX, actor.y - CY) > engine.arenaRadius + actor.radius * 1.35) {
      actor.alive = false;
      actor.outAt = engine.elapsed;
      onSound("out");
    }
  }

  const survivors = engine.actors.filter((actor) => actor.alive);
  if (survivors.length === 1 && engine.actors.length > 1) return survivors[0];
  if (survivors.length === 0) {
    const latest = [...engine.actors].sort((a, b) => b.outAt - a.outAt)[0];
    if (latest) latest.alive = true;
    return latest ?? null;
  }
  return null;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawActor(ctx: CanvasRenderingContext2D, actor: Actor, elapsed: number) {
  const shield = actor.shieldUntil > elapsed;
  const power = actor.powerUntil > elapsed;
  const radius = actor.radius;
  ctx.save();
  ctx.translate(actor.x, actor.y);
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.beginPath();
  ctx.ellipse(4, radius * 0.8, radius * 1.08, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  if (shield) {
    ctx.strokeStyle = "rgba(83,218,255,.78)";
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -elapsed * 24;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.shadowColor = actor.hitFlash > 0 ? "#fff" : actor.color;
  ctx.shadowBlur = actor.hitFlash > 0 ? 24 : power ? 18 : 9;
  ctx.fillStyle = actor.hitFlash > 0 ? "#fff" : actor.color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = power ? "#ffe3e8" : "rgba(255,255,255,.78)";
  ctx.lineWidth = actor.giantUntil > elapsed ? 4 : 2.4;
  ctx.stroke();
  ctx.rotate(actor.heading);
  ctx.fillStyle = "rgba(4,15,23,.74)";
  roundedRect(ctx, radius * 0.08, -radius * 0.42, radius * 0.92, radius * 0.84, radius * 0.24);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath();
  ctx.arc(radius * 0.54, -radius * 0.16, Math.max(2, radius * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(2,10,16,.86)";
  ctx.lineWidth = 4;
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.strokeText(actor.name, actor.x, actor.y - radius - 11);
  ctx.fillStyle = "#f6fbff";
  ctx.fillText(actor.name, actor.x, actor.y - radius - 11);
  ctx.font = "800 11px ui-monospace, monospace";
  ctx.fillStyle = actor.damage > 100 ? "#ff7890" : "#b9d3e1";
  ctx.fillText(`${Math.round(actor.damage)}%`, actor.x, actor.y + radius + 19);
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, item: ArenaItem, elapsed: number) {
  const style = ITEM_STYLE[item.kind];
  const pulse = 1 + Math.sin(elapsed * 7 + item.id) * 0.1;
  const bombTime = Math.max(0, item.explodeAt - elapsed);
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = style.color;
  ctx.shadowBlur = item.kind === "bomb" ? 14 + (2.2 - bombTime) * 8 : 14;
  ctx.fillStyle = "#0a1823";
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const x = Math.cos(angle) * item.radius;
    const y = Math.sin(angle) * item.radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = style.color;
  ctx.font = "900 16px ui-monospace, monospace";
  ctx.fillText(item.kind === "bomb" ? Math.ceil(bombTime).toString() : style.glyph, 0, 1);
  ctx.restore();
}

export function drawArena(
  ctx: CanvasRenderingContext2D,
  engine: EngineState,
  status: GameStatus,
  countdown: number,
  winner: Actor | null,
) {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  const background = ctx.createRadialGradient(CX, CY, 40, CX, CY, 520);
  background.addColorStop(0, "#152d40");
  background.addColorStop(0.55, "#0a1925");
  background.addColorStop(1, "#050b12");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#65dcff";
  for (let x = -100; x < WORLD_W + 100; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 330, WORLD_H); ctx.stroke();
  }
  for (let x = 0; x < WORLD_W + 350; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 330, WORLD_H); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(CX, CY + 30);
  ctx.scale(1, 0.42);
  const shadow = ctx.createRadialGradient(0, 0, 40, 0, 0, engine.arenaRadius + 90);
  shadow.addColorStop(0, "rgba(0,0,0,.42)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.arc(0, 0, engine.arenaRadius + 88, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const ring = ctx.createRadialGradient(CX - 55, CY - 75, 20, CX, CY, engine.arenaRadius);
  ring.addColorStop(0, "#153751"); ring.addColorStop(0.7, "#0f273a"); ring.addColorStop(1, "#091722");
  ctx.fillStyle = ring;
  ctx.beginPath(); ctx.arc(CX, CY, engine.arenaRadius, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(CX, CY, engine.arenaRadius - 2, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.24; ctx.strokeStyle = "#57d9ff"; ctx.lineWidth = 1.2;
  for (let r = 64; r < engine.arenaRadius; r += 55) { ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.stroke(); }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) { ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX + Math.cos(a) * engine.arenaRadius, CY + Math.sin(a) * engine.arenaRadius); ctx.stroke(); }
  ctx.restore();

  ctx.save();
  const shrinkRatio = engine.arenaRadius / BASE_RADIUS;
  const boundaryColor = shrinkRatio < 0.78 ? "#ff5d73" : "#54dcff";
  ctx.shadowColor = boundaryColor;
  ctx.shadowBlur = 22; ctx.strokeStyle = boundaryColor; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(CX, CY, engine.arenaRadius, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,.72)"; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(CX, CY, engine.arenaRadius - 6, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  for (const item of engine.items) drawItem(ctx, item, engine.elapsed);
  for (const actor of engine.actors.filter((entry) => entry.alive)) drawActor(ctx, actor, engine.elapsed);

  ctx.textAlign = "center";
  if (status === "running") {
    const delayRemaining = Math.max(0, SHRINK_DELAY - engine.elapsed);
    const atMinimum = engine.arenaRadius <= MIN_RADIUS + 0.01;
    const boundaryLabel = delayRemaining > 0
      ? `縮圈倒數 · ${delayRemaining.toFixed(1)}s`
      : atMinimum
        ? `最小決勝圈 · ${Math.round(shrinkRatio * 100)}%`
        : `能量環收縮 · ${Math.round(shrinkRatio * 100)}%`;
    ctx.font = "700 13px ui-monospace, monospace";
    ctx.fillStyle = delayRemaining > 0 ? "rgba(255,224,102,.9)" : "rgba(255,93,115,.9)";
    ctx.fillText(boundaryLabel, CX, 55);
  }
  if (status === "idle") {
    ctx.fillStyle = "rgba(224,246,255,.7)"; ctx.font = "600 15px system-ui, sans-serif";
    ctx.fillText("戰鬥模擬待命中", CX, CY + 7);
  }
  if (status === "countdown") {
    ctx.save(); ctx.shadowColor = "#68e5ff"; ctx.shadowBlur = 30; ctx.fillStyle = "#f4fbff";
    ctx.font = "900 96px system-ui, sans-serif"; ctx.fillText(countdown > 0 ? String(countdown) : "GO", CX, CY + 34); ctx.restore();
  }
  if (status === "paused") {
    ctx.fillStyle = "rgba(3,10,16,.62)"; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = "#f4fbff"; ctx.font = "900 44px system-ui, sans-serif"; ctx.fillText("PAUSED", CX, CY - 4);
    ctx.fillStyle = "#93aebe"; ctx.font = "600 15px system-ui, sans-serif"; ctx.fillText("按空白鍵繼續", CX, CY + 30);
  }
  if (status === "finished" && winner) {
    ctx.fillStyle = "rgba(3,10,16,.48)"; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = winner.color; ctx.font = "800 15px ui-monospace, monospace"; ctx.fillText("LAST SIGNAL STANDING", CX, CY - 80);
    ctx.fillStyle = "#fff"; ctx.font = "900 48px system-ui, sans-serif"; ctx.fillText(winner.name, CX, CY - 24);
    ctx.fillStyle = "#a9c0ce"; ctx.font = "600 14px system-ui, sans-serif"; ctx.fillText(`${Math.round(winner.damage)}% 傷害存活`, CX, CY + 12);
  }
}
