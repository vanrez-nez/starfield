# Phase 3 Task 1 — Patch descriptor model

## Goal
Introduce persistent patch descriptors that can later be upgraded, downgraded, prioritized, queued, and independently resident.

## Implementation Notes
- Define patch descriptors with `id`, `x`, `y`, `uvMin`, `uvSize`, angular dimensions, screen demand, required size, current size, target size, priority, state, target, mesh, and material.
- Add performance fields: `estimatedStarCount`, `projectedPixels`, `starsPerProjectedPixel`, `densityScale`, `brightStarCount`, and `allocationState`.
- Use states: `empty`, `queued`, `baking`, `resident`, `stale`, and `evicting`.
- Populate descriptors from the existing layout without changing current uniform patch sizing.

## Acceptance Criteria
- Existing patch grid rendering still works using descriptors.
- Stats/readouts can report descriptor count, resident count, current states, allocation state, and density pressure.
- `npm run build` passes.

## Dependencies
- `plan/phase-2/task-2.md`
