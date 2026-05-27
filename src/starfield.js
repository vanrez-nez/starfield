import * as THREE from "three";

const DOME_RADIUS = 10;
const REFERENCE_BAKE_WIDTH = 4096;
const REFERENCE_BAKE_HEIGHT = REFERENCE_BAKE_WIDTH / 2;
const MAX_AUTO_SUPERSAMPLE = 8;
const VIRTUAL_WIDTH_OPTIONS = [1024, 2048, 4096, 8192, 16384];
const PATCH_GUARD_TEXELS = 64;
const MIN_CORE_FINAL_TEXELS = 1.75;
const MIN_GLARE_FINAL_TEXELS = 3.25;
const GAUSSIAN_CUTOFF_SIGMA = 6.0;
const CATALOG_PARAMS = new Set(["uDensity", "uSparsity"]);

function sphereVerticalSegmentsFor(horizontalSegments) {
  return Math.max(8, Math.floor(horizontalSegments / 2));
}

function sizeLabel(width, height) {
  return `${Math.round(width)}x${Math.round(height)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function estimateTextureBytes(width, height, bytesPerPixel) {
  return width * height * bytesPerPixel;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function catalogSeed(value) {
  const scaled = Math.floor(value * 1000003);
  return (scaled ^ 0x9e3779b9) >>> 0;
}

export function createStarfield({ renderer, scene, requestRender }) {
  const gl = renderer.getContext();
  const WEBGL_MAX_TEXTURE_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const FLOAT_BLEND_SUPPORTED = Boolean(renderer.extensions.get("EXT_float_blend"));
  const HALF_FLOAT_ACCUMULATION_SUPPORTED = renderer.capabilities.isWebGL2
    ? Boolean(renderer.extensions.get("EXT_color_buffer_float")) && FLOAT_BLEND_SUPPORTED
    : Boolean(renderer.extensions.get("EXT_color_buffer_half_float")) && FLOAT_BLEND_SUPPORTED;
  const STAR_ACCUMULATION_TYPE = HALF_FLOAT_ACCUMULATION_SUPPORTED ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const starScene = new THREE.Scene();
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let bakeStatusHandler = () => {};
  let readoutsChangeHandler = () => {};

  function basePatchGridFor(virtualWidth) {
    if (virtualWidth <= 4096) return 1;
    if (virtualWidth <= 8192) return 2;
    return 4;
  }

  function createPatchLayout(virtualWidth) {
    const virtualHeight = virtualWidth / 2;
    let columns = basePatchGridFor(virtualWidth);
    let rows = columns;
    const guard = columns === 1 ? 0 : PATCH_GUARD_TEXELS;

    while (columns <= virtualWidth && rows <= virtualHeight) {
      const contentWidth = virtualWidth / columns;
      const contentHeight = virtualHeight / rows;
      const storageWidth = contentWidth + guard * 2;
      const storageHeight = contentHeight + guard * 2;

      if (storageWidth <= WEBGL_MAX_TEXTURE_SIZE && storageHeight <= WEBGL_MAX_TEXTURE_SIZE) {
        return {
          virtualWidth,
          virtualHeight,
          columns,
          rows,
          guard,
          contentWidth,
          contentHeight,
          storageWidth,
          storageHeight,
        };
      }

      columns *= 2;
      rows *= 2;
    }

    return null;
  }

  function supportedBakeWidths() {
    return VIRTUAL_WIDTH_OPTIONS.filter((width) => createPatchLayout(width) !== null);
  }

  function defaultBakeWidth() {
    const widths = supportedBakeWidths();
    if (widths.includes(REFERENCE_BAKE_WIDTH)) return REFERENCE_BAKE_WIDTH;
    return widths[widths.length - 1] || VIRTUAL_WIDTH_OPTIONS[0];
  }

  function autoSupersampleForLayout(layout) {
    const widthLimit = Math.floor(WEBGL_MAX_TEXTURE_SIZE / layout.storageWidth);
    const heightLimit = Math.floor(WEBGL_MAX_TEXTURE_SIZE / layout.storageHeight);
    const textureLimit = Math.min(widthLimit, heightLimit);
    return Math.max(1, Math.min(MAX_AUTO_SUPERSAMPLE, textureLimit));
  }

  function precisionWidthForLayout(layout) {
    return layout.storageWidth * autoSupersampleForLayout(layout);
  }

  function precisionHeightForLayout(layout) {
    return layout.storageHeight * autoSupersampleForLayout(layout);
  }

  function patchGridLabel(layout) {
    return `${layout.columns}x${layout.rows}`;
  }

  const defaults = {
    uDensity: 104,
    uSparsity: 0.79,
    uStarSize: 0.9,
    uSizeVar: 0.58,
    uBright: 1.7,
    uBrightVar: 0.7,
    uGlareSize: 1.4,
    uGlareStr: 0.24,
    uGlareVar: 0.64,
    uColorVar: 0.64,
    uSeed: 1,
    bakeWidth: defaultBakeWidth(),
    sphereSegments: 128,
  };
  const defaultPatchLayout = createPatchLayout(defaults.bakeWidth);
  let currentSphereSegments = defaults.sphereSegments;

  const stats = {
    mode: "baked-equirect-skydome-tiled-catalog-splat",
    bakes: 0,
    renders: 0,
    textureWidth: defaults.bakeWidth,
    textureHeight: defaults.bakeWidth / 2,
    supersampleMode: "auto",
    horizontalFov: 0,
    verticalFov: 0,
    supersample: autoSupersampleForLayout(defaultPatchLayout),
    maxSupersample: MAX_AUTO_SUPERSAMPLE,
    maxTextureSize: WEBGL_MAX_TEXTURE_SIZE,
    accumulationType: HALF_FLOAT_ACCUMULATION_SUPPORTED ? "HalfFloatType" : "UnsignedByteType",
    patchGrid: patchGridLabel(defaultPatchLayout),
    patchWidth: defaultPatchLayout.contentWidth,
    patchHeight: defaultPatchLayout.contentHeight,
    patchStorageWidth: defaultPatchLayout.storageWidth,
    patchStorageHeight: defaultPatchLayout.storageHeight,
    patchGuard: defaultPatchLayout.guard,
    starCount: 0,
    starInstances: 0,
    referenceWidth: REFERENCE_BAKE_WIDTH,
    referenceHeight: REFERENCE_BAKE_HEIGHT,
    internalWidth: precisionWidthForLayout(defaultPatchLayout),
    internalHeight: precisionHeightForLayout(defaultPatchLayout),
    sphereSegments: currentSphereSegments,
    sphereVerticalSegments: sphereVerticalSegmentsFor(currentSphereSegments),
    lastBakeMs: 0,
  };
  window.starfieldStats = stats;

  const bakeUniforms = {
    uBakeSize: { value: new THREE.Vector2(precisionWidthForLayout(defaultPatchLayout), precisionHeightForLayout(defaultPatchLayout)) },
    uFinalSize: { value: new THREE.Vector2(defaults.bakeWidth, defaults.bakeWidth / 2) },
    uTileUvMin: { value: new THREE.Vector2(0, 0) },
    uTileUvSize: { value: new THREE.Vector2(1, 1) },
    uReferenceHeight: { value: REFERENCE_BAKE_HEIGHT },
    uDensity: { value: defaults.uDensity },
    uSparsity: { value: defaults.uSparsity },
    uStarSize: { value: defaults.uStarSize },
    uSizeVar: { value: defaults.uSizeVar },
    uBright: { value: defaults.uBright },
    uBrightVar: { value: defaults.uBrightVar },
    uGlareSize: { value: defaults.uGlareSize },
    uGlareStr: { value: defaults.uGlareStr },
    uGlareVar: { value: defaults.uGlareVar },
    uColorVar: { value: defaults.uColorVar },
    uSeed: { value: defaults.uSeed },
  };

  const starMaterial = new THREE.ShaderMaterial({
    uniforms: bakeUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 iDirection;
      attribute vec2 iUv;
      attribute vec4 iRandoms;

      varying vec2 vUv;
      varying vec3 vDirection;
      varying vec4 vRandoms;

      uniform vec2 uBakeSize;
      uniform vec2 uFinalSize;
      uniform vec2 uTileUvMin;
      uniform vec2 uTileUvSize;
      uniform float uReferenceHeight;
      uniform float uStarSize;
      uniform float uSizeVar;
      uniform float uGlareSize;
      uniform float uGlareStr;

      const float PI = 3.14159265359;
      const float MIN_CORE_FINAL_TEXELS = ${MIN_CORE_FINAL_TEXELS.toFixed(2)};
      const float MIN_GLARE_FINAL_TEXELS = ${MIN_GLARE_FINAL_TEXELS.toFixed(2)};
      const float GAUSSIAN_CUTOFF_SIGMA = ${GAUSSIAN_CUTOFF_SIGMA.toFixed(1)};

      float sizeMultiplier(float rSize) {
        return mix(1.0, mix(0.1, 1.0, rSize), uSizeVar);
      }

      float splatSupportAngle(float rSize) {
        float bakeAngularPx = PI / uBakeSize.y;
        float finalAngularPx = PI / uFinalSize.y;
        float referenceAngularPx = PI / uReferenceHeight;

        float scale = sizeMultiplier(rSize);
        float starRadius = uStarSize * scale * referenceAngularPx;
        float coreRadius = max(starRadius, MIN_CORE_FINAL_TEXELS * finalAngularPx);
        float coreSigma = max(coreRadius * 0.45, bakeAngularPx);

        float glareSigma = 0.0;
        if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
          float glareRadius = uGlareSize * mix(1.0, scale, uSizeVar) * referenceAngularPx;
          float glareEdge = max(starRadius + glareRadius, MIN_GLARE_FINAL_TEXELS * finalAngularPx);
          glareSigma = max(glareEdge * 0.36, bakeAngularPx);
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
        gl_Position = vec4(patchUv * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      varying vec3 vDirection;
      varying vec4 vRandoms;

      uniform vec2 uBakeSize;
      uniform vec2 uFinalSize;
      uniform float uReferenceHeight;
      uniform float uStarSize;
      uniform float uSizeVar;
      uniform float uBright;
      uniform float uBrightVar;
      uniform float uGlareSize;
      uniform float uGlareStr;
      uniform float uGlareVar;
      uniform float uColorVar;

      const float PI = 3.14159265359;
      const float MIN_CORE_FINAL_TEXELS = ${MIN_CORE_FINAL_TEXELS.toFixed(2)};
      const float MIN_GLARE_FINAL_TEXELS = ${MIN_GLARE_FINAL_TEXELS.toFixed(2)};

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

      void main() {
        vec3 dir = equirectDirection(vUv);
        float angularDistance = acos(clamp(dot(dir, normalize(vDirection)), -1.0, 1.0));

        float bakeAngularPx = PI / uBakeSize.y;
        float finalAngularPx = PI / uFinalSize.y;
        float referenceAngularPx = PI / uReferenceHeight;
        float minCoreRadius = MIN_CORE_FINAL_TEXELS * finalAngularPx;
        float minGlareRadius = MIN_GLARE_FINAL_TEXELS * finalAngularPx;

        float scale = sizeMultiplier(vRandoms.x);
        float referenceStarRadiusPx = uStarSize * scale;
        float starRadius = referenceStarRadiusPx * referenceAngularPx;
        float coreRadius = max(starRadius, minCoreRadius);
        float coreEnergy = min(1.0, starRadius / max(coreRadius, 1e-8));
        float coreSigma = max(coreRadius * 0.45, bakeAngularPx);
        float core = exp(-(angularDistance * angularDistance) / max(2.0 * coreSigma * coreSigma, 1e-10));
        core *= coreEnergy;

        float glare = 0.0;
        if (uGlareSize > 0.000001 && uGlareStr > 0.000001) {
          float referenceGlareRadiusPx = uGlareSize * mix(1.0, scale, uSizeVar);
          float glareRadius = referenceGlareRadiusPx * referenceAngularPx;
          float glareEdge = max(starRadius + glareRadius, minGlareRadius);
          float glareEnergy = min(1.0, (starRadius + glareRadius) / max(glareEdge, 1e-8));
          float glareSigma = max(glareEdge * 0.36, bakeAngularPx);
          glare = exp(-(angularDistance * angularDistance) / max(2.0 * glareSigma * glareSigma, 1e-10));
          glare *= glareEnergy;
        }

        float glareStr = uGlareStr * mix(1.0, pow(vRandoms.z, 8.0), uGlareVar);
        float bright = uBright * mix(1.0, pow(vRandoms.y, 3.0) * 3.0, uBrightVar);
        vec3 color = starColor(mix(0.5, vRandoms.w, uColorVar));
        vec3 radiance = color * (core + glare * glareStr) * bright;

        gl_FragColor = vec4(radiance, 1.0);
      }
    `,
  });

  const EMPTY_STAR_POSITIONS = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    1, -1,
    1, 1,
    -1, 1,
  ]);

  function createEmptyStarGeometry() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(EMPTY_STAR_POSITIONS, 2));
    geometry.instanceCount = 0;
    return geometry;
  }

  let starGeometry = createEmptyStarGeometry();
  const starMesh = new THREE.Mesh(starGeometry, starMaterial);
  starMesh.frustumCulled = false;
  starScene.add(starMesh);
  let catalogDirty = true;

  function catalogStarCount() {
    const density = bakeUniforms.uDensity.value;
    const sparsity = bakeUniforms.uSparsity.value;
    return Math.max(32, Math.round(density * density * (1 - sparsity)));
  }

  function createStarGeometry(count) {
    const seamCopies = 3;
    const instanceCount = count * seamCopies;
    const directions = new Float32Array(instanceCount * 3);
    const uvs = new Float32Array(instanceCount * 2);
    const randoms = new Float32Array(instanceCount * 4);
    const random = mulberry32(catalogSeed(bakeUniforms.uSeed.value));
    let instance = 0;

    for (let i = 0; i < count; i += 1) {
      const y = 1 - random() * 2;
      const theta = (random() * 2 - 1) * Math.PI;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const x = ring * Math.sin(theta);
      const z = ring * Math.cos(theta);
      const u = theta / (Math.PI * 2) + 0.5;
      const v = Math.acos(THREE.MathUtils.clamp(y, -1, 1)) / Math.PI;
      const rSize = random();
      const rBright = random();
      const rGlare = random();
      const rColor = random();

      for (let seam = -1; seam <= 1; seam += 1) {
        const directionOffset = instance * 3;
        const uvOffset = instance * 2;
        const randomOffset = instance * 4;

        directions[directionOffset] = x;
        directions[directionOffset + 1] = y;
        directions[directionOffset + 2] = z;
        uvs[uvOffset] = u + seam;
        uvs[uvOffset + 1] = v;
        randoms[randomOffset] = rSize;
        randoms[randomOffset + 1] = rBright;
        randoms[randomOffset + 2] = rGlare;
        randoms[randomOffset + 3] = rColor;
        instance += 1;
      }
    }

    const geometry = createEmptyStarGeometry();
    geometry.setAttribute("iDirection", new THREE.InstancedBufferAttribute(directions, 3));
    geometry.setAttribute("iUv", new THREE.InstancedBufferAttribute(uvs, 2));
    geometry.setAttribute("iRandoms", new THREE.InstancedBufferAttribute(randoms, 4));
    geometry.instanceCount = instanceCount;
    return geometry;
  }

  function rebuildStarCatalog() {
    const count = catalogStarCount();
    const nextGeometry = createStarGeometry(count);
    starMesh.geometry = nextGeometry;
    starGeometry.dispose();
    starGeometry = nextGeometry;
    catalogDirty = false;
    stats.starCount = count;
    stats.starInstances = count * 3;
  }

  function markCatalogDirty() {
    catalogDirty = true;
  }

  function ensureStarCatalog() {
    if (catalogDirty) {
      rebuildStarCatalog();
    }
  }

  const downsampleUniforms = {
    uSourceTexture: { value: null },
    uSourceSize: { value: new THREE.Vector2(1, 1) },
    uTargetSize: { value: new THREE.Vector2(1, 1) },
    uSourcePerTarget: { value: 1 },
    uExposure: { value: 1 },
  };

  const downsampleMaterial = new THREE.ShaderMaterial({
    uniforms: downsampleUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
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
    `,
  });

  const downsampleScene = new THREE.Scene();
  const downsampleQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), downsampleMaterial);
  downsampleQuad.frustumCulled = false;
  downsampleScene.add(downsampleQuad);

  function createDomeGeometry() {
    return new THREE.SphereGeometry(
      DOME_RADIUS,
      currentSphereSegments,
      sphereVerticalSegmentsFor(currentSphereSegments),
    );
  }

  function createPatchDomeMaterial(patch, layout) {
    const innerOffset = new THREE.Vector2(layout.guard / layout.storageWidth, layout.guard / layout.storageHeight);
    const innerScale = new THREE.Vector2(layout.contentWidth / layout.storageWidth, layout.contentHeight / layout.storageHeight);
    const contentUvMin = new THREE.Vector2(
      (patch.x * layout.contentWidth) / layout.virtualWidth,
      (patch.y * layout.contentHeight) / layout.virtualHeight,
    );
    const contentUvSize = new THREE.Vector2(
      layout.contentWidth / layout.virtualWidth,
      layout.contentHeight / layout.virtualHeight,
    );

    return new THREE.ShaderMaterial({
      uniforms: {
        uSkyTexture: { value: patch.target.texture },
        uContentUvMin: { value: contentUvMin },
        uContentUvSize: { value: contentUvSize },
        uInnerOffset: { value: innerOffset },
        uInnerScale: { value: innerScale },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDirection;

        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform sampler2D uSkyTexture;
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
          gl_FragColor = texture2D(uSkyTexture, uInnerOffset + clamp(localUv, 0.0, 1.0) * uInnerScale);
        }
      `,
    });
  }

  function createPatchDomeMesh(patch, layout) {
    const geometry = createDomeGeometry();
    const material = createPatchDomeMaterial(patch, layout);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    patch.mesh = mesh;
    patch.material = material;
    return mesh;
  }

  const bakedDomeGroup = new THREE.Group();
  scene.add(bakedDomeGroup);

  function createRenderTarget(width, height, options = {}) {
    const {
      type = THREE.UnsignedByteType,
      colorSpace = THREE.SRGBColorSpace,
      name = "Baked equirectangular skydome starfield",
      wrapS = THREE.ClampToEdgeWrapping,
      wrapT = THREE.ClampToEdgeWrapping,
    } = options;
    const target = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS,
      wrapT,
    });

    target.texture.name = name;
    target.texture.colorSpace = colorSpace;
    target.texture.generateMipmaps = false;
    return target;
  }

  function createAccumulationTarget(width, height) {
    return createRenderTarget(width, height, {
      type: STAR_ACCUMULATION_TYPE,
      colorSpace: THREE.LinearSRGBColorSpace,
      name: "HDR star radiance accumulation",
    });
  }

  function createPatchRenderTargets(layout) {
    const patches = [];
    const horizontalWrap = layout.columns === 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;

    for (let y = 0; y < layout.rows; y += 1) {
      for (let x = 0; x < layout.columns; x += 1) {
        patches.push({
          x,
          y,
          target: createRenderTarget(layout.storageWidth, layout.storageHeight, {
            name: `Baked skydome patch ${x + 1},${y + 1}`,
            wrapS: horizontalWrap,
          }),
          mesh: null,
          material: null,
        });
      }
    }

    return patches;
  }

  function disposePatchRenderTargets(patches) {
    patches.forEach((patch) => {
      patch.target.dispose();
    });
  }

  function disposeBakedDomeMeshes() {
    while (bakedDomeGroup.children.length > 0) {
      const child = bakedDomeGroup.children[0];
      bakedDomeGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
  }

  function rebuildBakedDomeMeshes(patches, layout) {
    disposeBakedDomeMeshes();
    patches.forEach((patch) => {
      bakedDomeGroup.add(createPatchDomeMesh(patch, layout));
    });
  }

  let currentBakeWidth = defaults.bakeWidth;
  let currentPatchLayout = createPatchLayout(currentBakeWidth);
  let currentSupersample = autoSupersampleForLayout(currentPatchLayout);
  let renderTargets = createPatchRenderTargets(currentPatchLayout);
  let supersampleTarget = createAccumulationTarget(precisionWidthForLayout(currentPatchLayout), precisionHeightForLayout(currentPatchLayout));
  let bakeTimer = 0;
  rebuildBakedDomeMeshes(renderTargets, currentPatchLayout);

  function setBakeStatus(label, disabled = false) {
    bakeStatusHandler(label, disabled);
  }

  function notifyReadouts() {
    readoutsChangeHandler(getReadouts());
  }

  function updatePatchStats() {
    stats.textureWidth = currentBakeWidth;
    stats.textureHeight = currentBakeWidth / 2;
    stats.supersample = currentSupersample;
    stats.maxTextureSize = WEBGL_MAX_TEXTURE_SIZE;
    stats.accumulationType = HALF_FLOAT_ACCUMULATION_SUPPORTED ? "HalfFloatType" : "UnsignedByteType";
    stats.patchGrid = patchGridLabel(currentPatchLayout);
    stats.patchWidth = currentPatchLayout.contentWidth;
    stats.patchHeight = currentPatchLayout.contentHeight;
    stats.patchStorageWidth = currentPatchLayout.storageWidth;
    stats.patchStorageHeight = currentPatchLayout.storageHeight;
    stats.patchGuard = currentPatchLayout.guard;
    stats.internalWidth = precisionWidthForLayout(currentPatchLayout);
    stats.internalHeight = precisionHeightForLayout(currentPatchLayout);
  }

  function updateSphereSegmentStats() {
    stats.sphereSegments = currentSphereSegments;
    stats.sphereVerticalSegments = sphereVerticalSegmentsFor(currentSphereSegments);
  }

  function rebuildDisplayGeometry() {
    rebuildBakedDomeMeshes(renderTargets, currentPatchLayout);
    updateSphereSegmentStats();
    requestRender();
  }

  function bakeSkydome() {
    clearTimeout(bakeTimer);
    setBakeStatus("Baking", true);

    requestAnimationFrame(() => {
      const bakeStart = performance.now();
      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      const previousClearColor = new THREE.Color();
      renderer.getClearColor(previousClearColor);
      const previousClearAlpha = renderer.getClearAlpha();
      currentSupersample = autoSupersampleForLayout(currentPatchLayout);
      const internalWidth = precisionWidthForLayout(currentPatchLayout);
      const internalHeight = precisionHeightForLayout(currentPatchLayout);
      const sourcePerTarget = internalWidth / currentPatchLayout.storageWidth;

      ensureStarCatalog();
      bakeUniforms.uBakeSize.value.set(internalWidth, internalHeight);
      bakeUniforms.uFinalSize.value.set(currentPatchLayout.virtualWidth, currentPatchLayout.virtualHeight);
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);

      renderTargets.forEach((patch, index) => {
        setBakeStatus(`Baking ${index + 1}/${renderTargets.length}`, true);
        bakeUniforms.uTileUvMin.value.set(
          (patch.x * currentPatchLayout.contentWidth - currentPatchLayout.guard) / currentPatchLayout.virtualWidth,
          (patch.y * currentPatchLayout.contentHeight - currentPatchLayout.guard) / currentPatchLayout.virtualHeight,
        );
        bakeUniforms.uTileUvSize.value.set(
          currentPatchLayout.storageWidth / currentPatchLayout.virtualWidth,
          currentPatchLayout.storageHeight / currentPatchLayout.virtualHeight,
        );

        renderer.setRenderTarget(supersampleTarget);
        renderer.clear();
        renderer.render(starScene, bakeCamera);

        downsampleUniforms.uSourceTexture.value = supersampleTarget.texture;
        downsampleUniforms.uSourceSize.value.set(internalWidth, internalHeight);
        downsampleUniforms.uTargetSize.value.set(currentPatchLayout.storageWidth, currentPatchLayout.storageHeight);
        downsampleUniforms.uSourcePerTarget.value = sourcePerTarget;
        renderer.setRenderTarget(patch.target);
        renderer.clear();
        renderer.render(downsampleScene, bakeCamera);
      });

      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      stats.bakes += 1;
      updatePatchStats();
      stats.lastBakeMs = Number((performance.now() - bakeStart).toFixed(2));
      setBakeStatus("Bake");
      notifyReadouts();
      requestRender();
    });
  }

  function scheduleBake(delay = 180) {
    clearTimeout(bakeTimer);
    bakeTimer = window.setTimeout(bakeSkydome, delay);
  }

  function setBakeWidth(width) {
    if (width === currentBakeWidth) return;

    const previousTargets = renderTargets;
    const previousSupersampleTarget = supersampleTarget;
    currentBakeWidth = width;
    currentPatchLayout = createPatchLayout(currentBakeWidth);
    currentSupersample = autoSupersampleForLayout(currentPatchLayout);
    renderTargets = createPatchRenderTargets(currentPatchLayout);
    supersampleTarget = createAccumulationTarget(precisionWidthForLayout(currentPatchLayout), precisionHeightForLayout(currentPatchLayout));
    rebuildBakedDomeMeshes(renderTargets, currentPatchLayout);
    disposePatchRenderTargets(previousTargets);
    previousSupersampleTarget.dispose();
    updatePatchStats();
    notifyReadouts();
    requestRender();
    scheduleBake(0);
  }

  function setParam(key, value, delay = 180) {
    if (!bakeUniforms[key]) return;
    bakeUniforms[key].value = value;
    if (CATALOG_PARAMS.has(key)) {
      markCatalogDirty();
    }
    scheduleBake(delay);
  }

  function setSphereSegments(value) {
    currentSphereSegments = value;
    rebuildDisplayGeometry();
  }

  function reseed() {
    bakeUniforms.uSeed.value = Math.random() * 1000;
    markCatalogDirty();
    scheduleBake(0);
  }

  function getReadouts() {
    return {
      bakeWidth: currentBakeWidth,
      supportedBakeWidths: supportedBakeWidths(),
      patchGrid: patchGridLabel(currentPatchLayout),
      patchSize: sizeLabel(currentPatchLayout.contentWidth, currentPatchLayout.contentHeight),
      supersample: `${currentSupersample}x`,
      internalPatchSize: sizeLabel(precisionWidthForLayout(currentPatchLayout), precisionHeightForLayout(currentPatchLayout)),
      gpuLimit: `${WEBGL_MAX_TEXTURE_SIZE}`,
    };
  }

  function setCameraInfo(cameraInfo) {
    stats.horizontalFov = cameraInfo.horizontalFov;
    stats.verticalFov = cameraInfo.verticalFov;
  }

  function recordRender() {
    stats.renders += 1;
  }

  function collectStats(rendererInfo, cameraInfo = {}) {
    if (cameraInfo.horizontalFov !== undefined && cameraInfo.verticalFov !== undefined) {
      setCameraInfo(cameraInfo);
    }

    const patchTextureBytes = estimateTextureBytes(
      currentPatchLayout.storageWidth,
      currentPatchLayout.storageHeight,
      4,
    ) * renderTargets.length;
    const accumulationBytesPerPixel = STAR_ACCUMULATION_TYPE === THREE.HalfFloatType ? 8 : 4;
    const accumulationTextureBytes = estimateTextureBytes(
      precisionWidthForLayout(currentPatchLayout),
      precisionHeightForLayout(currentPatchLayout),
      accumulationBytesPerPixel,
    );
    const estimatedTextureBytes = patchTextureBytes + accumulationTextureBytes;
    const result = {
      ...stats,
      frame: rendererInfo.render.frame,
      drawCalls: rendererInfo.render.calls,
      callFrames: `${rendererInfo.render.calls}/${rendererInfo.render.frame}`,
      polygons: rendererInfo.render.triangles,
      triangles: rendererInfo.render.triangles,
      points: rendererInfo.render.points,
      lines: rendererInfo.render.lines,
      geometries: rendererInfo.memory.geometries,
      textures: rendererInfo.memory.textures,
      shaderPrograms: rendererInfo.programs?.length ?? 0,
      virtualSize: sizeLabel(currentPatchLayout.virtualWidth, currentPatchLayout.virtualHeight),
      patchGrid: patchGridLabel(currentPatchLayout),
      patchCount: renderTargets.length,
      patchSize: sizeLabel(currentPatchLayout.contentWidth, currentPatchLayout.contentHeight),
      patchStorageSize: sizeLabel(currentPatchLayout.storageWidth, currentPatchLayout.storageHeight),
      internalPatchSize: sizeLabel(precisionWidthForLayout(currentPatchLayout), precisionHeightForLayout(currentPatchLayout)),
      supersample: `${currentSupersample}x`,
      accumulationType: HALF_FLOAT_ACCUMULATION_SUPPORTED ? "HalfFloatType" : "UnsignedByteType",
      estimatedTextureMemory: formatBytes(estimatedTextureBytes),
      estimatedTextureBytes,
    };
    Object.assign(stats, result);
    return result;
  }

  function dispose() {
    clearTimeout(bakeTimer);
    disposePatchRenderTargets(renderTargets);
    disposeBakedDomeMeshes();
    supersampleTarget.dispose();
    starGeometry.dispose();
    starMaterial.dispose();
    downsampleQuad.geometry.dispose();
    downsampleMaterial.dispose();
    scene.remove(bakedDomeGroup);
  }

  function setBakeStatusHandler(handler) {
    bakeStatusHandler = handler;
  }

  function setReadoutsChangeHandler(handler) {
    readoutsChangeHandler = handler;
  }

  return {
    defaults,
    getSupportedBakeWidths: supportedBakeWidths,
    getReadouts,
    setParam,
    setSphereSegments,
    setBakeWidth,
    reseed,
    bakeNow: bakeSkydome,
    scheduleBake,
    collectStats,
    dispose,
    setBakeStatusHandler,
    setReadoutsChangeHandler,
    setCameraInfo,
    recordRender,
  };
}
