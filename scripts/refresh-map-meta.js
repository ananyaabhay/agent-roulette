/**
 * Rebuild data/map-meta.js from the pasted tables in data/raw/.
 *
 * No API returns "agent pick rate on Lotus" — Riot's official endpoints are
 * match-by-id, matchlist-by-puuid and recent-matches-by-queue, and the
 * aggregate is something the stats sites compute themselves. So the human step
 * is permanent. This exists to make it cheap enough that it actually happens,
 * instead of the snapshot quietly rotting for seven weeks the way 13.04 did.
 *
 * One file per map, named <mapId>.tsv, with a header block and a pasted table:
 *
 *   # patch: 13.08
 *   # date: 2026-10-22
 *   # sample: 634
 *   # source: https://www.vstats.gg/agents?map=lotus
 *   # population: ranked ladder
 *   # intel: Three sites, so a second Controller earns its keep.
 *   Omen	97.9
 *   Killjoy	88.5
 *
 * The raw file is committed alongside the generated data, so every number in
 * map-meta.js is traceable to a table somebody actually looked at, and a
 * refresh shows up in the PR diff as both the paste and its effect.
 *
 *   node scripts/refresh-map-meta.js            # rewrite data/map-meta.js
 *   node scripts/refresh-map-meta.js --check    # fail if it would change
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { AGENTS } from "../data/game-data.js";
import { MAPS } from "../data/maps.js";
import {
  MAP_META as EXISTING_META,
  MAP_META_SOURCES as EXISTING_SOURCES,
  MAP_META_UPDATED_AT as EXISTING_DATE,
  MAP_META_VERSION as EXISTING_VERSION,
} from "../data/map-meta.js";

const RAW_DIR = new URL("../data/raw/", import.meta.url);
const OUT_FILE = new URL("../data/map-meta.js", import.meta.url);

/**
 * Pick rate to candidate weight. Deliberately a straight line: a 100% agent
 * lands at WEIGHT_CEILING, a 0% agent at 1.0, nothing in between is special.
 * Anything cleverer would be a model nobody could check against the table.
 */
const WEIGHT_CEILING = 1.5;
const MIN_RATE = 25;
const TOP_N = 4;

export function rateToWeight(rate) {
  return Math.round((1 + (rate / 100) * (WEIGHT_CEILING - 1)) * 100) / 100;
}

export function confidenceFor(sampleSize) {
  if (sampleSize >= 400) return "high";
  if (sampleSize >= 100) return "medium";
  return "low";
}

const normalize = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseRawTable(text, { fileName, agents = AGENTS } = {}) {
  const byName = new Map(agents.map((agent) => [normalize(agent.name), agent]));
  const meta = {};
  const rows = [];
  const problems = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const header = trimmed.match(/^#\s*([a-z]+)\s*:\s*(.+)$/i);
    if (header) {
      meta[header[1].toLowerCase()] = header[2].trim();
      return;
    }
    if (trimmed.startsWith("#")) return;

    const cells = trimmed.split(/\t|\s{2,}|,/).map((cell) => cell.trim());
    const name = cells[0];
    const rate = Number.parseFloat(String(cells[1]).replace("%", ""));

    const agent = byName.get(normalize(name));
    if (!agent) {
      problems.push(`${fileName} line ${index + 1}: unknown agent "${name}"`);
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      problems.push(
        `${fileName} line ${index + 1}: "${cells[1]}" is not a pick rate between 0 and 100`,
      );
      return;
    }
    rows.push({ agent, rate });
  });

  for (const key of ["patch", "date", "sample", "source", "population"]) {
    if (!meta[key]) problems.push(`${fileName}: missing "# ${key}:" header`);
  }
  if (!rows.length) problems.push(`${fileName}: no agent rows found`);

  const sampleSize = Number.parseInt(meta.sample, 10);
  if (meta.sample && !Number.isFinite(sampleSize)) {
    problems.push(`${fileName}: "# sample:" must be a number of games`);
  }

  rows.sort((left, right) => right.rate - left.rate);
  return { meta: { ...meta, sampleSize }, rows, problems };
}

export function buildMapEntry({ meta, rows }, existing = {}) {
  const weights = {};
  rows
    .filter((row) => row.rate >= MIN_RATE)
    .forEach((row) => {
      weights[row.agent.id] = rateToWeight(row.rate);
    });

  return {
    // rolePairWeights are a hand-made judgement (Split wants two Controllers),
    // not something a pick-rate table contains, so a refresh carries them over
    // rather than quietly deleting them.
    ...(existing.rolePairWeights
      ? { rolePairWeights: existing.rolePairWeights }
      : {}),
    confidence: confidenceFor(meta.sampleSize),
    sampleSize: meta.sampleSize,
    agentWeights: weights,
    observed: rows.slice(0, TOP_N).map((row) => ({ agentId: row.agent.id })),
    intel: meta.intel || "",
    source: meta.source,
    population: meta.population,
  };
}

