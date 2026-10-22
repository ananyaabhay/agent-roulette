// Drift detection and the map-evidence presentation rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AGENTS,
  GAME_IDENTITY_VALIDATED_PATCH,
} from "../data/game-data.js";
import { MAP_META } from "../data/map-meta.js";
import { MAPS } from "../data/maps.js";
import {
  confidenceFor,
  parseRawTable,
  rateToWeight,
} from "../scripts/refresh-map-meta.js";
import { UPCOMING_AGENTS } from "../data/upcoming.js";
import { getUpcomingAgentNotice } from "../logic/upcoming.js";
import {
  analyzeDataHealth,
  decideIssueAction,
  extractPatch,
} from "../scripts/check-game-data.js";
import {
  buildMaintenanceReview,
  createIdentityValidationPatch,
} from "../scripts/prepare-data-maintenance.js";
import {
  createMapCandidateWeight,
  getMapConfidenceInfluence,
  MAP_EVIDENCE_CAVEAT,
  MAP_CONFIDENCE_INFLUENCE,
  mapEvidenceCaveat,
  buildLineupNotes,
  describeMapEvidence,
  observedAgentNames,
} from "../logic/recommendations.js";

const currentAgents = AGENTS.map((agent) => ({ displayName: agent.name }));
const currentIdentityAgents = AGENTS.map((agent, index) => ({
  displayName: agent.name,
  isBaseContent: agent.starter,
  role: { displayName: agent.role },
  uuid: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
}));
const gameDataSource = [
  'export const GAME_DATA_VERSION = "13.04-2026-08-31";',
  "",
  "// Roster, role, and starter identity only; this does not imply that Map Smart",
  "// statistics or the Competitive map rotation were refreshed.",
  `export const GAME_IDENTITY_VALIDATED_PATCH = "${GAME_IDENTITY_VALIDATED_PATCH}";`,
  "",
].join("\n");
const healthyCheck = (overrides = {}) =>
  analyzeDataHealth({
    upstreamPatch: "13.04",
    upstreamAgents: currentAgents,
    now: "2026-09-08T12:00:00Z",
    mapMeta: {},
    snapshotVersion: "13.04-2026-08-31",
    snapshotUpdatedAt: "2026-08-31",
    ...overrides,
  });
const maintenanceReview = (overrides = {}) =>
  buildMaintenanceReview({
    upstreamPatch: "13.05",
    upstreamAgents: currentIdentityAgents,
    now: "2026-09-10T12:00:00Z",
    mapMeta: {},
    snapshotVersion: "13.04-2026-08-31",
    snapshotUpdatedAt: "2026-08-31",
    mapPoolVersion: "13.04",
    gameDataVersion: "13.04-2026-08-31",
    identityValidatedPatch: "13.05",
    gameDataSource,
    ...overrides,
  });

test("patch numbers are read out of whatever shape upstream sends", () => {
  assert.equal(extractPatch("release-13.04"), "13.04");
  assert.equal(extractPatch("13.04-2026-08-31"), "13.04");
  assert.equal(extractPatch("release-14.00-shipping-15-3456789"), "14.00");
  assert.equal(extractPatch(""), null);
  assert.equal(extractPatch(undefined), null);
});

test("a matching roster, patch, and fresh snapshot report healthy", () => {
  const health = healthyCheck();
  assert.equal(health.level, "healthy");
  assert.equal(health.needsAttention, false);
  assert.match(health.report, /Live VALORANT patch: 13\.04/);
  assert.match(health.report, /✓ 8 days old/);
});

test("patch drift is a review signal, including map-rotation review", () => {
  const health = healthyCheck({ upstreamPatch: "14.00" });
  assert.equal(health.level, "review");
  assert.match(health.report, /Live VALORANT patch: 14\.00/);
  assert.match(health.report, /Map Smart snapshot patch: 13\.04/);
  assert.match(health.report, /Meta snapshot is behind the live game patch/);
  assert.match(
    health.report,
    /Competitive map rotation[\s\S]*Review recommended after patch change/,
  );
});

test("a 14-day-old snapshot is a review signal", () => {
  const health = healthyCheck({ now: "2026-09-14T00:00:00Z" });
  assert.equal(health.snapshotAgeDays, 14);
  assert.equal(health.snapshotStale, true);
  assert.match(health.report, /⚠ 14 days old — review recommended/);
});

test("an unknown playable agent is an action-needed finding", () => {
  const health = healthyCheck({
    upstreamAgents: [...currentAgents, { displayName: "Someone New" }],
  });
  assert.equal(health.level, "action");
  assert.match(health.report, /🔴 New playable agent detected: Someone New/);
  assert.match(health.report, /Update local game data and agent art/);
});

