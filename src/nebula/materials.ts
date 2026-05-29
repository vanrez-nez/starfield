import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  PI,
  acos,
  atan,
  clamp,
  dot,
  exp,
  float,
  int,
  max,
  mix,
  modelViewProjection,
  mx_fractal_noise_float,
  normalize,
  positionGeometry,
  pow,
  select,
  sin,
  cos,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uniformTexture,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { NEBULA_MAX_ANCHORS } from "./constants";
import type {
  NebulaUniforms,
  PatchDescriptor,
  StarfieldMaterial,
  UniformMap,
  VisiblePatchTarget,
} from "./types";

function patchTextureUniform(textureValue: THREE.Texture): ReturnType<typeof uniformTexture> {
  return uniformTexture(textureValue);
}

function patchVectorUniform(value: THREE.Vector2): ReturnType<typeof uniform> {
  return uniform(value.clone());
}

function intervalError(value: any, intervalSize: any): any {
  return max(max(value.negate(), value.sub(intervalSize)), 0.0);
}

function storageLocalU(skyU: any, storageMinU: any, storageSizeU: any): any {
  const d0 = skyU.sub(storageMinU);
  const d1 = d0.add(1.0);
  const d2 = d0.sub(1.0);
  const e0 = intervalError(d0, storageSizeU);
  const e1 = intervalError(d1, storageSizeU);
  const e2 = intervalError(d2, storageSizeU);
  return (select as any)(
    e1.lessThan(e0).and(e1.lessThanEqual(e2)),
    d1,
    (select as any)(e2.lessThan(e0).and(e2.lessThan(e1)), d2, d0),
  ).div(storageSizeU);
}

function equirectDirectionFromUvNode(rawUv: any): any {
  const phi = rawUv.x.sub(0.5).mul(PI).mul(2.0);
  const theta = rawUv.y.mul(PI);
  const sinTheta = sin(theta);
  return normalize(vec3(sin(phi).mul(sinTheta), cos(theta), cos(phi).mul(sinTheta)));
}

function numberUniform(uniforms: UniformMap, key: string): any {
  const existing = uniforms[key] as unknown as { value: unknown; isUniformNode?: boolean };
  if (existing?.isUniformNode) return existing;
  const node = uniform(Number(existing?.value ?? 0));
  uniforms[key] = node as unknown as UniformMap[string];
  return node as any;
}

function vec2Uniform(uniforms: UniformMap, key: string): any {
  const existing = uniforms[key] as unknown as { value: unknown; isUniformNode?: boolean };
  if (existing?.isUniformNode) return existing;
  const value = existing?.value instanceof THREE.Vector2 ? existing.value.clone() : new THREE.Vector2();
  const node = uniform(value);
  uniforms[key] = node as unknown as UniformMap[string];
  return node as any;
}

function vec3Uniform(uniforms: UniformMap, key: string): any {
  const existing = uniforms[key] as unknown as { value: unknown; isUniformNode?: boolean };
  if (existing?.isUniformNode) return existing;
  const value = existing?.value instanceof THREE.Vector3 ? existing.value.clone() : new THREE.Vector3();
  const node = uniform(value);
  uniforms[key] = node as unknown as UniformMap[string];
  return node as any;
}

function fbm01Node(pInput: any, octavesInput: any, lacunarityInput: any, gainInput: any): any {
  const octaves = clamp(octavesInput, 1.0, 8.0);
  const lacunarity = max(lacunarityInput, 0.001);
  const gain = clamp(gainInput, 0.001, 0.999);
  const p = vec3(pInput).toVar();
  const amplitude = float(0.5).toVar();
  const sum = float(0.0).toVar();
  const norm = float(0.0).toVar();

  Loop(8, ({ i }: any) => {
    If(float(i).lessThan(octaves), () => {
      const octaveNoise = mx_fractal_noise_float(p, int(1), lacunarity, gain).mul(0.5).add(0.5);
      sum.addAssign(amplitude.mul(octaveNoise));
      norm.addAssign(amplitude);
      p.mulAssign(lacunarity);
      amplitude.mulAssign(gain);
    });
  });

  return sum.div(max(norm, 0.0001));
}

