# Declarative cinematic campaigns

The declarative campaign contract turns a complete multi-shot production into validated data. It is the preferred boundary for new trailer and campaign forms because campaign authors do not need to add an application module, renderer branch, or edit script.

## Generalisation rule

The reference cinematic benchmark is an acceptance fixture, not an implementation boundary. A repair discovered through that benchmark counts as system progress only when it is expressed as a renderer-independent domain contract, reusable factory or policy, generic verifier, or backend adapter with regression coverage. Production code must not depend on benchmark campaign IDs, shot names, editorial order, or hand-tuned world coordinates. Campaign-specific creative decisions remain declarative data.

Passing the benchmark does not by itself establish subsystem maturity. Human performance, character fidelity, lighting, materials, environments, and cinematic finish remain subject to their own quantitative gates and repeated visual rejection. A subsystem is considered reusable when another trailer form can compose it without bespoke orchestration; a second campaign proof is useful evidence, but it must not displace work on the largest known quality blocker.

`finishSources` resolves either a campaign-local cinematic-finish JSON profile or a verified `vfx` library artifact. A shot references the source through `finish`; the builder applies it after 3D/editorial compositing, records it in the production plan and asset manifest, fingerprints its current bytes, and points edit assembly at the canonical `-finished.mp4` output. Use the shared `finish-profile` artifact role for library requirements. A finish is display-referred delivery treatment, not a substitute for scene lighting or material verification. See [ADR 053](adr/053-renderer-independent-cinematic-finishing.md).

```bash
npm run video -- cinematic-campaign validate path/to/cinematic-campaign.yaml
npm run video -- cinematic-campaign build path/to/cinematic-campaign.yaml --no-render
npm run video -- cinematic-campaign build path/to/cinematic-campaign.yaml
npm run video -- cinematic-campaign produce path/to/cinematic-campaign.yaml
npm run video -- cinematic-campaign production-status path/to/cinematic-campaign.yaml
npm run video -- cinematic-campaign review path/to/cinematic-campaign.yaml work/production/review.yaml
npm run video -- cinematic-campaign publish-assets path/to/cinematic-campaign.yaml \
  --approve environment-source-id \
  --reviewer accountable-reviewer \
  --rationale "Reviewed declared semantic frames, verification reports, and reuse capabilities."
```

Rendering requires Blender host access. All production rendering remains local, deterministic, provider-free, and based on open-source dependencies.

## Autonomous production and repair

`produce` is the preferred complete workflow. It persists a production plan before construction, records reuse/adapt/create decisions, fingerprints each renderer-independent scene and every live geometry/motion/editorial dependency, renders only stale or explicitly repaired shots, runs objective gates, assembles passing work, and writes a resumable `work/production/production-run.json` ledger plus a hash-bound review template. Use `--repair-shots shot-a,shot-b` for an explicit selective repair.

The ledger separates pixel identity from evidence identity. Geometry, motion, camera, lighting, atmosphere, overlays, timing, resolution, and the render profile contribute to `renderInputSha256`. Landmarks, objective gates, semantic overlay IDs, and metadata additionally contribute to `inputSha256`. When only the latter changes, Blender runs an inspect-only evaluation, semantic frames/contact sheets are regenerated from the unchanged MP4, and gates are rerun. The live video hash and mtime remain unchanged; qualitative review is still invalidated because its evidence changed. A missing or hash-changed video always takes the full-render path.

The run remains `awaiting-review` until `review` accepts every shot and the delivery against the current source, scene, contact-sheet, and edit hashes. A failed dimension requires a concrete repair instruction. A byte-identical no-op resume renders nothing and preserves the accepted review. See [ADR 035](adr/035-autonomous-campaign-production-loop.md).

Authoritative scene evidence defaults to fixed-seed multithreaded Cycles CPU. Eevee Next is an explicit preview-only profile because Blender 4.5.13's Apple Metal shadow path was observed to vary decoded pixels across identical runs. The final path retains shadows and quality, writes lossless PNG frames, then uses deterministic project-owned FFmpeg encoding. See [ADR 036](adr/036-deterministic-blender-render-profiles.md).

## Contract responsibilities

A campaign file declares:

