import * as THREE from "three";
import {
  BRIGHT_STAR_FRACTION,
  BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS,
  STAR_CLASSES,
  STAR_QUERY_EDGE_PAD_CELLS,
  STAR_QUERY_SEAM_COPIES,
  classifyStar,
  clamp,
  emptyStarClassStats,
  finalizeStarClassStats,
  hashCellUnit,
  qFromV,
  recordStarClass,
  screenPixelAngleFromInfo,
  wrapIndex,
  MIN_CORE_PIXELS,
  MIN_GLARE_PIXELS,
  GAUSSIAN_CUTOFF_SIGMA,
  catalogSeed,
} from "./constants.js";

export const EMPTY_STAR_POSITIONS = new Float32Array([
  -1, -1, 0,
  1, -1, 0,
  -1, 1, 0,
  1, -1, 0,
  1, 1, 0,
  -1, 1, 0,
]);

export function createEmptyStarGeometry() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(EMPTY_STAR_POSITIONS, 3));
  geometry.setAttribute("iDirection", new THREE.InstancedBufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute("iUv", new THREE.InstancedBufferAttribute(new Float32Array(0), 2));
  geometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(new Float32Array(0), 4));
  geometry.setAttribute("iSizeGate", new THREE.InstancedBufferAttribute(new Float32Array(0), 1));
  geometry.setAttribute("iClass", new THREE.InstancedBufferAttribute(new Float32Array(0), 1));
  geometry.instanceCount = 0;
  return geometry;
}

export function createEmptyOverlayGeometry() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(EMPTY_STAR_POSITIONS, 3));
  geometry.setAttribute("iDirection", new THREE.InstancedBufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(new Float32Array(0), 4));
  geometry.setAttribute("iSizeGate", new THREE.InstancedBufferAttribute(new Float32Array(0), 1));
  geometry.setAttribute("iClass", new THREE.InstancedBufferAttribute(new Float32Array(0), 1));
  geometry.instanceCount = 0;
  return geometry;
}

export function currentStarGrid(bakeUniforms) {
  const density = Math.max(1, Math.round(bakeUniforms.uDensity.value));
  return {
    columns: density,
    rows: density,
    occupancy: clamp(1 - bakeUniforms.uSparsity.value, 0, 1),
    seed: catalogSeed(bakeUniforms.uSeed.value),
  };
}

export function catalogStarCount(bakeUniforms) {
  const grid = currentStarGrid(bakeUniforms);
  return Math.round(grid.columns * grid.rows * grid.occupancy);
}

function largeStarRarityFromUniforms(bakeUniforms) {
  return clamp(bakeUniforms.uLargeStarRarity?.value ?? 0, 0, 1);
}

export function overlayCandidateStarCount({ bakeUniforms, catalogDirty, stats }) {
  const totalStarCount = catalogStarCount(bakeUniforms);
  return !catalogDirty && stats.starClassTotal > 0
    ? stats.overlayCandidateStarCount
    : totalStarCount * BRIGHT_STAR_FRACTION;
}

export function starFromCell(grid, column, row, largeStarRarity = 0) {
  if (row < 0 || row >= grid.rows) return null;

  const wrappedColumn = wrapIndex(column, grid.columns);
  if (hashCellUnit(grid.seed, wrappedColumn, row, 0) >= grid.occupancy) return null;

  const u = (wrappedColumn + hashCellUnit(grid.seed, wrappedColumn, row, 1)) / grid.columns;
  const q = (row + hashCellUnit(grid.seed, wrappedColumn, row, 2)) / grid.rows;
  const y = 1 - q * 2;
  const theta = (u - 0.5) * Math.PI * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const rSize = hashCellUnit(grid.seed, wrappedColumn, row, 3);
  const rBright = hashCellUnit(grid.seed, wrappedColumn, row, 4);
  const rGlare = hashCellUnit(grid.seed, wrappedColumn, row, 5);
  const rColor = hashCellUnit(grid.seed, wrappedColumn, row, 6);
  const rSizeGate = hashCellUnit(grid.seed, wrappedColumn, row, 7);

  return {
    cellId: `${wrappedColumn}:${row}`,
    column: wrappedColumn,
    row,
    x: ring * Math.sin(theta),
    y,
    z: ring * Math.cos(theta),
    u,
    v: Math.acos(THREE.MathUtils.clamp(y, -1, 1)) / Math.PI,
    rSize,
    rBright,
    rGlare,
    rColor,
    rSizeGate,
    classId: classifyStar(rSize, rSizeGate, largeStarRarity, rBright, rGlare),
  };
}

