# REA-TASK.md

task: reverse engineer the installed opencode desktop app so its GUI, buttons, plugins, features and
window material can be customized, subagents can be watched in parallel, and the app runs leaner while
keeping every skill.
target: `C:\Users\witek\AppData\Local\Programs\@opencode-aidesktop\OpenCode.exe`
        (resources/app.asar = 168.1 MB, renderer = `oc://renderer/index.html`, bundled `opencode-cli 2.0.28`)
goal: C - my own working version (not just a report)
reporter: user (Witek), beginner-friendly output requested, answers in Polish where possible
next step: 2

## Step 1 - answers (from the user's own prompt; nothing guessed)

- what: opencode desktop app (Electron wrapper `@opencode-aidesktop`, not the TUI)
- where: the path above; already installed and previously inspected
- features wanted (in the user's words, in priority order):
  1. customize the GUI (colors, fonts, **button locations**, sizes, CSS)
  2. add **plugins** and **more buttons**
  3. see **all subagents working in parallel**
  4. **transparent background** for the desktop app
  5. make the app **efficient and RAM friendly** while keeping all skills
  6. put the result on **GitHub**
- deliverable: a working custom build/toolchain in this repo, with REA evidence per claim

## Already established (previous sessions, evidence in docs/opencode-client-re.md + GOAL.md)

| Fact | Evidence |
|---|---|
| Window is created WITHOUT `transparent:true`/`backgroundMaterial` -> OS can't show wallpaper | bundle string: `function Rd(e,t){let n=kr();return{title:'OpenCode',icon:Xd(e,t),backgroundColor:Ld??cn(),...}` |
| App syncs `--background-base` into `window.setBackgroundColor()` | bundle: `getComputedStyle(document.documentElement).getPropertyValue('--background-base')` + `api.setBackgroundColor(t)` |
| CSS/Style hooks exist: `localStorage['opencode-theme-css-dark'|'-light']` + `opencode-theme-id` (36 bundled themes) | `oc-theme-preload.js` inside app.asar; verified live over CDP |
| Real variable names for styling (`--background-base`, `--surface-*`, `--text-*`, `--border-*`, `--border-radius`) | live stylesheet read (540 custom properties) |
| Byte patch `backgroundColor:Ld??cn(),` -> `transparent:!0,` (25 bytes, same length) works and is reversible | tools/patch-desktop.mjs; verified on a copy (size/header unchanged, byte-identical revert) |
| 40+ spawn sites across this repo lacked `windowsHide`; the rtk plugin was the real source of console windows | test/spawn.test.mjs + GOAL.md phase 10 |

## Web research (3 queries, treg)

- pykeio/vibe + StackOverflow: for real Windows acrylic the Electron window needs `backgroundColor:
  '#00000000'` (plus transparent) - exactly what the byte patch does.
- electronjs.org/docs/latest/tutorial/performance: official RAM/CPU guidance (measure first).
- Chromium issue 41017839: shader disk cache can eat ~10% of the filesystem's memory budget -> a
  candidate switch for the "RAM friendly" goal.
- reddit r/opencode: "How to download opencode desktop V2?" - users are unsure the desktop build even
  supports the v2 features; no ready-made customization project exists, so this is not duplicating work.

## Step 2 (setup) - to run after the plan is confirmed

1. `npx -y rea-agents@latest doctor --client opencode --json` and check only `registration:opencode`
   in `scope_checks` (an error exit plus missing Ghidra/JADX is normal).
2. If not ok: `npx -y rea-agents@latest setup --client opencode --dry-run --json`, then `--yes --json`
   after approval; restart OpenCode and re-run this task.
3. REA CLI present: `rea@6.7.0` (verified with `npx -y rea-agents@latest --help`).

## Step 3 (route) - planned, per target kind

- Electron route: `npx -y rea-agents@latest analyze-javascript-application
  "C:\Users\witek\AppData\Local\Programs\@opencode-aidesktop\resources\app.asar" --json`
  -> application graph: renderer bundle, IPC surface, window options, session/subagent code paths.
- API route (parallel subagents): `opencode api get /openapi.json` + `/api/session*` to find whether
  child/subagent sessions are queryable (dashboard evidence).
- Native route only if needed for the window material: `doctor --provider ghidra --json`.
