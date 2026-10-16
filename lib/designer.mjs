// Prompt / image-reference -> design. Deterministic, auditable, offline.
// No API key, no network: words map to colours and controls, image palettes map to roles.
// ponytail: a heuristic interpreter with a visible "matched words" list beats a hidden model call.

import { ALL_HUES, chromaOf, defaultDesign, hexToRgb, mixColors, relativeLuminance, tuneColor } from "./schema.mjs";

// Hue name -> representative colour. Tuned so the derived 9-step ladder looks right.
const COLOR_WORDS = {
  blue: "#5b8dd6", azure: "#3b9dff", sky: "#7cc4ff", cobalt: "#2f6fd0", navy: "#27406b", sapphire: "#2f6bd8",
  teal: "#2ec4b6", turquoise: "#40e0d0", aqua: "#35d0d6", cyan: "#22c3d6",
  green: "#4ade80", emerald: "#10b981", lime: "#a3e635", olive: "#7c8a3c", forest: "#2f6b45", mint: "#98f5c8",
  purple: "#a78bfa", violet: "#8b5cf6", indigo: "#6366f1", lavender: "#c4b5fd", grape: "#7c3aed",
  magenta: "#e879f9", fuchsia: "#d946ef", pink: "#f472b6", rose: "#fb7185", blush: "#f9a8d4",
  red: "#ef4444", crimson: "#dc2626", scarlet: "#e11d48", ruby: "#c81e4a", rust: "#b45309", maroon: "#7f1d1d",
  orange: "#fb923c", amber: "#fbbf24", gold: "#f5c542", yellow: "#fde047", sand: "#e0d3b8", tan: "#d3b98c",
  brown: "#92400e", sepia: "#b08050", beige: "#e8dcc8", cream: "#f4ecdd", ivory: "#f6f1e4",
  gray: "#8b95a7", grey: "#8b95a7", slate: "#7b8496", charcoal: "#3a3f4b", graphite: "#4a4f5a", silver: "#c0c6d0",
  black: "#0b0d12", white: "#f8fafc", snow: "#eef2f7", monochrome: "#9aa3b2",
  nord: "#88c0d0", dracula: "#bd93f9", gruvbox: "#d79921", tokyo: "#7aa2f7", tokyonight: "#7aa2f7",
  catppuccin: "#cba6f7", solarized: "#268bd2", rosepine: "#ebbcba", everforest: "#a7c080", monokai: "#f92672",
  matrix: "#00ff41", cyberpunk: "#fc02a5", vaporwave: "#ff71ce", sunset: "#ff8c42", sunrise: "#ffb56b",
  ocean: "#2b6cb0", marine: "#1d4ed8", desert: "#c98c48", jungle: "#2f8f6b", candy: "#ff8fd0", cherry: "#d2042d",
  midnight: "#1a2332", night: "#141922", dusk: "#3b3f5c", dawn: "#ffd7a8", neon: "#39ff14", ice: "#cfe8ff",
};

const THEME_SEEDS = {
  dracula: ["#282a36", "#f8f8f2", "#bd93f9", "#ff79c6", "#8be9fd", "#50fa7b", "#f1fa8c"],
  nord: ["#2e3440", "#d8dee9", "#88c0d0", "#81a1c1", "#8fbcbb", "#a3be8c", "#ebcb8b"],
  gruvbox: ["#282828", "#ebdbb2", "#fabd2f", "#83a598", "#b8bb26", "#fb4934", "#d3869b"],
  tokyonight: ["#1a1b26", "#c0caf5", "#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68"],
  catppuccin: ["#1e1e2e", "#cdd6f4", "#cba6f7", "#89b4fa", "#94e2d5", "#a6e3a1", "#f9e2af"],
  monokai: ["#272822", "#f8f8f2", "#f92672", "#66d9ef", "#a6e22e", "#fd971f", "#ae81ff"],
  solarized: ["#002b36", "#93a1a1", "#268bd2", "#2aa198", "#859900", "#b58900", "#cb4b16"],
  rosepine: ["#191724", "#e0def4", "#ebbcba", "#9ccfd8", "#c4a7e7", "#31748f", "#f6c177"],
  everforest: ["#2d353b", "#d3c6aa", "#a7c080", "#7fbbb3", "#d699b6", "#e69875", "#dbbc7f"],
  matrix: ["#0b0f0b", "#c8ffc8", "#00ff41", "#00c853", "#69f0ae", "#b2ff59", "#76ff03"],
  cyberpunk: ["#0d0221", "#f8f8f2", "#fc02a5", "#00e5ff", "#f9e64f", "#00ff9f", "#ff5f1f"],
};

