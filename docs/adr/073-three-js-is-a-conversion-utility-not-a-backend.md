# ADR 073: Three.js is a geometry-conversion utility, not a production rendering backend

## Status

Accepted.

## Context

ADR 021 assigns Three.js a peer role alongside Remotion, PixiJS, Blender, and FFmpeg: "programmable
runtime 3D scene graphs, cameras, lights, materials, skinned characters, morphs, and previews
behind a `three-3d` backend adapter." `docs/renderer-scene-backends.md` and `docs/architecture.md`
repeat this framing (the latter claims spoken-performance morph tracks "drive... Three.js morph
attributes").

None of this is true of the code as it exists. Checked directly as part of the pragmatic
production realignment ([ADR 072](072-pragmatic-production-realignment.md)):

- The scene-layer registry that actually routes rendering (`src/renderers/registry.ts`) only routes
  to the React/Remotion adapter and the PixiJS adapter. No `three-3d` backend is registered.
- `src/renderers/three-geometry.ts` (88 lines: `toThreeBufferGeometry`, `toThreeSkeleton`,
  `toThreeSkinnedMesh`) is the only code in the repository that imports `three`. It is a pure
  data-conversion utility — Videoer's canonical `GeometryAsset` in, a `THREE.BufferGeometry` /
  `THREE.Skeleton` / `THREE.SkinnedMesh` out.
- Its only caller anywhere in `src/` or `test/` is `test/geometry.test.ts`, which asserts the
  conversion produces structurally valid output (correct vertex/bone/morph counts). Nothing renders
  a frame through it, previews anything with it, or drives a live Three.js scene from motion data.
- No CLI command, application operation, or campaign path touches it.

So Three.js currently earns its place in this repository as a **structural cross-format validation
check on the canonical geometry model** — a cheap, real regression test that the canonical format
converts correctly to a second representation — not as a rendering backend, and not as a preview
capability. No concrete product need for a live in-browser 3D preview has been identified.

## Decision

Stop describing Three.js as a production rendering backend. Per the architecture-creation
threshold in [`docs/product-principles.md`](../product-principles.md), building a real `three-3d`
backend (a live scene graph, camera, preview renderer) is not justified today: it would be new,
speculative infrastructure with no identified user-facing capability behind it.

- Keep `src/renderers/three-geometry.ts` and its test. It is cheap (88 lines, no dependents to
  break) and provides genuine, if narrow, value: proof that the canonical geometry format isn't
  accidentally coupled to Blender's conventions.
- Move `three` from `dependencies` to `devDependencies` in `package.json` — nothing in the shipped
  CLI (`dist/cli.js`) reaches this module; only the test suite does.
- ADR 021 is narrowed: its Three.js line describes an unbuilt, optional future adapter, not a
  current backend. `docs/renderer-scene-backends.md`'s "a Three.js backend could later own..."
  framing is accurate and unaffected; `docs/architecture.md`'s claim that morph tracks "drive...
  Three.js morph attributes" is corrected — they drive Blender shape keys today; Three.js morph
  attributes are exercised only in the conversion test.
- If a concrete need for a live 3D preview emerges later (this is the one plausible use case that
  would justify investment — see the realignment migration report), build that specific capability
  and register a real `three-3d` backend at that point. Until then this is explicitly R&D-adjacent,
  not a production dependency.

## Consequences

The architecture diagram and backend list in `docs/architecture.md`/`README.md` no longer imply a
working Three.js rendering path exists. `npm install --production` (or any production install)
no longer pulls in `three`. No behavior changes for any existing campaign, test, or CLI command —
`three-geometry.ts` and its test are untouched.
