import { AGENTS, ROLES } from "../data/game-data.js";
import { MAP_BY_ID } from "../data/maps.js";
import {
  MAP_META,
  MAP_META_SOURCES,
  MAP_META_UPDATED_AT,
  MAP_META_VERSION,
} from "../data/map-meta.js";

/**
 * Confidence scales recommendation influence toward neutral without changing
 * the configured map data. High-confidence snapshots keep the full weight,
 * medium snapshots keep 75%, and low snapshots keep 45%.
 */
export const MAP_CONFIDENCE_INFLUENCE = Object.freeze({
  high: 1,
  medium: 0.75,
  low: 0.45,
});

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

export function getMapConfidenceInfluence(mapId) {
  const confidence = MAP_META[mapId]?.confidence;
  return MAP_CONFIDENCE_INFLUENCE[confidence] ?? 0;
}

/**
 * Map influence begins with an exponent, then confidence blends it toward
 * neutral: w' = 1 + ((w ** strength) - 1) * confidenceInfluence.
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
  const confidenceInfluence = getMapConfidenceInfluence(mapId);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const outsideRoleCounts = Object.fromEntries(ROLES.map((role) => [role, 0]));
  takenAgentIds.forEach((agentId) => {
    const agent = byId.get(agentId);
    if (agent) outsideRoleCounts[agent.role] += 1;
  });

  return (agent, { roleCounts = {} } = {}) => {
    let configuredWeight = (meta.agentWeights[agent.id] || 1) ** strength;
    const accountedRoleCount =
      (roleCounts[agent.role] || 0) + outsideRoleCounts[agent.role];
    if (accountedRoleCount === 1 && meta.rolePairWeights[agent.role]) {
      configuredWeight *= meta.rolePairWeights[agent.role] ** strength;
    }
    return 1 + (configuredWeight - 1) * confidenceInfluence;
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

function formatAgentNames(agents) {
  return agents.map((agent) => agent.name).join(", ");
}

function filledNeedNote(draft, teamNeeds) {
  const filled = teamNeeds
    .filter((need) => need.state === "needed" && need.requiredFromStack > 0)
    .map((need) => ({
      need,
      agents: draft
        .filter((agent) => agent.role === need.role)
        .slice(0, need.requiredFromStack),
    }))
    .filter(({ need, agents }) => agents.length >= need.requiredFromStack);

  if (!filled.length) return "";
  if (filled.length === 1) {
    const [{ need, agents }] = filled;
    return `Filled team need: ${formatAgentNames(agents)} supplied the ${need.role} highlighted before the roll.`;
  }
  return `Filled team needs: ${filled
    .map(({ need, agents }) => `${formatAgentNames(agents)} supplied ${need.role}`)
    .join("; ")}.`;
}

/**
 * Build the single post-roll Notes list. Map data is intentionally ignored
 * unless the active stop is Map Smart, even when a remembered map is present.
 */
export function buildLineupNotes({
  structureId = "balanced",
  mode = "balanced",
  mapId = "",
  draft,
  takenAgentIds = new Set(),
  agents = AGENTS,
  mapStrength = 0,
  teamNeeds = [],
}) {
  if (!draft?.length) return [];
  const composition = getCompositionSummary({ draft, takenAgentIds, agents });
  if (mode === "chaos") {
    return [
      `Reference only — role recommendations were not enforced in Total Chaos. Generated lineup: ${composition.text}.`,
    ];
  }

  const reasons = [`Team comp: ${composition.text}.`];
  const needNote = filledNeedNote(draft, teamNeeds);
  if (needNote) reasons.push(needNote);

  if (structureId !== "map" || mapStrength <= 0 || !mapId) return reasons;
  const intel = getMapIntel(mapId);
  if (!intel) return reasons;

  const candidateWeight = createMapCandidateWeight({
    mapId,
    takenAgentIds,
    agents,
    strength: mapStrength,
  });
  const remainingNeededByRole = new Map(
    teamNeeds
      .filter((need) => need.state === "needed" && need.requiredFromStack > 0)
      .map((need) => [need.role, need.requiredFromStack]),
  );
  const roleCounts = Object.fromEntries(ROLES.map((role) => [role, 0]));
  const categories = { favoured: [], constrained: [], wildcard: [] };
  draft.forEach((agent) => {
    const weight = candidateWeight?.(agent, { roleCounts }) || 1;
    const fillsRequiredSlot = (remainingNeededByRole.get(agent.role) || 0) > 0;
    if (fillsRequiredSlot) {
      remainingNeededByRole.set(
        agent.role,
        remainingNeededByRole.get(agent.role) - 1,
      );
    }
    if (weight >= 1.25) categories.favoured.push(agent);
    else if (fillsRequiredSlot) categories.constrained.push(agent);
    else categories.wildcard.push(agent);
    roleCounts[agent.role] += 1;
  });

  if (categories.favoured.length) {
    reasons.push(
      `Map-favoured: ${formatAgentNames(categories.favoured)} received meaningful positive ${intel.map.name} weight.`,
    );
  }
  if (categories.constrained.length) {
    reasons.push(
      `Role / constraint-led: ${formatAgentNames(categories.constrained)} helped satisfy required role coverage.`,
    );
  }
  if (categories.wildcard.length) {
    reasons.push(
      `Wildcard roll: ${formatAgentNames(categories.wildcard)} ${categories.wildcard.length === 1 ? "was" : "were"} ${categories.wildcard.length === 1 ? "a legal random result" : "legal random results"} outside ${intel.map.name}’s stronger observed signals. Map Smart changes probability rather than forcing meta agents.`,
    );
  }

  const supportedRepeatedRole = ROLES.find(
    (role) =>
      composition.counts[role] === 2 && Boolean(intel.rolePairWeights[role]),
  );
  if (supportedRepeatedRole) {
    reasons.push(
      `Weighted shape: ${intel.map.name} gives a light boost to a second ${supportedRepeatedRole}; it is never required.`,
    );
  }

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
 * Plain-language disclosure of how much data sits behind a map. The same
 * confidence band also sets the transparent Map Smart influence multiplier.
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
