import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS,
  MAX_TEAM_SIZE,
  REROLL_BUDGET,
  STARTER_AGENT_IDS,
} from "../data/game-data.js";
import { createMatchState } from "../logic/match.js";
import { escapeDiscordText, formatDiscordResult } from "../logic/discord.js";
import {
  normalizeSavedPreferences,
  normalizeSessionState,
  sanitizeProfileName,
  serializePreferences,
  serializeSessionState,
} from "../logic/storage.js";

const byId = new Map(AGENTS.map((agent) => [agent.id, agent]));

function savedPlayer(id, name, ownedAgentIds = STARTER_AGENT_IDS) {
  return { id, name, ownedAgentIds: new Set(ownedAgentIds), open: false };
}

test("legacy V1 profiles migrate to the saved library with stable IDs and current-stack IDs", () => {
  const normalized = normalizeSavedPreferences(
    {
      mode: "chaos",
      players: [
        { id: "ananya", name: "Ananya", ownedAgentIds: ["omen"] },
        { id: "yash", name: "Yash", ownedAgentIds: ["jett"] },
      ],
    },
    { agents: AGENTS, makeId: () => "generated" },
  );
  assert.equal(normalized.preferredMode, "chaos");
  assert.deepEqual(normalized.migratedCurrentStackIds, ["ananya", "yash"]);
  assert.equal(normalized.savedPlayers[0].id, "ananya");
  assert.ok(normalized.savedPlayers[0].ownedAgentIds.has("omen"));
  STARTER_AGENT_IDS.forEach((agentId) => {
    assert.ok(normalized.savedPlayers[0].ownedAgentIds.has(agentId));
  });
});

test("duplicate display names remain separate because IDs, not names, are keys", () => {
  let id = 0;
  const normalized = normalizeSavedPreferences(
    {
      savedPlayers: [
        { id: "same-id", name: "Sibling", ownedAgentIds: [] },
        { id: "same-id", name: "Sibling", ownedAgentIds: [] },
      ],
    },
    { agents: AGENTS, makeId: () => `generated-${++id}` },
  );
  assert.equal(normalized.savedPlayers[0].name, "Sibling");
  assert.equal(normalized.savedPlayers[1].name, "Sibling");
  assert.notEqual(normalized.savedPlayers[0].id, normalized.savedPlayers[1].id);
});

test("saved-library serialization excludes current stack and active Match state", () => {
  const output = serializePreferences({
    preferredMode: "balanced",
    savedPlayers: [savedPlayer("p1", "Ananya", ["omen", ...STARTER_AGENT_IDS])],
    currentStackIds: ["p1"],
    matchState: { draft: [byId.get("omen")] },
  });
  assert.deepEqual(Object.keys(output).sort(), [
    "preferredMode",
    "preferredStructure",
    "savedPlayers",
    "selectedMapId",
    "version",
  ]);
  assert.deepEqual(Object.keys(output.savedPlayers[0]).sort(), [
    "id",
    "name",
    "ownedAgentIds",
  ]);
});

test("remembered map survives while a non-map Roll Style is preferred", () => {
  const serialized = serializePreferences({
    preferredMode: "balanced",
    preferredStructure: 1,
    selectedMapId: "haven",
    savedPlayers: [],
  });
  const normalized = normalizeSavedPreferences(serialized, {
    agents: AGENTS,
    validMapIds: ["haven"],
  });
  assert.equal(normalized.preferredStructure, 1);
  assert.equal(normalized.selectedMapId, "haven");
});

test("removing and later re-adding a current-stack ID does not alter saved ownership", () => {
  const library = [savedPlayer("p1", "Ananya", ["omen", ...STARTER_AGENT_IDS])];
  const before = serializePreferences({
    preferredMode: "balanced",
    savedPlayers: library,
  });
  const sessionWithoutPlayer = normalizeSessionState(
    {
      currentStackIds: [],
      takenAgentIds: [],
      mode: "balanced",
      matchState: { matchNumber: 2, draftAgentIds: null },
    },
    {
      savedPlayers: library,
      agents: AGENTS,
      maxTeamSize: MAX_TEAM_SIZE,
      rerollBudget: REROLL_BUDGET,
    },
  );
  assert.deepEqual(sessionWithoutPlayer.currentStackIds, []);
  assert.deepEqual(
    serializePreferences({ preferredMode: "balanced", savedPlayers: library }),
    before,
  );
  const sessionWithPlayer = normalizeSessionState(
    {
      currentStackIds: ["p1"],
      takenAgentIds: [],
      mode: "balanced",
      matchState: { matchNumber: 2, draftAgentIds: null },
    },
    {
      savedPlayers: library,
      agents: AGENTS,
      maxTeamSize: MAX_TEAM_SIZE,
      rerollBudget: REROLL_BUDGET,
    },
  );
  assert.deepEqual(sessionWithPlayer.currentStackIds, ["p1"]);
  assert.ok(library[0].ownedAgentIds.has("omen"));
});

