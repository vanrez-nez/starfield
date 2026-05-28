import * as THREE from "three";
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
} from "./constants.js";

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iDirection;
  attribute vec2 iUv;
  attribute vec4 iRandoms;
  attribute float iSizeGate;
  attribute float iClass;

  varying vec2 vUv;
  varying vec3 vDirection;
  varying vec4 vRandoms;
  varying float vSizeGate;
  varying float vClass;

  uniform vec2 uBakeSize;
  uniform vec2 uOutputSize;
  uniform vec2 uTileUvMin;
  uniform vec2 uTileUvSize;
  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uLargeStarRarity;
  uniform float uGlareSize;
  uniform float uGlareStr;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float SUBPIXEL_DENSITY_THRESHOLD_PX = ${SUBPIXEL_DENSITY_THRESHOLD_PX.toFixed(2)};
  const float AA_PIN_THRESHOLD_PX = ${AA_PIN_THRESHOLD_PX.toFixed(2)};
  const float GAUSSIAN_CUTOFF_SIGMA = ${GAUSSIAN_CUTOFF_SIGMA.toFixed(1)};
  const float STAR_SIZE_MIN_SCALE = ${STAR_SIZE_MIN_SCALE.toFixed(2)};
  const float STAR_SIZE_RARITY_EXPONENT = ${STAR_SIZE_RARITY_EXPONENT.toFixed(1)};
  const float STAR_SIZE_GATE_EXPONENT = ${STAR_SIZE_GATE_EXPONENT.toFixed(1)};

  float sizeRank(float rSize, float rSizeGate) {
    float baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
    float gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
    return baseRank * gate;
  }

  float sizeMultiplier(float rSize, float rSizeGate) {
    return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, sizeRank(rSize, rSizeGate)), uSizeVar);
  }

  float angularPixel(vec2 textureSize) {
    return PI * max(uTileUvSize.y, 1e-6) / max(textureSize.y, 1.0);
  }

  float splatSupportAngle(float rSize, float rSizeGate) {
    float bakeAngularPx = angularPixel(uBakeSize);
    float outputAngularPx = angularPixel(uOutputSize);

    float scale = sizeMultiplier(rSize, rSizeGate);
    float starRadius = uStarSize * scale * uScreenPixelAngle;
    float screenRadiusPx = uStarSize * scale;
    float pinWeight = 1.0 - smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX, AA_PIN_THRESHOLD_PX, screenRadiusPx);
    float normalCoreFloor = max(MIN_CORE_PIXELS * outputAngularPx, MIN_CORE_PIXELS * uScreenPixelAngle);
    float pinCoreFloor = max(outputAngularPx, 0.5 * uScreenPixelAngle);
    float coreSupportRadius = max(starRadius, mix(normalCoreFloor, pinCoreFloor, pinWeight));
    float coreSigma = max(coreSupportRadius * 0.45, bakeAngularPx);

    float glareSigma = 0.0;
    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float normalWeight = smoothstep(AA_PIN_THRESHOLD_PX, AA_PIN_THRESHOLD_PX + 0.25, screenRadiusPx);
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * uScreenPixelAngle;
      float glareSupportEdge = max(starRadius + glareRadius, max(MIN_GLARE_PIXELS * outputAngularPx, MIN_GLARE_PIXELS * uScreenPixelAngle));
      glareSigma = max(glareSupportEdge * 0.36, bakeAngularPx) * normalWeight;
    }

    return max(coreSigma, glareSigma) * GAUSSIAN_CUTOFF_SIGMA;
  }

  void main() {
    float supportAngle = splatSupportAngle(iRandoms.x, iSizeGate);
    float sinPhi = max(sin(iUv.y * PI), 0.015);
    vec2 halfUv = vec2(
      min(1.5, supportAngle / (2.0 * PI * sinPhi)),
      supportAngle / PI
    );
    vec2 splatUv = iUv + position.xy * halfUv;
    vec2 patchUv = (splatUv - uTileUvMin) / uTileUvSize;

    vUv = splatUv;
    vDirection = iDirection;
    vRandoms = iRandoms;
    vSizeGate = iSizeGate;
    vClass = iClass;
    gl_Position = vec4(patchUv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vDirection;
  varying vec4 vRandoms;
  varying float vSizeGate;
  varying float vClass;

  uniform vec2 uBakeSize;
  uniform vec2 uOutputSize;
  uniform vec2 uTileUvSize;
  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uLargeStarRarity;
  uniform float uBright;
  uniform float uBrightVar;
  uniform float uGlareSize;
  uniform float uGlareStr;
  uniform float uGlareVar;
  uniform float uColorVar;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float SUBPIXEL_DENSITY_THRESHOLD_PX = ${SUBPIXEL_DENSITY_THRESHOLD_PX.toFixed(2)};
  const float AA_PIN_THRESHOLD_PX = ${AA_PIN_THRESHOLD_PX.toFixed(2)};
  const float STAR_SIZE_MIN_SCALE = ${STAR_SIZE_MIN_SCALE.toFixed(2)};
  const float STAR_SIZE_RARITY_EXPONENT = ${STAR_SIZE_RARITY_EXPONENT.toFixed(1)};
  const float STAR_SIZE_GATE_EXPONENT = ${STAR_SIZE_GATE_EXPONENT.toFixed(1)};
  const float STAR_SIZE_BRIGHTNESS_LINK = ${STAR_SIZE_BRIGHTNESS_LINK.toFixed(2)};
  const float STAR_SIZE_GLARE_LINK = ${STAR_SIZE_GLARE_LINK.toFixed(2)};

  vec3 starColor(float t) {
    vec3 cool = vec3(1.00, 0.55, 0.30);
    vec3 mid = vec3(1.00, 0.96, 0.92);
    vec3 hot = vec3(0.70, 0.80, 1.00);
    return (t < 0.5) ? mix(cool, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
  }

  vec2 foldEquirectUv(vec2 uv) {
    float v = mod(uv.y, 2.0);
    float folded = step(1.0, v);
    return vec2(uv.x + folded * 0.5, mix(v, 2.0 - v, folded));
  }

  vec3 equirectDirection(vec2 rawUv) {
    vec2 uv = foldEquirectUv(rawUv);
    float theta = (uv.x - 0.5) * PI * 2.0;
    float phi = uv.y * PI;
    float sinPhi = sin(phi);
    return normalize(vec3(
      sinPhi * sin(theta),
      cos(phi),
      sinPhi * cos(theta)
    ));
  }

  float sizeRank(float rSize, float rSizeGate) {
    float baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
    float gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
    return baseRank * gate;
  }

  float sizeMultiplier(float rSize, float rSizeGate) {
    return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, sizeRank(rSize, rSizeGate)), uSizeVar);
  }

  float angularPixel(vec2 textureSize) {
    return PI * max(uTileUvSize.y, 1e-6) / max(textureSize.y, 1.0);
  }

  void main() {
    vec3 dir = equirectDirection(vUv);
    float angularDistance = acos(clamp(dot(dir, normalize(vDirection)), -1.0, 1.0));

    float bakeAngularPx = angularPixel(uBakeSize);

    float rank = sizeRank(vRandoms.x, vSizeGate);
    float scale = sizeMultiplier(vRandoms.x, vSizeGate);
    float starRadius = uStarSize * scale * uScreenPixelAngle;
    float screenRadiusPx = uStarSize * scale;
    float subpixelWeight = 1.0 - smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX * 0.75, SUBPIXEL_DENSITY_THRESHOLD_PX, screenRadiusPx);
    float normalWeight = smoothstep(AA_PIN_THRESHOLD_PX, AA_PIN_THRESHOLD_PX + 0.25, screenRadiusPx);
    float coreRadius = max(starRadius, uScreenPixelAngle * 0.1);
    float coreEnergy = 1.0;
    float densityEnergy = max(0.08, smoothstep(0.0, SUBPIXEL_DENSITY_THRESHOLD_PX, screenRadiusPx));
    coreEnergy *= mix(1.0, densityEnergy, subpixelWeight);
    float coreSigma = max(coreRadius * 0.45, bakeAngularPx * 0.5);
    float core = exp(-(angularDistance * angularDistance) / max(2.0 * coreSigma * coreSigma, 1e-10));
    core *= coreEnergy;

    float glare = 0.0;
    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * uScreenPixelAngle;
      float glareEdge = max(starRadius + glareRadius, uScreenPixelAngle * 0.1);
      float glareEnergy = 1.0;
      float glareSigma = max(glareEdge * 0.36, bakeAngularPx * 0.5);
      glare = exp(-(angularDistance * angularDistance) / max(2.0 * glareSigma * glareSigma, 1e-10));
      glare *= glareEnergy * normalWeight;
    }

    float linkedBrightRand = mix(vRandoms.y, max(vRandoms.y, rank), STAR_SIZE_BRIGHTNESS_LINK * uSizeVar);
    float linkedGlareRand = mix(vRandoms.z, max(vRandoms.z, rank), STAR_SIZE_GLARE_LINK * uSizeVar);
    float glareStr = uGlareStr * mix(1.0, pow(linkedGlareRand, 8.0), uGlareVar);
    float bright = uBright * mix(1.0, pow(linkedBrightRand, 3.0) * 3.0, uBrightVar);
    vec3 color = starColor(mix(0.5, vRandoms.w, uColorVar));
    vec3 radiance = color * (core + glare * glareStr) * bright;

    gl_FragColor = vec4(radiance, 1.0);
  }
