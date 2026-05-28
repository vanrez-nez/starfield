import * as THREE from "three/webgpu";
import {
  ALLOCATION_STATES,
  BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS,
  BRIGHT_STAR_OVERLAY_ENABLED,
  CAMERA_BAKE_IDLE_MS,
  CATALOG_PARAMS,
  DEFAULT_BAKED_STAR_RADIUS,
  DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS,
  DEFAULT_EFFECT_MAX_SIZE,
  DEFAULT_EFFECT_MIN_SIZE,
  DEFAULT_FIELD_GRADIENT,
  DEFAULT_LARGE_STAR_RARITY,
  DEFAULT_LIGHT_COMPOSITION_BACKGROUND,
  DEFAULT_WINKLE_AMOUNT,
  DEFAULT_WINKLE_FLASHINESS,
  DEFAULT_WINKLE_SHARPNESS,
  DEFAULT_SKY_BACKGROUND_RADIUS,
  FALLBACK_STATES,
  LIGHT_COMPOSITION_MAX_ANCHORS,
  MIN_BACKGROUND_SPHERE_SEGMENTS,
  PATCH_STATES,
  REFERENCE_BAKE_HEIGHT,
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
  createBackgroundPatchDomeMaterial,
  createDownsampleMaterial,
  createLightCompositionBakeMaterial,
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
  updateSphereSegmentStats,
} from "./starfield/stats";
import { createBakePipeline } from "./starfield/bake-pipeline";
import { createBackgroundBakePipeline } from "./starfield/background-bake-pipeline";
import type {
  BackgroundParams,
  BackgroundUniforms,
  BakeUniforms,
  CameraInfo,
  DownsampleUniforms,
  FieldGradient,
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
type BackgroundBakePipeline = ReturnType<typeof createBackgroundBakePipeline>;
type DemandReadouts = ReturnType<typeof computeDemandReadoutsFromStats>;

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
  skyBackground: LayerStateEntry<BackgroundParams, BackgroundUniforms>;
  bakedStars: LayerStateEntry<StarLayerParams, BakeUniforms>;
  brightOverlay: LayerStateEntry<StarLayerParams, OverlayUniforms>;
}

function vectorFromArray(value: unknown, fallback: [number, number, number] = [0, 0, 0]): THREE.Vector3 {
  const source = Array.isArray(value) && value.length >= 3 ? value : fallback;
  return new THREE.Vector3(Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0);
}

function normalizedVectorFromArray(value: unknown, fallback: [number, number, number] = [0, 0, 1]): THREE.Vector3 {
  const vector = vectorFromArray(value, fallback);
  if (vector.lengthSq() < 1e-8) return vectorFromArray(fallback).normalize();
  return vector.normalize();
}

function applyFieldGradientToUniforms(uniforms: BackgroundUniforms, gradient: Readonly<FieldGradient> = DEFAULT_FIELD_GRADIENT): void {
  const anchors = Array.isArray(gradient.anchors) ? gradient.anchors.slice(0, LIGHT_COMPOSITION_MAX_ANCHORS) : [];
  uniforms.uAnchorCount.value = anchors.length;
  uniforms.uBlend.value = gradient.blend === "gaussian" ? 1 : 0;
  uniforms.uPower.value = typeof gradient.power === "number" && Number.isFinite(gradient.power) ? gradient.power : 2;
  uniforms.uSigma.value = typeof gradient.sigma === "number" && Number.isFinite(gradient.sigma) ? gradient.sigma : 0.34;
  uniforms.uColorWarpAmp.value = Number.isFinite(gradient.warp?.amp)
    ? gradient.warp?.amp ?? uniforms.uColorWarpAmp.value
    : uniforms.uColorWarpAmp.value;
  uniforms.uColorWarpFreq.value = Number.isFinite(gradient.warp?.freq)
    ? gradient.warp?.freq ?? uniforms.uColorWarpFreq.value
    : uniforms.uColorWarpFreq.value;

  for (let index = 0; index < LIGHT_COMPOSITION_MAX_ANCHORS; index += 1) {
    const anchor = anchors[index];
    uniforms.uAnchorDir.value[index].copy(normalizedVectorFromArray(anchor?.dir));
    uniforms.uAnchorColor.value[index].copy(vectorFromArray(anchor?.color));
  }
}

