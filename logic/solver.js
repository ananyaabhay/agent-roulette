import {
  AGENTS,
  MAX_TEAM_SIZE,
  ROLE_MAXIMUMS_BY_TEAM_SIZE,
  ROLE_MINIMUMS_BY_TEAM_SIZE,
  ROLES,
} from "../data/game-data.js";

/**
 * The engine solves a generic problem: assign distinct items to participants
 * under per-participant eligibility, category quotas and weighted preference.
 * Nothing below needs to know what an agent or a map is.
 *
 * VALORANT is the default ruleset, not a dependency. Pass your own `ruleset`
 * and the same solver drives a different domain with no changes in logic/ —
 * tests/ruleset.test.js proves this against a non-VALORANT ruleset.
 */
export const DEFAULT_RULESET = Object.freeze({
  categories: ROLES,
  categoryOf: (item) => item.role,
  minimumsBySize: ROLE_MINIMUMS_BY_TEAM_SIZE,
  maximumsBySize: ROLE_MAXIMUMS_BY_TEAM_SIZE,
  maxGroupSize: MAX_TEAM_SIZE,
});

export function shuffled(items, random = Math.random) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

/**
 * Randomly order candidates without replacement. A weight only changes how
 * early a legal candidate is tried; it never changes pools or constraints.
 */
export function orderCandidates(
  items,
  random = Math.random,
  candidateWeight = null,
  context = {},
) {
  if (typeof candidateWeight !== "function") return shuffled(items, random);
  const remaining = items.slice();
  const ordered = [];
  while (remaining.length) {
    const weights = remaining.map((agent) => {
      const value = Number(candidateWeight(agent, context));
      return Number.isFinite(value) && value > 0 ? value : 1;
    });
    const total = weights.reduce((sum, value) => sum + value, 0);
    let target = random() * total;
    let selectedIndex = weights.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      target -= weights[index];
      if (target < 0) {
        selectedIndex = index;
        break;
      }
    }
    ordered.push(remaining.splice(selectedIndex, 1)[0]);
  }
  return ordered;
}