- exact frame rate, resolution, shot order, and per-shot frame counts;
- procedural geometry recipes, local persisted inputs, or capability-based requirements resolved from the verified shared library;
- deterministic motion recipes, verified library motion, and frame-exact layered base/additive/override timelines;
- physically meaningful materials and asset-owned semantic attachments;
- verified or bounded-derived atmospheric VFX, surface materials, and canonical fitted clothing;
- verified or bounded-derived first-class lighting rigs, optional shot-specific supplemental lights, and reviewed library image overlays;
- entities, transforms, optional motion bindings, lights, atmosphere, and overlays;
- camera keyframes whose position and target may use world coordinates or semantic attachments;
- semantic landmarks, quantitative motion gates, and render gates for visibility, highlight detail, subject framing, and named-overlay opacity at review landmarks;
- an exact-duration, seeded provider-free soundtrack plan; and
- final codec, pixel format, fast-start, and delivery location.

The generic application operation owns schema and cross-reference validation, reuse/adapt/create asset resolution, procedural geometry and motion construction, gait biomechanics, skeleton compatibility, layered motion composition, target-derived turns, semantic transform resolution, open-font overlay rendering, deterministic audio synthesis, executable scene creation, Blender rendering, final-clip selection, edit assembly, and fail-closed delivery verification.

When an animated integrated garment or wardrobe entity declares the `long-dress-drape-v1` policy, assembly evaluates the actual garment/body/motion tuple over time before rendering. A failing tuple is corrected through deterministic pose-space morph targets and reverified for body collision, silhouette stability, and local mesh strain. The derived geometry, motion, and evidence report are content-addressed by all three input hashes under the repository-level `.videoer-cache/deformations`, so repeated shots, later builds, and other campaigns reuse one result. Cache hits repeat hash, compatibility, and temporal semantic validation. This cache is a production artifact contract, not a benchmark-shot optimization; campaign ID, entity name, camera, and editorial form do not affect it.

`lightingSources` resolves a verified lighting artifact once and lets any shot reference it by ID; a shot may add explicit supplemental lights without duplicating the complete rig. A source may declare `lighting-rig-transform-v1` to uniformly transform positions, targets, and emitter scale; apply bounded global/per-purpose energy factors; and recolour the rig. Light identity, order, type, purpose, and coherent exposure are protected. Compatibility evidence records both hashes and every recomputed semantic invariant, and approval repeats the derivation from the immutable parent. Legacy environment-typed `lighting-rig` artifacts remain valid parents, while new releases publish through the first-class `lighting` domain. An overlay may either declare an open-font text recipe or resolve a reviewed transparent image artifact from the library. All decisions are recorded in `work/asset-manifest.yaml`.

The soundtrack duration must equal the frame-derived edit duration. Cameras must span the exact shot duration. Geometry, overlay, entity, and semantic references are checked before rendering. The final edit fails unless ffprobe confirms codec, pixel format, dimensions, frame count, frame rate, duration, AAC stereo, and 48 kHz audio.

A shot may declare a `camera-path-clearance` quality gate with obstacle entity IDs, sample count, camera-body clearance, and target-end tolerance. The generic verifier samples the same linear or sinusoidal ease-in-out position/target path executed by Blender, evaluates static or motion-retimed/skinned/morphed triangles, and fails before rendering on body proximity or early sightline intersections. Blender independently reports its evaluated position, animated semantic target, and lens error at every landmark; that automatic renderer contract fails even when no optional camera gate is present.

## Spoken performance

A geometry adaptation may add `speechMorphs: {kind: english-visemes-v1}`. This preserves vertex/triangle topology, skeleton, coordinate system, materials, and identity while adding five sparse mouth-only targets: `viseme-aa`, `viseme-ee`, `viseme-oh`, `viseme-fv`, and `viseme-mbp`. The compatibility report records the parent and derived hashes, exact target vocabulary, affected mouth-vertex count, and measurable deformation result.

A soundtrack cue with `kind: speech` declares text, eSpeak NG voice, rate, pitch, global edit interval, gain, and purpose. A `speech-visemes` motion recipe names that cue and a target geometry. The builder obtains native phoneme/word events from the same speech configuration, creates scalar morph tracks on the exact campaign frame grid, verifies at least three exercised visemes and target compatibility, and persists timing provenance in the motion artifact. Soundtrack rendering rejects source audio longer than the declared cue instead of clipping it.

Every shot binding of that generated speech motion must align with the named soundtrack cue within one frame on the global edit timeline. Morph layers may also be combined with body motion through ordinary base/additive/override timelines using explicit `morphTargets` masks; contribution verification recomposes the timeline without each facial layer and measures the resulting scalar difference.

