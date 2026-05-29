import * as THREE from "three/webgpu";
import { NEBULA_MAX_ANCHORS, DEFAULT_FIELD_GRADIENT } from "./constants";
import type { FieldGradient, NebulaParams, NebulaUniforms } from "./types";

function vectorFromArray(value: unknown, fallback: [number, number, number] = [0, 0, 0]): THREE.Vector3 {
  const source = Array.isArray(value) && value.length >= 3 ? value : fallback;
  return new THREE.Vector3(Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0);
}

function normalizedVectorFromArray(value: unknown, fallback: [number, number, number] = [0, 0, 1]): THREE.Vector3 {
  const vector = vectorFromArray(value, fallback);
  if (vector.lengthSq() < 1e-8) return vectorFromArray(fallback).normalize();
  return vector.normalize();
}

export function applyFieldGradientToUniforms(
  uniforms: NebulaUniforms,
  gradient: Readonly<FieldGradient> = DEFAULT_FIELD_GRADIENT,
): void {
  const anchors = Array.isArray(gradient.anchors) ? gradient.anchors.slice(0, NEBULA_MAX_ANCHORS) : [];
  uniforms.uAnchorCount.value = anchors.length;
  uniforms.uBlend.value = gradient.blend === "gaussian" ? 1 : 0;
  uniforms.uPower.value = typeof gradient.power === "number" && Number.isFinite(gradient.power) ? gradient.power : 2;
  uniforms.uSigma.value = typeof gradient.sigma === "number" && Number.isFinite(gradient.sigma) ? gradient.sigma : 0.34;
  uniforms.uColorWarpAmp.value = Number.isFinite(gradient.warp?.amp)
    ? gradient.warp?.amp ?? uniforms.uColorWarpAmp.value
    : uniforms.uColorWarpAmp.value;
  uniforms.uColorWarpFreq.value = Number.isFinite(gradient.warp?.freq)
    ? gradient.warp?.freq ?? uniforms.uColorWarpFreq.value
    : uniforms.uColorWarpFreq.value;

  for (let index = 0; index < NEBULA_MAX_ANCHORS; index += 1) {
    const anchor = anchors[index];
    uniforms.uAnchorDir.value[index].copy(normalizedVectorFromArray(anchor?.dir));
    uniforms.uAnchorColor.value[index].copy(vectorFromArray(anchor?.color));
  }
}

export function createNebulaUniforms(
  params: NebulaParams,
  gradient: Readonly<FieldGradient> = DEFAULT_FIELD_GRADIENT,
): NebulaUniforms {
  const uniforms: NebulaUniforms = {
    uTileUvMin: { value: new THREE.Vector2(0, 0) },
    uTileUvSize: { value: new THREE.Vector2(1, 1) },
    uAnchorCount: { value: 0 },
    uBlend: { value: 1 },
    uPower: { value: 2 },
    uSigma: { value: 0.34 },
    uColorWarpAmp: { value: params.uColorWarpAmp },
    uColorWarpFreq: { value: params.uColorWarpFreq },
    uAnchorDir: { value: Array.from({ length: NEBULA_MAX_ANCHORS }, () => new THREE.Vector3(0, 0, 1)) },
    uAnchorColor: { value: Array.from({ length: NEBULA_MAX_ANCHORS }, () => new THREE.Vector3()) },
    uSeed: { value: params.uSeed },
    uCoverage: { value: params.uCoverage },
    uDensity: { value: params.uDensity },
    uSoftness: { value: params.uSoftness },
    uContrast: { value: params.uContrast },
    uBaseScale: { value: params.uBaseScale },
    uOctaves: { value: params.uOctaves },
    uOpacity: { value: params.uOpacity },
    uLightFocus: { value: params.uLightFocus },
    uLightLining: { value: params.uLightLining },
    uLightIntensity: { value: params.uLightIntensity },
    uNebulaStrength: { value: params.uNebulaStrength },
    uNebulaExposure: { value: params.uNebulaExposure },
    uCloudShadow: { value: vectorFromArray(params.uCloudShadow) },
    uCloudHighlight: { value: vectorFromArray(params.uCloudHighlight) },
    uCloudCore: { value: vectorFromArray(params.uCloudCore) },
  };

  applyFieldGradientToUniforms(uniforms, gradient);
  return uniforms;
}
