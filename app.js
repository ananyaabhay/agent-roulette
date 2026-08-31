import {
  AGENTS,
  MAX_TEAM_SIZE,
  REROLL_BUDGET,
  ROLE_CSS_VARIABLES,
  ROLES,
  STARTER_AGENT_IDS,
} from "./data/game-data.js";
import {
  explainFailure,
  getAvailableAgents,
  getTeamNeeds,
  solveDraft,
} from "./logic/solver.js";
import {
  attemptPlayerReroll,
  createRoundState,
  redrawUnpinned,
  spinInitialDraft,
  startNewRound,
  togglePlayerPin,
} from "./logic/round.js";
import {
  normalizeSavedPreferences,
  serializePreferences,
} from "./logic/storage.js";

const STORAGE_KEY = "agent-roulette:preferences:v1";
const MAX_NAME_LENGTH = 60;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const pendingTimers = [];
let fallbackId = 0;

const $ = (selector) => document.querySelector(selector);
const playersElement = $("#players");
const resultsElement = $("#results");
const lobbyElement = $("#lobbyCard");

function makePlayerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `player-${Date.now()}-${fallbackId}`;
}

function createPlayer() {
  return {
    id: makePlayerId(),
    name: "",
    ownedAgentIds: new Set(AGENTS.map((agent) => agent.id)),
    open: false,
  };
}

function loadPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSavedPreferences(JSON.parse(raw), {
      agents: AGENTS,
      maxPlayers: MAX_TEAM_SIZE,
      makeId: makePlayerId,
    });
  } catch (error) {
    console.warn("Saved Agent Roulette profiles could not be loaded.", error);
    return null;
  }
}

function savePreferences() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializePreferences({ mode, players })),
    );
  } catch (error) {
    console.warn("Agent Roulette could not save profiles on this device.", error);
  }
}

const savedPreferences = loadPreferences();
let players = savedPreferences?.players || [createPlayer(), createPlayer()];
let mode = savedPreferences?.mode || "balanced";
let takenAgentIds = new Set();
let roundState = createRoundState();
let lobbyOpen = false;
let feasible = true;

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function actionButton(text, className = "icon-btn") {
  const button = element("button", className, text);
  button.type = "button";
  return button;
}

function playerLabel(player, index = players.indexOf(player)) {
  return player.name.trim() || `Player ${index + 1}`;
}

function outsideSeatCount() {
  return MAX_TEAM_SIZE - players.length;
}

function availableStackSeats() {
  return MAX_TEAM_SIZE - players.length - takenAgentIds.size;
}

function currentContext() {
  return {
    players,
    takenAgentIds,
    mode,
    agents: AGENTS,
    random: Math.random,
  };
}

function mutateSetup(mutation, { persist = true } = {}) {
  const replacedActiveRound = Boolean(roundState.draft);
  mutation();
  if (replacedActiveRound) roundState = startNewRound(roundState);
  if (persist) savePreferences();
  renderAll();
  if (replacedActiveRound) {
    showNote(
      "Setup changed — a fresh round is ready.",
      "The old draft was cleared because its constraints changed. Your rerolls were refilled.",
      true,
    );
  }
}

function createChipGrid({ isOn, isFixed, isGone, isDisabled, onToggle }) {
  const fragment = document.createDocumentFragment();

  ROLES.forEach((role) => {
    const block = element("div", "role-block");
    block.style.color = `var(${ROLE_CSS_VARIABLES[role]})`;
    block.append(element("div", "role-label", `${role}s`));

    const chips = element("div", "chips");
    AGENTS.filter((agent) => agent.role === role).forEach((agent) => {
      const fixed = Boolean(isFixed(agent));
      const gone = Boolean(isGone(agent));
      const disabled = Boolean(isDisabled?.(agent)) || fixed || gone;
      const chip = actionButton(agent.name, "chip");
      chip.dataset.agentId = agent.id;
      chip.classList.toggle("fixed", fixed);
      chip.classList.toggle("gone", gone);
      chip.setAttribute("aria-pressed", isOn(agent) ? "true" : "false");
      chip.disabled = disabled;

      if (fixed) chip.title = "Unlocked by default on every account";
      if (gone) chip.title = "Already locked by an outside teammate";
      if (!fixed && !gone && disabled) {
        chip.title = "All outside teammate seats are already accounted for";
      }
      if (!disabled && onToggle) {
        chip.addEventListener("click", () => onToggle(agent));
      }
      chips.append(chip);
    });

    block.append(chips);
    fragment.append(block);
  });

  return fragment;
}

