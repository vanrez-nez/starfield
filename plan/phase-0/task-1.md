# Phase 0 Task 1 — Module split architecture

## Goal
Define the internal starfield module structure needed for adaptive patch work while keeping `src/starfield.js` as the public facade used by `main.js` and `controls.js`.

## Implementation Notes
- Create an internal `src/starfield/` module namespace for constants, patch layout, render targets, catalog generation, shader sources, bake pipeline, skydome display, and stats helpers.
- Keep `createStarfield({ renderer, scene, requestRender })` exported from `src/starfield.js` with the same facade API currently used by the app shell and controls.
- Do not change runtime behavior, UI labels, bake timing, stats contents, or the generated starfield output in this task.

## Acceptance Criteria
- `src/starfield.js` remains the only import path used by `main.js` for starfield creation.
- A documented internal module map exists in code comments or file names under `src/starfield/`.
- `npm run build` passes with no runtime code path changes beyond imports and exports.

## Dependencies
- None.
