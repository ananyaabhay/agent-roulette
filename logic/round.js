import { AGENTS, REROLL_BUDGET } from "../data/game-data.js";
import {
  getAvailableAgents,
  shuffled,
  solveDraft,
  validateDraft,
} from "./solver.js";

export function createRoundState(roundNumber = 1) {
  return {
    roundNumber,
    draft: null,
    pinnedPlayerIds: new Set(),
    rerollsRemaining: REROLL_BUDGET,
  };
}

export function startNewRound(roundState) {
  return createRoundState((roundState?.roundNumber || 0) + 1);
}

export function spinInitialDraft(roundState, context) {
  if (roundState.draft) {
    return { changed: false, reason: "round-active", state: roundState };
  }

  const draft = solveDraft(context);
  if (!draft) {
    return { changed: false, reason: "no-solution", state: roundState };
  }

  return {
    changed: true,
    reason: "spun",
    movedPlayerIndexes: context.players.map((_, index) => index),
    state: { ...roundState, draft },
  };
}

export function togglePlayerPin(roundState, playerId) {
  if (!roundState.draft) return roundState;
  const pinnedPlayerIds = new Set(roundState.pinnedPlayerIds);
  pinnedPlayerIds.has(playerId)
    ? pinnedPlayerIds.delete(playerId)
    : pinnedPlayerIds.add(playerId);
  return { ...roundState, pinnedPlayerIds };
}

export function attemptPlayerReroll(roundState, playerId, context) {
  if (!roundState.draft) {
    return { changed: false, reason: "no-draft", state: roundState };
  }
  if (roundState.rerollsRemaining <= 0) {
    return { changed: false, reason: "no-budget", state: roundState };
  }
  if (roundState.pinnedPlayerIds.has(playerId)) {
    return { changed: false, reason: "pinned", state: roundState };
  }

  const playerIndex = context.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    return { changed: false, reason: "unknown-player", state: roundState };
  }

  const currentAgent = roundState.draft[playerIndex];
  const otherAgentIds = new Set(
    roundState.draft
      .filter((_, index) => index !== playerIndex)
      .map((agent) => agent.id),
  );

  const directCandidates = shuffled(
    getAvailableAgents(
      context.players[playerIndex],
      context.takenAgentIds,
      context.agents || AGENTS,
    ).filter(
      (agent) =>
        agent.id !== currentAgent.id && !otherAgentIds.has(agent.id),
    ),
    context.random,
  );

  for (const candidate of directCandidates) {
    const draft = roundState.draft.slice();
    draft[playerIndex] = candidate;
    if (validateDraft({ ...context, assignment: draft })) {
      return successfulReroll(roundState, draft, [playerIndex], "direct");
    }
  }

  const fixedAgentIds = new Map();
  context.players.forEach((player, index) => {
    if (
      player.id !== playerId &&
      roundState.pinnedPlayerIds.has(player.id)
    ) {
      fixedAgentIds.set(player.id, roundState.draft[index].id);
    }
  });
  const forbiddenAgentIds = new Map([
    [playerId, new Set([currentAgent.id])],
  ]);
  const preferredAgentIds = new Map(
    context.players.map((player, index) => [
      player.id,
      roundState.draft[index].id,
    ]),
  );
  const draft = solveDraft({
    ...context,
    fixedAgentIds,
    forbiddenAgentIds,
    preferredAgentIds,
  });

  if (!draft) {
    return { changed: false, reason: "no-alternative", state: roundState };
  }

  const movedPlayerIndexes = changedIndexes(roundState.draft, draft);
  return successfulReroll(
    roundState,
    draft,
    movedPlayerIndexes,
    movedPlayerIndexes.length > 1 ? "cascade" : "direct",
  );
}

export function redrawUnpinned(roundState, context) {
  if (!roundState.draft) {
    return { changed: false, reason: "no-draft", state: roundState };
  }
  if (roundState.rerollsRemaining <= 0) {
    return { changed: false, reason: "no-budget", state: roundState };
  }

  const fixedAgentIds = new Map();
  const forbiddenAgentIds = new Map();
  context.players.forEach((player, index) => {
    const currentAgentId = roundState.draft[index].id;
    if (roundState.pinnedPlayerIds.has(player.id)) {
      fixedAgentIds.set(player.id, currentAgentId);
    } else {
      // Every unpinned player must actually change. If that is impossible,
      // the attempt fails and the shared token is preserved.
      forbiddenAgentIds.set(player.id, new Set([currentAgentId]));
    }
  });

  if (forbiddenAgentIds.size === 0) {
    return { changed: false, reason: "all-pinned", state: roundState };
  }

  const draft = solveDraft({
    ...context,
    fixedAgentIds,
    forbiddenAgentIds,
  });
  if (!draft) {
    return { changed: false, reason: "no-alternative", state: roundState };
  }

  return successfulReroll(
    roundState,
    draft,
    changedIndexes(roundState.draft, draft),
    "redraw",
  );
}

function changedIndexes(before, after) {
  return after
    .map((agent, index) => (agent.id !== before[index].id ? index : -1))
    .filter((index) => index >= 0);
}

function successfulReroll(roundState, draft, movedPlayerIndexes, kind) {
  return {
    changed: true,
    reason: kind,
    movedPlayerIndexes,
    state: {
      ...roundState,
      draft,
      rerollsRemaining: Math.max(0, roundState.rerollsRemaining - 1),
    },
  };
}
