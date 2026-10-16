#!/usr/bin/env node
// OpenCode Theme Manager - zero-dependency local server.
// Binds 127.0.0.1 only. Every write is backed up as <file>.bak.<timestamp> first.
//
//   node server.mjs [--port 4289] [--config-dir <path>] [--no-open] [--terminal-settings <path>]

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  buildTheme, designToCss, defaultDesign, importV1, resolveHues, resolveTheme, validateTheme, TOKEN_PATHS, ALL_HUES, WEB_CSS_KEYS,
} from "./lib/schema.mjs";
import { designFromInput, interpretPrompt, paletteFromThemeSeed, paletteToDesign } from "./lib/designer.mjs";
import {
  DEFAULT_DEBUG_PORT, applyToDesktop, bundledThemeIds, clearDesktop, desktopCss, findDesktopApp, findDebugPort, launchDesktopWithDebugging, probeTarget,
} from "./lib/desktop.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const PORT = Number(flag("--port", process.env.OC_THEME_PORT || 4289));
const openBrowser = !args.includes("--no-open");
const home = os.homedir();

function resolveConfigDir() {
  const explicit = flag("--config-dir");
  if (explicit) return path.resolve(explicit);
  if (process.env.OPENCODE_CONFIG_DIR) return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "opencode");
  return path.join(home, ".config", "opencode");
}

let configDir = resolveConfigDir();
let terminalSettingsPath = flag("--terminal-settings");
const projectsDir = path.join(here, "..");

/* --------------------------------- helpers --------------------------------- */

function safeName(name) {
  const value = String(name || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes("..")) throw new Error(`unsafe theme name: "${name}"`);
  return value;
}

function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, "$1")
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(stripped);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return parseJsonc(raw);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const target = `${file}.bak.${timestamp()}`;
  fs.copyFileSync(file, target);
  return target;
}

function writeJsonWithBackup(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = backup(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { path: file, backup: bak };
}

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      deepMerge(target[key], value);
    } else if (value === null) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
  return target;
}

const CLI_KEYS = ["theme", "animations", "cursor", "mouse", "scroll", "prompt", "session", "tabs", "diffs", "terminal", "mini", "highlights", "leader", "keybinds"];

function cliFile() {
  return path.join(configDir, "cli.json");
}
function themeDir() {
  return path.join(configDir, "themes");
}
function projectThemeDir() {
  return path.join(configDir, "..", "..", "themes");
}
function profileDir() {
  return path.join(configDir, "theme-manager");
}

function loadCli() {
  return readJson(cliFile()) || { $schema: "https://opencode.ai/v2/cli.json" };
}

