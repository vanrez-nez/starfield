import { Pane, type ButtonApi, type FolderApi, type TabPageApi } from "tweakpane";
import { STARFIELD_CONFIG } from "./config";
import type { BakeCoverage, GpuStarfieldApi, GpuStarfieldParams, StarfieldStats } from "./starfield/types";

const GPU_FIELD_LAYER_ID = STARFIELD_CONFIG.gpuField.id;

type ControlValue = number | boolean;
type PaneValue = number | boolean | string;
type PaneState = Record<string, PaneValue>;
type RangeFormatFn = (value: number) => string;
type ControlLayerId = "skyBackground" | "bakedStars" | "brightOverlay" | typeof GPU_FIELD_LAYER_ID;
type StarfieldControlLayerId = Exclude<ControlLayerId, typeof GPU_FIELD_LAYER_ID>;
type PaneContainer = FolderApi | TabPageApi;
type BakeCoverageKey = keyof BakeCoverage;

interface RefreshableBinding {
  refresh(): void;
}

interface DiagnosticBindingState {
  binding: RefreshableBinding;
  folder: FolderApi;
  lastRefreshAt: number;
}

interface LayerGroupControl {
  type: "group";
  label: string;
}

interface LayerToggleControl {
  type: "toggle";
  key: string;
  label: string;
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

interface StarfieldControlApi {
  getLayerEnabled(layerId: StarfieldControlLayerId): boolean;
  setLayerEnabled(layerId: StarfieldControlLayerId, enabled: boolean): void;
  getLayerParam(layerId: StarfieldControlLayerId, key: string): ControlValue;
  setLayerParam(layerId: StarfieldControlLayerId, key: string, value: number, delay?: number): void;
  reseedLayer(layerId: StarfieldControlLayerId): void;
  setBakeCoverage(values: Partial<BakeCoverage>, delay?: number): void;
  setBakeCoverageParam(key: BakeCoverageKey, value: number, delay?: number): void;
  getBakeCoverageParam(key: BakeCoverageKey): number;
  bakeNow(): void;
  setBakeStatusHandler(handler: (label: string, disabled?: boolean) => void): void;
  setReadoutsChangeHandler(handler: () => void): void;
}

interface CreateControlsArgs {
  container: HTMLElement;
  starfield: StarfieldControlApi;
  gpuStarfield: GpuStarfieldApi;
  getStats: (options?: { detail?: "panel" | "debug" }) => StarfieldStats;
  onRecenter: () => void;
  resetPerformanceHistory: () => void;
  setPerformanceProbeOptions: (options: { skipRenderSubmit?: boolean }) => void;
}

interface StatsGroup {
  title: string;
  lines: string[];
}

interface FrameSample {
  delta: number;
}

interface PerfProbeScenario {
  name: string;
  overrides: Partial<Record<ControlLayerId, boolean>>;
  hideUx?: boolean;
  pauseDiagnostics?: boolean;
  pauseFpsUi?: boolean;
  skipRenderSubmit?: boolean;
  params?: Array<{
    layer: ControlLayerId;
    key: string;
    value: number | boolean;
  }>;
}

interface ClippingPreset {
  azimuthCenterDeg: number;
  altitudeCenterDeg: number;
  azimuthSpanDeg: number;
  altitudeSpanDeg: number;
}

const CLIPPING_PRESETS = {
  Full: {
    azimuthCenterDeg: 0,
    altitudeCenterDeg: 0,
    azimuthSpanDeg: 360,
    altitudeSpanDeg: 180,
  },
  "Upper Half": {
    azimuthCenterDeg: 0,
    altitudeCenterDeg: 45,
    azimuthSpanDeg: 360,
    altitudeSpanDeg: 90,
  },
  "Lower Half": {
    azimuthCenterDeg: 0,
    altitudeCenterDeg: -45,
    azimuthSpanDeg: 360,
    altitudeSpanDeg: 90,
  },
  "Front Half": {
    azimuthCenterDeg: 0,
    altitudeCenterDeg: 0,
    azimuthSpanDeg: 180,
    altitudeSpanDeg: 180,
  },
} satisfies Record<string, ClippingPreset>;

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
    label: "Nebula",
    controls: [
      { type: "toggle", key: "skyBackgroundEnabled", label: "Enabled" },
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
    label: "Stars Bg",
    controls: [
      { type: "toggle", key: "bakedStarsEnabled", label: "Enabled" },
      { type: "range", key: "uParallaxStrength", label: "Strength", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
      ...STAR_LAYER_CONTROLS,
    ],
  },
  {
    id: GPU_FIELD_LAYER_ID,
    label: "Particles",
    controls: [
      { type: "toggle", key: "enabled", label: "Enabled" },
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
    label: "Stars Fg",
    controls: [
      { type: "toggle", key: "brightOverlayEnabled", label: "Enabled" },
      { type: "range", key: "uParallaxStrength", label: "Strength", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2), param: true },
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

const STATS_PANEL_REFRESH_MS = 500;
const STATS_PANEL_SLOW_REFRESH_MS = 2000;
const FRAME_PACING_DIAGNOSTIC_KEY = "frame_pacing";
const PERF_PROBE_DIAGNOSTIC_KEY = "perf_probe";
const FPS_ROLLING_WINDOW_SECONDS = 1.5;
const FPS_UPDATE_INTERVAL_MS = 100;
const FPS_DELTA_CLAMP_SECONDS = 1;
const FPS_GRAPH_MAX = 240;
const FPS_SMOOTHING_ALPHA = 0.18;
const PERF_PROBE_SAMPLE_MS = STARFIELD_CONFIG.internal.performanceProbeSampleMs;
const PERF_PROBE_SETTLE_MS = STARFIELD_CONFIG.internal.performanceProbeSettleMs;
const PERF_PROBE_SCENARIOS: PerfProbeScenario[] = [
  { name: "Baseline", overrides: {} },
  { name: "No Diagnostics", overrides: {}, pauseDiagnostics: true },
  { name: "No FPS UI", overrides: {}, pauseFpsUi: true },
  { name: "UX Hidden", overrides: {}, hideUx: true },
  { name: "No Nebula", overrides: { skyBackground: false } },
  { name: "No Stars Bg", overrides: { bakedStars: false } },
  { name: "No Particles", overrides: { [GPU_FIELD_LAYER_ID]: false } },
  { name: "No Stars Fg", overrides: { brightOverlay: false } },
  {
    name: "No Winkles",
    overrides: {},
    params: [{ layer: "brightOverlay", key: "uWinkleAmount", value: 0 }],
  },
  {
    name: "Overlay Density 180",
    overrides: {},
    params: [{ layer: "brightOverlay", key: "uDensity", value: 180 }],
  },
  {
    name: "Overlay Density 120",
    overrides: {},
    params: [{ layer: "brightOverlay", key: "uDensity", value: 120 }],
  },
  {
    name: "Overlay Density 90",
    overrides: {},
    params: [{ layer: "brightOverlay", key: "uDensity", value: 90 }],
  },
  {
    name: "Overlay Density 60",
    overrides: {},
    params: [{ layer: "brightOverlay", key: "uDensity", value: 60 }],
  },
  {
    name: "All Runtime Off",
    overrides: {
      skyBackground: false,
      bakedStars: false,
      [GPU_FIELD_LAYER_ID]: false,
      brightOverlay: false,
    },
  },
  { name: "No Render Submit", overrides: {}, skipRenderSubmit: true },
  {
    name: "Loop Only",
    overrides: {
      skyBackground: false,
      bakedStars: false,
      [GPU_FIELD_LAYER_ID]: false,
      brightOverlay: false,
    },
    skipRenderSubmit: true,
    pauseDiagnostics: true,
    pauseFpsUi: true,
    hideUx: true,
  },
];

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
    "Frame Pacing",
    `Target: ${formatNumber(stats.perfTargetFps, 0)} FPS (${formatNumber(stats.perfFrameBudgetMs, 2)}ms)`,
    `Cadence Epsilon: ${formatNumber(stats.perfCadenceMissEpsilonMs, 2)}ms`,
    `History: ${formatNumber(stats.perfHistorySeconds, 0)}s / ${formatInteger(stats.perfFrameCount)} frames`,
    `Dropped Slots: ${formatInteger(stats.perfDroppedFrames)} / ${formatInteger(stats.perfExpectedFrames)} (${formatPercent(stats.perfDropRate)})`,
    `Deadline Misses: ${formatInteger(stats.perfDeadlineMissFrames)} (${formatPercent(stats.perfDeadlineMissRate)})`,
    `Cadence Jitter: ${formatInteger(stats.perfCadenceMissFrames)} (${formatPercent(stats.perfCadenceMissRate)})`,
    `Jitter Avg/P95: ${formatNumber(stats.perfAverageCadenceJitterMs, 3)} / ${formatNumber(stats.perfP95CadenceJitterMs, 3)}ms`,
    `Overrun: ${formatNumber(stats.perfCadenceOverrunMs, 2)}ms total / ${formatNumber(stats.perfAverageCadenceOverrunMs, 3)}ms avg`,
    `Dropped-Frame Hitches: ${formatInteger(stats.perfHitchFrames)} (${formatPercent(stats.perfHitchRate)})`,
    `Long Tasks: ${formatInteger(stats.perfLongTaskCount)} / ${formatNumber(stats.perfLongTaskTotalMs, 1)}ms total / ${formatNumber(stats.perfLongTaskMaxMs, 1)}ms max`,
    `Recent Long Tasks: ${stats.perfLongTaskSummary ?? "none"}`,
    `FPS Avg/P95: ${formatNumber(stats.perfAverageFps, 1)} / ${formatNumber(stats.perfPacedFps, 1)}`,
    `Frame Avg/P95/P99/Max: ${formatNumber(stats.perfAverageFrameMs, 2)} / ${formatNumber(stats.perfP95FrameMs, 2)} / ${formatNumber(stats.perfP99FrameMs, 2)} / ${formatNumber(stats.perfMaxFrameMs, 2)}ms`,
    `Worst Stage: ${stats.perfWorstStage ?? "none"}`,
    `Stage P95: ${stats.perfStageP95Summary ?? "none"}`,
    `Stage Max: ${stats.perfStageMaxSummary ?? "none"}`,
    "",
    "Perf Probe",
    `Status: ${stats.perfProbeStatus ?? "idle"}`,
    `Sample: ${formatNumber(stats.perfProbeSampleMs, 0)}ms`,
    `${stats.perfProbeResults ?? "No probe results yet."}`,
    "",
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
    `Stars Bg Strength: ${formatNumber(stats.bakedStarLayerStrength, 2)}`,
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
    `Stars Fg Strength: ${formatNumber(stats.overlayLayerStrength, 2)}`,
    `Overlay Density: ${formatInteger(stats.overlayLayerDensity)}`,
    `Overlay Seed: ${formatNumber(stats.overlayLayerSeed, 0)}`,
    `Overlay Catalog: ${formatInteger(stats.overlayLayerStarCount)}`,
    `Overlay Active: ${formatInteger(stats.overlayStarCount)}`,
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
    `Coverage Projection: ${stats.coverageProjection ?? "equirect"}`,
    `Coverage Azimuth: ${formatNumber(stats.coverageAzimuthSpanDeg ?? 360, 0)}deg @ ${formatNumber(stats.coverageAzimuthCenterDeg ?? 0, 0)}deg`,
    `Coverage Altitude: ${formatNumber(stats.coverageAltitudeSpanDeg ?? 180, 0)}deg @ ${formatNumber(stats.coverageAltitudeCenterDeg ?? 0, 0)}deg`,
    `Coverage Fraction: ${formatPercent(stats.coverageFraction ?? 1)}`,
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
    "Catalog",
    `Tiny: ${formatInteger(stats.tinyStarCount)}`,
    `Normal: ${formatInteger(stats.normalStarCount)}`,
    `Bright: ${formatInteger(stats.brightStarClassCount)}`,
    `Hero: ${formatInteger(stats.heroStarCount)}`,
    `Density Candidates: ${formatInteger(stats.densityCandidateStarCount)}`,
    `Baked Candidates: ${formatInteger(stats.bakedCandidateStarCount)}`,
    `Overlay Candidates: ${formatInteger(stats.overlayCandidateStarCount)}`,
    `Overlay Active Cap: ${formatInteger(STARFIELD_CONFIG.internal.foregroundOverlayMaxStars)}`,
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

function normalizeNumber(value: ControlValue): number {
  return typeof value === "boolean" ? Number(value) : value;
}

function diagnosticsKey(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function statsBindingRows(lines: string[]): number {
  return Math.min(18, Math.max(4, lines.length + 1));
}

export function createControls({
  container,
  starfield,
  gpuStarfield,
  getStats,
  onRecenter,
  resetPerformanceHistory,
  setPerformanceProbeOptions,
}: CreateControlsArgs) {
  const pane = new Pane({ title: "Starfield", container });
  const paneState: Record<ControlLayerId, PaneState> = {
    skyBackground: {},
    bakedStars: {},
    [GPU_FIELD_LAYER_ID]: {},
    brightOverlay: {},
  };
  const diagnosticState: PaneState = {};
  const diagnosticBindings = new Map<string, DiagnosticBindingState>();
  const layerBindings = new Map<string, RefreshableBinding>();
  const actionState: PaneState = { bakeStatus: "Idle" };
  const perfProbeState = {
    running: false,
    status: "Idle",
    results: "No probe results yet.",
  };
  const fpsState: PaneState = { fps: 0 };
  const clippingState: PaneState = {
    preset: "Full",
    azimuthCenterDeg: starfield.getBakeCoverageParam("azimuthCenterDeg"),
    altitudeCenterDeg: starfield.getBakeCoverageParam("altitudeCenterDeg"),
    azimuthSpanDeg: starfield.getBakeCoverageParam("azimuthSpanDeg"),
    altitudeSpanDeg: starfield.getBakeCoverageParam("altitudeSpanDeg"),
  };
  const clippingBindings = new Map<BakeCoverageKey | "preset", RefreshableBinding>();
  const fpsSamples: FrameSample[] = [];

  let uxVisible = true;
  let updatingDiagnostics = false;
  let statsRefreshTimer = 0;
  let lastStatsRefreshAt = 0;
  let fpsDeltaSum = 0;
  let lastFpsUpdateAt = 0;
  let lastFpsLabel = "";
  let smoothedFps = 0;
  let fpsBinding: RefreshableBinding | null = null;
  let bakeButton: ButtonApi;
  let perfProbeButton: ButtonApi;
  let diagnosticsPage: TabPageApi | null = null;
  let diagnosticsTabSelected = false;
  let syncingClippingState = false;
  let applyingClippingPreset = false;
  let clippingPresetTimer = 0;
  let diagnosticsPausedForProbe = false;
  let fpsUiPausedForProbe = false;

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

  function layerBindingKey(layer: ControlLayerId, key: string): string {
    return `${layer}:${key}`;
  }

  function syncLayerBinding(layer: ControlLayerId, key: string): void {
    const binding = layerBindings.get(layerBindingKey(layer, key));
    if (!binding) return;
    const control = LAYER_TABS
      .find((tab) => tab.id === layer)
      ?.controls.find((entry): entry is LayerToggleControl | LayerRangeControl => entry.type !== "group" && entry.key === key);
    if (!control) return;
    if (control.type === "toggle") {
      paneState[layer][key] = getLayerEnabled(layer);
    } else {
      paneState[layer][key] = normalizeNumber(getLayerParam(layer, key));
    }
    binding.refresh();
  }

  function syncLayerEnabledBinding(layer: ControlLayerId): void {
    if (layer === "skyBackground") {
      syncLayerBinding(layer, "skyBackgroundEnabled");
    } else if (layer === "bakedStars") {
      syncLayerBinding(layer, "bakedStarsEnabled");
    } else if (layer === "brightOverlay") {
      syncLayerBinding(layer, "brightOverlayEnabled");
    } else {
      syncLayerBinding(layer, "enabled");
    }
  }

  function syncOverlayControls(): void {
    const enabled = starfield.getLayerEnabled("brightOverlay");
    paneState.brightOverlay.brightOverlayEnabled = enabled;
    syncLayerBinding("brightOverlay", "brightOverlayEnabled");
  }

  function syncClippingBinding(key: BakeCoverageKey | "preset"): void {
    clippingBindings.get(key)?.refresh();
  }

  function syncClippingStateFromRuntime(): void {
    syncingClippingState = true;
    ([
      "azimuthCenterDeg",
      "altitudeCenterDeg",
      "azimuthSpanDeg",
      "altitudeSpanDeg",
    ] as BakeCoverageKey[]).forEach((key) => {
      clippingState[key] = starfield.getBakeCoverageParam(key);
      syncClippingBinding(key);
    });
    syncingClippingState = false;
  }

  function setClippingValues(values: Partial<BakeCoverage>, delay = 450, presetName?: string): void {
    if (presetName) {
      applyingClippingPreset = true;
      window.clearTimeout(clippingPresetTimer);
    }
    (Object.keys(values) as BakeCoverageKey[]).forEach((key) => {
      const value = values[key];
      if (typeof value !== "number") return;
      clippingState[key] = value;
    });
    starfield.setBakeCoverage(values, delay);
    syncClippingStateFromRuntime();
    if (presetName) {
      clippingState.preset = presetName;
      syncClippingBinding("preset");
      clippingPresetTimer = window.setTimeout(() => {
        applyingClippingPreset = false;
        clippingState.preset = presetName;
        syncClippingBinding("preset");
      }, 80);
    }
    refreshDiagnostics();
  }

  function collectStatsForPane(options: { detail?: "panel" | "debug" } = {}): StarfieldStats {
    updatingDiagnostics = true;
    try {
      return {
        ...getStats(options),
        perfProbeStatus: perfProbeState.status,
        perfProbeResults: perfProbeState.results,
        perfProbeSampleMs: PERF_PROBE_SAMPLE_MS,
      };
    } finally {
      updatingDiagnostics = false;
    }
  }

  function updateDiagnostics(
    stats: StarfieldStats,
    options: { force?: boolean; keys?: Set<string> } = {},
  ): void {
    const now = performance.now();
    const groups = createStatsGroups(stats);
    groups.forEach((group) => {
      const key = diagnosticsKey(group.title);
      const state = diagnosticBindings.get(key);
      if (!state) return;

      const isFramePacing = key === FRAME_PACING_DIAGNOSTIC_KEY;
      const isPerfProbe = key === PERF_PROBE_DIAGNOSTIC_KEY;
      const forceGroup = Boolean(options.keys?.has(key) || (options.force && !options.keys));
      const interval = isFramePacing ? STATS_PANEL_REFRESH_MS : STATS_PANEL_SLOW_REFRESH_MS;
      const shouldRefresh = forceGroup
        || (state.folder.expanded && !isPerfProbe && now - state.lastRefreshAt >= interval);
      if (!shouldRefresh) return;

      const nextText = group.lines.join("\n");
      if (diagnosticState[key] !== nextText) {
        diagnosticState[key] = nextText;
        state.binding.refresh();
      }
      state.lastRefreshAt = now;
    });
  }

  function refreshDiagnostics({
    force = false,
    keys,
  }: {
    force?: boolean;
    keys?: Set<string>;
  } = {}): void {
    if (updatingDiagnostics || !uxVisible || !diagnosticsTabSelected || diagnosticsPausedForProbe) return;
    const now = performance.now();
    const elapsed = now - lastStatsRefreshAt;

    if (!force && elapsed < STATS_PANEL_REFRESH_MS) {
      if (!statsRefreshTimer) {
        statsRefreshTimer = window.setTimeout(() => {
          statsRefreshTimer = 0;
          refreshDiagnostics({ force: true });
        }, STATS_PANEL_REFRESH_MS - elapsed);
      }
      return;
    }

    lastStatsRefreshAt = now;
    updateDiagnostics(collectStatsForPane({ detail: "panel" }), { force, keys });
    scheduleNextDiagnosticsRefresh();
  }

  function scheduleNextDiagnosticsRefresh(): void {
    if (statsRefreshTimer || !uxVisible || !diagnosticsTabSelected || diagnosticsPausedForProbe) return;
    statsRefreshTimer = window.setTimeout(() => {
      statsRefreshTimer = 0;
      refreshDiagnostics();
    }, STATS_PANEL_REFRESH_MS);
  }

  function setUxVisible(nextVisible: boolean): void {
    uxVisible = nextVisible;
    document.body.classList.toggle("is-ux-hidden", !uxVisible);
    clearTimeout(statsRefreshTimer);
    statsRefreshTimer = 0;

    if (uxVisible && diagnosticsTabSelected) {
      refreshDiagnostics({ force: true });
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function toggleUxVisibility(): void {
    setUxVisible(!uxVisible);
  }

  function handleUxHotkey(event: KeyboardEvent): void {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    toggleUxVisibility();
  }

  function refreshReadouts(): void {
    refreshDiagnostics();
  }

  function setBakeStatus(label: string, disabled = false): void {
    actionState.bakeStatus = label;
    bakeButton.title = disabled ? label : "Bake";
    bakeButton.disabled = disabled;
    pane.refresh();
  }

  function setPerfProbeStatus(status: string): void {
    perfProbeState.status = status;
    if (perfProbeButton) {
      perfProbeButton.title = perfProbeState.running ? status : "Run Perf Probe";
      perfProbeButton.disabled = perfProbeState.running;
    }
    refreshDiagnostics({ force: true, keys: new Set([PERF_PROBE_DIAGNOSTIC_KEY]) });
  }

  function setLayerEnabledForProbe(layer: ControlLayerId, enabled: boolean): void {
    setLayerEnabled(layer, enabled);
    syncLayerEnabledBinding(layer);
  }

  function syncLayerParamBinding(layer: ControlLayerId, key: string): void {
    syncLayerBinding(layer, key);
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function formatProbeLine(name: string, stats: StarfieldStats): string {
    return [
      `${name}:`,
      `${formatNumber(stats.perfPacedFps, 1)} FPS p95`,
      `${formatPercent(stats.perfDropRate)} dropped slots`,
      `${formatPercent(stats.perfDeadlineMissRate)} deadline miss`,
      `${formatPercent(stats.perfCadenceMissRate)} cadence jitter`,
      `${formatNumber(stats.perfP95FrameMs, 2)}ms p95`,
      `${formatNumber(stats.perfMaxFrameMs, 2)}ms max`,
      `${formatInteger(stats.perfLongTaskCount)} long tasks`,
      `worst ${stats.perfWorstStage ?? "none"}`,
    ].join(" ");
  }

  async function runPerfProbe(): Promise<void> {
    if (perfProbeState.running) return;
    perfProbeState.running = true;
    const originalStates: Record<ControlLayerId, boolean> = {
      skyBackground: getLayerEnabled("skyBackground"),
      bakedStars: getLayerEnabled("bakedStars"),
      [GPU_FIELD_LAYER_ID]: getLayerEnabled(GPU_FIELD_LAYER_ID),
      brightOverlay: getLayerEnabled("brightOverlay"),
    };
    const originalUxVisible = uxVisible;
    const originalParams = new Map<string, number | boolean>();
    const results: string[] = [];

    try {
      setPerfProbeStatus("Preparing probe");
      for (const scenario of PERF_PROBE_SCENARIOS) {
        setPerfProbeStatus(`Probe: ${scenario.name}`);
        diagnosticsPausedForProbe = Boolean(scenario.pauseDiagnostics);
        fpsUiPausedForProbe = Boolean(scenario.pauseFpsUi);
        setPerformanceProbeOptions({ skipRenderSubmit: Boolean(scenario.skipRenderSubmit) });
        setUxVisible(scenario.hideUx ? false : originalUxVisible);
        (Object.keys(originalStates) as ControlLayerId[]).forEach((layer) => {
          const nextEnabled = scenario.overrides[layer] ?? originalStates[layer];
          setLayerEnabledForProbe(layer, nextEnabled);
        });
        scenario.params?.forEach(({ layer, key, value }) => {
          const mapKey = `${layer}:${key}`;
          if (!originalParams.has(mapKey)) {
            originalParams.set(mapKey, getLayerParam(layer, key));
          }
          setLayerParam(layer, key, Number(value), 0);
          syncLayerParamBinding(layer, key);
        });
        await wait(PERF_PROBE_SETTLE_MS);
        resetPerformanceHistory();
        await wait(PERF_PROBE_SAMPLE_MS);
        const stats = collectStatsForPane({ detail: "panel" });
        results.push(formatProbeLine(scenario.name, stats));
        perfProbeState.results = results.join("\n");
        refreshDiagnostics({ force: true, keys: new Set([PERF_PROBE_DIAGNOSTIC_KEY]) });
      }
      perfProbeState.status = "Complete";
    } finally {
      (Object.keys(originalStates) as ControlLayerId[]).forEach((layer) => {
        setLayerEnabledForProbe(layer, originalStates[layer]);
      });
      originalParams.forEach((value, mapKey) => {
        const [layer, key] = mapKey.split(":") as [ControlLayerId, string];
        setLayerParam(layer, key, Number(value), 0);
        syncLayerParamBinding(layer, key);
      });
      diagnosticsPausedForProbe = false;
      fpsUiPausedForProbe = false;
      setPerformanceProbeOptions({ skipRenderSubmit: false });
      setUxVisible(originalUxVisible);
      resetPerformanceHistory();
      perfProbeState.running = false;
      setPerfProbeStatus(perfProbeState.status === "Complete" ? "Complete" : "Interrupted");
    }
  }

  function updateFps(deltaSeconds: number): void {
    if (fpsUiPausedForProbe) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const clampedDelta = Math.min(deltaSeconds, FPS_DELTA_CLAMP_SECONDS);
    fpsSamples.push({ delta: clampedDelta });
    fpsDeltaSum += clampedDelta;

    while (fpsSamples.length > 1 && fpsDeltaSum - fpsSamples[0].delta > FPS_ROLLING_WINDOW_SECONDS) {
      const sample = fpsSamples.shift();
      if (sample) fpsDeltaSum -= sample.delta;
    }

    const now = performance.now();
    if (now - lastFpsUpdateAt < FPS_UPDATE_INTERVAL_MS && fpsSamples.length > 1) return;
    lastFpsUpdateAt = now;

    const averageDelta = fpsSamples.length > 0 ? fpsDeltaSum / fpsSamples.length : clampedDelta;
    const rollingFps = Math.min(FPS_GRAPH_MAX, 1 / Math.max(averageDelta, 1 / FPS_GRAPH_MAX));
    smoothedFps = smoothedFps > 0
      ? smoothedFps + (rollingFps - smoothedFps) * FPS_SMOOTHING_ALPHA
      : rollingFps;

    fpsState.fps = smoothedFps;
    const nextLabel = `FPS (${Math.round(smoothedFps)})`;
    if (nextLabel !== lastFpsLabel && fpsBinding && "label" in fpsBinding) {
      (fpsBinding as RefreshableBinding & { label: string }).label = nextLabel;
      lastFpsLabel = nextLabel;
    }
  }

  function buildLayerBinding(parent: PaneContainer, layer: ControlLayerId, control: LayerToggleControl | LayerRangeControl): void {
    if (control.type === "toggle") {
      paneState[layer][control.key] = getLayerEnabled(layer);
      const binding = parent.addBinding(paneState[layer], control.key, { label: control.label });
      layerBindings.set(layerBindingKey(layer, control.key), binding);
      binding.on("change", (event) => {
        setLayerEnabled(layer, Boolean(event.value));
        if (layer === "brightOverlay") syncOverlayControls();
        refreshDiagnostics();
      });
      return;
    }

    paneState[layer][control.key] = normalizeNumber(getLayerParam(layer, control.key));
    const binding = parent.addBinding(paneState[layer], control.key, {
      label: control.label,
      min: control.min,
      max: control.max,
      step: control.step,
      format: control.format,
    });
    layerBindings.set(layerBindingKey(layer, control.key), binding);
    binding.on("change", (event) => {
      const nextValue = Number(event.value);
      if (!Number.isFinite(nextValue)) return;
      setLayerParam(layer, control.key, nextValue, 180);
      refreshDiagnostics();
    });
  }

  function buildLayerPage(page: TabPageApi, tab: LayerTabConfig): void {
    let currentContainer: PaneContainer = page;

    tab.controls.forEach((control) => {
      if (control.type === "group") {
        currentContainer = page.addFolder({ title: control.label, expanded: true });
        return;
      }
      buildLayerBinding(currentContainer, tab.id, control);
    });

    if (tab.id === "bakedStars") {
      page.addButton({ title: "Reseed Baked" }).on("click", () => {
        starfield.reseedLayer("bakedStars");
        syncLayerBinding("bakedStars", "uSeed");
        refreshDiagnostics();
      });
    } else if (tab.id === "brightOverlay") {
      page.addButton({ title: "Reseed Overlay" }).on("click", () => {
        starfield.reseedLayer("brightOverlay");
        syncLayerBinding("brightOverlay", "uSeed");
        refreshDiagnostics();
      });
    }
  }

  function buildDiagnosticsPage(page: TabPageApi): void {
    const initialStats = collectStatsForPane({ detail: "panel" });
    createStatsGroups(initialStats).forEach((group) => {
      const key = diagnosticsKey(group.title);
      diagnosticState[key] = group.lines.join("\n");
      const folder = page.addFolder({
        title: group.title,
        expanded: key === FRAME_PACING_DIAGNOSTIC_KEY || key === PERF_PROBE_DIAGNOSTIC_KEY,
      });
      folder.on("fold", () => {
        if (folder.expanded) {
          refreshDiagnostics({ force: true, keys: new Set([key]) });
        }
      });
      const binding = folder.addBinding(diagnosticState, key, {
        label: null as unknown as string,
        readonly: true,
        multiline: true,
        rows: statsBindingRows(group.lines),
      });
      diagnosticBindings.set(key, { binding, folder, lastRefreshAt: 0 });
    });
  }

  function buildPane(): void {
    fpsBinding = pane.addBinding(fpsState, "fps", {
      label: "FPS",
      readonly: true,
      view: "graph",
      min: 0,
      max: FPS_GRAPH_MAX,
      bufferSize: 120,
      interval: 100,
    });

    const clipping = pane.addFolder({ title: "Clipping", expanded: false });
    const presetBinding = clipping.addBinding(clippingState, "preset", {
      label: "Preset",
      options: {
        ...Object.fromEntries(Object.keys(CLIPPING_PRESETS).map((name) => [name, name])),
        Custom: "Custom",
      },
    });
    clippingBindings.set("preset", presetBinding);
    presetBinding.on("change", (event) => {
      const presetName = String(event.value);
      const preset = CLIPPING_PRESETS[presetName as keyof typeof CLIPPING_PRESETS];
      if (!preset) return;
      setClippingValues(preset, 180, presetName);
    });

    const clippingRanges: Array<{
      key: BakeCoverageKey;
      label: string;
      min: number;
      max: number;
      step: number;
    }> = [
      { key: "azimuthCenterDeg", label: "Az Center", min: -180, max: 180, step: 1 },
      { key: "altitudeCenterDeg", label: "Alt Center", min: -90, max: 90, step: 1 },
      { key: "azimuthSpanDeg", label: "Azimuth", min: 1, max: 360, step: 1 },
      { key: "altitudeSpanDeg", label: "Altitude", min: 1, max: 180, step: 1 },
    ];
    clippingRanges.forEach((control) => {
      const binding = clipping.addBinding(clippingState, control.key, {
        label: control.label,
        min: control.min,
        max: control.max,
        step: control.step,
        format: (value) => `${Number(value).toFixed(0)}deg`,
      });
      clippingBindings.set(control.key, binding);
      binding.on("change", (event) => {
        if (syncingClippingState || applyingClippingPreset) return;
        clippingState.preset = "Custom";
        syncClippingBinding("preset");
        const nextValue = Number(event.value);
        if (!Number.isFinite(nextValue)) return;
        starfield.setBakeCoverageParam(control.key, nextValue, 450);
        syncClippingStateFromRuntime();
        refreshDiagnostics();
      });
    });

    const tabs = pane.addTab({
      pages: [
        ...LAYER_TABS.map((layer) => ({ title: layer.label })),
        { title: "Dbg" },
      ],
    });
    LAYER_TABS.forEach((layer, index) => buildLayerPage(tabs.pages[index], layer));
    diagnosticsPage = tabs.pages[LAYER_TABS.length];
    buildDiagnosticsPage(diagnosticsPage);
    tabs.on("select", (event) => {
      diagnosticsTabSelected = event.index === LAYER_TABS.length;
      clearTimeout(statsRefreshTimer);
      statsRefreshTimer = 0;
      if (diagnosticsTabSelected) {
        lastStatsRefreshAt = 0;
        refreshDiagnostics({ force: true });
      }
    });
    syncOverlayControls();

    const actions = pane.addFolder({ title: "Actions", expanded: true });
    actions.addBinding(actionState, "bakeStatus", { label: "Bake Status", readonly: true });
    bakeButton = actions.addButton({ title: "Bake" });
    bakeButton.on("click", () => starfield.bakeNow());
    actions.addButton({ title: "Recenter" }).on("click", onRecenter);
    perfProbeButton = actions.addButton({ title: "Run Perf Probe" });
    perfProbeButton.on("click", () => {
      void runPerfProbe();
    });
    actions.addButton({ title: "Reset Perf" }).on("click", () => {
      resetPerformanceHistory();
      refreshDiagnostics({ force: true });
    });
  }

  function printGpuStats(): void {
    setUxVisible(true);
    if (diagnosticsPage) {
      diagnosticsPage.selected = true;
      diagnosticsTabSelected = true;
    }
    const stats = collectStatsForPane({ detail: "debug" });
    window.lastStarfieldGpuStats = stats;
    updateDiagnostics(stats, { force: true });
    console.groupCollapsed("[Starfield GPU Stats]");
    console.table(stats);
    console.groupEnd();
  }

  starfield.setBakeStatusHandler(setBakeStatus);
  starfield.setReadoutsChangeHandler(refreshReadouts);
  document.addEventListener("keydown", handleUxHotkey, true);
  window.printStarfieldGpuStats = printGpuStats;

  buildPane();
  refreshDiagnostics({ force: true });

  return {
    updateFps,
    refreshReadouts,
    printGpuStats,
    dispose() {
      clearTimeout(statsRefreshTimer);
      clearTimeout(clippingPresetTimer);
      document.removeEventListener("keydown", handleUxHotkey, true);
      document.body.classList.remove("is-ux-hidden");
      pane.dispose();
    },
  };
}
