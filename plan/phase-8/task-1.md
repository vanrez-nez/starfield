# Phase 8 Task 1 — Raster job queue

## Goal
Bake adaptive patches incrementally instead of rebaking every patch in one blocking pass.

## Implementation Notes
- Add `pendingBakeJobs`, `activeBakeJob`, and `maxBakeJobsPerFrame`.
- Queue jobs with `patchId`, `targetSize`, `priority`, and reason `new`, `upgrade`, or `stale`.
- Process highest priority jobs first and keep the old resident patch visible until a replacement target is ready.
- Stop queue processing completely when `pendingBakeJobs` is empty, `activeBakeJob` is null, and no crossfades are active.
- Camera movement may enqueue jobs, but once work completes runtime must return to zero active bake state and zero allocation growth.

## Acceptance Criteria
- Adaptive Resolution on schedules jobs instead of full-grid immediate rebakes.
- Camera or quality changes enqueue patch upgrades without blocking the render loop.
- Bake status and stats report queue length, active job, completed jobs, allocation count, and queue idle state.
- After queue drain and 5 seconds idle, active/pending job counts remain zero and allocation counters do not increase.

## Dependencies
- `plan/phase-7/task-1.md`
