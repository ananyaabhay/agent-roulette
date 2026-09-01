import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../app.js", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const cssUrl = new URL("../styles.css", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);

test("browser UI uses safe DOM APIs instead of dynamic innerHTML", async () => {
  const appSource = await readFile(appUrl, "utf8");
  assert.doesNotMatch(appSource, /\.innerHTML\s*=/);
  assert.match(appSource, /textContent/);
  assert.match(appSource, /replaceChildren/);
});

test("visible product copy uses Roll Style, lineup, and Match terminology", async () => {
  const [appSource, htmlSource, readmeSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(readmeUrl, "utf8"),
  ]);
  // The rule is about words the user reads, not identifiers. Math.round is not
  // product copy, so strip API calls before checking for the banned term.
  const appCopy = appSource.replace(/\bMath\.round\b/g, "");
  assert.doesNotMatch(appCopy, /\bround\b/i);
  assert.doesNotMatch(htmlSource, /\bround\b/i);
  for (const source of [appCopy, htmlSource, readmeSource]) {
    assert.doesNotMatch(source, /Draft Structure|Tactical Draft|Full Chaos/i);
  }
  assert.match(htmlSource, /Roll style/i);
  assert.match(appSource, /ArrowLeft:[\s\S]*ArrowRight:[\s\S]*Home:[\s\S]*End:/);
  assert.match(htmlSource, /New Match/);
  assert.match(appSource, /Match.*restored/);
});

test("unified player setup, Match persistence, and Discord flow are present", async () => {
  const [appSource, htmlSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
  ]);
  assert.match(htmlSource, /Who’s playing\?/);
  assert.match(appSource, /Select all/);
  assert.match(appSource, /Reset to defaults/);
  assert.match(appSource, /Save & add to stack/);
  assert.doesNotMatch(appSource, /Default agents only/);
  assert.doesNotMatch(appSource, /All agents/);
  assert.match(htmlSource, /playerLibrary/);
  assert.match(appSource, /sessionStorage/);
  assert.match(htmlSource, /Copy result/i);
  assert.match(htmlSource, /Open Discord/);
  assert.doesNotMatch(htmlSource, /Copy &amp; open Discord|copyOpen/);
  assert.doesNotMatch(appSource, /copyOpen|window\.open\(DISCORD/);
  assert.match(appSource, /Open Discord and paste it into your chat/);
});

test("Team Needs, Notes, status tones, and device-storage copy have one clear job", async () => {
  const [appSource, htmlSource, cssSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);
  assert.match(htmlSource, /<section class="team-needs"/);
  assert.doesNotMatch(htmlSource, /<details class="team-needs"/);
  assert.match(appSource, /Reference only — not enforced in Chaos/);
  assert.match(appSource, /"Notes"/);
  assert.doesNotMatch(appSource, /Map notes|Composition notes|Draft notes/i);
  assert.match(cssSource, /#spinHint\[data-tone="idle"\].*var\(--quiet\)/);
  assert.match(cssSource, /#spinHint\[data-tone="bad"\].*var\(--accent\)/);
  assert.match(cssSource, /data-tone="ready"[\s\S]*data-tone="locked"[\s\S]*var\(--go\)/);
  assert.doesNotMatch(htmlSource, /Local profiles/i);
  assert.match(htmlSource, /Saved on this device/i);
});

test("squad reveal and shared reroll presentation are wired", async () => {
  const [appSource, htmlSource, cssSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);
  assert.match(htmlSource, /Lock us in/);
  assert.match(appSource, /agent-portrait/);
  assert.match(appSource, /rerolls remaining/);
  assert.match(cssSource, /\.reroll-dot\s*\{/);
  assert.match(cssSource, /border-radius:\s*50%/);
  assert.match(cssSource, /\.reveal-card/);
});

test("metadata, favicon, focus styles, reduced motion, and mobile targets are wired", async () => {
  const [htmlSource, cssSource] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);
  assert.match(htmlSource, /property="og:title"/);
  assert.match(htmlSource, /rel="icon"/);
  assert.match(cssSource, /:focus-visible/);
  assert.match(cssSource, /prefers-reduced-motion/);
  assert.match(cssSource, /min-height: 44px/);
});
