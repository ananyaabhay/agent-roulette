import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AGENTS,
  MAX_TEAM_SIZE,
  REROLL_BUDGET,
  ROLES,
  STARTER_AGENT_IDS,
} from "../data/game-data.js";
import {
  explainFailure,
  getRoleQuotas,
  getTeamNeeds,
  solveDraft,
  validateDraft,
} from "../logic/solver.js";
import {
  attemptPlayerReroll,
  createRoundState,
  redrawUnpinned,
  spinInitialDraft,
  startNewRound,
  togglePlayerPin,
} from "../logic/round.js";
import {
  normalizeSavedPreferences,
  serializePreferences,
} from "../logic/storage.js";

const byId = new Map(AGENTS.map((agent) => [agent.id, agent]));
const allAgentIds = AGENTS.map((agent) => agent.id);

function player(id, ownedAgentIds = allAgentIds) {
  return { id, name: id, ownedAgentIds: new Set(ownedAgentIds), open: false };
}

function players(count, ownedAgentIds = allAgentIds) {
  return Array.from({ length: count }, (_, index) =>
    player(`p${index + 1}`, ownedAgentIds),
  );
}

function context(overrides = {}) {
  return {
    players: players(2),
    takenAgentIds: new Set(),
    mode: "balanced",
    agents: AGENTS,
    random: () => 0.37,
    ...overrides,
  };
}

function roundWithDraft(draftIds, pinnedPlayerIds = []) {
  return {
    ...createRoundState(),
    draft: draftIds.map((agentId) => byId.get(agentId)),
    pinnedPlayerIds: new Set(pinnedPlayerIds),
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

test("game data has unique stable IDs, valid roles, and data-defined starters", () => {
  assert.equal(new Set(AGENTS.map((agent) => agent.id)).size, AGENTS.length);
  assert.ok(AGENTS.every((agent) => ROLES.includes(agent.role)));
  assert.deepEqual(
    STARTER_AGENT_IDS,
    AGENTS.filter((agent) => agent.starter).map((agent) => agent.id),
  );
  assert.equal(STARTER_AGENT_IDS.length, 5);
});

test("Role Balanced creates valid drafts for solo through five-stack", () => {
  for (let stackSize = 1; stackSize <= MAX_TEAM_SIZE; stackSize += 1) {
    const setup = context({ players: players(stackSize) });
    const draft = solveDraft(setup);
    assert.ok(draft, `${stackSize}-stack should be solvable`);
    assert.ok(validateDraft({ ...setup, assignment: draft }));
  }
});

test("drafts never duplicate agents or assign an unowned agent", () => {
  const setupPlayers = [
    player("p1", ["brimstone", "jett"]),
    player("p2", ["sage", "sova"]),
    player("p3", ["phoenix", "omen"]),
  ];
  const setup = context({ players: setupPlayers });
  const draft = solveDraft(setup);
  assert.ok(draft);
  assert.equal(new Set(draft.map((agent) => agent.id)).size, draft.length);
  draft.forEach((agent, index) => {
    assert.ok(setupPlayers[index].ownedAgentIds.has(agent.id));
  });
});

test("known outside picks are excluded and count toward role quotas", () => {
  const setup = context({
    players: players(3),
    takenAgentIds: new Set(["omen"]),
  });
  const quotas = getRoleQuotas({
    mode: setup.mode,
    stackSize: setup.players.length,
    takenAgentIds: setup.takenAgentIds,
    agents: AGENTS,
  });
  assert.equal(quotas.accountedTeamSize, 4);
  assert.equal(quotas.minimums.Controller, 0);
  assert.equal(quotas.minimums.Sentinel, 1);
  assert.equal(quotas.minimums.Initiator, 1);

  const draft = solveDraft(setup);
  assert.ok(draft);
  assert.ok(draft.every((agent) => agent.id !== "omen"));
  assert.ok(validateDraft({ ...setup, assignment: draft }));
});

test("different outside-pick counts and role combinations remain valid", () => {
  const cases = [
    { stackSize: 1, picks: ["omen", "sage", "sova", "jett"] },
    { stackSize: 2, picks: ["raze", "reyna", "jett"] },
    { stackSize: 3, picks: ["omen", "cypher"] },
    { stackSize: 4, picks: ["sova"] },
    { stackSize: 5, picks: [] },
  ];

  cases.forEach(({ stackSize, picks }) => {
    const setup = context({
      players: players(stackSize),
      takenAgentIds: new Set(picks),
    });
    const draft = solveDraft(setup);
    if (draft) assert.ok(validateDraft({ ...setup, assignment: draft }));
  });
});

test("terminal validation prevents a reachable-but-unfilled role minimum", () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const setup = context({ players: players(2), random: seededRandom(attempt) });
    const draft = solveDraft(setup);
    assert.ok(draft);
    assert.ok(draft.some((agent) => agent.role === "Controller"));
    assert.ok(validateDraft({ ...setup, assignment: draft }));
  }
});

