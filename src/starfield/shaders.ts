import * as THREE from "three/webgpu";
import {
  Discard,
  Fn,
  If,
  Loop,
  PI,
  acos,
  abs,
  attribute,
  atan,
  cameraProjectionMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  int,
  length,
  max,
  min,
  mix,
  mod,
  modelViewMatrix,
  mx_fractal_noise_float,
  normalize,
  positionGeometry,
  modelViewProjection,
  pow,
  select,
  sin,
  sqrt,
  smoothstep,
  step,
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
import {
  AA_PIN_THRESHOLD_PX,
  GAUSSIAN_CUTOFF_SIGMA,
  LIGHT_COMPOSITION_MAX_ANCHORS,
  MIN_CORE_PIXELS,
  MIN_GLARE_PIXELS,
  STAR_SIZE_BRIGHTNESS_LINK,
  STAR_SIZE_GATE_EXPONENT,
  STAR_SIZE_GLARE_LINK,
  STAR_SIZE_MIN_SCALE,
  STAR_SIZE_RARITY_EXPONENT,
  SUBPIXEL_DENSITY_THRESHOLD_PX,
} from "./constants";
import type {
  BackgroundUniforms,
  BakeUniforms,
  DownsampleUniforms,
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

function directionToEquirectUv(direction: any): any {
  const dir = normalize(direction) as any;
  const u = (atan as any)(dir.x, dir.z).div(PI.mul(2.0)).add(0.5);
  const v = acos(clamp(dir.y, -1.0, 1.0)).div(PI);
  return vec2(u, v);
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

function createPatchNodeMaterial({
  uniforms,
  background = false,
}: {
  uniforms: UniformMap;
  background?: boolean;
}): StarfieldMaterial {
  const uCurrentTexture = patchTextureUniform(uniforms.uCurrentTexture.value as THREE.Texture);
  const uNextTexture = patchTextureUniform(uniforms.uNextTexture.value as THREE.Texture);
  const uBlend = uniform(uniforms.uBlend.value as number) as any;
  const uContentUvMin = patchVectorUniform(uniforms.uContentUvMin.value as THREE.Vector2) as any;
  const uContentUvSize = patchVectorUniform(uniforms.uContentUvSize.value as THREE.Vector2) as any;
  const uCurrentInnerOffset = patchVectorUniform(uniforms.uCurrentInnerOffset.value as THREE.Vector2) as any;
  const uCurrentInnerScale = patchVectorUniform(uniforms.uCurrentInnerScale.value as THREE.Vector2) as any;
  const uNextInnerOffset = patchVectorUniform(uniforms.uNextInnerOffset.value as THREE.Vector2) as any;
  const uNextInnerScale = patchVectorUniform(uniforms.uNextInnerScale.value as THREE.Vector2) as any;
  uniforms.uCurrentTexture = uCurrentTexture as unknown as UniformMap[string];
  uniforms.uNextTexture = uNextTexture as unknown as UniformMap[string];
  uniforms.uBlend = uBlend as unknown as UniformMap[string];
  uniforms.uContentUvMin = uContentUvMin as unknown as UniformMap[string];
  uniforms.uContentUvSize = uContentUvSize as unknown as UniformMap[string];
  uniforms.uCurrentInnerOffset = uCurrentInnerOffset as unknown as UniformMap[string];
  uniforms.uCurrentInnerScale = uCurrentInnerScale as unknown as UniformMap[string];
  uniforms.uNextInnerOffset = uNextInnerOffset as unknown as UniformMap[string];
  uniforms.uNextInnerScale = uNextInnerScale as unknown as UniformMap[string];

  const uCurrentStorageUvMin = background
    ? patchVectorUniform(uniforms.uCurrentStorageUvMin.value as THREE.Vector2) as any
    : null;
  const uCurrentStorageUvSize = background
    ? patchVectorUniform(uniforms.uCurrentStorageUvSize.value as THREE.Vector2) as any
    : null;
  const uNextStorageUvMin = background
    ? patchVectorUniform(uniforms.uNextStorageUvMin.value as THREE.Vector2) as any
    : null;
  const uNextStorageUvSize = background
    ? patchVectorUniform(uniforms.uNextStorageUvSize.value as THREE.Vector2) as any
    : null;
  if (background && uCurrentStorageUvMin && uCurrentStorageUvSize && uNextStorageUvMin && uNextStorageUvSize) {
    uniforms.uCurrentStorageUvMin = uCurrentStorageUvMin as unknown as UniformMap[string];
    uniforms.uCurrentStorageUvSize = uCurrentStorageUvSize as unknown as UniformMap[string];
    uniforms.uNextStorageUvMin = uNextStorageUvMin as unknown as UniformMap[string];
    uniforms.uNextStorageUvSize = uNextStorageUvSize as unknown as UniformMap[string];
  }
  const uNebulaExposure = background ? numberUniform(uniforms, "uNebulaExposure") : null;

  const vDirection = varyingProperty("vec3", background ? "vBackgroundPatchDirection" : "vStarPatchDirection") as any;
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: !background,
    depthWrite: false,
    depthTest: false,
  }) as unknown as StarfieldMaterial & { vertexNode: unknown; colorNode: unknown };

  if (!background) {
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }

  material.uniforms = uniforms;
  material.vertexNode = Fn(() => {
    vDirection.assign(positionGeometry);
    return modelViewProjection;
  })();
  material.colorNode = Fn(() => {
    const skyUv = background
      ? uContentUvMin.add(uv().mul(uContentUvSize))
      : directionToEquirectUv(vDirection);
    let currentPatchUv: any;
    let nextPatchUv: any;

    if (background && uCurrentStorageUvMin && uCurrentStorageUvSize && uNextStorageUvMin && uNextStorageUvSize) {
      currentPatchUv = clamp(vec2(
        storageLocalU(skyUv.x, uCurrentStorageUvMin.x, uCurrentStorageUvSize.x),
        skyUv.y.sub(uCurrentStorageUvMin.y).div(uCurrentStorageUvSize.y),
      ), 0.0, 1.0);
      nextPatchUv = clamp(vec2(
        storageLocalU(skyUv.x, uNextStorageUvMin.x, uNextStorageUvSize.x),
        skyUv.y.sub(uNextStorageUvMin.y).div(uNextStorageUvSize.y),
      ), 0.0, 1.0);
    } else {
      const localUv = skyUv.sub(uContentUvMin).div(uContentUvSize);
      const clampedLocalUv = clamp(localUv, 0.0, 1.0);
      currentPatchUv = uCurrentInnerOffset.add(clampedLocalUv.mul(uCurrentInnerScale));
      nextPatchUv = uNextInnerOffset.add(clampedLocalUv.mul(uNextInnerScale));
    }

    const currentColor = texture(uCurrentTexture, currentPatchUv);
    const nextColor = texture(uNextTexture, nextPatchUv);
    const mixedColor = mix(currentColor, nextColor, clamp(uBlend, 0.0, 1.0));
    if (background && uNebulaExposure) {
      const mapped = vec3(1.0).sub(exp((max as any)(mixedColor.rgb, vec3(0.0)).mul(max(uNebulaExposure, 0.001)).negate()));
      return vec4(mapped, 1.0);
    }
    return mixedColor;
  })();

  return material;
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

function starColorNode(t: any): any {
  const cool = vec3(1.0, 0.55, 0.30);
  const mid = vec3(1.0, 0.96, 0.92);
  const hot = vec3(0.70, 0.80, 1.0);
  return (select as any)(
    t.lessThan(0.5),
    mix(cool, mid, t.mul(2.0)),
    mix(mid, hot, t.sub(0.5).mul(2.0)),
  );
}

function sizeRankNode(rSize: any, rSizeGate: any, uLargeStarRarity: any): any {
  const baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
  const gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
  return baseRank.mul(gate);
}

function sizeMultiplierNode(rSize: any, rSizeGate: any, uLargeStarRarity: any, uSizeVar: any): any {
  return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, sizeRankNode(rSize, rSizeGate, uLargeStarRarity)), uSizeVar);
}

