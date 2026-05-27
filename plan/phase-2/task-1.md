# Phase 2 Task 1 — Adaptive quality controls

## Goal
Add UI controls for adaptive quality preferences while keeping adaptive rendering disabled by default.

## Implementation Notes
- Add controls for Adaptive Resolution, Target Texels/Pixel, Min Patch Size, Max Patch Size, Patch Budget, and Center Bias.
- Use defaults: Adaptive Resolution off, Target Texels/Pixel `1.5`, Min Patch Size `256`, Max Patch Size `4096`, Patch Budget `128 MB`, Center Bias `0.5`.
- Store control values in the starfield facade state and expose them through readouts/stats, but do not alter render target sizing yet.
- Treat Patch Budget as a hard future runtime resident-memory budget, not a soft visual recommendation.

## Acceptance Criteria
- Controls appear, update state, and persist during virtual size changes in the current session.
- Adaptive Resolution off keeps current rendering behavior exactly unchanged.
- Changing budget and texels-per-pixel controls updates diagnostic demand/budget state without allocating render targets.
- `npm run build` passes and browser console has no warnings/errors.

## Dependencies
- `plan/phase-1/task-2.md`
