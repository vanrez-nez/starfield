# Phase 0 Task 5 — Runtime performance contract

## Goal
Define the performance contract for adaptive starfield work: generation may spend 1-2 seconds of CPU/GPU time, but settled runtime must be render-on-demand, allocation-free, and backed only by resident textures, materials, and meshes.

## Implementation Notes
- Treat active baking, target allocation, catalog rebuilds, pool growth, and crossfade animation as generation/update work, not idle runtime work.
- Split memory stats into `residentTextureMemory`, `bakeScratchMemory`, `pooledTargetMemory`, and `totalAllocatedMemory`.
- Add counters for `allocationCount`, active/pending bake jobs, resident patches, downgraded patches, and density-fallback patches.
- Production mode must dispose bake scratch after generation; editor/debug mode may retain bake scratch only if it reports it separately from resident runtime memory.
- After the bake queue drains, camera idle must perform no WebGL target/texture/material/geometry allocation and no catalog rebuilds.

## Acceptance Criteria
- Tab stats distinguish resident runtime memory from temporary bake scratch and pooled targets.
- After initial generation completes and 5 seconds pass, allocation counters, texture count, material count, and geometry count remain stable while the user does not interact.
- Render calls occur only on interaction, resize, stats toggle, explicit bake, active queue work, or active crossfade.
- Documentation states that runtime budget is prioritized over exact per-star fidelity when density exceeds what the screen can represent.

## Dependencies
- `plan/phase-0/task-4.md`