[`campaigns/last-call-dialogue-conformance/cinematic-campaign.yaml`](../campaigns/last-call-dialogue-conformance/cinematic-campaign.yaml) is the first complete consumer. It adapts the recurring heroine without changing topology, generates 25 native phoneme events and five frame-exact morph tracks, renders distinct neutral/`aa`/`ee`/`mbp`/rest frames through Blender shape keys, and delivers one 72-frame close-up with synchronized provider-free speech. Its one-shot edit also exposed and fixed the generic contact-sheet helper's former two-input assumption.

Speech publication produces three independently reviewable assets: the speaking geometry, the isolated WAV plus native event ledger, and the facial motion. The motion declares exact audio and target-geometry versions in `compatibility.requires`. Approval re-hashes those live dependencies, parses the WAV and ledger, checks duration and monotonic event timing, reloads geometry and motion, reruns mouth-only morph, viseme, exact-grid, and target compatibility validation, and requires passing global AV placement evidence. A regression rewrites both a forged event ledger and its candidate hashes; live semantic approval still rejects it before review state is written.

For downstream reuse, `audioSources` resolves verified audio by capabilities and `audio-source` soundtrack cues mix the resolved artifact without regenerating it. `audiovisualBindings` explicitly connect a motion, audio cue, target geometry, and frame tolerance across the global multi-shot edit. [`campaigns/voices-of-midnight-documentary-conformance/cinematic-campaign.yaml`](../campaigns/voices-of-midnight-documentary-conformance/cinematic-campaign.yaml) proves this route in a testimony/cutaway/title documentary grammar: its manifest records reuse of the published stage, speaking character, isolated dialogue, and facial performance, while its work area contains no generated speech source.

An `audioSource` may instead declare a `cinematic-audio-treatment-v1` adaptation and output path. The derivation selects an exact parent interval and declares bounded EQ, dynamics, stereo width, fades, loudness/peak targets, and optional tonal or seeded-noise accents aligned to integer 48 kHz samples. Build evidence includes live parent/output hashes, exact format and duration, temporal-envelope preservation, sample-aligned accent timing, interval-local accent contribution, and a byte-identical independent re-render. Rendered approval repeats those checks from the immutable parent before publication. Beacon One creates `audio.beacon-one-product-pulse@1.0.0`; Last Platform resolves it as an ordinary reusable source with `adaptedAudioSources: 0`.

## Cross-campaign evidence

[`campaigns/beacon-one-product-conformance/cinematic-campaign.yaml`](../campaigns/beacon-one-product-conformance/cinematic-campaign.yaml) declares an original product launch in 165 lines of creative data and uses zero campaign-specific orchestration source files. It generates one procedural product asset, three semantically framed shots, a transparent brand treatment, a seeded soundtrack, and an exact nine-second delivery.

Its first accepted TypeScript implementation required a 363-line campaign-specific application module plus a 66-line product factory. Those files were deleted after the declarative build reproduced the accepted contact sheet and passed all delivery gates. This does not mean creative work is free; it proves that new campaign work no longer requires modifying orchestration software.

[`campaigns/breathe-again-awareness-conformance/cinematic-campaign.yaml`](../campaigns/breathe-again-awareness-conformance/cinematic-campaign.yaml) is an independent third proof: a horizontal environmental public-awareness campaign with two procedural assets, four shots, and no new orchestration source. It exposed missing organic geometry and highlight verification, which were promoted into generic ellipsoid recipes and `frame-overexposure` gates.

[`campaigns/after-hours-character-conformance/cinematic-campaign.yaml`](../campaigns/after-hours-character-conformance/cinematic-campaign.yaml) is a fourth proof in a character-fashion grammar. It resolves a recurring character and cautious gait by capability from the shared library, creates a semantic target-derived turn, composes two layered motion timelines, and verifies forward travel, gait biomechanics, full-body framing, visibility, and highlight detail. Its first walk camera was rejected even though the pixels and travel-direction gates passed: the legs were cropped. That failure became the generic `subject-framing` gate, which projects the evaluated animated mesh through the real Blender camera at every semantic landmark.

These campaigns establish reuse of production mechanics, not automatic creative sameness. New art direction, copy, and genuinely new asset classes still require creative work; once created and verified, their reusable capabilities enter the same resolver and declarative assembly path.

[`campaigns/rainwalk-square-crossdomain-conformance/cinematic-campaign.yaml`](../campaigns/rainwalk-square-crossdomain-conformance/cinematic-campaign.yaml) proves cross-domain derivation in a four-second square fashion vignette. It resolves verified VFX, material, clothing, character, and gait parents; adapts the first three through domain contracts; renders them together; and publishes three immutable releases. [`campaigns/rainwalk-banner-library-reuse/cinematic-campaign.yaml`](../campaigns/rainwalk-banner-library-reuse/cinematic-campaign.yaml) is the downstream transfer test: a two-second 16:9 campaign resolves the three exact releases with zero further VFX, material, or clothing adaptation. Its separate camera correction shows that format-specific composition remains creative data while the production mechanics stay reusable.

