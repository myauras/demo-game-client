import type { FighterConfig } from "./arena";
import { assetPath } from "./assets";

export type GameStatus = "idle" | "countdown" | "running" | "finished";

export type Actor = FighterConfig & {
  teamId: string;
  isClone: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  alive: boolean;
  outAt: number;
  heading: number;
  aiTimer: number;
  targetAngle: number;
  hitFlash: number;
  impactFlash: number;
  knockbackTimer: number;
  leeSinKnockbackTimer: number;
  stunTimer: number;
  stunAfterKnockback: number;
  spawnFadeTimer: number;
  deathTimer: number;
  deathDuration: number;
  deathStyle: "normal" | "zed-smoke" | null;
};

export type EngineState = {
  actors: Actor[];
  skillCastEvents: SkillCastEvent[];
  skillCastEventSequence: number;
  skillCastGateTimer: number;
  rockets: RocketProjectile[];
  explosions: ExplosionEffect[];
  rocketSequence: number;
  jinxRocketCooldown: number;
  jinxVolleyRemaining: number;
  jinxVolleyTimer: number;
  jinxVolleyTargetId: string | null;
  jinxVolleyTargetX: number | null;
  jinxVolleyTargetY: number | null;
  tornadoes: Tornado[];
  jannaTornadoSequence: number;
  jannaCastTimer: number;
  jannaSkillCooldown: number;
  leeSinSkillCooldown: number;
  leeSinCastTimer: number;
  leeSinTargetId: string | null;
  leeSinKickEffects: LeeSinKickEffect[];
  leeSinDashTrails: LeeSinDashTrail[];
  dariusCastTimer: number;
  dariusSkillCooldown: number;
  dariusSlashEffects: DariusSlashEffect[];
  zedCastTimer: number;
  zedCasterId: string | null;
  zedCloneSequence: number;
  zedSkillCooldown: number;
  zedCoordinationTargetId: string | null;
  zedCoordinationChargeTimer: number;
  zedCoordinationStageX: number | null;
  zedCoordinationStageY: number | null;
  zedCoordinationStageAngle: number | null;
  elapsed: number;
  arenaRadius: number;
};

export type SkillCastEvent = {
  id: number;
  fighterId: string;
};

export type RocketProjectile = {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  angle: number;
};

export type ExplosionEffect = {
  id: number;
  x: number;
  y: number;
  age: number;
};

export type LeeSinKickEffect = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  age: number;
};

export type LeeSinDashTrail = {
  x: number;
  y: number;
  angle: number;
  age: number;
};

export type DariusSlashEffect = {
  x: number;
  y: number;
  age: number;
  hitActorIds: string[];
};

export type Tornado = {
  id: number;
  age: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  angle: number;
  enteredScreen: boolean;
  fadeOut: number | null;
  hitCooldowns: Record<string, number>;
};

export type RankingRow = Pick<Actor, "id" | "name" | "color" | "damage" | "alive" | "outAt">;

export const WORLD_W = 680;
export const WORLD_H = 650;
const CX = WORLD_W / 2;
const CY = 326;
const BASE_RADIUS = 294;
const MIN_RADIUS = 120;
const SHRINK_DELAY = 0;
const SHRINK_SPEED = 5.5;
const MOVE_SPEED = 150;
const HIT_DAMAGE_BASE = 5;
const HIT_DAMAGE_SPEED = 0.038;
const COLLISION_KNOCKBACK_SPEED = 400;
const MAX_KNOCKBACK_SPEED = 760;
const COLLISION_KNOCKBACK_DURATION = 0.18;
const COLLISION_STUN_DURATION = 0.5;
const JINX_ROCKET_INITIAL_DELAY = 2.2;
const JINX_ROCKET_COOLDOWN = 7;
const JINX_ROCKET_SPEED = 650;
const JINX_VOLLEY_SIZE = 10;
const JINX_VOLLEY_INTERVAL = 0.1;
const JINX_ROCKET_SPREAD_RADIANS = Math.PI * 2 / 15;
const JINX_ROCKET_KNOCKBACK = 250;
const JINX_ROCKET_KNOCKBACK_DURATION = 0.12;
const JINX_ROCKET_STUN_DURATION = 0.3;
const JINX_ROCKET_TARGET_RADIUS = 18;
const JINX_ROCKET_EXPLOSION_RADIUS = 34;
const EXPLOSION_DURATION = 0.26;
const JANNA_CAST_DURATION = 0.5;
const JANNA_SKILL_INITIAL_DELAY = 3.2;
const JANNA_SKILL_COOLDOWN = 8;
const JANNA_TORNADO_FADE_OUT_DURATION = 0.65;
const JANNA_TORNADO_SPEED = 100;
const JANNA_TORNADO_START_RADIUS = 24;
const JANNA_TORNADO_MAX_RADIUS = 72;
const JANNA_TORNADO_GROWTH_PER_SECOND = 12;
const JANNA_TORNADO_KNOCKBACK = 400;
const JANNA_TORNADO_KNOCKBACK_DURATION = 0.24;
const JANNA_TORNADO_STUN_DURATION = 1;
const JANNA_TORNADO_HIT_COOLDOWN = 0.45;
const JANNA_CROWD_RADIUS = 135;
const LEE_SIN_SKILL_INITIAL_DELAY = 2.6;
const LEE_SIN_SKILL_COOLDOWN = 8;
const LEE_SIN_CAST_DURATION = 0.5;
const LEE_SIN_DASH_SPEED = 420;
const LEE_SIN_KNOCKBACK = 600;
const LEE_SIN_KNOCKBACK_DURATION = 0.3;
const LEE_SIN_STUN_DURATION = 1;
const LEE_SIN_KICK_EFFECT_DURATION = 0.32;
const LEE_SIN_DASH_TRAIL_DURATION = 0.26;
const DARIUS_CAST_DURATION = 1.5;
const DARIUS_SKILL_INITIAL_DELAY = 3.5;
const DARIUS_SKILL_COOLDOWN = 6;
const DARIUS_SLASH_RADIUS = 180;
const DARIUS_SLASH_KNOCKBACK = 550;
const DARIUS_SLASH_KNOCKBACK_DURATION = 0.2;
const DARIUS_SLASH_STUN_DURATION = 1;
const DARIUS_SLASH_HIT_DELAY = 0.12;
const DARIUS_SLASH_EFFECT_DURATION = 0.48;
const ZED_CAST_DURATION = 1;
const ZED_SKILL_COOLDOWN = 12;
const SKILL_CAST_STAGGER_INTERVAL = 1;
const ZED_SPAWN_FADE_DURATION = 0.72;
const ZED_COORDINATION_NEAR_STAGE_DISTANCE = 58;
const ZED_COORDINATION_FAR_STAGE_DISTANCE = 72;
const ZED_COORDINATION_LATERAL_OFFSET = 10;
const ZED_COORDINATION_READY_RADIUS = 24;
const ZED_COORDINATION_CHARGE_DURATION = 1.2;
const NORMAL_DEATH_DURATION = 0.52;
const ZED_SMOKE_DEATH_DURATION = 0.46;

const ZED_SKILL_PRIMARY = "#111318";
const ZED_SKILL_LIGHT = "#59606b";
const JINX_SKILL_PRIMARY = "#00ade9";
const JINX_SKILL_LIGHT = "#b9edff";
const JINX_SKILL_DARK = "#00688d";
const JANNA_SKILL_PRIMARY = "#f7f9ff";
const JANNA_SKILL_LIGHT = "#ffffff";
const JANNA_SKILL_DARK = "#737b88";
const LEE_SIN_SKILL_PRIMARY = "#8f1418";
const LEE_SIN_SKILL_LIGHT = "#e24e47";
const LEE_SIN_SKILL_DARK = "#360204";
const DARIUS_SKILL_PRIMARY = "#e2182b";
const DARIUS_SKILL_LIGHT = "#ff5a4f";
const DARIUS_SKILL_DARK = "#050102";
const ARENA_RUNE_PRIMARY = "#54dbe2";
const ARENA_RUNE_LIGHT = "#c6f5ee";
const ARENA_RUNE_DARK = "#102c31";
const ARENA_BACKGROUND_SRC = assetPath("/arena-map-v1.webp");
const JANNA_TORNADO_LAYER_SRC = assetPath("/effects/janna-tornado-layer-v1.png");
const DARIUS_SLASH_SHEET_SRC = assetPath("/effects/darius-slash-gray-v1.png");
const DARIUS_SLASH_SHEET_COLUMNS = 6;
const DARIUS_SLASH_SHEET_ROWS = 3;
const DARIUS_SLASH_FRAME_COUNT = DARIUS_SLASH_SHEET_COLUMNS * DARIUS_SLASH_SHEET_ROWS;
const DARIUS_SLASH_BLACK_FILTER = "brightness(0.08) contrast(2.3)";
const DARIUS_SLASH_RED_FILTER = "sepia(1) saturate(10) hue-rotate(310deg) brightness(1.08) contrast(1.45)";
const AI_PURSUIT_CHANCE = 0.4;
const AI_EDGE_RETURN_RATIO = 0.72;
const AI_EDGE_PADDING = 14;
const AI_EDGE_LOOKAHEAD = 0.28;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function queuePostKnockbackStun(actor: Actor, duration: number) {
  actor.stunAfterKnockback = Math.max(
    actor.stunTimer,
    actor.stunAfterKnockback,
    duration,
  );
  actor.stunTimer = 0;
}