`;

const OVERLAY_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iDirection;
  attribute vec4 iRandoms;
  attribute float iSizeGate;
  attribute float iClass;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vSizeGate;
  varying float vClass;
  varying float vSupportAngle;

  uniform float uRadius;
  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uLargeStarRarity;
  uniform float uGlareSize;
  uniform float uGlareStr;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float GAUSSIAN_CUTOFF_SIGMA = ${GAUSSIAN_CUTOFF_SIGMA.toFixed(1)};
  const float STAR_SIZE_MIN_SCALE = ${STAR_SIZE_MIN_SCALE.toFixed(2)};
  const float STAR_SIZE_RARITY_EXPONENT = ${STAR_SIZE_RARITY_EXPONENT.toFixed(1)};
  const float STAR_SIZE_GATE_EXPONENT = ${STAR_SIZE_GATE_EXPONENT.toFixed(1)};

  float sizeRank(float rSize, float rSizeGate) {
    float baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
    float gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
    return baseRank * gate;
  }

  float sizeMultiplier(float rSize, float rSizeGate) {
    return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, sizeRank(rSize, rSizeGate)), uSizeVar);
  }

  float overlaySupportAngle(float rSize, float rSizeGate) {
    float scale = sizeMultiplier(rSize, rSizeGate);
    float starRadius = uStarSize * scale * uScreenPixelAngle;
    float coreSupportRadius = max(starRadius, MIN_CORE_PIXELS * uScreenPixelAngle);
    float coreSigma = max(coreSupportRadius * 0.42, uScreenPixelAngle * 0.5);
    float glareSigma = 0.0;

    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * uScreenPixelAngle;
      float glareSupportEdge = max(starRadius + glareRadius, MIN_GLARE_PIXELS * uScreenPixelAngle);
      glareSigma = max(glareSupportEdge * 0.36, uScreenPixelAngle * 0.5);
    }

    return max(max(coreSigma, glareSigma) * GAUSSIAN_CUTOFF_SIGMA, uScreenPixelAngle * 2.0);
  }

  void main() {
    vec3 dir = normalize(iDirection);
    vec3 referenceUp = abs(dir.y) > 0.96 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(referenceUp, dir));
    vec3 up = normalize(cross(right, dir));
    float supportAngle = overlaySupportAngle(iRandoms.x, iSizeGate);
    vec3 offset = (right * position.x + up * position.y) * (uRadius * supportAngle);
    vec3 worldPosition = dir * uRadius + offset;

    vLocal = position.xy;
    vRandoms = iRandoms;
    vSizeGate = iSizeGate;
    vClass = iClass;
    vSupportAngle = supportAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
  }
`;

