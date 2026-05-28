import * as THREE from "three";
import {
  ALLOCATION_STATES,
  AUTO_PATCH_GRIDS,
  FALLBACK_STATES,
  FINAL_TEXTURE_BYTES_PER_PIXEL,
  MAX_AUTO_SUPERSAMPLE,
  PATCH_SIZE_ALIGNMENT,
  PATCH_CROSSFADE_MS,
  PATCH_GUARD_TEXELS,
  PATCH_STATES,
  REFERENCE_BAKE_WIDTH,
  STARFIELD_ALLOCATION_BUDGET_BYTES,
  VIRTUAL_WIDTH_OPTIONS,
  equirectDirectionFromUv,
  estimateTextureBytes,
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

export function createPatchLayoutForGrid({
  columns,
  rows = columns,
  contentWidth,
  contentHeight,
  guard = columns === 1 ? 0 : PATCH_GUARD_TEXELS,
  reason = "automatic",
  demand = null,
  supersample = 1,
  qualityScale = 1,
  idealVirtualWidth = contentWidth * columns,
  idealVirtualHeight = contentHeight * rows,
  idealPatchWidth = contentWidth,
  idealPatchHeight = contentHeight,
  allocation = null,
  targetTexelsPerPixel = 1,
}) {
  const safeColumns = Math.max(1, Math.round(columns));
  const safeRows = Math.max(1, Math.round(rows));
  const safeContentWidth = Math.max(1, Math.round(contentWidth));
  const safeContentHeight = Math.max(1, Math.round(contentHeight));
  const storageWidth = safeContentWidth + guard * 2;
  const storageHeight = safeContentHeight + guard * 2;

  return {
    virtualWidth: safeContentWidth * safeColumns,
    virtualHeight: safeContentHeight * safeRows,
    columns: safeColumns,
    rows: safeRows,
    guard,
    contentWidth: safeContentWidth,
    contentHeight: safeContentHeight,
    storageWidth,
    storageHeight,
    autoLayout: true,
    autoLayoutReason: reason,
    autoLayoutDemand: demand,
    supersample,
    qualityScale,
    idealVirtualWidth,
    idealVirtualHeight,
    effectiveVirtualWidth: safeContentWidth * safeColumns,
    effectiveVirtualHeight: safeContentHeight * safeRows,
    idealPatchWidth,
    idealPatchHeight,
    allocation,
    targetTexelsPerPixel,
  };
}

function accumulationBytesPerPixel(accumulationType) {
  return accumulationType === THREE.HalfFloatType ? 8 : 4;
}

function alignTexels(value, alignment = PATCH_SIZE_ALIGNMENT) {
  return Math.max(alignment, Math.ceil(Math.max(1, value) / alignment) * alignment);
}

function clampContentSize(value, maxContentSize) {
  return Math.max(1, Math.min(maxContentSize, alignTexels(value)));
}

function candidateMemory({
  storageWidth,
  storageHeight,
  patchCount,
  supersample,
  accumulationBytes,
  residentLayerCount = 1,
}) {
  const residentBytes = estimateTextureBytes(storageWidth, storageHeight, FINAL_TEXTURE_BYTES_PER_PIXEL) * patchCount * residentLayerCount;
  const scratchBytes = estimateTextureBytes(
    storageWidth * supersample,
    storageHeight * supersample,
    accumulationBytes,
  );
  return {
    residentBytes,
    scratchBytes,
    peakBytes: residentBytes + scratchBytes,
  };
}

function chooseSupersample({
  storageWidth,
  storageHeight,
  patchCount,
  budgetBytes,
  maxTextureSize,
  accumulationBytes,
  residentLayerCount = 1,
}) {
  const maxSupersample = Math.max(1, Math.min(
    MAX_AUTO_SUPERSAMPLE,
    Math.floor(maxTextureSize / Math.max(1, storageWidth)),
    Math.floor(maxTextureSize / Math.max(1, storageHeight)),
  ));

  for (let supersample = maxSupersample; supersample >= 1; supersample -= 1) {
    const memory = candidateMemory({
      storageWidth,
      storageHeight,
      patchCount,
      supersample,
      accumulationBytes,
      residentLayerCount,
    });
    if (memory.peakBytes <= budgetBytes || supersample === 1) {
      return {
        supersample,
        ...memory,
        peakBudgetRatio: memory.peakBytes / budgetBytes,
      };
    }
  }

  return {
    supersample: 1,
    ...candidateMemory({
      storageWidth,
      storageHeight,
      patchCount,
      supersample: 1,
      accumulationBytes,
      residentLayerCount,
    }),
    peakBudgetRatio: 1,
  };
}

function buildMemoryBoundCandidate({
  grid,
  idealVirtualWidth,
  idealVirtualHeight,
  maxTextureSize,
  budgetBytes,
  accumulationBytes,
  residentLayerCount = 1,
}) {
  const guard = grid === 1 ? 0 : PATCH_GUARD_TEXELS;
  const maxContentWidth = Math.max(1, maxTextureSize - guard * 2);
  const maxContentHeight = Math.max(1, maxTextureSize - guard * 2);
  const idealPatchWidth = Math.max(1, idealVirtualWidth / grid);
  const idealPatchHeight = Math.max(1, idealVirtualHeight / grid);
  const textureScale = Math.min(
    1,
    maxContentWidth / idealPatchWidth,
    maxContentHeight / idealPatchHeight,
  );
  const patchCount = grid * grid;
  let scale = Math.max(0.001, textureScale);
  let result = null;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const contentWidth = clampContentSize(idealPatchWidth * scale, maxContentWidth);
    const contentHeight = clampContentSize(idealPatchHeight * scale, maxContentHeight);
    const storageWidth = contentWidth + guard * 2;
    const storageHeight = contentHeight + guard * 2;
    const allocation = chooseSupersample({
      storageWidth,
      storageHeight,
      patchCount,
      budgetBytes,
      maxTextureSize,
      accumulationBytes,
      residentLayerCount,
    });
    result = {
      contentWidth,
      contentHeight,
      storageWidth,
      storageHeight,
      allocation,
      scale: Math.min(contentWidth / idealPatchWidth, contentHeight / idealPatchHeight, 1),
    };

    if (allocation.peakBytes <= budgetBytes) break;

    const nextScale = scale * Math.sqrt(budgetBytes / Math.max(allocation.peakBytes, 1)) * 0.96;
    if (Math.abs(nextScale - scale) < 0.001 || contentWidth <= PATCH_SIZE_ALIGNMENT || contentHeight <= PATCH_SIZE_ALIGNMENT) break;
    scale = Math.max(0.001, nextScale);
  }

  return {
    grid,
    guard,
    patchCount,
    idealPatchWidth,
    idealPatchHeight,
    ...result,
  };
}