const MATERIAL_WORDS = {
  glass: 45, frosted: 50, glassy: 45, translucent: 45, transparent: 60, see_through: 50, acrylic: 40,
  blur: 45, blurred: 45, smoky: 35, sheer: 50, crystal: 40, airy: 30, ghost: 55,
  opaque: 0, solid: 0, flat: 0, matte: 0, dense: 0, heavy: 5,
};
const SATURATION_WORDS = { pastel: 0.45, soft: 0.7, muted: 0.6, subtle: 0.65, gentle: 0.7, vivid: 1.25, neon: 1.45, bold: 1.2, vivid_bold: 1.25 };
const LIGHTNESS_WORDS = { dark: -0.05, deep: -0.07, light: 0.06, pale: 0.08, bright: 0.05, dim: -0.04, warm: 0.02, cool: -0.02 };
const RADIUS_WORDS = { rounded: 14, round: 14, pill: 22, "squircle": 16, soft: 12, sharp: 2, square: 3, boxy: 3, angular: 2 };
const DENSITY_WORDS = { compact: 0.85, dense: 0.85, tight: 0.85, airy: 1.25, spacious: 1.25, roomy: 1.2, comfortable: 1.1 };
const SIZE_WORDS = { tiny: 11, small: 12, normal: 13, large: 15, big: 16, huge: 18 };
const FONT_WORDS = {
  "jetbrains": "JetBrains Mono", "jetbrains mono": "JetBrains Mono", "fira": "Fira Code", "fira code": "Fira Code",
  cascadia: "Cascadia Code", consolas: "Consolas", meslo: "MesloLGS NF", hack: "Hack", "ibm plex": "IBM Plex Mono",
  "source code": "Source Code Pro", "cascadia mono": "Cascadia Mono", "comic": "Comic Mono",
};
const LAYOUT_WORDS = {
  sidebar: { "session.sidebar": "auto" }, "no sidebar": { "session.sidebar": "hide" }, "hide sidebar": { "session.sidebar": "hide" },
  "vertical tabs": { "tabs.layout": "vertical" }, "horizontal tabs": { "tabs.layout": "horizontal" },
  "split diff": { "diffs.view": "split" }, "unified diff": { "diffs.view": "unified" },
  scrollbar: { "session.scrollbar": true }, "no scrollbar": { "session.scrollbar": false },
};

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .split(/[^a-z0-9+%-]+/)
    .filter(Boolean);
}

function percentFromText(text) {
  const match = String(text || "").match(/(\d{1,3})\s*(?:%|percent|pct)[a-z ]*(transparen|see[- ]?through|opac)|(transparen|see[- ]?through)\D{0,12}(\d{1,3})\s*(?:%|percent|pct)/i);
  if (match) {
    const value = Number(match[1] ?? match[3]);
    if (value >= 0 && value <= 100) return match[1] ? value : 100 - value;
  }
  const plain = String(text || "").match(/(\d{1,3})\s*(?:%|percent)\s*(?:transparen|glass|see[- ]?through)/i);
  if (plain) return Number(plain[1]);
  return null;
}

export function paletteFromThemeSeed(name) {
  const key = Object.keys(THEME_SEEDS).find((k) => name.includes(k));
  if (!key) return null;
  const [bg, fg, accent, accent2, cyan, green, yellow] = THEME_SEEDS[key];
  return { background: bg, text: fg, accent, accent2, cyan, green, yellow, theme: key };
}

