# Realignment audit — 2026-09-02

Companion to [`docs/migration-report-2026-09-02.md`](migration-report-2026-09-02.md) (what changed)
and [ADR 072](adr/072-pragmatic-production-realignment.md) (the decision). This document records
what the audit found before those changes were made.

## Instruction sources found

- `AGENTS.md` — repository-wide agent instructions (system capability requirements; now also
  points to product policy).
- `README.md` — user-facing overview and command reference.
- `docs/architecture.md` — architecture narrative.
- `codex-goal-bootstrap-ai-marketing-video-generator.md` — original bootstrap goal (1097 lines).
- `codex-goal-agent-operated-verification-architecture.md` — second goal doc (1378 lines),
  verification/inspection/campaign-workspace architecture.
- `docs/adr/001`–`071` — 71 architecture decision records, no prior status/index document.
- `docs/progress/cinematic-system.md` (487 lines) — dated iteration log for the cinematic subsystem.
- `docs/steering/aaa-inspired-character-production-pipeline.md` (633 lines) — a governance
  checklist, already answered inline in the progress log.
- `docs/research/*.md` (9 files) — R&D notes (gait, face, retopology, paving/weathering,
  construction history, open-source ecosystem survey).
- `docs/reviews/*` — one production quality scorecard (YAML) plus 15 single-asset
  "transfer-audit" JSON files.
- Numerous per-domain docs (`docs/materials.md`, `characters.md`, `lighting.md`, `environments.md`,
  `interactions.md`, `particle-system.md`, `sound-effects.md`, `scene-vfx.md`,
  `declarative-cinematic-campaigns.md`, `renderer-scene-backends.md`) — implementation reference,
  not architecture-level mandates; left largely as-is.

## The contradiction

The bootstrap goal's product principle ("good-looking marketing output per unit of cost and
effort", style-agnostic, no style privileged) was never rescinded by either goal document. But 71
ADRs — mainly 017–071, built iteratively against one demanding reference production
(`campaigns/reference-cinematic-benchmark`) — accumulated a second, unstated doctrine:

1. **Renderer independence as a default assumption** for geometry, materials, skeletons, motion,
   clothing, lighting, VFX, audio treatment, and cinematic finishing.