const OVERLAY_STAR_SIZE_RARITY_EXPONENT = 2.8;
const OVERLAY_STAR_SIZE_GATE_EXPONENT = 5.0;
const OVERLAY_STAR_SIZE_GATE_MIN = 0.25;

function overlaySizeRankNode(rSize: any, rSizeGate: any, uLargeStarRarity: any): any {
  const baseRank = pow(clamp(rSize, 0.0, 1.0), OVERLAY_STAR_SIZE_RARITY_EXPONENT);
  const gateRank = pow(clamp(rSizeGate, 0.0, 1.0), OVERLAY_STAR_SIZE_GATE_EXPONENT);
  const gate = mix(1.0, mix(OVERLAY_STAR_SIZE_GATE_MIN, 1.0, gateRank), uLargeStarRarity);
  return clamp(baseRank.mul(gate), 0.0, 1.0);
}

function overlaySizeMultiplierNode(rSize: any, rSizeGate: any, uLargeStarRarity: any, uSizeVar: any): any {
  return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, overlaySizeRankNode(rSize, rSizeGate, uLargeStarRarity)), uSizeVar);
}

function angularPixelNode(textureSize: any, uTileUvSize: any): any {
  return PI.mul(max(uTileUvSize.y, 1e-6)).div(max(textureSize.y, 1.0));
}

function foldEquirectUvNode(rawUv: any): any {
  const v = mod(rawUv.y, 2.0);
  const folded = step(1.0, v);
  return vec2(rawUv.x.add(folded.mul(0.5)), mix(v, float(2.0).sub(v), folded));
}

function equirectDirectionNode(rawUv: any): any {
  const uv = foldEquirectUvNode(rawUv) as any;
  const theta = uv.x.sub(0.5).mul(PI).mul(2.0);
  const phi = uv.y.mul(PI);
  const sinPhi = sin(phi);
  return normalize(vec3(sinPhi.mul(sin(theta)), cos(phi), sinPhi.mul(cos(theta))));
}

