const PARAMS = [
  { group: "Display" },
  { key: "sphereSegments", label: "Sphere Segments", min: 16, max: 256, step: 16, format: (v) => v.toFixed(0), kind: "display" },
  { group: "Adaptive" },
  { key: "adaptiveResolution", label: "Adaptive Resolution", kind: "adaptiveToggle", format: (v) => (v ? "On" : "Off") },
  { key: "targetTexelsPerPixel", label: "Target Texels/Pixel", min: 0.5, max: 3, step: 0.05, format: (v) => v.toFixed(2), kind: "adaptive" },
  { key: "minPatchSize", label: "Min Patch Size", min: 128, max: 4096, step: 128, format: (v) => v.toFixed(0), kind: "adaptive" },
  { key: "maxPatchSize", label: "Max Patch Size", min: 256, max: 8192, step: 256, format: (v) => v.toFixed(0), kind: "adaptive" },
  { key: "patchBudgetMb", label: "Patch Budget", min: 16, max: 512, step: 16, format: (v) => `${v.toFixed(0)} MB`, kind: "adaptive" },
  { key: "centerBias", label: "Center Bias", min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2), kind: "adaptive" },
  {
    key: "sparseMode",
    label: "Sparse Mode",
    kind: "adaptiveSelect",
    options: [
      { value: "full", label: "Full Grid" },
      { value: "visible", label: "Visible Only" },
      { value: "center", label: "Center Weighted" },
      { value: "density", label: "Density Weighted" },
    ],
    format: (v) => ({
      full: "Full",
      visible: "Visible",
      center: "Center",
      density: "Density",
    }[v] ?? "Full"),
  },
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

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(digits);
}

function formatInteger(value) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

