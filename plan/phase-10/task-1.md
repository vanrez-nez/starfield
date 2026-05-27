# Phase 10 Task 1 — Crossfade patch upgrades

## Goal
Blend patch texture replacements to avoid visible popping when a descriptor changes target size.

## Implementation Notes
- Update patch display material to support `uCurrentTexture`, `uNextTexture`, and `uBlend`.
- Advance blend on render ticks until complete, then release the old target and promote next to current.
- Use the same inner guard sampling logic for current and next textures.
- Request render frames only while blends are active; after all blends complete, return to render-on-demand idle behavior.

## Acceptance Criteria
- Upgrades and downgrades fade smoothly instead of popping.
- Old targets are returned to the pool only after blend completion.
- Stats report active blends, and active blend count returns to zero after transitions.
- After active blends reach zero, no continuous animation loop remains.

## Dependencies
- `plan/phase-9/task-1.md`
