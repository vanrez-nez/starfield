import * as THREE from "three";

export const DOME_RADIUS = 10;
export const REFERENCE_BAKE_WIDTH = 4096;
export const REFERENCE_BAKE_HEIGHT = REFERENCE_BAKE_WIDTH / 2;
export const MAX_AUTO_SUPERSAMPLE = 8;
export const STARFIELD_ALLOCATION_BUDGET_MIB = 512;
const BYTES_PER_MIB = 1024 * 1024;
export const STARFIELD_ALLOCATION_BUDGET_BYTES = STARFIELD_ALLOCATION_BUDGET_MIB * BYTES_PER_MIB;
export const PATCH_SIZE_ALIGNMENT = 128;
export const PATCH_GUARD_TEXELS = 64;
export const MIN_CORE_PIXELS = 1.75;
export const MIN_GLARE_PIXELS = 3.25;
export const SUBPIXEL_DENSITY_THRESHOLD_PX = 1;
export const AA_PIN_THRESHOLD_PX = 1.5;
export const GAUSSIAN_CUTOFF_SIGMA = 8.0;
export const STAR_SIZE_MIN_SCALE = 0.1;
export const STAR_SIZE_RARITY_EXPONENT = 5.0;
export const STAR_SIZE_GATE_EXPONENT = 12.0;
export const STAR_SIZE_BRIGHTNESS_LINK = 0.35;
export const STAR_SIZE_GLARE_LINK = 0.25;
export const STAR_CATALOG_BASE_DENSITY = 1000;
export const DEFAULT_LARGE_STAR_RARITY = 0.5;
export const BRIGHT_STAR_OVERLAY_ENABLED = true;
export const BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS = false;
export const BRIGHT_STAR_OVERLAY_STRENGTH = 0.38;
const BRIGHT_STAR_OVERLAY_RADIUS_SCALE = 0.985;
export const WINKLE_MAX_COUNT = 128;
export const DEFAULT_WINKLE_AMOUNT = 0;
export const DEFAULT_WINKLE_SHARPNESS = 0.65;
export const DEFAULT_WINKLE_FLASHINESS = 0.65;
export const DEFAULT_EFFECT_MIN_SIZE = 0;
export const DEFAULT_EFFECT_MAX_SIZE = 0.75;
export const DEFAULT_SKY_BACKGROUND_RADIUS = DOME_RADIUS;
export const DEFAULT_BAKED_STAR_RADIUS = DOME_RADIUS;
export const DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS = DOME_RADIUS * BRIGHT_STAR_OVERLAY_RADIUS_SCALE;
export const LIGHT_COMPOSITION_MAX_ANCHORS = 8;
export const DEFAULT_LIGHT_COMPOSITION_BACKGROUND = Object.freeze({
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
});
export const DEFAULT_FIELD_GRADIENT = Object.freeze({
  type: "gradient",
  mode: "field",
  blend: "gaussian",
  sigma: 0.34,
  power: 2,
  warp: { amp: DEFAULT_LIGHT_COMPOSITION_BACKGROUND.uColorWarpAmp, freq: DEFAULT_LIGHT_COMPOSITION_BACKGROUND.uColorWarpFreq },
  anchors: [
    { dir: [0.26, 0.18, 0.95], color: [0.14, 0.19, 0.46] },
    { dir: [-0.72, 0.34, 0.6], color: [0.18, 0.08, 0.22] },
    { dir: [0.62, -0.46, -0.64], color: [0.05, 0.12, 0.28] },
    { dir: [-0.18, -0.82, -0.54], color: [0.13, 0.15, 0.2] },
  ],
});
export const MAX_BAKE_JOBS_PER_FRAME = 1;
export const CAMERA_BAKE_IDLE_MS = 450;
export const PATCH_CROSSFADE_MS = 260;
export const CATALOG_PARAMS = new Set(["uDensity", "uSeed"]);
export const DENSITY_FALLBACK_STARS_PER_PIXEL = 0.25;
export const BRIGHT_STAR_FRACTION = 0.1;
export const AUTO_PATCH_GRIDS = [1, 2, 4, 8, 16];
export const BASE_TARGET_POOL_BUCKETS = [128, 256, 512, 1024, 2048, 4096];
export const FINAL_TEXTURE_BYTES_PER_PIXEL = 4;

