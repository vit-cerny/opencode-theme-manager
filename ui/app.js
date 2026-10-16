// OpenCode Theme Manager - UI logic. Reuses the same model as the server (lib/*.mjs), so the
// browser and the tests can never disagree about what a theme means.
import {
  ALL_HUES, HUE_STEPS, TOKEN_PATHS, buildTheme, designToCss, defaultDesign,
  hexToRgb, hueScale, resolveHues, resolveTheme, rgbToHex, tuneColor, validateTheme, webCssSnippet, desktopClientCss,
} from "/lib/schema.mjs";
import { interpretPrompt, paletteToDesign } from "/lib/designer.mjs";

const $ = (id) => document.getElementById(id);
const FONTS = ["JetBrains Mono", "Cascadia Code", "Cascadia Mono", "Fira Code", "Consolas", "Hack", "IBM Plex Mono", "MesloLGS NF", "Source Code Pro", "Comic Mono", "Menlo", "Monaco"];

const state = {
  design: null,
  ui: { monoFont: "", fontSize: 13, lineHeight: 1.45, radius: 10, pad: 12, buttonSize: 30, buttonAlign: "right", sidebarWidth: 240, headerHeight: 34, statusHeight: 24, blur: 18, customCss: "" },
  layout: {},
  theme: null,
  resolved: { dark: {}, light: {} },
  hues: { dark: {}, light: {} },
  validation: { ok: false, errors: [], warnings: [] },
  mode: "dark",
  view: "tui",
  name: "glass",
  imageColors: null,
  server: null,
};

/* --------------------------------- plumbing --------------------------------- */

async function api(path, body) {
  const options = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {};
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({ error: `bad response (${response.status})` }));
  if (!response.ok && !payload.validation) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

