import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./styles.css";
import { STARFIELD_CONFIG } from "./config";
import { createControls } from "./controls";
import { createGpuStarfield } from "./gpu-starfield";
import { createFramePerformanceMonitor, type FrameStageDurations, type FrameStageName } from "./performance-monitor";
import { createStarfield } from "./starfield";
import type { CameraInfo, StarfieldStats } from "./starfield/types";

const HORIZONTAL_FOV = 60;

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const canvas = queryRequired<HTMLCanvasElement>("#scene");
const paneHost = queryRequired<HTMLElement>("#pane-host");
const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: true,
  // powerPreference: "low-power",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x05060a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

void start();

async function start(): Promise<void> {
  try {
    await renderer.init();
  } catch (error) {
    const message = document.createElement("div");
    message.className = "renderer-error";
    message.textContent = "Unable to initialize Three.js WebGPU/WebGL2 renderer.";
    document.body.appendChild(message);
    throw error;
  }

const scene = new THREE.Scene();
const drawingBufferSize = new THREE.Vector2();
const cameraForward = new THREE.Vector3();
const timer = new THREE.Timer();
timer.connect(document);
const targetFrameDelta = 1 / Math.max(1, STARFIELD_CONFIG.internal.performanceTargetFps);
const targetFrameBudgetMs = 1000 / Math.max(1, STARFIELD_CONFIG.internal.performanceTargetFps);
let visualElapsedTime = 0;
const frameStages: FrameStageDurations = {};
let frameStageStartMs = 0;
const frameMonitor = createFramePerformanceMonitor({
  targetFps: STARFIELD_CONFIG.internal.performanceTargetFps,
  historySeconds: STARFIELD_CONFIG.internal.performanceHistorySeconds,
});
window.starfieldPerfHistory = frameMonitor.history;
window.resetStarfieldPerfHistory = frameMonitor.reset;

function verticalFovForViewport(horizontalFov: number, aspect: number): number {
  const horizontalRadians = THREE.MathUtils.degToRad(horizontalFov);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalRadians * 0.5) / Math.max(aspect, 0.001)));
}

const initialAspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(verticalFovForViewport(HORIZONTAL_FOV, initialAspect), initialAspect, 0.1, 30);
camera.position.set(0, 0, 0);
const orbitCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
orbitCamera.position.set(0, 0, 1);

const state = {
  resizePending: false,
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
};
const performanceProbeOptions = {
  skipRenderSubmit: false,
};

let starfield: ReturnType<typeof createStarfield>;
let gpuStarfield: ReturnType<typeof createGpuStarfield>;
let uiControls: ReturnType<typeof createControls>;

const cachedCameraInfo: CameraInfo = {
  horizontalFov: HORIZONTAL_FOV,
  verticalFov: Number(camera.fov.toFixed(2)),
  screenWidth: 1,
  screenHeight: 1,
  cssWidth: state.width,
  cssHeight: state.height,
  pixelRatio: state.pixelRatio,
  forwardX: 0,
  forwardY: 0,
  forwardZ: -1,
};

const orbitControls = new OrbitControls(orbitCamera, canvas);
orbitControls.target.set(0, 0, 0);
orbitControls.enableRotate = true;
orbitControls.enablePan = false;
orbitControls.enableZoom = false;
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.01;
orbitControls.autoRotate = false;
orbitControls.minPolarAngle = Math.PI / 2 - 1.35;
orbitControls.maxPolarAngle = Math.PI / 2 + 1.35;
orbitControls.rotateSpeed = 0.45;
orbitControls.saveState();

["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"].forEach((eventName) => {
  paneHost.addEventListener(eventName, (event) => {
    event.stopPropagation();
  }, { passive: true });
});

function syncRenderCameraFromOrbit(): void {
  orbitCamera.updateMatrixWorld();
  camera.quaternion.copy(orbitCamera.quaternion);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld();
}

function updateCameraInfoCache({ screen = false }: { screen?: boolean } = {}): CameraInfo {
  if (screen) {
    renderer.getDrawingBufferSize(drawingBufferSize);
    cachedCameraInfo.horizontalFov = HORIZONTAL_FOV;
    cachedCameraInfo.verticalFov = Number(camera.fov.toFixed(2));
    cachedCameraInfo.screenWidth = drawingBufferSize.x;
    cachedCameraInfo.screenHeight = drawingBufferSize.y;
    cachedCameraInfo.cssWidth = state.width;
    cachedCameraInfo.cssHeight = state.height;
    cachedCameraInfo.pixelRatio = renderer.getPixelRatio();
  }

  camera.getWorldDirection(cameraForward);
  cachedCameraInfo.forwardX = cameraForward.x;
  cachedCameraInfo.forwardY = cameraForward.y;
  cachedCameraInfo.forwardZ = cameraForward.z;
  return cachedCameraInfo;
}

function cameraInfo({ screen = false }: { screen?: boolean } = {}): CameraInfo {
  return { ...updateCameraInfoCache({ screen }) };
}