test("Role Balanced respects role maximums", () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const setup = context({ players: players(5), random: seededRandom(attempt) });
    const draft = solveDraft(setup);
    assert.ok(draft);
    const counts = Object.fromEntries(ROLES.map((role) => [role, 0]));
    draft.forEach((agent) => {
      counts[agent.role] += 1;
    });
    assert.ok(counts.Duelist <= 2);
    assert.ok(counts.Controller <= 2);
    assert.ok(counts.Sentinel <= 2);
    assert.ok(counts.Initiator <= 3);
  }
});

test("Full Chaos disables role targets but preserves hard constraints", () => {
  const duelists = AGENTS.filter((agent) => agent.role === "Duelist").slice(0, 5);
  const setupPlayers = duelists.map((agent, index) => player(`p${index}`, [agent.id]));
  const chaosSetup = context({ players: setupPlayers, mode: "chaos" });
  const chaosDraft = solveDraft(chaosSetup);
  assert.ok(chaosDraft);
  assert.ok(chaosDraft.every((agent) => agent.role === "Duelist"));
  assert.ok(validateDraft({ ...chaosSetup, assignment: chaosDraft }));

  assert.equal(solveDraft({ ...chaosSetup, mode: "balanced" }), null);
});

test("Team Needs reports needed, covered, flexible, impossible, and disabled states", () => {
  const balancedNeeds = getTeamNeeds(
    context({ players: players(3), takenAgentIds: new Set(["omen"]) }),
  );
  assert.equal(
    balancedNeeds.find((need) => need.role === "Controller").state,
    "covered",
  );
  assert.equal(
    balancedNeeds.find((need) => need.role === "Sentinel").state,
    "needed",
  );
  assert.equal(
    balancedNeeds.find((need) => need.role === "Duelist").state,
    "flexible",
  );

  const impossibleNeeds = getTeamNeeds(
    context({
      players: [player("p1", ["phoenix"]), player("p2", ["jett"])],
    }),
  );
  assert.equal(
    impossibleNeeds.find((need) => need.role === "Controller").state,
    "impossible",
  );

  const chaosNeeds = getTeamNeeds(context({ mode: "chaos" }));
  assert.ok(chaosNeeds.every((need) => need.state === "disabled"));
});

test("failure explanation identifies too many open roles for the stack", () => {
  const failure = explainFailure(
    context({
      players: players(2),
      takenAgentIds: new Set(["phoenix", "jett", "reyna"]),
    }),
  );
  assert.equal(failure.title, "The known picks leave too many roles open.");
  assert.match(failure.body, /3 roles across 2 stack players/);
});

test("Spin creates one initial draft and cannot be repeated in an active round", () => {
  const setup = context();
  const first = spinInitialDraft(createRoundState(), setup);
  assert.equal(first.changed, true);
  assert.ok(first.state.draft);
  assert.equal(first.state.rerollsRemaining, REROLL_BUDGET);

  const second = spinInitialDraft(first.state, setup);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "round-active");
  assert.strictEqual(second.state, first.state);
});