function equirectDirectionFromUvNode(rawUv: any): any {
  const phi = rawUv.x.sub(0.5).mul(PI).mul(2.0);
  const theta = rawUv.y.mul(PI);
  const sinTheta = sin(theta);
  return normalize(vec3(sin(phi).mul(sinTheta), cos(theta), cos(phi).mul(sinTheta)));
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

function hash11Node(p: any): any {
  return fract(sin(p.mul(127.1)).mul(43758.5453123));
}

function hash41Node(p: any): any {
  return fract(sin(dot(p, vec4(12.9898, 78.233, 37.719, 11.135))).mul(43758.5453123));
}

function noise1Node(x: any): any {
  const i = floor(x);
  const f = fract(x).toVar();
  f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
  return mix(hash11Node(i), hash11Node(i.add(1.0)), f);
}

function groupedBurstNode(seed: any, phase: any, speed: any, uTime: any): any {
  const group = floor(seed.mul(4.0));
  const groupWave = sin(uTime.mul(1.35).add(group.mul(PI).mul(0.5)));
  const groupPulse = smoothstep(0.34, 0.98, groupWave.mul(0.5).add(0.5));
  const localPulse = smoothstep(0.45, 1.0, noise1Node(uTime.mul(speed).add(phase)));
  return groupPulse.mul(mix(0.45, 1.0, localPulse));
}

function sizeRangeMaskNode(visualSizePx: any, uEffectMinSize: any, uEffectMaxSize: any): any {
  const minSize = min(uEffectMinSize, uEffectMaxSize);
  const maxSize = max(uEffectMinSize, uEffectMaxSize);
  const lower = (select as any)(
    minSize.lessThanEqual(0.0001),
    1.0,
    smoothstep(minSize, minSize.add(0.35), visualSizePx),
  );
  const upper = smoothstep(maxSize, maxSize.add(0.35), visualSizePx).oneMinus();
  const valid = step(0.0001, maxSize).mul(step(0.0001, maxSize.sub(minSize)));
  return clamp(lower.mul(upper), 0.0, 1.0).mul(valid);
}

function rotate2Node(p: any, angle: any): any {
  const s = sin(angle);
  const c = cos(angle);
  return (vec2 as any)(c.mul(p.x).sub(s.mul(p.y)), s.mul(p.x).add(c.mul(p.y)));
}

function makeAdditiveMaterial(uniforms: UniformMap): StarfieldMaterial & { vertexNode: unknown; colorNode: unknown } {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  }) as unknown as StarfieldMaterial & { vertexNode: unknown; colorNode: unknown };
  material.uniforms = uniforms;
  return material;
}

