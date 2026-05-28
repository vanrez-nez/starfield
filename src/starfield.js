import * as THREE from "three";
import {
  ALLOCATION_STATES,
  BRIGHT_STAR_OVERLAY_ENABLED,
  BRIGHT_STAR_OVERLAY_RADIUS_SCALE,
  BRIGHT_STAR_OVERLAY_STRENGTH,
  BYTES_PER_MIB,
  CATALOG_PARAMS,
  DEFAULT_ADAPTIVE_QUALITY,
  DOME_RADIUS,
  FALLBACK_STATES,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  PATCH_STATES,
  REFERENCE_BAKE_HEIGHT,
  SPARSE_PATCH_MODES,
  STAR_QUERY_SEAM_COPIES,
  clamp,
  estimateTextureBytes,
  formatBytes,
  screenPixelAngleFromInfo,
  sizeLabel,
} from "./starfield/constants.js";
import {
  autoSupersampleForLayout,
  createPatchDescriptors as createPatchDescriptorList,
  createPatchLayout,
  defaultBakeWidth,
  maxDescriptorPrecisionSize,
  patchGridLabel,
  supportedBakeWidths,
} from "./starfield/patch-layout.js";
import {
  createCatalogOverlayAndStats,
  createEmptyOverlayGeometry,
  createEmptyStarGeometry,
  createStarGeometryForDescriptor,
  syncOverlayStats as syncCatalogOverlayStats,
} from "./starfield/catalog.js";
import { createRenderTargetManager } from "./starfield/render-targets.js";
import {
  createDownsampleMaterial,
  createOverlayMaterial,
  createStarMaterial,
} from "./starfield/shaders.js";
import { createSkydomeManager } from "./starfield/skydome.js";
import {
  collectStatsPayload,
  computeDemandReadouts as computeDemandReadoutsFromStats,
  computeMemoryReadouts as computeMemoryReadoutsFromStats,
  createInitialStats,
  patchDescriptorSummary as patchDescriptorSummaryFromStats,
  updatePatchDescriptorDemand as updatePatchDescriptorDemandFromStats,
  updatePatchStats as updatePatchStatsFromStats,
  updateSphereSegmentStats,
} from "./starfield/stats.js";
import { createBakePipeline } from "./starfield/bake-pipeline.js";

