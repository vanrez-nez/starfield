import * as THREE from "three";
import {
  ALLOCATION_STATES,
  BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS,
  BRIGHT_STAR_OVERLAY_ENABLED,
  CATALOG_PARAMS,
  DEFAULT_ADAPTIVE_QUALITY,
  DEFAULT_BAKED_STAR_RADIUS,
  DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS,
  DEFAULT_LARGE_STAR_RARITY,
  DEFAULT_SKY_BACKGROUND_RADIUS,
  FALLBACK_STATES,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  PATCH_STATES,
  REFERENCE_BAKE_HEIGHT,
  SPARSE_PATCH_MODES,
  STARFIELD_ALLOCATION_BUDGET_BYTES,
  STAR_QUERY_SEAM_COPIES,
  estimateTextureBytes,
  formatBytes,
  screenPixelAngleFromInfo,
  sizeLabel,
} from "./starfield/constants.js";
import {
  assignDescriptorStorage,
  createAutoPatchLayout,
  createPatchDescriptors as createPatchDescriptorList,
  maxDescriptorPrecisionSize,
  patchGridLabel,
} from "./starfield/patch-layout.js";
import {
  catalogStarCount,
  createEmptyStarGeometry,
  createStarGeometryForDescriptor,
} from "./starfield/catalog.js";
import { createRenderTargetManager } from "./starfield/render-targets.js";
import {
  createDownsampleMaterial,
  createStarMaterial,
} from "./starfield/shaders.js";
import { createSkydomeManager } from "./starfield/skydome.js";
import { createStarLayerManager } from "./starfield/star-layers.js";
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
  let overlayCatalogDirty = true;
  let autoLayoutTimer = 0;
  let pendingAutoLayoutKey = "";
  let pendingDisplaySwap = null;
  let layoutInitialized = false;
  let currentCameraInfo = {
    horizontalFov: 60,
    verticalFov: 60,
    screenWidth: 1,
    screenHeight: 1,
    cssWidth: 1,
    cssHeight: 1,
    pixelRatio: 1,
    forwardX: 0,
    forwardY: 0,
    forwardZ: -1,
  };

  const defaultPatchLayout = createAutoPatchLayout({
    cameraInfo: currentCameraInfo,
    maxTextureSize,
    accumulationType,
  });
  const initialBakeWidth = defaultPatchLayout.virtualWidth;
  const defaultStarParams = {
    uDensity: 360,
    uSparsity: 0.005,
    uStarSize: 5,
    uSizeVar: 0.95,
    uLargeStarRarity: DEFAULT_LARGE_STAR_RARITY,
    uBright: 5,
    uBrightVar: 0.95,
    uGlareSize: 7,
    uGlareStr: 0.24,
    uGlareVar: 0.95,
    uColorVar: 1,
    uSeed: 1,
  };
  const defaults = {
    ...defaultStarParams,
    bakeWidth: initialBakeWidth,
    sphereSegments: 32,
    skyBackgroundEnabled: true,
    skyBackgroundRadius: DEFAULT_SKY_BACKGROUND_RADIUS,
    bakedStarsEnabled: true,
    bakedStarsRadius: DEFAULT_BAKED_STAR_RADIUS,
    brightOverlayEnabled: BRIGHT_STAR_OVERLAY_ENABLED,
    brightOverlayRadius: DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS,
    ...DEFAULT_ADAPTIVE_QUALITY,
  };

  let currentSphereSegments = defaults.sphereSegments;
  const layerState = {
    skyBackground: {
      enabled: defaults.skyBackgroundEnabled,
      radius: defaults.skyBackgroundRadius,
    },
    bakedStars: {
      enabled: defaults.bakedStarsEnabled,
      radius: defaults.bakedStarsRadius,
      params: { ...defaultStarParams },
    },
    brightOverlay: {
      enabled: defaults.brightOverlayEnabled,
      radius: defaults.brightOverlayRadius,
      params: { ...defaultStarParams },
    },
  };
  const adaptiveQuality = { ...DEFAULT_ADAPTIVE_QUALITY, adaptiveResolution: true };
  const stats = createInitialStats({
    defaults,
    defaultPatchLayout,
    supersample: defaultPatchLayout.supersample,
    maxTextureSize,
    accumulationTypeLabel,
    currentSphereSegments,
  });
  window.starfieldStats = stats;

  const fallbackPatchTexture = targetManager.createFallbackPatchTexture();
  const fallbackPatchTarget = { texture: fallbackPatchTexture };
  const screenPixelAngleUniform = { value: Math.PI / REFERENCE_BAKE_HEIGHT };
  const referenceHeightUniform = { value: REFERENCE_BAKE_HEIGHT };

  const bakeUniforms = {
    uBakeSize: { value: new THREE.Vector2(
      defaultPatchLayout.storageWidth * defaultPatchLayout.supersample,
      defaultPatchLayout.storageHeight * defaultPatchLayout.supersample,
    ) },
    uOutputSize: { value: new THREE.Vector2(defaultPatchLayout.storageWidth, defaultPatchLayout.storageHeight) },
    uTileUvMin: { value: new THREE.Vector2(0, 0) },
    uTileUvSize: { value: new THREE.Vector2(1, 1) },
    uScreenPixelAngle: screenPixelAngleUniform,
    uReferenceHeight: referenceHeightUniform,
    uDensity: { value: layerState.bakedStars.params.uDensity },
    uSparsity: { value: layerState.bakedStars.params.uSparsity },
    uStarSize: { value: layerState.bakedStars.params.uStarSize },
    uSizeVar: { value: layerState.bakedStars.params.uSizeVar },
    uLargeStarRarity: { value: layerState.bakedStars.params.uLargeStarRarity },
    uBright: { value: layerState.bakedStars.params.uBright },
    uBrightVar: { value: layerState.bakedStars.params.uBrightVar },
    uGlareSize: { value: layerState.bakedStars.params.uGlareSize },
    uGlareStr: { value: layerState.bakedStars.params.uGlareStr },
    uGlareVar: { value: layerState.bakedStars.params.uGlareVar },
    uColorVar: { value: layerState.bakedStars.params.uColorVar },
    uSeed: { value: layerState.bakedStars.params.uSeed },
  };
  const overlayUniforms = {
    uScreenPixelAngle: screenPixelAngleUniform,
    uReferenceHeight: referenceHeightUniform,
    uDensity: { value: layerState.brightOverlay.params.uDensity },
    uSparsity: { value: layerState.brightOverlay.params.uSparsity },
    uStarSize: { value: layerState.brightOverlay.params.uStarSize },
    uSizeVar: { value: layerState.brightOverlay.params.uSizeVar },
    uLargeStarRarity: { value: layerState.brightOverlay.params.uLargeStarRarity },
    uBright: { value: layerState.brightOverlay.params.uBright },
    uBrightVar: { value: layerState.brightOverlay.params.uBrightVar },
    uGlareSize: { value: layerState.brightOverlay.params.uGlareSize },
    uGlareStr: { value: layerState.brightOverlay.params.uGlareStr },
    uGlareVar: { value: layerState.brightOverlay.params.uGlareVar },
    uColorVar: { value: layerState.brightOverlay.params.uColorVar },
    uSeed: { value: layerState.brightOverlay.params.uSeed },
  };
  layerState.bakedStars.uniforms = bakeUniforms;
  layerState.brightOverlay.uniforms = overlayUniforms;

  const starMaterial = createStarMaterial(bakeUniforms);
  let starGeometry = createEmptyStarGeometry();
  const starMesh = new THREE.Mesh(starGeometry, starMaterial);
  starMesh.frustumCulled = false;
  starScene.add(starMesh);

  const starLayers = createStarLayerManager({
    scene,
    overlayUniforms,
    requestRender,
    backgroundRadius: layerState.skyBackground.radius,
    overlayRadius: layerState.brightOverlay.radius,
    sphereSegments: currentSphereSegments,
  });
  starLayers.setEnabled(brightStarOverlayEnabled);

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
  let currentPatchLayout = defaultPatchLayout;
  let currentSupersample = currentPatchLayout.supersample;
  let patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
  let supersampleTarget = targetManager.createAccumulationTarget(1, 1);

  const skydome = createSkydomeManager({
    scene,
    requestRender,
    targetManager,
    fallbackPatchTarget,
    getSphereSegments: () => currentSphereSegments,
    initialRadius: layerState.bakedStars.radius,
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
    targetMatchesDescriptor,
    releaseTarget: (target) => targetManager.releaseTarget(target),
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
    onDescriptorBaked: recordDescriptorLayerBake,
    onBakeQueueDrained: () => {
      completePendingDisplaySwap();
      releaseBakeScratch();
      targetManager.disposeTargetPool();
      updatePatchStats();
      notifyReadouts();
    },
    requestRender,
  });

  function accumulationBytesPerPixel() {
    return accumulationType === THREE.HalfFloatType ? 8 : 4;
  }

  function currentBakeScratchBytes() {
    if (!supersampleTarget || supersampleTarget.width <= 1 || supersampleTarget.height <= 1) return 0;
    return estimateTextureBytes(supersampleTarget.width, supersampleTarget.height, accumulationBytesPerPixel());
  }

  function releaseBakeScratch() {
    if (!supersampleTarget || (supersampleTarget.width <= 1 && supersampleTarget.height <= 1)) return;
    supersampleTarget.setSize(1, 1);
  }

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
      overlayUniforms,
      catalogDirty,
      overlayCatalogDirty,
      layerState,
      stats,
      targetManager,
      allocationBudgetBytes: STARFIELD_ALLOCATION_BUDGET_BYTES,
      bakeScratchBytes: currentBakeScratchBytes(),
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
    return [currentBakeWidth];
  }

  function roundedNumber(value, digits = 4) {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function screenBakeSignature(cameraInfo = currentCameraInfo) {
    const screenWidth = Math.max(1, Math.round(Number(cameraInfo.screenWidth) || 1));
    const screenHeight = Math.max(1, Math.round(Number(cameraInfo.screenHeight) || 1));
    const pixelRatio = roundedNumber(cameraInfo.pixelRatio, 3);
    const horizontalFov = roundedNumber(cameraInfo.horizontalFov, 3);
    const verticalFov = roundedNumber(cameraInfo.verticalFov, 3);
    const screenPixelAngle = roundedNumber(screenPixelAngleFromInfo(cameraInfo), 12);
    const key = [
      `${screenWidth}x${screenHeight}`,
      `pr:${pixelRatio}`,
      `fov:${horizontalFov}x${verticalFov}`,
      `px:${screenPixelAngle}`,
    ].join("|");

    return {
      key,
      screenWidth,
      screenHeight,
      pixelRatio,
      horizontalFov,
      verticalFov,
      screenPixelAngle,
    };
  }

  function patchLayoutKey(layout) {
    return [
      `${layout.columns}x${layout.rows}`,
      `guard:${layout.guard}`,
      `content:${layout.contentWidth}x${layout.contentHeight}`,
      `ss:${layout.supersample ?? 1}`,
    ].join("|");
  }

  function computeAutoPatchLayout() {
    return createAutoPatchLayout({
      cameraInfo: currentCameraInfo,
      maxTextureSize,
      accumulationType,
    });
  }

  function plannedDescriptorContentSize(descriptor) {
    const sourceSize = descriptor.targetSize;
    return {
      width: sourceSize.width,
      height: sourceSize.height,
    };
  }

  function plannedDescriptorStorageSize(descriptor) {
    const contentSize = plannedDescriptorContentSize(descriptor);
    const assignedWidth = Math.min(maxTextureSize, Math.max(1, Math.round(contentSize.width)));
    const assignedHeight = Math.min(maxTextureSize, Math.max(1, Math.round(contentSize.height)));
    return {
      width: Math.min(maxTextureSize, assignedWidth + currentPatchLayout.guard * 2),
      height: Math.min(maxTextureSize, assignedHeight + currentPatchLayout.guard * 2),
    };
  }

  function desiredLayerBakeKey(descriptor, signature = screenBakeSignature()) {
    const storageSize = plannedDescriptorStorageSize(descriptor);
    return [
      descriptor.id,
      signature.key,
      `storage:${storageSize.width}x${storageSize.height}`,
      `overlay:${brightStarOverlayEnabled ? 1 : 0}`,
    ].join("|");
  }

  function applyDescriptorBakeStorage(descriptor) {
    const contentSize = plannedDescriptorContentSize(descriptor);
    assignDescriptorStorage(
      descriptor,
      contentSize.width,
      contentSize.height,
      currentPatchLayout.guard,
      maxTextureSize,
    );
  }

  function attachTargetSamplingMetadata(descriptor, target) {
    target.starfieldSampling = {
      innerOffset: descriptor.innerOffset.clone(),
      innerScale: descriptor.innerScale.clone(),
      storageUvMin: descriptor.storageUvMin.clone(),
      storageUvSize: descriptor.storageUvSize.clone(),
      assignedSize: { ...descriptor.assignedSize },
      storageSize: { ...descriptor.storageSize },
    };
  }

  function targetForDescriptor(descriptor, name = "Baked skydome patch") {
    applyDescriptorBakeStorage(descriptor);
    const target = targetManager.acquireTarget(descriptor.storageSize.width, descriptor.storageSize.height, {
      name,
      wrapS: descriptor.wrapS,
      wrapT: descriptor.wrapT,
    });
    attachTargetSamplingMetadata(descriptor, target);
    return target;
  }

  function targetMatchesDescriptor(descriptor, target) {
    if (!target) return false;
    const storageSize = plannedDescriptorStorageSize(descriptor);
    return targetManager.renderTargetWidth(target) === storageSize.width
      && targetManager.renderTargetHeight(target) === storageSize.height;
  }

  function recordDescriptorLayerBake(descriptor) {
    const signature = screenBakeSignature();
    descriptor.lastBakedScreenSignature = { ...signature };
    descriptor.lastBakedScreenSignatureKey = signature.key;
    descriptor.lastBakedTargetSize = { ...descriptor.targetSize };
    descriptor.lastBakedStorageSize = { ...descriptor.storageSize };
    descriptor.lastBakedLayerKey = desiredLayerBakeKey(descriptor, signature);
    descriptor.pendingLayerBakeKey = "";
    descriptor.pendingScreenSignature = null;
    descriptor.layerDirty = false;
    descriptor.layerDirtyReason = "";
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
    Object.assign(stats, starLayers.collectStats());
    stats.bakedStarLayerEnabled = layerState.bakedStars.enabled;
    stats.bakedStarLayerDrawCalls = layerState.bakedStars.enabled ? patchDescriptors.length : 0;
    stats.bakedStarLayerRadius = layerState.bakedStars.radius;
    stats.bakedStarLayerDensity = layerState.bakedStars.params.uDensity;
    stats.bakedStarLayerSparsity = layerState.bakedStars.params.uSparsity;
    stats.bakedStarLayerSeed = layerState.bakedStars.params.uSeed;
    stats.bakedStarLayerStarCount = catalogStarCount(bakeUniforms);
    stats.overlayLayerDensity = layerState.brightOverlay.params.uDensity;
    stats.overlayLayerSparsity = layerState.brightOverlay.params.uSparsity;
    stats.overlayLayerSeed = layerState.brightOverlay.params.uSeed;
    stats.overlayLayerStarCount = catalogStarCount(overlayUniforms);
    stats.overlayCatalogDirty = overlayCatalogDirty;
  }

  function rebuildOverlayCatalog() {
    const { classStats } = starLayers.rebuild({
      overlayUniforms,
      enabled: brightStarOverlayEnabled,
    });
    overlayCatalogDirty = false;
    Object.assign(stats, classStats);
    syncOverlayStats();
  }

  function syncBakedCatalogStats() {
    catalogDirty = false;
    stats.starCount = catalogStarCount(bakeUniforms);
    stats.starInstances = stats.starCount * STAR_QUERY_SEAM_COPIES;
    syncOverlayStats();
  }

  function markCatalogDirty(layerId = "bakedStars") {
    if (layerId === "brightOverlay") {
      overlayCatalogDirty = true;
      return;
    }
    catalogDirty = true;
  }

  function ensureStarCatalog() {
    if (overlayCatalogDirty) {
      rebuildOverlayCatalog();
    }
    if (catalogDirty) {
      syncBakedCatalogStats();
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
    return SPARSE_PATCH_MODES.FULL;
  }

  function descriptorTextureBytes(descriptor) {
    const storageSize = plannedDescriptorStorageSize(descriptor);
    return estimateTextureBytes(
      storageSize.width,
      storageSize.height,
      FINAL_TEXTURE_BYTES_PER_PIXEL,
    );
  }

  function autoVirtualSizeLabel() {
    const targetWidth = patchDescriptors.reduce((maxWidth, descriptor) => Math.max(maxWidth, descriptor.targetSize.width), 1);
    const targetHeight = patchDescriptors.reduce((maxHeight, descriptor) => Math.max(maxHeight, descriptor.targetSize.height), 1);
    return sizeLabel(targetWidth * currentPatchLayout.columns, targetHeight * currentPatchLayout.rows);
  }

  function currentPatchSizeLabel() {
    const targetWidth = patchDescriptors.reduce((maxWidth, descriptor) => Math.max(maxWidth, descriptor.assignedSize?.width ?? descriptor.targetSize.width), 1);
    const targetHeight = patchDescriptors.reduce((maxHeight, descriptor) => Math.max(maxHeight, descriptor.assignedSize?.height ?? descriptor.targetSize.height), 1);
    return sizeLabel(targetWidth, targetHeight);
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
    const patchBudgetBytes = STARFIELD_ALLOCATION_BUDGET_BYTES;
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
    currentSupersample = currentPatchLayout.supersample ?? 1;
    applySparseResidency();
    Object.assign(stats, demand, computeMemoryReadouts(demand), patchDescriptorSummary());
  }

  function updatePatchStats() {
    updatePatchStatsFromStats(makeStatsContext());
    updateDemandStats();
  }

  function descriptorsNeedingScreenLayerBake() {
    const signature = screenBakeSignature();
    const changedDescriptors = [];

    patchDescriptors.forEach((descriptor) => {
      if (!descriptor.sparseWanted) return;
      if (descriptor.state !== PATCH_STATES.RESIDENT && descriptor.state !== PATCH_STATES.STALE) return;

      const layerKey = desiredLayerBakeKey(descriptor, signature);
      if (descriptor.lastBakedLayerKey === layerKey || descriptor.pendingLayerBakeKey === layerKey) return;

      descriptor.pendingLayerBakeKey = layerKey;
      descriptor.pendingScreenSignature = { ...signature };
      descriptor.layerDirty = true;
      descriptor.layerDirtyReason = "screen";
      if (descriptor.state === PATCH_STATES.RESIDENT) {
        descriptor.state = PATCH_STATES.STALE;
      }
      changedDescriptors.push(descriptor);
    });

    return changedDescriptors;
  }

  function scheduleScreenLayerRebakes() {
    const descriptors = descriptorsNeedingScreenLayerBake();
    if (descriptors.length === 0) return;
    pipeline.scheduleLayerBakeJobs(descriptors, "screen");
  }

  function rebuildDisplayGeometry() {
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    starLayers.setSphereSegments(currentSphereSegments);
    updateSphereSegmentStats(stats, currentSphereSegments);
    requestRender();
  }

  function completePendingDisplaySwap() {
    if (!pendingDisplaySwap) return;

    const { previousDescriptors } = pendingDisplaySwap;
    skydome.disposeBakedDomeMeshes();
    disposePatchDescriptors(previousDescriptors);
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    pendingDisplaySwap = null;
    updatePatchStats();
    notifyReadouts();
    requestRender();
  }

  function applyAutomaticPatchLayout(reason = "automatic", { bake = true } = {}) {
    const nextLayout = computeAutoPatchLayout();
    if (!nextLayout || patchLayoutKey(nextLayout) === patchLayoutKey(currentPatchLayout)) {
      stats.autoLayoutReason = nextLayout?.autoLayoutReason ?? reason;
      return false;
    }

    const previousDescriptors = patchDescriptors;
    pipeline.clearBakeQueue();
    currentPatchLayout = nextLayout;
    currentBakeWidth = nextLayout.virtualWidth;
    patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
    currentSupersample = currentPatchLayout.supersample ?? 1;
    pendingDisplaySwap = null;
    skydome.disposeBakedDomeMeshes();
    disposePatchDescriptors(previousDescriptors, { releaseTargets: false });
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    stats.autoLayoutReason = nextLayout.autoLayoutReason ?? reason;
    stats.pendingAutoLayout = false;
    updatePatchStats();
    notifyReadouts();
    if (bake) {
      pipeline.bakeNow();
    }
    return true;
  }

  function scheduleAutomaticPatchLayout(reason = "screen", delay = 450) {
    const nextLayout = computeAutoPatchLayout();
    if (!nextLayout) return false;

    const nextKey = patchLayoutKey(nextLayout);
    if (nextKey === patchLayoutKey(currentPatchLayout)) {
      stats.autoLayoutReason = nextLayout.autoLayoutReason ?? reason;
      return false;
    }
    if (pendingAutoLayoutKey === nextKey) return true;

    pendingAutoLayoutKey = nextKey;
    stats.pendingAutoLayout = true;
    clearTimeout(autoLayoutTimer);
    autoLayoutTimer = window.setTimeout(() => {
      autoLayoutTimer = 0;
      pendingAutoLayoutKey = "";
      applyAutomaticPatchLayout(reason);
    }, Math.max(0, delay));
    return true;
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
    scheduleAutomaticPatchLayout("compat", 0);
  }

  function setParam(key, value, delay = 180) {
    setLayerParam("bakedStars", key, value, delay);
  }

  function setLayerParamValue(layerId, key, value) {
    const layer = layerState[layerId];
    if (!layer?.params || !layer?.uniforms?.[key]) return false;
    layer.params[key] = value;
    layer.uniforms[key].value = value;
    return true;
  }

  function setLayerParam(layerId, key, value, delay = 180) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || !setLayerParamValue(layerId, key, nextValue)) return;

    if (layerId === "bakedStars") {
      if (CATALOG_PARAMS.has(key)) {
        markCatalogDirty("bakedStars");
      }
      pipeline.markPatchDescriptorsStale(CATALOG_PARAMS.has(key) ? "catalog" : "visual");
      updateDemandStats();
      syncOverlayStats();
      notifyReadouts();
      pipeline.scheduleBake(delay);
      return;
    }

    if (layerId === "brightOverlay") {
      if (CATALOG_PARAMS.has(key) || key === "uLargeStarRarity") {
        markCatalogDirty("brightOverlay");
        rebuildOverlayCatalog();
      } else {
        syncOverlayStats();
      }
      updateDemandStats();
      notifyReadouts();
      requestRender();
    }
  }

  function getLayerParam(layerId, key) {
    return layerState[layerId]?.params?.[key] ?? 0;
  }

  function reseedLayer(layerId) {
    if (!layerState[layerId]?.params) return 0;
    const nextSeed = Math.floor(Math.random() * 1001);
    setLayerParam(layerId, "uSeed", nextSeed, 0);
    return nextSeed;
  }

  function setAdaptiveParam(key, value) {
    if (!(key in adaptiveQuality)) return;
    notifyReadouts();
  }

  function setSphereSegments(value) {
    currentSphereSegments = value;
    rebuildDisplayGeometry();
    notifyReadouts();
  }

  function setLayerEnabled(layerId, enabled) {
    const nextEnabled = Boolean(enabled);

    if (layerId === "skyBackground") {
      layerState.skyBackground.enabled = nextEnabled;
      starLayers.setLayerEnabled("skyBackground", nextEnabled);
    } else if (layerId === "bakedStars") {
      layerState.bakedStars.enabled = nextEnabled;
      skydome.setVisible(nextEnabled);
    } else if (layerId === "brightOverlay") {
      setBrightStarOverlayEnabled(nextEnabled);
      return;
    } else {
      return;
    }

    syncOverlayStats();
    notifyReadouts();
    requestRender();
  }

  function getLayerEnabled(layerId) {
    return Boolean(layerState[layerId]?.enabled);
  }

  function setLayerRadius(layerId, value) {
    const nextRadius = Number(value);
    if (!Number.isFinite(nextRadius) || nextRadius <= 0 || !layerState[layerId]) return;

    layerState[layerId].radius = nextRadius;

    if (layerId === "skyBackground") {
      starLayers.setLayerRadius("skyBackground", nextRadius);
    } else if (layerId === "bakedStars") {
      skydome.setRadius(nextRadius, patchDescriptors);
    } else if (layerId === "brightOverlay") {
      starLayers.setLayerRadius("brightOverlay", nextRadius);
    }

    syncOverlayStats();
    notifyReadouts();
    requestRender();
  }

  function getLayerRadius(layerId) {
    return layerState[layerId]?.radius ?? 0;
  }

  function setBrightStarOverlayEnabled(enabled) {
    brightStarOverlayEnabled = BRIGHT_STAR_OVERLAY_ENABLED && Boolean(enabled);
    layerState.brightOverlay.enabled = brightStarOverlayEnabled;
    rebuildOverlayCatalog();
    updateDemandStats();
    notifyReadouts();
    if (BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS) {
      pipeline.markPatchDescriptorsStale("overlay");
      pipeline.scheduleBake(0);
    }
    requestRender();
  }

  function getBrightStarOverlayEnabled() {
    return brightStarOverlayEnabled;
  }

  function reseed() {
    reseedLayer("bakedStars");
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
      virtualSize: autoVirtualSizeLabel(),
      autoLayoutReason: currentPatchLayout.autoLayoutReason ?? stats.autoLayoutReason ?? "automatic",
      patchGrid: patchGridLabel(currentPatchLayout),
      patchSize: currentPatchSizeLabel(),
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
    const previousScreenKey = screenBakeSignature().key;
    const nextCameraInfo = {
      ...currentCameraInfo,
      ...cameraInfo,
    };
    const nextScreenKey = screenBakeSignature(nextCameraInfo).key;
    const screenChanged = nextScreenKey !== previousScreenKey;
    const shouldInitializeLayout = !layoutInitialized;

    currentCameraInfo = nextCameraInfo;
    stats.horizontalFov = currentCameraInfo.horizontalFov;
    stats.verticalFov = currentCameraInfo.verticalFov;
    bakeUniforms.uScreenPixelAngle.value = screenPixelAngleFromInfo(currentCameraInfo);

    if (!shouldInitializeLayout && !screenChanged) {
      if (notify) {
        notifyReadouts();
      }
      return false;
    }

    updateDemandStats();

    if (shouldInitializeLayout) {
      layoutInitialized = true;
      applyAutomaticPatchLayout("initial", { bake: false });
    } else if (screenChanged) {
      const layoutQueued = scheduleAutomaticPatchLayout("screen", 450);
      if (!layoutQueued) {
        scheduleScreenLayerRebakes();
      }
    }

    if (notify) {
      notifyReadouts();
    }
    return true;
  }

  function recordRender() {
    stats.renders += 1;
    if (skydome.activeBlendCount > 0 && skydome.advancePatchBlends()) {
      requestRender();
    }
  }

  function collectStats(rendererInfo, cameraInfo = {}, options = {}) {
    return collectStatsPayload(makeStatsContext(), rendererInfo, cameraInfo, options);
  }

  function dispose() {
    clearTimeout(autoLayoutTimer);
    pipeline.clearBakeQueue();
    if (pendingDisplaySwap) {
      disposePatchDescriptors(pendingDisplaySwap.previousDescriptors, { releaseTargets: false });
      pendingDisplaySwap = null;
    }
    disposePatchDescriptors(patchDescriptors, { releaseTargets: false });
    targetManager.disposeTargetPool();
    skydome.dispose();
    supersampleTarget.dispose();
    starGeometry.dispose();
    starMaterial.dispose();
    starLayers.dispose();
    fallbackPatchTexture.dispose();
    downsampleQuad.geometry.dispose();
    downsampleMaterial.dispose();
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
    setLayerEnabled,
    getLayerEnabled,
    setLayerRadius,
    getLayerRadius,
    setLayerParam,
    getLayerParam,
    reseedLayer,
    setBrightStarOverlayEnabled,
    getBrightStarOverlayEnabled,
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