function chooseAiDirection(engine: EngineState, actor: Actor, alive: Actor[]) {
  const safeRadius = Math.max(1, engine.arenaRadius - actor.radius - AI_EDGE_PADDING);
  const centerDistance = Math.hypot(actor.x - CX, actor.y - CY);
  const homeAngle = Math.atan2(CY - actor.y, CX - actor.x);
  const opponents = alive.filter((entry) => entry.teamId !== actor.teamId);

  if (centerDistance / safeRadius > AI_EDGE_RETURN_RATIO) {
    actor.targetAngle = homeAngle + (Math.random() - 0.5) * 0.42;
    actor.aiTimer = 0.35 + Math.random() * 0.35;
  } else if (opponents.length > 0 && Math.random() < AI_PURSUIT_CHANCE) {
    const target = opponents[Math.floor(Math.random() * opponents.length)];
    const targetAngle = Math.atan2(target.y - actor.y, target.x - actor.x);
    const strafeDirection = Math.random() < 0.5 ? -1 : 1;
    actor.targetAngle = targetAngle + strafeDirection * (0.2 + Math.random() * 0.38);
    actor.aiTimer = 0.35 + Math.random() * 0.4;
  } else {
    const waypointAngle = Math.random() * Math.PI * 2;
    const waypointRadius = safeRadius * (0.15 + Math.random() * 0.55);
    const waypointX = CX + Math.cos(waypointAngle) * waypointRadius;
    const waypointY = CY + Math.sin(waypointAngle) * waypointRadius;
    actor.targetAngle = Math.atan2(waypointY - actor.y, waypointX - actor.x);
    actor.aiTimer = 0.65 + Math.random() * 0.65;
  }
  actor.heading = actor.targetAngle;
}

function clampZedDestinationToArena(
  engine: EngineState,
  zed: Actor,
  destination: { x: number; y: number },
) {
  const safeRadius = Math.max(1, engine.arenaRadius - zed.radius - AI_EDGE_PADDING);
  const dx = destination.x - CX;
  const dy = destination.y - CY;
  const distance = Math.hypot(dx, dy);
  if (distance <= safeRadius || distance <= 0.01) {
    return { ...destination, clamped: false };
  }
  return {
    x: CX + (dx / distance) * safeRadius,
    y: CY + (dy / distance) * safeRadius,
    clamped: true,
  };
}

function coordinateZedPair(engine: EngineState, alive: Actor[], dt: number) {
  const coordinatedIds = new Set<string>();
  const holdingIds = new Set<string>();
  const zeds = alive
    .filter((actor) => actor.teamId === "zed")
    .sort((a, b) => Number(a.isClone) - Number(b.isClone));
  if (zeds.length !== 2) {
    engine.zedCoordinationTargetId = null;
    engine.zedCoordinationChargeTimer = 0;
    engine.zedCoordinationStageX = null;
    engine.zedCoordinationStageY = null;
    engine.zedCoordinationStageAngle = null;
    return { coordinatedIds, holdingIds };
  }

  const opponents = alive.filter((actor) => actor.teamId !== "zed");
  let target = opponents.find((actor) => actor.id === engine.zedCoordinationTargetId);
  let needsStageSnapshot = false;
  if (!target) {
    const pairX = (zeds[0].x + zeds[1].x) * 0.5;
    const pairY = (zeds[0].y + zeds[1].y) * 0.5;
    target = opponents.reduce<Actor | undefined>((nearest, candidate) => {
      if (!nearest) return candidate;
      const nearestDistance = Math.hypot(nearest.x - pairX, nearest.y - pairY);
      const candidateDistance = Math.hypot(candidate.x - pairX, candidate.y - pairY);
      return candidateDistance < nearestDistance ? candidate : nearest;
    }, undefined);
    engine.zedCoordinationTargetId = target?.id ?? null;
    engine.zedCoordinationChargeTimer = 0;
    needsStageSnapshot = true;
  }
  if (!target) {
    engine.zedCoordinationStageX = null;
    engine.zedCoordinationStageY = null;
    engine.zedCoordinationStageAngle = null;
    return { coordinatedIds, holdingIds };
  }

  const wasCharging = engine.zedCoordinationChargeTimer > 0;
  engine.zedCoordinationChargeTimer = Math.max(
    0,
    engine.zedCoordinationChargeTimer - dt,
  );
  if (wasCharging && engine.zedCoordinationChargeTimer === 0) {
    needsStageSnapshot = true;
  }
  const pairX = (zeds[0].x + zeds[1].x) * 0.5;
  const pairY = (zeds[0].y + zeds[1].y) * 0.5;
  if (
    needsStageSnapshot
    || engine.zedCoordinationStageX === null
    || engine.zedCoordinationStageY === null
    || engine.zedCoordinationStageAngle === null
  ) {
    const targetFromCenterX = target.x - CX;
    const targetFromCenterY = target.y - CY;
    const targetFromCenterDistance = Math.hypot(targetFromCenterX, targetFromCenterY);
    engine.zedCoordinationStageX = target.x;
    engine.zedCoordinationStageY = target.y;
    engine.zedCoordinationStageAngle = targetFromCenterDistance > 20
      ? Math.atan2(targetFromCenterY, targetFromCenterX)
      : Math.atan2(target.y - pairY, target.x - pairX);
  }
  const stageX = engine.zedCoordinationStageX;
  const stageY = engine.zedCoordinationStageY;
  const outwardAngle = engine.zedCoordinationStageAngle;
  const outwardX = Math.cos(outwardAngle);
  const outwardY = Math.sin(outwardAngle);
  const lateralX = -outwardY;
  const lateralY = outwardX;
  const stages = [
    {
      x: stageX - outwardX * ZED_COORDINATION_NEAR_STAGE_DISTANCE
        - lateralX * ZED_COORDINATION_LATERAL_OFFSET,
      y: stageY - outwardY * ZED_COORDINATION_NEAR_STAGE_DISTANCE
        - lateralY * ZED_COORDINATION_LATERAL_OFFSET,
    },
    {
      x: stageX - outwardX * ZED_COORDINATION_FAR_STAGE_DISTANCE
        + lateralX * ZED_COORDINATION_LATERAL_OFFSET,
      y: stageY - outwardY * ZED_COORDINATION_FAR_STAGE_DISTANCE
        + lateralY * ZED_COORDINATION_LATERAL_OFFSET,
    },
  ];
  const safeStages = zeds.map(
    (zed, index) => clampZedDestinationToArena(engine, zed, stages[index]),
  );
  const stageDistances = zeds.map(
    (zed, index) => Math.hypot(zed.x - safeStages[index].x, zed.y - safeStages[index].y),
  );
  const bothReady = stageDistances.every(
    (distance) => distance <= ZED_COORDINATION_READY_RADIUS,
  );
  if (engine.zedCoordinationChargeTimer <= 0 && bothReady) {
    engine.zedCoordinationChargeTimer = ZED_COORDINATION_CHARGE_DURATION;
  }
  const charging = engine.zedCoordinationChargeTimer > 0;

  zeds.forEach((zed, index) => {
    const destination = charging
      ? clampZedDestinationToArena(engine, zed, target)
      : safeStages[index];
    const destinationDistance = Math.hypot(
      zed.x - destination.x,
      zed.y - destination.y,
    );
    zed.targetAngle = Math.atan2(destination.y - zed.y, destination.x - zed.x);
    zed.heading = zed.targetAngle;
    zed.aiTimer = 0.12;
    coordinatedIds.add(zed.id);
    if (
      (!charging && stageDistances[index] <= ZED_COORDINATION_READY_RADIUS)
      || (charging && destination.clamped && destinationDistance <= ZED_COORDINATION_READY_RADIUS)
    ) {
      holdingIds.add(zed.id);
    }
  });
  return { coordinatedIds, holdingIds };
}

function steerAiInsideArena(engine: EngineState, actor: Actor) {
  const safeRadius = Math.max(1, engine.arenaRadius - actor.radius - AI_EDGE_PADDING);
  const lookaheadDistance = MOVE_SPEED * AI_EDGE_LOOKAHEAD;
  const projectedX = actor.x + Math.cos(actor.targetAngle) * lookaheadDistance;
  const projectedY = actor.y + Math.sin(actor.targetAngle) * lookaheadDistance;
  if (Math.hypot(projectedX - CX, projectedY - CY) <= safeRadius) return;

  actor.targetAngle = Math.atan2(CY - actor.y, CX - actor.x);
  actor.heading = actor.targetAngle;
  actor.aiTimer = Math.min(actor.aiTimer, 0.35);
}

export function createEngine(fighters: FighterConfig[]): EngineState {
  const offset = Math.random() * Math.PI * 2;
  const spread = Math.min(172, 58 + fighters.length * 20);
  return {
    actors: fighters.map((fighter, index) => {
      const angle = offset + (index / fighters.length) * Math.PI * 2;
      return {
        ...fighter,
        teamId: fighter.id,
        isClone: false,
        x: CX + Math.cos(angle) * spread,
        y: CY + Math.sin(angle) * spread,
        vx: Math.cos(angle + Math.PI) * MOVE_SPEED,
        vy: Math.sin(angle + Math.PI) * MOVE_SPEED,
        radius: 21,
        damage: 0,
        alive: true,
        outAt: Number.POSITIVE_INFINITY,
        heading: angle + Math.PI,
        aiTimer: Math.random() * 0.8,
        targetAngle: angle + Math.PI,
        hitFlash: 0,
        impactFlash: 0,
        knockbackTimer: 0,
        leeSinKnockbackTimer: 0,
        stunTimer: 0,
        stunAfterKnockback: 0,
        spawnFadeTimer: 0,
        deathTimer: 0,
        deathDuration: 0,
        deathStyle: null,
      };
    }),
    skillCastEvents: [],
    skillCastEventSequence: 0,
    skillCastGateTimer: 0,
    rockets: [],
    explosions: [],
    rocketSequence: 0,
    jinxRocketCooldown: JINX_ROCKET_INITIAL_DELAY,
    jinxVolleyRemaining: 0,
    jinxVolleyTimer: 0,
    jinxVolleyTargetId: null,
    jinxVolleyTargetX: null,
    jinxVolleyTargetY: null,
    tornadoes: [],
    jannaTornadoSequence: 0,
    jannaCastTimer: 0,
    jannaSkillCooldown: JANNA_SKILL_INITIAL_DELAY,
    leeSinSkillCooldown: LEE_SIN_SKILL_INITIAL_DELAY,
    leeSinCastTimer: 0,
    leeSinTargetId: null,
    leeSinKickEffects: [],
    leeSinDashTrails: [],
    dariusCastTimer: 0,
    dariusSkillCooldown: DARIUS_SKILL_INITIAL_DELAY,
    dariusSlashEffects: [],
    zedCastTimer: 0,
    zedCasterId: null,
    zedCloneSequence: 0,
    zedSkillCooldown: 0,
    zedCoordinationTargetId: null,
    zedCoordinationChargeTimer: 0,
    zedCoordinationStageX: null,
    zedCoordinationStageY: null,
    zedCoordinationStageAngle: null,
    elapsed: 0,
    arenaRadius: BASE_RADIUS,
  };
}

