// Agent Roulette V1.5 experience layer over the stable legality solver.
import {
  AGENT_BY_ID,
  AGENTS,
  MAX_TEAM_SIZE,
  REROLL_BUDGET,
  ROLE_CSS_VARIABLES,
  ROLES,
  STARTER_AGENT_IDS,
} from "./data/game-data.js";
import { getAgentVisualPath } from "./data/agent-visuals.js";
import { MAPS, MAP_BY_ID, MAP_IDS } from "./data/maps.js";
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
  getPersonalRerollsRemaining,
  reconcileActiveMatch,
  redrawUnpinned,
  spinInitialDraft,
  startNewMatch,
  togglePlayerPin,
} from "./logic/match.js";
import {
  createMapCandidateWeight,
  explainMapDraft,
  getCompositionSummary,
  getMapIntel,
  observedAgentNames,
} from "./logic/recommendations.js";
import { formatDiscordResult } from "./logic/discord.js";
import {
  normalizeSavedPreferences,
  normalizeSessionState,
  sanitizeProfileName,
  serializePreferences,
  serializeSessionState,
} from "./logic/storage.js";

const PREFERENCES_KEY = "agent-roulette:preferences:v3";
const LEGACY_PREFERENCES_KEYS = [
  "agent-roulette:preferences:v2",
  "agent-roulette:preferences:v1",
];
const SESSION_KEY = "agent-roulette:match-session:v2";
const LEGACY_SESSION_KEY = "agent-roulette:match-session:v1";
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

function createSavedPlayer(name, ownedAgentIds = STARTER_AGENT_IDS) {
  return {
    id: makePlayerId(),
    name: sanitizeProfileName(name.trim()),
    ownedAgentIds: new Set([...STARTER_AGENT_IDS, ...ownedAgentIds]),
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
  const legacy = current
    ? null
    : LEGACY_PREFERENCES_KEYS
        .map((key) => parseStoredJson(localStorage, key))
        .find(Boolean);
  const normalized = normalizeSavedPreferences(current || legacy, {
    agents: AGENTS,
    validMapIds: MAP_IDS,
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
const storedSession =
  parseStoredJson(sessionStorage, SESSION_KEY) ||
  parseStoredJson(sessionStorage, LEGACY_SESSION_KEY);
const normalizedSession = normalizeSessionState(
  storedSession,
  {
    savedPlayers,
    agents: AGENTS,
    validMapIds: MAP_IDS,
    maxTeamSize: MAX_TEAM_SIZE,
    rerollBudget: REROLL_BUDGET,
  },
);
let currentStackIds = normalizedSession?.currentStackIds ||
  loadedPreferences.normalized?.migratedCurrentStackIds || [];
let players = [];
let mode = normalizedSession?.mode || preferredMode;
let selectedMapId =
  normalizedSession?.selectedMapId ||
  loadedPreferences.normalized?.selectedMapId ||
  "";
let takenAgentIds = new Set(normalizedSession?.takenAgentIds || []);
let matchState = createMatchState(
  normalizedSession?.matchState.matchNumber || 1,
  currentStackIds,
);
let lobbyOpen = false;
let libraryOpen = savedPlayers.length === 0;
let libraryView = savedPlayers.length === 0 ? "editor" : "choose";
let editorReturnView = "choose";
let editingPlayerId = null;
let editorName = "";
let editorAgentIds = new Set(STARTER_AGENT_IDS);
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
    personalRerollsRemaining: new Map(
      Object.entries(normalizedSession.matchState.personalRerollsRemaining),
    ),
    teamRedrawsRemaining: normalizedSession.matchState.teamRedrawsRemaining,
  };
  if (!validateDraft({
    assignment: draft,
    players,
    takenAgentIds,
    mode,
    agents: AGENTS,
  })) {
    matchState = createMatchState(matchState.matchNumber, currentStackIds);
    storageRecoveryNotice = true;
  }
}

function savePreferences() {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify(
        serializePreferences({
          preferredMode,
          selectedMapId,
          savedPlayers,
        }),
      ),
    );
    LEGACY_PREFERENCES_KEYS.forEach((key) => localStorage.removeItem(key));
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
          selectedMapId,
          currentStackIds,
          takenAgentIds,
          matchState,
        }),
      ),
    );
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
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