test("irrelevant upstream maps cannot create missing-map warnings", () => {
  const health = healthyCheck({
    upstreamMaps: [
      { displayName: "Bind" },
      { displayName: "Fracture" },
      { displayName: "Range" },
    ],
  });
  assert.equal(health.level, "healthy");
  assert.doesNotMatch(health.report, /Bind|Fracture|Range|Missing maps/i);
});

test("agents whose names differ only by punctuation are not false positives", () => {
  // KAY/O is the one that breaks naive matching.
  const health = healthyCheck({
    upstreamAgents: currentAgents.map((agent) =>
      agent.displayName === "KAY/O" ? { displayName: "KAY / O" } : agent,
    ),
  });
  assert.deepEqual(health.missingAgents, []);
});

test("current low-confidence maps are reported without recalculation", () => {
  const health = healthyCheck({ mapMeta: MAP_META });
  assert.deepEqual(health.lowConfidenceMaps, ["Abyss"]);
  assert.match(health.report, /Low-confidence maps[\s\S]*⚠ Abyss/);
});

test("unchanged findings do not create duplicate issue comments", () => {
  const first = healthyCheck({ upstreamPatch: "14.00" });
  const nextWeek = healthyCheck({
    upstreamPatch: "14.00",
    now: "2026-09-10T12:00:00Z",
  });
  assert.equal(first.signature, nextWeek.signature);
  assert.equal(
    decideIssueAction({
      currentSignature: nextWeek.signature,
      issueState: "open",
      needsAttention: true,
      previousSignature: first.signature,
    }),
    "none",
  );
});

test("a previously unhealthy issue closes when all checks become healthy", () => {
  const health = healthyCheck();
  assert.equal(
    decideIssueAction({
      currentSignature: health.signature,
      issueState: "open",
      needsAttention: health.needsAttention,
      previousSignature: "older-status",
    }),
    "close",
  );
});

test("workflow stays weekly on Wednesday and keeps manual dispatch", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/game-data-drift.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /cron: "0 6 \* \* 3"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /valorant-api\.com\/v1\/maps/);
});

test("13.05 with an unchanged roster produces no fake gameplay update", () => {
  const review = maintenanceReview();
  assert.equal(review.patch, null);
  assert.match(review.report, /Patch 13\.05 review/);
  assert.match(review.report, /✓ Agent roster unchanged/);
  assert.match(review.report, /✓ Agent roles unchanged/);
  assert.match(review.report, /✓ Competitive map rotation unchanged/);
  assert.match(review.report, /✓ No Map Smart refresh applied/);
  assert.match(review.report, /No gameplay-data change required/);
  assert.match(
    review.report,
    /GAME_DATA_VERSION remains 13\.04-2026-08-31/,
  );
});

test("a live patch newer than Map Smart remains a statistics review", () => {
  const review = maintenanceReview({
    upstreamPatch: "13.06",
    identityValidatedPatch: "13.06",
  });
  assert.match(review.report, /Snapshot patch: 13\.04/);
  assert.match(review.report, /Statistical snapshot has not been refreshed/);
  assert.match(
    review.report,
    /Competitive map rotation requires human verification/,
  );
  assert.match(review.report, /Professional map statistics require review/);
});

test("new upstream agents include structured identity and artwork review", () => {
  const review = maintenanceReview({
    upstreamAgents: [
      ...currentIdentityAgents,
      {
        displayName: "Agent Thirty",
        isBaseContent: false,
        role: { displayName: "Initiator" },
        uuid: "12345678-1234-1234-1234-123456789abc",
      },
    ],
  });
  assert.equal(review.roster.additions.length, 1);
  assert.match(review.report, /New upstream agent detected: Agent Thirty/);
  assert.match(review.report, /12345678-1234-1234-1234-123456789abc/);
  assert.match(review.report, /Role: Initiator/);
  assert.match(review.report, /Agent art still needs review\/import/);
});

test("unchanged agents include matching roles and starter configuration", () => {
  const review = maintenanceReview();
  assert.equal(review.identityMatches, true);
  assert.deepEqual(review.roster.additions, []);
  assert.deepEqual(review.roster.removals, []);
  assert.deepEqual(review.roster.roleDifferences, []);
  assert.deepEqual(review.roster.starterDifferences, []);
  assert.match(review.report, /✓ 29 agents match/);
  assert.match(review.report, /✓ Starter configuration matches/);
});

