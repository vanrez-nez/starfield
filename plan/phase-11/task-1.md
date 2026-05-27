# Phase 11 Task 1 — Screen-space star minimum policy

## Goal
Make star minimum size behavior explicitly screen-space so adaptive low-resolution patches stay stable without square or clipped artifacts.

## Implementation Notes
- Rename conceptual controls/constants to Min Core Pixels, Min Glare Pixels, and Subpixel Energy Mode.
- Apply thresholds: below `0.5px` becomes density contribution, `0.5px` to `1.5px` becomes antialiased pin, above `1.5px` uses normal splat/glare.
- Preserve current visual defaults as closely as possible before exposing additional UI.

## Acceptance Criteria
- Low-resolution adaptive patches avoid hard clipped or square-looking star cores.
- Existing default visual look remains close at `4096` and `8192`.
- Stress test with high brightness/glare has no obvious cutoff artifacts.

## Dependencies
- `plan/phase-10/task-1.md`
