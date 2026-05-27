# Phase 3 Task 2 — Descriptor migration

## Goal
Migrate existing patch target creation, mesh creation, readouts, stats, and bake loops to consume patch descriptors instead of raw patch objects.

## Implementation Notes
- Replace raw `{ x, y, target, mesh, material }` patch structures with descriptors throughout target creation, skydome material setup, and bake iteration.
- Keep all patches at the current layout-derived target size for now.
- Keep current full-grid behavior and existing virtual size options.

## Acceptance Criteria
- Virtual size changes still rebuild the same number of patches and report the same patch grid.
- Initial bake and slider rebakes render correctly.
- Browser smoke test passes for `1024`, `8192`, and `16384`.

## Dependencies
- `plan/phase-3/task-1.md`