function pacedAnimationDelta(rawDeltaSeconds: number): number {
  const rawDeltaMs = Math.max(0, rawDeltaSeconds * 1000);
  const frameSlots = rawDeltaMs >= targetFrameBudgetMs * 1.5
    ? Math.max(1, Math.round(rawDeltaMs / targetFrameBudgetMs))
    : 1;
  return targetFrameDelta * frameSlots;
}

function resetFrameStages(): void {
  frameStages.resize = 0;
  frameStages.timer = 0;
  frameStages.orbit = 0;
  frameStages.camera = 0;
  frameStages.gpuField = 0;
  frameStages.starfield = 0;
  frameStages.render = 0;
  frameStages.ui = 0;
  frameStageStartMs = performance.now();
}

function markStage(stage: FrameStageName): void {
  const nowMs = performance.now();
  frameStages[stage] = nowMs - frameStageStartMs;
  frameStageStartMs = nowMs;
}

function renderFrame(timestampMs: DOMHighResTimeStamp): void {
  resetFrameStages();
  applyResizeIfNeeded();
  markStage("resize");
  timer.update(timestampMs);
  const delta = timer.getDelta();
  const visualDelta = pacedAnimationDelta(delta);
  visualElapsedTime += visualDelta;
  markStage("timer");
  orbitControls.update();
  markStage("orbit");
  syncRenderCameraFromOrbit();
  const frameCameraInfo = updateCameraInfoCache();
  markStage("camera");
  gpuStarfield.recordRender({
    delta: visualDelta,
    elapsedTime: visualElapsedTime,
    cameraInfo: frameCameraInfo,
  });
  markStage("gpuField");
  starfield.recordRender({ elapsedTime: visualElapsedTime, cameraInfo: frameCameraInfo });
  markStage("starfield");
  if (!performanceProbeOptions.skipRenderSubmit) {
    renderer.render(scene, camera);
  }
  markStage("render");
  uiControls.updateFps(delta);
  markStage("ui");
  frameMonitor.record(delta, frameStages, timestampMs);
}

function animationLoop(timestampMs: DOMHighResTimeStamp): void {
  renderFrame(timestampMs);
}

function requestRuntimeRender(): void {
  // Compatibility hook for starfield internals; the runtime loop is already active.
}

starfield = createStarfield({
  renderer,
  scene,
  requestRender: requestRuntimeRender,
});
gpuStarfield = createGpuStarfield({
  scene,
  requestRender: requestRuntimeRender,
});
syncRenderCameraFromOrbit();
const initialCameraInfo = cameraInfo({ screen: true });
starfield.setCameraInfo(initialCameraInfo);
gpuStarfield.setCameraInfo(initialCameraInfo);

function recenter(): void {
  orbitControls.reset();
  syncRenderCameraFromOrbit();
  requestRuntimeRender();
}

uiControls = createControls({
  container: paneHost,
  starfield,
  gpuStarfield,
  getStats(options: { detail?: "panel" | "debug" } = {}): StarfieldStats {
    applyResizeIfNeeded();
    syncRenderCameraFromOrbit();
    return {
      ...starfield.collectStats(renderer.info, cameraInfo({ screen: true }), options),
      ...gpuStarfield.collectStats(),
      ...frameMonitor.collectStats(),
    };
  },
  onRecenter: recenter,
  resetPerformanceHistory: frameMonitor.reset,
  setPerformanceProbeOptions(options: { skipRenderSubmit?: boolean }): void {
    performanceProbeOptions.skipRenderSubmit = Boolean(options.skipRenderSubmit);
  },
});

orbitControls.addEventListener("start", () => {
  canvas.classList.add("is-dragging");
});
orbitControls.addEventListener("end", () => {
  canvas.classList.remove("is-dragging");
});

function applyResizeIfNeeded({ force = false }: { force?: boolean } = {}): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  if (!force && !state.resizePending && width === state.width && height === state.height && pixelRatio === state.pixelRatio) return;

  state.resizePending = false;
  state.width = width;
  state.height = height;
  state.pixelRatio = pixelRatio;

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = verticalFovForViewport(HORIZONTAL_FOV, camera.aspect);
  camera.updateProjectionMatrix();
  orbitCamera.aspect = camera.aspect;
  orbitCamera.fov = camera.fov;
  orbitCamera.updateProjectionMatrix();
  syncRenderCameraFromOrbit();
  const nextCameraInfo = cameraInfo({ screen: true });
  starfield.setCameraInfo(nextCameraInfo);
  gpuStarfield.setCameraInfo(nextCameraInfo);
  requestRuntimeRender();
}

function resize(): void {
  state.resizePending = true;
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  renderer.setAnimationLoop(null);
  uiControls.dispose();
  orbitControls.dispose();
  timer.dispose();
  frameMonitor.dispose();
  delete window.starfieldPerfHistory;
  delete window.resetStarfieldPerfHistory;
  gpuStarfield.dispose();
  starfield.dispose();
  renderer.dispose();
});

applyResizeIfNeeded({ force: true });
starfield.bakeNow();
timer.reset();
visualElapsedTime = 0;
renderer.setAnimationLoop(animationLoop);
}
