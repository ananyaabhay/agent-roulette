// Agent Roulette V1.3.1 browser state and accessible rendering.
import {
  AGENT_BY_ID,
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
  validateDraft,
} from "./logic/solver.js";
import {
  attemptPlayerReroll,
  createMatchState,
  reconcileActiveMatch,
  redrawUnpinned,
  spinInitialDraft,
  startNewMatch,
  togglePlayerPin,
} from "./logic/match.js";
import { formatDiscordResult } from "./logic/discord.js";
import {
  normalizeSavedPreferences,
  normalizeSessionState,
  sanitizeProfileName,
  serializePreferences,
  serializeSessionState,
} from "./logic/storage.js";

const PREFERENCES_KEY = "agent-roulette:preferences:v2";
const LEGACY_PREFERENCES_KEY = "agent-roulette:preferences:v1";
const SESSION_KEY = "agent-roulette:match-session:v1";
const DISCORD_URL = "https://discord.com/channels/@me";
const MAX_SAVED_PLAYERS = 50;
const MAX_NAME_LENGTH = 60;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const pendingTimers = [];
let fallbackId = 0;
let storageRecoveryNotice = false;

const $ = (selector) => document.querySelector(selector);
const playersElement = $("#players");
const resultsElement = $("#results");
const lobbyElement = $("#lobbyCard");

function makePlayerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `player-${Date.now()}-${fallbackId}`;
}

function createSavedPlayer(name, startWithAll) {
  return {
    id: makePlayerId(),
    name: sanitizeProfileName(name.trim()),
    ownedAgentIds: new Set(
      startWithAll ? AGENTS.map((agent) => agent.id) : STARTER_AGENT_IDS,
    ),
    open: false,
  };
}

function parseStoredJson(storageArea, key) {
  try {
    const raw = storageArea.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    storageRecoveryNotice = true;
    console.warn(`Agent Roulette ignored malformed browser data at ${key}.`, error);
    return null;
  }
}

function loadPreferences() {
  const current = parseStoredJson(localStorage, PREFERENCES_KEY);
  const legacy = current ? null : parseStoredJson(localStorage, LEGACY_PREFERENCES_KEY);
  const normalized = normalizeSavedPreferences(current || legacy, {
    agents: AGENTS,
    maxSavedPlayers: MAX_SAVED_PLAYERS,
    makeId: makePlayerId,
  });
  return {
    normalized,
    migratedLegacy: Boolean(!current && legacy && normalized),
  };
}

const loadedPreferences = loadPreferences();
let savedPlayers = loadedPreferences.normalized?.savedPlayers || [];
let preferredMode = loadedPreferences.normalized?.preferredMode || "balanced";
const normalizedSession = normalizeSessionState(
  parseStoredJson(sessionStorage, SESSION_KEY),
  {
    savedPlayers,
    agents: AGENTS,
    maxTeamSize: MAX_TEAM_SIZE,
    rerollBudget: REROLL_BUDGET,
  },
);
let currentStackIds = normalizedSession?.currentStackIds ||
  loadedPreferences.normalized?.migratedCurrentStackIds || [];
let players = [];
let mode = normalizedSession?.mode || preferredMode;
let takenAgentIds = new Set(normalizedSession?.takenAgentIds || []);
let matchState = createMatchState(
  normalizedSession?.matchState.matchNumber || 1,
);
let lobbyOpen = false;
let libraryOpen = savedPlayers.length === 0;
let feasible = false;

function syncPlayers() {
  const byId = new Map(savedPlayers.map((player) => [player.id, player]));
  currentStackIds = currentStackIds.filter((playerId) => byId.has(playerId));
  players = currentStackIds.map((playerId) => byId.get(playerId));
}

