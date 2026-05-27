# Phase 15 Task 1 — Sparse patching modes

## Goal
Allow adaptive rendering to keep only useful patches resident while relying on fallbacks for missing or low-priority areas.

## Implementation Notes
- Add sparse modes: Full Grid, Visible Only Sparse Grid, Center Weighted Sparse Grid, and Density Weighted Sparse Grid.
- Use priority, budget, and fallback availability to decide which descriptors stay resident.
- Ensure evicted descriptors release targets through the bucket pool and transition through `evicting` safely.
- When budget pressure is high, downgrade background/density-heavy patches before sacrificing bright/hero-star coverage.

## Acceptance Criteria
- Sparse modes reduce resident texture memory compared with Full Grid.
- Camera movement schedules visible/important patches back into residency.
- No missing-patch artifacts appear because fallback rendering remains available.
- Resident memory remains at or below Patch Budget after the queue settles.

## Dependencies
- `plan/phase-14/task-1.md`
