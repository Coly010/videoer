# Scene renderer backends

`src/renderers/registry.ts` is the only layer-to-backend routing point. Image, video, text, shape, and sprite layers currently use the React/Remotion adapter. Particle systems and GPU effects use the PixiJS 2D adapter. The domain never names either backend.

PixiJS is pinned and initialized once per GPU layer. Frame state is calculated directly from the Remotion frame and a seeded particle engine, so seeking and parallel frame rendering remain deterministic. Chrome Headless Shell is launched with ANGLE enabled and Pixi is restricted to WebGL; it fails with the layer ID when WebGL is unavailable instead of silently switching to a lower-fidelity implementation. `preserveDrawingBuffer` makes the canvas capturable by Remotion.

Remotion remains responsible for the timeline, Sequences, React composition, captions, audio, campaign templates, dimensions, and H.264/AAC rendering. Pixi owns dense 2D draw calls, blend-ready transparent canvases, procedural particles, and selected atmosphere/light/distortion layers. FFmpeg remains the delivery, probing, frame-extraction, and contact-sheet boundary.

A future backend implements a renderer registration and a scene-layer component without changing storyboard schemas. A Three.js backend could later own real perspective, 3D planes, depth maps, or shader-heavy scenes — most plausibly a live in-browser 3D preview, since that is the one concrete capability current tooling can't offer. It is intentionally absent today, not just because the verification scenes need layered 2D rather than a 3D scene graph, but because no such capability has been requested; see [ADR 073](adr/073-three-js-is-a-conversion-utility-not-a-backend.md). Build it when that need is concrete, not speculatively.