function formatGpuStatsForPanel(stats) {
  return [
    "GPU Stats",
    `Memory: ${stats.estimatedTextureMemory}`,
    `Draws/Frame: ${stats.callFrames}`,
    `FOV: ${stats.horizontalFov}h/${stats.verticalFov}v`,
    `Screen: ${stats.screenSize ?? "0x0"}`,
    `Polygons: ${stats.polygons}`,
    `Geometry: ${stats.geometries}`,
    `Textures: ${stats.textures}`,
    `Programs: ${stats.shaderPrograms}`,
    `Sphere: ${stats.sphereSegments}x${stats.sphereVerticalSegments}`,
    "",
    "Bake",
    `Virtual: ${stats.virtualSize}`,
    `Patches: ${stats.patchGrid} (${stats.patchCount})`,
    `Patch Size: ${stats.patchSize}`,
    `Patch Storage: ${stats.patchStorageSize}`,
    `Internal Patch: ${stats.internalPatchSize}`,
    `Supersample: ${stats.supersample}`,
    `GPU Limit: ${stats.maxTextureSize}`,
    "",
    "Descriptors",
    `Count: ${stats.patchDescriptorCount ?? stats.patchCount ?? 0}`,
    `Resident: ${stats.residentPatchCount ?? 0}`,
    `Allocated: ${stats.allocatedPatchCount ?? 0}`,
    `Fallbacks: ${stats.fallbackPatchCount ?? 0}`,
    `Next Targets: ${stats.nextTargetPatchCount ?? 0}`,
    `Downgraded: ${stats.downgradedPatchCount ?? 0}`,
    `States: ${stats.patchStateSummary ?? "none"}`,
    `Allocations: ${stats.allocationStateSummary ?? "none"}`,
    `Required Buckets: ${stats.descriptorRequiredBucketSummary ?? "none"}`,
    `Target Buckets: ${stats.descriptorTargetBucketSummary ?? "none"}`,
    `Density Pressure: ${formatNumber(stats.descriptorDensityPressure, 4)}/px`,
    `Density Fallbacks: ${stats.descriptorDensityFallbackCount ?? 0}`,
    `Bright Pressure: ${formatNumber(stats.descriptorBrightStarPressure, 4)}/px`,
    "",
    "Priority",
    `Highest: ${stats.highestPriorityPatch ?? "none"}`,
    `Range: ${formatNumber(stats.lowestPriority, 1)}-${formatNumber(stats.highestPriority, 1)}`,
    `Top: ${stats.topPrioritySummary ?? "none"}`,
    "",
    "Adaptive",
    `Enabled: ${stats.adaptiveResolution ? "yes" : "no"}`,
    `Target Texels/Pixel: ${formatNumber(stats.targetTexelsPerPixel, 2)}x`,
    `Patch Limits: ${formatInteger(stats.minPatchSize)}-${formatInteger(stats.maxPatchSize)}`,
    `Patch Budget: ${stats.patchBudgetMemory ?? "0 B"}`,
    `Center Bias: ${formatNumber(stats.centerBias, 2)}`,
    `Sparse Mode: ${stats.sparseMode ?? "full"}`,
    `Effective Sparse: ${stats.effectiveSparseMode ?? "full"}`,
    `Sparse Wanted: ${stats.sparseWantedPatchCount ?? 0}`,
    `Sparse Resident: ${stats.sparseResidentPatchCount ?? 0}`,
    `Sparse Evicted: ${stats.sparseEvictedPatchCount ?? 0}`,
    `Sparse Fallbacks: ${stats.sparseFallbackPatchCount ?? 0}`,
    `Sparse Visible: ${stats.sparseVisiblePatchCount ?? 0}`,
    `Sparse Budget: ${stats.sparseBudgetUsedMemory ?? "0 B"} (${formatPercent(stats.sparseBudgetRatio)})`,
    `Sparse Selection: ${stats.sparseSelectionSummary ?? "none"}`,
    `Recommended Raster: ${stats.recommendedActualRasterSize ?? "0x0"}`,
    `Recommended Storage: ${stats.recommendedPatchStorageSize ?? "0x0"}`,
    `Recommended Resident: ${stats.recommendedResidentTextureMemory ?? "0 B"} (${formatPercent(stats.recommendedResidentBudgetRatio)})`,
    "",
    "Screen Demand",
    `CSS Size: ${stats.cssSize ?? "0x0"}`,
    `Pixel Ratio: ${formatNumber(stats.pixelRatio, 2)}x`,
    `Pixels/Deg: ${formatNumber(stats.pixelsPerDegreeX, 1)}x${formatNumber(stats.pixelsPerDegreeY, 1)}`,
    `Pixels/Rad: ${formatNumber(stats.pixelsPerRadianX, 0)}x${formatNumber(stats.pixelsPerRadianY, 0)}`,
    `Texels/Pixel: ${formatNumber(stats.texelsPerPixelTarget, 2)}x`,
    `Patch Angle: ${formatNumber(stats.patchAngularWidthDeg, 1)}x${formatNumber(stats.patchAngularHeightDeg, 1)}`,
    `Projected Patch: ${formatNumber(stats.projectedPatchWidthPixels, 0)}x${formatNumber(stats.projectedPatchHeightPixels, 0)}`,
    `Required Texels: ${stats.requiredPatchTexels ?? "0x0"}`,
    `Recommended Bucket: ${stats.recommendedPatchBucket ?? 0}`,
    `Current Patch: ${formatInteger(stats.currentPatchSize)}`,
    `Oversample: ${formatNumber(stats.oversampleRatio, 2)}x`,
    `Undersample: ${stats.undersampleWarning ? "yes" : "no"}`,
    "",
    "Density Demand",
    `Total Stars: ${formatInteger(stats.totalStarCount)}`,
    `Stars/Patch: ${formatInteger(stats.estimatedStarsPerPatch)}`,
    `Projected Pixels: ${formatInteger(stats.projectedPatchPixels)}`,
    `Stars/Pixel: ${formatNumber(stats.starsPerProjectedPixel, 4)}`,
    `Bright Stars: ${formatInteger(stats.brightStarCount)}`,
    `Density Scale: ${formatNumber(stats.densityScale, 2)}x`,
    `Density Fallback: ${stats.densityFallbackWarning ? "yes" : "no"}`,
    "",
    "Catalog Classes",
    `Tiny: ${formatInteger(stats.tinyStarCount)}`,
    `Normal: ${formatInteger(stats.normalStarCount)}`,
    `Bright: ${formatInteger(stats.brightStarClassCount)}`,
    `Hero: ${formatInteger(stats.heroStarCount)}`,
    `Density Candidates: ${formatInteger(stats.densityCandidateStarCount)}`,
    `Baked Candidates: ${formatInteger(stats.bakedCandidateStarCount)}`,
    `Overlay Candidates: ${formatInteger(stats.overlayCandidateStarCount)}`,
    `Overlay Enabled: ${stats.overlayEnabled ? "yes" : "no"}`,
    `Overlay Stars: ${formatInteger(stats.overlayStarCount)}`,
    `Overlay Instances: ${formatInteger(stats.overlayStarInstances)}`,
    `Overlay Tris: ${formatInteger(stats.overlayTriangleCount)}`,
    `Overlay Draws: ${formatInteger(stats.overlayDrawCalls)}`,
    `Tile Aware: ${stats.tileAwareGeneration ? "yes" : "no"}`,
    `Query Grid: ${stats.starQueryGrid ?? "0x0"}`,
    `Last Query Patch: ${stats.lastStarQueryPatchId ?? "none"}`,
    `Last Query Stars: ${formatInteger(stats.lastStarQueryStarCount)}`,
    `Last Query Instances: ${formatInteger(stats.lastStarQueryInstanceCount)}`,
    `Last Query Cells: ${formatInteger(stats.lastStarQueryCellCount)}`,
    `Patch Query Stars: ${stats.queriedPatchStarSummary ?? "none"}`,
    `Summary: ${stats.starClassSummary ?? "none"}`,
    "",
    "Star Policy",
    `Min Core Pixels: ${formatNumber(stats.minCorePixels, 2)}`,
    `Min Glare Pixels: ${formatNumber(stats.minGlarePixels, 2)}`,
    `Density Threshold: ${formatNumber(stats.subpixelDensityThresholdPx, 2)}px`,
    `AA Pin Threshold: ${formatNumber(stats.aaPinThresholdPx, 2)}px`,
    `Subpixel Mode: ${stats.subpixelEnergyMode ?? "density-pin-normal"}`,
    "",
    "Memory Budget",
    `Resident: ${stats.residentTextureMemory ?? "0 B"} (${formatPercent(stats.residentBudgetRatio)})`,
    `Bake Scratch: ${stats.bakeScratchMemory ?? "0 B"}`,
    `Pooled Memory: ${stats.pooledTargetMemory ?? "0 B"}`,
    `Total Allocated: ${stats.totalAllocatedMemory ?? "0 B"} (${formatPercent(stats.totalAllocatedBudgetRatio)})`,
    `Active Targets: ${stats.activeTargetCount ?? 0}`,
    `Pooled Targets: ${stats.pooledTargetCount ?? 0}`,
    `Pooled Buckets: ${stats.pooledTargetSummary ?? "none"}`,
    `Alloc Count: ${stats.allocationCount ?? 0}`,
    `Bake Jobs: ${stats.activeBakeJobs ?? 0} active / ${stats.pendingBakeJobs ?? 0} pending`,
    `Active Blends: ${stats.activeBlendCount ?? 0}`,
    `Active Job: ${stats.activeBakeJobId ?? "none"}`,
    `Completed Jobs: ${stats.completedBakeJobs ?? 0}/${stats.totalQueuedBakeJobs ?? 0}`,
    `Jobs/Frame: ${stats.maxBakeJobsPerFrame ?? 0}`,
    `Queue Idle: ${stats.queueIdle ? "yes" : "no"}`,
    `Pending Top: ${stats.pendingBakeJobSummary ?? "none"}`,
    `Resident Over Budget: ${stats.residentBudgetExceeded ? "yes" : "no"}`,
    `Total Over Budget: ${stats.totalAllocatedBudgetExceeded ? "yes" : "no"}`,
  ].join("\n");
}

