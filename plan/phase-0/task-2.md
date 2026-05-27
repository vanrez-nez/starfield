# Phase 0 Task 2 — Extract patch layout and target modules

## Goal
Move patch layout math and render target allocation into focused internal modules so adaptive patch descriptors and target pools can be added without expanding the facade file.

## Implementation Notes
- Extract virtual size options, guard texel policy, `createPatchLayout`, `supportedBakeWidths`, patch grid labels, and precision-size helpers into `src/starfield/patch-layout.js`.
- Extract `createRenderTarget`, `createAccumulationTarget`, and patch render-target creation/disposal into `src/starfield/render-targets.js`.
- Preserve existing WebGL texture-limit behavior, patch grids, guard sizing, supersample calculation, and target color-space/type settings.

## Acceptance Criteria
- Switching virtual sizes still reports the same patch grid, patch size, internal patch size, supersample, and GPU limit values as before extraction.
- `npm run build` passes.
- Browser smoke test confirms `1024`, `4096`, `8192`, and `16384` still bake and render.

## Dependencies
- `plan/phase-0/task-1.md`
