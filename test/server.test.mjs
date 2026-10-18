import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// End-to-end contract test: boot the real server against a throwaway config dir and drive the API.
// Nothing in the user's real ~/.config/opencode is touched.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
let child = null;
let base = "";
let configDir = "";
let terminalFile = "";

function waitForPort(proc) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in 15s")), 15_000);
    let buffer = "";
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    proc.stderr.on("data", (chunk) => {
      buffer += chunk;
    });
    proc.on("exit", (code) => reject(new Error(`server exited early (${code}): ${buffer}`)));
  });
}

const call = async (method, url, body) => {
  const response = await fetch(base + url, body ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* html */ }
  return { status: response.status, json, text };
};

before(async () => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "octm-test-"));
  fs.mkdirSync(path.join(configDir, "themes"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "cli.json"), JSON.stringify({ $schema: "https://opencode.ai/v2/cli.json", theme: { name: "system" }, mouse: false }, null, 2));
  terminalFile = path.join(configDir, "wt-settings.json");
  fs.writeFileSync(terminalFile, JSON.stringify({ profiles: { defaults: { font: { face: "Cascadia Mono", size: 11 }, opacity: 90, useAcrylic: true }, list: [{ guid: "{abc}", name: "PowerShell" }] } }, null, 2));  child = spawn(process.execPath, ["server.mjs", "--port", "0", "--no-open", "--config-dir", configDir, "--terminal-settings", terminalFile, "--desktop-profile", path.join(configDir, "appdata")], { windowsHide: true, cwd: repo });
  const port = await waitForPort(child);
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  if (child) child.kill();
  if (configDir && fs.existsSync(configDir)) fs.rmSync(configDir, { recursive: true, force: true });
});

