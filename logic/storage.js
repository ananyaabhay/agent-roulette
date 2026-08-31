const MAX_NAME_LENGTH = 60;
export const PREFERENCES_VERSION = 3;
export const SESSION_VERSION = 2;

export function sanitizeProfileName(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_NAME_LENGTH)
    : "";
}

export function normalizeSavedPreferences(
  savedValue,
  { agents, validMapIds = [], maxSavedPlayers = 50, makeId },
) {
  if (!savedValue || typeof savedValue !== "object") return null;

  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const validMaps = new Set(validMapIds);
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
    preferredMode: normalizeMode(savedValue.preferredMode ?? savedValue.mode),
    selectedMapId: validMaps.has(savedValue.selectedMapId)
      ? savedValue.selectedMapId
      : "",
    savedPlayers,
    migratedCurrentStackIds: isLegacy
      ? savedPlayers.slice(0, 5).map((player) => player.id)
      : [],
  };
}

export function serializePreferences({ preferredMode, selectedMapId, savedPlayers }) {
  return {
    version: PREFERENCES_VERSION,
    preferredMode: normalizeMode(preferredMode),
    selectedMapId: typeof selectedMapId === "string" ? selectedMapId : "",
    savedPlayers: savedPlayers.map((player) => ({
      id: player.id,
      name: sanitizeProfileName(player.name),
      ownedAgentIds: [...player.ownedAgentIds],
    })),
  };
}

export function normalizeSessionState(
  savedValue,
  { savedPlayers, agents, validMapIds = [], maxTeamSize, rerollBudget },
) {
  if (!savedValue || typeof savedValue !== "object") return null;

  const validPlayerIds = new Set(savedPlayers.map((player) => player.id));
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const validMaps = new Set(validMapIds);
  const currentStackIds = uniqueValidStrings(
    savedValue.currentStackIds,
    validPlayerIds,
  ).slice(0, maxTeamSize);
  const outsideSeatCount = Math.max(0, maxTeamSize - currentStackIds.length);
  const takenAgentIds = uniqueValidStrings(
    savedValue.takenAgentIds,
    validAgentIds,
  ).slice(0, outsideSeatCount);
  const mode = normalizeMode(savedValue.mode);
  const selectedMapId = validMaps.has(savedValue.selectedMapId)
    ? savedValue.selectedMapId
    : "";
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
    ) &&
    (mode !== "map" || selectedMapId)
      ? rawDraft.slice()
      : null;
  const pinnedPlayerIds = draftAgentIds
    ? uniqueValidStrings(rawMatch?.pinnedPlayerIds, new Set(currentStackIds))
    : [];

  const legacySharedRemaining = clampInteger(
    rawMatch?.rerollsRemaining,
    0,
    rerollBudget,
    rerollBudget,
  );
  const rawPersonal = rawMatch?.personalRerollsRemaining;
  const personalRerollsRemaining = Object.fromEntries(
    currentStackIds.map((playerId) => [
      playerId,
      draftAgentIds
        ? clampInteger(
            readPersonalBudget(rawPersonal, playerId),
            0,
            rerollBudget,
            legacySharedRemaining,
          )
        : rerollBudget,
    ]),
  );
  const teamRedrawsRemaining = draftAgentIds
    ? clampInteger(
        rawMatch?.teamRedrawsRemaining,
        0,
        rerollBudget,
        legacySharedRemaining,
      )
    : rerollBudget;

  return {
    mode,
    selectedMapId,
    currentStackIds,
    takenAgentIds,
    matchState: {
      matchNumber,
      draftAgentIds,
      pinnedPlayerIds,
      personalRerollsRemaining,
      teamRedrawsRemaining,
    },
  };
}

export function serializeSessionState({
  mode,
  selectedMapId,
  currentStackIds,
  takenAgentIds,
  matchState,
}) {
  return {
    version: SESSION_VERSION,
    mode: normalizeMode(mode),
    selectedMapId: typeof selectedMapId === "string" ? selectedMapId : "",
    currentStackIds: [...currentStackIds],
    takenAgentIds: [...takenAgentIds],
    matchState: {
      matchNumber: matchState.matchNumber,
      draftAgentIds: matchState.draft
        ? matchState.draft.map((agent) => agent.id)
        : null,
      pinnedPlayerIds: [...matchState.pinnedPlayerIds],
      personalRerollsRemaining: Object.fromEntries(
        matchState.personalRerollsRemaining || [],
      ),
      teamRedrawsRemaining: matchState.teamRedrawsRemaining,
    },
  };
}

function normalizeMode(value) {
  return value === "chaos" || value === "map" ? value : "balanced";
}

function readPersonalBudget(value, playerId) {
  if (Array.isArray(value)) {
    return value.find((entry) => entry?.[0] === playerId)?.[1];
  }
  return value && typeof value === "object" ? value[playerId] : undefined;
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
