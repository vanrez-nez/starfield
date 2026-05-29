import * as THREE from "three/webgpu";
import {
  STARFIELD_CONFIG,
  cloneStarLayerParams,
} from "./config";
import {
  ALLOCATION_STATES,
  BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS,
  BRIGHT_STAR_OVERLAY_ENABLED,
  CAMERA_BAKE_IDLE_MS,
  CATALOG_PARAMS,
  FALLBACK_STATES,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  PATCH_STATES,
  REFERENCE_BAKE_HEIGHT,
  SKYDOME_SPHERE_SEGMENTS,
  STARFIELD_ALLOCATION_BUDGET_BYTES,
  STAR_QUERY_SEAM_COPIES,
  estimateTextureBytes,
  screenPixelAngleFromInfo,
  sizeLabel,
} from "./starfield/constants";
import {
  assignDescriptorStorage,
  createAutoPatchLayout,
  createPatchDescriptors as createPatchDescriptorList,
  maxDescriptorPrecisionSize,
  patchGridLabel,
} from "./starfield/patch-layout";
import {
  catalogStarCount,
  createEmptyStarGeometry,
  createStarGeometryForDescriptor,
} from "./starfield/catalog";
import { createRenderTargetManager } from "./starfield/render-targets";
import {
  createDownsampleMaterial,
  createPatchDomeMaterial,
  createStarMaterial,
} from "./starfield/shaders";
import { createSkydomeManager } from "./starfield/skydome";
import { createStarLayerManager } from "./starfield/star-layers";
import {
  collectStatsPayload,
  computeDemandReadouts as computeDemandReadoutsFromStats,
  computeMemoryReadouts as computeMemoryReadoutsFromStats,
  createInitialStats,
  patchDescriptorSummary as patchDescriptorSummaryFromStats,
  updatePatchDescriptorDemand as updatePatchDescriptorDemandFromStats,
  updatePatchStats as updatePatchStatsFromStats,
} from "./starfield/stats";
import { createBakePipeline } from "./starfield/bake-pipeline";
import {
  createNebulaLayer,
} from "./nebula";
import type { NebulaLayerApi } from "./nebula";
import type {
  BakeUniforms,
  CameraInfo,
  DownsampleUniforms,
  LayerId,
  OverlayUniforms,
  PatchDescriptor,
  PatchLayout,
  PatchRenderTarget,
  PatchTextureTarget,
  RequestRender,
  RendererInfoLike,
  ScreenBakeSignature,
  StarLayerParams,
  StarfieldStats,
  UniformMap,
} from "./starfield/types";

type BakePipeline = ReturnType<typeof createBakePipeline>;
type DemandReadouts = ReturnType<typeof computeDemandReadoutsFromStats>;

const PARALLAX_GUARD_USAGE = 0.45;

interface CreateStarfieldArgs {
  renderer: THREE.Renderer;
  scene: THREE.Scene;
  requestRender: RequestRender;
}

interface PendingDisplaySwap {
  previousDescriptors: PatchDescriptor[];
}

interface LayerStateEntry<P extends Record<string, unknown>, U extends UniformMap = UniformMap> {
  enabled: boolean;
  radius: number;
  params: P;
  uniforms?: U;
}

interface StarfieldLayerState {
  bakedStars: LayerStateEntry<StarLayerParams, BakeUniforms>;
  brightOverlay: LayerStateEntry<StarLayerParams, OverlayUniforms>;
}