test("serves the manager UI and its modules", async () => {
  const page = await call("GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.text, /OpenCode Theme Manager/);
  assert.match(page.text, /id="tui"/);
  const model = await call("GET", "/lib/schema.mjs");
  assert.equal(model.status, 200);
  assert.match(model.text, /export function buildTheme/);
  const designer = await call("GET", "/lib/designer.mjs");
  assert.equal(designer.status, 200);
  const css = await call("GET", "/ui/styles.css");
  assert.equal(css.status, 200);
});

test("reports real paths, token count and the v2 web-css hook", async () => {
  const { status, json } = await call("GET", "/api/state");
  assert.equal(status, 200);
  assert.equal(path.resolve(json.configDir), path.resolve(configDir));
  assert.equal(json.tokenCount, 103);
  assert.ok(json.presets.length >= 30, `expected built-in presets, got ${json.presets.length}`);
  assert.equal(json.cli.theme.name, "system");
  assert.equal(json.terminal.profiles.length, 1);
  assert.deepEqual(json.desktop.web.keys, { dark: "opencode-theme-css-dark", light: "opencode-theme-css-light" });
  assert.match(json.desktop.web.preload, /oc-theme-preload/);
});

test("prompt -> design -> valid theme with translucent surfaces", async () => {
  const { status, json } = await call("POST", "/api/design", { prompt: "nord blue frosted glass, big rounded buttons, jetbrains mono, 60% transparent", transparency: 60 });
  assert.equal(status, 200);
  assert.equal(json.validation.ok, true, JSON.stringify(json.validation.errors.slice(0, 3)));
  assert.ok(json.theme.base.text.base);
  assert.match(json.resolved.dark["background.base"], /^#[0-9a-f]{6}66$/i);
  assert.equal(json.ui.monoFont, "JetBrains Mono");
  assert.ok(json.matched.some((m) => m.startsWith("transparency:60")));
  assert.ok(json.ui.css.includes("--oc-font-mono: JetBrains Mono"));
});

test("image palette -> design stays valid", async () => {
  const { status, json } = await call("POST", "/api/palette", { imageColors: ["#0b1020", "#e8ecf8", "#7aa2f7", "#bb9af7"], mode: "dark", transparency: 55 });
  assert.equal(status, 200);
  assert.equal(json.validation.ok, true);
  assert.ok(json.matched.some((m) => m.startsWith("palette:")));
  assert.match(json.resolved.dark["background.base"], /^#[0-9a-f]{8}$/i);
});

test("save writes the theme and backs up the previous copy", async () => {
  const design = await call("POST", "/api/design", { prompt: "ocean teal glass", transparency: 45 });
  const first = await call("POST", "/api/save", { name: "test-glass", theme: design.json.theme });
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  const file = path.join(configDir, "themes", "test-glass.json");
  assert.ok(fs.existsSync(file));
  const second = await call("POST", "/api/save", { name: "test-glass", theme: design.json.theme });
  assert.equal(second.json.ok, true);
  assert.ok(second.json.backup && fs.existsSync(second.json.backup), "second save must leave a backup");
});

test("invalid themes are refused, not written", async () => {
  const broken = await call("POST", "/api/design", { prompt: "blue" });
  broken.json.theme.base.border = { base: "not-a-colour" };
  const result = await call("POST", "/api/save", { name: "broken", theme: broken.json.theme });
  assert.equal(result.status, 422);
  assert.equal(result.json.ok, false);
  assert.ok(result.json.validation.errors.some((e) => e.includes("border.base")));
  assert.equal(fs.existsSync(path.join(configDir, "themes", "broken.json")), false);
});

test("apply points cli.json at the theme, keeps the rest, and backs up", async () => {
  const result = await call("POST", "/api/apply", { name: "test-glass", mode: "dark" });
  assert.equal(result.json.ok, true);
  const cli = JSON.parse(fs.readFileSync(path.join(configDir, "cli.json"), "utf8"));
  assert.equal(cli.theme.name, "test-glass");
  assert.equal(cli.theme.mode, "dark");
  assert.equal(cli.mouse, false, "unrelated settings survive");
  assert.ok(result.json.backup);
});

test("layout patch merges whitelisted keys only", async () => {
  const result = await call("POST", "/api/cli", { patch: { tabs: { layout: "vertical" }, "session.sidebar": "hide", evil: true, $schema: "x" } });
  assert.equal(result.json.ok, true);
  const cli = JSON.parse(fs.readFileSync(path.join(configDir, "cli.json"), "utf8"));
  assert.equal(cli.tabs.layout, "vertical");
  assert.equal(cli.evil, undefined);
  assert.equal(cli.$schema, "https://opencode.ai/v2/cli.json");
});

test("dotted cli keys nest instead of becoming literal keys", async () => {
  const result = await call("POST", "/api/cli", { patch: { "session.sidebar": "hide", "diffs.view": "split" } });
  assert.equal(result.json.ok, true);
  const cli = JSON.parse(fs.readFileSync(path.join(configDir, "cli.json"), "utf8"));
  assert.equal(cli["session.sidebar"], undefined, "no literal dotted key");
  assert.equal(cli.session.sidebar, "hide", "session.sidebar nested");
  assert.equal(cli.diffs.view, "split", "diffs.view nested");
});

test("prototype-polluting keys never reach cli.json", async () => {
  const result = await call("POST", "/api/cli", { patch: { tabs: { __proto__: { polluted: true }, layout: "horizontal" }, "session.__proto__": "x" } });
  assert.equal(result.json.ok, true);
  const cli = JSON.parse(fs.readFileSync(path.join(configDir, "cli.json"), "utf8"));
  assert.equal({}.polluted, undefined, "Object.prototype untouched");
  assert.equal(cli.tabs.layout, "horizontal", "legitimate sibling still applied");
});

test("the Windows Terminal guid the panel shows is the guid it writes", async () => {
  const state = await call("GET", "/api/state");
  const profile = state.json.terminal.profiles[0];
  assert.ok(profile?.guid, "a profile with a guid is reported");
  assert.equal(profile.guid, "{abc}", "array-form settings report the real guid, not an index");
  const result = await call("POST", "/api/terminal", { guid: profile.guid, opacity: 55 });
  assert.equal(result.json.ok, true, JSON.stringify(result.json));
  const doc = JSON.parse(fs.readFileSync(terminalFile, "utf8"));
  assert.equal(doc.profiles.list[0].opacity, 55, "the profile itself was updated");
});

test("two saves in the same second keep two backups", async () => {
  const design = await call("POST", "/api/design", { prompt: "gruvbox glass", transparency: 40 });
  const file = path.join(configDir, "themes", "same-second.json");
  const first = await call("POST", "/api/save", { name: "same-second", theme: design.json.theme });
  const second = await call("POST", "/api/save", { name: "same-second", theme: design.json.theme });
  assert.ok(first.json.ok && second.json.ok);
  assert.ok(second.json.backup, "second save left a backup");
  assert.notEqual(first.json.backup, second.json.backup, "the two backups are different files");
  assert.ok(fs.existsSync(second.json.backup));
  assert.equal(fs.readFileSync(file, "utf8").length > 1000, true, "final file is complete");
});

test("apply refuses a theme that does not exist", async () => {
  const result = await call("POST", "/api/apply", { name: "no-such-theme" });
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /does not exist/);
  const cli = JSON.parse(fs.readFileSync(path.join(configDir, "cli.json"), "utf8"));
  assert.notEqual(cli.theme.name, "no-such-theme", "cli.json was not pointed at a missing theme");
});

test("terminal transparency + font write into Windows Terminal settings with a backup", async () => {
  const result = await call("POST", "/api/terminal", { opacity: 65, useAcrylic: true, font: { face: "JetBrains Mono", size: 14, weight: "normal" } });
  assert.equal(result.json.ok, true);
  assert.ok(result.json.backup && fs.existsSync(result.json.backup));
  const doc = JSON.parse(fs.readFileSync(terminalFile, "utf8"));
  assert.equal(doc.profiles.defaults.opacity, 65);
  assert.equal(doc.profiles.defaults.font.face, "JetBrains Mono");
  assert.equal(doc.profiles.defaults.useAcrylic, true);
});

test("legacy V1 presets import through the API", async () => {
  const preset = await call("GET", "/api/preset?name=nord");
  assert.equal(preset.status, 200);
  assert.ok(preset.json.raw.theme, "preset is V1 format");
  assert.equal(preset.json.validation.ok, true);
  assert.ok(preset.json.theme.base.text.base);
  assert.match(preset.json.palette.background, /^#[0-9a-f]{6}$/i);
});

test("theme names cannot escape the themes directory", async () => {
  const result = await call("POST", "/api/save", { name: "../../evil", theme: { base: {}, light: { hue: {} } } });
  assert.equal(result.status, 400);
  assert.match(result.json.error, /unsafe theme name/);
});

test("export returns the exact JSON that would be written", async () => {
  const design = await call("POST", "/api/design", { prompt: "dracula glass", transparency: 40 });
  const result = await call("POST", "/api/export", { name: "dracula-glass", theme: design.json.theme });
  assert.equal(result.json.ok, true);
  assert.equal(result.json.filename, "dracula-glass.json");
  assert.deepEqual(JSON.parse(result.json.json), design.json.theme);
});

test("unknown routes and bad bodies fail cleanly", async () => {
  assert.equal((await call("GET", "/api/nope")).status, 404);
  const bad = await fetch(base + "/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
  assert.equal(bad.status, 400);
});
