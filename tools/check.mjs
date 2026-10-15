#!/usr/bin/env node
// Verifies every theme this repo ships: examples/ (V2 + legacy V1) and presets/v1/*.json.
//   node tools/check.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_PATHS, REQUIRED_TOKEN_PATHS, importV1, resolveTheme, validateTheme } from "../lib/schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
let failures = 0;

const line = (ok, text) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
};

// `node tools/check.mjs <file> [file...]` validates individual theme documents (V2 or legacy V1).
const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (explicit.length) {
  for (const file of explicit) {
    const full = path.resolve(file);
    if (!fs.existsSync(full)) {
      line(false, `${file}: no such file`);
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(full, "utf8"));
    if (doc.base) {
      const result = validateTheme(doc);
      line(result.ok, `${file}: V2, ${result.ok ? "valid" : result.errors.slice(0, 3).join("; ")}`);
    } else {
      const { validation } = importV1(doc);
      line(validation.ok, `${file}: legacy V1, imports ${validation.ok ? "cleanly" : validation.errors.slice(0, 3).join("; ")}`);
    }
  }
  console.log(`\n${failures ? `${failures} failure(s)` : "all checks passed"}`);
  process.exit(failures ? 1 : 0);
}

console.log(`token inventory: ${TOKEN_PATHS.length} paths (${REQUIRED_TOKEN_PATHS.length} required, ${TOKEN_PATHS.length - REQUIRED_TOKEN_PATHS.length} optional)\n`);

console.log("examples/");
const exampleDir = path.join(repo, "examples");
const examples = fs.existsSync(exampleDir) ? fs.readdirSync(exampleDir).filter((f) => f.endsWith(".json")) : [];
if (!examples.length) line(false, "no example themes found");
for (const file of examples) {
  const doc = JSON.parse(fs.readFileSync(path.join(exampleDir, file), "utf8"));
  if (doc.base) {
    const result = validateTheme(doc);
    const translucent = Object.values(resolveTheme(doc, doc.dark ? "dark" : "light")).filter((v) => /^#[0-9a-f]{8}$/i.test(v) || v === "transparent").length;
    line(result.ok, `${file}: V2, ${result.ok ? "valid" : result.errors.slice(0, 2).join("; ")}, ${translucent} translucent token(s)`);
  } else {
    const { theme, validation } = importV1(doc);
    line(validation.ok, `${file}: legacy V1, imports ${validation.ok ? "cleanly" : validation.errors.slice(0, 2).join("; ")}`);
    line(Object.keys(theme.base || {}).length > 0, `${file}: legacy import produced a base tree`);
  }
}

console.log("\npresets/v1/");
const presetDir = path.join(repo, "presets", "v1");
const presets = fs.existsSync(presetDir) ? fs.readdirSync(presetDir).filter((f) => f.endsWith(".json")) : [];
if (!presets.length) line(false, "no presets found");
for (const file of presets) {
  const doc = JSON.parse(fs.readFileSync(path.join(presetDir, file), "utf8"));
  const { theme, validation } = importV1(doc);
  const resolved = resolveTheme(theme, "dark");
  const missing = Object.entries(resolved).filter(([, value]) => !/^#[0-9a-f]{3,8}$/i.test(value) && value !== "transparent");
  line(validation.ok && !missing.length, `${file}: ${validation.ok ? "valid" : validation.errors.slice(0, 2).join("; ")}${missing.length ? `, unresolved: ${missing.slice(0, 2).map(([k]) => k).join(", ")}` : ""}`);
}

console.log(`\n${failures ? `${failures} failure(s)` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
