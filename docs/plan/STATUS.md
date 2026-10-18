# STATUS - opencode desktop customization

next action: wave 1 in flight (units 1-4, background tasks). Nothing merged yet.

| unit | owner | status | evidence / blocker |
|---|---|---|---|
| 1 REA app graph | subagent (wave 1) | running | - |
| 2 REA subagent data path | subagent (wave 1) | running | - |
| 3 REA window + RAM switches | subagent (wave 1) | running | - |
| 4 patch manifest | subagent (wave 1) | running | existing byte-patch tool is the base |
| 5 GUI overlay | - | queued | needs unit 3 + 4 |
| 6 subagent dashboard | - | queued | needs unit 2 |
| 7 RAM profiler | - | queued | needs unit 3 |
| 8 skills preservation | - | queued | wave 3 |
| 9 packaging + docs | - | queued | wave 3 |
| 10 e2e verification | - | queued | wave 3 |

Baseline facts already banked (do not re-derive):
- window created without `transparent`/`backgroundMaterial`; byte patch `backgroundColor:Ld??cn(),` -> `transparent:!0,` verified reversible on a copy;
- styling lever = `localStorage` (`opencode-theme-css-dark/light`, `opencode-theme-id`, 36 bundled themes);
- real CSS variable names: `--background-base`, `--surface-*`, `--text-*`, `--icon-*`, `--border-*`, `--border-radius`;
- renderer URL `oc://renderer/index.html`; app bundles `opencode-cli 2.0.28`;
- console-window culprit was the `rtk.ts` plugin (fixed with `windowsHide`), not opencode.
