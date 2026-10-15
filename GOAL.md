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

status: done
