// The three-stop structure control and the fixed map-influence strength.
import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS,
  MAP_STRENGTH,
  STRUCTURE_MAX,
  STRUCTURE_STOPS,
  resolveStructure,
} from "../data/game-data.js";
import {
  createMapCandidateWeight,
  getMapConfidenceInfluence,
} from "../logic/recommendations.js";
import { MAP_CONFIDENCE_INFLUENCE } from "../logic/recommendations.js";
import { MAP_META } from "../data/map-meta.js";
import { solveDraft, validateDraft } from "../logic/solver.js";
import {
  normalizeSavedPreferences,
  serializePreferences,
} from "../logic/storage.js";

const allAgentIds = AGENTS.map((agent) => agent.id);
const stack = (count = 5) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `p${index + 1}`,
    ownedAgentIds: new Set(allAgentIds),
  }));

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/** Appearance rate and roster spread at a given map strength. */
function sample({ mapStrength, mapId = "lotus", trials = 1200 }) {
  const players = stack();
  const candidateWeight = createMapCandidateWeight({
    mapId,
    strength: mapStrength,
  });
  const random = seededRandom(0x51a7);
  const appearances = new Map(AGENTS.map((agent) => [agent.id, 0]));
  let solved = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const draft = solveDraft({ players, mode: "balanced", candidateWeight, random });
    if (!draft) continue;
    solved += 1;
    draft.forEach((agent) =>
      appearances.set(agent.id, appearances.get(agent.id) + 1),
    );
  }
  return {
    rate: (agentId) => appearances.get(agentId) / solved,
    inPlay: [...appearances.values()].filter((count) => count / solved >= 0.1)
      .length,
  };
}

test("the control has exactly three stops and no positions between them", () => {
  assert.equal(STRUCTURE_STOPS.length, 3);
  assert.equal(STRUCTURE_MAX, 2);
  assert.deepEqual(
    STRUCTURE_STOPS.map((stop) => stop.id),
    ["chaos", "balanced", "map"],
  );
  assert.deepEqual(
    STRUCTURE_STOPS.map((stop) => stop.position),
    [0, 1, 2],
  );
});

test("only Total Chaos drops role targets, and only Map Smart weights", () => {
  assert.equal(resolveStructure(0).mode, "chaos");
  assert.equal(resolveStructure(1).mode, "balanced");
  assert.equal(resolveStructure(2).mode, "balanced");
  assert.equal(resolveStructure(0).mapStrength, 0);
  assert.equal(resolveStructure(1).mapStrength, 0);
  assert.equal(resolveStructure(2).mapStrength, MAP_STRENGTH);
});

test("out-of-range and junk positions resolve to a real stop", () => {
  assert.equal(resolveStructure(-40).id, "chaos");
  assert.equal(resolveStructure(9999).id, "map");
  assert.equal(resolveStructure("nonsense").id, "balanced");
  assert.equal(resolveStructure(undefined).id, "balanced");
  assert.equal(resolveStructure(1.4).id, "balanced");
});

test("strength 0 produces no weighting at all", () => {
  assert.equal(createMapCandidateWeight({ mapId: "lotus", strength: 0 }), null);
});

