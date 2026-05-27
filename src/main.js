import * as THREE from "three";
import "./styles.css";
import { createControls } from "./controls.js";
import { createStarfield } from "./starfield.js";

const HORIZONTAL_FOV = 60;

const canvas = document.querySelector("#scene");
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

function verticalFovForViewport(horizontalFov, aspect) {
  const horizontalRadians = THREE.MathUtils.degToRad(horizontalFov);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalRadians * 0.5) / Math.max(aspect, 0.001)));
}

function cameraInfo() {
  renderer.getDrawingBufferSize(drawingBufferSize);
  return {
    horizontalFov: HORIZONTAL_FOV,
    verticalFov: Number(camera.fov.toFixed(2)),
    screenWidth: drawingBufferSize.x,
    screenHeight: drawingBufferSize.y,
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    pixelRatio: renderer.getPixelRatio(),
  };
}

const initialAspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(verticalFovForViewport(HORIZONTAL_FOV, initialAspect), initialAspect, 0.1, 30);
camera.position.set(0, 0, 0);
camera.rotation.order = "YXZ";

const state = {
  yaw: 0,
  pitch: 0,
  renderQueued: false,
  dragging: false,
  lastPointerX: 0,
  lastPointerY: 0,
};

let starfield = null;

function render() {
  state.renderQueued = false;
  starfield.recordRender();
  camera.rotation.set(state.pitch, state.yaw, 0);
  renderer.render(scene, camera);
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
starfield.setCameraInfo(cameraInfo());

function recenter() {
  state.yaw = 0;
  state.pitch = 0;
  scheduleRender();
}

const controls = createControls({
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

canvas.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  state.lastPointerX = event.clientX;
  state.lastPointerY = event.clientY;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;

  const deltaX = event.clientX - state.lastPointerX;
  const deltaY = event.clientY - state.lastPointerY;
  state.lastPointerX = event.clientX;
  state.lastPointerY = event.clientY;

  state.yaw -= deltaX * 0.004;
  state.pitch -= deltaY * 0.004;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -1.35, 1.35);
  scheduleRender();
});

function stopDragging(event) {
  state.dragging = false;
  canvas.classList.remove("is-dragging");
  if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = verticalFovForViewport(HORIZONTAL_FOV, camera.aspect);
  starfield.setCameraInfo(cameraInfo());
  camera.updateProjectionMatrix();
  scheduleRender();
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  controls.dispose();
  starfield.dispose();
  renderer.dispose();
});

resize();
starfield.bakeNow();
