const PARAMS = [
  { group: "Display" },
  { key: "sphereSegments", label: "Sphere Segments", min: 16, max: 256, step: 16, format: (v) => v.toFixed(0), kind: "display" },
  { group: "Field" },
  { key: "uDensity", label: "Density", min: 10, max: 360, step: 1, format: (v) => v.toFixed(0) },
  { key: "uSparsity", label: "Sparsity", min: 0, max: 0.97, step: 0.005, format: (v) => v.toFixed(3) },
  { group: "Core" },
  { key: "uStarSize", label: "Star Size", min: 0.1, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uSizeVar", label: "Size Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: "uLargeStarRarity", label: "Large Star Rarity", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: "uBright", label: "Brightness", min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uBrightVar", label: "Brightness Var", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { group: "Glare" },
  { key: "uGlareSize", label: "Glare Size", min: 0, max: 8, step: 0.1, format: (v) => v.toFixed(1) },
  { key: "uGlareStr", label: "Glare Strength", min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "uGlareVar", label: "Glare Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { group: "Color" },
  { key: "uColorVar", label: "Color Variance", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
];

const STATS_PANEL_REFRESH_MS = 250;

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

function formatSizeWithOptimal(value, optimal, capped) {
  const label = value ?? "0x0";
  if (!capped || !optimal) return label;
  return `${label} (optimal ${optimal})`;
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
    `Auto Virtual: ${formatSizeWithOptimal(stats.autoVirtualSize ?? stats.virtualSize, stats.optimalVirtualSize, stats.autoVirtualSizeCapped)}`,
    `Ideal Virtual: ${stats.idealVirtualSize ?? stats.optimalVirtualSize ?? "0x0"}`,
    `Effective Virtual: ${stats.effectiveVirtualSize ?? stats.autoVirtualSize ?? stats.virtualSize ?? "0x0"}`,
    `Quality Scale: ${formatPercent(stats.qualityScale)}`,
    `Auto Grid: ${stats.autoPatchGrid ?? stats.patchGrid} (${stats.patchCount})`,
    `Auto Reason: ${stats.autoLayoutReason ?? "automatic"}`,
    `Patch Size: ${formatSizeWithOptimal(stats.patchSize, stats.optimalPatchSize, stats.patchSizeCapped)}`,
    `Patch Storage: ${formatSizeWithOptimal(stats.patchStorageSize, stats.optimalPatchStorageSize, stats.patchStorageSizeCapped)}`,
    `Internal Patch: ${formatSizeWithOptimal(stats.internalPatchSize, stats.optimalInternalPatchSize, stats.internalPatchSizeCapped)}`,
    `Supersample: ${stats.supersample}`,
    `GPU Limit: ${stats.maxTextureSize}`,
    "",
    "Descriptors",
    `Count: ${stats.patchDescriptorCount ?? stats.patchCount ?? 0}`,
    `Resident: ${stats.residentPatchCount ?? 0}`,
    `Allocated: ${stats.allocatedPatchCount ?? 0}`,
    `Fallbacks: ${stats.fallbackPatchCount ?? 0}`,
    `Next Targets: ${stats.nextTargetPatchCount ?? 0}`,
    `Layer Dirty: ${stats.layerDirtyPatchCount ?? 0}`,
    `Pending Layers: ${stats.pendingLayerPatchCount ?? 0}`,
    `Catalog Dirty: ${stats.catalogDirty ? "yes" : "no"}`,
    `Layout Pending: ${stats.pendingAutoLayout ? "yes" : "no"}`,
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
    "Allocation",
    `Automatic: yes`,
    `Allocation Budget: ${stats.allocationBudgetMemory ?? stats.patchBudgetMemory ?? "0 B"}`,
    `Resident: ${stats.residentTextureMemory ?? "0 B"} (${formatPercent(stats.residentBudgetRatio)})`,
    `Scratch: ${stats.bakeScratchMemory ?? "0 B"}`,
    `Pool: ${stats.pooledTargetMemory ?? "0 B"}`,
    `Total Allocated: ${stats.totalAllocatedMemory ?? "0 B"} (${formatPercent(stats.totalAllocatedBudgetRatio)})`,
    `Peak Estimate: ${stats.estimatedBakeScratchMemory ?? "0 B"} scratch`,
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
  const gpuStatsPanel = document.createElement("div");
  gpuStatsPanel.id = "gpu-stats";
  gpuStatsPanel.setAttribute("aria-live", "polite");
  document.body.append(gpuStatsPanel);

  let updatingStatsPanel = false;
  let uxVisible = true;
  let statsRefreshTimer = 0;
  let lastStatsRefreshAt = 0;
  const collapsedStatsGroups = new Set();

  function isUxVisible() {
    return uxVisible;
  }

  function setUxVisible(nextVisible) {
    uxVisible = nextVisible;
    document.body.classList.toggle("is-ux-hidden", !uxVisible);

    if (uxVisible) {
      refreshVisibleStatsPanel({ force: true });
      return;
    }

    hideGpuStatsPanel();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function collectStatsForPanel(options = {}) {
    updatingStatsPanel = true;
    try {
      return getStats(options);
    } finally {
      updatingStatsPanel = false;
    }
  }

  function scheduleNextStatsPanelRefresh() {
    if (statsRefreshTimer || !isUxVisible() || !gpuStatsPanel.classList.contains("is-visible")) return;
    statsRefreshTimer = window.setTimeout(() => {
      statsRefreshTimer = 0;
      refreshVisibleStatsPanel({ force: true });
    }, STATS_PANEL_REFRESH_MS);
  }

  function refreshVisibleStatsPanel({ force = false } = {}) {
    if (updatingStatsPanel || !isUxVisible()) return;
    if (!force && !gpuStatsPanel.classList.contains("is-visible")) return;
    const now = performance.now();
    const elapsed = now - lastStatsRefreshAt;

    if (!force && elapsed < STATS_PANEL_REFRESH_MS) {
      if (!statsRefreshTimer) {
        statsRefreshTimer = window.setTimeout(() => {
          statsRefreshTimer = 0;
          refreshVisibleStatsPanel({ force: true });
        }, STATS_PANEL_REFRESH_MS - elapsed);
      }
      return;
    }

    lastStatsRefreshAt = now;
    showGpuStatsPanel(collectStatsForPanel({ detail: "panel" }));
    scheduleNextStatsPanelRefresh();
  }

  function setBakeStatus(label, disabled = false) {
    buttons.bake.textContent = label;
    buttons.bake.disabled = disabled;
  }

  function setOverlayButtonState(enabled) {
    if (!buttons.overlay) return;
    buttons.overlay.setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  function toggleOverlay() {
    const nextEnabled = !starfield.getBrightStarOverlayEnabled();
    starfield.setBrightStarOverlayEnabled(nextEnabled);
    setOverlayButtonState(starfield.getBrightStarOverlayEnabled());
    refreshVisibleStatsPanel({ force: true });
  }

  function refreshReadouts() {
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
  }

  function createStatsGroups(stats) {
    const groups = [];
    let currentGroup = null;

    formatGpuStatsForPanel(stats)
      .split("\n")
      .forEach((line) => {
        if (!line) {
          currentGroup = null;
          return;
        }

        if (!currentGroup) {
          currentGroup = { title: line, lines: [] };
          groups.push(currentGroup);
          return;
        }

        currentGroup.lines.push(line);
      });

    return groups;
  }

  function renderGpuStatsGroups(stats) {
    const fragment = document.createDocumentFragment();
    const groups = createStatsGroups(stats);

    groups.forEach((group) => {
      const details = document.createElement("details");
      details.className = "gpu-stats-group";
      details.open = !collapsedStatsGroups.has(group.title);
      details.dataset.group = group.title;

      const summary = document.createElement("summary");
      summary.className = "gpu-stats-summary";
      summary.textContent = group.title;

      const lines = document.createElement("pre");
      lines.className = "gpu-stats-lines";
      lines.textContent = group.lines.join("\n");

      details.addEventListener("toggle", () => {
        if (details.open) {
          collapsedStatsGroups.delete(group.title);
          return;
        }
        collapsedStatsGroups.add(group.title);
      });

      details.append(summary, lines);
      fragment.append(details);
    });

    gpuStatsPanel.replaceChildren(fragment);
  }

  function showGpuStatsPanel(stats) {
    renderGpuStatsGroups(stats);
    gpuStatsPanel.classList.add("is-visible");
  }

  function hideGpuStatsPanel() {
    clearTimeout(statsRefreshTimer);
    statsRefreshTimer = 0;
    gpuStatsPanel.classList.remove("is-visible");
  }

  function printGpuStats() {
    setUxVisible(true);
    const stats = collectStatsForPanel({ detail: "debug" });
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
  buttons.overlay?.addEventListener("click", toggleOverlay);
  document.addEventListener("keydown", handleUxHotkey, true);
  window.printStarfieldGpuStats = printGpuStats;

  buildPanel();
  setOverlayButtonState(starfield.getBrightStarOverlayEnabled());

  return {
    refreshReadouts,
    printGpuStats,
    dispose() {
      clearTimeout(statsRefreshTimer);
      buttons.overlay?.removeEventListener("click", toggleOverlay);
      document.removeEventListener("keydown", handleUxHotkey, true);
      document.body.classList.remove("is-ux-hidden");
      gpuStatsPanel.remove();
    },
  };
}
