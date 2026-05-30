import type { StarfieldStats } from "./starfield/types";
import type { RuntimePerformanceSample } from "./performance-monitor";

declare global {
  interface Window {
    starfieldStats?: StarfieldStats;
    lastStarfieldGpuStats?: StarfieldStats;
    printStarfieldGpuStats?: () => void;
    starfieldPerfHistory?: () => RuntimePerformanceSample[];
    resetStarfieldPerfHistory?: () => void;
  }
}

export {};
