import * as THREE from "three/webgpu";
import { STARFIELD_CONFIG } from "../config";
import {
  DENSITY_FALLBACK_STARS_PER_PIXEL,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  MAX_AUTO_SUPERSAMPLE,
  MAX_BAKE_JOBS_PER_FRAME,
  MIN_CORE_PIXELS,
  MIN_GLARE_PIXELS,
  PATCH_STATES,
  REFERENCE_BAKE_HEIGHT,
  REFERENCE_BAKE_WIDTH,
  AA_PIN_THRESHOLD_PX,
  SUBPIXEL_DENSITY_THRESHOLD_PX,
  emptyStarClassStats,
  estimateTextureBytes,
  formatBytes,
  STARFIELD_ALLOCATION_BUDGET_BYTES,
  STARFIELD_ALLOCATION_BUDGET_MIB,
  WINKLE_MAX_COUNT,
  sizeLabel,
  sphereVerticalSegmentsFor,
} from "./constants";
import {
  maxDescriptorPrecisionSize,
  maxDescriptorStorageSize,
  patchGridLabel,
} from "./patch-layout";
import {
  catalogStarCount,
  currentStarGrid,
  overlayCandidateStarCount,
} from "./catalog";
import type {
  BakeUniforms,
  CameraInfo,
  OverlayUniforms,
  PatchDescriptor,
  PatchLayout,
  QueueState,
  RendererInfoLike,
  StarfieldStats,
} from "./types";

interface InitialStatsArgs {
  initialPatchLayout: PatchLayout;
  supersample: number;
  maxTextureSize: number;
  accumulationTypeLabel: string;
  sphereSegments: number;
}

interface StatsTargetManager {
  activePatchTargets: Set<unknown>;
  allocationCount: number;
  activePatchTargetBytes(): number;
  pooledTargetBytes(): number;
  pooledTargets(): unknown[];
  pooledTargetsByBucket(): Record<string, number>;
  targetBucketSummary(counts: Record<string, number>): string;
}

interface StatsContext {
  currentCameraInfo: CameraInfo;
  currentPatchLayout: PatchLayout;
  currentSupersample: number;
  patchDescriptors: PatchDescriptor[];
  maxTextureSize: number;
  accumulationType: THREE.TextureDataType;
  accumulationTypeLabel: string;
  bakeUniforms: BakeUniforms;
  overlayUniforms?: OverlayUniforms;
  catalogDirty: boolean;
  overlayCatalogDirty?: boolean;
  stats: StarfieldStats;
  targetManager: StatsTargetManager;
  allocationBudgetBytes?: number;
  residentLayerCount?: number;
  residentBytesPerPixel?: number;
  bakeScratchBytes?: number;
  queueState: QueueState;
  activeBlendCount: number;
  syncOverlayStats(): void;
}

