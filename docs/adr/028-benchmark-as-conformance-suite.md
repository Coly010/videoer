# ADR 028: Treat cinematic benchmarks as conformance suites, not architecture

## Status

Accepted.

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** the benchmark is a fixture and
example, not a conformance gate. A second campaign proving reuse is welcome evidence, never a
requirement for a campaign or the system to be considered done.

## Context

The reference cinematic benchmark is intentionally demanding: one recurring character crosses a rainy old-city street, notices and enters a bookshop, handles a book, and yields to title and cover reveals. It is useful because it forces geometry, motion, interaction, continuity, lighting, atmosphere, editorial, rendering, and verification to work together.

That usefulness creates a risk. A system can appear capable while its orchestration is actually a collection of bookshop coordinates, Elara-specific factories, fixed cameras, and one campaign's editorial copy. Passing one benchmark is not evidence that a new campaign becomes cheaper.

## Decision

The benchmark is a conformance suite and reference implementation. It may provide fixtures, examples, and accepted visual evidence, but reusable domain and application contracts must not depend on:

- the benchmark campaign ID;
- Elara Vale or her wardrobe;
- the old-city bookshop asset or its fixed world coordinates;
- The Rise of Demons copy or cover;
- one shot list, genre, aspect ratio, or trailer grammar.

Reusable systems accept typed parameters or resolved asset capabilities. Campaign-specific factories may compose those systems, but must live at the application/example boundary and must not leak names or coordinates into geometry, motion, interaction, lighting, VFX, cinematic, editorial, or verification domain models.

The reusable boundary includes:

- versioned asset metadata, clearance, compatibility, search, and reuse/adapt/create resolution;
- renderer-independent geometry, materials, skeletons, motion, interactions, lighting, VFX, titles, and cinematic scenes;
- target-derived actions and attachment/landmark resolution instead of baked world coordinates;
- frame-exact timelines, overlays, final assembly, and deterministic audio;
- quantitative and visual verification contracts that apply across campaigns.

## Acceptance

The first benchmark is necessary but insufficient. Before the autonomous production system can be considered generally robust:

1. Express the complete benchmark through the generic declarative campaign builder and remove its named orchestration factory.
2. Resolve scene transforms through asset attachments and production-plan targets rather than fixed bookshop coordinates.
3. Drive title, product reveal, lighting, atmosphere, and edit/audio choices through reusable schemas.
4. Run a second, materially different campaign or trailer form through the same public operations.
5. Record how much campaign-specific code and manual iteration the second run requires; it must be substantially lower than the benchmark build.

## First cross-campaign evidence

The Beacon One product conformance campaign is a three-shot, nine-second non-narrative product launch. It contains no recurring heroine, walk cycle, bookshop, door, book, rainy-street continuity, or eight-beat narrative grammar. It uses:

- asset-owned semantic camera targets resolved through entity transforms;
- the same generic dimensional-product reveal template now used by the benchmark cover;
- reusable lighting/atmosphere scene contracts and visibility gates;
- a campaign-data-driven transparent text overlay renderer;
- the generic provider-free soundtrack-plan renderer; and
- the same frame-exact edit assembler and delivery verifier.

The first run exposed and corrected a genuine hidden benchmark specialization: edit assembly selected an uncomposited base clip unless the campaign manually named its overlay output. Final scene-output selection is now a reusable contract and is regression tested.

The first product implementation used a 363-line campaign-specific application module and a 66-line product factory. It was then migrated to a 165-line validated campaign-data file interpreted by the generic cinematic campaign builder. Both bespoke source files were deleted. The resulting `declarative-build-report.json` records zero campaign-specific orchestration source files. This demonstrates removal of orchestration coupling; it does not claim that creative direction or original asset design require zero effort.

A third campaign then used the same unmodified orchestration path: `Breathe Again` is a horizontal, four-shot environmental public-awareness film rather than a narrative trailer or product launch. Its 211-line campaign file creates two procedural assets, uses world and semantic camera targets, produces two editorial treatments and a twelve-second soundtrack, and assembles a verified 288-frame delivery with zero bespoke orchestration files. Its first visual review drove reusable ellipsoid geometry recipes and a new overexposure gate rather than campaign-only workarounds.

A fourth campaign, `After Hours`, proves the character path is not confined to the benchmark. Its declarative file resolves a verified recurring character and cautious gait from the shared library, synthesizes a turn toward an environment-owned semantic target, composes layered motion timelines, and verifies biomechanics, forward travel, animated full-body framing, and exact delivery with zero bespoke orchestration source. A rejected cropped walk shot produced a generic camera-projection framing gate rather than a campaign exemption.

The environment created for After Hours then passed through the generic publication workflow as `environment.night-transit-platform@1.0.1`: its exact declarative source and all campaign verification evidence are embedded and hashed in the immutable package. The separate Night Signal campaign resolves that version through ordinary capability search, adds a new prop and editorial identity, and renders without copying the platform recipe or adding orchestration source. This closes the measured create → verify → approve → publish → resolve → reuse loop.

`The Last Platform` adds a fifth materially different grammar: silent multi-character performance. It derives a dialogue-stage version of the night platform through declared attachment/material operations and re-synthesizes a verified cautious phase gait against a target character's proportions. Both derivations record parent, target where applicable, and derived hashes plus compatibility evidence. The campaign places two characters semantically, composes independent performances, and uses quantitative reciprocal-blocking and partial-subject coverage gates. Each approved derived release requires its exact dependencies and contains its compatibility report as hashed evidence.

`Quiet Resolve` adds a brand-manifesto grammar and closes multi-parent performance lineage. Its reusable performance accepts only verified library inputs, records each selected artifact role and digest, binds the result to a verified target character, and requires explicit masks plus measured contribution for every non-base layer. The first resolve camera failed unchanged full-body framing; the composition was rebuilt rather than weakening the gate. The approved output is independently re-hashed against both motion parents and the target geometry before review state is written.

## Consequences

The complete eight-shot benchmark now lives in `campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml`. The named scene factory, named soundtrack builder, named edit-plan builder, and their CLI commands have been removed. Library-backed lighting rigs and reviewed image overlays were added to the public contract because migration proved they were genuine reusable gaps. The accepted declarative render preserves all 360 frames and passes delivery verification.

A visually successful benchmark does not close the goal by itself. Every accepted campaign must either reuse existing capabilities or promote its new primitives into the shared system and library. Transfer is measured by unchanged orchestration, explicit asset-resolution decisions, reusable verification gains, and decreasing campaign-specific source—not merely by producing another video.
