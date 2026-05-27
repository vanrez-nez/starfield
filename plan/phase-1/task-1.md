# Phase 1 Task 1 — Screen demand math

## Goal
Add pure math helpers that calculate screen texel demand from camera FOV, viewport size, patch angular coverage, and a texels-per-pixel target.

## Implementation Notes
- Create helpers for camera demand: `pixelsPerRadX`, `pixelsPerRadY`, `pixelsPerDegreeX`, and `pixelsPerDegreeY`.
- Create helpers for patch demand: angular width/height in radians and degrees, required texels X/Y, recommended bucket, oversample ratio, and undersample warning.
- Add density-aware demand helpers for estimated stars per patch, projected patch pixels, stars per projected pixel, bright-star count, and density scale.
- When estimated background star density exceeds projected screen support, report density fallback need instead of only recommending a larger patch bucket.
- Use current equirectangular patch layout only; do not change rendering, target allocation, or bake behavior in this task.

## Acceptance Criteria
- Helper outputs are deterministic for a given camera, viewport, patch layout, and texels-per-pixel target.
- Helper outputs include density-pressure values that can drive later subpixel/density fallback decisions.
- Existing rendering output remains unchanged.
- `npm run build` passes.

## Dependencies
- `plan/phase-0/task-5.md`