test("successful individual reroll changes the requested player and spends exactly one token", () => {
  const setup = context({
    players: [
      player("p1", ["brimstone", "omen"]),
      player("p2", ["sage"]),
    ],
  });
  const round = roundWithDraft(["brimstone", "sage"]);
  const result = attemptPlayerReroll(round, "p1", setup);
  assert.equal(result.changed, true);
  assert.equal(result.state.draft[0].id, "omen");
  assert.equal(result.state.rerollsRemaining, REROLL_BUDGET - 1);
  assert.ok(validateDraft({ ...setup, assignment: result.state.draft }));
});

test("impossible individual reroll preserves the shared token", () => {
  const setup = context({
    players: [player("p1", ["brimstone"]), player("p2", ["sage"])],
  });
  const round = roundWithDraft(["brimstone", "sage"]);
  const result = attemptPlayerReroll(round, "p1", setup);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "no-alternative");
  assert.equal(result.state.rerollsRemaining, REROLL_BUDGET);
});

test("cascade reroll protects pins and re-solves other unpinned players", () => {
  const setup = context({
    players: [
      player("p1", ["sage", "cypher"]),
      player("p2", ["brimstone"]),
      player("p3", ["cypher", "phoenix"]),
    ],
  });
  const round = roundWithDraft(["sage", "brimstone", "cypher"], ["p2"]);
  const result = attemptPlayerReroll(round, "p1", setup);
  assert.equal(result.changed, true);
  assert.equal(result.reason, "cascade");
  assert.equal(result.state.draft[0].id, "cypher");
  assert.equal(result.state.draft[1].id, "brimstone");
  assert.equal(result.state.draft[2].id, "phoenix");
  assert.equal(result.state.rerollsRemaining, REROLL_BUDGET - 1);
  assert.ok(validateDraft({ ...setup, assignment: result.state.draft }));
});

test("Redraw unpinned changes every unpinned slot and spends one token", () => {
  const setup = context({
    players: [
      player("p1", ["phoenix", "jett"]),
      player("p2", ["phoenix", "jett"]),
    ],
    mode: "chaos",
  });
  const round = roundWithDraft(["phoenix", "jett"]);
  const result = redrawUnpinned(round, setup);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.state.draft.map((agent) => agent.id),
    ["jett", "phoenix"],
  );
  assert.equal(result.state.rerollsRemaining, REROLL_BUDGET - 1);
});

test("failed redraw and all-pinned redraw preserve the shared token", () => {
  const setup = context({
    players: [player("p1", ["phoenix"]), player("p2", ["jett"])],
    mode: "chaos",
  });
  const round = roundWithDraft(["phoenix", "jett"]);
  const impossible = redrawUnpinned(round, setup);
  assert.equal(impossible.changed, false);
  assert.equal(impossible.reason, "no-alternative");
  assert.equal(impossible.state.rerollsRemaining, REROLL_BUDGET);

  const allPinned = redrawUnpinned(
    togglePlayerPin(togglePlayerPin(round, "p1"), "p2"),
    setup,
  );
  assert.equal(allPinned.changed, false);
  assert.equal(allPinned.reason, "all-pinned");
  assert.equal(allPinned.state.rerollsRemaining, REROLL_BUDGET);
});

test("shared reroll budget cannot fall below zero", () => {
  const setup = context({
    players: [player("p1", ["phoenix", "jett"])],
    mode: "chaos",
  });
  let round = roundWithDraft(["phoenix"]);
  for (let count = 0; count < REROLL_BUDGET; count += 1) {
    const result = attemptPlayerReroll(round, "p1", setup);
    assert.equal(result.changed, true);
    round = result.state;
  }
  assert.equal(round.rerollsRemaining, 0);
  const blocked = attemptPlayerReroll(round, "p1", setup);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.reason, "no-budget");
  assert.equal(blocked.state.rerollsRemaining, 0);
});

test("New Round clears draft and pins and refills rerolls", () => {
  const active = {
    ...roundWithDraft(["brimstone", "sage"], ["p1"]),
    rerollsRemaining: 0,
    roundNumber: 4,
  };
  const fresh = startNewRound(active);
  assert.equal(fresh.roundNumber, 5);
  assert.equal(fresh.draft, null);
  assert.equal(fresh.pinnedPlayerIds.size, 0);
  assert.equal(fresh.rerollsRemaining, REROLL_BUDGET);
});