export function createStarfield({ renderer, scene, requestRender }) {
  const targetManager = createRenderTargetManager({ renderer });
  const maxTextureSize = targetManager.maxTextureSize;
  const accumulationType = targetManager.accumulationType;
  const accumulationTypeLabel = targetManager.halfFloatAccumulationSupported ? "HalfFloatType" : "UnsignedByteType";

  const starScene = new THREE.Scene();
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let pipeline;
  let bakeStatusHandler = () => {};
  let readoutsChangeHandler = () => {};
  let brightStarOverlayEnabled = BRIGHT_STAR_OVERLAY_ENABLED;
  let catalogDirty = true;

  const initialBakeWidth = defaultBakeWidth(maxTextureSize);
  const defaultPatchLayout = createPatchLayout(initialBakeWidth, maxTextureSize);
  const defaults = {
    uDensity: 104,
    uSparsity: 0.79,
    uStarSize: 0.9,
    uSizeVar: 0.58,
    uBright: 1.7,
    uBrightVar: 0.7,
    uGlareSize: 1.4,
    uGlareStr: 0.24,
    uGlareVar: 0.64,
    uColorVar: 0.64,
    uSeed: 1,
    bakeWidth: initialBakeWidth,
    sphereSegments: 128,
    ...DEFAULT_ADAPTIVE_QUALITY,
  };

  let currentSphereSegments = defaults.sphereSegments;
  const adaptiveQuality = { ...DEFAULT_ADAPTIVE_QUALITY };
  const stats = createInitialStats({
    defaults,
    defaultPatchLayout,
    supersample: autoSupersampleForLayout(defaultPatchLayout, maxTextureSize),
    maxTextureSize,
    accumulationTypeLabel,
    currentSphereSegments,
  });
  window.starfieldStats = stats;

  const fallbackPatchTexture = targetManager.createFallbackPatchTexture();
  const fallbackPatchTarget = { texture: fallbackPatchTexture };

  const bakeUniforms = {
    uBakeSize: { value: new THREE.Vector2(
      defaultPatchLayout.storageWidth * autoSupersampleForLayout(defaultPatchLayout, maxTextureSize),
      defaultPatchLayout.storageHeight * autoSupersampleForLayout(defaultPatchLayout, maxTextureSize),
    ) },
    uOutputSize: { value: new THREE.Vector2(defaults.bakeWidth, defaults.bakeWidth / 2) },
    uTileUvMin: { value: new THREE.Vector2(0, 0) },
    uTileUvSize: { value: new THREE.Vector2(1, 1) },
    uScreenPixelAngle: { value: Math.PI / REFERENCE_BAKE_HEIGHT },
    uReferenceHeight: { value: REFERENCE_BAKE_HEIGHT },
    uDensity: { value: defaults.uDensity },
    uSparsity: { value: defaults.uSparsity },
    uStarSize: { value: defaults.uStarSize },
    uSizeVar: { value: defaults.uSizeVar },
    uBright: { value: defaults.uBright },
    uBrightVar: { value: defaults.uBrightVar },
    uGlareSize: { value: defaults.uGlareSize },
    uGlareStr: { value: defaults.uGlareStr },
    uGlareVar: { value: defaults.uGlareVar },
    uColorVar: { value: defaults.uColorVar },
    uSeed: { value: defaults.uSeed },
    uOverlayEnabled: { value: BRIGHT_STAR_OVERLAY_ENABLED ? 1 : 0 },
  };

  const starMaterial = createStarMaterial(bakeUniforms);
  let starGeometry = createEmptyStarGeometry();
  const starMesh = new THREE.Mesh(starGeometry, starMaterial);
  starMesh.frustumCulled = false;
  starScene.add(starMesh);

  const overlayUniforms = {
    uRadius: { value: DOME_RADIUS * BRIGHT_STAR_OVERLAY_RADIUS_SCALE },
    uScreenPixelAngle: bakeUniforms.uScreenPixelAngle,
    uReferenceHeight: bakeUniforms.uReferenceHeight,
    uStarSize: bakeUniforms.uStarSize,
    uSizeVar: bakeUniforms.uSizeVar,
    uBright: bakeUniforms.uBright,
    uBrightVar: bakeUniforms.uBrightVar,
    uGlareSize: bakeUniforms.uGlareSize,
    uGlareStr: bakeUniforms.uGlareStr,
    uGlareVar: bakeUniforms.uGlareVar,
    uColorVar: bakeUniforms.uColorVar,
    uOverlayStrength: { value: BRIGHT_STAR_OVERLAY_STRENGTH },
  };
  const overlayMaterial = createOverlayMaterial(overlayUniforms);
  let overlayGeometry = createEmptyOverlayGeometry();
  const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
  overlayMesh.frustumCulled = false;
  overlayMesh.renderOrder = 20;
  overlayMesh.visible = brightStarOverlayEnabled && overlayGeometry.instanceCount > 0;
  scene.add(overlayMesh);

  const downsampleUniforms = {
    uSourceTexture: { value: null },
    uSourceSize: { value: new THREE.Vector2(1, 1) },
    uTargetSize: { value: new THREE.Vector2(1, 1) },
    uSourcePerTarget: { value: 1 },
    uExposure: { value: 1 },
  };
  const downsampleMaterial = createDownsampleMaterial(downsampleUniforms);
  const downsampleScene = new THREE.Scene();
  const downsampleQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), downsampleMaterial);
  downsampleQuad.frustumCulled = false;
  downsampleScene.add(downsampleQuad);

  let currentBakeWidth = defaults.bakeWidth;
  let currentPatchLayout = createPatchLayout(currentBakeWidth, maxTextureSize);
  let currentSupersample = autoSupersampleForLayout(currentPatchLayout, maxTextureSize);
  let patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
  let supersampleTarget = targetManager.createAccumulationTarget(
    maxDescriptorPrecisionSize(patchDescriptors, currentSupersample).width,
    maxDescriptorPrecisionSize(patchDescriptors, currentSupersample).height,
  );
  let currentCameraInfo = {
    horizontalFov: 0,
    verticalFov: 0,
    screenWidth: 1,
    screenHeight: 1,
    cssWidth: 1,
    cssHeight: 1,
    pixelRatio: 1,
    forwardX: 0,
    forwardY: 0,
    forwardZ: -1,
  };

  const skydome = createSkydomeManager({
    scene,
    requestRender,
    targetManager,
    fallbackPatchTarget,
    getSphereSegments: () => currentSphereSegments,
    onBlendStatsChange: () => pipeline?.syncBakeQueueStats(),
  });
  skydome.rebuildBakedDomeMeshes(patchDescriptors);
  pipeline = createBakePipeline({
    renderer,
    starScene,
    bakeCamera,
    downsampleScene,
    downsampleUniforms,
    bakeUniforms,
    adaptiveQuality,
    maxTextureSize,
    stats,
    skydome,
    getCurrentCameraInfo: () => currentCameraInfo,
    getCurrentPatchLayout: () => currentPatchLayout,
    getCurrentSupersample: () => currentSupersample,
    setCurrentSupersample: (value) => {
      currentSupersample = value;
    },
    getPatchDescriptors: () => patchDescriptors,
    getSupersampleTarget: () => supersampleTarget,
    targetForDescriptor,
    descriptorById,
    setStarBakeGeometry,
    createBakeGeometry: (descriptor) => createStarGeometryForDescriptor({
      descriptor,
      bakeUniforms,
      currentCameraInfo,
      brightStarOverlayEnabled,
      stats,
    }),
    ensureStarCatalog,
    updatePatchStats,
    updateDemandStats,
    notifyReadouts,
    setBakeStatus,
    requestRender,
  });

  function makeStatsContext() {
    return {
      adaptiveQuality,
      currentCameraInfo,
      currentPatchLayout,
      currentBakeWidth,
      currentSupersample,
      patchDescriptors,
      maxTextureSize,
      accumulationType,
      accumulationTypeLabel,
      bakeUniforms,
      catalogDirty,
      stats,
      targetManager,
      queueState: pipeline.queueState(),
      activeSparseMode,
      activeBlendCount: skydome.activeBlendCount,
      setCameraInfo,
      syncOverlayStats,
    };
  }

  function setBakeStatus(label, disabled = false) {
    bakeStatusHandler(label, disabled);
  }

  function notifyReadouts() {
    readoutsChangeHandler(getReadouts());
  }

  function supportedWidths() {
    return supportedBakeWidths(maxTextureSize);
  }

  function targetForDescriptor(descriptor, name = "Baked skydome patch") {
    return targetManager.acquireTarget(descriptor.storageSize.width, descriptor.storageSize.height, {
      name,
      wrapS: descriptor.wrapS,
      wrapT: descriptor.wrapT,
    });
  }

  function createPatchDescriptorsWithTargets(layout) {
    const descriptors = createPatchDescriptorList(layout, maxTextureSize);
    descriptors.forEach((descriptor) => {
      descriptor.currentTarget = targetForDescriptor(descriptor, `Baked skydome patch ${descriptor.x + 1},${descriptor.y + 1}`);
      descriptor.target = descriptor.currentTarget;
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
    });
    return descriptors;
  }

  function descriptorById(patchId) {
    return patchDescriptors.find((descriptor) => descriptor.id === patchId) ?? null;
  }

  function syncOverlayStats() {
    syncCatalogOverlayStats({
      overlayGeometry,
      overlayMesh,
      stats,
      brightStarOverlayEnabled,
    });
  }

  function rebuildStarCatalog() {
    const { overlayGeometry: nextOverlayGeometry, classStats } = createCatalogOverlayAndStats({
      bakeUniforms,
      brightStarOverlayEnabled,
    });
    overlayMesh.geometry = nextOverlayGeometry;
    overlayGeometry.dispose();
    overlayGeometry = nextOverlayGeometry;
    overlayMesh.visible = brightStarOverlayEnabled && classStats.overlayStarCount > 0;
    catalogDirty = false;
    stats.starCount = classStats.starClassTotal;
    stats.starInstances = classStats.bakedCandidateStarCount * STAR_QUERY_SEAM_COPIES;
    Object.assign(stats, classStats);
    syncOverlayStats();
  }

  function markCatalogDirty() {
    catalogDirty = true;
  }

  function ensureStarCatalog() {
    if (catalogDirty) {
      rebuildStarCatalog();
    }
  }

  function setStarBakeGeometry(nextGeometry) {
    starMesh.geometry = nextGeometry;
    starGeometry.dispose();
    starGeometry = nextGeometry;
  }

  function computeDemandReadouts() {
    return computeDemandReadoutsFromStats(makeStatsContext());
  }

  function computeMemoryReadouts(demand = computeDemandReadouts()) {
    return computeMemoryReadoutsFromStats(makeStatsContext(), demand);
  }

  function updatePatchDescriptorDemand(demand) {
    updatePatchDescriptorDemandFromStats(makeStatsContext(), demand);
  }

  function patchDescriptorSummary() {
    return patchDescriptorSummaryFromStats(makeStatsContext());
  }

  function activeSparseMode() {
    return adaptiveQuality.adaptiveResolution
      ? adaptiveQuality.sparseMode
      : SPARSE_PATCH_MODES.FULL;
  }

  function descriptorTextureBytes(descriptor) {
    return estimateTextureBytes(
      descriptor.storageSize.width,
      descriptor.storageSize.height,
      FINAL_TEXTURE_BYTES_PER_PIXEL,
    );
  }

  function descriptorVisibleInCamera(descriptor) {
    const horizontalFovRad = THREE.MathUtils.degToRad(Math.max(Number(currentCameraInfo.horizontalFov) || 0, 0.001));
    const verticalFovRad = THREE.MathUtils.degToRad(Math.max(Number(currentCameraInfo.verticalFov) || 0, 0.001));
    const halfViewDiagonal = Math.hypot(horizontalFovRad, verticalFovRad) * 0.5;
    const patchRadius = Math.hypot(descriptor.angularWidthRad, descriptor.angularHeightRad) * 0.5;
    return descriptor.priorityCenterAngleRad <= halfViewDiagonal + patchRadius;
  }

  function sparseScoreForDescriptor(descriptor, mode) {
    const basePriority = descriptor.priority / Math.max(descriptor.priorityStaleWeight, 0.001);
    if (mode === SPARSE_PATCH_MODES.VISIBLE) {
      return descriptor.sparseVisible ? basePriority : -1;
    }
    if (mode === SPARSE_PATCH_MODES.CENTER) {
      return basePriority * (0.5 + descriptor.priorityCenterWeight);
    }
    if (mode === SPARSE_PATCH_MODES.DENSITY) {
      const densityRelief = Math.max(0.2, descriptor.densityScale);
      const brightImportance = 1 + Math.min(3, descriptor.brightStarPressure * 8192);
      return basePriority * densityRelief * brightImportance;
    }
    return basePriority;
  }

  function releaseDescriptorTargetsToPool(descriptor) {
    const targets = new Set([
      descriptor.currentTarget,
      descriptor.nextTarget,
      descriptor.target,
      descriptor.blendFromTarget,
      descriptor.blendToTarget,
    ].filter(Boolean));

    targets.forEach((target) => targetManager.releaseTarget(target));
  }

  function evictDescriptorToSparseFallback(descriptor) {
    if (descriptor.state === PATCH_STATES.BAKING || pipeline.activeBakeJob?.patchId === descriptor.id) return false;

    pipeline.removeQueuedBakeJobForDescriptor(descriptor);
    releaseDescriptorTargetsToPool(descriptor);
    skydome.bindDescriptorFallback(descriptor);
    descriptor.sparseEvicted = true;
    return true;
  }

  function sparseSelectionForCurrentPriorities() {
    const mode = activeSparseMode();
    const patchBudgetBytes = Math.max(BYTES_PER_MIB, adaptiveQuality.patchBudgetMb * BYTES_PER_MIB);
    const sorted = [...patchDescriptors]
      .map((descriptor) => {
        descriptor.sparseVisible = descriptorVisibleInCamera(descriptor);
        descriptor.sparseScore = sparseScoreForDescriptor(descriptor, mode);
        return descriptor;
      })
      .sort((a, b) => (b.sparseScore - a.sparseScore) || a.id.localeCompare(b.id));

    if (mode === SPARSE_PATCH_MODES.FULL) {
      return {
        mode,
        wanted: new Set(patchDescriptors),
        budgetBytes: patchBudgetBytes,
        budgetUsedBytes: patchDescriptors.reduce((bytes, descriptor) => bytes + descriptorTextureBytes(descriptor), 0),
        visibleCount: patchDescriptors.filter((descriptor) => descriptor.sparseVisible).length,
        summary: "full-grid",
      };
    }

    const primaryCandidates = mode === SPARSE_PATCH_MODES.VISIBLE
      ? sorted.filter((descriptor) => descriptor.sparseVisible)
      : sorted;
    const candidates = primaryCandidates.length > 0 ? primaryCandidates : sorted;
    const wanted = new Set();
    let budgetUsedBytes = 0;

    for (const descriptor of candidates) {
      if (descriptor.sparseScore < 0 && wanted.size > 0) continue;

      const cost = descriptorTextureBytes(descriptor);
      if (wanted.size > 0 && budgetUsedBytes + cost > patchBudgetBytes) continue;

      wanted.add(descriptor);
      budgetUsedBytes += cost;
    }

    if (wanted.size === 0 && sorted.length > 0) {
      const descriptor = sorted[0];
      const cost = descriptorTextureBytes(descriptor);
      if (cost <= patchBudgetBytes) {
        wanted.add(descriptor);
        budgetUsedBytes += cost;
      }
    }

    const summary = [...wanted]
      .sort((a, b) => b.sparseScore - a.sparseScore)
      .slice(0, 5)
      .map((descriptor) => `${descriptor.id}:${descriptor.sparseScore.toFixed(1)}`)
      .join(", ") || "none";

    return {
      mode,
      wanted,
      budgetBytes: patchBudgetBytes,
      budgetUsedBytes,
      visibleCount: patchDescriptors.filter((descriptor) => descriptor.sparseVisible).length,
      summary,
    };
  }

  function applySparseResidency() {
    const selection = sparseSelectionForCurrentPriorities();
    let changed = false;
    let queuedSparseBake = false;

    patchDescriptors.forEach((descriptor) => {
      const wanted = selection.wanted.has(descriptor);
      descriptor.sparseWanted = wanted;
      descriptor.sparseEvicted = !wanted;

      if (wanted) {
        if (descriptor.fallbackState === FALLBACK_STATES.SPARSE && descriptor.allocationState === ALLOCATION_STATES.UNALLOCATED) {
          descriptor.state = PATCH_STATES.EMPTY;
        }
        if (selection.mode !== SPARSE_PATCH_MODES.FULL && descriptor.allocationState === ALLOCATION_STATES.UNALLOCATED) {
          queuedSparseBake = pipeline.queueSparseBakeForDescriptor(descriptor) || queuedSparseBake;
        }
        return;
      }

      if (
        descriptor.currentTarget
        || descriptor.nextTarget
        || descriptor.target
        || descriptor.blendFromTarget
        || descriptor.blendToTarget
        || descriptor.allocationState !== ALLOCATION_STATES.UNALLOCATED
      ) {
        changed = evictDescriptorToSparseFallback(descriptor) || changed;
      } else {
        skydome.bindDescriptorFallback(descriptor);
      }
    });

    if (queuedSparseBake) {
      pipeline.sortBakeQueue();
      pipeline.requestBakeQueueProcessing();
    }
    pipeline.syncBakeQueueStats();
    stats.sparseMode = adaptiveQuality.sparseMode;
    stats.effectiveSparseMode = selection.mode;
    stats.sparseWantedPatchCount = selection.wanted.size;
    stats.sparseResidentPatchCount = patchDescriptors.filter((descriptor) => descriptor.sparseWanted && descriptor.allocationState === ALLOCATION_STATES.ALLOCATED).length;
    stats.sparseEvictedPatchCount = patchDescriptors.filter((descriptor) => descriptor.sparseEvicted).length;
    stats.sparseFallbackPatchCount = patchDescriptors.filter((descriptor) => descriptor.fallbackState === FALLBACK_STATES.SPARSE).length;
    stats.sparseVisiblePatchCount = selection.visibleCount;
    stats.sparseBudgetUsedBytes = selection.budgetUsedBytes;
    stats.sparseBudgetUsedMemory = formatBytes(selection.budgetUsedBytes);
    stats.sparseBudgetRatio = selection.budgetUsedBytes / selection.budgetBytes;
    stats.sparseBudgetExceeded = selection.budgetUsedBytes > selection.budgetBytes;
    stats.sparseSelectionSummary = selection.summary;

    if (changed) {
      requestRender();
    }
  }

  function updateDemandStats() {
    const demand = computeDemandReadouts();
    updatePatchDescriptorDemand(demand);
    applySparseResidency();
    Object.assign(stats, demand, computeMemoryReadouts(demand), patchDescriptorSummary());
  }

  function updatePatchStats() {
    updatePatchStatsFromStats(makeStatsContext());
    updateDemandStats();
  }

  function rebuildDisplayGeometry() {
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    updateSphereSegmentStats(stats, currentSphereSegments);
    requestRender();
  }

  function disposePatchDescriptors(descriptors, { releaseTargets = true } = {}) {
    descriptors.forEach((descriptor) => {
      descriptor.state = PATCH_STATES.EVICTING;
      const targets = new Set([
        descriptor.currentTarget,
        descriptor.nextTarget,
        descriptor.target,
        descriptor.blendFromTarget,
        descriptor.blendToTarget,
      ].filter(Boolean));

      targets.forEach((target) => {
        if (releaseTargets) {
          targetManager.releaseTarget(target);
        } else {
          targetManager.disposePatchTarget(target);
        }
      });
      descriptor.target = null;
      descriptor.currentTarget = null;
      descriptor.nextTarget = null;
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.UNALLOCATED;
      skydome.clearBlendForDescriptor(descriptor);
    });
  }

  function setBakeWidth(width) {
    if (width === currentBakeWidth) return;

    const nextLayout = createPatchLayout(width, maxTextureSize);
    if (!nextLayout) return;

    const previousDescriptors = patchDescriptors;
    pipeline.clearBakeQueue();
    currentBakeWidth = width;
    currentPatchLayout = nextLayout;
    currentSupersample = autoSupersampleForLayout(currentPatchLayout, maxTextureSize);
    skydome.disposeBakedDomeMeshes();
    disposePatchDescriptors(previousDescriptors);
    patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
    targetManager.trimTargetPoolToBudget(adaptiveQuality.patchBudgetMb * BYTES_PER_MIB);
    const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
    pipeline.ensureSupersampleTargetSize(precisionSize.width, precisionSize.height);
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    updatePatchStats();
    notifyReadouts();
    requestRender();
    pipeline.scheduleBake(0);
  }

  function setParam(key, value, delay = 180) {
    if (!bakeUniforms[key]) return;
    bakeUniforms[key].value = value;
    if (CATALOG_PARAMS.has(key)) {
      markCatalogDirty();
    }
    pipeline.markPatchDescriptorsStale();
    updateDemandStats();
    notifyReadouts();
    pipeline.scheduleBake(delay);
  }

  function setAdaptiveParam(key, value) {
    if (!(key in adaptiveQuality)) return;
    const wasAdaptive = adaptiveQuality.adaptiveResolution;

    if (key === "adaptiveResolution") {
      adaptiveQuality[key] = Boolean(value);
    } else if (key === "targetTexelsPerPixel") {
      adaptiveQuality[key] = clamp(Number(value), 0.25, 4);
    } else if (key === "minPatchSize") {
      adaptiveQuality[key] = clamp(Number(value), 128, maxTextureSize);
    } else if (key === "maxPatchSize") {
      adaptiveQuality[key] = clamp(Number(value), 128, maxTextureSize);
    } else if (key === "patchBudgetMb") {
      adaptiveQuality[key] = clamp(Number(value), 16, 4096);
    } else if (key === "centerBias") {
      adaptiveQuality[key] = clamp(Number(value), 0, 1);
    } else if (key === "sparseMode") {
      adaptiveQuality[key] = Object.values(SPARSE_PATCH_MODES).includes(value)
        ? value
        : SPARSE_PATCH_MODES.FULL;
    }

    if (key === "patchBudgetMb" || key === "sparseMode") {
      targetManager.trimTargetPoolToBudget(adaptiveQuality.patchBudgetMb * BYTES_PER_MIB);
    }
    updateDemandStats();
    if (adaptiveQuality.adaptiveResolution && (wasAdaptive || key === "adaptiveResolution" || key === "sparseMode")) {
      pipeline.markCurrentCameraQueued();
      pipeline.enqueueBakeJobs(patchDescriptors, "upgrade", { replace: true });
      pipeline.requestBakeQueueProcessing();
    }
    notifyReadouts();
  }

  function setSphereSegments(value) {
    currentSphereSegments = value;
    rebuildDisplayGeometry();
  }

  function setBrightStarOverlayEnabled(enabled) {
    brightStarOverlayEnabled = Boolean(enabled);
    bakeUniforms.uOverlayEnabled.value = brightStarOverlayEnabled ? 1 : 0;
    markCatalogDirty();
    pipeline.markPatchDescriptorsStale();
    syncOverlayStats();
    updateDemandStats();
    notifyReadouts();
    pipeline.scheduleBake(0);
    requestRender();
  }

  function reseed() {
    bakeUniforms.uSeed.value = Math.random() * 1000;
    markCatalogDirty();
    pipeline.markPatchDescriptorsStale();
    pipeline.scheduleBake(0);
  }

  function getReadouts() {
    const demand = computeDemandReadouts();
    updatePatchDescriptorDemand(demand);
    const memory = computeMemoryReadouts(demand);
    const descriptors = patchDescriptorSummary();
    const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
    return {
      bakeWidth: currentBakeWidth,
      supportedBakeWidths: supportedWidths(),
      patchGrid: patchGridLabel(currentPatchLayout),
      patchSize: sizeLabel(currentPatchLayout.contentWidth, currentPatchLayout.contentHeight),
      supersample: `${currentSupersample}x`,
      internalPatchSize: sizeLabel(precisionSize.width, precisionSize.height),
      gpuLimit: `${maxTextureSize}`,
      adaptive: { ...adaptiveQuality },
      demand,
      memory,
      descriptors,
    };
  }

  function setCameraInfo(cameraInfo, options = {}) {
    const { notify = true } = options;
    currentCameraInfo = {
      ...currentCameraInfo,
      ...cameraInfo,
    };
    pipeline.noteCameraMotion();
    stats.horizontalFov = currentCameraInfo.horizontalFov;
    stats.verticalFov = currentCameraInfo.verticalFov;
    bakeUniforms.uScreenPixelAngle.value = screenPixelAngleFromInfo(currentCameraInfo);
    updateDemandStats();
    pipeline.maybeEnqueueCameraBakeJobs();
    if (notify) {
      notifyReadouts();
    }
  }

  function recordRender() {
    stats.renders += 1;
    if (skydome.advancePatchBlends()) {
      requestRender();
    }
  }

  function collectStats(rendererInfo, cameraInfo = {}) {
    return collectStatsPayload(makeStatsContext(), rendererInfo, cameraInfo);
  }

  function dispose() {
    pipeline.clearBakeQueue();
    disposePatchDescriptors(patchDescriptors, { releaseTargets: false });
    targetManager.disposeTargetPool();
    skydome.dispose();
    supersampleTarget.dispose();
    starGeometry.dispose();
    starMaterial.dispose();
    overlayGeometry.dispose();
    overlayMaterial.dispose();
    fallbackPatchTexture.dispose();
    downsampleQuad.geometry.dispose();
    downsampleMaterial.dispose();
    scene.remove(overlayMesh);
  }

  function setBakeStatusHandler(handler) {
    bakeStatusHandler = handler;
  }

  function setReadoutsChangeHandler(handler) {
    readoutsChangeHandler = handler;
  }

  updatePatchStats();

  return {
    defaults,
    getSupportedBakeWidths: supportedWidths,
    getReadouts,
    setParam,
    setAdaptiveParam,
    setSphereSegments,
    setBrightStarOverlayEnabled,
    setBakeWidth,
    reseed,
    bakeNow: pipeline.bakeNow,
    scheduleBake: pipeline.scheduleBake,
    collectStats,
    dispose,
    setBakeStatusHandler,
    setReadoutsChangeHandler,
    setCameraInfo,
    recordRender,
  };
}
