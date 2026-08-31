export const AGENT_VISUAL_CATALOG_VERSION = "13.04.00.5304478";
export const AGENT_VISUAL_SOURCE =
  "https://developer.riotgames.com/docs/valorant#assets";

export function getAgentVisualPath(agentId) {
  return `./assets/agents/${agentId}.png`;
}
