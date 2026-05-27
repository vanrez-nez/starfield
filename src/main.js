import * as THREE from "three";
import "./styles.css";

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "low-power",
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x05060a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const FOV = 60;
const DOME_RADIUS = 9;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 30);
camera.position.set(0, 0, 0);
camera.rotation.order = "YXZ";

const defaults = {
  uDensity: 104,
  uSparsity: 0.79,
  uStarSize: 1.45,
  uSizeVar: 0.58,
  uBright: 1.7,
  uBrightVar: 0.7,
  uGlareSize: 2.4,
  uGlareStr: 0.45,
  uGlareVar: 0.64,
  uColorVar: 0.64,
  seed: 1,
};

window.starfieldStats = {
  mode: "skydome-point-sprites",
  rebuilds: 0,
  renders: 0,
  stars: 0,
};

const uniforms = {
  uPixelRatio: { value: renderer.getPixelRatio() },
  uStarSize: { value: defaults.uStarSize },
  uSizeVar: { value: defaults.uSizeVar },
  uBright: { value: defaults.uBright },
  uBrightVar: { value: defaults.uBrightVar },
  uGlareSize: { value: defaults.uGlareSize },
  uGlareStr: { value: defaults.uGlareStr },
  uGlareVar: { value: defaults.uGlareVar },
  uColorVar: { value: defaults.uColorVar },
};

const domeMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  vertexShader: /* glsl */ `
    varying vec3 vDirection;

    void main() {
      vDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    varying vec3 vDirection;

    void main() {
      float upper = smoothstep(-0.35, 0.9, vDirection.y);
      vec3 low = vec3(0.005, 0.006, 0.013);
      vec3 high = vec3(0.011, 0.013, 0.026);
      gl_FragColor = vec4(mix(low, high, upper), 1.0);
    }
  `,
});

const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 96, 64), domeMaterial);
dome.frustumCulled = false;
scene.add(dome);

const starMaterial = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.NormalBlending,
  vertexShader: /* glsl */ `
    attribute float aSizeRand;
    attribute float aBrightRand;
    attribute float aGlareRand;
    attribute float aColorRand;

    uniform float uPixelRatio;
    uniform float uStarSize;
    uniform float uSizeVar;
    uniform float uBright;
    uniform float uBrightVar;
    uniform float uGlareSize;
    uniform float uGlareStr;
    uniform float uGlareVar;
    uniform float uColorVar;

    varying float vCorePx;
    varying float vGlarePx;
    varying float vPointPx;
    varying float vBrightness;
    varying float vGlareStrength;
    varying float vColorTemperature;

    void main() {
      float sizeMultiplier = mix(1.0, mix(0.1, 1.0, aSizeRand), uSizeVar);
      float corePx = max(uStarSize * sizeMultiplier * uPixelRatio, 0.05);
      float glarePx = max(uGlareSize * mix(1.0, sizeMultiplier, uSizeVar) * uPixelRatio, 0.0);
      float pointRadiusPx = max(corePx + glarePx, corePx + 1.25 * uPixelRatio);

      vCorePx = corePx;
      vGlarePx = glarePx;
      vPointPx = pointRadiusPx * 2.0;
      vBrightness = uBright * mix(1.0, pow(aBrightRand, 3.0) * 3.0, uBrightVar);
      vGlareStrength = uGlareStr * mix(1.0, pow(aGlareRand, 8.0), uGlareVar);
      vColorTemperature = mix(0.5, aColorRand, uColorVar);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = vPointPx;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    varying float vCorePx;
    varying float vGlarePx;
    varying float vPointPx;
    varying float vBrightness;
    varying float vGlareStrength;
    varying float vColorTemperature;

    vec3 starColor(float t) {
      vec3 cool = vec3(1.00, 0.55, 0.30);
      vec3 mid = vec3(1.00, 0.96, 0.92);
      vec3 hot = vec3(0.70, 0.80, 1.00);
      return (t < 0.5) ? mix(cool, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
    }

    void main() {
      vec2 point = gl_PointCoord - 0.5;
      float d = length(point) * vPointPx;
      float core = 1.0 - smoothstep(vCorePx - 0.75, vCorePx + 0.75, d);

      float glare = 0.0;
      if (vGlarePx > 0.01) {
        float glareRadius = vCorePx + vGlarePx;
        float g = d / max(glareRadius, 0.001);
        glare = (g < 1.0) ? pow(1.0 - g, 2.6) : 0.0;
      }

      float intensity = max(core, glare * vGlareStrength) * vBrightness;
      if (intensity < 0.003) discard;

      gl_FragColor = vec4(starColor(vColorTemperature) * intensity, clamp(intensity, 0.0, 1.0));
    }
  `,
});

let starGeometry = null;
let stars = null;
let seed = defaults.seed;

const state = {
  yaw: 0,
  pitch: 0,
  renderQueued: false,
  dragging: false,
  lastPointerX: 0,
  lastPointerY: 0,
};

