#!/usr/bin/env node
// One command to actually make opencode look like something.
//   node tools/apply.mjs                                  # the built-in glass look, dark mode
//   node tools/apply.mjs --prompt "tokyonight frosted glass, big rounded buttons"
//   node tools/apply.mjs --file examples/glass.json       # apply a theme document you already have
//   node tools/apply.mjs --name my-glass --mode light --terminal
//
// It drives the same HTTP API the UI uses, so behaviour (validation, backups) is identical.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTheme, validateTheme } from "../lib/schema.mjs";
import { interpretPrompt } from "../lib/designer.mjs";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(name);

const prompt = arg("--prompt", "nord blue frosted glass, rounded corners");
const name = arg("--name", "glass");
const mode = arg("--mode", "dark") === "light" ? "light" : "dark";
const file = arg("--file");
const configFlag = arg("--config-dir");
const withTerminal = has("--terminal") || has("--everywhere");
const everywhere = has("--everywhere");
const transparency = arg("--transparency");

let theme;
if (file) {
  theme = JSON.parse(fs.readFileSync(path.resolve(repo, file), "utf8"));
} else {
  const bundle = interpretPrompt(prompt);
  if (transparency !== null) bundle.design.transparency = { dark: Number(transparency), light: Math.round(Number(transparency) * 0.55) };
  theme = buildTheme(bundle.design);
  console.log(`prompt: ${prompt}`);
  console.log(`understood: ${bundle.matched.join(", ") || "(nothing - default palette)"}`);
}
const validation = validateTheme(theme);
if (!validation.ok) {
  console.error("theme is invalid, refusing to write:", validation.errors.slice(0, 5));
  process.exit(1);
}
console.log(`theme: ${name} (${validation.ok ? "valid V2" : "invalid"}), ${Object.values(theme[mode]?.hue || {}).length} hue slots, ${mode} mode\n`);

const child = spawn(process.execPath, ["server.mjs", "--port", "0", "--no-open", ...(configFlag ? ["--config-dir", configFlag] : [])], { windowsHide: true, cwd: repo });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 15_000);
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) {
      clearTimeout(timer);
      resolve(Number(match[1]));
    }
  });
  child.stderr.on("data", (chunk) => {
    buffer += chunk;
  });
  child.on("exit", (code) => reject(new Error(`server exited (${code}): ${buffer}`)));
});
const base = `http://127.0.0.1:${port}`;
const post = async (route, body) => {
  const response = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
};

try {
  const saved = await post("/api/save", { name, theme });
  if (!saved.ok) throw new Error(`save failed: ${JSON.stringify(saved.validation?.errors?.slice(0, 3))}`);
  console.log(`wrote     ${saved.path}${saved.backup ? `\nbackup    ${saved.backup}` : ""}`);

  const applied = await post("/api/apply", { name, mode });
  console.log(`applied   ${applied.path} -> theme.name="${name}", theme.mode="${mode}"${applied.backup ? `\nbackup    ${applied.backup}` : ""}`);

  if (withTerminal) {
    const font = arg("--font") ? { face: arg("--font"), size: Number(arg("--font-size", 11)) } : undefined;
    const terminal = await post("/api/terminal", { opacity: Number(arg("--opacity", 70)), useAcrylic: true, font });
    if (terminal.ok) console.log(`terminal  ${terminal.path} -> opacity ${terminal.opacity}, acrylic ${terminal.useAcrylic}${font ? `, font ${font.face} ${font.size}` : ""}${terminal.backup ? `\nbackup    ${terminal.backup}` : ""}`);
    else console.log(`terminal  skipped: ${terminal.error}`);
  }
  if (everywhere) {
    // The desktop GUI is a different client: it needs its CSS over localStorage, which needs a DevTools port.
    const desktop = await post("/api/desktop/apply", { theme, ui: { monoFont: arg("--font"), fontSize: Number(arg("--font-size", 13)), radius: 10, blur: 18 } });
    if (desktop.ok) console.log(`desktop   CSS injected into ${desktop.target.url} (${desktop.cssBytes} bytes, theme-id untouched)`);
    else console.log(`desktop   skipped: ${desktop.error}\n          ${desktop.hint}`);
  }
  console.log(`\nRestart opencode (the TUI reads cli.json at startup). Verify with:  opencode debug config`);
} finally {
  child.kill();
}
