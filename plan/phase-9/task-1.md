# Phase 9 Task 1 — Fallback patch targets

## Goal
Ensure every patch has a visible fallback while higher resolution targets are missing, stale, or being replaced.

## Implementation Notes
- Add descriptor fields `currentTarget`, `nextTarget`, and fallback state.
- Keep current resident target visible while next target bakes.
- For empty patches, use the lowest available resident patch target or an explicitly generated minimum-size target before showing higher resolution upgrades.
- Never dispose or release a current target until its fallback or replacement target is ready and bound to the material.

## Acceptance Criteria
- No patch disappears during adaptive upgrades, downgrades, or queue processing.
- Patches never sample from disposed targets.
- Resident texture memory stays within budget by downgrading or evicting only after a valid fallback exists.
- Browser smoke test shows no black holes or flicker during camera changes.

## Dependencies
- `plan/phase-8/task-1.md`