const PARAMS = [
  { group: "Field" },
  { key: "uDensity", label: "Density", min: 10, max: 180, step: 1, format: (v) => v.toFixed(0) },
  { key: "uSparsity", label: "Sparsity", min: 0, max: 0.97, step: 0.005, format: (v) => v.toFixed(3) },
  { group: "Core" },
  { key: "uStarSize", label: "Star Size", min: 0.5, max: 8, step: 0.1, format: (v) => v.toFixed(1) },
  { key: "uSizeVar", label: "Size Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: "uBright", label: "Brightness", min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uBrightVar", label: "Brightness Var", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { group: "Glare" },
  { key: "uGlareSize", label: "Glare Size", min: 0, max: 18, step: 0.2, format: (v) => v.toFixed(1) },
  { key: "uGlareStr", label: "Glare Strength", min: 0, max: 3.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uGlareVar", label: "Glare Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { group: "Color" },
  { key: "uColorVar", label: "Color Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
];

const rows = document.querySelector("#rows");
const fieldValues = {
  uDensity: defaults.uDensity,
  uSparsity: defaults.uSparsity,
};

function mulberry32(value) {
  return function random() {
    let t = (value += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starCountFromField() {
  const density = fieldValues.uDensity;
  const occupancy = 1 - fieldValues.uSparsity;
  return Math.max(32, Math.round(density * density * occupancy));
}

function rebuildStars() {
  const count = starCountFromField();
  const random = mulberry32(Math.floor(seed * 100000) || 1);
  const positions = new Float32Array(count * 3);
  const sizeRand = new Float32Array(count);
  const brightRand = new Float32Array(count);
  const glareRand = new Float32Array(count);
  const colorRand = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    const x = Math.cos(angle) * radius;
    const y = z;
    const zz = Math.sin(angle) * radius;

    positions[i * 3] = x * (DOME_RADIUS * 0.985);
    positions[i * 3 + 1] = y * (DOME_RADIUS * 0.985);
    positions[i * 3 + 2] = zz * (DOME_RADIUS * 0.985);
    sizeRand[i] = random();
    brightRand[i] = random();
    glareRand[i] = random();
    colorRand[i] = random();
  }

  const nextGeometry = new THREE.BufferGeometry();
  nextGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  nextGeometry.setAttribute("aSizeRand", new THREE.BufferAttribute(sizeRand, 1));
  nextGeometry.setAttribute("aBrightRand", new THREE.BufferAttribute(brightRand, 1));
  nextGeometry.setAttribute("aGlareRand", new THREE.BufferAttribute(glareRand, 1));
  nextGeometry.setAttribute("aColorRand", new THREE.BufferAttribute(colorRand, 1));

  if (stars) {
    scene.remove(stars);
    starGeometry.dispose();
  }

  starGeometry = nextGeometry;
  stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  scene.add(stars);

  window.starfieldStats.rebuilds += 1;
  window.starfieldStats.stars = count;
  scheduleRender();
}

function render() {
  state.renderQueued = false;
  window.starfieldStats.renders += 1;
  camera.rotation.set(state.pitch, state.yaw, 0);
  renderer.render(scene, camera);
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(render);
}

function updateSliderFill(input, min, max) {
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function addRangeRow(param) {
  const row = document.createElement("div");
  row.className = "row";

  const top = document.createElement("div");
  top.className = "top";

  const label = document.createElement("label");
  label.textContent = param.label;

  const value = document.createElement("span");
  value.className = "val";

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(param.min);
  input.max = String(param.max);
  input.step = String(param.step);
  input.value = String(defaults[param.key]);

  function sync() {
    const nextValue = Number(input.value);
    value.textContent = param.format(nextValue);
    updateSliderFill(input, param.min, param.max);

    if (param.key === "uDensity" || param.key === "uSparsity") {
      fieldValues[param.key] = nextValue;
      rebuildStars();
      return;
    }

    uniforms[param.key].value = nextValue;
    scheduleRender();
  }

  input.addEventListener("input", sync);
  top.append(label, value);
  row.append(top, input);
  rows.append(row);
  sync();
}

function buildPanel() {
  PARAMS.forEach((param) => {
    if (param.group) {
      const group = document.createElement("div");
      group.className = "group";
      group.textContent = param.group;
      rows.append(group);
      return;
    }

    addRangeRow(param);
  });
}

function reseed() {
  seed = Math.random() * 1000;
  rebuildStars();
}

function recenter() {
  state.yaw = 0;
  state.pitch = 0;
  scheduleRender();
}

document.querySelector("#rebake").addEventListener("click", rebuildStars);
document.querySelector("#seedBtn").addEventListener("click", reseed);
document.querySelector("#recenterBtn").addEventListener("click", recenter);

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  uniforms.uPixelRatio.value = renderer.getPixelRatio();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  scheduleRender();
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  if (starGeometry) starGeometry.dispose();
  starMaterial.dispose();
  dome.geometry.dispose();
  domeMaterial.dispose();
  renderer.dispose();
});

buildPanel();
rebuildStars();
resize();