function renderPlayers() {
  playersElement.replaceChildren();

  players.forEach((player, index) => {
    const card = element("article", `player${player.open ? " open" : ""}`);
    const bar = element("div", "player-bar");
    bar.append(element("span", "slot", String(index + 1).padStart(2, "0")));

    const nameInput = element("input", "name-input");
    nameInput.type = "text";
    nameInput.maxLength = MAX_NAME_LENGTH;
    nameInput.placeholder = `Player ${index + 1}`;
    nameInput.setAttribute("aria-label", `Player ${index + 1} name`);
    nameInput.value = player.name;
    nameInput.addEventListener("input", (event) => {
      player.name = event.target.value.slice(0, MAX_NAME_LENGTH);
      savePreferences();
      if (roundState.draft) renderResults(roundState.draft, { animate: false });
    });
    bar.append(nameInput);

    bar.append(
      element(
        "span",
        "count",
        `${getAvailableAgents(player, takenAgentIds, AGENTS).length} avail.`,
      ),
    );

    const toggleButton = actionButton(player.open ? "Done" : "Agents");
    toggleButton.setAttribute("aria-expanded", player.open ? "true" : "false");
    toggleButton.addEventListener("click", () => {
      player.open = !player.open;
      renderPlayers();
    });
    bar.append(toggleButton);

    if (players.length > 1) {
      const removeButton = actionButton("×");
      removeButton.setAttribute("aria-label", `Remove ${playerLabel(player, index)}`);
      removeButton.addEventListener("click", () => {
        mutateSetup(() => players.splice(index, 1));
      });
      bar.append(removeButton);
    }
    card.append(bar);

    const pool = element("div", "pool");
    const tools = element("div", "pool-tools");
    const allButton = actionButton(`All ${AGENTS.length}`);
    allButton.addEventListener("click", () => {
      mutateSetup(() => {
        player.ownedAgentIds = new Set(AGENTS.map((agent) => agent.id));
      });
    });
    const startersButton = actionButton(
      `Default ${STARTER_AGENT_IDS.length} only`,
    );
    startersButton.addEventListener("click", () => {
      mutateSetup(() => {
        player.ownedAgentIds = new Set(STARTER_AGENT_IDS);
      });
    });
    tools.append(allButton, startersButton);
    pool.append(tools);
    pool.append(
      element(
        "p",
        "pool-note",
        "Default agents stay on. Agents locked by outside teammates are temporarily unavailable.",
      ),
    );
    pool.append(
      createChipGrid({
        isOn: (agent) => player.ownedAgentIds.has(agent.id),
        isFixed: (agent) => agent.starter && !takenAgentIds.has(agent.id),
        isGone: (agent) => takenAgentIds.has(agent.id),
        isDisabled: () => false,
        onToggle: (agent) => {
          mutateSetup(() => {
            player.ownedAgentIds.has(agent.id)
              ? player.ownedAgentIds.delete(agent.id)
              : player.ownedAgentIds.add(agent.id);
            STARTER_AGENT_IDS.forEach((agentId) =>
              player.ownedAgentIds.add(agentId),
            );
          });
        },
      }),
    );
    card.append(pool);
    playersElement.append(card);
  });

  $("#stackHint").textContent = `${players.length}-stack · ${players.length} of ${MAX_TEAM_SIZE} seats`;
  const addPlayerButton = $("#addPlayer");
  addPlayerButton.disabled = availableStackSeats() <= 0;
  addPlayerButton.title = addPlayerButton.disabled
    ? "Remove an outside teammate pick before adding another stack player"
    : "Add another person from your stack";
}

