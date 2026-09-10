// Drift detection and the map-evidence presentation rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { AGENTS } from "../data/game-data.js";
import { MAP_META } from "../data/map-meta.js";
import {
  analyzeDataHealth,
  decideIssueAction,
  extractPatch,
} from "../scripts/check-game-data.js";
import {
  MAP_EVIDENCE_CAVEAT,
  buildLineupNotes,
  describeMapEvidence,
  observedAgentNames,
} from "../logic/recommendations.js";

const currentAgents = AGENTS.map((agent) => ({ displayName: agent.name }));
const healthyCheck = (overrides = {}) =>
  analyzeDataHealth({
    upstreamPatch: "13.04",
    upstreamAgents: currentAgents,
    now: "2026-09-08T12:00:00Z",
    mapMeta: {},
    snapshotVersion: "13.04-2026-08-31",
    snapshotUpdatedAt: "2026-08-31",
    ...overrides,
  });

test("patch numbers are read out of whatever shape upstream sends", () => {
  assert.equal(extractPatch("release-13.04"), "13.04");
  assert.equal(extractPatch("13.04-2026-08-31"), "13.04");
  assert.equal(extractPatch("release-14.00-shipping-15-3456789"), "14.00");
  assert.equal(extractPatch(""), null);
  assert.equal(extractPatch(undefined), null);
});

test("a matching roster, patch, and fresh snapshot report healthy", () => {
  const health = healthyCheck();
  assert.equal(health.level, "healthy");
  assert.equal(health.needsAttention, false);
  assert.match(health.report, /Live VALORANT patch: 13\.04/);
  assert.match(health.report, /✓ 8 days old/);
});

test("patch drift is a review signal, including map-rotation review", () => {
  const health = healthyCheck({ upstreamPatch: "14.00" });
  assert.equal(health.level, "review");
  assert.match(health.report, /Live VALORANT patch: 14\.00/);
  assert.match(health.report, /Map Smart snapshot patch: 13\.04/);
  assert.match(health.report, /Meta snapshot is behind the live game patch/);
  assert.match(
    health.report,
    /Competitive map rotation[\s\S]*Review recommended after patch change/,
  );
});

test("a 14-day-old snapshot is a review signal", () => {
  const health = healthyCheck({ now: "2026-09-14T00:00:00Z" });
  assert.equal(health.snapshotAgeDays, 14);
  assert.equal(health.snapshotStale, true);
  assert.match(health.report, /⚠ 14 days old — review recommended/);
});

test("an unknown playable agent is an action-needed finding", () => {
  const health = healthyCheck({
    upstreamAgents: [...currentAgents, { displayName: "Someone New" }],
  });
  assert.equal(health.level, "action");
  assert.match(health.report, /🔴 New playable agent detected: Someone New/);
  assert.match(health.report, /Update local game data and agent art/);
});

test("irrelevant upstream maps cannot create missing-map warnings", () => {
  const health = healthyCheck({
    upstreamMaps: [
      { displayName: "Bind" },
      { displayName: "Fracture" },
      { displayName: "Range" },
    ],
  });
  assert.equal(health.level, "healthy");
  assert.doesNotMatch(health.report, /Bind|Fracture|Range|Missing maps/i);
});

test("agents whose names differ only by punctuation are not false positives", () => {
  // KAY/O is the one that breaks naive matching.
  const health = healthyCheck({
    upstreamAgents: currentAgents.map((agent) =>
      agent.displayName === "KAY/O" ? { displayName: "KAY / O" } : agent,
    ),
  });
  assert.deepEqual(health.missingAgents, []);
});

test("current low-confidence maps are reported without recalculation", () => {
  const health = healthyCheck({ mapMeta: MAP_META });
  assert.deepEqual(health.lowConfidenceMaps, ["Abyss"]);
  assert.match(health.report, /Low-confidence maps[\s\S]*⚠ Abyss/);
});

test("unchanged findings do not create duplicate issue comments", () => {
  const first = healthyCheck({ upstreamPatch: "14.00" });
  const nextWeek = healthyCheck({
    upstreamPatch: "14.00",
    now: "2026-09-10T12:00:00Z",
  });
  assert.equal(first.signature, nextWeek.signature);
  assert.equal(
    decideIssueAction({
      currentSignature: nextWeek.signature,
      issueState: "open",
      needsAttention: true,
      previousSignature: first.signature,
    }),
    "none",
  );
});