function listThemes() {
  const dir = themeDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      let doc = null;
      try {
        doc = readJson(full);
      } catch { /* invalid json stays visible in the list */ }
      return {
        name: file.replace(/\.json$/, ""),
        file: full,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        format: doc && doc.base ? "v2" : doc && doc.theme ? "v1" : "unknown",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listPresets() {
  const dir = path.join(here, "presets", "v1");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}

function loadPreset(name) {
  const file = path.join(here, "presets", "v1", `${safeName(name)}.json`);
  if (!fs.existsSync(file)) throw new Error(`unknown preset: ${name}`);
  return readJson(file);
}

function presetPalette(name) {
  const raw = loadPreset(name);
  const { theme } = importV1(raw);
  const resolved = resolveTheme(theme, "dark");
  return seedFromResolved(resolved);
}

function seedFromResolved(resolved) {
  return {
    theme: null,
    background: resolved["background.base"],
    text: resolved["text.base"],
    accent: resolved["text.action.secondary.base"] || resolved["markdown.heading"],
    cyan: resolved["syntax.type"] || resolved["markdown.link"],
    green: resolved["syntax.string"],
    yellow: resolved["syntax.number"],
  };
}

function terminalSettingsCandidates() {
  const list = [];
  if (process.env.LOCALAPPDATA) {
    list.push(path.join(process.env.LOCALAPPDATA, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState", "settings.json"));
    list.push(path.join(process.env.LOCALAPPDATA, "Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState", "settings.json"));
    list.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows Terminal", "settings.json"));
  }
  return list;
}

function terminalState() {
  const candidates = terminalSettingsPath ? [terminalSettingsPath] : terminalSettingsCandidates();
  const found = candidates.find((file) => fs.existsSync(file)) || null;
  terminalSettingsPath = found;
  if (!found) return { supported: process.platform === "win32", path: null, candidates, profiles: [] };
  let doc = null;
  try {
    doc = readJson(found);
  } catch (error) {
    return { supported: true, path: found, candidates, error: error.message, profiles: [] };
  }
  const defaults = doc.profiles?.defaults || {};
  const profiles = Object.entries(doc.profiles?.list || []).map(([guid, profile]) => ({
    guid,
    name: profile.name || guid,
    font: profile.font || defaults.font || {},
    opacity: profile.opacity ?? defaults.opacity ?? 100,
    useAcrylic: profile.useAcrylic ?? defaults.useAcrylic ?? false,
  }));
  return {
    supported: true,
    path: found,
    candidates,
    profiles,
    defaults: { font: defaults.font || {}, opacity: defaults.opacity ?? 100, useAcrylic: defaults.useAcrylic ?? false },
  };
}

function desktopState() {
  const cssPath = path.join(profileDir(), "desktop.css");
  return {
    cssPath,
    exists: fs.existsSync(cssPath),
    web: {
      preload: "/oc-theme-preload.js",
      keys: WEB_CSS_KEYS,
      note: "The web/desktop client restores injected CSS from those localStorage keys (packages/app/public/oc-theme-preload.js). Copy the snippet from the CSS panel and run it in that client's console once.",
    },
    note: "No file-based CSS hook exists in opencode v2.0.29 (see docs/opencode-client-re.md): the CSS is written to the path above as a record and delivered to the web/desktop client through the localStorage snippet.",
  };
}

function bundleFromRequest(body) {
  const prompt = String(body.prompt || "");
  const preset = body.preset ? String(body.preset) : null;
  let seed = null;
  if (preset) {
    try {
      seed = presetPalette(preset);
    } catch { /* unknown preset falls back to prompt words */ }
  }
  const bundle = designFromInput({
    prompt,
    imageColors: Array.isArray(body.imageColors) ? body.imageColors : null,
    preset,
    presetPalette: seed,
    mode: body.mode === "light" ? "light" : "dark",
    transparency: body.transparency === undefined || body.transparency === null || body.transparency === "" ? null : Number(body.transparency),
  });
  if (body.design) bundle.design = body.design;
  if (body.ui) bundle.ui = { ...bundle.ui, ...body.ui };
  const theme = buildTheme(bundle.design);
  const validation = validateTheme(theme);
  return {
    ...bundle,
    theme,
    validation,
    resolved: { dark: resolveTheme(theme, "dark"), light: resolveTheme(theme, "light") },
    hues: { dark: resolveHues(theme, "dark"), light: resolveHues(theme, "light") },
    ui: { ...bundle.ui, css: designToCss(bundle.ui) },
  };
}

/* ---------------------------------- routes ---------------------------------- */

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

const routes = {
  "GET /api/state": () => ({
    platform: process.platform,
    home,
    configDir,
    themeDir: themeDir(),
    projectDir: projectsDir,
    cliFile: cliFile(),
    cli: loadCli(),
    themes: listThemes(),
    presets: listPresets(),
    tokenCount: TOKEN_PATHS.length,
    hues: ALL_HUES,
    terminal: terminalState(),
    desktop: desktopState(),
    defaults: { design: defaultDesign() },
    profiles: fs.existsSync(profileDir()) ? fs.readdirSync(profileDir()).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [],
  }),

  "GET /api/theme": (query) => {
    const file = path.join(themeDir(), `${safeName(query.get("name"))}.json`);
    return { name: query.get("name"), theme: readJson(file), validation: validateTheme(readJson(file) || {}) };
  },

  "GET /api/preset": (query) => {
    const raw = loadPreset(query.get("name"));
    const imported = importV1(raw);
    return { name: query.get("name"), raw, theme: imported.theme, validation: imported.validation, palette: presetPalette(query.get("name")) };
  },

  "GET /api/profile": (query) => ({ name: query.get("name"), profile: readJson(path.join(profileDir(), `${safeName(query.get("name"))}.json`)) }),

  "POST /api/design": (body) => bundleFromRequest(body),

  "POST /api/palette": (body) => {
    const colors = (body.imageColors || []).filter(Boolean);
    const bundle = paletteToDesign(colors, { mode: body.mode === "light" ? "light" : "dark", transparency: Number(body.transparency ?? 40) });
    const theme = buildTheme(bundle.design);
    return { ...bundle, theme, validation: validateTheme(theme), resolved: { dark: resolveTheme(theme, "dark"), light: resolveTheme(theme, "light") }, hues: { dark: resolveHues(theme, "dark"), light: resolveHues(theme, "light") } };
  },

  "POST /api/prompt": (body) => {
    const bundle = interpretPrompt(String(body.prompt || ""), { seedPalette: body.preset ? presetPalette(body.preset) : null });
    const theme = buildTheme(bundle.design);
    return { ...bundle, theme, validation: validateTheme(theme), resolved: { dark: resolveTheme(theme, "dark"), light: resolveTheme(theme, "light") }, hues: { dark: resolveHues(theme, "dark"), light: resolveHues(theme, "light") }, palette: paletteFromThemeSeed(String(body.prompt || "").toLowerCase()) };
  },

  "POST /api/validate": (body) => ({
    validation: validateTheme(body.theme || {}),
    resolved: { dark: resolveTheme(body.theme || {}, "dark"), light: resolveTheme(body.theme || {}, "light") },
  }),

  "POST /api/save": (body) => {
    const name = safeName(body.name);
    const theme = body.theme;
    const validation = validateTheme(theme);
    if (!validation.ok) return { ok: false, validation };
    const written = writeJsonWithBackup(path.join(themeDir(), `${name}.json`), theme);
    return { ok: true, validation, ...written, themes: listThemes() };
  },

  "POST /api/delete": (body) => {
    const name = safeName(body.name);
    const file = path.join(themeDir(), `${name}.json`);
    if (!fs.existsSync(file)) return { ok: false, error: "not found" };
    const bak = backup(file);
    fs.unlinkSync(file);
    return { ok: true, deleted: file, backup: bak, themes: listThemes() };
  },

  "POST /api/apply": (body) => {
    const name = safeName(body.name);
    const cli = loadCli();
    cli.$schema ||= "https://opencode.ai/v2/cli.json";
    cli.theme = { ...(cli.theme || {}), name };
    if (body.mode) cli.theme.mode = body.mode;
    if (body.layout) {
      for (const [key, value] of Object.entries(body.layout)) {
        if (CLI_KEYS.includes(key.split(".")[0])) deepMerge(cli, setNested(key, value));
      }
    }
    const written = writeJsonWithBackup(cliFile(), cli);
    return { ok: true, ...written, cli };
  },

  "POST /api/cli": (body) => {
    const patch = {};
    for (const [key, value] of Object.entries(body.patch || {})) {
      if (CLI_KEYS.includes(key.split(".")[0])) patch[key] = value;
    }
    const cli = deepMerge(loadCli(), patch);
    cli.$schema ||= "https://opencode.ai/v2/cli.json";
    const written = writeJsonWithBackup(cliFile(), cli);
    return { ok: true, ...written, cli, applied: Object.keys(patch) };
  },

  "POST /api/terminal": (body) => {
    const file = terminalSettingsPath || terminalSettingsCandidates().find((candidate) => fs.existsSync(candidate));
    if (!file) return { ok: false, error: "Windows Terminal settings.json not found", candidates: terminalSettingsCandidates() };
    const doc = readJson(file);
    const guid = body.guid;
    const target = guid ? doc.profiles.list.find((p) => p.guid === guid) : doc.profiles.defaults;
    if (!target) return { ok: false, error: `profile ${guid} not found` };
    const font = {};
    if (body.font) {
      if (body.font.face) font.face = String(body.font.face);
      if (body.font.size) font.size = Number(body.font.size);
      if (body.font.weight) font.weight = String(body.font.weight);
      if (Object.keys(font).length) target.font = { ...(target.font || {}), ...font };
    }
    if (body.opacity !== undefined && body.opacity !== null && body.opacity !== "") target.opacity = Math.max(0, Math.min(100, Number(body.opacity)));
    if (body.useAcrylic !== undefined && body.useAcrylic !== null) target.useAcrylic = Boolean(body.useAcrylic);
    const written = writeJsonWithBackup(file, doc);
    return { ok: true, ...written, applied: font, opacity: target.opacity, useAcrylic: target.useAcrylic, terminal: terminalState() };
  },

  "POST /api/desktop/css": (body) => {
    const css = String(body.css || "");
    const target = desktopState().cssPath;
    if (!css.trim()) return { ok: false, error: "empty css" };
    const written = writeJsonWithBackupRaw(target, css);
    return { ok: true, ...written, note: desktopState().note };
  },

  "GET /api/desktop": async () => {
    const app = findDesktopApp();
    const found = await findDebugPort();
    const probes = [];
    if (found) {
      for (const target of found.targets) {
        const probe = await probeTarget(target.ws);
        probes.push({ url: target.url, title: target.title, isApp: probe.isApp, theme: probe.theme, hasDark: probe.hasDark, hasLight: probe.hasLight, error: probe.error });
      }
    }
    const appTarget = probes.find((probe) => probe.isApp) || null;
    return {
      app,
      themeIds: bundledThemeIds(),
      debug: { defaultPort: DEFAULT_DEBUG_PORT, port: found?.port ?? null, probes, current: appTarget },
      keys: { theme: "opencode-theme-id", dark: "opencode-theme-css-dark", light: "opencode-theme-css-light" },
    };
  },

  "POST /api/desktop/apply": async (body) => {
    const resolvedDark = body.resolved?.dark || resolveTheme(body.theme || {}, "dark");
    const resolvedLight = body.resolved?.light || resolveTheme(body.theme || {}, "light");
    const css = body.css ?? desktopCss(resolvedDark, body.ui || {});
    const light = body.light ?? (body.css ? body.css : desktopCss(resolvedLight, body.ui || {}));
    try {
      const result = await applyToDesktop({
        css,
        light,
        themeId: body.themeId || null,
        scheme: body.scheme || null,
        port: Number(body.port) || DEFAULT_DEBUG_PORT,
        reload: body.reload === true,
        live: body.live !== false,
      });
      return { ok: true, ...result, cssBytes: css.length };
    } catch (error) {
      return { ok: false, error: error.message, hint: `run: node tools/desktop-apply.mjs --glass --restart (opens --remote-debugging-port=${DEFAULT_DEBUG_PORT})` };
    }
  },

  "POST /api/desktop/clear": async (body) => {
    try {
      const result = await clearDesktop(Number(body.port) || DEFAULT_DEBUG_PORT);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  "POST /api/desktop/restart": (body) => {
    try {
      const launched = launchDesktopWithDebugging({ port: Number(body.port) || DEFAULT_DEBUG_PORT, kill: true });
      return { ok: true, ...launched, note: "the app was closed and is starting again with DevTools enabled; wait a few seconds, then apply" };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },

  "POST /api/profile": (body) => {
    const name = safeName(body.name);
    const written = writeJsonWithBackup(path.join(profileDir(), `${name}.json`), body.profile || {});
    return { ok: true, ...written };
  },

  "POST /api/import": (body) => {
    const imported = importV1(body.json);
    return { ok: imported.validation.ok, theme: imported.theme, validation: imported.validation, mode: imported.mode, source: body.source || "v1" };
  },

  "POST /api/export": (body) => {
    const name = safeName(body.name || "theme");
    const json = JSON.stringify(body.theme, null, 2);
    if (body.write === "examples") {
      const file = path.join(here, "examples", `${name}.json`);
      const written = writeJsonWithBackupRaw(file, json + "\n");
      return { ok: true, ...written };
    }
    return { ok: true, filename: `${name}.json`, json };
  },
};

function setNested(key, value) {
  const keys = key.split(".");
  const out = {};
  let cur = out;
  for (const part of keys.slice(0, -1)) cur = cur[part] = {};
  cur[keys[keys.length - 1]] = value;
  return out;
}

function writeJsonWithBackupRaw(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = backup(file);
  fs.writeFileSync(file, text, "utf8");
  return { path: file, backup: bak };
}

function send(res, status, payload, type = "application/json; charset=utf-8") {
  const body = type.startsWith("application/json") ? JSON.stringify(payload) : payload;
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "ui/index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(here, rel);
  if (!file.startsWith(here) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: "not found" });
  return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const key = `${req.method} ${url.pathname}`;
  if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui/") || url.pathname.startsWith("/lib/") || url.pathname.startsWith("/presets/") || url.pathname.startsWith("/docs/") || url.pathname.startsWith("/examples/"))) {
    return serveStatic(res, url.pathname);
  }
  const handler = routes[key];
  if (!handler) return send(res, 404, { error: `no route for ${key}` });
  if (req.method === "GET") {
    try {
      return send(res, 200, await handler(url.searchParams));
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 12_000_000) req.destroy();
  });
  req.on("end", async () => {
    try {
      const body = raw ? JSON.parse(raw) : {};
      const result = await handler(body, url.searchParams);
      send(res, result && result.ok === false && result.validation ? 422 : 200, result);
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  const bound = server.address().port;
  const url = `http://127.0.0.1:${bound}/`;
  console.log(`opencode theme manager -> ${url}`);
  console.log(`config dir: ${configDir}`);
  console.log(`themes dir: ${themeDir()}`);
  if (openBrowser) {
    const command = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    try {
      spawn(command[0], command[1], { detached: true, stdio: "ignore" }).unref();
    } catch { /* opening the browser is a convenience, never fatal */ }
  }
});

export { server, routes, buildTheme, designFromInput };
