import * as THREE from "three";
import {
  CAMERA_BAKE_IDLE_MS,
  ALLOCATION_STATES,
  FALLBACK_STATES,
  MAX_BAKE_JOBS_PER_FRAME,
  PATCH_STATES,
  screenPixelAngleFromInfo,
} from "./constants.js";
import {
  autoSupersampleForDescriptor,
  descriptorPrecisionHeight,
  descriptorPrecisionWidth,
} from "./patch-layout.js";

export function createBakePipeline({
  renderer,
  starScene,
  bakeCamera,
  downsampleScene,
  downsampleUniforms,
  bakeUniforms,
  maxTextureSize,
  stats,
  skydome,
  getCurrentCameraInfo,
  getCurrentPatchLayout,
  getCurrentSupersample,
  setCurrentSupersample,
  getPatchDescriptors,
  getSupersampleTarget,
  targetForDescriptor,
  targetMatchesDescriptor = () => true,
  releaseTarget = () => {},
  descriptorById,
  setStarBakeGeometry,
  createBakeGeometry,
  ensureStarCatalog,
  updatePatchStats,
  updateDemandStats,
  notifyReadouts,
  setBakeStatus,
  onDescriptorBaked = () => {},
  onBakeQueueDrained = () => {},
  requestRender,
}) {
  const bakeJobQueue = [];
  const queuedBakeJobsByPatchId = new Map();
  let activeBakeJob = null;
  let completedBakeJobs = 0;
  let totalQueuedBakeJobs = 0;
  let bakeQueueFrameRequested = false;
  let bakeTimer = 0;
  let layerBakeTimer = 0;

  function queueState() {
    return {
      bakeJobQueue,
      activeBakeJob,
      activeBakeJobs: activeBakeJob ? 1 : 0,
      pendingBakeJobs: bakeJobQueue.length,
      completedBakeJobs,
      totalQueuedBakeJobs,
    };
  }

  function syncBakeQueueStats() {
    const queue = queueState();
    stats.pendingBakeJobs = queue.pendingBakeJobs;
    stats.activeBakeJobs = queue.activeBakeJobs;
    stats.activeBakeJob = queue.activeBakeJob ? { ...queue.activeBakeJob } : null;
    stats.activeBakeJobId = queue.activeBakeJob?.patchId ?? "none";
    stats.completedBakeJobs = queue.completedBakeJobs;
    stats.totalQueuedBakeJobs = queue.totalQueuedBakeJobs;
    stats.maxBakeJobsPerFrame = MAX_BAKE_JOBS_PER_FRAME;
    stats.activeBlendCount = skydome.activeBlendCount;
    stats.queueIdle = queue.pendingBakeJobs === 0 && !queue.activeBakeJob && skydome.activeBlendCount === 0;
    stats.pendingBakeJobSummary = bakeJobQueue.length
      ? bakeJobQueue.slice(0, 5).map((job) => `${job.patchId}:${job.reason}`).join(", ")
      : "none";
  }

  function reasonForDescriptor(descriptor, fallbackReason = "upgrade") {
    if (fallbackReason) return fallbackReason;
    if (descriptor.state === PATCH_STATES.EMPTY) return "new";
    if (descriptor.state === PATCH_STATES.STALE) return "stale";
    return "upgrade";
  }

  function jobForDescriptor(descriptor, reason) {
    return {
      patchId: descriptor.id,
      reason: reasonForDescriptor(descriptor, reason),
    };
  }

  function enqueueBakeJobs(descriptors, reason = "upgrade", { replace = false } = {}) {
    if (replace) {
      bakeJobQueue.length = 0;
      queuedBakeJobsByPatchId.clear();
      completedBakeJobs = 0;
      totalQueuedBakeJobs = 0;
    }

    updateDemandStats();
    descriptors.forEach((descriptor) => {
      if (activeBakeJob?.patchId === descriptor.id) return;

      const job = jobForDescriptor(descriptor, reason);
      const existingJob = queuedBakeJobsByPatchId.get(descriptor.id);
      if (existingJob) {
        Object.assign(existingJob, job);
      } else {
        bakeJobQueue.push(job);
        queuedBakeJobsByPatchId.set(descriptor.id, job);
        totalQueuedBakeJobs += 1;
      }

      if (descriptor.state !== PATCH_STATES.BAKING) {
        descriptor.state = PATCH_STATES.QUEUED;
      }
    });

    syncBakeQueueStats();
    updateDemandStats();
  }

  function clearBakeQueue() {
    clearTimeout(bakeTimer);
    clearTimeout(layerBakeTimer);
    bakeJobQueue.length = 0;
    queuedBakeJobsByPatchId.clear();
    activeBakeJob = null;
    layerBakeTimer = 0;
    bakeQueueFrameRequested = false;
    syncBakeQueueStats();
  }

  function requestBakeQueueProcessing() {
    if (bakeQueueFrameRequested || bakeJobQueue.length === 0) {
      syncBakeQueueStats();
      return;
    }

    bakeQueueFrameRequested = true;
    requestAnimationFrame(processBakeQueueFrame);
  }

  function ensureSupersampleTargetSize(width, height) {
    const supersampleTarget = getSupersampleTarget();
    if (supersampleTarget.width === width && supersampleTarget.height === height) return;
    supersampleTarget.setSize(width, height);
  }

  function renderPatchDescriptor(descriptor, target) {
    const currentSupersample = Math.min(
      getCurrentSupersample(),
      autoSupersampleForDescriptor(descriptor, maxTextureSize),
    );
    const internalWidth = descriptorPrecisionWidth(descriptor, currentSupersample);
    const internalHeight = descriptorPrecisionHeight(descriptor, currentSupersample);
    const sourcePerTarget = internalWidth / descriptor.storageSize.width;
    const currentCameraInfo = getCurrentCameraInfo();
    const supersampleTarget = getSupersampleTarget();

    setStarBakeGeometry(createBakeGeometry(descriptor));
    ensureSupersampleTargetSize(internalWidth, internalHeight);
    bakeUniforms.uBakeSize.value.set(internalWidth, internalHeight);
    bakeUniforms.uOutputSize.value.set(descriptor.storageSize.width, descriptor.storageSize.height);
    bakeUniforms.uTileUvMin.value.copy(descriptor.storageUvMin);
    bakeUniforms.uTileUvSize.value.copy(descriptor.storageUvSize);
    bakeUniforms.uScreenPixelAngle.value = screenPixelAngleFromInfo(currentCameraInfo);

    renderer.setRenderTarget(supersampleTarget);
    renderer.clear();
    renderer.render(starScene, bakeCamera);

    downsampleUniforms.uSourceTexture.value = supersampleTarget.texture;
    downsampleUniforms.uSourceSize.value.set(internalWidth, internalHeight);
    downsampleUniforms.uTargetSize.value.set(descriptor.storageSize.width, descriptor.storageSize.height);
    downsampleUniforms.uSourcePerTarget.value = sourcePerTarget;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(downsampleScene, bakeCamera);
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
        descriptor.currentTarget = targetForDescriptor(descriptor, `Baked skydome patch ${descriptor.x + 1},${descriptor.y + 1}`);
      }
      descriptor.target = descriptor.currentTarget;
      descriptor.nextTarget = null;
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
      return descriptor.currentTarget;
    }

    descriptor.currentTarget = targetForDescriptor(descriptor, `Baked skydome patch ${descriptor.x + 1},${descriptor.y + 1}`);
    descriptor.target = descriptor.currentTarget;
    descriptor.nextTarget = null;
    descriptor.fallbackState = FALLBACK_STATES.EMPTY;
    descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
    return descriptor.currentTarget;
  }

  function markPatchDescriptorsQueued() {
    enqueueBakeJobs(getPatchDescriptors(), null, { replace: true });
  }

  function markPatchDescriptorsStale(reason = "stale") {
    getPatchDescriptors().forEach((descriptor) => {
      if (descriptor.state === PATCH_STATES.RESIDENT) {
        descriptor.state = PATCH_STATES.STALE;
      }
      if (descriptor.state !== PATCH_STATES.EMPTY) {
        descriptor.layerDirty = true;
        descriptor.layerDirtyReason = reason;
      }
    });
    updateDemandStats();
  }

  function scheduleLayerBakeJobs(descriptors, reason = "screen", delay = CAMERA_BAKE_IDLE_MS) {
    if (!descriptors.length) return;

    clearTimeout(layerBakeTimer);
    layerBakeTimer = window.setTimeout(() => {
      layerBakeTimer = 0;
      enqueueBakeJobs(descriptors, reason);
      requestBakeQueueProcessing();
    }, Math.max(0, delay));
    syncBakeQueueStats();
  }

  function processBakeQueueFrame() {
    bakeQueueFrameRequested = false;
    if (bakeJobQueue.length === 0 || activeBakeJob) {
      syncBakeQueueStats();
      if (!activeBakeJob) {
        setBakeStatus("Bake");
        onBakeQueueDrained();
      }
      return;
    }

    const bakeStart = performance.now();
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = new THREE.Color();
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    const jobsThisFrame = MAX_BAKE_JOBS_PER_FRAME;
    let completedThisFrame = 0;

    setCurrentSupersample(getCurrentPatchLayout().supersample ?? getCurrentSupersample());
    ensureStarCatalog();
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);

    while (completedThisFrame < jobsThisFrame && bakeJobQueue.length > 0) {
      const job = bakeJobQueue.shift();
      queuedBakeJobsByPatchId.delete(job.patchId);
      const descriptor = descriptorById(job.patchId);
      if (!descriptor) {
        continue;
      }
      const bakeTarget = prepareDescriptorBakeTarget(descriptor);
      if (!bakeTarget) continue;

      activeBakeJob = job;
      descriptor.state = PATCH_STATES.BAKING;
      syncBakeQueueStats();
      setBakeStatus(`Baking ${completedBakeJobs + 1}/${totalQueuedBakeJobs}`, true);

      const patchStart = performance.now();
      renderPatchDescriptor(descriptor, bakeTarget);
      skydome.promoteDescriptorBakeTarget(descriptor, bakeTarget);
      onDescriptorBaked(descriptor, bakeTarget);
      descriptor.lastBakeReason = job.reason;
      descriptor.lastBakeDurationMs = Number((performance.now() - patchStart).toFixed(2));
      descriptor.state = PATCH_STATES.RESIDENT;
      activeBakeJob = null;
      completedBakeJobs += 1;
      completedThisFrame += 1;
    }

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    stats.bakes += completedThisFrame;
    setCurrentSupersample(getCurrentPatchLayout().supersample ?? getCurrentSupersample());
    updatePatchStats();
    stats.lastBakeMs = Number((performance.now() - bakeStart).toFixed(2));
    syncBakeQueueStats();

    if (bakeJobQueue.length > 0) {
      setBakeStatus(`Baking ${completedBakeJobs}/${totalQueuedBakeJobs}`, true);
      requestBakeQueueProcessing();
    } else {
      setBakeStatus("Bake");
      onBakeQueueDrained();
    }
    notifyReadouts();
    requestRender();
  }

  function bakeNow() {
    clearTimeout(bakeTimer);
    clearTimeout(layerBakeTimer);
    layerBakeTimer = 0;
    completedBakeJobs = 0;
    totalQueuedBakeJobs = 0;
    markPatchDescriptorsQueued();
    setBakeStatus("Baking", true);
    requestBakeQueueProcessing();
  }

  function scheduleBake(delay = 180) {
    clearTimeout(bakeTimer);
    bakeTimer = window.setTimeout(bakeNow, delay);
  }

  function dispose() {
    clearBakeQueue();
    clearTimeout(bakeTimer);
    clearTimeout(layerBakeTimer);
  }

  return {
    bakeJobQueue,
    queuedBakeJobsByPatchId,
    queueState,
    syncBakeQueueStats,
    enqueueBakeJobs,
    clearBakeQueue,
    requestBakeQueueProcessing,
    markPatchDescriptorsStale,
    scheduleLayerBakeJobs,
    bakeNow,
    scheduleBake,
    dispose,
    get activeBakeJob() {
      return activeBakeJob;
    },
  };
}
