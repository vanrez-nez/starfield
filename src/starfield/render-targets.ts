import * as THREE from "three/webgpu";
import {
  BASE_TARGET_POOL_BUCKETS,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  HDR_TEXTURE_BYTES_PER_PIXEL,
  estimateTextureBytes,
} from "./constants";
import type { PatchRenderTarget, StarfieldStats } from "./types";

interface RenderTargetOptions {
  type?: THREE.TextureDataType;
  colorSpace?: THREE.ColorSpace;
  name?: string;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  bytesPerPixel?: number;
}

type TargetPoolMap = Map<string, PatchRenderTarget[]>;
type BucketCounts = Record<string, number>;
type PatchPoolState = NonNullable<PatchRenderTarget["starfieldPool"]>;

function rendererBackend(renderer: THREE.Renderer): Record<string, unknown> {
  return (renderer as unknown as { backend?: Record<string, unknown> }).backend ?? {};
}

function detectMaxTextureSize(renderer: THREE.Renderer): number {
  const backend = rendererBackend(renderer);
  const device = backend.device as { limits?: { maxTextureDimension2D?: number } } | undefined;
  if (typeof device?.limits?.maxTextureDimension2D === "number") {
    return device.limits.maxTextureDimension2D;
  }

  const gl = backend.gl as WebGL2RenderingContext | undefined;
  if (gl) {
    return Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  }

  return 16384;
}

function backendExtensionAvailable(renderer: THREE.Renderer, name: string): boolean {
  const backend = rendererBackend(renderer);
  const extensions = backend.extensions as { get?: (extensionName: string) => unknown } | undefined;
  return Boolean(extensions?.get?.(name));
}

function bytesPerPixelForType(type: THREE.TextureDataType): number {
  if (type === THREE.HalfFloatType) return HDR_TEXTURE_BYTES_PER_PIXEL;
  if (type === THREE.FloatType) return 16;
  return FINAL_TEXTURE_BYTES_PER_PIXEL;
}

function textureTypeLabel(type: THREE.TextureDataType): string {
  if (type === THREE.HalfFloatType) return "HalfFloatType";
  if (type === THREE.FloatType) return "FloatType";
  if (type === THREE.UnsignedByteType) return "UnsignedByteType";
  return String(type);
}

