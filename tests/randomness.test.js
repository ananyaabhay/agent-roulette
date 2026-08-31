import test from "node:test";
import assert from "node:assert/strict";

import { AGENTS, ROLES, STARTER_AGENT_IDS } from "../data/game-data.js";
import { solveDraft } from "../logic/solver.js";

const TRIALS_PER_SCENARIO = 10000;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlayers(count, ownedAgentIds) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    ownedAgentIds: new Set(ownedAgentIds),
  }));
}

function measureScenario(name, { players, mode, seed, expectedSymmetry }) {
  const random = seededRandom(seed);
  const agentFrequencies = new Map(AGENTS.map((agent) => [agent.id, 0]));
  const roleFrequencies = new Map(ROLES.map((role) => [role, 0]));

  for (let trial = 0; trial < TRIALS_PER_SCENARIO; trial += 1) {
    const draft = solveDraft({
      players,
      takenAgentIds: new Set(),
      mode,
      agents: AGENTS,
      random,
    });
    assert.ok(draft, `${name} trial ${trial} should be solvable`);
    draft.forEach((agent) => {
      agentFrequencies.set(agent.id, agentFrequencies.get(agent.id) + 1);
      roleFrequencies.set(agent.role, roleFrequencies.get(agent.role) + 1);
    });
  }

  let largestWithinRoleDeviation = 0;
  const roleDeviations = {};
  for (const role of ROLES) {
    const roleAgentIds = AGENTS
      .filter(
        (agent) =>
          agent.role === role &&
          players.some((player) => player.ownedAgentIds.has(agent.id)),
      )
      .map((agent) => agent.id);
    const roleTotal = roleAgentIds.reduce(
      (total, agentId) => total + agentFrequencies.get(agentId),
      0,
    );
    if (!roleTotal || !roleAgentIds.length) continue;
    const expectedPerAgent = roleTotal / roleAgentIds.length;
    const deviation = Math.max(
      ...roleAgentIds.map(
        (agentId) =>
          Math.abs(agentFrequencies.get(agentId) - expectedPerAgent) /
          expectedPerAgent,
      ),
    );
    roleDeviations[role] = Number((deviation * 100).toFixed(2));
    largestWithinRoleDeviation = Math.max(largestWithinRoleDeviation, deviation);
  }

  const result = {
    name,
    trials: TRIALS_PER_SCENARIO,
    assignments: TRIALS_PER_SCENARIO * players.length,
    expectedSymmetry,
    roleFrequencies: Object.fromEntries(roleFrequencies),
    largestWithinRoleAgentDeviationPercent: Number(
      (largestWithinRoleDeviation * 100).toFixed(2),
    ),
    roleDeviationPercent: roleDeviations,
  };
  console.log(`Fairness: ${JSON.stringify(result)}`);
  return { ...result, agentFrequencies, largestWithinRoleDeviation };
}

test("50,000 seeded fairness simulations show no heavy within-role agent-order bias", () => {
  const allIds = AGENTS.map((agent) => agent.id);
  const scenarios = [
    measureScenario("solo-all-chaos", {
      players: makePlayers(1, allIds),
      mode: "chaos",
      seed: 0x101,
      expectedSymmetry: "all agents proportional to roster membership",
    }),
    measureScenario("trio-equivalent-pools-chaos", {
      players: makePlayers(3, allIds),
      mode: "chaos",
      seed: 0x202,
      expectedSymmetry: "equivalent players and agents within each role",
    }),
    measureScenario("five-complete-pools-balanced", {
      players: makePlayers(5, allIds),
      mode: "balanced",
      seed: 0x303,
      expectedSymmetry: "agents within the same role; roles follow constraints",
    }),
    measureScenario("five-starter-only-balanced", {
      players: makePlayers(5, STARTER_AGENT_IDS),
      mode: "balanced",
      seed: 0x404,
      expectedSymmetry: "all five starters appear once per draft",
    }),
    measureScenario("duo-complete-pools-balanced", {
      players: makePlayers(2, allIds),
      mode: "balanced",
      seed: 0x505,
      expectedSymmetry: "agents within a role; Controller is intentionally required",
    }),
  ];

  scenarios.forEach((scenario) => {
    assert.ok(
      scenario.largestWithinRoleDeviation < 0.25,
      `${scenario.name} has unexplained within-role deviation above 25%`,
    );
  });

  const starterScenario = scenarios[3];
  STARTER_AGENT_IDS.forEach((agentId) => {
    assert.equal(starterScenario.agentFrequencies.get(agentId), TRIALS_PER_SCENARIO);
  });
});
