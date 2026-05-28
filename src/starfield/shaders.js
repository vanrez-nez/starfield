import * as THREE from "three";
import {
  AA_PIN_THRESHOLD_PX,
  GAUSSIAN_CUTOFF_SIGMA,
  MIN_CORE_PIXELS,
  MIN_GLARE_PIXELS,
  SUBPIXEL_DENSITY_THRESHOLD_PX,
} from "./constants.js";

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iDirection;
  attribute vec2 iUv;
  attribute vec4 iRandoms;
  attribute float iClass;

  varying vec2 vUv;
  varying vec3 vDirection;
  varying vec4 vRandoms;
  varying float vClass;

  uniform vec2 uBakeSize;
  uniform vec2 uOutputSize;
  uniform vec2 uTileUvMin;
  uniform vec2 uTileUvSize;
  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uGlareSize;
  uniform float uGlareStr;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float SUBPIXEL_DENSITY_THRESHOLD_PX = ${SUBPIXEL_DENSITY_THRESHOLD_PX.toFixed(2)};
  const float AA_PIN_THRESHOLD_PX = ${AA_PIN_THRESHOLD_PX.toFixed(2)};
  const float GAUSSIAN_CUTOFF_SIGMA = ${GAUSSIAN_CUTOFF_SIGMA.toFixed(1)};

  float sizeMultiplier(float rSize) {
    return mix(1.0, mix(0.1, 1.0, rSize), uSizeVar);
  }

  float angularPixel(vec2 textureSize) {
    return PI * max(uTileUvSize.y, 1e-6) / max(textureSize.y, 1.0);
  }

  float splatSupportAngle(float rSize) {
    float bakeAngularPx = angularPixel(uBakeSize);
    float outputAngularPx = angularPixel(uOutputSize);
    float referenceAngularPx = PI / uReferenceHeight;

    float scale = sizeMultiplier(rSize);
    float starRadius = uStarSize * scale * referenceAngularPx;
    float screenRadiusPx = starRadius / max(uScreenPixelAngle, 1e-8);
    float pinWeight = 1.0 - smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX, AA_PIN_THRESHOLD_PX, screenRadiusPx);
    float normalCoreFloor = max(MIN_CORE_PIXELS * outputAngularPx, MIN_CORE_PIXELS * uScreenPixelAngle);
    float pinCoreFloor = max(outputAngularPx, 0.5 * uScreenPixelAngle);
    float coreRadius = max(starRadius, mix(normalCoreFloor, pinCoreFloor, pinWeight));
    float coreSigma = max(coreRadius * 0.45, bakeAngularPx);

    float glareSigma = 0.0;
    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float normalWeight = smoothstep(AA_PIN_THRESHOLD_PX, AA_PIN_THRESHOLD_PX + 0.25, screenRadiusPx);
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * referenceAngularPx;
      float glareEdge = max(starRadius + glareRadius, max(MIN_GLARE_PIXELS * outputAngularPx, MIN_GLARE_PIXELS * uScreenPixelAngle));
      glareSigma = max(glareEdge * 0.36, bakeAngularPx) * normalWeight;
    }

    return max(coreSigma, glareSigma) * GAUSSIAN_CUTOFF_SIGMA;
  }

  void main() {
    float supportAngle = splatSupportAngle(iRandoms.x);
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
    vClass = iClass;
    gl_Position = vec4(patchUv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vDirection;
  varying vec4 vRandoms;
  varying float vClass;

  uniform vec2 uBakeSize;
  uniform vec2 uOutputSize;
  uniform vec2 uTileUvSize;
  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uBright;
  uniform float uBrightVar;
  uniform float uGlareSize;
  uniform float uGlareStr;
  uniform float uGlareVar;
  uniform float uColorVar;
  uniform float uOverlayEnabled;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float SUBPIXEL_DENSITY_THRESHOLD_PX = ${SUBPIXEL_DENSITY_THRESHOLD_PX.toFixed(2)};
  const float AA_PIN_THRESHOLD_PX = ${AA_PIN_THRESHOLD_PX.toFixed(2)};

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

  float sizeMultiplier(float rSize) {
    return mix(1.0, mix(0.1, 1.0, rSize), uSizeVar);
  }

  float angularPixel(vec2 textureSize) {
    return PI * max(uTileUvSize.y, 1e-6) / max(textureSize.y, 1.0);
  }

  void main() {
    if (uOverlayEnabled > 0.5 && vClass > 1.5) discard;

    vec3 dir = equirectDirection(vUv);
    float angularDistance = acos(clamp(dot(dir, normalize(vDirection)), -1.0, 1.0));

    float bakeAngularPx = angularPixel(uBakeSize);
    float outputAngularPx = angularPixel(uOutputSize);
    float referenceAngularPx = PI / uReferenceHeight;

    float scale = sizeMultiplier(vRandoms.x);
    float referenceStarRadiusPx = uStarSize * scale;
    float starRadius = referenceStarRadiusPx * referenceAngularPx;
    float screenRadiusPx = starRadius / max(uScreenPixelAngle, 1e-8);
    float subpixelWeight = 1.0 - smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX * 0.75, SUBPIXEL_DENSITY_THRESHOLD_PX, screenRadiusPx);
    float pinWeight = 1.0 - smoothstep(SUBPIXEL_DENSITY_THRESHOLD_PX, AA_PIN_THRESHOLD_PX, screenRadiusPx);
    float normalWeight = smoothstep(AA_PIN_THRESHOLD_PX, AA_PIN_THRESHOLD_PX + 0.25, screenRadiusPx);
    float normalCoreFloor = max(MIN_CORE_PIXELS * outputAngularPx, MIN_CORE_PIXELS * uScreenPixelAngle);
    float pinCoreFloor = max(outputAngularPx, 0.5 * uScreenPixelAngle);
    float minCoreRadius = mix(normalCoreFloor, pinCoreFloor, pinWeight);
    float coreRadius = max(starRadius, minCoreRadius);
    float coreEnergy = min(1.0, starRadius / max(coreRadius, 1e-8));
    float densityEnergy = max(0.08, smoothstep(0.0, SUBPIXEL_DENSITY_THRESHOLD_PX, screenRadiusPx));
    coreEnergy *= mix(1.0, densityEnergy, subpixelWeight);
    float coreSigma = max(coreRadius * 0.45, bakeAngularPx);
    float core = exp(-(angularDistance * angularDistance) / max(2.0 * coreSigma * coreSigma, 1e-10));
    core *= coreEnergy;

    float glare = 0.0;
    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float referenceGlareRadiusPx = uGlareSize * mix(1.0, scale, uSizeVar);
      float glareRadius = referenceGlareRadiusPx * referenceAngularPx;
      float minGlareRadius = max(MIN_GLARE_PIXELS * outputAngularPx, MIN_GLARE_PIXELS * uScreenPixelAngle);
      float glareEdge = max(starRadius + glareRadius, minGlareRadius);
      float glareEnergy = min(1.0, (starRadius + glareRadius) / max(glareEdge, 1e-8));
      float glareSigma = max(glareEdge * 0.36, bakeAngularPx);
      glare = exp(-(angularDistance * angularDistance) / max(2.0 * glareSigma * glareSigma, 1e-10));
      glare *= glareEnergy * normalWeight;
    }

    float glareStr = uGlareStr * mix(1.0, pow(vRandoms.z, 8.0), uGlareVar);
    float bright = uBright * mix(1.0, pow(vRandoms.y, 3.0) * 3.0, uBrightVar);
    vec3 color = starColor(mix(0.5, vRandoms.w, uColorVar));
    vec3 radiance = color * (core + glare * glareStr) * bright;

    gl_FragColor = vec4(radiance, 1.0);
  }
