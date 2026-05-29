import * as THREE from "three/webgpu";
import { cloneGpuFieldParams } from "./config";
import {
  Fn,
  Discard,
  abs,
  attribute,
  cameraProjectionMatrix,
  clamp,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  modelViewMatrix,
  normalize,
  positionGeometry,
  pow,
  select,
  sin,
  smoothstep,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type {
  CameraInfo,
  GpuStarfieldApi,
  GpuStarfieldParams,
  RequestRender,
  StarfieldStats,
} from "./starfield/types";

const BASE_QUAD_POSITIONS = new Float32Array([
  -1, -1, 0,
  1, -1, 0,
  -1, 1, 0,
  1, -1, 0,
  1, 1, 0,
  -1, 1, 0,
]);

function mixUint32(value: number): number {
  let state = value >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  return (state ^ (state >>> 16)) >>> 0;
}

function randomUnit(index: number, salt: number): number {
  return mixUint32((Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 17, 0x85ebca6b)) >>> 0) / 4294967296;
}

function wrapPositive(value: number, span: number): number {
  if (span <= 0) return 0;
  return ((value % span) + span) % span;
}

function screenPixelAngleFromInfo(cameraInfo: Partial<CameraInfo> = {}): number {
  const screenWidth = Math.max(1, Number(cameraInfo.screenWidth) || 1);
  const screenHeight = Math.max(1, Number(cameraInfo.screenHeight) || 1);
  const horizontalFov = THREE.MathUtils.degToRad(Number(cameraInfo.horizontalFov) || 60);
  const verticalFov = THREE.MathUtils.degToRad(Number(cameraInfo.verticalFov) || 60);
  return Math.max(horizontalFov / screenWidth, verticalFov / screenHeight);
}

function forwardFromInfo(cameraInfo: Partial<CameraInfo> = {}): THREE.Vector3 {
  const x = Number(cameraInfo.forwardX ?? cameraInfo.forward?.x ?? 0);
  const y = Number(cameraInfo.forwardY ?? cameraInfo.forward?.y ?? 0);
  const z = Number(cameraInfo.forwardZ ?? cameraInfo.forward?.z ?? -1);
  const length = Math.hypot(x, y, z) || 1;
  return new THREE.Vector3(x / length, y / length, z / length);
}

function createGeometry(starCount: number): THREE.InstancedBufferGeometry {
  const count = Math.max(0, Math.round(starCount));
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(BASE_QUAD_POSITIONS, 3));

  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count * 4);
  const side = Math.max(1, Math.ceil(Math.cbrt(Math.max(1, count))));
  const totalCells = side * side * side;
  const cellSize = 2 / side;

  for (let index = 0; index < count; index += 1) {
    const cellIndex = Math.min(totalCells - 1, Math.floor((index + 0.5) * totalCells / Math.max(1, count)));
    const x = cellIndex % side;
    const y = Math.floor(cellIndex / side) % side;
    const z = Math.floor(cellIndex / (side * side));
    const jx = randomUnit(index, 1);
    const jy = randomUnit(index, 2);
    const jz = randomUnit(index, 3);
    positions[index * 3] = -1 + (x + jx) * cellSize;
    positions[index * 3 + 1] = -1 + (y + jy) * cellSize;
    positions[index * 3 + 2] = -1 + (z + jz) * cellSize;
    randoms[index * 4] = randomUnit(index, 4);
    randoms[index * 4 + 1] = randomUnit(index, 5);
    randoms[index * 4 + 2] = randomUnit(index, 6);
    randoms[index * 4 + 3] = randomUnit(index, 7);
  }

  geometry.setAttribute("iBasePosition", new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(randoms, 4));
  geometry.instanceCount = count;
  return geometry;
}

