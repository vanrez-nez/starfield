import * as THREE from "three/webgpu";
import { STARFIELD_CONFIG } from "../config";
import {
  BRIGHT_STAR_OVERLAY_STRENGTH,
  WINKLE_MAX_COUNT,
} from "./constants";
import {
  createCatalogOverlayAndStats,
  createEmptyOverlayGeometry,
  EMPTY_STAR_POSITIONS,
} from "./catalog";
import {
  createOverlayMaterial,
  createWinkleMaterial,
} from "./shaders";
import type {
  CatalogStar,
  OverlayUniforms,
  RequestRender,
  StarfieldMaterial,
  StarfieldStats,
  UniformMap,
} from "./types";

interface StarLayerManagerArgs {
  scene: THREE.Scene;
  overlayUniforms: OverlayUniforms;
  requestRender: RequestRender;
  overlayRadius?: number;
}

interface RuntimeStarLayer {
  id: string;
  geometry: THREE.InstancedBufferGeometry;
  material: StarfieldMaterial;
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, StarfieldMaterial>;
}

const OVERLAY_SHARED_UNIFORM_KEYS = [
  "uScreenPixelAngle",
  "uReferenceHeight",
  "uStarSize",
  "uSizeVar",
  "uLargeStarRarity",
  "uBright",
  "uBrightVar",
  "uGlareSize",
  "uGlareStr",
  "uGlareVar",
  "uColorVar",
  "uWinkleAmount",
  "uEffectMinSize",
  "uEffectMaxSize",
  "uWinkleSharpness",
  "uWinkleFlashiness",
  "uParallaxStrength",
  "uParallaxOffset",
];

function syncSharedOverlayUniformNodes(source: OverlayUniforms, converted: UniformMap): void {
  OVERLAY_SHARED_UNIFORM_KEYS.forEach((key) => {
    if (converted[key]) {
      source[key] = converted[key];
    }
  });
}

function createWinkleGeometry(stars: CatalogStar[] = []): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const count = Math.min(WINKLE_MAX_COUNT, stars.length);
  const directions = new Float32Array(count * 3);
  const randoms = new Float32Array(count * 4);
  const sizeGates = new Float32Array(count);
  const classes = new Float32Array(count);
  const winkles = new Float32Array(count * 4);

  for (let index = 0; index < count; index += 1) {
    const star = stars[index];
    directions.set([star.x, star.y, star.z], index * 3);
    randoms.set([star.rSize, star.rBright, star.rGlare, star.rColor], index * 4);
    sizeGates[index] = star.rSizeGate;
    classes[index] = star.classId;
    winkles.set([
      star.rWinkleRotation * Math.PI * 2,
      star.rWinklePhase * 97,
      0.45 + star.rWinkleSpeed * 1.35,
      star.importance,
    ], index * 4);
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(EMPTY_STAR_POSITIONS, 3));
  geometry.setAttribute("iDirection", new THREE.InstancedBufferAttribute(directions, 3));
  geometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(randoms, 4));
  geometry.setAttribute("iSizeGate", new THREE.InstancedBufferAttribute(sizeGates, 1));
  geometry.setAttribute("iClass", new THREE.InstancedBufferAttribute(classes, 1));
  geometry.setAttribute("iWinkle", new THREE.InstancedBufferAttribute(winkles, 4));
  geometry.instanceCount = 0;
  geometry.userData.availableInstanceCount = count;
  return geometry;
}

