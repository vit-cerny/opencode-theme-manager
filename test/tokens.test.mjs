import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HUE_STEPS, SEMANTIC_HUES, TOKEN_PATHS,
  applyTransparency, buildTheme, defaultDesign, hexToRgb, hueScale, importV1,
  isColorValue, referenceBase, resolveTheme, tokenPaths, validateTheme,
} from "../lib/schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");

// The exact required `base` token tree from opencode's packages/theme/src/tui/schema.ts
// (CompleteThemeTokensDefinition). Hardcoded on purpose: if opencode adds a token, this test fails loudly.
function expectedBaseTokens() {
  const states = ["base", "$hovered", "$focused", "$pressed", "$selected", "$disabled"];
  const out = ["text.base", "text.muted"];
  for (const variant of ["primary", "secondary", "destructive"]) {
    for (const state of states) out.push(`text.action.${variant}.${state}`);
  }
  for (const state of states) out.push(`text.formfield.${state}`);
  for (const kind of ["error", "warning", "success", "info"]) out.push(`text.feedback.${kind}.base`, `text.feedback.${kind}.muted`);
  out.push("background.base");
  for (const raised of ["base", "high", "max"]) out.push(`background.raised.${raised}`);
  for (const variant of ["primary", "secondary", "destructive"]) {
    for (const state of states) out.push(`background.action.${variant}.${state}`);
  }
  for (const state of states) out.push(`background.formfield.${state}`);
  for (const kind of ["error", "warning", "success", "info"]) out.push(`background.feedback.${kind}.base`);
  out.push("border.base", "scrollbar.base");
  for (const token of ["added", "removed", "context", "hunkHeader"]) out.push(`diff.text.${token}`);
  for (const token of ["added", "removed", "context"]) out.push(`diff.background.${token}`);
  for (const token of ["added", "removed"]) out.push(`diff.highlight.${token}`);
  out.push("diff.lineNumber.text");
  for (const token of ["added", "removed"]) out.push(`diff.lineNumber.background.${token}`);
  for (const token of ["comment", "keyword", "function", "variable", "string", "number", "type", "operator", "punctuation"]) out.push(`syntax.${token}`);
  for (const token of ["text", "heading", "link", "linkText", "code", "blockQuote", "emphasis", "strong", "horizontalRule", "listItem", "listEnumeration", "image", "imageText", "codeBlock"]) out.push(`markdown.${token}`);
  return out;
}

test("reference tree covers every required base token exactly", () => {
  const expected = expectedBaseTokens();
  const mine = new Set(TOKEN_PATHS);
  assert.deepEqual(expected.filter((p) => !mine.has(p)), [], "missing required base tokens");
  assert.deepEqual(TOKEN_PATHS.filter((p) => !expected.includes(p)), [], "extra base tokens");
  assert.equal(TOKEN_PATHS.length, expected.length);
  assert.ok(expected.length >= 100);
  assert.equal(tokenPaths(referenceBase()).length, expected.length);
});