const OVERLAY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vSizeGate;
  varying float vClass;
  varying float vSupportAngle;

  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uLargeStarRarity;
  uniform float uBright;
  uniform float uBrightVar;
  uniform float uGlareSize;
  uniform float uGlareStr;
  uniform float uGlareVar;
  uniform float uColorVar;
  uniform float uTime;
  uniform float uWinkleAmount;
  uniform float uWinkleFlashiness;
  uniform float uEffectMinSize;
  uniform float uEffectMaxSize;
  uniform float uOverlayStrength;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float STAR_SIZE_MIN_SCALE = ${STAR_SIZE_MIN_SCALE.toFixed(2)};
  const float STAR_SIZE_RARITY_EXPONENT = ${STAR_SIZE_RARITY_EXPONENT.toFixed(1)};
  const float STAR_SIZE_GATE_EXPONENT = ${STAR_SIZE_GATE_EXPONENT.toFixed(1)};
  const float STAR_SIZE_BRIGHTNESS_LINK = ${STAR_SIZE_BRIGHTNESS_LINK.toFixed(2)};
  const float STAR_SIZE_GLARE_LINK = ${STAR_SIZE_GLARE_LINK.toFixed(2)};

  vec3 starColor(float t) {
    vec3 cool = vec3(1.00, 0.55, 0.30);
    vec3 mid = vec3(1.00, 0.96, 0.92);
    vec3 hot = vec3(0.70, 0.80, 1.00);
    return (t < 0.5) ? mix(cool, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
  }

  float sizeRank(float rSize, float rSizeGate) {
    float baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
    float gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
    return baseRank * gate;
  }

  float sizeMultiplier(float rSize, float rSizeGate) {
    return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, sizeRank(rSize, rSizeGate)), uSizeVar);
  }

  float hash41(vec4 p) {
    return fract(sin(dot(p, vec4(12.9898, 78.233, 37.719, 11.135))) * 43758.5453123);
  }

  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(fract(sin(i * 127.1) * 43758.5453123), fract(sin((i + 1.0) * 127.1) * 43758.5453123), f);
  }

  float groupedBurst(float seed, float phase, float speed) {
    float group = floor(seed * 4.0);
    float groupWave = sin(uTime * 1.35 + group * PI * 0.5);
    float groupPulse = smoothstep(0.34, 0.98, groupWave * 0.5 + 0.5);
    float localPulse = smoothstep(0.45, 1.0, noise1(uTime * speed + phase));
    return groupPulse * mix(0.45, 1.0, localPulse);
  }

  float sizeRangeMask(float visualSizePx) {
    float minSize = min(uEffectMinSize, uEffectMaxSize);
    float maxSize = max(uEffectMinSize, uEffectMaxSize);
    if (maxSize <= 0.0001 || maxSize - minSize <= 0.0001) return 0.0;
    float lower = minSize <= 0.0001 ? 1.0 : smoothstep(minSize, minSize + 0.35, visualSizePx);
    float upper = 1.0 - smoothstep(maxSize, maxSize + 0.35, visualSizePx);
    return clamp(lower * upper, 0.0, 1.0);
  }

  void main() {
    float angularDistance = length(vLocal) * vSupportAngle;
    float glowSharpness = 0.45;
    float flashDepth = clamp(uWinkleAmount * uWinkleFlashiness, 0.0, 1.0);
    float burstSeed = hash41(vec4(vRandoms.xyz, vSizeGate));
    float burst = groupedBurst(burstSeed, burstSeed * 41.0, 0.65 + vRandoms.y * 0.85);
    float rank = sizeRank(vRandoms.x, vSizeGate);
    float scale = sizeMultiplier(vRandoms.x, vSizeGate);
    float visualSizePx = uStarSize * scale;
    float smallBlinkMask = sizeRangeMask(visualSizePx);
    float activeSmallBlink = smallBlinkMask * smoothstep(0.001, 0.05, flashDepth);
    float hardBlinkPulse = smoothstep(0.68, 0.74, burst);
    float starRadius = uStarSize * scale * uScreenPixelAngle;
    float coreRadius = max(starRadius, uScreenPixelAngle * 0.1);
    float coreSigma = max(coreRadius * 0.42, uScreenPixelAngle * 0.5);
    float coreEnergy = 1.0;
    float coreNorm = angularDistance / max(coreSigma, 1e-6);
    float corePower = mix(2.0, 5.25, glowSharpness);
    float coreCut = 1.0 - smoothstep(mix(4.6, 2.25, glowSharpness), mix(5.7, 2.65, glowSharpness), coreNorm);
    float core = exp(-0.5 * pow(coreNorm, corePower)) * coreCut * coreEnergy;
    core *= 1.0 + burst * flashDepth * 0.14 * (1.0 - activeSmallBlink);
    core *= 1.0 - activeSmallBlink * hardBlinkPulse * 0.55;

    float glare = 0.0;
    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * uScreenPixelAngle;
      float glareEdge = max(starRadius + glareRadius, uScreenPixelAngle * 0.1);
      float glareEnergy = 1.0;
      float glareSigma = max(glareEdge * 0.36, uScreenPixelAngle * 0.5);
      float glareNorm = angularDistance / max(glareSigma, 1e-6);
      float glarePower = mix(2.0, 3.75, glowSharpness);
      float glareCut = 1.0 - smoothstep(mix(5.2, 2.85, glowSharpness), mix(6.4, 3.35, glowSharpness), glareNorm);
      glare = exp(-0.5 * pow(glareNorm, glarePower)) * glareCut * glareEnergy;
      glare *= 1.0 + burst * flashDepth * 0.25 * (1.0 - activeSmallBlink);
      glare *= 1.0 - activeSmallBlink * mix(0.72, 0.96, hardBlinkPulse);
    }

    float linkedBrightRand = mix(vRandoms.y, max(vRandoms.y, rank), STAR_SIZE_BRIGHTNESS_LINK * uSizeVar);
    float linkedGlareRand = mix(vRandoms.z, max(vRandoms.z, rank), STAR_SIZE_GLARE_LINK * uSizeVar);
    float glareStr = uGlareStr * mix(1.0, pow(linkedGlareRand, 8.0), uGlareVar);
    float bright = uBright * mix(1.0, pow(linkedBrightRand, 3.0) * 3.0, uBrightVar);
    bright *= 1.0 + burst * flashDepth * 0.18 * (1.0 - activeSmallBlink);
    float classBoost = vClass > 2.5 ? 1.28 : 1.0;
    vec3 color = starColor(mix(0.5, vRandoms.w, uColorVar));
    vec3 radiance = color * (core + glare * glareStr) * bright * classBoost * uOverlayStrength;

    if (max(max(radiance.r, radiance.g), radiance.b) < 0.00001) discard;
    gl_FragColor = vec4(radiance, 1.0);
  }