test("stale Map Smart data reports age and existing low-confidence samples", () => {
  const review = maintenanceReview({
    mapMeta: MAP_META,
    now: "2026-09-14T00:00:00Z",
  });
  assert.equal(review.health.snapshotStale, true);
  assert.match(review.report, /Age: 14 days/);
  assert.match(review.report, /Snapshot is at least 14 days old/);
  assert.match(review.report, /Abyss: 26 professional matches/);
});

test("unsafe identity drift produces report only and no patch", () => {
  const review = maintenanceReview({
    upstreamPatch: "13.06",
    upstreamAgents: currentIdentityAgents.slice(1),
  });
  assert.equal(review.patch, null);
  assert.match(review.report, /Local agent absent upstream/);
  assert.match(review.report, /No product-data changes can be safely generated/);
});

test("a safe identity-validation change produces a normal git patch", () => {
  const review = maintenanceReview({ upstreamPatch: "13.06" });
  assert.equal(
    review.patch,
    createIdentityValidationPatch(gameDataSource, "13.06"),
  );
  assert.match(review.patch, /^diff --git a\/data\/game-data\.js/m);
  assert.match(
    review.patch,
    /-export const GAME_IDENTITY_VALIDATED_PATCH = "13\.05";/,
  );
  assert.match(
    review.patch,
    /\+export const GAME_IDENTITY_VALIDATED_PATCH = "13\.06";/,
  );
  assert.doesNotMatch(review.patch, /MAP_META|agentWeights/);
});

