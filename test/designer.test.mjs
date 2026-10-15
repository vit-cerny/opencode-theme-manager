import { test } from "node:test";
import assert from "node:assert/strict";
import { COLOR_WORD_TABLE, THEME_SEED_TABLE, designFromInput, interpretPrompt, paletteFromThemeSeed, paletteToDesign } from "../lib/designer.mjs";
import { chromaOf, resolveTheme, validateTheme } from "../lib/schema.mjs";
import { buildTheme } from "../lib/schema.mjs";

const ok = (design) => {
  const result = validateTheme(buildTheme(design));
  assert.deepEqual(result.errors, []);
  return result;
};

test("a prompt produces a valid theme and says what it understood", () => {
  const { design, ui, matched } = interpretPrompt("nord blue frosted glass, jetbrains mono, 70% transparent");
  ok(design);
  assert.equal(ui.monoFont, "JetBrains Mono");
  assert.equal(design.transparency.dark, 70);
  assert.ok(matched.includes("theme:nord"));
  assert.ok(matched.includes("transparency:70%"));
  assert.ok(matched.some((m) => m.startsWith("material:")));
  assert.ok(matched.some((m) => m.startsWith("font:")));
});

test("font names never leak into colour matching", () => {
  const { matched } = interpretPrompt("jetbrains mono, comic mono");
  assert.deepEqual(matched.filter((m) => m.startsWith("color:")), []);
  assert.ok(matched.includes("font:JetBrains Mono"));
});

test("material words pick the transparency level", () => {
  assert.equal(interpretPrompt("frosted glass").design.transparency.dark, 50);
  assert.equal(interpretPrompt("translucent").design.transparency.dark, 45);
  assert.equal(interpretPrompt("opaque solid flat").design.transparency.dark, 0);
  assert.equal(interpretPrompt("neon cyberpunk glass").design.transparency.dark, 45);
  assert.ok(interpretPrompt("30% transparency").design.transparency.dark === 30);
});

test("saturation and lightness words actually change the hues", () => {
  const muted = interpretPrompt("muted deep blue").design.hues.dark.accent;
  const neon = interpretPrompt("neon blue").design.hues.dark.accent;
  const plain = interpretPrompt("blue").design.hues.dark.accent;
  assert.ok(chromaOf(neon) > chromaOf(plain), "neon must be more saturated");
  assert.ok(chromaOf(muted) < chromaOf(plain), "muted must be less saturated");
});

test("light prompts build a light-first palette that still validates", () => {
  const { design } = interpretPrompt("light pastel cream, soft rounded");
  ok(design);
  assert.equal(design.modes[0], "light");
  assert.equal(interpretPrompt("dark navy").design.modes[0], "dark");
});

test("typo, shape and density words reach the ui profile", () => {
  const { ui } = interpretPrompt("big rounded buttons, airy layout, fira code, small text");
  assert.ok(ui.fontSize >= 13);
  assert.equal(ui.radius, 14);
  assert.ok(ui.pad > 12);
  assert.equal(ui.monoFont, "Fira Code");
});

test("layout words map onto real cli.json keys only", () => {
  const { layout } = interpretPrompt("vertical tabs, no sidebar, split diff");
  assert.deepEqual(layout, { "tabs.layout": "vertical", "session.sidebar": "hide", "diffs.view": "split" });
});

test("an image palette becomes a design whose roles make sense", () => {
  const { design, matched } = paletteToDesign(["#080b14", "#e9eefb", "#4f8cff", "#b39ddb"], { mode: "dark", transparency: 50 });
  ok(design);
  assert.equal(design.hues.dark.accent, "#4f8cff");
  assert.ok(matched.some((m) => m.startsWith("background:")));
  const resolved = resolveTheme(buildTheme(design), "dark");
  assert.equal(resolved["background.base"], "#080b1480", "the palette background survives with 50% alpha");
  assert.equal(resolved["text.base"], "#e9eefb");
  assert.ok(resolved["background.raised.base"] !== resolved["background.base"], "raised surfaces step up");
});

test("light image palettes flip the inferred roles", () => {
  const { design } = paletteToDesign(["#f7f7fb", "#111827", "#2563eb"], { mode: "light", transparency: 0 });
  ok(design);
  assert.equal(design.modes[0], "light");
  const resolved = resolveTheme(buildTheme(design), "light");
  assert.equal(resolved["background.base"], "#f7f7fb");
  assert.equal(resolved["text.base"], "#111827");
});

test("too few colours is an error, not a guess", () => {
  assert.throws(() => paletteToDesign(["#000000"]), /at least two colours/);
});

test("designFromInput combines prompt, image and preset", () => {
  const bundle = designFromInput({ prompt: "ocean glass", imageColors: ["#04121f", "#dff3ff", "#2ec4b6"], preset: "nord", presetPalette: { background: "#2e3440", text: "#d8dee9", accent: "#88c0d0", cyan: "#8fbcbb", green: "#a3be8c", yellow: "#ebcb8b" }, transparency: 62 });
  ok(bundle.design);
  assert.equal(bundle.design.transparency.dark, 62);
  assert.equal(bundle.preset, "nord");
  const resolved = resolveTheme(buildTheme(bundle.design), "dark");
  assert.equal(resolved["background.base"], "#04121f61", "the image palette wins over the preset seed");
});

test("a prompt with a named theme still yields a usable palette", () => {
  const bundle = designFromInput({ prompt: "tokyonight glass with big rounded buttons", transparency: 50 });
  ok(bundle.design);
  assert.ok(bundle.matched.includes("theme:tokyonight"));
  assert.ok(bundle.ui.radius === 14);
  assert.match(resolveTheme(buildTheme(bundle.design), "dark")["background.base"], /^#[0-9a-f]{8}$/i);
});

test("tables stay ship-able", () => {
  assert.ok(Object.keys(COLOR_WORD_TABLE).length > 60);
  assert.ok(Object.keys(THEME_SEED_TABLE).length >= 10);
  assert.equal(paletteFromThemeSeed("i want tokyonight glass").theme, "tokyonight");
  assert.equal(paletteFromThemeSeed("nothing here"), null);
});
