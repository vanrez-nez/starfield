import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Stats from "three/addons/libs/stats.module.js";
import "./styles.css";
import { createControls } from "./controls";
import { createGpuStarfield } from "./gpu-starfield";
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
const panel = queryRequired<HTMLElement>("#panel");
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

const stats = new Stats();
stats.showPanel(0);
stats.dom.classList.add("starfield-stats-panel");
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
const drawingBufferSize = new THREE.Vector2();
const cameraForward = new THREE.Vector3();
const timer = new THREE.Timer();
timer.connect(document);

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
  animationFrame: 0,
  resizePending: false,
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
};

let starfield: ReturnType<typeof createStarfield>;
let gpuStarfield: ReturnType<typeof createGpuStarfield>;

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
  panel?.addEventListener(eventName, (event) => {
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

function renderFrame(): void {
  stats.begin();
  applyResizeIfNeeded();
  timer.update();
  const delta = timer.getDelta();
  orbitControls.update();
  syncRenderCameraFromOrbit();
  const frameCameraInfo = updateCameraInfoCache();
  gpuStarfield.recordRender({
    delta,
    elapsedTime: timer.getElapsed(),
    cameraInfo: frameCameraInfo,
  });
  starfield.recordRender();
  renderer.render(scene, camera);
  stats.end();
}

function animationLoop(): void {
  renderFrame();
  state.animationFrame = requestAnimationFrame(animationLoop);
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

const uiControls = createControls({
  rows: queryRequired<HTMLElement>("#rows"),
  buttons: {
    bake: queryRequired<HTMLButtonElement>("#rebake"),
    seed: queryRequired<HTMLButtonElement>("#seedBtn"),
    recenter: queryRequired<HTMLButtonElement>("#recenterBtn"),
    overlay: document.querySelector<HTMLButtonElement>("#toggleOverlayBtn"),
  },
  starfield,
  gpuStarfield,
  getStats(options: { detail?: "panel" | "debug" } = {}): StarfieldStats {
    applyResizeIfNeeded();
    syncRenderCameraFromOrbit();
    return {
      ...starfield.collectStats(renderer.info, cameraInfo({ screen: true }), options),
      ...gpuStarfield.collectStats(),
    };
  },
  onRecenter: recenter,
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
  cancelAnimationFrame(state.animationFrame);
  uiControls.dispose();
  orbitControls.dispose();
  timer.dispose();
  gpuStarfield.dispose();
  starfield.dispose();
  stats.dom.remove();
  renderer.dispose();
});

applyResizeIfNeeded({ force: true });
starfield.bakeNow();
state.animationFrame = requestAnimationFrame(animationLoop);
}
