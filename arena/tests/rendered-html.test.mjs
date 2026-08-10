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
  assert.match(html, /CHAMPION PICK/);
  assert.match(html, /選擇冠軍/);
  assert.match(html, /開始亂鬥/);
  for (const fighter of ["Zed", "Jinx", "Darius", "Lee Sin", "Janna"]) {
    assert.match(html, new RegExp(fighter));
  }
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships selection, automated resolution, and prize settlement without removed controls", async () => {
  const [component, arena, engine, packageJson] = await Promise.all([
    readFile(new URL("../app/components/ArenaGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/arena.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(component, /selectedId/);
  assert.match(component, /WIN_PRIZE = 500/);
  assert.match(component, /setSettlement/);
  assert.match(component, /disabled={!selectedFighter/);
  assert.match(component, /獲得模擬獎金/);
  assert.match(component, /再玩一場/);
  for (const fighter of ["Zed", "Jinx", "Darius", "Lee Sin", "Janna"]) {
    assert.match(arena, new RegExp(`name: "${fighter}"`));
  }

  assert.match(engine, /stepEngine/);
  assert.match(engine, /arenaRadius/);
  assert.match(engine, /MIN_RADIUS = 120/);
  assert.match(engine, /SHRINK_DELAY = 0/);
  assert.match(engine, /SHRINK_SPEED = 5\.5/);
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
});

test("includes project-specific social and icon artwork", async () => {
  await Promise.all([
    access(new URL("../public/og-v2.png", import.meta.url)),
    access(new URL("../public/favicon.png", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