export function createStarMaterial(uniforms: BakeUniforms): StarfieldMaterial {
  const uniformMap = uniforms as UniformMap;
  const uBakeSize = vec2Uniform(uniformMap, "uBakeSize");
  const uOutputSize = vec2Uniform(uniformMap, "uOutputSize");
  const uTileUvMin = vec2Uniform(uniformMap, "uTileUvMin");
  const uTileUvSize = vec2Uniform(uniformMap, "uTileUvSize");
  const uScreenPixelAngle = numberUniform(uniformMap, "uScreenPixelAngle");
  const uStarSize = numberUniform(uniformMap, "uStarSize");
  const uSizeVar = numberUniform(uniformMap, "uSizeVar");
  const uLargeStarRarity = numberUniform(uniformMap, "uLargeStarRarity");
  const uBright = numberUniform(uniformMap, "uBright");
  const uBrightVar = numberUniform(uniformMap, "uBrightVar");
  const uGlareSize = numberUniform(uniformMap, "uGlareSize");
  const uGlareStr = numberUniform(uniformMap, "uGlareStr");
  const uGlareVar = numberUniform(uniformMap, "uGlareVar");
  const uColorVar = numberUniform(uniformMap, "uColorVar");

  const vUv = varyingProperty("vec2", "vStarBakeUv") as any;
  const vDirection = varyingProperty("vec3", "vStarBakeDirection") as any;
  const vRandoms = varyingProperty("vec4", "vStarBakeRandoms") as any;
  const vSizeGate = varyingProperty("float", "vStarBakeSizeGate") as any;
  const vClass = varyingProperty("float", "vStarBakeClass") as any;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  }) as unknown as StarfieldMaterial & { vertexNode: unknown; colorNode: unknown };
  material.uniforms = uniformMap;

  material.vertexNode = Fn(() => {
    const iDirection = attribute("iDirection", "vec3") as any;
    const iUv = attribute("iUv", "vec2") as any;
    const iRandoms = attribute("iRandoms", "vec4") as any;
    const iSizeGate = attribute("iSizeGate", "float") as any;
    const iClass = attribute("iClass", "float") as any;

    const bakeAngularPx = angularPixelNode(uBakeSize, uTileUvSize);
    const outputAngularPx = angularPixelNode(uOutputSize, uTileUvSize);
    const scale = sizeMultiplierNode(iRandoms.x, iSizeGate, uLargeStarRarity, uSizeVar);
    const starRadius = uStarSize.mul(scale).mul(uScreenPixelAngle);
    const screenRadiusPx = uStarSize.mul(scale);
    const pinWeight = smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX, AA_PIN_THRESHOLD_PX, screenRadiusPx).oneMinus();
    const normalCoreFloor = float(MIN_CORE_PIXELS).mul(max(outputAngularPx, uScreenPixelAngle));
    const pinCoreFloor = max(outputAngularPx, uScreenPixelAngle.mul(0.5));
    const coreSupportRadius = max(starRadius, mix(normalCoreFloor, pinCoreFloor, pinWeight));
    const coreSigma = max(coreSupportRadius.mul(0.45), bakeAngularPx);
    const normalWeight = smoothstep(AA_PIN_THRESHOLD_PX, AA_PIN_THRESHOLD_PX + 0.25, screenRadiusPx);
    const glareRadius = uGlareSize.mul(mix(1.0, scale, uSizeVar)).mul(uScreenPixelAngle);
    const glareSupportEdge = max(starRadius.add(glareRadius), float(MIN_GLARE_PIXELS).mul(max(outputAngularPx, uScreenPixelAngle)));
    const glareSigma = max(glareSupportEdge.mul(0.36), bakeAngularPx).mul(normalWeight)
      .mul(step(0.000001, uGlareSize))
      .mul(step(0.000001, uGlareStr));
    const supportAngle = max(coreSigma, glareSigma).mul(GAUSSIAN_CUTOFF_SIGMA);
    const sinPhi = max(sin(iUv.y.mul(PI)), 0.015);
    const halfUv = vec2(
      min(1.5, supportAngle.div(PI.mul(2.0).mul(sinPhi))),
      supportAngle.div(PI),
    );
    const splatUv = iUv.add(positionGeometry.xy.mul(halfUv));
    const patchUv = splatUv.sub(uTileUvMin).div(uTileUvSize);

    vUv.assign(splatUv);
    vDirection.assign(iDirection);
    vRandoms.assign(iRandoms);
    vSizeGate.assign(iSizeGate);
    vClass.assign(iClass);
    return vec4(patchUv.mul(2.0).sub(1.0), 0.0, 1.0);
  })();

  material.colorNode = Fn(() => {
    const dir = equirectDirectionNode(vUv);
    const angularDistance = acos(clamp(dot(dir, normalize(vDirection) as any), -1.0, 1.0));
    const bakeAngularPx = angularPixelNode(uBakeSize, uTileUvSize);
    const rank = sizeRankNode(vRandoms.x, vSizeGate, uLargeStarRarity);
    const scale = sizeMultiplierNode(vRandoms.x, vSizeGate, uLargeStarRarity, uSizeVar);
    const starRadius = uStarSize.mul(scale).mul(uScreenPixelAngle);
    const screenRadiusPx = uStarSize.mul(scale);
    const subpixelWeight = smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX * 0.75, SUBPIXEL_DENSITY_THRESHOLD_PX, screenRadiusPx).oneMinus();
    const normalWeight = smoothstep(AA_PIN_THRESHOLD_PX, AA_PIN_THRESHOLD_PX + 0.25, screenRadiusPx);
    const coreRadius = max(starRadius, uScreenPixelAngle.mul(0.1));
    const densityEnergy = max(0.08, smoothstep(0.0, SUBPIXEL_DENSITY_THRESHOLD_PX, screenRadiusPx));
    const coreEnergy = mix(1.0, densityEnergy, subpixelWeight);
    const coreSigma = max(coreRadius.mul(0.45), bakeAngularPx.mul(0.5));
    const core = exp(angularDistance.mul(angularDistance).negate().div(max(coreSigma.mul(coreSigma).mul(2.0), 1e-10))).mul(coreEnergy);

    const glareRadius = uGlareSize.mul(mix(1.0, scale, uSizeVar)).mul(uScreenPixelAngle);
    const glareEdge = max(starRadius.add(glareRadius), uScreenPixelAngle.mul(0.1));
    const glareSigma = max(glareEdge.mul(0.36), bakeAngularPx.mul(0.5));
    const glare = exp(angularDistance.mul(angularDistance).negate().div(max(glareSigma.mul(glareSigma).mul(2.0), 1e-10)))
      .mul(normalWeight)
      .mul(step(0.000001, uGlareSize))
      .mul(step(0.000001, uGlareStr));

    const linkedBrightRand = mix(vRandoms.y, max(vRandoms.y, rank), uSizeVar.mul(STAR_SIZE_BRIGHTNESS_LINK));
    const linkedGlareRand = mix(vRandoms.z, max(vRandoms.z, rank), uSizeVar.mul(STAR_SIZE_GLARE_LINK));
    const glareStr = uGlareStr.mul(mix(1.0, pow(linkedGlareRand, 8.0).mul(1.0), uGlareVar));
    const bright = uBright.mul(mix(1.0, pow(linkedBrightRand, 3.0).mul(3.0), uBrightVar));
    const color = starColorNode(mix(0.5, vRandoms.w, uColorVar));
    const radiance = color.mul(core.add(glare.mul(glareStr))).mul(bright);
    return vec4(radiance, 1.0);
  })();

  return material;
}