test("default design builds a valid V2 theme", () => {
  const theme = buildTheme(defaultDesign());
  const result = validateTheme(theme);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  for (const mode of ["light", "dark"]) {
    assert.ok(theme[mode].hue, `${mode} hue palette`);
    for (const name of SEMANTIC_HUES) assert.ok(theme[mode].hue[name], `${mode}.hue.${name}`);
    for (const step of HUE_STEPS) assert.match(theme[mode].hue.neutral[step], /^#[0-9a-f]{6}$/);
  }
});

test("validator rejects the things opencode rejects", () => {
  const base = () => buildTheme(defaultDesign());

  const badHex = base();
  badHex.base.text.base = "#zzzzzz";
  assert.ok(validateTheme(badHex).errors.some((e) => e.includes("text.base")));

  const missing = base();
  delete missing.base.border;
  assert.ok(validateTheme(missing).errors.some((e) => e.includes("border.base")));

  const noMode = base();
  delete noMode.light;
  delete noMode.dark;
  assert.ok(validateTheme(noMode).errors.some((e) => e.includes("light/dark")));

  const noSemantic = base();
  delete noSemantic.dark.hue.accent;
  assert.ok(validateTheme(noSemantic).errors.some((e) => e.includes("hue.accent")));

  const shortScale = base();
  delete shortScale.dark.hue.green[400];
  assert.ok(validateTheme(shortScale).errors.some((e) => e.includes("green.400")));

  const brokenAlias = base();
  brokenAlias.dark.hue.accent = "$hue.nope";
  assert.ok(validateTheme(brokenAlias).errors.some((e) => e.includes("undefined hue")));

  const badSyntax = base();
  badSyntax.base.syntax.keyword = "$text.muted";
  assert.ok(validateTheme(badSyntax).errors.some((e) => e.includes("syntax.keyword")));

  const unknown = base();
  unknown.base.text.nope = "#ffffff";
  assert.ok(validateTheme(unknown).warnings.some((w) => w.includes("unknown token")));

  assert.equal(validateTheme({ base: {} }).ok, false);
  assert.equal(validateTheme(null).ok, false);
});

test("colour values accept everything the schema accepts", () => {
  for (const good of ["#fff", "#ffff", "#ffffff", "#ffffffff", "transparent", "$hue.neutral.200", "$text.muted"]) {
    assert.equal(isColorValue(good), true, good);
  }
  for (const bad of ["#ff", "ffffff", "red", "rgb(1,2,3)", "", null, 12]) {
    assert.equal(isColorValue(bad), false, String(bad));
  }
});

test("hue ladder produces 9 usable steps in the right direction", () => {
  const dark = hueScale("#88c0d0", "dark");
  const light = hueScale("#0e7490", "light");
  for (const scale of [dark, light]) {
    assert.deepEqual(Object.keys(scale), HUE_STEPS.map(String));
    for (const step of HUE_STEPS) assert.match(scale[step], /^#[0-9a-f]{6}$/);
  }
  const luma = (hex) => Object.values(hexToRgb(hex)).slice(0, 3).reduce((a, b) => a + b, 0);
  assert.ok(luma(dark[100]) > luma(dark[900]), "dark themes run light -> dark");
  assert.ok(luma(light[100]) < luma(light[900]), "light themes run dark -> light");
  assert.equal(hueScale("nope", "dark"), null);
});

test("transparency bakes alpha into surfaces instead of references", () => {
  assert.equal(applyTransparency("#112233", 0), "#112233");
  assert.equal(applyTransparency("#112233", 100), "transparent");
  assert.equal(applyTransparency("#112233", 50), "#11223380");
  assert.equal(applyTransparency("transparent", 50), "transparent");
  assert.equal(applyTransparency("$hue.neutral.900", 50), "$hue.neutral.900");

  const theme = buildTheme(defaultDesign());
  assert.match(theme.dark.background.base, /^#[0-9a-f]{8}$/);
  assert.match(theme.light.background.base, /^#[0-9a-f]{8}$/);
  const clear = buildTheme({ ...defaultDesign(), transparency: { dark: 0, light: 0 } });
  assert.equal(clear.dark.background, undefined, "no transparency -> surfaces stay as base references");
  assert.equal(validateTheme(clear).ok, true);
});

test("every reference resolves to a concrete colour", () => {
  const theme = buildTheme(defaultDesign());
  for (const mode of ["dark", "light"]) {
    const resolved = resolveTheme(theme, mode);
    assert.equal(Object.keys(resolved).length, TOKEN_PATHS.length);
    for (const [token, value] of Object.entries(resolved)) {
      assert.ok(/^#[0-9a-f]{3,8}$/i.test(value), `${mode} ${token} -> ${value}`);
    }
  }
});

test("legacy V1 presets import into valid V2 themes", () => {
  const dir = path.join(repo, "presets", "v1");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 30, `expected the built-in preset set, found ${files.length}`);
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const { theme, validation } = importV1(json);
    assert.deepEqual(validation.errors, [], `${file} should import cleanly`);
    const resolved = resolveTheme(theme, "dark");
    assert.ok(Object.keys(resolved).length === TOKEN_PATHS.length, `${file} resolves fully`);
    for (const value of Object.values(resolved)) assert.match(value, /^(#[0-9a-f]{3,8}|transparent)$/i, `${file} -> ${value}`);
  }
});

test("importing junk fails loudly instead of inventing a theme", () => {
  assert.throws(() => importV1({ hello: "world" }), /no recognisable V1 tokens/);
});

test("sky in, glass theme out (prompt-independent invariants hold)", () => {
  const theme = buildTheme({ ...defaultDesign(), transparency: { dark: 70, light: 0 } });
  assert.match(theme.dark.background.base, /^#[0-9a-f]{6}4d$/i);
  assert.equal(validateTheme(theme).ok, true);
});
