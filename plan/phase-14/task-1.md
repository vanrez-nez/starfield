# Phase 14 Task 1 — Tile-aware deterministic star generation

## Goal
Replace the global catalog splat source with deterministic tile-aware star queries that support sparse adaptive patch residency.

## Implementation Notes
- Generate or query stars from global angular/tile coordinates instead of a full global catalog array.
- Use stable global star cell IDs and hashes so star identity does not change when patch grids or target sizes change.
- Preserve seam handling across equirectangular U wrap and pole folding.

## Acceptance Criteria
- Stars at patch edges remain continuous across neighboring patches.
- Changing virtual size or patch grid does not reshuffle star identity.
- Adaptive patch baking can request only stars affecting a descriptor's UV/angular bounds.

## Dependencies
- `plan/phase-13/task-1.md`