syncPlayers();
if (normalizedSession?.matchState.draftAgentIds) {
  const draft = normalizedSession.matchState.draftAgentIds.map((agentId) =>
    AGENT_BY_ID.get(agentId),
  );
  matchState = {
    matchNumber: normalizedSession.matchState.matchNumber,
    draft,
    pinnedPlayerIds: new Set(normalizedSession.matchState.pinnedPlayerIds),
    rerollsRemaining: normalizedSession.matchState.rerollsRemaining,
  };
  if (!validateDraft({
    assignment: draft,
    players,
    takenAgentIds,
    mode,
    agents: AGENTS,
  })) {
    matchState = createMatchState(matchState.matchNumber);
    storageRecoveryNotice = true;
  }
}

function savePreferences() {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify(serializePreferences({ preferredMode, savedPlayers })),
    );
    localStorage.removeItem(LEGACY_PREFERENCES_KEY);
  } catch (error) {
    console.warn("Agent Roulette could not save profiles on this device.", error);
  }
}

function saveSession() {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(
        serializeSessionState({
          mode,
          currentStackIds,
          takenAgentIds,
          matchState,
        }),
      ),
    );
  } catch (error) {
    console.warn("Agent Roulette could not save the active Match.", error);
  }
}

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
  return player?.name.trim() || `Player ${index + 1}`;
}

function outsideSeatCount() {
  return players.length > 0 ? MAX_TEAM_SIZE - players.length : 0;
}

function availableStackSeats() {
  return MAX_TEAM_SIZE - players.length - takenAgentIds.size;
}

function currentContext(overrides = {}) {
  return {
    players,
    takenAgentIds,
    mode,
    agents: AGENTS,
    random: Math.random,
    ...overrides,
  };
}

function changeStack(mutation, description) {
  const hadActiveMatch = Boolean(matchState.draft);
  if (
    hadActiveMatch &&
    !window.confirm(
      `${description} changes who is playing and will start a new Match. Continue?`,
    )
  ) {
    return false;
  }

  mutation();
  syncPlayers();
  if (hadActiveMatch) matchState = startNewMatch(matchState);
  saveSession();
  renderAll();
  if (hadActiveMatch) {
    showNote(
      `Match ${matchState.matchNumber} is ready.`,
      "The previous draft and pins were cleared because the current stack changed. All three rerolls are available.",
      true,
    );
  }
  return true;
}