`;

const WINKLE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iDirection;
  attribute vec4 iRandoms;
  attribute float iSizeGate;
  attribute float iClass;
  attribute vec4 iWinkle;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vSizeGate;
  varying float vClass;
  varying vec4 vWinkle;

  uniform float uRadius;
  uniform float uScreenPixelAngle;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uLargeStarRarity;
  uniform float uGlareSize;

  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float STAR_SIZE_MIN_SCALE = ${STAR_SIZE_MIN_SCALE.toFixed(2)};
  const float STAR_SIZE_RARITY_EXPONENT = ${STAR_SIZE_RARITY_EXPONENT.toFixed(1)};
  const float STAR_SIZE_GATE_EXPONENT = ${STAR_SIZE_GATE_EXPONENT.toFixed(1)};

  float sizeRank(float rSize, float rSizeGate) {
    float baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
    float gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
    return baseRank * gate;
  }

  float sizeMultiplier(float rSize, float rSizeGate) {
    return mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, sizeRank(rSize, rSizeGate)), uSizeVar);
  }

  float winkleSupportAngle(float rSize, float rSizeGate, float classId, float importance) {
    float scale = sizeMultiplier(rSize, rSizeGate);
    float starRadius = uStarSize * scale * uScreenPixelAngle;
    float glareRadius = max(uGlareSize, 1.0) * mix(1.0, scale, uSizeVar) * uScreenPixelAngle;
    float classBoost = classId > 2.5 ? 1.35 : 1.0;
    float importanceBoost = mix(0.85, 1.35, clamp(importance, 0.0, 1.0));
    float support = max(starRadius * 2.2 + glareRadius * 0.7, MIN_GLARE_PIXELS * uScreenPixelAngle) * classBoost * importanceBoost;
    return support;
  }

  void main() {
    vec3 dir = normalize(iDirection);
    vec3 referenceUp = abs(dir.y) > 0.96 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(referenceUp, dir));
    vec3 up = normalize(cross(right, dir));
    float supportAngle = winkleSupportAngle(iRandoms.x, iSizeGate, iClass, iWinkle.w);
    vec3 offset = (right * position.x + up * position.y) * (uRadius * supportAngle);
    vec3 worldPosition = dir * uRadius + offset;

    vLocal = position.xy;
    vRandoms = iRandoms;
    vSizeGate = iSizeGate;
    vClass = iClass;
    vWinkle = iWinkle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
  }
`;