function appendStarInstances({ directions, uvs, randoms, sizeGates, classes }, star) {
  for (let seam = -1; seam <= 1; seam += 1) {
    directions.push(star.x, star.y, star.z);
    uvs.push(star.u + seam, star.v);
    randoms.push(star.rSize, star.rBright, star.rGlare, star.rColor);
    sizeGates.push(star.rSizeGate);
    classes.push(star.classId);
  }
}

function createGeometryFromInstanceArrays({ directions, uvs, randoms, sizeGates, classes }) {
  const geometry = createEmptyStarGeometry();
  geometry.setAttribute("iDirection", new THREE.InstancedBufferAttribute(new Float32Array(directions), 3));
  geometry.setAttribute("iUv", new THREE.InstancedBufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(new Float32Array(randoms), 4));
  geometry.setAttribute("iSizeGate", new THREE.InstancedBufferAttribute(new Float32Array(sizeGates), 1));
  geometry.setAttribute("iClass", new THREE.InstancedBufferAttribute(new Float32Array(classes), 1));
  geometry.instanceCount = classes.length;
  return geometry;
}

function maxStarSupportAngle({ bakeUniforms, currentCameraInfo }) {
  const screenAngularPx = screenPixelAngleFromInfo(currentCameraInfo);
  const coreRadius = Math.max(
    bakeUniforms.uStarSize.value * screenAngularPx,
    MIN_CORE_PIXELS * screenAngularPx,
  );
  const glareRadius = Math.max(
    (bakeUniforms.uStarSize.value + bakeUniforms.uGlareSize.value) * screenAngularPx,
    MIN_GLARE_PIXELS * screenAngularPx,
  );
  return Math.max(coreRadius * 0.45, glareRadius * 0.36, screenAngularPx) * GAUSSIAN_CUTOFF_SIGMA;
}

function uvRangeIntersectsColumn(uMin, uMax, column, columns) {
  if (uMax - uMin >= 1) return true;

  const cellMin = column / columns;
  const cellMax = (column + 1) / columns;
  for (let seam = -1; seam <= 1; seam += 1) {
    if (cellMax + seam >= uMin && cellMin + seam <= uMax) return true;
  }
  return false;
}

export function createStarGeometryForDescriptor({
  descriptor,
  bakeUniforms,
  currentCameraInfo,
  brightStarOverlayEnabled,
  stats,
}) {
  const grid = currentStarGrid(bakeUniforms);
  const largeStarRarity = largeStarRarityFromUniforms(bakeUniforms);
  const supportAngle = maxStarSupportAngle({ bakeUniforms, currentCameraInfo });
  const vMargin = supportAngle / Math.PI;
  const rawVMin = descriptor.storageUvMin.y - vMargin;
  const rawVMax = descriptor.storageUvMin.y + descriptor.storageUvSize.y + vMargin;
  const vMin = clamp(rawVMin, 0, 1);
  const vMax = clamp(rawVMax, 0, 1);
  const qMin = qFromV(vMin);
  const qMax = qFromV(vMax);
  const rowStart = Math.max(0, Math.floor(qMin * grid.rows) - STAR_QUERY_EDGE_PAD_CELLS);
  const rowEnd = Math.min(grid.rows - 1, Math.floor(qMax * grid.rows) + STAR_QUERY_EDGE_PAD_CELLS);
  const poleWideQuery = rawVMin <= vMargin || rawVMax >= 1 - vMargin;
  const sinPhi = Math.max(
    Math.min(
      Math.sin(Math.max(vMin, 0.001) * Math.PI),
      Math.sin(Math.min(vMax, 0.999) * Math.PI),
    ),
    0.015,
  );
  const uMargin = poleWideQuery
    ? 1
    : Math.min(1, supportAngle / (2 * Math.PI * sinPhi) + STAR_QUERY_EDGE_PAD_CELLS / grid.columns);
  const uMin = descriptor.storageUvMin.x - uMargin;
  const uMax = descriptor.storageUvMin.x + descriptor.storageUvSize.x + uMargin;
  const arrays = {
    directions: [],
    uvs: [],
    randoms: [],
    sizeGates: [],
    classes: [],
  };
  let queriedCellCount = 0;
  let queriedStarCount = 0;

  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (!poleWideQuery && !uvRangeIntersectsColumn(uMin, uMax, column, grid.columns)) continue;

      queriedCellCount += 1;
      const star = starFromCell(grid, column, row, largeStarRarity);
      if (!star) continue;
      if (brightStarOverlayEnabled && BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS && star.classId > STAR_CLASSES.NORMAL) continue;

      appendStarInstances(arrays, star);
      queriedStarCount += 1;
    }
  }

  const geometry = createGeometryFromInstanceArrays(arrays);
  descriptor.lastQueriedStarCount = queriedStarCount;
  descriptor.lastQueriedStarInstances = geometry.instanceCount;
  descriptor.lastQueriedCellCount = queriedCellCount;
  stats.starQueryGrid = `${grid.columns}x${grid.rows}`;
  stats.lastStarQueryPatchId = descriptor.id;
  stats.lastStarQueryStarCount = queriedStarCount;
  stats.lastStarQueryInstanceCount = geometry.instanceCount;
  stats.lastStarQueryCellCount = queriedCellCount;
  return geometry;
}

