/**
 * Versioned, local game data.
 *
 * The app never needs a live API to spin. When Riot adds an agent, this is
 * the one roster file to update; the solver reads whatever data is exported.
 */
export const GAME_DATA_VERSION = "13.04-2026-08-31";

export const MAX_TEAM_SIZE = 5;
export const REROLL_BUDGET = 3;

export const ROLES = Object.freeze([
  "Duelist",
  "Initiator",
  "Controller",
  "Sentinel",
]);

export const ROLE_CSS_VARIABLES = Object.freeze({
  Duelist: "--duelist",
  Initiator: "--initiator",
  Controller: "--controller",
  Sentinel: "--sentinel",
});

export const AGENTS = Object.freeze([
  { id: "phoenix", name: "Phoenix", role: "Duelist", starter: true },
  { id: "jett", name: "Jett", role: "Duelist", starter: true },
  { id: "reyna", name: "Reyna", role: "Duelist", starter: false },
  { id: "raze", name: "Raze", role: "Duelist", starter: false },
  { id: "yoru", name: "Yoru", role: "Duelist", starter: false },
  { id: "neon", name: "Neon", role: "Duelist", starter: false },
  { id: "iso", name: "Iso", role: "Duelist", starter: false },
  { id: "waylay", name: "Waylay", role: "Duelist", starter: false },

  { id: "sova", name: "Sova", role: "Initiator", starter: true },
  { id: "breach", name: "Breach", role: "Initiator", starter: false },
  { id: "skye", name: "Skye", role: "Initiator", starter: false },
  { id: "kayo", name: "KAY/O", role: "Initiator", starter: false },
  { id: "fade", name: "Fade", role: "Initiator", starter: false },
  { id: "gekko", name: "Gekko", role: "Initiator", starter: false },
  { id: "tejo", name: "Tejo", role: "Initiator", starter: false },

  { id: "brimstone", name: "Brimstone", role: "Controller", starter: true },
  { id: "viper", name: "Viper", role: "Controller", starter: false },
  { id: "omen", name: "Omen", role: "Controller", starter: false },
  { id: "astra", name: "Astra", role: "Controller", starter: false },
  { id: "harbor", name: "Harbor", role: "Controller", starter: false },
  { id: "clove", name: "Clove", role: "Controller", starter: false },
  { id: "miks", name: "Miks", role: "Controller", starter: false },

  { id: "sage", name: "Sage", role: "Sentinel", starter: true },
  { id: "cypher", name: "Cypher", role: "Sentinel", starter: false },
  { id: "killjoy", name: "Killjoy", role: "Sentinel", starter: false },
  { id: "chamber", name: "Chamber", role: "Sentinel", starter: false },
  { id: "deadlock", name: "Deadlock", role: "Sentinel", starter: false },
  { id: "vyse", name: "Vyse", role: "Sentinel", starter: false },
  { id: "veto", name: "Veto", role: "Sentinel", starter: false },
].map(Object.freeze));

export const AGENT_BY_ID = new Map(AGENTS.map((agent) => [agent.id, agent]));
export const STARTER_AGENT_IDS = Object.freeze(
  AGENTS.filter((agent) => agent.starter).map((agent) => agent.id),
);

/**
 * Role targets describe the accounted-for side: stack players plus any known
 * outside teammate picks. They are deliberately role-aware, not map/meta-aware.
 */
export const ROLE_MINIMUMS_BY_TEAM_SIZE = Object.freeze({
  1: Object.freeze({}),
  2: Object.freeze({ Controller: 1 }),
  3: Object.freeze({ Controller: 1, Sentinel: 1 }),
  4: Object.freeze({ Controller: 1, Sentinel: 1, Initiator: 1 }),
  5: Object.freeze({ Controller: 1, Sentinel: 1, Initiator: 1, Duelist: 1 }),
});

export const ROLE_MAXIMUMS_BY_TEAM_SIZE = Object.freeze({
  1: Object.freeze({}),
  2: Object.freeze({}),
  3: Object.freeze({}),
  4: Object.freeze({ Duelist: 2, Controller: 2, Sentinel: 2 }),
  5: Object.freeze({ Duelist: 2, Initiator: 2, Controller: 2, Sentinel: 2 }),
});

/**
 * The draft-structure control has three named stops and nothing in between.
 * A continuous scale would need a defensible meaning for every position, and
 * there isn't one, so the slider is a segmented control that happens to slide.
 *
 * MAP_STRENGTH is an exponent on the map weights (w ** strength), fixed at the
 * calibrated value rather than exposed. Measured on Ascent over 4,000
 * five-stacks: strength 1 put Omen in 24% of drafts (barely above the 17%
 * baseline, which is why Map Smart felt inert), strength 4 puts him near 50%
 * with most of the roster still appearing, and strength 8 collapses the pool
 * to six agents.
 */
export const STRUCTURE_STOPS = Object.freeze([
  Object.freeze({
    id: "chaos",
    position: 0,
    label: "Total Chaos",
    mode: "chaos",
    mapStrength: 0,
    description:
      "No role targets. Ownership and distinct-agent rules still apply.",
  }),
  Object.freeze({
    id: "balanced",
    position: 1,
    label: "Role Balanced",
    mode: "balanced",
    mapStrength: 0,
    description:
      "Covers sensible role targets from the squad information you supply.",
  }),
  Object.freeze({
    id: "map",
    position: 2,
    label: "Map Smart",
    mode: "balanced",
    mapStrength: 4,
    description:
      "Every Role Balanced rule stays hard, then map data reorders the legal options.",
  }),
]);

export const STRUCTURE_MAX = STRUCTURE_STOPS.length - 1;
export const MAP_STRENGTH = 4;

export function resolveStructure(position) {
  const parsed = Math.round(Number(position));
  const index = Number.isFinite(parsed)
    ? Math.max(0, Math.min(STRUCTURE_MAX, parsed))
    : 1;
  return STRUCTURE_STOPS[index];
}