function createAgentVisual(agent) {
  const visual = element("div", "agent-visual");
  const image = element("img", "agent-portrait");
  image.src = getAgentVisualPath(agent.id);
  image.alt = "";
  image.loading = "eager";
  image.decoding = "async";
  const fallback = element("span", "agent-fallback", agent.name);
  fallback.hidden = true;
  image.addEventListener("error", () => {
    image.hidden = true;
    fallback.hidden = false;
  }, { once: true });
  visual.append(image, fallback);
  return visual;
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
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
    candidateWeight:
      mode === "map" && selectedMapId
        ? createMapCandidateWeight({
            mapId: selectedMapId,
            takenAgentIds,
            agents: AGENTS,
          })
        : null,
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
  if (hadActiveMatch) matchState = startNewMatch(matchState, currentStackIds);
  saveSession();
  renderAll();
  if (hadActiveMatch) {
    showNote(
      `Match ${matchState.matchNumber} is ready.`,
      "The previous draft and pins were cleared because the current stack changed. Personal rerolls and team redraws are full.",
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
      chip.style.setProperty(
        "--chip-accent",
        `var(${ROLE_CSS_VARIABLES[agent.role]})`,
      );
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
        chip.addEventListener("click", () => onToggle(agent, chip));
      }
      chips.append(chip);
    });

    block.append(chips);
    fragment.append(block);
  });
  return fragment;
}

function openPlayerLibrary(view = "choose") {
  libraryOpen = true;
  libraryView = savedPlayers.length === 0 && view === "choose" ? "editor" : view;
  renderPlayers();
  renderLibrary();
}

function closePlayerLibrary(focusSelector = "#addPlayer") {
  libraryOpen = false;
  renderPlayers();
  renderLibrary();
  $(focusSelector)?.focus();
}

function openPlayerEditor(profile = null, returnView = "choose") {
  editingPlayerId = profile?.id || null;
  editorName = profile?.name || "";
  editorAgentIds = new Set(profile?.ownedAgentIds || STARTER_AGENT_IDS);
  STARTER_AGENT_IDS.forEach((agentId) => editorAgentIds.add(agentId));
  editorReturnView = returnView;
  openPlayerLibrary("editor");
}

function renderPlayers() {
  playersElement.replaceChildren();

  if (players.length === 0) {
    const empty = element("div", "squad-empty");
    empty.append(element("span", "empty-mark", "+"));
    const copy = element("span");
    copy.append(element("strong", "", "Build today’s squad"));
    copy.append(element("small", "", "Choose a saved player or make a new one."));
    empty.append(copy);
    playersElement.append(empty);
  }

  players.forEach((player, index) => {
    const card = element("article", "squad-player");
    const identity = element("div", "squad-identity");
    const monogram = element(
      "span",
      "player-monogram",
      (playerLabel(player, index)[0] || String(index + 1)).toUpperCase(),
    );
    monogram.setAttribute("aria-hidden", "true");
    const copy = element("span", "squad-copy");
    copy.append(element("small", "", `Player ${String(index + 1).padStart(2, "0")}`));
    copy.append(element("strong", "", playerLabel(player, index)));
    copy.append(
      element(
        "span",
        "",
        `${player.ownedAgentIds.size} owned · ${getAvailableAgents(player, takenAgentIds, AGENTS).length} available`,
      ),
    );
    identity.append(monogram, copy);
    card.append(identity);

    const controls = element("div", "squad-controls");
    const edit = actionButton("Edit agents", "icon-btn");
    edit.addEventListener("click", () => openPlayerEditor(player, "choose"));
    const remove = actionButton("Remove", "icon-btn icon-btn--quiet");
    remove.setAttribute(
      "aria-label",
      `Remove ${playerLabel(player, index)} from today’s squad`,
    );
    remove.addEventListener("click", () => {
      changeStack(
        () => currentStackIds.splice(index, 1),
        `Removing ${playerLabel(player, index)} from the current stack`,
      );
    });
    controls.append(edit, remove);
    card.append(controls);
    playersElement.append(card);
  });

  $("#stackHint").textContent = `${players.length} / ${MAX_TEAM_SIZE} locked`;
  const addPlayerButton = $("#addPlayer");
  addPlayerButton.setAttribute("aria-expanded", libraryOpen ? "true" : "false");
  addPlayerButton.disabled = availableStackSeats() <= 0;
  addPlayerButton.title = addPlayerButton.disabled
    ? "All five lobby seats are already accounted for"
    : "Choose who is playing";
}

