import * as THREE from "three";
import {
  BYTES_PER_MIB,
  DENSITY_FALLBACK_STARS_PER_PIXEL,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  MAX_AUTO_SUPERSAMPLE,
  MAX_BAKE_JOBS_PER_FRAME,
  MIN_CORE_PIXELS,
  MIN_GLARE_PIXELS,
  PATCH_STATES,
  REFERENCE_BAKE_HEIGHT,
  REFERENCE_BAKE_WIDTH,
  SPARSE_PATCH_MODES,
  AA_PIN_THRESHOLD_PX,
  SUBPIXEL_DENSITY_THRESHOLD_PX,
  cameraForwardFromInfo,
  centerWeightForCosine,
  densityImportanceForPatch,
  emptyStarClassStats,
  estimateTextureBytes,
  formatBytes,
  STARFIELD_ALLOCATION_BUDGET_BYTES,
  STARFIELD_ALLOCATION_BUDGET_MIB,
  WINKLE_MAX_COUNT,
  DEFAULT_EFFECT_MAX_SIZE,
  DEFAULT_EFFECT_MIN_SIZE,
  DEFAULT_WINKLE_SHARPNESS,
  DEFAULT_WINKLE_FLASHINESS,
  sizeLabel,
  sphereVerticalSegmentsFor,
  staleWeightForState,
} from "./constants.js";
import {
  maxDescriptorPrecisionSize,
  maxDescriptorStorageSize,
  patchGridLabel,
} from "./patch-layout.js";
import {
  catalogStarCount,
  currentStarGrid,
  overlayCandidateStarCount,
} from "./catalog.js";

export function createInitialStats({
  defaults,
  defaultPatchLayout,
  supersample,
  maxTextureSize,
  accumulationTypeLabel,
  currentSphereSegments,
}) {
  return {
    mode: "baked-equirect-skydome-tiled-catalog-splat",
    bakes: 0,
    renders: 0,
    textureWidth: defaults.bakeWidth,
    textureHeight: defaultPatchLayout.virtualHeight,
    supersampleMode: "auto",
    horizontalFov: 0,
    verticalFov: 0,
    supersample,
    maxSupersample: MAX_AUTO_SUPERSAMPLE,
    maxTextureSize,
    allocationBudgetBytes: STARFIELD_ALLOCATION_BUDGET_BYTES,
    allocationBudgetMemory: formatBytes(STARFIELD_ALLOCATION_BUDGET_BYTES),
    allocationBudgetMiB: STARFIELD_ALLOCATION_BUDGET_MIB,
    accumulationType: accumulationTypeLabel,
    patchGrid: patchGridLabel(defaultPatchLayout),
    autoPatchGrid: patchGridLabel(defaultPatchLayout),
    autoVirtualSize: sizeLabel(defaultPatchLayout.virtualWidth, defaultPatchLayout.virtualHeight),
    autoLayoutReason: defaultPatchLayout.autoLayoutReason ?? "initial",
    catalogDirty: true,
    patchWidth: defaultPatchLayout.contentWidth,
    patchHeight: defaultPatchLayout.contentHeight,
    patchStorageWidth: defaultPatchLayout.storageWidth,
    patchStorageHeight: defaultPatchLayout.storageHeight,
    patchGuard: defaultPatchLayout.guard,
    starCount: 0,
    starInstances: 0,
    ...emptyStarClassStats(),
    referenceWidth: REFERENCE_BAKE_WIDTH,
    referenceHeight: REFERENCE_BAKE_HEIGHT,
    internalWidth: defaultPatchLayout.storageWidth * supersample,
    internalHeight: defaultPatchLayout.storageHeight * supersample,
    sphereSegments: currentSphereSegments,
    sphereVerticalSegments: sphereVerticalSegmentsFor(currentSphereSegments),
    backgroundLayerEnabled: true,
    backgroundLayerDrawCalls: 1,
    backgroundLayerTriangles: 0,
    backgroundLayerRadius: defaults.skyBackgroundRadius,
    bakedStarLayerEnabled: true,
    bakedStarLayerDrawCalls: defaultPatchLayout.patchCount,
    bakedStarLayerRadius: defaults.bakedStarsRadius,
    bakedStarLayerDensity: defaults.uDensity,
    bakedStarLayerSeed: defaults.uSeed,
    bakedStarLayerStarCount: 0,
    overlayRadius: defaults.brightOverlayRadius,
    overlayLayerDensity: defaults.uDensity,
    overlayLayerSeed: defaults.uSeed,
    overlayLayerStarCount: 0,
    overlayCatalogDirty: true,
    winkleAmount: defaults.uWinkleAmount ?? 0,
    effectMinSize: defaults.uEffectMinSize ?? DEFAULT_EFFECT_MIN_SIZE,
    effectMaxSize: defaults.uEffectMaxSize ?? DEFAULT_EFFECT_MAX_SIZE,
    winkleSharpness: defaults.uWinkleSharpness ?? DEFAULT_WINKLE_SHARPNESS,
    winkleFlashiness: defaults.uWinkleFlashiness ?? DEFAULT_WINKLE_FLASHINESS,
    winkleMaxCount: WINKLE_MAX_COUNT,
    winkleActiveCount: 0,
    winkleDrawCalls: 0,
    winkleTriangles: 0,
    lastBakeMs: 0,
    allocationCount: 0,
    activeBakeJobs: 0,
    pendingBakeJobs: 0,
    activeBlendCount: 0,
    activeBakeJob: null,
    activeBakeJobId: "none",
    completedBakeJobs: 0,
    totalQueuedBakeJobs: 0,
    maxBakeJobsPerFrame: MAX_BAKE_JOBS_PER_FRAME,
    queueIdle: true,
    pendingBakeJobSummary: "none",
    minCorePixels: MIN_CORE_PIXELS,
    minGlarePixels: MIN_GLARE_PIXELS,
    subpixelDensityThresholdPx: SUBPIXEL_DENSITY_THRESHOLD_PX,
    aaPinThresholdPx: AA_PIN_THRESHOLD_PX,
    subpixelEnergyMode: "density-pin-normal",
    activeTargetCount: 0,
    pooledTargetCount: 0,
    pooledTargetsByBucket: {},
    pooledTargetSummary: "none",
    downgradedPatchCount: 0,
    densityFallbackPatchCount: 0,
  };
}