test("confidence transparently dampens configured influence toward neutral", () => {
  // Assert the bands, not which map currently sits in which — the snapshot is
  // meant to be replaced, and naming maps here breaks on every refresh.
  assert.equal(MAP_CONFIDENCE_INFLUENCE.high, 1);
  assert.equal(MAP_CONFIDENCE_INFLUENCE.medium, 0.75);
  assert.equal(MAP_CONFIDENCE_INFLUENCE.low, 0.45);
  // A table with no published sample size can never outrank a counted one.
  assert.ok(MAP_CONFIDENCE_INFLUENCE.unstated <= MAP_CONFIDENCE_INFLUENCE.low);
  for (const [mapId, meta] of Object.entries(MAP_META)) {
    assert.equal(
      getMapConfidenceInfluence(mapId),
      MAP_CONFIDENCE_INFLUENCE[meta.confidence] ?? 0,
      `${mapId} influence does not follow its confidence band`,
    );
  }
  // Sova carries a weight on both Haven (high confidence) and Abyss (low), so
  // the same agent shows the dampening without changing maps mid-comparison.
  // Dampening must move a weight toward neutral, never above its raw value.
  const [mapId, meta] = Object.entries(MAP_META).find(
    ([, value]) => Object.keys(value.agentWeights).length > 0,
  );
  const [leaderId, rawWeight] = Object.entries(meta.agentWeights).sort(
    (left, right) => right[1] - left[1],
  )[0];
  const leader = AGENTS.find((agent) => agent.id === leaderId);
  const weighted = createMapCandidateWeight({ mapId, strength: 4 })(leader);
  const undampened = rawWeight ** 4;
  assert.ok(weighted > 1, "dampening flattened the weight entirely");
  assert.ok(weighted <= undampened, "dampening raised the weight");
});

test("Map Smart visibly favours the map's leading agents", () => {
  // Whichever agent the table ranks highest — naming one in the test would
  // break every time the snapshot is refreshed, which is the point of the
  // snapshot being refreshable.
  const leader = Object.entries(MAP_META.haven.agentWeights).sort(
    (left, right) => right[1] - left[1],
  )[0][0];
  // The V1.4 setting moved the leader from 17% to 24%, which read as inert.
  const baseline = sample({ mapStrength: 0, mapId: "haven" });
  const shipped = sample({ mapStrength: MAP_STRENGTH, mapId: "haven" });
  assert.ok(
    shipped.rate(leader) > baseline.rate(leader) + 0.2,
    `expected a visible shift for ${leader}, got ${baseline.rate(leader).toFixed(2)} -> ${shipped.rate(leader).toFixed(2)}`,
  );
});

test("high- and low-confidence Map Smart both preserve roulette variety", () => {
  const shipped = sample({ mapStrength: MAP_STRENGTH, mapId: "haven" });
  const dampened = sample({ mapStrength: MAP_STRENGTH, mapId: "abyss" });
  assert.ok(
    shipped.inPlay >= 20,
    `Map Smart left only ${shipped.inPlay} agents in play`,
  );
  assert.ok(
    dampened.inPlay >= 20,
    `Low-confidence Map Smart left only ${dampened.inPlay} agents in play`,
  );
});

test("weights order candidates but never make an unowned agent legal", () => {
  const players = [
    { id: "p1", name: "p1", ownedAgentIds: new Set(["brimstone", "sage"]) },
    { id: "p2", name: "p2", ownedAgentIds: new Set(["sova", "jett"]) },
  ];
  const candidateWeight = createMapCandidateWeight({
    mapId: "lotus",
    strength: MAP_STRENGTH,
  });
  for (let trial = 0; trial < 200; trial += 1) {
    const draft = solveDraft({ players, mode: "balanced", candidateWeight });
    assert.ok(draft);
    assert.equal(new Set(draft.map((agent) => agent.id)).size, draft.length);
    draft.forEach((agent, index) => {
      assert.ok(players[index].ownedAgentIds.has(agent.id));
    });
    assert.ok(validateDraft({ assignment: draft, players, mode: "balanced" }));
  }
});

test("storage's mirrored STRUCTURE_MAX cannot drift from game data", () => {
  const stored = serializePreferences({
    preferredMode: "balanced",
    preferredStructure: 10 ** 6,
    selectedMapId: "",
    savedPlayers: [],
  });
  assert.equal(stored.preferredStructure, STRUCTURE_MAX);
});

test("saves made before the slider migrate onto the matching stop", () => {
  const options = { agents: AGENTS, validMapIds: ["lotus"] };
  const migrated = (preferredMode) =>
    normalizeSavedPreferences({ preferredMode }, options).preferredStructure;
  assert.equal(migrated("chaos"), 0);
  assert.equal(migrated("balanced"), 1);
  assert.equal(migrated("map"), 2);
});
