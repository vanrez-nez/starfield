# Phase 0 Task 4 — Preserve facade API and parity tests

## Goal
Lock the refactored module boundary with parity checks so later adaptive patch work can change internals safely.

## Implementation Notes
- Keep the facade methods currently used by controls: `defaults`, `getSupportedBakeWidths`, `getReadouts`, `setParam`, `setSphereSegments`, `setBakeWidth`, `reseed`, `bakeNow`, `scheduleBake`, `collectStats`, `dispose`, `setBakeStatusHandler`, `setReadoutsChangeHandler`, `setCameraInfo`, and `recordRender`.
- Move stats helper logic into `src/starfield/stats.js` if it is not already separated by prior tasks.
- Add or document a smoke-test checklist that verifies initial bake, slider rebake, sphere segment display-only rebuild, virtual size changes, Tab stats, and cleanup.

## Acceptance Criteria
- `main.js` and `controls.js` need no behavioral changes after the internal split.
- Browser smoke test passes for rendering, controls, and stats.
- `src/starfield.js` is reduced to facade orchestration and no longer contains large shader strings.

## Dependencies
- `plan/phase-0/task-3.md`
