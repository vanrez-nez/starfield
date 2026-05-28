import * as THREE from "three";
import {
  ALLOCATION_STATES,
  FALLBACK_STATES,
  MAX_AUTO_SUPERSAMPLE,
  PATCH_CROSSFADE_MS,
  PATCH_GUARD_TEXELS,
  PATCH_STATES,
  REFERENCE_BAKE_WIDTH,
  VIRTUAL_WIDTH_OPTIONS,
  equirectDirectionFromUv,
} from "./constants.js";

export function basePatchGridFor(virtualWidth) {
  if (virtualWidth <= 4096) return 1;
  if (virtualWidth <= 8192) return 2;
  return 4;
}

export function createPatchLayout(virtualWidth, maxTextureSize) {
  const virtualHeight = virtualWidth / 2;
  let columns = basePatchGridFor(virtualWidth);
  let rows = columns;
  const guard = columns === 1 ? 0 : PATCH_GUARD_TEXELS;

  while (columns <= virtualWidth && rows <= virtualHeight) {
    const contentWidth = virtualWidth / columns;
    const contentHeight = virtualHeight / rows;
    const storageWidth = contentWidth + guard * 2;
    const storageHeight = contentHeight + guard * 2;

    if (storageWidth <= maxTextureSize && storageHeight <= maxTextureSize) {
      return {
        virtualWidth,
        virtualHeight,
        columns,
        rows,
        guard,
        contentWidth,
        contentHeight,
        storageWidth,
        storageHeight,
      };
    }

    columns *= 2;
    rows *= 2;
  }

  return null;
}

export function supportedBakeWidths(maxTextureSize) {
  return VIRTUAL_WIDTH_OPTIONS.filter((width) => createPatchLayout(width, maxTextureSize) !== null);
}

export function defaultBakeWidth(maxTextureSize) {
  const widths = supportedBakeWidths(maxTextureSize);
  if (widths.includes(REFERENCE_BAKE_WIDTH)) return REFERENCE_BAKE_WIDTH;
  return widths[widths.length - 1] || VIRTUAL_WIDTH_OPTIONS[0];
}

export function autoSupersampleForLayout(layout, maxTextureSize) {
  const widthLimit = Math.floor(maxTextureSize / layout.storageWidth);
  const heightLimit = Math.floor(maxTextureSize / layout.storageHeight);
  const textureLimit = Math.min(widthLimit, heightLimit);
  return Math.max(1, Math.min(MAX_AUTO_SUPERSAMPLE, textureLimit));
}

export function precisionWidthForLayout(layout, maxTextureSize) {
  return layout.storageWidth * autoSupersampleForLayout(layout, maxTextureSize);
}

export function precisionHeightForLayout(layout, maxTextureSize) {
  return layout.storageHeight * autoSupersampleForLayout(layout, maxTextureSize);
}

export function patchGridLabel(layout) {
  return `${layout.columns}x${layout.rows}`;
}

export function descriptorPrecisionWidth(descriptor, supersample) {
  return descriptor.storageSize.width * supersample;
}

export function descriptorPrecisionHeight(descriptor, supersample) {
  return descriptor.storageSize.height * supersample;
}

export function maxDescriptorStorageSize(descriptors) {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptor.storageSize.width),
    height: Math.max(size.height, descriptor.storageSize.height),
  }), { width: 1, height: 1 });
}

export function maxDescriptorPrecisionSize(descriptors, supersample) {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptorPrecisionWidth(descriptor, supersample)),
    height: Math.max(size.height, descriptorPrecisionHeight(descriptor, supersample)),
  }), { width: 1, height: 1 });
}

export function assignDescriptorStorage(descriptor, contentWidth, contentHeight, guard, maxTextureSize) {
  const assignedWidth = Math.min(maxTextureSize, Math.max(1, Math.round(contentWidth)));
  const assignedHeight = Math.min(maxTextureSize, Math.max(1, Math.round(contentHeight)));
  const storageWidth = Math.min(maxTextureSize, assignedWidth + guard * 2);
  const storageHeight = Math.min(maxTextureSize, assignedHeight + guard * 2);
  const guardX = Math.max(0, (storageWidth - assignedWidth) * 0.5);
  const guardY = Math.max(0, (storageHeight - assignedHeight) * 0.5);
  const guardUvX = descriptor.uvSize.x * (guardX / assignedWidth);
  const guardUvY = descriptor.uvSize.y * (guardY / assignedHeight);

  descriptor.assignedSize = {
    width: assignedWidth,
    height: assignedHeight,
    bucket: Math.max(assignedWidth, assignedHeight),
  };
  descriptor.currentSize = {
    ...descriptor.assignedSize,
  };
  descriptor.storageSize = {
    width: storageWidth,
    height: storageHeight,
  };
  descriptor.storageGuard = {
    x: guardX,
    y: guardY,
  };
  descriptor.storageUvMin = new THREE.Vector2(
    descriptor.uvMin.x - guardUvX,
    descriptor.uvMin.y - guardUvY,
  );
  descriptor.storageUvSize = new THREE.Vector2(
    descriptor.uvSize.x + guardUvX * 2,
    descriptor.uvSize.y + guardUvY * 2,
  );
  descriptor.innerOffset = new THREE.Vector2(
    guardX / storageWidth,
    guardY / storageHeight,
  );
  descriptor.innerScale = new THREE.Vector2(
    assignedWidth / storageWidth,
    assignedHeight / storageHeight,
  );
}

