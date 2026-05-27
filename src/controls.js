const PARAMS = [
  { group: "Display" },
  { key: "sphereSegments", label: "Sphere Segments", min: 16, max: 256, step: 16, format: (v) => v.toFixed(0), kind: "display" },
  { group: "Field" },
  { key: "uDensity", label: "Density", min: 10, max: 360, step: 1, format: (v) => v.toFixed(0) },
  { key: "uSparsity", label: "Sparsity", min: 0, max: 0.97, step: 0.005, format: (v) => v.toFixed(3) },
  { group: "Core" },
  { key: "uStarSize", label: "Star Size", min: 0.1, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uSizeVar", label: "Size Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: "uBright", label: "Brightness", min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uBrightVar", label: "Brightness Var", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { group: "Glare" },
  { key: "uGlareSize", label: "Glare Size", min: 0, max: 8, step: 0.1, format: (v) => v.toFixed(1) },
  { key: "uGlareStr", label: "Glare Strength", min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uGlareVar", label: "Glare Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { group: "Color" },
  { key: "uColorVar", label: "Color Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
];

function updateSliderFill(input, min, max) {
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function formatGpuStatsForPanel(stats) {
  return [
    "GPU Stats",
    `Memory: ${stats.estimatedTextureMemory}`,
    `Draws/Frame: ${stats.callFrames}`,
    `FOV: ${stats.horizontalFov}h/${stats.verticalFov}v`,
    `Polygons: ${stats.polygons}`,
    `Geometry: ${stats.geometries}`,
    `Textures: ${stats.textures}`,
    `Programs: ${stats.shaderPrograms}`,
    `Sphere: ${stats.sphereSegments}x${stats.sphereVerticalSegments}`,
    `Virtual: ${stats.virtualSize}`,
    `Patches: ${stats.patchGrid} (${stats.patchCount})`,
  ].join("\n");
}

export function createControls({ rows, buttons, starfield, getStats, onRecenter }) {
  const gpuStatsPanel = document.createElement("pre");
  gpuStatsPanel.id = "gpu-stats";
  gpuStatsPanel.setAttribute("aria-live", "polite");
  document.body.append(gpuStatsPanel);

  let textureSizeValue = null;
  let supersampleValue = null;
  let patchGridValue = null;
  let patchSizeValue = null;
  let internalSizeValue = null;

  function setBakeStatus(label, disabled = false) {
    buttons.bake.textContent = label;
    buttons.bake.disabled = disabled;
  }

  function refreshReadouts(readouts = starfield.getReadouts()) {
    if (textureSizeValue) textureSizeValue.textContent = String(readouts.bakeWidth);
    if (patchGridValue) patchGridValue.textContent = readouts.patchGrid;
    if (patchSizeValue) patchSizeValue.textContent = readouts.patchSize;
    if (supersampleValue) supersampleValue.textContent = readouts.supersample;
    if (internalSizeValue) internalSizeValue.textContent = readouts.internalPatchSize;
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
    input.value = String(starfield.defaults[param.key]);

    function paint(nextValue) {
      value.textContent = param.format(nextValue);
      updateSliderFill(input, param.min, param.max);
    }

    input.addEventListener("input", () => {
      const nextValue = Number(input.value);
      paint(nextValue);
      if (param.kind === "display") {
        starfield.setSphereSegments(nextValue);
        return;
      }
      starfield.setParam(param.key, nextValue, 180);
    });

    top.append(label, value);
    row.append(top, input);
    rows.append(row);
    paint(Number(input.value));
  }

  function addTextureSizeRow() {
    const readouts = starfield.getReadouts();
    const row = document.createElement("div");
    row.className = "row row--select";

    const top = document.createElement("div");
    top.className = "top";

    const label = document.createElement("label");
    label.textContent = "Virtual Size";

    textureSizeValue = document.createElement("span");
    textureSizeValue.className = "val";
    textureSizeValue.textContent = `${readouts.bakeWidth}`;

    const select = document.createElement("select");
    select.id = "bake-size";

    readouts.supportedBakeWidths.forEach((width) => {
      const option = document.createElement("option");
      option.value = String(width);
      option.textContent = `${width}x${width / 2}`;
      option.selected = width === readouts.bakeWidth;
      select.append(option);
    });

    select.addEventListener("change", () => {
      starfield.setBakeWidth(Number(select.value));
      refreshReadouts();
    });

    top.append(label, textureSizeValue);
    row.append(top, select);
    rows.append(row);
  }

  function addReadoutRow(labelText, getValue) {
    const row = document.createElement("div");
    row.className = "row row--readout";

    const top = document.createElement("div");
    top.className = "top";

    const label = document.createElement("label");
    label.textContent = labelText;

    const value = document.createElement("span");
    value.className = "val";
    value.textContent = getValue();

    top.append(label, value);
    row.append(top);
    rows.append(row);
    return value;
  }

  function addSupersampleRows() {
    const readouts = starfield.getReadouts();
    patchGridValue = addReadoutRow("Patch Grid", () => readouts.patchGrid);
    patchSizeValue = addReadoutRow("Patch Size", () => readouts.patchSize);
    supersampleValue = addReadoutRow("Supersample", () => readouts.supersample);
    internalSizeValue = addReadoutRow("Internal Patch Size", () => readouts.internalPatchSize);
    addReadoutRow("GPU Limit", () => readouts.gpuLimit);
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

    const group = document.createElement("div");
    group.className = "group";
    group.textContent = "Bake";
    rows.append(group);
    addTextureSizeRow();
    addSupersampleRows();
  }

  function showGpuStatsPanel(stats) {
    gpuStatsPanel.textContent = formatGpuStatsForPanel(stats);
    gpuStatsPanel.classList.add("is-visible");
  }

  function hideGpuStatsPanel() {
    gpuStatsPanel.classList.remove("is-visible");
  }

  function printGpuStats() {
    const stats = getStats();
    window.lastStarfieldGpuStats = stats;
    showGpuStatsPanel(stats);
    console.groupCollapsed("[Starfield GPU Stats]");
    console.table(stats);
    console.groupEnd();
  }

  function toggleGpuStatsPanel() {
    if (gpuStatsPanel.classList.contains("is-visible")) {
      hideGpuStatsPanel();
      return;
    }

    printGpuStats();
  }

  function handleGpuStatsHotkey(event) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    toggleGpuStatsPanel();
  }

  starfield.setBakeStatusHandler(setBakeStatus);
  starfield.setReadoutsChangeHandler(refreshReadouts);
  buttons.bake.addEventListener("click", () => starfield.bakeNow());
  buttons.seed.addEventListener("click", () => starfield.reseed());
  buttons.recenter.addEventListener("click", onRecenter);
  document.addEventListener("keydown", handleGpuStatsHotkey, true);
  window.printStarfieldGpuStats = printGpuStats;

  buildPanel();

  return {
    refreshReadouts,
    printGpuStats,
    dispose() {
      document.removeEventListener("keydown", handleGpuStatsHotkey, true);
      gpuStatsPanel.remove();
    },
  };
}
