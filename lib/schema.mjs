// OpenCode V2 theme model: reference tree, validation, hue ladders, transparency, V1 import.
// Mirrors the rules in opencode's own packages/theme/src/tui/schema.ts (hex 3/4/6/8, "transparent", "$ref").
// ponytail: only what the app needs - one tree, one validator, one ladder, one mapper.

export const HUE_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
export const BASE_HUES = ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple"];
export const SEMANTIC_HUES = ["accent", "interactive", "neutral"];
export const ALL_HUES = [...BASE_HUES, ...SEMANTIC_HUES];
export const ACTION_VARIANTS = ["primary", "secondary", "destructive"];
export const ACTION_STATES = ["$hovered", "$focused", "$pressed", "$selected", "$disabled"];
export const FEEDBACK_KINDS = ["error", "warning", "success", "info"];

const HEX_RE = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const REF_RE = /^\$.+$/;
const HUE_REF_RE = /^\$hue\..+\.(?:100|200|300|400|500|600|700|800|900)$/;

function states(base, hovered, focused, pressed, selected, disabled) {
  return {
    base,
    $hovered: hovered,
    $focused: focused,
    $pressed: pressed,
    $selected: selected,
    $disabled: disabled,
  };
}

// Hue-driven reference tree. Editing hues re-skins everything; individual tokens can be overridden with hex.
export function referenceBase() {
  const textAction = (hue) => states(`$hue.${hue}.300`, `$hue.${hue}.200`, `$hue.${hue}.200`, `$hue.${hue}.400`, `$hue.${hue}.400`, "$hue.neutral.600");
  const backgroundAction = (hue) => states(`$hue.${hue}.600`, `$hue.${hue}.500`, `$hue.${hue}.500`, `$hue.${hue}.700`, `$hue.${hue}.700`, "$hue.neutral.800");
  return {
    categorical: ["accent", "purple", "green", "blue"],
    text: {
      base: "$hue.neutral.200",
      muted: "$hue.neutral.400",
      action: {
        primary: textAction("interactive"),
        secondary: textAction("accent"),
        destructive: textAction("red"),
      },
      formfield: states("$hue.neutral.200", "$hue.neutral.100", "$hue.neutral.100", "$hue.neutral.300", "$hue.neutral.300", "$hue.neutral.600"),
      feedback: {
        error: { base: "$hue.red.300", muted: "$hue.red.400" },
        warning: { base: "$hue.orange.300", muted: "$hue.orange.400" },
        success: { base: "$hue.green.300", muted: "$hue.green.400" },
        info: { base: "$hue.blue.300", muted: "$hue.blue.400" },
      },
    },
    background: {
      base: "$hue.neutral.900",
      raised: { base: "$hue.neutral.800", high: "$hue.neutral.700", max: "$hue.neutral.600" },
      action: {
        primary: backgroundAction("interactive"),
        secondary: backgroundAction("accent"),
        destructive: backgroundAction("red"),
      },
      formfield: states("$hue.neutral.800", "$hue.neutral.700", "$hue.neutral.700", "$hue.neutral.800", "$hue.neutral.700", "$hue.neutral.800"),
      feedback: {
        error: { base: "$hue.red.900" },
        warning: { base: "$hue.orange.900" },
        success: { base: "$hue.green.900" },
        info: { base: "$hue.blue.900" },
      },
    },
    border: { base: "$hue.neutral.700" },
    scrollbar: { base: "$hue.neutral.600" },
    diff: {
      text: { added: "$hue.green.300", removed: "$hue.red.300", context: "$hue.neutral.400", hunkHeader: "$hue.blue.300" },
      background: { added: "$hue.green.900", removed: "$hue.red.900", context: "$hue.neutral.800" },
      highlight: { added: "$hue.green.700", removed: "$hue.red.700" },
      lineNumber: { text: "$hue.neutral.500", background: { added: "$hue.green.900", removed: "$hue.red.900" } },
    },
    syntax: {
      comment: "$hue.neutral.500",
      keyword: "$hue.purple.300",
      function: "$hue.blue.300",
      variable: "$hue.neutral.200",
      string: "$hue.green.300",
      number: "$hue.orange.300",
      type: "$hue.cyan.300",
      operator: "$hue.neutral.300",
      punctuation: "$hue.neutral.400",
    },
    markdown: {
      text: "$hue.neutral.200",
      heading: "$hue.accent.300",
      link: "$hue.blue.300",
      linkText: "$hue.blue.200",
      code: "$hue.purple.200",
      blockQuote: "$hue.neutral.400",
      emphasis: "$hue.yellow.300",
      strong: "$hue.neutral.100",
      horizontalRule: "$hue.neutral.600",
      listItem: "$hue.neutral.200",
      listEnumeration: "$hue.accent.300",
      image: "$hue.accent.300",
      imageText: "$hue.neutral.300",
      codeBlock: "$hue.neutral.100",
    },
  };
}

