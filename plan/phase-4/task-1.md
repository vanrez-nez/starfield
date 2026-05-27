# Phase 4 Task 1 — Per-patch required bucket computation

## Goal
Compute required raster bucket per patch descriptor using screen demand and adaptive quality settings.

## Implementation Notes
- Implement `requiredPatchBucket({ patchAngularWidthRad, patchAngularHeightRad, screenWidth, screenHeight, horizontalFovRad, verticalFovRad, texelsPerPixel, minSize, maxSize })`.
- Use buckets `[128, 256, 512, 1024, 2048, 4096, 8192]`, clamped by Min Patch Size and Max Patch Size.
- Apply density pressure after screen demand: high background density should lower `densityScale` or enable density fallback rather than blindly increasing target size beyond budget.
- Keep bright/hero star pressure separate so later overlay phases can preserve important stars without forcing every patch to high resolution.
- Store `requiredSize` and `targetSize` on each descriptor, but continue rendering with current uniform targets until Phase 5.

## Acceptance Criteria
- Each descriptor exposes required and target bucket values in stats/debug readouts.
- Each descriptor exposes density fallback and bright-star pressure values.
- Changing adaptive controls updates descriptor target sizes.
- Rendering output remains unchanged.

## Dependencies
- `plan/phase-3/task-2.md`
