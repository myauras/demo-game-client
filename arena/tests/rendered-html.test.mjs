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

test("server-renders the Arena game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Arena — 自動亂鬥模擬器<\/title>/i);
  assert.match(html, /AUTONOMOUS COMBAT LAB/);
  assert.match(html, /即時排名/);
  assert.match(html, /開戰/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships the original battle engine and device-local customization", async () => {
  const [component, engine, packageJson] = await Promise.all([
    readFile(new URL("../app/components/ArenaGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(component, /localStorage/);
  assert.match(component, /requestFullscreen/);
  assert.match(component, /RULE_COPY/);
  assert.match(engine, /stepEngine/);
  assert.match(engine, /damage/);
  assert.match(engine, /arenaRadius/);
  assert.match(engine, /MIN_RADIUS = 120/);
  assert.match(engine, /SHRINK_DELAY = 0/);
  assert.match(engine, /SHRINK_SPEED = 5\.5/);
  assert.match(engine, /MOVE_ACCEL = 210/);
  assert.match(engine, /MAX_MOVE_SPEED = 350/);
  assert.match(engine, /DASH_MIN = 165/);
  assert.match(engine, /DASH_VARIANCE = 135/);
  assert.match(engine, /KNOCKBACK_BASE = 110/);
  assert.match(engine, /KNOCKBACK_DAMAGE = 2\.6/);
  assert.match(engine, /engine\.elapsed - SHRINK_DELAY/);
  assert.match(engine, /BASE_RADIUS - shrinkElapsed \* SHRINK_SPEED/);
  assert.doesNotMatch(engine, /engine\.elapsed > 18/);
  assert.doesNotMatch(`${component}\n${engine}`, /gachago|MegaSmash/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("includes project-specific social and icon artwork", async () => {
  await Promise.all([
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../public/favicon.png", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
