# Phase 7 Task 1 — Patch priority scoring

## Goal
Assign each patch a priority score that estimates which patches should be baked or upgraded first.

## Implementation Notes
- Compute first-version priority as `(projectedPixels * centerWeight * densityImportance * staleWeight) / memoryCost`.
- Derive center weight from the angle between camera forward direction and patch center direction, controlled by Center Bias.
- Include density/bright-star importance so high-density background can degrade while patches containing important bright stars stay prioritized.
- Store `priority`, `projectedPixels`, center angle, memory cost, density importance, stale weight, and bright-star count on each descriptor for stats/readouts.

## Acceptance Criteria
- Moving the camera changes patch priorities without immediately changing rendering.
- Center Bias changes the ordering of recommended patch work.
- Stats/debug output can show the highest priority patches and explain whether priority came from projected pixels, center bias, density, bright stars, stale state, or memory cost.

## Dependencies
- `plan/phase-6/task-1.md`