function serializeEntry(entry) {
  // JSON quotes its keys, which is still a valid object literal, and it copies
  // keys this script doesn't know about (rolePairWeights and anything added
  // later) rather than silently dropping them.
  return JSON.stringify(entry, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join("\n");
}

function renderFile(entries, { patch, date, sources }) {
  const body = MAPS.map((map) => {
    // A map keeps whatever it already had until someone adds its table, so the
    // migration is one map at a time and never loses data in between.
    const entry = entries.get(map.id) || EXISTING_META[map.id];
    if (!entry) {
      return `  ${map.id}: freezeMap({
    // No table in data/raw/${map.id}.tsv yet, so this map carries no weights.
    confidence: "none",
    sampleSize: 0,
    agentWeights: {},
    observed: [],
    intel: "No pick-rate snapshot has been taken for this map yet.",
  }),`;
    }
    const origin = entries.has(map.id)
      ? `    // from data/raw/${map.id}.tsv · ${entry.source}\n`
      : "";
    const { source, ...stored } = entry;
    return `  ${map.id}: freezeMap(${origin ? "\n" + origin + "    " : ""}${serializeEntry(stored)}),`;
  }).join("\n");

  return `// GENERATED by scripts/refresh-map-meta.js — do not edit by hand.
// Every number here comes from a committed table in data/raw/, so it can be
// checked against what somebody actually pasted. Re-run the script instead of
// editing: npm run refresh:maps
import { MAP_BY_ID } from "./maps.js";

export const MAP_META_VERSION = "${patch}-${date}";
export const MAP_META_UPDATED_AT = "${date}";

export const MAP_META_SOURCES = Object.freeze(${JSON.stringify(sources, null, 2)});

const freezeMap = (value) => Object.freeze(value);

export const MAP_META = Object.freeze({
${body}
});

export function getMapIntel(mapId) {
  const meta = MAP_META[mapId];
  const map = MAP_BY_ID.get(mapId);
  if (!meta || !map) return null;
  return { ...meta, map };
}
`;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  let fileNames = [];
  try {
    fileNames = (await readdir(RAW_DIR)).filter((name) => name.endsWith(".tsv"));
  } catch (error) {
    console.error(
      "data/raw/ not found. Create it and add one <mapId>.tsv per map.",
    );
    process.exit(1);
  }

  const knownMapIds = new Set(MAPS.map((map) => map.id));
  const entries = new Map();
  const problems = [];
  let newestPatch = "";
  let newestDate = "";

  for (const fileName of fileNames.sort()) {
    const mapId = fileName.replace(/\.tsv$/, "");
    if (!knownMapIds.has(mapId)) {
      problems.push(
        `${fileName}: "${mapId}" is not a map in data/maps.js — the pool may have rotated`,
      );
      continue;
    }
    const text = await readFile(new URL(fileName, RAW_DIR), "utf8");
    const parsed = parseRawTable(text, { fileName });
    problems.push(...parsed.problems);
    if (parsed.problems.length) continue;

    entries.set(mapId, buildMapEntry(parsed, EXISTING_META[mapId] || {}));
    if (parsed.meta.date > newestDate) {
      newestDate = parsed.meta.date;
      newestPatch = parsed.meta.patch;
    }
  }

  if (problems.length) {
    console.error("Refusing to write. Fix these first:\n");
    problems.forEach((line) => console.error(`  - ${line}`));
    process.exit(1);
  }

  const missing = MAPS.filter(
    (map) => !entries.has(map.id) && !EXISTING_META[map.id],
  ).map((map) => map.name);
  // A refreshed table supplies its own agent-stats URL; the rotation link is
  // whatever was last recorded by hand.
  const refreshedSource = [...entries.values()].find((entry) => entry.source);
  const output = renderFile(entries, {
    patch: newestPatch || EXISTING_VERSION.split("-")[0],
    date: newestDate || EXISTING_DATE,
    sources: {
      ...EXISTING_SOURCES,
      ...(refreshedSource ? { agentStats: refreshedSource.source } : {}),
    },
  });

  if (checkOnly) {
    const current = await readFile(OUT_FILE, "utf8");
    if (current !== output) {
      console.error("data/map-meta.js is out of date with data/raw/.");
      console.error("Run: npm run refresh:maps");
      process.exit(2);
    }
    console.log("data/map-meta.js matches data/raw/.");
    return;
  }

  await writeFile(OUT_FILE, output, "utf8");
  console.log(`Wrote data/map-meta.js from ${entries.size} table(s).`);
  console.log(`Snapshot: patch ${newestPatch}, ${newestDate}`);
  if (missing.length) {
    console.log(`\nStill without any data: ${missing.join(", ")}`);
    console.log("Those maps carry no weights until a table is added.");
  }
}

if (process.argv[1] && process.argv[1].endsWith("refresh-map-meta.js")) {
  main().catch((error) => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  });
}
