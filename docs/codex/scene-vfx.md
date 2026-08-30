# Extending scene VFX from Codex

Preserve the domain/renderer boundary: storyboards describe semantic intent; they never import or name React, Remotion, PixiJS, WebGL classes, containers, filters, or shaders.

## Add a particle preset

Add a data-first emitter definition and name in `src/particles/presets.ts`. Reuse `ParticleEmitter`; do not create a React particle component. Add deterministic engine/preset tests, then use the preset in a fixture and inspect its five sampled frames. Keep counts bounded and fade particles at birth and death.

## Add a VFX preset or bundle

Register the name, backend, family, and description in `src/vfx/registry.ts`. Implement the visual in `ReactEffect` or `drawEffect` according to its renderer registration. Add parameter validation to `resolveEffectPreset`. Bundles resolve to several low-level presets and must not hide provider calls or mutable state.

## Add a new effect implementation

Prefer an existing primitive first. Use React/CSS for typography-safe overlays and light finishing effects. Use Pixi for dense sprites, procedural atmosphere, distortion, masks, and high-volume animated elements. Keep setup outside per-frame code and compute every frame from time plus seed.

## Render and inspect fixtures

```bash
npm run video -- doctor
npx remotion browser ensure
npm run video -- shot render campaigns/fixtures/scene-vfx-cinematic/campaign.yaml castle-awakens --preview
npm run video -- shot inspect campaigns/fixtures/scene-vfx-cinematic/inspection/shots/castle-awakens-preview.mp4
```

Repeat for `scene-vfx-magical/reveal` and `scene-vfx-product/dashboard`. Inspect the contact sheet and individual frames. Look for popping, unreadable text, excessive density, wrong parallax direction, seams, clipping, masks, and genre-inappropriate effects. A successful process exit is not visual acceptance.

## Debug renderer issues

Run `scene validate` first. Missing presets/assets/masks are reported before bundling. If Pixi reports no renderer, confirm the pinned Chrome shell and the Remotion `chromiumOptions.gl` setting; do not permit a silent Canvas2D fallback. Run `doctor` before changing any FFmpeg path or quality setting.

## Add a backend

Add one registry backend ID, an adapter component, validation, and a fixture. Do not add backend-specific fields to `src/scene/model.ts`. Three.js is reserved for work that actually needs 3D perspective or shader-heavy depth; it is not the default route for 2D effects.
