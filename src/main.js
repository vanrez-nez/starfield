import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./styles.css";
import { createControls } from "./controls.js";
import { createStarfield } from "./starfield.js";

const HORIZONTAL_FOV = 60;
const FPS_SAMPLE_WINDOW_MS = 1000;
const FPS_IDLE_RESET_MS = 900;

const canvas = document.querySelector("#scene");
const fpsMeter = document.querySelector("#fps-meter");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "low-power",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x05060a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const drawingBufferSize = new THREE.Vector2();
const cameraForward = new THREE.Vector3();

function verticalFovForViewport(horizontalFov, aspect) {
  const horizontalRadians = THREE.MathUtils.degToRad(horizontalFov);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalRadians * 0.5) / Math.max(aspect, 0.001)));
}

function cameraInfo() {
  renderer.getDrawingBufferSize(drawingBufferSize);
  camera.getWorldDirection(cameraForward);
  return {
    horizontalFov: HORIZONTAL_FOV,
    verticalFov: Number(camera.fov.toFixed(2)),
    screenWidth: drawingBufferSize.x,
    screenHeight: drawingBufferSize.y,
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    pixelRatio: renderer.getPixelRatio(),
    forwardX: cameraForward.x,
    forwardY: cameraForward.y,
    forwardZ: cameraForward.z,
  };
}

const initialAspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(verticalFovForViewport(HORIZONTAL_FOV, initialAspect), initialAspect, 0.1, 30);
camera.position.set(0, 0, 0);
const orbitCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
orbitCamera.position.set(0, 0, 1);

const state = {
  renderQueued: false,
  fpsIdleTimer: 0,
};

const fpsFrameTimes = [];
let starfield = null;

const orbitControls = new OrbitControls(orbitCamera, canvas);
orbitControls.target.set(0, 0, 0);
orbitControls.enableRotate = true;
orbitControls.enablePan = false;
orbitControls.enableZoom = false;
orbitControls.enableDamping = false;
orbitControls.minPolarAngle = Math.PI / 2 - 1.35;
orbitControls.maxPolarAngle = Math.PI / 2 + 1.35;
orbitControls.rotateSpeed = 0.45;
orbitControls.saveState();

function syncRenderCameraFromOrbit() {
  orbitCamera.updateMatrixWorld();
  camera.quaternion.copy(orbitCamera.quaternion);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld();
}

function updateFpsMeter() {
  if (!fpsMeter) return;

  const now = performance.now();
  fpsFrameTimes.push(now);
  while (fpsFrameTimes.length > 0 && now - fpsFrameTimes[0] > FPS_SAMPLE_WINDOW_MS) {
    fpsFrameTimes.shift();
  }

  const elapsed = fpsFrameTimes[fpsFrameTimes.length - 1] - fpsFrameTimes[0];
  const fps = elapsed > 0 ? Math.round(((fpsFrameTimes.length - 1) * 1000) / elapsed) : 0;
  fpsMeter.textContent = `FPS ${fps}`;

  window.clearTimeout(state.fpsIdleTimer);
  state.fpsIdleTimer = window.setTimeout(() => {
    fpsFrameTimes.length = 0;
    fpsMeter.textContent = "FPS 0";
  }, FPS_IDLE_RESET_MS);
}

function render() {
  state.renderQueued = false;
  syncRenderCameraFromOrbit();
  starfield.setCameraInfo(cameraInfo(), { notify: false });
  starfield.recordRender();
  renderer.render(scene, camera);
  updateFpsMeter();
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(render);
}

starfield = createStarfield({
  renderer,
  scene,
  requestRender: scheduleRender,
});
syncRenderCameraFromOrbit();
starfield.setCameraInfo(cameraInfo());

function recenter() {
  orbitControls.reset();
  syncRenderCameraFromOrbit();
  scheduleRender();
}

const uiControls = createControls({
  rows: document.querySelector("#rows"),
  buttons: {
    bake: document.querySelector("#rebake"),
    seed: document.querySelector("#seedBtn"),
    recenter: document.querySelector("#recenterBtn"),
  },
  starfield,
  getStats() {
    render();
    return starfield.collectStats(renderer.info, cameraInfo());
  },
  onRecenter: recenter,
});

orbitControls.addEventListener("start", () => {
  canvas.classList.add("is-dragging");
});
orbitControls.addEventListener("change", () => {
  syncRenderCameraFromOrbit();
  scheduleRender();
});
orbitControls.addEventListener("end", () => {
  canvas.classList.remove("is-dragging");
});

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = verticalFovForViewport(HORIZONTAL_FOV, camera.aspect);
  camera.updateProjectionMatrix();
  orbitCamera.aspect = camera.aspect;
  orbitCamera.fov = camera.fov;
  orbitCamera.updateProjectionMatrix();
  syncRenderCameraFromOrbit();
  starfield.setCameraInfo(cameraInfo());
  scheduleRender();
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  window.clearTimeout(state.fpsIdleTimer);
  uiControls.dispose();
  orbitControls.dispose();
  starfield.dispose();
  renderer.dispose();
});

resize();
starfield.bakeNow();