function colorDistance(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return 999;
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

/* ---------------------------------- preview ---------------------------------- */

function applyPreview() {
  const colors = state.resolved[state.mode] || {};
  const ui = state.ui;
  const tui = $("tui");
  const map = {
    "--oc-bg": colors["background.base"],
    "--oc-raised": colors["background.raised.base"],
    "--oc-raised-high": colors["background.raised.high"],
    "--oc-raised-max": colors["background.raised.max"],
    "--oc-text": colors["text.base"],
    "--oc-muted": colors["text.muted"],
    "--oc-border": colors["border.base"],
    "--oc-scrollbar": colors["scrollbar.base"],
    "--oc-accent": colors["text.action.primary.base"],
    "--oc-accent-bg": colors["background.action.primary.base"],
    "--oc-secondary": colors["text.action.secondary.base"],
    "--oc-destructive": colors["text.action.destructive.base"],
    "--oc-added": colors["diff.text.added"],
    "--oc-added-bg": colors["diff.background.added"],
    "--oc-removed": colors["diff.text.removed"],
    "--oc-removed-bg": colors["diff.background.removed"],
    "--oc-syntax-keyword": colors["syntax.keyword"],
    "--oc-syntax-string": colors["syntax.string"],
    "--oc-syntax-function": colors["syntax.function"],
    "--oc-syntax-comment": colors["syntax.comment"],
    "--oc-markdown-heading": colors["markdown.heading"],
    "--oc-input-bg": colors["background.formfield.base"],
    "--oc-feedback-error": colors["text.feedback.error.base"],
  };
  for (const [key, value] of Object.entries(map)) if (value) tui.style.setProperty(key, value);

  const vars = {
    "--oc-font-mono": `${ui.monoFont || "ui-monospace"}, ui-monospace, monospace`,
    "--oc-font-size": `${ui.fontSize}px`,
    "--oc-line-height": String(ui.lineHeight),
    "--oc-radius": `${ui.radius}px`,
    "--oc-pad": `${ui.pad}px`,
    "--oc-btn": `${ui.buttonSize}px`,
    "--oc-btn-align": ui.buttonAlign,
    "--oc-sidebar": `${ui.sidebarWidth}px`,
    "--oc-header": `${ui.headerHeight}px`,
    "--oc-status": `${ui.statusHeight}px`,
    "--oc-blur": `${ui.blur}px`,
    "--oc-chrome": state.view === "desktop" ? "1" : "0",
  };
  for (const [key, value] of Object.entries(vars)) tui.style.setProperty(key, value);
  tui.classList.toggle("desktop", state.view === "desktop");
  $("tuiTabs").style.display = state.layout["tabs.mode"] === "off" ? "none" : "";
  $("tuiSidebar").style.display = state.layout["session.sidebar"] === "hide" ? "none" : "";

  $("swBg").style.background = colors["background.base"];
  $("swPanel").style.background = colors["background.raised.base"];
  $("swAccent").style.background = colors["text.action.primary.base"];
  $("swText").style.background = colors["text.base"];
  $("swBorder").style.background = colors["border.base"];
  $("legendInfo").textContent = `${Object.values(colors).filter((v) => /^#[0-9a-f]{8}$/i.test(v)).length} translucent tokens`;
}

function applyUserCss() {
  let el = $("userCss");
  if (!el) {
    el = document.createElement("style");
    el.id = "userCss";
    document.head.appendChild(el);
  }
  el.textContent = designToCss({ ...state.ui, customCss: state.ui.customCss });
}

/* ---------------------------------- panels ---------------------------------- */

function renderHues() {
  const host = $("hues");
  host.innerHTML = "";
  for (const mode of ["dark", "light"]) {
    const group = document.createElement("div");
    group.className = "hue-group";
    group.innerHTML = `<div class="hue-title">${mode}</div>`;
    const grid = document.createElement("div");
    grid.className = "hue-grid";
    for (const hue of ALL_HUES) {
      const source = state.design.hues[mode]?.[hue] || "#888888";
      const scale = hueScale(source, mode) || {};
      const cell = document.createElement("label");
      cell.className = "hue-cell";
      cell.title = `${mode}.${hue} = ${source}`;
      cell.innerHTML = `<span class="hue-name">${hue}</span>`;
      const input = document.createElement("input");
      input.type = "color";
      input.value = /^#[0-9a-f]{6}$/i.test(source) ? source : "#888888";
      input.addEventListener("input", () => {
        state.design.hues[mode] = { ...state.design.hues[mode], [hue]: input.value };
        state.design.overrides[mode] = {};
        rebuild();
        renderHues();
      });
      cell.appendChild(input);
      const strip = document.createElement("span");
      strip.className = "strip";
      for (const step of HUE_STEPS) {
        const chip = document.createElement("i");
        chip.style.background = scale[step];
        chip.title = `${step}: ${scale[step]}`;
        strip.appendChild(chip);
      }
      cell.appendChild(strip);
      grid.appendChild(cell);
    }
    group.appendChild(grid);
    host.appendChild(group);
  }
}

function currentValue(path) {
  const override = state.design.overrides[state.mode]?.[path];
  if (override !== undefined) return override;
  const modeValue = state.theme?.[state.mode] ? getPath(state.theme[state.mode], path) : undefined;
  if (modeValue !== undefined && typeof modeValue === "string") return modeValue;
  return getPath(state.theme?.base, path) ?? "";
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function renderTokens() {
  const host = $("tokens");
  const filter = $("tokenFilter").value.trim().toLowerCase();
  const onlyOverrides = $("tokenOnlyOverrides").checked;
  host.innerHTML = "";
  for (const path of TOKEN_PATHS) {
    const value = currentValue(path);
    const isOverride = state.design.overrides[state.mode]?.[path] !== undefined;
    if (filter && !path.toLowerCase().includes(filter) && !String(value).toLowerCase().includes(filter)) continue;
    if (onlyOverrides && !isOverride) continue;
    const row = document.createElement("div");
    row.className = "token-row" + (isOverride ? " override" : "");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = state.resolved[state.mode]?.[path] || "#888";
    const label = document.createElement("span");
    label.className = "token-path";
    label.textContent = path;
    label.title = path;
    const input = document.createElement("input");
    input.value = value;
    input.spellcheck = false;
    input.addEventListener("change", () => {
      const overrides = { ...(state.design.overrides[state.mode] || {}) };
      if (!input.value.trim()) delete overrides[path];
      else overrides[path] = input.value.trim();
      state.design.overrides[state.mode] = overrides;
      rebuild();
    });
    const reset = document.createElement("button");
    reset.className = "mini";
    reset.textContent = "reset";
    reset.disabled = !isOverride;
    reset.addEventListener("click", () => {
      const overrides = { ...(state.design.overrides[state.mode] || {}) };
      delete overrides[path];
      state.design.overrides[state.mode] = overrides;
      rebuild();
    });
    row.append(swatch, label, input, reset);
    host.appendChild(row);
  }
}

function renderValidation() {
  const v = state.validation;
  const parts = [];
  if (v.ok) parts.push("valid V2 theme");
  else parts.push(`${v.errors.length} error(s)`);
  if (v.warnings?.length) parts.push(`${v.warnings.length} warning(s)`);
  $("validation").innerHTML = `${parts.join(" · ")}<br>${[...(v.errors || []), ...(v.warnings || [])].slice(0, 6).map((e) => `<code>${e}</code>`).join("<br>")}`;
  $("validation").className = `hint ${v.ok ? "ok" : "bad"}`;
}

function renderServerInfo() {
  const s = state.server;
  if (!s) return;
  $("paths").innerHTML = `config <code>${s.configDir}</code> · ${s.themes.length} theme(s) · ${s.tokenCount} tokens · v2.0.29 target`;
  const saved = $("savedThemes");
  saved.innerHTML = "";
  for (const theme of s.themes) {
    const option = document.createElement("option");
    option.value = theme.name;
    option.textContent = `${theme.name} (${theme.format})`;
    saved.appendChild(option);
  }
  const preset = $("preset");
  preset.innerHTML = '<option value="">(none)</option>';
  for (const name of s.presets) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    preset.appendChild(option);
  }
  const fontList = $("fontList");
  fontList.innerHTML = "";
  for (const font of FONTS) {
    const option = document.createElement("option");
    option.value = font;
    fontList.appendChild(option);
  }
  const wt = $("wtProfile");
  wt.innerHTML = "";
  const terminal = s.terminal || {};
  if (!terminal.path) {
    wt.innerHTML = '<option value="">Windows Terminal not detected</option>';
    $("terminalInfo").textContent = `Terminal settings not found. Candidates: ${(terminal.candidates || []).join(", ")}`;
  } else {
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "defaults (all profiles)";
    wt.appendChild(def);
    for (const profile of terminal.profiles) {
      const option = document.createElement("option");
      option.value = profile.guid;
      option.textContent = `${profile.name} · ${profile.font?.face || "default font"} ${profile.font?.size || ""} · ${profile.opacity}%`;
      wt.appendChild(option);
    }
    $("terminalInfo").textContent = `${terminal.path}`;
  }
}

/* ---------------------------------- rebuild ---------------------------------- */

function rebuild() {
  state.theme = buildTheme(state.design);
  state.validation = validateTheme(state.theme);
  state.resolved = { dark: resolveTheme(state.theme, "dark"), light: resolveTheme(state.theme, "light") };
  state.hues = { dark: resolveHues(state.theme, "dark"), light: resolveHues(state.theme, "light") };
  applyPreview();
  applyUserCss();
  renderTokens();
  renderValidation();
}

function applyBundle(bundle) {
  if (bundle.design) state.design = bundle.design;
  if (bundle.ui) state.ui = { ...state.ui, ...bundle.ui };
  if (bundle.layout) {
    state.layout = { ...state.layout, ...bundle.layout };
    syncLayoutControls();
  }
  if (bundle.matched) {
    $("matched").innerHTML = bundle.matched.length
      ? "understood: " + bundle.matched.map((m) => `<code>${m}</code>`).join(" ") + (bundle.notes?.length ? `<br>${bundle.notes.join(" ")}` : "")
      : "no style words understood - falling back to the current palette";
  }
  syncTypeControls();
  rebuild();
  renderHues();
}

function syncTypeControls() {
  $("monoFont").value = state.ui.monoFont || "";
  $("fontSize").value = state.ui.fontSize;
  $("lineHeight").value = state.ui.lineHeight;
  $("radius").value = state.ui.radius;
  $("pad").value = state.ui.pad;
  $("buttonSize").value = state.ui.buttonSize;
  $("buttonAlign").value = state.ui.buttonAlign;
  $("sidebarWidth").value = state.ui.sidebarWidth;
  $("headerHeight").value = state.ui.headerHeight;
  $("statusHeight").value = state.ui.statusHeight;
  $("blur").value = state.ui.blur;
  $("blurOut").textContent = `${state.ui.blur}px`;
  $("customCss").value = state.ui.customCss || "";
}

function syncLayoutControls() {
  for (const control of document.querySelectorAll("[data-cli]")) {
    const key = control.dataset.cli;
    const value = getPath(state.layout, key);
    if (value === undefined) continue;
    if (control.type === "checkbox") control.checked = value === true || value === control.dataset.on;
    else control.value = String(value);
  }
}

function collectLayout() {
  const patch = {};
  for (const control of document.querySelectorAll("[data-cli]")) {
    const key = control.dataset.cli;
    let value;
    if (control.type === "checkbox") value = control.checked ? (control.dataset.on || true) : (control.dataset.off || false);
    else if (control.value === "true") value = true;
    else if (control.value === "false") value = false;
    else value = control.value;
    const keys = key.split(".");
    let cursor = patch;
    for (const part of keys.slice(0, -1)) cursor = cursor[part] ||= {};
    cursor[keys[keys.length - 1]] = value;
    state.layout[key] = value;
  }
  return patch;
}

/* ----------------------------------- image ----------------------------------- */

async function extractPalette(file) {
  const bitmap = await createImageBitmap(file);
  const width = 96;
  const height = Math.max(1, Math.round((96 * bitmap.height) / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const bucket = buckets.get(key) || [0, 0, 0, 0];
    bucket[0] += data[i];
    bucket[1] += data[i + 1];
    bucket[2] += data[i + 2];
    bucket[3] += 1;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b[3] - a[3]).slice(0, 40)
    .map(([r, g, b, n]) => rgbToHex(r / n / 255, g / n / 255, b / n / 255));
  const out = [];
  for (const color of ranked) {
    if (out.every((existing) => colorDistance(existing, color) > 34)) out.push(color);
    if (out.length === 8) break;
  }
  return out;
}

function renderImageSwatches(colors) {
  const host = $("imageSwatches");
  host.innerHTML = "";
  for (const color of colors || []) {
    const chip = document.createElement("button");
    chip.className = "chip-swatch";
    chip.style.background = color;
    chip.title = `${color} - click to use as the accent`;
    chip.addEventListener("click", () => {
      state.design.hues[state.mode] = { ...state.design.hues[state.mode], accent: color, interactive: tuneColor(color, { chroma: 0.8 }) };
      state.design.overrides[state.mode] = {};
      rebuild();
      renderHues();
      setStatus(`accent set to ${color}`);
    });
    host.appendChild(chip);
  }
}

/* ---------------------------------- actions ---------------------------------- */

async function generate() {
  const prompt = $("prompt").value;
  const preset = $("preset").value || null;
  const mode = $("mode").value;
  const transparency = Number($("transparency").value);
  setStatus("generating...");
  const body = { prompt, preset, mode, transparency, imageColors: state.imageColors };
  const result = await api("/api/design", body);
  state.imageColors = null;
  applyBundle(result);
  $("darkTrans").value = state.design.transparency.dark;
  $("lightTrans").value = state.design.transparency.light;
  $("darkTransOut").textContent = `${state.design.transparency.dark}%`;
  $("lightTransOut").textContent = `${state.design.transparency.light}%`;
  setStatus(`generated ${state.validation.ok ? "a valid theme" : "with validation errors"}`, state.validation.ok ? "ok" : "bad");
}

async function useImage(file) {
  if (!file) return;
  setStatus("reading image...");
  const colors = await extractPalette(file);
  state.imageColors = colors;
  renderImageSwatches(colors);
  $("imageInfo").textContent = `${file.name} · ${colors.length} colours extracted: ${colors.join(" ")}`;
  const bundle = paletteToDesign(colors, { mode: $("mode").value, transparency: Number($("transparency").value) });
  applyBundle({ ...bundle, design: bundle.design });
  $("matched").innerHTML = "palette: " + colors.map((c) => `<code>${c}</code>`).join(" ");
  setStatus("palette extracted - tune it on the right, or edit the swatches");
}

const handler = {
  async save() {
    const name = $("themeName").value.trim() || "glass";
    const result = await api("/api/save", { name, theme: state.theme });
    if (result.ok === false) {
      renderValidation();
      setStatus(`not saved: ${result.validation.errors.slice(0, 2).join("; ")}`, "bad");
      return;
    }
    setStatus(`saved ${result.path}${result.backup ? ` (backup ${result.backup})` : ""}`, "ok");
    await refreshState();
  },
  async apply() {
    const name = $("themeName").value.trim() || "glass";
    const saved = await api("/api/save", { name, theme: state.theme });
    if (saved.ok === false) return setStatus("not applied: theme invalid", "bad");
    const layout = collectLayout();
    const result = await api("/api/apply", { name, mode: $("mode").value, layout });
    setStatus(`applied ${name} (${$("mode").value}) to ${result.path}${result.backup ? `, backup ${result.backup}` : ""}. Restart opencode.`, "ok");
    await refreshState();
  },
  async terminal() {
    const guid = $("wtProfile").value || undefined;
    const result = await api("/api/terminal", { guid, opacity: Number($("wtOpacity").value), useAcrylic: $("wtAcrylic").checked });
    if (result.ok === false) return setStatus(result.error, "bad");
    setStatus(`terminal transparency written to ${result.path} (backup ${result.backup})`, "ok");
  },
  async terminalFont() {
    const guid = $("wtProfile").value || undefined;
    const result = await api("/api/terminal", { guid, font: { face: $("monoFont").value, size: Number($("fontSize").value), weight: "normal" } });
    if (result.ok === false) return setStatus(result.error, "bad");
    setStatus(`terminal font written to ${result.path} (backup ${result.backup})`, "ok");
  },
  async layout() {
    const patch = collectLayout();
    const result = await api("/api/cli", { patch });
    setStatus(`cli.json updated: ${result.applied.join(", ")} (backup ${result.backup})`, "ok");
  },
  async export() {
    const name = $("themeName").value.trim() || "glass";
    const result = await api("/api/export", { name, theme: state.theme, write: $("btnExport").dataset.write || "" });
    if (result.json) {
      const blob = new Blob([result.json], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus(`exported ${result.filename}`);
    } else setStatus(`written ${result.path}`, "ok");
  },
  async import(file) {
    if (!file) return;
    const text = await file.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return setStatus(`not JSON: ${error.message}`, "bad");
    }
    if (json.base) {
      state.design = designFromThemeDoc(json);
      state.name = file.name.replace(/\.json$/, "");
      $("themeName").value = state.name;
      $("darkTrans").value = state.design.transparency.dark;
      $("lightTrans").value = state.design.transparency.light;
      rebuild();
      renderHues();
      setStatus(`loaded V2 theme from ${file.name}`);
      return;
    }
    const result = await api("/api/import", { json, source: "v1" });
    state.design = designFromThemeDoc(result.theme);
    $("themeName").value = file.name.replace(/\.json$/, "");
    rebuild();
    renderHues();
    setStatus(`imported legacy V1 theme: ${result.validation.ok ? "valid" : "needs fixes"} (${(result.validation.errors || []).length} errors)`);
  },
  async loadSaved(name) {
    const result = await api(`/api/theme?name=${encodeURIComponent(name)}`);
    if (!result.theme) return setStatus(`theme ${name} not readable`, "bad");
    if (!result.theme.base) {
      const converted = await api("/api/import", { json: result.theme, source: "v1" });
      state.design = designFromThemeDoc(converted.theme);
      setStatus(`loaded legacy ${name} (converted to V2)`);
    } else {
      state.design = designFromThemeDoc(result.theme);
      setStatus(`loaded ${name}`);
    }
    $("themeName").value = name;
    rebuild();
    renderHues();
  },
  cssExport() {
    const css = designToCss({ ...state.ui, customCss: state.ui.customCss });
    const blob = new Blob([css], { type: "text/css" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "preview.css";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("exported preview.css");
  },
  async desktopCss() {
    const css = designToCss({ ...state.ui, customCss: state.ui.customCss }, state.resolved[state.mode]);
    const result = await api("/api/desktop/css", { css });
    if (result.ok === false) return setStatus(result.error, "bad");
    setStatus(`desktop CSS written to ${result.path} (backup ${result.backup}). ${result.note}`);
  },
  async desktopInfo() {
    const info = await api("/api/desktop");
    state.desktop = info;
    const app = info.app;
    const debug = info.debug || {};
    const probeList = debug.probes || debug.targets || [];
    const target = debug.port
      ? `${debug.port} -> ${probeList.map((entry) => `${entry.url}${entry.isApp ? " (app)" : ""}`).join(", ") || "no pages"}`
      : "closed (needs a restart with theming)";
    $("desktopInfo").innerHTML = app.installed
      ? `app: <code>${app.exe}</code><br>profile: <code>${app.profile}</code><br>bundled themes: ${info.themeIds.length} · devtools port: ${target}${debug.current?.theme ? ` · current GUI theme: <code>${debug.current.theme}</code>` : ""}`
      : `no opencode desktop app found on this machine (looked in ${app.root || "%LOCALAPPDATA%\\Programs"})`;
    const select = $("desktopThemeId");
    if (select.options.length !== info.themeIds.length) {
      select.innerHTML = "";
      for (const id of info.themeIds) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        select.appendChild(option);
      }
      if (info.themeIds.includes("nord")) select.value = "nord";
    }
  },
  async desktopApplyTheme() {
    const result = await api("/api/desktop/apply", { themeId: $("desktopThemeId").value, reload: true, port: state.desktop?.debug?.port || undefined });
    if (result.ok === false) return setStatus(`desktop: ${result.error}. ${result.hint || ""}`, "bad");
    setStatus(`GUI theme set to ${$("desktopThemeId").value} on ${result.target.url}`, "ok");
    await handler.desktopInfo();
  },
  async desktopGlass() {
    const css = desktopClientCss(state.resolved[state.mode], { ...state.ui, customCss: state.ui.customCss });
    const light = desktopClientCss(state.resolved.light, { ...state.ui, customCss: state.ui.customCss });
    const result = await api("/api/desktop/apply", { css, light, themeId: $("desktopThemeId").value || null, port: state.desktop?.debug?.port || undefined });
    if (result.ok === false) {
      $("desktopResult").innerHTML = `<b>could not reach the desktop app</b><br>${result.error}<br><code>${result.hint}</code>`;
      return setStatus("desktop: needs a one-time restart with theming", "bad");
    }
    $("desktopResult").innerHTML = `injected ${css.length} bytes into <code>${result.target.url}</code> · applied live: ${result.result.appliedNow} bytes · stored keys: ${Object.keys(result.result).filter((k) => k !== "origin" && k !== "appliedNow").join(", ")}`;
    setStatus("desktop CSS applied live - no restart, no reload", "ok");
  },
  async desktopRestart() {
    const result = await api("/api/desktop/restart", { port: state.desktop?.debug?.port || undefined });
    if (result.ok === false) return setStatus(result.error, "bad");
    setStatus("restarting the desktop app with DevTools enabled - wait ~5s, then Apply glass CSS again", "ok");
    setTimeout(() => handler.desktopInfo().catch(() => {}), 6000);
  },
  async desktopClear() {
    const result = await api("/api/desktop/clear", { port: state.desktop?.debug?.port || undefined });
    if (result.ok === false) return setStatus(`desktop: ${result.error}`, "bad");
    setStatus("desktop override cleared - the app is back to its own theme settings", "ok");
    await handler.desktopInfo();
  },
  async copySnippet() {
    const css = designToCss({ ...state.ui, customCss: state.ui.customCss }, state.resolved[state.mode]);
    const snippet = webCssSnippet(css);
    try {
      await navigator.clipboard.writeText(snippet);
      setStatus("web/desktop snippet copied - paste it in the opencode web/desktop client console once", "ok");
    } catch {
      setStatus("clipboard blocked; snippet printed in the CSS box");
      $("customCss").value = snippet;
      state.ui.customCss = snippet;
    }
  },
};

// Rebuild a design out of any V2 document so imported/saved themes stay editable.
function designFromThemeDoc(doc) {
  const design = defaultDesign();
  design.modes = ["light", "dark"].filter((mode) => doc[mode]);
  if (!design.modes.length) design.modes = ["dark"];
  design.overrides = { dark: {}, light: {} };
  let translucent = 0;
  for (const mode of design.modes) {
    for (const hue of ALL_HUES) {
      const raw = doc[mode]?.hue?.[hue];
      if (typeof raw === "string") continue;
      const middle = raw?.["500"] || raw?.["400"] || Object.values(raw || {})[0];
      if (middle) design.hues[mode][hue] = middle;
    }
    for (const path of TOKEN_PATHS) {
      const value = getPath(doc[mode], path);
      if (typeof value !== "string" || value.startsWith("$")) continue;
      const base = getPath(doc.base, path);
      if (value !== base) {
        design.overrides[mode][path] = value;
        if (path.startsWith("background.") && /^#[0-9a-f]{8}$/i.test(value)) translucent = Math.max(translucent, 100 - Math.round((parseInt(value.slice(7, 9), 16) / 255) * 100));
      }
    }
  }
  design.transparency = { dark: translucent, light: Math.round(translucent * 0.55) };
  return design;
}

/* ----------------------------------- wiring ----------------------------------- */

async function refreshState() {
  state.server = await api("/api/state");
  renderServerInfo();
}

function wire() {
  $("btnGenerate").addEventListener("click", () => generate().catch((error) => setStatus(error.message, "bad")));
  $("btnReset").addEventListener("click", () => {
    state.design = defaultDesign();
    state.layout = {};
    applyBundle({ design: state.design, layout: {}, matched: [] });
    setStatus("reset to the built-in glass design");
  });
  $("image").addEventListener("change", (event) => useImage(event.target.files[0]).catch((error) => setStatus(error.message, "bad")));
  const wallpaper = $("wallpaper");
  wallpaper.addEventListener("dragover", (event) => {
    event.preventDefault();
    wallpaper.classList.add("dragging");
  });
  wallpaper.addEventListener("dragleave", () => wallpaper.classList.remove("dragging"));
  wallpaper.addEventListener("drop", (event) => {
    event.preventDefault();
    wallpaper.classList.remove("dragging");
    const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) useImage(file).catch((error) => setStatus(error.message, "bad"));
  });

  for (const id of ["darkTrans", "lightTrans"]) {
    $(id).addEventListener("input", () => {
      const value = Number($(id).value);
      $(`${id}Out`).textContent = `${value}%`;
      state.design.transparency[id === "darkTrans" ? "dark" : "light"] = value;
      state.design.overrides = { dark: {}, light: {} };
      rebuild();
    });
  }
  $("transparency").addEventListener("input", () => {
    $("transparencyOut").textContent = `${$("transparency").value}%`;
  });
  $("blur").addEventListener("input", () => {
    state.ui.blur = Number($("blur").value);
    applyPreview();
  });

  const typeBindings = { monoFont: "string", fontSize: "number", lineHeight: "number", radius: "number", pad: "number", buttonSize: "number", buttonAlign: "string", sidebarWidth: "number", headerHeight: "number", statusHeight: "number" };
  for (const [id, kind] of Object.entries(typeBindings)) {
    $(id).addEventListener("input", () => {
      state.ui[id] = kind === "number" ? Number($(id).value) : $(id).value;
      applyPreview();
      applyUserCss();
    });
  }
  $("customCss").addEventListener("input", () => {
    state.ui.customCss = $("customCss").value;
    applyUserCss();
  });
  $("tokenFilter").addEventListener("input", renderTokens);
  $("tokenOnlyOverrides").addEventListener("change", renderTokens);

  $("btnSave").addEventListener("click", () => handler.save().catch((error) => setStatus(error.message, "bad")));
  $("btnApply").addEventListener("click", () => handler.apply().catch((error) => setStatus(error.message, "bad")));
  $("btnTerminal").addEventListener("click", () => handler.terminal().catch((error) => setStatus(error.message, "bad")));
  $("btnTerminalFont").addEventListener("click", () => handler.terminalFont().catch((error) => setStatus(error.message, "bad")));
  $("btnLayout").addEventListener("click", () => handler.layout().catch((error) => setStatus(error.message, "bad")));
  $("btnExport").addEventListener("click", () => handler.export().catch((error) => setStatus(error.message, "bad")));
  $("btnCssExport").addEventListener("click", () => handler.cssExport());
  $("btnDesktopCss").addEventListener("click", () => handler.desktopCss().catch((error) => setStatus(error.message, "bad")));
  $("btnCss").addEventListener("click", () => {
    state.ui.customCss = $("customCss").value;
    applyUserCss();
    setStatus("custom CSS applied to the preview");
  });
  $("btnCssSnippet").addEventListener("click", () => handler.copySnippet().catch((error) => setStatus(error.message, "bad")));
  $("btnDesktopTheme").addEventListener("click", () => handler.desktopApplyTheme().catch((error) => setStatus(error.message, "bad")));
  $("btnDesktopGlass").addEventListener("click", () => handler.desktopGlass().catch((error) => setStatus(error.message, "bad")));
  $("btnDesktopRestart").addEventListener("click", () => handler.desktopRestart().catch((error) => setStatus(error.message, "bad")));
  $("btnDesktopClear").addEventListener("click", () => handler.desktopClear().catch((error) => setStatus(error.message, "bad")));
  $("importFile").addEventListener("change", (event) => handler.import(event.target.files[0]).catch((error) => setStatus(error.message, "bad")));
  $("btnLoad").addEventListener("click", () => handler.loadSaved($("savedThemes").value).catch((error) => setStatus(error.message, "bad")));

  for (const tab of document.querySelectorAll(".tab[data-mode]")) {
    tab.addEventListener("click", () => {
      state.mode = tab.dataset.mode;
      document.querySelectorAll(".tab[data-mode]").forEach((other) => other.classList.toggle("active", other === tab));
      applyPreview();
      renderTokens();
    });
  }
  for (const tab of document.querySelectorAll(".tab[data-view]")) {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      document.querySelectorAll(".tab[data-view]").forEach((other) => other.classList.toggle("active", other === tab));
      applyPreview();
    });
  }
}

async function boot() {
  wire();
  state.design = defaultDesign();
  await refreshState();
  syncTypeControls();
  rebuild();
  renderHues();
  handler.desktopInfo().catch(() => {});
  setStatus("ready - describe a look, drop an image, or tune the palette");
}

boot().catch((error) => setStatus(`boot failed: ${error.message}`, "bad"));