function indexAgents(agents) {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

function emptyRoleCounts(ruleset = DEFAULT_RULESET) {
  return Object.fromEntries(ruleset.categories.map((role) => [role, 0]));
}

export function getAvailableAgents(
  player,
  takenAgentIds = new Set(),
  agents = AGENTS,
) {
  return agents.filter(
    (agent) => player.ownedAgentIds.has(agent.id) && !takenAgentIds.has(agent.id),
  );
}

/**
 * Return role targets for the stack after known outside picks have claimed
 * their share. The same function powers the solver and the Team Needs panel.
 */
export function getRoleQuotas({
  mode,
  stackSize,
  takenAgentIds = new Set(),
  agents = AGENTS,
  ruleset = DEFAULT_RULESET,
}) {
  const byId = indexAgents(agents);
  const takenAgents = [...takenAgentIds]
    .map((agentId) => byId.get(agentId))
    .filter(Boolean);
  const accountedTeamSize = Math.min(
    ruleset.maxGroupSize,
    stackSize + takenAgents.length,
  );

  if (mode === "chaos") {
    return {
      minimums: {},
      maximums: {},
      targetMinimums: {},
      accountedTeamSize,
    };
  }

  const minimums = { ...(ruleset.minimumsBySize[accountedTeamSize] || {}) };
  const targetMinimums = { ...minimums };
  const maximums = { ...(ruleset.maximumsBySize[accountedTeamSize] || {}) };

  for (const agent of takenAgents) {
    const category = ruleset.categoryOf(agent);
    if (minimums[category] != null) {
      minimums[category] = Math.max(0, minimums[category] - 1);
    }
    if (maximums[category] != null) {
      maximums[category] = Math.max(0, maximums[category] - 1);
    }
  }

  return { minimums, maximums, targetMinimums, accountedTeamSize };
}

/**
 * Assign distinct, owned agents under role limits.
 *
 * The original V1.2 architecture is intentionally preserved:
 * - search the smallest player pool first;
 * - prune branches whose remaining players cannot cover role gaps;
 * - backtrack when a candidate blocks the rest of the team;
 * - validate role minimums again at the terminal state.
 */
export function solveDraft({
  players,
  takenAgentIds = new Set(),
  mode = "balanced",
  agents = AGENTS,
  fixedAgentIds = new Map(),
  forbiddenAgentIds = new Map(),
  preferredAgentIds = new Map(),
  candidateWeight = null,
  random = Math.random,
  ruleset = DEFAULT_RULESET,
}) {
  const byId = indexAgents(agents);
  const { minimums, maximums } = getRoleQuotas({
    mode,
    stackSize: players.length,
    takenAgentIds,
    agents,
    ruleset,
  });

  const pools = players.map((player) => {
    const fixedId = fixedAgentIds.get(player.id);
    if (fixedId) {
      const fixedAgent = byId.get(fixedId);
      return fixedAgent &&
        player.ownedAgentIds.has(fixedId) &&
        !takenAgentIds.has(fixedId)
        ? [fixedAgent]
        : [];
    }

    const forbidden = forbiddenAgentIds.get(player.id);
    return getAvailableAgents(player, takenAgentIds, agents).filter(
      (agent) => !forbidden?.has(agent.id),
    );
  });

  const playerOrder = players
    .map((_, index) => index)
    .sort((left, right) => pools[left].length - pools[right].length);
  const usedAgentIds = new Set();
  const roleCounts = emptyRoleCounts(ruleset);
  const assignment = new Array(players.length).fill(null);

  function minimumsStillReachable(orderIndex) {
    const remainingPlayerIndexes = playerOrder.slice(orderIndex);
    let totalMissingRoles = 0;

    for (const role of ruleset.categories) {
      const gap = Math.max(0, (minimums[role] || 0) - roleCounts[role]);
      if (gap === 0) continue;

      totalMissingRoles += gap;
      const capablePlayers = remainingPlayerIndexes.filter((playerIndex) =>
        pools[playerIndex].some(
          (agent) =>
            ruleset.categoryOf(agent) === role && !usedAgentIds.has(agent.id),
        ),
      ).length;

      if (capablePlayers < gap) return false;
    }

    return totalMissingRoles <= remainingPlayerIndexes.length;
  }

  function assignNext(orderIndex) {
    if (orderIndex === players.length) {
      // Reachability only proves a role could be filled. This terminal check
      // prevents the historical bug where the final draft omitted it anyway.
      return ruleset.categories.every(
        (role) => roleCounts[role] >= (minimums[role] || 0),
      );
    }

    if (!minimumsStillReachable(orderIndex)) return false;

    const playerIndex = playerOrder[orderIndex];
    const player = players[playerIndex];
    const candidates = orderCandidates(
      pools[playerIndex].filter(
        (agent) =>
          !usedAgentIds.has(agent.id) &&
          roleCounts[ruleset.categoryOf(agent)] <
            (maximums[ruleset.categoryOf(agent)] ?? Infinity),
      ),
      random,
      candidateWeight,
      {
        player,
        playerIndex,
        assignment: assignment.slice(),
        roleCounts: { ...roleCounts },
      },
    );

    const preferredId = preferredAgentIds.get(player.id);
    const preferredIndex = candidates.findIndex(
      (agent) => agent.id === preferredId,
    );
    if (preferredIndex > 0) {
      candidates.unshift(candidates.splice(preferredIndex, 1)[0]);
    }

    for (const agent of candidates) {
      usedAgentIds.add(agent.id);
      roleCounts[ruleset.categoryOf(agent)] += 1;
      assignment[playerIndex] = agent;

      if (assignNext(orderIndex + 1)) return true;

      usedAgentIds.delete(agent.id);
      roleCounts[ruleset.categoryOf(agent)] -= 1;
      assignment[playerIndex] = null;
    }

    return false;
  }

  return assignNext(0) ? assignment.slice() : null;
}

export function validateDraft({
  assignment,
  players,
  takenAgentIds = new Set(),
  mode = "balanced",
  agents = AGENTS,
  ruleset = DEFAULT_RULESET,
}) {
  if (!assignment || assignment.length !== players.length || assignment.some((agent) => !agent)) {
    return false;
  }

  const assignedIds = assignment.map((agent) => agent.id);
  if (new Set(assignedIds).size !== assignedIds.length) return false;
  if (assignedIds.some((agentId) => takenAgentIds.has(agentId))) return false;
  if (
    assignment.some(
      (agent, index) => !players[index].ownedAgentIds.has(agent.id),
    )
  ) {
    return false;
  }

  const { minimums, maximums } = getRoleQuotas({
    mode,
    stackSize: players.length,
    takenAgentIds,
    agents,
    ruleset,
  });
  const roleCounts = emptyRoleCounts(ruleset);
  assignment.forEach((agent) => {
    roleCounts[ruleset.categoryOf(agent)] += 1;
  });

  return ruleset.categories.every(
    (role) =>
      roleCounts[role] >= (minimums[role] || 0) &&
      roleCounts[role] <= (maximums[role] ?? Infinity),
  );
}

export function getTeamNeeds({
  players,
  takenAgentIds = new Set(),
  mode = "balanced",
  agents = AGENTS,
}) {
  const { minimums, targetMinimums } = getRoleQuotas({
    mode,
    stackSize: players.length,
    takenAgentIds,
    agents,
  });
  const byId = indexAgents(agents);
  const lobbyAgents = [...takenAgentIds]
    .map((agentId) => byId.get(agentId))
    .filter(Boolean);

  return ROLES.map((role) => {
    const playersWhoCanCover = players.filter((player) =>
      getAvailableAgents(player, takenAgentIds, agents).some(
        (agent) => agent.role === role,
      ),
    ).length;
    const requiredFromStack = minimums[role] || 0;
    const coveringLobbyAgents = (targetMinimums[role] || 0) > requiredFromStack
      ? lobbyAgents.filter((agent) => agent.role === role)
      : [];

    if (mode === "chaos") {
      return {
        role,
        state: "disabled",
        requiredFromStack: 0,
        coveringLobbyAgents,
      };
    }
    if (requiredFromStack > playersWhoCanCover) {
      return {
        role,
        state: "impossible",
        requiredFromStack,
        coveringLobbyAgents,
      };
    }
    if (requiredFromStack > 0) {
      return {
        role,
        state: "needed",
        requiredFromStack,
        coveringLobbyAgents,
      };
    }
    if (coveringLobbyAgents.length > 0) {
      return {
        role,
        state: "covered",
        requiredFromStack: 0,
        coveringLobbyAgents,
      };
    }
    return {
      role,
      state: "flexible",
      requiredFromStack: 0,
      coveringLobbyAgents,
    };
  });
}

export function explainFailure({
  players,
  takenAgentIds = new Set(),
  mode = "balanced",
  agents = AGENTS,
  random = Math.random,
}) {
  const bareDraft = solveDraft({
    players,
    takenAgentIds,
    mode: "chaos",
    agents,
    random,
  });
  if (!bareDraft) {
    return {
      title: "Not enough agents left to go around.",
      body: `After outside picks, there are not ${players.length} distinct owned agents available. Remove a pick, add ownership, or reduce the stack.`,
    };
  }

  const { minimums } = getRoleQuotas({
    mode,
    stackSize: players.length,
    takenAgentIds,
    agents,
  });
  const totalNeeded = Object.values(minimums).reduce(
    (total, count) => total + count,
    0,
  );

  if (totalNeeded > players.length) {
    const roles = Object.entries(minimums)
      .filter(([, count]) => count > 0)
      .map(([role]) => role)
      .join(", ");
    return {
      title: "The known picks leave too many roles open.",
      body: `The comp still needs ${roles}: ${totalNeeded} roles across ${players.length} stack ${players.length === 1 ? "player" : "players"}. Switch to Total Chaos or change an outside pick.`,
    };
  }

  const uncoveredRole = ROLES.find(
    (role) =>
      (minimums[role] || 0) > 0 &&
      !players.some((player) =>
        getAvailableAgents(player, takenAgentIds, agents).some(
          (agent) => agent.role === role,
        ),
      ),
  );
  if (uncoveredRole) {
    const starter = agents.find(
      (agent) => agent.role === uncoveredRole && agent.starter,
    );
    return {
      title: `Nobody in the stack can play a ${uncoveredRole}.`,
      body: `That role is still needed.${starter ? ` ${starter.name} is a default unlock; check whether they are marked as an outside pick.` : ""} You can also switch to Total Chaos.`,
    };
  }

  return {
    title: "These agent pools cannot cover a Role Balanced lineup.",
    body: "There are enough agents, but the ownership spread cannot meet every role target without duplicates. Add ownership across roles or use Total Chaos.",
  };
}
