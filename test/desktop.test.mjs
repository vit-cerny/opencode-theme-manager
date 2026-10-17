import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CSS_KEYS, DEFAULT_DEBUG_PORT, THEME_ID_KEY, applyToDesktop, bundledThemeIds, cdpEvaluate, clearDesktop, desktopCss, findDesktopApp, findDebugPort, probeTarget, readDesktopTheme,
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
// Fresh port per run: a leaked Chromium from an earlier run would otherwise keep the old one bound.
const DEBUG_PORT = 9420 + (process.pid % 40);

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
  if (chromium?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(chromium.pid), "/T", "/F"], { stdio: "ignore" });
    else chromium.kill("SIGKILL");
  }
  // Also reap any Chromium left behind by an earlier run of this test (matched by our temp profile
  // path only - never the user's browser).
  if (process.platform === "win32") {
    spawnSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*octm-desktop-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore" });
  }
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
  const css = desktopCss(resolved, { monoFont: "JetBrains Mono", radius: 14, blur: 20, customCss: "/* user block */" });
  // Names read live off the running app (oc://renderer/index.html) - if the app renames one, this fails.
  for (const variable of ["--background-base", "--surface-base", "--surface-raised-base", "--text-base", "--text-weak", "--icon-base", "--border-base", "--success-bg", "--error-text", "--border-radius"]) {
    assert.ok(css.includes(variable), `css sets ${variable}`);
  }
  // The window fill must be opaque (no transparent/Mica flag in the app's window options) while the
  // surfaces on top keep their alpha - that is the difference between "themed" and "looks unchanged".
  assert.match(css, /--background-base: #101623 !important;/);
  assert.match(css, /--surface-raised-base: #171d29a6 !important;/);
  assert.match(css, /--surface-raised-stronger: #232c3e !important;/);
  assert.match(css, /--border-radius: 14px !important;/);
  assert.match(css, /--v2-font-family-code: "JetBrains Mono", ui-monospace, monospace !important;/);
  assert.match(css, /backdrop-filter: blur\(20px\)/);
  assert.ok(css.includes("/* user block */"), "custom css is appended last");
  assert.equal(desktopCss(resolved, {}).includes("--v2-font-family-code: var(--v2-font-family-code);"), true, "no font requested keeps the app's own font");
  // Backdrop mode: window layer transparent (so the OS blur could show) and no in-page blur at all.
  const backdropCss = desktopCss(resolved, { backdrop: "acrylic", monoFont: "JetBrains Mono", blur: 20 });
  assert.match(backdropCss, /--background-base: transparent !important;/);
  assert.equal(/backdrop-filter:\s*blur/.test(backdropCss), false, "no in-page blur when the OS does it");
  assert.match(desktopCss(resolved, {}), /backdrop-filter: blur\(18px\)/, "default keeps the container-level blur");
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

test("a themed page on a foreign origin is not treated as the app", async (t) => {
  if (!chrome) {
    t.skip("no Chromium binary available for the CDP harness");
    return;
  }
  const target = (await findDebugPort([DEBUG_PORT])).targets[0];
  await cdpEvaluate(target.ws, 'document.documentElement.setAttribute("data-theme", "oc-2")');
  const local = await probeTarget(target.ws, target.url);
  const foreign = await probeTarget(target.ws, "https://tailwindcss.com/docs/installation");
  assert.equal(local.isApp, true, "loopback page with data-theme is an app surface");
  assert.equal(foreign.isApp, false, "the same page fetched from a remote origin would be refused");
});

test("the desktop app's real surface variables are what we write", async (t) => {
  // Read-only against the live app when it is running with a debug port: proves the names in
  // lib/schema.mjs#desktopClientCss are the ones the app actually defines.
  const found = await findDebugPort([DEFAULT_DEBUG_PORT]);
  const target = found?.targets.find((candidate) => candidate.url.startsWith("oc:"));
  if (!target) {
    t.skip("no opencode app page on 9222 (run tools/desktop-apply.mjs --glass --restart; a stand-in browser on the same port is not the app)");
    return;
  }
  const names = await cdpEvaluate(target.ws, `(() => {
    const out = new Set();
    for (const sheet of document.styleSheets) {
      let rules = []; try { rules = sheet.cssRules || []; } catch { continue; }
      for (const rule of rules) if (rule.style) for (const prop of rule.style) if (prop.startsWith("--")) out.add(prop);
    }
    return JSON.stringify([...out]);
  })()`);
  const defined = new Set(JSON.parse(names));
  const required = ["--background-base", "--surface-base", "--surface-raised-base", "--text-base", "--text-weak", "--icon-base", "--border-base", "--border-radius", "--success-bg", "--error-text"];
  const missing = required.filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `the app no longer defines: ${missing.join(", ")}`);
  t.diagnostic(`${defined.size} variables defined by the app; all ${required.length} names we write exist (${target.url})`);
});

test("a closed debug port fails with an actionable message", async () => {
  await assert.rejects(() => readDesktopTheme(9412), /debug port/);
  await assert.rejects(() => applyToDesktop({ css: "x", port: 9412 }), /debug port/);
});