[`campaigns/nocturne-exhibition-conformance/cinematic-campaign.yaml`](../campaigns/nocturne-exhibition-conformance/cinematic-campaign.yaml) is a 20-second 16:9 cultural-exhibition trailer with five semantic venue/installational shot patterns and zero bespoke orchestration. It derives and publishes `lighting.nocturne-gallery@1.0.0`. [`campaigns/atelier-vessel-lighting-reuse/cinematic-campaign.yaml`](../campaigns/atelier-vessel-lighting-reuse/cinematic-campaign.yaml) is a separate six-second 1:1 fragrance-product trailer that resolves the release unchanged (`reusedLightingSources: 1`, `adaptedLightingSources: 0`). The pair changes genre, duration, geometry, format, cameras, audio, and editorial while retaining the shared lighting, campaign, renderer, verification, publication, and edit subsystems.

The same Nocturne source campaign derives and publishes `editorial.nocturne-event-lockup@1.0.0` through `editorial-treatment-v1`. The contract bounds canvas, copy, margins, palette, motif opacity, and typography scale while preserving the verified parent's exact font and motif. Independent rendering, per-line alpha bounds, safe-area containment, contrast, and font-file hashing are repeated during approval. [`campaigns/nocturne-programme-announcement-reuse/cinematic-campaign.yaml`](../campaigns/nocturne-programme-announcement-reuse/cinematic-campaign.yaml) resolves the exact transparent overlay unchanged (`reusedEditorialSources: 1`, `adaptedEditorialSources: 0`) in a new four-second delivery with new geometry, camera, soundtrack, and timing. It also directly reuses the published lighting rig and adds no orchestration source.

## Create-to-library publication

A procedural geometry source, motion source, layered motion timeline, atmospheric VFX adaptation, surface-material adaptation, clothing-fit adaptation, lighting-rig adaptation, audio treatment, or editorial treatment may declare publication metadata: immutable asset ID/version, title, description, tags, capabilities, generator, renderer compatibility, required verification checks, and the campaign shots that provide evidence.

Publication is intentionally two-stage:

1. A fully rendered campaign with a passing delivery report creates `work/publication-candidates/manifest.yaml`. Each candidate contains its generated artifact, the exact declarative campaign source, semantic contact sheets, structured render/framing reports, and delivery report. Every declared file carries a SHA-256 digest.
2. `cinematic-campaign publish-assets` requires explicit source IDs, reviewer identity, and rationale. It verifies every hash, records an approval artifact, changes the candidate from `validated` to `verified`, copies only declared files into the immutable library version, and rebuilds the shared index.

No candidate is produced by `--no-render`, a failed delivery cannot become a candidate, an altered artifact or evidence file cannot be approved, and the resolver will not reuse a merely validated candidate. Every verified/deprecated library artifact and verification file must declare a SHA-256 digest. Domain approval also reloads live artifacts and repeats semantic checks, so an attacker cannot make a protected VFX, material, or clothing change acceptable merely by rewriting the candidate, report, and hashes together. This keeps review accountable while making approved reuse a single deterministic operation.

Rendered rebuilds are idempotent after publication. If the declared immutable version already exists and its primary artifact hash matches the newly built output, the candidate manifest records the existing library release as `published` instead of manufacturing another review request. If the content differs, the build fails with an immutable-version collision and requires an explicit version increment.

If a released version is superseded, `asset deprecate` records its verified successor, timestamp, and reason without deleting its audit artifacts. Ordinary search and resolution exclude deprecated versions; explicit inspection can still retrieve them.

[`campaigns/night-signal-library-reuse-conformance/cinematic-campaign.yaml`](../campaigns/night-signal-library-reuse-conformance/cinematic-campaign.yaml) proves the downstream half of the loop. It resolves `environment.night-transit-platform@1.0.1` from the library and combines it with a new prop and editorial grammar without copying the originating recipe or adding orchestration code. The resolver records the platform as `reuse` and the signal orb as `create`.

## Auditable adaptation

Atmospheric VFX, surface materials, and clothing use the same parent-resolution and immutable-publication model as geometry and motion, with domain-specific invariants:

