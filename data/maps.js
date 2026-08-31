export const MAP_POOL_VERSION = "13.04";

export const MAPS = Object.freeze([
  { id: "abyss", name: "Abyss" },
  { id: "ascent", name: "Ascent" },
  { id: "haven", name: "Haven" },
  { id: "lotus", name: "Lotus" },
  { id: "split", name: "Split" },
  { id: "summit", name: "Summit" },
  { id: "sunset", name: "Sunset" },
].map(Object.freeze));

export const MAP_BY_ID = new Map(MAPS.map((map) => [map.id, map]));
export const MAP_IDS = Object.freeze(MAPS.map((map) => map.id));