function renderLobby() {
  const section = $("#lobbySection");
  const totalOutsideSeats = outsideSeatCount();
  section.hidden = totalOutsideSeats === 0;
  if (section.hidden) return;

  const knownCount = takenAgentIds.size;
  $("#outsideCount").textContent =
    knownCount === totalOutsideSeats
      ? "Full lobby accounted for"
      : `${knownCount} of ${totalOutsideSeats} known`;
  $("#outsideNote").textContent =
    knownCount === totalOutsideSeats
      ? "Every outside seat has a known pick. Those agents are excluded and their roles count toward the draft."
      : "Playing with people outside your stack? Mark agents after they lock. You can still Spin when some picks are unknown.";

  lobbyElement.className = `player${lobbyOpen ? " open" : ""}`;
  lobbyElement.replaceChildren();

  const bar = element("div", "player-bar");
  bar.append(element("span", "slot", "LOBBY"));
  bar.append(element("span", "bar-title", "Mark agents already locked"));
  bar.append(element("span", "count", `${knownCount} marked`));
  const toggleButton = actionButton(lobbyOpen ? "Done" : "Mark picks");
  toggleButton.setAttribute("aria-expanded", lobbyOpen ? "true" : "false");
  toggleButton.addEventListener("click", () => {
    lobbyOpen = !lobbyOpen;
    renderLobby();
  });
  bar.append(toggleButton);
  lobbyElement.append(bar);

  const pool = element("div", "pool");
  const remaining = totalOutsideSeats - knownCount;
  pool.append(
    element(
      "p",
      "pool-note",
      remaining > 0
        ? `You can mark ${remaining} more ${remaining === 1 ? "pick" : "picks"}.`
        : "All outside seats are filled. Untick a pick to change it.",
    ),
  );
  pool.append(
    createChipGrid({
      isOn: (agent) => takenAgentIds.has(agent.id),
      isFixed: () => false,
      isGone: () => false,
      isDisabled: (agent) =>
        !takenAgentIds.has(agent.id) && knownCount >= totalOutsideSeats,
      onToggle: (agent) => {
        mutateSetup(
          () => {
            takenAgentIds.has(agent.id)
              ? takenAgentIds.delete(agent.id)
              : takenAgentIds.add(agent.id);
            lobbyOpen = true;
          },
          { persist: false },
        );
        requestAnimationFrame(() => {
          lobbyElement.querySelector(".pool")?.scrollIntoView({ block: "nearest" });
        });
      },
    }),
  );
  lobbyElement.append(pool);
}

function renderTeamNeeds() {
  const teamNeedsElement = $("#teamNeeds");
  const needs = getTeamNeeds(currentContext());
  teamNeedsElement.replaceChildren();
  $("#teamNeedsIntro").textContent =
    mode === "chaos"
      ? "Full Chaos disables role targets. Ownership and distinct-agent rules still apply."
      : "What the current role targets need from your stack, using the same quotas as the solver.";

  needs.forEach((need) => {
    const row = element("div", `need-row ${need.state}`);
    const role = element("span", "need-role", need.role);
    role.style.color = `var(${ROLE_CSS_VARIABLES[need.role]})`;
    row.append(role);

    const state = element("span", "need-state");
    let title = "Flexible";
    let detail = "Currently not required by the role targets.";

    if (need.state === "disabled") {
      title = "Role targets off";
      detail = "Full Chaos does not require this role.";
    } else if (need.state === "covered") {
      title = `Covered by ${need.coveringLobbyAgents.map((agent) => agent.name).join(", ")}`;
      detail = `${need.capablePlayers} stack ${need.capablePlayers === 1 ? "player is" : "players are"} also available.`;
    } else if (need.state === "needed") {
      title = "Needed from your stack";
      detail = `${need.capablePlayers} stack ${need.capablePlayers === 1 ? "player is" : "players are"} available.`;
    } else if (need.state === "impossible") {
      title = "Impossible with current pools";
      detail = `Needs ${need.neededCount}; only ${need.capablePlayers} stack ${need.capablePlayers === 1 ? "player is" : "players are"} available.`;
    }

    state.append(element("strong", "", title));
    state.append(element("span", "", detail));
    row.append(state);
    teamNeedsElement.append(row);
  });
}

