import { AGENTS, ROLES } from "../data/game-data.js";
import { MAP_BY_ID } from "../data/maps.js";
import {
  MAP_META,
  MAP_META_SOURCES,
  MAP_META_UPDATED_AT,
  MAP_META_VERSION,
} from "../data/map-meta.js";

export function getMapIntel(mapId) {
  const map = MAP_BY_ID.get(mapId);
  const meta = MAP_META[mapId];
  if (!map || !meta) return null;
  return {
    map,
    ...meta,
    version: MAP_META_VERSION,
    updatedAt: MAP_META_UPDATED_AT,
    sources: MAP_META_SOURCES,
  };
}

/**
 * Map influence is an exponent, not a fixed table: w' = w ** strength.
 * strength 0 collapses every weight to 1 (pure legal randomness), 1 is the
 * historical V1.4 behaviour, and MAP_STRENGTH_MAX is the point past which the
 * draft stops being a roulette. Measured on Ascent over 4,000 five-stacks:
 * strength 1 puts Omen in 24% of drafts, 5 puts him in 60% with 26 of 29
 * agents still appearing, and 8 collapses the pool to six agents.
 */
export function createMapCandidateWeight({
  mapId,
  takenAgentIds = new Set(),
  agents = AGENTS,
  strength = 1,
}) {
  const meta = MAP_META[mapId];
  if (!meta || strength <= 0) return null;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const outsideRoleCounts = Object.fromEntries(ROLES.map((role) => [role, 0]));
  takenAgentIds.forEach((agentId) => {
    const agent = byId.get(agentId);
    if (agent) outsideRoleCounts[agent.role] += 1;
  });

  return (agent, { roleCounts = {} } = {}) => {
    let weight = (meta.agentWeights[agent.id] || 1) ** strength;
    const accountedRoleCount =
      (roleCounts[agent.role] || 0) + outsideRoleCounts[agent.role];
    if (accountedRoleCount === 1 && meta.rolePairWeights[agent.role]) {
      weight *= meta.rolePairWeights[agent.role] ** strength;
    }
    return weight;
  };
}

export function getCompositionSummary({ draft = [], takenAgentIds = new Set(), agents = AGENTS }) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const counts = Object.fromEntries(ROLES.map((role) => [role, 0]));
  [...draft, ...[...takenAgentIds].map((agentId) => byId.get(agentId)).filter(Boolean)]
    .forEach((agent) => {
      counts[agent.role] += 1;
    });
  return {
    counts,
    text: ROLES.map((role) => `${counts[role]} ${role}`).join(" · "),
  };
}

export function explainMapDraft({
  mapId,
  draft,
  takenAgentIds = new Set(),
  agents = AGENTS,
}) {
  const intel = getMapIntel(mapId);
  if (!intel || !draft?.length) return [];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const highlighted = draft
    .filter((agent) => (intel.agentWeights[agent.id] || 1) > 1)
    .sort(
      (left, right) =>
        intel.agentWeights[right.id] - intel.agentWeights[left.id] ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 3);
  const reasons = [];

  if (highlighted.length) {
    reasons.push(
      `${highlighted.map((agent) => agent.name).join(", ")} ${highlighted.length === 1 ? "is" : "are"} among ${intel.map.name}’s stronger local data signals.`,
    );
  } else {
    reasons.push(
      "Ownership and hard composition rules took priority; the legal result did not include a highlighted map pick.",
    );
  }

  const composition = getCompositionSummary({ draft, takenAgentIds, agents });
  const supportedRepeatedRole = ROLES.find(
    (role) =>
      composition.counts[role] === 2 && Boolean(intel.rolePairWeights[role]),
  );
  if (supportedRepeatedRole) {
    reasons.push(
      `The two-${supportedRepeatedRole} shape is intentional on ${intel.map.name}; the map model boosts that repeat without requiring it.`,
    );
  }

  if (intel.confidence !== "high") {
    reasons.push(
      `${intel.confidence[0].toUpperCase()}${intel.confidence.slice(1)} confidence: only ${intel.sampleSize} observed map appearances were available in this snapshot.`,
    );
  }
  return reasons;
}

export function observedAgentNames(mapId, agents = AGENTS, limit = 4) {
  const intel = getMapIntel(mapId);
  if (!intel) return [];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return intel.observed.slice(0, limit).map(({ agentId, pickRate }) => ({
    name: byId.get(agentId)?.name || agentId,
    pickRate,
  }));
}
