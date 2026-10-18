# Roster - opencode desktop customization (10 units, 3 waves)

Goal: a working, reversible customization of the installed opencode desktop app
(`C:\Users\witek\AppData\Local\Programs\@opencode-aidesktop`) covering GUI styling, buttons/plugins,
parallel-subagent visibility, transparent window material, and measured RAM wins - keeping every skill.
Evidence rules: every RE claim carries the exact REA command + raw output; no invented claims.
Report style: plain language, for a beginner - before each step *what and why*, after it *what was found*.

| # | Wave | Unit | Owned files | Done check |
|---|---|---|---|---|
| 1 | 1 | REA app graph of app.asar (renderer bundle, IPC surface, window options, session code) | `docs/re/app-graph.md`, `docs/re/app-graph.json` | file has >=10 claims, each with command + offset/line; `analyze-javascript-application` actually ran |
| 2 | 1 | REA session/subagent data path (can child/subagent sessions be listed?) | `docs/re/subagents.md` | every endpoint listed with a real response captured in this session |
| 3 | 1 | Window material + RAM switch inventory (what the app accepts) | `docs/re/window-and-ram.md` | each switch has a citation (bundle string or Electron/Chromium doc) + a test command |
| 4 | 1 | Patch manifest: transparent window, preload injection, RAM switches, dry-run/apply/revert | `tools/patch-desktop.mjs`, `test/patcher.test.mjs` | `node --test test/patcher.test.mjs` green + revert byte-identical on a copy |
| 5 | 2 | GUI overlay: extra buttons, button positions, fonts, CSS injection | `overlay/**`, `test/overlay.test.mjs` | assets load in headless Chromium; buttons present; test green |
| 6 | 2 | Parallel-subagent dashboard (all running agents side by side) | `dashboard/**`, `server.mjs`, `test/dashboard.test.mjs` | page renders with real API data; Playwright/CDP assertion green |
| 7 | 2 | RAM profiler: per-process memory before/after, safe switches only | `tools/ram-profile.mjs`, `docs/re/ram-profile.md` | prints a real before/after table for the installed app |
| 8 | 3 | Skills preservation check (nothing lost after customization) | `tools/check-skills.mjs`, `test/skills-preserved.test.mjs` | counts equal before/after via `opencode api get /api/skill` |
| 9 | 3 | Packaging + docs + install/uninstall of the whole customization | `docs/CUSTOMIZE.md`, `install-custom.ps1`, `uninstall-custom.ps1`, `README.md` | installer dry-run exits 0; docs commands verified |
| 10 | 3 | End-to-end verification harness | `test/e2e-custom.test.mjs`, `docs/plan/VERIFY.md` | `node --test test/` all green on the integrated source |

Decisions taken by the user (2026-10-18):
- waves of ~4, not all ten at once;
- patch the **installed** app, with backup + byte-identical revert;
- RAM: **keep visuals**, take only measured safe wins.

Rules for every unit: read the whole project, write only your owned files, never touch another unit's
files, name your exact check, report files + check output + blocker. No secrets in any file. No push.
