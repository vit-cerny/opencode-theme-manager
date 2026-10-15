#!/usr/bin/env node
// Evidence probe: does the installed opencode binary really contain the V2 theme loader?
//   node tools/strings-probe.mjs [binary] [pattern...]
// Prints match counts and a small context window per hit. No execution of the target.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const candidates = [
  path.join(process.env.APPDATA || "", "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
  path.join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"),
];
const DEFAULT_PATTERNS = [
  "Missing required semantic hues",
  "opencode.ai/theme.json",
  "oc-theme-preload",
  ".opencode/themes",
  "thinkingOpacity",
];

const target = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : candidates.find((file) => fs.existsSync(file));
if (!target) {
  console.error("no opencode binary found; pass a path");
  process.exit(2);
}
const patterns = process.argv.slice(process.argv[2] && fs.existsSync(process.argv[2]) ? 3 : 2);
const list = patterns.length ? patterns : DEFAULT_PATTERNS;

const stat = fs.statSync(target);
const buffer = fs.readFileSync(target);
const haystack = buffer.toString("latin1");

console.log(`binary: ${target}`);
console.log(`size:   ${(stat.size / 1024 / 1024).toFixed(1)} MB\n`);
for (const pattern of list) {
  const hits = [];
  let index = haystack.indexOf(pattern);
  while (index !== -1 && hits.length < 3) {
    hits.push(haystack.slice(Math.max(0, index - 90), index + pattern.length + 90).replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim());
    index = haystack.indexOf(pattern, index + 1);
  }
  const present = haystack.includes(pattern);
  console.log(`${present ? "FOUND" : "absent"}  "${pattern}"${hits.length ? ` (${hits.length}+ hit(s))` : ""}`);
  for (const hit of hits) console.log(`        ...${hit}`);
  console.log();
}