export function createLightCompositionBakeMaterial(uniforms: NebulaUniforms): StarfieldMaterial {
  const uniformMap = uniforms as UniformMap;
  const uTileUvMin = vec2Uniform(uniformMap, "uTileUvMin");
  const uTileUvSize = vec2Uniform(uniformMap, "uTileUvSize");
  const uAnchorCount = numberUniform(uniformMap, "uAnchorCount");
  const uBlend = numberUniform(uniformMap, "uBlend");
  const uPower = numberUniform(uniformMap, "uPower");
  const uSigma = numberUniform(uniformMap, "uSigma");
  const uColorWarpAmp = numberUniform(uniformMap, "uColorWarpAmp");
  const uColorWarpFreq = numberUniform(uniformMap, "uColorWarpFreq");
  const uSeed = numberUniform(uniformMap, "uSeed");
  const uCoverage = numberUniform(uniformMap, "uCoverage");
  const uDensity = numberUniform(uniformMap, "uDensity");
  const uSoftness = numberUniform(uniformMap, "uSoftness");
  const uContrast = numberUniform(uniformMap, "uContrast");
  const uBaseScale = numberUniform(uniformMap, "uBaseScale");
  const uOctaves = numberUniform(uniformMap, "uOctaves");
  const uOpacity = numberUniform(uniformMap, "uOpacity");
  const uLightFocus = numberUniform(uniformMap, "uLightFocus");
  const uLightLining = numberUniform(uniformMap, "uLightLining");
  const uLightIntensity = numberUniform(uniformMap, "uLightIntensity");
  const uNebulaStrength = numberUniform(uniformMap, "uNebulaStrength");
  const uCloudShadow = vec3Uniform(uniformMap, "uCloudShadow");
  const uCloudHighlight = vec3Uniform(uniformMap, "uCloudHighlight");
  const uCloudCore = vec3Uniform(uniformMap, "uCloudCore");
  const anchorDirs = uniformArray(uniforms.uAnchorDir.value, "vec3") as any;
  const anchorColors = uniformArray(uniforms.uAnchorColor.value, "vec3") as any;

  const material = new THREE.MeshBasicNodeMaterial({
    depthWrite: false,
    depthTest: false,
  }) as unknown as StarfieldMaterial & { colorNode: unknown };
  material.uniforms = uniformMap;

  material.colorNode = Fn(() => {
    const fullscreenUv = positionGeometry.xy.mul(0.5).add(0.5);
    const skyUv = uTileUvMin.add(fullscreenUv.mul(uTileUvSize));
    const dir = equirectDirectionFromUvNode(skyUv);
    const octaves = clamp(uOctaves, 1.0, 8.0);

    const warpP = dir.mul(max(uColorWarpFreq, 0.001)).add(vec3(uSeed, uSeed.mul(0.37), uSeed.mul(-0.21)));
    const warpVec = vec3(
      fbm01Node(warpP, octaves, 2.02, 0.52),
      fbm01Node(warpP.add(vec3(5.2, 1.3, 7.1)), octaves, 2.03, 0.50),
      fbm01Node(warpP.add(vec3(9.1, 8.4, 2.8)), octaves, 2.01, 0.51),
    ).mul(2.0).sub(1.0);
    const warpedDir = normalize(dir.add(warpVec.mul(max(uColorWarpAmp, 0.0))));

    const lightField = vec3(0.0).toVar();
    const weightSum = float(0.0).toVar();
    Loop(NEBULA_MAX_ANCHORS, ({ i }: any) => {
      If(float(i).lessThan(uAnchorCount), () => {
        const anchorDir = normalize(anchorDirs.element(i));
        const anchorColor = anchorColors.element(i);
        const dist = float(1.0).sub(dot(warpedDir, anchorDir));
        const idwWeight = float(1.0).div(pow(dist.add(0.0001), max(uPower, 0.0001)));
        const gaussianWeight = exp(dist.mul(dist).negate().div((max as any)(0.0001, float(2.0).mul(uSigma).mul(uSigma))));
        const weight = (select as any)(uBlend.lessThan(0.5), idwWeight, gaussianWeight);
        lightField.addAssign(anchorColor.mul(weight));
        weightSum.addAssign(weight);
      });
    });
    lightField.assign(lightField.div(max(weightSum, 0.0001)));

    const seedOffset = vec3(uSeed.mul(13.17), uSeed.mul(-7.31), uSeed.mul(5.19));
    const p = dir.mul(max(uBaseScale, 0.001)).add(seedOffset);
    const q = vec3(
      fbm01Node(p, octaves, 2.02, 0.5),
      fbm01Node(p.add(vec3(5.2, 1.3, 2.8)), octaves, 2.02, 0.5),
      fbm01Node(p.add(vec3(2.1, 4.7, 9.2)), octaves, 2.02, 0.5),
    );
    const cloudNoise = clamp(fbm01Node(p.add(q.mul(3.0)), octaves, 2.02, 0.5), 0.0, 1.0);
    const coverage = clamp(uCoverage, 0.02, 0.98);
    const density = pow(clamp(smoothstep(coverage, coverage.add(max(uSoftness, 0.001)), cloudNoise), 0.0, 1.0), max(uContrast, 0.05));
    const lightMask = clamp(max(max(lightField.r, lightField.g), lightField.b).mul(max(uLightIntensity, 0.0)), 0.0, 1.0);
    const lit = pow(lightMask, max(uLightFocus, 0.001));
    const highlight = lightField.mul(uCloudHighlight).mul(max(uLightIntensity, 0.0));
    const cloudColor = mix(mix(uCloudShadow, highlight, lit), uCloudCore, clamp(density.mul(0.4), 0.0, 1.0))
      .add(lightField.mul(lit).mul(density.oneMinus()).mul(max(uLightLining, 0.0)).mul(max(uLightIntensity, 0.0)))
      .mul(max(uDensity, 0.0));
    const nebulaRgb = (pow as any)((max as any)(cloudColor, vec3(0.0)), vec3(0.92));
    const alpha = clamp(density.mul(uOpacity), 0.0, 1.0);
    const baseLinear = vec3(0.004, 0.005, 0.011);
    const colorLinear = baseLinear.add(nebulaRgb.mul(alpha).mul(max(uNebulaStrength, 0.0)));
    return vec4((max as any)(colorLinear, vec3(0.0)), 1.0);
  })();

  return material;
}