test("saved profiles use stable IDs, restore starters, and exclude transient round state", () => {
  let generatedId = 0;
  const normalized = normalizeSavedPreferences(
    {
      mode: "chaos",
      players: [
        {
          id: "stable-player-id",
          name: '<img src=x onerror="globalThis.pwned=true">',
          ownedAgentIds: ["omen", "not-a-real-agent"],
          pinned: true,
        },
      ],
      draft: ["omen"],
      takenAgentIds: ["sage"],
      rerollsRemaining: 0,
    },
    {
      agents: AGENTS,
      maxPlayers: MAX_TEAM_SIZE,
      makeId: () => `generated-${++generatedId}`,
    },
  );
  assert.equal(normalized.mode, "chaos");
  assert.equal(normalized.players[0].id, "stable-player-id");
  assert.match(normalized.players[0].name, /<img/);
  assert.ok(normalized.players[0].ownedAgentIds.has("omen"));
  STARTER_AGENT_IDS.forEach((agentId) => {
    assert.ok(normalized.players[0].ownedAgentIds.has(agentId));
  });
  assert.equal(normalized.players[0].ownedAgentIds.has("not-a-real-agent"), false);

  const serialized = serializePreferences({
    mode: normalized.mode,
    players: normalized.players,
    draft: [byId.get("omen")],
    takenAgentIds: new Set(["sage"]),
    rerollsRemaining: 0,
  });
  assert.deepEqual(Object.keys(serialized).sort(), ["mode", "players", "version"]);
  assert.deepEqual(Object.keys(serialized.players[0]).sort(), [
    "id",
    "name",
    "ownedAgentIds",
  ]);
});

test("browser UI does not use innerHTML for dynamic rendering", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /\.innerHTML\s*=/);
  assert.match(appSource, /textContent/);
  assert.match(appSource, /replaceChildren/);
});

test("5,000 randomized valid and invalid setups preserve every solver invariant", () => {
  const random = seededRandom(0xa63e71);
  let solvedCases = 0;
  let impossibleCases = 0;

  for (let caseIndex = 0; caseIndex < 5000; caseIndex += 1) {
    const stackSize = 1 + Math.floor(random() * MAX_TEAM_SIZE);
    const outsideSeats = MAX_TEAM_SIZE - stackSize;
    const shuffledAgentIds = allAgentIds
      .map((agentId) => ({ agentId, order: random() }))
      .sort((left, right) => left.order - right.order)
      .map(({ agentId }) => agentId);
    const knownPickCount = Math.floor(random() * (outsideSeats + 1));
    const taken = new Set(shuffledAgentIds.slice(0, knownPickCount));
    const setupPlayers = Array.from({ length: stackSize }, (_, playerIndex) => {
      const owned = new Set(STARTER_AGENT_IDS);
      AGENTS.forEach((agent) => {
        if (random() < 0.32) owned.add(agent.id);
      });
      // Regularly create deliberately narrow/invalid profiles as well.
      if (caseIndex % 17 === 0) {
        owned.clear();
        owned.add(shuffledAgentIds[(playerIndex + knownPickCount) % AGENTS.length]);
      }
      return player(`case-${caseIndex}-p${playerIndex}`, [...owned]);
    });
    const setup = context({
      players: setupPlayers,
      takenAgentIds: taken,
      mode: random() < 0.78 ? "balanced" : "chaos",
      random,
    });
    const draft = solveDraft(setup);

    if (!draft) {
      impossibleCases += 1;
      continue;
    }

    solvedCases += 1;
    assert.ok(validateDraft({ ...setup, assignment: draft }));
    assert.equal(new Set(draft.map((agent) => agent.id)).size, draft.length);
    draft.forEach((agent, playerIndex) => {
      assert.ok(setupPlayers[playerIndex].ownedAgentIds.has(agent.id));
      assert.equal(taken.has(agent.id), false);
    });
  }

  assert.equal(solvedCases + impossibleCases, 5000);
  assert.ok(solvedCases > 0);
  assert.ok(impossibleCases > 0);
  console.log(
    `Randomized cases: 5000 (${solvedCases} solved, ${impossibleCases} correctly reported impossible)`,
  );
});
