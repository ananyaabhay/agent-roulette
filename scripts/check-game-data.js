/**
 * Report reviewable drift without changing any product data.
 *
 * Valorant-API provides a useful live patch and playable-agent roster, but not
 * a trustworthy Competitive map rotation. Map rotation therefore becomes a
 * human review item after patch drift instead of an automated map comparison.
 */
import { createHash } from "node:crypto";

import { AGENTS } from "../data/game-data.js";
import { MAP_BY_ID } from "../data/maps.js";
import {
  MAP_META,
  MAP_META_UPDATED_AT,
  MAP_META_VERSION,
} from "../data/map-meta.js";

const VERSION_URL = "https://valorant-api.com/v1/version";
const AGENTS_URL =
  "https://valorant-api.com/v1/agents?isPlayableCharacter=true";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const SNAPSHOT_REVIEW_DAYS = 14;
export const MANAGED_ISSUE_MARKER = "<!-- agent-roulette-data-health -->";

export const normalizeAgentName = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const payload = await response.json();
  return payload.data;
}

export async function fetchLiveGameData() {
  const [version, upstreamAgents] = await Promise.all([
    getJson(VERSION_URL),
    getJson(AGENTS_URL),
  ]);
  return {
    upstreamPatch: version.branch || version.riotClientVersion,
    upstreamAgents,
  };
}

