# Migration report — pragmatic production realignment, 2026-09-02

Full findings are in [`docs/realignment-audit-2026-09-02.md`](realignment-audit-2026-09-02.md); the
decision is [ADR 072](adr/072-pragmatic-production-realignment.md); durable policy is
[`docs/product-principles.md`](product-principles.md).

## What changed

**New documents:** `docs/product-principles.md` (canonical policy), `docs/adr/072-*` (superseding
ADR), `docs/adr/README.md` (ADR index/status), `docs/quality-model.md`, `docs/current-state.md`,
`docs/realignment-audit-2026-09-02.md`, this migration report, and
`projects/the-rise-of-demons/finished-video-review.yaml` (a real, validated demonstration of the
new finished-video review against the one shipped production in the repository).

**Rewritten framing (content-preserving, not deleted):** `AGENTS.md` (now points to the product
policy and states the pragmatic rules up front), `README.md` (leads with what a user can create and
which techniques exist, demotes the reuse/transfer/publication paragraphs to "optional, available"
framing), `docs/architecture.md` (adds a policy-pointer intro, reframes the benchmark-conformance
and cross-campaign-transfer paragraphs as optional evidence rather than requirements),
`docs/codex/trailer-workflow.md` (expanded into a full shot-strategy-selection + iteration-economics
+ whole-video-inspection workflow).

**Marked historical (content preserved, header added):**
`codex-goal-bootstrap-ai-marketing-video-generator.md` (still largely current — its product
principle is exactly what was restored), `codex-goal-agent-operated-verification-architecture.md`
(still largely current — its verification/inspection architecture is unaffected; it did not
originate the doctrine being narrowed), `docs/steering/aaa-inspired-character-production-pipeline.md`
(completed governance checklist), `docs/progress/cinematic-system.md` (historical iteration log;
`docs/current-state.md` is now the default-context summary).

**ADRs individually annotated as narrowed:** 018, 019, 020, 027, 028, 029, 030, 031, 032, 034, 037,
039, 053 — each gets a one-line "narrowed by ADR 072" note plus the specific narrowing. All other
ADRs are unaffected and covered by the index.

**Code:** `src/quality/model.ts` — `transfer` and `reuseOutsideBenchmark` score fields made
optional; new `finishedVideoReviewSchema`/`FinishedVideoReview` type added.
`src/application/quality-scorecard.ts` — `loadFinishedVideoReview`/`validateFinishedVideoReview`
added, mirroring the existing scorecard loader. `src/cli.ts` — new `finished-video-review`
command. `test/quality-scorecard.test.ts` — covers the now-optional fields and the new schema.
`docs/reviews/production-quality-scorecard-2026-09-02.yaml` — one-comment header marking it a
secondary diagnostic, data unchanged.

No source files were deleted, no directories were reorganised, and no existing campaign, asset, or
test fixture was modified beyond the quality-scorecard schema/test change above.

## What was retained

Every production subsystem listed KEEP in the audit: Remotion, PixiJS, FFmpeg-full, Blender
(Cycles final / Eevee preview), MPFB/Rigify, eSpeak NG, OpenEXR tooling, Poly Haven/ambientCG
source adapters, the shared asset library's publish/audit/repair mechanics (now explicitly
optional), and the environment-material/weathering research line.

## What became optional (previously implied mandatory)

Renderer-independent geometry/skeleton/motion/clothing/lighting/audio-treatment/editorial/
finishing contracts; cross-campaign transfer as evidence; shared-library publication as a
precondition for a campaign or asset to "count"; benchmark conformance as a general-acceptance
gate.

## What became explicit R&D (was already de facto frozen, now documented as such)

Human gait synthesis, continuous-body/face/hand character topology, and the Rigify-native
action-authoring experiments (`scripts/blender/render_*_rigify_*probe.py`).

## What was removed

Nothing was deleted. The realignment is documentation- and policy-level plus one small, additive
code change; see ADR 072 for why a large rewrite was not attempted.

## ADRs superseded/narrowed

ADR 072 supersedes/narrows ADRs 018, 019, 020, 027, 028, 029, 030, 031, 032, 034, 037, 039, and 053.
See `docs/adr/README.md` for the complete status table across all 72 ADRs.

## Current production paths

1. Ordinary storyboard path (Remotion + PixiJS, no 3D) — proven by `projects/the-rise-of-demons`.
2. Declarative cinematic-campaign path (Blender-backed 3D) — proven by
   `campaigns/reference-cinematic-benchmark` and its conformance/reuse examples.