function deleteSavedProfile(profile, profileIndex) {
  const inStack = currentStackIds.includes(profile.id);
  const activeWarning = inStack && matchState.draft
    ? " This will also end the active Match because that player is in the current stack."
    : "";
  if (
    !window.confirm(
      `Permanently delete “${profile.name || `Saved player ${profileIndex + 1}`}”? Their ownership settings cannot be recovered.${activeWarning}`,
    )
  ) {
    return;
  }

  savedPlayers.splice(profileIndex, 1);
  currentStackIds = currentStackIds.filter((playerId) => playerId !== profile.id);
  syncPlayers();
  if (inStack && matchState.draft) {
    matchState = startNewMatch(matchState, currentStackIds);
  }
  savePreferences();
  saveSession();
  libraryOpen = true;
  libraryView = savedPlayers.length ? "manage" : "editor";
  if (!savedPlayers.length) {
    editingPlayerId = null;
    editorName = "";
    editorAgentIds = new Set(STARTER_AGENT_IDS);
  }
  renderAll();
  showNote(
    "Saved player deleted.",
    `${profile.name || "The player"} was removed from this device${inStack ? " and today’s squad" : ""}.`,
    true,
  );
}

function resetAllProfiles() {
  if (
    !window.confirm(
      "Permanently delete every saved player and ownership setting on this device? This cannot be undone.",
    )
  ) {
    return;
  }
  try {
    localStorage.removeItem(PREFERENCES_KEY);
    LEGACY_PREFERENCES_KEYS.forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch (error) {
    console.warn("Saved data could not be removed.", error);
  }
  savedPlayers = [];
  currentStackIds = [];
  players = [];
  preferredMode = "balanced";
  mode = "balanced";
  selectedMapId = "";
  takenAgentIds = new Set();
  lobbyOpen = false;
  libraryOpen = true;
  libraryView = "editor";
  editingPlayerId = null;
  editorName = "";
  editorAgentIds = new Set(STARTER_AGENT_IDS);
  matchState = createMatchState(1, currentStackIds);
  savePreferences();
  saveSession();
  renderAll();
  showNote(
    "Saved players cleared.",
    "Create a new player to start today’s squad.",
    true,
  );
}

function renderPlayerEditor(panel) {
  const profile = editingPlayerId
    ? savedPlayers.find((candidate) => candidate.id === editingPlayerId)
    : null;
  if (editingPlayerId && !profile) {
    editingPlayerId = null;
    editorName = "";
    editorAgentIds = new Set(STARTER_AGENT_IDS);
  }

  const form = element("form", "player-editor");
  form.noValidate = true;

  const editorHeading = element("div", "editor-heading");
  editorHeading.append(
    element("p", "eyebrow", profile ? "Saved player" : "New player"),
    element("h3", "", profile ? `Edit ${profile.name || "player"}` : "Create player"),
    element(
      "p",
      "",
      "Who are you, and which agents can the roulette assign you?",
    ),
  );
  form.append(editorHeading);

  const nameLabel = element("label", "editor-name");
  nameLabel.append(element("span", "field-label", "Name"));
  const nameInput = element("input");
  nameInput.type = "text";
  nameInput.name = "player-name";
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.autocomplete = "off";
  nameInput.placeholder = "e.g. Ana";
  nameInput.value = editorName;
  nameInput.addEventListener("input", (event) => {
    editorName = sanitizeProfileName(event.target.value);
  });
  nameLabel.append(nameInput);
  form.append(nameLabel);

  const selectorHead = element("div", "selector-head");
  const selectorTitle = element("div");
  selectorTitle.append(element("span", "field-label", "Agents you own"));
  selectorTitle.append(
    element("small", "agent-count", `${editorAgentIds.size} selected`),
  );
  const tools = element("div", "pool-tools");
  const selectAll = actionButton("Select all", "icon-btn");
  selectAll.addEventListener("click", () => {
    editorAgentIds = new Set(AGENTS.map((agent) => agent.id));
    renderLibrary();
  });
  const resetDefaults = actionButton("Reset to defaults", "icon-btn icon-btn--quiet");
  resetDefaults.addEventListener("click", () => {
    editorAgentIds = new Set(STARTER_AGENT_IDS);
    renderLibrary();
  });
  tools.append(selectAll, resetDefaults);
  selectorHead.append(selectorTitle, tools);
  form.append(selectorHead);
  form.append(
    element(
      "p",
      "pool-note",
      `The ${STARTER_AGENT_IDS.length} guaranteed agents are already selected and stay locked.`,
    ),
  );

  const agentSelector = element("div", "agent-selector");
  agentSelector.append(
    createChipGrid({
      isOn: (agent) => editorAgentIds.has(agent.id),
      isFixed: (agent) => agent.starter,
      isGone: () => false,
      isDisabled: () => false,
      onToggle: (agent, chip) => {
        editorAgentIds.has(agent.id)
          ? editorAgentIds.delete(agent.id)
          : editorAgentIds.add(agent.id);
        chip.setAttribute(
          "aria-pressed",
          editorAgentIds.has(agent.id) ? "true" : "false",
        );
        selectorTitle.querySelector(".agent-count").textContent = `${editorAgentIds.size} selected`;
      },
    }),
  );
  form.append(agentSelector);

  const actions = element("div", "editor-actions");
  const cancel = actionButton("Cancel", "button button--secondary");
  cancel.addEventListener("click", () => {
    if (!savedPlayers.length && !profile) {
      closePlayerLibrary();
      return;
    }
    libraryView = editorReturnView;
    renderLibrary();
  });
  const save = actionButton(
    profile ? "Save changes" : "Save & add to stack",
    "button button--primary",
  );
  save.type = "submit";
  actions.append(cancel, save);
  form.append(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = sanitizeProfileName(editorName).trim();
    if (!name) {
      nameInput.setAttribute("aria-invalid", "true");
      nameInput.focus();
      return;
    }

    if (!profile) {
      const newProfile = createSavedPlayer(name, editorAgentIds);
      const added = changeStack(
        () => {
          savedPlayers.push(newProfile);
          currentStackIds.push(newProfile.id);
        },
        `Adding ${name} to the current stack`,
      );
      if (!added) return;
      savePreferences();
      libraryOpen = false;
      libraryView = "choose";
      renderAll();
      showNote(
        `${name} joined the squad.`,
        `${newProfile.ownedAgentIds.size} owned agents saved on this device.`,
        true,
      );
      return;
    }

    const previousName = profile.name;
    const previousAgents = profile.ownedAgentIds;
    const ownershipChanged = !setsEqual(previousAgents, editorAgentIds);
    const applied = applyReconcilableChange({
      apply: () => {
        profile.name = name;
        profile.ownedAgentIds = new Set(editorAgentIds);
        STARTER_AGENT_IDS.forEach((agentId) => profile.ownedAgentIds.add(agentId));
      },
      rollback: () => {
        profile.name = previousName;
        profile.ownedAgentIds = previousAgents;
      },
      persistProfiles: true,
      description: ownershipChanged
        ? `Updating ${name}’s owned agents`
        : `Renaming ${previousName || "this player"}`,
    });
    if (!applied) return;
    libraryOpen = false;
    libraryView = "choose";
    renderAll();
    showNote(
      `${name} updated.`,
      `${profile.ownedAgentIds.size} owned agents saved.`,
      true,
    );
  });

  panel.append(form);
  queueMicrotask(() => nameInput.focus());
}

