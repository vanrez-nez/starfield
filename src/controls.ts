import { STARFIELD_CONFIG } from "./config";
import type { GpuStarfieldApi, GpuStarfieldParams, StarfieldStats } from "./starfield/types";

const GPU_FIELD_LAYER_ID = STARFIELD_CONFIG.gpuField.id;

type ControlValue = number | boolean;
type RangeFormatFn = (value: number) => string;
type ToggleFormatFn = (value: boolean) => string;
type ControlLayerId = "skyBackground" | "bakedStars" | "brightOverlay" | typeof GPU_FIELD_LAYER_ID;
type StarfieldControlLayerId = Exclude<ControlLayerId, typeof GPU_FIELD_LAYER_ID>;

interface PanelGroupParam {
  group: string;
}

interface LayerTabsParam {
  kind: "layerTabs";
}

type PanelParam = PanelGroupParam | LayerTabsParam;

interface LayerGroupControl {
  type: "group";
  label: string;
}

interface LayerToggleControl {
  type: "toggle";
  key: string;
  label: string;
  format: ToggleFormatFn;
}

interface LayerRangeControl {
  type: "range";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format: RangeFormatFn;
  param?: boolean;
}

type LayerControl = LayerGroupControl | LayerToggleControl | LayerRangeControl;

interface LayerTabConfig {
  id: ControlLayerId;
  label: string;
  controls: LayerControl[];
}

interface LayerToggleState {
  input: HTMLInputElement;
  value: HTMLElement;
  format: ToggleFormatFn;
}

interface LayerParamState {
  input: HTMLInputElement;
  value: HTMLElement;
  format: RangeFormatFn;
  min: number;
  max: number;
}

interface StarfieldControlApi {
  setLayerRadius(layerId: StarfieldControlLayerId, value: number): void;
  getLayerRadius(layerId: StarfieldControlLayerId): number;
  getLayerEnabled(layerId: StarfieldControlLayerId): boolean;
  setLayerEnabled(layerId: StarfieldControlLayerId, enabled: boolean): void;
  getLayerParam(layerId: StarfieldControlLayerId, key: string): ControlValue;
  setLayerParam(layerId: StarfieldControlLayerId, key: string, value: number, delay?: number): void;
  reseedLayer(layerId: StarfieldControlLayerId): void;
  bakeNow(): void;
  setBakeStatusHandler(handler: (label: string, disabled?: boolean) => void): void;
  setReadoutsChangeHandler(handler: () => void): void;
}

interface ControlButtons {
  bake: HTMLButtonElement;
  seed: HTMLButtonElement;
  recenter: HTMLButtonElement;
  overlay?: HTMLButtonElement | null;
}

interface CreateControlsArgs {
  rows: HTMLElement;
  buttons: ControlButtons;
  starfield: StarfieldControlApi;
  gpuStarfield: GpuStarfieldApi;
  getStats: (options?: { detail?: "panel" | "debug" }) => StarfieldStats;
  onRecenter: () => void;
}

interface StatsGroup {
  title: string;
  lines: string[];
}

const PARAMS: PanelParam[] = [
  { group: "Layers" },
  { kind: "layerTabs" },
];