3. Both paths share edit assembly, verification, and inspection, and can be mixed per shot in one
   campaign.

## Verification performed

- `npm run typecheck` and `npm run lint` pass cleanly.
- `npm test` (full 83-file, 414-test suite, including the changed quality schema/tests) passed
  completely on the first clean run after the code change. Rerunning `npm run check` afterwards
  surfaced 1–2 pre-existing, order-varying timeouts (`paving-material-assembly.test.ts` and others,
  each with a tight 2–5s per-test timeout) under concurrent CPU load; each failing file passes
  cleanly in isolation, and the specific failing file differs between runs. This is pre-existing
  test-timing flakiness under load, unrelated to any file this realignment touched, and is not
  fixed here — doing so would be an unrelated test-suite hardening task, not part of this
  realignment.
- The ordinary storyboard path was not re-rendered (no code changed on that path); its schemas and
  tests are untouched and passing.
- The cinematic-3D path: `npm run video -- doctor` confirms Blender 4.5.13, its bundled
  OpenVDB/NumPy, eSpeak NG, and OpenEXR tooling are all invocable in this environment. As a bounded
  smoke test, `npm run video -- cinematic render campaigns/nocturne-exhibition-conformance/work/scenes/threshold/scene.json`
  (an existing 4-second, 480×270 fixture) was run against a scratch output directory: it correctly
  invoked Blender headless, resolved the scene, and produced 41 real lossless Cycles frames before
  being deliberately stopped early once that was confirmed — completing the full render added no
  further evidence and would have cost significant wall-clock time for a small fixture, which this
  realignment's own iteration-economics guidance argues against. The full 1.7 GB reference
  benchmark was not re-rendered.
- `projects/the-rise-of-demons` was not touched or re-rendered; nothing in this change affects its
  campaign files, assets, or renders. A `finished-video-review.yaml` was added under its
  (git-ignored) project directory and validated against its real `output/final.mp4` via
  `finished-video-review`, demonstrating the new primary quality model against the one real
  shipped production in the repository.

## Current known quality gaps

Production-character fidelity (face, hands, gait) and clothing/hair temporal fidelity remain the
weakest parts of the Blender cinematic path — visually rejected, not blocking anything else.
Camera grammar above raw paths and an accountable audio-mix review remain flagged incomplete in
the last subsystem scorecard. None of this blocks shipping a campaign that doesn't need photoreal
hero characters or a mix review.

## Addendum — 2026-09-02: Three.js's role decided, campaign paths freshly verified

After the initial realignment, two follow-ups happened in the same session:

1. **Fresh end-to-end verification, not just inference from existing tests.** The ordinary
   storyboard path was run cold on a real campaign (`campaigns/examples/saas-promo`): `validate` →
   `storyboard validate` → `verify` (11/11 pass) → `render --draft` (new `render-004.mp4`) →
   `inspect-render` → `verify-render` (PASS), with the resulting contact sheet visually inspected
   and confirmed to show correctly rendered UI-mockup/typography frames. The cinematic-campaign
   path's `validate` was re-run fresh against the full reference benchmark and passes. Combined
   with the earlier partial Blender smoke-render (41 real frames), both production paths are now
   demonstrated working on live inputs, not only inferred from the pre-existing test suite.
2. **Three.js's production role is decided, not just flagged** — see
   [ADR 073](adr/073-three-js-is-a-conversion-utility-not-a-backend.md). It was never wired to any
   live scene (`src/renderers/registry.ts` only routes to React/Remotion and PixiJS); its only
   caller anywhere was its own structural test. It is kept as a devDependency/test-only geometry
   conversion utility (`three` moved from `dependencies` to `devDependencies`), not a production
   backend, and ADR 021/`docs/architecture.md`/`docs/renderer-scene-backends.md` were corrected to
   stop implying a working `three-3d` rendering path exists.

Also found during this pass: the full 83-file test suite has pre-existing, order-varying timeout
flakiness under concurrent CPU load (e.g. `paving-material-assembly.test.ts`, each test with a
tight 2–5s timeout) — every failing file passes cleanly in isolation, and the specific file that
fails differs run to run. This is unrelated to anything touched in this realignment and was not
fixed here; flag it separately if it becomes disruptive.

## Addendum — 2026-09-02: CC0-motion-to-Rigify experiment (next task #1) attempted, pipeline de-risked

Ran the bounded CC0→Rigify experiment. Two attempts against the existing
`scripts/blender/render_cc0_rigify_action_reel.py` (which prior commits had left grounded-but-stiff
via IK end-effectors), added behind a `VIDEOER_CC0_REEL_MODE` selector so the default path is
unchanged:

