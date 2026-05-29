import type { FieldGradient, NebulaParams } from "./nebula/types";
import type { GpuStarfieldParams, StarLayerParams } from "./starfield/types";

interface LayerConfig<Id extends string, P extends Record<string, unknown>> {
  id: Id;
  enabled: boolean;
  radius: number;
  params: P;
}

interface GpuFieldConfig {
  id: "gpuField";
  params: GpuStarfieldParams;
}

export const STARFIELD_CONFIG = {
  background: {
    id: "skyBackground",
    enabled: true,
    radius: 10,
    params: {
      uSeed: 2.4,
      uCoverage: 0.42,
      uDensity: 1.1,
      uSoftness: 0.28,
      uContrast: 1.35,
      uBaseScale: 2.4,
      uOctaves: 4,
      uOpacity: 1,
      uLightFocus: 1.55,
      uLightLining: 0.22,
      uLightIntensity: 0.85,
      uNebulaStrength: 4,
      uNebulaExposure: 2.4,
      uColorWarpAmp: 0.045,
      uColorWarpFreq: 2.2,
      uCloudShadow: [0.004, 0.006, 0.018],
      uCloudHighlight: [0.3, 0.36, 0.72],
      uCloudCore: [0.025, 0.03, 0.07],
    },
    fieldGradient: {
      type: "gradient",
      mode: "field",
      blend: "gaussian",
      sigma: 0.34,
      power: 2,
      warp: { amp: 0.045, freq: 2.2 },
      anchors: [
        { dir: [0.26, 0.18, 0.95], color: [0.14, 0.19, 0.46] },
        { dir: [-0.72, 0.34, 0.6], color: [0.18, 0.08, 0.22] },
        { dir: [0.62, -0.46, -0.64], color: [0.05, 0.12, 0.28] },
        { dir: [-0.18, -0.82, -0.54], color: [0.13, 0.15, 0.2] },
      ],
    },
  } satisfies LayerConfig<"skyBackground", NebulaParams> & { fieldGradient: FieldGradient },
  baked: {
    id: "bakedStars",
    enabled: true,
    radius: 10,
    params: {
      uDensity: 360,
      uStarSize: 5,
      uSizeVar: 0.95,
      uLargeStarRarity: 0.5,
      uBright: 5,
      uBrightVar: 0.95,
      uGlareSize: 7,
      uGlareStr: 0.24,
      uGlareVar: 0.95,
      uColorVar: 1,
      uSeed: 1,
    },
  } satisfies LayerConfig<"bakedStars", StarLayerParams>,
  gpuField: {
    id: "gpuField",
    params: {
      enabled: true,
      starCount: 10000,
      fieldRadius: 14,
      depthFade: 0.45,
      travelSpeed: 1,
      starSize: 5,
      brightness: 1,
      colorVariance: 1,
    },
  } satisfies GpuFieldConfig,
  overlay: {
    id: "brightOverlay",
    enabled: true,
    radius: 10 * 0.985,
    params: {
      uDensity: 360,
      uStarSize: 5,
      uSizeVar: 0.95,
      uLargeStarRarity: 0.5,
      uBright: 5,
      uBrightVar: 0.95,
      uGlareSize: 7,
      uGlareStr: 0.24,
      uGlareVar: 0.95,
      uColorVar: 1,
      uSeed: 1,
      uWinkleAmount: 1,
      uEffectMinSize: 0,
      uEffectMaxSize: 0.75,
      uWinkleSharpness: 0.65,
      uWinkleFlashiness: 0.65,
    },
  } satisfies LayerConfig<"brightOverlay", StarLayerParams>,
  internal: {
    domeRadius: 10,
    skydomeSphereSegments: 32,
    referenceBakeWidth: 4096,
    maxAutoSupersample: 8,
    allocationBudgetMiB: 1024,
    patchSizeAlignment: 128,
    patchGuardTexels: 64,
    minCorePixels: 1.75,
    minGlarePixels: 3.25,
    subpixelDensityThresholdPx: 1,
    aaPinThresholdPx: 1.5,
    gaussianCutoffSigma: 8.0,
    starSizeMinScale: 0.1,
    starSizeRarityExponent: 5.0,
    starSizeGateExponent: 12.0,
    starSizeBrightnessLink: 0.35,
    starSizeGlareLink: 0.25,
    starCatalogBaseDensity: 1000,
    brightStarOverlayEnabled: true,
    brightStarOverlayExcludesBakedStars: false,
    brightStarOverlayStrength: 0.38,
    winkleMaxCount: 128,
    maxBakeJobsPerFrame: 1,
    cameraBakeIdleMs: 450,
    patchCrossfadeMs: 260,
    densityFallbackStarsPerPixel: 0.25,
    brightStarFraction: 0.1,
    autoPatchGrids: [1, 2, 4, 8, 16],
    baseTargetPoolBuckets: [128, 256, 512, 1024, 2048, 4096],
    finalTextureBytesPerPixel: 4,
    hdrTextureBytesPerPixel: 8,
    nebulaMaxAnchors: 8,
    minNebulaSphereSegments: 128,
    catalogParamKeys: ["uDensity", "uSeed"],
  },
} as const;

export const CATALOG_PARAM_KEYS = new Set<string>(STARFIELD_CONFIG.internal.catalogParamKeys);
export const STARFIELD_ALLOCATION_BUDGET_BYTES = STARFIELD_CONFIG.internal.allocationBudgetMiB * 1024 * 1024;
export const REFERENCE_BAKE_HEIGHT = STARFIELD_CONFIG.internal.referenceBakeWidth / 2;

export function cloneStarLayerParams(params: Readonly<StarLayerParams>): StarLayerParams {
  return { ...params };
}

export function cloneGpuFieldParams(params: Readonly<GpuStarfieldParams> = STARFIELD_CONFIG.gpuField.params): GpuStarfieldParams {
  return { ...params };
}

export function cloneBackgroundParams(params: Readonly<NebulaParams> = STARFIELD_CONFIG.background.params): NebulaParams {
  return {
    ...params,
    uCloudShadow: [...params.uCloudShadow],
    uCloudHighlight: [...params.uCloudHighlight],
    uCloudCore: [...params.uCloudCore],
  };
}

export function cloneFieldGradient(gradient: Readonly<FieldGradient> = STARFIELD_CONFIG.background.fieldGradient): FieldGradient {
  return {
    ...gradient,
    warp: gradient.warp ? { ...gradient.warp } : null,
    anchors: gradient.anchors.map((anchor) => ({
      dir: [...anchor.dir],
      color: [...anchor.color],
    })),
  };
}
