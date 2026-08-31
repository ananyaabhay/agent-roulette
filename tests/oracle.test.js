import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS,
  MAX_TEAM_SIZE,
  ROLE_MAXIMUMS_BY_TEAM_SIZE,
  ROLE_MINIMUMS_BY_TEAM_SIZE,
  ROLES,
} from "../data/game-data.js";
import { solveDraft } from "../logic/solver.js";

const ORACLE_CASES = 1000;

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

function referenceHasSolution({ players, takenAgentIds, mode, agents }) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const takenAgents = [...takenAgentIds].map((id) => byId.get(id)).filter(Boolean);
  const accounted = Math.min(MAX_TEAM_SIZE, players.length + takenAgents.length);
  const minimums = mode === "chaos"
    ? {}
    : { ...(ROLE_MINIMUMS_BY_TEAM_SIZE[accounted] || {}) };
  const maximums = mode === "chaos"
    ? {}
    : { ...(ROLE_MAXIMUMS_BY_TEAM_SIZE[accounted] || {}) };
  for (const agent of takenAgents) {
    if (minimums[agent.role] != null) {
      minimums[agent.role] = Math.max(0, minimums[agent.role] - 1);
    }
    if (maximums[agent.role] != null) {
      maximums[agent.role] = Math.max(0, maximums[agent.role] - 1);
    }
  }

  const pools = players.map((player) =>
    agents.filter(
      (agent) => player.ownedAgentIds.has(agent.id) && !takenAgentIds.has(agent.id),
    ),
  );
  const chosen = [];
  const used = new Set();

  function enumerate(playerIndex) {
    if (playerIndex === players.length) {
      const counts = Object.fromEntries(ROLES.map((role) => [role, 0]));
      chosen.forEach((agent) => {
        counts[agent.role] += 1;
      });
      return ROLES.every(
        (role) =>
          counts[role] >= (minimums[role] || 0) &&
          counts[role] <= (maximums[role] ?? Infinity),
      );
    }
    for (const agent of pools[playerIndex]) {
      if (used.has(agent.id)) continue;
      chosen.push(agent);
      used.add(agent.id);
      if (enumerate(playerIndex + 1)) return true;
      used.delete(agent.id);
      chosen.pop();
    }
    return false;
  }

  return enumerate(0);
}

test("production solver classification matches an independent exhaustive oracle", () => {
  const random = seededRandom(0x0ac1e);
  const reducedAgents = ROLES.flatMap((role) =>
    AGENTS.filter((agent) => agent.role === role).slice(0, 2),
  );
  let falsePositives = 0;
  let falseNegatives = 0;

  for (let caseIndex = 0; caseIndex < ORACLE_CASES; caseIndex += 1) {
    const stackSize = 1 + Math.floor(random() * 4);
    const shuffled = reducedAgents
      .map((agent) => ({ agent, order: random() }))
      .sort((left, right) => left.order - right.order)
      .map(({ agent }) => agent);
    const knownPickCount = Math.floor(
      random() * (Math.min(2, MAX_TEAM_SIZE - stackSize) + 1),
    );
    const takenAgentIds = new Set(
      shuffled.slice(0, knownPickCount).map((agent) => agent.id),
    );
    const players = Array.from({ length: stackSize }, (_, playerIndex) => {
      const ownedAgentIds = new Set();
      reducedAgents.forEach((agent) => {
        if (random() < 0.45) ownedAgentIds.add(agent.id);
      });
      if (caseIndex % 11 === 0) ownedAgentIds.clear();
      return { id: `case-${caseIndex}-p${playerIndex}`, ownedAgentIds };
    });
    const setup = {
      players,
      takenAgentIds,
      mode: random() < 0.7 ? "balanced" : "chaos",
      agents: reducedAgents,
      random,
    };
    const productionCanSolve = Boolean(solveDraft(setup));
    const oracleCanSolve = referenceHasSolution(setup);
    if (productionCanSolve && !oracleCanSolve) falsePositives += 1;
    if (!productionCanSolve && oracleCanSolve) falseNegatives += 1;
  }

  const mismatches = falsePositives + falseNegatives;
  console.log(
    `Oracle comparisons: ${ORACLE_CASES}; false positives: ${falsePositives}; false negatives: ${falseNegatives}; mismatches: ${mismatches}`,
  );
  assert.equal(falsePositives, 0);
  assert.equal(falseNegatives, 0);
});
