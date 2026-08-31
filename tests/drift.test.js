// Drift detection and the map-evidence presentation rules.
import test from "node:test";
import assert from "node:assert/strict";

import { AGENTS } from "../data/game-data.js";
import { MAPS } from "../data/maps.js";
import { MAP_META } from "../data/map-meta.js";
import { extractPatch, findDrift } from "../scripts/check-game-data.js";
import {
  MAP_EVIDENCE_CAVEAT,
  describeMapEvidence,
  explainMapDraft,
  observedAgentNames,
} from "../logic/recommendations.js";

const currentAgents = AGENTS.map((agent) => ({ displayName: agent.name }));
const currentMaps = MAPS.map((map) => ({ displayName: map.name }));

test("patch numbers are read out of whatever shape upstream sends", () => {
  assert.equal(extractPatch("release-13.04"), "13.04");
  assert.equal(extractPatch("13.04-2026-08-31"), "13.04");
  assert.equal(extractPatch("release-14.00-shipping-15-3456789"), "14.00");
  assert.equal(extractPatch(""), null);
  assert.equal(extractPatch(undefined), null);
});

test("a matching game reports no drift", () => {
  const findings = findDrift({
    upstreamPatch: "13.04",
    upstreamAgents: currentAgents,
    upstreamMaps: currentMaps,
  });
  assert.deepEqual(findings, []);
});

test("a new patch is reported", () => {
  const findings = findDrift({
    upstreamPatch: "14.00",
    upstreamAgents: currentAgents,
    upstreamMaps: currentMaps,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /live game is on 14\.00/);
});

test("an agent we don't know about is reported by name", () => {
  const findings = findDrift({
    upstreamPatch: "13.04",
    upstreamAgents: [...currentAgents, { displayName: "Someone New" }],
    upstreamMaps: currentMaps,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /Someone New/);
  assert.match(findings[0], /fetch:art/);
});

test("a new map is reported", () => {
  const findings = findDrift({
    upstreamPatch: "13.04",
    upstreamAgents: currentAgents,
    upstreamMaps: [...currentMaps, { displayName: "Somewhere New" }],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /Somewhere New/);
});

test("agents whose names differ only by punctuation are not false positives", () => {
  // KAY/O is the one that breaks naive matching.
  const findings = findDrift({
    upstreamPatch: "13.04",
    upstreamAgents: currentAgents.map((agent) =>
      agent.displayName === "KAY/O" ? { displayName: "KAY / O" } : agent,
    ),
    upstreamMaps: currentMaps,
  });
  assert.deepEqual(findings, []);
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
    assert.match(text, /recorded professional matches/);
    assert.doesNotMatch(text, /%/);
  }
  assert.match(describeMapEvidence("abyss"), /too few to be reliable/);
  assert.match(describeMapEvidence("lotus"), /show a real pattern/);
});

test("at zero map strength the panel says the draft ignored the map", () => {
  const draft = [AGENTS.find((agent) => agent.id === "sova")];
  const reasons = explainMapDraft({ mapId: "abyss", draft, mapStrength: 0 });
  assert.match(reasons[0], /ignored this map entirely/);
  assert.ok(reasons.every((line) => !/\d+(\.\d+)?%/.test(line)));
  // The evidence line belongs to the Map Intel panel; repeating it here showed
  // the same sentence twice on one screen.
  assert.ok(reasons.every((line) => !/recorded professional matches/.test(line)));
});

test("at full strength the panel describes observation, not recommendation", () => {
  const draft = [AGENTS.find((agent) => agent.id === "sova")];
  const reasons = explainMapDraft({ mapId: "abyss", draft, mapStrength: 4 });
  assert.match(reasons[0], /seen most often/);
  assert.doesNotMatch(reasons.join(" "), /signal/i);
  assert.ok(reasons.every((line) => !/recorded professional matches/.test(line)));
});

test("the panel discloses that the source is pro play, not the ladder", () => {
  assert.match(MAP_EVIDENCE_CAVEAT, /professional play/);
  assert.match(MAP_EVIDENCE_CAVEAT, /ranked ladder/);
  for (const mapId of Object.keys(MAP_META)) {
    assert.match(describeMapEvidence(mapId), /professional matches/);
  }
});