function renderLibrary() {
  const panel = $("#playerLibrary");
  if (!libraryOpen) {
    if (panel.open) panel.close();
    panel.replaceChildren();
    return;
  }

  panel.replaceChildren();
  const header = element("div", "library-head");
  const heading = element("div");
  heading.append(element("p", "eyebrow", "Saved on this device"));
  heading.append(
    element(
      "h2",
      "",
      libraryView === "manage"
        ? "Manage players"
        : libraryView === "editor"
          ? "Player setup"
          : "Who’s joining?",
    ),
  );
  const close = actionButton("Close", "dialog-close");
  close.setAttribute("aria-label", "Close saved players");
  close.addEventListener("click", () => closePlayerLibrary());
  header.append(heading, close);
  panel.append(header);

  if (libraryView === "editor") {
    renderPlayerEditor(panel);
  } else {
    panel.append(
      element(
        "p",
        "library-intro",
        libraryView === "manage"
          ? "Edit ownership or permanently remove profiles from this device."
          : "One tap adds a saved player to today’s squad.",
      ),
    );

    const list = element("div", "library-list");
    savedPlayers.forEach((profile, profileIndex) => {
      const inStack = currentStackIds.includes(profile.id);
      const card = element("article", "library-card");
      const monogram = element(
        "span",
        "library-monogram",
        (profile.name.trim()[0] || String(profileIndex + 1)).toUpperCase(),
      );
      monogram.setAttribute("aria-hidden", "true");
      const identity = element("span", "library-identity");
      identity.append(
        element("strong", "", profile.name.trim() || `Saved player ${profileIndex + 1}`),
        element("span", "", `${profile.ownedAgentIds.size} agents`),
      );
      card.append(monogram, identity);

      if (libraryView === "manage") {
        const controls = element("span", "library-controls");
        const edit = actionButton("Edit", "icon-btn");
        edit.addEventListener("click", () => openPlayerEditor(profile, "manage"));
        const remove = actionButton("Delete", "text-button danger");
        remove.setAttribute(
          "aria-label",
          `Permanently delete ${profile.name || `saved player ${profileIndex + 1}`}`,
        );
        remove.addEventListener("click", () => deleteSavedProfile(profile, profileIndex));
        controls.append(edit, remove);
        card.append(controls);
      } else {
        const add = actionButton(inStack ? "Playing" : "Add", "library-add");
        add.disabled = inStack || availableStackSeats() <= 0;
        if (!inStack && availableStackSeats() <= 0) {
          add.title = "All five lobby seats are already accounted for";
        }
        add.addEventListener("click", () => {
          if (add.disabled) return;
          const added = changeStack(
            () => currentStackIds.push(profile.id),
            `Adding ${profile.name || "this saved player"} to the current stack`,
          );
          if (added) closePlayerLibrary();
        });
        card.append(add);
      }
      list.append(card);
    });
    panel.append(list);

    const footer = element("div", "library-footer");
    if (libraryView === "manage") {
      const back = actionButton("Back to add players", "button button--secondary");
      back.addEventListener("click", () => {
        libraryView = "choose";
        renderLibrary();
      });
      const clear = actionButton("Delete all saved players", "text-button danger");
      clear.addEventListener("click", resetAllProfiles);
      footer.append(back, clear);
    } else {
      const create = actionButton("+ New player", "button button--primary");
      create.disabled = availableStackSeats() <= 0;
      create.addEventListener("click", () => openPlayerEditor(null, "choose"));
      const manage = actionButton("Manage players", "text-button");
      manage.addEventListener("click", () => {
        libraryView = "manage";
        renderLibrary();
      });
      footer.append(create, manage);
    }
    panel.append(footer);
  }

  if (!panel.open) panel.showModal();
}

