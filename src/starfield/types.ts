import type * as THREE from "three";

export type RequestRender = () => void;

export interface CameraInfo {
  horizontalFov: number;
  verticalFov: number;
  screenWidth: number;
  screenHeight: number;
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  forward?: { x: number; y: number; z: number };
}

export interface Size2 {
  width: number;
  height: number;
}

export interface BucketSize extends Size2 {
  bucket: number;
}

export interface PatchLayout {
  virtualWidth: number;
  virtualHeight: number;
  columns: number;
  rows: number;
  patchCount: number;
  guard: number;
  contentWidth: number;
  contentHeight: number;
  storageWidth: number;
  storageHeight: number;
  autoLayout: boolean;
  autoLayoutReason: string;
  autoLayoutDemand: unknown;
  supersample: number;
  qualityScale: number;
  idealVirtualWidth: number;
  idealVirtualHeight: number;
  effectiveVirtualWidth: number;
  effectiveVirtualHeight: number;
  idealPatchWidth: number;
  idealPatchHeight: number;
  allocation: PatchAllocation | null;
  targetTexelsPerPixel: number;
  demand: PatchDemand | null;
}

export interface PatchAllocation {
  budgetBytes: number;
  residentBytes: number;
  scratchBytes: number;
  peakBytes: number;
  peakBudgetRatio: number;
  budgetExceeded: boolean;
}

export interface PatchDemand {
  idealVirtualWidth: number;
  idealVirtualHeight: number;
  effectiveVirtualWidth: number;
  effectiveVirtualHeight: number;
  qualityScale: number;
  budgetBytes: number;
  residentBytes: number;
  scratchBytes: number;
  peakBytes: number;
  budgetExceeded: boolean;
}

export interface PatchRenderTargetMetadata {
  key?: string;
  bytes?: number;
  starfieldPool?: {
    bucket: number;
    key: string;
    inPool: boolean;
    bytesPerPixel: number;
  };
  starfieldSampling?: {
    innerOffset: THREE.Vector2;
    innerScale: THREE.Vector2;
    storageUvMin: THREE.Vector2;
    storageUvSize: THREE.Vector2;
    assignedSize: BucketSize;
    storageSize: Size2;
  };
}

export type PatchRenderTarget = THREE.WebGLRenderTarget & PatchRenderTargetMetadata;

export interface PatchTextureTarget {
  texture: THREE.Texture;
  starfieldSampling?: PatchRenderTargetMetadata["starfieldSampling"];
}

export type VisiblePatchTarget = PatchTextureTarget | PatchRenderTarget;

export interface PatchDescriptor {
  id: string;
  x: number;
  y: number;
  uvMin: THREE.Vector2;
  uvSize: THREE.Vector2;
  centerUv: THREE.Vector2;
  centerDirection: THREE.Vector3;
  logicalSize: Size2;
  storageUvMin: THREE.Vector2;
  storageUvSize: THREE.Vector2;
  innerOffset: THREE.Vector2;
  innerScale: THREE.Vector2;
  angularWidthRad: number;
  angularHeightRad: number;
  angularWidthDeg: number;
  angularHeightDeg: number;
  screenDemand: {
    projectedWidthPixels: number;
    projectedHeightPixels: number;
    projectedPixels: number;
  };
  requiredSize: BucketSize;
  currentSize: BucketSize;
  assignedSize: BucketSize;
  targetSize: BucketSize;
  requiredBucket: number;
  targetBucket: number;
  storageSize: Size2;
  storageGuard: { x: number; y: number };
  state: string;
  target: PatchRenderTarget | null;
  currentTarget: PatchRenderTarget | null;
  nextTarget: PatchRenderTarget | null;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  material: THREE.ShaderMaterial | null;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  fallbackState: string;
  estimatedStarCount: number;
  projectedPixels: number;
  starsPerProjectedPixel: number;
  densityScale: number;
  densityFallback: boolean;
  brightStarCount: number;
  brightStarPressure: number;
  downgraded: boolean;
  lastQueriedStarCount: number;
  lastQueriedStarInstances: number;
  lastQueriedCellCount: number;
  lastBakeReason: string;
  lastBakeDurationMs: number;
  lastBakedLayerKey: string;
  lastBakedScreenSignature: ScreenBakeSignature | null;
  lastBakedScreenSignatureKey: string;
  lastBakedTargetSize: BucketSize | null;
  lastBakedStorageSize: Size2 | null;
  pendingLayerBakeKey: string;
  pendingScreenSignature: ScreenBakeSignature | null;
  layerDirty: boolean;
  layerDirtyReason?: string;
  backgroundDirty?: boolean;
  backgroundDirtyReason?: string;
  blendActive: boolean;
  blendStartMs: number;
  blendDurationMs: number;
  blendProgress: number;
  blendFromTarget: PatchRenderTarget | null;
  blendToTarget: PatchRenderTarget | null;
  allocationState: string;
}