export function createOverlayMaterial(uniforms: UniformMap): StarfieldMaterial {
  const uRadius = numberUniform(uniforms, "uRadius");
  const uScreenPixelAngle = numberUniform(uniforms, "uScreenPixelAngle");
  const uStarSize = numberUniform(uniforms, "uStarSize");
  const uSizeVar = numberUniform(uniforms, "uSizeVar");
  const uLargeStarRarity = numberUniform(uniforms, "uLargeStarRarity");
  const uBright = numberUniform(uniforms, "uBright");
  const uBrightVar = numberUniform(uniforms, "uBrightVar");
  const uGlareSize = numberUniform(uniforms, "uGlareSize");
  const uGlareStr = numberUniform(uniforms, "uGlareStr");
  const uGlareVar = numberUniform(uniforms, "uGlareVar");
  const uColorVar = numberUniform(uniforms, "uColorVar");
  const uTime = numberUniform(uniforms, "uTime");
  const uWinkleAmount = numberUniform(uniforms, "uWinkleAmount");
  const uWinkleFlashiness = numberUniform(uniforms, "uWinkleFlashiness");
  const uEffectMinSize = numberUniform(uniforms, "uEffectMinSize");
  const uEffectMaxSize = numberUniform(uniforms, "uEffectMaxSize");
  const uOverlayStrength = numberUniform(uniforms, "uOverlayStrength");

  const vLocal = varyingProperty("vec2", "vOverlayLocal") as any;
  const vRandoms = varyingProperty("vec4", "vOverlayRandoms") as any;
  const vSizeGate = varyingProperty("float", "vOverlaySizeGate") as any;
  const vClass = varyingProperty("float", "vOverlayClass") as any;
  const vSupportAngle = varyingProperty("float", "vOverlaySupportAngle") as any;

  const material = makeAdditiveMaterial(uniforms);

  material.vertexNode = Fn(() => {
    const iDirection = attribute("iDirection", "vec3") as any;
    const iRandoms = attribute("iRandoms", "vec4") as any;
    const iSizeGate = attribute("iSizeGate", "float") as any;
    const iClass = attribute("iClass", "float") as any;

    const dir = normalize(iDirection) as any;
    const referenceUp = (select as any)(abs(dir.y).greaterThan(0.96), vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
    const right = normalize(cross(referenceUp, dir) as any) as any;
    const up = normalize(cross(right, dir) as any) as any;
    const scale = overlaySizeMultiplierNode(iRandoms.x, iSizeGate, uLargeStarRarity, uSizeVar);
    const starRadius = uStarSize.mul(scale).mul(uScreenPixelAngle);
    const coreSupportRadius = max(starRadius, float(MIN_CORE_PIXELS).mul(uScreenPixelAngle));
    const coreSigma = max(coreSupportRadius.mul(0.42), uScreenPixelAngle.mul(0.5));
    const glareRadius = uGlareSize.mul(mix(1.0, scale, uSizeVar)).mul(uScreenPixelAngle);
    const glareSupportEdge = max(starRadius.add(glareRadius), float(MIN_GLARE_PIXELS).mul(uScreenPixelAngle));
    const glareSigma = max(glareSupportEdge.mul(0.36), uScreenPixelAngle.mul(0.5))
      .mul(step(0.000001, uGlareSize))
      .mul(step(0.000001, uGlareStr));
    const supportAngle = max(max(coreSigma, glareSigma).mul(GAUSSIAN_CUTOFF_SIGMA), uScreenPixelAngle.mul(2.0));
    const offset = right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(uRadius.mul(supportAngle));
    const worldPosition = dir.mul(uRadius).add(offset);

    vLocal.assign(positionGeometry.xy);
    vRandoms.assign(iRandoms);
    vSizeGate.assign(iSizeGate);
    vClass.assign(iClass);
    vSupportAngle.assign(supportAngle);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(worldPosition, 1.0)));
  })();

  material.colorNode = Fn(() => {
    const angularDistance = length(vLocal).mul(vSupportAngle);
    const glowSharpness = float(0.45);
    const flashDepth = clamp(uWinkleAmount.mul(uWinkleFlashiness), 0.0, 1.0);
    const burstSeed = hash41Node(vec4(vRandoms.xyz, vSizeGate));
    const burst = groupedBurstNode(burstSeed, burstSeed.mul(41.0), vRandoms.y.mul(0.85).add(0.65), uTime);
    const rank = overlaySizeRankNode(vRandoms.x, vSizeGate, uLargeStarRarity);
    const scale = overlaySizeMultiplierNode(vRandoms.x, vSizeGate, uLargeStarRarity, uSizeVar);
    const visualSizePx = uStarSize.mul(scale);
    const smallBlinkMask = sizeRangeMaskNode(visualSizePx, uEffectMinSize, uEffectMaxSize);
    const activeSmallBlink = smallBlinkMask.mul(smoothstep(0.001, 0.05, flashDepth));
    const hardBlinkPulse = smoothstep(0.68, 0.74, burst);
    const starRadius = uStarSize.mul(scale).mul(uScreenPixelAngle);
    const coreRadius = max(starRadius, uScreenPixelAngle.mul(0.1));
    const coreSigma = max(coreRadius.mul(0.42), uScreenPixelAngle.mul(0.5));
    const coreNorm = angularDistance.div(max(coreSigma, 1e-6));
    const corePower = mix(2.0, 5.25, glowSharpness);
    const coreCut = (smoothstep as any)((mix as any)(4.6, 2.25, glowSharpness), (mix as any)(5.7, 2.65, glowSharpness), coreNorm).oneMinus();
    const core = (exp as any)((pow as any)(coreNorm, corePower).mul(-0.5))
      .mul(coreCut)
      .mul(burst.mul(flashDepth).mul(0.14).mul(activeSmallBlink.oneMinus()).add(1.0))
      .mul(activeSmallBlink.mul(hardBlinkPulse).mul(0.55).oneMinus());

    const glareRadius = uGlareSize.mul(mix(1.0, scale, uSizeVar)).mul(uScreenPixelAngle);
    const glareEdge = max(starRadius.add(glareRadius), uScreenPixelAngle.mul(0.1));
    const glareSigma = max(glareEdge.mul(0.36), uScreenPixelAngle.mul(0.5));
    const glareNorm = angularDistance.div(max(glareSigma, 1e-6));
    const glarePower = mix(2.0, 3.75, glowSharpness);
    const glareCut = (smoothstep as any)((mix as any)(5.2, 2.85, glowSharpness), (mix as any)(6.4, 3.35, glowSharpness), glareNorm).oneMinus();
    const glare = (exp as any)((pow as any)(glareNorm, glarePower).mul(-0.5))
      .mul(glareCut)
      .mul(burst.mul(flashDepth).mul(0.25).mul(activeSmallBlink.oneMinus()).add(1.0))
      .mul(activeSmallBlink.mul(mix(0.72, 0.96, hardBlinkPulse)).oneMinus())
      .mul(step(0.000001, uGlareSize))
      .mul(step(0.000001, uGlareStr));

    const linkedBrightRand = mix(vRandoms.y, max(vRandoms.y, rank), uSizeVar.mul(STAR_SIZE_BRIGHTNESS_LINK));
    const linkedGlareRand = mix(vRandoms.z, max(vRandoms.z, rank), uSizeVar.mul(STAR_SIZE_GLARE_LINK));
    const glareStr = uGlareStr.mul(mix(1.0, pow(linkedGlareRand, 8.0), uGlareVar));
    const bright = uBright.mul(mix(1.0, pow(linkedBrightRand, 3.0).mul(3.0), uBrightVar))
      .mul(burst.mul(flashDepth).mul(0.18).mul(activeSmallBlink.oneMinus()).add(1.0));
    const classBoost = (select as any)(vClass.greaterThan(2.5), 1.28, 1.0);
    const color = starColorNode(mix(0.5, vRandoms.w, uColorVar));
    const radiance = color.mul(core.add(glare.mul(glareStr))).mul(bright).mul(classBoost).mul(uOverlayStrength);
    const peak = max(max(radiance.r, radiance.g), radiance.b);
    Discard(peak.lessThan(0.00001));
    return vec4(radiance, 1.0);
  })();

  return material;
}