export function computeDemandReadouts(ctx) {
  const {
    adaptiveQuality,
    currentCameraInfo,
    currentPatchLayout,
    bakeUniforms,
    overlayUniforms = bakeUniforms,
    catalogDirty,
    overlayCatalogDirty = catalogDirty,
    stats,
    activeSparseMode,
  } = ctx;
  const targetTexelsPerPixel = currentPatchLayout.targetTexelsPerPixel ?? adaptiveQuality.targetTexelsPerPixel ?? 1;
  const horizontalFov = Number(currentCameraInfo.horizontalFov) || 0;
  const verticalFov = Number(currentCameraInfo.verticalFov) || 0;
  const horizontalFovRad = THREE.MathUtils.degToRad(Math.max(horizontalFov, 0.001));
  const verticalFovRad = THREE.MathUtils.degToRad(Math.max(verticalFov, 0.001));
  const screenWidth = Math.max(1, Number(currentCameraInfo.screenWidth) || 1);
  const screenHeight = Math.max(1, Number(currentCameraInfo.screenHeight) || 1);
  const cssWidth = Math.max(1, Number(currentCameraInfo.cssWidth) || screenWidth);
  const cssHeight = Math.max(1, Number(currentCameraInfo.cssHeight) || screenHeight);
  const pixelRatio = Math.max(1, Number(currentCameraInfo.pixelRatio) || 1);
  const pixelsPerRadianX = screenWidth / horizontalFovRad;
  const pixelsPerRadianY = screenHeight / verticalFovRad;
  const pixelsPerDegreeX = pixelsPerRadianX * (Math.PI / 180);
  const pixelsPerDegreeY = pixelsPerRadianY * (Math.PI / 180);
  const patchCount = Math.max(1, currentPatchLayout.columns * currentPatchLayout.rows);
  const patchAngularWidthRad = (Math.PI * 2) / currentPatchLayout.columns;
  const patchAngularHeightRad = Math.PI / currentPatchLayout.rows;
  const patchAngularWidthDeg = THREE.MathUtils.radToDeg(patchAngularWidthRad);
  const patchAngularHeightDeg = THREE.MathUtils.radToDeg(patchAngularHeightRad);
  const projectedPatchWidthPixels = patchAngularWidthRad * pixelsPerRadianX;
  const projectedPatchHeightPixels = patchAngularHeightRad * pixelsPerRadianY;
  const requiredPatchTexelsX = currentPatchLayout.idealPatchWidth ?? projectedPatchWidthPixels * targetTexelsPerPixel;
  const requiredPatchTexelsY = currentPatchLayout.idealPatchHeight ?? projectedPatchHeightPixels * targetTexelsPerPixel;
  const projectedPatchPixels = Math.max(1, projectedPatchWidthPixels * projectedPatchHeightPixels);
  const requiredPatchTexelsMax = Math.max(requiredPatchTexelsX, requiredPatchTexelsY, 1);
  const recommendedActualPatchWidth = currentPatchLayout.contentWidth;
  const recommendedActualPatchHeight = currentPatchLayout.contentHeight;
  const recommendedPatchBucket = Math.max(recommendedActualPatchWidth, recommendedActualPatchHeight);
  const currentPatchSize = Math.max(currentPatchLayout.contentWidth, currentPatchLayout.contentHeight);
  const oversampleRatio = currentPatchLayout.qualityScale ?? currentPatchSize / requiredPatchTexelsMax;
  const totalStarCount = catalogStarCount(bakeUniforms);
  const totalOverlayCandidateCount = overlayCandidateStarCount({
    bakeUniforms: overlayUniforms,
    catalogDirty: overlayCatalogDirty,
    stats,
  });
  const estimatedStarsPerPatch = totalStarCount / patchCount;
  const estimatedOverlayCandidatesPerPatch = totalOverlayCandidateCount / patchCount;
  const starsPerProjectedPixel = estimatedStarsPerPatch / projectedPatchPixels;
  const densityScale = starsPerProjectedPixel > 0
    ? Math.min(1, DENSITY_FALLBACK_STARS_PER_PIXEL / starsPerProjectedPixel)
    : 1;
  const densityFallbackWarning = densityScale < 1;

  return {
    horizontalFov,
    verticalFov,
    horizontalFovRad,
    verticalFovRad,
    screenWidth,
    screenHeight,
    cssWidth,
    cssHeight,
    pixelRatio,
    screenSize: sizeLabel(screenWidth, screenHeight),
    cssSize: sizeLabel(cssWidth, cssHeight),
    adaptiveResolution: adaptiveQuality.adaptiveResolution,
    targetTexelsPerPixel,
    texelsPerPixelTarget: targetTexelsPerPixel,
    minPatchSize: 1,
    maxPatchSize: Math.max(currentPatchLayout.contentWidth, currentPatchLayout.contentHeight),
    patchBudgetMb: adaptiveQuality.patchBudgetMb,
    centerBias: adaptiveQuality.centerBias,
    sparseMode: adaptiveQuality.sparseMode,
    effectiveSparseMode: activeSparseMode(),
    pixelsPerRadianX,
    pixelsPerRadianY,
    pixelsPerDegreeX,
    pixelsPerDegreeY,
    patchAngularWidthRad,
    patchAngularHeightRad,
    patchAngularWidthDeg,
    patchAngularHeightDeg,
    projectedPatchWidthPixels,
    projectedPatchHeightPixels,
    projectedPatchPixels,
    requiredPatchTexelsX,
    requiredPatchTexelsY,
    requiredPatchTexels: sizeLabel(requiredPatchTexelsX, requiredPatchTexelsY),
    requiredPatchBucket: Math.max(requiredPatchTexelsX, requiredPatchTexelsY),
    recommendedPatchBucket,
    recommendedActualPatchWidth,
    recommendedActualPatchHeight,
    recommendedActualRasterSize: sizeLabel(recommendedActualPatchWidth, recommendedActualPatchHeight),
    idealVirtualSize: sizeLabel(currentPatchLayout.idealVirtualWidth ?? currentPatchLayout.virtualWidth, currentPatchLayout.idealVirtualHeight ?? currentPatchLayout.virtualHeight),
    effectiveVirtualSize: sizeLabel(currentPatchLayout.effectiveVirtualWidth ?? currentPatchLayout.virtualWidth, currentPatchLayout.effectiveVirtualHeight ?? currentPatchLayout.virtualHeight),
    qualityScale: currentPatchLayout.qualityScale ?? 1,
    currentPatchSize,
    oversampleRatio,
    undersampleWarning: oversampleRatio < 1,
    totalStarCount,
    estimatedStarsPerPatch,
    starsPerProjectedPixel,
    brightStarCount: estimatedOverlayCandidatesPerPatch,
    overlayCandidateStarsPerPatch: estimatedOverlayCandidatesPerPatch,
    densityScale,
    densityFallbackWarning,
    densityFallbackPatchCount: densityFallbackWarning ? patchCount : 0,
    densityFallbackThreshold: DENSITY_FALLBACK_STARS_PER_PIXEL,
  };
}

