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
  mapStrength = 0,
}) {
  const intel = getMapIntel(mapId);
  if (!intel || !draft?.length) return [];
  // At Role Balanced the map data touched nothing, so the panel must not imply
  // it did. Saying "these were chosen because of the map" when the weight was
  // zero is the single most misleading thing this screen could do.
  if (mapStrength <= 0) {
    return [
      `Your draft ignored this map entirely — Role Balanced applies no map influence. Shown for interest only.`,
      describeMapEvidence(mapId),
    ];
  }
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
      `${highlighted.map((agent) => agent.name).join(", ")} ${highlighted.length === 1 ? "is" : "are"} among the agents seen most often on ${intel.map.name} in our snapshot.`,
    );
  } else {
    reasons.push(
      `Nobody in this squad is a frequent ${intel.map.name} pick in our snapshot. That is not a problem — it just means the draft landed elsewhere.`,
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

  reasons.push(describeMapEvidence(mapId));
  return reasons;
}

/**
 * The most-seen agents on a map, in order, without numbers.
 *
 * The snapshot sizes range from 26 appearances to 634. Printing "57.7%" off 26
 * observations implies a precision the sample cannot carry — that figure is
 * 15 of 26, and one more game moves it four points. Order survives a small
 * sample; a decimal place does not. So every map shows a ranked list and the
 * raw count of games behind it, and the reader judges the weight themselves.
 */
export function observedAgentNames(mapId, agents = AGENTS, limit = 4) {
  const intel = getMapIntel(mapId);
  if (!intel) return [];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return intel.observed
    .slice(0, limit)
    .map(({ agentId }) => byId.get(agentId)?.name || agentId);
}

/**
 * Where the snapshot comes from. This matters more than sample size: the
 * source is professional match data, and a coordinated five-stack running a
 * solved meta picks nothing like an ordinary lobby. Omen at 94% on Ascent
 * describes VCT stages, not a Friday night in Unrated.
 */
export const MAP_EVIDENCE_CAVEAT =
  "This is professional play, not the ranked ladder — coordinated teams pick very differently from a normal lobby.";

/**
 * Plain-language disclosure of how much data sits behind a map. Confidence is
 * never applied to the weighting — every map is treated identically by the
 * solver — so this exists purely to let the reader discount what they see.
 */
export function describeMapEvidence(mapId) {
  const intel = getMapIntel(mapId);
  if (!intel) return "";
  if (intel.confidence === "high") {
    return `Drawn from ${intel.sampleSize} recorded professional matches on this map — enough to show a real pattern.`;
  }
  if (intel.confidence === "medium") {
    return `Drawn from ${intel.sampleSize} recorded professional matches. A moderate sample, so treat the order as a hint rather than a fact.`;
  }
  return `Drawn from only ${intel.sampleSize} recorded professional matches. That is too few to be reliable — a handful of games could reorder this entirely.`;
}
