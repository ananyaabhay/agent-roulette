/**
 * Competitive map pool. Patch 13.08 (13 Oct 2026, start of V26 Act 6) put Bind
 * and Corrode in, and took Ascent and Split out.
 *
 * Note this is a different thing from MAP_META_VERSION, which dates the agent
 * pick-rate snapshot. The pool can move without the stats being refreshed, and
 * right now it has.
 */
export const MAP_POOL_VERSION = "13.08";

export const MAPS = Object.freeze([
  { id: "abyss", name: "Abyss" },
  { id: "bind", name: "Bind" },
  { id: "corrode", name: "Corrode" },
  { id: "haven", name: "Haven" },
  { id: "lotus", name: "Lotus" },
  { id: "summit", name: "Summit" },
  { id: "sunset", name: "Sunset" },
].map(Object.freeze));

export const MAP_BY_ID = new Map(MAPS.map((map) => [map.id, map]));
export const MAP_IDS = Object.freeze(MAPS.map((map) => map.id));