// Every required base leaf path, e.g. "text.action.primary.$hovered". Derived from the tree, never duplicated.
export function tokenPaths(tree = referenceBase(), prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(tree)) {
    if (key === "categorical") continue;
    const path = prefix ? prefix + "." + key : key;
    if (value && typeof value === "object" && !Array.isArray(value)) out.push(...tokenPaths(value, path));
    else out.push(path);
  }
  return out;
}

export const TOKEN_PATHS = tokenPaths();
export const SURFACE_PATHS = TOKEN_PATHS.filter((p) => p.startsWith("background."));

// opencode's schema marks interaction states and `text.feedback.*.muted` optional; everything else in
// `base` is required. 59 required leaves, 44 optional (verified against packages/theme/src/tui/schema.ts).
const OPTIONAL_RE = /\$(hovered|focused|pressed|selected|disabled)$/;
export const REQUIRED_TOKEN_PATHS = TOKEN_PATHS.filter((p) => !OPTIONAL_RE.test(p) && !/^text\.feedback\.[a-z]+\.muted$/.test(p));
export const OPTIONAL_TOKEN_PATHS = TOKEN_PATHS.filter((p) => !REQUIRED_TOKEN_PATHS.includes(p));

export function defaultDesign() {
  return {
    name: "glass",
    modes: ["light", "dark"],
    hues: {
      dark: {
        gray: "#8b95a7", red: "#e06c75", orange: "#d19a66", yellow: "#e5c07b", green: "#98c379",
        cyan: "#56b6c2", blue: "#61afef", purple: "#c678dd", accent: "#88c0d0", interactive: "#81a1c1", neutral: "#8b95a7",
      },
      light: {
        gray: "#4c566a", red: "#b91c1c", orange: "#c2410c", yellow: "#a16207", green: "#15803d",
        cyan: "#0e7490", blue: "#1d4ed8", purple: "#7e22ce", accent: "#0e7490", interactive: "#1d4ed8", neutral: "#4c566a",
      },
    },
    // Percent of see-through applied to every background.* token (0 = opaque). Terminal must be transparent too.
    transparency: { dark: 45, light: 20 },
    overrides: { dark: {}, light: {} },
  };
}

