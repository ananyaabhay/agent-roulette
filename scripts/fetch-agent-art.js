/**
 * Fetch agent portraits into ./assets/agents/<id>.png
 *
 * app.js already expects these (data/agent-visuals.js -> getAgentVisualPath),
 * and falls back to the agent name as text when a file is missing — which is
 * why every card currently reads as text. This fills the gap.
 *
 * Run from the repo root:
 *   node scripts/fetch-agent-art.js
 *
 * Images are downloaded once and committed, rather than hotlinked, so the app
 * keeps working if the upstream host changes or goes down.
 */
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { AGENTS } from "../data/game-data.js";

const SOURCE = "https://valorant-api.com/v1/agents?isPlayableCharacter=true";
const OUT_DIR = new URL("../assets/agents/", import.meta.url);

// Upstream display names that don't match our ids by simple lowercasing.
const NAME_OVERRIDES = { kayo: "KAY/O" };

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const response = await fetch(SOURCE);
  if (!response.ok) {
    throw new Error(`Agent list request failed: ${response.status}`);
  }
  const { data } = await response.json();
  const upstream = new Map(
    data.map((agent) => [normalize(agent.displayName), agent]),
  );

  const missing = [];
  let written = 0;

  for (const agent of AGENTS) {
    const key = normalize(NAME_OVERRIDES[agent.id] || agent.name);
    const match = upstream.get(key);
    if (!match?.displayIcon) {
      missing.push(agent.name);
      continue;
    }

    const image = await fetch(match.displayIcon);
    if (!image.ok) {
      missing.push(`${agent.name} (image ${image.status})`);
      continue;
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    await writeFile(new URL(`${agent.id}.png`, OUT_DIR), bytes);
    written += 1;
    console.log(`  ${agent.id}.png  ${(bytes.length / 1024).toFixed(0)} KB`);
  }

  const onDisk = await readdir(OUT_DIR);
  console.log(`\nWrote ${written} of ${AGENTS.length} portraits.`);
  console.log(`assets/agents/ now holds ${onDisk.length} files.`);

  if (missing.length) {
    console.log(`\nNo image found for: ${missing.join(", ")}`);
    console.log(
      "Those agents will keep showing the text fallback. Add an entry to " +
        "NAME_OVERRIDES if the upstream display name differs from ours.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  console.error(
    "If this is a network error, check that valorant-api.com is reachable.",
  );
  process.exit(1);
});
