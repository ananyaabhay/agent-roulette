import {
  AGENTS,
  MAX_TEAM_SIZE,
  ROLE_MAXIMUMS_BY_TEAM_SIZE,
  ROLE_MINIMUMS_BY_TEAM_SIZE,
  ROLES,
} from "../data/game-data.js";

export function shuffled(items, random = Math.random) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function indexAgents(agents) {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

function emptyRoleCounts() {
  return Object.fromEntries(ROLES.map((role) => [role, 0]));
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
}) {
  const byId = indexAgents(agents);
  const takenAgents = [...takenAgentIds]
    .map((agentId) => byId.get(agentId))
    .filter(Boolean);
  const accountedTeamSize = Math.min(
    MAX_TEAM_SIZE,
    stackSize + takenAgents.length,
  );

  if (mode === "chaos") {
    return { minimums: {}, maximums: {}, accountedTeamSize };
  }

  const minimums = { ...(ROLE_MINIMUMS_BY_TEAM_SIZE[accountedTeamSize] || {}) };
  const maximums = { ...(ROLE_MAXIMUMS_BY_TEAM_SIZE[accountedTeamSize] || {}) };

  for (const agent of takenAgents) {
    if (minimums[agent.role] != null) {
      minimums[agent.role] = Math.max(0, minimums[agent.role] - 1);
    }
    if (maximums[agent.role] != null) {
      maximums[agent.role] = Math.max(0, maximums[agent.role] - 1);
    }
  }

  return { minimums, maximums, accountedTeamSize };
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
  random = Math.random,
}) {
  const byId = indexAgents(agents);
  const { minimums, maximums } = getRoleQuotas({
    mode,
    stackSize: players.length,
    takenAgentIds,
    agents,
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
  const roleCounts = emptyRoleCounts();
  const assignment = new Array(players.length).fill(null);

  function minimumsStillReachable(orderIndex) {
    const remainingPlayerIndexes = playerOrder.slice(orderIndex);
    let totalMissingRoles = 0;

    for (const role of ROLES) {
      const gap = Math.max(0, (minimums[role] || 0) - roleCounts[role]);
      if (gap === 0) continue;

      totalMissingRoles += gap;
      const capablePlayers = remainingPlayerIndexes.filter((playerIndex) =>
        pools[playerIndex].some(
          (agent) => agent.role === role && !usedAgentIds.has(agent.id),
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
      return ROLES.every(
        (role) => roleCounts[role] >= (minimums[role] || 0),
      );
    }

    if (!minimumsStillReachable(orderIndex)) return false;

    const playerIndex = playerOrder[orderIndex];
    const player = players[playerIndex];
    const candidates = shuffled(
      pools[playerIndex].filter(
        (agent) =>
          !usedAgentIds.has(agent.id) &&
          roleCounts[agent.role] < (maximums[agent.role] ?? Infinity),
      ),
      random,
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
      roleCounts[agent.role] += 1;
      assignment[playerIndex] = agent;

      if (assignNext(orderIndex + 1)) return true;

      usedAgentIds.delete(agent.id);
      roleCounts[agent.role] -= 1;
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
  });
  const roleCounts = emptyRoleCounts();
  assignment.forEach((agent) => {
    roleCounts[agent.role] += 1;
  });

  return ROLES.every(
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
  const { minimums } = getRoleQuotas({
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
    const capablePlayers = players.filter((player) =>
      getAvailableAgents(player, takenAgentIds, agents).some(
        (agent) => agent.role === role,
      ),
    ).length;
    const neededCount = minimums[role] || 0;
    const coveringLobbyAgents = lobbyAgents.filter(
      (agent) => agent.role === role,
    );

    if (mode === "chaos") {
      return { role, state: "disabled", neededCount: 0, capablePlayers, coveringLobbyAgents };
    }
    if (neededCount > capablePlayers) {
      return { role, state: "impossible", neededCount, capablePlayers, coveringLobbyAgents };
    }
    if (neededCount > 0) {
      return { role, state: "needed", neededCount, capablePlayers, coveringLobbyAgents };
    }
    if (coveringLobbyAgents.length > 0) {
      return { role, state: "covered", neededCount: 0, capablePlayers, coveringLobbyAgents };
    }
    return { role, state: "flexible", neededCount: 0, capablePlayers, coveringLobbyAgents };
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
      body: `The comp still needs ${roles}: ${totalNeeded} roles across ${players.length} stack ${players.length === 1 ? "player" : "players"}. Switch to Full Chaos or change an outside pick.`,
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
      body: `That role is still needed.${starter ? ` ${starter.name} is a default unlock; check whether they are marked as an outside pick.` : ""} You can also switch to Full Chaos.`,
    };
  }

  return {
    title: "These agent pools cannot cover a Role Balanced draft.",
    body: "There are enough agents, but the ownership spread cannot meet every role target without duplicates. Add ownership across roles or use Full Chaos.",
  };
}