function createLightCompositionUniforms(
  params: BackgroundParams,
  gradient: Readonly<FieldGradient> = DEFAULT_FIELD_GRADIENT,
): BackgroundUniforms {
  const uniforms = {
    uTileUvMin: { value: new THREE.Vector2(0, 0) },
    uTileUvSize: { value: new THREE.Vector2(1, 1) },
    uAnchorCount: { value: 0 },
    uBlend: { value: 1 },
    uPower: { value: 2 },
    uSigma: { value: 0.34 },
    uColorWarpAmp: { value: params.uColorWarpAmp },
    uColorWarpFreq: { value: params.uColorWarpFreq },
    uAnchorDir: { value: Array.from({ length: LIGHT_COMPOSITION_MAX_ANCHORS }, () => new THREE.Vector3(0, 0, 1)) },
    uAnchorColor: { value: Array.from({ length: LIGHT_COMPOSITION_MAX_ANCHORS }, () => new THREE.Vector3()) },
    uSeed: { value: params.uSeed },
    uCoverage: { value: params.uCoverage },
    uDensity: { value: params.uDensity },
    uSoftness: { value: params.uSoftness },
    uContrast: { value: params.uContrast },
    uBaseScale: { value: params.uBaseScale },
    uOctaves: { value: params.uOctaves },
    uOpacity: { value: params.uOpacity },
    uLightFocus: { value: params.uLightFocus },
    uLightLining: { value: params.uLightLining },
    uLightIntensity: { value: params.uLightIntensity },
    uNebulaStrength: { value: params.uNebulaStrength },
    uNebulaExposure: { value: params.uNebulaExposure },
    uCloudShadow: { value: vectorFromArray(params.uCloudShadow) },
    uCloudHighlight: { value: vectorFromArray(params.uCloudHighlight) },
    uCloudCore: { value: vectorFromArray(params.uCloudCore) },
  };

  applyFieldGradientToUniforms(uniforms, gradient);
  return uniforms;
}