export function createNebulaPatchDomeMaterial({
  descriptor,
  visibleTarget,
  nebulaExposure = 1,
}: {
  descriptor: PatchDescriptor;
  visibleTarget: VisiblePatchTarget;
  nebulaExposure?: number;
}): StarfieldMaterial {
  const sampling = visibleTarget.starfieldSampling ?? {
    innerOffset: descriptor.innerOffset,
    innerScale: descriptor.innerScale,
    storageUvMin: descriptor.storageUvMin,
    storageUvSize: descriptor.storageUvSize,
  };
  const uniforms: UniformMap = {
    uCurrentTexture: { value: visibleTarget.texture },
    uNextTexture: { value: visibleTarget.texture },
    uBlend: { value: 0 },
    uContentUvMin: { value: descriptor.uvMin.clone() },
    uContentUvSize: { value: descriptor.uvSize.clone() },
    uCurrentInnerOffset: { value: sampling.innerOffset.clone() },
    uCurrentInnerScale: { value: sampling.innerScale.clone() },
    uNextInnerOffset: { value: sampling.innerOffset.clone() },
    uNextInnerScale: { value: sampling.innerScale.clone() },
    uCurrentStorageUvMin: { value: sampling.storageUvMin.clone() },
    uCurrentStorageUvSize: { value: sampling.storageUvSize.clone() },
    uNextStorageUvMin: { value: sampling.storageUvMin.clone() },
    uNextStorageUvSize: { value: sampling.storageUvSize.clone() },
    uNebulaExposure: { value: nebulaExposure },
  };

  const uCurrentTexture = patchTextureUniform(uniforms.uCurrentTexture.value as THREE.Texture);
  const uNextTexture = patchTextureUniform(uniforms.uNextTexture.value as THREE.Texture);
  const uBlend = uniform(uniforms.uBlend.value as number) as any;
  const uContentUvMin = patchVectorUniform(uniforms.uContentUvMin.value as THREE.Vector2) as any;
  const uContentUvSize = patchVectorUniform(uniforms.uContentUvSize.value as THREE.Vector2) as any;
  const uCurrentStorageUvMin = patchVectorUniform(uniforms.uCurrentStorageUvMin.value as THREE.Vector2) as any;
  const uCurrentStorageUvSize = patchVectorUniform(uniforms.uCurrentStorageUvSize.value as THREE.Vector2) as any;
  const uNextStorageUvMin = patchVectorUniform(uniforms.uNextStorageUvMin.value as THREE.Vector2) as any;
  const uNextStorageUvSize = patchVectorUniform(uniforms.uNextStorageUvSize.value as THREE.Vector2) as any;
  const uNebulaExposure = numberUniform(uniforms, "uNebulaExposure");

  uniforms.uCurrentTexture = uCurrentTexture as unknown as UniformMap[string];
  uniforms.uNextTexture = uNextTexture as unknown as UniformMap[string];
  uniforms.uBlend = uBlend as unknown as UniformMap[string];
  uniforms.uContentUvMin = uContentUvMin as unknown as UniformMap[string];
  uniforms.uContentUvSize = uContentUvSize as unknown as UniformMap[string];
  uniforms.uCurrentStorageUvMin = uCurrentStorageUvMin as unknown as UniformMap[string];
  uniforms.uCurrentStorageUvSize = uCurrentStorageUvSize as unknown as UniformMap[string];
  uniforms.uNextStorageUvMin = uNextStorageUvMin as unknown as UniformMap[string];
  uniforms.uNextStorageUvSize = uNextStorageUvSize as unknown as UniformMap[string];

  const vDirection = varyingProperty("vec3", "vNebulaPatchDirection") as any;
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: false,
    depthWrite: false,
    depthTest: false,
  }) as unknown as StarfieldMaterial & { vertexNode: unknown; colorNode: unknown };
  material.uniforms = uniforms;
  material.vertexNode = Fn(() => {
    vDirection.assign(positionGeometry);
    return modelViewProjection;
  })();
  material.colorNode = Fn(() => {
    const skyUv = uContentUvMin.add(uv().mul(uContentUvSize));
    const currentPatchUv = clamp(vec2(
      storageLocalU(skyUv.x, uCurrentStorageUvMin.x, uCurrentStorageUvSize.x),
      skyUv.y.sub(uCurrentStorageUvMin.y).div(uCurrentStorageUvSize.y),
    ), 0.0, 1.0);
    const nextPatchUv = clamp(vec2(
      storageLocalU(skyUv.x, uNextStorageUvMin.x, uNextStorageUvSize.x),
      skyUv.y.sub(uNextStorageUvMin.y).div(uNextStorageUvSize.y),
    ), 0.0, 1.0);

    const currentColor = texture(uCurrentTexture, currentPatchUv);
    const nextColor = texture(uNextTexture, nextPatchUv);
    const mixedColor = mix(currentColor, nextColor, clamp(uBlend, 0.0, 1.0));
    const mapped = vec3(1.0).sub(exp((max as any)(mixedColor.rgb, vec3(0.0)).mul(max(uNebulaExposure, 0.001)).negate()));
    return vec4(mapped, 1.0);
  })();

  return material;
}
