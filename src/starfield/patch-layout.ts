import * as THREE from "three/webgpu";
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
  STARFIELD_ALLOCATION_BUDGET_BYTES,
  equirectDirectionFromUv,
  estimateTextureBytes,
} from "./constants";
import type {
  BakeCoverage,
  CameraInfo,
  PatchAllocation,
  PatchDescriptor,
  PatchLayout,
  Size2,
} from "./types";

interface CreatePatchLayoutForGridArgs {
  columns: number;
  contentWidth: number;
  contentHeight: number;
  guard?: number;
  reason?: string;
  demand?: PatchLayout["demand"];
  supersample?: number;
  qualityScale?: number;
  idealVirtualWidth?: number;
  idealVirtualHeight?: number;
  idealPatchWidth?: number;
  idealPatchHeight?: number;
  allocation?: PatchAllocation | null;
  targetTexelsPerPixel?: number;
  coverage?: BakeCoverage;
}

interface CandidateMemoryArgs {
  storageWidth: number;
  storageHeight: number;
  patchCount: number;
  supersample: number;
  accumulationBytes: number;
  residentBytesPerPixel?: number;
}

type CandidateMemoryBaseArgs = Omit<CandidateMemoryArgs, "supersample">;

interface SupersampleChoice {
  supersample: number;
  residentBytes: number;
  scratchBytes: number;
  peakBytes: number;
  peakBudgetRatio: number;
}

interface MemoryBoundCandidateArgs {
  grid: number;
  idealVirtualWidth: number;
  idealVirtualHeight: number;
  maxTextureSize: number;
  budgetBytes: number;
  accumulationBytes: number;
  residentBytesPerPixel?: number;
  coverage?: BakeCoverage;
  maxQualityScale?: number;
}

interface MemoryBoundCandidate {
  grid: number;
  guard: number;
  patchCount: number;
  idealPatchWidth: number;
  idealPatchHeight: number;
  coverage: NormalizedCoverage;
  contentWidth: number;
  contentHeight: number;
  storageWidth: number;
  storageHeight: number;
  allocation: SupersampleChoice;
  scale: number;
}