export function createInitialStats({
  initialPatchLayout,
  supersample,
  maxTextureSize,
  accumulationTypeLabel,
  sphereSegments,
}: InitialStatsArgs): StarfieldStats {
  const { background, baked, overlay } = STARFIELD_CONFIG;
  return {
    mode: "baked-equirect-skydome-tiled-catalog-splat",
    bakes: 0,
    renders: 0,
    textureWidth: initialPatchLayout.virtualWidth,
    textureHeight: initialPatchLayout.virtualHeight,
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
    patchGrid: patchGridLabel(initialPatchLayout),
    autoPatchGrid: patchGridLabel(initialPatchLayout),
    autoVirtualSize: sizeLabel(initialPatchLayout.virtualWidth, initialPatchLayout.virtualHeight),
    autoLayoutReason: initialPatchLayout.autoLayoutReason ?? "initial",
    catalogDirty: true,
    patchWidth: initialPatchLayout.contentWidth,
    patchHeight: initialPatchLayout.contentHeight,
    patchStorageWidth: initialPatchLayout.storageWidth,
    patchStorageHeight: initialPatchLayout.storageHeight,
    patchGuard: initialPatchLayout.guard,
    starCount: 0,
    starInstances: 0,
    ...emptyStarClassStats(),
    referenceWidth: REFERENCE_BAKE_WIDTH,
    referenceHeight: REFERENCE_BAKE_HEIGHT,
    internalWidth: initialPatchLayout.storageWidth * supersample,
    internalHeight: initialPatchLayout.storageHeight * supersample,
    sphereSegments,
    sphereVerticalSegments: sphereVerticalSegmentsFor(sphereSegments),
    backgroundLayerEnabled: true,
    backgroundLayerDrawCalls: 1,
    backgroundLayerTriangles: 0,
    backgroundLayerRadius: background.radius,
    backgroundSeed: background.params.uSeed,
    backgroundCoverage: background.params.uCoverage,
    backgroundDensity: background.params.uDensity,
    backgroundScale: background.params.uBaseScale,
    backgroundOpacity: background.params.uOpacity,
    backgroundNebulaStrength: background.params.uNebulaStrength,
    backgroundNebulaExposure: background.params.uNebulaExposure,
    backgroundLightIntensity: background.params.uLightIntensity,
    backgroundOctaves: background.params.uOctaves,
    backgroundTargetType: "unknown",
    backgroundTargetColorSpace: "unknown",
    backgroundTargetBytesPerPixel: 0,
    backgroundHdrEnabled: false,
    backgroundHdrFallback: true,
    bakedStarLayerEnabled: true,
    bakedStarLayerDrawCalls: initialPatchLayout.patchCount,
    bakedStarLayerRadius: baked.radius,
    bakedStarLayerDensity: baked.params.uDensity,
    bakedStarLayerSeed: baked.params.uSeed,
    bakedStarLayerStarCount: 0,
    overlayRadius: overlay.radius,
    overlayLayerDensity: overlay.params.uDensity,
    overlayLayerSeed: overlay.params.uSeed,
    overlayLayerStarCount: 0,
    overlayCatalogDirty: true,
    winkleAmount: overlay.params.uWinkleAmount,
    effectMinSize: overlay.params.uEffectMinSize,
    effectMaxSize: overlay.params.uEffectMaxSize,
    winkleSharpness: overlay.params.uWinkleSharpness,
    winkleFlashiness: overlay.params.uWinkleFlashiness,
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

export function computeDemandReadouts(ctx: StatsContext) {
  const {
    currentCameraInfo,
    currentPatchLayout,
    bakeUniforms,
    overlayUniforms = bakeUniforms,
    catalogDirty,
    overlayCatalogDirty = catalogDirty,
    stats,
  } = ctx;
  const targetTexelsPerPixel = currentPatchLayout.targetTexelsPerPixel ?? 1;
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
    targetTexelsPerPixel,
    texelsPerPixelTarget: targetTexelsPerPixel,
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

export function computeMemoryReadouts(ctx: StatsContext, demand = computeDemandReadouts(ctx)) {
  const {
    currentPatchLayout,
    currentSupersample,
    patchDescriptors,
    maxTextureSize,
    accumulationType,
    targetManager,
    allocationBudgetBytes,
    bakeScratchBytes,
    residentLayerCount = 1,
    residentBytesPerPixel = FINAL_TEXTURE_BYTES_PER_PIXEL * residentLayerCount,
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
    residentBytesPerPixel,
  ) * patchCount;
  const patchBudgetBytes = allocationBudgetBytes ?? STARFIELD_ALLOCATION_BUDGET_BYTES;

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

function autoVirtualSizeForDescriptors(layout: PatchLayout, descriptors: PatchDescriptor[]): string {
  const targetWidth = descriptors.reduce((maxWidth, descriptor) => Math.max(maxWidth, descriptor.targetSize.width), 1);
  const targetHeight = descriptors.reduce((maxHeight, descriptor) => Math.max(maxHeight, descriptor.targetSize.height), 1);
  return sizeLabel(targetWidth * layout.columns, targetHeight * layout.rows);
}

function maxDescriptorTargetSize(descriptors: PatchDescriptor[]) {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptor.targetSize?.width ?? 1),
    height: Math.max(size.height, descriptor.targetSize?.height ?? 1),
  }), { width: 1, height: 1 });
}

function maxDescriptorAssignedSize(descriptors: PatchDescriptor[]) {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptor.assignedSize?.width ?? descriptor.targetSize.width),
    height: Math.max(size.height, descriptor.assignedSize?.height ?? descriptor.targetSize.height),
  }), { width: 1, height: 1 });
}

