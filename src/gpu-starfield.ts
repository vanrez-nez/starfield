import * as THREE from "three";
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

const DEFAULTS: GpuStarfieldParams = Object.freeze({
  enabled: true,
  starCount: 6144,
  fieldRadius: 14,
  depthFade: 0.45,
  travelSpeed: 0,
  starSize: 1.15,
  brightness: 0.55,
  colorVariance: 0.55,
});

const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  attribute vec3 iBasePosition;
  attribute vec4 iRandoms;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vDistanceFade;

  uniform vec3 uVirtualPosition;
  uniform float uFieldRadius;
  uniform float uDepthFade;
  uniform float uScreenPixelAngle;
  uniform float uStarSize;

  vec3 wrapCentered(vec3 value, float span) {
    return mod(value + span * 0.5, span) - span * 0.5;
  }

  void main() {
    float radius = max(uFieldRadius, 0.001);
    vec3 wrapped = wrapCentered(iBasePosition * radius - uVirtualPosition, radius * 2.0);
    float distanceToCamera = length(wrapped);
    float normalizedDistance = distanceToCamera / radius;
    float edgeStart = mix(0.98, 0.55, clamp(uDepthFade, 0.0, 1.0));
    float edgeFade = 1.0 - smoothstep(edgeStart, 1.0, normalizedDistance);
    float nearFade = smoothstep(0.04, 0.12, normalizedDistance);
    vDistanceFade = edgeFade * nearFade;

    vec3 viewDir = distanceToCamera > 0.0001 ? normalize(-wrapped) : vec3(0.0, 0.0, 1.0);
    vec3 referenceUp = abs(viewDir.y) > 0.96 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(referenceUp, viewDir));
    vec3 up = normalize(cross(viewDir, right));
    float sizeScale = mix(0.35, 1.0, pow(iRandoms.x, 4.0));
    float supportPixels = uStarSize * sizeScale * 3.4;
    float supportWorld = max(distanceToCamera * uScreenPixelAngle * supportPixels, 0.0002);
    vec3 worldPosition = wrapped + (right * position.x + up * position.y) * supportWorld;

    vLocal = position.xy;
    vRandoms = iRandoms;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vDistanceFade;

  uniform float uTime;
  uniform float uBrightness;
  uniform float uColorVariance;

  vec3 starColor(float t) {
    vec3 warm = vec3(1.00, 0.70, 0.42);
    vec3 mid = vec3(0.92, 0.96, 1.00);
    vec3 cool = vec3(0.62, 0.76, 1.00);
    return (t < 0.5) ? mix(warm, mid, t * 2.0) : mix(mid, cool, (t - 0.5) * 2.0);
  }

  float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453123);
  }

  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
  }

  void main() {
    if (vDistanceFade <= 0.0001) discard;

    float radius = length(vLocal);
    float edge = 1.0 - smoothstep(0.86, 1.0, radius);
    float core = exp(-radius * radius * 20.0);
    float glow = exp(-radius * radius * 4.8) * 0.18;
    float twinkle = mix(0.82, 1.18, noise1(uTime * (0.3 + vRandoms.w * 0.8) + vRandoms.z * 31.0));
    float brightRank = mix(0.35, 1.0, pow(vRandoms.y, 2.2));
    vec3 color = starColor(mix(0.5, vRandoms.z, clamp(uColorVariance, 0.0, 1.0)));
    vec3 radiance = color * (core + glow) * edge * vDistanceFade * brightRank * twinkle * uBrightness;

    if (max(max(radiance.r, radiance.g), radiance.b) < 0.00001) discard;
    gl_FragColor = vec4(radiance, 1.0);
  }
`;

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

export function createGpuStarfield({
  scene,
  requestRender = () => {},
}: {
  scene: THREE.Scene;
  requestRender?: RequestRender;
}): GpuStarfieldApi {
  const params: GpuStarfieldParams = { ...DEFAULTS };
  const virtualPosition = new THREE.Vector3();
  let cameraForward = new THREE.Vector3(0, 0, -1);
  let geometryRebuilds = 0;

  const uniforms = {
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
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });

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
      const span = uniforms.uFieldRadius.value * 2;
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
    defaults: DEFAULTS,
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