function renderMode() {
  $("#modeBalanced").setAttribute(
    "aria-pressed",
    mode === "balanced" ? "true" : "false",
  );
  $("#modeChaos").setAttribute(
    "aria-pressed",
    mode === "chaos" ? "true" : "false",
  );
  $("#modeDescription").textContent =
    mode === "balanced"
      ? "Role Balanced maintains sensible role coverage from the information you supply. It is not an optimal or map-meta composition."
      : "Full Chaos ignores role targets while still respecting ownership, outside picks, and distinct agents.";
}

function checkFeasibility() {
  feasible = Boolean(solveDraft(currentContext()));
  const status = $("#status");
  status.classList.toggle("bad", !feasible);

  if (feasible && roundState.draft) {
    $("#statusTitle").textContent = "Round active.";
    $("#statusBody").textContent =
      "Use the shared rerolls to adjust this draft, or choose New Round to start over.";
  } else if (feasible) {
    $("#statusTitle").textContent = "Ready to spin.";
    const outsideText = takenAgentIds.size
      ? `, accounting for ${takenAgentIds.size} known outside ${takenAgentIds.size === 1 ? "pick" : "picks"}`
      : "";
    $("#statusBody").textContent = `A valid draft exists in ${mode === "chaos" ? "Full Chaos" : "Role Balanced"}${outsideText}.`;
  } else {
    const failure = explainFailure(currentContext());
    $("#statusTitle").textContent = failure.title;
    $("#statusBody").textContent = failure.body;
  }

  $("#roll").disabled = !feasible || Boolean(roundState.draft);
  $("#redraw").disabled =
    !roundState.draft || roundState.rerollsRemaining <= 0 || !feasible;
  $("#newRound").disabled = !roundState.draft;
  $("#spinHint").textContent = `Round ${roundState.roundNumber} · ${roundState.draft ? "active" : "ready"}`;
  $("#roundNumber").textContent = String(roundState.roundNumber).padStart(2, "0");
  $("#rerollCount").textContent = `${roundState.rerollsRemaining} / ${REROLL_BUDGET} remaining`;

  const dots = $("#rerollDots");
  dots.replaceChildren();
  for (let index = 0; index < REROLL_BUDGET; index += 1) {
    const dot = element("span", "reroll-dot");
    dot.classList.toggle("spent", index >= roundState.rerollsRemaining);
    dots.append(dot);
  }
}

function stopAnimations() {
  pendingTimers.forEach((timer) => clearTimeout(timer));
  pendingTimers.length = 0;
}

function renderResults(assignment, options = {}) {
  stopAnimations();
  resultsElement.replaceChildren();

  if (takenAgentIds.size > 0) {
    const strip = element("div", "lobby-strip");
    strip.append(element("span", "", "Outside picks"));
    [...takenAgentIds].forEach((agentId) => {
      const agent = AGENTS.find((candidate) => candidate.id === agentId);
      if (agent) strip.append(element("span", "lobby-tag", agent.name));
    });
    resultsElement.append(strip);
  }

  if (!assignment) {
    const empty = element("div", "empty");
    empty.append(element("strong", "", "Nothing spun this round."));
    empty.append(
      document.createTextNode(
        "Set ownership, mark any known outside picks, then Spin once.",
      ),
    );
    resultsElement.append(empty);
    return;
  }

  assignment.forEach((agent, index) => {
    const player = players[index];
    const pinned = roundState.pinnedPlayerIds.has(player.id);
    const row = element("article", `res${pinned ? " pinned" : ""}`);
    row.style.color = `var(${ROLE_CSS_VARIABLES[agent.role]})`;
    row.append(element("span", "res-slot", String(index + 1).padStart(2, "0")));

    const main = element("span", "res-main");
    main.append(element("span", "res-agent", agent.name));
    const meta = element("span", "res-meta");
    meta.append(element("span", "res-role", agent.role));
    meta.append(element("span", "res-who", playerLabel(player, index)));
    main.append(meta);
    row.append(main);

    const actions = element("span", "res-acts");
    const pinButton = actionButton(pinned ? "Pinned" : "Pin", "token");
    pinButton.dataset.action = "pin";
    pinButton.dataset.playerId = player.id;
    pinButton.setAttribute("aria-pressed", pinned ? "true" : "false");
    actions.append(pinButton);

    const rerollButton = actionButton("Reroll", "token");
    rerollButton.dataset.action = "reroll";
    rerollButton.dataset.playerId = player.id;
    rerollButton.disabled = pinned || roundState.rerollsRemaining <= 0;
    rerollButton.setAttribute(
      "aria-label",
      `Reroll ${playerLabel(player, index)}; costs one shared reroll`,
    );
    actions.append(rerollButton);
    row.append(actions);
    resultsElement.append(row);

    const shouldAnimate =
      options.animate &&
      !reducedMotion &&
      (!options.only || options.only.includes(index));
    if (shouldAnimate) {
      scrambleResult(row, agent, options.only ? 480 : index * 130 + 200);
    } else {
      row.classList.add("revealed");
    }
  });
}