export function createWinkleMaterial(uniforms: UniformMap): StarfieldMaterial {
  const uRadius = numberUniform(uniforms, "uRadius");
  const uScreenPixelAngle = numberUniform(uniforms, "uScreenPixelAngle");
  const uStarSize = numberUniform(uniforms, "uStarSize");
  const uSizeVar = numberUniform(uniforms, "uSizeVar");
  const uLargeStarRarity = numberUniform(uniforms, "uLargeStarRarity");
  const uGlareSize = numberUniform(uniforms, "uGlareSize");
  const uBright = numberUniform(uniforms, "uBright");
  const uBrightVar = numberUniform(uniforms, "uBrightVar");
  const uGlareStr = numberUniform(uniforms, "uGlareStr");
  const uGlareVar = numberUniform(uniforms, "uGlareVar");
  const uColorVar = numberUniform(uniforms, "uColorVar");
  const uEffectMinSize = numberUniform(uniforms, "uEffectMinSize");
  const uEffectMaxSize = numberUniform(uniforms, "uEffectMaxSize");
  const uWinkleSharpness = numberUniform(uniforms, "uWinkleSharpness");
  const uWinkleFlashiness = numberUniform(uniforms, "uWinkleFlashiness");
  const uTime = numberUniform(uniforms, "uTime");
  const uWinkleAmount = numberUniform(uniforms, "uWinkleAmount");

  const vLocal = varyingProperty("vec2", "vWinkleLocal") as any;
  const vRandoms = varyingProperty("vec4", "vWinkleRandoms") as any;
  const vSizeGate = varyingProperty("float", "vWinkleSizeGate") as any;
  const vClass = varyingProperty("float", "vWinkleClass") as any;
  const vWinkle = varyingProperty("vec4", "vWinkleData") as any;

  const material = makeAdditiveMaterial(uniforms);

  material.vertexNode = Fn(() => {
    const iDirection = attribute("iDirection", "vec3") as any;
    const iRandoms = attribute("iRandoms", "vec4") as any;
    const iSizeGate = attribute("iSizeGate", "float") as any;
    const iClass = attribute("iClass", "float") as any;
    const iWinkle = attribute("iWinkle", "vec4") as any;

    const dir = normalize(iDirection) as any;
    const referenceUp = (select as any)(abs(dir.y).greaterThan(0.96), vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
    const right = normalize(cross(referenceUp, dir) as any) as any;
    const up = normalize(cross(right, dir) as any) as any;
    const scale = overlaySizeMultiplierNode(iRandoms.x, iSizeGate, uLargeStarRarity, uSizeVar);
    const starRadius = uStarSize.mul(scale).mul(uScreenPixelAngle);
    const glareRadius = max(uGlareSize, 1.0).mul(mix(1.0, scale, uSizeVar)).mul(uScreenPixelAngle);
    const classBoost = (select as any)(iClass.greaterThan(2.5), 1.35, 1.0);
    const importanceBoost = mix(0.85, 1.35, clamp(iWinkle.w, 0.0, 1.0));
    const supportAngle = max(starRadius.mul(2.2).add(glareRadius.mul(0.7)), float(MIN_GLARE_PIXELS).mul(uScreenPixelAngle))
      .mul(classBoost)
      .mul(importanceBoost);
    const offset = right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(uRadius.mul(supportAngle));
    const worldPosition = dir.mul(uRadius).add(offset);

    vLocal.assign(positionGeometry.xy);
    vRandoms.assign(iRandoms);
    vSizeGate.assign(iSizeGate);
    vClass.assign(iClass);
    vWinkle.assign(iWinkle);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(worldPosition, 1.0)));
  })();

  material.colorNode = Fn(() => {
    Discard(uWinkleAmount.lessThanEqual(0.0001));
    const sharpness = clamp(uWinkleSharpness, 0.0, 1.0);
    const flashiness = clamp(uWinkleFlashiness, 0.0, 1.0);
    const speed = max(vWinkle.z, 0.01);
    const phase = vWinkle.y;
    const time = uTime.mul(speed).add(phase);
    const pulseNoise = noise1Node(time);
    const soloPulse = smoothstep(mix(0.28, 0.56, sharpness), 1.0, pulseNoise);
    const burstSeed = hash41Node(vec4(vRandoms.xyz, vSizeGate));
    const burst = groupedBurstNode(burstSeed, phase, speed, uTime);
    const pulse = mix(soloPulse, max(soloPulse.mul(0.32), burst), flashiness);
    const rank = overlaySizeRankNode(vRandoms.x, vSizeGate, uLargeStarRarity);
    const scale = mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, rank), uSizeVar);
    const visualSizePx = uStarSize.mul(scale);
    const smallBlinkMask = sizeRangeMaskNode(visualSizePx, uEffectMinSize, uEffectMaxSize);
    const flashDepth = clamp(uWinkleAmount.mul(flashiness), 0.0, 1.0);
    const activeSmallBlink = smallBlinkMask.mul(smoothstep(0.001, 0.05, flashDepth));
    const hardBlinkPulse = smoothstep(0.68, 0.74, burst);
    const glintFade = activeSmallBlink.mul(mix(0.72, 0.96, hardBlinkPulse)).oneMinus();
    const rayNoise = noise1Node(time.mul(0.57).add(9.0));
    const trembleNoise = noise1Node(time.mul(0.31).add(17.0));
    const angle = vWinkle.x.add(trembleNoise.sub(0.5).mul(2.0).mul(0.05235987756));
    const p = rotate2Node(vLocal, angle) as any;
    const px = p.x as any;
    const py = p.y as any;
    const radial = length(vLocal);
    const edgeMask = pow(clamp(smoothstep((mix as any)(0.82, 0.58, sharpness), (mix as any)(1.0, 0.76, sharpness), radial).oneMinus(), 0.0, 1.0), (mix as any)(1.0, 2.2, sharpness));
    const rayLength = (mix as any)(0.85, 1.35, rayNoise).mul(burst.mul(flashiness).mul(0.28).add(1.0));
    const rayWidth = (mix as any)(130.0, 430.0, sharpness);
    const rayFalloff = (mix as any)(2.7, 5.8, sharpness);
    const rayX = (exp as any)(py.mul(py).mul(rayWidth).negate()).mul((exp as any)((abs as any)(px).mul(rayFalloff).div((max as any)(rayLength, 0.1)).negate()));
    const rayY = (exp as any)(px.mul(px).mul(rayWidth).negate()).mul((exp as any)((abs as any)(py).mul(rayFalloff).div((max as any)(rayLength, 0.1)).negate()));
    const diagonal = (exp as any)(px.add(py).mul(px.add(py)).mul(rayWidth).mul(-0.45))
      .mul((exp as any)((abs as any)(px.sub(py)).mul(rayFalloff).mul(1.35).div((max as any)(rayLength, 0.1)).negate()));
    const antiDiagonal = (exp as any)(px.sub(py).mul(px.sub(py)).mul(rayWidth).mul(-0.45))
      .mul((exp as any)((abs as any)(px.add(py)).mul(rayFalloff).mul(1.35).div((max as any)(rayLength, 0.1)).negate()));
    const core = (exp as any)((pow as any)(dot(p, p), (mix as any)(1.0, 1.65, sharpness)).mul((mix as any)(44.0, 115.0, sharpness)).negate());
    const glint = rayX.add(rayY).mul(0.82).add(diagonal.add(antiDiagonal).mul(0.16)).add(core.mul(0.45))
      .mul(edgeMask)
      .mul(glintFade);
    const linkedBrightRand = mix(vRandoms.y, max(vRandoms.y, rank), uSizeVar.mul(STAR_SIZE_BRIGHTNESS_LINK));
    const linkedGlareRand = mix(vRandoms.z, max(vRandoms.z, rank), uSizeVar.mul(STAR_SIZE_GLARE_LINK));
    const glareStr = uGlareStr.mul(mix(1.0, pow(linkedGlareRand, 8.0), uGlareVar));
    const bright = uBright.mul(mix(1.0, pow(linkedBrightRand, 3.0).mul(3.0), uBrightVar));
    const classBoost = (select as any)(vClass.greaterThan(2.5), 1.45, 1.0);
    const importanceBoost = mix(0.35, 1.25, clamp(vWinkle.w, 0.0, 1.0));
    const shimmer = mix(0.28, 0.95, pulse).mul(burst.mul(flashiness).mul(0.75).add(1.0));
    const color = starColorNode(mix(0.5, vRandoms.w, uColorVar));
    const brightEnergy = sqrt(max(bright, 0.0));
    const glareEnergy = sqrt(max(glareStr, 0.0)).mul(0.22).add(0.20);
    const radiance = color.mul(glint)
      .mul(brightEnergy)
      .mul(glareEnergy)
      .mul(classBoost)
      .mul(importanceBoost)
      .mul(shimmer)
      .mul(uWinkleAmount)
      .mul(burst.mul(flashiness).mul(0.18).add(1.0))
      .toVar();
    const peak = max(max(radiance.r, radiance.g), radiance.b);
    const compressedPeak = exp(peak.mul(-0.55)).oneMinus();
    radiance.mulAssign(compressedPeak.div(max(peak, 1e-5)));
    radiance.mulAssign(0.72);
    const finalPeak = max(max(radiance.r, radiance.g), radiance.b);
    Discard(finalPeak.lessThan(mix(0.00001, 0.00045, sharpness)));
    return vec4(radiance, 1.0);
  })();

  return material;
}

