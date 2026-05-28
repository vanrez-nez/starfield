import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Stats from "three/addons/libs/stats.module.js";
import "./styles.css";
import { createControls } from "./controls.js";
import { createStarfield } from "./starfield.js";

const HORIZONTAL_FOV = 60;

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  // powerPreference: "low-power",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x05060a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const stats = new Stats();
stats.showPanel(0);
stats.dom.classList.add("starfield-stats-panel");
document.body.appendChild(stats.dom);

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
  animationFrame: 0,
  resizePending: false,
  width: window.innerWidth,
  height: window.innerHeight,
};

let starfield = null;

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

function syncRenderCameraFromOrbit() {
  orbitCamera.updateMatrixWorld();
  camera.quaternion.copy(orbitCamera.quaternion);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld();
}

function renderFrame() {
  stats.begin();
  applyResizeIfNeeded();
  orbitControls.update();
  syncRenderCameraFromOrbit();
  starfield.setCameraInfo(cameraInfo(), { notify: false });
  starfield.recordRender();
  renderer.render(scene, camera);
  stats.end();
}

function animationLoop() {
  renderFrame();
  state.animationFrame = requestAnimationFrame(animationLoop);
}

function requestRuntimeRender() {
  // Compatibility hook for starfield internals; the runtime loop is already active.
}

starfield = createStarfield({
  renderer,
  scene,
  requestRender: requestRuntimeRender,
});
syncRenderCameraFromOrbit();
starfield.setCameraInfo(cameraInfo());

function recenter() {
  orbitControls.reset();
  syncRenderCameraFromOrbit();
  requestRuntimeRender();
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
    renderFrame();
    return starfield.collectStats(renderer.info, cameraInfo());
  },
  onRecenter: recenter,
});

orbitControls.addEventListener("start", () => {
  canvas.classList.add("is-dragging");
});
orbitControls.addEventListener("change", () => {
  syncRenderCameraFromOrbit();
  requestRuntimeRender();
});
orbitControls.addEventListener("end", () => {
  canvas.classList.remove("is-dragging");
});

function applyResizeIfNeeded({ force = false } = {}) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!force && !state.resizePending && width === state.width && height === state.height) return;

  state.resizePending = false;
  state.width = width;
  state.height = height;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = verticalFovForViewport(HORIZONTAL_FOV, camera.aspect);
  camera.updateProjectionMatrix();
  orbitCamera.aspect = camera.aspect;
  orbitCamera.fov = camera.fov;
  orbitCamera.updateProjectionMatrix();
  syncRenderCameraFromOrbit();
  starfield.setCameraInfo(cameraInfo());
  requestRuntimeRender();
}

function resize() {
  state.resizePending = true;
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(state.animationFrame);
  uiControls.dispose();
  orbitControls.dispose();
  starfield.dispose();
  stats.dom.remove();
  renderer.dispose();
});

applyResizeIfNeeded({ force: true });
starfield.bakeNow();
state.animationFrame = requestAnimationFrame(animationLoop);
