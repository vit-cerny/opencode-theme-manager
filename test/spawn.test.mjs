import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every child process this project starts must be launched with windowsHide: true. Without it, a
// console child (tasklist, taskkill, powershell, a helper script) allocates a visible console window
// on Windows - which is exactly the "why is my opencode always opening cmd windows?" report.
// This is a static check on purpose: it fails at review time, not after a user notices a flash.

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["server.mjs", "lib", "tools", "test"];

function sourceFiles() {
  const out = [];
  for (const entry of roots) {
    const full = path.join(repo, entry);
    if (fs.statSync(full).isFile()) out.push(full);
    else {
      for (const file of fs.readdirSync(full)) {
        if (file.endsWith(".mjs")) out.push(path.join(full, file));
      }
    }
  }
  return out;
}

// A spawn call may span several lines, so gather a small window of text after the call.
function spawnCallSites(text) {
  const sites = [];
  const pattern = /(spawnSync|spawn|execSync|execFileSync|execFile)\(/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const window = text.slice(match.index, match.index + 700);
    // stop at the end of the statement, so a later call's options cannot satisfy this one
    const end = window.search(/\)\s*;|\n\s*\}\s*\n/);
    sites.push({ name: match[1], index: match.index, body: window.slice(0, end === -1 ? 700 : end + 2) });
  }
  return sites;
}

test("every child process is launched hidden (no stray cmd windows)", () => {
  const offenders = [];
  let inspected = 0;
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const site of spawnCallSites(text)) {
      inspected++;
      if (!site.body.includes("windowsHide")) {
        const line = text.slice(0, site.index).split("\n").length;
        offenders.push(`${path.relative(repo, file)}:${line} ${site.name}(...)`);
      }
    }
  }
  assert.ok(inspected > 20, `expected to inspect the project's spawn sites, saw ${inspected}`);
  assert.deepEqual(offenders, [], `spawn sites missing windowsHide: true ->\n${offenders.join("\n")}`);
});

test("the relaunch wait is a single hidden call, not a polling loop of processes", () => {
  const desktop = fs.readFileSync(path.join(repo, "lib", "desktop.mjs"), "utf8");
  assert.ok(desktop.includes("function waitForExit"), "lib/desktop.mjs has the single-call waiter");
  assert.equal(/while \(isRunning\(name\)/.test(desktop), false, "no tasklist polling loop left");
  const patch = fs.readFileSync(path.join(repo, "tools", "patch-desktop.mjs"), "utf8");
  assert.equal(/for \(let attempt = 0; attempt < 40/.test(patch), false, "no 40-iteration wait loop left in the patcher");
});
