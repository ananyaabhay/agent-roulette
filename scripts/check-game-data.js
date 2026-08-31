/**
 * Detect when the live game has moved past our local snapshot.
 *
 * There is no official endpoint for the map rotation or for agent pick rates,
 * so nothing here can update map-meta.js on its own — the weights are a
 * reviewed, dated snapshot and should stay that way. What this can do is
 * notice drift and tell a human what to look at:
 *
 *   - a new patch number upstream
 *   - agents that exist in the game but not in data/game-data.js
 *   - maps that exist in the game but not in data/maps.js
 *
 * Exit code 0 means we are current. Exit code 2 means drift was found, which
 * the workflow turns into an issue.
 */
import { AGENTS } from "../data/game-data.js";
import { MAPS } from "../data/maps.js";
import { MAP_META_UPDATED_AT, MAP_META_VERSION } from "../data/map-meta.js";

const VERSION_URL = "https://valorant-api.com/v1/version";
const AGENTS_URL =
  "https://valorant-api.com/v1/agents?isPlayableCharacter=true";
const MAPS_URL = "https://valorant-api.com/v1/maps";

const normalize = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const payload = await response.json();
  return payload.data;
}

/** Pull "13.04" out of whatever shape the upstream version string takes. */
export function extractPatch(branchOrVersion) {
  const match = String(branchOrVersion || "").match(/(\d{1,2})\.(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : null;
}

export function findDrift({ upstreamPatch, upstreamAgents, upstreamMaps }) {
  const findings = [];

  const localPatch = extractPatch(MAP_META_VERSION);
  if (upstreamPatch && localPatch && upstreamPatch !== localPatch) {
    findings.push(
      `Patch moved: live game is on ${upstreamPatch}, our snapshot is ${localPatch} ` +
        `(taken ${MAP_META_UPDATED_AT}). Review the map rotation and refresh ` +
        `data/map-meta.js.`,
    );
  }

  const knownAgents = new Set(AGENTS.map((agent) => normalize(agent.name)));
  const newAgents = upstreamAgents
    .filter((agent) => !knownAgents.has(normalize(agent.displayName)))
    .map((agent) => agent.displayName);
  if (newAgents.length) {
    findings.push(
      `New agent(s) in the game and missing from data/game-data.js: ` +
        `${newAgents.join(", ")}. Add them, set the role, and run npm run fetch:art.`,
    );
  }

  const knownMaps = new Set(MAPS.map((map) => normalize(map.name)));
  const newMaps = upstreamMaps
    .filter((map) => map.displayName && !knownMaps.has(normalize(map.displayName)))
    .map((map) => map.displayName);
  if (newMaps.length) {
    findings.push(
      `Map(s) in the game and missing from data/maps.js: ${newMaps.join(", ")}.`,
    );
  }

  return findings;
}

async function main() {
  const [version, upstreamAgents, upstreamMaps] = await Promise.all([
    getJson(VERSION_URL),
    getJson(AGENTS_URL),
    getJson(MAPS_URL),
  ]);

  const upstreamPatch = extractPatch(version.branch || version.riotClientVersion);
  const findings = findDrift({ upstreamPatch, upstreamAgents, upstreamMaps });

  console.log(`Local snapshot : ${MAP_META_VERSION}`);
  console.log(`Live patch     : ${upstreamPatch || "unknown"}`);
  console.log(`Agents known   : ${AGENTS.length}`);
  console.log(`Maps known     : ${MAPS.length}\n`);

  if (!findings.length) {
    console.log("No drift. Local data still matches the live game.");
    return;
  }

  console.log("Drift detected:\n");
  findings.forEach((line) => console.log(`- ${line}`));
  process.exitCode = 2;
}

// Only run when invoked directly, so the pure functions stay testable.
if (process.argv[1] && process.argv[1].endsWith("check-game-data.js")) {
  main().catch((error) => {
    console.error(`Check failed: ${error.message}`);
    console.error("Upstream may be unreachable; this is not a data problem.");
    process.exit(1);
  });
}