// Prompt -> design. `seedPalette` (from a matched preset theme or an extracted image) wins over colour words.
export function interpretPrompt(prompt, { seedPalette = null } = {}) {
  const text = String(prompt || "");
  // Font names contain colour-ish words ("JetBrains Mono", "Neon Sans"): strip them before colour matching.
  let colorText = text.toLowerCase();
  for (const key of Object.keys(FONT_WORDS)) colorText = colorText.split(key).join(" ");
  const list = words(colorText);
  const lower = colorText.toLowerCase();
  const rawLower = text.toLowerCase();
  const matched = [];
  const notes = [];

  const seed = seedPalette || paletteFromThemeSeed(rawLower);
  if (seed?.theme) matched.push(`theme:${seed.theme}`);

  // 1. explicit colour words (in the order they appear; later words win for the accent)
  const colorWords = list.filter((w) => COLOR_WORDS[w]);
  if (colorWords.length) matched.push(...colorWords.map((w) => `color:${w}`));
  let accent = colorWords.length ? COLOR_WORDS[colorWords[colorWords.length - 1]] : null;
  if (seed && !accent) accent = seed.accent;

  // 2. material / transparency
  let transparency = null;
  for (const w of list) {
    if (MATERIAL_WORDS[w] !== undefined) {
      transparency = MATERIAL_WORDS[w];
      matched.push(`material:${w}`);
      break;
    }
  }
  if (transparency === null && /frosted glass|glass morph|glassmorph|glass effect|glass panel/.test(lower)) {
    transparency = 50;
    matched.push("material:glass-panel");
  }
  const percent = percentFromText(text);
  if (percent !== null) {
    transparency = percent;
    matched.push(`transparency:${percent}%`);
  }
  if (transparency === null) transparency = seed ? 40 : 35;
  if (/blur/.test(lower)) notes.push("blur is applied by the terminal/desktop compositor, not by the theme colours");

  // 3. saturation / lightness modifiers
  let chromaScale = 1;
  let lightnessShift = 0;
  for (const w of list) {
    if (SATURATION_WORDS[w] !== undefined) {
      chromaScale *= SATURATION_WORDS[w];
      matched.push(`saturation:${w}`);
    }
    if (LIGHTNESS_WORDS[w] !== undefined) {
      lightnessShift += LIGHTNESS_WORDS[w];
      matched.push(`lightness:${w}`);
    }
  }
  const wantsLight = /\blight\b|\bday\b|\bwhite\b|\bpale\b|\bpastel\b/.test(lower) && !/\bdark\b/.test(lower);

  // 4. typography + shape
  let monoFont = null;
  for (const [key, font] of Object.entries(FONT_WORDS)) {
    if (rawLower.includes(key)) {
      monoFont = font;
      matched.push(`font:${font}`);
      break;
    }
  }
  let fontSize = 13;
  const firstWordIn = (table) => list.find((word) => table[word] !== undefined);
  const sizeWord = firstWordIn(SIZE_WORDS);
  if (sizeWord) {
    fontSize = SIZE_WORDS[sizeWord];
    matched.push(`size:${sizeWord}`);
  }
  const bigUi = /big (buttons|text|ui)|large (buttons|text|ui)|chunky/.test(lower) || list.includes("big") || list.includes("large");
  if (bigUi) {
    fontSize = Math.max(fontSize, 15);
    matched.push("size:big-ui");
  }
  let radius = 10;
  const radiusWord = firstWordIn(RADIUS_WORDS);
  if (radiusWord) {
    radius = RADIUS_WORDS[radiusWord];
    matched.push(`radius:${radiusWord}`);
  }
  let pad = 12;
  const densityWord = firstWordIn(DENSITY_WORDS);
  if (densityWord) {
    pad = Math.round(12 * DENSITY_WORDS[densityWord]);
    matched.push(`density:${densityWord}`);
  }

  // 5. layout knobs opencode actually has in cli.json
  const layout = {};
  for (const [phrase, patch] of Object.entries(LAYOUT_WORDS)) {
    if (lower.includes(phrase)) {
      Object.assign(layout, patch);
      matched.push(`layout:${phrase}`);
    }
  }

  const design = designFromColors({ accent, seed, transparency, chromaScale, lightnessShift, wantsLight });
  const ui = { monoFont, uiFont: null, fontSize, lineHeight: 1.45, radius, pad, customCss: "" };
  return { design, ui, layout, matched, notes, wantsLight };
}