export function createDownsampleMaterial(uniforms: DownsampleUniforms): StarfieldMaterial {
  const uniformMap = uniforms as UniformMap;
  const uSourceTexture = uniformTexture(uniforms.uSourceTexture.value ?? new THREE.Texture());
  const uSourceSize = vec2Uniform(uniformMap, "uSourceSize");
  const uTargetSize = vec2Uniform(uniformMap, "uTargetSize");
  const uSourcePerTarget = numberUniform(uniformMap, "uSourcePerTarget");
  const uExposure = numberUniform(uniformMap, "uExposure");
  uniformMap.uSourceTexture = uSourceTexture as unknown as UniformMap[string];

  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
  }) as unknown as StarfieldMaterial & { colorNode: unknown };
  material.uniforms = uniformMap;
  material.colorNode = Fn(() => {
    const targetPixel = floor(uv().mul(uTargetSize));
    const kernel = floor(uSourcePerTarget.add(0.5));
    const color = vec4(0.0).toVar();
    const count = float(0.0).toVar();

    Loop(8, ({ i: y }: any) => {
      Loop(8, ({ i: x }: any) => {
        If(float(x).lessThan(kernel).and(float(y).lessThan(kernel)), () => {
          const sourcePixel = targetPixel.mul(uSourcePerTarget).add(vec2(float(x), float(y))).add(0.5);
          color.addAssign(texture(uSourceTexture, sourcePixel.div(uSourceSize)));
          count.addAssign(1.0);
        });
      });
    });

    const stars = color.rgb.div(max(count, 1.0));
    const background = vec3(0.004, 0.005, 0.011);
    const backgroundMapped = vec3(1.0).sub((exp as any)(background.mul(uExposure).negate()));
    const combinedMapped = vec3(1.0).sub((exp as any)(background.add(stars).mul(uExposure).negate()));
    const starContribution = (max as any)(combinedMapped.sub(backgroundMapped), vec3(0.0));
    const alpha = clamp(max(max(starContribution.r, starContribution.g), starContribution.b), 0.0, 1.0);
    return vec4(starContribution, alpha);
  })();

  return material;
}