function renderTeamSeats() {
  const seats = $("#teamSeats");
  seats.replaceChildren();
  players.forEach((player, index) => {
    const seat = element("span", "team-seat stack-seat");
    seat.append(element("b", "", playerLabel(player, index)));
    seat.append(element("small", "", "Your squad"));
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
      : "Marked picks are excluded in every mode. Smart modes also count their roles and do not guess unknown seats.";
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
  const signal = $("#teamNeedsSignal");
  teamNeedsElement.replaceChildren();

  if (players.length === 0) {
    $("#teamNeedsIntro").textContent =
      "Add someone to today’s stack to calculate role targets.";
    signal.textContent = "Add players";
    return;
  }

  const needs = getTeamNeeds(currentContext());
  if (mode === "chaos") {
    $("#teamNeedsIntro").textContent =
      "Full Chaos disables role targets. Ownership, outside picks, and distinct agents still apply.";
    signal.textContent = "Targets off";
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
  signal.textContent = required.length
    ? required.map((need) => need.role).join(" + ")
    : "Covered";
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
  $("#modeMap").setAttribute(
    "aria-pressed",
    mode === "map" ? "true" : "false",
  );
  const descriptions = {
    chaos: "Ignores role targets; ownership and distinct-agent rules still apply.",
    balanced: "Covers sensible role targets from the squad information you supply.",
    map: "Keeps every Role Balanced rule, then gently favours map-relevant legal options.",
  };
  $("#modeDescription").textContent = descriptions[mode];

  const mapPanel = $("#mapPanel");
  mapPanel.hidden = mode !== "map";
  const select = $("#mapSelect");
  if (select.options.length === 1) {
    MAPS.forEach((map) => {
      const option = element("option", "", map.name);
      option.value = map.id;
      select.append(option);
    });
  }
  select.value = selectedMapId;
  renderMapIntel();
}

function renderMapIntel() {
  const body = $("#mapIntelBody");
  body.replaceChildren();
  if (!selectedMapId) {
    body.append(element("p", "", "Choose a map to see the local data snapshot."));
    return;
  }
  const intel = getMapIntel(selectedMapId);
  if (!intel) return;
  const heading = element("div", "map-intel-heading");
  heading.append(
    element("strong", "", `${intel.map.name} · ${intel.confidence} confidence`),
    element("span", "", `${intel.sampleSize} observed map appearances`),
  );
  body.append(heading, element("p", "", intel.intel));
  const observed = element("div", "map-observed");
  observed.append(element("span", "", "Observed leaders"));
  observedAgentNames(selectedMapId).forEach(({ name, pickRate }) => {
    observed.append(element("b", "", `${name} ${pickRate}%`));
  });
  body.append(observed);
  const source = element("p", "map-source");
  source.append(document.createTextNode(`Patch 13.04 · snapshot ${intel.updatedAt} · `));
  const link = element("a", "", "public Agent Stats source");
  link.href = intel.sources.agentStats;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  source.append(link);
  body.append(source);
}

function checkFeasibility() {
  const mapReady = mode !== "map" || Boolean(selectedMapId);
  feasible = mapReady && players.length > 0 && Boolean(solveDraft(currentContext()));
  const status = $("#status");
  status.classList.toggle("bad", !feasible);

  if (players.length === 0) {
    $("#statusTitle").textContent = "Squad waiting.";
    $("#statusBody").textContent = "Add at least one player to begin.";
  } else if (!mapReady) {
    $("#statusTitle").textContent = "Choose a map first.";
    $("#statusBody").textContent = "Map Smart needs a current map before it can lock a squad.";
  } else if (feasible && matchState.draft) {
    $("#statusTitle").textContent = "Squad locked.";
    $("#statusBody").textContent = "Pin a favourite, use a personal reroll, or spend a team redraw.";
  } else if (feasible) {
    $("#statusTitle").textContent = "Ready to lock in.";
    const outsideText = takenAgentIds.size
      ? ` · ${takenAgentIds.size} outside ${takenAgentIds.size === 1 ? "pick" : "picks"} accounted for`
      : "";
    const labels = { chaos: "Full Chaos", balanced: "Role Balanced", map: `Map Smart · ${MAP_BY_ID.get(selectedMapId)?.name}` };
    $("#statusBody").textContent = `${labels[mode]}${outsideText}`;
  } else {
    const failure = explainFailure(currentContext());
    $("#statusTitle").textContent = failure.title;
    $("#statusBody").textContent = failure.body;
  }

  $("#roll").disabled = !feasible || Boolean(matchState.draft);
  $("#redraw").disabled =
    !matchState.draft || matchState.teamRedrawsRemaining <= 0 || !feasible;
  $("#newMatch").disabled = !matchState.draft;
  $("#copy").disabled = !matchState.draft;
  $("#copyOpen").disabled = !matchState.draft;
  $(".share-actions").hidden = !matchState.draft;
  $("#spinHint").textContent = matchState.draft ? "Active" : "Ready";
  $("#matchNumber").textContent = String(matchState.matchNumber).padStart(2, "0");
  $("#rerollCount").textContent = `${matchState.teamRedrawsRemaining} of ${REROLL_BUDGET} team redraws remaining`;

  const dots = $("#rerollDots");
  while (dots.children.length < REROLL_BUDGET) {
    dots.append(element("span", "reroll-dot"));
  }
  [...dots.children].forEach((dot, index) => {
    dot.classList.toggle("spent", index >= matchState.teamRedrawsRemaining);
  });
}

function stopAnimations() {
  pendingTimers.forEach((timer) => {
    clearTimeout(timer);
    clearInterval(timer);
  });
  pendingTimers.length = 0;
}

function bringRevealIntoView() {
  if (!window.matchMedia("(max-width: 720px)").matches) return;
  resultsElement.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

function renderResults(assignment, options = {}) {
  stopAnimations();
  resultsElement.replaceChildren();
  resultsElement.className = `results${assignment ? " has-draft" : ""}`;
  const compositionElement = $("#compositionSummary");
  compositionElement.hidden = true;
  compositionElement.replaceChildren();

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
    if (!players.length) {
      const empty = element("div", "draft-empty");
      empty.append(element("span", "draft-reticle", "+"));
      empty.append(element("strong", "", "Your squad reveal starts here"));
      empty.append(element("span", "", "Add players, then lock in the draft."));
      resultsElement.append(empty);
      return;
    }

    const placeholders = element("div", "result-grid placeholder-grid");
    players.forEach((player, index) => {
      const slot = element("article", "reveal-card reveal-card--waiting");
      slot.append(element("span", "res-slot", String(index + 1).padStart(2, "0")));
      const visual = element("span", "agent-visual", "?");
      visual.setAttribute("aria-hidden", "true");
      slot.append(visual);
      const copy = element("span", "waiting-copy");
      copy.append(element("strong", "", playerLabel(player, index)));
      copy.append(element("small", "", "Awaiting lock-in"));
      slot.append(copy);
      placeholders.append(slot);
    });
    resultsElement.append(placeholders);
    return;
  }

  const grid = element("div", "result-grid");
  assignment.forEach((agent, index) => {
    const player = players[index];
    const pinned = matchState.pinnedPlayerIds.has(player.id);
    const row = element("article", `res reveal-card${pinned ? " pinned" : ""}`);
    row.style.setProperty("--role-color", `var(${ROLE_CSS_VARIABLES[agent.role]})`);
    row.setAttribute(
      "aria-label",
      `${playerLabel(player, index)} received ${agent.name}, ${agent.role}`,
    );

    const top = element("div", "reveal-top");
    top.append(element("span", "res-slot", `Player ${String(index + 1).padStart(2, "0")}`));
    top.append(element("strong", "res-who", playerLabel(player, index)));
    row.append(top);

    row.append(createAgentVisual(agent));

    const main = element("div", "res-main");
    main.append(element("strong", "res-agent", agent.name));
    main.append(element("span", "res-role", agent.role));
    row.append(main);

    const actions = element("div", "res-acts");
    const pinButton = actionButton(pinned ? "Pinned" : "Pin", "token");
    pinButton.dataset.action = "pin";
    pinButton.dataset.playerId = player.id;
    pinButton.setAttribute("aria-pressed", pinned ? "true" : "false");
    actions.append(pinButton);
    const personalRemaining = getPersonalRerollsRemaining(matchState, player.id);
    const rerollButton = actionButton(`Reroll · ${personalRemaining}`, "token");
    rerollButton.dataset.action = "reroll";
    rerollButton.dataset.playerId = player.id;
    rerollButton.disabled = pinned || personalRemaining <= 0;
    rerollButton.setAttribute(
      "aria-label",
      `Reroll ${playerLabel(player, index)}; ${personalRemaining} personal rerolls remaining`,
    );
    actions.append(rerollButton);
    row.append(actions);
    grid.append(row);

    const shouldAnimate =
      options.animate &&
      !reducedMotion &&
      (!options.only || options.only.includes(index));
    if (shouldAnimate) {
      scrambleResult(row, agent, options.only ? 520 : 840 + index * 130);
    } else {
      row.classList.add("revealed");
    }
  });
  resultsElement.append(grid);
  renderCompositionSummary(assignment);
}

function scrambleResult(row, finalAgent, duration) {
  const agentElement = row.querySelector(".res-agent");
  row.classList.add("scrambling");
  const interval = setInterval(() => {
    const candidate = AGENTS[Math.floor(Math.random() * AGENTS.length)];
    agentElement.textContent = candidate.name;
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

function renderCompositionSummary(assignment) {
  const container = $("#compositionSummary");
  const composition = getCompositionSummary({
    draft: assignment,
    takenAgentIds,
    agents: AGENTS,
  });
  const heading = element("div", "composition-heading");
  heading.append(
    element("span", "eyebrow", "Accounted team"),
    element("strong", "", composition.text),
  );
  container.append(heading);

  if (mode === "map" && selectedMapId) {
    const reasons = explainMapDraft({
      mapId: selectedMapId,
      draft: assignment,
      takenAgentIds,
      agents: AGENTS,
    });
    if (reasons.length) {
      const list = element("ul", "map-reasons");
      reasons.forEach((reason) => list.append(element("li", "", reason)));
      container.append(list);
    }
  }
  container.hidden = false;
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
    personalRerollsRemaining: matchState.personalRerollsRemaining,
    teamRedrawsRemaining: matchState.teamRedrawsRemaining,
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
      "no-budget": [
        "No personal rerolls remaining.",
        "That player gets three more in a New Match.",
      ],
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
      "A single swap was not legal, so the solver rebuilt around pinned agents. Only the selected player spent one personal reroll.",
      true,
    );
  } else if (previousDraft[targetIndex].id !== matchState.draft[targetIndex].id) {
    showNote(
      `${playerLabel(players[targetIndex], targetIndex)} rerolled.`,
      "That player spent one personal reroll.",
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
  bringRevealIntoView();
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
        "No team redraws remaining.",
        "Start a New Match to refill all three team redraws.",
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
    "Every unpinned slot changed and one team redraw was spent. Personal rerolls were untouched.",
    true,
  );
});

$("#newMatch").addEventListener("click", () => {
  matchState = startNewMatch(matchState, currentStackIds);
  saveSession();
  renderResults(null, { animate: false });
  checkFeasibility();
  showNote(
    `Match ${matchState.matchNumber} is ready.`,
    "The previous draft and pins were cleared. Every player has three rerolls and the team has three redraws.",
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
  openPlayerLibrary("choose");
});
$("#managePlayers").addEventListener("click", () => {
  openPlayerLibrary(savedPlayers.length ? "manage" : "editor");
});
$("#playerLibrary").addEventListener("cancel", (event) => {
  event.preventDefault();
  closePlayerLibrary();
});

function setMode(nextMode) {
  if (mode === nextMode) return;
  const labels = { chaos: "Full Chaos", balanced: "Role Balanced", map: "Map Smart" };
  const hadActiveMatch = Boolean(matchState.draft);
  if (
    hadActiveMatch &&
    !window.confirm(
      `Switching to ${labels[nextMode]} changes the draft rules and will start a new Match. Continue?`,
    )
  ) {
    renderMode();
    return;
  }
  mode = nextMode;
  preferredMode = nextMode;
  if (hadActiveMatch) {
    matchState = startNewMatch(matchState, currentStackIds);
  }
  savePreferences();
  saveSession();
  renderAll();
  if (hadActiveMatch) {
    showNote(
      `Match ${matchState.matchNumber} is ready in ${labels[nextMode]}.`,
      "The previous draft and pins were cleared. All personal rerolls and team redraws are full.",
      true,
    );
  }
}

$("#modeBalanced").addEventListener("click", () => setMode("balanced"));
$("#modeChaos").addEventListener("click", () => setMode("chaos"));
$("#modeMap").addEventListener("click", () => setMode("map"));
$("#mapSelect").addEventListener("change", (event) => {
  const nextMapId = event.target.value;
  if (nextMapId === selectedMapId) return;
  const hadActiveMatch = Boolean(matchState.draft);
  if (
    hadActiveMatch &&
    !window.confirm(
      `Changing the map to ${MAP_BY_ID.get(nextMapId)?.name || "no map"} changes Map Smart recommendations and will start a new Match. Continue?`,
    )
  ) {
    event.target.value = selectedMapId;
    return;
  }
  selectedMapId = nextMapId;
  if (hadActiveMatch) {
    matchState = startNewMatch(matchState, currentStackIds);
  }
  savePreferences();
  saveSession();
  renderAll();
  if (hadActiveMatch) {
    showNote(
      `Match ${matchState.matchNumber} is ready for ${MAP_BY_ID.get(selectedMapId)?.name || "Map Smart"}.`,
      "The previous draft and pins were cleared. All personal rerolls and team redraws are full.",
      true,
    );
  }
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
    `The draft, pins, outside picks, personal rerolls, and ${matchState.teamRedrawsRemaining} team redraws survived the refresh.`,
    true,
  );
}
