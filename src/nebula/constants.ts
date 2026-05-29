import type { FieldGradient, NebulaParams } from "./types";

export const NEBULA_MAX_ANCHORS = 8;
export const DEFAULT_NEBULA_RADIUS = 10;
export const MIN_NEBULA_SPHERE_SEGMENTS = 128;

export const DEFAULT_NEBULA_PARAMS: Readonly<NebulaParams> = Object.freeze({
  uSeed: 2.4,
  uCoverage: 0.42,
  uDensity: 1.1,
  uSoftness: 0.28,
  uContrast: 1.35,
  uBaseScale: 2.4,
  uOctaves: 4,
  uOpacity: 1,
  uLightFocus: 1.55,
  uLightLining: 0.22,
  uLightIntensity: 0.85,
  uNebulaStrength: 4,
  uNebulaExposure: 2.4,
  uColorWarpAmp: 0.045,
  uColorWarpFreq: 2.2,
  uCloudShadow: [0.004, 0.006, 0.018],
  uCloudHighlight: [0.3, 0.36, 0.72],
  uCloudCore: [0.025, 0.03, 0.07],
});

export const DEFAULT_FIELD_GRADIENT: Readonly<FieldGradient> = Object.freeze({
  type: "gradient",
  mode: "field",
  blend: "gaussian",
  sigma: 0.34,
  power: 2,
  warp: { amp: DEFAULT_NEBULA_PARAMS.uColorWarpAmp, freq: DEFAULT_NEBULA_PARAMS.uColorWarpFreq },
  anchors: [
    { dir: [0.26, 0.18, 0.95] as [number, number, number], color: [0.14, 0.19, 0.46] as [number, number, number] },
    { dir: [-0.72, 0.34, 0.6] as [number, number, number], color: [0.18, 0.08, 0.22] as [number, number, number] },
    { dir: [0.62, -0.46, -0.64] as [number, number, number], color: [0.05, 0.12, 0.28] as [number, number, number] },
    { dir: [-0.18, -0.82, -0.54] as [number, number, number], color: [0.13, 0.15, 0.2] as [number, number, number] },
  ],
});

export function cloneNebulaParams(params: Readonly<NebulaParams> = DEFAULT_NEBULA_PARAMS): NebulaParams {
  return {
    ...params,
    uCloudShadow: [...params.uCloudShadow],
    uCloudHighlight: [...params.uCloudHighlight],
    uCloudCore: [...params.uCloudCore],
  };
}