const STAR_LAYER_CONTROLS: LayerControl[] = [
  { type: "group", label: "Field" },
  { type: "range", key: "uDensity", label: "Density", min: 10, max: 1000, step: 1, format: (v) => v.toFixed(0), param: true },
  { type: "range", key: "uSeed", label: "Seed", min: 0, max: 1000, step: 1, format: (v) => v.toFixed(0), param: true },
  { type: "group", label: "Core" },
  { type: "range", key: "uStarSize", label: "Star Size", min: 0.1, max: 4, step: 0.05, format: (v) => v.toFixed(2), param: true },
  { type: "range", key: "uSizeVar", label: "Size Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
  { type: "range", key: "uLargeStarRarity", label: "Large Star Rarity", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
  { type: "range", key: "uBright", label: "Brightness", min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2), param: true },
  { type: "range", key: "uBrightVar", label: "Brightness Var", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
  { type: "group", label: "Glare" },
  { type: "range", key: "uGlareSize", label: "Glare Size", min: 0, max: 8, step: 0.1, format: (v) => v.toFixed(1), param: true },
  { type: "range", key: "uGlareStr", label: "Glare Strength", min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2), param: true },
  { type: "range", key: "uGlareVar", label: "Glare Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
  { type: "group", label: "Color" },
  { type: "range", key: "uColorVar", label: "Color Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
];

const LAYER_TABS: LayerTabConfig[] = [
  {
    id: STARFIELD_CONFIG.background.id,
    label: "Background",
    controls: [
      { type: "toggle", key: "skyBackgroundEnabled", label: "Enabled", format: (v) => (v ? "On" : "Off") },
      { type: "range", key: "skyBackgroundRadius", label: "Radius", min: 1, max: 25, step: 0.05, format: (v) => v.toFixed(2) },
      { type: "group", label: "Nebula" },
      { type: "range", key: "uSeed", label: "Seed", min: 0, max: 1000, step: 0.1, format: (v) => v.toFixed(1), param: true },
      { type: "range", key: "uCoverage", label: "Coverage", min: 0.02, max: 0.98, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uDensity", label: "Density", min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uSoftness", label: "Softness", min: 0.001, max: 0.6, step: 0.005, format: (v) => v.toFixed(3), param: true },
      { type: "range", key: "uContrast", label: "Contrast", min: 0.05, max: 4, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uBaseScale", label: "Scale", min: 0.1, max: 10, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uOctaves", label: "Octaves", min: 1, max: 8, step: 1, format: (v) => v.toFixed(0), param: true },
      { type: "range", key: "uOpacity", label: "Opacity", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uNebulaStrength", label: "Nebula Strength", min: 0, max: 12, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uNebulaExposure", label: "Nebula Exposure", min: 0.1, max: 8, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "group", label: "Light" },
      { type: "range", key: "uLightFocus", label: "Light Focus", min: 0.1, max: 5, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uLightLining", label: "Light Lining", min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uLightIntensity", label: "Light Intensity", min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "group", label: "Color Warp" },
      { type: "range", key: "uColorWarpAmp", label: "Warp Amp", min: 0, max: 0.5, step: 0.005, format: (v) => v.toFixed(3), param: true },
      { type: "range", key: "uColorWarpFreq", label: "Warp Freq", min: 0.1, max: 8, step: 0.05, format: (v) => v.toFixed(2), param: true },
    ],
  },
  {
    id: STARFIELD_CONFIG.baked.id,
    label: "Baked",
    controls: [
      { type: "toggle", key: "bakedStarsEnabled", label: "Enabled", format: (v) => (v ? "On" : "Off") },
      { type: "range", key: "bakedStarsRadius", label: "Radius", min: 1, max: 25, step: 0.05, format: (v) => v.toFixed(2) },
      ...STAR_LAYER_CONTROLS,
    ],
  },
  {
    id: GPU_FIELD_LAYER_ID,
    label: "GPU Field",
    controls: [
      { type: "toggle", key: "enabled", label: "Enabled", format: (v) => (v ? "On" : "Off") },
      { type: "group", label: "Runtime" },
      { type: "range", key: "starCount", label: "Star Count", min: 0, max: 30000, step: 512, format: (v) => v.toFixed(0), param: true },
      { type: "range", key: "fieldRadius", label: "Field Radius", min: 4, max: 40, step: 0.5, format: (v) => v.toFixed(1), param: true },
      { type: "range", key: "depthFade", label: "Depth Fade", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "travelSpeed", label: "Travel Speed", min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "starSize", label: "Star Size", min: 0.1, max: 4, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "brightness", label: "Brightness", min: 0, max: 2, step: 0.02, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "colorVariance", label: "Color Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
    ],
  },
  {
    id: STARFIELD_CONFIG.overlay.id,
    label: "Overlay",
    controls: [
      { type: "toggle", key: "brightOverlayEnabled", label: "Enabled", format: (v) => (v ? "On" : "Off") },
      { type: "range", key: "brightOverlayRadius", label: "Radius", min: 1, max: 25, step: 0.05, format: (v) => v.toFixed(2) },
      ...STAR_LAYER_CONTROLS,
      { type: "group", label: "Effects" },
      { type: "range", key: "uWinkleAmount", label: "Winkle Amount", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uEffectMinSize", label: "Min Size", min: 0, max: 12, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uEffectMaxSize", label: "Max Size", min: 0, max: 12, step: 0.05, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uWinkleSharpness", label: "Winkle Sharpness", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
      { type: "range", key: "uWinkleFlashiness", label: "Winkle Flashiness", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
    ],
  },
];

const STATS_PANEL_REFRESH_MS = 250;

function updateSliderFill(input: HTMLInputElement, min: number, max: number): void {
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function formatNumber(value: unknown, digits = 1): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(digits);
}

function formatInteger(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return String(Math.round(numeric));
}

function formatPercent(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0.0%";
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatSizeWithOptimal(value: unknown, optimal: unknown, capped: unknown): string {
  const label = value ?? "0x0";
  if (!capped || !optimal) return String(label);
  return `${label} (optimal ${optimal})`;
}

function formatGpuStatsForPanel(stats: StarfieldStats): string {
  return [
    "GPU Stats",
    `Memory: ${stats.estimatedTextureMemory}`,
    `Draws/Frame: ${stats.callFrames}`,
    `FOV: ${stats.horizontalFov}h/${stats.verticalFov}v`,
    `Screen: ${stats.screenSize ?? "0x0"}`,
    `Polygons: ${stats.polygons}`,
    `Geometry: ${stats.geometries}`,
    `Textures: ${stats.textures}`,
    `Programs: ${stats.shaderPrograms}`,
    `Sphere: ${stats.sphereSegments}x${stats.sphereVerticalSegments}`,
    "",
    "Layers",
    `Sky Background: ${stats.backgroundLayerEnabled ? "on" : "off"}`,
    `Background Radius: ${formatNumber(stats.backgroundLayerRadius, 2)}`,
    `Background Coverage: ${formatNumber(stats.backgroundCoverage, 2)}`,
    `Background Density: ${formatNumber(stats.backgroundDensity, 2)}`,
    `Background Strength: ${formatNumber(stats.backgroundNebulaStrength, 2)}`,
    `Background Exposure: ${formatNumber(stats.backgroundNebulaExposure, 2)}`,
    `Background Octaves: ${formatInteger(stats.backgroundOctaves)}`,
    `Background Format: ${stats.backgroundTargetType ?? "unknown"} ${stats.backgroundHdrEnabled ? "HDR" : "LDR"}`,
    `Background BPP: ${formatInteger(stats.backgroundTargetBytesPerPixel)}`,
    `Background Light: ${formatNumber(stats.backgroundLightIntensity, 2)}`,
    `Background Draws: ${formatInteger(stats.backgroundLayerDrawCalls)}`,
    `Background Tris: ${formatInteger(stats.backgroundLayerTriangles)}`,
    `Background Patches: ${formatInteger(stats.backgroundPatchCount)}`,
    `Background Jobs: ${formatInteger(stats.backgroundActiveBakeJobs)} active / ${formatInteger(stats.backgroundPendingBakeJobs)} pending`,
    `Background Dirty: ${formatInteger(stats.backgroundDirtyPatchCount)}`,
    `Baked Stars: ${stats.bakedStarLayerEnabled ? "on" : "off"}`,
    `Baked Radius: ${formatNumber(stats.bakedStarLayerRadius, 2)}`,
    `Baked Density: ${formatInteger(stats.bakedStarLayerDensity)}`,
    `Baked Seed: ${formatNumber(stats.bakedStarLayerSeed, 0)}`,
    `Baked Count: ${formatInteger(stats.bakedStarLayerStarCount)}`,
    `Baked Draws: ${formatInteger(stats.bakedStarLayerDrawCalls)}`,
    `GPU Field: ${stats.gpuFieldEnabled ? "on" : "off"}`,
    `GPU Field Count: ${formatInteger(stats.gpuFieldStarCount)}`,
    `GPU Field Radius: ${formatNumber(stats.gpuFieldRadius, 1)}`,
    `GPU Field Speed: ${formatNumber(stats.gpuFieldTravelSpeed, 2)}`,
    `GPU Field Draws: ${formatInteger(stats.gpuFieldDrawCalls)}`,
    `GPU Field Tris: ${formatInteger(stats.gpuFieldTriangles)}`,
    `Bright Overlay: ${stats.overlayEnabled ? "on" : "off"}`,
    `Overlay Radius: ${formatNumber(stats.overlayRadius, 2)}`,
    `Overlay Density: ${formatInteger(stats.overlayLayerDensity)}`,
    `Overlay Seed: ${formatNumber(stats.overlayLayerSeed, 0)}`,
    `Overlay Count: ${formatInteger(stats.overlayLayerStarCount)}`,
    `Overlay Draws: ${formatInteger(stats.overlayDrawCalls)}`,
    `Winkle Amount: ${formatNumber(stats.winkleAmount, 2)}`,
    `Effect Min Size: ${formatNumber(stats.effectMinSize, 2)}`,
    `Effect Max Size: ${formatNumber(stats.effectMaxSize, 2)}`,
    `Winkle Sharpness: ${formatNumber(stats.winkleSharpness, 2)}`,
    `Winkle Flashiness: ${formatNumber(stats.winkleFlashiness, 2)}`,
    `Winkles: ${formatInteger(stats.winkleActiveCount)}/${formatInteger(stats.winkleMaxCount)}`,
    `Winkle Draws: ${formatInteger(stats.winkleDrawCalls)}`,
    `Winkle Tris: ${formatInteger(stats.winkleTriangles)}`,
    "",
    "Bake",
    `Auto Virtual: ${formatSizeWithOptimal(stats.autoVirtualSize ?? stats.virtualSize, stats.optimalVirtualSize, stats.autoVirtualSizeCapped)}`,
    `Ideal Virtual: ${stats.idealVirtualSize ?? stats.optimalVirtualSize ?? "0x0"}`,
    `Effective Virtual: ${stats.effectiveVirtualSize ?? stats.autoVirtualSize ?? stats.virtualSize ?? "0x0"}`,
    `Quality Scale: ${formatPercent(stats.qualityScale)}`,
    `Auto Grid: ${stats.autoPatchGrid ?? stats.patchGrid} (${stats.patchCount})`,
    `Auto Reason: ${stats.autoLayoutReason ?? "automatic"}`,
    `Patch Size: ${formatSizeWithOptimal(stats.patchSize, stats.optimalPatchSize, stats.patchSizeCapped)}`,
    `Patch Storage: ${formatSizeWithOptimal(stats.patchStorageSize, stats.optimalPatchStorageSize, stats.patchStorageSizeCapped)}`,
    `Internal Patch: ${formatSizeWithOptimal(stats.internalPatchSize, stats.optimalInternalPatchSize, stats.internalPatchSizeCapped)}`,
    `Supersample: ${stats.supersample}`,
    `GPU Limit: ${stats.maxTextureSize}`,
    "",
    "Descriptors",
    `Count: ${stats.patchDescriptorCount ?? stats.patchCount ?? 0}`,
    `Resident: ${stats.residentPatchCount ?? 0}`,
    `Allocated: ${stats.allocatedPatchCount ?? 0}`,
    `Fallbacks: ${stats.fallbackPatchCount ?? 0}`,
    `Next Targets: ${stats.nextTargetPatchCount ?? 0}`,
    `Layer Dirty: ${stats.layerDirtyPatchCount ?? 0}`,
    `Pending Layers: ${stats.pendingLayerPatchCount ?? 0}`,
    `Baked Catalog Dirty: ${stats.catalogDirty ? "yes" : "no"}`,
    `Overlay Catalog Dirty: ${stats.overlayCatalogDirty ? "yes" : "no"}`,
    `Layout Pending: ${stats.pendingAutoLayout ? "yes" : "no"}`,
    `Downgraded: ${stats.downgradedPatchCount ?? 0}`,
    `States: ${stats.patchStateSummary ?? "none"}`,
    `Allocations: ${stats.allocationStateSummary ?? "none"}`,
    `Required Buckets: ${stats.descriptorRequiredBucketSummary ?? "none"}`,
    `Target Buckets: ${stats.descriptorTargetBucketSummary ?? "none"}`,
    `Density Pressure: ${formatNumber(stats.descriptorDensityPressure, 4)}/px`,
    `Density Fallbacks: ${stats.descriptorDensityFallbackCount ?? 0}`,
    `Bright Pressure: ${formatNumber(stats.descriptorBrightStarPressure, 4)}/px`,
    "",
    "Allocation",
    `Automatic: yes`,
    `Allocation Budget: ${stats.allocationBudgetMemory ?? stats.patchBudgetMemory ?? "0 B"}`,
    `Resident: ${stats.residentTextureMemory ?? "0 B"} (${formatPercent(stats.residentBudgetRatio)})`,
    `Scratch: ${stats.bakeScratchMemory ?? "0 B"}`,
    `Pool: ${stats.pooledTargetMemory ?? "0 B"}`,
    `Total Allocated: ${stats.totalAllocatedMemory ?? "0 B"} (${formatPercent(stats.totalAllocatedBudgetRatio)})`,
    `Peak Estimate: ${stats.estimatedBakeScratchMemory ?? "0 B"} scratch`,
    `Recommended Raster: ${stats.recommendedActualRasterSize ?? "0x0"}`,
    `Recommended Storage: ${stats.recommendedPatchStorageSize ?? "0x0"}`,
    `Recommended Resident: ${stats.recommendedResidentTextureMemory ?? "0 B"} (${formatPercent(stats.recommendedResidentBudgetRatio)})`,
    "",
    "Screen Demand",
    `CSS Size: ${stats.cssSize ?? "0x0"}`,
    `Pixel Ratio: ${formatNumber(stats.pixelRatio, 2)}x`,
    `Pixels/Deg: ${formatNumber(stats.pixelsPerDegreeX, 1)}x${formatNumber(stats.pixelsPerDegreeY, 1)}`,
    `Pixels/Rad: ${formatNumber(stats.pixelsPerRadianX, 0)}x${formatNumber(stats.pixelsPerRadianY, 0)}`,
    `Texels/Pixel: ${formatNumber(stats.texelsPerPixelTarget, 2)}x`,
    `Patch Angle: ${formatNumber(stats.patchAngularWidthDeg, 1)}x${formatNumber(stats.patchAngularHeightDeg, 1)}`,
    `Projected Patch: ${formatNumber(stats.projectedPatchWidthPixels, 0)}x${formatNumber(stats.projectedPatchHeightPixels, 0)}`,
    `Required Texels: ${stats.requiredPatchTexels ?? "0x0"}`,
    `Recommended Bucket: ${stats.recommendedPatchBucket ?? 0}`,
    `Current Patch: ${formatInteger(stats.currentPatchSize)}`,
    `Oversample: ${formatNumber(stats.oversampleRatio, 2)}x`,
    `Undersample: ${stats.undersampleWarning ? "yes" : "no"}`,
    "",
    "Density Demand",
    `Total Stars: ${formatInteger(stats.totalStarCount)}`,
    `Stars/Patch: ${formatInteger(stats.estimatedStarsPerPatch)}`,
    `Projected Pixels: ${formatInteger(stats.projectedPatchPixels)}`,
    `Stars/Pixel: ${formatNumber(stats.starsPerProjectedPixel, 4)}`,
    `Bright Stars: ${formatInteger(stats.brightStarCount)}`,
    `Density Scale: ${formatNumber(stats.densityScale, 2)}x`,
    `Density Fallback: ${stats.densityFallbackWarning ? "yes" : "no"}`,
    "",
    "Catalog Classes",
    `Tiny: ${formatInteger(stats.tinyStarCount)}`,
    `Normal: ${formatInteger(stats.normalStarCount)}`,
    `Bright: ${formatInteger(stats.brightStarClassCount)}`,
    `Hero: ${formatInteger(stats.heroStarCount)}`,
    `Density Candidates: ${formatInteger(stats.densityCandidateStarCount)}`,
    `Baked Candidates: ${formatInteger(stats.bakedCandidateStarCount)}`,
    `Overlay Candidates: ${formatInteger(stats.overlayCandidateStarCount)}`,
    `Overlay Enabled: ${stats.overlayEnabled ? "yes" : "no"}`,
    `Overlay Stars: ${formatInteger(stats.overlayStarCount)}`,
    `Overlay Instances: ${formatInteger(stats.overlayStarInstances)}`,
    `Overlay Tris: ${formatInteger(stats.overlayTriangleCount)}`,
    `Overlay Draws: ${formatInteger(stats.overlayDrawCalls)}`,
    `Winkle Amount: ${formatNumber(stats.winkleAmount, 2)}`,
    `Effect Min Size: ${formatNumber(stats.effectMinSize, 2)}`,
    `Effect Max Size: ${formatNumber(stats.effectMaxSize, 2)}`,
    `Winkle Sharpness: ${formatNumber(stats.winkleSharpness, 2)}`,
    `Winkle Flashiness: ${formatNumber(stats.winkleFlashiness, 2)}`,
    `Winkle Max: ${formatInteger(stats.winkleMaxCount)}`,
    `Winkle Active: ${formatInteger(stats.winkleActiveCount)}`,
    `Winkle Tris: ${formatInteger(stats.winkleTriangles)}`,
    `Winkle Draws: ${formatInteger(stats.winkleDrawCalls)}`,
    `Background Layer: ${stats.backgroundLayerEnabled ? "yes" : "no"}`,
    `Background Seed: ${formatNumber(stats.backgroundSeed, 1)}`,
    `Background Coverage: ${formatNumber(stats.backgroundCoverage, 2)}`,
    `Background Density: ${formatNumber(stats.backgroundDensity, 2)}`,
    `Background Scale: ${formatNumber(stats.backgroundScale, 2)}`,
    `Background Opacity: ${formatNumber(stats.backgroundOpacity, 2)}`,
    `Background Strength: ${formatNumber(stats.backgroundNebulaStrength, 2)}`,
    `Background Exposure: ${formatNumber(stats.backgroundNebulaExposure, 2)}`,
    `Background Octaves: ${formatInteger(stats.backgroundOctaves)}`,
    `Background Format: ${stats.backgroundTargetType ?? "unknown"} ${stats.backgroundHdrEnabled ? "HDR" : "LDR"}`,
    `Background BPP: ${formatInteger(stats.backgroundTargetBytesPerPixel)}`,
    `Background Light: ${formatNumber(stats.backgroundLightIntensity, 2)}`,
    `Background Draws: ${formatInteger(stats.backgroundLayerDrawCalls)}`,
    `Background Tris: ${formatInteger(stats.backgroundLayerTriangles)}`,
    `Background Patches: ${formatInteger(stats.backgroundPatchCount)}`,
    `Background Resident: ${stats.backgroundResidentTextureMemory ?? "0 B"}`,
    `Background Dirty: ${formatInteger(stats.backgroundDirtyPatchCount)}`,
    `Background Jobs: ${formatInteger(stats.backgroundActiveBakeJobs)} active / ${formatInteger(stats.backgroundPendingBakeJobs)} pending`,
    `Background Last Bake: ${formatNumber(stats.backgroundLastBakeMs, 2)}ms`,
    `GPU Field: ${stats.gpuFieldEnabled ? "yes" : "no"}`,
    `GPU Field Count: ${formatInteger(stats.gpuFieldStarCount)}`,
    `GPU Field Radius: ${formatNumber(stats.gpuFieldRadius, 1)}`,
    `GPU Field Depth Fade: ${formatNumber(stats.gpuFieldDepthFade, 2)}`,
    `GPU Field Speed: ${formatNumber(stats.gpuFieldTravelSpeed, 2)}`,
    `GPU Field Size: ${formatNumber(stats.gpuFieldStarSize, 2)}`,
    `GPU Field Brightness: ${formatNumber(stats.gpuFieldBrightness, 2)}`,
    `GPU Field Color Var: ${formatNumber(stats.gpuFieldColorVariance, 2)}`,
    `GPU Field Distance: ${formatNumber(stats.gpuFieldVirtualDistance, 2)}`,
    `GPU Field Rebuilds: ${formatInteger(stats.gpuFieldGeometryRebuilds)}`,
    `GPU Field Draws: ${formatInteger(stats.gpuFieldDrawCalls)}`,
    `GPU Field Tris: ${formatInteger(stats.gpuFieldTriangles)}`,
    `Tile Aware: ${stats.tileAwareGeneration ? "yes" : "no"}`,
    `Query Grid: ${stats.starQueryGrid ?? "0x0"}`,
    `Last Query Patch: ${stats.lastStarQueryPatchId ?? "none"}`,
    `Last Query Stars: ${formatInteger(stats.lastStarQueryStarCount)}`,
    `Last Query Instances: ${formatInteger(stats.lastStarQueryInstanceCount)}`,
    `Last Query Cells: ${formatInteger(stats.lastStarQueryCellCount)}`,
    `Patch Query Stars: ${stats.queriedPatchStarSummary ?? "none"}`,
    `Summary: ${stats.starClassSummary ?? "none"}`,
    "",
    "Star Policy",
    `Min Core Pixels: ${formatNumber(stats.minCorePixels, 2)}`,
    `Min Glare Pixels: ${formatNumber(stats.minGlarePixels, 2)}`,
    `Density Threshold: ${formatNumber(stats.subpixelDensityThresholdPx, 2)}px`,
    `AA Pin Threshold: ${formatNumber(stats.aaPinThresholdPx, 2)}px`,
    `Subpixel Mode: ${stats.subpixelEnergyMode ?? "density-pin-normal"}`,
    "",
    "Memory Budget",
    `Resident: ${stats.residentTextureMemory ?? "0 B"} (${formatPercent(stats.residentBudgetRatio)})`,
    `Bake Scratch: ${stats.bakeScratchMemory ?? "0 B"}`,
    `Pooled Memory: ${stats.pooledTargetMemory ?? "0 B"}`,
    `Total Allocated: ${stats.totalAllocatedMemory ?? "0 B"} (${formatPercent(stats.totalAllocatedBudgetRatio)})`,
    `Active Targets: ${stats.activeTargetCount ?? 0}`,
    `Pooled Targets: ${stats.pooledTargetCount ?? 0}`,
    `Pooled Buckets: ${stats.pooledTargetSummary ?? "none"}`,
    `Alloc Count: ${stats.allocationCount ?? 0}`,
    `Bake Jobs: ${stats.activeBakeJobs ?? 0} active / ${stats.pendingBakeJobs ?? 0} pending`,
    `Background Jobs: ${stats.backgroundActiveBakeJobs ?? 0} active / ${stats.backgroundPendingBakeJobs ?? 0} pending`,
    `Active Blends: ${stats.activeBlendCount ?? 0}`,
    `Active Job: ${stats.activeBakeJobId ?? "none"}`,
    `Completed Jobs: ${stats.completedBakeJobs ?? 0}/${stats.totalQueuedBakeJobs ?? 0}`,
    `Jobs/Frame: ${stats.maxBakeJobsPerFrame ?? 0}`,
    `Queue Idle: ${stats.queueIdle ? "yes" : "no"}`,
    `Pending Top: ${stats.pendingBakeJobSummary ?? "none"}`,
    `Resident Over Budget: ${stats.residentBudgetExceeded ? "yes" : "no"}`,
    `Total Over Budget: ${stats.totalAllocatedBudgetExceeded ? "yes" : "no"}`,
  ].join("\n");
}

export function createControls({ rows, buttons, starfield, gpuStarfield, getStats, onRecenter }: CreateControlsArgs) {
  const gpuStatsPanel = document.createElement("div");
  gpuStatsPanel.id = "gpu-stats";
  gpuStatsPanel.setAttribute("aria-live", "polite");
  document.body.append(gpuStatsPanel);

  let updatingStatsPanel = false;
  let uxVisible = true;
  let statsRefreshTimer = 0;
  let lastStatsRefreshAt = 0;
  const collapsedStatsGroups = new Set<string>();
  const layerToggleInputs = new Map<string, LayerToggleState>();
  const layerParamInputs = new Map<string, LayerParamState>();
  let activeLayerId: ControlLayerId = STARFIELD_CONFIG.baked.id;

  function isGpuFieldLayer(layer: string): layer is typeof GPU_FIELD_LAYER_ID {
    return layer === GPU_FIELD_LAYER_ID;
  }

  function getLayerEnabled(layer: ControlLayerId): boolean {
    return isGpuFieldLayer(layer) ? gpuStarfield.getEnabled() : starfield.getLayerEnabled(layer);
  }

  function setLayerEnabled(layer: ControlLayerId, enabled: boolean): void {
    if (isGpuFieldLayer(layer)) {
      gpuStarfield.setEnabled(enabled);
      return;
    }
    starfield.setLayerEnabled(layer, enabled);
  }

  function getLayerParam(layer: ControlLayerId, key: string): ControlValue {
    return isGpuFieldLayer(layer) ? gpuStarfield.getParam(key as keyof GpuStarfieldParams) : starfield.getLayerParam(layer, key);
  }

  function setLayerParam(layer: ControlLayerId, key: string, value: number, delay?: number): void {
    if (isGpuFieldLayer(layer)) {
      gpuStarfield.setParam(key as keyof GpuStarfieldParams, value);
      return;
    }
    starfield.setLayerParam(layer, key, value, delay);
  }

  function getLayerRadius(layer: ControlLayerId): number {
    if (isGpuFieldLayer(layer)) return 0;
    return starfield.getLayerRadius(layer);
  }

  function isUxVisible(): boolean {
    return uxVisible;
  }

  function setUxVisible(nextVisible: boolean): void {
    uxVisible = nextVisible;
    document.body.classList.toggle("is-ux-hidden", !uxVisible);

    if (uxVisible) {
      refreshVisibleStatsPanel({ force: true });
      return;
    }

    hideGpuStatsPanel();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function collectStatsForPanel(options: { detail?: "panel" | "debug" } = {}): StarfieldStats {
    updatingStatsPanel = true;
    try {
      return getStats(options);
    } finally {
      updatingStatsPanel = false;
    }
  }

  function scheduleNextStatsPanelRefresh(): void {
    if (statsRefreshTimer || !isUxVisible() || !gpuStatsPanel.classList.contains("is-visible")) return;
    statsRefreshTimer = window.setTimeout(() => {
      statsRefreshTimer = 0;
      refreshVisibleStatsPanel({ force: true });
    }, STATS_PANEL_REFRESH_MS);
  }

  function refreshVisibleStatsPanel({ force = false }: { force?: boolean } = {}): void {
    if (updatingStatsPanel || !isUxVisible()) return;
    if (!force && !gpuStatsPanel.classList.contains("is-visible")) return;
    const now = performance.now();
    const elapsed = now - lastStatsRefreshAt;

    if (!force && elapsed < STATS_PANEL_REFRESH_MS) {
      if (!statsRefreshTimer) {
        statsRefreshTimer = window.setTimeout(() => {
          statsRefreshTimer = 0;
          refreshVisibleStatsPanel({ force: true });
        }, STATS_PANEL_REFRESH_MS - elapsed);
      }
      return;
    }

    lastStatsRefreshAt = now;
    showGpuStatsPanel(collectStatsForPanel({ detail: "panel" }));
    scheduleNextStatsPanelRefresh();
  }

  function setBakeStatus(label: string, disabled = false): void {
    buttons.bake.textContent = label;
    buttons.bake.disabled = disabled;
  }

  function setOverlayButtonState(enabled: boolean): void {
    if (!buttons.overlay) return;
    buttons.overlay.setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  function syncLayerToggle(layer: ControlLayerId): void {
    const control = layerToggleInputs.get(layer);
    if (!control) return;
    const enabled = getLayerEnabled(layer);
    control.input.checked = enabled;
    control.value.textContent = control.format(enabled);
  }

  function syncLayerParam(layer: ControlLayerId, key: string): void {
    const control = layerParamInputs.get(`${layer}:${key}`);
    if (!control) return;
    const nextValue = getLayerParam(layer, key);
    control.input.value = String(nextValue);
    control.value.textContent = control.format(Number(nextValue));
    updateSliderFill(control.input, control.min, control.max);
  }

  function syncSeedButtonState(): void {
    buttons.seed.disabled = activeLayerId === "skyBackground" || activeLayerId === GPU_FIELD_LAYER_ID;
  }

  function toggleOverlay(): void {
    const nextEnabled = !starfield.getLayerEnabled("brightOverlay");
    starfield.setLayerEnabled("brightOverlay", nextEnabled);
    setOverlayButtonState(starfield.getLayerEnabled("brightOverlay"));
    syncLayerToggle("brightOverlay");
    refreshVisibleStatsPanel({ force: true });
  }

  function refreshReadouts(): void {
    refreshVisibleStatsPanel();
  }

  function addLayerToggleRow(parent: HTMLElement, layer: ControlLayerId, control: LayerToggleControl): void {
    const row = document.createElement("div");
    row.className = "row row--toggle";

    const top = document.createElement("div");
    top.className = "top";

    const label = document.createElement("label");
    label.textContent = control.label;

    const value = document.createElement("span");
    value.className = "val";

    const switchControl = document.createElement("div");
    switchControl.className = "switch";

    const input = document.createElement("input");
    input.id = `control-${layer}-${control.key}`;
    input.type = "checkbox";
    input.checked = getLayerEnabled(layer);
    label.htmlFor = input.id;
    layerToggleInputs.set(layer, { input, value, format: control.format });

    const track = document.createElement("span");
    track.className = "switch-track";

    function paint(nextValue: boolean): void {
      value.textContent = control.format(nextValue);
    }

    input.addEventListener("change", () => {
      paint(input.checked);
      setLayerEnabled(layer, input.checked);
      if (layer === "brightOverlay") {
        setOverlayButtonState(starfield.getLayerEnabled("brightOverlay"));
      }
      refreshVisibleStatsPanel({ force: true });
    });
    switchControl.addEventListener("click", (event) => {
      if (event.target === input) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    top.append(label, value);
    switchControl.append(input, track);
    row.append(top, switchControl);
    parent.append(row);
    paint(input.checked);
  }

  function addLayerRangeRow(parent: HTMLElement, layer: ControlLayerId, control: LayerRangeControl): void {
    const row = document.createElement("div");
    row.className = "row";

    const top = document.createElement("div");
    top.className = "top";

    const label = document.createElement("label");
    label.textContent = control.label;

    const value = document.createElement("span");
    value.className = "val";

    const input = document.createElement("input");
    input.id = `control-${layer}-${control.key}`;
    input.type = "range";
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(control.param ? getLayerParam(layer, control.key) : getLayerRadius(layer));
    label.htmlFor = input.id;
    if (control.param) {
      layerParamInputs.set(`${layer}:${control.key}`, {
        input,
        value,
        format: control.format,
        min: control.min,
        max: control.max,
      });
    }

    function paint(nextValue: number): void {
      value.textContent = control.format(nextValue);
      updateSliderFill(input, control.min, control.max);
    }

    input.addEventListener("input", () => {
      const nextValue = Number(input.value);
      paint(nextValue);
      if (control.param) {
        setLayerParam(layer, control.key, nextValue, 180);
        refreshVisibleStatsPanel();
        return;
      }
      if (!isGpuFieldLayer(layer)) {
        starfield.setLayerRadius(layer, nextValue);
      }
      refreshVisibleStatsPanel();
    });

    top.append(label, value);
    row.append(top, input);
    parent.append(row);
    paint(Number(input.value));
  }

  function addLayerTabs(): void {
    const row = document.createElement("div");
    row.className = "row row--layer-tabs";

    const tablist = document.createElement("div");
    tablist.className = "layer-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Starfield layers");

    const panels = document.createElement("div");
    panels.className = "layer-tab-panels";

    function activate(layerId: ControlLayerId): void {
      activeLayerId = layerId;
      Array.from(tablist.children).forEach((tabElement) => {
        const tab = tabElement as HTMLElement;
        const selected = tab.dataset.layer === layerId;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.tabIndex = selected ? 0 : -1;
      });

      Array.from(panels.children).forEach((panelElement) => {
        const panel = panelElement as HTMLElement;
        panel.hidden = panel.dataset.layer !== layerId;
      });
      syncSeedButtonState();
    }

    LAYER_TABS.forEach((layer, index) => {
      const selected = layer.id === activeLayerId;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "layer-tab";
      tab.textContent = layer.label;
      tab.dataset.layer = layer.id;
      tab.id = `layer-tab-${layer.id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `layer-panel-${layer.id}`);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      tab.addEventListener("click", () => activate(layer.id));

      const panel = document.createElement("div");
      panel.className = "layer-tab-panel";
      panel.dataset.layer = layer.id;
      panel.id = `layer-panel-${layer.id}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.hidden = !selected;

      layer.controls.forEach((control) => {
        if (control.type === "group") {
          const group = document.createElement("div");
          group.className = "group group--layer";
          group.textContent = control.label;
          panel.append(group);
          return;
        }
        if (control.type === "toggle") {
          addLayerToggleRow(panel, layer.id, control);
          return;
        }
        addLayerRangeRow(panel, layer.id, control);
      });

      tablist.append(tab);
      panels.append(panel);
    });

    row.append(tablist, panels);
    rows.append(row);
  }

  function buildPanel(): void {
    PARAMS.forEach((param) => {
      if ("group" in param) {
        const group = document.createElement("div");
        group.className = "group";
        group.textContent = param.group;
        rows.append(group);
        return;
      }

      if (param.kind === "layerTabs") {
        addLayerTabs();
      }
    });
  }

  function createStatsGroups(stats: StarfieldStats): StatsGroup[] {
    const groups: StatsGroup[] = [];
    let currentGroup: StatsGroup | null = null;

    formatGpuStatsForPanel(stats)
      .split("\n")
      .forEach((line) => {
        if (!line) {
          currentGroup = null;
          return;
        }

        if (!currentGroup) {
          currentGroup = { title: line, lines: [] };
          groups.push(currentGroup);
          return;
        }

        currentGroup.lines.push(line);
      });

    return groups;
  }

  function renderGpuStatsGroups(stats: StarfieldStats): void {
    const fragment = document.createDocumentFragment();
    const groups = createStatsGroups(stats);

    groups.forEach((group) => {
      const details = document.createElement("details");
      details.className = "gpu-stats-group";
      details.open = !collapsedStatsGroups.has(group.title);
      details.dataset.group = group.title;

      const summary = document.createElement("summary");
      summary.className = "gpu-stats-summary";
      summary.textContent = group.title;

      const lines = document.createElement("pre");
      lines.className = "gpu-stats-lines";
      lines.textContent = group.lines.join("\n");

      details.addEventListener("toggle", () => {
        if (details.open) {
          collapsedStatsGroups.delete(group.title);
          return;
        }
        collapsedStatsGroups.add(group.title);
      });

      details.append(summary, lines);
      fragment.append(details);
    });

    gpuStatsPanel.replaceChildren(fragment);
  }

  function showGpuStatsPanel(stats: StarfieldStats): void {
    renderGpuStatsGroups(stats);
    gpuStatsPanel.classList.add("is-visible");
  }

  function hideGpuStatsPanel(): void {
    clearTimeout(statsRefreshTimer);
    statsRefreshTimer = 0;
    gpuStatsPanel.classList.remove("is-visible");
  }

  function printGpuStats(): void {
    setUxVisible(true);
    const stats = collectStatsForPanel({ detail: "debug" });
    window.lastStarfieldGpuStats = stats;
    showGpuStatsPanel(stats);
    console.groupCollapsed("[Starfield GPU Stats]");
    console.table(stats);
    console.groupEnd();
  }

  function toggleUxVisibility(): void {
    setUxVisible(!uxVisible);
  }

  function handleUxHotkey(event: KeyboardEvent): void {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    toggleUxVisibility();
  }

  starfield.setBakeStatusHandler(setBakeStatus);
  starfield.setReadoutsChangeHandler(refreshReadouts);
  buttons.bake.addEventListener("click", () => starfield.bakeNow());
  buttons.seed.addEventListener("click", () => {
    if (activeLayerId === "skyBackground" || activeLayerId === GPU_FIELD_LAYER_ID) return;
    starfield.reseedLayer(activeLayerId);
    syncLayerParam(activeLayerId, "uSeed");
    refreshVisibleStatsPanel({ force: true });
  });
  buttons.recenter.addEventListener("click", onRecenter);
  buttons.overlay?.addEventListener("click", toggleOverlay);
  document.addEventListener("keydown", handleUxHotkey, true);
  window.printStarfieldGpuStats = printGpuStats;

  buildPanel();
  const layerIds: ControlLayerId[] = [
    STARFIELD_CONFIG.background.id,
    STARFIELD_CONFIG.baked.id,
    GPU_FIELD_LAYER_ID,
    STARFIELD_CONFIG.overlay.id,
  ];
  layerIds.forEach(syncLayerToggle);
  setOverlayButtonState(starfield.getLayerEnabled("brightOverlay"));
  syncSeedButtonState();

  return {
    refreshReadouts,
    printGpuStats,
    dispose() {
      clearTimeout(statsRefreshTimer);
      buttons.overlay?.removeEventListener("click", toggleOverlay);
      document.removeEventListener("keydown", handleUxHotkey, true);
      document.body.classList.remove("is-ux-hidden");
      gpuStatsPanel.remove();
    },
  };
}