test("maintenance workflow uploads review artifacts without remote writes", async () => {
  const [workflow, script] = await Promise.all([
    readFile(
      new URL(
        "../.github/workflows/prepare-data-maintenance.yml",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../scripts/prepare-data-maintenance.js", import.meta.url),
      "utf8",
    ),
  ]);
  const automation = `${workflow}\n${script}`;
  assert.match(workflow, /name: Prepare data maintenance/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /agent-roulette-maintenance-review/);
  assert.match(workflow, /maintenance-output\/\*/);
  assert.doesNotMatch(automation, /git\s+(?:commit|push)|gh\s+pr\s+create/);
});

test("observed agents come back as ordered names with no numbers", () => {
  for (const [mapId, meta] of Object.entries(MAP_META)) {
    const names = observedAgentNames(mapId);
    if (meta.confidence === "none") {
      assert.equal(names.length, 0, `${mapId} has no snapshot but listed agents`);
      continue;
    }
    assert.ok(names.length > 0, `${mapId} returned nothing`);
    names.forEach((name) => {
      assert.equal(typeof name, "string");
      assert.doesNotMatch(name, /\d/, `${mapId} leaked a number: ${name}`);
      assert.doesNotMatch(name, /%/, `${mapId} leaked a percentage: ${name}`);
    });
  }
});

test("every map states its sample size in plain language", () => {
  for (const [mapId, meta] of Object.entries(MAP_META)) {
    const text = describeMapEvidence(mapId);
    assert.doesNotMatch(text, /%/);
    if (meta.confidence === "none") {
      // Rotated in since the snapshot: there is no sample to describe.
      assert.match(text, /No pick-rate snapshot/);
      assert.match(text, /leaves this map alone/);
      continue;
    }
    assert.match(text, new RegExp(String(meta.sampleSize)));
    assert.match(text, /pro matches/);
  }
  assert.match(describeMapEvidence("abyss"), /Only 26 pro matches/);
  assert.match(describeMapEvidence("abyss"), /may shift quickly/);
  assert.match(describeMapEvidence("summit"), /useful.*directional/);
  assert.match(describeMapEvidence("lotus"), /stronger evidence base/);
  assert.doesNotMatch(describeMapEvidence("lotus"), /only|shift quickly/i);
});

test("remembered maps produce zero map-result commentary outside Map Smart", () => {
  const lineup = [AGENTS.find((agent) => agent.id === "gekko")];
  const teamNeeds = [{ role: "Initiator", state: "needed", requiredFromStack: 1 }];
  const balanced = buildLineupNotes({
    structureId: "balanced",
    mode: "balanced",
    mapId: "haven",
    draft: lineup,
    mapStrength: 0,
    teamNeeds,
  });
  const chaos = buildLineupNotes({
    structureId: "chaos",
    mode: "chaos",
    mapId: "haven",
    draft: lineup,
    mapStrength: 0,
    teamNeeds,
  });
  assert.match(balanced.join(" "), /Filled team need: Gekko supplied the Initiator/);
  assert.doesNotMatch(balanced.join(" "), /Haven|map|snapshot|weight/i);
  assert.match(chaos.join(" "), /not enforced in Total Chaos/);
  assert.doesNotMatch(chaos.join(" "), /Haven|map|snapshot|weight/i);
});

test("Map Smart Notes classify map-favoured, constraint-led, and wildcard outcomes", () => {
  const lineup = ["omen", "gekko", "chamber"].map((id) =>
    AGENTS.find((agent) => agent.id === id),
  );
  const reasons = buildLineupNotes({
    structureId: "map",
    mode: "balanced",
    mapId: "haven",
    draft: lineup,
    mapStrength: 4,
    teamNeeds: [{ role: "Initiator", state: "needed", requiredFromStack: 1 }],
  });
  const text = reasons.join(" ");
  assert.match(text, /Map-favoured: Omen/);
  assert.match(text, /Role \/ constraint-led: Gekko/);
  assert.match(text, /Wildcard roll: Chamber/);
  assert.match(text, /changes probability rather than forcing meta agents/);
  assert.doesNotMatch(text, /recommended|optimal|best possible|wrong pick|not mentioned/i);
  assert.doesNotMatch(text, /recorded professional matches/);
});

test("the panel discloses that the source is pro play, not the ladder", () => {
  assert.match(MAP_EVIDENCE_CAVEAT, /Pro play/);
  assert.match(MAP_EVIDENCE_CAVEAT, /normal ranked games/);
  assert.match(MAP_EVIDENCE_CAVEAT, /signal rather than a tier list/);
  for (const [mapId, meta] of Object.entries(MAP_META)) {
    if (meta.confidence === "none") continue;
    assert.match(describeMapEvidence(mapId), /pro matches/);
  }
});

test("a map rotation does not silently invalidate the stats snapshot", () => {
  // MAP_POOL_VERSION and MAP_META_VERSION are different clocks on purpose: the
  // pool moved to 13.08 while the pick-rate snapshot is still 13.04. The drift
  // report must keep saying so rather than treating the pool bump as a refresh.
  const health = analyzeDataHealth({
    upstreamPatch: "release-13.08",
    upstreamAgents: currentAgents,
    now: new Date("2026-10-22T00:00:00Z"),
  });
  assert.equal(health.needsAttention, true);
  assert.match(health.report, /13\.08/);
});

test("every map in the pool has a meta entry, and nothing extra", () => {
  assert.deepEqual(
    Object.keys(MAP_META).sort(),
    MAPS.map((map) => map.id).sort(),
  );
});

test("maps without a snapshot apply no map influence at any strength", () => {
  for (const [mapId, meta] of Object.entries(MAP_META)) {
    if (meta.confidence !== "none") continue;
    assert.equal(getMapConfidenceInfluence(mapId), 0);
    const weight = createMapCandidateWeight({ mapId, strength: 4 });
    if (weight) {
      AGENTS.forEach((agent) => assert.equal(weight(agent), 1));
    }
  }
});

test("an announced agent stays out of the playable roster", () => {
  const names = new Set(AGENTS.map((agent) => agent.name.toLowerCase()));
  UPCOMING_AGENTS.forEach((agent) => {
    assert.ok(
      !names.has(agent.name.toLowerCase()),
      `${agent.name} is announced but already in AGENTS — rosters default to ` +
        "everything selected, so she would be dealt to people who cannot pick her",
    );
    assert.match(agent.releaseDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(agent.trailerUrl, /^https:\/\//);
  });
});

test("the next-agent banner counts down, flips, and retires itself", () => {
  const at = (day) =>
    getUpcomingAgentNotice({ now: new Date(`${day}T06:00:00Z`) });

  assert.equal(at("2026-10-22").state, "upcoming");
  assert.equal(at("2026-10-22").days, 5);
  assert.match(at("2026-10-26").headline, /arrives tomorrow/);
  assert.equal(at("2026-10-23").days, 4, "the countdown must tick down daily");
  assert.equal(at("2026-10-27").state, "arrived");
  assert.match(at("2026-10-27").headline, /is here/);
  assert.equal(at("2026-11-10").state, "arrived", "should still mark the launch");
  // Three weeks of "she's here", then it retires itself.
  assert.equal(at("2026-11-20"), null);
});

test("the banner disappears the moment the agent reaches local data", () => {
  const notice = getUpcomingAgentNotice({
    now: new Date("2026-10-22T06:00:00Z"),
    localAgents: [...AGENTS, { name: "Hush", role: "Duelist" }],
  });
  assert.equal(notice, null);
});

test("pick rates map onto weights in a straight, checkable line", () => {
  assert.equal(rateToWeight(100), 1.5);
  assert.equal(rateToWeight(0), 1);
  assert.equal(rateToWeight(50), 1.25);
  assert.equal(confidenceFor(634), "high");
  assert.equal(confidenceFor(224), "medium");
  assert.equal(confidenceFor(26), "low");
});

test("a raw table is rejected rather than half-read", () => {
  const good = parseRawTable(
    "# patch: 13.08\n# date: 2026-10-22\n# sample: 400\n# source: x\n# population: ranked ladder\nOmen\t90\nKAY/O\t40\n",
    { fileName: "lotus.tsv" },
  );
  assert.deepEqual(good.problems, []);
  assert.equal(good.rows.length, 2);
  // KAY/O's slash is the name that breaks naive matching.
  assert.ok(good.rows.some((row) => row.agent.id === "kayo"));

  const bad = parseRawTable("Nobody\t90\nOmen\t900\n", { fileName: "x.tsv" });
  assert.ok(bad.problems.some((line) => /unknown agent "Nobody"/.test(line)));
  assert.ok(bad.problems.some((line) => /no usable rate for Omen/.test(line)));
  assert.ok(bad.problems.some((line) => /missing "# patch:"/.test(line)));
});

test("a map with no table keeps whatever data it already had", () => {
  // The migration is one map at a time; a refresh must never blank the rest.
  for (const map of MAPS) {
    const entry = MAP_META[map.id];
    assert.ok(entry, `${map.id} lost its entry`);
    if (entry.confidence !== "none") {
      assert.ok(Object.keys(entry.agentWeights).length > 0);
      assert.ok(entry.sampleSize > 0);
    }
  }
});

test("evidence copy follows the table's population, not an assumption", () => {
  // A vstats refresh must not keep claiming the numbers came from VCT.
  const pro = { confidence: "high", sampleSize: 400, population: "professional" };
  const ladder = { ...pro, population: "ranked ladder" };
  const describe = (intel) =>
    intel.population === "ranked ladder" ? "ranked games" : "pro matches";
  assert.equal(describe(pro), "pro matches");
  assert.equal(describe(ladder), "ranked games");

  for (const [mapId, meta] of Object.entries(MAP_META)) {
    const caveat = mapEvidenceCaveat(mapId);
    if (meta.confidence === "none") {
      assert.equal(caveat, "", `${mapId} has no data but showed a caveat`);
      continue;
    }
    assert.ok(caveat.length > 0, `${mapId} showed no caveat`);
  }
});

test("a pasted table declares its own column layout", () => {
  // vstats leads with rank and a role icon; vlr leads with the agent.
  const vstats = parseRawTable(
    [
      "# patch: 13.08",
      "# date: 2026-10-22",
      "# sample: unknown",
      "# source: https://www.vstats.gg/",
      "# population: ranked ladder",
      "# columns: rank, role, agent, winrate, roundwr, pickrate, kd, performance",
      "1\tController\tClove\t54.69%\t52.40%\t50.42%\t0.96\t278.96",
      "2\tSentinel\tSage\t53.21%\t51.87%\t27.65%\t0.92\t232.56",
    ].join("\n"),
    { fileName: "lotus.tsv" },
  );
  assert.deepEqual(vstats.problems, []);
  assert.equal(vstats.rows.length, 2);
  assert.equal(vstats.rows[0].agent.id, "clove");
  // Win rate wins when the table has both.
  assert.equal(vstats.rows[0].rate, 54.69);
  assert.equal(vstats.rows[0].pickRate, 50.42);
  assert.equal(vstats.meta.unknownSample, true);
});

test("a table with no published sample size cannot claim high confidence", () => {
  assert.equal(confidenceFor(0, { unknown: true }), "unstated");
  assert.ok(MAP_CONFIDENCE_INFLUENCE.unstated <= MAP_CONFIDENCE_INFLUENCE.low);
});

test("the launch is marked even after the roster catches up", () => {
  const withHush = [...AGENTS, { name: "Hush", role: "Duelist" }];
  const at = (day) =>
    getUpcomingAgentNotice({
      now: new Date(`${day}T06:00:00Z`),
      localAgents: withHush,
    });
  // Announcing her before release would be wrong — she can't be owned yet.
  assert.equal(at("2026-10-22"), null);
  assert.equal(at("2026-10-27").state, "arrived");
  assert.match(at("2026-10-27").detail, /in the roulette now/);
  assert.equal(at("2026-11-25"), null);
});
