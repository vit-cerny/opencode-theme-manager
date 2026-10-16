// Desktop client support (the @opencode-aidesktop GUI).
//
// Evidence: that app is a Chromium shell around the opencode web app. Its bundle
// (resources/app.asar) contains the preload that restores injected CSS:
//   var themeId = localStorage.getItem("opencode-theme-id") || "oc-2"
//   var css = localStorage.getItem("opencode-theme-css-" + mode)
// and 36 bundled themes under ./themes/<id>.json, applied as CSS variables named
// --v2-<group>-<name> (--v2-text-text-base, --v2-border-border-base, ...) plus
// --font-family-text, --v2-font-family-code, --border-radius.
//
// So the GUI has exactly two levers, both localStorage: which bundled theme id to use,
// and a raw CSS override. There is no file hook and no config key. This module drives
// them over the Chrome DevTools Protocol, which needs the app started with
// --remote-debugging-port=<port>.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DESKTOP_THEME_ID_KEY } from "./schema.mjs";

export const THEME_ID_KEY = DESKTOP_THEME_ID_KEY;
export const COLOR_SCHEME_KEY = "opencode-color-scheme";
export const CSS_KEYS = { dark: "opencode-theme-css-dark", light: "opencode-theme-css-light" };
export const DEFAULT_DEBUG_PORT = 9222;

export function desktopCandidates() {
  const local = process.env.LOCALAPPDATA || "";
  const roaming = process.env.APPDATA || "";
  const roots = [
    path.join(local, "Programs", "@opencode-aidesktop"),
    path.join(local, "Programs", "@openchamberelectron"),
    path.join(local, "Programs", "opencode-desktop"),
  ];
  const userData = [path.join(roaming, "ai.opencode.desktop"), path.join(roaming, "openchamber")];
  return { roots, userData };
}

export function findDesktopApp() {
  const { roots, userData } = desktopCandidates();
  const root = roots.find((dir) => fs.existsSync(dir)) || null;
  const exe = root
    ? ["OpenCode.exe", "opencode.exe", "OpenChamber.exe"].map((name) => path.join(root, name)).find((file) => fs.existsSync(file)) || null
    : null;
  const profile = userData.find((dir) => fs.existsSync(dir)) || userData[0];
  const settingsFile = path.join(profile, "opencode.settings");
  let settings = null;
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    } catch { /* leave null, the file is app-owned */ }
  }
  const asar = root ? path.join(root, "resources", "app.asar") : null;
  const localStore = path.join(profile, "Local Storage", "leveldb");
  return {
    installed: Boolean(root && exe),
    root,
    exe,
    profile,
    settingsFile,
    settings,
    asar: asar && fs.existsSync(asar) ? asar : null,
    localStore: fs.existsSync(localStore) ? localStore : null,
    bundledCli: (() => {
      const cliRoot = path.join(profile, "cli");
      if (!fs.existsSync(cliRoot)) return null;
      const version = fs.readdirSync(cliRoot).find((entry) => /^\d+\./.test(entry));
      return version ? path.join(cliRoot, version, "opencode-cli.exe") : null;
    })(),
  };
}

// The GUI ships its themes inside app.asar; the ids are what `opencode-theme-id` accepts.
// Memoised: the asar is 168 MB and scanning it takes seconds, so do it once per process.
let themeIdCache = null;
export function bundledThemeIds() {
  if (themeIdCache) return themeIdCache;
  const app = findDesktopApp();
  if (!app.asar) return [];
  const text = fs.readFileSync(app.asar).toString("latin1");
  const ids = new Set();
  for (const match of text.matchAll(/\.\/themes\/([a-z0-9._-]+)\.json/g)) ids.add(match[1]);
  themeIdCache = [...ids].sort();
  return themeIdCache;
}

/* ---------------------------------- CDP ---------------------------------- */

export async function debugTargets(port = DEFAULT_DEBUG_PORT, timeout = 1500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.filter((target) => target.type === "page").map((target) => ({ id: target.id, title: target.title, url: target.url, ws: target.webSocketDebuggerUrl }));
  } catch {
    return null;
  }
}

export async function findDebugPort(ports = [DEFAULT_DEBUG_PORT]) {
  for (const port of ports) {
    const targets = await debugTargets(port);
    if (targets) return { port, targets };
  }
  return null;
}

// A candidate page is only touched if it is really the opencode web app: its preload sets
// data-theme on <html> (and only the app writes opencode-theme-id). A random browser tab on the
// same machine will never match, so this cannot restyle an unrelated page.
export async function probeTarget(ws) {
  try {
    const value = await cdpEvaluate(ws, `(() => ({
      origin: location.origin,
      title: document.title,
      themed: document.documentElement.hasAttribute("data-theme"),
      theme: localStorage.getItem(${JSON.stringify(THEME_ID_KEY)}),
      hasDark: localStorage.getItem(${JSON.stringify(CSS_KEYS.dark)}) !== null,
      hasLight: localStorage.getItem(${JSON.stringify(CSS_KEYS.light)}) !== null,
      stored: localStorage.getItem(${JSON.stringify(THEME_ID_KEY)}) !== null
    }))()`);
    return { ...value, isApp: Boolean(value && (value.themed || value.stored)) };
  } catch (error) {
    return { error: error.message, isApp: false };
  }
}