- `atmospheric-treatment` may tune world, fog, and rain appearance but preserves three ordered camera-depth layers, IDs, seeds, depth intervals, and spans.
- `surface-treatment` may tune palette and bounded surface response while preserving the renderer-independent shading model. A geometry `materialBindings` entry embeds the complete surface contract, which Blender renders as seeded procedural shader nodes.
- `canonical-clothing-fit` targets an exact canonical character skeleton, preserves garment topology/material groups, and applies measured outward clearance. `long-dress-drape-v1` uses pelvis-dominant weighting and a bounded hem influence to prevent legs from pulling the skirt sideways.

Each successful derivation emits a compatibility report with parent and derived hashes, capability closure, operations, preserved invariants, and measured outcomes. Clothing also records and verifies its target geometry hash and skeleton. Direct reuse accepts only a fitted garment whose declared target or ancestry matches the resolved actor.

A geometry requirement may declare a deterministic adaptation of a verified library parent. The public contract currently supports additive semantic attachments and explicit material-property overrides. The builder refuses undeclared capability gaps, attachment overwrites, unknown materials, no-op adaptations, non-verified parents, and topology/skeleton validation failures.

Every successful adaptation writes `work/adaptations/<source>/compatibility-report.json` containing the exact parent version and geometry hash, derived geometry hash, requested/missing/provided capabilities, operations, vertex/triangle/joint counts before and after, coordinate preservation, and validation result. A published derived asset must declare its parent in `compatibility.requires`; approval independently re-hashes both parent and derived geometry and rejects a report naming or hashing the wrong lineage.

A motion requirement may declare `adaptation.kind: gait-retarget` with a verified phase-gait parent and a target library-backed character source. The builder reads the target character's height, leg length, arm length, hip width, and foot scale, then runs the shared phase-gait synthesizer again with the parent's semantic style. It deliberately does not multiply or stretch baked joint curves. The resulting compatibility report records both dependency versions and hashes, source/target proportions, canonical skeleton compatibility, gait phase model, forward travel, knee polarity, planted-contact error, swing clearance, ground penetration, pelvis continuity, and joint-limit results.

Publication requires both the parent motion and target character in `compatibility.requires`, independently re-hashes the live motion and geometry artifacts, and requires passing skeleton and biomechanics evidence. All dependency and lineage checks complete before approval state is written, so a rejected derivation cannot leave a candidate falsely marked as reviewed.

A motion timeline may declare `derivation.kind: layered-performance`. Unlike an ordinary campaign-local timeline, this reusable form only accepts directly reused verified library motions and a verified library-backed target character. Every non-base layer requires an explicit joint mask and `minimumContribution`; verification recomposes the output without that layer and measures the maximum vector delta on the declared joints. This prevents a nominal gaze, gesture, or facial layer from earning a capability while contributing no visible motion.

The compatibility report records each input asset/version, artifact role, live artifact hash, layer interval, source interval, playback, weight, fade, mask, threshold, measured contribution, target geometry hash, skeleton result, finite samples, uninterrupted base coverage, and exact frame grid. Publication declares all inputs in `source.sourceAssets` and `compatibility.requires`. Approval independently resolves and hashes every named source role and target geometry, and rejects missing, additional, omitted, or altered lineage before writing review state.

Semantic entity placement can position a character or prop from another scene entity's named attachment. This removes duplicated world coordinates from multi-character marks. Cycles, self-placement, unknown entities, and missing attachments fail before rendering.

[`campaigns/last-platform-multicharacter-conformance/cinematic-campaign.yaml`](../campaigns/last-platform-multicharacter-conformance/cinematic-campaign.yaml) exercises both adaptation paths. It adapts the published night platform with reusable dialogue marks/cameras, retargets a verified cautious gait to Elara's exact proportions, places two distinct verified characters from semantic marks, composes grounded base poses with independent head performances, and verifies mutual facing, complete full-body shots, intentional over-shoulder coverage, local highlights, and exact delivery. The accepted gait is published as `motion.walk-natural-cautious-elara@1.0.0` for ordinary downstream resolution.

[`campaigns/quiet-resolve-performance-conformance/cinematic-campaign.yaml`](../campaigns/quiet-resolve-performance-conformance/cinematic-campaign.yaml) exercises multi-parent performance derivation in a six-second brand-manifesto grammar. It resolves the published Elara gait and bidirectional turn library, proves a 0.34-radian masked head contribution over a declared 0.20 threshold, preserves 1.622 m forward travel at 0.99994 alignment, survives a rejected-and-rebuilt full-body camera, and publishes `motion.quiet-resolve.walk-and-look@1.0.0`.