test("active Match session round-trips draft, pins, rerolls, picks, mode, and Match number", () => {
  const library = [
    savedPlayer("p1", "Ananya", ["omen", ...STARTER_AGENT_IDS]),
    savedPlayer("p2", "Yash", ["cypher", ...STARTER_AGENT_IDS]),
  ];
  const matchState = {
    ...createMatchState(4),
    draft: [byId.get("omen"), byId.get("cypher")],
    pinnedPlayerIds: new Set(["p1"]),
    teamRedrawsRemaining: 1,
  };
  const serialized = serializeSessionState({
    mode: "chaos",
    currentStackIds: ["p1", "p2"],
    takenAgentIds: new Set(["sage"]),
    matchState,
  });
  const normalized = normalizeSessionState(serialized, {
    savedPlayers: library,
    agents: AGENTS,
    maxTeamSize: MAX_TEAM_SIZE,
    rerollBudget: REROLL_BUDGET,
  });
  assert.equal(normalized.mode, "chaos");
  assert.deepEqual(normalized.currentStackIds, ["p1", "p2"]);
  assert.deepEqual(normalized.takenAgentIds, ["sage"]);
  assert.equal(normalized.matchState.matchNumber, 4);
  assert.deepEqual(normalized.matchState.draftAgentIds, ["omen", "cypher"]);
  assert.deepEqual(normalized.matchState.pinnedPlayerIds, ["p1"]);
  assert.equal(normalized.matchState.teamRedrawsRemaining, 1);
});

test("malformed session values are filtered and an invalid draft fails closed", () => {
  const library = [savedPlayer("p1", "Ananya")];
  const normalized = normalizeSessionState(
    {
      mode: "not-a-mode",
      currentStackIds: ["p1", "p1", "missing", 7],
      takenAgentIds: ["omen", "not-an-agent", "omen"],
      matchState: {
        matchNumber: -8,
        draftAgentIds: ["not-an-agent"],
        pinnedPlayerIds: ["p1", "missing"],
        teamRedrawsRemaining: -50,
      },
    },
    {
      savedPlayers: library,
      agents: AGENTS,
      maxTeamSize: MAX_TEAM_SIZE,
      rerollBudget: REROLL_BUDGET,
    },
  );
  assert.equal(normalized.mode, "balanced");
  assert.deepEqual(normalized.currentStackIds, ["p1"]);
  assert.deepEqual(normalized.takenAgentIds, ["omen"]);
  assert.equal(normalized.matchState.matchNumber, 1);
  assert.equal(normalized.matchState.draftAgentIds, null);
  assert.deepEqual(normalized.matchState.pinnedPlayerIds, []);
  assert.equal(normalized.matchState.teamRedrawsRemaining, REROLL_BUDGET);
});

test("session validation caps outside picks to the number of outside seats", () => {
  const library = Array.from({ length: 4 }, (_, index) =>
    savedPlayer(`p${index}`, `Player ${index}`),
  );
  const normalized = normalizeSessionState(
    {
      currentStackIds: library.map((player) => player.id),
      takenAgentIds: ["omen", "sage", "jett"],
      matchState: { matchNumber: 1 },
    },
    {
      savedPlayers: library,
      agents: AGENTS,
      maxTeamSize: MAX_TEAM_SIZE,
      rerollBudget: REROLL_BUDGET,
    },
  );
  assert.deepEqual(normalized.takenAgentIds, ["omen"]);
});

test("profile names keep harmless punctuation but remove stored control characters", () => {
  assert.equal(sanitizeProfileName("A\nB\u0000_C"), "A B _C");
  assert.equal(sanitizeProfileName("@Sibling_*"), "@Sibling_*");
});

test("Discord escaping neutralizes mentions and Markdown without changing the visible profile", () => {
  const name = "@everyone *_`~|>\\ name";
  const escaped = escapeDiscordText(name);
  assert.match(escaped, /@\u200beveryone/);
  assert.match(escaped, /\\\*/);
  assert.match(escaped, /\\_/);
  assert.match(escaped, /\\`/);
  assert.match(escaped, /\\~/);
  assert.match(escaped, /\\\|/);
  assert.match(escaped, /\\>/);
  assert.equal(name, "@everyone *_`~|>\\ name");
});

test("Discord result uses Match terminology and sanitized player names", () => {
  const output = formatDiscordResult({
    matchNumber: 3,
    draft: [byId.get("omen")],
    players: [savedPlayer("p1", "@everyone *Ananya*")],
    pinnedPlayerIds: new Set(["p1"]),
    personalRerollsRemaining: new Map([["p1", REROLL_BUDGET - 1]]),
    teamRedrawsRemaining: 2,
    rerollBudget: REROLL_BUDGET,
    takenAgentIds: new Set(["sage"]),
    agents: AGENTS,
  });
  assert.match(output, /@\u200beveryone \\\*Ananya\\\*/);
  assert.match(output, /match 3/);
  assert.match(output, /outside picks: Sage/);
  assert.doesNotMatch(output, /round/i);
});