export function drainSkillCastEvents(engine: EngineState): SkillCastEvent[] {
  return engine.skillCastEvents.splice(0);
}

function queueSkillCast(engine: EngineState, fighterId: string) {
  engine.skillCastEventSequence += 1;
  engine.skillCastGateTimer = SKILL_CAST_STAGGER_INTERVAL;
  engine.skillCastEvents.push({
    id: engine.skillCastEventSequence,
    fighterId,
  });
}

export function rankActors(actors: Actor[]): Actor[] {
  const teams = new Map<string, Actor[]>();
  for (const actor of actors) {
    const members = teams.get(actor.teamId) ?? [];
    members.push(actor);
    teams.set(actor.teamId, members);
  }
  const rows = [...teams.entries()].map(([teamId, members]) => {
    const living = members.filter((member) => member.alive);
    const representative = living[0] ?? members[0];
    const trackedMembers = living.length > 0 ? living : members;
    return {
      ...representative,
      id: teamId,
      alive: living.length > 0,
      damage: Math.max(...trackedMembers.map((member) => member.damage)),
      outAt: Math.max(...members.map((member) => member.outAt)),
    };
  });
  return rows.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (!a.alive && !b.alive) return b.outAt - a.outAt;
    return a.damage - b.damage;
  });
}

function launchJinxRocket(
  engine: EngineState,
  jinx: Actor,
  targetX: number,
  targetY: number,
) {
  const targetAngle = Math.atan2(targetY - jinx.y, targetX - jinx.x);
  const spreadOffset = (Math.random() - 0.5) * JINX_ROCKET_SPREAD_RADIANS;
  const angle = targetAngle + spreadOffset;
  engine.rocketSequence += 1;
  engine.rockets.push({
    id: engine.rocketSequence,
    x: jinx.x + Math.cos(angle) * (jinx.radius + 10),
    y: jinx.y + Math.sin(angle) * (jinx.radius + 10),
    targetX,
    targetY,
    angle,
  });
}

function interruptJinxVolley(engine: EngineState) {
  if (engine.jinxVolleyRemaining <= 0) return;
  engine.jinxVolleyRemaining = 0;
  engine.jinxVolleyTimer = 0;
  engine.jinxVolleyTargetId = null;
  engine.jinxVolleyTargetX = null;
  engine.jinxVolleyTargetY = null;
  engine.jinxRocketCooldown = JINX_ROCKET_COOLDOWN;
}

function hitJinxRocket(engine: EngineState, rocket: RocketProjectile, target: Actor) {
  engine.explosions.push({
    id: rocket.id,
    x: target.x,
    y: target.y,
    age: 0,
  });
  target.vx += Math.cos(rocket.angle) * JINX_ROCKET_KNOCKBACK;
  target.vy += Math.sin(rocket.angle) * JINX_ROCKET_KNOCKBACK;
  target.hitFlash = Math.max(target.hitFlash, 0.14);
  target.impactFlash = Math.max(target.impactFlash, 0.18);
  target.knockbackTimer = Math.max(target.knockbackTimer, JINX_ROCKET_KNOCKBACK_DURATION);
  queuePostKnockbackStun(target, JINX_ROCKET_STUN_DURATION);
}

function stepJinxRocketSkill(engine: EngineState, dt: number) {
  engine.explosions = engine.explosions
    .map((explosion) => ({ ...explosion, age: explosion.age + dt }))
    .filter((explosion) => explosion.age < EXPLOSION_DURATION);

  const jinx = engine.actors.find((actor) => actor.id === "jinx" && actor.alive);
  if (jinx) {
    if (engine.jinxVolleyRemaining > 0) {
      engine.jinxVolleyTimer -= dt;
      if (engine.jinxVolleyTimer <= 0) {
        const volleyTarget = engine.actors.find(
          (actor) => actor.id === engine.jinxVolleyTargetId,
        );
        if (volleyTarget) {
          engine.jinxVolleyTargetX = volleyTarget.x;
          engine.jinxVolleyTargetY = volleyTarget.y;
        }
        if (
          engine.jinxVolleyTargetId !== null
          && engine.jinxVolleyTargetX !== null
          && engine.jinxVolleyTargetY !== null
        ) {
          launchJinxRocket(
            engine,
            jinx,
            engine.jinxVolleyTargetX,
            engine.jinxVolleyTargetY,
          );
        }
        engine.jinxVolleyRemaining -= 1;
        engine.jinxVolleyTimer += JINX_VOLLEY_INTERVAL;
        if (engine.jinxVolleyRemaining === 0) {
          engine.jinxVolleyTargetId = null;
          engine.jinxVolleyTargetX = null;
          engine.jinxVolleyTargetY = null;
          engine.jinxRocketCooldown = JINX_ROCKET_COOLDOWN;
        }
      }
    } else {
      engine.jinxRocketCooldown -= dt;
      if (
        engine.jinxRocketCooldown <= 0
        && engine.skillCastGateTimer <= 0
        && jinx.knockbackTimer <= 0
        && jinx.stunTimer <= 0
      ) {
        const opponents = engine.actors.filter(
          (actor) => actor.alive && actor.teamId !== jinx.teamId,
        );
        const target = opponents[Math.floor(Math.random() * opponents.length)];
        if (target) {
          engine.jinxVolleyTargetId = target.id;
          engine.jinxVolleyTargetX = target.x;
          engine.jinxVolleyTargetY = target.y;
          engine.jinxVolleyRemaining = JINX_VOLLEY_SIZE;
          engine.jinxVolleyTimer = 0;
          queueSkillCast(engine, "jinx");
        }
      }
    }
  } else {
    engine.jinxVolleyRemaining = 0;
    engine.jinxVolleyTargetId = null;
    engine.jinxVolleyTargetX = null;
    engine.jinxVolleyTargetY = null;
  }

  const activeRockets: RocketProjectile[] = [];
  for (const rocket of engine.rockets) {
    const travel = JINX_ROCKET_SPEED * dt;
    const segmentX = Math.cos(rocket.angle) * travel;
    const segmentY = Math.sin(rocket.angle) * travel;
    const nextX = rocket.x + segmentX;
    const nextY = rocket.y + segmentY;
    const segmentLengthSquared = Math.max(0.0001, segmentX * segmentX + segmentY * segmentY);
    let hitTarget: Actor | null = null;
    let hitProgress = Infinity;
    for (const target of engine.actors) {
      if (!target.alive || target.teamId === "jinx") continue;
      const targetProgress = clamp(
        ((target.x - rocket.x) * segmentX + (target.y - rocket.y) * segmentY)
          / segmentLengthSquared,
        0,
        1,
      );
      const closestX = rocket.x + segmentX * targetProgress;
      const closestY = rocket.y + segmentY * targetProgress;
      if (Math.hypot(target.x - closestX, target.y - closestY) > target.radius) continue;
      if (targetProgress >= hitProgress) continue;
      hitTarget = target;
      hitProgress = targetProgress;
    }
    if (hitTarget) {
      rocket.x += segmentX * hitProgress;
      rocket.y += segmentY * hitProgress;
      hitJinxRocket(engine, rocket, hitTarget);
      continue;
    }
    rocket.x = nextX;
    rocket.y = nextY;
    if (
      rocket.x < -80 || rocket.x > WORLD_W + 80
      || rocket.y < -80 || rocket.y > WORLD_H + 80
    ) continue;
    activeRockets.push(rocket);
  }
  engine.rockets = activeRockets;
}

function findCrowdedTarget(actors: Actor[]) {
  let bestActor = actors[0];
  let bestCount = -1;
  let bestX = bestActor?.x ?? CX;
  let bestY = bestActor?.y ?? CY;
  for (const candidate of actors) {
    const cluster = actors.filter(
      (actor) => Math.hypot(actor.x - candidate.x, actor.y - candidate.y) <= JANNA_CROWD_RADIUS,
    );
    if (cluster.length <= bestCount) continue;
    bestCount = cluster.length;
    bestActor = candidate;
    bestX = cluster.reduce((sum, actor) => sum + actor.x, 0) / cluster.length;
    bestY = cluster.reduce((sum, actor) => sum + actor.y, 0) / cluster.length;
  }
  return { x: bestX, y: bestY };
}

function jannaTornadoRadius(age: number) {
  return Math.min(
    JANNA_TORNADO_MAX_RADIUS,
    JANNA_TORNADO_START_RADIUS + age * JANNA_TORNADO_GROWTH_PER_SECOND,
  );
}

function summonJannaTornado(engine: EngineState, janna: Actor) {
  const targets = engine.actors.filter((actor) => actor.alive && actor.teamId !== "janna");
  if (targets.length === 0) return;
  const target = findCrowdedTarget(targets);
  engine.jannaTornadoSequence += 1;
  engine.tornadoes.push({
    id: engine.jannaTornadoSequence,
    age: 0,
    x: janna.x,
    y: janna.y,
    targetX: target.x,
    targetY: target.y,
    angle: Math.atan2(target.y - janna.y, target.x - janna.x),
    enteredScreen: true,
    fadeOut: null,
    hitCooldowns: {},
  });
}