export function createLightCompositionBakeMaterial(uniforms: BackgroundUniforms): StarfieldMaterial {
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
    Loop(LIGHT_COMPOSITION_MAX_ANCHORS, ({ i }: any) => {
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

export function createPatchDomeMaterial({
  descriptor,
  visibleTarget,
}: {
  descriptor: PatchDescriptor;
  visibleTarget: VisiblePatchTarget;
}): StarfieldMaterial {
  const sampling = visibleTarget.starfieldSampling ?? {
    innerOffset: descriptor.innerOffset,
    innerScale: descriptor.innerScale,
  };

  return createPatchNodeMaterial({
    uniforms: {
      uCurrentTexture: { value: visibleTarget.texture },
      uNextTexture: { value: visibleTarget.texture },
      uBlend: { value: 0 },
      uContentUvMin: { value: descriptor.uvMin.clone() },
      uContentUvSize: { value: descriptor.uvSize.clone() },
      uCurrentInnerOffset: { value: sampling.innerOffset.clone() },
      uCurrentInnerScale: { value: sampling.innerScale.clone() },
      uNextInnerOffset: { value: sampling.innerOffset.clone() },
      uNextInnerScale: { value: sampling.innerScale.clone() },
    },
  });
}

export function createBackgroundPatchDomeMaterial({
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

  return createPatchNodeMaterial({
    uniforms: {
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
    },
    background: true,
  });
}