/* ---------------------------------- color ---------------------------------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}

export function rgbToHex(r, g, b, a = 1) {
  const byte = (v) => clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, "0");
  const base = "#" + byte(r) + byte(g) + byte(b);
  return a >= 1 ? base : base + byte(a);
}

export function isHex(value) {
  return HEX_RE.test(String(value));
}
export function isColorValue(value) {
  return typeof value === "string" && (HEX_RE.test(value) || value === "transparent" || REF_RE.test(value));
}
export function isHueColorValue(value) {
  return typeof value === "string" && (HEX_RE.test(value) || HUE_REF_RE.test(value));
}

// Alpha as a percent of see-through: 0 -> opaque, 100 -> "transparent".
export function applyTransparency(value, percent) {
  if (!percent) return value;
  if (percent >= 100) return "transparent";
  if (!isHex(value) || value.length === 5) return value;
  const rgb = hexToRgb(value);
  if (!rgb) return value;
  const alpha = clamp(1 - percent / 100, 0, 1);
  return rgbToHex(rgb.r / 255, rgb.g / 255, rgb.b / 255, alpha);
}

function rgbToOklch(r, g, b) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, c, h: h < 0 ? h + 360 : h };
}

function oklchToRgb({ L, c, h }) {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function fitOklch(color) {
  let c = Math.max(0, color.c);
  const L = clamp(color.L, 0, 1);
  for (let i = 0; i < 32; i++) {
    const rgb = oklchToRgb({ L, c, h: color.h });
    if (rgb.r >= 0 && rgb.r <= 1 && rgb.g >= 0 && rgb.g <= 1 && rgb.b >= 0 && rgb.b <= 1) return { L, c, h: color.h };
    c *= 0.94;
  }
  return { L, c: 0, h: color.h };
}

// Chroma/lightness tuning in OKLCH - used by the prompt interpreter ("neon", "pastel", "muted").
export function tuneColor(hex, { chroma = 1, lightness = 0 } = {}) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const src = rgbToOklch(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  const out = fitOklch({ L: clamp(src.L + lightness, 0, 1), c: Math.max(0, src.c * chroma), h: src.h });
  const tuned = oklchToRgb(out);
  return rgbToHex(clamp(tuned.r, 0, 1), clamp(tuned.g, 0, 1), clamp(tuned.b, 0, 1), rgb.a);
}

export function mixColors(a, b, t = 0.5) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a;
  return rgbToHex(A.r / 255 + (B.r / 255 - A.r / 255) * t, A.g / 255 + (B.g / 255 - A.g / 255) * t, A.b / 255 + (B.b / 255 - A.b / 255) * t);
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (0.2126 * srgbToLinear(rgb.r / 255) + 0.7152 * srgbToLinear(rgb.g / 255) + 0.0722 * srgbToLinear(rgb.b / 255));
}

export function chromaOf(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return rgbToOklch(rgb.r / 255, rgb.g / 255, rgb.b / 255).c;
}

// 9-step hue scale. Light: dark at 100 -> light at 900. Dark: light at 100 -> dark at 900 (opencode's direction).
export function hueScale(hex, mode = "dark") {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const src = rgbToOklch(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  const scale = {};
  HUE_STEPS.forEach((step, index) => {
    const t = index / (HUE_STEPS.length - 1);
    const L = mode === "light" ? 0.22 + t * 0.73 : 0.95 - t * 0.73;
    const out = fitOklch({ L, c: src.c, h: src.h });
    const r = oklchToRgb(out);
    scale[step] = rgbToHex(clamp(r.r, 0, 1), clamp(r.g, 0, 1), clamp(r.b, 0, 1));
  });
  return scale;
}

/* -------------------------------- resolution -------------------------------- */

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function resolveColor(value, doc, mode, depth = 0) {
  if (typeof value !== "string" || depth > 24) return value === "transparent" ? "transparent" : "#888888";
  if (value === "transparent" || isHex(value)) return value;
  if (!value.startsWith("$")) return "#888888";
  const path = value.slice(1);
  const modeDoc = doc[mode] || {};
  if (path.startsWith("hue.")) {
    const [, name, step] = path.split(".");
    const raw = modeDoc.hue?.[name];
    if (raw == null) return "#888888";
    const resolved = typeof raw === "string" ? raw : raw[step];
    return resolved == null ? "#888888" : resolveColor(resolved, doc, mode, depth + 1);
  }
  const own = getPath(modeDoc, path);
  if (own !== undefined) return resolveColor(own, doc, mode, depth + 1);
  const base = getPath(doc.base, path);
  if (base !== undefined) return resolveColor(base, doc, mode, depth + 1);
  return "#888888";
}

export function resolveTheme(doc, mode = "dark") {
  const out = {};
  for (const path of TOKEN_PATHS) {
    const value = getPath(doc[mode] || {}, path) ?? getPath(doc.base, path);
    out[path] = resolveColor(value, doc, mode);
  }
  return out;
}

export function resolveHues(doc, mode = "dark") {
  const out = {};
  const hue = (doc[mode] || {}).hue || {};
  for (const name of Object.keys(hue)) {
    const raw = hue[name];
    if (typeof raw === "string") out[name] = resolveHueRef(raw, hue, 500);
    else out[name] = { ...raw };
  }
  return out;
}

function resolveHueRef(ref, hue, step) {
  const [, name, s] = String(ref).split(".");
  const raw = hue[name];
  if (typeof raw === "string") return resolveHueRef(raw, hue, step);
  return raw?.[s] ?? raw?.[step] ?? "#888888";
}

/* ---------------------------------- builder ---------------------------------- */