function stepJannaSkill(engine: EngineState, dt: number) {
  const janna = engine.actors.find((actor) => actor.id === "janna" && actor.alive);
  if (janna) {
    if (engine.jannaCastTimer > 0) {
      engine.jannaCastTimer = Math.max(0, engine.jannaCastTimer - dt);
      if (engine.jannaCastTimer === 0) {
        summonJannaTornado(engine, janna);
        engine.jannaSkillCooldown = JANNA_SKILL_COOLDOWN;
      }
    } else {
      engine.jannaSkillCooldown -= dt;
      if (
        engine.jannaSkillCooldown <= 0
        && engine.skillCastGateTimer <= 0
        && engine.tornadoes.length === 0
        && janna.knockbackTimer <= 0
        && janna.stunTimer <= 0
      ) {
        engine.jannaCastTimer = JANNA_CAST_DURATION;
        queueSkillCast(engine, "janna");
      }
    }
  } else {
    engine.jannaCastTimer = 0;
  }

  const activeTornadoes: Tornado[] = [];
  for (const tornado of engine.tornadoes) {
    tornado.age += dt;
    const tornadoRadius = jannaTornadoRadius(tornado.age);
    tornado.hitCooldowns = Object.fromEntries(
      Object.entries(tornado.hitCooldowns)
        .map(([id, time]) => [id, time - dt])
        .filter(([, time]) => Number(time) > 0),
    );
    const travel = JANNA_TORNADO_SPEED * dt;
    tornado.x += Math.cos(tornado.angle) * travel;
    tornado.y += Math.sin(tornado.angle) * travel;

    const outsideScreen = tornado.x < 0
      || tornado.x > WORLD_W
      || tornado.y < 0
      || tornado.y > WORLD_H;
    if (tornado.enteredScreen && outsideScreen && tornado.fadeOut === null) {
      tornado.fadeOut = JANNA_TORNADO_FADE_OUT_DURATION;
    }
    if (tornado.fadeOut !== null) tornado.fadeOut -= dt;

    for (const actor of engine.actors) {
      if (!actor.alive || actor.teamId === "janna" || tornado.hitCooldowns[actor.id] > 0) continue;
      const hitDistance = Math.hypot(actor.x - tornado.x, actor.y - tornado.y);
      if (hitDistance > actor.radius + tornadoRadius) continue;
      const direction = hitDistance > 0.01
        ? Math.atan2(actor.y - tornado.y, actor.x - tornado.x)
        : tornado.angle;
      actor.vx += Math.cos(direction) * JANNA_TORNADO_KNOCKBACK;
      actor.vy += Math.sin(direction) * JANNA_TORNADO_KNOCKBACK;
      actor.hitFlash = Math.max(actor.hitFlash, 0.18);
      actor.impactFlash = Math.max(actor.impactFlash, 0.28);
      actor.knockbackTimer = Math.max(actor.knockbackTimer, JANNA_TORNADO_KNOCKBACK_DURATION);
      queuePostKnockbackStun(actor, JANNA_TORNADO_STUN_DURATION);
      tornado.hitCooldowns[actor.id] = JANNA_TORNADO_HIT_COOLDOWN;
    }
    if (tornado.fadeOut === null || tornado.fadeOut > 0) activeTornadoes.push(tornado);
  }
  engine.tornadoes = activeTornadoes;
}

function applyLeeSinKnockback(target: Actor, angle: number) {
  target.vx = Math.cos(angle) * LEE_SIN_KNOCKBACK;
  target.vy = Math.sin(angle) * LEE_SIN_KNOCKBACK;
  target.hitFlash = Math.max(target.hitFlash, 0.18);
  target.impactFlash = Math.max(target.impactFlash, LEE_SIN_KICK_EFFECT_DURATION);
  target.knockbackTimer = Math.max(target.knockbackTimer, LEE_SIN_KNOCKBACK_DURATION);
  target.leeSinKnockbackTimer = LEE_SIN_KNOCKBACK_DURATION;
  queuePostKnockbackStun(target, LEE_SIN_STUN_DURATION);
}

function addLeeSinKickEffect(
  engine: EngineState,
  x: number,
  y: number,
  targetX: number,
  targetY: number,
) {
  engine.leeSinKickEffects.push({ x, y, targetX, targetY, age: 0 });
}