interface NormalizedCoverage {
  config: BakeCoverage;
  uvMin: THREE.Vector2;
  uvSize: THREE.Vector2;
  fraction: number;
  azimuthSpanRad: number;
  altitudeSpanRad: number;
  wrapsHorizontally: boolean;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeBakeCoverageConfig(coverage?: Partial<BakeCoverage>): BakeCoverage {
  const azimuthCenterDeg = Number(coverage?.azimuthCenterDeg) || 0;
  const azimuthSpanDeg = clampNumber(Number(coverage?.azimuthSpanDeg) || 360, 1, 360);
  const altitudeSpanDeg = clampNumber(Number(coverage?.altitudeSpanDeg) || 180, 1, 180);
  const altitudeCenterLimit = Math.max(0, 90 - altitudeSpanDeg * 0.5);
  const altitudeCenterDeg = clampNumber(Number(coverage?.altitudeCenterDeg) || 0, -altitudeCenterLimit, altitudeCenterLimit);
  return {
    azimuthCenterDeg,
    altitudeCenterDeg,
    azimuthSpanDeg,
    altitudeSpanDeg,
  };
}

function normalizeCoverage(coverage?: Partial<BakeCoverage>): NormalizedCoverage {
  const config = normalizeBakeCoverageConfig(coverage);
  const altitudeMax = config.altitudeCenterDeg + config.altitudeSpanDeg * 0.5;
  const altitudeMin = config.altitudeCenterDeg - config.altitudeSpanDeg * 0.5;
  const wrapsHorizontally = config.azimuthSpanDeg >= 359.999;
  const uMin = wrapsHorizontally
    ? 0
    : 0.5 + (config.azimuthCenterDeg - config.azimuthSpanDeg * 0.5) / 360;
  const uSize = wrapsHorizontally ? 1 : config.azimuthSpanDeg / 360;
  const vMin = (90 - altitudeMax) / 180;
  const vSize = config.altitudeSpanDeg / 180;

  return {
    config,
    uvMin: new THREE.Vector2(uMin, vMin),
    uvSize: new THREE.Vector2(uSize, vSize),
    fraction: Math.max(0.0001, uSize * vSize),
    azimuthSpanRad: uSize * Math.PI * 2,
    altitudeSpanRad: vSize * Math.PI,
    wrapsHorizontally,
  };
}

function createPatchLayoutForGrid({
  columns,
  contentWidth,
  contentHeight,
  guard = columns === 1 ? 0 : PATCH_GUARD_TEXELS,
  reason = "automatic",
  demand = null,
  supersample = 1,
  qualityScale = 1,
  idealVirtualWidth = contentWidth * columns,
  idealVirtualHeight = contentHeight * columns,
  idealPatchWidth = contentWidth,
  idealPatchHeight = contentHeight,
  allocation = null,
  targetTexelsPerPixel = 1,
  coverage,
}: CreatePatchLayoutForGridArgs): PatchLayout {
  const safeColumns = Math.max(1, Math.round(columns));
  const safeRows = safeColumns;
  const safeContentWidth = Math.max(1, Math.round(contentWidth));
  const safeContentHeight = Math.max(1, Math.round(contentHeight));
  const storageWidth = safeContentWidth + guard * 2;
  const storageHeight = safeContentHeight + guard * 2;
  const normalizedCoverage = normalizeCoverage(coverage);

  return {
    virtualWidth: safeContentWidth * safeColumns,
    virtualHeight: safeContentHeight * safeRows,
    columns: safeColumns,
    rows: safeRows,
    patchCount: safeColumns * safeRows,
    guard,
    contentWidth: safeContentWidth,
    contentHeight: safeContentHeight,
    storageWidth,
    storageHeight,
    coverage: normalizedCoverage.config,
    coverageUvMin: normalizedCoverage.uvMin,
    coverageUvSize: normalizedCoverage.uvSize,
    coverageFraction: normalizedCoverage.fraction,
    wrapsHorizontally: normalizedCoverage.wrapsHorizontally,
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
    demand,
  };
}

function accumulationBytesPerPixel(accumulationType: THREE.TextureDataType): number {
  return accumulationType === THREE.HalfFloatType ? 8 : 4;
}

function alignTexels(value: number, alignment = PATCH_SIZE_ALIGNMENT): number {
  return Math.max(alignment, Math.ceil(Math.max(1, value) / alignment) * alignment);
}

function clampContentSize(value: number, maxContentSize: number): number {
  return Math.max(1, Math.min(maxContentSize, alignTexels(value)));
}

function candidateMemory({
  storageWidth,
  storageHeight,
  patchCount,
  supersample,
  accumulationBytes,
  residentBytesPerPixel = FINAL_TEXTURE_BYTES_PER_PIXEL,
}: CandidateMemoryArgs): Omit<SupersampleChoice, "supersample" | "peakBudgetRatio"> {
  const residentBytes = estimateTextureBytes(storageWidth, storageHeight, residentBytesPerPixel) * patchCount;
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
  residentBytesPerPixel = FINAL_TEXTURE_BYTES_PER_PIXEL,
}: CandidateMemoryBaseArgs & { budgetBytes: number; maxTextureSize: number }): SupersampleChoice {
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
      residentBytesPerPixel,
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
      residentBytesPerPixel,
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
  residentBytesPerPixel = FINAL_TEXTURE_BYTES_PER_PIXEL,
  coverage,
  maxQualityScale = 1,
}: MemoryBoundCandidateArgs): MemoryBoundCandidate {
  const normalizedCoverage = normalizeCoverage(coverage);
  const guard = grid === 1 ? 0 : PATCH_GUARD_TEXELS;
  const maxContentWidth = Math.max(1, maxTextureSize - guard * 2);
  const maxContentHeight = Math.max(1, maxTextureSize - guard * 2);
  const idealPatchWidth = Math.max(1, idealVirtualWidth / grid);
  const idealPatchHeight = Math.max(1, idealVirtualHeight / grid);
  const textureScale = Math.min(
    1,
    Math.max(0.001, maxQualityScale),
    maxContentWidth / idealPatchWidth,
    maxContentHeight / idealPatchHeight,
  );
  const patchCount = grid * grid;
  let scale = Math.max(0.001, textureScale);
  let result: Omit<MemoryBoundCandidate, "grid" | "guard" | "patchCount" | "idealPatchWidth" | "idealPatchHeight" | "coverage"> | null = null;

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
      residentBytesPerPixel,
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

  if (!result) {
    result = {
      contentWidth: clampContentSize(idealPatchWidth * scale, maxContentWidth),
      contentHeight: clampContentSize(idealPatchHeight * scale, maxContentHeight),
      storageWidth: clampContentSize(idealPatchWidth * scale, maxContentWidth) + guard * 2,
      storageHeight: clampContentSize(idealPatchHeight * scale, maxContentHeight) + guard * 2,
      allocation: chooseSupersample({
        storageWidth: clampContentSize(idealPatchWidth * scale, maxContentWidth) + guard * 2,
        storageHeight: clampContentSize(idealPatchHeight * scale, maxContentHeight) + guard * 2,
        patchCount,
        budgetBytes,
        maxTextureSize,
        accumulationBytes,
        residentBytesPerPixel,
      }),
      scale,
    };
  }

  return {
    grid,
    guard,
    patchCount,
    idealPatchWidth,
    idealPatchHeight,
    coverage: normalizedCoverage,
    ...result,
  };
}