export function computeMemoryReadouts(ctx, demand = computeDemandReadouts(ctx)) {
  const {
    adaptiveQuality,
    currentPatchLayout,
    currentSupersample,
    patchDescriptors,
    maxTextureSize,
    accumulationType,
    targetManager,
    allocationBudgetBytes,
    bakeScratchBytes,
  } = ctx;
  const patchCount = Math.max(1, patchDescriptors.length);
  const residentTextureBytes = targetManager.activePatchTargetBytes();
  const accumulationBytesPerPixel = accumulationType === THREE.HalfFloatType ? 8 : 4;
  const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
  const estimatedBakeScratchBytes = estimateTextureBytes(
    precisionSize.width,
    precisionSize.height,
    accumulationBytesPerPixel,
  );
  const activeBakeScratchBytes = bakeScratchBytes ?? estimatedBakeScratchBytes;
  const pooledTargetMemoryBytes = targetManager.pooledTargetBytes();
  const totalAllocatedBytes = residentTextureBytes + activeBakeScratchBytes + pooledTargetMemoryBytes;
  const recommendedStorageWidth = Math.min(maxTextureSize, demand.recommendedActualPatchWidth + currentPatchLayout.guard * 2);
  const recommendedStorageHeight = Math.min(maxTextureSize, demand.recommendedActualPatchHeight + currentPatchLayout.guard * 2);
  const recommendedResidentTextureBytes = estimateTextureBytes(
    recommendedStorageWidth,
    recommendedStorageHeight,
    FINAL_TEXTURE_BYTES_PER_PIXEL,
  ) * patchCount;
  const patchBudgetBytes = allocationBudgetBytes ?? Math.max(BYTES_PER_MIB, adaptiveQuality.patchBudgetMb * BYTES_PER_MIB);

  return {
    residentTextureBytes,
    residentTextureMemory: formatBytes(residentTextureBytes),
    bakeScratchBytes: activeBakeScratchBytes,
    bakeScratchMemory: formatBytes(activeBakeScratchBytes),
    estimatedBakeScratchBytes,
    estimatedBakeScratchMemory: formatBytes(estimatedBakeScratchBytes),
    pooledTargetBytes: pooledTargetMemoryBytes,
    pooledTargetMemory: formatBytes(pooledTargetMemoryBytes),
    totalAllocatedBytes,
    totalAllocatedMemory: formatBytes(totalAllocatedBytes),
    patchBudgetBytes,
    patchBudgetMemory: formatBytes(patchBudgetBytes),
    allocationBudgetBytes: patchBudgetBytes,
    allocationBudgetMemory: formatBytes(patchBudgetBytes),
    residentBudgetRatio: residentTextureBytes / patchBudgetBytes,
    totalAllocatedBudgetRatio: totalAllocatedBytes / patchBudgetBytes,
    residentBudgetExceeded: residentTextureBytes > patchBudgetBytes,
    totalAllocatedBudgetExceeded: totalAllocatedBytes > patchBudgetBytes,
    recommendedStorageWidth,
    recommendedStorageHeight,
    recommendedPatchStorageSize: sizeLabel(recommendedStorageWidth, recommendedStorageHeight),
    recommendedResidentTextureBytes,
    recommendedResidentTextureMemory: formatBytes(recommendedResidentTextureBytes),
    recommendedResidentBudgetRatio: recommendedResidentTextureBytes / patchBudgetBytes,
    recommendedResidentBudgetExceeded: recommendedResidentTextureBytes > patchBudgetBytes,
  };
}

