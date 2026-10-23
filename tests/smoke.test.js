// End-to-end: load index.html and app.js in a real DOM and check the page boots.
//
// This exists because a missing import shipped to production. `node --check`
// passes on an undefined reference, and every other test here imports modules
// directly without ever executing app.js — so nothing caught it. The banner
// threw on every page load for days while the suite stayed green.
//
// Anything that stops the page rendering should fail here first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { AGENTS } from "../data/game-data.js";

async function bootPage({ preferences, session } = {}) {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost:8000/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
  global.Image = window.Image;
  Object.defineProperty(global, "navigator", {
    value: window.navigator,
    configurable: true,
  });
  global.requestAnimationFrame =
    window.requestAnimationFrame?.bind(window) ?? ((fn) => setTimeout(fn, 0));
  global.cancelAnimationFrame =
    window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
  window.matchMedia =
    window.matchMedia ||
    ((query) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
  global.matchMedia = window.matchMedia;

  // jsdom has no dialog support; the real browser does.
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };

  const errors = [];
  window.addEventListener("error", (event) =>
    errors.push(String(event.error || event.message)),
  );

  if (preferences) {
    localStorage.setItem("agent-roulette:preferences:v3", JSON.stringify(preferences));
  }
  if (session) {
    sessionStorage.setItem("agent-roulette:match-session:v2", JSON.stringify(session));
  }

  // Cache-bust so each test gets a fresh module against its own DOM.
  await import(`../app.js?boot=${Math.random()}`);
  return { window, errors, $: (sel) => window.document.querySelector(sel) };
}

test("the page boots without throwing", async () => {
  const { errors } = await bootPage();
  assert.deepEqual(errors, [], "page raised runtime errors on load");
});

test("every element app.js reaches for actually exists in index.html", async () => {
  const [appSource, html] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  const ids = [...appSource.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map(
    (match) => match[1],
  );
  const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `app.js queries ids not in index.html`);
});

test("the setup, spin and status surfaces all render", async () => {
  const { $ } = await bootPage();
  assert.ok($("#players").children.length > 0, "no player row rendered");
  assert.ok($("#roll").textContent.trim().length > 0, "spin button is empty");
  assert.ok($("#statusTitle").textContent.trim().length > 0, "status is empty");
  assert.ok(
    $("#modeDescription").textContent.trim().length > 0,
    "structure description is empty",
  );
  assert.equal($("#spinHint").dataset.tone, "idle");
});

test("the next-agent banner renders with its trailer link", async () => {
  const { $ } = await bootPage();
  const banner = $("#upcomingBanner");
  assert.ok(banner, "banner element is missing from index.html");
  assert.equal(banner.hidden, false, "banner did not render");
  assert.match($("#upcomingHeadline").textContent, /Hush/);
  assert.match(
    $("#upcomingTrailer").getAttribute("href"),
    /^https:\/\/www\.youtube\.com\//,
  );
});

test("every module app.js imports resolves", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const paths = [...appSource.matchAll(/from\s+"(\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, "found no local imports to check");
  for (const path of paths) {
    await import(new URL(`../${path.replace("./", "")}`, import.meta.url));
  }
});

const SQUAD = ["Yoyo", "Jinn", "Karma", "Jack", "Koko"].map((name, index) => ({
  id: `p${index}`,
  name,
  ownedAgentIds: AGENTS.map((agent) => agent.id),
}));

function seededStorage(stackSize) {
  return {
    preferences: {
      version: 3,
      preferredMode: "balanced",
      preferredStructure: 1,
      selectedMapId: "",
      savedPlayers: SQUAD,
    },
    session: {
      version: 2,
      mode: "balanced",
      selectedMapId: "",
      currentStackIds: SQUAD.slice(0, stackSize).map((player) => player.id),
      takenAgentIds: [],
      matchState: {
        matchNumber: 1,
        draftAgentIds: null,
        pinnedPlayerIds: [],
        personalRerollsRemaining: {},
        teamRedrawsRemaining: 3,
      },
    },
  };
}

const seatNames = ($) =>
  [...$("#teamSeats").querySelectorAll("b")].map((node) => node.textContent);

test("a full stack shows all five lobby seats after a refresh", async () => {
  const { $ } = await bootPage(seededStorage(5));
  assert.deepEqual(seatNames($), SQUAD.map((player) => player.name));
  assert.equal($("#outsideCount").textContent, "Full stack");
  assert.equal($("#lobbySection").hidden, true);
});

test("adding the fifth player replaces the unknown seat", async () => {
  const { $, window } = await bootPage(seededStorage(4));
  assert.deepEqual(seatNames($), ["Yoyo", "Jinn", "Karma", "Jack", "?"]);
  assert.equal($("#outsideCount").textContent, "1 outside · 0 known");
  $("#addPlayer").click();
  [...window.document.querySelectorAll(".library-add")]
    .find((button) => !button.disabled)
    .click();
  assert.deepEqual(seatNames($), SQUAD.map((player) => player.name));
  assert.equal($("#outsideCount").textContent, "Full stack");
});

test("team needs states a status instead of repeating the role list", async () => {
  const { $ } = await bootPage(seededStorage(5));
  assert.equal($("#teamNeedsSignal").textContent, "4 roles to fill");
  assert.match($("#teamNeeds").textContent, /Duelist · Initiator · Controller · Sentinel/);
});

test("the feedback link stays hidden until a form URL is configured", async () => {
  const { $ } = await bootPage();
  assert.equal($("#feedbackEntry").hidden, true);
  assert.equal($("#feedbackLink").hasAttribute("href"), false);
});