export function buildTheme(design) {
  const d = design || defaultDesign();
  const base = JSON.parse(JSON.stringify(referenceBase()));
  const out = { $schema: "https://opencode.ai/theme.json", base };
  const modes = (d.modes && d.modes.length ? d.modes : ["dark"]).filter((m) => m === "light" || m === "dark");
  if (!modes.length) throw new Error("a theme needs at least one of light/dark");
  const hueRefTemplate = {};
  for (const mode of modes) {
    const hue = {};
    for (const [name, color] of Object.entries(d.hues?.[mode] || {})) {
      hue[name] = typeof color === "string" && color.startsWith("$") ? color : hueScale(color, mode) || hueScale("#888888", mode);
    }
    for (const name of SEMANTIC_HUES) {
      if (!hue[name]) hue[name] = hue.neutral || hue.gray || hueScale("#8b95a7", mode);
      hueRefTemplate[name] = true;
    }
    const modeDoc = { hue: JSON.parse(JSON.stringify(hue)) };
    const overrides = (d.overrides?.[mode]) || {};
    for (const [path, value] of Object.entries(overrides)) {
      if (!value) continue;
      setPath(modeDoc, path, value);
    }
    out[mode] = modeDoc;
  }
  if (d.transparency) {
    for (const mode of modes) {
      const percent = d.transparency[mode] || 0;
      if (!percent) continue;
      // Resolve the (possibly reference) surface colour, then bake the alpha in: alpha cannot ride on a "$ref".
      const snapshot = { ...out, ...{ [mode]: out[mode] } };
      for (const path of SURFACE_PATHS) {
        const current = getPath(out[mode], path) ?? getPath(out.base, path);
        const resolved = resolveColor(current, snapshot, mode);
        if (!resolved.startsWith("#")) continue;
        setPath(out[mode], path, applyTransparency(resolved, percent));
      }
    }
  }
  return out;
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

/* --------------------------------- validation --------------------------------- */

export function validateTheme(doc) {
  const errors = [];
  const warn = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, errors: ["theme document must be a JSON object"], warnings: [] };
  const push = (msg) => errors.push(msg);
  if (!doc.base || typeof doc.base !== "object") push("base: missing (required)");
  if (!doc.light && !doc.dark) push("needs at least one of light/dark");
  for (const key of Object.keys(doc)) {
    if (!["$schema", "base", "light", "dark"].includes(key)) warn.push(`unknown top-level key "${key}" (opencode ignores unknown keys)`);
  }
  if (doc.base && typeof doc.base === "object") {
    if (!Array.isArray(doc.base.categorical) || !doc.base.categorical.length || doc.base.categorical.some((h) => typeof h !== "string" || !h)) {
      push("base.categorical: expected a non-empty array of hue names");
    }
    for (const path of REQUIRED_TOKEN_PATHS) {
      const value = getPath(doc.base, path);
      if (value === undefined) push(`base.${path}: missing (every base token is required)`);
      else if (!isColorValue(value)) push(`base.${path}: "${value}" is not hex, "transparent" or a "$reference"`);
      else if (path.startsWith("syntax.") || path.startsWith("markdown.")) {
        if (!isHueColorValue(value)) push(`base.${path}: expected hex or a "$hue.<name>.<100-900>" reference`);
      }
    }
    for (const path of OPTIONAL_TOKEN_PATHS) {
      const value = getPath(doc.base, path);
      if (value === undefined) continue;
      if (!isColorValue(value)) push(`base.${path}: "${value}" is not hex, "transparent" or a "$reference"`);
    }
    validateUnknown(doc.base, referenceBase(), "base", warn);
    if (doc.base["@dialog"]) validateOverrides(doc.base["@dialog"], "@dialog", push);
  }
  for (const mode of ["light", "dark"]) {
    if (!doc[mode]) continue;
    const modeDoc = doc[mode];
    if (typeof modeDoc !== "object" || Array.isArray(modeDoc)) {
      push(`${mode}: expected an object`);
      continue;
    }
    const hue = modeDoc.hue;
    if (!hue || typeof hue !== "object" || Array.isArray(hue)) push(`${mode}.hue: missing (every mode needs a hue palette)`);
    else {
      for (const name of SEMANTIC_HUES) {
        if (hue[name] === undefined) push(`${mode}.hue.${name}: missing (required semantic hue)`);
      }
      for (const [name, value] of Object.entries(hue)) {
        if (typeof value === "string") {
          if (!/^\$hue\..+$/.test(value)) push(`${mode}.hue.${name}: a hue alias must look like "$hue.other"`);
          else if (!hue[value.split(".")[1]]) push(`${mode}.hue.${name}: alias "${value}" points at an undefined hue`);
        } else if (value && typeof value === "object") {
          for (const step of HUE_STEPS) {
            if (value[step] === undefined) push(`${mode}.hue.${name}.${step}: missing step`);
            else if (!isHex(value[step])) push(`${mode}.hue.${name}.${step}: "${value[step]}" is not a hex colour`);
          }
          for (const key of Object.keys(value)) {
            if (!HUE_STEPS.includes(Number(key))) push(`${mode}.hue.${name}.${key}: not a hue step (100-900)`);
          }
        } else push(`${mode}.hue.${name}: expected a 9-step scale or a "$hue.other" alias`);
      }
    }
    validateOverrides(modeDoc, mode, push);
  }
  return { ok: errors.length === 0, errors, warnings: warn };
}