function sizeIsCapped(actual: { width: number; height: number }, optimal: { width: number; height: number }): boolean {
  return Math.round(actual.width) < Math.round(optimal.width)
    || Math.round(actual.height) < Math.round(optimal.height);
}

function computeCapReadouts({
  currentPatchLayout,
  currentSupersample,
  demand,
  patchDescriptors,
}: {
  currentPatchLayout: PatchLayout;
  currentSupersample: number;
  demand: ReturnType<typeof computeDemandReadouts>;
  patchDescriptors: PatchDescriptor[];
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

export function updatePatchDescriptorDemand(ctx: StatsContext, demand: ReturnType<typeof computeDemandReadouts>): void {
  const {
    patchDescriptors,
  } = ctx;
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
    descriptor.downgraded = descriptor.assignedSize.bucket < descriptor.targetSize.bucket;
  });
}

export function patchDescriptorSummary(ctx: StatsContext, { includeDebug = false }: { includeDebug?: boolean } = {}): StarfieldStats {
  const {
    patchDescriptors,
    stats,
    queueState,
    targetManager,
    activeBlendCount,
    catalogDirty,
  } = ctx;
  const states: Record<string, number> = {};
  const allocationStates: Record<string, number> = {};
  const requiredBuckets = patchDescriptors.map((descriptor) => descriptor.requiredBucket);
  const targetBuckets = patchDescriptors.map((descriptor) => descriptor.targetBucket);
  const brightStarPressures = patchDescriptors.map((descriptor) => descriptor.brightStarPressure);
  const queriedStarCounts = patchDescriptors.map((descriptor) => descriptor.lastQueriedStarCount);
  const queriedInstanceCounts = patchDescriptors.map((descriptor) => descriptor.lastQueriedStarInstances);
  const pooledByBucket = targetManager.pooledTargetsByBucket();

  patchDescriptors.forEach((descriptor) => {
    states[descriptor.state] = (states[descriptor.state] ?? 0) + 1;
    allocationStates[descriptor.allocationState] = (allocationStates[descriptor.allocationState] ?? 0) + 1;
  });

  const formatCounts = (counts: Record<string, number>) => Object.entries(counts)
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
  const formatRange = (values: number[]) => {
    if (values.length === 0) return "none";
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? String(Math.round(min)) : `${Math.round(min)}-${Math.round(max)}`;
  };
  const summary: StarfieldStats = {
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
      lastQueriedStarCount: descriptor.lastQueriedStarCount,
      lastQueriedStarInstances: descriptor.lastQueriedStarInstances,
      lastQueriedCellCount: descriptor.lastQueriedCellCount,
      lastBakeReason: descriptor.lastBakeReason,
      lastBakeDurationMs: descriptor.lastBakeDurationMs,
      lastBakedLayerKey: descriptor.lastBakedLayerKey,
      lastBakedScreenSignatureKey: descriptor.lastBakedScreenSignatureKey,
      lastBakedStorageSize: descriptor.lastBakedStorageSize ? { ...descriptor.lastBakedStorageSize } : null,
      pendingLayerBakeKey: descriptor.pendingLayerBakeKey,
      layerDirty: descriptor.layerDirty,
      layerDirtyReason: descriptor.layerDirtyReason,
      blendActive: descriptor.blendActive,
      blendProgress: descriptor.blendProgress,
    }));
  }

  return summary;
}

export function collectStatsPayload(
  ctx: StatsContext,
  rendererInfo: RendererInfoLike,
  cameraInfo: Partial<CameraInfo> = {},
  { detail = "panel" }: { detail?: "panel" | "debug" } = {},
): StarfieldStats {
  void cameraInfo;
  const {
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
  const rendererFrame = rendererInfo.render.frame ?? rendererInfo.frame ?? 0;
  const result: StarfieldStats = {
    ...stats,
    ...demand,
    ...memory,
    ...descriptors,
    ...capReadouts,
    frame: rendererFrame,
    drawCalls: rendererInfo.render.calls,
    callFrames: `${rendererInfo.render.calls}/${rendererFrame}`,
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

export function updatePatchStats(ctx: StatsContext): void {
  const {
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
  stats.textureWidth = currentPatchLayout.virtualWidth;
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
