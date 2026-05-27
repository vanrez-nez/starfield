# Phase 6 Task 1 — Render target pools by bucket size

## Goal
Avoid allocation churn by pooling render targets per adaptive bucket size.

## Implementation Notes
- Add target pools for `128`, `256`, `512`, `1024`, `2048`, and `4096` buckets, with optional `8192` support only when under WebGL texture limits.
- Implement `acquireTarget(size)` and `releaseTarget(target, size)` helpers.
- Pools must be prewarmed during generation or grown only while active bake work is allowed.
- If no pooled target is available and the Patch Budget is exhausted, downgrade the target size or evict first; do not allocate over budget.
- Ensure targets are cleared before reuse and fully disposed during starfield cleanup.

## Acceptance Criteria
- Changing patch target sizes reuses pooled targets instead of constantly allocating new WebGLRenderTargets.
- After the bake queue drains, allocation counters remain unchanged during idle camera time.
- Cleanup disposes all active and pooled targets.
- Stats can report active targets, pooled targets by bucket, allocation count, pooled target memory, resident texture memory, and bake scratch memory.

## Dependencies
- `plan/phase-5/task-1.md`