export function createAutoPatchLayout({
  cameraInfo,
  maxTextureSize,
  accumulationType = THREE.UnsignedByteType,
  residentLayerCount = 1,
  residentBytesPerPixel = FINAL_TEXTURE_BYTES_PER_PIXEL * residentLayerCount,
  coverage,
}: {
  cameraInfo: CameraInfo;
  maxTextureSize: number;
  accumulationType?: THREE.TextureDataType;
  residentLayerCount?: number;
  residentBytesPerPixel?: number;
  coverage?: BakeCoverage;
}): PatchLayout {
  const normalizedCoverage = normalizeCoverage(coverage);
  const screenWidth = Math.max(1, Number(cameraInfo.screenWidth) || 1);
  const screenHeight = Math.max(1, Number(cameraInfo.screenHeight) || 1);
  const horizontalFovRad = THREE.MathUtils.degToRad(Math.max(Number(cameraInfo.horizontalFov) || 0, 0.001));
  const verticalFovRad = THREE.MathUtils.degToRad(Math.max(Number(cameraInfo.verticalFov) || 0, 0.001));
  const idealVirtualWidth = Math.max(1, screenWidth * (normalizedCoverage.azimuthSpanRad / horizontalFovRad));
  const idealVirtualHeight = Math.max(1, screenHeight * (normalizedCoverage.altitudeSpanRad / verticalFovRad));
  const fullIdealVirtualWidth = Math.max(1, screenWidth * ((Math.PI * 2) / horizontalFovRad));
  const fullIdealVirtualHeight = Math.max(1, screenHeight * (Math.PI / verticalFovRad));
  const budgetBytes = STARFIELD_ALLOCATION_BUDGET_BYTES;
  const accumulationBytes = accumulationBytesPerPixel(accumulationType);
  const gridForDemand = (width: number, height: number): number => AUTO_PATCH_GRIDS.find((grid) => {
    const guard = grid === 1 ? 0 : PATCH_GUARD_TEXELS;
    const maxContent = Math.max(1, maxTextureSize - guard * 2);
    return width / grid <= maxContent
      && height / grid <= maxContent;
  }) ?? AUTO_PATCH_GRIDS[AUTO_PATCH_GRIDS.length - 1];
  const fullGrid = gridForDemand(fullIdealVirtualWidth, fullIdealVirtualHeight);
  const fullCandidate = buildMemoryBoundCandidate({
    grid: fullGrid,
    idealVirtualWidth: fullIdealVirtualWidth,
    idealVirtualHeight: fullIdealVirtualHeight,
    maxTextureSize,
    budgetBytes,
    accumulationBytes,
    residentBytesPerPixel,
  });
  const selectedGrid = gridForDemand(idealVirtualWidth, idealVirtualHeight);
  const candidate = buildMemoryBoundCandidate({
    grid: selectedGrid,
    idealVirtualWidth,
    idealVirtualHeight,
    maxTextureSize,
    budgetBytes,
    accumulationBytes,
    residentBytesPerPixel,
    coverage: normalizedCoverage.config,
    maxQualityScale: normalizedCoverage.fraction < 0.9999 ? fullCandidate.scale : 1,
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
    coverage: candidate.coverage.config,
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

function autoSupersampleForStorage(width: number, height: number, maxTextureSize: number): number {
  const widthLimit = Math.floor(maxTextureSize / Math.max(1, width));
  const heightLimit = Math.floor(maxTextureSize / Math.max(1, height));
  const textureLimit = Math.min(widthLimit, heightLimit);
  return Math.max(1, Math.min(MAX_AUTO_SUPERSAMPLE, textureLimit));
}

export function autoSupersampleForDescriptor(descriptor: PatchDescriptor, maxTextureSize: number): number {
  return autoSupersampleForStorage(
    descriptor.storageSize.width,
    descriptor.storageSize.height,
    maxTextureSize,
  );
}

export function patchGridLabel(layout: Pick<PatchLayout, "columns" | "rows">): string {
  return `${layout.columns}x${layout.rows}`;
}

function assertSquarePatchLayout(layout: Pick<PatchLayout, "columns" | "rows">): void {
  if (layout.columns !== layout.rows) {
    throw new Error(
      `Baked starfield patch layouts must be square; received ${layout.columns}x${layout.rows}.`,
    );
  }
}

function descriptorUvMin(layout: PatchLayout, x: number, y: number): THREE.Vector2 {
  return new THREE.Vector2(
    layout.coverageUvMin.x + (x / layout.columns) * layout.coverageUvSize.x,
    layout.coverageUvMin.y + (y / layout.rows) * layout.coverageUvSize.y,
  );
}

function descriptorUvSize(layout: PatchLayout): THREE.Vector2 {
  return new THREE.Vector2(
    layout.coverageUvSize.x / layout.columns,
    layout.coverageUvSize.y / layout.rows,
  );
}

export function descriptorPrecisionWidth(descriptor: PatchDescriptor, supersample: number): number {
  return descriptor.storageSize.width * supersample;
}

export function descriptorPrecisionHeight(descriptor: PatchDescriptor, supersample: number): number {
  return descriptor.storageSize.height * supersample;
}

export function maxDescriptorStorageSize(descriptors: PatchDescriptor[]): Size2 {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptor.storageSize.width),
    height: Math.max(size.height, descriptor.storageSize.height),
  }), { width: 1, height: 1 });
}