2. **Cross-campaign transfer as an acceptance criterion** (ADR 028: "a second, materially
   different campaign... through the same public operations with substantially less bespoke
   implementation" before the system is "generally robust").
3. **Publication/immutable versioning as implicit required progress**, even though the actual
   publish workflow (`src/application/cinematic-publication.ts`) is opt-in at the code level.
4. **A quality scorecard** (`src/quality/model.ts`,
   `docs/reviews/production-quality-scorecard-2026-09-02.yaml`) that scored `transfer` and
   `reuseOutsideBenchmark` as mandatory 0–5 dimensions weighted equally with visual/temporal
   quality across 12 subsystem domains — 7 of 12 domains were `blocked` under this scorecard, none
   of which blocked `projects/the-rise-of-demons` from shipping, because that project used none of
   this machinery.

Neither goal document asked for this; it emerged from ADR-by-ADR scope creep. See ADR 072 for the
full narrowing decision and [`docs/adr/README.md`](adr/README.md) for per-ADR status.

## Is any of this doctrine mechanically enforced in code?

Checked directly: no code path blocks a campaign's `render`/`cinematic-campaign build|produce`
from completing without transfer, publication, or benchmark conformance.
`bespokeOrchestrationSourceFiles` in `src/application/cinematic-campaign.ts` is a reported metric,
not an assertion. The shared-library publish workflow
(`src/application/cinematic-publication.ts`, `src/assets/library.ts`) is a genuinely optional,
explicit, two-stage command (`cinematic-campaign publish-assets`) with real immutability/hash
guarantees once you opt in — that part is good engineering and is kept as-is. The doctrine lived in
documentation, ADR framing, and the quality scorecard's scoring weights, not in a build-blocking
gate. This meant the fix could be almost entirely documentation plus one small, contained schema
change (`src/quality/model.ts`), not a large code migration.

## Subsystem classification

| Subsystem | Verdict | Notes |
| --- | --- | --- |
| Remotion + React (timeline, delivery) | KEEP | Load-bearing for every path. |
| PixiJS (dense 2D VFX) | KEEP | Load-bearing for `scene`/layered-2D shots. |
| FFmpeg-full | KEEP | Required for delivery, probing, inspection. |
| Blender + Cycles (final) / Eevee Next (preview) | KEEP | Best available local backend for real 3D; see cinematic backend evaluation below. |
| MPFB + Rigify | KEEP | Mature rigging/skinning; correct to delegate to rather than reinvent. |
| eSpeak NG + native phoneme bridge | KEEP | Deterministic, provider-free, working. |
| OpenEXR (`exrinfo`) tooling | KEEP | Small, load-bearing for HDR source inspection. |
| Poly Haven / ambientCG source adapters | KEEP | Provider independence for *asset sources*, distinct from renderer independence. |
| Shared asset library (publish/audit/repair) | SIMPLIFY (framing only) | Mechanics kept; "required for progress" framing removed. Now explicitly optional. |
| Custom procedural geometry (`src/geometry`) | OPTIONAL | Valid generator for shots that need it; not mandatory scaffolding. |
| Custom canonical skeleton/motion (`src/characters`, `src/motion`) | OPTIONAL | Valid reusable contract; Blender-native rigs/actions are equally valid alternatives. |
| Renderer-independent clothing/lighting/audio-treatment/editorial/finishing derivations | OPTIONAL | Valid, working, opt-in reuse contracts (ADR 030/031/032/034/053). |
| Continuous-body character deformation, face/hand topology | R&D | Structurally valid, visually rejected; frozen pending a campaign that needs a hero-distance human. |
| Human gait synthesis | R&D | Mechanically calibrated (v1–v22), visually rejected, intentionally frozen. |
| Rigify-native action-authoring experiments (`scripts/blender/render_*_rigify_*probe.py`) | R&D | Explicitly `experimental-not-accepted`; promising alternative to canonical-motion retargeting. |
| Three.js as a rendering backend | R&D / re-evaluate | See cinematic backend evaluation — not currently wired to any live scene. |
| `docs/research/paving-*`, `construction-surface-history*`, `wet-porous-materials.md` | KEEP (as reference) | Feeds real, verified environment materials; not a rabbit hole. |
| Benchmark-as-conformance-suite doctrine (ADR 028) | REMOVE (as a requirement) | Benchmark kept as a fixture/example; conformance requirement removed. |
| Quality scorecard's mandatory `transfer`/`reuseOutsideBenchmark` scoring | REPLACE | Made optional; new `finishedVideoReviewSchema` is now primary — see `docs/quality-model.md`. |

No subsystem is marked REMOVE outright; nothing that works today was deleted.

## Cinematic backend evaluation

1. **Is Blender still the best default local cinematic/3D backend?** Yes — no evidence surfaced of
   a better free/local/open alternative for headless geometry, rigging, simulation, and rendering
   at this project's scale.
2. **Should Cycles and Eevee serve different tiers?** Yes, and they already do (ADR 036): fixed-seed
   Cycles CPU is the authoritative final path; Eevee Next is preview-only because its Metal shadow
   path is not bit-repeatable on the observed platform. Keep this split.
3. **Which character/animation problems should delegate to Blender/Rigify rather than an
   engine-owned representation?** Rigging, skinning, and IK already delegate to MPFB/Rigify
   correctly (ADR 021). The weak point is authored *performance* (gait, hand pose, face) — that's a
   content/animation problem, not an architecture problem, and no engine-owned abstraction fixes it.
4. **Which custom geometry/material/VFX systems materially outperform simpler native-tool usage?**
   The procedural environment-material/weathering/surface-water work
   (ADRs 055–070) is genuinely load-bearing — it solves problems (metre-scaled construction
   variation, causal surface history) that a stock native shader doesn't address out of the box.
   Keep it. The canonical skeleton/motion retargeting layer is useful specifically because it lets
   one authored gait/turn/performance drive multiple characters — but it has not yet produced a
   visually accepted hero performance, so its value is currently in reuse potential, not finished
   quality.
5. **Does Three.js still justify its production role?** Not currently. ADR 021 assigns it "runtime
   3D scene graphs, cameras, lights, materials, skinned characters, morphs, and previews behind a
   `three-3d` backend adapter," but no shot renders through it today
   (`docs/renderer-scene-backends.md` explicitly says a Three.js backend "is intentionally absent
   today"). Its only live usage is `src/renderers/three-geometry.ts` plus geometry tests. **Decided
   later the same session:** [ADR 073](adr/073-three-js-is-a-conversion-utility-not-a-backend.md)
   — kept as a devDependency/test-only conversion utility, not a backend; see the migration
   report's addendum.
6. **Which renderer-independent layers provide real automation value even without portability?**
   The motion-retargeting layer (one gait driving multiple proportioned characters), the
   lighting-rig derivation layer (one rig transformed for a new environment), and the
   editorial-derivation layer (one typographic identity reused across formats) all provide genuine
   automation value independent of any Blender/Three.js portability claim. Keep these.
7. **Which current systems should become optional R&D rather than production dependencies?** Human
   gait synthesis, continuous-body/face/hand topology, and the Rigify-native action experiments —
   already effectively frozen in practice; this audit makes that explicit.
8. **Are there free/open/local tools that would materially improve production and reduce custom
   engineering?** `docs/research/open-production-ecosystem.md` already surveys this space
   (MakeHuman/MPFB, Rigify, Quaternius, Poly Haven, ambientCG, BlenderGIS, MaterialX) and the
   adopted choices look sound. The one concrete opportunity worth a follow-up investigation: a
   CC0 motion library (Quaternius, or the "Universal Animation Library" already referenced in
   `docs/characters.md`) retargeted directly onto Rigify, bypassing the canonical-motion layer for
   *authored* performance while keeping it for procedurally *generated* motion (walk-style
   parameter sweeps). Flagged as a proposed next task, not started here.

## Significant migration decisions made in this pass

- Renderer independence, cross-campaign transfer, and benchmark conformance are no longer
  universal requirements (ADR 072).
- Shared-library publication is confirmed and documented as optional (it already was, in code).
- Quality scorecard schema: `transfer`/`reuseOutsideBenchmark` made optional; new
  `finishedVideoReviewSchema` and `finished-video-review` CLI command added as the primary
  acceptance surface.
- No physical code/directory reorganisation was performed (e.g. nesting the cinematic subsystems
  under one `src/cinematic-3d/` umbrella). That would be a large, high-risk mechanical churn for a
  documentation-level problem; it is recorded as a possible future task, not executed now.
- Three.js's production role was flagged here for an explicit decision, then decided later the same
  session, with the user's direction, as [ADR 073](adr/073-three-js-is-a-conversion-utility-not-a-backend.md):
  kept as a devDependency/test-only conversion utility, not a backend.
