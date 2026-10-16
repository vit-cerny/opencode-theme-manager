import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CSS_KEYS, THEME_ID_KEY, applyToDesktop, bundledThemeIds, cdpEvaluate, clearDesktop, desktopCss, findDesktopApp, findDebugPort, readDesktopTheme,
} from "../lib/desktop.mjs";

// The desktop GUI cannot be driven from files, so the mechanism under test is the one it exposes:
// localStorage keys read by its own preload. We exercise the real Chrome DevTools Protocol client
// against a throwaway headless Chromium on the same origin shape (http://127.0.0.1:<port>/).
// The real app is only inspected read-only (installed? which theme ids ship in its bundle?).

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find((file) => fs.existsSync(file));

let server = null;
let chromium = null;
let base = "";
let profile = "";
const DEBUG_PORT = 9411;

function waitFor(pattern, stream, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}`)), timeoutMs);
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const match = buffer.match(pattern);
      if (match) {
        clearTimeout(timer);
        stream.off("data", onData);
        resolve(match);
      }
    };
    stream.on("data", onData);
  });
}

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "octm-desktop-"));
  server = spawn(process.execPath, ["server.mjs", "--port", "0", "--no-open", "--config-dir", path.join(profile, "config")], { cwd: repo });
  const [, port] = await waitFor(/http:\/\/127\.0\.0\.1:(\d+)\//, server.stdout);
  base = `http://127.0.0.1:${port}/`;
  if (!chrome) return;
  chromium = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(profile, "chrome")}`, `--remote-debugging-port=${DEBUG_PORT}`, base,
  ], { stdio: "ignore" });
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = await findDebugPort([DEBUG_PORT]);
    if (found?.targets.some((target) => target.url.startsWith(base))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});

after(() => {
  chromium?.kill();
  server?.kill();
  if (profile && fs.existsSync(profile)) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch { /* chromium may still hold a lock on Windows */ }
  }
});

test("the desktop app is detected and its bundled themes are readable", (t) => {
  const ports = findDesktopApp();
  if (!ports.installed) {
    t.diagnostic("desktop app not installed on this machine - detection returns a clean negative");
    assert.equal(ports.installed, false);
    assert.equal(ports.exe, null);
    return;
  }
  assert.ok(fs.existsSync(ports.exe), "exe exists");
  assert.ok(ports.profile.length > 0, "profile path resolved");
  const ids = bundledThemeIds();
  assert.ok(ids.length >= 20, `expected the bundled theme set, got ${ids.length}`);
  assert.ok(ids.includes("oc-2"), "the default theme id is oc-2");
  assert.ok(ids.includes("nord"), "nord ships with the app");
  t.diagnostic(`${ids.length} bundled desktop themes, exe ${ports.exe}`);
});

test("generated CSS drives the desktop app's own variable names", () => {
  const resolved = {
    "text.base": "#e6ecf7", "text.muted": "#9aa6bd", "text.action.primary.base": "#7aa2f7",
    "border.base": "#ffffff26", "scrollbar.base": "#ffffff40", "background.base": "#10162380",
    "background.raised.base": "#171d29a6", "diff.text.added": "#9ae6b4", "diff.text.removed": "#ff9a9a",
    "text.feedback.success.base": "#9ae6b4", "text.feedback.warning.base": "#f5c542",
    "text.feedback.error.base": "#ff8080", "text.feedback.info.base": "#7aa2f7",
    "background.feedback.success.base": "#12271a", "background.feedback.warning.base": "#2b2313",
    "background.feedback.error.base": "#2c1618", "background.feedback.info.base": "#141d2e",
  };
  const css = desktopCss(resolved, { monoFont: "JetBrains Mono", radius: 14, lineHeight: 1.5, blur: 20, customCss: "/* user block */" });
  for (const variable of ["--v2-text-text-base", "--v2-icon-icon-base", "--v2-border-border-base", "--v2-state-fg-danger", "--background-base", "--border-radius"]) {
    assert.ok(css.includes(variable), `css sets ${variable}`);
  }
  assert.match(css, /--v2-text-text-base: #e6ecf7 !important;/);
  assert.match(css, /--v2-font-family-code: "JetBrains Mono", ui-monospace, monospace !important;/);
  assert.match(css, /--border-radius: 14px !important;/);
  assert.match(css, /backdrop-filter: blur\(20px\)/);
  assert.ok(css.includes("/* user block */"), "custom css is appended last");
});

test("CDP round-trip: refuses a foreign page, then injects into the app page", async (t) => {
  if (!chrome) {
    t.skip("no Chromium binary available for the CDP harness");
    return;
  }
  // The harvest page here is the manager UI, not the app: it must be refused, not restyled.
  await assert.rejects(() => applyToDesktop({ css: "body{--octm-test:1}", themeId: "nord", port: DEBUG_PORT, reload: false }), /not the opencode app/);

  // Mark the page the way the app's preload does, then the same call must go through.
  const target = (await findDebugPort([DEBUG_PORT])).targets[0];
  await cdpEvaluate(target.ws, 'document.documentElement.setAttribute("data-theme","oc-2")');

  const app = await applyToDesktop({ css: "body{--octm-test:1}", light: "body{--octm-test-light:1}", themeId: "nord", port: DEBUG_PORT, reload: false });
  assert.equal(app.probe.isApp, true);
  assert.equal(app.result[THEME_ID_KEY], "nord");

  const state = await readDesktopTheme(DEBUG_PORT);
  assert.equal(state.theme, "nord");
  assert.equal(state.hasDark, true);
  assert.equal(state.hasLight, true);

  const cleared = await clearDesktop(DEBUG_PORT);
  assert.equal(cleared.result[THEME_ID_KEY], "oc-2");
  const after = await readDesktopTheme(DEBUG_PORT);
  assert.equal(after.theme, "oc-2");
  assert.equal(after.hasDark, false);
  assert.equal(after.hasLight, false);
});

test("a closed debug port fails with an actionable message", async () => {
  await assert.rejects(() => readDesktopTheme(9412), /debug port/);
  await assert.rejects(() => applyToDesktop({ css: "x", port: 9412 }), /debug port/);
});
