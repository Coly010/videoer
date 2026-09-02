# ADR 072: Pragmatic production realignment — finished-video quality over renderer-independent architecture

## Status

Accepted.

## Context

Videoer's original bootstrap goal
(`codex-goal-bootstrap-ai-marketing-video-generator.md`) set a clear product principle: optimise
for good-looking marketing output per unit of cost and effort, across styles from cinematic
trailers to slideshow-style SaaS promos, with neither style treated as more "real" than the other.
A later goal document
(`codex-goal-agent-operated-verification-architecture.md`) added a sound, still-valid
verification/inspection/campaign-workspace architecture and did not itself mandate renderer
independence, cross-campaign transfer, or benchmark conformance.

Between those two documents and today, 71 ADRs (mainly 017–071) accumulated through iterative
work on one demanding reference production (`campaigns/reference-cinematic-benchmark`, an
eight-shot narrative trailer with a recurring character, bookshop set, and gait/cloth/lighting/VFX
work). Each iteration reasonably solved the problem in front of it, but the cumulative effect was
architectural scope creep that the original goal never asked for:

- **Renderer independence became a default assumption** for geometry, materials, skeletons,
  motion, clothing, lighting, VFX, audio treatment, and cinematic finishing — even where Blender
  was always going to be the only backend that mattered for that shot.
- **Cross-campaign transfer became an acceptance criterion.** ADR 028 requires "a second,
  materially different campaign... through the same public operations with substantially less
  bespoke implementation" before the production system is "generally robust," and the production
  quality scorecard (`src/quality/model.ts`, `docs/reviews/production-quality-scorecard-*.yaml`)
  scores `transfer` and `reuseOutsideBenchmark` as mandatory 0–5 dimensions weighted equally with
  visual/temporal quality.
- **Publication/immutable-versioning became implicitly required** for a piece of work to "count,"
  even though the shared library and its publish workflow
  (`src/application/cinematic-publication.ts`) are already correctly optional and opt-in at the
  code level — it is the surrounding documentation and scorecard, not the CLI, that treats
  publication and transfer as mandatory evidence of progress.
- **The benchmark became a conformance suite** whose demands (ADR 022, ADR 028) shaped domain
  contracts more than the goal of shipping good finished videos did.

Meanwhile, `projects/the-rise-of-demons` — the one completed, real, user-facing production in the
repository — ships a genuinely effective 9-second dark-fantasy book teaser using none of this
machinery: supplied artwork, layered 2D VFX (particles, glows, atmosphere), SVG typography, and a
composed soundtrack. It required no Blender, no canonical geometry, no cross-campaign transfer
proof, and no library publication. This is direct evidence that the renderer-independent/transfer/
conformance doctrine is not what makes Videoer's marketing videos good.

## Decision

Restore the original product principle as the highest-order rule, recorded in
[`docs/product-principles.md`](../product-principles.md): optimise for finished-video quality per
unit of cost and effort, and use whichever tool-native technique gets there fastest. This ADR does
not delete or invalidate the domain work already built. It narrows what that work is *required*
to prove.

Specifically:

1. **Renderer independence is no longer a universal requirement.** It is acceptable for
   `cinematic-3d → Blender` to be a plain production decision using Blender-native geometry,
   materials, Geometry Nodes, Rigify rigs, constraints, actions, and simulations directly. Existing
   renderer-independent contracts remain valid, supported implementations where they already exist
   and continue to provide real value (e.g. driving Blender shape keys and a Three.js preview
   from one motion contract) — they are simply no longer mandatory scaffolding for new work.
2. **Cross-campaign transfer and benchmark conformance are no longer acceptance criteria.** A
   campaign is complete when it produces a good finished video, not when a second unrelated
   campaign reuses its assets unchanged. Transfer remains useful, optional evidence that a domain
   contract is reusable; it is not a gate.
3. **Shared-library publication remains fully supported and fully optional.** The two-stage
   publish/promote workflow, immutable versioning, and content-addressed hashing in
   `src/application/cinematic-publication.ts` and `src/assets/library.ts` are kept as-is — they are
   good engineering for the case where reuse is worth the cost. They are not a required lifecycle
   for campaign-local assets.
4. **The quality scorecard's `transfer` and `reuseOutsideBenchmark` dimensions become optional**
   (see the `src/quality/model.ts` schema change accompanying this ADR), and a new
   `finishedVideoReviewSchema` / `finished-video-review` CLI command establishes the
   whole-finished-video review as the primary acceptance surface, per
   [`docs/quality-model.md`](../quality-model.md). Subsystem scorecards remain useful secondary
   engineering diagnostics.
