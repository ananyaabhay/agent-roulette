// The engine must be domain-free. This drives it with a ruleset that has no
// connection to VALORANT — different categories, different group size,
// different items — using only the public API and no changes in logic/.
import test from "node:test";
import assert from "node:assert/strict";

import { solveDraft, validateDraft } from "../logic/solver.js";

const CLASSES = [
  { id: "cleric", name: "Cleric", archetype: "Healer" },
  { id: "druid", name: "Druid", archetype: "Healer" },
  { id: "fighter", name: "Fighter", archetype: "Tank" },
  { id: "paladin", name: "Paladin", archetype: "Tank" },
  { id: "rogue", name: "Rogue", archetype: "Damage" },
  { id: "ranger", name: "Ranger", archetype: "Damage" },
  { id: "wizard", name: "Wizard", archetype: "Damage" },
  { id: "bard", name: "Bard", archetype: "Support" },
];

const PARTY_RULESET = {
  categories: ["Healer", "Tank", "Damage", "Support"],
  categoryOf: (item) => item.archetype,
  minimumsBySize: {
    2: { Healer: 1 },
    3: { Healer: 1, Tank: 1 },
    4: { Healer: 1, Tank: 1, Damage: 1 },
  },
  maximumsBySize: { 4: { Damage: 2, Healer: 1 } },
  maxGroupSize: 4,
};

const party = (...pools) =>
  pools.map((pool, index) => ({
    id: `member${index + 1}`,
    name: `Member ${index + 1}`,
    ownedAgentIds: new Set(pool),
  }));

const everything = CLASSES.map((entry) => entry.id);

test("the solver runs a ruleset with no VALORANT concepts in it", () => {
  const players = party(everything, everything, everything, everything);
  for (let trial = 0; trial < 300; trial += 1) {
    const assignment = solveDraft({
      players,
      agents: CLASSES,
      ruleset: PARTY_RULESET,
    });
    assert.ok(assignment, "expected a legal party");
    assert.ok(
      validateDraft({
        assignment,
        players,
        agents: CLASSES,
        ruleset: PARTY_RULESET,
      }),
    );
    const archetypes = assignment.map((entry) => entry.archetype);
    assert.equal(archetypes.filter((a) => a === "Healer").length, 1);
    assert.ok(archetypes.includes("Tank"));
    assert.ok(archetypes.filter((a) => a === "Damage").length <= 2);
  }
});

test("eligibility and distinctness hold under a foreign ruleset", () => {
  const players = party(
    ["cleric", "druid"],
    ["fighter"],
    ["rogue", "wizard"],
    ["bard", "ranger"],
  );
  const assignment = solveDraft({
    players,
    agents: CLASSES,
    ruleset: PARTY_RULESET,
  });
  assert.ok(assignment);
  assert.equal(new Set(assignment.map((e) => e.id)).size, 4);
  assignment.forEach((entry, index) => {
    assert.ok(players[index].ownedAgentIds.has(entry.id));
  });
});

test("an unsatisfiable foreign ruleset fails closed rather than cheating", () => {
  // Nobody can be the Healer this ruleset requires.
  const players = party(["fighter"], ["rogue"], ["wizard"]);
  assert.equal(
    solveDraft({ players, agents: CLASSES, ruleset: PARTY_RULESET }),
    null,
  );
});

test("chaos mode drops category quotas in any domain", () => {
  const players = party(["fighter"], ["rogue"], ["wizard"]);
  assert.ok(
    solveDraft({
      players,
      agents: CLASSES,
      mode: "chaos",
      ruleset: PARTY_RULESET,
    }),
  );
});
