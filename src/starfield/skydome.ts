import * as THREE from "three/webgpu";
import {
  ALLOCATION_STATES,
  DOME_RADIUS,
  FALLBACK_STATES,
  PATCH_CROSSFADE_MS,
  clamp,
  sphereVerticalSegmentsFor,
} from "./constants";
import { createPatchDomeMaterial } from "./shaders";
import type {
  PatchDescriptor,
  PatchRenderTarget,
  RequestRender,
  Size2,
  StarfieldMaterial,
  VisiblePatchTarget,
} from "./types";

interface SkydomeManagerArgs {
  scene: THREE.Scene;
  requestRender: RequestRender;
  targetManager: {
    releaseTarget(target: PatchRenderTarget): void;
  };
  fallbackPatchTarget: VisiblePatchTarget;
  getSphereSegments: () => number;
  initialRadius?: number;
  createMaterial?: (args: { descriptor: PatchDescriptor; visibleTarget: VisiblePatchTarget }) => StarfieldMaterial;
  geometryUvRangeForDescriptor?: (descriptor: PatchDescriptor) => {
    uvMin: THREE.Vector2;
    uvSize: THREE.Vector2;
  };
  renderOrder?: number;
  fallbackDomeColor?: THREE.ColorRepresentation | null;
  onBlendStatsChange?: (activeBlendCount: number) => void;
}

