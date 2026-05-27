# Phase 13 Task 1 — Bright star overlay layer

## Goal
Render the brightest stars outside baked patches so hero stars remain crisp even when background patches use lower adaptive resolution.

## Implementation Notes
- Add a separate bright-star scene layer or skydome-aligned billboard geometry layer on top of baked patches.
- Source overlay candidates from Bright and Hero star classes.
- Keep overlay rendering static/on-demand with the same camera orientation and no continuous animation loop.

## Acceptance Criteria
- Bright/Hero stars remain crisp when adaptive patch max size is reduced.
- Overlay draw calls and geometry counts are visible in Tab stats.
- Overlay can be disabled internally for comparison during testing.

## Dependencies
- `plan/phase-12/task-1.md`