function applyReconcilableChange({
  apply,
  rollback,
  persistProfiles = false,
  description,
}) {
  apply();
  const result = reconcileActiveMatch(matchState, currentContext());

  if (result.reason === "no-solution") {
    rollback();
    renderAll();
    showNote(
      "That change cannot produce a valid Match.",
      `${description} was not applied. Adjust another ownership setting, outside pick, or use Full Chaos first.`,
    );
    return false;
  }

  if (
    result.reason === "resolved" &&
    !window.confirm(
      `${description} conflicts with the active draft. Agent Roulette can rebuild a valid draft without spending a reroll. Continue?`,
    )
  ) {
    rollback();
    renderAll();
    return false;
  }

  if (result.reason === "resolved") matchState = result.state;
  if (persistProfiles) savePreferences();
  saveSession();
  renderAll();

  if (result.reason === "resolved") {
    const releasedText = result.releasedPinIds?.length
      ? " A conflicting pin was released."
      : " Existing pins were preserved.";
    showNote(
      "Active Match resolved.",
      `The draft was rebuilt around the updated setup. No reroll was spent.${releasedText}`,
      true,
    );
  }
  return true;
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

function updateOwnership(player, nextAgentIds, description) {
  const previous = player.ownedAgentIds;
  applyReconcilableChange({
    apply: () => {
      player.ownedAgentIds = new Set(nextAgentIds);
      STARTER_AGENT_IDS.forEach((agentId) => player.ownedAgentIds.add(agentId));
    },
    rollback: () => {
      player.ownedAgentIds = previous;
    },
    persistProfiles: true,
    description,
  });
}

function renderPlayers() {
  playersElement.replaceChildren();

  if (players.length === 0) {
    const empty = element("div", "stack-empty");
    empty.append(element("strong", "", "No one is in today’s stack yet."));
    empty.append(
      document.createTextNode(
        "Open Add player to choose a saved profile or create your first one.",
      ),
    );
    playersElement.append(empty);
  }

  players.forEach((player, index) => {
    const card = element("article", `player${player.open ? " open" : ""}`);
    const poolId = `agent-pool-${player.id}`;
    const bar = element("div", "player-bar");
    bar.append(element("span", "slot", String(index + 1).padStart(2, "0")));

    const nameInput = element("input", "name-input");
    nameInput.type = "text";
    nameInput.maxLength = MAX_NAME_LENGTH;
    nameInput.placeholder = `Player ${index + 1}`;
    nameInput.setAttribute("aria-label", `${playerLabel(player, index)} display name`);
    nameInput.value = player.name;
    nameInput.addEventListener("input", (event) => {
      player.name = sanitizeProfileName(event.target.value);
      savePreferences();
      if (matchState.draft) renderResults(matchState.draft, { animate: false });
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
    toggleButton.setAttribute("aria-controls", poolId);
    toggleButton.addEventListener("click", () => {
      player.open = !player.open;
      renderPlayers();
    });
    bar.append(toggleButton);

    const removeButton = actionButton("Remove");
    removeButton.setAttribute(
      "aria-label",
      `Remove ${playerLabel(player, index)} from the current stack`,
    );
    removeButton.addEventListener("click", () => {
      changeStack(
        () => currentStackIds.splice(index, 1),
        `Removing ${playerLabel(player, index)} from the current stack`,
      );
    });
    bar.append(removeButton);
    card.append(bar);

    const pool = element("div", "pool");
    pool.id = poolId;
    const tools = element("div", "pool-tools");
    const allButton = actionButton(`All ${AGENTS.length}`);
    allButton.addEventListener("click", () => {
      updateOwnership(
        player,
        AGENTS.map((agent) => agent.id),
        `Changing ${playerLabel(player, index)} to all agents`,
      );
    });
    const startersButton = actionButton(
      `Default ${STARTER_AGENT_IDS.length} only`,
    );
    startersButton.addEventListener("click", () => {
      updateOwnership(
        player,
        STARTER_AGENT_IDS,
        `Changing ${playerLabel(player, index)} to default agents only`,
      );
    });
    tools.append(allButton, startersButton);
    pool.append(tools);
    pool.append(
      element(
        "p",
        "pool-note",
        "Default agents stay on. Outside picks are temporarily unavailable, but they remain saved as owned.",
      ),
    );
    pool.append(
      createChipGrid({
        isOn: (agent) => player.ownedAgentIds.has(agent.id),
        isFixed: (agent) => agent.starter,
        isGone: (agent) => takenAgentIds.has(agent.id),
        isDisabled: () => false,
        onToggle: (agent) => {
          const next = new Set(player.ownedAgentIds);
          next.has(agent.id) ? next.delete(agent.id) : next.add(agent.id);
          updateOwnership(
            player,
            next,
            `Changing ${playerLabel(player, index)}’s ownership`,
          );
        },
      }),
    );
    card.append(pool);
    playersElement.append(card);
  });

  $("#stackHint").textContent = `${players.length}-stack · ${players.length} of ${MAX_TEAM_SIZE} seats`;
  const addPlayerButton = $("#addPlayer");
  addPlayerButton.setAttribute("aria-expanded", libraryOpen ? "true" : "false");
  addPlayerButton.textContent = libraryOpen ? "Close player library" : "+ Add player";
}

function renderLibrary() {
  const panel = $("#playerLibrary");
  panel.hidden = !libraryOpen;
  panel.replaceChildren();
  if (!libraryOpen) return;

  const header = element("div", "library-head");
  const heading = element("div");
  heading.append(element("p", "eyebrow", "Saved on this device"));
  heading.append(element("h3", "", "Player library"));
  const close = actionButton("Close");
  close.addEventListener("click", () => {
    libraryOpen = false;
    renderPlayers();
    renderLibrary();
    $("#addPlayer").focus();
  });
  header.append(heading, close);
  panel.append(header);
  panel.append(
    element(
      "p",
      "library-intro",
      "Removing someone from today’s stack keeps their saved name and ownership here.",
    ),
  );

  const list = element("div", "library-list");
  if (savedPlayers.length === 0) {
    list.append(element("p", "library-empty", "No saved profiles yet."));
  }
  savedPlayers.forEach((profile, profileIndex) => {
    const inStack = currentStackIds.includes(profile.id);
    const row = element("div", "library-row");
    const identity = element("span", "library-identity");
    identity.append(
      element("strong", "", profile.name.trim() || `Saved player ${profileIndex + 1}`),
    );
    identity.append(
      element("span", "", `${profile.ownedAgentIds.size} owned agents`),
    );
    row.append(identity);

    const add = actionButton(inStack ? "In stack" : "Add", "icon-btn library-add");
    add.disabled = inStack || availableStackSeats() <= 0;
    if (!inStack && availableStackSeats() <= 0) {
      add.title = "All five team seats are already accounted for";
    }
    add.addEventListener("click", () => {
      if (add.disabled) return;
      if (
        changeStack(
          () => currentStackIds.push(profile.id),
          `Adding ${profile.name || "this saved player"} to the current stack`,
        )
      ) {
        libraryOpen = true;
        renderPlayers();
        renderLibrary();
      }
    });
    row.append(add);

    const remove = actionButton("Delete profile", "text-button danger");
    remove.setAttribute(
      "aria-label",
      `Permanently delete the saved profile for ${profile.name || `player ${profileIndex + 1}`}`,
    );
    remove.addEventListener("click", () => {
      const activeWarning = inStack && matchState.draft
        ? " This will also end the active Match because that player is in the current stack."
        : "";
      if (
        !window.confirm(
          `Permanently delete the saved profile “${profile.name || `Saved player ${profileIndex + 1}`}”? Their ownership settings cannot be recovered.${activeWarning}`,
        )
      ) {
        return;
      }
      savedPlayers.splice(profileIndex, 1);
      currentStackIds = currentStackIds.filter((playerId) => playerId !== profile.id);
      syncPlayers();
      if (inStack && matchState.draft) matchState = startNewMatch(matchState);
      savePreferences();
      saveSession();
      renderAll();
      libraryOpen = true;
      renderPlayers();
      renderLibrary();
      showNote(
        "Saved profile deleted.",
        `${profile.name || "The player"} was removed from this device${inStack ? " and from the current stack" : ""}.`,
        true,
      );
    });
    list.append(row);
  });
  panel.append(list);

  const form = element("form", "new-profile");
  form.noValidate = true;
  form.append(element("h4", "", "+ New player"));
  const nameLabel = element("label", "new-profile-name");
  nameLabel.append(element("span", "", "Display name"));
  const nameInput = element("input");
  nameInput.type = "text";
  nameInput.name = "player-name";
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.autocomplete = "off";
  nameInput.placeholder = "e.g. Ananya";
  nameLabel.append(nameInput);
  form.append(nameLabel);

  const choices = element("fieldset", "start-options");
  choices.append(element("legend", "", "Start with"));
  [
    ["default", "Default agents only", true],
    ["all", "All agents", false],
  ].forEach(([value, label, checked]) => {
    const option = element("label");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "starting-pool";
    radio.value = value;
    radio.checked = checked;
    option.append(radio, document.createTextNode(label));
    choices.append(option);
  });
  form.append(choices);
  form.append(
    element(
      "p",
      "pool-note",
      `The ${STARTER_AGENT_IDS.length} default agents always stay enabled. You can customise the profile after adding it.`,
    ),
  );
  const create = actionButton("Create saved player", "ghost");
  create.type = "submit";
  form.append(create);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = sanitizeProfileName(nameInput.value).trim();
    if (!name) {
      showNote("Give this profile a name.", "Names can repeat; profiles use separate internal IDs.");
      nameInput.focus();
      return;
    }
    const startWithAll = form.elements["starting-pool"].value === "all";
    const profile = createSavedPlayer(name, startWithAll);
    savedPlayers.push(profile);
    savePreferences();
    let addedToStack = false;
    if (availableStackSeats() > 0) {
      addedToStack = changeStack(
        () => currentStackIds.push(profile.id),
        `Adding ${name} to the current stack`,
      );
    } else {
      renderAll();
    }
    libraryOpen = true;
    renderPlayers();
    renderLibrary();
    showNote(
      `${name} saved${addedToStack ? " and added" : ""}.`,
      startWithAll
        ? "All agents are selected. Open Agents to customise ownership."
        : "Only default agents are selected. Open Agents to add unlocks.",
      true,
    );
  });
  panel.append(form);
}

function renderTeamSeats() {
  const seats = $("#teamSeats");
  seats.replaceChildren();
  players.forEach((player, index) => {
    const seat = element("span", "team-seat stack-seat");
    seat.append(element("b", "", playerLabel(player, index)));
    seat.append(element("small", "", "Your stack"));
    seats.append(seat);
  });
  [...takenAgentIds].forEach((agentId) => {
    const agent = AGENT_BY_ID.get(agentId);
    if (!agent) return;
    const seat = element("span", "team-seat known-seat");
    seat.append(element("b", "", agent.name));
    seat.append(element("small", "", "Known pick"));
    seats.append(seat);
  });
  const unknownCount = MAX_TEAM_SIZE - players.length - takenAgentIds.size;
  for (let index = 0; index < unknownCount; index += 1) {
    const seat = element("span", "team-seat unknown-seat");
    seat.append(element("b", "", "?"));
    seat.append(element("small", "", "Unknown"));
    seats.append(seat);
  }
}

function renderLobby() {
  const section = $("#lobbySection");
  const totalOutsideSeats = outsideSeatCount();
  section.hidden = totalOutsideSeats === 0;
  if (section.hidden) return;

  const knownCount = takenAgentIds.size;
  $("#outsideCount").textContent = `${knownCount} of ${totalOutsideSeats} known`;
  $("#outsideNote").textContent =
    knownCount === totalOutsideSeats
      ? "Every outside seat has a known pick. Their agents and roles now count toward this Match."
      : "Role Balanced uses marked picks and does not guess the remaining outside seats.";
  renderTeamSeats();

  lobbyElement.className = `player${lobbyOpen ? " open" : ""}`;
  lobbyElement.replaceChildren();
  const poolId = "outside-pick-pool";
  const bar = element("div", "player-bar");
  bar.append(element("span", "slot", "LOBBY"));
  bar.append(element("span", "bar-title", "Mark agents already locked"));
  bar.append(element("span", "count", `${knownCount} marked`));
  const toggleButton = actionButton(lobbyOpen ? "Done" : "Mark picks");
  toggleButton.setAttribute("aria-expanded", lobbyOpen ? "true" : "false");
  toggleButton.setAttribute("aria-controls", poolId);
  toggleButton.addEventListener("click", () => {
    lobbyOpen = !lobbyOpen;
    renderLobby();
  });
  bar.append(toggleButton);
  lobbyElement.append(bar);

  const pool = element("div", "pool");
  pool.id = poolId;
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
        const previous = new Set(takenAgentIds);
        applyReconcilableChange({
          apply: () => {
            takenAgentIds.has(agent.id)
              ? takenAgentIds.delete(agent.id)
              : takenAgentIds.add(agent.id);
            lobbyOpen = true;
          },
          rollback: () => {
            takenAgentIds = previous;
          },
          description: `${agent.name} as an outside teammate pick`,
        });
      },
    }),
  );
  lobbyElement.append(pool);
}