function autoVirtualSizeForDescriptors(layout, descriptors) {
  const targetWidth = descriptors.reduce((maxWidth, descriptor) => Math.max(maxWidth, descriptor.targetSize.width), 1);
  const targetHeight = descriptors.reduce((maxHeight, descriptor) => Math.max(maxHeight, descriptor.targetSize.height), 1);
  return sizeLabel(targetWidth * layout.columns, targetHeight * layout.rows);
}

function maxDescriptorTargetSize(descriptors) {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptor.targetSize?.width ?? 1),
    height: Math.max(size.height, descriptor.targetSize?.height ?? 1),
  }), { width: 1, height: 1 });
}

function maxDescriptorAssignedSize(descriptors) {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptor.assignedSize?.width ?? descriptor.targetSize.width),
    height: Math.max(size.height, descriptor.assignedSize?.height ?? descriptor.targetSize.height),
  }), { width: 1, height: 1 });
}

function sizeIsCapped(actual, optimal) {
  return Math.round(actual.width) < Math.round(optimal.width)
    || Math.round(actual.height) < Math.round(optimal.height);
}

function computeCapReadouts({
  currentPatchLayout,
  currentSupersample,
  demand,
  patchDescriptors,
}) {
  const targetSize = maxDescriptorTargetSize(patchDescriptors);
  const assignedSize = maxDescriptorAssignedSize(patchDescriptors);
  const storageSize = maxDescriptorStorageSize(patchDescriptors);
  const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
  const optimalPatchSize = {
    width: Math.max(1, demand.requiredPatchTexelsX),
    height: Math.max(1, demand.requiredPatchTexelsY),
  };
  const optimalVirtualSize = {
    width: optimalPatchSize.width * currentPatchLayout.columns,
    height: optimalPatchSize.height * currentPatchLayout.rows,
  };
  const optimalPatchStorageSize = {
    width: optimalPatchSize.width + currentPatchLayout.guard * 2,
    height: optimalPatchSize.height + currentPatchLayout.guard * 2,
  };
  const optimalInternalPatchSize = {
    width: storageSize.width * MAX_AUTO_SUPERSAMPLE,
    height: storageSize.height * MAX_AUTO_SUPERSAMPLE,
  };

  return {
    optimalPatchSize: sizeLabel(optimalPatchSize.width, optimalPatchSize.height),
    optimalVirtualSize: sizeLabel(optimalVirtualSize.width, optimalVirtualSize.height),
    optimalPatchStorageSize: sizeLabel(optimalPatchStorageSize.width, optimalPatchStorageSize.height),
    optimalInternalPatchSize: sizeLabel(optimalInternalPatchSize.width, optimalInternalPatchSize.height),
    autoVirtualSizeCapped: sizeIsCapped({
      width: targetSize.width * currentPatchLayout.columns,
      height: targetSize.height * currentPatchLayout.rows,
    }, optimalVirtualSize),
    patchSizeCapped: sizeIsCapped(assignedSize, optimalPatchSize),
    patchStorageSizeCapped: sizeIsCapped(storageSize, optimalPatchStorageSize),
    internalPatchSizeCapped: sizeIsCapped(precisionSize, optimalInternalPatchSize),
  };
}

export function updatePatchDescriptorPriority({
  descriptor,
  cameraForward,
  adaptiveQuality,
  currentPatchLayout,
  maxTextureSize,
}) {
  const cosAngle = Math.min(1, Math.max(-1,
    descriptor.centerDirection.x * cameraForward.x
      + descriptor.centerDirection.y * cameraForward.y
      + descriptor.centerDirection.z * cameraForward.z,
  ));
  const centerAngleRad = Math.acos(cosAngle);
  const { centerScore, centerWeight } = centerWeightForCosine(cosAngle, adaptiveQuality.centerBias);
  const densityImportance = densityImportanceForPatch(descriptor);
  const staleWeight = staleWeightForState(descriptor.state);
  const contentSize = adaptiveQuality.adaptiveResolution
    ? descriptor.targetSize
    : descriptor.logicalSize;
  const assignedWidth = Math.min(maxTextureSize, Math.max(1, Math.round(contentSize.width)));
  const assignedHeight = Math.min(maxTextureSize, Math.max(1, Math.round(contentSize.height)));
  const memoryCostBytes = estimateTextureBytes(
    Math.min(maxTextureSize, assignedWidth + currentPatchLayout.guard * 2),
    Math.min(maxTextureSize, assignedHeight + currentPatchLayout.guard * 2),
    FINAL_TEXTURE_BYTES_PER_PIXEL,
  );
  const memoryCost = Math.max(memoryCostBytes / BYTES_PER_MIB, 0.001);
  const projectedPixels = Math.max(1, descriptor.projectedPixels);

  descriptor.priorityProjectedPixels = projectedPixels;
  descriptor.priorityCenterAngleRad = centerAngleRad;
  descriptor.priorityCenterAngleDeg = THREE.MathUtils.radToDeg(centerAngleRad);
  descriptor.priorityCenterScore = centerScore;
  descriptor.priorityCenterWeight = centerWeight;
  descriptor.priorityDensityImportance = densityImportance;
  descriptor.priorityStaleWeight = staleWeight;
  descriptor.priorityMemoryCost = memoryCost;
  descriptor.priorityMemoryCostBytes = memoryCostBytes;
  descriptor.priority = (projectedPixels * centerWeight * densityImportance * staleWeight) / memoryCost;
}