`;

const OVERLAY_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iDirection;
  attribute vec4 iRandoms;
  attribute float iClass;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vClass;
  varying float vSupportAngle;

  uniform float uRadius;
  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uGlareSize;
  uniform float uGlareStr;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};
  const float GAUSSIAN_CUTOFF_SIGMA = ${GAUSSIAN_CUTOFF_SIGMA.toFixed(1)};

  float sizeMultiplier(float rSize) {
    return mix(1.0, mix(0.1, 1.0, rSize), uSizeVar);
  }

  float overlaySupportAngle(float rSize) {
    float referenceAngularPx = PI / uReferenceHeight;
    float scale = sizeMultiplier(rSize);
    float starRadius = uStarSize * scale * referenceAngularPx;
    float coreRadius = max(starRadius, MIN_CORE_PIXELS * uScreenPixelAngle);
    float coreSigma = max(coreRadius * 0.42, uScreenPixelAngle * 0.5);
    float glareSigma = 0.0;

    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * referenceAngularPx;
      float glareEdge = max(starRadius + glareRadius, MIN_GLARE_PIXELS * uScreenPixelAngle);
      glareSigma = max(glareEdge * 0.36, uScreenPixelAngle * 0.5);
    }

    return max(max(coreSigma, glareSigma) * GAUSSIAN_CUTOFF_SIGMA, uScreenPixelAngle * 2.0);
  }

  void main() {
    vec3 dir = normalize(iDirection);
    vec3 referenceUp = abs(dir.y) > 0.96 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(referenceUp, dir));
    vec3 up = normalize(cross(dir, right));
    float supportAngle = overlaySupportAngle(iRandoms.x);
    vec3 offset = (right * position.x + up * position.y) * (uRadius * supportAngle);
    vec3 worldPosition = dir * uRadius + offset;

    vLocal = position.xy;
    vRandoms = iRandoms;
    vClass = iClass;
    vSupportAngle = supportAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
  }
`;