export function createCatalogOverlayAndStats({ bakeUniforms, brightStarOverlayEnabled }) {
  const grid = currentStarGrid(bakeUniforms);
  const largeStarRarity = largeStarRarityFromUniforms(bakeUniforms);
  const overlayDirections = [];
  const overlayRandoms = [];
  const overlaySizeGates = [];
  const overlayClasses = [];
  const classStats = emptyStarClassStats();

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const star = starFromCell(grid, column, row, largeStarRarity);
      if (!star) continue;

      recordStarClass(classStats, star.classId);

      if (brightStarOverlayEnabled && (star.classId === STAR_CLASSES.BRIGHT || star.classId === STAR_CLASSES.HERO)) {
        overlayDirections.push(star.x, star.y, star.z);
        overlayRandoms.push(star.rSize, star.rBright, star.rGlare, star.rColor);
        overlaySizeGates.push(star.rSizeGate);
        overlayClasses.push(star.classId);
      }
    }
  }

  const nextOverlayGeometry = createEmptyOverlayGeometry();
  nextOverlayGeometry.setAttribute("iDirection", new THREE.InstancedBufferAttribute(new Float32Array(overlayDirections), 3));
  nextOverlayGeometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(new Float32Array(overlayRandoms), 4));
  nextOverlayGeometry.setAttribute("iSizeGate", new THREE.InstancedBufferAttribute(new Float32Array(overlaySizeGates), 1));
  nextOverlayGeometry.setAttribute("iClass", new THREE.InstancedBufferAttribute(new Float32Array(overlayClasses), 1));
  nextOverlayGeometry.instanceCount = overlayClasses.length;
  const finalizedClassStats = finalizeStarClassStats(classStats);
  if (brightStarOverlayEnabled && BRIGHT_STAR_OVERLAY_EXCLUDES_BAKED_STARS) {
    finalizedClassStats.bakedCandidateStarCount = finalizedClassStats.normalStarCount;
  }
  finalizedClassStats.overlayStarCount = overlayClasses.length;
  finalizedClassStats.overlayStarInstances = overlayClasses.length;
  finalizedClassStats.overlayTriangleCount = overlayClasses.length * 2;
  finalizedClassStats.overlayDrawCalls = brightStarOverlayEnabled && overlayClasses.length > 0 ? 1 : 0;
  finalizedClassStats.overlayEnabled = brightStarOverlayEnabled;
  finalizedClassStats.starQueryGrid = `${grid.columns}x${grid.rows}`;
  finalizedClassStats.tileAwareGeneration = true;

  return {
    classStats: finalizedClassStats,
    overlayGeometry: nextOverlayGeometry,
  };
}

export function catalogClassStatsSummary(stats) {
  return {
    starCount: stats.starClassTotal,
    starInstances: stats.bakedCandidateStarCount * STAR_QUERY_SEAM_COPIES,
    overlayStarCount: stats.overlayStarCount,
  };
}
