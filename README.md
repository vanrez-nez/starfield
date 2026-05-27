# Starfield Skybox Playground

Three.js shader playground for a configurable procedural starfield. The star shader bakes equirectangular skydome patches, then the visible scene maps those patches onto an inside-facing sphere.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Skydome Shape

- `src/main.js` builds a deterministic star catalog from the current seed, density, and sparsity controls.
- The generated bake renders that catalog as seam-duplicated instanced equirectangular quads into a temporary supersampled patch target, then box-filters down into guarded output patches.
- Each star fragment maps its equirectangular UV to a spherical direction and measures angular distance to the star direction, so core and glare falloffs are circular on the skydome instead of bounded by texture cells.
- The visible scene uses clipped full-sphere patch passes, so each generated patch samples through the same skydome UV mapping while avoiding physical segment seams.
- The Bake panel includes a texture-source switch that swaps the skydome sampler between the generated render target and `starfield-test.png` for comparison.
- There is no cubemap render target, mipmapping, or cube-face sampling.
- Each patch render target is a normal 2D texture, so the tiled set can be composed with other baked sky effects later.
- Star and glare sizes are measured in angular units against a fixed `4096x2048` reference, with minimum final-texel footprints to keep low-resolution bakes round when magnified.
- The generated bake uses smooth Gaussian-style core/glare falloffs and additive star radiance accumulation. It prefers a half-float accumulation target and falls back to an unsigned-byte target if the browser cannot render and blend half-float textures.
- `Virtual Size` is the logical skydome size. `1024`, `2048`, and `4096` use one patch; `8192` uses a `2x2` grid; `16384` uses a `4x4` grid unless the GPU texture limit requires more patches.
- Tiled patches include a 64-texel guard band to keep filtering continuous across patch boundaries.
- Supersampling is automatic per patch: `min(8, floor(MAX_TEXTURE_SIZE / patchStorageWidth), floor(MAX_TEXTURE_SIZE / patchStorageHeight))`.
- The panel shows the selected virtual size, patch grid, content patch size, automatic supersample factor, internal patch size, and WebGL texture limit used for the cap.
- The `Sphere Segments` display control rebuilds only the skydome geometry. It does not rebake generated textures; vertical segments are derived as half of the horizontal setting.
- Lower final textures are useful for storage/performance previews, but they still have fewer texels to sample in the skydome. A `1024x512` equirectangular texture cannot preserve crisp sub-texel stars when magnified through a 60 degree camera.
- The app renders on demand for resize, camera drag, and bake completion instead of running a continuous animation loop.
- The display camera keeps a fixed horizontal FOV and derives Three.js' vertical FOV from the current viewport aspect.
- Shader controls expose base and variance per feature: density/sparsity, core size/size variance, brightness/brightness variance, glare size/strength/variance, and color variance.
- Press `Tab` to print basic GPU/render stats, including skydome segment counts, to the browser console and show a temporary in-app stats panel.