5. **The reference cinematic benchmark remains a valid, useful fixture and example** — it is
   demoted from "conformance suite that general acceptance depends on" to "one representative
   production among several," alongside `projects/the-rise-of-demons` and the ordinary
   storyboard/Remotion path.

## Which earlier ADRs this narrows

Every ADR listed below keeps its original decision as a **valid, available implementation**. What
changes is that none of them are read as a universal mandate for all future shot production.

| ADR | Narrowed how |
| --- | --- |
| [018](018-shared-asset-library.md) Shared asset library | Publication remains available; no longer required before a campaign or asset "counts" as progress. |
| [019](019-procedural-geometry.md) Renderer-independent procedural geometry | Valid, reusable generator; not mandatory for shots better served by Blender-native geometry or a supplied/generated asset. |
| [020](020-character-skeleton-motion.md) Character skeleton and motion | Canonical skeleton/motion remain a valid reusable contract; Blender-native rigs (Rigify, MPFB) or supplied performance are equally valid without deriving through it. |
| [027](027-executable-cinematic-scene-contract.md) Executable cinematic scene contract | Valid for the Blender path specifically; not a requirement for every 3D or composited shot. |
| [028](028-benchmark-as-conformance-suite.md) Benchmark as conformance suite | The benchmark is a fixture/example, not a conformance gate. A second campaign is welcome evidence, never a requirement. |
| [029](029-cross-domain-derived-asset-contracts.md) Cross-domain derived asset contracts | Adaptation/publication contracts remain available; transfer is optional evidence, not a completion criterion. |
| [030](030-renderer-independent-temporal-clothing.md) Renderer-independent temporal clothing | Valid where animated fitted clothing is actually needed; not mandatory scaffolding for every garment. |
| [031](031-deterministic-audio-treatment-derivation.md) Deterministic audio treatment derivation | Valid reusable derivation; byte-identical rerender is required only where byte identity itself has product value. |
| [032](032-first-class-lighting-derivation.md) First-class lighting derivation | Valid reusable asset type; transfer across campaigns is optional evidence, not a target. |
| [034](034-first-class-editorial-derivation-and-transfer.md) First-class editorial derivation and transfer | Valid reusable asset type; unrelated-campaign transfer is optional evidence, not a target. |
| [037](037-renderer-independent-procedural-sound-effects.md) Renderer-independent procedural sound effects | Valid technique; a supplied or generated sound is equally acceptable when cheaper/better. |
| [039](039-first-class-modular-hair.md) First-class modular hair | Valid technique for the Blender character path; not mandatory for every hair need. |
| [053](053-renderer-independent-cinematic-finishing.md) Renderer-independent cinematic finishing | Valid finishing pass; byte-identical rerender required only where that identity has product value. |

ADRs 038–052 and 054–070 (environment dressing, paving, weathering, surface-water optics,
architectural modules, and similar) are narrow, domain-specific implementation decisions for the
Blender-backed environment system. They are retained as implementation reference and are not
individually narrowed by this ADR — see [`docs/adr/README.md`](README.md) for their status. Going
forward, this granularity of ADR should generally not be created; ordinary documentation covers
implementation-level decisions (see the architecture-creation threshold in
`docs/product-principles.md`).

ADRs 001–014, 021, 023, 024 (except its determinism framing, unaffected), and 071 are ordinary
engineering decisions (repository layout, runtime, CLI, error handling, testing strategy, renderer
boundaries, licensing, camera-intent typing) and are unaffected by this ADR.

Neither top-level goal document (`codex-goal-bootstrap-ai-marketing-video-generator.md`,
`codex-goal-agent-operated-verification-architecture.md`) is superseded — both are marked
historical-but-largely-current, since the drift this ADR corrects was not mandated by either of
them. See the header added to each.

## Consequences

- New production work is judged first by whether the finished video is good, second by whether the
  chosen technique suited the shot, and only after that by reuse/reproducibility/abstraction
  purity — see the priority order in `docs/product-principles.md`.
- `src/quality/model.ts` gains an optional-fields change (`transfer`, `reuseOutsideBenchmark`) and
  a new `finishedVideoReviewSchema`; no existing scorecard data is invalidated.
- No renderer-independent code is deleted by this ADR. Nothing that already works is removed;
  future work is simply no longer obligated to route through it.
- A campaign may ship, and be considered complete, without publishing any asset to the shared
  library and without a second campaign proving reuse.
- `docs/architecture.md`, `README.md`, and `docs/codex/trailer-workflow.md` are revised to reflect
  this framing (see their updated content and the migration report at
  `docs/migration-report-2026-09-02.md`).