export function createAutoPatchLayout({
  cameraInfo,
  maxTextureSize,
  accumulationType = THREE.UnsignedByteType,
  residentLayerCount = 1,
}) {
  const screenWidth = Math.max(1, Number(cameraInfo.screenWidth) || 1);
  const screenHeight = Math.max(1, Number(cameraInfo.screenHeight) || 1);
  const horizontalFovRad = THREE.MathUtils.degToRad(Math.max(Number(cameraInfo.horizontalFov) || 0, 0.001));
  const verticalFovRad = THREE.MathUtils.degToRad(Math.max(Number(cameraInfo.verticalFov) || 0, 0.001));
  const idealVirtualWidth = Math.max(1, screenWidth * ((Math.PI * 2) / horizontalFovRad));
  const idealVirtualHeight = Math.max(1, screenHeight * (Math.PI / verticalFovRad));
  const budgetBytes = STARFIELD_ALLOCATION_BUDGET_BYTES;
  const accumulationBytes = accumulationBytesPerPixel(accumulationType);
  const selectedGrid = AUTO_PATCH_GRIDS.find((grid) => {
    const guard = grid === 1 ? 0 : PATCH_GUARD_TEXELS;
    const maxContent = Math.max(1, maxTextureSize - guard * 2);
    return idealVirtualWidth / grid <= maxContent
      && idealVirtualHeight / grid <= maxContent;
  }) ?? AUTO_PATCH_GRIDS[AUTO_PATCH_GRIDS.length - 1];
  const candidate = buildMemoryBoundCandidate({
    grid: selectedGrid,
    idealVirtualWidth,
    idealVirtualHeight,
    maxTextureSize,
    budgetBytes,
    accumulationBytes,
    residentLayerCount,
  });
  const budgetExceeded = candidate.allocation.peakBytes > budgetBytes;

  return createPatchLayoutForGrid({
    columns: selectedGrid,
    contentWidth: candidate.contentWidth,
    contentHeight: candidate.contentHeight,
    guard: candidate.guard,
    reason: budgetExceeded
      ? "budget-minimum"
      : candidate.scale < 0.995
        ? "budget-scaled"
        : "screen-fit",
    supersample: candidate.allocation.supersample,
    qualityScale: candidate.scale,
    idealVirtualWidth,
    idealVirtualHeight,
    idealPatchWidth: candidate.idealPatchWidth,
    idealPatchHeight: candidate.idealPatchHeight,
    allocation: {
      budgetBytes,
      residentBytes: candidate.allocation.residentBytes,
      scratchBytes: candidate.allocation.scratchBytes,
      peakBytes: candidate.allocation.peakBytes,
      peakBudgetRatio: candidate.allocation.peakBudgetRatio,
      budgetExceeded,
    },
    targetTexelsPerPixel: 1,
    demand: {
      idealVirtualWidth,
      idealVirtualHeight,
      effectiveVirtualWidth: candidate.contentWidth * selectedGrid,
      effectiveVirtualHeight: candidate.contentHeight * selectedGrid,
      qualityScale: candidate.scale,
      budgetBytes,
      residentBytes: candidate.allocation.residentBytes,
      scratchBytes: candidate.allocation.scratchBytes,
      peakBytes: candidate.allocation.peakBytes,
      budgetExceeded,
    },
  });
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

export function autoSupersampleForStorage(width, height, maxTextureSize) {
  const widthLimit = Math.floor(maxTextureSize / Math.max(1, width));
  const heightLimit = Math.floor(maxTextureSize / Math.max(1, height));
  const textureLimit = Math.min(widthLimit, heightLimit);
  return Math.max(1, Math.min(MAX_AUTO_SUPERSAMPLE, textureLimit));
}

export function autoSupersampleForDescriptor(descriptor, maxTextureSize) {
  return autoSupersampleForStorage(
    descriptor.storageSize.width,
    descriptor.storageSize.height,
    maxTextureSize,
  );
}

export function autoSupersampleForDescriptors(descriptors, maxTextureSize) {
  if (descriptors.length === 0) return 1;
  return descriptors.reduce(
    (sample, descriptor) => Math.min(sample, autoSupersampleForDescriptor(descriptor, maxTextureSize)),
    MAX_AUTO_SUPERSAMPLE,
  );
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
    lastBakedLayerKey: "",
    lastBakedScreenSignature: null,
    lastBakedScreenSignatureKey: "",
    lastBakedTargetSize: null,
    lastBakedStorageSize: null,
    pendingLayerBakeKey: "",
    pendingScreenSignature: null,
    layerDirty: false,
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