export function createStarfield({ renderer, scene, requestRender }: CreateStarfieldArgs) {
  const targetManager = createRenderTargetManager({ renderer });
  const maxTextureSize = targetManager.maxTextureSize;
  const accumulationType = targetManager.accumulationType;
  const accumulationTypeLabel = targetManager.halfFloatAccumulationSupported ? "HalfFloatType" : "UnsignedByteType";
  const residentPatchBytesPerPixel = FINAL_TEXTURE_BYTES_PER_PIXEL + targetManager.backgroundTargetBytesPerPixel;

  const starScene = new THREE.Scene();
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let pipeline: BakePipeline;
  let bakeStatusHandler: (label: string, disabled?: boolean) => void = () => {};
  let readoutsChangeHandler: (readouts?: unknown) => void = () => {};
  let brightStarOverlayEnabled: boolean = BRIGHT_STAR_OVERLAY_ENABLED;
  let catalogDirty = true;
  let overlayCatalogDirty = true;
  let autoLayoutTimer = 0;
  let pendingAutoLayoutKey = "";
  let pendingDisplaySwap: PendingDisplaySwap | null = null;
  let layoutInitialized = false;
  let currentCameraInfo: CameraInfo = {
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

  const initialPatchLayout = createAutoPatchLayout({
    cameraInfo: currentCameraInfo,
    maxTextureSize,
    accumulationType,
    residentBytesPerPixel: residentPatchBytesPerPixel,
  });
  const layerState: StarfieldLayerState = {
    bakedStars: {
      enabled: STARFIELD_CONFIG.baked.enabled,
      radius: STARFIELD_CONFIG.baked.radius,
      params: cloneStarLayerParams(STARFIELD_CONFIG.baked.params),
    },
    brightOverlay: {
      enabled: STARFIELD_CONFIG.overlay.enabled,
      radius: STARFIELD_CONFIG.overlay.radius,
      params: {
        ...cloneStarLayerParams(STARFIELD_CONFIG.overlay.params),
      },
    },
  };
  const stats = createInitialStats({
    initialPatchLayout,
    supersample: initialPatchLayout.supersample,
    maxTextureSize,
    accumulationTypeLabel,
    sphereSegments: SKYDOME_SPHERE_SEGMENTS,
  });
  window.starfieldStats = stats;

  const fallbackPatchTexture = targetManager.createFallbackPatchTexture();
  const fallbackPatchTarget: PatchTextureTarget = { texture: fallbackPatchTexture };
  const screenPixelAngleUniform = { value: Math.PI / REFERENCE_BAKE_HEIGHT };
  const referenceHeightUniform = { value: REFERENCE_BAKE_HEIGHT };
  const parallaxOffsetUniform = { value: new THREE.Vector3() };

  const bakeUniforms: BakeUniforms = {
    uBakeSize: { value: new THREE.Vector2(
      initialPatchLayout.storageWidth * initialPatchLayout.supersample,
      initialPatchLayout.storageHeight * initialPatchLayout.supersample,
    ) },
    uOutputSize: { value: new THREE.Vector2(initialPatchLayout.storageWidth, initialPatchLayout.storageHeight) },
    uTileUvMin: { value: new THREE.Vector2(0, 0) },
    uTileUvSize: { value: new THREE.Vector2(1, 1) },
    uScreenPixelAngle: screenPixelAngleUniform,
    uReferenceHeight: referenceHeightUniform,
    uDensity: { value: layerState.bakedStars.params.uDensity },
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
    uParallaxStrength: { value: layerState.bakedStars.params.uParallaxStrength },
    uParallaxOffset: parallaxOffsetUniform,
  };
  const overlayUniforms: OverlayUniforms = {
    uScreenPixelAngle: screenPixelAngleUniform,
    uReferenceHeight: referenceHeightUniform,
    uDensity: { value: layerState.brightOverlay.params.uDensity },
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
    uParallaxStrength: { value: layerState.brightOverlay.params.uParallaxStrength },
    uParallaxOffset: parallaxOffsetUniform,
    uWinkleAmount: { value: layerState.brightOverlay.params.uWinkleAmount! },
    uEffectMinSize: { value: layerState.brightOverlay.params.uEffectMinSize! },
    uEffectMaxSize: { value: layerState.brightOverlay.params.uEffectMaxSize! },
    uWinkleSharpness: { value: layerState.brightOverlay.params.uWinkleSharpness! },
    uWinkleFlashiness: { value: layerState.brightOverlay.params.uWinkleFlashiness! },
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
    overlayRadius: layerState.brightOverlay.radius,
  });
  starLayers.setEnabled(brightStarOverlayEnabled);

  const downsampleUniforms: DownsampleUniforms = {
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

  let currentPatchLayout = initialPatchLayout;
  let currentSupersample = currentPatchLayout.supersample;
  let patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
  let supersampleTarget = targetManager.createAccumulationTarget(1, 1);
  const nebulaLayer: NebulaLayerApi = createNebulaLayer({
    renderer,
    scene,
    bakeCamera,
    requestRender,
    targetManager,
    initialLayout: currentPatchLayout,
    stats,
    notifyReadouts,
    getSphereSegments: () => SKYDOME_SPHERE_SEGMENTS,
  });

  const skydome = createSkydomeManager({
    scene,
    requestRender,
    targetManager,
    fallbackPatchTarget,
    getSphereSegments: () => SKYDOME_SPHERE_SEGMENTS,
    initialRadius: layerState.bakedStars.radius,
    geometryUvRangeForDescriptor: (descriptor) => ({
      uvMin: descriptor.storageUvMin,
      uvSize: descriptor.storageUvSize,
    }),
    createMaterial: (args) => createPatchDomeMaterial({
      ...args,
      parallaxUniforms: {
        strength: bakeUniforms.uParallaxStrength,
        offset: parallaxOffsetUniform,
      },
    }),
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
    maxTextureSize,
    stats,
    skydome,
    getCurrentCameraInfo: () => currentCameraInfo,
    getCurrentPatchLayout: () => currentPatchLayout,
    getCurrentSupersample: () => currentSupersample,
    setCurrentSupersample: (value: number) => {
      currentSupersample = value;
    },
    getPatchDescriptors: () => patchDescriptors,
    getSupersampleTarget: () => supersampleTarget,
    targetForDescriptor,
    targetMatchesDescriptor,
    releaseTarget: (target: PatchRenderTarget) => targetManager.releaseTarget(target),
    descriptorById,
    setStarBakeGeometry,
    createBakeGeometry: (descriptor: PatchDescriptor) => createStarGeometryForDescriptor({
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

  const referenceParallaxForward = new THREE.Vector3(0, 0, -1);
  const currentParallaxForward = new THREE.Vector3(0, 0, -1);
  let parallaxForwardInitialized = false;

  function currentParallaxScale(): number {
    let minGuardAngle = Number.POSITIVE_INFINITY;
    patchDescriptors.forEach((descriptor) => {
      const guardU = Math.max(0, (descriptor.storageUvSize.x - descriptor.uvSize.x) * 0.5);
      const guardV = Math.max(0, (descriptor.storageUvSize.y - descriptor.uvSize.y) * 0.5);
      const guardAngles = [guardU * Math.PI * 2, guardV * Math.PI].filter((angle) => angle > 1e-8);
      guardAngles.forEach((angle) => {
        minGuardAngle = Math.min(minGuardAngle, angle);
      });
    });

    return Number.isFinite(minGuardAngle) ? minGuardAngle * PARALLAX_GUARD_USAGE : 0;
  }

  function updateVirtualParallax(cameraInfo: Partial<CameraInfo> = currentCameraInfo): void {
    currentParallaxForward.set(
      Number(cameraInfo.forwardX ?? currentCameraInfo.forwardX ?? 0),
      Number(cameraInfo.forwardY ?? currentCameraInfo.forwardY ?? 0),
      Number(cameraInfo.forwardZ ?? currentCameraInfo.forwardZ ?? -1),
    );

    if (currentParallaxForward.lengthSq() <= 1e-8) {
      currentParallaxForward.set(0, 0, -1);
    } else {
      currentParallaxForward.normalize();
    }

    if (!parallaxForwardInitialized) {
      referenceParallaxForward.copy(currentParallaxForward);
      parallaxForwardInitialized = true;
    }

    parallaxOffsetUniform.value
      .copy(currentParallaxForward)
      .sub(referenceParallaxForward)
      .multiplyScalar(currentParallaxScale());
  }

  function accumulationBytesPerPixel(): number {
    return accumulationType === THREE.HalfFloatType ? 8 : 4;
  }

  function currentBakeScratchBytes(): number {
    if (!supersampleTarget || supersampleTarget.width <= 1 || supersampleTarget.height <= 1) return 0;
    return estimateTextureBytes(supersampleTarget.width, supersampleTarget.height, accumulationBytesPerPixel());
  }

  function releaseBakeScratch(): void {
    if (!supersampleTarget || (supersampleTarget.width <= 1 && supersampleTarget.height <= 1)) return;
    supersampleTarget.setSize(1, 1);
  }

  function makeStatsContext() {
    return {
      currentCameraInfo,
      currentPatchLayout,
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
      residentLayerCount: 2,
      residentBytesPerPixel: residentPatchBytesPerPixel,
      bakeScratchBytes: currentBakeScratchBytes(),
      queueState: pipeline.queueState(),
      activeBlendCount: skydome.activeBlendCount + nebulaLayer.activeBlendCount,
      setCameraInfo,
      syncOverlayStats,
    };
  }

  function setBakeStatus(label: string, disabled = false): void {
    bakeStatusHandler(label, disabled);
  }

  function notifyReadouts(): void {
    readoutsChangeHandler(getReadouts());
  }

  function roundedNumber(value: number, digits = 4): number {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function screenBakeSignature(cameraInfo: CameraInfo = currentCameraInfo): ScreenBakeSignature {
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

  function patchLayoutKey(layout: PatchLayout): string {
    return [
      `${layout.columns}x${layout.rows}`,
      `guard:${layout.guard}`,
      `content:${layout.contentWidth}x${layout.contentHeight}`,
      `ss:${layout.supersample ?? 1}`,
    ].join("|");
  }

  function computeAutoPatchLayout(): PatchLayout {
    return createAutoPatchLayout({
      cameraInfo: currentCameraInfo,
      maxTextureSize,
      accumulationType,
      residentBytesPerPixel: residentPatchBytesPerPixel,
    });
  }

  function plannedDescriptorContentSize(descriptor: PatchDescriptor) {
    const sourceSize = descriptor.targetSize;
    return {
      width: sourceSize.width,
      height: sourceSize.height,
    };
  }

  function plannedDescriptorStorageSize(descriptor: PatchDescriptor) {
    const contentSize = plannedDescriptorContentSize(descriptor);
    const assignedWidth = Math.min(maxTextureSize, Math.max(1, Math.round(contentSize.width)));
    const assignedHeight = Math.min(maxTextureSize, Math.max(1, Math.round(contentSize.height)));
    return {
      width: Math.min(maxTextureSize, assignedWidth + currentPatchLayout.guard * 2),
      height: Math.min(maxTextureSize, assignedHeight + currentPatchLayout.guard * 2),
    };
  }

  function desiredLayerBakeKey(descriptor: PatchDescriptor, signature = screenBakeSignature()): string {
    const storageSize = plannedDescriptorStorageSize(descriptor);
    return [
      descriptor.id,
      signature.key,
      `storage:${storageSize.width}x${storageSize.height}`,
      `overlay:${brightStarOverlayEnabled ? 1 : 0}`,
    ].join("|");
  }

  function applyDescriptorBakeStorage(descriptor: PatchDescriptor): void {
    const contentSize = plannedDescriptorContentSize(descriptor);
    assignDescriptorStorage(
      descriptor,
      contentSize.width,
      contentSize.height,
      currentPatchLayout.guard,
      maxTextureSize,
    );
  }

  function attachTargetSamplingMetadata(descriptor: PatchDescriptor, target: PatchRenderTarget): void {
    target.starfieldSampling = {
      innerOffset: descriptor.innerOffset.clone(),
      innerScale: descriptor.innerScale.clone(),
      storageUvMin: descriptor.storageUvMin.clone(),
      storageUvSize: descriptor.storageUvSize.clone(),
      assignedSize: { ...descriptor.assignedSize },
      storageSize: { ...descriptor.storageSize },
    };
  }

  function targetForDescriptor(descriptor: PatchDescriptor, name = "Baked skydome patch"): PatchRenderTarget {
    applyDescriptorBakeStorage(descriptor);
    const target = targetManager.acquireTarget(descriptor.storageSize.width, descriptor.storageSize.height, {
      name,
      wrapS: descriptor.wrapS,
      wrapT: descriptor.wrapT,
    });
    attachTargetSamplingMetadata(descriptor, target);
    return target;
  }

  function targetMatchesDescriptor(descriptor: PatchDescriptor, target: PatchRenderTarget | null): boolean {
    if (!target) return false;
    const storageSize = plannedDescriptorStorageSize(descriptor);
    return targetManager.renderTargetWidth(target) === storageSize.width
      && targetManager.renderTargetHeight(target) === storageSize.height;
  }

  function recordDescriptorLayerBake(descriptor: PatchDescriptor): void {
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

  function createPatchDescriptorsWithTargets(layout: PatchLayout): PatchDescriptor[] {
    const descriptors = createPatchDescriptorList(layout, maxTextureSize);
    descriptors.forEach((descriptor) => {
      descriptor.currentTarget = targetForDescriptor(descriptor, `Baked skydome patch ${descriptor.x + 1},${descriptor.y + 1}`);
      descriptor.target = descriptor.currentTarget;
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
    });
    return descriptors;
  }

  function descriptorById(patchId: string): PatchDescriptor | undefined {
    return patchDescriptors.find((descriptor) => descriptor.id === patchId);
  }

  function syncOverlayStats(): void {
    Object.assign(stats, starLayers.collectStats());
    Object.assign(stats, nebulaLayer.collectStats());
    stats.bakedStarLayerEnabled = layerState.bakedStars.enabled;
    stats.bakedStarLayerDrawCalls = layerState.bakedStars.enabled ? patchDescriptors.length : 0;
    stats.bakedStarLayerRadius = layerState.bakedStars.radius;
    stats.bakedStarLayerStrength = layerState.bakedStars.params.uParallaxStrength;
    stats.bakedStarLayerDensity = layerState.bakedStars.params.uDensity;
    stats.bakedStarLayerSeed = layerState.bakedStars.params.uSeed;
    stats.bakedStarLayerStarCount = catalogStarCount(bakeUniforms);
    stats.overlayLayerDensity = layerState.brightOverlay.params.uDensity;
    stats.overlayLayerStrength = layerState.brightOverlay.params.uParallaxStrength;
    stats.overlayLayerSeed = layerState.brightOverlay.params.uSeed;
    stats.overlayLayerStarCount = catalogStarCount(overlayUniforms);
    stats.winkleAmount = layerState.brightOverlay.params.uWinkleAmount;
    stats.effectMinSize = layerState.brightOverlay.params.uEffectMinSize;
    stats.effectMaxSize = layerState.brightOverlay.params.uEffectMaxSize;
    stats.winkleSharpness = layerState.brightOverlay.params.uWinkleSharpness;
    stats.winkleFlashiness = layerState.brightOverlay.params.uWinkleFlashiness;
    stats.overlayCatalogDirty = overlayCatalogDirty;
  }

  function rebuildOverlayCatalog(): void {
    const { classStats } = starLayers.rebuild({
      overlayUniforms,
      enabled: brightStarOverlayEnabled,
    });
    overlayCatalogDirty = false;
    Object.assign(stats, classStats);
    syncOverlayStats();
  }

  function syncBakedCatalogStats(): void {
    catalogDirty = false;
    stats.starCount = catalogStarCount(bakeUniforms);
    stats.starInstances = stats.starCount * STAR_QUERY_SEAM_COPIES;
    syncOverlayStats();
  }

  function markCatalogDirty(layerId: LayerId = "bakedStars"): void {
    if (layerId === "brightOverlay") {
      overlayCatalogDirty = true;
      return;
    }
    catalogDirty = true;
  }

  function ensureStarCatalog(): void {
    if (overlayCatalogDirty) {
      rebuildOverlayCatalog();
    }
    if (catalogDirty) {
      syncBakedCatalogStats();
    }
  }

  function setStarBakeGeometry(nextGeometry: THREE.InstancedBufferGeometry): void {
    starMesh.geometry = nextGeometry;
    starGeometry.dispose();
    starGeometry = nextGeometry;
  }

  function computeDemandReadouts() {
    return computeDemandReadoutsFromStats(makeStatsContext());
  }

  function computeMemoryReadouts(demand: DemandReadouts = computeDemandReadouts()) {
    return computeMemoryReadoutsFromStats(makeStatsContext(), demand);
  }

  function updatePatchDescriptorDemand(demand: DemandReadouts): void {
    updatePatchDescriptorDemandFromStats(makeStatsContext(), demand);
  }

  function patchDescriptorSummary() {
    return patchDescriptorSummaryFromStats(makeStatsContext());
  }

  function autoVirtualSizeLabel(): string {
    const targetWidth = patchDescriptors.reduce((maxWidth, descriptor) => Math.max(maxWidth, descriptor.targetSize.width), 1);
    const targetHeight = patchDescriptors.reduce((maxHeight, descriptor) => Math.max(maxHeight, descriptor.targetSize.height), 1);
    return sizeLabel(targetWidth * currentPatchLayout.columns, targetHeight * currentPatchLayout.rows);
  }

  function currentPatchSizeLabel(): string {
    const targetWidth = patchDescriptors.reduce((maxWidth, descriptor) => Math.max(maxWidth, descriptor.assignedSize?.width ?? descriptor.targetSize.width), 1);
    const targetHeight = patchDescriptors.reduce((maxHeight, descriptor) => Math.max(maxHeight, descriptor.assignedSize?.height ?? descriptor.targetSize.height), 1);
    return sizeLabel(targetWidth, targetHeight);
  }

  function updateDemandStats(): void {
    const demand = computeDemandReadouts();
    updatePatchDescriptorDemand(demand);
    currentSupersample = currentPatchLayout.supersample ?? 1;
    Object.assign(stats, demand, computeMemoryReadouts(demand), patchDescriptorSummary());
  }

  function updatePatchStats(): void {
    updatePatchStatsFromStats(makeStatsContext());
    updateDemandStats();
  }

  function descriptorsNeedingScreenLayerBake(): PatchDescriptor[] {
    const signature = screenBakeSignature();
    const changedDescriptors: PatchDescriptor[] = [];

    patchDescriptors.forEach((descriptor) => {
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

  function scheduleScreenLayerRebakes(): void {
    const descriptors = descriptorsNeedingScreenLayerBake();
    if (descriptors.length > 0) {
      pipeline.scheduleLayerBakeJobs(descriptors, "screen");
    }
    nebulaLayer.markStale("screen");
    nebulaLayer.scheduleBake(CAMERA_BAKE_IDLE_MS);
  }

  function completePendingDisplaySwap(): void {
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

  function applyAutomaticPatchLayout(reason = "automatic", { bake = true }: { bake?: boolean } = {}): boolean {
    const nextLayout = computeAutoPatchLayout();
    if (!nextLayout || patchLayoutKey(nextLayout) === patchLayoutKey(currentPatchLayout)) {
      stats.autoLayoutReason = nextLayout?.autoLayoutReason ?? reason;
      return false;
    }

    const previousDescriptors = patchDescriptors;
    pipeline.clearBakeQueue();
    nebulaLayer.clearBakeQueue();
    currentPatchLayout = nextLayout;
    patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
    currentSupersample = currentPatchLayout.supersample ?? 1;
    pendingDisplaySwap = null;
    skydome.disposeBakedDomeMeshes();
    disposePatchDescriptors(previousDescriptors, { releaseTargets: false });
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    nebulaLayer.setLayout(currentPatchLayout, { bake: false, reason });
    stats.autoLayoutReason = nextLayout.autoLayoutReason ?? reason;
    stats.pendingAutoLayout = false;
    updatePatchStats();
    syncOverlayStats();
    notifyReadouts();
    if (bake) {
      pipeline.bakeNow();
      nebulaLayer.bakeNow();
    }
    return true;
  }

  function scheduleAutomaticPatchLayout(reason = "screen", delay = 450): boolean {
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

  function disposePatchDescriptors(
    descriptors: PatchDescriptor[],
    {
      releaseTargets = true,
      skydomeManager = skydome,
    }: {
      releaseTargets?: boolean;
      skydomeManager?: typeof skydome;
    } = {},
  ): void {
    descriptors.forEach((descriptor) => {
      const targets = new Set<PatchRenderTarget>([
        descriptor.currentTarget,
        descriptor.nextTarget,
        descriptor.target,
        descriptor.blendFromTarget,
        descriptor.blendToTarget,
      ].filter((target): target is PatchRenderTarget => Boolean(target)));

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
      skydomeManager.clearBlendForDescriptor(descriptor);
    });
  }

  function setLayerParamValue(layerId: keyof StarfieldLayerState, key: string, value: number): boolean {
    const layer = layerState[layerId];
    if (!layer?.params || !layer?.uniforms?.[key]) return false;
    layer.params[key] = value;
    layer.uniforms[key].value = value;
    return true;
  }

  function setLayerParam(layerId: LayerId, key: string, value: number, delay = 180): void {
    const nextValue = Number(value);
    if (layerId === "skyBackground") {
      if (Number.isFinite(nextValue) && nebulaLayer.setParam(key, nextValue, delay)) {
        syncOverlayStats();
      }
      return;
    }

    if (!Number.isFinite(nextValue) || !setLayerParamValue(layerId, key, nextValue)) return;

    if (key === "uParallaxStrength") {
      if (layerId === "bakedStars") {
        skydome.setMaterialUniformValue("uParallaxStrength", nextValue);
      }
      syncOverlayStats();
      notifyReadouts();
      requestRender();
      return;
    }

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
      if (
        key === "uWinkleAmount"
        || key === "uEffectMinSize"
        || key === "uEffectMaxSize"
        || key === "uWinkleSharpness"
        || key === "uWinkleFlashiness"
      ) {
        if (key === "uWinkleAmount") {
          starLayers.setWinkleAmount(nextValue);
        }
        syncOverlayStats();
        notifyReadouts();
        requestRender();
        return;
      }
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

  function getLayerParam(layerId: LayerId, key: string): number {
    if (layerId === "skyBackground") {
      return nebulaLayer.getParam(key);
    }
    const value = layerState[layerId]?.params?.[key];
    return typeof value === "number" ? value : 0;
  }

  function reseedLayer(layerId: LayerId): number {
    if (layerId === "skyBackground") return 0;
    if (!layerState[layerId]?.params) return 0;
    const nextSeed = Math.floor(Math.random() * 1001);
    setLayerParam(layerId, "uSeed", nextSeed, 0);
    return nextSeed;
  }

  function setLayerEnabled(layerId: LayerId, enabled: boolean): void {
    const nextEnabled = Boolean(enabled);

    if (layerId === "skyBackground") {
      nebulaLayer.setEnabled(nextEnabled);
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

  function getLayerEnabled(layerId: LayerId): boolean {
    if (layerId === "skyBackground") {
      return nebulaLayer.getEnabled();
    }
    return Boolean(layerState[layerId]?.enabled);
  }

  function setBrightStarOverlayEnabled(enabled: boolean): void {
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

  function getBrightStarOverlayEnabled(): boolean {
    return brightStarOverlayEnabled;
  }

  function reseed(): void {
    reseedLayer("bakedStars");
  }

  function getReadouts() {
    const demand = computeDemandReadouts();
    updatePatchDescriptorDemand(demand);
    const memory = computeMemoryReadouts(demand);
    const descriptors = patchDescriptorSummary();
    const precisionSize = maxDescriptorPrecisionSize(patchDescriptors, currentSupersample);
    return {
      virtualSize: autoVirtualSizeLabel(),
      autoLayoutReason: currentPatchLayout.autoLayoutReason ?? stats.autoLayoutReason ?? "automatic",
      patchGrid: patchGridLabel(currentPatchLayout),
      patchSize: currentPatchSizeLabel(),
      supersample: `${currentSupersample}x`,
      internalPatchSize: sizeLabel(precisionSize.width, precisionSize.height),
      gpuLimit: `${maxTextureSize}`,
      demand,
      memory,
      descriptors,
    };
  }

  function setCameraInfo(cameraInfo: Partial<CameraInfo>, options: { notify?: boolean } = {}): boolean {
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

  function recordRender({
    cameraInfo = currentCameraInfo,
  }: {
    cameraInfo?: Partial<CameraInfo>;
  } = {}): void {
    stats.renders = Number(stats.renders ?? 0) + 1;
    updateVirtualParallax(cameraInfo);
    starLayers.advanceRuntime();
    nebulaLayer.recordRender();
    if (skydome.activeBlendCount > 0 && skydome.advancePatchBlends()) {
      requestRender();
    }
  }

  function bakeNow(): void {
    pipeline.bakeNow();
    nebulaLayer.bakeNow();
  }

  function scheduleBake(delay = 180): void {
    pipeline.scheduleBake(delay);
    nebulaLayer.scheduleBake(delay);
  }

  function collectStats(rendererInfo: RendererInfoLike, cameraInfo: Partial<CameraInfo> = {}, options: { detail?: "panel" | "debug" } = {}) {
    return collectStatsPayload(makeStatsContext(), rendererInfo, cameraInfo, options);
  }

  function dispose(): void {
    clearTimeout(autoLayoutTimer);
    pipeline.clearBakeQueue();
    nebulaLayer.clearBakeQueue();
    if (pendingDisplaySwap) {
      disposePatchDescriptors(pendingDisplaySwap.previousDescriptors, { releaseTargets: false });
      pendingDisplaySwap = null;
    }
    disposePatchDescriptors(patchDescriptors, { releaseTargets: false });
    targetManager.disposeTargetPool();
    nebulaLayer.dispose();
    skydome.dispose();
    supersampleTarget.dispose();
    starGeometry.dispose();
    starMaterial.dispose();
    starLayers.dispose();
    fallbackPatchTexture.dispose();
    downsampleQuad.geometry.dispose();
    downsampleMaterial.dispose();
  }

  function setBakeStatusHandler(handler: (label: string, disabled?: boolean) => void): void {
    bakeStatusHandler = handler;
  }

  function setReadoutsChangeHandler(handler: (readouts?: unknown) => void): void {
    readoutsChangeHandler = handler;
  }

  syncOverlayStats();
  updatePatchStats();

  return {
    getReadouts,
    setLayerEnabled,
    getLayerEnabled,
    setLayerParam,
    getLayerParam,
    reseedLayer,
    setBrightStarOverlayEnabled,
    getBrightStarOverlayEnabled,
    reseed,
    bakeNow,
    scheduleBake,
    collectStats,
    dispose,
    setBakeStatusHandler,
    setReadoutsChangeHandler,
    setCameraInfo,
    recordRender,
  };
}