const WINKLE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vSizeGate;
  varying float vClass;
  varying vec4 vWinkle;

  uniform float uTime;
  uniform float uWinkleAmount;
  uniform float uWinkleSharpness;
  uniform float uWinkleFlashiness;
  uniform float uEffectMinSize;
  uniform float uEffectMaxSize;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uLargeStarRarity;
  uniform float uBright;
  uniform float uBrightVar;
  uniform float uGlareStr;
  uniform float uGlareVar;
  uniform float uColorVar;

  const float PI = 3.14159265359;
  const float STAR_SIZE_MIN_SCALE = ${STAR_SIZE_MIN_SCALE.toFixed(2)};
  const float STAR_SIZE_RARITY_EXPONENT = ${STAR_SIZE_RARITY_EXPONENT.toFixed(1)};
  const float STAR_SIZE_GATE_EXPONENT = ${STAR_SIZE_GATE_EXPONENT.toFixed(1)};
  const float STAR_SIZE_BRIGHTNESS_LINK = ${STAR_SIZE_BRIGHTNESS_LINK.toFixed(2)};
  const float STAR_SIZE_GLARE_LINK = ${STAR_SIZE_GLARE_LINK.toFixed(2)};

  vec3 starColor(float t) {
    vec3 cool = vec3(1.00, 0.55, 0.30);
    vec3 mid = vec3(1.00, 0.96, 0.92);
    vec3 hot = vec3(0.70, 0.80, 1.00);
    return (t < 0.5) ? mix(cool, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
  }

  float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453123);
  }

  float hash41(vec4 p) {
    return fract(sin(dot(p, vec4(12.9898, 78.233, 37.719, 11.135))) * 43758.5453123);
  }

  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
  }

  vec2 rotate2(vec2 p, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  float sizeRank(float rSize, float rSizeGate) {
    float baseRank = pow(clamp(rSize, 0.0, 1.0), STAR_SIZE_RARITY_EXPONENT);
    float gate = mix(1.0, pow(clamp(rSizeGate, 0.0, 1.0), STAR_SIZE_GATE_EXPONENT), uLargeStarRarity);
    return baseRank * gate;
  }

  float groupedBurst(float seed, float phase, float speed) {
    float group = floor(seed * 4.0);
    float groupWave = sin(uTime * 1.35 + group * PI * 0.5);
    float groupPulse = smoothstep(0.34, 0.98, groupWave * 0.5 + 0.5);
    float localPulse = smoothstep(0.45, 1.0, noise1(uTime * speed + phase));
    return groupPulse * mix(0.45, 1.0, localPulse);
  }

  float sizeRangeMask(float visualSizePx) {
    float minSize = min(uEffectMinSize, uEffectMaxSize);
    float maxSize = max(uEffectMinSize, uEffectMaxSize);
    if (maxSize <= 0.0001 || maxSize - minSize <= 0.0001) return 0.0;
    float lower = minSize <= 0.0001 ? 1.0 : smoothstep(minSize, minSize + 0.35, visualSizePx);
    float upper = 1.0 - smoothstep(maxSize, maxSize + 0.35, visualSizePx);
    return clamp(lower * upper, 0.0, 1.0);
  }

  void main() {
    if (uWinkleAmount <= 0.0001) discard;

    float sharpness = clamp(uWinkleSharpness, 0.0, 1.0);
    float flashiness = clamp(uWinkleFlashiness, 0.0, 1.0);
    float speed = max(vWinkle.z, 0.01);
    float phase = vWinkle.y;
    float time = uTime * speed + phase;
    float pulseNoise = noise1(time);
    float soloPulse = smoothstep(mix(0.28, 0.56, sharpness), 1.0, pulseNoise);
    float burstSeed = hash41(vec4(vRandoms.xyz, vSizeGate));
    float burst = groupedBurst(burstSeed, phase, speed);
    float pulse = mix(soloPulse, max(soloPulse * 0.32, burst), flashiness);
    float rank = sizeRank(vRandoms.x, vSizeGate);
    float scale = mix(1.0, mix(STAR_SIZE_MIN_SCALE, 1.0, rank), uSizeVar);
    float visualSizePx = uStarSize * scale;
    float smallBlinkMask = sizeRangeMask(visualSizePx);
    float flashDepth = clamp(uWinkleAmount * flashiness, 0.0, 1.0);
    float activeSmallBlink = smallBlinkMask * smoothstep(0.001, 0.05, flashDepth);
    float hardBlinkPulse = smoothstep(0.68, 0.74, burst);
    float glintFade = 1.0 - activeSmallBlink * mix(0.72, 0.96, hardBlinkPulse);
    float rayNoise = noise1(time * 0.57 + 9.0);
    float trembleNoise = noise1(time * 0.31 + 17.0);
    float maxTremble = 0.05235987756;
    float angle = vWinkle.x + (trembleNoise - 0.5) * 2.0 * maxTremble;
    vec2 p = rotate2(vLocal, angle);
    float radial = length(vLocal);
    float edgeMask = 1.0 - smoothstep(mix(0.82, 0.58, sharpness), mix(1.0, 0.76, sharpness), radial);
    edgeMask = pow(clamp(edgeMask, 0.0, 1.0), mix(1.0, 2.2, sharpness));

    float rayLength = mix(0.85, 1.35, rayNoise) * (1.0 + burst * flashiness * 0.28);
    float rayWidth = mix(130.0, 430.0, sharpness);
    float rayFalloff = mix(2.7, 5.8, sharpness);
    float rayX = exp(-p.y * p.y * rayWidth) * exp(-abs(p.x) * rayFalloff / max(rayLength, 0.1));
    float rayY = exp(-p.x * p.x * rayWidth) * exp(-abs(p.y) * rayFalloff / max(rayLength, 0.1));
    float diagonal = exp(-(p.x + p.y) * (p.x + p.y) * rayWidth * 0.45)
      * exp(-abs(p.x - p.y) * rayFalloff * 1.35 / max(rayLength, 0.1));
    float antiDiagonal = exp(-(p.x - p.y) * (p.x - p.y) * rayWidth * 0.45)
      * exp(-abs(p.x + p.y) * rayFalloff * 1.35 / max(rayLength, 0.1));
    float core = exp(-pow(dot(p, p), mix(1.0, 1.65, sharpness)) * mix(44.0, 115.0, sharpness));
    float glint = ((rayX + rayY) * 0.82 + (diagonal + antiDiagonal) * 0.16 + core * 0.45) * edgeMask;
    glint *= glintFade;

    float linkedBrightRand = mix(vRandoms.y, max(vRandoms.y, rank), STAR_SIZE_BRIGHTNESS_LINK * uSizeVar);
    float linkedGlareRand = mix(vRandoms.z, max(vRandoms.z, rank), STAR_SIZE_GLARE_LINK * uSizeVar);
    float glareStr = uGlareStr * mix(1.0, pow(linkedGlareRand, 8.0), uGlareVar);
    float bright = uBright * mix(1.0, pow(linkedBrightRand, 3.0) * 3.0, uBrightVar);
    float classBoost = vClass > 2.5 ? 1.45 : 1.0;
    float importanceBoost = mix(0.35, 1.25, clamp(vWinkle.w, 0.0, 1.0));
    float shimmer = mix(0.28, 0.95, pulse) * (1.0 + burst * flashiness * 0.75);
    vec3 color = starColor(mix(0.5, vRandoms.w, uColorVar));
    float brightEnergy = sqrt(max(bright, 0.0));
    float glareEnergy = 0.20 + sqrt(max(glareStr, 0.0)) * 0.22;
    vec3 radiance = color * glint * brightEnergy * glareEnergy * classBoost * importanceBoost * shimmer * uWinkleAmount;
    radiance *= 1.0 + burst * flashiness * 0.18;

    float peak = max(max(radiance.r, radiance.g), radiance.b);
    float compressedPeak = 1.0 - exp(-peak * 0.55);
    radiance *= compressedPeak / max(peak, 1e-5);
    radiance *= 0.72;

    if (max(max(radiance.r, radiance.g), radiance.b) < mix(0.00001, 0.00045, sharpness)) discard;
    gl_FragColor = vec4(radiance, 1.0);
  }
`;

const DOWNSAMPLE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const DOWNSAMPLE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uSourceTexture;
  uniform vec2 uSourceSize;
  uniform vec2 uTargetSize;
  uniform float uSourcePerTarget;
  uniform float uExposure;
  varying vec2 vUv;

  vec4 sampleSourcePixel(vec2 targetPixel, vec2 offset) {
    vec2 sourcePixel = targetPixel * uSourcePerTarget + offset + 0.5;
    return texture2D(uSourceTexture, sourcePixel / uSourceSize);
  }

  void main() {
    vec2 targetPixel = floor(vUv * uTargetSize);
    float kernel = floor(uSourcePerTarget + 0.5);
    vec4 color = vec4(0.0);
    float count = 0.0;

    for (int y = 0; y < 8; y++) {
      for (int x = 0; x < 8; x++) {
        if (float(x) < kernel && float(y) < kernel) {
          color += sampleSourcePixel(targetPixel, vec2(float(x), float(y)));
          count += 1.0;
        }
      }
    }

    vec3 stars = color.rgb / max(count, 1.0);
    vec3 background = vec3(0.004, 0.005, 0.011);
    vec3 backgroundMapped = 1.0 - exp(-background * uExposure);
    vec3 combinedMapped = 1.0 - exp(-(background + stars) * uExposure);
    vec3 starContribution = max(combinedMapped - backgroundMapped, vec3(0.0));
    float alpha = clamp(max(max(starContribution.r, starContribution.g), starContribution.b), 0.0, 1.0);
    gl_FragColor = vec4(starContribution, alpha);
  }
`;

const SKY_BACKGROUND_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  varying vec2 vUv;

  void main() {
    vDirection = position;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LIGHT_COMPOSITION_BAKE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  varying vec2 vUv;

  void main() {
    vDirection = vec3(0.0, 0.0, 1.0);
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SKY_BACKGROUND_FRAGMENT_SHADER = /* glsl */ `
  #define MAX_ANCHORS ${LIGHT_COMPOSITION_MAX_ANCHORS}
  precision highp float;

  varying vec3 vDirection;
  varying vec2 vUv;

  uniform int uUseTileUv;
  uniform vec2 uTileUvMin;
  uniform vec2 uTileUvSize;
  uniform int uAnchorCount;
  uniform int uBlend;
  uniform float uPower;
  uniform float uSigma;
  uniform float uColorWarpAmp;
  uniform float uColorWarpFreq;
  uniform vec3 uAnchorDir[MAX_ANCHORS];
  uniform vec3 uAnchorColor[MAX_ANCHORS];

  uniform float uSeed;
  uniform float uCoverage;
  uniform float uDensity;
  uniform float uSoftness;
  uniform float uContrast;
  uniform float uBaseScale;
  uniform int uOctaves;
  uniform float uOpacity;

  uniform float uLightFocus;
  uniform float uLightLining;
  uniform float uLightIntensity;
  uniform float uNebulaStrength;
  uniform float uNebulaExposure;
  uniform vec3 uCloudShadow;
  uniform vec3 uCloudHighlight;
  uniform vec3 uCloudCore;

  const float PI = 3.14159265359;

  vec3 equirectDirectionFromUv(vec2 uv) {
    float phi = (uv.x - 0.5) * PI * 2.0;
    float theta = uv.y * PI;
    float sinTheta = sin(theta);
    return normalize(vec3(sin(phi) * sinTheta, cos(theta), cos(phi) * sinTheta));
  }

  vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  vec4 noised(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    vec3 ga = normalize(hash33(i + vec3(0.0, 0.0, 0.0)));
    vec3 gb = normalize(hash33(i + vec3(1.0, 0.0, 0.0)));
    vec3 gc = normalize(hash33(i + vec3(0.0, 1.0, 0.0)));
    vec3 gd = normalize(hash33(i + vec3(1.0, 1.0, 0.0)));
    vec3 ge = normalize(hash33(i + vec3(0.0, 0.0, 1.0)));
    vec3 gf = normalize(hash33(i + vec3(1.0, 0.0, 1.0)));
    vec3 gg = normalize(hash33(i + vec3(0.0, 1.0, 1.0)));
    vec3 gh = normalize(hash33(i + vec3(1.0, 1.0, 1.0)));

    float va = dot(ga, f - vec3(0.0, 0.0, 0.0));
    float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
    float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
    float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
    float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
    float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
    float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
    float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));

    float v = va
      + u.x * (vb - va)
      + u.y * (vc - va)
      + u.z * (ve - va)
      + u.x * u.y * (va - vb - vc + vd)
      + u.y * u.z * (va - vc - ve + vg)
      + u.z * u.x * (va - vb - ve + vf)
      + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);

    vec3 d = ga
      + u.x * (gb - ga)
      + u.y * (gc - ga)
      + u.z * (ge - ga)
      + u.x * u.y * (ga - gb - gc + gd)
      + u.y * u.z * (ga - gc - ge + gg)
      + u.z * u.x * (ga - gb - ge + gf)
      + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
      + du * (
        vec3(vb - va, vc - va, ve - va)
        + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf)
        + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg)
        + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh)
      );

    return vec4(v, d);
  }

  float noise01(vec3 p) {
    return noised(p).x * 0.5 + 0.5;
  }

  float fbm(vec3 p, float lacunarity, float gain) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    mat3 rot = mat3(
      0.00,  0.80,  0.60,
     -0.80,  0.36, -0.48,
     -0.60, -0.48,  0.64
    );

    for (int i = 0; i < 8; i++) {
      if (i >= uOctaves) break;
      sum += amp * noise01(p);
      norm += amp;
      p = rot * p * lacunarity + vec3(17.31, -11.73, 7.19);
      amp *= gain;
    }

    return norm > 0.0 ? sum / norm : 0.0;
  }

  vec3 warpVec(vec3 p) {
    return vec3(
      fbm(p + vec3(0.0, 0.0, 0.0), 2.02, 0.52),
      fbm(p + vec3(5.2, 1.3, 7.1), 2.03, 0.50),
      fbm(p + vec3(9.1, 8.4, 2.8), 2.01, 0.51)
    ) * 2.0 - 1.0;
  }

  vec3 colorWarp(vec3 dir) {
    if (uColorWarpAmp <= 0.0) return dir;
    vec3 offset = warpVec(dir * uColorWarpFreq + vec3(uSeed, uSeed * 0.37, -uSeed * 0.21));
    return normalize(dir + offset * uColorWarpAmp);
  }

  vec3 fieldGradient(vec3 dir) {
    vec3 d = colorWarp(dir);
    vec3 acc = vec3(0.0);
    float weightSum = 0.0;

    for (int i = 0; i < MAX_ANCHORS; i++) {
      if (i >= uAnchorCount) break;
      float dist = 1.0 - dot(d, normalize(uAnchorDir[i]));
      float weight = 0.0;
      if (uBlend == 0) {
        weight = 1.0 / pow(dist + 0.0001, uPower);
      } else {
        weight = exp(-(dist * dist) / max(0.0001, 2.0 * uSigma * uSigma));
      }
      acc += uAnchorColor[i] * weight;
      weightSum += weight;
    }

    return weightSum > 0.0 ? acc / weightSum : vec3(0.0);
  }

  vec3 lcHash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }

  float lcNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = lcHash3(i + vec3(0.0, 0.0, 0.0)).x;
    float n100 = lcHash3(i + vec3(1.0, 0.0, 0.0)).x;
    float n010 = lcHash3(i + vec3(0.0, 1.0, 0.0)).x;
    float n110 = lcHash3(i + vec3(1.0, 1.0, 0.0)).x;
    float n001 = lcHash3(i + vec3(0.0, 0.0, 1.0)).x;
    float n101 = lcHash3(i + vec3(1.0, 0.0, 1.0)).x;
    float n011 = lcHash3(i + vec3(0.0, 1.0, 1.0)).x;
    float n111 = lcHash3(i + vec3(1.0, 1.0, 1.0)).x;

    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  float lcFbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;

    for (int i = 0; i < 5; i++) {
      sum += amp * lcNoise3(p);
      norm += amp;
      p *= 2.02;
      amp *= 0.5;
    }

    return sum / norm;
  }

  float lightCompositionCloudField(vec3 dir) {
    vec3 seedOffset = vec3(uSeed * 13.17, uSeed * -7.31, uSeed * 5.19);
    vec3 p = dir * max(uBaseScale, 0.001) + seedOffset;
    vec3 q = vec3(
      lcFbm(p),
      lcFbm(p + vec3(5.2, 1.3, 2.8)),
      lcFbm(p + vec3(2.1, 4.7, 9.2))
    );
    return lcFbm(p + 3.0 * q);
  }

  float lightCompositionDensityField(vec3 dir) {
    float f = lightCompositionCloudField(dir);
    float coverage = clamp(uCoverage, 0.02, 0.98);
    float d = smoothstep(coverage, coverage + max(uSoftness, 0.001), f);
    d = pow(clamp(d, 0.0, 1.0), max(uContrast, 0.05));
    return clamp(d, 0.0, 1.0);
  }

  vec4 lightCompositionNebula(vec3 dir) {
    float density = lightCompositionDensityField(normalize(dir));
    vec3 lightField = fieldGradient(normalize(dir));
    float lightMask = clamp(max(max(lightField.r, lightField.g), lightField.b) * max(uLightIntensity, 0.0), 0.0, 1.0);
    float lit = pow(lightMask, max(uLightFocus, 0.001));

    vec3 highlight = lightField * uCloudHighlight * max(uLightIntensity, 0.0);
    vec3 color = mix(uCloudShadow, highlight, lit);
    color = mix(color, uCloudCore, clamp(density * 0.4, 0.0, 1.0));

    float lining = lit * (1.0 - density);
    color += lightField * lining * max(uLightLining, 0.0) * max(uLightIntensity, 0.0);
    color *= max(uDensity, 0.0);

    return vec4(pow(max(color, 0.0), vec3(0.92)), density * uOpacity);
  }

  void main() {
    vec2 skyUv = uTileUvMin + vUv * uTileUvSize;
    vec3 dir = uUseTileUv == 1 ? equirectDirectionFromUv(skyUv) : normalize(vDirection);
    vec4 nebula = lightCompositionNebula(dir);
    vec3 baseLinear = vec3(0.004, 0.005, 0.011);
    vec3 colorLinear = baseLinear + nebula.rgb * clamp(nebula.a, 0.0, 1.0) * max(uNebulaStrength, 0.0);
    vec3 mapped = 1.0 - exp(-max(colorLinear, vec3(0.0)) * max(uNebulaExposure, 0.001));
    gl_FragColor = vec4(mapped, 1.0);
  }
`;

const PATCH_DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PATCH_DOME_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uCurrentTexture;
  uniform sampler2D uNextTexture;
  uniform float uBlend;
  uniform vec2 uContentUvMin;
  uniform vec2 uContentUvSize;
  uniform vec2 uCurrentInnerOffset;
  uniform vec2 uCurrentInnerScale;
  uniform vec2 uNextInnerOffset;
  uniform vec2 uNextInnerScale;
  varying vec3 vDirection;

  const float PI = 3.14159265359;

  vec2 directionToEquirectUv(vec3 direction) {
    vec3 dir = normalize(direction);
    float u = atan(dir.x, dir.z) / (2.0 * PI) + 0.5;
    float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
  }

  void main() {
    vec2 skyUv = directionToEquirectUv(vDirection);
    vec2 localUv = (skyUv - uContentUvMin) / uContentUvSize;
    vec2 clampedLocalUv = clamp(localUv, 0.0, 1.0);
    vec2 currentPatchUv = uCurrentInnerOffset + clampedLocalUv * uCurrentInnerScale;
    vec4 currentColor = texture2D(uCurrentTexture, currentPatchUv);
    if (uBlend <= 0.000001) {
      gl_FragColor = currentColor;
      return;
    }

    vec2 nextPatchUv = uNextInnerOffset + clampedLocalUv * uNextInnerScale;
    vec4 nextColor = texture2D(uNextTexture, nextPatchUv);
    gl_FragColor = mix(currentColor, nextColor, clamp(uBlend, 0.0, 1.0));
  }
`;

const BACKGROUND_PATCH_DOME_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uCurrentTexture;
  uniform sampler2D uNextTexture;
  uniform float uBlend;
  uniform vec2 uCurrentStorageUvMin;
  uniform vec2 uCurrentStorageUvSize;
  uniform vec2 uNextStorageUvMin;
  uniform vec2 uNextStorageUvSize;
  varying vec3 vDirection;

  const float PI = 3.14159265359;

  vec2 directionToEquirectUv(vec3 direction) {
    vec3 dir = normalize(direction);
    float u = atan(dir.x, dir.z) / (2.0 * PI) + 0.5;
    float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
  }

  float intervalError(float value, float intervalSize) {
    return max(max(-value, value - intervalSize), 0.0);
  }

  float storageLocalU(float skyU, float storageMinU, float storageSizeU) {
    float d0 = skyU - storageMinU;
    float d1 = d0 + 1.0;
    float d2 = d0 - 1.0;
    float e0 = intervalError(d0, storageSizeU);
    float e1 = intervalError(d1, storageSizeU);
    float e2 = intervalError(d2, storageSizeU);
    float d = d0;
    if (e1 < e0 && e1 <= e2) {
      d = d1;
    } else if (e2 < e0 && e2 < e1) {
      d = d2;
    }
    return d / storageSizeU;
  }

  vec2 storageLocalUv(vec2 skyUv, vec2 storageUvMin, vec2 storageUvSize) {
    return clamp(vec2(
      storageLocalU(skyUv.x, storageUvMin.x, storageUvSize.x),
      (skyUv.y - storageUvMin.y) / storageUvSize.y
    ), 0.0, 1.0);
  }

  void main() {
    vec2 skyUv = directionToEquirectUv(vDirection);
    vec2 currentPatchUv = storageLocalUv(skyUv, uCurrentStorageUvMin, uCurrentStorageUvSize);
    vec4 currentColor = texture2D(uCurrentTexture, currentPatchUv);
    if (uBlend <= 0.000001) {
      gl_FragColor = currentColor;
      return;
    }

    vec2 nextPatchUv = storageLocalUv(skyUv, uNextStorageUvMin, uNextStorageUvSize);
    vec4 nextColor = texture2D(uNextTexture, nextPatchUv);
    gl_FragColor = mix(currentColor, nextColor, clamp(uBlend, 0.0, 1.0));
  }
`;

export function createStarMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
  });
}

