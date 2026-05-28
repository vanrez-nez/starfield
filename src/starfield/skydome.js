import * as THREE from "three";
import {
  ALLOCATION_STATES,
  DOME_RADIUS,
  FALLBACK_STATES,
  PATCH_CROSSFADE_MS,
  PATCH_STATES,
  clamp,
  sphereVerticalSegmentsFor,
} from "./constants.js";
import { createPatchDomeMaterial } from "./shaders.js";

export function createSkydomeManager({
  scene,
  requestRender,
  targetManager,
  fallbackPatchTarget,
  getSphereSegments,
  onBlendStatsChange = () => {},
}) {
  const bakedDomeGroup = new THREE.Group();
  const activePatchBlends = new Set();
  scene.add(bakedDomeGroup);

  function createDomeGeometry() {
    const sphereSegments = getSphereSegments();
    return new THREE.SphereGeometry(
      DOME_RADIUS,
      sphereSegments,
      sphereVerticalSegmentsFor(sphereSegments),
    );
  }

  function visibleTargetForDescriptor(descriptor) {
    return descriptor.currentTarget ?? descriptor.target ?? fallbackPatchTarget;
  }

  function createPatchDomeMesh(descriptor) {
    const geometry = createDomeGeometry();
    const material = createPatchDomeMaterial({
      descriptor,
      visibleTarget: visibleTargetForDescriptor(descriptor),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.userData.patchDescriptorId = descriptor.id;
    descriptor.mesh = mesh;
    descriptor.material = material;
    return mesh;
  }

  function setDescriptorMaterialTextures(descriptor, currentTarget, nextTarget = currentTarget, blend = 0) {
    if (!descriptor.material || !currentTarget) return;
    descriptor.material.uniforms.uCurrentTexture.value = currentTarget.texture;
    descriptor.material.uniforms.uNextTexture.value = (nextTarget ?? currentTarget).texture;
    descriptor.material.uniforms.uBlend.value = blend;
  }

  function syncBlendStats() {
    onBlendStatsChange(activePatchBlends.size);
  }

  function bindDescriptorMaterialTarget(descriptor, target) {
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

  function bindDescriptorFallback(descriptor) {
    descriptor.currentTarget = null;
    descriptor.target = null;
    descriptor.nextTarget = null;
    descriptor.blendActive = false;
    descriptor.blendProgress = 0;
    descriptor.blendFromTarget = null;
    descriptor.blendToTarget = null;
    descriptor.fallbackState = FALLBACK_STATES.SPARSE;
    descriptor.allocationState = ALLOCATION_STATES.UNALLOCATED;
    descriptor.state = PATCH_STATES.EMPTY;
    activePatchBlends.delete(descriptor);
    setDescriptorMaterialTextures(descriptor, fallbackPatchTarget);
    syncBlendStats();
  }

  function finishDescriptorBlend(descriptor) {
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

  function startDescriptorBlend(descriptor, previousTarget, nextTarget) {
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

  function promoteDescriptorBakeTarget(descriptor, bakedTarget) {
    const previousTarget = descriptor.currentTarget;

    if (!previousTarget || previousTarget === bakedTarget) {
      bindDescriptorMaterialTarget(descriptor, bakedTarget);
      descriptor.fallbackState = FALLBACK_STATES.RESIDENT;
      descriptor.allocationState = ALLOCATION_STATES.ALLOCATED;
      return;
    }

    startDescriptorBlend(descriptor, previousTarget, bakedTarget);
  }

  function disposeBakedDomeMeshes() {
    while (bakedDomeGroup.children.length > 0) {
      const child = bakedDomeGroup.children[0];
      bakedDomeGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
  }

  function rebuildBakedDomeMeshes(descriptors) {
    disposeBakedDomeMeshes();
    descriptors.forEach((descriptor) => {
      bakedDomeGroup.add(createPatchDomeMesh(descriptor));
    });
  }

  function clearBlendForDescriptor(descriptor) {
    activePatchBlends.delete(descriptor);
    descriptor.blendActive = false;
    descriptor.blendProgress = 0;
    descriptor.blendFromTarget = null;
    descriptor.blendToTarget = null;
    descriptor.mesh = null;
    descriptor.material = null;
    syncBlendStats();
  }

  function advancePatchBlends() {
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

  function dispose() {
    disposeBakedDomeMeshes();
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
    bindDescriptorFallback,
    finishDescriptorBlend,
    startDescriptorBlend,
    promoteDescriptorBakeTarget,
    clearBlendForDescriptor,
    rebuildBakedDomeMeshes,
    disposeBakedDomeMeshes,
    advancePatchBlends,
    dispose,
    get activeBlendCount() {
      return activePatchBlends.size;
    },
  };
}
