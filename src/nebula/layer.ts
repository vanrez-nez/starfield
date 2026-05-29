import * as THREE from "three/webgpu";
import {
  ALLOCATION_STATES,
  FALLBACK_STATES,
  PATCH_STATES,
} from "../starfield/constants";
import {
  assignDescriptorStorage,
  createPatchDescriptors as createPatchDescriptorList,
} from "../starfield/patch-layout";
import { createSkydomeManager } from "../starfield/skydome";
import {
  DEFAULT_FIELD_GRADIENT,
  DEFAULT_NEBULA_PARAMS,
  DEFAULT_NEBULA_RADIUS,
  MIN_NEBULA_SPHERE_SEGMENTS,
  cloneNebulaParams,
} from "./constants";
import { createNebulaBakePipeline } from "./bake-pipeline";
import {
  createLightCompositionBakeMaterial,
  createNebulaPatchDomeMaterial,
} from "./materials";
import { createNebulaUniforms } from "./uniforms";
import type {
  CreateNebulaLayerArgs,
  NebulaLayerApi,
  NebulaParams,
  PatchDescriptor,
  PatchLayout,
  PatchRenderTarget,
  PatchTextureTarget,
  StarfieldStats,
} from "./types";

function createFallbackBackgroundTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([8, 16, 44, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.name = "Fallback baked nebula patch";
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createNebulaLayer({
  renderer,
  scene,
  bakeCamera,
  requestRender,
  targetManager,
  initialLayout,
  stats,
  notifyReadouts,
  getSphereSegments,
}: CreateNebulaLayerArgs): NebulaLayerApi {
  const defaults = {
    enabled: true,
    radius: DEFAULT_NEBULA_RADIUS,
    params: cloneNebulaParams(DEFAULT_NEBULA_PARAMS),
  };
  const params = cloneNebulaParams(defaults.params);
  const uniforms = createNebulaUniforms(params, DEFAULT_FIELD_GRADIENT);
  const fallbackTexture = createFallbackBackgroundTexture();
  const fallbackTarget: PatchTextureTarget = { texture: fallbackTexture };
  const bakeMaterial = createLightCompositionBakeMaterial(uniforms);
  const bakeScene = new THREE.Scene();
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
  bakeQuad.frustumCulled = false;
  bakeScene.add(bakeQuad);

  let enabled = defaults.enabled;
  let radius = defaults.radius;
  let currentLayout = initialLayout;
  let descriptors = createNebulaPatchDescriptors(currentLayout);

  const skydome = createSkydomeManager({
    scene,
    requestRender,
    targetManager,
    fallbackPatchTarget: fallbackTarget,
    getSphereSegments: () => Math.max(getSphereSegments(), MIN_NEBULA_SPHERE_SEGMENTS),
    initialRadius: radius,
    createMaterial: (args) => createNebulaPatchDomeMaterial({
      ...args,
      nebulaExposure: uniforms.uNebulaExposure.value,
    }),
    renderOrder: -10,
    fallbackDomeColor: new THREE.Color(0.004, 0.005, 0.011),
    onBlendStatsChange: () => {
      syncStats();
    },
  });
  skydome.rebuildBakedDomeMeshes(descriptors);
  skydome.setVisible(enabled);

  const pipeline = createNebulaBakePipeline({
    renderer,
    bakeCamera,
    nebulaScene: bakeScene,
    nebulaUniforms: uniforms,
    skydome,
    stats,
    getPatchDescriptors: () => descriptors,
    targetForDescriptor,
    targetMatchesDescriptor,
    releaseTarget: targetManager.releaseTarget,
    descriptorById,
    targetBytes: targetManager.patchTargetBytes,
    notifyReadouts,
    requestRender,
    onBakeQueueDrained: () => {
      syncStats();
      notifyReadouts();
    },
  });

  function createNebulaPatchDescriptors(layout: PatchLayout): PatchDescriptor[] {
    const nextDescriptors = createPatchDescriptorList(layout, targetManager.maxTextureSize);
    nextDescriptors.forEach((descriptor) => {
      descriptor.backgroundDirty = true;
      descriptor.backgroundDirtyReason = "new";
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.UNALLOCATED;
    });
    return nextDescriptors;
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
    const assignedWidth = Math.min(targetManager.maxTextureSize, Math.max(1, Math.round(contentSize.width)));
    const assignedHeight = Math.min(targetManager.maxTextureSize, Math.max(1, Math.round(contentSize.height)));
    return {
      width: Math.min(targetManager.maxTextureSize, assignedWidth + currentLayout.guard * 2),
      height: Math.min(targetManager.maxTextureSize, assignedHeight + currentLayout.guard * 2),
    };
  }

  function applyDescriptorBakeStorage(descriptor: PatchDescriptor): void {
    const contentSize = plannedDescriptorContentSize(descriptor);
    assignDescriptorStorage(
      descriptor,
      contentSize.width,
      contentSize.height,
      currentLayout.guard,
      targetManager.maxTextureSize,
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

  function targetForDescriptor(descriptor: PatchDescriptor, name = "Baked nebula patch"): PatchRenderTarget {
    applyDescriptorBakeStorage(descriptor);
    const target = targetManager.acquireTarget(descriptor.storageSize.width, descriptor.storageSize.height, {
      name,
      wrapS: descriptor.wrapS,
      wrapT: descriptor.wrapT,
      type: targetManager.backgroundTargetType,
      colorSpace: targetManager.backgroundTargetColorSpace,
      bytesPerPixel: targetManager.backgroundTargetBytesPerPixel,
    });
    attachTargetSamplingMetadata(descriptor, target);
    return target;
  }

  function targetMatchesDescriptor(descriptor: PatchDescriptor, target: PatchRenderTarget): boolean {
    const storageSize = plannedDescriptorStorageSize(descriptor);
    return targetManager.renderTargetWidth(target) === storageSize.width
      && targetManager.renderTargetHeight(target) === storageSize.height;
  }

  function descriptorById(patchId: string): PatchDescriptor | undefined {
    return descriptors.find((descriptor) => descriptor.id === patchId);
  }

  function descriptorMeshTriangles(descriptor: PatchDescriptor): number {
    const geometry = descriptor.mesh?.geometry;
    if (!geometry) return 0;
    if (geometry.index) return Math.round(geometry.index.count / 3);
    return Math.round((geometry.attributes.position?.count ?? 0) / 3);
  }

  function disposeDescriptors(targetDescriptors: PatchDescriptor[]): void {
    targetDescriptors.forEach((descriptor) => {
      const targets = new Set<PatchRenderTarget>([
        descriptor.currentTarget,
        descriptor.nextTarget,
        descriptor.target,
        descriptor.blendFromTarget,
        descriptor.blendToTarget,
      ].filter((target): target is PatchRenderTarget => Boolean(target)));

      targets.forEach((target) => {
        targetManager.disposePatchTarget(target);
      });
      descriptor.target = null;
      descriptor.currentTarget = null;
      descriptor.nextTarget = null;
      descriptor.fallbackState = FALLBACK_STATES.EMPTY;
      descriptor.allocationState = ALLOCATION_STATES.UNALLOCATED;
      skydome.clearBlendForDescriptor(descriptor);
    });
  }

  function syncStats(): StarfieldStats {
    pipeline?.syncStats();
    stats.backgroundLayerEnabled = enabled;
    stats.backgroundLayerDrawCalls = enabled ? descriptors.length : 0;
    stats.backgroundLayerTriangles = enabled
      ? descriptors.reduce((total, descriptor) => total + descriptorMeshTriangles(descriptor), 0)
      : 0;
    stats.backgroundLayerRadius = radius;
    stats.backgroundSeed = uniforms.uSeed.value;
    stats.backgroundCoverage = uniforms.uCoverage.value;
    stats.backgroundDensity = uniforms.uDensity.value;
    stats.backgroundScale = uniforms.uBaseScale.value;
    stats.backgroundOpacity = uniforms.uOpacity.value;
    stats.backgroundNebulaStrength = uniforms.uNebulaStrength.value;
    stats.backgroundNebulaExposure = uniforms.uNebulaExposure.value;
    stats.backgroundLightIntensity = uniforms.uLightIntensity.value;
    stats.backgroundOctaves = uniforms.uOctaves.value;
    stats.backgroundTargetType = targetManager.backgroundTargetTypeLabel;
    stats.backgroundTargetColorSpace = targetManager.backgroundTargetColorSpace;
    stats.backgroundTargetBytesPerPixel = targetManager.backgroundTargetBytesPerPixel;
    stats.backgroundHdrEnabled = targetManager.backgroundHdrEnabled;
    stats.backgroundHdrFallback = !targetManager.backgroundHdrEnabled;
    stats.backgroundActiveBlendCount = skydome.activeBlendCount;
    return stats;
  }

  function setParam(key: string, value: number, delay = 180): boolean {
    const nextValue = Number(value);
    const uniformValue = uniforms[key];
    if (!Number.isFinite(nextValue) || !uniformValue) return false;
    params[key] = nextValue;
    uniformValue.value = nextValue as never;

    if (key === "uNebulaExposure") {
      skydome.setMaterialUniformValue("uNebulaExposure", nextValue);
      syncStats();
      notifyReadouts();
      requestRender();
      return true;
    }

    markStale("background");
    scheduleBake(delay);
    syncStats();
    notifyReadouts();
    requestRender();
    return true;
  }

  function getParam(key: string): number {
    const value = params[key];
    return typeof value === "number" ? value : 0;
  }

  function setEnabled(nextEnabled: boolean): void {
    enabled = Boolean(nextEnabled);
    skydome.setVisible(enabled);
    syncStats();
    notifyReadouts();
    requestRender();
  }

  function setRadius(value: number): void {
    const nextRadius = Number(value);
    if (!Number.isFinite(nextRadius) || nextRadius <= 0) return;
    radius = nextRadius;
    skydome.setRadius(nextRadius, descriptors);
    syncStats();
    notifyReadouts();
    requestRender();
  }

  function setLayout(layout: PatchLayout, { bake = true }: { bake?: boolean; reason?: string } = {}): void {
    const previousDescriptors = descriptors;
    pipeline.clearBakeQueue();
    currentLayout = layout;
    descriptors = createNebulaPatchDescriptors(currentLayout);
    skydome.disposeBakedDomeMeshes();
    disposeDescriptors(previousDescriptors);
    skydome.rebuildBakedDomeMeshes(descriptors);
    skydome.setVisible(enabled);
    syncStats();
    notifyReadouts();
    if (bake) {
      pipeline.bakeNow();
    }
  }

  function markStale(reason = "background"): void {
    pipeline.markPatchDescriptorsStale(reason);
    syncStats();
  }

  function bakeNow(): void {
    pipeline.bakeNow();
  }

  function scheduleBake(delay = 180): void {
    pipeline.scheduleBake(delay);
  }

  function clearBakeQueue(): void {
    pipeline.clearBakeQueue();
  }

  function recordRender(): boolean {
    if (skydome.activeBlendCount === 0) return false;
    const stillActive = skydome.advancePatchBlends();
    if (stillActive) requestRender();
    syncStats();
    return stillActive;
  }

  function dispose(): void {
    pipeline.clearBakeQueue();
    disposeDescriptors(descriptors);
    pipeline.dispose();
    skydome.dispose();
    fallbackTexture.dispose();
    bakeQuad.geometry.dispose();
    bakeMaterial.dispose();
  }

  syncStats();

  return {
    defaults,
    getParams: () => params,
    getParam,
    getUniforms: () => uniforms,
    getDescriptors: () => descriptors,
    setParam,
    setEnabled,
    getEnabled: () => enabled,
    setRadius,
    getRadius: () => radius,
    setLayout,
    markStale,
    bakeNow,
    scheduleBake,
    clearBakeQueue,
    recordRender,
    collectStats: syncStats,
    dispose,
    get activeBlendCount() {
      return skydome.activeBlendCount;
    },
  };
}