const OVERLAY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vLocal;
  varying vec4 vRandoms;
  varying float vClass;
  varying float vSupportAngle;

  uniform float uScreenPixelAngle;
  uniform float uReferenceHeight;
  uniform float uStarSize;
  uniform float uSizeVar;
  uniform float uBright;
  uniform float uBrightVar;
  uniform float uGlareSize;
  uniform float uGlareStr;
  uniform float uGlareVar;
  uniform float uColorVar;
  uniform float uOverlayStrength;

  const float PI = 3.14159265359;
  const float MIN_CORE_PIXELS = ${MIN_CORE_PIXELS.toFixed(2)};
  const float MIN_GLARE_PIXELS = ${MIN_GLARE_PIXELS.toFixed(2)};

  vec3 starColor(float t) {
    vec3 cool = vec3(1.00, 0.55, 0.30);
    vec3 mid = vec3(1.00, 0.96, 0.92);
    vec3 hot = vec3(0.70, 0.80, 1.00);
    return (t < 0.5) ? mix(cool, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
  }

  float sizeMultiplier(float rSize) {
    return mix(1.0, mix(0.1, 1.0, rSize), uSizeVar);
  }

  void main() {
    float angularDistance = length(vLocal) * vSupportAngle;
    float referenceAngularPx = PI / uReferenceHeight;
    float scale = sizeMultiplier(vRandoms.x);
    float starRadius = uStarSize * scale * referenceAngularPx;
    float coreRadius = max(starRadius, MIN_CORE_PIXELS * uScreenPixelAngle);
    float coreSigma = max(coreRadius * 0.42, uScreenPixelAngle * 0.5);
    float coreEnergy = min(1.0, starRadius / max(coreRadius, 1e-8));
    float core = exp(-(angularDistance * angularDistance) / max(2.0 * coreSigma * coreSigma, 1e-10)) * coreEnergy;

    float glare = 0.0;
    if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
      float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * referenceAngularPx;
      float glareEdge = max(starRadius + glareRadius, MIN_GLARE_PIXELS * uScreenPixelAngle);
      float glareEnergy = min(1.0, (starRadius + glareRadius) / max(glareEdge, 1e-8));
      float glareSigma = max(glareEdge * 0.36, uScreenPixelAngle * 0.5);
      glare = exp(-(angularDistance * angularDistance) / max(2.0 * glareSigma * glareSigma, 1e-10)) * glareEnergy;
    }

    float glareStr = uGlareStr * mix(1.0, pow(vRandoms.z, 8.0), uGlareVar);
    float bright = uBright * mix(1.0, pow(vRandoms.y, 3.0) * 3.0, uBrightVar);
    float classBoost = vClass > 2.5 ? 1.28 : 1.0;
    vec3 color = starColor(mix(0.5, vRandoms.w, uColorVar));
    vec3 radiance = color * (core + glare * glareStr) * bright * classBoost * uOverlayStrength;

    if (max(max(radiance.r, radiance.g), radiance.b) < 0.00001) discard;
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
    vec3 mapped = 1.0 - exp(-(background + stars) * uExposure);
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
  uniform vec2 uInnerOffset;
  uniform vec2 uInnerScale;
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
    if (localUv.x < -0.000001 || localUv.x > 1.000001 || localUv.y < -0.000001 || localUv.y > 1.000001) {
      discard;
    }

    vec2 patchUv = uInnerOffset + clamp(localUv, 0.0, 1.0) * uInnerScale;
    vec4 currentColor = texture2D(uCurrentTexture, patchUv);
    if (uBlend <= 0.000001) {
      gl_FragColor = currentColor;
      return;
    }

    vec4 nextColor = texture2D(uNextTexture, patchUv);
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
    depthTest: false,
    depthWrite: false,
    vertexShader: OVERLAY_VERTEX_SHADER,
    fragmentShader: OVERLAY_FRAGMENT_SHADER,
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

export function createPatchDomeMaterial({ descriptor, visibleTarget }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCurrentTexture: { value: visibleTarget.texture },
      uNextTexture: { value: visibleTarget.texture },
      uBlend: { value: 0 },
      uContentUvMin: { value: descriptor.uvMin.clone() },
      uContentUvSize: { value: descriptor.uvSize.clone() },
      uInnerOffset: { value: descriptor.innerOffset.clone() },
      uInnerScale: { value: descriptor.innerScale.clone() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: PATCH_DOME_VERTEX_SHADER,
    fragmentShader: PATCH_DOME_FRAGMENT_SHADER,
  });
}