function stepLeeSinSkill(engine: EngineState, dt: number) {
  const leeSin = engine.actors.find((actor) => actor.id === "lee-sin" && actor.alive);
  engine.leeSinKickEffects = engine.leeSinKickEffects
    .map((effect) => ({
      ...effect,
      x: leeSin?.x ?? effect.x,
      y: leeSin?.y ?? effect.y,
      age: effect.age + dt,
    }))
    .filter((effect) => effect.age < LEE_SIN_KICK_EFFECT_DURATION);
  engine.leeSinDashTrails = engine.leeSinDashTrails
    .map((trail) => ({ ...trail, age: trail.age + dt }))
    .filter((trail) => trail.age < LEE_SIN_DASH_TRAIL_DURATION);

  if (!leeSin) {
    engine.leeSinCastTimer = 0;
    engine.leeSinTargetId = null;
    return;
  }

  const target = engine.actors.find(
    (actor) => actor.id === engine.leeSinTargetId && actor.alive,
  );

  if (engine.leeSinCastTimer > 0) {
    engine.leeSinCastTimer = Math.max(0, engine.leeSinCastTimer - dt);
    if (target) leeSin.heading = Math.atan2(target.y - leeSin.y, target.x - leeSin.x);
    if (engine.leeSinCastTimer === 0 && !target) {
      engine.leeSinTargetId = null;
      engine.leeSinSkillCooldown = LEE_SIN_SKILL_COOLDOWN;
    }
    return;
  }

  if (engine.leeSinTargetId !== null) {
    if (!target) {
      engine.leeSinTargetId = null;
      engine.leeSinSkillCooldown = LEE_SIN_SKILL_COOLDOWN;
      return;
    }
    if (leeSin.knockbackTimer > 0 || leeSin.stunTimer > 0) return;

    const dx = target.x - leeSin.x;
    const dy = target.y - leeSin.y;
    const distance = Math.max(0.01, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const contactDistance = leeSin.radius + target.radius;
    const travel = LEE_SIN_DASH_SPEED * dt;
    leeSin.heading = angle;
    engine.leeSinDashTrails.push({ x: leeSin.x, y: leeSin.y, angle, age: 0 });

    if (distance <= contactDistance + travel) {
      const landingTravel = Math.max(0, distance - contactDistance);
      leeSin.x += Math.cos(angle) * landingTravel;
      leeSin.y += Math.sin(angle) * landingTravel;
      addLeeSinKickEffect(engine, leeSin.x, leeSin.y, target.x, target.y);
      applyLeeSinKnockback(target, angle);
      engine.leeSinTargetId = null;
      engine.leeSinSkillCooldown = LEE_SIN_SKILL_COOLDOWN;
      return;
    }

    leeSin.x += Math.cos(angle) * travel;
    leeSin.y += Math.sin(angle) * travel;
    return;
  }

  engine.leeSinSkillCooldown -= dt;
  if (
    engine.leeSinSkillCooldown > 0
    || engine.skillCastGateTimer > 0
    || leeSin.knockbackTimer > 0
    || leeSin.stunTimer > 0
  ) return;

  const opponents = engine.actors.filter(
    (actor) => actor.alive && actor.teamId !== leeSin.teamId,
  );
  const selectedTarget = opponents[Math.floor(Math.random() * opponents.length)];
  if (!selectedTarget) return;
  engine.leeSinTargetId = selectedTarget.id;
  engine.leeSinCastTimer = LEE_SIN_CAST_DURATION;
  queueSkillCast(engine, "lee-sin");
  leeSin.heading = Math.atan2(selectedTarget.y - leeSin.y, selectedTarget.x - leeSin.x);
}

function dariusSlashVisualRadius(age: number) {
  const impactProgress = clamp(age / DARIUS_SLASH_HIT_DELAY, 0, 1);
  return DARIUS_SLASH_RADIUS * (0.72 + impactProgress * 0.28);
}

function applyDariusSlashImpact(engine: EngineState, darius: Actor, effect: DariusSlashEffect) {
  const hitRadius = dariusSlashVisualRadius(effect.age);
  for (const target of engine.actors) {
    if (!target.alive || target.teamId === darius.teamId) continue;
    if (effect.hitActorIds.includes(target.id)) continue;
    const dx = target.x - effect.x;
    const dy = target.y - effect.y;
    const distance = Math.hypot(dx, dy);
    if (distance > hitRadius) continue;
    const angle = distance > 0.01 ? Math.atan2(dy, dx) : darius.heading;
    target.vx += Math.cos(angle) * DARIUS_SLASH_KNOCKBACK;
    target.vy += Math.sin(angle) * DARIUS_SLASH_KNOCKBACK;
    target.hitFlash = Math.max(target.hitFlash, 0.16);
    target.impactFlash = Math.max(target.impactFlash, 0.24);
    target.knockbackTimer = Math.max(target.knockbackTimer, DARIUS_SLASH_KNOCKBACK_DURATION);
    queuePostKnockbackStun(target, DARIUS_SLASH_STUN_DURATION);
    effect.hitActorIds.push(target.id);
  }
}

function releaseDariusSlash(engine: EngineState, darius: Actor) {
  engine.dariusSlashEffects.push({
    x: darius.x,
    y: darius.y,
    age: 0,
    hitActorIds: [],
  });
}

function stepDariusSkill(engine: EngineState, dt: number) {
  const darius = engine.actors.find((actor) => actor.id === "darius" && actor.alive);
  const activeSlashEffects: DariusSlashEffect[] = [];
  for (const effect of engine.dariusSlashEffects) {
    effect.x = darius?.x ?? effect.x;
    effect.y = darius?.y ?? effect.y;
    effect.age += dt;
    if (darius) applyDariusSlashImpact(engine, darius, effect);
    if (effect.age < DARIUS_SLASH_EFFECT_DURATION) activeSlashEffects.push(effect);
  }
  engine.dariusSlashEffects = activeSlashEffects;

  if (!darius) {
    engine.dariusCastTimer = 0;
    return;
  }
  if (engine.dariusCastTimer > 0) {
    engine.dariusCastTimer = Math.max(0, engine.dariusCastTimer - dt);
    if (engine.dariusCastTimer === 0) {
      releaseDariusSlash(engine, darius);
      engine.dariusSkillCooldown = DARIUS_SKILL_COOLDOWN;
    }
    return;
  }

  engine.dariusSkillCooldown -= dt;
  if (engine.dariusSkillCooldown <= 0 && engine.skillCastGateTimer <= 0) {
    engine.dariusCastTimer = DARIUS_CAST_DURATION;
    queueSkillCast(engine, "darius");
  }
}

function spawnZedClone(engine: EngineState, caster: Actor) {
  const towardCenter = Math.atan2(CY - caster.y, CX - caster.x);
  const spawnAngle = towardCenter + (Math.random() - 0.5) * 1.2;
  const spawnDistance = 58;
  let x = caster.x + Math.cos(spawnAngle) * spawnDistance;
  let y = caster.y + Math.sin(spawnAngle) * spawnDistance;
  const centerDistance = Math.hypot(x - CX, y - CY);
  const safeRadius = Math.max(0, engine.arenaRadius - caster.radius - 8);
  if (centerDistance > safeRadius && centerDistance > 0) {
    x = CX + ((x - CX) / centerDistance) * safeRadius;
    y = CY + ((y - CY) / centerDistance) * safeRadius;
  }
  engine.zedCloneSequence += 1;
  engine.actors.push({
    ...caster,
    id: `zed-shadow-${engine.zedCloneSequence}`,
    teamId: "zed",
    name: "Zed",
    isClone: true,
    x,
    y,
    vx: Math.cos(spawnAngle) * MOVE_SPEED,
    vy: Math.sin(spawnAngle) * MOVE_SPEED,
    damage: 0,
    alive: true,
    outAt: Number.POSITIVE_INFINITY,
    heading: spawnAngle,
    aiTimer: 0.18 + Math.random() * 0.4,
    targetAngle: spawnAngle,
    hitFlash: 0,
    impactFlash: 0,
    knockbackTimer: 0,
    leeSinKnockbackTimer: 0,
    stunTimer: 0,
    stunAfterKnockback: 0,
    spawnFadeTimer: ZED_SPAWN_FADE_DURATION,
    deathTimer: 0,
    deathDuration: 0,
    deathStyle: null,
  });
}

function stepZedSkill(engine: EngineState, dt: number) {
  const livingZeds = engine.actors.filter(
    (actor) => actor.alive && actor.teamId === "zed",
  );
  if (livingZeds.length !== 1) {
    engine.zedCastTimer = 0;
    engine.zedCasterId = null;
    return;
  }

  const zed = livingZeds[0];
  if (engine.zedSkillCooldown > 0) {
    engine.zedSkillCooldown = Math.max(0, engine.zedSkillCooldown - dt);
    return;
  }
  if (engine.zedCastTimer > 0) {
    if (engine.zedCasterId !== zed.id) {
      engine.zedCasterId = zed.id;
      engine.zedCastTimer = ZED_CAST_DURATION;
    }
    engine.zedCastTimer = Math.max(0, engine.zedCastTimer - dt);
    if (engine.zedCastTimer === 0) {
      spawnZedClone(engine, zed);
      engine.zedCasterId = null;
    }
    return;
  }

  if (
    engine.skillCastGateTimer <= 0
    && zed.knockbackTimer <= 0
    && zed.stunTimer <= 0
  ) {
    engine.zedCasterId = zed.id;
    engine.zedCastTimer = ZED_CAST_DURATION;
    queueSkillCast(engine, "zed");
  }
}

function eliminateActor(engine: EngineState, actor: Actor) {
  const hasLivingZedPartner = actor.teamId === "zed" && engine.actors.some(
    (candidate) => candidate.alive && candidate.teamId === "zed" && candidate.id !== actor.id,
  );
  if (hasLivingZedPartner) engine.zedSkillCooldown = ZED_SKILL_COOLDOWN;
  actor.alive = false;
  actor.outAt = engine.elapsed;
  actor.vx = 0;
  actor.vy = 0;
  actor.knockbackTimer = 0;
  actor.stunTimer = 0;
  actor.impactFlash = 0;
  actor.deathStyle = hasLivingZedPartner ? "zed-smoke" : "normal";
  actor.deathDuration = hasLivingZedPartner
    ? ZED_SMOKE_DEATH_DURATION
    : NORMAL_DEATH_DURATION;
  actor.deathTimer = actor.deathDuration;
}

function championFromActor(actor: Actor): Actor {
  return actor.id === actor.teamId ? actor : { ...actor, id: actor.teamId, isClone: false };
}

export function stepEngine(engine: EngineState, dt: number) {
  engine.elapsed += dt;
  engine.skillCastGateTimer = Math.max(0, engine.skillCastGateTimer - dt);
  // Close from the first live frame at half speed until two 60 px arena grid
  // bands remain.
  const shrinkElapsed = Math.max(0, engine.elapsed - SHRINK_DELAY);
  engine.arenaRadius = Math.max(MIN_RADIUS, BASE_RADIUS - shrinkElapsed * SHRINK_SPEED);

  for (const actor of engine.actors) {
    actor.spawnFadeTimer = Math.max(0, actor.spawnFadeTimer - dt);
    if (!actor.alive) actor.deathTimer = Math.max(0, actor.deathTimer - dt);
  }

  const alive = engine.actors.filter((actor) => actor.alive);
  const teamsAtFrameStart = new Map<string, Actor[]>();
  for (const actor of alive) {
    const members = teamsAtFrameStart.get(actor.teamId) ?? [];
    members.push(actor);
    teamsAtFrameStart.set(actor.teamId, members);
  }
  if (teamsAtFrameStart.size === 1 && engine.actors.length > 1) {
    const deathAnimationActive = engine.actors.some(
      (actor) => !actor.alive && actor.deathTimer > 0,
    );
    if (deathAnimationActive) return null;
    return championFromActor([...teamsAtFrameStart.values()][0][0]);
  }
  const zedCoordination = coordinateZedPair(engine, alive, dt);

  for (const actor of alive) {
    const beingKnockedBack = actor.knockbackTimer > 0;
    const castingJinxVolley = actor.id === "jinx" && engine.jinxVolleyRemaining > 0;
    const castingJannaTornado = actor.id === "janna" && engine.jannaCastTimer > 0;
    const castingOrDashingLeeSin = actor.id === "lee-sin"
      && (engine.leeSinCastTimer > 0 || engine.leeSinTargetId !== null);
    const castingZedClone = actor.id === engine.zedCasterId && engine.zedCastTimer > 0;
    actor.hitFlash = Math.max(0, actor.hitFlash - dt);
    actor.impactFlash = Math.max(0, actor.impactFlash - dt);
    actor.leeSinKnockbackTimer = Math.max(0, actor.leeSinKnockbackTimer - dt);
    if (beingKnockedBack) {
      actor.knockbackTimer = Math.max(0, actor.knockbackTimer - dt);
      if (actor.knockbackTimer === 0 && actor.stunAfterKnockback > 0) {
        actor.stunTimer = Math.max(actor.stunTimer, actor.stunAfterKnockback);
        actor.stunAfterKnockback = 0;
        actor.vx = 0;
        actor.vy = 0;
      }
    }

    const stunned = !beingKnockedBack && actor.stunTimer > 0;
    if (stunned) {
      actor.stunTimer = Math.max(0, actor.stunTimer - dt);
      actor.vx = 0;
      actor.vy = 0;
      continue;
    }

    if (
      (castingJinxVolley || castingJannaTornado || castingOrDashingLeeSin || castingZedClone)
      && !beingKnockedBack
    ) {
      actor.vx = 0;
      actor.vy = 0;
      continue;
    }
    if (zedCoordination.holdingIds.has(actor.id) && !beingKnockedBack) {
      actor.vx = 0;
      actor.vy = 0;
      continue;
    }

    actor.aiTimer -= dt;
    if (
      !beingKnockedBack
      && actor.aiTimer <= 0
      && !zedCoordination.coordinatedIds.has(actor.id)
    ) {
      chooseAiDirection(engine, actor, alive);
    }

    if (!beingKnockedBack) {
      if (!zedCoordination.coordinatedIds.has(actor.id)) {
        steerAiInsideArena(engine, actor);
      }
      actor.vx = Math.cos(actor.targetAngle) * MOVE_SPEED;
      actor.vy = Math.sin(actor.targetAngle) * MOVE_SPEED;
    } else {
      const friction = Math.pow(0.985, dt * 60);
      actor.vx *= friction;
      actor.vy *= friction;
      const speed = Math.hypot(actor.vx, actor.vy);
      if (speed > MAX_KNOCKBACK_SPEED) {
        actor.vx = (actor.vx / speed) * MAX_KNOCKBACK_SPEED;
        actor.vy = (actor.vy / speed) * MAX_KNOCKBACK_SPEED;
      }
    }
    actor.x += actor.vx * dt;
    actor.y += actor.vy * dt;
  }

  stepJinxRocketSkill(engine, dt);
  stepJannaSkill(engine, dt);
  stepLeeSinSkill(engine, dt);
  stepDariusSkill(engine, dt);
  stepZedSkill(engine, dt);

  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) {
      const a = alive[i];
      const b = alive[j];
      if (a.teamId === b.teamId) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const minDistance = a.radius + b.radius;
      if (distance >= minDistance) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const aLeeSinKnockback = a.leeSinKnockbackTimer > 0;
      const bLeeSinKnockback = b.leeSinKnockbackTimer > 0;
      if (aLeeSinKnockback && !bLeeSinKnockback) {
        b.x += nx * overlap;
        b.y += ny * overlap;
      } else if (bLeeSinKnockback && !aLeeSinKnockback) {
        a.x -= nx * overlap;
        a.y -= ny * overlap;
      } else {
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
      }
      if (aLeeSinKnockback || bLeeSinKnockback) {
        if (aLeeSinKnockback && !bLeeSinKnockback && b.id !== "lee-sin") {
          const flightAngle = Math.atan2(a.vy, a.vx);
          addLeeSinKickEffect(engine, a.x, a.y, b.x, b.y);
          applyLeeSinKnockback(b, flightAngle);
        } else if (bLeeSinKnockback && !aLeeSinKnockback && a.id !== "lee-sin") {
          const flightAngle = Math.atan2(b.vy, b.vx);
          addLeeSinKickEffect(engine, b.x, b.y, a.x, a.y);
          applyLeeSinKnockback(a, flightAngle);
        }
        continue;
      }

      const relative = Math.max(0, (a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
      if (relative < 14) continue;
      if (a.id === "jinx") interruptJinxVolley(engine);
      if (b.id === "jinx") interruptJinxVolley(engine);
      a.damage = clamp(a.damage + HIT_DAMAGE_BASE + relative * HIT_DAMAGE_SPEED, 0, 999);
      b.damage = clamp(b.damage + HIT_DAMAGE_BASE + relative * HIT_DAMAGE_SPEED, 0, 999);
      a.vx = -nx * COLLISION_KNOCKBACK_SPEED;
      a.vy = -ny * COLLISION_KNOCKBACK_SPEED;
      b.vx = nx * COLLISION_KNOCKBACK_SPEED;
      b.vy = ny * COLLISION_KNOCKBACK_SPEED;
      a.hitFlash = 0.18;
      b.hitFlash = 0.18;
      a.impactFlash = Math.max(a.impactFlash, 0.16);
      b.impactFlash = Math.max(b.impactFlash, 0.16);
      a.knockbackTimer = Math.max(a.knockbackTimer, COLLISION_KNOCKBACK_DURATION);
      b.knockbackTimer = Math.max(b.knockbackTimer, COLLISION_KNOCKBACK_DURATION);
      queuePostKnockbackStun(a, COLLISION_STUN_DURATION);
      queuePostKnockbackStun(b, COLLISION_STUN_DURATION);
    }
  }

  for (const actor of engine.actors) {
    if (!actor.alive) continue;
    if (Math.hypot(actor.x - CX, actor.y - CY) > engine.arenaRadius + actor.radius * 1.35) {
      eliminateActor(engine, actor);
    }
  }

  const survivors = engine.actors.filter((actor) => actor.alive);
  const survivingTeams = new Map<string, Actor[]>();
  for (const survivor of survivors) {
    const members = survivingTeams.get(survivor.teamId) ?? [];
    members.push(survivor);
    survivingTeams.set(survivor.teamId, members);
  }
  const deathAnimationActive = engine.actors.some(
    (actor) => !actor.alive && actor.deathTimer > 0,
  );
  if (survivingTeams.size === 1 && engine.actors.length > 1) {
    if (deathAnimationActive) return null;
    const champion = [...survivingTeams.values()][0][0];
    return championFromActor(champion);
  }
  if (survivingTeams.size === 0) {
    if (deathAnimationActive) return null;
    const latest = [...engine.actors].sort((a, b) => b.outAt - a.outAt)[0];
    if (latest) {
      latest.alive = true;
      latest.deathTimer = 0;
      latest.deathStyle = null;
    }
    return latest ? championFromActor(latest) : null;
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

const fighterIconCache = new Map<string, HTMLImageElement>();
const effectImageCache = new Map<string, HTMLImageElement>();
let arenaBackgroundImage: HTMLImageElement | null = null;

function getFighterIcon(src: string) {
  if (typeof Image === "undefined") return null;
  const cached = fighterIconCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  fighterIconCache.set(src, image);
  return image;
}

function getArenaBackgroundImage() {
  if (typeof Image === "undefined") return null;
  if (arenaBackgroundImage) return arenaBackgroundImage;
  arenaBackgroundImage = new Image();
  arenaBackgroundImage.decoding = "async";
  arenaBackgroundImage.src = ARENA_BACKGROUND_SRC;
  return arenaBackgroundImage;
}

function getEffectImage(src: string) {
  if (typeof Image === "undefined") return null;
  const cached = effectImageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  effectImageCache.set(src, image);
  return image;
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) * 0.5;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) * 0.5;
  }
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
}