function validateUnknown(obj, reference, prefix, warn, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return;
  for (const [key, value] of Object.entries(obj)) {
    const ref = reference?.[key];
    if (ref === undefined) warn.push(`${prefix}.${key}: unknown token (opencode rejects unknown tokens)`);
    else if (value && typeof value === "object" && !Array.isArray(value)) validateUnknown(value, ref, `${prefix}.${key}`, warn, depth + 1);
  }
}

function validateOverrides(modeDoc, label, push) {
  for (const [key, value] of Object.entries(modeDoc)) {
    if (key === "@dialog") {
      validateOverrides(value, `${label}["@dialog"]`, push);
      continue;
    }
    if (key === "hue" || key === "categorical") continue;
    const json = JSON.stringify(value);
    if (typeof value === "string") {
      if (!isColorValue(value)) push(`${label}.${key}: "${value}" is not hex, "transparent" or a "$reference"`);
    } else if (value && typeof value === "object") {
      walk(value, (path, leaf) => {
        if (!isColorValue(leaf)) push(`${label}.${key}.${path}: "${leaf}" is not hex, "transparent" or a "$reference"`);
      });
      if (json.length > 4000) push(`${label}.${key}: override is unreasonably large`);
    } else push(`${label}.${key}: expected a colour or an object of colours`);
  }
}

function walk(obj, visit, prefix = "") {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) walk(value, visit, path);
    else visit(path, value);
  }
}

/* --------------------------------- V1 import --------------------------------- */

const V1_MAP = {
  text: "text.base", textMuted: "text.muted", selectedListItemText: "text.base",
  background: "background.base", backgroundPanel: "background.raised.base",
  backgroundElement: "background.raised.high", backgroundMenu: "background.raised.max",
  border: "border.base", borderActive: "scrollbar.base", borderSubtle: "border.base",
  diffAdded: "diff.text.added", diffRemoved: "diff.text.removed", diffContext: "diff.text.context",
  diffHunkHeader: "diff.text.hunkHeader", diffHighlightAdded: "diff.highlight.added",
  diffHighlightRemoved: "diff.highlight.removed", diffAddedBg: "diff.background.added",
  diffRemovedBg: "diff.background.removed", diffContextBg: "diff.background.context",
  diffLineNumber: "diff.lineNumber.text", diffAddedLineNumberBg: "diff.lineNumber.background.added",
  diffRemovedLineNumberBg: "diff.lineNumber.background.removed",
  markdownText: "markdown.text", markdownHeading: "markdown.heading", markdownLink: "markdown.link",
  markdownLinkText: "markdown.linkText", markdownCode: "markdown.code", markdownBlockQuote: "markdown.blockQuote",
  markdownEmph: "markdown.emphasis", markdownStrong: "markdown.strong",
  markdownHorizontalRule: "markdown.horizontalRule", markdownListItem: "markdown.listItem",
  markdownListEnumeration: "markdown.listEnumeration", markdownImage: "markdown.image",
  markdownImageText: "markdown.imageText", markdownCodeBlock: "markdown.codeBlock",
  syntaxComment: "syntax.comment", syntaxKeyword: "syntax.keyword", syntaxFunction: "syntax.function",
  syntaxVariable: "syntax.variable", syntaxString: "syntax.string", syntaxNumber: "syntax.number",
  syntaxType: "syntax.type", syntaxOperator: "syntax.operator", syntaxPunctuation: "syntax.punctuation",
};

const V1_HUE_SOURCE = {
  accent: "primary", interactive: "secondary", neutral: "text",
  red: "error", orange: "warning", yellow: "accent", green: "success", cyan: "info", blue: "primary", purple: "accent",
};

function xterm256ToHex(index) {
  const base = [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ];
  if (index < 16) return base[index];
  if (index < 232) {
    const i = index - 16;
    const level = (v) => [0, 95, 135, 175, 215, 255][v];
    return rgbToHex(level(Math.floor(i / 36)) / 255, level(Math.floor((i % 36) / 6)) / 255, level(i % 6) / 255);
  }
  const gray = 8 + (index - 232) * 10;
  return rgbToHex(gray / 255, gray / 255, gray / 255);
}