export interface ScreenBakeSignature {
  key: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  horizontalFov: number;
  verticalFov: number;
  screenPixelAngle: number;
}

export interface BakeJob {
  patchId: string;
  reason: string;
}

export interface QueueState {
  bakeJobQueue: BakeJob[];
  activeBakeJob: BakeJob | null;
  activeBakeJobs: number;
  pendingBakeJobs: number;
  completedBakeJobs: number;
  totalQueuedBakeJobs: number;
}

export interface StarClassStats {
  starClassTotal: number;
  tinyStarCount: number;
  normalStarCount: number;
  brightStarClassCount: number;
  heroStarCount: number;
  densityCandidateStarCount: number;
  bakedCandidateStarCount: number;
  overlayCandidateStarCount: number;
  overlayStarCount: number;
  overlayStarInstances: number;
  overlayTriangleCount: number;
  overlayDrawCalls: number;
  overlayEnabled: boolean;
  starClassSummary: string;
  tileAwareGeneration: boolean;
  starQueryGrid: string;
  lastStarQueryPatchId: string;
  lastStarQueryStarCount: number;
  lastStarQueryInstanceCount: number;
  lastStarQueryCellCount: number;
}

export interface CatalogStar {
  importance: number;
  cellId: string;
  column: number;
  row: number;
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  rSize: number;
  rBright: number;
  rGlare: number;
  rColor: number;
  rSizeGate: number;
  rWinkleRotation: number;
  rWinklePhase: number;
  rWinkleSpeed: number;
  classId: number;
}

export interface CatalogOverlayResult {
  geometry: THREE.InstancedBufferGeometry;
  overlayGeometry: THREE.InstancedBufferGeometry;
  classStats: StarClassStats;
  overlayStars: CatalogStar[];
}

export type UniformValue =
  | number
  | boolean
  | null
  | THREE.Texture
  | THREE.Vector2
  | THREE.Vector3
  | THREE.Vector3[];

export type UniformMap = Record<string, THREE.IUniform<UniformValue>>;
export type NumericUniformMap = Record<string, THREE.IUniform<number>>;

export interface StarUniforms {
  [key: string]: THREE.IUniform<UniformValue>;
  uDensity: THREE.IUniform<number>;
  uStarSize: THREE.IUniform<number>;
  uSizeVar: THREE.IUniform<number>;
  uLargeStarRarity: THREE.IUniform<number>;
  uBright: THREE.IUniform<number>;
  uBrightVar: THREE.IUniform<number>;
  uGlareSize: THREE.IUniform<number>;
  uGlareStr: THREE.IUniform<number>;
  uGlareVar: THREE.IUniform<number>;
  uColorVar: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
}

export interface BakeUniforms extends StarUniforms {
  uBakeSize: THREE.IUniform<THREE.Vector2>;
  uOutputSize: THREE.IUniform<THREE.Vector2>;
  uTileUvMin: THREE.IUniform<THREE.Vector2>;
  uTileUvSize: THREE.IUniform<THREE.Vector2>;
  uScreenPixelAngle: THREE.IUniform<number>;
  uReferenceHeight: THREE.IUniform<number>;
}

export interface OverlayUniforms extends StarUniforms {
  uScreenPixelAngle: THREE.IUniform<number>;
  uReferenceHeight: THREE.IUniform<number>;
  uWinkleAmount: THREE.IUniform<number>;
  uEffectMinSize: THREE.IUniform<number>;
  uEffectMaxSize: THREE.IUniform<number>;
  uWinkleSharpness: THREE.IUniform<number>;
  uWinkleFlashiness: THREE.IUniform<number>;
}