export function createStarfield({ renderer, scene, requestRender }: CreateStarfieldArgs) {
  const targetManager = createRenderTargetManager({ renderer });
  const maxTextureSize = targetManager.maxTextureSize;
  const accumulationType = targetManager.accumulationType;
  const accumulationTypeLabel = targetManager.halfFloatAccumulationSupported ? "HalfFloatType" : "UnsignedByteType";

  const starScene = new THREE.Scene();
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let pipeline: BakePipeline;
  let bakeStatusHandler: (label: string, disabled?: boolean) => void = () => {};
  let readoutsChangeHandler: (readouts?: unknown) => void = () => {};
  let brightStarOverlayEnabled = BRIGHT_STAR_OVERLAY_ENABLED;
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

  const defaultPatchLayout = createAutoPatchLayout({
    cameraInfo: currentCameraInfo,
    maxTextureSize,
    accumulationType,
    residentLayerCount: 2,
  });
  const defaultStarParams: StarLayerParams = {
    uDensity: 360,
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
  const defaultBackgroundParams: BackgroundParams = {
    ...DEFAULT_LIGHT_COMPOSITION_BACKGROUND,
    uCloudShadow: [...DEFAULT_LIGHT_COMPOSITION_BACKGROUND.uCloudShadow],
    uCloudHighlight: [...DEFAULT_LIGHT_COMPOSITION_BACKGROUND.uCloudHighlight],
    uCloudCore: [...DEFAULT_LIGHT_COMPOSITION_BACKGROUND.uCloudCore],
  };
  const defaults = {
    ...defaultStarParams,
    sphereSegments: 128,
    skyBackgroundEnabled: true,
    skyBackgroundRadius: DEFAULT_SKY_BACKGROUND_RADIUS,
    bakedStarsEnabled: true,
    bakedStarsRadius: DEFAULT_BAKED_STAR_RADIUS,
    brightOverlayEnabled: BRIGHT_STAR_OVERLAY_ENABLED,
    brightOverlayRadius: DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS,
    uWinkleAmount: DEFAULT_WINKLE_AMOUNT,
    uEffectMinSize: DEFAULT_EFFECT_MIN_SIZE,
    uEffectMaxSize: DEFAULT_EFFECT_MAX_SIZE,
    uWinkleSharpness: DEFAULT_WINKLE_SHARPNESS,
    uWinkleFlashiness: DEFAULT_WINKLE_FLASHINESS,
    backgroundParams: defaultBackgroundParams,
  };

  let currentSphereSegments = defaults.sphereSegments;
  const layerState: StarfieldLayerState = {
    skyBackground: {
      enabled: defaults.skyBackgroundEnabled,
      radius: defaults.skyBackgroundRadius,
      params: {
        ...defaultBackgroundParams,
        uCloudShadow: [...defaultBackgroundParams.uCloudShadow],
        uCloudHighlight: [...defaultBackgroundParams.uCloudHighlight],
        uCloudCore: [...defaultBackgroundParams.uCloudCore],
      },
    },
    bakedStars: {
      enabled: defaults.bakedStarsEnabled,
      radius: defaults.bakedStarsRadius,
      params: { ...defaultStarParams },
    },
    brightOverlay: {
      enabled: defaults.brightOverlayEnabled,
      radius: defaults.brightOverlayRadius,
      params: {
        ...defaultStarParams,
        uWinkleAmount: defaults.uWinkleAmount,
        uEffectMinSize: defaults.uEffectMinSize,
        uEffectMaxSize: defaults.uEffectMaxSize,
        uWinkleSharpness: defaults.uWinkleSharpness,
        uWinkleFlashiness: defaults.uWinkleFlashiness,
      },
    },
  };
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
  const fallbackPatchTarget: PatchTextureTarget = { texture: fallbackPatchTexture };
  const fallbackBackgroundTexture = new THREE.DataTexture(
    new Uint8Array([8, 16, 44, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  fallbackBackgroundTexture.name = "Fallback baked nebula patch";
  fallbackBackgroundTexture.colorSpace = THREE.SRGBColorSpace;
  fallbackBackgroundTexture.minFilter = THREE.LinearFilter;
  fallbackBackgroundTexture.magFilter = THREE.LinearFilter;
  fallbackBackgroundTexture.wrapS = THREE.ClampToEdgeWrapping;
  fallbackBackgroundTexture.wrapT = THREE.ClampToEdgeWrapping;
  fallbackBackgroundTexture.needsUpdate = true;
  const fallbackBackgroundTarget: PatchTextureTarget = { texture: fallbackBackgroundTexture };
  const screenPixelAngleUniform = { value: Math.PI / REFERENCE_BAKE_HEIGHT };
  const referenceHeightUniform = { value: REFERENCE_BAKE_HEIGHT };

  const bakeUniforms: BakeUniforms = {
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
    uWinkleAmount: { value: layerState.brightOverlay.params.uWinkleAmount ?? DEFAULT_WINKLE_AMOUNT },
    uEffectMinSize: { value: layerState.brightOverlay.params.uEffectMinSize ?? DEFAULT_EFFECT_MIN_SIZE },
    uEffectMaxSize: { value: layerState.brightOverlay.params.uEffectMaxSize ?? DEFAULT_EFFECT_MAX_SIZE },
    uWinkleSharpness: { value: layerState.brightOverlay.params.uWinkleSharpness ?? DEFAULT_WINKLE_SHARPNESS },
    uWinkleFlashiness: { value: layerState.brightOverlay.params.uWinkleFlashiness ?? DEFAULT_WINKLE_FLASHINESS },
  };
  const backgroundUniforms = createLightCompositionUniforms(layerState.skyBackground.params, DEFAULT_FIELD_GRADIENT);
  layerState.skyBackground.uniforms = backgroundUniforms;
  layerState.bakedStars.uniforms = bakeUniforms;
  layerState.brightOverlay.uniforms = overlayUniforms;

  const backgroundBakeMaterial = createLightCompositionBakeMaterial(backgroundUniforms);
  const backgroundBakeScene = new THREE.Scene();
  const backgroundBakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundBakeMaterial);
  backgroundBakeQuad.frustumCulled = false;
  backgroundBakeScene.add(backgroundBakeQuad);

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

  let currentPatchLayout = defaultPatchLayout;
  let currentSupersample = currentPatchLayout.supersample;
  let patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
  let backgroundPatchDescriptors = createBackgroundPatchDescriptors(currentPatchLayout);
  let supersampleTarget = targetManager.createAccumulationTarget(1, 1);

  const backgroundSkydome = createSkydomeManager({
    scene,
    requestRender,
    targetManager,
    fallbackPatchTarget: fallbackBackgroundTarget,
    getSphereSegments: () => Math.max(currentSphereSegments, MIN_BACKGROUND_SPHERE_SEGMENTS),
    initialRadius: layerState.skyBackground.radius,
    createMaterial: createBackgroundPatchDomeMaterial,
    renderOrder: -10,
    onBlendStatsChange: () => {
      backgroundPipeline?.syncStats();
      syncOverlayStats();
    },
  });
  backgroundSkydome.rebuildBakedDomeMeshes(backgroundPatchDescriptors);
  backgroundSkydome.setVisible(layerState.skyBackground.enabled);

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
  let backgroundPipeline: BackgroundBakePipeline;
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
  backgroundPipeline = createBackgroundBakePipeline({
    renderer,
    bakeCamera,
    backgroundScene: backgroundBakeScene,
    backgroundUniforms,
    skydome: backgroundSkydome,
    stats,
    getPatchDescriptors: () => backgroundPatchDescriptors,
    targetForDescriptor: backgroundTargetForDescriptor,
    targetMatchesDescriptor,
    releaseTarget: (target: PatchRenderTarget) => targetManager.releaseTarget(target),
    descriptorById: backgroundDescriptorById,
    targetBytes: (target: PatchRenderTarget) => targetManager.patchTargetBytes(target),
    notifyReadouts,
    requestRender,
    onBakeQueueDrained: () => {
      backgroundPipeline.syncStats();
      targetManager.disposeTargetPool();
      syncOverlayStats();
      notifyReadouts();
    },
  });

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
      bakeScratchBytes: currentBakeScratchBytes(),
      queueState: pipeline.queueState(),
      activeBlendCount: skydome.activeBlendCount + backgroundSkydome.activeBlendCount,
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
      residentLayerCount: 2,
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

  function backgroundTargetForDescriptor(descriptor: PatchDescriptor, name = "Baked nebula patch"): PatchRenderTarget {
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

  function createBackgroundPatchDescriptors(layout: PatchLayout): PatchDescriptor[] {
    const descriptors = createPatchDescriptorList(layout, maxTextureSize);
    descriptors.forEach((descriptor) => {
      descriptor.backgroundDirty = true;
      descriptor.backgroundDirtyReason = "new";
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.UNALLOCATED;
    });
    return descriptors;
  }

  function descriptorById(patchId: string): PatchDescriptor | undefined {
    return patchDescriptors.find((descriptor) => descriptor.id === patchId);
  }

  function backgroundDescriptorById(patchId: string): PatchDescriptor | undefined {
    return backgroundPatchDescriptors.find((descriptor) => descriptor.id === patchId);
  }

  function descriptorMeshTriangles(descriptor: PatchDescriptor): number {
    const geometry = descriptor.mesh?.geometry;
    if (!geometry) return 0;
    if (geometry.index) return Math.round(geometry.index.count / 3);
    return Math.round((geometry.attributes.position?.count ?? 0) / 3);
  }

  function syncBackgroundStats(): void {
    backgroundPipeline?.syncStats();
    const visible = layerState.skyBackground.enabled;
    stats.backgroundLayerEnabled = visible;
    stats.backgroundLayerDrawCalls = visible ? backgroundPatchDescriptors.length : 0;
    stats.backgroundLayerTriangles = visible
      ? backgroundPatchDescriptors.reduce((total, descriptor) => total + descriptorMeshTriangles(descriptor), 0)
      : 0;
    stats.backgroundLayerRadius = layerState.skyBackground.radius;
    stats.backgroundSeed = backgroundUniforms.uSeed.value;
    stats.backgroundCoverage = backgroundUniforms.uCoverage.value;
    stats.backgroundDensity = backgroundUniforms.uDensity.value;
    stats.backgroundScale = backgroundUniforms.uBaseScale.value;
    stats.backgroundOpacity = backgroundUniforms.uOpacity.value;
    stats.backgroundNebulaStrength = backgroundUniforms.uNebulaStrength.value;
    stats.backgroundNebulaExposure = backgroundUniforms.uNebulaExposure.value;
    stats.backgroundLightIntensity = backgroundUniforms.uLightIntensity.value;
  }

  function syncOverlayStats(): void {
    Object.assign(stats, starLayers.collectStats());
    syncBackgroundStats();
    stats.bakedStarLayerEnabled = layerState.bakedStars.enabled;
    stats.bakedStarLayerDrawCalls = layerState.bakedStars.enabled ? patchDescriptors.length : 0;
    stats.bakedStarLayerRadius = layerState.bakedStars.radius;
    stats.bakedStarLayerDensity = layerState.bakedStars.params.uDensity;
    stats.bakedStarLayerSeed = layerState.bakedStars.params.uSeed;
    stats.bakedStarLayerStarCount = catalogStarCount(bakeUniforms);
    stats.overlayLayerDensity = layerState.brightOverlay.params.uDensity;
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
    backgroundPipeline.markPatchDescriptorsStale("screen");
    backgroundPipeline.scheduleBake(CAMERA_BAKE_IDLE_MS);
  }

  function rebuildDisplayGeometry(): void {
    backgroundSkydome.rebuildBakedDomeMeshes(backgroundPatchDescriptors);
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    starLayers.setSphereSegments(currentSphereSegments);
    syncOverlayStats();
    updateSphereSegmentStats(stats, currentSphereSegments);
    requestRender();
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
    const previousBackgroundDescriptors = backgroundPatchDescriptors;
    pipeline.clearBakeQueue();
    backgroundPipeline.clearBakeQueue();
    currentPatchLayout = nextLayout;
    patchDescriptors = createPatchDescriptorsWithTargets(currentPatchLayout);
    backgroundPatchDescriptors = createBackgroundPatchDescriptors(currentPatchLayout);
    currentSupersample = currentPatchLayout.supersample ?? 1;
    pendingDisplaySwap = null;
    skydome.disposeBakedDomeMeshes();
    backgroundSkydome.disposeBakedDomeMeshes();
    disposePatchDescriptors(previousDescriptors, { releaseTargets: false });
    disposePatchDescriptors(previousBackgroundDescriptors, { releaseTargets: false, skydomeManager: backgroundSkydome });
    skydome.rebuildBakedDomeMeshes(patchDescriptors);
    backgroundSkydome.rebuildBakedDomeMeshes(backgroundPatchDescriptors);
    backgroundSkydome.setVisible(layerState.skyBackground.enabled);
    stats.autoLayoutReason = nextLayout.autoLayoutReason ?? reason;
    stats.pendingAutoLayout = false;
    updatePatchStats();
    syncOverlayStats();
    notifyReadouts();
    if (bake) {
      pipeline.bakeNow();
      backgroundPipeline.bakeNow();
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

  function setLayerParamValue(layerId: LayerId, key: string, value: number): boolean {
    const layer = layerState[layerId];
    if (!layer?.params || !layer?.uniforms?.[key]) return false;
    layer.params[key] = value;
    layer.uniforms[key].value = value;
    return true;
  }

  function setLayerParam(layerId: LayerId, key: string, value: number, delay = 180): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || !setLayerParamValue(layerId, key, nextValue)) return;

    if (layerId === "skyBackground") {
      backgroundPipeline.markPatchDescriptorsStale("background");
      backgroundPipeline.scheduleBake(delay);
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
    const value = layerState[layerId]?.params?.[key];
    return typeof value === "number" ? value : 0;
  }

  function reseedLayer(layerId: LayerId): number {
    if (!layerState[layerId]?.params) return 0;
    const nextSeed = Math.floor(Math.random() * 1001);
    setLayerParam(layerId, "uSeed", nextSeed, 0);
    return nextSeed;
  }

  function setSphereSegments(value: number): void {
    currentSphereSegments = value;
    rebuildDisplayGeometry();
    notifyReadouts();
  }

  function setLayerEnabled(layerId: LayerId, enabled: boolean): void {
    const nextEnabled = Boolean(enabled);

    if (layerId === "skyBackground") {
      layerState.skyBackground.enabled = nextEnabled;
      backgroundSkydome.setVisible(nextEnabled);
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
    return Boolean(layerState[layerId]?.enabled);
  }

  function setLayerRadius(layerId: LayerId, value: number): void {
    const nextRadius = Number(value);
    if (!Number.isFinite(nextRadius) || nextRadius <= 0 || !layerState[layerId]) return;

    layerState[layerId].radius = nextRadius;

    if (layerId === "skyBackground") {
      backgroundSkydome.setRadius(nextRadius, backgroundPatchDescriptors);
    } else if (layerId === "bakedStars") {
      skydome.setRadius(nextRadius, patchDescriptors);
    } else if (layerId === "brightOverlay") {
      starLayers.setLayerRadius("brightOverlay", nextRadius);
    }

    syncOverlayStats();
    notifyReadouts();
    requestRender();
  }

  function getLayerRadius(layerId: LayerId): number {
    return layerState[layerId]?.radius ?? 0;
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

  function recordRender(): void {
    stats.renders = Number(stats.renders ?? 0) + 1;
    starLayers.advanceRuntime();
    if (backgroundSkydome.activeBlendCount > 0 && backgroundSkydome.advancePatchBlends()) {
      requestRender();
    }
    if (skydome.activeBlendCount > 0 && skydome.advancePatchBlends()) {
      requestRender();
    }
  }

  function bakeNow(): void {
    pipeline.bakeNow();
    backgroundPipeline.bakeNow();
  }

  function scheduleBake(delay = 180): void {
    pipeline.scheduleBake(delay);
    backgroundPipeline.scheduleBake(delay);
  }

  function collectStats(rendererInfo: RendererInfoLike, cameraInfo: Partial<CameraInfo> = {}, options: { detail?: "panel" | "debug" } = {}) {
    return collectStatsPayload(makeStatsContext(), rendererInfo, cameraInfo, options);
  }

  function dispose(): void {
    clearTimeout(autoLayoutTimer);
    pipeline.clearBakeQueue();
    backgroundPipeline.clearBakeQueue();
    if (pendingDisplaySwap) {
      disposePatchDescriptors(pendingDisplaySwap.previousDescriptors, { releaseTargets: false });
      pendingDisplaySwap = null;
    }
    disposePatchDescriptors(patchDescriptors, { releaseTargets: false });
    disposePatchDescriptors(backgroundPatchDescriptors, { releaseTargets: false, skydomeManager: backgroundSkydome });
    targetManager.disposeTargetPool();
    backgroundPipeline.dispose();
    backgroundSkydome.dispose();
    skydome.dispose();
    supersampleTarget.dispose();
    starGeometry.dispose();
    starMaterial.dispose();
    starLayers.dispose();
    fallbackPatchTexture.dispose();
    fallbackBackgroundTexture.dispose();
    backgroundBakeQuad.geometry.dispose();
    backgroundBakeMaterial.dispose();
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
    defaults,
    getReadouts,
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