function v1Value(raw, defs, byName, seen = new Set()) {
  if (raw == null) return null;
  if (typeof raw === "number") return xterm256ToHex(clamp(raw, 0, 255));
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value === "none" || value === "transparent") return "transparent";
  if (isHex(value)) return value;
  if (defs && defs[value] !== undefined) return v1Value(defs[value], defs, byName, seen);
  if (byName && byName[value] !== undefined && !seen.has(value)) {
    seen.add(value);
    return v1Value(byName[value], defs, byName, seen);
  }
  if (/^\d+$/.test(value)) return xterm256ToHex(clamp(Number(value), 0, 255));
  return null;
}

// Best-effort legacy import: opencode migrates V1 by classifying its palette; we map names 1:1 and keep the
// original colours as literal hex so nothing is invented.
export function importV1(json) {
  const source = json?.theme ?? json;
  const defs = json?.defs || {};
  const byName = {};
  for (const [key, value] of Object.entries(source || {})) if (value && typeof value !== "object") byName[key] = value;
  const modes = ["dark", "light"];
  const doc = { $schema: "https://opencode.ai/theme.json", base: JSON.parse(JSON.stringify(referenceBase())) };
  const hueSources = {};
  let anyOverride = false;
  for (const mode of modes) {
    const hue = {};
    const overrides = {};
    for (const [key, value] of Object.entries(source || {})) {
      const picked = value && typeof value === "object" && !Array.isArray(value) ? value[mode] : value;
      const hex = v1Value(picked, defs, byName);
      if (hex == null) continue;
      const target = V1_MAP[key];
      if (target) overrides[target] = hex;
      for (const [hueName, sourceKey] of Object.entries(V1_HUE_SOURCE)) {
        if (sourceKey === key) (hueSources[hueName] ||= {})[mode] = hex;
      }
      if (key === "primary") hueSources.accent ||= {}, hueSources.accent[mode] = hex;
    }
    if (!Object.keys(overrides).length) continue;
    anyOverride = true;
    for (const name of ALL_HUES) {
      const color = hueSources[name]?.[mode] || hueSources.neutral?.[mode] || "#8b95a7";
      hue[name] = hueScale(typeof color === "string" && color.startsWith("#") ? color : "#8b95a7", mode);
    }
    hue.accent = hue.accent || hue.interactive || hue.neutral;
    doc[mode] = { hue };
    for (const [path, value] of Object.entries(overrides)) setPath(doc[mode], path, value);
  }
  if (!anyOverride) throw new Error("no recognisable V1 tokens found in that file");
  const check = validateTheme(doc);
  return { theme: doc, mode: modes.filter((m) => doc[m]), validation: check };
}

/* ------------------------------ preview CSS/design ------------------------------ */

// Colour variables the preview (and the exported preview.css) uses. Keys are opencode token paths.
export const CSS_COLOR_TOKENS = [
  "background.base", "background.raised.base", "background.raised.high", "background.raised.max",
  "background.action.primary.base", "background.formfield.base", "border.base", "scrollbar.base",
  "text.base", "text.muted", "text.action.primary.base", "text.action.secondary.base", "text.action.destructive.base",
  "text.feedback.error.base", "text.feedback.warning.base", "text.feedback.success.base",
  "diff.text.added", "diff.text.removed", "diff.background.added", "diff.background.removed",
  "syntax.keyword", "syntax.string", "syntax.function", "syntax.comment", "syntax.variable",
  "markdown.heading", "markdown.link", "markdown.code", "markdown.strong",
];

export function designToCss(ui = {}, resolved = null) {
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const lines = [
    "/* generated by opencode-theme-manager - preview/desktop surface styling */",
    ":root {",
    `  --oc-font-mono: ${ui.monoFont ? `${ui.monoFont}, ` : ""}ui-monospace, SFMono-Regular, monospace;`,
    `  --oc-font-ui: ${ui.uiFont ? `${ui.uiFont}, ` : ""}system-ui, -apple-system, Segoe UI, sans-serif;`,
    `  --oc-font-size: ${num(ui.fontSize, 13)}px;`,
    `  --oc-line-height: ${num(ui.lineHeight, 1.45)};`,
    `  --oc-radius: ${num(ui.radius, 10)}px;`,
    `  --oc-pad: ${num(ui.pad, 12)}px;`,
    `  --oc-btn: ${num(ui.buttonSize, 30)}px;`,
    `  --oc-btn-align: ${ui.buttonAlign || "right"};`,
    `  --oc-sidebar: ${num(ui.sidebarWidth, 240)}px;`,
    `  --oc-header: ${num(ui.headerHeight, 34)}px;`,
    `  --oc-status: ${num(ui.statusHeight, 24)}px;`,
    `  --oc-blur: ${num(ui.blur, 18)}px;`,
  ];
  if (resolved) {
    for (const token of CSS_COLOR_TOKENS) {
      if (resolved[token]) lines.push(`  --oc-${token.replace(/\./g, "-")}: ${resolved[token]};`);
    }
  }
  lines.push("}", ui.customCss || "");
  return lines.join("\n");
}

