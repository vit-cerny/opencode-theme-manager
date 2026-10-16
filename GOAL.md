# Goal
objective: New zero-dependency OpenCode theme manager (glassy transparent theme + transparency/fonts/layout/CSS controls, prompt- or image-driven) in this directory, inspired by the old opencode-themes editor.
acceptance:
- A1 `node --test test/` passes: V2 theme schema validation (valid + invalid cases), hue-ladder expansion (9 steps), transparency/alpha ops, V1->V2 import, prompt/image design, full server API round-trip in a temp config dir with backups.
- A2 `node tools/check.mjs` validates every shipped example theme and all 35 presets and exits 0.
- A3 Server serves the manager UI at `/`; config writes happen only through explicit user actions and every overwrite is preceded by a `.bak.<yyyymmdd-hhmmss>` backup.
- A4 Examples ship a transparent "glass" theme in V2 native format plus a legacy V1 copy; both validate.
- A5 The UI renders in a browser: all panels, a live translucent preview driven by resolved theme colours, real config paths.
- A6 Both requested skill sets are installed under `~/.agents/skills/` (rea: reverse-engineer-anything, rea-tool-design, rea-ci-tests-audit, rea-changelog-update; garden: gpt-image-2, beautiful-article, kb-retriever, motion-showreel, web-design-engineer, web-video-presentation).
- A7 A prompt or a reference image produces a complete theme plus desktop/web CSS and terminal font/transparency settings.
checks:
- node --test test/
- node tools/check.mjs
- node tools/serve-smoke.mjs
- node server.mjs --port 4289   (manual: open http://127.0.0.1:4289/)

## Result: done

| Criterion | Evidence |
|---|---|
| A1 | `node --test test/` -> `tests 46 / pass 46 / fail 0` (tokens.test.mjs, designer.test.mjs, server.test.mjs, skills.test.mjs) |
| A2 | `node tools/check.mjs` -> `token inventory: 103 paths (59 required, 44 optional)`, every example + all 35 presets `ok`, `all checks passed` |
| A3 | `node tools/serve-smoke.mjs` -> 9 ok, `smoke test passed (no files written)`; `test/server.test.mjs` asserts the backup file exists after the 2nd save and that an invalid theme is refused with HTTP 422 and no file written |
| A4 | `examples/glass.json` = V2, valid, 32 translucent tokens; `examples/glass-v1.json` = legacy V1, imports cleanly; `examples/preview.css` generated |
| A5 | served page text dump shows title, all 8 numbered panels, the live preview (session list, transcript, diff, code, prompt, status line) with real config `<config>C:\Users\witek\.config\opencode · 2 theme(s) · 103 tokens`, `32 translucent tokens`, status `ready - describe a look, drop an image, or tune the palette`; screenshot captured to `docs/screenshot.jpg` and shown to the user in the Review pane |
| A6 | `test/skills.test.mjs` -> 10/10 pass; rea set copied from github.com/morluto/rea into `~/.agents/skills/`, garden set already present; the user's own cleanup later archived both sets to `~/.agents/skills-archive-20261015`, which the test accepts and reports |
| A7 | `test/designer.test.mjs` (12 tests) + `POST /api/design`, `/api/palette`, `/api/import` in `test/server.test.mjs`; `lib/designer.mjs` maps prompt words and image palettes to hues/transparency/font/radius/layout; `webCssSnippet()` emits the `opencode-theme-css-dark/light` localStorage seeding the web/desktop client restores |

## Locked assumptions
- Old repo (`../opencode-themes`) is inspiration only; this is a fresh project (per the user's instruction).
- Theme format: V2 native (`base` + `light`/`dark` + `hue`), mirrored from opencode's own `packages/theme/src/tui/schema.ts`. Values: 3/4/6/8-digit hex, `transparent`, `$reference`. Legacy V1 flat themes import on a best-effort name mapping.
- opencode v2.0.29 has NO font, geometry, button-position or CSS settings; that was reverse-engineered, not assumed, and is documented with evidence in `docs/opencode-client-re.md`. "Fonts / sizes / buttons / CSS" are therefore delivered as (1) real Windows Terminal profile writes (font face/size/weight, opacity, useAcrylic - the actual see-through glass), (2) the manager's live preview + exported `preview.css`, (3) the web/desktop client's only CSS hook (`localStorage['opencode-theme-css-dark'|'...light']`, read by `packages/app/public/oc-theme-preload.js`), seeded by a copy-to-clipboard snippet, and (4) the real `cli.json` layout knobs (`session.sidebar`, `tabs.*`, `diffs.*`, `cursor.*`, ...).
- Image handling is client-side only (canvas palette extraction, no upload, no dependency).
- The rea *MCP server* (`npx rea-agents setup`) was not installed by me; the user installed it later. Its skills were installed as asked.
- Themes are never applied automatically: saving/applying is a button press, so the user's live config is only touched on purpose.

## Known limits (recorded, not hidden)
- A5 visual QA is partial: two attempts to have the `vision-assistant` subagent describe the screenshot were killed by opencode server restarts, so the screenshot is verified by the DOM/text dump and by the user's own eyes in the Review pane, not by an independent model read.
- The generated theme is validated against opencode's mirrored schema and by tests, never by asserting TUI pixels: there is no headless way to read the rendered colours of the TUI, so "opencode renders it" is inferred from the schema match plus the fact that the same V2 format is what `packages/theme` consumes.
- Writes inside `test/server.test.mjs` and `tools/serve-smoke.mjs` go to a throwaway directory or are read-only against the real config (`serve-smoke` performs GETs and pure POSTs only).

## Follow-up goal (after first handover): make it visible, installable, published

objective: "how do i use it? opencode doesnt change" + "put it on github, easy to install and uninstall, set up my first theme"
acceptance:
- B1 The glass theme is actually applied to the real config (theme file written, cli.json pointed at it) and the applied file validates.
- B2 `node tools/apply.mjs --prompt "..." --terminal` performs save + apply + terminal transparency in one command, with backups.
- B3 `install.ps1` installs to a target dir, writes a launcher, and the installed copy serves the API; `uninstall.ps1` removes it and leaves themes/cli.json alone.
- B4 README answers "how do i use it" (UI steps + one-command CLI) and carries a troubleshooting checklist for "opencode looks the same".
- B5 The project is public on GitHub under the user's account, MIT, no secrets.
- B6 v2.0.29 really contains the V2 theme loader (not just the docs claiming it) - proven from the shipped binary.
checks:
- node tools/apply.mjs --name glass --mode dark --prompt "nord blue frosted glass, rounded corners, 45% transparency" --terminal
- node tools/check.mjs "$env:USERPROFILE\.config\opencode\themes\glass.json"
- node tools/strings-probe.mjs
- powershell -File .\install.ps1 -TargetDir <temp> -NoShortcut  +  powershell -File .\uninstall.ps1 -TargetDir <temp> -Yes
- gh repo view vit-cerny/opencode-theme-manager

| Criterion | Evidence |
|---|---|
| B1 | `wrote C:\Users\witek\.config\opencode\themes\glass.json` (backup `glass.json.bak.20261015-222223`) and `applied ...\cli.json -> theme.name="glass", theme.mode="dark"` (backup `cli.json.bak.20261015-222223`); `node tools/check.mjs <that file>` -> `V2, valid` |
| B2 | same run: `terminal ...settings.json -> opacity 70, acrylic true` (backup `settings.json.bak.20261015-222223`) |
| B3 | install to `%TEMP%\octm-install-test` copied all 12 items, the installed `server.mjs` answered `GET /api/state` with `tokenCount 103` on port 4291; `uninstall.ps1` removed the folder (`Test-Path` -> False) and printed that themes/cli.json are untouched |
| B4 | README sections "Using it", "I applied it but opencode looks the same" (7 checks), "Undo", "Scale notes" |
| B5 | `gh repo create opencode-theme-manager --public --push` -> https://github.com/vit-cerny/opencode-theme-manager, commit 3739523, MIT LICENSE, no credentials in the tree |
| B6 | `node tools/strings-probe.mjs` on the installed 203 MB binary: `FOUND "Missing required semantic hues"` (the V2 hue filter), `FOUND "opencode.ai/theme.json"`, `FOUND "byToken"/"byHue"` + `$hovered/$focused/...` state keys, `FOUND "thinkingOpacity"` (V1 migration path), `FOUND "oc-theme-preload"` (the web CSS hook) - so both V1 and V2 loaders ship in v2.0.29 |

Note: `docs/screenshot.jpg` was captured against the real config, so it shows the user's username and theme list; replace it before promoting the repo widely if that matters.

## Phase 3: the desktop GUI

objective: "so how do i use my opencode is still the same old desktop gui" - the GUI is a different client with its own theming.
acceptance:
- C1 Identify, with evidence, why the TUI theme does not reach the desktop GUI.
- C2 Implement the GUI's real levers (its bundled theme id + its localStorage CSS hook) and drive them over CDP.
- C3 Never touch an unrelated page that happens to expose a debug port.
- C4 Ship it as a command, an API route and a UI panel; tests cover detection, CSS mapping, injection, refusal and the no-port error.
- C5 Make a change that is visible without a restart, and say exactly what the user must run for the rest.
checks:
- node --test test/desktop.test.mjs
- node tools/desktop-apply.mjs --list
- node tools/check.mjs

| Criterion | Evidence |
|---|---|
| C1 | The running GUI is `C:\Users\witek\AppData\Local\Programs\@opencode-aidesktop\OpenCode.exe` (its own `opencode-cli 2.0.28` under `%APPDATA%\ai.opencode.desktop\cli`). Its 168 MB `resources/app.asar` contains `THEME_ID:'opencode-theme-id', COLOR_SCHEME:'opencode-color-scheme', THEME_CSS_LIGHT/DARK:'opencode-theme-css-*'`, 36 bundled themes (`./themes/oc-2.json`, `./themes/nord.json`, ...), its own schema `https://opencode.ai/desktop-theme.json`, and no file/env hook (`user.css` absent). So the GUI never reads `<config>/themes/*.json`. |
| C2 | `lib/desktop.mjs` (CDP client on the built-in WebSocket), `lib/schema.mjs#desktopClientCss` (maps a resolved theme onto the app's own `--v2-text-text-base`, `--v2-border-border-base`, `--v2-state-*`, `--background-base`, `--border-radius`, `--v2-font-family-code` names), `tools/desktop-apply.mjs --glass --restart`, routes `/api/desktop`, `/api/desktop/apply`, `/api/desktop/clear`, `/api/desktop/restart`, UI panel `7 - Desktop app (GUI)`. |
| C3 | `probeTarget()` requires `document.documentElement.hasAttribute("data-theme")` or a stored theme id before writing; verified by the test that first asserts injection into a foreign page throws `/not the opencode app/`. The port list is no longer a scanner: it defaults to the single port we launch with. |
| C4 | `node --test test/desktop.test.mjs` -> 4/4 pass (detection + 36 theme ids from the real asar, CSS mapping, CDP round-trip incl. refusal, closed-port error). Full suite 50/50. `tools/check.mjs` and `tools/serve-smoke.mjs` still pass. |
| C5 | `%APPDATA%\ai.opencode.desktop\opencode.settings` `backgroundColor` set to `#101623` (backup `opencode.settings.bak.20261016-220018`) - the GUI window fill changes on its next launch with no DevTools. Everything else (CSS + theme id) needs one run of `node tools/desktop-apply.mjs --glass --restart`, which the user triggers because it closes their window. |

Not verifiable here: what the themed GUI actually looks like - the vision subagent is
unavailable (killed repeatedly by server restarts), so GUI appearance is unverified by me.

## Result: done (phase 5: review + deployment)

objective: "how do i use it, make easy deployment and uninstall, put it on github, review the entire project and test it"

| Criterion | Evidence |
|---|---|
| Review by someone other than the author | `reviewer` subagent, read-only, ranked 15 findings with file:line (6 must-fix, 6 should-fix, 3 notes) and 3 "verified fine" lines |
| Every must-fix fixed | 1) `/api/cli` dotted keys now nest through `setNested` (they silently created a literal `"session.sidebar"` key); 2) Windows Terminal `profiles.list` may be an array - guids are real guids again and the write reaches the file (my first fix copied the objects; the new test caught that); 3) desktop injection now requires a local-looking URL *and* the app marker, and writes to every app window instead of the first; 4) backups get a uniqueness suffix and writes go through tmp+rename; 5) `__proto__`/`constructor`/`prototype` are refused in merges; 6) `/api/apply` refuses a theme file that does not exist |
| Should-fix taken | dead code removed (`projectThemeDir`, `projectsDir`/`projectDir`, unused imports, duplicate CSS-key constant); portability guards around `taskkill`; `tools/desktop-apply.mjs --glass` now applies live instead of reloading; README/GOAL test counts and panel names corrected |
| Regression tests added | 6 new: dotted cli keys, prototype pollution, WT guid round-trip, same-second double backup, apply-refuses-missing-theme, foreign-origin refusal |
| Truth pass | README test counts said 46 and 56; both now read 62 (actual `node --test test/`). Panel label corrected to `6 · Layout & tabs (cli.json)`. Theme-id lever documented as keeping the injected CSS |
| Deployment verified end to end | `install.ps1` -> 63 files incl. `docs/`, Desktop + Start menu shortcuts, installed copy served `GET /api/state` with 103 tokens / 35 presets; `uninstall.ps1` -> target folder and both shortcuts gone, `~/.config/opencode/themes` untouched (still 2 files) |
| Tests | `node --test test/` **62/62**; `python tools/ui-e2e.py` **10/10 PLAYWRIGHT PASS**; `tools/check.mjs` all examples + 35 presets; `tools/serve-smoke.mjs` pass; `tools/apply.mjs --everywhere` against a temp config wrote theme + cli.json + terminal |
| Published | github.com/vit-cerny/opencode-theme-manager, tag `v0.1.0` |

Known residual risk (documented, not hidden): a *local* page (loopback/file/app scheme) that happens to set `data-theme` could still be mistaken for the app if it also sits behind the probed DevTools port. The port default is 9222, the port our own launcher opens.

status: done


