import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cdpEvaluate, findDebugPort } from "../lib/desktop.mjs";

// UI-level check: drive the real manager in a real browser and click the real buttons.
// This is the "make sure it works" half - the API tests prove the server, these prove the tool.

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find((file) => fs.existsSync(file));
// 9222 by default: that is the port the manager probes (`DEFAULT_DEBUG_PORT`), so the UI's own
// discovery finds this browser the way it finds the relaunched desktop app. If the real app already
// holds 9222 we move to a random port and skip the desktop-live assertion instead of failing.
const DESKTOP_PORT = 9222;
let DEBUG_PORT = DESKTOP_PORT;
let portFree = true;

let server = null;
let chromium = null;
let profile = "";
let page = null;
const logs = [];

const waitFor = (target, expression, timeoutMs = 20_000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = async () => {
    try {
      const value = await cdpEvaluate(page, expression);
      if (value) return resolve(value);
    } catch { /* page still loading */ }
    if (Date.now() - started > timeoutMs) return reject(new Error(`timed out: ${expression}`));
    setTimeout(tick, 250);
  };
  tick();
});

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "octm-ui-"));
  server = spawn(process.execPath, ["server.mjs", "--port", "0", "--no-open", "--config-dir", path.join(profile, "config")], { cwd: repo });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 15_000);
    let buffer = "";
    server.stdout.on("data", (chunk) => {
      buffer += chunk;
      const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    server.stderr.on("data", (chunk) => { buffer += chunk; });
    server.on("exit", (code) => reject(new Error(`server exited ${code}: ${buffer}`)));
  });
  if (!chrome) return;
  portFree = !(await findDebugPort([DESKTOP_PORT]));
  if (!portFree) DEBUG_PORT = 9440 + (process.pid % 40);
  chromium = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(profile, "chrome")}`, `--remote-debugging-port=${DEBUG_PORT}`, `http://127.0.0.1:${port}/`], { stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt++) {
    const targets = await findDebugPort([DEBUG_PORT]);
    const target = targets?.targets.find((candidate) => candidate.url.startsWith("http://127.0.0.1:"));
    if (target) {
      page = target.ws;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(page, "headless browser page for the manager");
  await waitFor(null, "!!document.getElementById('status')");
  // Fail loudly if the UI itself throws after this point (clicks below).
  await cdpEvaluate(page, `window.__errors = []; window.addEventListener("error", (e) => window.__errors.push(String(e.message))); window.__errors.length`);
});

after(() => {
  if (chromium?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(chromium.pid), "/T", "/F"], { stdio: "ignore" });
    else chromium.kill("SIGKILL");
  }
  if (process.platform === "win32") {
    spawnSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*octm-ui-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore" });
  }
  server?.kill();
  if (profile && fs.existsSync(profile)) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch { /* chromium may still hold a lock */ }
  }
});

test("the manager boots, reads the real config and reports its panels", async (t) => {
  if (!chrome) return t.skip("no Chromium binary available");
  // desktopInfo is fetched after boot; wait for it instead of racing it.
  await waitFor(null, `/app:|no opencode desktop app/i.test(document.getElementById("desktopInfo").textContent)`);
  const summary = await waitFor(null, `JSON.stringify({
    panels: [...document.querySelectorAll(".rail .panel > summary")].map((node) => node.textContent.trim()),
    status: document.getElementById("status").textContent,
    paths: document.getElementById("paths").textContent,
    previewPanes: document.querySelectorAll("#tui .tui-body, #tui .tui-prompt, #tui .tui-status").length,
    hueCells: document.querySelectorAll(".hue-cell").length,
    tokenRows: document.querySelectorAll(".token-row").length,
    desktopInfo: document.getElementById("desktopInfo").textContent.slice(0, 400)
  })`);
  const state = JSON.parse(summary);
  assert.equal(state.panels.length, 9, `nine panels, saw ${state.panels.length}: ${state.panels.join(" | ")}`);
  assert.match(state.paths, /config/i);
  assert.equal(state.previewPanes, 3, "preview has body, prompt and status");
  assert.ok(state.hueCells >= 20, `hue swatches rendered (${state.hueCells})`);
  assert.ok(state.tokenRows > 50, `token rows rendered (${state.tokenRows})`);
  assert.match(state.desktopInfo, /app:/);
  assert.match(state.desktopInfo, /bundled themes: \d+/);
  t.diagnostic(`status: ${state.status} | desktop panel: ${state.desktopInfo.replace(/\s+/g, " ").slice(0, 80)}`);
});

