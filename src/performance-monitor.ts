import type { StarfieldStats } from "./starfield/types";

export type FrameStageName =
  | "resize"
  | "timer"
  | "orbit"
  | "camera"
  | "gpuField"
  | "starfield"
  | "render"
  | "ui";

export type FrameStageDurations = Partial<Record<FrameStageName, number>>;

export interface RuntimePerformanceSample {
  timeMs: number;
  deltaMs: number;
  droppedFrames: number;
  deadlineMissed: boolean;
  cadenceMissed: boolean;
  cadenceOverrunMs: number;
  cadenceJitterMs: number;
  stages: FrameStageDurations;
}

interface CreateFramePerformanceMonitorArgs {
  targetFps: number;
  historySeconds: number;
}

const STAGE_ORDER: FrameStageName[] = [
  "resize",
  "timer",
  "orbit",
  "camera",
  "gpuField",
  "starfield",
  "render",
  "ui",
];
const STAGE_INDEX = new Map<FrameStageName, number>(STAGE_ORDER.map((stage, index) => [stage, index]));
const CADENCE_MISS_EPSILON_MS = 0.25;
const DROPPED_FRAME_SLOT_THRESHOLD = 1.5;

interface LongTaskSample {
  timeMs: number;
  durationMs: number;
  name: string;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * ratio)),
  );
  return sortedValues[index] ?? 0;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatStageSummary(stageValues: Map<FrameStageName, number>, maxEntries = 4): string {
  const entries = [...stageValues.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEntries);
  return entries.length
    ? entries.map(([stage, value]) => `${stage}:${formatMs(value)}`).join(", ")
    : "none";
}