function designFromColors({ accent, seed, transparency, chromaScale, lightnessShift, wantsLight }) {
  const design = defaultDesign();
  design.modes = wantsLight ? ["light", "dark"] : ["light", "dark"];
  const dark = { ...design.hues.dark };
  const light = { ...design.hues.light };
  const acc = accent ? tuneColor(accent, { chroma: chromaScale, lightness: lightnessShift }) : null;

  if (seed) {
    dark.gray = seed.background;
    dark.neutral = mixColors(seed.text, seed.background, 0.45);
    dark.text = seed.text;
    light.neutral = mixColors(seed.text, seed.background, 0.35);
  }
  if (acc) {
    dark.accent = acc;
    dark.interactive = tuneColor(acc, { chroma: 0.8, lightness: -0.05 });
    light.accent = tuneColor(acc, { chroma: 1.05, lightness: wantsLight ? -0.15 : -0.1 });
    light.interactive = tuneColor(acc, { chroma: 1.0, lightness: -0.2 });
    dark.blue = mixColors(acc, "#3b82f6", 0.4);
    light.blue = tuneColor(mixColors(acc, "#2563eb", 0.5), { lightness: -0.1 });
  }
  if (seed) {
    dark.cyan = seed.cyan;
    dark.green = seed.green;
    dark.yellow = seed.yellow;
  }
  for (const hue of ALL_HUES) {
    if (dark[hue]) dark[hue] = tuneColor(dark[hue], { chroma: chromaScale, lightness: lightnessShift });
    if (light[hue]) light[hue] = tuneColor(light[hue], { chroma: chromaScale, lightness: wantsLight ? lightnessShift + 0.02 : lightnessShift });
  }
  // Neutral ramp: keep it faintly tinted toward the palette so glass panels read as one material.
  if (acc) {
    dark.neutral = mixColors(dark.neutral || "#8b95a7", acc, 0.16);
    light.neutral = mixColors(light.neutral || "#4c566a", acc, 0.12);
  }
  light.neutral = light.neutral || "#4c566a";
  dark.neutral = dark.neutral || "#8b95a7";

  design.hues = { dark, light };
  design.transparency = { dark: transparency, light: Math.max(0, Math.round(transparency * 0.55)) };
  design.modes = wantsLight ? ["light", "dark"] : ["dark", "light"];
  // Honour the source palette exactly on the primary mode: background/text come from the seed,
  // every other token keeps the generated ladder. Alpha is baked in later by buildTheme.
  if (seed) {
    const primary = design.modes[0];
    const overrides = design.overrides[primary] || (design.overrides[primary] = {});
    overrides["background.base"] = seed.background;
    overrides["background.raised.base"] = mixColors(seed.background, seed.text, 0.07);
    overrides["background.raised.high"] = mixColors(seed.background, seed.text, 0.13);
    overrides["background.raised.max"] = mixColors(seed.background, seed.text, 0.19);
    overrides["text.base"] = seed.text;
    overrides["text.muted"] = mixColors(seed.text, seed.background, 0.45);
  }
  return design;
}

// Image palette (extracted in the browser) -> design. Heuristic, then editable in the UI.
export function paletteToDesign(colors, { mode = "dark", transparency = 40 } = {}) {
  const hexes = (colors || []).filter((c) => hexToRgb(c));
  if (hexes.length < 2) throw new Error("need at least two colours to build a palette");
  const byLuma = [...hexes].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  const light = mode === "light";
  const background = light ? byLuma[byLuma.length - 1] : byLuma[0];
  const foreground = light ? byLuma[0] : byLuma[byLuma.length - 1];
  const accent = [...hexes].sort((a, b) => chromaOf(b) - chromaOf(a))[0] || foreground;
  const secondary = [...hexes].filter((c) => c !== accent).sort((a, b) => chromaOf(b) - chromaOf(a))[0];
  return {
    design: designFromColors({
      accent,
      seed: { background, text: foreground, accent, cyan: secondary || accent, green: secondary || accent, yellow: secondary || accent },
      transparency,
      chromaScale: 1,
      lightnessShift: 0,
      wantsLight: light,
    }),
    ui: { monoFont: null, uiFont: null, fontSize: 13, lineHeight: 1.45, radius: 10, pad: 12, customCss: "" },
    layout: {},
    matched: [`palette:${hexes.length} colours`, `background:${background}`, `foreground:${foreground}`, `accent:${accent}`],
    notes: ["palette derived from the reference image; every swatch stays editable"],
  };
}

// Full pipeline used by the UI: prompt (+ optional image palette, + optional named preset) -> design bundle.
export function designFromInput({ prompt = "", imageColors = null, preset = null, presetPalette = null, mode = "dark", transparency = null } = {}) {
  const base = prompt ? interpretPrompt(prompt, { seedPalette: presetPalette }) : null;
  let bundle = base;
  if (!bundle && imageColors) bundle = paletteToDesign(imageColors, { mode, transparency: transparency ?? 40 });
  if (!bundle) bundle = { design: defaultDesign(), ui: { monoFont: null, uiFont: null, fontSize: 13, lineHeight: 1.45, radius: 10, pad: 12, customCss: "" }, layout: {}, matched: [], notes: [] };
  if (bundle && imageColors) bundle.design = paletteToDesign(imageColors, { mode: bundle.design.modes[0] === "light" ? "light" : mode, transparency: transparency ?? bundle.design.transparency?.dark ?? 40 }).design;
  if (transparency !== null && Number.isFinite(Number(transparency))) {
    bundle.design.transparency = { dark: Number(transparency), light: Math.max(0, Math.round(Number(transparency) * 0.55)) };
  }
  if (preset) bundle.preset = preset;
  return bundle;
}

export const COLOR_WORD_TABLE = COLOR_WORDS;
export const THEME_SEED_TABLE = THEME_SEEDS;
