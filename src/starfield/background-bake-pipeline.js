import * as THREE from "three";
import {
  ALLOCATION_STATES,
  FALLBACK_STATES,
  MAX_BAKE_JOBS_PER_FRAME,
  PATCH_STATES,
  formatBytes,
} from "./constants.js";

export function createBackgroundBakePipeline({
  renderer,
  bakeCamera,
  backgroundScene,
  backgroundUniforms,
  skydome,
  stats,
  getPatchDescriptors,
  targetForDescriptor,
  targetMatchesDescriptor,
  releaseTarget,
  descriptorById,
  targetBytes,
  notifyReadouts,
  requestRender,
  onBakeQueueDrained = () => {},
}) {
  const bakeJobQueue = [];
  const queuedBakeJobsByPatchId = new Map();
  let bakeTimer = 0;
  let bakeQueueFrameRequested = false;
  let activeBakeJob = null;
  let completedBakeJobs = 0;
  let totalQueuedBakeJobs = 0;

  function descriptorTargets(descriptor) {
    return new Set([
      descriptor.currentTarget,
      descriptor.nextTarget,
      descriptor.target,
      descriptor.blendFromTarget,
      descriptor.blendToTarget,
    ].filter(Boolean));
  }

  function residentTextureBytes() {
    const targets = new Set();
    getPatchDescriptors().forEach((descriptor) => {
      descriptorTargets(descriptor).forEach((target) => targets.add(target));
    });
    return [...targets].reduce((bytes, target) => bytes + targetBytes(target), 0);
  }

  function dirtyPatchCount() {
    return getPatchDescriptors().filter((descriptor) => descriptor.backgroundDirty || descriptor.state !== PATCH_STATES.RESIDENT).length;
  }

  function syncStats() {
    const descriptors = getPatchDescriptors();
    const residentBytes = residentTextureBytes();
    stats.backgroundPatchCount = descriptors.length;
    stats.backgroundActiveBakeJobs = activeBakeJob ? 1 : 0;
    stats.backgroundPendingBakeJobs = bakeJobQueue.length;
    stats.backgroundDirtyPatchCount = dirtyPatchCount();
    stats.backgroundResidentTextureBytes = residentBytes;
    stats.backgroundResidentTextureMemory = formatBytes(residentBytes);
    stats.backgroundCompletedBakeJobs = completedBakeJobs;
    stats.backgroundTotalQueuedBakeJobs = totalQueuedBakeJobs;
    stats.backgroundQueueIdle = !activeBakeJob && bakeJobQueue.length === 0;
    stats.backgroundActiveBakeJobId = activeBakeJob?.patchId ?? "none";
    stats.backgroundPendingBakeJobSummary = bakeJobQueue
      .slice(0, 4)
      .map((job) => `${job.patchId}:${job.reason}`)
      .join(", ") || "none";
  }

  function jobForDescriptor(descriptor, reason = "background") {
    return {
      patchId: descriptor.id,
      reason,
    };
  }

  function clearBakeQueue() {
    bakeJobQueue.length = 0;
    queuedBakeJobsByPatchId.clear();
    activeBakeJob = null;
    syncStats();
  }

  function enqueueBakeJobs(descriptors, reason = "background", { replace = false } = {}) {
    if (replace) clearBakeQueue();

    descriptors.forEach((descriptor) => {
      if (queuedBakeJobsByPatchId.has(descriptor.id)) return;
      const job = jobForDescriptor(descriptor, reason);
      bakeJobQueue.push(job);
      queuedBakeJobsByPatchId.set(descriptor.id, job);
      descriptor.state = PATCH_STATES.QUEUED;
      descriptor.backgroundDirty = true;
      descriptor.backgroundDirtyReason = reason;
    });

    totalQueuedBakeJobs = Math.max(totalQueuedBakeJobs, completedBakeJobs + bakeJobQueue.length);
    syncStats();
  }

  function markPatchDescriptorsStale(reason = "background") {
    getPatchDescriptors().forEach((descriptor) => {
      if (descriptor.state === PATCH_STATES.RESIDENT) {
        descriptor.state = PATCH_STATES.STALE;
      }
      descriptor.backgroundDirty = true;
      descriptor.backgroundDirtyReason = reason;
    });
    syncStats();
  }

  function requestBakeQueueProcessing() {
    if (bakeQueueFrameRequested) return;
    bakeQueueFrameRequested = true;
    requestAnimationFrame(processBakeQueueFrame);
  }

  function prepareDescriptorBakeTarget(descriptor) {
    if (descriptor.blendActive) {
      skydome.finishDescriptorBlend(descriptor);
    }

    if (descriptor.nextTarget && !targetMatchesDescriptor(descriptor, descriptor.nextTarget)) {
      releaseTarget(descriptor.nextTarget);
      descriptor.nextTarget = null;
    }

    if (descriptor.currentTarget) {
      if (!targetMatchesDescriptor(descriptor, descriptor.currentTarget)) {
        releaseTarget(descriptor.currentTarget);
        descriptor.currentTarget = targetForDescriptor(descriptor, `Baked nebula patch ${descriptor.x + 1},${descriptor.y + 1}`);
      }
      descriptor.target = descriptor.currentTarget;
      descriptor.nextTarget = null;
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
      return descriptor.currentTarget;
    }

    descriptor.currentTarget = targetForDescriptor(descriptor, `Baked nebula patch ${descriptor.x + 1},${descriptor.y + 1}`);
    descriptor.target = descriptor.currentTarget;
    descriptor.nextTarget = null;
    descriptor.fallbackState = FALLBACK_STATES.EMPTY;
    descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
    return descriptor.currentTarget;
  }

  function renderPatchDescriptor(descriptor, target) {
    backgroundUniforms.uTileUvMin.value.copy(descriptor.storageUvMin);
    backgroundUniforms.uTileUvSize.value.copy(descriptor.storageUvSize);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(backgroundScene, bakeCamera);
  }

  function processBakeQueueFrame() {
    bakeQueueFrameRequested = false;
    if (bakeJobQueue.length === 0 || activeBakeJob) {
      syncStats();
      if (!activeBakeJob) onBakeQueueDrained();
      return;
    }

    const bakeStart = performance.now();
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = new THREE.Color();
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    let completedThisFrame = 0;

    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);

    while (completedThisFrame < MAX_BAKE_JOBS_PER_FRAME && bakeJobQueue.length > 0) {
      const job = bakeJobQueue.shift();
      queuedBakeJobsByPatchId.delete(job.patchId);
      const descriptor = descriptorById(job.patchId);
      if (!descriptor) continue;

      const bakeTarget = prepareDescriptorBakeTarget(descriptor);
      if (!bakeTarget) continue;

      activeBakeJob = job;
      descriptor.state = PATCH_STATES.BAKING;
      syncStats();

      const patchStart = performance.now();
      renderPatchDescriptor(descriptor, bakeTarget);
      skydome.promoteDescriptorBakeTarget(descriptor, bakeTarget);
      descriptor.lastBakeReason = job.reason;
      descriptor.lastBakeDurationMs = Number((performance.now() - patchStart).toFixed(2));
      descriptor.state = PATCH_STATES.RESIDENT;
      descriptor.backgroundDirty = false;
      descriptor.backgroundDirtyReason = "";
      activeBakeJob = null;
      completedBakeJobs += 1;
      completedThisFrame += 1;
    }

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    stats.backgroundBakes = (stats.backgroundBakes ?? 0) + completedThisFrame;
    stats.backgroundLastBakeMs = Number((performance.now() - bakeStart).toFixed(2));
    syncStats();

    if (bakeJobQueue.length > 0) {
      requestBakeQueueProcessing();
    } else {
      onBakeQueueDrained();
    }
    notifyReadouts();
    requestRender();
  }

  function bakeNow({ onlyDirty = false } = {}) {
    clearTimeout(bakeTimer);
    completedBakeJobs = 0;
    totalQueuedBakeJobs = 0;
    const descriptors = onlyDirty
      ? getPatchDescriptors().filter((descriptor) => descriptor.backgroundDirty || descriptor.state !== PATCH_STATES.RESIDENT)
      : getPatchDescriptors();
    enqueueBakeJobs(descriptors, "background", { replace: true });
    requestBakeQueueProcessing();
  }

  function scheduleBake(delay = 180) {
    clearTimeout(bakeTimer);
    bakeTimer = window.setTimeout(() => {
      bakeNow({ onlyDirty: true });
    }, Math.max(0, delay));
  }

  function dispose() {
    clearTimeout(bakeTimer);
    clearBakeQueue();
  }

  syncStats();

  return {
    clearBakeQueue,
    enqueueBakeJobs,
    markPatchDescriptorsStale,
    requestBakeQueueProcessing,
    bakeNow,
    scheduleBake,
    syncStats,
    dispose,
    get activeBakeJob() {
      return activeBakeJob;
    },
  };
}
