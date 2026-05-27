# Phase 2 Task 2 — Adaptive readout wiring

## Goal
Wire adaptive quality controls into the screen-demand diagnostics so users can preview recommended patch buckets before adaptive rendering changes allocation.

## Implementation Notes
- Recompute required patch texels and recommended bucket when Target Texels/Pixel, Min Patch Size, Max Patch Size, viewport size, FOV, or virtual size changes.
- Recompute density fallback recommendations when density, sparsity, projected patch pixels, or bright-star count changes.
- Keep `Virtual Size` as logical address-space selection and label adaptive values as recommended actual raster sizes.
- Surface budget pressure as readout-only: resident texture estimate, bake scratch estimate, pooled target estimate, and total allocated estimate versus selected Patch Budget.

## Acceptance Criteria
- Readouts respond immediately to adaptive control changes.
- Adaptive Resolution off still has no effect on rendering output.
- Tab stats include enough adaptive values to debug demand, density fallback, resident memory, bake scratch, pooled targets, and recommendation state.

## Dependencies
- `plan/phase-2/task-1.md`