export function updatePatchDescriptorDemand(ctx, demand) {
  const {
    adaptiveQuality,
    currentCameraInfo,
    maxTextureSize,
    patchDescriptors,
  } = ctx;
  const cameraForward = cameraForwardFromInfo(currentCameraInfo);
  patchDescriptors.forEach((descriptor) => {
    const projectedWidthPixels = descriptor.angularWidthRad * demand.pixelsPerRadianX;
    const projectedHeightPixels = descriptor.angularHeightRad * demand.pixelsPerRadianY;
    const projectedPixels = Math.max(1, projectedWidthPixels * projectedHeightPixels);
    const requiredWidth = projectedWidthPixels * demand.targetTexelsPerPixel;
    const requiredHeight = projectedHeightPixels * demand.targetTexelsPerPixel;
    const targetWidth = descriptor.logicalSize.width;
    const targetHeight = descriptor.logicalSize.height;
    descriptor.angularWidthRad = demand.patchAngularWidthRad;
    descriptor.angularHeightRad = demand.patchAngularHeightRad;
    descriptor.angularWidthDeg = demand.patchAngularWidthDeg;
    descriptor.angularHeightDeg = demand.patchAngularHeightDeg;
    descriptor.screenDemand = {
      projectedWidthPixels,
      projectedHeightPixels,
      projectedPixels,
    };
    descriptor.requiredSize = {
      width: requiredWidth,
      height: requiredHeight,
      bucket: Math.max(requiredWidth, requiredHeight),
    };
    descriptor.currentSize = {
      ...descriptor.assignedSize,
    };
    descriptor.targetSize = {
      width: targetWidth,
      height: targetHeight,
      bucket: Math.max(targetWidth, targetHeight),
    };
    descriptor.requiredBucket = Math.max(requiredWidth, requiredHeight);
    descriptor.targetBucket = Math.max(targetWidth, targetHeight);
    descriptor.estimatedStarCount = demand.estimatedStarsPerPatch;
    descriptor.projectedPixels = projectedPixels;
    descriptor.starsPerProjectedPixel = descriptor.estimatedStarCount / Math.max(projectedPixels, 1);
    descriptor.densityScale = descriptor.starsPerProjectedPixel > 0
      ? Math.min(1, DENSITY_FALLBACK_STARS_PER_PIXEL / descriptor.starsPerProjectedPixel)
      : 1;
    descriptor.densityFallback = descriptor.densityScale < 1;
    descriptor.brightStarCount = demand.brightStarCount;
    descriptor.brightStarPressure = descriptor.brightStarCount / Math.max(projectedPixels, 1);
    descriptor.downgraded = adaptiveQuality.adaptiveResolution
      && descriptor.assignedSize.bucket < descriptor.targetSize.bucket;
    updatePatchDescriptorPriority({
      descriptor,
      cameraForward,
      adaptiveQuality,
      currentPatchLayout: ctx.currentPatchLayout,
      maxTextureSize,
    });
  });
}

