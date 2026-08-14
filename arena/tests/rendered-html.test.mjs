import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the champion prediction experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Arena — 冠軍預測亂鬥<\/title>/i);
  assert.match(html, /開始亂鬥/);
  for (const fighter of ["Zed", "Jinx", "Darius", "Lee Sin", "Janna"]) {
    assert.match(html, new RegExp(fighter));
  }
  assert.doesNotMatch(html, /CHAMPION PICK|YOUR PICK|<h1>ARENA<\/h1>|選擇冠軍/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships selection, automated resolution, and prize settlement without removed controls", async () => {
  const [component, arena, engine, globalsCss, packageJson] = await Promise.all([
    readFile(new URL("../app/components/ArenaGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/arena.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(component, /selectedId/);
  assert.match(component, /WIN_PROBABILITY = 1 \/ DEFAULT_FIGHTERS\.length/);
  assert.match(component, /DECIMAL_ODDS = 1 \/ WIN_PROBABILITY/);
  assert.match(component, /WIN_PRIZE = ENTRY_AMOUNT \* DECIMAL_ODDS/);
  assert.match(component, /賠率 <strong>\{DECIMAL_ODDS\.toFixed\(2\)\}x<\/strong>/);
  assert.doesNotMatch(component, /<span>預測成功 <strong>NT\$ \{WIN_PRIZE\}<\/strong><\/span>/);
  assert.match(component, /setSettlement/);
  assert.match(component, /disabled={!selectedFighter/);
  assert.match(component, /DESIGN_WIDTH = 1179/);
  assert.match(component, /DESIGN_HEIGHT = 1977/);
  assert.match(component, /Math\.min\(availableWidth \/ DESIGN_WIDTH, availableHeight \/ DESIGN_HEIGHT\)/);
  assert.match(component, /window\.visualViewport/);
  assert.match(component, /translate\(-50%, -50%\) scale\(\$\{viewportScale\}\)/);
  assert.match(globalsCss, /\.arena-design-surface[\s\S]*width: 1179px;[\s\S]*height: 1977px;/);
  assert.match(globalsCss, /\.arena-app[\s\S]*width: 393px;[\s\S]*height: 659px;[\s\S]*transform: scale\(3\)/);
  assert.match(globalsCss, /html,[\s\S]*body[\s\S]*overflow: hidden/);
  assert.doesNotMatch(component, /arena-header|prediction-heading|YOUR PICK|CHAMPION PICK/);
  assert.doesNotMatch(globalsCss, /\.arena-header|\.prediction-heading/);
  assert.match(globalsCss, /\.prediction-panel[\s\S]*grid-template-columns: 142px minmax\(0, 1fr\)/);
  assert.match(globalsCss, /\.fighter-option[\s\S]*min-height: 50px/);
  assert.match(component, /獲得模擬獎金/);
  assert.match(component, /回到下注/);
  assert.match(component, /className="fighter-avatar"/);
  assert.match(component, /className="skill-info-button"/);
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /skillFighter\.skillDescription/);
  assert.match(component, /className="selected-skill-preview"/);
  assert.match(component, /selectedFighter\.skillIcon/);
  assert.match(component, /selectedFighter\.skillName/);
  assert.match(component, /selectedFighter\.skillDescription/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /settlement\.champion\.icon/);
  assert.match(globalsCss, /\.skill-backdrop/);
  assert.match(globalsCss, /\.skill-dialog-icon/);
  assert.match(globalsCss, /\.selected-skill-preview[\s\S]*grid-template-columns: 36px minmax\(0, 1fr\)/);
  assert.match(globalsCss, /\.entry-summary[\s\S]*font-size: 10px/);
  assert.match(globalsCss, /\.entry-summary strong[\s\S]*900 13px\/1/);
  assert.match(globalsCss, /--rust: #8f4330/);
  assert.match(globalsCss, /--bronze: #b17645/);
  assert.match(globalsCss, /--violet: #8c5f9f/);
  assert.match(globalsCss, /linear-gradient\(150deg, #24120f, #0d0808 62%, #060505\)/);
  for (const fighter of ["Zed", "Jinx", "Darius", "Lee Sin", "Janna"]) {
    assert.match(arena, new RegExp(`name: "${fighter}"`));
  }
  for (const description of [
    "劫召喚一位影分身一起進行戰鬥",
    "吉茵珂絲射出連發火箭對前方目標進行掃蕩。",
    "達瑞斯揮舞他的斧頭造成致命旋風，對周圍進行大範圍擊退。",
    "李星鎖定一位目標衝刺並造成強力擊退。",
    "珍娜控制天氣，召喚一道隨時間強化的龍捲風",
  ]) {
    assert.match(arena, new RegExp(`skillDescription: "${description}"`));
    assert.doesNotMatch(description, /\d/);
  }
  for (const skillName of [
    "疾風殘影",
    "超威能死亡火箭",
    "毀滅風暴",
    "虎嘯龍吟",
    "颶風呼嘯",
  ]) {
    assert.match(arena, new RegExp(`skillName: "${skillName}"`));
  }

  assert.match(engine, /stepEngine/);
  assert.match(engine, /WORLD_W = 680/);
  assert.match(engine, /arenaRadius/);
  assert.match(engine, /BASE_RADIUS = 294/);
  assert.match(engine, /MIN_RADIUS = 120/);
  assert.match(engine, /SHRINK_DELAY = 0/);
  assert.match(engine, /SHRINK_SPEED = 5\.5/);
  assert.doesNotMatch(engine, /縮圈倒數|最小決勝圈|能量環收縮|boundaryLabel/);
  assert.match(engine, /ARENA_BACKGROUND_SRC = assetPath\("\/arena-map-v1\.png"\)/);
  assert.match(engine, /function getArenaBackgroundImage/);
  assert.match(engine, /function drawImageCover/);
  assert.match(engine, /drawImageCover\(ctx, arenaBackground, WORLD_W, WORLD_H\)/);
  assert.match(engine, /ARENA_RUNE_PRIMARY = "#54dbe2"/);
  assert.match(engine, /ARENA_RUNE_LIGHT = "#c6f5ee"/);
  assert.match(engine, /ARENA_RUNE_DARK = "#102c31"/);
  assert.match(engine, /function drawRuneBoundary/);
  assert.match(engine, /ctx\.setLineDash\(\[1\.5, 6, 9, 7\]\)/);
  assert.match(engine, /for \(let index = 0; index < 24; index \+= 1\)/);
  assert.match(engine, /drawRuneBoundary\(ctx, engine\)/);
  assert.doesNotMatch(engine, /boundaryColor|#ff6848/);
  assert.doesNotMatch(engine, /戰鬥模擬待命中/);
  assert.match(engine, /MOVE_SPEED = 150/);
  assert.match(engine, /COLLISION_KNOCKBACK_SPEED = 400/);
  assert.doesNotMatch(engine, /Math\.round\(actor\.damage\).*%/);
  assert.doesNotMatch(engine, /Math\.round\(winner\.damage\).*傷害存活/);
  assert.match(component, /drawArena\(ctx, engineRef\.current, statusRef\.current, countdown, winner\)/);
  assert.doesNotMatch(component, /actors\.find\(\(actor\) => actor\.alive\).*winner/);
  assert.match(component, /function normalizeChampion\(champion: Actor\)/);
  assert.match(component, /entry\.id === champion\.teamId \|\| entry\.id === champion\.id/);
  assert.match(component, /const settledChampion = normalizeChampion\(champion\)/);
  assert.match(component, /champion: \{ \.\.\.settledChampion \}/);
  assert.match(engine, /Math\.cos\(angle \+ Math\.PI\) \* MOVE_SPEED/);
  assert.match(engine, /actor\.vx = Math\.cos\(actor\.targetAngle\) \* MOVE_SPEED/);
  assert.match(engine, /a\.vx = -nx \* COLLISION_KNOCKBACK_SPEED/);
  assert.match(engine, /b\.vx = nx \* COLLISION_KNOCKBACK_SPEED/);
  assert.doesNotMatch(engine, /MOVE_ACCEL|MAX_MOVE_SPEED|DASH_MIN|DASH_VARIANCE|KNOCKBACK_BASE|KNOCKBACK_DAMAGE/);
  assert.match(engine, /launchJinxRocket/);
  assert.match(engine, /hitJinxRocket/);
  assert.match(engine, /JINX_VOLLEY_SIZE = 10/);
  assert.match(engine, /JINX_VOLLEY_INTERVAL = 0\.1/);
  assert.match(engine, /JINX_ROCKET_COOLDOWN = 7/);
  assert.match(engine, /JINX_ROCKET_SPREAD_RADIANS = Math\.PI \* 2 \/ 15/);
  assert.match(engine, /JINX_ROCKET_KNOCKBACK = 250/);
  assert.match(engine, /JINX_ROCKET_KNOCKBACK_DURATION = 0\.12/);
  assert.match(engine, /JINX_ROCKET_STUN_DURATION = 0\.3/);
  assert.match(engine, /queuePostKnockbackStun\(target, JINX_ROCKET_STUN_DURATION\)/);
  assert.match(engine, /JINX_ROCKET_EXPLOSION_RADIUS = 34/);
  assert.match(engine, /JINX_ROCKET_SPEED = 650/);
  assert.match(engine, /jinxVolleyTargetId: string \| null/);
  assert.match(engine, /engine\.jinxVolleyTargetId = target\.id/);
  assert.match(engine, /engine\.jinxVolleyTargetX = target\.x/);
  assert.match(engine, /engine\.jinxVolleyTargetY = target\.y/);
  assert.match(engine, /actor\.id === engine\.jinxVolleyTargetId/);
  assert.match(engine, /engine\.jinxVolleyTargetX = volleyTarget\.x/);
  assert.match(engine, /engine\.jinxVolleyTargetY = volleyTarget\.y/);
  assert.match(engine, /engine\.jinxVolleyTargetX,[\s\S]{0,80}engine\.jinxVolleyTargetY/);
  assert.doesNotMatch(engine, /rocket\.targetId/);
  assert.match(engine, /const spreadOffset = \(Math\.random\(\) - 0\.5\) \* JINX_ROCKET_SPREAD_RADIANS/);
  assert.match(engine, /const angle = targetAngle \+ spreadOffset/);
  assert.match(engine, /const nextX = rocket\.x \+ segmentX/);
  assert.match(engine, /target\.teamId === "jinx"/);
  assert.match(engine, /hitJinxRocket\(engine, rocket, hitTarget\)/);
  assert.doesNotMatch(engine, /rocket\.angle = Math\.atan2/);
  assert.match(engine, /opponents\[Math\.floor\(Math\.random\(\) \* opponents\.length\)\]/);
  assert.match(engine, /function interruptJinxVolley/);
  assert.match(engine, /castingJinxVolley = actor\.id === "jinx" && engine\.jinxVolleyRemaining > 0/);
  assert.match(engine, /castingJinxVolley \|\| castingJannaTornado \|\| castingOrDashingLeeSin \|\| castingZedClone/);
  assert.match(engine, /if \(a\.id === "jinx"\) interruptJinxVolley\(engine\)/);
  assert.match(engine, /actor\.id === "jinx" && engine\.jinxVolleyRemaining > 0/);
  assert.match(engine, /ctx\.rotate\(elapsed \* 5\.5\)/);
  assert.match(engine, /target\.vx \+= Math\.cos\(rocket\.angle\) \* JINX_ROCKET_KNOCKBACK/);
  assert.match(engine, /drawJinxRocket/);
  assert.match(engine, /drawRocketExplosion/);
  assert.match(engine, /actor\.heading = actor\.targetAngle/);
  assert.doesNotMatch(engine, /actor\.heading = Math\.atan2\(actor\.vy, actor\.vx\)/);
  assert.match(engine, /globalCompositeOperation = "lighter"/);
  assert.match(engine, /ZED_SKILL_PRIMARY = "#111318"/);
  assert.match(engine, /JINX_SKILL_PRIMARY = "#00ade9"/);
  assert.match(engine, /DARIUS_SKILL_PRIMARY = "#858b94"/);
  assert.match(engine, /LEE_SIN_SKILL_PRIMARY = "#8f1418"/);
  assert.match(engine, /JANNA_SKILL_PRIMARY = "#f7f9ff"/);
  assert.match(engine, /ctx\.globalCompositeOperation = castEffect === "zed" \? "source-over" : "lighter"/);
  assert.match(engine, /ctx\.globalAlpha = castEffect === "janna" \? 0\.52/);
  assert.match(engine, /for \(let index = 0; index < 6; index \+= 1\)/);
  assert.match(engine, /MAX_KNOCKBACK_SPEED = 760/);
  assert.match(engine, /COLLISION_KNOCKBACK_DURATION = 0\.18/);
  assert.match(engine, /COLLISION_STUN_DURATION = 0\.5/);
  assert.match(engine, /actor\.stunAfterKnockback = Math\.max\([\s\S]*actor\.stunTimer,[\s\S]*actor\.stunAfterKnockback,[\s\S]*duration/);
  assert.match(engine, /queuePostKnockbackStun\(a, COLLISION_STUN_DURATION\)/);
  assert.doesNotMatch(engine, /stunAfterKnockback \+=|stunTimer \+=/);
  assert.match(engine, /AI_PURSUIT_CHANCE = 0\.4/);
  assert.match(engine, /function chooseAiDirection/);
  assert.match(engine, /function steerAiInsideArena/);
  assert.match(engine, /waypointRadius = safeRadius \* \(0\.15 \+ Math\.random\(\) \* 0\.55\)/);
  assert.match(engine, /projectedX = actor\.x \+ Math\.cos\(actor\.targetAngle\) \* lookaheadDistance/);
  assert.match(engine, /if \(speed > MAX_KNOCKBACK_SPEED\)/);
  assert.match(engine, /actor\.impactFlash > 0 && knockbackSpeed > 80/);
  assert.match(engine, /actor\.stunTimer = Math\.max\(actor\.stunTimer, actor\.stunAfterKnockback\)/);
  assert.match(engine, /actor\.vx = 0/);
  assert.match(engine, /JANNA_CAST_DURATION = 0\.5/);
  assert.match(engine, /JANNA_TORNADO_FADE_OUT_DURATION = 0\.65/);
  assert.match(engine, /JANNA_TORNADO_SPEED = 100/);
  assert.match(engine, /JANNA_TORNADO_START_RADIUS = 24/);
  assert.match(engine, /JANNA_TORNADO_MAX_RADIUS = 72/);
  assert.match(engine, /JANNA_TORNADO_GROWTH_PER_SECOND = 12/);
  assert.match(engine, /function jannaTornadoRadius\(age: number\)/);
  assert.match(engine, /JANNA_TORNADO_START_RADIUS \+ age \* JANNA_TORNADO_GROWTH_PER_SECOND/);
  assert.match(engine, /age: 0/);
  assert.match(engine, /tornado\.age \+= dt/);
  assert.match(engine, /const tornadoRadius = jannaTornadoRadius\(tornado\.age\)/);
  assert.match(engine, /hitDistance > actor\.radius \+ tornadoRadius/);
  assert.doesNotMatch(engine, /JANNA_TORNADO_RADIUS/);
  assert.match(engine, /JANNA_TORNADO_KNOCKBACK = 400/);
  assert.match(engine, /JANNA_TORNADO_STUN_DURATION = 1/);
  assert.match(engine, /queuePostKnockbackStun\(actor, JANNA_TORNADO_STUN_DURATION\)/);
  assert.match(engine, /function findCrowdedTarget/);
  assert.match(engine, /function summonJannaTornado/);
  assert.match(engine, /x: janna\.x/);
  assert.match(engine, /y: janna\.y/);
  assert.match(engine, /const target = findCrowdedTarget\(targets\)/);
  assert.match(engine, /angle: Math\.atan2\(target\.y - janna\.y, target\.x - janna\.x\)/);
  assert.match(engine, /enteredScreen: true/);
  assert.doesNotMatch(engine, /JANNA_TORNADO_FADE_IN_DURATION|tornado\.delay|tornado\.active/);
  assert.match(engine, /tornado\.x \+= Math\.cos\(tornado\.angle\) \* travel/);
  assert.doesNotMatch(engine, /const travel = Math\.min\(distance, JANNA_TORNADO_SPEED \* dt\)/);
  assert.match(engine, /const outsideScreen = tornado\.x < 0/);
  assert.match(engine, /tornado\.enteredScreen && outsideScreen/);
  assert.match(engine, /const opacity = fadeOut/);
  assert.match(engine, /for \(let arm = 0; arm < 5; arm \+= 1\)/);
  assert.match(engine, /for \(let index = 0; index < 10; index \+= 1\)/);
  assert.match(engine, /const outerRadius = radius \* \(0\.94 - index \* 0\.012\)/);
  assert.doesNotMatch(engine, /JANNA_CAST_CLEAR_RADIUS|nearbyOpponent|interruptJannaCast/);
  assert.match(engine, /const castingJannaTornado = actor\.id === "janna" && engine\.jannaCastTimer > 0/);
  assert.doesNotMatch(engine, /castingJannaTornado[\s\S]{0,100}engine\.tornadoes\.length > 0/);
  assert.match(engine, /if \(!actor\.alive \|\| actor\.teamId === "janna"/);
  assert.match(engine, /drawJannaTornado/);
  assert.match(engine, /function drawJannaTornadoLink/);
  assert.match(engine, /function drawJannaTornado[\s\S]{0,500}ctx\.globalCompositeOperation = "source-over"/);
  assert.match(engine, /ctx\.lineWidth = 1/);
  assert.match(engine, /ctx\.setLineDash\(\[2, 7\]\)/);
  assert.match(engine, /ctx\.moveTo\(janna\.x, janna\.y\)/);
  assert.match(engine, /ctx\.lineTo\(tornado\.x, tornado\.y\)/);
  assert.match(engine, /ZED_SKILL_PRIMARY = "#111318"/);
  assert.match(engine, /JINX_SKILL_PRIMARY = "#00ade9"/);
  assert.match(engine, /JANNA_SKILL_PRIMARY = "#f7f9ff"/);
  assert.match(engine, /LEE_SIN_SKILL_PRIMARY = "#8f1418"/);
  assert.match(engine, /DARIUS_SKILL_PRIMARY = "#858b94"/);
  assert.match(engine, /LEE_SIN_CAST_DURATION = 0\.5/);
  assert.match(engine, /LEE_SIN_DASH_SPEED = 420/);
  assert.match(engine, /LEE_SIN_KNOCKBACK = 600/);
  assert.match(engine, /LEE_SIN_KNOCKBACK_DURATION = 0\.3/);
  assert.match(engine, /LEE_SIN_STUN_DURATION = 1/);
  assert.match(engine, /queuePostKnockbackStun\(target, LEE_SIN_STUN_DURATION\)/);
  assert.match(engine, /LEE_SIN_SKILL_COOLDOWN = 8/);
  assert.match(engine, /function stepLeeSinSkill/);
  assert.match(engine, /function applyLeeSinKnockback/);
  assert.match(engine, /target\.vx = Math\.cos\(angle\) \* LEE_SIN_KNOCKBACK/);
  assert.match(engine, /const aLeeSinKnockback = a\.leeSinKnockbackTimer > 0/);
  assert.match(engine, /applyLeeSinKnockback\(b, flightAngle\)/);
  assert.match(engine, /continue;/);
  assert.match(engine, /actor\.id === "lee-sin" && engine\.leeSinCastTimer > 0/);
  assert.match(engine, /drawLeeSinKickEffect/);
  assert.match(engine, /selectedTarget = opponents\[Math\.floor\(Math\.random\(\) \* opponents\.length\)\]/);
  assert.match(engine, /engine\.leeSinTargetId = selectedTarget\.id/);
  assert.match(engine, /engine\.leeSinCastTimer = LEE_SIN_CAST_DURATION/);
  assert.match(engine, /const travel = LEE_SIN_DASH_SPEED \* dt/);
  assert.match(engine, /applyLeeSinKnockback\(target, angle\)/);
  assert.match(engine, /function drawLeeSinDashTrail/);
  assert.match(engine, /engine\.leeSinDashTrails\.push/);
  assert.doesNotMatch(engine, /LEE_SIN_TRIGGER_DISTANCE|nearbyTarget/);
  assert.match(engine, /b\.id !== "lee-sin"/);
  assert.match(engine, /a\.id !== "lee-sin"/);
  assert.match(engine, /if \(aLeeSinKnockback && !bLeeSinKnockback\) \{[\s\S]*b\.x \+= nx \* overlap/);
  assert.match(engine, /else if \(bLeeSinKnockback && !aLeeSinKnockback\) \{[\s\S]*a\.x -= nx \* overlap/);
  assert.match(engine, /x: leeSin\?\.x \?\? effect\.x/);
  assert.match(engine, /effect\.x = darius\?\.x \?\? effect\.x/);
  assert.match(engine, /ctx\.translate\(effect\.x, effect\.y\)/);
  assert.match(engine, /LEE_SIN_SKILL_DARK = "#360204"/);
  assert.match(engine, /ctx\.lineTo\(0, -54\)/);
  assert.match(engine, /ctx\.lineTo\(52, 12\)/);
  assert.match(engine, /DARIUS_CAST_DURATION = 1\.5/);
  assert.match(engine, /DARIUS_SLASH_RADIUS = 180/);
  assert.match(engine, /DARIUS_SLASH_KNOCKBACK = 550/);
  assert.match(engine, /DARIUS_SKILL_COOLDOWN = 6/);
  assert.match(engine, /DARIUS_SLASH_STUN_DURATION = 1/);
  assert.match(engine, /queuePostKnockbackStun\(target, DARIUS_SLASH_STUN_DURATION\)/);
  assert.match(engine, /DARIUS_SLASH_HIT_DELAY = 0\.12/);
  assert.match(engine, /function stepDariusSkill/);
  assert.match(engine, /function releaseDariusSlash/);
  assert.match(engine, /function applyDariusSlashImpact/);
  assert.match(engine, /function dariusSlashVisualRadius/);
  assert.match(engine, /const hitRadius = dariusSlashVisualRadius\(effect\.age\)/);
  assert.match(engine, /const radius = dariusSlashVisualRadius\(effect\.age\)/);
  assert.match(engine, /if \(distance > hitRadius\) continue/);
  assert.doesNotMatch(engine, /DARIUS_SLASH_RADIUS \+ target\.radius/);
  assert.match(engine, /hitActorIds: \[\]/);
  assert.match(engine, /effect\.hitActorIds\.includes\(target\.id\)/);
  assert.match(engine, /effect\.hitActorIds\.push\(target\.id\)/);
  assert.match(engine, /if \(darius\) applyDariusSlashImpact\(engine, darius, effect\)/);
  assert.doesNotMatch(engine, /hitApplied/);
  assert.match(engine, /const impactProgress = clamp\(age \/ DARIUS_SLASH_HIT_DELAY/);
  assert.match(engine, /target\.teamId === darius\.teamId/);
  assert.match(engine, /actor\.id === "darius" && engine\.dariusCastTimer > 0/);
  assert.doesNotMatch(engine, /interruptDarius|dariusCastTimer = 0;[\s\S]{0,120}hitFlash/);
  assert.match(engine, /drawDariusSlashEffect/);
  assert.match(engine, /ZED_CAST_DURATION = 1/);
  assert.match(engine, /ZED_SKILL_COOLDOWN = 12/);
  assert.match(engine, /ZED_COORDINATION_NEAR_STAGE_DISTANCE = 58/);
  assert.match(engine, /ZED_COORDINATION_FAR_STAGE_DISTANCE = 72/);
  assert.match(engine, /ZED_COORDINATION_CHARGE_DURATION = 1\.2/);
  assert.match(engine, /function coordinateZedPair/);
  assert.match(engine, /actor\.id === engine\.zedCoordinationTargetId/);
  assert.match(engine, /engine\.zedCoordinationTargetId = target\?\.id \?\? null/);
  assert.match(engine, /const bothReady = stageDistances\.every/);
  assert.match(engine, /const charging = engine\.zedCoordinationChargeTimer > 0/);
  assert.match(engine, /zedCoordinationStageX: number \| null/);
  assert.match(engine, /zedCoordinationStageY: number \| null/);
  assert.match(engine, /zedCoordinationStageAngle: number \| null/);
  assert.match(engine, /const stageX = engine\.zedCoordinationStageX/);
  assert.match(engine, /const stageY = engine\.zedCoordinationStageY/);
  assert.match(engine, /const outwardAngle = engine\.zedCoordinationStageAngle/);
  assert.match(engine, /function clampZedDestinationToArena/);
  assert.match(engine, /const safeStages = zeds\.map/);
  assert.match(engine, /charging && destination\.clamped && destinationDistance <= ZED_COORDINATION_READY_RADIUS/);
  assert.match(engine, /const holdingIds = new Set<string>\(\)/);
  assert.match(engine, /holdingIds\.add\(zed\.id\)/);
  assert.match(engine, /const zedCoordination = coordinateZedPair\(engine, alive, dt\)/);
  assert.match(engine, /zedCoordination\.holdingIds\.has\(actor\.id\)/);
  assert.match(engine, /!zedCoordination\.coordinatedIds\.has\(actor\.id\)/);
  assert.match(engine, /if \(!zedCoordination\.coordinatedIds\.has\(actor\.id\)\) \{\s+steerAiInsideArena/);
  assert.match(engine, /const b = alive\[j\];\s+if \(a\.teamId === b\.teamId\) continue;\s+const dx/);
  assert.doesNotMatch(engine, /zedBodyCollision/);
  assert.match(engine, /const opponents = alive\.filter\(\(entry\) => entry\.teamId !== actor\.teamId\)/);
  assert.match(engine, /function stepZedSkill/);
  assert.match(engine, /function spawnZedClone/);
  assert.match(engine, /id: `zed-shadow-\$\{engine\.zedCloneSequence\}`/);
  assert.match(engine, /livingZeds\.length !== 1/);
  assert.match(engine, /engine\.zedSkillCooldown = Math\.max\(0, engine\.zedSkillCooldown - dt\)/);
  assert.match(engine, /teamId: "zed"/);
  assert.match(engine, /function eliminateActor/);
  assert.match(engine, /hasLivingZedPartner \? "zed-smoke" : "normal"/);
  assert.match(engine, /if \(hasLivingZedPartner\) engine\.zedSkillCooldown = ZED_SKILL_COOLDOWN/);
  assert.match(engine, /function drawZedSmoke/);
  assert.match(engine, /function drawActorDeath/);
  assert.match(engine, /const shake = Math\.sin\(elapsed \* 120\)/);
  assert.match(engine, /const survivingTeams = new Map<string, Actor\[\]>/);
  assert.match(engine, /return championFromActor\(champion\)/);
  assert.match(engine, /const fighterIconCache = new Map<string, HTMLImageElement>/);
  assert.match(engine, /ctx\.drawImage\(icon, -radius, -radius, radius \* 2, radius \* 2\)/);
  assert.doesNotMatch(engine, /roundedRect\(ctx, radius \* 0\.08, -radius \* 0\.42/);
  for (const fighterId of ["zed", "jinx", "darius", "lee-sin", "janna"]) {
    assert.match(arena, new RegExp(`icon: assetPath\\("/icons/${fighterId}/icon\\.webp"\\)`));
    assert.match(arena, new RegExp(`skillIcon: assetPath\\("/icons/${fighterId}/skill\\.png"\\)`));
  }
  assert.match(arena, /color: "#111318"/);
  assert.match(arena, /color: "#00ade9"/);
  assert.match(arena, /color: "#858b94"/);
  assert.match(arena, /color: "#470305"/);
  assert.match(arena, /color: "#f7f9ff"/);
  assert.doesNotMatch(engine, /ArenaRules|ItemKind|ArenaItem|ITEM_STYLE|engine\.items|itemTimer|drawItem|explodeBomb|powerUntil|shieldUntil|hasteUntil|giantUntil|baseRadius|onSound/);
  assert.doesNotMatch(arena, /ArenaRules|ItemKind|DEFAULT_RULES|weight|profileUrl/);
  assert.doesNotMatch(component, /規則模組|參賽者|重置戰場|快捷操作|自動戰鬥|ROUND|ACTIVE/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("documents monorepo routing and Arena product rules", async () => {
  const [rootAgents, arenaAgents, rules] = await Promise.all([
    readFile(new URL("../../AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../RULES.md", import.meta.url), "utf8"),
  ]);

  assert.match(rootAgents, /Identify which game/);
  assert.match(rootAgents, /arena\/RULES\.md/);
  assert.match(arenaAgents, /read(?:ing)? `RULES\.md`/i);
  assert.match(rules, /https:\/\/www\.gachago\.net\/zh-tw\/MegaSmash/);
  assert.match(rules, /https:\/\/op\.gg\/lol\/champions\/zed\/build\/mid/);
  assert.match(rules, /pre-match champion prediction/);
  assert.match(rules, /prize won/);
  assert.match(rules, /fair decimal odds of `5\.00x`/);
  assert.match(rules, /do not draw shrink countdown, energy-ring shrink, minimum-ring, percentage/);
  assert.match(rules, /battle contains no items/);
  assert.match(rules, /Jinx fires a ten-rocket volley/);
  assert.match(rules, /keeps that same fighter locked for the entire volley/);
  assert.match(rules, /firing direction follows that fighter's movement between shots/);
  assert.match(rules, /total 24-degree cone/);
  assert.match(rules, /Jinx cannot move while the volley is being cast/);
  assert.match(rules, /collision hit against Jinx interrupts the cast/);
  assert.match(rules, /Janna stops normal movement and channels for 0\.5 seconds/);
  assert.match(rules, /channel cannot be interrupted/);
  assert.match(rules, /nearby fighters do not prevent the cast/);
  assert.match(rules, /launches one stylized top-down spiral tornado directly from Janna's current position/);
  assert.match(rules, /moves at 100 world pixels per second without turning or stopping/);
  assert.match(rules, /starts a visible fade as soon as its center crosses the screen boundary/);
  assert.match(rules, /resumes normal movement immediately after launching the tornado/);
  assert.match(rules, /very thin, low-opacity white energy line from Janna's current position to her tornado/);
  assert.match(rules, /impulse of 400 world pixels per second/);
  assert.match(rules, /knockback impulse of 250 world pixels per second/);
  assert.match(rules, /total 24-degree cone/);
  assert.match(rules, /flies straight without tracking/);
  assert.match(rules, /RGB `0, 173, 233` blue color family/);
  assert.match(rules, /white color family with pearl-gray shadows/);
  assert.match(rules, /layered pearl-white spiral ribbons/);
  assert.match(rules, /dark-metal under-sweep/);
  assert.match(rules, /skill icon, skill name, and concise description in a compact preview above/);
  assert.match(rules, /without a distance restriction and channel in place for 0\.5 seconds/);
  assert.match(rules, /dashes toward that fighter at 420 world pixels per second/);
  assert.match(rules, /knockback velocity to 600 world pixels per second/);
  assert.match(rules, /angular impact burst/);
  assert.match(rules, /keeps its exact flight direction and is never displaced or redirected/);
  assert.match(rules, /RGB `71, 3, 5` dark-red color family/);
  assert.match(rules, /burst stays centered on Lee Sin and follows his position/);
  assert.match(rules, /passes the same 600-world-pixel-per-second knockback direction/);
  assert.match(rules, /no recoil or self-knockback from his dash impact/);
  assert.match(rules, /no recoil or self-knockback/);
  assert.match(rules, /Darius can keep moving while channeling his skill for 1\.5 seconds/);
  assert.match(rules, /cannot be interrupted by collision, knockback, or stun/);
  assert.match(rules, /waits 7 seconds after a completed or interrupted volley/);
  assert.match(rules, /180-world-pixel radius/);
  assert.match(rules, /impulse of 550 world pixels per second/);
  assert.match(rules, /expands to its 180-world-pixel hit radius over 0\.12 seconds/);
  assert.match(rules, /collision is evaluated against the slash's current rendered position and current rendered radius/);
  assert.match(rules, /remains centered on Darius and follows him while visible/);
  assert.match(rules, /exactly one living Zed/);
  assert.match(rules, /Zed is eliminated only after every living Zed/);
  assert.match(rules, /shared 12-second skill cooldown does not count down while both Zeds are alive/);
  assert.match(rules, /do not physically collide, push, damage, or knock each other back/);
  assert.match(rules, /neither Zed deliberately targets or chases the other/);
  assert.match(rules, /keep one shared opponent target instead of roaming independently/);
  assert.match(rules, /staging positions remain fixed until the charge starts/);
  assert.match(rules, /Coordination destinations are clamped inside the safe arena edge/);
  assert.match(rules, /without rapid movement reversals or stop-start jitter/);
  assert.match(rules, /second collision follow the first before the target can recover/);
  assert.match(rules, /holds still instead of overshooting/);
  assert.match(rules, /starts only when the first Zed body dies/);
  assert.match(rules, /rapidly shakes first and then fades out/);
  assert.match(rules, /black-fog fade-in/);
  assert.match(rules, /fixed `1179 x 1977` portrait design surface/);
  assert.match(rules, /scale it uniformly to the largest size that fits/);
  assert.match(rules, /fighter skill, not an item/);
  assert.match(rules, /without flipping the direction they are facing/);
  assert.match(rules, /provided `\/icons\/<fighter>\/icon\.webp` portraits/);
  assert.match(rules, /separate skill-info button/);
  assert.match(rules, /plain circles without an extra head, facing, or direction marker/);
  assert.match(rules, /visible description omits numerical gameplay values/);
  assert.match(rules, /matching accessible skill-information dialog/);
  assert.match(rules, /Render `\/arena-map-v1\.png` as the battlefield background/);
  assert.match(rules, /background artwork contains no fixed glowing boundary and no purple portal circles/);
  assert.match(rules, /charcoal, rust-red, aged-bronze, warm-gold/);
  assert.match(rules, /thin cyan rune ring with a dark contrast under-stroke/);
  assert.match(rules, /Zed uses black and graphite smoke/);
  assert.match(rules, /Avoid large neutral-white additive blooms/);
});

test("includes project-specific social and icon artwork", async () => {
  const fighterArtwork = ["zed", "jinx", "darius", "lee-sin", "janna"].flatMap((fighterId) => [
    access(new URL(`../public/icons/${fighterId}/icon.webp`, import.meta.url)),
    access(new URL(`../public/icons/${fighterId}/skill.png`, import.meta.url)),
  ]);
  await Promise.all([
    access(new URL("../public/og-v2.png", import.meta.url)),
    access(new URL("../public/favicon.png", import.meta.url)),
    access(new URL("../public/arena-map-v1.png", import.meta.url)),
    ...fighterArtwork,
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