/** Pull "13.04" out of whatever shape the upstream version string takes. */
export function extractPatch(branchOrVersion) {
  const match = String(branchOrVersion || "").match(/(\d{1,2})\.(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : null;
}

function mapName(mapId) {
  return MAP_BY_ID.get(mapId)?.name ||
    mapId.charAt(0).toUpperCase() + mapId.slice(1);
}

function dayLabel(days) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function compareAgentRoster({
  upstreamAgents = [],
  localAgents = AGENTS,
}) {
  const localByName = new Map(
    localAgents.map((agent) => [normalizeAgentName(agent.name), agent]),
  );
  const upstreamByName = new Map(
    upstreamAgents
      .filter((agent) => agent.displayName)
      .map((agent) => [normalizeAgentName(agent.displayName), agent]),
  );
  const additions = [...upstreamByName]
    .filter(([key]) => !localByName.has(key))
    .map(([, agent]) => ({
      displayName: agent.displayName,
      role: agent.role?.displayName || null,
      uuid: agent.uuid || null,
    }));
  const removals = [...localByName]
    .filter(([key]) => !upstreamByName.has(key))
    .map(([, agent]) => ({ name: agent.name, role: agent.role }));
  const matches = [...upstreamByName]
    .filter(([key]) => localByName.has(key))
    .map(([key, upstream]) => ({ local: localByName.get(key), upstream }));
  const renamedAgents = matches
    .filter(({ local, upstream }) => local.name !== upstream.displayName)
    .map(({ local, upstream }) => ({
      localName: local.name,
      upstreamName: upstream.displayName,
    }));
  const roleDifferences = matches
    .filter(
      ({ local, upstream }) =>
        upstream.role?.displayName && local.role !== upstream.role.displayName,
    )
    .map(({ local, upstream }) => ({
      name: local.name,
      localRole: local.role,
      upstreamRole: upstream.role.displayName,
    }));
  const starterDifferences = matches
    .filter(
      ({ local, upstream }) =>
        typeof upstream.isBaseContent === "boolean" &&
        local.starter !== upstream.isBaseContent,
    )
    .map(({ local, upstream }) => ({
      name: local.name,
      localStarter: local.starter,
      upstreamStarter: upstream.isBaseContent,
    }));

  return {
    additions,
    removals,
    renamedAgents,
    roleDataComplete:
      upstreamByName.size > 0 &&
      [...upstreamByName.values()].every((agent) => agent.role?.displayName),
    roleDifferences,
    starterDataComplete:
      upstreamByName.size > 0 &&
      [...upstreamByName.values()].every(
        (agent) => typeof agent.isBaseContent === "boolean",
      ),
    starterDifferences,
    upstreamCount: upstreamByName.size,
  };
}

export function formatHealthReport(health) {
  const lines = [
    MANAGED_ISSUE_MARKER,
    `<!-- agent-roulette-data-health-status:${health.signature} -->`,
    "## Data health check",
    "",
    `Live VALORANT patch: ${health.livePatch || "Unknown"}`,
    `Map Smart snapshot patch: ${health.snapshotPatch || "Unknown"}`,
    `Snapshot age: ${dayLabel(health.snapshotAgeDays)}`,
    "",
    "### Agent roster",
  ];

  if (health.missingAgents.length) {
    health.missingAgents.forEach((name) => {
      lines.push(`🔴 New playable agent detected: ${name}`);
    });
  } else {
    lines.push(
      `✓ ${health.agentCount} / ${health.agentCount} playable agents match local data`,
    );
  }

  lines.push("", "### Competitive map rotation");
  if (!health.livePatch) {
    lines.push("⚠ Live patch could not be determined — review recommended");
  } else if (health.patchDrift) {
    lines.push("⚠ Review recommended after patch change");
  } else {
    lines.push("✓ No review triggered by patch drift");
  }

  lines.push("", "### Map Smart snapshot");
  if (health.patchDrift) {
    lines.push(
      "⚠ Meta snapshot is behind the live game patch — review recommended",
    );
  }
  lines.push(
    health.snapshotStale
      ? `⚠ ${dayLabel(health.snapshotAgeDays)} old — review recommended`
      : `✓ ${dayLabel(health.snapshotAgeDays)} old`,
  );

  lines.push("", "### Low-confidence maps");
  lines.push(
    health.lowConfidenceMaps.length
      ? `⚠ ${health.lowConfidenceMaps.join(", ")}`
      : "✓ None",
  );

  lines.push("", "### Recommended action");
  if (health.missingAgents.length) {
    lines.push("Update local game data and agent art.");
  } else if (health.needsAttention) {
    lines.push("Review the meta snapshot before the next refresh.");
  } else {
    lines.push("No action needed.");
  }
  lines.push("", "Nothing was changed automatically.");
  return lines.join("\n");
}

export function analyzeDataHealth({
  upstreamPatch,
  upstreamAgents = [],
  now = new Date(),
  localAgents = AGENTS,
  mapMeta = MAP_META,
  snapshotVersion = MAP_META_VERSION,
  snapshotUpdatedAt = MAP_META_UPDATED_AT,
}) {
  const livePatch = extractPatch(upstreamPatch);
  const snapshotPatch = extractPatch(snapshotVersion);
  const patchDrift = Boolean(
    livePatch && snapshotPatch && livePatch !== snapshotPatch,
  );
  const snapshotAgeDays = Math.max(
    0,
    Math.floor(
      (new Date(now).getTime() - Date.parse(`${snapshotUpdatedAt}T00:00:00Z`)) /
        DAY_IN_MS,
    ),
  );
  const snapshotStale = snapshotAgeDays >= SNAPSHOT_REVIEW_DAYS;

  const roster = compareAgentRoster({ upstreamAgents, localAgents });
  const missingAgents = roster.additions.map((agent) => agent.displayName);
  // "unstated" is a table that never published its game count, which is at
  // least as weak as a small counted sample — it must not slip through.
  const WEAK_CONFIDENCE = new Set(["low", "unstated", "none"]);
  const lowConfidenceMapIds = Object.entries(mapMeta)
    .filter(([, meta]) => WEAK_CONFIDENCE.has(meta.confidence))
    .map(([mapId]) => mapId)
    .sort();
  const lowConfidenceMaps = lowConfidenceMapIds.map(mapName);
  const needsAttention = Boolean(
    !livePatch ||
      patchDrift ||
      snapshotStale ||
      missingAgents.length ||
      lowConfidenceMaps.length,
  );
  const level = missingAgents.length
    ? "action"
    : needsAttention
      ? "review"
      : "healthy";
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        livePatch: livePatch || "unknown",
        snapshotVersion,
        snapshotUpdatedAt,
        snapshotFreshness: snapshotStale ? "stale" : "fresh",
        missingAgents: missingAgents.map(normalizeAgentName).sort(),
        lowConfidenceMapIds,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const health = {
    agentCount: roster.upstreamCount,
    level,
    livePatch,
    lowConfidenceMaps,
    missingAgents,
    needsAttention,
    patchDrift,
    signature,
    snapshotAgeDays,
    snapshotPatch,
    snapshotStale,
  };
  return { ...health, report: formatHealthReport(health) };
}

export function extractReportSignature(text) {
  return String(text || "").match(
    /<!-- agent-roulette-data-health-status:([a-f0-9]+) -->/,
  )?.[1] || null;
}

export function decideIssueAction({
  currentSignature,
  issueState,
  needsAttention,
  previousSignature,
}) {
  if (!needsAttention) return issueState === "open" ? "close" : "none";
  if (!issueState) return "create";
  const changed = currentSignature !== previousSignature;
  if (issueState === "closed") {
    return changed ? "reopen-and-comment" : "reopen";
  }
  return changed ? "comment" : "none";
}

async function main() {
  const health = analyzeDataHealth(await fetchLiveGameData());
  console.log(health.report);
  if (health.needsAttention) process.exitCode = 2;
}

// Only run when invoked directly, so the pure functions stay testable.
if (process.argv[1] && process.argv[1].endsWith("check-game-data.js")) {
  main().catch((error) => {
    console.error(`Check failed: ${error.message}`);
    console.error("Upstream may be unreachable; this is not a data problem.");
    process.exit(1);
  });
}