export function createControls({ rows, buttons, starfield, getStats, onRecenter }) {
  const gpuStatsPanel = document.createElement("pre");
  gpuStatsPanel.id = "gpu-stats";
  gpuStatsPanel.setAttribute("aria-live", "polite");
  document.body.append(gpuStatsPanel);

  let textureSizeValue = null;
  let updatingStatsPanel = false;
  let uxVisible = true;

  function isUxVisible() {
    return uxVisible;
  }

  function setUxVisible(nextVisible) {
    uxVisible = nextVisible;
    document.body.classList.toggle("is-ux-hidden", !uxVisible);

    if (uxVisible) {
      showGpuStatsPanel(collectStatsForPanel());
      return;
    }

    hideGpuStatsPanel();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function collectStatsForPanel() {
    updatingStatsPanel = true;
    try {
      return getStats();
    } finally {
      updatingStatsPanel = false;
    }
  }

  function refreshVisibleStatsPanel() {
    if (updatingStatsPanel || !isUxVisible() || !gpuStatsPanel.classList.contains("is-visible")) return;
    showGpuStatsPanel(collectStatsForPanel());
  }

  function setBakeStatus(label, disabled = false) {
    buttons.bake.textContent = label;
    buttons.bake.disabled = disabled;
  }

  function refreshReadouts(readouts = starfield.getReadouts()) {
    if (textureSizeValue) textureSizeValue.textContent = String(readouts.bakeWidth);
    refreshVisibleStatsPanel();
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
      if (param.kind === "adaptive") {
        starfield.setAdaptiveParam(param.key, nextValue);
        return;
      }
      starfield.setParam(param.key, nextValue, 180);
    });

    top.append(label, value);
    row.append(top, input);
    rows.append(row);
    paint(Number(input.value));
  }

  function addToggleRow(param) {
    const row = document.createElement("div");
    row.className = "row row--toggle";

    const top = document.createElement("div");
    top.className = "top";

    const label = document.createElement("label");
    label.textContent = param.label;

    const value = document.createElement("span");
    value.className = "val";

    const switchControl = document.createElement("div");
    switchControl.className = "switch";

    const input = document.createElement("input");
    input.id = `control-${param.key}`;
    input.type = "checkbox";
    input.checked = Boolean(starfield.defaults[param.key]);
    label.htmlFor = input.id;

    const track = document.createElement("span");
    track.className = "switch-track";

    function paint(nextValue) {
      value.textContent = param.format(nextValue);
    }

    input.addEventListener("change", () => {
      paint(input.checked);
      starfield.setAdaptiveParam(param.key, input.checked);
    });
    switchControl.addEventListener("click", (event) => {
      if (event.target === input) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    top.append(label, value);
    switchControl.append(input, track);
    row.append(top, switchControl);
    rows.append(row);
    paint(input.checked);
  }

  function addSelectRow(param) {
    const row = document.createElement("div");
    row.className = "row row--select";

    const top = document.createElement("div");
    top.className = "top";

    const label = document.createElement("label");
    label.textContent = param.label;

    const value = document.createElement("span");
    value.className = "val";

    const select = document.createElement("select");
    select.id = `control-${param.key}`;
    label.htmlFor = select.id;

    param.options.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      optionElement.selected = option.value === starfield.defaults[param.key];
      select.append(optionElement);
    });

    function paint(nextValue) {
      value.textContent = param.format(nextValue);
    }

    select.addEventListener("change", () => {
      paint(select.value);
      starfield.setAdaptiveParam(param.key, select.value);
    });

    top.append(label, value);
    row.append(top, select);
    rows.append(row);
    paint(select.value);
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

  function buildPanel() {
    PARAMS.forEach((param) => {
      if (param.group) {
        const group = document.createElement("div");
        group.className = "group";
        group.textContent = param.group;
        rows.append(group);
        return;
      }

      if (param.kind === "adaptiveToggle") {
        addToggleRow(param);
        return;
      }

      if (param.kind === "adaptiveSelect") {
        addSelectRow(param);
        return;
      }

      addRangeRow(param);
    });

    const group = document.createElement("div");
    group.className = "group";
    group.textContent = "Bake";
    rows.append(group);
    addTextureSizeRow();
  }

  function showGpuStatsPanel(stats) {
    gpuStatsPanel.textContent = formatGpuStatsForPanel(stats);
    gpuStatsPanel.classList.add("is-visible");
  }

  function hideGpuStatsPanel() {
    gpuStatsPanel.classList.remove("is-visible");
  }

  function printGpuStats() {
    setUxVisible(true);
    const stats = collectStatsForPanel();
    window.lastStarfieldGpuStats = stats;
    showGpuStatsPanel(stats);
    console.groupCollapsed("[Starfield GPU Stats]");
    console.table(stats);
    console.groupEnd();
  }

  function toggleUxVisibility() {
    setUxVisible(!uxVisible);
  }

  function handleUxHotkey(event) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    toggleUxVisibility();
  }

  starfield.setBakeStatusHandler(setBakeStatus);
  starfield.setReadoutsChangeHandler(refreshReadouts);
  buttons.bake.addEventListener("click", () => starfield.bakeNow());
  buttons.seed.addEventListener("click", () => starfield.reseed());
  buttons.recenter.addEventListener("click", onRecenter);
  document.addEventListener("keydown", handleUxHotkey, true);
  window.printStarfieldGpuStats = printGpuStats;

  buildPanel();

  return {
    refreshReadouts,
    printGpuStats,
    dispose() {
      document.removeEventListener("keydown", handleUxHotkey, true);
      document.body.classList.remove("is-ux-hidden");
      gpuStatsPanel.remove();
    },
  };
}