export function createSkydomeManager({
  scene,
  requestRender,
  targetManager,
  fallbackPatchTarget,
  getSphereSegments,
  initialRadius = DOME_RADIUS,
  createMaterial = createPatchDomeMaterial,
  geometryUvRangeForDescriptor = (descriptor) => ({
    uvMin: descriptor.uvMin,
    uvSize: descriptor.uvSize,
  }),
  renderOrder = 0,
  fallbackDomeColor = null,
  onBlendStatsChange = () => {},
}: SkydomeManagerArgs) {
  const bakedDomeGroup = new THREE.Group();
  const activePatchBlends = new Set<PatchDescriptor>();
  let domeRadius = Number.isFinite(initialRadius) ? initialRadius : DOME_RADIUS;
  let fallbackDomeMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  scene.add(bakedDomeGroup);

  function createFallbackDomeMesh(): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null {
    if (fallbackDomeColor === null) return null;
    const sphereSegments = getSphereSegments();
    const geometry = new THREE.SphereGeometry(
      domeRadius * 1.0005,
      sphereSegments,
      sphereVerticalSegmentsFor(sphereSegments),
    );
    const material = new THREE.MeshBasicMaterial({
      color: fallbackDomeColor,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder - 1;
    return mesh;
  }

  function rebuildFallbackDomeMesh(): void {
    if (fallbackDomeMesh) {
      scene.remove(fallbackDomeMesh);
      fallbackDomeMesh.geometry.dispose();
      fallbackDomeMesh.material.dispose();
      fallbackDomeMesh = null;
    }

    fallbackDomeMesh = createFallbackDomeMesh();
    if (fallbackDomeMesh) {
      fallbackDomeMesh.visible = bakedDomeGroup.visible;
      scene.add(fallbackDomeMesh);
    }
  }

  rebuildFallbackDomeMesh();

  function createDomeGeometry(descriptor: PatchDescriptor): THREE.SphereGeometry {
    const sphereSegments = getSphereSegments();
    const sphereVerticalSegments = sphereVerticalSegmentsFor(sphereSegments);
    const geometryUvRange = geometryUvRangeForDescriptor(descriptor);
    const uvMin = geometryUvRange.uvMin ?? descriptor.uvMin;
    const uvSize = geometryUvRange.uvSize ?? descriptor.uvSize;
    const vStart = clamp(uvMin.y, 0, 1);
    const vEnd = clamp(uvMin.y + uvSize.y, 0, 1);
    const clampedVSize = Math.max(vEnd - vStart, 0.0001);
    const horizontalSegments = Math.max(3, Math.ceil(sphereSegments * Math.max(uvSize.x, 0.001)));
    const verticalSegments = Math.max(2, Math.ceil(sphereVerticalSegments * Math.max(clampedVSize, 0.001)));
    const phiStart = (uvMin.x - 0.25) * Math.PI * 2;
    const phiLength = uvSize.x * Math.PI * 2;
    const thetaStart = vStart * Math.PI;
    const thetaLength = clampedVSize * Math.PI;

    return new THREE.SphereGeometry(
      domeRadius,
      horizontalSegments,
      verticalSegments,
      phiStart,
      phiLength,
      thetaStart,
      thetaLength,
    );
  }

  function visibleTargetForDescriptor(descriptor: PatchDescriptor): VisiblePatchTarget {
    return descriptor.currentTarget ?? descriptor.target ?? fallbackPatchTarget;
  }

  function samplingForTarget(target: VisiblePatchTarget, descriptor: PatchDescriptor) {
    return target?.starfieldSampling ?? {
      innerOffset: descriptor.innerOffset,
      innerScale: descriptor.innerScale,
      storageUvMin: descriptor.storageUvMin,
      storageUvSize: descriptor.storageUvSize,
    };
  }

  function createPatchDomeMesh(descriptor: PatchDescriptor): THREE.Mesh<THREE.SphereGeometry, StarfieldMaterial> {
    const geometry = createDomeGeometry(descriptor);
    const material = createMaterial({
      descriptor,
      visibleTarget: visibleTargetForDescriptor(descriptor),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.userData.patchDescriptorId = descriptor.id;
    descriptor.mesh = mesh;
    descriptor.material = material;
    return mesh;
  }

  function setDescriptorMaterialTextures(
    descriptor: PatchDescriptor,
    currentTarget: VisiblePatchTarget | null,
    nextTarget: VisiblePatchTarget | null = currentTarget,
    blend = 0,
  ): void {
    if (!descriptor.material || !currentTarget) return;
    const uniforms = descriptor.material.uniforms as Record<string, { value: unknown }>;
    const currentSampling = samplingForTarget(currentTarget, descriptor);
    const nextSampling = samplingForTarget(nextTarget ?? currentTarget, descriptor);
    uniforms.uCurrentTexture.value = currentTarget.texture;
    uniforms.uNextTexture.value = (nextTarget ?? currentTarget).texture;
    (uniforms.uCurrentInnerOffset.value as THREE.Vector2).copy(currentSampling.innerOffset);
    (uniforms.uCurrentInnerScale.value as THREE.Vector2).copy(currentSampling.innerScale);
    (uniforms.uNextInnerOffset.value as THREE.Vector2).copy(nextSampling.innerOffset);
    (uniforms.uNextInnerScale.value as THREE.Vector2).copy(nextSampling.innerScale);
    if (uniforms.uCurrentStorageUvMin) {
      (uniforms.uCurrentStorageUvMin.value as THREE.Vector2).copy(currentSampling.storageUvMin);
      (uniforms.uCurrentStorageUvSize.value as THREE.Vector2).copy(currentSampling.storageUvSize);
      (uniforms.uNextStorageUvMin.value as THREE.Vector2).copy(nextSampling.storageUvMin);
      (uniforms.uNextStorageUvSize.value as THREE.Vector2).copy(nextSampling.storageUvSize);
    }
    uniforms.uBlend.value = blend;
  }

  function syncBlendStats(): void {
    onBlendStatsChange(activePatchBlends.size);
  }

  function bindDescriptorMaterialTarget(descriptor: PatchDescriptor, target: PatchRenderTarget | null): void {
    if (!target) return;
    descriptor.currentTarget = target;
    descriptor.target = target;
    descriptor.nextTarget = null;
    descriptor.blendActive = false;
    descriptor.blendProgress = 0;
    descriptor.blendFromTarget = null;
    descriptor.blendToTarget = null;
    activePatchBlends.delete(descriptor);
    setDescriptorMaterialTextures(descriptor, target);
    syncBlendStats();
  }

  function finishDescriptorBlend(descriptor: PatchDescriptor): void {
    const previousTarget = descriptor.blendFromTarget;
    const nextTarget = descriptor.blendToTarget ?? descriptor.nextTarget;

    if (!nextTarget) {
      descriptor.blendActive = false;
      descriptor.blendProgress = 0;
      activePatchBlends.delete(descriptor);
      syncBlendStats();
      return;
    }

    descriptor.currentTarget = nextTarget;
    descriptor.target = nextTarget;
    descriptor.nextTarget = null;
    descriptor.blendActive = false;
    descriptor.blendStartMs = 0;
    descriptor.blendProgress = 0;
    descriptor.blendFromTarget = null;
    descriptor.blendToTarget = null;
    descriptor.fallbackState = FALLBACK_STATES.RESIDENT;
    descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
    setDescriptorMaterialTextures(descriptor, nextTarget);
    activePatchBlends.delete(descriptor);
    syncBlendStats();

    if (previousTarget && previousTarget !== nextTarget) {
      targetManager.releaseTarget(previousTarget);
    }
  }

  function startDescriptorBlend(
    descriptor: PatchDescriptor,
    previousTarget: PatchRenderTarget,
    nextTarget: PatchRenderTarget,
  ): void {
    descriptor.currentTarget = previousTarget;
    descriptor.target = previousTarget;
    descriptor.nextTarget = nextTarget;
    descriptor.blendActive = true;
    descriptor.blendStartMs = performance.now();
    descriptor.blendDurationMs = PATCH_CROSSFADE_MS;
    descriptor.blendProgress = 0;
    descriptor.blendFromTarget = previousTarget;
    descriptor.blendToTarget = nextTarget;
    descriptor.fallbackState = FALLBACK_STATES.NEXT;
    descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
    setDescriptorMaterialTextures(descriptor, previousTarget, nextTarget, 0);
    activePatchBlends.add(descriptor);
    syncBlendStats();
    requestRender();
  }

  function promoteDescriptorBakeTarget(descriptor: PatchDescriptor, bakedTarget: PatchRenderTarget): void {
    const previousTarget = descriptor.currentTarget;

    if (!previousTarget || previousTarget === bakedTarget) {
      bindDescriptorMaterialTarget(descriptor, bakedTarget);
      descriptor.fallbackState = FALLBACK_STATES.RESIDENT;
      descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
      return;
    }

    startDescriptorBlend(descriptor, previousTarget, bakedTarget);
  }

  function disposeBakedDomeMeshes(): void {
    while (bakedDomeGroup.children.length > 0) {
      const child = bakedDomeGroup.children[0];
      bakedDomeGroup.remove(child);
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }

  function rebuildBakedDomeMeshes(descriptors: PatchDescriptor[]): void {
    disposeBakedDomeMeshes();
    rebuildFallbackDomeMesh();
    descriptors.forEach((descriptor) => {
      bakedDomeGroup.add(createPatchDomeMesh(descriptor));
    });
  }

  function setVisible(visible: boolean): void {
    bakedDomeGroup.visible = Boolean(visible);
    if (fallbackDomeMesh) {
      fallbackDomeMesh.visible = Boolean(visible);
    }
    requestRender();
  }

  function setRadius(value: number, descriptors: PatchDescriptor[] = []): void {
    const nextRadius = Number(value);
    if (!Number.isFinite(nextRadius) || nextRadius <= 0) return;
    domeRadius = nextRadius;
    rebuildBakedDomeMeshes(descriptors);
    requestRender();
  }

  function setMaterialUniformValue(key: string, value: unknown): void {
    bakedDomeGroup.children.forEach((child) => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, StarfieldMaterial>;
      const uniformValue = mesh.material?.uniforms?.[key];
      if (uniformValue) {
        uniformValue.value = value as never;
      }
    });
    requestRender();
  }

  function clearBlendForDescriptor(descriptor: PatchDescriptor): void {
    activePatchBlends.delete(descriptor);
    descriptor.blendActive = false;
    descriptor.blendProgress = 0;
    descriptor.blendFromTarget = null;
    descriptor.blendToTarget = null;
    descriptor.mesh = null;
    descriptor.material = null;
    syncBlendStats();
  }

  function advancePatchBlends(): boolean {
    if (activePatchBlends.size === 0) return false;

    const now = performance.now();
    const descriptors = [...activePatchBlends];
    descriptors.forEach((descriptor) => {
      if (!descriptor.blendActive || !descriptor.blendFromTarget || !descriptor.blendToTarget) {
        finishDescriptorBlend(descriptor);
        return;
      }

      const rawProgress = (now - descriptor.blendStartMs) / Math.max(descriptor.blendDurationMs, 1);
      const progress = clamp(rawProgress, 0, 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      descriptor.blendProgress = easedProgress;
      if (descriptor.material) {
        descriptor.material.uniforms.uBlend.value = easedProgress;
      }

      if (progress >= 1) {
        finishDescriptorBlend(descriptor);
      }
    });
    syncBlendStats();
    return activePatchBlends.size > 0;
  }

  function dispose(): void {
    disposeBakedDomeMeshes();
    if (fallbackDomeMesh) {
      scene.remove(fallbackDomeMesh);
      fallbackDomeMesh.geometry.dispose();
      fallbackDomeMesh.material.dispose();
      fallbackDomeMesh = null;
    }
    scene.remove(bakedDomeGroup);
    activePatchBlends.clear();
    syncBlendStats();
  }

  return {
    bakedDomeGroup,
    activePatchBlends,
    visibleTargetForDescriptor,
    setDescriptorMaterialTextures,
    bindDescriptorMaterialTarget,
    finishDescriptorBlend,
    startDescriptorBlend,
    promoteDescriptorBakeTarget,
    clearBlendForDescriptor,
    setVisible,
    setRadius,
    setMaterialUniformValue,
    rebuildBakedDomeMeshes,
    disposeBakedDomeMeshes,
    advancePatchBlends,
    dispose,
    get activeBlendCount() {
      return activePatchBlends.size;
    },
    get visible() {
      return bakedDomeGroup.visible;
    },
    get radius() {
      return domeRadius;
    },
  };
}
