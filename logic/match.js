import { AGENTS, REROLL_BUDGET } from "../data/game-data.js";
import {
  getAvailableAgents,
  shuffled,
  solveDraft,
  validateDraft,
} from "./solver.js";

export function createMatchState(matchNumber = 1) {
  return {
    matchNumber,
    draft: null,
    pinnedPlayerIds: new Set(),
    rerollsRemaining: REROLL_BUDGET,
  };
}

export function startNewMatch(matchState) {
  return createMatchState((matchState?.matchNumber || 0) + 1);
}

export function spinInitialDraft(matchState, context) {
  if (matchState.draft) {
    return { changed: false, reason: "match-active", state: matchState };
  }

  const draft = solveDraft(context);
  if (!draft) {
    return { changed: false, reason: "no-solution", state: matchState };
  }

  return {
    changed: true,
    reason: "spun",
    movedPlayerIndexes: context.players.map((_, index) => index),
    state: { ...matchState, draft },
  };
}

export function togglePlayerPin(matchState, playerId) {
  if (!matchState.draft) return matchState;
  const pinnedPlayerIds = new Set(matchState.pinnedPlayerIds);
  pinnedPlayerIds.has(playerId)
    ? pinnedPlayerIds.delete(playerId)
    : pinnedPlayerIds.add(playerId);
  return { ...matchState, pinnedPlayerIds };
}

export function attemptPlayerReroll(matchState, playerId, context) {
  if (!matchState.draft) {
    return { changed: false, reason: "no-draft", state: matchState };
  }
  if (matchState.rerollsRemaining <= 0) {
    return { changed: false, reason: "no-budget", state: matchState };
  }
  if (matchState.pinnedPlayerIds.has(playerId)) {
    return { changed: false, reason: "pinned", state: matchState };
  }

  const playerIndex = context.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    return { changed: false, reason: "unknown-player", state: matchState };
  }

  const currentAgent = matchState.draft[playerIndex];
  const otherAgentIds = new Set(
    matchState.draft
      .filter((_, index) => index !== playerIndex)
      .map((agent) => agent.id),
  );
  const directCandidates = shuffled(
    getAvailableAgents(
      context.players[playerIndex],
      context.takenAgentIds,
      context.agents || AGENTS,
    ).filter(
      (agent) => agent.id !== currentAgent.id && !otherAgentIds.has(agent.id),
    ),
    context.random,
  );

  for (const candidate of directCandidates) {
    const draft = matchState.draft.slice();
    draft[playerIndex] = candidate;
    if (validateDraft({ ...context, assignment: draft })) {
      return successfulReroll(matchState, draft, [playerIndex], "direct");
    }
  }

  const fixedAgentIds = new Map();
  context.players.forEach((player, index) => {
    if (player.id !== playerId && matchState.pinnedPlayerIds.has(player.id)) {
      fixedAgentIds.set(player.id, matchState.draft[index].id);
    }
  });
  const draft = solveDraft({
    ...context,
    fixedAgentIds,
    forbiddenAgentIds: new Map([[playerId, new Set([currentAgent.id])]]),
    preferredAgentIds: new Map(
      context.players.map((player, index) => [
        player.id,
        matchState.draft[index].id,
      ]),
    ),
  });

  if (!draft) {
    return { changed: false, reason: "no-alternative", state: matchState };
  }

  const movedPlayerIndexes = changedIndexes(matchState.draft, draft);
  return successfulReroll(
    matchState,
    draft,
    movedPlayerIndexes,
    movedPlayerIndexes.length > 1 ? "cascade" : "direct",
  );
}

export function redrawUnpinned(matchState, context) {
  if (!matchState.draft) {
    return { changed: false, reason: "no-draft", state: matchState };
  }
  if (matchState.rerollsRemaining <= 0) {
    return { changed: false, reason: "no-budget", state: matchState };
  }

  const fixedAgentIds = new Map();
  const forbiddenAgentIds = new Map();
  context.players.forEach((player, index) => {
    const currentAgentId = matchState.draft[index].id;
    if (matchState.pinnedPlayerIds.has(player.id)) {
      fixedAgentIds.set(player.id, currentAgentId);
    } else {
      forbiddenAgentIds.set(player.id, new Set([currentAgentId]));
    }
  });

  if (forbiddenAgentIds.size === 0) {
    return { changed: false, reason: "all-pinned", state: matchState };
  }

  const draft = solveDraft({ ...context, fixedAgentIds, forbiddenAgentIds });
  if (!draft) {
    return { changed: false, reason: "no-alternative", state: matchState };
  }

  return successfulReroll(
    matchState,
    draft,
    changedIndexes(matchState.draft, draft),
    "redraw",
  );
}

export function reconcileActiveMatch(matchState, context) {
  if (!matchState.draft) {
    return { changed: false, reason: "no-draft", state: matchState };
  }
  if (validateDraft({ ...context, assignment: matchState.draft })) {
    return { changed: false, reason: "still-valid", state: matchState };
  }

  const preferredAgentIds = new Map(
    context.players.map((player, index) => [
      player.id,
      matchState.draft[index]?.id,
    ]),
  );
  const fixedAgentIds = new Map();
  context.players.forEach((player, index) => {
    const assigned = matchState.draft[index];
    if (
      assigned &&
      matchState.pinnedPlayerIds.has(player.id) &&
      player.ownedAgentIds.has(assigned.id) &&
      !context.takenAgentIds.has(assigned.id)
    ) {
      fixedAgentIds.set(player.id, assigned.id);
    }
  });

  let draft = solveDraft({ ...context, fixedAgentIds, preferredAgentIds });
  if (!draft && fixedAgentIds.size > 0) {
    draft = solveDraft({ ...context, preferredAgentIds });
  }
  if (!draft) {
    return { changed: false, reason: "no-solution", state: matchState };
  }

  const movedPlayerIndexes = changedIndexes(matchState.draft, draft);
  const pinnedPlayerIds = new Set(
    context.players
      .filter(
        (player, index) =>
          matchState.pinnedPlayerIds.has(player.id) &&
          matchState.draft[index]?.id === draft[index]?.id,
      )
      .map((player) => player.id),
  );
  const releasedPinIds = [...matchState.pinnedPlayerIds].filter(
    (playerId) => !pinnedPlayerIds.has(playerId),
  );

  return {
    changed: movedPlayerIndexes.length > 0,
    reason: "resolved",
    movedPlayerIndexes,
    releasedPinIds,
    state: { ...matchState, draft, pinnedPlayerIds },
  };
}

function changedIndexes(before, after) {
  return after
    .map((agent, index) => (agent.id !== before[index]?.id ? index : -1))
    .filter((index) => index >= 0);
}

function successfulReroll(matchState, draft, movedPlayerIndexes, kind) {
  return {
    changed: true,
    reason: kind,
    movedPlayerIndexes,
    state: {
      ...matchState,
      draft,
      rerollsRemaining: Math.max(0, matchState.rerollsRemaining - 1),
    },
  };
}