export function createOverlayMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: OVERLAY_VERTEX_SHADER,
    fragmentShader: OVERLAY_FRAGMENT_SHADER,
  });
}

export function createWinkleMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: WINKLE_VERTEX_SHADER,
    fragmentShader: WINKLE_FRAGMENT_SHADER,
  });
}

export function createDownsampleMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: DOWNSAMPLE_VERTEX_SHADER,
    fragmentShader: DOWNSAMPLE_FRAGMENT_SHADER,
  });
}

export function createSkyBackgroundMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uUseTileUv: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: SKY_BACKGROUND_VERTEX_SHADER,
    fragmentShader: SKY_BACKGROUND_FRAGMENT_SHADER,
  });
}

export function createLightCompositionBakeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uUseTileUv: { value: 1 },
    },
    depthWrite: false,
    depthTest: false,
    vertexShader: LIGHT_COMPOSITION_BAKE_VERTEX_SHADER,
    fragmentShader: SKY_BACKGROUND_FRAGMENT_SHADER,
  });
}

export function createPatchDomeMaterial({ descriptor, visibleTarget }) {
  const sampling = visibleTarget.starfieldSampling ?? {
    innerOffset: descriptor.innerOffset,
    innerScale: descriptor.innerScale,
  };

  return new THREE.ShaderMaterial({
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
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: false,
    vertexShader: PATCH_DOME_VERTEX_SHADER,
    fragmentShader: PATCH_DOME_FRAGMENT_SHADER,
  });
}

export function createBackgroundPatchDomeMaterial({ descriptor, visibleTarget }) {
  const sampling = visibleTarget.starfieldSampling ?? {
    innerOffset: descriptor.innerOffset,
    innerScale: descriptor.innerScale,
    storageUvMin: descriptor.storageUvMin,
    storageUvSize: descriptor.storageUvSize,
  };

  return new THREE.ShaderMaterial({
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
    },
    side: THREE.BackSide,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    vertexShader: PATCH_DOME_VERTEX_SHADER,
    fragmentShader: BACKGROUND_PATCH_DOME_FRAGMENT_SHADER,
  });
}
