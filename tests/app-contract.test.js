import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../app.js", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const cssUrl = new URL("../styles.css", import.meta.url);

test("browser UI uses safe DOM APIs instead of dynamic innerHTML", async () => {
  const appSource = await readFile(appUrl, "utf8");
  assert.doesNotMatch(appSource, /\.innerHTML\s*=/);
  assert.match(appSource, /textContent/);
  assert.match(appSource, /replaceChildren/);
});

test("visible product copy consistently uses Match terminology", async () => {
  const [appSource, htmlSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
  ]);
  // The rule is about words the user reads, not identifiers. Math.round is not
  // product copy, so strip API calls before checking for the banned term.
  const appCopy = appSource.replace(/\bMath\.round\b/g, "");
  assert.doesNotMatch(appCopy, /\bround\b/i);
  assert.doesNotMatch(htmlSource, /\bround\b/i);
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
  assert.match(htmlSource, /Copy &amp; open Discord/);
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