function renderTeamNeeds() {
  const teamNeedsElement = $("#teamNeeds");
  teamNeedsElement.replaceChildren();

  if (players.length === 0) {
    $("#teamNeedsIntro").textContent =
      "Add someone to today’s stack to calculate role targets.";
    return;
  }

  const needs = getTeamNeeds(currentContext());
  if (mode === "chaos") {
    $("#teamNeedsIntro").textContent =
      "Full Chaos disables role targets. Ownership, outside picks, and distinct agents still apply.";
    teamNeedsElement.append(
      element("div", "needs-summary chaos", "Role targets are disabled for this Match."),
    );
    return;
  }

  const unknownOutsideSeats = MAX_TEAM_SIZE - players.length - takenAgentIds.size;
  $("#teamNeedsIntro").textContent =
    "What the current role targets still require, using the exact same quotas as the solver.";
  const summary = element("div", "needs-summary");
  const required = needs.filter((need) =>
    ["needed", "impossible"].includes(need.state),
  );
  const covered = needs
    .flatMap((need) => need.coveringLobbyAgents.map((agent) => `${agent.name} · ${need.role}`));
  summary.append(
    summaryRow(
      "Your stack must cover",
      required.length ? required.map((need) => need.role).join(" · ") : "No required roles remain",
    ),
  );
  if (covered.length) {
    summary.append(summaryRow("Covered outside", covered.join(" · ")));
  }
  summary.append(
    summaryRow(
      "Unknown outside seats",
      String(Math.max(0, unknownOutsideSeats)),
    ),
  );
  teamNeedsElement.append(summary);

  needs.forEach((need) => {
    const row = element("div", `need-row ${need.state}`);
    const role = element("span", "need-role", need.role);
    role.style.color = `var(${ROLE_CSS_VARIABLES[need.role]})`;
    row.append(role);
    const state = element("span", "need-state");
    let title = "Flexible";
    let detail = "Not required by the current role targets.";

    if (need.state === "covered") {
      title = `Covered by ${need.coveringLobbyAgents.map((agent) => agent.name).join(", ")}`;
      detail = "This known outside pick satisfies the current target.";
    } else if (need.state === "needed") {
      title = "Needed from your stack";
      detail = need.requiredFromStack > 1
        ? `Your stack must assign ${need.requiredFromStack} ${need.role}s.`
        : `Your stack must assign a ${need.role}.`;
    } else if (need.state === "impossible") {
      title = "Missing from current ownership";
      detail = `The target requires ${need.role}, but the current owned pools cannot supply it.`;
    }

    state.append(element("strong", "", title));
    state.append(element("span", "", detail));
    row.append(state);
    teamNeedsElement.append(row);
  });
}