test("a previously unhealthy issue closes when all checks become healthy", () => {
  const health = healthyCheck();
  assert.equal(
    decideIssueAction({
      currentSignature: health.signature,
      issueState: "open",
      needsAttention: health.needsAttention,
      previousSignature: "older-status",
    }),
    "close",
  );
});

test("workflow stays weekly on Wednesday and keeps manual dispatch", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/game-data-drift.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /cron: "0 6 \* \* 3"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /valorant-api\.com\/v1\/maps/);
});

test("observed agents come back as ordered names with no numbers", () => {
  for (const mapId of Object.keys(MAP_META)) {
    const names = observedAgentNames(mapId);
    assert.ok(names.length > 0, `${mapId} returned nothing`);
    names.forEach((name) => {
      assert.equal(typeof name, "string");
      assert.doesNotMatch(name, /\d/, `${mapId} leaked a number: ${name}`);
      assert.doesNotMatch(name, /%/, `${mapId} leaked a percentage: ${name}`);
    });
  }
});

test("every map states its sample size in plain language", () => {
  for (const [mapId, meta] of Object.entries(MAP_META)) {
    const text = describeMapEvidence(mapId);
    assert.match(text, new RegExp(String(meta.sampleSize)));
    assert.match(text, /pro matches/);
    assert.doesNotMatch(text, /%/);
  }
  assert.match(describeMapEvidence("abyss"), /Only 26 pro matches/);
  assert.match(describeMapEvidence("abyss"), /may shift quickly/);
  assert.match(describeMapEvidence("summit"), /useful.*directional/);
  assert.match(describeMapEvidence("lotus"), /stronger evidence base/);
  assert.doesNotMatch(describeMapEvidence("lotus"), /only|shift quickly/i);
});

test("remembered maps produce zero map-result commentary outside Map Smart", () => {
  const lineup = [AGENTS.find((agent) => agent.id === "gekko")];
  const teamNeeds = [{ role: "Initiator", state: "needed", requiredFromStack: 1 }];
  const balanced = buildLineupNotes({
    structureId: "balanced",
    mode: "balanced",
    mapId: "haven",
    draft: lineup,
    mapStrength: 0,
    teamNeeds,
  });
  const chaos = buildLineupNotes({
    structureId: "chaos",
    mode: "chaos",
    mapId: "haven",
    draft: lineup,
    mapStrength: 0,
    teamNeeds,
  });
  assert.match(balanced.join(" "), /Filled team need: Gekko supplied the Initiator/);
  assert.doesNotMatch(balanced.join(" "), /Haven|map|snapshot|weight/i);
  assert.match(chaos.join(" "), /not enforced in Total Chaos/);
  assert.doesNotMatch(chaos.join(" "), /Haven|map|snapshot|weight/i);
});

test("Map Smart Notes classify map-favoured, constraint-led, and wildcard outcomes", () => {
  const lineup = ["omen", "gekko", "chamber"].map((id) =>
    AGENTS.find((agent) => agent.id === id),
  );
  const reasons = buildLineupNotes({
    structureId: "map",
    mode: "balanced",
    mapId: "haven",
    draft: lineup,
    mapStrength: 4,
    teamNeeds: [{ role: "Initiator", state: "needed", requiredFromStack: 1 }],
  });
  const text = reasons.join(" ");
  assert.match(text, /Map-favoured: Omen/);
  assert.match(text, /Role \/ constraint-led: Gekko/);
  assert.match(text, /Wildcard roll: Chamber/);
  assert.match(text, /changes probability rather than forcing meta agents/);
  assert.doesNotMatch(text, /recommended|optimal|best possible|wrong pick|not mentioned/i);
  assert.doesNotMatch(text, /recorded professional matches/);
});

test("the panel discloses that the source is pro play, not the ladder", () => {
  assert.match(MAP_EVIDENCE_CAVEAT, /Pro play/);
  assert.match(MAP_EVIDENCE_CAVEAT, /normal ranked games/);
  assert.match(MAP_EVIDENCE_CAVEAT, /signal rather than a tier list/);
  for (const mapId of Object.keys(MAP_META)) {
    assert.match(describeMapEvidence(mapId), /pro matches/);
  }
});
