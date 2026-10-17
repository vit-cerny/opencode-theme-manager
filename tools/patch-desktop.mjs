#!/usr/bin/env node
// Patch the opencode desktop app so its window can actually be transparent.
//
// Why: the app creates its window with
//   { title, icon, backgroundColor: Ld ?? cn(), frame:false, titleBarStyle:'hidden', titleBarOverlay, webPreferences }
// - no `transparent: true` and no `backgroundMaterial` - so Chromium composites the page into an opaque
// surface and nothing behind the window can ever show through. Measured: the OS acrylic/mica backdrop
// changes not a single pixel of this window. Transparency is a property of the window, so it has to be
// added to the app.
//
// How: one function in the main bundle builds those options. Exactly one occurrence of the string
// `backgroundColor:Ld??cn(),` exists in the 168 MB `app.asar`. This tool overwrites those 25 bytes with
// `transparent:!0,` + padding spaces - a SAME-LENGTH edit inside the archive's payload. The archive is
// never unpacked or repacked: header, offsets and every other byte stay untouched, so nothing can be
// lost (an unpack/repack attempt was measured to drop 72 MB of node_modules - not doing that again).
//
//   node tools/patch-desktop.mjs                 # dry run: reports offset, before/after, writes nothing
//   node tools/patch-desktop.mjs --apply         # close the app, back it up, patch it
//   node tools/patch-desktop.mjs --revert        # restore the backup
//   node tools/patch-desktop.mjs --target <asar> # operate on a copy (what the tests do)
//
// Undo is a file copy. Re-run after an app update: updates replace app.asar (and re-patching is one
// command). If the app refuses to start, --revert puts the original bytes back.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findDesktopApp } from "../lib/desktop.mjs";

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};

const app = findDesktopApp();
const target = arg("--target") ? path.resolve(arg("--target")) : app.asar;
if (!target || !fs.existsSync(target)) {
  console.error("app.asar not found - is the opencode desktop app installed? (or pass --target <asar>)");
  process.exit(1);
}
const backup = `${target}.orig`;
const isCopy = Boolean(arg("--target"));

const ANCHOR = "backgroundColor:Ld??cn(),";
const REPLACEMENT = "transparent:!0,".padEnd(ANCHOR.length, " ");
if (REPLACEMENT.length !== ANCHOR.length) {
  console.error("replacement length mismatch - refusing to write");
  process.exit(1);
}

console.log(`asar:     ${target}`);
console.log(`size:     ${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
console.log(`backup:   ${backup}${fs.existsSync(backup) ? " (exists)" : ""}`);

if (has("--revert")) {
  if (!fs.existsSync(backup)) {
    console.error("no backup to restore - this tool never patched that file");
    process.exit(1);
  }
  fs.copyFileSync(backup, target);
  console.log("restored the original app.asar (byte-identical to the pre-patch file).");
  console.log(`the backup is still at ${backup} - delete it once you are happy.`);
  process.exit(0);
}

const buffer = fs.readFileSync(target);
const found = [];
let index = buffer.indexOf(ANCHOR);
while (index !== -1) {
  found.push(index);
  index = buffer.indexOf(ANCHOR, index + 1);
}
const patchOffset = found[0];
const already = buffer.indexOf("transparent:!0,");

console.log(`anchor:   ${JSON.stringify(ANCHOR)} (${ANCHOR.length} bytes), ${found.length} occurrence(s)`);
if (found.length === 0) {
  console.error("anchor not found. The app's window options changed - inspect the bundle again before patching.");
  process.exit(1);
}
if (found.length > 1) {
  console.error("refusing to patch: the anchor is not unique, a blind write could hit the wrong place.");
  process.exit(1);
}
if (already === patchOffset) {
  console.log("already patched (transparent:!0 is at the anchor offset) - nothing to do.");
  process.exit(0);
}

const before = buffer.slice(patchOffset - 60, patchOffset + ANCHOR.length + 30).toString("utf8");
const after = `${buffer.slice(patchOffset - 60, patchOffset).toString("utf8")}${REPLACEMENT}${buffer.slice(patchOffset + ANCHOR.length, patchOffset + ANCHOR.length + 30).toString("utf8")}`;
console.log(`offset:   ${patchOffset}`);
console.log(`before:   ...${JSON.stringify(before)}`);
console.log(`after:    ...${JSON.stringify(after)}`);

if (!has("--apply")) {
  console.log("\nDRY RUN - nothing written. Re-run with --apply to install it.");
  console.log("after --apply: start the app, then push the theme with a transparent window layer:");
  console.log("  node tools/desktop-apply.mjs --glass --wallpaper --restart");
  process.exit(0);
}

if (process.platform === "win32" && !isCopy) {
  const name = path.basename(app.exe || "OpenCode.exe");
  console.log(`\nclosing ${name} (a running app holds the file open) ...`);
  spawnSync("taskkill", ["/IM", name, "/T", "/F"], { stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt++) {
    const listing = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { encoding: "utf8" }).stdout || "";
    if (!listing.toLowerCase().includes(name.toLowerCase())) break;
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 250"], { stdio: "ignore" });
  }
}

if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
const fd = fs.openSync(target, "r+");
try {
  fs.writeSync(fd, Buffer.from(REPLACEMENT, "utf8"), 0, REPLACEMENT.length, patchOffset);
} finally {
  fs.closeSync(fd);
}

// Verify what actually landed on disk, byte by byte.
const verify = fs.readFileSync(target);
const wrote = verify.slice(patchOffset, patchOffset + REPLACEMENT.length).toString("utf8");
const sizeOk = fs.statSync(target).size === fs.statSync(backup).size;
console.log(`\nwritten:  ${JSON.stringify(wrote)}`);
console.log(`size:     ${sizeOk ? "unchanged (payload-only edit, archive structure untouched)" : "CHANGED - investigate before shipping"}`);
const headerMatch = verify.slice(0, 16).equals(fs.readFileSync(backup).slice(0, 16));
console.log(`header:   ${headerMatch ? "identical" : "CHANGED - investigate before shipping"}`);
if (wrote !== REPLACEMENT || !sizeOk || !headerMatch) {
  console.error("\nverification failed - restoring the backup");
  fs.copyFileSync(backup, target);
  process.exit(1);
}

console.log("\npatched. Now:");
console.log("  1. start the app (launch-themed.cmd does it with DevTools so the theme is pushed too)");
console.log("  2. node tools/desktop-apply.mjs --glass --wallpaper --restart");
console.log("  3. check tools/desktop-backdrop.ps1 -Backdrop acrylic (the window can now really be see-through)");
console.log(`\nundo any time: node tools/patch-desktop.mjs${isCopy ? ` --target "${target}"` : ""} --revert`);
