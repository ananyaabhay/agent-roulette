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
  rerollsRemaining,
  rerollBudget,
  takenAgentIds,
  agents,
}) {
  const lines = draft.map((agent, index) => {
    const rawName = players[index].name.trim() || `Player ${index + 1}`;
    const pinned = pinnedPlayerIds.has(players[index].id) ? " [pinned]" : "";
    return `${escapeDiscordText(rawName)} → ${agent.name} (${agent.role})${pinned}`;
  });
  const rerollsUsed = rerollBudget - rerollsRemaining;
  const footer = [
    `match ${matchNumber}`,
    `${rerollsUsed} ${rerollsUsed === 1 ? "reroll" : "rerolls"} used`,
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
