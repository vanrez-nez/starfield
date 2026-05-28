import * as THREE from "three";
import {
  BASE_TARGET_POOL_BUCKETS,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  estimateTextureBytes,
} from "./constants.js";

export function createRenderTargetManager({ renderer }) {
  const gl = renderer.getContext();
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const floatBlendSupported = Boolean(renderer.extensions.get("EXT_float_blend"));
  const halfFloatAccumulationSupported = renderer.capabilities.isWebGL2
    ? Boolean(renderer.extensions.get("EXT_color_buffer_float")) && floatBlendSupported
    : Boolean(renderer.extensions.get("EXT_color_buffer_half_float")) && floatBlendSupported;
  const accumulationType = halfFloatAccumulationSupported ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const targetPoolBuckets = maxTextureSize >= 8192
    ? [...BASE_TARGET_POOL_BUCKETS, 8192]
    : BASE_TARGET_POOL_BUCKETS.filter((bucket) => bucket <= maxTextureSize);
  const targetPools = new Map();
  const activePatchTargets = new Set();
  let allocationCount = 0;

  function createRenderTarget(width, height, options = {}) {
    const {
      type = THREE.UnsignedByteType,
      colorSpace = THREE.SRGBColorSpace,
      name = "Baked equirectangular skydome starfield",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
    } = options;
    const target = new THREE.WebGLRenderTarget(width, height, {
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

    target.texture.name = name;
    target.texture.colorSpace = colorSpace;
    target.texture.generateMipmaps = false;
    allocationCount += 1;
    return target;
  }

  function createAccumulationTarget(width, height) {
    return createRenderTarget(width, height, {
      type: accumulationType,
      colorSpace: THREE.LinearSRGBColorSpace,
      name: "HDR star radiance accumulation",
    });
  }

  function renderTargetWidth(target) {
    return target.width ?? target.texture?.image?.width ?? 0;
  }

  function renderTargetHeight(target) {
    return target.height ?? target.texture?.image?.height ?? 0;
  }

  function targetPoolBucketForStorage(width, height) {
    const targetSize = Math.max(width, height);
    for (const bucket of targetPoolBuckets) {
      if (bucket >= targetSize) return bucket;
    }
    return Math.min(maxTextureSize, targetSize);
  }

  function targetPoolKey(width, height, wrapS, wrapT) {
    const bucket = targetPoolBucketForStorage(width, height);
    return `${bucket}:${Math.round(width)}x${Math.round(height)}:${wrapS}:${wrapT}`;
  }

  function patchTargetBytes(target) {
    return estimateTextureBytes(
      renderTargetWidth(target),
      renderTargetHeight(target),
      FINAL_TEXTURE_BYTES_PER_PIXEL,
    );
  }

  function createPatchRenderTarget(width, height, options = {}) {
    const {
      name = "Baked skydome patch",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
    } = options;
    const target = createRenderTarget(width, height, {
      name,
      wrapS,
      wrapT,
    });
    const bucket = targetPoolBucketForStorage(width, height);
    target.starfieldPool = {
      bucket,
      key: targetPoolKey(width, height, wrapS, wrapT),
      inPool: false,
      bytesPerPixel: FINAL_TEXTURE_BYTES_PER_PIXEL,
    };
    return target;
  }

  function targetPoolListFor(key) {
    if (!targetPools.has(key)) {
      targetPools.set(key, []);
    }
    return targetPools.get(key);
  }

  function acquireTarget(width, height, options = {}) {
    const {
      name = "Baked skydome patch",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
    } = options;
    const key = targetPoolKey(width, height, wrapS, wrapT);
    const pool = targetPoolListFor(key);
    const target = pool.pop() ?? createPatchRenderTarget(width, height, { name, wrapS, wrapT });

    target.texture.name = name;
    target.texture.wrapS = wrapS;
    target.texture.wrapT = wrapT;
    target.starfieldPool = {
      ...target.starfieldPool,
      bucket: targetPoolBucketForStorage(width, height),
      key,
      inPool: false,
      bytesPerPixel: FINAL_TEXTURE_BYTES_PER_PIXEL,
    };
    activePatchTargets.add(target);
    return target;
  }

  function releaseTarget(target) {
    if (!target || target.starfieldPool?.inPool) return;

    activePatchTargets.delete(target);
    target.starfieldPool = {
      ...target.starfieldPool,
      inPool: true,
    };
    target.dispose();
  }

  function disposePatchTarget(target) {
    if (!target) return;
    activePatchTargets.delete(target);
    target.dispose();
  }

  function disposeTargetPool() {
    targetPools.forEach((pool) => {
      pool.forEach((target) => target.dispose());
      pool.length = 0;
    });
    targetPools.clear();
  }

  function pooledTargets() {
    return [...targetPools.values()].flat();
  }

  function pooledTargetBytes() {
    return pooledTargets().reduce((bytes, target) => bytes + patchTargetBytes(target), 0);
  }

  function pooledTargetsByBucket() {
    const buckets = {};
    pooledTargets().forEach((target) => {
      const bucket = target.starfieldPool?.bucket
        ?? targetPoolBucketForStorage(renderTargetWidth(target), renderTargetHeight(target));
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    });
    return buckets;
  }

  function targetBucketSummary(buckets) {
    const entries = Object.entries(buckets)
      .sort(([a], [b]) => Number(a) - Number(b));
    return entries.length
      ? entries.map(([bucket, count]) => `${bucket}:${count}`).join(", ")
      : "none";
  }

  function activePatchTargetBytes() {
    return [...activePatchTargets].reduce((bytes, target) => bytes + patchTargetBytes(target), 0);
  }

  function trimTargetPoolToBudget(budgetBytes) {
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

  function createFallbackPatchTexture() {
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

  function getStats() {
    return {
      allocationCount,
      activePatchTargets,
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
    halfFloatAccumulationSupported,
    accumulationType,
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