function scrambleResult(row, finalAgent, duration) {
  const agentElement = row.querySelector(".res-agent");
  row.classList.add("scrambling");
  const interval = setInterval(() => {
    agentElement.textContent =
      AGENTS[Math.floor(Math.random() * AGENTS.length)].name;
  }, 55);
  pendingTimers.push(interval);
  const timeout = setTimeout(() => {
    clearInterval(interval);
    agentElement.textContent = finalAgent.name;
    row.classList.remove("scrambling");
    row.classList.add("revealed");
  }, duration);
  pendingTimers.push(timeout);
}

function showNote(title, body, success = false) {
  const note = $("#note");
  note.className = `note show${success ? " ok" : ""}`;
  note.replaceChildren(
    element("b", "", title),
    element("span", "", body),
  );
}

function showCopyFallback(text) {
  const note = $("#note");
  note.className = "note show";
  note.replaceChildren(
    element("b", "", "Clipboard access was blocked."),
    element("span", "", "Select and copy this result manually:"),
    element("code", "", text),
  );
}

function hideNote() {
  $("#note").className = "note";
  $("#note").replaceChildren();
}

function formatDiscordResult() {
  const lines = roundState.draft.map(
    (agent, index) =>
      `${playerLabel(players[index], index)} → ${agent.name} (${agent.role})${roundState.pinnedPlayerIds.has(players[index].id) ? " [pinned]" : ""}`,
  );
  const rerollsUsed = REROLL_BUDGET - roundState.rerollsRemaining;
  const footer = [
    `round ${roundState.roundNumber}`,
    `${rerollsUsed} ${rerollsUsed === 1 ? "reroll" : "rerolls"} used`,
  ];
  if (takenAgentIds.size) {
    footer.push(
      `outside picks: ${[...takenAgentIds]
        .map((agentId) => AGENTS.find((agent) => agent.id === agentId)?.name)
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  return `**Agent Roulette**\n${lines.join("\n")}\n_${footer.join(" · ")}_`;
}

function renderAll() {
  hideNote();
  renderPlayers();
  renderLobby();
  renderTeamNeeds();
  renderMode();
  renderResults(roundState.draft, { animate: false });
  checkFeasibility();
}

resultsElement.addEventListener("click", (event) => {
  const button = event.target.closest(".token");
  if (!button || button.disabled) return;

  const playerId = button.dataset.playerId;
  if (button.dataset.action === "pin") {
    roundState = togglePlayerPin(roundState, playerId);
    renderResults(roundState.draft, { animate: false });
    checkFeasibility();
    return;
  }

  const previousDraft = roundState.draft;
  const result = attemptPlayerReroll(roundState, playerId, currentContext());
  if (!result.changed) {
    const player = players.find((candidate) => candidate.id === playerId);
    const messages = {
      "no-budget": ["No rerolls remaining.", "Start a New Round to refill all three."],
      "no-alternative": [
        `No other agent works for ${playerLabel(player)}.`,
        "Every legal alternative is taken, pinned, unowned, or breaks the role targets. No reroll token was spent.",
      ],
    };
    const [title, body] = messages[result.reason] || [
      "That player cannot be rerolled.",
      "Check the current round and pinned agents.",
    ];
    showNote(title, body);
    return;
  }

  roundState = result.state;
  renderResults(roundState.draft, {
    animate: true,
    only: result.movedPlayerIndexes,
  });
  checkFeasibility();

  const targetIndex = players.findIndex((player) => player.id === playerId);
  const otherMoved = result.movedPlayerIndexes.filter(
    (index) => index !== targetIndex,
  );
  if (otherMoved.length > 0) {
    showNote(
      `Rerolled ${playerLabel(players[targetIndex], targetIndex)} — ${otherMoved.map((index) => playerLabel(players[index], index)).join(" and ")} moved too.`,
      "A single swap was not legal, so the solver rebuilt around pinned agents. One shared reroll was spent.",
      true,
    );
  } else if (previousDraft[targetIndex].id !== roundState.draft[targetIndex].id) {
    showNote(
      `${playerLabel(players[targetIndex], targetIndex)} rerolled.`,
      "One shared reroll was spent.",
      true,
    );
  }
});

$("#roll").addEventListener("click", () => {
  hideNote();
  const result = spinInitialDraft(roundState, currentContext());
  if (!result.changed) {
    checkFeasibility();
    return;
  }
  roundState = result.state;
  renderResults(roundState.draft, {
    animate: true,
    only: result.movedPlayerIndexes,
  });
  checkFeasibility();
});

$("#redraw").addEventListener("click", () => {
  const result = redrawUnpinned(roundState, currentContext());
  if (!result.changed) {
    const messages = {
      "all-pinned": [
        "Every player is pinned.",
        "Unpin at least one player before redrawing. No reroll token was spent.",
      ],
      "no-alternative": [
        "No complete redraw works.",
        "Every unpinned player must receive a different agent. The current pools cannot do that, so no reroll token was spent.",
      ],
      "no-budget": [
        "No rerolls remaining.",
        "Start a New Round to refill all three.",
      ],
    };
    const [title, body] = messages[result.reason] || [
      "Nothing to redraw.",
      "Spin a draft first.",
    ];
    showNote(title, body);
    return;
  }

  roundState = result.state;
  renderResults(roundState.draft, {
    animate: true,
    only: result.movedPlayerIndexes,
  });
  checkFeasibility();
  showNote(
    "Unpinned players redrawn.",
    "Every unpinned slot changed and one shared reroll was spent.",
    true,
  );
});

$("#newRound").addEventListener("click", () => {
  roundState = startNewRound(roundState);
  renderResults(null, { animate: false });
  checkFeasibility();
  showNote(
    `Round ${roundState.roundNumber} is ready.`,
    "The previous draft and pins were cleared. All three rerolls are available again.",
    true,
  );
});

$("#copy").addEventListener("click", async () => {
  if (!roundState.draft) {
    showNote("Nothing to copy yet.", "Spin the initial draft first.");
    return;
  }

  const text = formatDiscordResult();
  try {
    await navigator.clipboard.writeText(text);
    showNote(
      "Result copied.",
      "Open Discord, choose the conversation, and paste it yourself.",
      true,
    );
  } catch (error) {
    showCopyFallback(text);
  }
});

$("#addPlayer").addEventListener("click", () => {
  if (availableStackSeats() <= 0) return;
  mutateSetup(() => players.push(createPlayer()));
});

function setMode(nextMode) {
  if (mode === nextMode) return;
  mutateSetup(() => {
    mode = nextMode;
  });
}

$("#modeBalanced").addEventListener("click", () => setMode("balanced"));
$("#modeChaos").addEventListener("click", () => setMode("chaos"));

$("#resetSaved").addEventListener("click", () => {
  const approved = window.confirm(
    "Reset saved player names and unlocked-agent selections on this device?",
  );
  if (!approved) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Saved data could not be removed.", error);
  }
  players = [createPlayer(), createPlayer()];
  mode = "balanced";
  takenAgentIds = new Set();
  lobbyOpen = false;
  roundState = createRoundState(roundState.roundNumber + 1);
  savePreferences();
  renderAll();
  showNote(
    "Saved player data reset.",
    "Two blank players with every agent selected are ready on this device.",
    true,
  );
});

renderAll();
