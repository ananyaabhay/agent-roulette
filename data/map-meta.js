/**
 * Local, reviewable Map Smart inputs. Pick rates are rounded snapshots from
 * RIB.gg's public map-filtered Agent Stats table on 2026-08-31. Weights are
 * deliberately modest: they order legal candidates, never create legality.
 *
 * This version dates the STATS, not the map pool — see MAP_POOL_VERSION in
 * data/maps.js. The pool moved to 13.08 on 13 Oct 2026 while these stats are
 * still the 13.04 snapshot, which is exactly what the drift check should keep
 * reporting until someone refreshes them. Maps added by a rotation carry
 * confidence "none" until they have their own snapshot.
 */
export const MAP_META_VERSION = "13.04-2026-08-31";
export const MAP_META_UPDATED_AT = "2026-08-31";
export const MAP_META_SOURCES = Object.freeze({
  rotation: "https://playvalorant.com/en-gb/news/game-updates/valorant-patch-notes-13-04/",
  agentStats: "https://rib.gg/agents",
});

export const MAP_META = Object.freeze({
  abyss: freezeMap({
    confidence: "low",
    sampleSize: 26,
    agentWeights: { sova: 1.5, astra: 1.27, waylay: 1.25, yoru: 1.22, harbor: 1.18, omen: 1.16 },
    observed: [["sova", 100], ["astra", 57.7], ["waylay", 57.7], ["yoru", 53.8]],
    intel: "A small post-rotation sample strongly features Sova; Astra, Waylay, Yoru, Harbor, and Omen are lighter signals.",
  }),
  bind: freezeMap({
    // Rotated into Competitive with patch 13.08 on 13 Oct 2026. The RIB.gg
    // snapshot predates that, so there is no pick-rate data for this map yet
    // and inventing some would defeat the point of a dated snapshot.
    confidence: "none",
    sampleSize: 0,
    agentWeights: {},
    observed: [],
    intel: "Bind returned to the pool in patch 13.08. No pick-rate snapshot has been taken since, so Map Smart has nothing to work with here.",
  }),
  corrode: freezeMap({
    // Also back in with 13.08, and reworked in the same patch — defender
    // rotations, mid and A site all changed. Pre-rework data would describe a
    // map that no longer exists.
    confidence: "none",
    sampleSize: 0,
    agentWeights: {},
    observed: [],
    intel: "Corrode returned in patch 13.08 and was substantially reworked in the same patch. Any earlier data would describe a different map.",
  }),
  haven: freezeMap({
    confidence: "high",
    sampleSize: 584,
    agentWeights: { omen: 1.45, sova: 1.43, neon: 1.32, phoenix: 1.28, cypher: 1.25, fade: 1.08 },
    observed: [["omen", 86.6], ["sova", 85.1], ["neon", 73.6], ["phoenix", 66.6]],
    intel: "Omen and Sova form the strongest observed signals, followed by mobile Duelists and Cypher.",
  }),
  lotus: freezeMap({
    confidence: "high",
    sampleSize: 634,
    agentWeights: { omen: 1.48, fade: 1.39, raze: 1.32, vyse: 1.27, viper: 1.24, skye: 1.08 },
    rolePairWeights: { Initiator: 1.06 },
    observed: [["omen", 97.9], ["fade", 86.6], ["raze", 72.4], ["vyse", 63.4]],
    intel: "Omen and Fade lead a stable observed core. A second Initiator is possible, but remains a light preference rather than a rule.",
  }),
  summit: freezeMap({
    confidence: "medium",
    sampleSize: 224,
    agentWeights: { fade: 1.34, neon: 1.31, omen: 1.29, cypher: 1.23, phoenix: 1.14, sova: 1.12 },
    rolePairWeights: { Initiator: 1.12 },
    observed: [["fade", 64.7], ["neon", 60.7], ["omen", 59.8], ["cypher", 46], ["sova", 22.3]],
    intel: "The newer-map sample favours Fade, Neon, Omen, and Cypher; Sova gives a meaningful second Initiator signal.",
  }),
  sunset: freezeMap({
    confidence: "high",
    sampleSize: 302,
    agentWeights: { omen: 1.48, neon: 1.38, sova: 1.29, cypher: 1.24, chamber: 1.16, fade: 1.15 },
    rolePairWeights: { Initiator: 1.12 },
    observed: [["omen", 98], ["neon", 82.8], ["sova", 62.6], ["cypher", 57.3], ["fade", 33.1]],
    intel: "Omen and Neon are the clearest signals. Sova plus Fade makes a two-Initiator result a supported possibility.",
  }),
});

function freezeMap(value) {
  return Object.freeze({
    ...value,
    agentWeights: Object.freeze({ ...(value.agentWeights || {}) }),
    rolePairWeights: Object.freeze({ ...(value.rolePairWeights || {}) }),
    observed: Object.freeze(
      (value.observed || []).map(([agentId, pickRate]) =>
        Object.freeze({ agentId, pickRate }),
      ),
    ),
  });
}