// The web/desktop client restores injected CSS from localStorage (packages/app/public/oc-theme-preload.js
// reads opencode-theme-css-dark / -light). This snippet is what a user pastes into that client's console.
export const WEB_CSS_KEYS = { dark: "opencode-theme-css-dark", light: "opencode-theme-css-light" };

// The desktop GUI (@opencode-aidesktop) is a Chromium shell around the same web app. It ships its own
// bundled themes and applies CSS variables named --v2-<group>-<name>; this maps a resolved opencode
// theme onto those names. Browser-safe on purpose: the UI and the CLI both call it.
export const DESKTOP_THEME_ID_KEY = "opencode-theme-id";

export function desktopClientCss(resolved, ui = {}) {
  const pick = (token, fallback) => resolved?.[token] || fallback;
  const opaque = (value) => (/^#[0-9a-f]{6}[0-9a-f]{2}$/i.test(value) ? value.slice(0, 7) : value);
  const mono = ui.monoFont ? `"${ui.monoFont}", ui-monospace, monospace` : null;
  const radius = Number.isFinite(Number(ui.radius)) ? Number(ui.radius) : 8;
  const blur = Number.isFinite(Number(ui.blur)) ? Number(ui.blur) : 18;
  // A window backdrop (DWM mica / acrylic, or the accent-blur fallback on Win11 21H2 and Win10) blurs
  // the desktop *behind* the window. Then the window layer must be transparent so it shows through,
  // and the in-page backdrop-filter is redundant - dropping it is what keeps this cheap.
  const backdrop = ui.backdrop && ui.backdrop !== "none" ? String(ui.backdrop) : null;
  // Painted wallpaper: the app's window is opaque (no transparent:true, no Mica material), so the only
  // way to see the desktop behind the panels is to paint the wallpaper into the page. 184 KB at 1600px.
  const wallpaper = typeof ui.wallpaper === "string" && ui.wallpaper.startsWith("data:image/") ? ui.wallpaper : null;
  // Names verified live against the running app (oc://renderer/index.html): --background-base,
  // --surface-*, --text-*, --icon-*, --border-*, --success/info/warning/error-*, --border-radius.
  const text = pick("text.base", "#e6ecf7");
  const muted = pick("text.muted", "#9aa6bd");
  // Without a backdrop the window is opaque: the app syncs --background-base into setBackgroundColor
  // and its window has no transparent/Mica flag, so alpha there is ignored (it looks unchanged).
  const windowBase = backdrop ? "transparent" : opaque(pick("background.base", "#101623"));
  const raised = pick("background.raised.base", "#171d29");
  const high = pick("background.raised.high", "#1d2534");
  const max = pick("background.raised.max", "#232c3e");
  const border = pick("border.base", "#ffffff26");
  const strong = pick("scrollbar.base", "#ffffff40");
  const accent = pick("text.action.primary.base", "#7aa2f7");
  const lines = [
    "/* opencode-theme-manager -> desktop client. Names verified against the live app's stylesheet.",
    backdrop
      ? `   Window backdrop: ${backdrop} - the window layer is transparent so the OS blur shows through,`
      : "   The app syncs its window fill from --background-base, so that one must stay opaque:",
    backdrop
      ? "   and no in-page backdrop-filter is emitted (the OS already blurs; see the perf note in README). */"
      : "   its window is created without transparent:true and without Mica/acrylic, so alpha is ignored. */",
    ":root, html[data-theme] {",
    `  --background-base: ${windowBase} !important;`,
    `  --background-weak: ${raised} !important;`,
    `  --background-strong: ${high} !important;`,
    `  --background-stronger: ${max} !important;`,
    `  --surface-base: ${raised} !important;`,
    `  --surface-base-hover: ${high} !important;`,
    `  --surface-raised-base: ${raised} !important;`,
    `  --surface-raised-base-hover: ${high} !important;`,
    `  --surface-raised-strong: ${high} !important;`,
    `  --surface-raised-stronger: ${max} !important;`,
    `  --surface-float-base: ${max} !important;`,
    `  --surface-weak: ${raised} !important;`,
    `  --surface-strong: ${max} !important;`,
    `  --surface-brand-base: ${accent} !important;`,
    `  --text-base: ${text} !important;`,
    `  --text-strong: ${text} !important;`,
    `  --text-weak: ${muted} !important;`,
    `  --text-weaker: ${muted} !important;`,
    `  --text-interactive-base: ${accent} !important;`,
    `  --icon-base: ${text} !important;`,
    `  --icon-weak-base: ${muted} !important;`,
    `  --border-base: ${border} !important;`,
    `  --border-weak-base: ${border} !important;`,
    `  --border-strong-base: ${strong} !important;`,
    `  --border-focus: ${accent} !important;`,
    `  --success-bg: ${pick("background.feedback.success.base", "#12271a")} !important;`,
    `  --success-text: ${pick("text.feedback.success.base", "#9ae6b4")} !important;`,
    `  --warning-bg: ${pick("background.feedback.warning.base", "#2b2313")} !important;`,
    `  --warning-text: ${pick("text.feedback.warning.base", "#f5c542")} !important;`,
    `  --error-bg: ${pick("background.feedback.error.base", "#2c1618")} !important;`,
    `  --error-text: ${pick("text.feedback.error.base", "#ff8080")} !important;`,
    `  --info-bg: ${pick("background.feedback.info.base", "#141d2e")} !important;`,
    `  --info-text: ${pick("text.feedback.info.base", "#7aa2f7")} !important;`,
    `  --normal-bg: ${raised} !important;`,
    `  --normal-border: ${border} !important;`,
    `  --normal-text: ${text} !important;`,
    // The app also exposes a v2 semantic layer; keep both sets in sync so nothing looks half-themed.
    `  --v2-text-text-base: ${text} !important;`,
    `  --v2-text-text-muted: ${muted} !important;`,
    `  --v2-icon-icon-base: ${text} !important;`,
    `  --v2-icon-icon-muted: ${muted} !important;`,
    `  --v2-border-border-base: ${border} !important;`,
    `  --v2-border-border-strong: ${strong} !important;`,
    `  --border-radius: ${radius}px !important;`,
    mono ? `  --v2-font-family-code: ${mono} !important;` : `  --v2-font-family-code: var(--v2-font-family-code);`,
    mono ? `  --font-family-code: ${mono} !important;` : `  --font-family-code: var(--font-family-code);`,
    mono ? `  --font-family-text: ${mono} !important;` : `  --font-family-text: var(--font-family-text);`,
    "}",
    "",
  ];
  if (wallpaper) {
    lines.push("/* your desktop wallpaper, painted into the page: the app's own window is opaque. */");
    lines.push('html::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;');
    lines.push(`  background-image: url("${wallpaper}"); background-size: cover; background-position: center; }`);
  }
  if (backdrop) {
    lines.push("/* the OS already blurs the desktop behind the window, so no in-page blur (repaints stay cheap) */");
    lines.push("html, body { background-color: transparent !important; }");
  } else {
    lines.push("/* glass: translucent surfaces over the window fill. Blur only on real containers, never on");
    lines.push("   every [data-component] - that was the expensive part on a busy screen. */");
    lines.push("html, body { background-color: transparent !important; }");
    lines.push('[data-slot="card"], .card, [data-component="dialog"], [data-component="menu"] {');
    lines.push(`  backdrop-filter: blur(${blur}px) saturate(1.1) !important;`);
    lines.push("}");
  }
  if (ui.customCss) lines.push("", ui.customCss);
  return lines.join("\n");
}

export function webCssSnippet(css, mode = "dark") {
  const escaped = String(css).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return [
    "(function () {",
    "  var css = `" + escaped + "`;",
    `  localStorage.setItem(${JSON.stringify(WEB_CSS_KEYS.dark)}, css);`,
    `  localStorage.setItem(${JSON.stringify(WEB_CSS_KEYS.light)}, css);`,
    '  console.log("opencode theme css stored - reloading");',
    "  location.reload();",
    "})();",
  ].join("\n");
}