function createGpuFieldMaterial(uniforms: Record<string, { value: unknown }>): THREE.MeshBasicNodeMaterial {
  const uVirtualPosition = uniform(uniforms.uVirtualPosition.value as THREE.Vector3);
  const uFieldRadius = uniform(uniforms.uFieldRadius.value as number);
  const uDepthFade = uniform(uniforms.uDepthFade.value as number);
  const uScreenPixelAngle = uniform(uniforms.uScreenPixelAngle.value as number);
  const uStarSize = uniform(uniforms.uStarSize.value as number);
  const uBrightness = uniform(uniforms.uBrightness.value as number);
  const uColorVariance = uniform(uniforms.uColorVariance.value as number);
  const uTime = uniform(uniforms.uTime.value as number);
  uniforms.uVirtualPosition = uVirtualPosition;
  uniforms.uFieldRadius = uFieldRadius;
  uniforms.uDepthFade = uDepthFade;
  uniforms.uScreenPixelAngle = uScreenPixelAngle;
  uniforms.uStarSize = uStarSize;
  uniforms.uBrightness = uBrightness;
  uniforms.uColorVariance = uColorVariance;
  uniforms.uTime = uTime;

  const vLocal = varyingProperty("vec2", "vGpuFieldLocal") as any;
  const vRandoms = varyingProperty("vec4", "vGpuFieldRandoms") as any;
  const vDistanceFade = varyingProperty("float", "vGpuFieldDistanceFade") as any;

  const hash11 = (Fn as any)(([p]: any[]) => fract(sin(p.mul(127.1)).mul(43758.5453123)));
  const noise1 = (Fn as any)(([x]: any[]) => {
    const i = floor(x);
    const f = fract(x).toVar();
    f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
    return mix(hash11(i), hash11(i.add(1.0)), f);
  });
  const starColor = (Fn as any)(([t]: any[]) => {
    const warm = vec3(1.0, 0.7, 0.42);
    const mid = vec3(0.92, 0.96, 1.0);
    const cool = vec3(0.62, 0.76, 1.0);
    return select(
      t.lessThan(0.5),
      mix(warm, mid, t.mul(2.0)),
      mix(mid, cool, t.sub(0.5).mul(2.0)),
    );
  });

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });

  material.vertexNode = Fn(() => {
    const basePosition = attribute("iBasePosition", "vec3") as any;
    const randoms = attribute("iRandoms", "vec4") as any;
    const radius = max(uFieldRadius, 0.001);
    const span = radius.mul(2.0);
    const wrapped = mod(basePosition.mul(radius).sub(uVirtualPosition).add(span.mul(0.5)), span).sub(span.mul(0.5)).toVar() as any;
    const distanceToCamera = length(wrapped) as any;
    const normalizedDistance = distanceToCamera.div(radius);
    const edgeStart = mix(0.98, 0.55, clamp(uDepthFade, 0.0, 1.0));
    const edgeFade = smoothstep(edgeStart, 1.0, normalizedDistance).oneMinus();
    const nearFade = smoothstep(0.04, 0.12, normalizedDistance);
    vDistanceFade.assign(edgeFade.mul(nearFade));

    const viewDir = wrapped.negate().div(max(distanceToCamera, 0.0001)) as any;
    const referenceUp = select(abs(viewDir.y).greaterThan(0.96), vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0)) as any;
    const right = normalize(cross(referenceUp, viewDir) as any) as any;
    const up = normalize(cross(viewDir, right) as any) as any;
    const sizeScale = mix(0.35, 1.0, pow(randoms.x, 4.0));
    const supportPixels = (uStarSize as any).mul(sizeScale).mul(3.4);
    const supportWorld = max(distanceToCamera.mul(uScreenPixelAngle).mul(supportPixels), 0.0002);
    const offset = right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(supportWorld);
    const worldPosition = wrapped.add(offset);

    vLocal.assign(positionGeometry.xy);
    vRandoms.assign(randoms);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(worldPosition, 1.0)));
  })();

  material.colorNode = Fn(() => {
    Discard(vDistanceFade.lessThanEqual(0.0001));
    const radius = length(vLocal);
    const edge = smoothstep(0.86, 1.0, radius).oneMinus();
    const core = exp(radius.mul(radius).mul(-20.0));
    const glow = exp(radius.mul(radius).mul(-4.8)).mul(0.18);
    const twinkle = mix(0.82, 1.18, noise1(uTime.mul(vRandoms.w.mul(0.8).add(0.3)).add(vRandoms.z.mul(31.0))));
    const brightRank = mix(0.35, 1.0, pow(vRandoms.y, 2.2));
    const color = starColor(mix(0.5, vRandoms.z, clamp(uColorVariance, 0.0, 1.0)));
    const radiance = color.mul(core.add(glow)).mul(edge).mul(vDistanceFade).mul(brightRank).mul(twinkle).mul(uBrightness);
    const peak = max(max(radiance.r, radiance.g), radiance.b);
    Discard(peak.lessThan(0.00001));
    return vec4(radiance, 1.0);
  })();

  return material;
}