export function createStarLayerManager({
  scene,
  overlayUniforms,
  requestRender,
  overlayRadius = STARFIELD_CONFIG.overlay.radius,
}: StarLayerManagerArgs) {
  const layers = new Map<string, RuntimeStarLayer>();
  let currentOverlayRadius = Number.isFinite(overlayRadius) ? overlayRadius : STARFIELD_CONFIG.overlay.radius;
  let brightOverlayEnabled = false;
  let brightOverlayStats: StarfieldStats = {
    overlayEnabled: false,
    overlayStarCount: 0,
    overlayStarInstances: 0,
    overlayTriangleCount: 0,
    overlayDrawCalls: 0,
  };
  let currentWinkleAmount = THREE.MathUtils.clamp(
    overlayUniforms.uWinkleAmount?.value ?? STARFIELD_CONFIG.overlay.params.uWinkleAmount,
    0,
    1,
  );
  let winkleStats: StarfieldStats = {
    winkleAmount: currentWinkleAmount,
    winkleMaxCount: WINKLE_MAX_COUNT,
    winkleActiveCount: 0,
    winkleDrawCalls: 0,
    winkleTriangles: 0,
  };

  const brightOverlayUniforms: UniformMap = {
    uRadius: { value: currentOverlayRadius },
    uScreenPixelAngle: overlayUniforms.uScreenPixelAngle,
    uReferenceHeight: overlayUniforms.uReferenceHeight,
    uStarSize: overlayUniforms.uStarSize,
    uSizeVar: overlayUniforms.uSizeVar,
    uLargeStarRarity: overlayUniforms.uLargeStarRarity,
    uBright: overlayUniforms.uBright,
    uBrightVar: overlayUniforms.uBrightVar,
    uGlareSize: overlayUniforms.uGlareSize,
    uGlareStr: overlayUniforms.uGlareStr,
    uGlareVar: overlayUniforms.uGlareVar,
    uColorVar: overlayUniforms.uColorVar,
    uTime: { value: 0 },
    uWinkleAmount: overlayUniforms.uWinkleAmount,
    uWinkleFlashiness: overlayUniforms.uWinkleFlashiness,
    uEffectMinSize: overlayUniforms.uEffectMinSize,
    uEffectMaxSize: overlayUniforms.uEffectMaxSize,
    uOverlayStrength: { value: BRIGHT_STAR_OVERLAY_STRENGTH },
    uParallaxStrength: overlayUniforms.uParallaxStrength,
    uParallaxOffset: overlayUniforms.uParallaxOffset,
  };
  const brightOverlayGeometry = createEmptyOverlayGeometry();
  const brightOverlayMaterial = createOverlayMaterial(brightOverlayUniforms);
  syncSharedOverlayUniformNodes(overlayUniforms, brightOverlayUniforms);
  const brightOverlay: RuntimeStarLayer = {
    id: "brightOverlay",
    geometry: brightOverlayGeometry,
    material: brightOverlayMaterial,
    mesh: new THREE.Mesh<THREE.InstancedBufferGeometry, StarfieldMaterial>(
      brightOverlayGeometry,
      brightOverlayMaterial,
    ),
  };
  brightOverlay.mesh.frustumCulled = false;
  brightOverlay.mesh.renderOrder = 20;
  brightOverlay.mesh.visible = false;
  scene.add(brightOverlay.mesh);
  layers.set(brightOverlay.id, brightOverlay);

  const winkleUniforms: UniformMap = {
    uRadius: { value: currentOverlayRadius },
    uScreenPixelAngle: overlayUniforms.uScreenPixelAngle,
    uStarSize: overlayUniforms.uStarSize,
    uSizeVar: overlayUniforms.uSizeVar,
    uLargeStarRarity: overlayUniforms.uLargeStarRarity,
    uBright: overlayUniforms.uBright,
    uBrightVar: overlayUniforms.uBrightVar,
    uGlareSize: overlayUniforms.uGlareSize,
    uGlareStr: overlayUniforms.uGlareStr,
    uGlareVar: overlayUniforms.uGlareVar,
    uColorVar: overlayUniforms.uColorVar,
    uEffectMinSize: overlayUniforms.uEffectMinSize,
    uEffectMaxSize: overlayUniforms.uEffectMaxSize,
    uWinkleSharpness: overlayUniforms.uWinkleSharpness,
    uWinkleFlashiness: overlayUniforms.uWinkleFlashiness,
    uTime: { value: 0 },
    uWinkleAmount: overlayUniforms.uWinkleAmount ?? { value: currentWinkleAmount },
    uParallaxStrength: overlayUniforms.uParallaxStrength,
    uParallaxOffset: overlayUniforms.uParallaxOffset,
  };
  const winkleOverlayGeometry = createWinkleGeometry();
  const winkleOverlayMaterial = createWinkleMaterial(winkleUniforms);
  syncSharedOverlayUniformNodes(overlayUniforms, winkleUniforms);
  const winkleOverlay: RuntimeStarLayer = {
    id: "winkleOverlay",
    geometry: winkleOverlayGeometry,
    material: winkleOverlayMaterial,
    mesh: new THREE.Mesh<THREE.InstancedBufferGeometry, StarfieldMaterial>(
      winkleOverlayGeometry,
      winkleOverlayMaterial,
    ),
  };
  winkleOverlay.mesh.frustumCulled = false;
  winkleOverlay.mesh.renderOrder = 21;
  winkleOverlay.mesh.visible = false;
  scene.add(winkleOverlay.mesh);
  layers.set(winkleOverlay.id, winkleOverlay);

  function syncBrightOverlayVisibility() {
    const overlayCount = brightOverlay.geometry.instanceCount ?? 0;
    brightOverlay.mesh.visible = brightOverlayEnabled && overlayCount > 0;
    brightOverlayStats = {
      ...brightOverlayStats,
      overlayEnabled: brightOverlayEnabled,
      overlayStarCount: overlayCount,
      overlayStarInstances: overlayCount,
      overlayTriangleCount: overlayCount * 2,
      overlayDrawCalls: brightOverlay.mesh.visible ? 1 : 0,
      overlayRadius: currentOverlayRadius,
    };
  }

  function syncWinkleVisibility() {
    const availableCount = Math.min(
      WINKLE_MAX_COUNT,
      winkleOverlay.geometry.userData.availableInstanceCount ?? winkleOverlay.geometry.instanceCount ?? 0,
    );
    const requestedCount = Math.floor(WINKLE_MAX_COUNT * currentWinkleAmount);
    const activeCount = brightOverlayEnabled
      ? Math.min(availableCount, requestedCount)
      : 0;

    winkleOverlay.geometry.instanceCount = activeCount;
    winkleOverlay.mesh.visible = brightOverlayEnabled && currentWinkleAmount > 0 && activeCount > 0;
    winkleStats = {
      winkleAmount: currentWinkleAmount,
      effectMinSize: overlayUniforms.uEffectMinSize?.value ?? 0,
      effectMaxSize: overlayUniforms.uEffectMaxSize?.value ?? 0,
      winkleSharpness: overlayUniforms.uWinkleSharpness?.value ?? 0,
      winkleFlashiness: overlayUniforms.uWinkleFlashiness?.value ?? 0,
      winkleMaxCount: WINKLE_MAX_COUNT,
      winkleActiveCount: activeCount,
      winkleDrawCalls: winkleOverlay.mesh.visible ? 1 : 0,
      winkleTriangles: activeCount * 2,
    };
  }

  function replaceBrightOverlayGeometry(nextGeometry: THREE.InstancedBufferGeometry): void {
    brightOverlay.mesh.geometry = nextGeometry;
    brightOverlay.geometry.dispose();
    brightOverlay.geometry = nextGeometry;
  }

  function replaceWinkleGeometry(nextGeometry: THREE.InstancedBufferGeometry): void {
    winkleOverlay.mesh.geometry = nextGeometry;
    winkleOverlay.geometry.dispose();
    winkleOverlay.geometry = nextGeometry;
  }

  function rebuild({
    overlayUniforms: nextOverlayUniforms = overlayUniforms,
    enabled = brightOverlayEnabled,
  }: {
    overlayUniforms?: OverlayUniforms;
    enabled?: boolean;
  } = {}) {
    brightOverlayEnabled = Boolean(enabled);
    const { overlayGeometry, overlayStars, classStats } = createCatalogOverlayAndStats({
      bakeUniforms: nextOverlayUniforms,
      brightStarOverlayEnabled: brightOverlayEnabled,
    });

    replaceBrightOverlayGeometry(overlayGeometry);
    replaceWinkleGeometry(createWinkleGeometry(overlayStars));
    brightOverlayStats = {
      ...classStats,
    };
    syncBrightOverlayVisibility();
    syncWinkleVisibility();
    requestRender();

    return {
      classStats: {
        ...classStats,
        ...brightOverlayStats,
      },
    };
  }

  function setEnabled(enabled: boolean): void {
    brightOverlayEnabled = Boolean(enabled);
    syncBrightOverlayVisibility();
    syncWinkleVisibility();
    requestRender();
  }

  function setLayerEnabled(layerId: string, enabled: boolean): void {
    if (layerId === "brightOverlay") {
      setEnabled(enabled);
    }
  }

  function refreshBackgroundStats(): void {
  }

  function setWinkleAmount(value: number): void {
    currentWinkleAmount = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
    winkleUniforms.uWinkleAmount.value = currentWinkleAmount;
    syncWinkleVisibility();
    requestRender();
  }

  function advanceRuntime(): boolean {
    const flashiness = overlayUniforms.uWinkleFlashiness?.value ?? 0;
    const effectsActive = brightOverlayEnabled && currentWinkleAmount > 0 && (winkleOverlay.mesh.visible || flashiness > 0);
    if (!effectsActive) return false;
    const time = performance.now() * 0.001;
    brightOverlayUniforms.uTime.value = time;
    winkleUniforms.uTime.value = time;
    return true;
  }

  function collectStats(): StarfieldStats {
    return {
      ...brightOverlayStats,
      ...winkleStats,
      effectMinSize: overlayUniforms.uEffectMinSize?.value ?? 0,
      effectMaxSize: overlayUniforms.uEffectMaxSize?.value ?? 0,
      winkleSharpness: overlayUniforms.uWinkleSharpness?.value ?? 0,
      winkleFlashiness: overlayUniforms.uWinkleFlashiness?.value ?? 0,
    };
  }

  function dispose() {
    layers.forEach((layer) => {
      scene.remove(layer.mesh);
      layer.geometry.dispose();
      layer.material.dispose();
    });
    layers.clear();
  }

  return {
    rebuild,
    setEnabled,
    setLayerEnabled,
    refreshBackgroundStats,
    setWinkleAmount,
    advanceRuntime,
    collectStats,
    dispose,
  };
}
