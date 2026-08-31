const MAX_NAME_LENGTH = 60;
export const PREFERENCES_VERSION = 2;
export const SESSION_VERSION = 1;

export function sanitizeProfileName(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_NAME_LENGTH)
    : "";
}

export function normalizeSavedPreferences(
  savedValue,
  { agents, maxSavedPlayers = 50, makeId },
) {
  if (!savedValue || typeof savedValue !== "object") return null;

  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const starterAgentIds = agents
    .filter((agent) => agent.starter)
    .map((agent) => agent.id);
  const usedPlayerIds = new Set();
  const isLegacy = !Array.isArray(savedValue.savedPlayers);
  const sourcePlayers = Array.isArray(savedValue.savedPlayers)
    ? savedValue.savedPlayers
    : Array.isArray(savedValue.players)
      ? savedValue.players
      : [];
  const savedPlayers = sourcePlayers
    .slice(0, maxSavedPlayers)
    .filter((value) => value && typeof value === "object")
    .map((savedPlayer) => {
      let id = typeof savedPlayer.id === "string" ? savedPlayer.id : "";
      if (!id || usedPlayerIds.has(id)) id = makeId();
      usedPlayerIds.add(id);

      const ownedAgentIds = new Set(
        Array.isArray(savedPlayer.ownedAgentIds)
          ? savedPlayer.ownedAgentIds.filter((agentId) =>
              validAgentIds.has(agentId),
            )
          : [],
      );
      starterAgentIds.forEach((agentId) => ownedAgentIds.add(agentId));

      return {
        id,
        name: sanitizeProfileName(savedPlayer.name),
        ownedAgentIds,
        open: false,
      };
    });

  return {
    preferredMode:
      savedValue.preferredMode === "chaos" || savedValue.mode === "chaos"
        ? "chaos"
        : "balanced",
    savedPlayers,
    migratedCurrentStackIds: isLegacy
      ? savedPlayers.slice(0, 5).map((player) => player.id)
      : [],
  };
}

export function serializePreferences({ preferredMode, savedPlayers }) {
  return {
    version: PREFERENCES_VERSION,
    preferredMode: preferredMode === "chaos" ? "chaos" : "balanced",
    savedPlayers: savedPlayers.map((player) => ({
      id: player.id,
      name: sanitizeProfileName(player.name),
      ownedAgentIds: [...player.ownedAgentIds],
    })),
  };
}

export function normalizeSessionState(
  savedValue,
  { savedPlayers, agents, maxTeamSize, rerollBudget },
) {
  if (!savedValue || typeof savedValue !== "object") return null;

  const validPlayerIds = new Set(savedPlayers.map((player) => player.id));
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const currentStackIds = uniqueValidStrings(
    savedValue.currentStackIds,
    validPlayerIds,
  ).slice(0, maxTeamSize);
  const outsideSeatCount = Math.max(0, maxTeamSize - currentStackIds.length);
  const takenAgentIds = uniqueValidStrings(
    savedValue.takenAgentIds,
    validAgentIds,
  ).slice(0, outsideSeatCount);
  const mode = savedValue.mode === "chaos" ? "chaos" : "balanced";
  const rawMatch = savedValue.matchState;
  const matchNumber =
    Number.isSafeInteger(rawMatch?.matchNumber) && rawMatch.matchNumber > 0
      ? rawMatch.matchNumber
      : 1;
  const rawDraft = Array.isArray(rawMatch?.draftAgentIds)
    ? rawMatch.draftAgentIds
    : null;
  const draftAgentIds =
    rawDraft &&
    rawDraft.length === currentStackIds.length &&
    rawDraft.length > 0 &&
    new Set(rawDraft).size === rawDraft.length &&
    rawDraft.every(
      (agentId) =>
        validAgentIds.has(agentId) && !takenAgentIds.includes(agentId),
    )
      ? rawDraft.slice()
      : null;
  const pinnedPlayerIds = draftAgentIds
    ? uniqueValidStrings(rawMatch?.pinnedPlayerIds, new Set(currentStackIds))
    : [];
  const rerollsRemaining = draftAgentIds
    ? clampInteger(rawMatch?.rerollsRemaining, 0, rerollBudget, rerollBudget)
    : rerollBudget;

  return {
    mode,
    currentStackIds,
    takenAgentIds,
    matchState: {
      matchNumber,
      draftAgentIds,
      pinnedPlayerIds,
      rerollsRemaining,
    },
  };
}

export function serializeSessionState({
  mode,
  currentStackIds,
  takenAgentIds,
  matchState,
}) {
  return {
    version: SESSION_VERSION,
    mode: mode === "chaos" ? "chaos" : "balanced",
    currentStackIds: [...currentStackIds],
    takenAgentIds: [...takenAgentIds],
    matchState: {
      matchNumber: matchState.matchNumber,
      draftAgentIds: matchState.draft
        ? matchState.draft.map((agent) => agent.id)
        : null,
      pinnedPlayerIds: [...matchState.pinnedPlayerIds],
      rerollsRemaining: matchState.rerollsRemaining,
    },
  };
}

function uniqueValidStrings(value, allowedValues) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((item) => {
    if (typeof item !== "string" || !allowedValues.has(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function clampInteger(value, minimum, maximum, fallback) {
  return Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
