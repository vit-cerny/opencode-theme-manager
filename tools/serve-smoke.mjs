#!/usr/bin/env node
// Boots the real server against the real opencode config, exercises read-only + pure routes, exits.
// Nothing is written: /api/design, /api/palette and /api/state are read-compute routes.
//   node tools/serve-smoke.mjs

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["server.mjs", "--port", "0", "--no-open"], { windowsHide: true, cwd: repo });
let failures = 0;
const check = (ok, text) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
};

const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start in 15s")), 15_000);
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
  child.on("exit", (code) => reject(new Error(`server exited early (${code}): ${buffer}`)));
});

const base = `http://127.0.0.1:${port}`;
try {
  const page = await fetch(base + "/");
  check(page.status === 200 && (await page.text()).includes("OpenCode Theme Manager"), "GET / serves the manager");

  const state = await (await fetch(base + "/api/state")).json();
  check(Boolean(state.configDir), `config dir resolved: ${state.configDir}`);
  check(state.themes.length >= 0, `themes directory readable (${state.themes.length} theme(s))`);
  check(state.presets.length >= 30, `presets available: ${state.presets.length}`);
  check(state.tokenCount === 103, `token inventory: ${state.tokenCount}`);
  check(state.terminal.path ? true : state.platform !== "win32", `terminal settings: ${state.terminal.path || "not found"}`);
  check(Boolean(state.desktop.web.keys.dark), `web css hook: ${state.desktop.web.keys.dark}`);

  const design = await (await fetch(base + "/api/design", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "nord blue frosted glass, 45% transparent" }) })).json();
  check(design.validation.ok === true, `prompt -> valid theme (${design.validation.errors.length} errors)`);
  check(design.resolved.dark["background.base"].length >= 7, `translucent background: ${design.resolved.dark["background.base"]}`);
} catch (error) {
  failures++;
  console.log(`FAIL ${error.message}`);
} finally {
  child.kill();
}

console.log(failures ? `\n${failures} failure(s)` : "\nsmoke test passed (no files written)");
process.exit(failures ? 1 : 0);
