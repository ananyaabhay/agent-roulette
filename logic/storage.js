const MAX_NAME_LENGTH = 60;

export function normalizeSavedPreferences(
  savedValue,
  { agents, maxPlayers, makeId },
) {
  if (!savedValue || typeof savedValue !== "object") return null;

  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const starterAgentIds = agents
    .filter((agent) => agent.starter)
    .map((agent) => agent.id);
  const usedPlayerIds = new Set();
  const savedPlayers = Array.isArray(savedValue.players)
    ? savedValue.players.slice(0, maxPlayers)
    : [];

  const players = savedPlayers.map((savedPlayer) => {
    let id = typeof savedPlayer?.id === "string" ? savedPlayer.id : "";
    if (!id || usedPlayerIds.has(id)) id = makeId();
    usedPlayerIds.add(id);

    const name =
      typeof savedPlayer?.name === "string"
        ? savedPlayer.name.slice(0, MAX_NAME_LENGTH)
        : "";
    const ownedAgentIds = new Set(
      Array.isArray(savedPlayer?.ownedAgentIds)
        ? savedPlayer.ownedAgentIds.filter((agentId) =>
            validAgentIds.has(agentId),
          )
        : [],
    );
    starterAgentIds.forEach((agentId) => ownedAgentIds.add(agentId));

    return { id, name, ownedAgentIds, open: false };
  });

  if (players.length === 0) return null;
  return {
    mode: savedValue.mode === "chaos" ? "chaos" : "balanced",
    players,
  };
}

export function serializePreferences({ mode, players }) {
  return {
    version: 1,
    mode: mode === "chaos" ? "chaos" : "balanced",
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      ownedAgentIds: [...player.ownedAgentIds],
    })),
  };
}
