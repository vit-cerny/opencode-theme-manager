import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The tiler is Windows-only Win32 code, so the check drives the real script against two throwaway
// windows (test/fixtures/window.ps1): it verifies the grid geometry, that only the named process is
// touched, and that -Restore puts the windows back. If windows for that process already exist we
// skip instead of moving somebody else's window.

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repo, "tools", "tile.ps1");
const fixture = path.join(repo, "test", "fixtures", "window.ps1");
const processName = "powershell";
const stateFile = path.join(os.tmpdir(), `octm-tile-state-${process.pid}.json`);
const padding = 12;

const runTile = (args) => {
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `tile.ps1 exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const listWindows = () => runTile(["-ProcessName", processName, "-List", "-Json", "-StateFile", stateFile]).windows;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("tiler snaps windows into a grid, touches only the named process, and restores", async (t) => {
  if (process.platform !== "win32") {
    t.skip("windows-only");
    return;
  }
  const preexisting = listWindows().length;
  if (preexisting > 0) {
    t.skip(`${processName} already has ${preexisting} window(s); skipping so the check cannot move someone else's window`);
    return;
  }

  const spawned = [
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Title", "octm tile A"], { stdio: "ignore" }),
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Title", "octm tile B"], { stdio: "ignore" }),
  ];
  try {
    let before = [];
    for (let attempt = 0; attempt < 80; attempt++) {
      before = listWindows();
      if (before.length >= 2) break;
      await sleep(250);
    }
    assert.ok(before.length >= 2, `expected two fixture windows within 20s, saw ${before.length} (PowerShell startup is slow under load)`);
    const original = before.slice(0, 2);

    const tiled = runTile(["-ProcessName", processName, "-Layout", "2x1", "-Padding", String(padding), "-Json", "-StateFile", stateFile]);
    assert.equal(tiled.ok, true);
    assert.equal(tiled.layout, "2 column(s) x 1 row(s)");
    assert.equal(tiled.tiled, 2);
    const [left, right] = tiled.windows;
    assert.ok(left.width > 100 && left.height > 100, "cell has a sane size");
    assert.equal(left.width, right.width, "columns are equal width");
    assert.equal(left.height, right.height, "columns are equal height");
    assert.ok(left.x + left.width <= right.x, "windows do not overlap horizontally");
    assert.equal(left.y, right.y, "same row");
    assert.ok(left.x >= tiled.workArea.x && right.x + right.width <= tiled.workArea.x + tiled.workArea.width, "inside the work area");
    assert.ok(fs.existsSync(stateFile), "previous positions were saved for undo");
    assert.ok(left.title.startsWith("octm tile"), "only the fixture windows were arranged");

    // Read the real rectangles back: the report is what we asked for, this is what happened.
    // -List returns EnumWindows order, so sort before comparing.
    const placed = listWindows().filter((window) => window.title.startsWith("octm tile")).sort((a, b) => a.x - b.x || a.y - b.y);
    assert.equal(placed.length, 2);
    assert.ok(placed[0].x + placed[0].width <= placed[1].x + 2, "the OS really moved them apart");

    // The aliases have to mean what they say: "stacked" is the transpose of "2x1".
    const stacked = runTile(["-ProcessName", processName, "-Layout", "stacked", "-Padding", String(padding), "-Json", "-StateFile", stateFile]);
    assert.equal(stacked.layout, "1 column(s) x 2 row(s)");
    const [top, bottom] = stacked.windows;
    assert.equal(top.x, bottom.x, "stacked columns share x");
    assert.ok(top.y + top.height <= bottom.y, "stacked rows do not overlap vertically");

    const restore = runTile(["-ProcessName", processName, "-Restore", "-Json", "-StateFile", stateFile]);
    assert.equal(restore.ok, true);
    assert.equal(restore.restored, 2);
    const after = listWindows();
    for (const window of original) {
      const now = after.find((candidate) => candidate.handle === window.handle);
      assert.ok(now, "window still exists after restore");
      assert.ok(Math.abs(now.x - window.x) <= 2 && Math.abs(now.y - window.y) <= 2, `x/y restored (${window.x},${window.y} -> ${now.x},${now.y})`);
      assert.ok(Math.abs(now.width - window.width) <= 2 && Math.abs(now.height - window.height) <= 2, "size restored");
    }
    assert.equal(fs.existsSync(stateFile), false, "one-shot undo state is consumed");
  } finally {
    for (const child of spawned) {
      if (!child.pid) continue;
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGKILL");
    }
    if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
  }
});

test("tiling reflects the real opencode windows without moving anything unexpected", async (t) => {
  if (process.platform !== "win32") {
    t.skip("windows-only");
    return;
  }
  const listed = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProcessName", "OpenCode", "-List", "-Json", "-StateFile", stateFile], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const report = JSON.parse(listed.stdout);
  assert.equal(report.ok, true);
  t.diagnostic(`opencode windows visible to the tiler: ${report.windows.length}${report.windows.length ? ` (${report.windows.map((w) => `${w.title} ${w.width}x${w.height}`).join(", ")})` : " (app closed: expected)"}`);
  assert.ok(Array.isArray(report.windows));
});