function drawActor(
  ctx: CanvasRenderingContext2D,
  actor: Actor,
  castEffect: "zed" | "jinx" | "janna" | "lee-sin" | "darius" | null,
  elapsed: number,
) {
  const radius = actor.radius;
  const knockbackSpeed = Math.hypot(actor.vx, actor.vy);
  if (actor.impactFlash > 0 && knockbackSpeed > 80) {
    const trailAngle = Math.atan2(actor.vy, actor.vx);
    const trailStrength = clamp(actor.impactFlash / 0.42, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 3; index >= 1; index -= 1) {
      const distance = 9 + index * 10;
      ctx.globalAlpha = trailStrength * (0.2 - index * 0.035);
      ctx.fillStyle = actor.color;
      ctx.beginPath();
      ctx.arc(
        actor.x - Math.cos(trailAngle) * distance,
        actor.y - Math.sin(trailAngle) * distance,
        radius * (1 - index * 0.12),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  if (castEffect) {
    const pulse = 1 + Math.sin(elapsed * 12) * 0.08;
    ctx.save();
    ctx.translate(actor.x, actor.y);
    ctx.rotate(elapsed * 5.5);
    ctx.scale(pulse, pulse);
    ctx.globalCompositeOperation = castEffect === "zed" || castEffect === "darius"
      ? "source-over"
      : "lighter";
    ctx.globalAlpha = castEffect === "janna" ? 0.52 : castEffect === "darius" ? 0.64 : 0.72;
    const primary = castEffect === "zed"
      ? ZED_SKILL_PRIMARY
      : castEffect === "jinx"
        ? JINX_SKILL_PRIMARY
        : castEffect === "darius"
          ? DARIUS_SKILL_PRIMARY
          : castEffect === "lee-sin"
            ? LEE_SIN_SKILL_PRIMARY
            : JANNA_SKILL_PRIMARY;
    const secondary = castEffect === "janna"
      ? JANNA_SKILL_LIGHT
      : castEffect === "lee-sin"
        ? LEE_SIN_SKILL_LIGHT
        : castEffect === "darius"
          ? DARIUS_SKILL_LIGHT
          : castEffect === "zed"
            ? ZED_SKILL_LIGHT
            : JINX_SKILL_LIGHT;
    if (castEffect === "darius") {
      ctx.globalAlpha = 0.92;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 5;
      ctx.strokeStyle = DARIUS_SKILL_DARK;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.84;
    }
    ctx.shadowColor = primary;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = primary;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 10, -0.15, Math.PI * 0.72);
    ctx.stroke();
    ctx.strokeStyle = secondary;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 10, Math.PI - 0.15, Math.PI * 1.72);
    ctx.stroke();
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2;
      ctx.fillStyle = index % 2 === 0 ? primary : secondary;
      ctx.beginPath();
      ctx.arc(
        Math.cos(angle) * (radius + 10),
        Math.sin(angle) * (radius + 10),
        1.8,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(actor.x, actor.y);
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.beginPath();
  ctx.ellipse(4, radius * 0.8, radius * 1.08, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = actor.hitFlash > 0 ? "#fff" : actor.color;
  ctx.shadowBlur = actor.hitFlash > 0 ? 14 : 9;
  ctx.fillStyle = actor.color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  const icon = getFighterIcon(actor.icon);
  if (icon?.complete && icon.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(icon, -radius, -radius, radius * 2, radius * 2);
    if (actor.hitFlash > 0) {
      ctx.globalAlpha = clamp(actor.hitFlash / 0.18, 0, 0.62);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    }
    ctx.restore();
  } else if (actor.hitFlash > 0) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255,255,255,.78)";
  ctx.lineWidth = 2.4;
  ctx.stroke();
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
  ctx.restore();

  if (actor.impactFlash > 0) {
    const impactProgress = 1 - clamp(actor.impactFlash / 0.42, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = Math.pow(1 - impactProgress, 0.7) * 0.58;
    ctx.strokeStyle = actor.color;
    ctx.lineWidth = 2.6 * (1 - impactProgress) + 1;
    ctx.shadowColor = actor.color;
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(actor.x, actor.y, radius + 7 + impactProgress * 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawZedSmoke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  strength: number,
  elapsed: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = "source-over";
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2 + elapsed * (0.45 + (index % 3) * 0.08);
    const drift = 15 + (index % 4) * 8 + strength * 13;
    const cloudX = Math.cos(angle) * drift;
    const cloudY = Math.sin(angle) * drift * 0.68 - strength * 8;
    const radius = 11 + (index % 3) * 5 + strength * 7;
    const fog = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, radius);
    fog.addColorStop(0, `rgba(7,8,11,${0.68 * strength})`);
    fog.addColorStop(0.58, `rgba(28,31,38,${0.42 * strength})`);
    fog.addColorStop(1, "rgba(17,19,24,0)");
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.arc(cloudX, cloudY, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSpawningActor(
  ctx: CanvasRenderingContext2D,
  actor: Actor,
  castEffect: "zed" | "jinx" | "janna" | "lee-sin" | "darius" | null,
  elapsed: number,
) {
  const progress = clamp(1 - actor.spawnFadeTimer / ZED_SPAWN_FADE_DURATION, 0, 1);
  drawZedSmoke(ctx, actor.x, actor.y, 1 - progress * 0.45, elapsed);
  ctx.save();
  ctx.globalAlpha = progress;
  drawActor(ctx, actor, castEffect, elapsed);
  ctx.restore();
}

function drawActorDeath(ctx: CanvasRenderingContext2D, actor: Actor, elapsed: number) {
  if (!actor.deathStyle || actor.deathDuration <= 0) return;
  const progress = clamp(1 - actor.deathTimer / actor.deathDuration, 0, 1);
  if (actor.deathStyle === "zed-smoke") {
    drawZedSmoke(ctx, actor.x, actor.y, Math.sin(progress * Math.PI) * 0.8 + 0.2, elapsed);
    ctx.save();
    ctx.globalAlpha = Math.pow(1 - progress, 1.25);
    drawActor(ctx, actor, null, elapsed);
    ctx.restore();
    return;
  }

  const shakeProgress = clamp(progress / 0.38, 0, 1);
  const shake = Math.sin(elapsed * 120) * 7 * (1 - shakeProgress);
  const fade = 1 - clamp((progress - 0.28) / 0.72, 0, 1);
  ctx.save();
  ctx.translate(shake, Math.cos(elapsed * 105) * 2.5 * (1 - shakeProgress));
  ctx.globalAlpha = fade;
  drawActor(ctx, actor, null, elapsed);
  ctx.restore();
}

function drawJinxRocket(ctx: CanvasRenderingContext2D, rocket: RocketProjectile) {
  ctx.save();
  ctx.strokeStyle = "rgba(0, 173, 233, .44)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(rocket.targetX, rocket.targetY, JINX_ROCKET_TARGET_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.translate(rocket.x, rocket.y);
  ctx.rotate(rocket.angle);
  const trail = ctx.createLinearGradient(-42, 0, 8, 0);
  trail.addColorStop(0, "rgba(0, 173, 233, 0)");
  trail.addColorStop(1, "rgba(105, 218, 255, .92)");
  ctx.fillStyle = trail;
  ctx.beginPath();
  ctx.moveTo(-42, 0);
  ctx.lineTo(-7, -7);
  ctx.lineTo(-7, 7);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = JINX_SKILL_PRIMARY;
  ctx.shadowBlur = 8;
  ctx.fillStyle = JINX_SKILL_LIGHT;
  roundedRect(ctx, -8, -6, 28, 12, 6);
  ctx.fill();
  ctx.fillStyle = JINX_SKILL_DARK;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(12, -7);
  ctx.lineTo(12, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRocketExplosion(ctx: CanvasRenderingContext2D, explosion: ExplosionEffect) {
  const progress = clamp(explosion.age / EXPLOSION_DURATION, 0, 1);
  const fade = 1 - progress;
  const coreRadius = JINX_ROCKET_EXPLOSION_RADIUS * (0.45 + progress * 0.55);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.7;
  const glow = ctx.createRadialGradient(
    explosion.x,
    explosion.y,
    0,
    explosion.x,
    explosion.y,
    coreRadius,
  );
  glow.addColorStop(0, `rgba(185,237,255,${0.7 * fade})`);
  glow.addColorStop(0.35, `rgba(64,194,238,${0.62 * fade})`);
  glow.addColorStop(0.72, `rgba(0,173,233,${0.42 * fade})`);
  glow.addColorStop(1, "rgba(0,104,141,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = fade * 0.58;
  ctx.strokeStyle = JINX_SKILL_LIGHT;
  ctx.lineWidth = 2 * fade + 0.8;
  ctx.shadowColor = JINX_SKILL_PRIMARY;
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(
    explosion.x,
    explosion.y,
    JINX_ROCKET_EXPLOSION_RADIUS * (0.25 + progress * 0.75),
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 + explosion.id * 0.73;
    const spread = 8 + progress * (15 + (index % 2) * 5);
    const sparkX = explosion.x + Math.cos(angle) * spread;
    const sparkY = explosion.y + Math.sin(angle) * spread;
    const sparkLength = 7 * fade + 2;
    ctx.globalAlpha = fade * 0.62;
    ctx.strokeStyle = index % 2 === 0 ? JINX_SKILL_LIGHT : JINX_SKILL_PRIMARY;
    ctx.lineWidth = 1.4 * fade + 0.7;
    ctx.beginPath();
    ctx.moveTo(sparkX, sparkY);
    ctx.lineTo(
      sparkX + Math.cos(angle) * sparkLength,
      sparkY + Math.sin(angle) * sparkLength,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawLeeSinKickEffect(ctx: CanvasRenderingContext2D, effect: LeeSinKickEffect) {
  const progress = clamp(effect.age / LEE_SIN_KICK_EFFECT_DURATION, 0, 1);
  const fade = 1 - progress;
  const angle = Math.atan2(effect.targetY - effect.y, effect.targetX - effect.x);
  const pop = 0.72 + Math.sin(Math.min(1, progress * 2.4) * Math.PI * 0.5) * 0.38;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = fade * 0.4;
  ctx.translate(effect.x, effect.y);
  ctx.rotate(angle);
  ctx.strokeStyle = LEE_SIN_SKILL_LIGHT;
  ctx.shadowColor = LEE_SIN_SKILL_PRIMARY;
  ctx.shadowBlur = 7;
  ctx.lineWidth = 3 * fade + 1;
  ctx.beginPath();
  ctx.moveTo(-54 - progress * 18, 0);
  ctx.lineTo(-18, 0);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(effect.x, effect.y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.scale(pop, pop);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = Math.pow(fade, 0.7) * 0.78;
  ctx.shadowColor = LEE_SIN_SKILL_PRIMARY;
  ctx.shadowBlur = 9;
  ctx.fillStyle = LEE_SIN_SKILL_DARK;
  ctx.beginPath();
  ctx.moveTo(-48, 14);
  ctx.lineTo(-25, 4);
  ctx.lineTo(-43, -7);
  ctx.lineTo(-16, -4);
  ctx.lineTo(-24, -29);
  ctx.lineTo(-8, -12);
  ctx.lineTo(0, -54);
  ctx.lineTo(8, -13);
  ctx.lineTo(24, -34);
  ctx.lineTo(18, -5);
  ctx.lineTo(44, -12);
  ctx.lineTo(27, 4);
  ctx.lineTo(52, 12);
  ctx.lineTo(19, 18);
  ctx.lineTo(-22, 18);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = fade * 0.78;
  ctx.shadowBlur = 6;
  ctx.fillStyle = LEE_SIN_SKILL_PRIMARY;
  ctx.beginPath();
  ctx.moveTo(-25, 11);
  ctx.lineTo(-8, 1);
  ctx.lineTo(-13, -14);
  ctx.lineTo(0, -5);
  ctx.lineTo(3, -31);
  ctx.lineTo(11, -7);
  ctx.lineTo(26, -13);
  ctx.lineTo(17, 3);
  ctx.lineTo(31, 10);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = fade * 0.72;
  ctx.fillStyle = LEE_SIN_SKILL_LIGHT;
  ctx.beginPath();
  ctx.moveTo(-7, 8);
  ctx.lineTo(0, -16);
  ctx.lineTo(7, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLeeSinDashTrail(ctx: CanvasRenderingContext2D, trail: LeeSinDashTrail) {
  const progress = clamp(trail.age / LEE_SIN_DASH_TRAIL_DURATION, 0, 1);
  const fade = 1 - progress;
  ctx.save();
  ctx.translate(trail.x, trail.y);
  ctx.rotate(trail.angle);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = fade * 0.5;
  ctx.strokeStyle = LEE_SIN_SKILL_PRIMARY;
  ctx.shadowColor = LEE_SIN_SKILL_LIGHT;
  ctx.shadowBlur = 7;
  ctx.lineCap = "round";
  ctx.lineWidth = 6 * fade + 1.5;
  ctx.beginPath();
  ctx.moveTo(-34 - progress * 18, 0);
  ctx.lineTo(-8, 0);
  ctx.stroke();
  ctx.globalAlpha = fade * 0.66;
  ctx.fillStyle = LEE_SIN_SKILL_LIGHT;
  ctx.beginPath();
  ctx.arc(-13, 0, 3.5 * fade + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDariusSlashEffect(ctx: CanvasRenderingContext2D, effect: DariusSlashEffect) {
  const progress = clamp(effect.age / DARIUS_SLASH_EFFECT_DURATION, 0, 1);
  const radius = dariusSlashVisualRadius(effect.age);
  const frameIndex = Math.min(
    DARIUS_SLASH_FRAME_COUNT - 1,
    Math.floor(progress * DARIUS_SLASH_FRAME_COUNT),
  );
  const frameColumn = frameIndex % DARIUS_SLASH_SHEET_COLUMNS;
  const frameRow = Math.floor(frameIndex / DARIUS_SLASH_SHEET_COLUMNS);
  const sheet = getEffectImage(DARIUS_SLASH_SHEET_SRC);
  const fade = progress < 0.84 ? 1 : 1 - (progress - 0.84) / 0.16;
  const spinProgress = clamp(progress / 0.64, 0, 1);
  const rotation = -Math.PI * 0.7 + spinProgress * Math.PI * 2.5;
  const slashLayers = [
    { angleOffset: 0, scale: 1, alpha: 0.96, filter: DARIUS_SLASH_BLACK_FILTER },
    { angleOffset: Math.PI / 24, scale: 0.92, alpha: 0.9, filter: DARIUS_SLASH_RED_FILTER },
  ];

  ctx.save();
  ctx.translate(effect.x, effect.y);
  ctx.globalCompositeOperation = "source-over";

  // The authored frame can touch the skill edge, but never render beyond the live hit radius.
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();

  if (sheet?.complete && sheet.naturalWidth > 0) {
    const sourceWidth = sheet.naturalWidth / DARIUS_SLASH_SHEET_COLUMNS;
    const sourceHeight = sheet.naturalHeight / DARIUS_SLASH_SHEET_ROWS;
    for (const layer of slashLayers) {
      const layerRadius = radius * layer.scale;
      ctx.save();
      ctx.rotate(rotation + layer.angleOffset);
      ctx.globalAlpha = fade * layer.alpha;
      ctx.filter = layer.filter;
      ctx.drawImage(
        sheet,
        frameColumn * sourceWidth,
        frameRow * sourceHeight,
        sourceWidth,
        sourceHeight,
        -layerRadius,
        -layerRadius,
        layerRadius * 2,
        layerRadius * 2,
      );
      ctx.restore();
    }
  } else {
    ctx.rotate(rotation);
    ctx.globalAlpha = fade * 0.3;
    ctx.strokeStyle = DARIUS_SKILL_DARK;
    ctx.lineWidth = Math.max(7, radius * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.88, -Math.PI * 0.88, Math.PI * 0.7);
    ctx.stroke();
    ctx.globalAlpha = fade * 0.78;
    ctx.strokeStyle = DARIUS_SKILL_PRIMARY;
    ctx.shadowColor = DARIUS_SKILL_LIGHT;
    ctx.shadowBlur = 5;
    ctx.lineWidth = Math.max(4, radius * 0.055);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.88, -Math.PI * 0.88, Math.PI * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawJannaTornado(ctx: CanvasRenderingContext2D, tornado: Tornado) {
  const fadeOut = tornado.fadeOut === null
    ? 1
    : clamp(tornado.fadeOut / JANNA_TORNADO_FADE_OUT_DURATION, 0, 1);
  const tornadoRadius = jannaTornadoRadius(tornado.age);
  const sprite = getEffectImage(JANNA_TORNADO_LAYER_SRC);
  const layers = [
    { scale: 1.18, speed: 4.6, phase: 0.18, alpha: 0.22, offset: 0.012 },
    { scale: 1.08, speed: 5.1, phase: 1.46, alpha: 0.2, offset: 0.019 },
    { scale: 0.98, speed: 5.7, phase: 2.34, alpha: 0.19, offset: 0.026 },
    { scale: 0.88, speed: 6.35, phase: -0.74, alpha: 0.18, offset: 0.033 },
    { scale: 0.78, speed: 7.05, phase: 1.16, alpha: 0.17, offset: 0.04 },
    { scale: 0.69, speed: 7.8, phase: 2.82, alpha: 0.16, offset: 0.047 },
    { scale: 0.6, speed: 8.6, phase: -1.52, alpha: 0.15, offset: 0.054 },
    { scale: 0.52, speed: 9.45, phase: 0.92, alpha: 0.14, offset: 0.061 },
    { scale: 0.45, speed: 10.35, phase: -2.38, alpha: 0.13, offset: 0.068 },
    { scale: 0.38, speed: 11.3, phase: 2.06, alpha: 0.12, offset: 0.075 },
    { scale: 0.31, speed: 12.3, phase: -0.36, alpha: 0.11, offset: 0.082 },
    { scale: 0.25, speed: 13.4, phase: 3.04, alpha: 0.1, offset: 0.09 },
  ];

  ctx.save();
  ctx.translate(tornado.x, tornado.y);
  ctx.globalCompositeOperation = "source-over";

  // Every layer stays inside the same circle used by collision detection.
  ctx.beginPath();
  ctx.arc(0, 0, tornadoRadius, 0, Math.PI * 2);
  ctx.clip();

  if (sprite?.complete && sprite.naturalWidth > 0) {
    for (const layer of layers) {
      const breath = 1 + Math.sin(tornado.age * 2.4 + layer.phase) * 0.026;
      const diameter = tornadoRadius * 2 * layer.scale * breath;
      const offsetAngle = tornado.age * 0.72 + layer.phase * 1.7;
      const offsetDistance = tornadoRadius * layer.offset;
      ctx.save();
      ctx.translate(
        Math.cos(offsetAngle) * offsetDistance,
        Math.sin(offsetAngle) * offsetDistance,
      );
      ctx.rotate(tornado.age * layer.speed + layer.phase + tornado.id * 0.31);
      ctx.globalAlpha = fadeOut * layer.alpha;
      ctx.drawImage(sprite, -diameter / 2, -diameter / 2, diameter, diameter);
      ctx.restore();
    }
  } else {
    ctx.globalAlpha = fadeOut * 0.72;
    ctx.strokeStyle = JANNA_SKILL_PRIMARY;
    ctx.shadowColor = JANNA_SKILL_DARK;
    ctx.shadowBlur = 4;
    ctx.lineWidth = Math.max(3, tornadoRadius * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, tornadoRadius * 0.72, tornado.age, tornado.age + Math.PI * 1.52);
    ctx.stroke();
  }
  ctx.restore();
}

function drawJannaTornadoLink(
  ctx: CanvasRenderingContext2D,
  janna: Actor,
  tornado: Tornado,
  elapsed: number,
) {
  const fadeOut = tornado.fadeOut === null
    ? 1
    : clamp(tornado.fadeOut / JANNA_TORNADO_FADE_OUT_DURATION, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = fadeOut * 0.42;
  ctx.strokeStyle = JANNA_SKILL_LIGHT;
  ctx.shadowColor = JANNA_SKILL_PRIMARY;
  ctx.shadowBlur = 2;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 7]);
  ctx.lineDashOffset = -elapsed * 18;
  ctx.beginPath();
  ctx.moveTo(janna.x, janna.y);
  ctx.lineTo(tornado.x, tornado.y);
  ctx.stroke();
  ctx.restore();
}

function drawRuneBoundary(ctx: CanvasRenderingContext2D, engine: EngineState) {
  const radius = engine.arenaRadius;
  ctx.save();
  ctx.lineCap = "round";

  ctx.strokeStyle = ARENA_RUNE_DARK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = ARENA_RUNE_PRIMARY;
  ctx.lineWidth = 1.9;
  ctx.shadowColor = ARENA_RUNE_PRIMARY;
  ctx.shadowBlur = 7;
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowBlur = 3;
  ctx.strokeStyle = ARENA_RUNE_LIGHT;
  ctx.lineWidth = 0.9;
  ctx.setLineDash([1.5, 6, 9, 7]);
  ctx.lineDashOffset = -engine.elapsed * 10;
  ctx.beginPath();
  ctx.arc(CX, CY, radius - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const x = CX + Math.cos(angle) * (radius - 1.5);
    const y = CY + Math.sin(angle) * (radius - 1.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.globalAlpha = index % 3 === 0 ? 0.92 : 0.58;
    ctx.strokeStyle = index % 2 === 0 ? ARENA_RUNE_LIGHT : ARENA_RUNE_PRIMARY;
    ctx.lineWidth = index % 3 === 0 ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.moveTo(-3.2, 1.8);
    ctx.lineTo(0, -2.4);
    ctx.lineTo(3.2, 1.8);
    if (index % 3 === 0) {
      ctx.moveTo(0, -2.4);
      ctx.lineTo(0, -5.2);
    }
    ctx.stroke();
    ctx.restore();
  }
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
  getEffectImage(JANNA_TORNADO_LAYER_SRC);
  getEffectImage(DARIUS_SLASH_SHEET_SRC);
  const arenaBackground = getArenaBackgroundImage();
  if (arenaBackground?.complete && arenaBackground.naturalWidth > 0) {
    drawImageCover(ctx, arenaBackground, WORLD_W, WORLD_H);
  } else {
    const background = ctx.createRadialGradient(CX, CY, 40, CX, CY, 520);
    background.addColorStop(0, "#793f31");
    background.addColorStop(0.58, "#38201d");
    background.addColorStop(1, "#090707");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }
  const mapVignette = ctx.createRadialGradient(CX, CY, 90, CX, CY, 440);
  mapVignette.addColorStop(0, "rgba(25,5,2,0)");
  mapVignette.addColorStop(0.72, "rgba(11,4,5,.08)");
  mapVignette.addColorStop(1, "rgba(3,2,3,.5)");
  ctx.fillStyle = mapVignette;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  drawRuneBoundary(ctx, engine);

  const janna = engine.actors.find((actor) => actor.id === "janna" && actor.alive);
  for (const tornado of engine.tornadoes) {
    if (janna) drawJannaTornadoLink(ctx, janna, tornado, engine.elapsed);
    drawJannaTornado(ctx, tornado);
  }
  for (const rocket of engine.rockets) drawJinxRocket(ctx, rocket);
  for (const trail of engine.leeSinDashTrails) drawLeeSinDashTrail(ctx, trail);
  for (const effect of engine.leeSinKickEffects) drawLeeSinKickEffect(ctx, effect);
  for (const actor of engine.actors.filter((entry) => !entry.alive && entry.deathTimer > 0)) {
    drawActorDeath(ctx, actor, engine.elapsed);
  }
  for (const actor of engine.actors.filter((entry) => entry.alive)) {
    const castEffect = actor.id === "jinx" && engine.jinxVolleyRemaining > 0
      ? "jinx"
      : actor.id === "janna" && engine.jannaCastTimer > 0
        ? "janna"
        : actor.id === "lee-sin" && engine.leeSinCastTimer > 0
          ? "lee-sin"
          : actor.id === "darius" && engine.dariusCastTimer > 0
            ? "darius"
            : actor.id === engine.zedCasterId && engine.zedCastTimer > 0
              ? "zed"
              : null;
    if (actor.spawnFadeTimer > 0) {
      drawSpawningActor(ctx, actor, castEffect, engine.elapsed);
    } else {
      drawActor(
        ctx,
        actor,
        castEffect,
        engine.elapsed,
      );
    }
  }
  for (const effect of engine.dariusSlashEffects) drawDariusSlashEffect(ctx, effect);
  for (const explosion of engine.explosions) drawRocketExplosion(ctx, explosion);

  ctx.textAlign = "center";
  if (status === "countdown") {
    ctx.save(); ctx.shadowColor = "#45d2dd"; ctx.shadowBlur = 28; ctx.fillStyle = "#f3cf88";
    ctx.font = "900 96px Georgia, serif"; ctx.fillText(countdown > 0 ? String(countdown) : "GO", CX, CY + 34); ctx.restore();
  }
  if (status === "finished" && winner) {
    ctx.fillStyle = "rgba(12,5,4,.58)"; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = "#e6b65b"; ctx.font = "800 15px ui-monospace, monospace"; ctx.fillText("LAST SIGNAL STANDING", CX, CY - 80);
    ctx.fillStyle = "#f8e9cf"; ctx.font = "900 48px Georgia, serif"; ctx.fillText(winner.name, CX, CY - 24);
  }
}
