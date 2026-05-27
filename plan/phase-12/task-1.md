# Phase 12 Task 1 — Star class separation

## Goal
Classify catalog stars by visual importance so adaptive patch resolution can treat tiny background stars differently from bright and hero stars.

## Implementation Notes
- During catalog generation classify stars as Tiny, Normal, Bright, or Hero using deterministic brightness/size/glare attributes.
- Route Tiny stars toward low-cost density or small splats, Normal stars through baked patch splats, and Bright/Hero stars as overlay candidates.
- Preserve deterministic star identity for a given seed.

## Acceptance Criteria
- Catalog stats report counts per star class.
- Default rendering remains visually close before overlay rendering is enabled.
- The classification is stable across patch size and virtual size changes.

## Dependencies
- `plan/phase-11/task-1.md`