export function createRenderTargetManager({ renderer }: { renderer: THREE.Renderer }) {
  const backend = rendererBackend(renderer);
  const maxTextureSize = detectMaxTextureSize(renderer);
  const webgpuBackend = backend.isWebGPUBackend === true;
  const webglBackend = backend.isWebGLBackend === true;
  const floatBlendSupported = webgpuBackend || backendExtensionAvailable(renderer, "EXT_float_blend");
  const halfFloatRenderTargetSupported = webgpuBackend
    || (webglBackend && backendExtensionAvailable(renderer, "EXT_color_buffer_float"));
  const halfFloatAccumulationSupported = webgpuBackend
    || (webglBackend && backendExtensionAvailable(renderer, "EXT_color_buffer_float") && floatBlendSupported);
  const accumulationType = halfFloatAccumulationSupported ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const backgroundTargetType = halfFloatRenderTargetSupported ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const backgroundTargetBytesPerPixel = bytesPerPixelForType(backgroundTargetType);
  const backgroundTargetColorSpace = THREE.LinearSRGBColorSpace;
  const targetPoolBuckets = maxTextureSize >= 8192
    ? [...BASE_TARGET_POOL_BUCKETS, 8192]
    : BASE_TARGET_POOL_BUCKETS.filter((bucket) => bucket <= maxTextureSize);
  const targetPools: TargetPoolMap = new Map();
  const activePatchTargets = new Set<PatchRenderTarget>();
  let allocationCount = 0;

  function createRenderTarget(width: number, height: number, options: RenderTargetOptions = {}): PatchRenderTarget {
    const {
      type = THREE.UnsignedByteType,
      colorSpace = THREE.SRGBColorSpace,
      name = "Baked equirectangular skydome starfield",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
      bytesPerPixel = bytesPerPixelForType(type),
    } = options;
    const target = new THREE.RenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS,
      wrapT,
    });

    const patchTarget = target as PatchRenderTarget;
    patchTarget.texture.name = name;
    patchTarget.texture.colorSpace = colorSpace;
    patchTarget.texture.generateMipmaps = false;
    patchTarget.starfieldPool = {
      bucket: targetPoolBucketForStorage(width, height),
      key: "",
      inPool: false,
      bytesPerPixel,
      type,
      colorSpace,
    };
    allocationCount += 1;
    return patchTarget;
  }

  function createAccumulationTarget(width: number, height: number): PatchRenderTarget {
    return createRenderTarget(width, height, {
      type: accumulationType,
      colorSpace: THREE.LinearSRGBColorSpace,
      name: "HDR star radiance accumulation",
    });
  }

  function renderTargetWidth(target: PatchRenderTarget): number {
    return target.width;
  }

  function renderTargetHeight(target: PatchRenderTarget): number {
    return target.height;
  }

  function targetPoolBucketForStorage(width: number, height: number): number {
    const targetSize = Math.max(width, height);
    for (const bucket of targetPoolBuckets) {
      if (bucket >= targetSize) return bucket;
    }
    return Math.min(maxTextureSize, targetSize);
  }

  function targetPoolKey(
    width: number,
    height: number,
    wrapS: THREE.Wrapping,
    wrapT: THREE.Wrapping,
    type: THREE.TextureDataType,
    colorSpace: THREE.ColorSpace,
  ): string {
    const bucket = targetPoolBucketForStorage(width, height);
    return `${bucket}:${Math.round(width)}x${Math.round(height)}:${wrapS}:${wrapT}:${textureTypeLabel(type)}:${colorSpace}`;
  }

  function patchTargetBytes(target: PatchRenderTarget): number {
    return estimateTextureBytes(
      renderTargetWidth(target),
      renderTargetHeight(target),
      target.starfieldPool?.bytesPerPixel ?? bytesPerPixelForType(target.texture.type),
    );
  }

  function createPatchRenderTarget(width: number, height: number, options: RenderTargetOptions = {}): PatchRenderTarget {
    const {
      name = "Baked skydome patch",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
      type = THREE.UnsignedByteType,
      colorSpace = THREE.SRGBColorSpace,
      bytesPerPixel = bytesPerPixelForType(type),
    } = options;
    const target = createRenderTarget(width, height, {
      name,
      wrapS,
      wrapT,
      type,
      colorSpace,
      bytesPerPixel,
    });
    const bucket = targetPoolBucketForStorage(width, height);
    target.starfieldPool = {
      bucket,
      key: targetPoolKey(width, height, wrapS, wrapT, type, colorSpace),
      inPool: false,
      bytesPerPixel,
      type,
      colorSpace,
    };
    return target;
  }

  function targetPoolListFor(key: string): PatchRenderTarget[] {
    if (!targetPools.has(key)) {
      targetPools.set(key, []);
    }
    return targetPools.get(key) ?? [];
  }

  function acquireTarget(width: number, height: number, options: RenderTargetOptions = {}): PatchRenderTarget {
    const {
      name = "Baked skydome patch",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
      type = THREE.UnsignedByteType,
      colorSpace = THREE.SRGBColorSpace,
      bytesPerPixel = bytesPerPixelForType(type),
    } = options;
    const key = targetPoolKey(width, height, wrapS, wrapT, type, colorSpace);
    const pool = targetPoolListFor(key);
    const target = pool.pop() ?? createPatchRenderTarget(width, height, { name, wrapS, wrapT, type, colorSpace, bytesPerPixel });

    target.texture.name = name;
    target.texture.wrapS = wrapS;
    target.texture.wrapT = wrapT;
    target.texture.colorSpace = colorSpace;
    target.starfieldPool = {
      ...target.starfieldPool,
      bucket: targetPoolBucketForStorage(width, height),
      key,
      inPool: false,
      bytesPerPixel,
      type,
      colorSpace,
    };
    activePatchTargets.add(target);
    return target;
  }

  function releaseTarget(target: PatchRenderTarget | null | undefined): void {
    if (!target || target.starfieldPool?.inPool) return;

    activePatchTargets.delete(target);
    const existingPool: PatchPoolState | undefined = target.starfieldPool;
    const textureType = existingPool?.type ?? target.texture.type;
    const textureColorSpace = (existingPool?.colorSpace ?? target.texture.colorSpace) as THREE.ColorSpace;
    const poolState = existingPool ?? {
      bucket: targetPoolBucketForStorage(renderTargetWidth(target), renderTargetHeight(target)),
      key: targetPoolKey(
        renderTargetWidth(target),
        renderTargetHeight(target),
        target.texture.wrapS,
        target.texture.wrapT,
        textureType,
        textureColorSpace,
      ),
      bytesPerPixel: bytesPerPixelForType(textureType),
      type: textureType,
      colorSpace: textureColorSpace,
      inPool: false,
    };
    target.starfieldPool = {
      ...poolState,
      inPool: true,
    };
    target.dispose();
  }

  function disposePatchTarget(target: PatchRenderTarget | null | undefined): void {
    if (!target) return;
    activePatchTargets.delete(target);
    target.dispose();
  }

  function disposeTargetPool(): void {
    targetPools.forEach((pool) => {
      pool.forEach((target) => target.dispose());
      pool.length = 0;
    });
    targetPools.clear();
  }

  function pooledTargets(): PatchRenderTarget[] {
    return [...targetPools.values()].flat();
  }

  function pooledTargetBytes(): number {
    return pooledTargets().reduce((bytes, target) => bytes + patchTargetBytes(target), 0);
  }

  function pooledTargetsByBucket(): BucketCounts {
    const buckets: BucketCounts = {};
    pooledTargets().forEach((target) => {
      const bucket = target.starfieldPool?.bucket
        ?? targetPoolBucketForStorage(renderTargetWidth(target), renderTargetHeight(target));
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    });
    return buckets;
  }

  function targetBucketSummary(buckets: BucketCounts): string {
    const entries = Object.entries(buckets)
      .sort(([a], [b]) => Number(a) - Number(b));
    return entries.length
      ? entries.map(([bucket, count]) => `${bucket}:${count}`).join(", ")
      : "none";
  }

  function activePatchTargetBytes(): number {
    return [...activePatchTargets].reduce((bytes, target) => bytes + patchTargetBytes(target), 0);
  }

  function trimTargetPoolToBudget(budgetBytes: number): void {
    let totalBytes = activePatchTargetBytes() + pooledTargetBytes();
    if (totalBytes <= budgetBytes) return;

    const pooled = pooledTargets()
      .sort((a, b) => patchTargetBytes(b) - patchTargetBytes(a));
    for (const target of pooled) {
      if (totalBytes <= budgetBytes) break;
      const key = target.starfieldPool?.key;
      const pool = key ? targetPools.get(key) : null;
      if (pool) {
        const index = pool.indexOf(target);
        if (index >= 0) pool.splice(index, 1);
      }
      totalBytes -= patchTargetBytes(target);
      target.dispose();
    }
  }

  function createFallbackPatchTexture(): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
    );
    texture.name = "Sparse fallback skydome patch";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  function getStats(): StarfieldStats {
    return {
      allocationCount,
      activePatchTargets: activePatchTargets.size,
      activeTargetCount: activePatchTargets.size,
      pooledTargetCount: pooledTargets().length,
      pooledTargetsByBucket: pooledTargetsByBucket(),
      pooledTargetSummary: targetBucketSummary(pooledTargetsByBucket()),
      activePatchTargetBytes: activePatchTargetBytes(),
      pooledTargetBytes: pooledTargetBytes(),
    };
  }

  return {
    maxTextureSize,
    floatBlendSupported,
    halfFloatRenderTargetSupported,
    halfFloatAccumulationSupported,
    accumulationType,
    backgroundTargetType,
    backgroundTargetTypeLabel: textureTypeLabel(backgroundTargetType),
    backgroundTargetBytesPerPixel,
    backgroundTargetColorSpace,
    backgroundHdrEnabled: backgroundTargetType === THREE.HalfFloatType,
    targetPoolBuckets,
    createRenderTarget,
    createAccumulationTarget,
    renderTargetWidth,
    renderTargetHeight,
    patchTargetBytes,
    acquireTarget,
    releaseTarget,
    disposePatchTarget,
    disposeTargetPool,
    pooledTargets,
    pooledTargetBytes,
    pooledTargetsByBucket,
    targetBucketSummary,
    trimTargetPoolToBudget,
    activePatchTargetBytes,
    createFallbackPatchTexture,
    get allocationCount() {
      return allocationCount;
    },
    get activePatchTargets() {
      return activePatchTargets;
    },
    getStats,
  };
}
