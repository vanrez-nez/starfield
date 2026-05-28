import type { StarfieldStats } from "./starfield/types";

declare global {
  interface Window {
    starfieldStats?: StarfieldStats;
    lastStarfieldGpuStats?: StarfieldStats;
    printStarfieldGpuStats?: () => void;
  }
}

export {};
