#!/usr/bin/env node
// Theme the opencode DESKTOP GUI (the @opencode-aidesktop app), which the TUI theme file cannot reach.
//
//   node tools/desktop-apply.mjs --list                      # what the app offers / is it reachable
//   node tools/desktop-apply.mjs --theme-id nord             # switch the GUI to a bundled theme
//   node tools/desktop-apply.mjs --glass                     # inject the glass CSS built from your opencode theme
//   node tools/desktop-apply.mjs --glass --restart           # (re)launch the app with --remote-debugging-port=9222 first
//   node tools/desktop-apply.mjs --clear                     # remove the override, back to the app's own settings
//
// The GUI reads localStorage (opencode-theme-id, opencode-theme-css-dark/light) through its own
// preload script; there is no config file or env var for it. A debug port is required, which is
// why --restart exists: it closes the app and starts it again with the port open.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTheme, resolveTheme } from "../lib/schema.mjs";
import { interpretPrompt } from "../lib/designer.mjs";
import {
  DEFAULT_DEBUG_PORT, applyToDesktop, bundledThemeIds, clearDesktop, desktopCss, findDesktopApp, findDebugPort, launchDesktopWithDebugging, readDesktopTheme,
} from "../lib/desktop.mjs";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(name);
const port = Number(arg("--port", DEFAULT_DEBUG_PORT));

const app = findDesktopApp();
const themeIds = bundledThemeIds();
console.log("opencode desktop app");
console.log(`  installed: ${app.installed ? "yes" : "NO"}`);
console.log(`  exe:       ${app.exe || "-"}`);
console.log(`  profile:   ${app.profile}`);
console.log(`  settings:  ${app.settingsFile}${app.settings ? ` (backgroundColor ${app.settings.backgroundColor || "-"})` : ""}`);
console.log(`  bundled cli: ${app.bundledCli || "-"}`);
console.log(`  bundled themes (${themeIds.length}): ${themeIds.join(", ") || "-"}`);

const reachable = await findDebugPort([port]);
console.log(`  debug port ${port}: ${reachable ? `open (${reachable.targets.length} page target(s))` : "closed"}`);

if (has("--list") || argv.length === 0) {
  if (reachable) {
    for (const target of reachable.targets) console.log(`  target: ${target.title || "(untitled)"} ${target.url}`);
    try {
      console.log(`  current: ${JSON.stringify(await readDesktopTheme(port))}`);
    } catch (error) {
      console.log(`  current: ${error.message}`);
    }
  } else {
    console.log("\nNothing to do. Re-run with --glass --restart (the app must be started with a debug port).");
  }
  process.exit(0);
}

if (has("--clear")) {
  if (!reachable) {
    console.error(`\nneed an open debug port on ${port}: run with --restart`);
    process.exit(1);
  }
  const result = await clearDesktop(port);
  console.log(`\ncleared override on ${result.target.url}: ${JSON.stringify(result.result)}`);
  process.exit(0);
}

if (has("--restart")) {
  if (!app.exe) {
    console.error("\ncannot restart: desktop app not found");
    process.exit(1);
  }
  console.log(`\nrestarting ${app.exe} with --remote-debugging-port=${port} ...`);
  launchDesktopWithDebugging({ port, kill: true });
  let ready = null;
  for (let attempt = 0; attempt < 30 && !ready; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    ready = await findDebugPort([port]);
  }
  if (!ready) {
    console.error("the app did not expose a debug port - start it manually with the flag and retry");
    process.exit(1);
  }
  console.log(`  port open, ${ready.targets.length} page target(s)`);
}

let css = "";
if (has("--css")) {
  css = fs.readFileSync(path.resolve(repo, arg("--css")), "utf8");
} else if (has("--glass")) {
  const prompt = arg("--prompt", "nord blue frosted glass, rounded corners, 45% transparency");
  const bundle = interpretPrompt(prompt);
  const theme = buildTheme(bundle.design);
  const resolved = { dark: resolveTheme(theme, "dark"), light: resolveTheme(theme, "light") };
  css = desktopCss(resolved.dark, bundle.ui);
  const light = desktopCss(resolved.light, bundle.ui);
  const themeId = arg("--theme-id", themeIds.includes("nord") ? "nord" : null);
  const result = await applyToDesktop({ css, light, themeId, port, reload: false });
  console.log(`\nprompt:    ${prompt}`);
  console.log(`injected:  ${css.split("\n").length} lines of CSS into ${result.target.url}`);
  console.log(`target:    ${result.target.title || "(untitled)"}`);
  console.log(`stored:    ${JSON.stringify(result.result)}`);
  console.log(`windows:   ${result.applied.length} app window(s) updated live (no reload)`);
  process.exit(0);
}

const themeId = arg("--theme-id");
if (themeId) {
  if (!themeIds.includes(themeId)) {
    console.error(`\n"${themeId}" is not a bundled theme. Choose one of: ${themeIds.join(", ")}`);
    process.exit(1);
  }
  const result = await applyToDesktop({ themeId, port, reload: true });
  console.log(`\nset ${themeId} on ${result.target.url}`);
  console.log(`stored: ${JSON.stringify(result.result)}`);
  process.exit(0);
}

console.log("\nnothing selected: pass --theme-id <id> or --glass (optionally --restart).");