- `world-fk` (v12): strode + grounded the legs but splayed the arms horizontally.
- `local-fk-grounded` (v13): local-space FK rotation deltas + world-space scaled root translation —
  grounded, striding, forward-travelling walk, but arms held in a bent-up guard.
- `rest-compensated` (v14): rest-pose-compensated transfer, the textbook fix — best-principled, but
  arms still in the guard through the whole cycle.

Watching the full cycle, **all four modes leave the arms in a bent-up guard**; four formulations
failing identically means it is not a retarget-math problem (likely the source clip's stylised
game-engine arm carriage or the arm/hand skinning). The "side-to-side" was diagnosed as the
follow-camera cancelling a confirmed dead-straight `+1.78m` forward travel, not a motion defect.
Backed off per the iteration rule; the model + rig pipeline is proven, the walking performance is
not. All render output is git-ignored; the only tracked change is the additive script.

## Addendum — 2026-09-02: MPFB/Rigify is the production human ([ADR 074](adr/074-mpfb-rigify-is-the-production-human.md))

Direction decision, not a code migration. The project-owned human (procedural body mesh, canonical
52-joint production skeleton, procedural gait) has been persistently visually rejected, while the
MPFB (hm08 CC0) + Rigify body — the same base kept as MPFB's full mesh with a Rigify rig — is
dramatically higher quality. Per the pragmatic-tooling policy, **MPFB/Rigify is now the production
human and everything human points there**; the owned body/skeleton/gait are retired-for-production.

Scope-limited on purpose: only docs + ADR 074 changed; **no code removed or repointed, no tests
affected**, so the benchmark still renders on the owned human until a later migration moves it.
ADR 020 is superseded for the production human, ADR 024 demoted.

## Addendum — 2026-09-02: arms solved; Expy Kit adopted ([ADR 075](adr/075-expykit-humanoid-retargeting.md))

The MPFB/Rigify arm carriage — broken across four hand-rolled retarget modes — is **solved**. The
diagnosis was corrected first (it was a retarget-tool bug, not the source clip; see the
`docs(characters)` commit and `docs/research/animation-approach-evaluation.md`), then two spikes
validated the fix, and the winner was productionized:

- **Expy Kit** (GitHub `pKrime/Expy-Kit`, v0.6.1, commit `3c4d5d7`, GPL) is adopted as the humanoid
  retargeting tool. Pinned + installed by `scripts/install-expykit-extension.sh` into git-ignored
  `.venv-blender/` (verified by headless registration), and driven by the durable
  `scripts/blender/render_expykit_action_reel.py` (constrain `Rigify_Controls`←`Unreal_Mannequin`
  `match_transform='Bone'`, drive source action+slot, `nla.bake`; two headless gotchas documented in
  ADR 075).
- Validated on **walk and jog** (evidence under
  `work/characters/production-rig-scene-integration/expykit-reel-v1/`): natural full-body
  performance, motion-appropriate arms per clip, head-droop fixed. The hand-rolled retarget modes are
  superseded; the native-FK arm-correction remains a dependency-free fallback.

Deliberately *not* done (per ADR 072, no speculative pipeline-building): wiring Expy-Kit-retargeted
actions into the declarative cinematic-campaign pipeline as a resolvable character-motion input, and
clothed / multi-character / full-campaign validation. Do those when a campaign needs a walking
character.

## Recommended next tasks

1. **The owned-human → MPFB/Rigify migration** (deferred by ADR 074): repoint the reference
   benchmark and campaign character resolution at the MPFB/Rigify human, then remove or clearly
   quarantine the owned body mesh, canonical production skeleton, and procedural gait. Do it when a
   campaign needs a production human or when picking up cleanup — it is real work, not a doc flip.
2. **Wire Expy-Kit human motion into the campaign pipeline** when a campaign needs a walking
   character: make a retargeted action a resolvable character-motion input, and validate clothed /
   multi-character / in-context. The tool + script are ready (ADR 075); this is the integration.
3. **Do a full audio-inclusive playthrough review of `projects/the-rise-of-demons/output/final.mp4`
   and one benchmark shot**, and record it with `finished-video-review`. This realignment already
   validated the schema against that project's final render from contact-sheet/render-history
   evidence (`projects/the-rise-of-demons/finished-video-review.yaml`); the next step is a real
   sound-on watch, which that review explicitly flagged as not yet done.