export function maxDescriptorPrecisionSize(descriptors: PatchDescriptor[], supersample: number): Size2 {
  return descriptors.reduce((size, descriptor) => ({
    width: Math.max(size.width, descriptorPrecisionWidth(descriptor, supersample)),
    height: Math.max(size.height, descriptorPrecisionHeight(descriptor, supersample)),
  }), { width: 1, height: 1 });
}

export function assignDescriptorStorage(
  descriptor: PatchDescriptor,
  contentWidth: number,
  contentHeight: number,
  guard: number,
  maxTextureSize: number,
): void {
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

function createPatchDescriptor(layout: PatchLayout, x: number, y: number, maxTextureSize: number): PatchDescriptor {
  const uvMin = descriptorUvMin(layout, x, y);
  const uvSize = descriptorUvSize(layout);
  const angularWidthRad = uvSize.x * Math.PI * 2;
  const angularHeightRad = uvSize.y * Math.PI;
  const centerUv = new THREE.Vector2(uvMin.x + uvSize.x * 0.5, uvMin.y + uvSize.y * 0.5);
  const centerDirection = equirectDirectionFromUv(centerUv.x, centerUv.y);
  const descriptor: PatchDescriptor = {
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
    hasLeftNeighbor: layout.wrapsHorizontally || x > 0,
    hasRightNeighbor: layout.wrapsHorizontally || x < layout.columns - 1,
    hasTopNeighbor: y > 0,
    hasBottomNeighbor: y < layout.rows - 1,
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
    assignedSize: {
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
    lastQueriedStarCount: 0,
    lastQueriedStarInstances: 0,
    lastQueriedCellCount: 0,
    lastBakeReason: "new",
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

export function createPatchDescriptors(layout: PatchLayout, maxTextureSize: number): PatchDescriptor[] {
  assertSquarePatchLayout(layout);

  const descriptors: PatchDescriptor[] = [];
  const horizontalWrap = layout.wrapsHorizontally && layout.columns === 1
    ? THREE.RepeatWrapping
    : THREE.ClampToEdgeWrapping;

  for (let y = 0; y < layout.rows; y += 1) {
    for (let x = 0; x < layout.columns; x += 1) {
      const descriptor = createPatchDescriptor(layout, x, y, maxTextureSize);
      descriptor.wrapS = horizontalWrap;
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}