export function createGpuStarfield({
  scene,
  requestRender = () => {},
}: {
  scene: THREE.Scene;
  requestRender?: RequestRender;
}): GpuStarfieldApi {
  const params: GpuStarfieldParams = cloneGpuFieldParams();
  const virtualPosition = new THREE.Vector3();
  let cameraForward = new THREE.Vector3(0, 0, -1);
  let geometryRebuilds = 0;

  const uniforms: Record<string, { value: unknown }> = {
    uVirtualPosition: { value: virtualPosition },
    uFieldRadius: { value: params.fieldRadius },
    uDepthFade: { value: params.depthFade },
    uScreenPixelAngle: { value: THREE.MathUtils.degToRad(60) / 1080 },
    uStarSize: { value: params.starSize },
    uBrightness: { value: params.brightness },
    uColorVariance: { value: params.colorVariance },
    uTime: { value: 0 },
  };

  let geometry = createGeometry(params.starCount);
  const material = createGpuFieldMaterial(uniforms);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = params.enabled;
  scene.add(mesh);

  function rebuildGeometry(nextCount: number): void {
    const nextGeometry = createGeometry(nextCount);
    mesh.geometry = nextGeometry;
    geometry.dispose();
    geometry = nextGeometry;
    geometryRebuilds += 1;
  }

  function setEnabled(enabled: boolean): void {
    params.enabled = Boolean(enabled);
    mesh.visible = params.enabled && params.starCount > 0;
    requestRender();
  }

  function setParam(key: keyof GpuStarfieldParams, value: number | boolean): void {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;

    if (key === "starCount") {
      const nextCount = Math.max(0, Math.round(nextValue));
      if (nextCount === params.starCount) return;
      params.starCount = nextCount;
      rebuildGeometry(nextCount);
      mesh.visible = params.enabled && params.starCount > 0;
      requestRender();
      return;
    }

    if (key === "enabled") {
      setEnabled(nextValue > 0);
      return;
    }

    const numericKey = key as Exclude<keyof GpuStarfieldParams, "enabled" | "starCount">;
    params[numericKey] = nextValue;
    if (key === "fieldRadius") {
      uniforms.uFieldRadius.value = Math.max(0.001, nextValue);
      const span = Number(uniforms.uFieldRadius.value) * 2;
      virtualPosition.set(
        wrapPositive(virtualPosition.x, span),
        wrapPositive(virtualPosition.y, span),
        wrapPositive(virtualPosition.z, span),
      );
    } else if (key === "depthFade") {
      uniforms.uDepthFade.value = nextValue;
    } else if (key === "starSize") {
      uniforms.uStarSize.value = nextValue;
    } else if (key === "brightness") {
      uniforms.uBrightness.value = nextValue;
    } else if (key === "colorVariance") {
      uniforms.uColorVariance.value = nextValue;
    }
    requestRender();
  }

  function getParam(key: keyof GpuStarfieldParams): number | boolean {
    return params[key] ?? 0;
  }

  function setCameraInfo(cameraInfo: Partial<CameraInfo> = {}): void {
    uniforms.uScreenPixelAngle.value = screenPixelAngleFromInfo(cameraInfo);
    cameraForward = forwardFromInfo(cameraInfo);
  }

  function recordRender({
    delta = 0,
    elapsedTime = 0,
    cameraInfo = undefined,
  }: {
    delta?: number;
    elapsedTime?: number;
    cameraInfo?: Partial<CameraInfo>;
  } = {}): void {
    if (cameraInfo) {
      cameraForward = forwardFromInfo(cameraInfo);
    }
    uniforms.uTime.value = elapsedTime;
    if (!params.enabled || params.travelSpeed === 0) return;

    const radius = Math.max(0.001, params.fieldRadius);
    const span = radius * 2;
    virtualPosition.addScaledVector(cameraForward, params.travelSpeed * Math.max(0, Math.min(delta, 0.1)));
    virtualPosition.set(
      wrapPositive(virtualPosition.x, span),
      wrapPositive(virtualPosition.y, span),
      wrapPositive(virtualPosition.z, span),
    );
  }

  function collectStats(): StarfieldStats {
    const visible = mesh.visible && params.starCount > 0;
    return {
      gpuFieldEnabled: params.enabled,
      gpuFieldStarCount: params.starCount,
      gpuFieldDrawCalls: visible ? 1 : 0,
      gpuFieldTriangles: visible ? params.starCount * 2 : 0,
      gpuFieldRadius: params.fieldRadius,
      gpuFieldDepthFade: params.depthFade,
      gpuFieldTravelSpeed: params.travelSpeed,
      gpuFieldStarSize: params.starSize,
      gpuFieldBrightness: params.brightness,
      gpuFieldColorVariance: params.colorVariance,
      gpuFieldVirtualDistance: virtualPosition.length(),
      gpuFieldGeometryRebuilds: geometryRebuilds,
    };
  }

  function dispose(): void {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return {
    setEnabled,
    getEnabled: () => params.enabled,
    setParam,
    getParam,
    setCameraInfo,
    recordRender,
    collectStats,
    dispose,
  };
}
