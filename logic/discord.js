export function escapeDiscordText(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/([*_`~|>])/g, "\\$1")
    .replace(/@/g, "@\u200b");
}

export function formatDiscordResult({
  matchNumber,
  draft,
  players,
  pinnedPlayerIds,
  personalRerollsRemaining = new Map(),
  teamRedrawsRemaining,
  rerollBudget,
  takenAgentIds,
  agents,
}) {
  const lines = draft.map((agent, index) => {
    const rawName = players[index].name.trim() || `Player ${index + 1}`;
    const pinned = pinnedPlayerIds.has(players[index].id) ? " [pinned]" : "";
    return `${escapeDiscordText(rawName)} → ${agent.name} (${agent.role})${pinned}`;
  });
  const personalRerollsUsed = players.reduce(
    (total, player) =>
      total + rerollBudget - (personalRerollsRemaining.get(player.id) ?? rerollBudget),
    0,
  );
  const teamRedrawsUsed = rerollBudget - teamRedrawsRemaining;
  const footer = [
    `match ${matchNumber}`,
    `${personalRerollsUsed} personal ${personalRerollsUsed === 1 ? "reroll" : "rerolls"} used`,
    `${teamRedrawsUsed} team ${teamRedrawsUsed === 1 ? "redraw" : "redraws"} used`,
  ];

  if (takenAgentIds.size) {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    footer.push(
      `outside picks: ${[...takenAgentIds]
        .map((agentId) => byId.get(agentId)?.name)
        .filter(Boolean)
        .join(", ")}`,
    );
  }

  return `**Agent Roulette**\n${lines.join("\n")}\n_${footer.join(" · ")}_`;
}