export const STAR_CLASSES = Object.freeze({
  TINY: 0,
  NORMAL: 1,
  BRIGHT: 2,
  HERO: 3,
});

const STAR_CLASS_NAMES = Object.freeze(["tiny", "normal", "bright", "hero"]);
export const STAR_QUERY_EDGE_PAD_CELLS = 2;
export const STAR_QUERY_SEAM_COPIES = 3;

export const PATCH_STATES = Object.freeze({
  EMPTY: "empty",
  QUEUED: "queued",
  BAKING: "baking",
  RESIDENT: "resident",
  STALE: "stale",
});

export const ALLOCATION_STATES = Object.freeze({
  UNALLOCATED: "unallocated",
  ALLOCATED: "allocated",
});

export const FALLBACK_STATES = Object.freeze({
  EMPTY: "empty",
  NEXT: "next",
  RESIDENT: "resident",
});

export function sphereVerticalSegmentsFor(horizontalSegments) {
  return Math.max(8, Math.floor(horizontalSegments / 2));
}

export function sizeLabel(width, height) {
  return `${Math.round(width)}x${Math.round(height)}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function estimateTextureBytes(width, height, bytesPerPixel) {
  return width * height * bytesPerPixel;
}

export function clamp(value, min, max) {
  const numeric = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, numeric));
}

export function catalogSeed(value) {
  const scaled = Math.floor(value * 1000003);
  return (scaled ^ 0x9e3779b9) >>> 0;
}

export function mixUint32(value) {
  let state = value >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  return (state ^ (state >>> 16)) >>> 0;
}

export function hashCellUnit(seed, column, row, salt) {
  const x = Math.imul((column + 0x9e3779b9) >>> 0, 0x85ebca6b);
  const y = Math.imul((row + 0xc2b2ae35) >>> 0, 0x27d4eb2f);
  const s = Math.imul((salt + 0x165667b1) >>> 0, 0x9e3779b1);
  return mixUint32((seed ^ x ^ y ^ s) >>> 0) / 4294967296;
}

export function wrapIndex(index, size) {
  return ((index % size) + size) % size;
}

export function qFromV(v) {
  const clampedV = clamp(v, 0, 1);
  return (1 - Math.cos(clampedV * Math.PI)) * 0.5;
}

export function equirectDirectionFromUv(u, v) {
  const theta = (u - 0.5) * Math.PI * 2;
  const phi = v * Math.PI;
  const sinPhi = Math.sin(phi);
  return new THREE.Vector3(
    sinPhi * Math.sin(theta),
    Math.cos(phi),
    sinPhi * Math.cos(theta),
  ).normalize();
}

export function emptyStarClassStats() {
  return {
    starClassTotal: 0,
    tinyStarCount: 0,
    normalStarCount: 0,
    brightStarClassCount: 0,
    heroStarCount: 0,
    bakedCandidateStarCount: 0,
    densityCandidateStarCount: 0,
    overlayCandidateStarCount: 0,
    overlayStarCount: 0,
    overlayStarInstances: 0,
    overlayTriangleCount: 0,
    overlayDrawCalls: 0,
    overlayEnabled: BRIGHT_STAR_OVERLAY_ENABLED,
    starClassSummary: "tiny:0, normal:0, bright:0, hero:0",
    tileAwareGeneration: true,
    starQueryGrid: "0x0",
    lastStarQueryPatchId: "none",
    lastStarQueryStarCount: 0,
    lastStarQueryInstanceCount: 0,
    lastStarQueryCellCount: 0,
  };
}

function starSizeRank(rSize, rSizeGate = 1, largeStarRarity = 0) {
  const baseRank = Math.pow(clamp(rSize, 0, 1), STAR_SIZE_RARITY_EXPONENT);
  const gate = 1 + (Math.pow(clamp(rSizeGate, 0, 1), STAR_SIZE_GATE_EXPONENT) - 1) * clamp(largeStarRarity, 0, 1);
  return baseRank * gate;
}

export function visualImportanceForStar(rSize, rSizeGate, largeStarRarity, rBright, rGlare) {
  const sizeScore = starSizeRank(rSize, rSizeGate, largeStarRarity);
  const linkedBrightRand = rBright + (Math.max(rBright, sizeScore) - rBright) * STAR_SIZE_BRIGHTNESS_LINK;
  const linkedGlareRand = rGlare + (Math.max(rGlare, sizeScore) - rGlare) * STAR_SIZE_GLARE_LINK;
  const brightScore = Math.pow(linkedBrightRand, 3);
  const glareScore = Math.pow(linkedGlareRand, 8);
  return clamp(sizeScore * 0.3 + brightScore * 0.55 + glareScore * 0.15, 0, 1);
}

export function classifyStar(rSize, rSizeGate, largeStarRarity, rBright, rGlare) {
  const sizeScore = starSizeRank(rSize, rSizeGate, largeStarRarity);
  const linkedBrightRand = rBright + (Math.max(rBright, sizeScore) - rBright) * STAR_SIZE_BRIGHTNESS_LINK;
  const linkedGlareRand = rGlare + (Math.max(rGlare, sizeScore) - rGlare) * STAR_SIZE_GLARE_LINK;
  const brightScore = Math.pow(linkedBrightRand, 3);
  const glareScore = Math.pow(linkedGlareRand, 8);
  const importance = visualImportanceForStar(rSize, rSizeGate, largeStarRarity, rBright, rGlare);

  if (importance >= 0.78 || (brightScore > 0.85 && (sizeScore > 0.65 || glareScore > 0.35))) {
    return STAR_CLASSES.HERO;
  }
  if (importance >= 0.52 || brightScore > 0.62 || (glareScore > 0.65 && sizeScore > 0.45)) {
    return STAR_CLASSES.BRIGHT;
  }
  if (importance < 0.16 && sizeScore < 0.35 && brightScore < 0.08 && glareScore < 0.08) {
    return STAR_CLASSES.TINY;
  }
  return STAR_CLASSES.NORMAL;
}

export function recordStarClass(classStats, classId) {
  classStats.starClassTotal += 1;
  if (classId === STAR_CLASSES.TINY) {
    classStats.tinyStarCount += 1;
    classStats.densityCandidateStarCount += 1;
    return;
  }
  if (classId === STAR_CLASSES.BRIGHT) {
    classStats.brightStarClassCount += 1;
    classStats.overlayCandidateStarCount += 1;
    return;
  }
  if (classId === STAR_CLASSES.HERO) {
    classStats.heroStarCount += 1;
    classStats.overlayCandidateStarCount += 1;
    return;
  }
  classStats.normalStarCount += 1;
  classStats.bakedCandidateStarCount += 1;
}

export function finalizeStarClassStats(classStats) {
  classStats.bakedCandidateStarCount += classStats.brightStarClassCount + classStats.heroStarCount;
  classStats.starClassSummary = STAR_CLASS_NAMES
    .map((name, classId) => {
      if (classId === STAR_CLASSES.TINY) return `${name}:${classStats.tinyStarCount}`;
      if (classId === STAR_CLASSES.BRIGHT) return `${name}:${classStats.brightStarClassCount}`;
      if (classId === STAR_CLASSES.HERO) return `${name}:${classStats.heroStarCount}`;
      return `${name}:${classStats.normalStarCount}`;
    })
    .join(", ");
  return classStats;
}

export function screenPixelAngleFromInfo(cameraInfo) {
  const verticalFov = Number(cameraInfo.verticalFov) || 0;
  const screenHeight = Math.max(1, Number(cameraInfo.screenHeight) || 1);
  if (verticalFov <= 0) return Math.PI / REFERENCE_BAKE_HEIGHT;
  return THREE.MathUtils.degToRad(verticalFov) / screenHeight;
}
