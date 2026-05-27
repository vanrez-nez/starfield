# Phase 5 Task 1 — Decouple logical patch area from target size

## Goal
Separate a patch descriptor's logical UV/angular area from its actual render target pixel dimensions.

## Implementation Notes
- Keep `uvMin`, `uvSize`, and angular dimensions tied to the logical virtual layout.
- Add actual target storage fields derived from descriptor target bucket plus guard texels.
- Update bake uniforms and skydome sampling to use descriptor-local target storage instead of layout-global storage dimensions.

## Acceptance Criteria
- Patches can be assigned different target sizes in data without breaking material UV mapping.
- With all descriptors assigned the same target size, output matches the pre-decoupling render.
- `npm run build` passes and browser smoke test has no visible patch seams.

## Dependencies
- `plan/phase-4/task-1.md`