export function patchDescriptorSummary(ctx, { includeDebug = false } = {}) {
  const {
    adaptiveQuality,
    patchDescriptors,
    stats,
    queueState,
    targetManager,
    activeSparseMode,
    activeBlendCount,
    catalogDirty,
  } = ctx;
  const states = {};
  const allocationStates = {};
  const requiredBuckets = patchDescriptors.map((descriptor) => descriptor.requiredBucket);
  const targetBuckets = patchDescriptors.map((descriptor) => descriptor.targetBucket);
  const brightStarPressures = patchDescriptors.map((descriptor) => descriptor.brightStarPressure);
  const queriedStarCounts = patchDescriptors.map((descriptor) => descriptor.lastQueriedStarCount);
  const queriedInstanceCounts = patchDescriptors.map((descriptor) => descriptor.lastQueriedStarInstances);
  const pooledByBucket = targetManager.pooledTargetsByBucket();
  const prioritySorted = [...patchDescriptors].sort((a, b) => b.priority - a.priority);

  patchDescriptors.forEach((descriptor) => {
    states[descriptor.state] = (states[descriptor.state] ?? 0) + 1;
    allocationStates[descriptor.allocationState] = (allocationStates[descriptor.allocationState] ?? 0) + 1;
  });
  prioritySorted.forEach((descriptor, index) => {
    descriptor.priorityRank = index + 1;
  });

  const formatCounts = (counts) => Object.entries(counts)
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
  const formatRange = (values) => {
    if (values.length === 0) return "none";
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? String(Math.round(min)) : `${Math.round(min)}-${Math.round(max)}`;
  };
  const formatPriority = (value) => {
    if (!Number.isFinite(value)) return "0";
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
    return value.toFixed(2);
  };
  const topPriorityPatches = prioritySorted.slice(0, 5).map((descriptor) => ({
    id: descriptor.id,
    rank: descriptor.priorityRank,
    priority: descriptor.priority,
    projectedPixels: descriptor.priorityProjectedPixels,
    centerAngleDeg: descriptor.priorityCenterAngleDeg,
    centerWeight: descriptor.priorityCenterWeight,
    densityImportance: descriptor.priorityDensityImportance,
    staleWeight: descriptor.priorityStaleWeight,
    memoryCost: descriptor.priorityMemoryCost,
    memoryCostBytes: descriptor.priorityMemoryCostBytes,
    brightStarCount: descriptor.brightStarCount,
    state: descriptor.state,
  }));
  const topPrioritySummary = topPriorityPatches.length
    ? topPriorityPatches.map((descriptor) => [
      `#${descriptor.rank} ${descriptor.id}`,
      `p=${formatPriority(descriptor.priority)}`,
      `px=${formatPriority(descriptor.projectedPixels)}`,
      `angle=${descriptor.centerAngleDeg.toFixed(1)}`,
      `center=${descriptor.centerWeight.toFixed(2)}`,
      `dens=${descriptor.densityImportance.toFixed(2)}`,
      `stale=${descriptor.staleWeight.toFixed(2)}`,
      `mem=${descriptor.memoryCost.toFixed(1)}MiB`,
    ].join(" ")).join(" | ")
    : "none";

  const summary = {
    patchDescriptorCount: patchDescriptors.length,
    descriptorCount: patchDescriptors.length,
    residentPatchCount: patchDescriptors.filter((descriptor) => descriptor.state === PATCH_STATES.RESIDENT).length,
    allocatedPatchCount: patchDescriptors.filter((descriptor) => descriptor.allocationState === "allocated").length,
    fallbackPatchCount: patchDescriptors.filter((descriptor) => descriptor.fallbackState !== "resident").length,
    nextTargetPatchCount: patchDescriptors.filter((descriptor) => descriptor.nextTarget).length,
    layerDirtyPatchCount: patchDescriptors.filter((descriptor) => descriptor.layerDirty).length,
    pendingLayerPatchCount: patchDescriptors.filter((descriptor) => descriptor.pendingLayerBakeKey).length,
    catalogDirty,
    pendingAutoLayout: stats.pendingAutoLayout ?? false,
    autoPatchGrid: patchGridLabel(ctx.currentPatchLayout),
    autoVirtualSize: autoVirtualSizeForDescriptors(ctx.currentPatchLayout, patchDescriptors),
    autoLayoutReason: ctx.currentPatchLayout.autoLayoutReason ?? stats.autoLayoutReason ?? "automatic",
    activeTargetCount: targetManager.activePatchTargets.size,
    pooledTargetCount: targetManager.pooledTargets().length,
    pooledTargetsByBucket: pooledByBucket,
    pooledTargetSummary: targetManager.targetBucketSummary(pooledByBucket),
    allocationCount: targetManager.allocationCount,
    activeBakeJobs: queueState.activeBakeJobs,
    pendingBakeJobs: queueState.pendingBakeJobs,
    activeBakeJob: queueState.activeBakeJob ? { ...queueState.activeBakeJob } : null,
    activeBakeJobId: queueState.activeBakeJob?.patchId ?? "none",
    completedBakeJobs: queueState.completedBakeJobs,
    totalQueuedBakeJobs: queueState.totalQueuedBakeJobs,
    maxBakeJobsPerFrame: MAX_BAKE_JOBS_PER_FRAME,
    activeBlendCount,
    queueIdle: queueState.pendingBakeJobs === 0 && !queueState.activeBakeJob && activeBlendCount === 0,
    pendingBakeJobSummary: queueState.bakeJobQueue.length
      ? queueState.bakeJobQueue.slice(0, 5).map((job) => `${job.patchId}:${job.reason}`).join(", ")
      : "none",
    patchStateCounts: states,
    patchStateSummary: formatCounts(states) || "none",
    allocationStateCounts: allocationStates,
    allocationStateSummary: formatCounts(allocationStates) || "none",
    descriptorDensityPressure: patchDescriptors.reduce((maxPressure, descriptor) => Math.max(maxPressure, descriptor.starsPerProjectedPixel), 0),
    descriptorDensityFallbackCount: patchDescriptors.filter((descriptor) => descriptor.densityScale < 1).length,
    densityFallbackPatchCount: patchDescriptors.filter((descriptor) => descriptor.densityScale < 1).length,
    downgradedPatchCount: patchDescriptors.filter((descriptor) => descriptor.downgraded).length,
    descriptorBrightStarPressure: brightStarPressures.reduce((maxPressure, pressure) => Math.max(maxPressure, pressure), 0),
    sparseMode: adaptiveQuality.sparseMode,
    effectiveSparseMode: activeSparseMode(),
    sparseWantedPatchCount: patchDescriptors.filter((descriptor) => descriptor.sparseWanted).length,
    sparseResidentPatchCount: patchDescriptors.filter((descriptor) => descriptor.sparseWanted && descriptor.allocationState === "allocated").length,
    sparseEvictedPatchCount: patchDescriptors.filter((descriptor) => descriptor.sparseEvicted).length,
    sparseFallbackPatchCount: patchDescriptors.filter((descriptor) => descriptor.fallbackState === "sparse").length,
    sparseVisiblePatchCount: patchDescriptors.filter((descriptor) => descriptor.sparseVisible).length,
    sparseBudgetUsedBytes: stats.sparseBudgetUsedBytes,
    sparseBudgetUsedMemory: stats.sparseBudgetUsedMemory,
    sparseBudgetRatio: stats.sparseBudgetRatio,
    sparseBudgetExceeded: stats.sparseBudgetExceeded,
    sparseSelectionSummary: stats.sparseSelectionSummary,
    queriedPatchStarCount: queriedStarCounts.reduce((total, count) => total + count, 0),
    queriedPatchInstanceCount: queriedInstanceCounts.reduce((total, count) => total + count, 0),
    queriedPatchStarSummary: formatRange(queriedStarCounts),
    queriedPatchInstanceSummary: formatRange(queriedInstanceCounts),
    descriptorRequiredBucketMin: requiredBuckets.length ? Math.min(...requiredBuckets) : 0,
    descriptorRequiredBucketMax: requiredBuckets.length ? Math.max(...requiredBuckets) : 0,
    descriptorRequiredBucketSummary: formatRange(requiredBuckets),
    descriptorTargetBucketMin: targetBuckets.length ? Math.min(...targetBuckets) : 0,
    descriptorTargetBucketMax: targetBuckets.length ? Math.max(...targetBuckets) : 0,
    descriptorTargetBucketSummary: formatRange(targetBuckets),
    topPriorityPatches,
    topPrioritySummary,
    highestPriorityPatch: topPriorityPatches[0]?.id ?? "none",
    highestPriority: topPriorityPatches[0]?.priority ?? 0,
    lowestPriority: prioritySorted[prioritySorted.length - 1]?.priority ?? 0,
  };

  if (includeDebug) {
    summary.patchDescriptorDebug = patchDescriptors.map((descriptor) => ({
      id: descriptor.id,
      x: descriptor.x,
      y: descriptor.y,
      state: descriptor.state,
      allocationState: descriptor.allocationState,
      fallbackState: descriptor.fallbackState,
      logicalSize: { ...descriptor.logicalSize },
      assignedSize: { ...descriptor.assignedSize },
      storageSize: { ...descriptor.storageSize },
      storageGuard: { ...descriptor.storageGuard },
      requiredSize: { ...descriptor.requiredSize },
      targetSize: { ...descriptor.targetSize },
      currentSize: { ...descriptor.currentSize },
      estimatedStarCount: descriptor.estimatedStarCount,
      projectedPixels: descriptor.projectedPixels,
      starsPerProjectedPixel: descriptor.starsPerProjectedPixel,
      densityScale: descriptor.densityScale,
      densityFallback: descriptor.densityFallback,
      brightStarCount: descriptor.brightStarCount,
      brightStarPressure: descriptor.brightStarPressure,
      downgraded: descriptor.downgraded,
      sparseWanted: descriptor.sparseWanted,
      sparseVisible: descriptor.sparseVisible,
      sparseScore: descriptor.sparseScore,
      sparseEvicted: descriptor.sparseEvicted,
      lastQueriedStarCount: descriptor.lastQueriedStarCount,
      lastQueriedStarInstances: descriptor.lastQueriedStarInstances,
      lastQueriedCellCount: descriptor.lastQueriedCellCount,
      lastBakeReason: descriptor.lastBakeReason,
      lastBakePriority: descriptor.lastBakePriority,
      lastBakeDurationMs: descriptor.lastBakeDurationMs,
      lastBakedLayerKey: descriptor.lastBakedLayerKey,
      lastBakedScreenSignatureKey: descriptor.lastBakedScreenSignatureKey,
      lastBakedStorageSize: descriptor.lastBakedStorageSize ? { ...descriptor.lastBakedStorageSize } : null,
      pendingLayerBakeKey: descriptor.pendingLayerBakeKey,
      layerDirty: descriptor.layerDirty,
      layerDirtyReason: descriptor.layerDirtyReason,
      blendActive: descriptor.blendActive,
      blendProgress: descriptor.blendProgress,
      priorityRank: descriptor.priorityRank,
      priority: descriptor.priority,
      priorityProjectedPixels: descriptor.priorityProjectedPixels,
      priorityCenterAngleDeg: descriptor.priorityCenterAngleDeg,
      priorityCenterScore: descriptor.priorityCenterScore,
      priorityCenterWeight: descriptor.priorityCenterWeight,
      priorityDensityImportance: descriptor.priorityDensityImportance,
      priorityStaleWeight: descriptor.priorityStaleWeight,
      priorityMemoryCost: descriptor.priorityMemoryCost,
      priorityMemoryCostBytes: descriptor.priorityMemoryCostBytes,
    }));
  }

  return summary;
}

