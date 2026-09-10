/**
 * Prepare review artifacts without editing tracked files or writing remotely.
 *
 * The only patch this script can currently produce updates the explicit game
 * identity validation marker after roster, role, and starter data all match.
 * Map rotation and professional statistics remain human-reviewed inputs.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENTS,
  GAME_DATA_VERSION,
  GAME_IDENTITY_VALIDATED_PATCH,
} from "../data/game-data.js";
import {
  MAP_META,
  MAP_META_UPDATED_AT,
  MAP_META_VERSION,
} from "../data/map-meta.js";
import { MAP_BY_ID, MAP_POOL_VERSION } from "../data/maps.js";
import {
  analyzeDataHealth,
  compareAgentRoster,
  extractPatch,
  fetchLiveGameData,
} from "./check-game-data.js";

const GAME_DATA_PATH = new URL("../data/game-data.js", import.meta.url);
const REPORT_FILENAME = "maintenance-report.md";
const PATCH_FILENAME = "agent-roulette-maintenance.patch";

export const VERIFIED_PATCH_REVIEWS = Object.freeze({
  "13.05": Object.freeze({
    competitiveRotationChanged: false,
    gameplayDataChangeRequired: false,
    sourceUrl:
      "https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-05/",
  }),
});

const formatDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));

const mapName = (mapId) => MAP_BY_ID.get(mapId)?.name || mapId;

const hasRosterDifferences = (roster) =>
  !roster.roleDataComplete ||
  !roster.starterDataComplete ||
  [
    roster.additions,
    roster.removals,
    roster.renamedAgents,
    roster.roleDifferences,
    roster.starterDifferences,
  ].some((items) => items.length);

const isPatchNewer = (candidate, current) => {
  const next = extractPatch(candidate)?.split(".").map(Number);
  const previous = extractPatch(current)?.split(".").map(Number);
  if (!next || !previous) return false;
  return (
    next[0] > previous[0] ||
    (next[0] === previous[0] && next[1] > previous[1])
  );
};

export function createIdentityValidationPatch(source, targetPatch) {
  const patch = extractPatch(targetPatch);
  if (!patch) return null;

  const lines = String(source).split(/\r?\n/);
  const declaration =
    /^export const GAME_IDENTITY_VALIDATED_PATCH = "(\d{1,2}\.\d{2})";$/;
  const matches = lines
    .map((line, index) => ({ index, match: line.match(declaration) }))
    .filter(({ match }) => match);
  if (matches.length !== 1 || matches[0].match[1] === patch) return null;

  const changedIndex = matches[0].index;
  const start = Math.max(0, changedIndex - 3);
  const end = Math.min(lines.length, changedIndex + 4);
  const oldLines = lines.slice(start, end);
  const newLines = [...oldLines];
  newLines[changedIndex - start] =
    `export const GAME_IDENTITY_VALIDATED_PATCH = "${patch}";`;

  const body = oldLines.flatMap((line, index) =>
    index === changedIndex - start
      ? [`-${line}`, `+${newLines[index]}`]
      : [` ${line}`],
  );
  return [
    "diff --git a/data/game-data.js b/data/game-data.js",
    "--- a/data/game-data.js",
    "+++ b/data/game-data.js",
    `@@ -${start + 1},${oldLines.length} +${start + 1},${newLines.length} @@`,
    ...body,
    "",
  ].join("\n");
}

function formatRoster(lines, roster) {
  if (!roster.additions.length && !roster.removals.length) {
    lines.push(`✓ ${roster.upstreamCount} agents match`);
  }
  roster.additions.forEach((agent) => {
    lines.push(`⚠ New upstream agent detected: ${agent.displayName}`);
    lines.push(`  - UUID: ${agent.uuid || "Unavailable"}`);
    lines.push(`  - Role: ${agent.role || "Unavailable"}`);
    lines.push("  - Agent art still needs review/import.");
  });
  roster.removals.forEach((agent) => {
    lines.push(
      `⚠ Local agent absent upstream: ${agent.name} — do not remove automatically`,
    );
  });
  roster.renamedAgents.forEach((agent) => {
    lines.push(
      `⚠ Display-name difference: ${agent.localName} → ${agent.upstreamName}`,
    );
  });
  if (!roster.roleDataComplete) {
    lines.push("⚠ Upstream role data is incomplete");
  } else if (roster.roleDifferences.length) {
    roster.roleDifferences.forEach((agent) => {
      lines.push(
        `⚠ Role difference: ${agent.name} (${agent.localRole} → ${agent.upstreamRole})`,
      );
    });
  } else {
    lines.push("✓ Agent roles match");
  }
  if (!roster.starterDataComplete) {
    lines.push("⚠ Upstream starter data is incomplete");
  } else if (roster.starterDifferences.length) {
    roster.starterDifferences.forEach((agent) => {
      lines.push(`⚠ Starter configuration differs for ${agent.name}`);
    });
  } else {
    lines.push("✓ Starter configuration matches");
  }
}

export function buildMaintenanceReview({
  upstreamPatch,
  upstreamAgents = [],
  now = new Date(),
  localAgents = AGENTS,
  mapMeta = MAP_META,
  snapshotVersion = MAP_META_VERSION,
  snapshotUpdatedAt = MAP_META_UPDATED_AT,
  mapPoolVersion = MAP_POOL_VERSION,
  gameDataVersion = GAME_DATA_VERSION,
  identityValidatedPatch = GAME_IDENTITY_VALIDATED_PATCH,
  gameDataSource = null,
  verifiedPatchReviews = VERIFIED_PATCH_REVIEWS,
}) {
  const livePatch = extractPatch(upstreamPatch);
  const health = analyzeDataHealth({
    upstreamPatch,
    upstreamAgents,
    now,
    localAgents,
    mapMeta,
    snapshotVersion,
    snapshotUpdatedAt,
  });
  const roster = compareAgentRoster({ upstreamAgents, localAgents });
  const identityMatches = !hasRosterDifferences(roster);
  const knownReview = verifiedPatchReviews[livePatch] || null;
  const rotationNeedsReview = Boolean(
    !livePatch ||
      (livePatch !== extractPatch(mapPoolVersion) &&
        knownReview?.competitiveRotationChanged !== false),
  );
  const shouldUpdateIdentityMarker = Boolean(
    livePatch &&
      identityMatches &&
      isPatchNewer(livePatch, identityValidatedPatch),
  );
  const proposedPatch =
    shouldUpdateIdentityMarker && gameDataSource
      ? createIdentityValidationPatch(gameDataSource, livePatch)
      : null;
  const lowConfidenceMaps = Object.entries(mapMeta)
    .filter(([, meta]) => meta.confidence === "low")
    .map(([mapId, meta]) => ({
      name: mapName(mapId),
      sampleSize: meta.sampleSize,
    }));
  const generated = new Date(now).toISOString().slice(0, 10);
  const lines = [
    "# Agent Roulette maintenance review",
    "",
    `Generated: ${generated}`,
    "",
    "## Live game",
    "",
    `Patch: ${livePatch || "Unknown"}`,
    "",
    "## Agent roster",
    "",
  ];
  formatRoster(lines, roster);

  lines.push("", "## Competitive maps", "");
  if (knownReview?.competitiveRotationChanged === false) {
    lines.push("✓ No rotation change found from verified source");
    lines.push(`Source: ${knownReview.sourceUrl}`);
  } else if (rotationNeedsReview) {
    lines.push("⚠ Competitive map rotation requires human verification.");
  } else {
    lines.push("✓ No rotation review triggered by patch drift");
  }

  lines.push(
    "",
    "## Map Smart",
    "",
    `Snapshot patch: ${health.snapshotPatch || "Unknown"}`,
    `Last updated: ${formatDate(snapshotUpdatedAt)}`,
    `Age: ${health.snapshotAgeDays} days`,
  );
  if (lowConfidenceMaps.length) {
    lines.push("", "Low confidence:");
    lowConfidenceMaps.forEach((map) => {
      lines.push(`- ${map.name}: ${map.sampleSize} professional matches`);
    });
  } else {
    lines.push("", "✓ No low-confidence maps");
  }
  if (health.patchDrift) {
    lines.push("", "⚠ Statistical snapshot has not been refreshed.");
  }
  if (health.snapshotStale) {
    lines.push(`⚠ Snapshot is at least 14 days old (${health.snapshotAgeDays} days).`);
  }

  if (
    knownReview?.gameplayDataChangeRequired === false &&
    identityMatches
  ) {
    lines.push(
      "",
      `## Patch ${livePatch} review`,
      "",
      "✓ Agent roster unchanged",
      "✓ Agent roles unchanged",
      "✓ Starter configuration unchanged",
      "✓ Competitive map rotation unchanged",
      "✓ No Map Smart refresh applied",
      "→ No gameplay-data change required",
    );
  }

  lines.push("", "## Suggested changes", "");
  if (proposedPatch) {
    lines.push(
      `Update GAME_IDENTITY_VALIDATED_PATCH from ${identityValidatedPatch} to ${livePatch}.`,
      "No gameplay or Map Smart data is included in the proposed patch.",
    );
  } else {
    lines.push("No product-data changes can be safely generated.");
  }
  lines.push(
    "",
    `GAME_DATA_VERSION remains ${gameDataVersion}; identity validation is tracked separately.`,
  );

  const manualReview = [];
  if (roster.additions.length) manualReview.push("Agent art and local identity data.");
  if (
    !roster.roleDataComplete ||
    !roster.starterDataComplete ||
    roster.removals.length ||
    roster.renamedAgents.length ||
    roster.roleDifferences.length ||
    roster.starterDifferences.length
  ) {
    manualReview.push("Reported agent identity differences.");
  }
  if (rotationNeedsReview) manualReview.push("Competitive map rotation.");
  if (health.patchDrift || health.snapshotStale) {
    manualReview.push("Professional map statistics require review.");
  }
  if (lowConfidenceMaps.length) {
    manualReview.push(
      `Low-confidence map evidence: ${lowConfidenceMaps.map((map) => map.name).join(", ")}.`,
    );
  }
  lines.push("", "## Manual review still required", "");
  lines.push(...(manualReview.length ? manualReview.map((item) => `- ${item}`) : ["- None."]));
  lines.push(
    "",
    "Nothing was committed, pushed, deployed, or applied automatically.",
    "",
  );

  return {
    health,
    identityMatches,
    patch: proposedPatch,
    report: lines.join("\n"),
    roster,
  };
}

function outputDirectory(args) {
  const index = args.indexOf("--output-dir");
  return path.resolve(index >= 0 && args[index + 1] ? args[index + 1] : "maintenance-output");
}

async function writeArtifacts(outputDir, review) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, REPORT_FILENAME), review.report, "utf8");
  const patchPath = path.join(outputDir, PATCH_FILENAME);
  if (review.patch) {
    await writeFile(patchPath, review.patch, "utf8");
  } else {
    await rm(patchPath, { force: true });
  }
}

async function main() {
  const outputDir = outputDirectory(process.argv.slice(2));
  try {
    const [liveData, gameDataSource] = await Promise.all([
      fetchLiveGameData(),
      readFile(GAME_DATA_PATH, "utf8"),
    ]);
    const review = buildMaintenanceReview({ ...liveData, gameDataSource });
    await writeArtifacts(outputDir, review);
    console.log(review.report);
  } catch (error) {
    const generated = new Date().toISOString().slice(0, 10);
    const report = [
      "# Agent Roulette maintenance review",
      "",
      `Generated: ${generated}`,
      "",
      "## Live game",
      "",
      "⚠ Live data could not be retrieved; no maintenance patch was generated.",
      "",
      "## Manual review still required",
      "",
      "- Retry the structured live-data check.",
      "",
      "Nothing was committed, pushed, deployed, or applied automatically.",
      "",
    ].join("\n");
    await writeArtifacts(outputDir, { patch: null, report });
    console.error(`Maintenance preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("prepare-data-maintenance.js")) {
  main();
}