test("typing a prompt and pressing the button restyles the live preview", async (t) => {
  if (!chrome) return t.skip("no Chromium binary available");
  const before = await cdpEvaluate(page, "getComputedStyle(document.getElementById('tui')).getPropertyValue('--oc-bg').trim()");
  await cdpEvaluate(page, `(() => {
    const input = document.getElementById("prompt");
    input.value = "cyberpunk neon frosted glass, rounded corners, 70% transparency";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("btnGenerate").click();
    return true;
  })()`);
  const after = await waitFor(null, `(() => {
    const validation = document.getElementById("validation").textContent;
    const matched = document.getElementById("matched").textContent;
    const bg = getComputedStyle(document.getElementById("tui")).getPropertyValue("--oc-bg").trim();
    if (!/understood/i.test(matched)) return "";
    if (!/valid/i.test(validation)) return "";
    return JSON.stringify({ validation, bg, matched, status: document.getElementById("status").textContent });
  })()`, 20_000);
  const result = JSON.parse(after);
  assert.match(result.validation, /valid/i);
  assert.match(result.matched, /understood/i);
  assert.notEqual(result.bg, before, `preview background changed (${before} -> ${result.bg})`);
  t.diagnostic(`bg ${before} -> ${result.bg}; ${result.status}`);
});

test("the desktop button applies CSS live to the app page (no reload)", async (t) => {
  if (!chrome) return t.skip("no Chromium binary available");
  if (!portFree) return t.skip("the real desktop app holds port 9222, so this browser cannot stand in for it");
  // Make this page look like the opencode app: its preload sets data-theme on <html>.
  await cdpEvaluate(page, 'document.documentElement.setAttribute("data-theme", "oc-2")');
  await cdpEvaluate(page, 'document.getElementById("desktopInfo").textContent = ""');
  await cdpEvaluate(page, 'document.getElementById("btnDesktopGlass").click()');
  const result = await waitFor(null, `(() => {
    const status = document.getElementById("status").textContent;
    const stored = localStorage.getItem("opencode-theme-css-dark");
    const live = document.getElementById("oc-theme-preload");
    if (!stored || !live) return "";
    return JSON.stringify({ status, bytes: stored.length, applied: live.textContent.length, fonts: /JetBrains Mono|ui-monospace/.test(live.textContent), vars: live.textContent.includes("--v2-text-text-base") });
  })()`, 20_000);
  const applied = JSON.parse(result);
  assert.ok(applied.bytes > 1000, `css stored (${applied.bytes} bytes)`);
  assert.equal(applied.applied, applied.bytes, "the style element got the same CSS without a reload");
  assert.equal(applied.vars, true, "desktop variable names present");
  t.diagnostic(applied.status);
});

test("the banner and buttons all wired up without console errors", async (t) => {
  if (!chrome) return t.skip("no Chromium binary available");
  const errors = await cdpEvaluate(page, "JSON.stringify(window.__errors || [])");
  assert.deepEqual(JSON.parse(errors), [], "no uncaught errors in the UI");
  const labels = JSON.parse(await cdpEvaluate(page, `JSON.stringify([...document.querySelectorAll("button")].map((b) => b.textContent.trim()))`));
  for (const expected of ["Save theme", "Apply to opencode", "Make it look like this", "Apply glass CSS to desktop app", "Restart app with theming", "Clear override", "Write terminal transparency", "Write terminal font", "Write cli.json layout"]) {
    assert.ok(labels.includes(expected), `button present: ${expected}`);
  }
  t.diagnostic(`${labels.length} buttons wired`);
});
