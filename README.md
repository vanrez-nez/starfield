# Starfield Skybox Playground

Three.js shader playground for a configurable procedural starfield. This diagnostic version renders a true skydome sphere with camera-centered point-sprite stars, avoiding cubemap projection and filtering.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Skydome Shape

- `src/main.js` creates an inside-facing sphere for the dark skydome background.
- Stars are distributed on that sphere as `THREE.Points`, and each point is shaded with `gl_PointCoord`, so the visible star/glare footprint is circular in screen space.
- There is no cubemap render target, mipmapping, or cube-face sampling in this version.
- The app renders on demand for resize, camera drag, field rebuilds, and visual uniform changes instead of running a continuous animation loop.
- Shader controls expose base and variance per feature: density/sparsity, core size/size variance, brightness/brightness variance, glare size/strength/variance, and color variance.