export function collectStatsPayload(ctx, rendererInfo, cameraInfo = {}, { detail = "panel" } = {}) {
  const {
    currentBakeWidth,
    currentPatchLayout,
    currentSupersample,
    patchDescriptors,
    stats,
    maxTextureSize,
    accumulationTypeLabel,
  } = ctx;
  const includeDebug = detail === "debug";

  const demand = computeDemandReadouts(ctx);
  const memory = computeMemoryReadouts(ctx, demand);
  updatePatchDescriptorDemand(ctx, demand);
  ctx.syncOverlayStats();
  const descriptors = patchDescriptorSummary(ctx, { includeDebug });
  const capReadouts = computeCapReadouts({
    currentPatchLayout,
    currentSupersample,
    demand,
    patchDescriptors,
  });
  const storageSize = maxDescriptorStorageSize(patchDescriptors);
  const assignedSize = maxDescriptorAssignedSize(patchDescriptors);
  const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
  const result = {
    ...stats,
    ...demand,
    ...memory,
    ...descriptors,
    ...capReadouts,
    frame: rendererInfo.render.frame,
    drawCalls: rendererInfo.render.calls,
    callFrames: `${rendererInfo.render.calls}/${rendererInfo.render.frame}`,
    polygons: rendererInfo.render.triangles,
    triangles: rendererInfo.render.triangles,
    points: rendererInfo.render.points,
    lines: rendererInfo.render.lines,
    geometries: rendererInfo.memory.geometries,
    textures: rendererInfo.memory.textures,
    shaderPrograms: rendererInfo.programs?.length ?? 0,
    virtualSize: sizeLabel(currentPatchLayout.virtualWidth, currentPatchLayout.virtualHeight),
    autoVirtualSize: autoVirtualSizeForDescriptors(currentPatchLayout, patchDescriptors),
    autoPatchGrid: patchGridLabel(currentPatchLayout),
    autoLayoutReason: currentPatchLayout.autoLayoutReason ?? stats.autoLayoutReason ?? "automatic",
    catalogDirty: ctx.catalogDirty,
    overlayCatalogDirty: ctx.overlayCatalogDirty,
    patchGrid: patchGridLabel(currentPatchLayout),
    patchCount: patchDescriptors.length,
    patchSize: sizeLabel(assignedSize.width, assignedSize.height),
    patchStorageSize: sizeLabel(storageSize.width, storageSize.height),
    internalPatchSize: sizeLabel(precisionSize.width, precisionSize.height),
    supersample: `${currentSupersample}x`,
    accumulationType: accumulationTypeLabel,
    estimatedTextureMemory: memory.totalAllocatedMemory,
    estimatedTextureBytes: memory.totalAllocatedBytes,
    maxTextureSize,
  };
  if (!includeDebug) {
    delete result.patchDescriptorDebug;
  }
  Object.assign(stats, result);
  if (!includeDebug) {
    delete stats.patchDescriptorDebug;
  }
  return result;
}

