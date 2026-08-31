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
import { createMapCandidateWeight } from "../logic/recommendations.js";
import { solveDraft } from "../logic/solver.js";
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

/** Appearance rate and roster spread at a given map strength. */
function sample({ mapStrength, trials = 1200 }) {
  const players = stack();
  const candidateWeight = createMapCandidateWeight({
    mapId: "ascent",
    strength: mapStrength,
  });
  const appearances = new Map(AGENTS.map((agent) => [agent.id, 0]));
  let solved = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const draft = solveDraft({ players, mode: "balanced", candidateWeight });
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
  assert.equal(createMapCandidateWeight({ mapId: "ascent", strength: 0 }), null);
});

test("Map Smart visibly favours the map's leading agents", () => {
  // The V1.4 setting moved Omen from 17% to 24%, which read as inert.
  const baseline = sample({ mapStrength: 0 });
  const shipped = sample({ mapStrength: MAP_STRENGTH });
  assert.ok(
    shipped.rate("omen") > baseline.rate("omen") + 0.2,
    `expected a visible shift, got ${baseline.rate("omen").toFixed(2)} -> ${shipped.rate("omen").toFixed(2)}`,
  );
});

test("Map Smart still behaves like a roulette rather than one fixed comp", () => {
  const shipped = sample({ mapStrength: MAP_STRENGTH });
  assert.ok(
    shipped.inPlay >= 20,
    `Map Smart left only ${shipped.inPlay} agents in play`,
  );
});

test("weights order candidates but never make an unowned agent legal", () => {
  const players = [
    { id: "p1", name: "p1", ownedAgentIds: new Set(["brimstone", "sage"]) },
    { id: "p2", name: "p2", ownedAgentIds: new Set(["sova", "jett"]) },
  ];
  const candidateWeight = createMapCandidateWeight({
    mapId: "ascent",
    strength: MAP_STRENGTH,
  });
  for (let trial = 0; trial < 200; trial += 1) {
    const draft = solveDraft({ players, mode: "balanced", candidateWeight });
    assert.ok(draft);
    draft.forEach((agent, index) => {
      assert.ok(players[index].ownedAgentIds.has(agent.id));
    });
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
  const options = { agents: AGENTS, validMapIds: ["ascent"] };
  const migrated = (preferredMode) =>
    normalizeSavedPreferences({ preferredMode }, options).preferredStructure;
  assert.equal(migrated("chaos"), 0);
  assert.equal(migrated("balanced"), 1);
  assert.equal(migrated("map"), 2);
});