function summaryRow(label, value) {
  const row = element("div", "summary-row");
  row.append(element("span", "", label));
  row.append(element("strong", "", value));
  return row;
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
  feasible = players.length > 0 && Boolean(solveDraft(currentContext()));
  const status = $("#status");
  status.classList.toggle("bad", !feasible);

  if (players.length === 0) {
    $("#statusTitle").textContent = "Add at least one player.";
    $("#statusBody").textContent =
      "Choose a saved profile or create a new one before spinning.";
  } else if (feasible && matchState.draft) {
    $("#statusTitle").textContent = "Match active.";
    $("#statusBody").textContent =
      "Use the shared rerolls to adjust this draft, or choose New Match to start over.";
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

  $("#roll").disabled = !feasible || Boolean(matchState.draft);
  $("#redraw").disabled =
    !matchState.draft || matchState.rerollsRemaining <= 0 || !feasible;
  $("#newMatch").disabled = !matchState.draft;
  $("#copy").disabled = !matchState.draft;
  $("#copyOpen").disabled = !matchState.draft;
  $("#spinHint").textContent = `Match ${matchState.matchNumber} · ${matchState.draft ? "active" : "ready"}`;
  $("#matchNumber").textContent = String(matchState.matchNumber).padStart(2, "0");
  $("#rerollCount").textContent = `${matchState.rerollsRemaining} / ${REROLL_BUDGET} left`;

  const dots = $("#rerollDots");
  dots.replaceChildren();
  for (let index = 0; index < REROLL_BUDGET; index += 1) {
    const dot = element("span", "reroll-dot");
    dot.classList.toggle("spent", index >= matchState.rerollsRemaining);
    dots.append(dot);
  }
}

function stopAnimations() {
  pendingTimers.forEach((timer) => {
    clearTimeout(timer);
    clearInterval(timer);
  });
  pendingTimers.length = 0;
}

function renderResults(assignment, options = {}) {
  stopAnimations();
  resultsElement.replaceChildren();

  if (takenAgentIds.size > 0) {
    const strip = element("div", "lobby-strip");
    strip.append(element("span", "", "Outside picks"));
    [...takenAgentIds].forEach((agentId) => {
      const agent = AGENT_BY_ID.get(agentId);
      if (agent) strip.append(element("span", "lobby-tag", agent.name));
    });
    resultsElement.append(strip);
  }

  if (!assignment) {
    const empty = element("div", "empty");
    empty.append(
      element(
        "strong",
        "",
        players.length ? "Nothing spun this Match." : "Your current stack is empty.",
      ),
    );
    empty.append(
      document.createTextNode(
        players.length
          ? "Set ownership, mark any known outside picks, then Spin once."
          : "Add a saved player to begin.",
      ),
    );
    resultsElement.append(empty);
    return;
  }

  assignment.forEach((agent, index) => {
    const player = players[index];
    const pinned = matchState.pinnedPlayerIds.has(player.id);
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
    rerollButton.disabled = pinned || matchState.rerollsRemaining <= 0;
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

function discordText() {
  return formatDiscordResult({
    matchNumber: matchState.matchNumber,
    draft: matchState.draft,
    players,
    pinnedPlayerIds: matchState.pinnedPlayerIds,
    rerollsRemaining: matchState.rerollsRemaining,
    rerollBudget: REROLL_BUDGET,
    takenAgentIds,
    agents: AGENTS,
  });
}

function renderAll() {
  hideNote();
  renderPlayers();
  renderLibrary();
  renderLobby();
  renderTeamNeeds();
  renderMode();
  renderResults(matchState.draft, { animate: false });
  checkFeasibility();
}

resultsElement.addEventListener("click", (event) => {
  const button = event.target.closest(".token");
  if (!button || button.disabled) return;
  const playerId = button.dataset.playerId;

  if (button.dataset.action === "pin") {
    matchState = togglePlayerPin(matchState, playerId);
    saveSession();
    renderResults(matchState.draft, { animate: false });
    checkFeasibility();
    return;
  }

  const previousDraft = matchState.draft;
  const result = attemptPlayerReroll(matchState, playerId, currentContext());
  if (!result.changed) {
    const player = players.find((candidate) => candidate.id === playerId);
    const messages = {
      "no-budget": ["No rerolls remaining.", "Start a New Match to refill all three."],
      "no-alternative": [
        `No other agent works for ${playerLabel(player)}.`,
        "Every legal alternative is taken, pinned, unowned, or breaks the role targets. No reroll was spent.",
      ],
    };
    const [title, body] = messages[result.reason] || [
      "That player cannot be rerolled.",
      "Check the current Match and pinned agents.",
    ];
    showNote(title, body);
    return;
  }

  matchState = result.state;
  saveSession();
  renderResults(matchState.draft, {
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
  } else if (previousDraft[targetIndex].id !== matchState.draft[targetIndex].id) {
    showNote(
      `${playerLabel(players[targetIndex], targetIndex)} rerolled.`,
      "One shared reroll was spent.",
      true,
    );
  }
});

$("#roll").addEventListener("click", () => {
  hideNote();
  const result = spinInitialDraft(matchState, currentContext());
  if (!result.changed) {
    checkFeasibility();
    return;
  }
  matchState = result.state;
  saveSession();
  renderResults(matchState.draft, {
    animate: true,
    only: result.movedPlayerIndexes,
  });
  checkFeasibility();
});

$("#redraw").addEventListener("click", () => {
  const result = redrawUnpinned(matchState, currentContext());
  if (!result.changed) {
    const messages = {
      "all-pinned": [
        "Every player is pinned.",
        "Unpin at least one player before redrawing. No reroll was spent.",
      ],
      "no-alternative": [
        "No complete redraw works.",
        "Every unpinned player must receive a different agent. The current pools cannot do that, so no reroll was spent.",
      ],
      "no-budget": [
        "No rerolls remaining.",
        "Start a New Match to refill all three.",
      ],
    };
    const [title, body] = messages[result.reason] || [
      "Nothing to redraw.",
      "Spin a draft first.",
    ];
    showNote(title, body);
    return;
  }

  matchState = result.state;
  saveSession();
  renderResults(matchState.draft, {
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

$("#newMatch").addEventListener("click", () => {
  matchState = startNewMatch(matchState);
  saveSession();
  renderResults(null, { animate: false });
  checkFeasibility();
  showNote(
    `Match ${matchState.matchNumber} is ready.`,
    "The previous draft and pins were cleared. All three rerolls are available again.",
    true,
  );
});

async function copyResult(openDiscord) {
  if (!matchState.draft) {
    showNote("Nothing to copy yet.", "Spin the initial draft first.");
    return;
  }
  const text = discordText();
  try {
    await navigator.clipboard.writeText(text);
    showNote(
      openDiscord ? "Result copied — opening Discord." : "Result copied.",
      "Choose the conversation and paste it yourself. Agent Roulette does not post automatically.",
      true,
    );
    if (openDiscord) {
      const opened = window.open(DISCORD_URL, "_blank", "noopener,noreferrer");
      if (!opened) {
        showNote(
          "Result copied, but Discord was blocked.",
          "Use the separate Open Discord link, then paste the copied result yourself.",
        );
      }
    }
  } catch (error) {
    showCopyFallback(text);
  }
}

$("#copy").addEventListener("click", () => copyResult(false));
$("#copyOpen").addEventListener("click", () => copyResult(true));
$("#addPlayer").addEventListener("click", () => {
  libraryOpen = !libraryOpen;
  renderPlayers();
  renderLibrary();
  if (libraryOpen) $("#playerLibrary").scrollIntoView({ block: "nearest" });
});

function setMode(nextMode) {
  if (mode === nextMode) return;
  const previousMode = mode;
  const previousPreferredMode = preferredMode;
  applyReconcilableChange({
    apply: () => {
      mode = nextMode;
      preferredMode = nextMode;
    },
    rollback: () => {
      mode = previousMode;
      preferredMode = previousPreferredMode;
    },
    persistProfiles: true,
    description: `Switching to ${nextMode === "chaos" ? "Full Chaos" : "Role Balanced"}`,
  });
}

$("#modeBalanced").addEventListener("click", () => setMode("balanced"));
$("#modeChaos").addEventListener("click", () => setMode("chaos"));

$("#resetSaved").addEventListener("click", () => {
  if (
    !window.confirm(
      "Permanently delete every saved player profile and ownership setting on this device? This cannot be undone.",
    )
  ) {
    return;
  }
  try {
    localStorage.removeItem(PREFERENCES_KEY);
    localStorage.removeItem(LEGACY_PREFERENCES_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn("Saved data could not be removed.", error);
  }
  savedPlayers = [];
  currentStackIds = [];
  players = [];
  preferredMode = "balanced";
  mode = "balanced";
  takenAgentIds = new Set();
  lobbyOpen = false;
  libraryOpen = true;
  matchState = createMatchState();
  savePreferences();
  saveSession();
  renderAll();
  showNote(
    "Player library reset.",
    "All saved profiles were deleted. Create a new player and choose their starting ownership.",
    true,
  );
});

if (loadedPreferences.migratedLegacy) savePreferences();
saveSession();
renderAll();
if (storageRecoveryNotice) {
  showNote(
    "Some saved browser data was ignored.",
    "Agent Roulette found malformed or invalid stored state and recovered safely without using it.",
  );
} else if (matchState.draft) {
  showNote(
    `Match ${matchState.matchNumber} restored.`,
    `The draft, pins, outside picks, and ${matchState.rerollsRemaining} remaining rerolls survived the refresh.`,
    true,
  );
}