export function createPatchDescriptor(layout, x, y, maxTextureSize) {
  const uvMin = new THREE.Vector2(
    (x * layout.contentWidth) / layout.virtualWidth,
    (y * layout.contentHeight) / layout.virtualHeight,
  );
  const uvSize = new THREE.Vector2(
    layout.contentWidth / layout.virtualWidth,
    layout.contentHeight / layout.virtualHeight,
  );
  const angularWidthRad = (Math.PI * 2) / layout.columns;
  const angularHeightRad = Math.PI / layout.rows;
  const centerUv = new THREE.Vector2(uvMin.x + uvSize.x * 0.5, uvMin.y + uvSize.y * 0.5);
  const centerDirection = equirectDirectionFromUv(centerUv.x, centerUv.y);
  const descriptor = {
    id: `${layout.virtualWidth}x${layout.virtualHeight}:${x},${y}`,
    x,
    y,
    uvMin,
    uvSize,
    centerUv,
    centerDirection,
    logicalSize: {
      width: layout.contentWidth,
      height: layout.contentHeight,
    },
    storageUvMin: new THREE.Vector2(),
    storageUvSize: new THREE.Vector2(),
    innerOffset: new THREE.Vector2(),
    innerScale: new THREE.Vector2(1, 1),
    angularWidthRad,
    angularHeightRad,
    angularWidthDeg: THREE.MathUtils.radToDeg(angularWidthRad),
    angularHeightDeg: THREE.MathUtils.radToDeg(angularHeightRad),
    screenDemand: {
      projectedWidthPixels: 0,
      projectedHeightPixels: 0,
      projectedPixels: 0,
    },
    requiredSize: {
      width: layout.contentWidth,
      height: layout.contentHeight,
      bucket: Math.max(layout.contentWidth, layout.contentHeight),
    },
    currentSize: {
      width: layout.contentWidth,
      height: layout.contentHeight,
      bucket: Math.max(layout.contentWidth, layout.contentHeight),
    },
    targetSize: {
      width: layout.contentWidth,
      height: layout.contentHeight,
      bucket: Math.max(layout.contentWidth, layout.contentHeight),
    },
    requiredBucket: Math.max(layout.contentWidth, layout.contentHeight),
    targetBucket: Math.max(layout.contentWidth, layout.contentHeight),
    storageSize: {
      width: layout.storageWidth,
      height: layout.storageHeight,
    },
    storageGuard: {
      x: layout.guard,
      y: layout.guard,
    },
    priority: 0,
    priorityRank: 0,
    priorityProjectedPixels: 0,
    priorityCenterAngleRad: Math.PI,
    priorityCenterAngleDeg: 180,
    priorityCenterScore: 0,
    priorityCenterWeight: 1,
    priorityDensityImportance: 1,
    priorityStaleWeight: 1,
    priorityMemoryCost: 1,
    priorityMemoryCostBytes: 0,
    state: PATCH_STATES.EMPTY,
    target: null,
    currentTarget: null,
    nextTarget: null,
    mesh: null,
    material: null,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    fallbackState: FALLBACK_STATES.EMPTY,
    estimatedStarCount: 0,
    projectedPixels: 0,
    starsPerProjectedPixel: 0,
    densityScale: 1,
    densityFallback: false,
    brightStarCount: 0,
    brightStarPressure: 0,
    downgraded: false,
    sparseWanted: true,
    sparseVisible: true,
    sparseScore: 0,
    sparseEvicted: false,
    lastQueriedStarCount: 0,
    lastQueriedStarInstances: 0,
    lastQueriedCellCount: 0,
    lastBakeReason: "new",
    lastBakePriority: 0,
    lastBakeDurationMs: 0,
    blendActive: false,
    blendStartMs: 0,
    blendDurationMs: PATCH_CROSSFADE_MS,
    blendProgress: 0,
    blendFromTarget: null,
    blendToTarget: null,
    allocationState: ALLOCATION_STATES.UNALLOCATED,
  };

  assignDescriptorStorage(descriptor, layout.contentWidth, layout.contentHeight, layout.guard, maxTextureSize);
  return descriptor;
}

export function createPatchDescriptors(layout, maxTextureSize) {
  const descriptors = [];
  const horizontalWrap = layout.columns === 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;

  for (let y = 0; y < layout.rows; y += 1) {
    for (let x = 0; x < layout.columns; x += 1) {
      const descriptor = createPatchDescriptor(layout, x, y, maxTextureSize);
      descriptor.wrapS = horizontalWrap;
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}