export function createFramePerformanceMonitor({
  targetFps,
  historySeconds,
}: CreateFramePerformanceMonitorArgs) {
  const frameBudgetMs = 1000 / Math.max(1, targetFps);
  const historyWindowMs = Math.max(1, historySeconds) * 1000;
  const sampleCapacity = Math.max(120, Math.ceil((historyWindowMs / frameBudgetMs) * 4));
  const sampleTimeMs = new Float64Array(sampleCapacity);
  const sampleDeltaMs = new Float32Array(sampleCapacity);
  const sampleDroppedFrames = new Uint16Array(sampleCapacity);
  const sampleDeadlineMissed = new Uint8Array(sampleCapacity);
  const sampleCadenceMissed = new Uint8Array(sampleCapacity);
  const sampleCadenceOverrunMs = new Float32Array(sampleCapacity);
  const sampleCadenceJitterMs = new Float32Array(sampleCapacity);
  const sampleStageMs = new Float32Array(sampleCapacity * STAGE_ORDER.length);
  const longTasks: LongTaskSample[] = [];
  let longTaskObserver: PerformanceObserver | null = null;
  let writeIndex = 0;
  let sampleCount = 0;
  let skipNextSample = false;

  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    longTaskObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        longTasks.push({
          timeMs: entry.startTime + entry.duration,
          durationMs: entry.duration,
          name: entry.name || entry.entryType,
        });
      });
      trim(performance.now());
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  }

  function trim(nowMs: number): void {
    const cutoff = nowMs - historyWindowMs;
    while (longTasks.length > 0 && longTasks[0].timeMs < cutoff) {
      longTasks.shift();
    }
  }

  function recentSampleIndices(nowMs = performance.now()): number[] {
    const cutoff = nowMs - historyWindowMs;
    const indices: number[] = [];
    const oldestIndex = (writeIndex - sampleCount + sampleCapacity) % sampleCapacity;

    for (let offset = 0; offset < sampleCount; offset += 1) {
      const index = (oldestIndex + offset) % sampleCapacity;
      if (sampleTimeMs[index] >= cutoff) {
        indices.push(index);
      }
    }

    return indices;
  }

  function record(deltaSeconds: number, stages: FrameStageDurations, timestampMs = performance.now()): void {
    if (skipNextSample) {
      skipNextSample = false;
      trim(timestampMs);
      return;
    }

    const nowMs = finiteOrZero(timestampMs);
    const deltaMs = Math.max(0, finiteOrZero(deltaSeconds) * 1000);
    const rawFrameSlots = deltaMs / frameBudgetMs;
    const droppedFrames = rawFrameSlots >= DROPPED_FRAME_SLOT_THRESHOLD
      ? Math.max(0, Math.round(rawFrameSlots) - 1)
      : 0;
    const expectedFrameSlots = droppedFrames + 1;
    const cadenceDeltaMs = deltaMs - expectedFrameSlots * frameBudgetMs;
    const cadenceJitterMs = Math.abs(cadenceDeltaMs);
    const cadenceOverrunMs = Math.max(0, cadenceDeltaMs);
    const deadlineMissed = droppedFrames > 0 || cadenceDeltaMs > CADENCE_MISS_EPSILON_MS;
    const cadenceMissed = droppedFrames === 0 && cadenceJitterMs > CADENCE_MISS_EPSILON_MS;

    const index = writeIndex;
    sampleTimeMs[index] = nowMs;
    sampleDeltaMs[index] = deltaMs;
    sampleDroppedFrames[index] = droppedFrames;
    sampleDeadlineMissed[index] = deadlineMissed ? 1 : 0;
    sampleCadenceMissed[index] = cadenceMissed ? 1 : 0;
    sampleCadenceOverrunMs[index] = cadenceOverrunMs;
    sampleCadenceJitterMs[index] = cadenceJitterMs;
    const stageOffset = index * STAGE_ORDER.length;
    STAGE_ORDER.forEach((stage, stageIndex) => {
      sampleStageMs[stageOffset + stageIndex] = finiteOrZero(stages[stage] ?? 0);
    });
    writeIndex = (writeIndex + 1) % sampleCapacity;
    sampleCount = Math.min(sampleCapacity, sampleCount + 1);
    trim(nowMs);
  }

  function reset(): void {
    writeIndex = 0;
    sampleCount = 0;
    longTasks.length = 0;
    skipNextSample = true;
  }

  function history(): RuntimePerformanceSample[] {
    return recentSampleIndices().map((index) => {
      const stageOffset = index * STAGE_ORDER.length;
      const stages: FrameStageDurations = {};
      STAGE_ORDER.forEach((stage, stageIndex) => {
        stages[stage] = sampleStageMs[stageOffset + stageIndex] ?? 0;
      });

      return {
        timeMs: sampleTimeMs[index] ?? 0,
        deltaMs: sampleDeltaMs[index] ?? 0,
        droppedFrames: sampleDroppedFrames[index] ?? 0,
        deadlineMissed: sampleDeadlineMissed[index] === 1,
        cadenceMissed: sampleCadenceMissed[index] === 1,
        cadenceOverrunMs: sampleCadenceOverrunMs[index] ?? 0,
        cadenceJitterMs: sampleCadenceJitterMs[index] ?? 0,
        stages,
      };
    });
  }

  function collectStats(): StarfieldStats {
    const sampleIndices = recentSampleIndices();
    const deltas = sampleIndices.map((index) => sampleDeltaMs[index] ?? 0).filter((delta) => delta > 0);
    const sortedDeltas = [...deltas].sort((a, b) => a - b);
    const frameCount = sampleIndices.length;
    const cadenceMissFrames = sampleIndices.reduce((acc, index) => acc + sampleCadenceMissed[index], 0);
    const deadlineMissFrames = sampleIndices.reduce((acc, index) => acc + sampleDeadlineMissed[index], 0);
    const cadenceOverrunMs = sampleIndices.reduce((acc, index) => acc + (sampleCadenceOverrunMs[index] ?? 0), 0);
    const cadenceJitterValues = sampleIndices.map((index) => sampleCadenceJitterMs[index] ?? 0).sort((a, b) => a - b);
    const cadenceJitterMs = sum(cadenceJitterValues);
    const totalDeltaMs = sum(deltas);
    const droppedFrames = sampleIndices.reduce((acc, index) => acc + sampleDroppedFrames[index], 0);
    const expectedFrames = frameCount + droppedFrames;
    const avgFrameMs = frameCount > 0 ? totalDeltaMs / frameCount : 0;
    const avgFps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
    const p95FrameMs = percentile(sortedDeltas, 0.95);
    const p99FrameMs = percentile(sortedDeltas, 0.99);
    const maxFrameMs = sortedDeltas[sortedDeltas.length - 1] ?? 0;
    const pacedFps = p95FrameMs > 0 ? 1000 / p95FrameMs : 0;
    const hitchFrames = sampleIndices.filter((index) => sampleDroppedFrames[index] > 0).length;
    const longTaskDurations = longTasks.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const longTaskMax = longTaskDurations[longTaskDurations.length - 1] ?? 0;
    const longTaskTotal = sum(longTaskDurations);
    const recentLongTasks = longTasks
      .slice(-3)
      .map((sample) => `${sample.name}:${formatMs(sample.durationMs)}`)
      .join(", ");
    const stageAvg = new Map<FrameStageName, number>();
    const stageP95 = new Map<FrameStageName, number>();
    const stageMax = new Map<FrameStageName, number>();

    STAGE_ORDER.forEach((stage) => {
      const stageIndex = STAGE_INDEX.get(stage) ?? 0;
      const values = sampleIndices
        .map((index) => sampleStageMs[index * STAGE_ORDER.length + stageIndex] ?? 0)
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      if (values.length === 0) return;
      stageAvg.set(stage, sum(values) / values.length);
      stageP95.set(stage, percentile(values, 0.95));
      stageMax.set(stage, values[values.length - 1] ?? 0);
    });

    const worstStage = [...stageP95.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      perfTargetFps: targetFps,
      perfFrameBudgetMs: frameBudgetMs,
      perfCadenceMissEpsilonMs: CADENCE_MISS_EPSILON_MS,
      perfHistorySeconds: historySeconds,
      perfFrameCount: frameCount,
      perfExpectedFrames: expectedFrames,
      perfDroppedFrames: droppedFrames,
      perfDropRate: expectedFrames > 0 ? droppedFrames / expectedFrames : 0,
      perfDeadlineMissFrames: deadlineMissFrames,
      perfDeadlineMissRate: frameCount > 0 ? deadlineMissFrames / frameCount : 0,
      perfCadenceMissFrames: cadenceMissFrames,
      perfCadenceMissRate: frameCount > 0 ? cadenceMissFrames / frameCount : 0,
      perfCadenceOverrunMs: cadenceOverrunMs,
      perfAverageCadenceOverrunMs: frameCount > 0 ? cadenceOverrunMs / frameCount : 0,
      perfCadenceJitterMs: cadenceJitterMs,
      perfAverageCadenceJitterMs: frameCount > 0 ? cadenceJitterMs / frameCount : 0,
      perfP95CadenceJitterMs: percentile(cadenceJitterValues, 0.95),
      perfHitchFrames: hitchFrames,
      perfHitchRate: frameCount > 0 ? hitchFrames / frameCount : 0,
      perfLongTaskCount: longTasks.length,
      perfLongTaskTotalMs: longTaskTotal,
      perfLongTaskMaxMs: longTaskMax,
      perfLongTaskSummary: recentLongTasks || "none",
      perfAverageFps: avgFps,
      perfPacedFps: pacedFps,
      perfAverageFrameMs: avgFrameMs,
      perfP95FrameMs: p95FrameMs,
      perfP99FrameMs: p99FrameMs,
      perfMaxFrameMs: maxFrameMs,
      perfWorstStage: worstStage ? `${worstStage[0]} ${formatMs(worstStage[1])} p95` : "none",
      perfStageAvgSummary: formatStageSummary(stageAvg),
      perfStageP95Summary: formatStageSummary(stageP95),
      perfStageMaxSummary: formatStageSummary(stageMax),
    };
  }

  return {
    record,
    reset,
    history,
    collectStats,
    dispose(): void {
      longTaskObserver?.disconnect();
      longTaskObserver = null;
    },
  };
}