export function updatePatchStats(ctx) {
  const {
    currentBakeWidth,
    currentPatchLayout,
    currentSupersample,
    patchDescriptors,
    stats,
    maxTextureSize,
    accumulationTypeLabel,
    bakeUniforms,
  } = ctx;
  const storageSize = maxDescriptorStorageSize(patchDescriptors);
  const assignedSize = maxDescriptorAssignedSize(patchDescriptors);
  const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
  const demand = computeDemandReadouts(ctx);
  const capReadouts = computeCapReadouts({
    currentPatchLayout,
    currentSupersample,
    demand,
    patchDescriptors,
  });
  stats.textureWidth = currentBakeWidth;
  stats.textureHeight = currentPatchLayout.virtualHeight;
  stats.supersample = currentSupersample;
  stats.maxTextureSize = maxTextureSize;
  stats.accumulationType = accumulationTypeLabel;
  stats.patchGrid = patchGridLabel(currentPatchLayout);
  stats.autoPatchGrid = patchGridLabel(currentPatchLayout);
  stats.autoVirtualSize = autoVirtualSizeForDescriptors(currentPatchLayout, patchDescriptors);
  stats.autoLayoutReason = currentPatchLayout.autoLayoutReason ?? stats.autoLayoutReason ?? "automatic";
  Object.assign(stats, capReadouts);
  stats.patchWidth = assignedSize.width;
  stats.patchHeight = assignedSize.height;
  stats.patchStorageWidth = storageSize.width;
  stats.patchStorageHeight = storageSize.height;
  stats.patchGuard = currentPatchLayout.guard;
  stats.internalWidth = precisionSize.width;
  stats.internalHeight = precisionSize.height;
  stats.minCorePixels = MIN_CORE_PIXELS;
  stats.minGlarePixels = MIN_GLARE_PIXELS;
  stats.subpixelDensityThresholdPx = SUBPIXEL_DENSITY_THRESHOLD_PX;
  stats.aaPinThresholdPx = AA_PIN_THRESHOLD_PX;
  stats.subpixelEnergyMode = "density-pin-normal";
  stats.tileAwareGeneration = true;
  stats.starQueryGrid = `${currentStarGrid(bakeUniforms).columns}x${currentStarGrid(bakeUniforms).rows}`;
}

export function updateSphereSegmentStats(stats, currentSphereSegments) {
  stats.sphereSegments = currentSphereSegments;
  stats.sphereVerticalSegments = sphereVerticalSegmentsFor(currentSphereSegments);
}

export function defaultQueueState() {
  return {
    bakeJobQueue: [],
    activeBakeJobs: 0,
    activeBakeJob: null,
    pendingBakeJobs: 0,
    completedBakeJobs: 0,
    totalQueuedBakeJobs: 0,
  };
}

export { SPARSE_PATCH_MODES };
