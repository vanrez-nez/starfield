# Phase 0 Task 3 — Extract catalog, shaders, and bake pipeline

## Goal
Separate star catalog generation, shader source construction, and bake orchestration into internal modules without changing generated output or controls.

## Implementation Notes
- Move deterministic random helpers, catalog seed/count logic, and instanced star geometry creation into `src/starfield/catalog.js`.
- Move shader materials or shader source factories into `src/starfield/shaders.js`.
- Move bake sequencing, downsample pass wiring, and per-patch render loop into `src/starfield/bake-pipeline.js`.
- Keep existing star attributes, seam copies, Gaussian core/glare behavior, box downsample pass, additive blending, and half-float fallback behavior.

## Acceptance Criteria
- Initial bake and slider-triggered rebakes produce visually equivalent output.
- Density and sparsity still rebuild the catalog; other visual sliders reuse the catalog and rebake.
- `npm run build` passes and browser console has no shader compile/link errors.

## Dependencies
- `plan/phase-0/task-2.md`
