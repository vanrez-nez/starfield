# Phase 1 Task 2 — Screen demand readouts

## Goal
Display demand diagnostics for the current camera, screen, and patch layout without changing the bake pipeline.

## Implementation Notes
- Add readouts for horizontal FOV, vertical FOV, screen width, screen height, pixels per degree/radian, and texels-per-pixel target.
- Add patch demand readouts for angular patch size, required texels X/Y, recommended patch bucket, current patch size, oversample ratio, and undersample warning.
- Add density demand readouts for estimated stars per patch, projected patch pixels, stars per projected pixel, bright-star count, density scale, and density fallback warning.
- Place these readouts in the existing controls panel as diagnostics and include key values in Tab stats where useful.

## Acceptance Criteria
- Changing browser size or virtual size updates demand readouts.
- Increasing density raises density pressure/fallback readouts without changing rendering.
- Rendering and bake output do not change.
- Browser smoke test confirms readouts are present and console has no warnings/errors.

## Dependencies
- `plan/phase-1/task-1.md`
