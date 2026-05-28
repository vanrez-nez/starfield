import * as THREE from "three";
import {
  BRIGHT_STAR_OVERLAY_STRENGTH,
  DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS,
  DEFAULT_SKY_BACKGROUND_RADIUS,
  sphereVerticalSegmentsFor,
} from "./constants.js";
import {
  createCatalogOverlayAndStats,
  createEmptyOverlayGeometry,
} from "./catalog.js";
import {
  createOverlayMaterial,
  createSkyBackgroundMaterial,
} from "./shaders.js";

export function createStarLayerManager({
  scene,
  overlayUniforms,
  requestRender,
  backgroundRadius = DEFAULT_SKY_BACKGROUND_RADIUS,
  overlayRadius = DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS,
  sphereSegments = 32,
}) {
  const layers = new Map();
  let currentSphereSegments = Number.isFinite(sphereSegments) ? sphereSegments : 32;
  let currentBackgroundRadius = Number.isFinite(backgroundRadius) ? backgroundRadius : DEFAULT_SKY_BACKGROUND_RADIUS;
  let currentOverlayRadius = Number.isFinite(overlayRadius) ? overlayRadius : DEFAULT_BRIGHT_STAR_OVERLAY_RADIUS;
  let backgroundLayerStats = {
    backgroundLayerEnabled: true,
    backgroundLayerDrawCalls: 1,
    backgroundLayerTriangles: 0,
    backgroundLayerRadius: currentBackgroundRadius,
  };
  let brightOverlayEnabled = false;
  let brightOverlayStats = {
    overlayEnabled: false,
    overlayStarCount: 0,
    overlayStarInstances: 0,
    overlayTriangleCount: 0,
    overlayDrawCalls: 0,
  };

  function triangleCountForGeometry(geometry) {
    if (geometry.index) return Math.round(geometry.index.count / 3);
    return Math.round((geometry.attributes.position?.count ?? 0) / 3);
  }

  function createBackgroundGeometry() {
    const horizontalSegments = Math.max(8, Math.round(currentSphereSegments));
    return new THREE.SphereGeometry(
      currentBackgroundRadius,
      horizontalSegments,
      sphereVerticalSegmentsFor(horizontalSegments),
    );
  }

  function syncBackgroundStats() {
    const visible = skyBackground.mesh.visible;
    backgroundLayerStats = {
      backgroundLayerEnabled: visible,
      backgroundLayerDrawCalls: visible ? 1 : 0,
      backgroundLayerTriangles: visible ? triangleCountForGeometry(skyBackground.geometry) : 0,
      backgroundLayerRadius: currentBackgroundRadius,
    };
  }

  const skyBackground = {
    id: "skyBackground",
    geometry: createBackgroundGeometry(),
    material: createSkyBackgroundMaterial(),
    mesh: null,
  };
  skyBackground.mesh = new THREE.Mesh(skyBackground.geometry, skyBackground.material);
  skyBackground.mesh.frustumCulled = false;
  skyBackground.mesh.renderOrder = -10;
  scene.add(skyBackground.mesh);
  layers.set(skyBackground.id, skyBackground);
  syncBackgroundStats();

  const brightOverlayUniforms = {
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
    uOverlayStrength: { value: BRIGHT_STAR_OVERLAY_STRENGTH },
  };
  const brightOverlay = {
    id: "brightOverlay",
    geometry: createEmptyOverlayGeometry(),
    material: createOverlayMaterial(brightOverlayUniforms),
    mesh: null,
  };
  brightOverlay.mesh = new THREE.Mesh(brightOverlay.geometry, brightOverlay.material);
  brightOverlay.mesh.frustumCulled = false;
  brightOverlay.mesh.renderOrder = 20;
  brightOverlay.mesh.visible = false;
  scene.add(brightOverlay.mesh);
  layers.set(brightOverlay.id, brightOverlay);

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

  function replaceBrightOverlayGeometry(nextGeometry) {
    brightOverlay.mesh.geometry = nextGeometry;
    brightOverlay.geometry.dispose();
    brightOverlay.geometry = nextGeometry;
  }

  function rebuild({ overlayUniforms: nextOverlayUniforms = overlayUniforms, enabled = brightOverlayEnabled } = {}) {
    brightOverlayEnabled = Boolean(enabled);
    const { overlayGeometry, classStats } = createCatalogOverlayAndStats({
      bakeUniforms: nextOverlayUniforms,
      brightStarOverlayEnabled: brightOverlayEnabled,
    });

    replaceBrightOverlayGeometry(overlayGeometry);
    brightOverlayStats = {
      ...classStats,
    };
    syncBrightOverlayVisibility();
    requestRender();

    return {
      classStats: {
        ...classStats,
        ...brightOverlayStats,
      },
    };
  }

  function setEnabled(enabled) {
    brightOverlayEnabled = Boolean(enabled);
    syncBrightOverlayVisibility();
    requestRender();
  }

  function setLayerEnabled(layerId, enabled) {
    if (layerId === "skyBackground") {
      skyBackground.mesh.visible = Boolean(enabled);
      syncBackgroundStats();
      requestRender();
      return;
    }

    if (layerId === "brightOverlay") {
      setEnabled(enabled);
    }
  }

  function setLayerRadius(layerId, value) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;

    if (layerId === "skyBackground") {
      currentBackgroundRadius = nextValue;
      const nextGeometry = createBackgroundGeometry();
      skyBackground.mesh.geometry = nextGeometry;
      skyBackground.geometry.dispose();
      skyBackground.geometry = nextGeometry;
      syncBackgroundStats();
      requestRender();
      return;
    }

    if (layerId === "brightOverlay") {
      currentOverlayRadius = nextValue;
      brightOverlayUniforms.uRadius.value = nextValue;
      syncBrightOverlayVisibility();
      requestRender();
    }
  }

  function setSphereSegments(value) {
    currentSphereSegments = Number.isFinite(value) ? value : currentSphereSegments;
    const nextGeometry = createBackgroundGeometry();
    skyBackground.mesh.geometry = nextGeometry;
    skyBackground.geometry.dispose();
    skyBackground.geometry = nextGeometry;
    syncBackgroundStats();
    requestRender();
  }

  function collectStats() {
    return {
      ...backgroundLayerStats,
      ...brightOverlayStats,
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
    setLayerRadius,
    setSphereSegments,
    collectStats,
    dispose,
  };
}
