import type * as THREE from "three/webgpu";
import type {
  BakeJob,
  MutableUniform,
  PatchDescriptor,
  PatchLayout,
  PatchRenderTarget,
  PatchTextureTarget,
  RequestRender,
  StarfieldMaterial,
  StarfieldStats,
  UniformMap,
  VisiblePatchTarget,
} from "../starfield/types";

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

export interface NebulaParams {
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

export interface NebulaUniforms extends UniformMap {
  uTileUvMin: MutableUniform<THREE.Vector2>;
  uTileUvSize: MutableUniform<THREE.Vector2>;
  uAnchorCount: MutableUniform<number>;
  uBlend: MutableUniform<number>;
  uPower: MutableUniform<number>;
  uSigma: MutableUniform<number>;
  uColorWarpAmp: MutableUniform<number>;
  uColorWarpFreq: MutableUniform<number>;
  uAnchorDir: MutableUniform<THREE.Vector3[]>;
  uAnchorColor: MutableUniform<THREE.Vector3[]>;
  uSeed: MutableUniform<number>;
  uCoverage: MutableUniform<number>;
  uDensity: MutableUniform<number>;
  uSoftness: MutableUniform<number>;
  uContrast: MutableUniform<number>;
  uBaseScale: MutableUniform<number>;
  uOctaves: MutableUniform<number>;
  uOpacity: MutableUniform<number>;
  uLightFocus: MutableUniform<number>;
  uLightLining: MutableUniform<number>;
  uLightIntensity: MutableUniform<number>;
  uNebulaStrength: MutableUniform<number>;
  uNebulaExposure: MutableUniform<number>;
  uCloudShadow: MutableUniform<THREE.Vector3>;
  uCloudHighlight: MutableUniform<THREE.Vector3>;
  uCloudCore: MutableUniform<THREE.Vector3>;
}

export interface NebulaTargetManager {
  maxTextureSize: number;
  backgroundTargetType: THREE.TextureDataType;
  backgroundTargetTypeLabel: string;
  backgroundTargetBytesPerPixel: number;
  backgroundTargetColorSpace: THREE.ColorSpace;
  backgroundHdrEnabled: boolean;
  acquireTarget(width: number, height: number, options?: {
    type?: THREE.TextureDataType;
    colorSpace?: THREE.ColorSpace;
    name?: string;
    wrapS?: THREE.Wrapping;
    wrapT?: THREE.Wrapping;
    bytesPerPixel?: number;
  }): PatchRenderTarget;
  releaseTarget(target: PatchRenderTarget): void;
  disposePatchTarget(target: PatchRenderTarget | null | undefined): void;
  renderTargetWidth(target: PatchRenderTarget): number;
  renderTargetHeight(target: PatchRenderTarget): number;
  patchTargetBytes(target: PatchRenderTarget): number;
}

export interface NebulaBakeSkydome {
  finishDescriptorBlend(descriptor: PatchDescriptor): void;
  promoteDescriptorBakeTarget(descriptor: PatchDescriptor, target: PatchRenderTarget): void;
}

export interface NebulaBakePipelineArgs {
  renderer: THREE.Renderer;
  bakeCamera: THREE.Camera;
  nebulaScene: THREE.Scene;
  nebulaUniforms: NebulaUniforms;
  skydome: NebulaBakeSkydome;
  stats: StarfieldStats;
  getPatchDescriptors: () => PatchDescriptor[];
  targetForDescriptor: (descriptor: PatchDescriptor, label?: string) => PatchRenderTarget;
  targetMatchesDescriptor: (descriptor: PatchDescriptor, target: PatchRenderTarget) => boolean;
  releaseTarget: (target: PatchRenderTarget) => void;
  descriptorById: (patchId: string) => PatchDescriptor | undefined;
  targetBytes: (target: PatchRenderTarget) => number;
  notifyReadouts: () => void;
  requestRender: RequestRender;
  onBakeQueueDrained?: () => void;
}

export interface CreateNebulaLayerArgs {
  renderer: THREE.Renderer;
  scene: THREE.Scene;
  bakeCamera: THREE.Camera;
  requestRender: RequestRender;
  targetManager: NebulaTargetManager;
  initialLayout: PatchLayout;
  stats: StarfieldStats;
  notifyReadouts: () => void;
  getSphereSegments: () => number;
}

export interface NebulaLayerApi {
  readonly activeBlendCount: number;
  getParams(): NebulaParams;
  getParam(key: string): number;
  getUniforms(): NebulaUniforms;
  getDescriptors(): PatchDescriptor[];
  setParam(key: string, value: number, delay?: number): boolean;
  setEnabled(enabled: boolean): void;
  getEnabled(): boolean;
  setRadius(value: number): void;
  getRadius(): number;
  setLayout(layout: PatchLayout, options?: { bake?: boolean; reason?: string }): void;
  markStale(reason?: string): void;
  bakeNow(): void;
  scheduleBake(delay?: number): void;
  clearBakeQueue(): void;
  recordRender(): boolean;
  collectStats(): StarfieldStats;
  dispose(): void;
}

export type {
  BakeJob,
  PatchDescriptor,
  PatchLayout,
  PatchRenderTarget,
  PatchTextureTarget,
  StarfieldMaterial,
  StarfieldStats,
  UniformMap,
  VisiblePatchTarget,
};