function cdpCall(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
    const onMessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (payload.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

export async function cdpEvaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`cannot connect to ${wsUrl}`)), { once: true });
    });
    const result = await cdpCall(ws, 1, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluation failed");
    return result.result?.value;
  } finally {
    try {
      ws.close();
    } catch { /* already closed */ }
  }
}

export function injectionScript({ themeId, scheme, dark, light, reload, live = true }) {
  const payload = JSON.stringify({ themeId, scheme, dark, light });
  return `(() => {
  const spec = ${payload};
  const out = {};
  if (spec.themeId) localStorage.setItem(${JSON.stringify(THEME_ID_KEY)}, spec.themeId);
  if (spec.scheme) localStorage.setItem(${JSON.stringify(COLOR_SCHEME_KEY)}, spec.scheme);
  const put = (key, value) => {
    if (value === null) localStorage.removeItem(key);
    else if (typeof value === "string") localStorage.setItem(key, value);
  };
  const darkKey = ${JSON.stringify(CSS_KEYS.dark)};
  const lightKey = ${JSON.stringify(CSS_KEYS.light)};
  put(darkKey, spec.dark === undefined ? undefined : spec.dark);
  put(lightKey, spec.light === undefined ? undefined : spec.light);
  // Apply immediately as well, so a running window restyles without a reload. The style element
  // reuses the id the app's own preload uses, so the next start replaces it from localStorage.
  if (${live}) {
    const css = localStorage.getItem(darkKey) || localStorage.getItem(lightKey) || "";
    let style = document.getElementById("oc-theme-preload");
    if (!style) {
      style = document.createElement("style");
      style.id = "oc-theme-preload";
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
    out.appliedNow = css.length;
  }
  for (const key of [${JSON.stringify(THEME_ID_KEY)}, ${JSON.stringify(CSS_KEYS.dark)}, ${JSON.stringify(CSS_KEYS.light)}]) {
    const value = localStorage.getItem(key);
    out[key] = value === null ? null : (value.length > 60 ? value.slice(0, 57) + "..." : value);
  }
  out.origin = location.origin;
  if (spec.reload) setTimeout(() => location.reload(), 300);
  return out;
})()`;
}

export async function readDesktopTheme(port = DEFAULT_DEBUG_PORT) {
  const found = await findDebugPort([port]);
  if (!found) throw new Error(`no debug port on ${port} - start the desktop app with --remote-debugging-port=${port}`);
  const probes = [];
  for (const target of found.targets) {
    const probe = await probeTarget(target.ws);
    probes.push({ url: target.url, ...probe });
    if (!probe.isApp) continue;
    return { port: found.port, target, origin: probe.origin, title: probe.title, theme: probe.theme, hasDark: probe.hasDark, hasLight: probe.hasLight };
  }
  throw new Error(`port ${found.port} is open but none of its ${found.targets.length} page(s) is the opencode app (${probes.map((p) => p.url).join(", ")})`);
}

export async function applyToDesktop({ css, light, themeId, scheme, port = DEFAULT_DEBUG_PORT, reload = false, live = true }) {
  const found = await findDebugPort([port]);
  if (!found) throw new Error(`no debug port on ${port} - restart the app with --remote-debugging-port=${port}`);
  const problems = [];
  for (const target of found.targets) {
    const probe = await probeTarget(target.ws);
    if (!probe.isApp) {
      problems.push(`${target.url} is not the opencode app${probe.error ? ` (${probe.error})` : ""}`);
      continue;
    }
    const result = await cdpEvaluate(target.ws, injectionScript({ themeId, scheme, dark: css, light, reload, live }));
    return { port: found.port, target: { id: target.id, url: target.url, title: target.title }, probe, result };
  }
  throw new Error(`nothing to inject into on port ${found.port}: ${problems.join("; ")}`);
}

export async function clearDesktop(port = DEFAULT_DEBUG_PORT) {
  return applyToDesktop({ css: null, light: null, themeId: "oc-2", port, reload: true, live: true });
}

// Launch (or relaunch) the GUI so its DevTools endpoint is reachable. The caller decides when:
// this closes whatever windows the user has open.
export function launchDesktopWithDebugging({ port = DEFAULT_DEBUG_PORT, kill = false } = {}) {
  const app = findDesktopApp();
  if (!app.exe) throw new Error("opencode desktop app not found");
  if (kill) {
    try {
      spawn("taskkill", ["/IM", "OpenCode.exe", "/F"], { stdio: "ignore", detached: false }).unref();
    } catch { /* nothing to kill */ }
  }
  const child = spawn(app.exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" });
  child.unref();
  return { exe: app.exe, port };
}

/* ------------------------------- css generator ------------------------------- */

// Implemented in schema.mjs so the browser UI, the CLI and the tests share one definition.
export { desktopClientCss as desktopCss } from "./schema.mjs";