export interface DownsampleUniforms extends UniformMap {
  uSourceTexture: THREE.IUniform<THREE.Texture | null>;
  uSourceSize: THREE.IUniform<THREE.Vector2>;
  uTargetSize: THREE.IUniform<THREE.Vector2>;
  uSourcePerTarget: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
}

export interface BackgroundUniforms extends UniformMap {
  uTileUvMin: THREE.IUniform<THREE.Vector2>;
  uTileUvSize: THREE.IUniform<THREE.Vector2>;
  uAnchorCount: THREE.IUniform<number>;
  uBlend: THREE.IUniform<number>;
  uPower: THREE.IUniform<number>;
  uSigma: THREE.IUniform<number>;
  uColorWarpAmp: THREE.IUniform<number>;
  uColorWarpFreq: THREE.IUniform<number>;
  uAnchorDir: THREE.IUniform<THREE.Vector3[]>;
  uAnchorColor: THREE.IUniform<THREE.Vector3[]>;
  uSeed: THREE.IUniform<number>;
  uCoverage: THREE.IUniform<number>;
  uDensity: THREE.IUniform<number>;
  uSoftness: THREE.IUniform<number>;
  uContrast: THREE.IUniform<number>;
  uBaseScale: THREE.IUniform<number>;
  uOctaves: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uLightFocus: THREE.IUniform<number>;
  uLightLining: THREE.IUniform<number>;
  uLightIntensity: THREE.IUniform<number>;
  uNebulaStrength: THREE.IUniform<number>;
  uNebulaExposure: THREE.IUniform<number>;
  uCloudShadow: THREE.IUniform<THREE.Vector3>;
  uCloudHighlight: THREE.IUniform<THREE.Vector3>;
  uCloudCore: THREE.IUniform<THREE.Vector3>;
}

export type StatsValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Set<unknown>
  | Record<string, unknown>
  | Array<unknown>;

export type StarfieldStats = Record<string, StatsValue>;

export interface FieldGradientAnchor {
  dir: [number, number, number];
  color: [number, number, number];
}

export interface FieldGradient {
  type: "gradient";
  mode: "field";
  blend: "idw" | "gaussian";
  power?: number;
  sigma?: number;
  warp: { amp: number; freq: number } | null;
  anchors: FieldGradientAnchor[];
}

export type LayerId = "skyBackground" | "bakedStars" | "brightOverlay";

export interface StarLayerParams {
  [key: string]: number | undefined;
  uDensity: number;
  uStarSize: number;
  uSizeVar: number;
  uLargeStarRarity: number;
  uBright: number;
  uBrightVar: number;
  uGlareSize: number;
  uGlareStr: number;
  uGlareVar: number;
  uColorVar: number;
  uSeed: number;
  uWinkleAmount?: number;
  uEffectMinSize?: number;
  uEffectMaxSize?: number;
  uWinkleSharpness?: number;
  uWinkleFlashiness?: number;
}

export interface BackgroundParams {
  [key: string]: number | number[];
  uSeed: number;
  uCoverage: number;
  uDensity: number;
  uSoftness: number;
  uContrast: number;
  uBaseScale: number;
  uOctaves: number;
  uOpacity: number;
  uLightFocus: number;
  uLightLining: number;
  uLightIntensity: number;
  uNebulaStrength: number;
  uNebulaExposure: number;
  uCloudShadow: number[];
  uCloudHighlight: number[];
  uCloudCore: number[];
  uColorWarpAmp: number;
  uColorWarpFreq: number;
}

export interface GpuStarfieldApi {
  defaults: GpuStarfieldParams;
  setEnabled(enabled: boolean): void;
  getEnabled(): boolean;
  setParam(key: keyof GpuStarfieldParams, value: number | boolean): void;
  getParam(key: keyof GpuStarfieldParams): number | boolean;
  setCameraInfo(cameraInfo: Partial<CameraInfo>): void;
  recordRender(args: { delta: number; elapsedTime: number; cameraInfo: Partial<CameraInfo> }): void;
  collectStats(): StarfieldStats;
  dispose(): void;
}

export interface GpuStarfieldParams {
  enabled: boolean;
  starCount: number;
  fieldRadius: number;
  depthFade: number;
  travelSpeed: number;
  starSize: number;
  brightness: number;
  colorVariance: number;
}
