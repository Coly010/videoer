# ADR 032: First-class lighting-rig derivation and transfer

## Status

Accepted.

## Context

Videoer could resolve complete reusable lighting rigs, but early rigs were packaged as `environment` assets because the library had no lighting asset kind. A campaign could add local lights, yet it could not derive, verify, publish, and independently reuse a spatially transformed rig. That made lighting adaptation either campaign-owned duplication or an unverified manifest claim.

Lighting integrity is not established by a valid JSON schema or matching hashes. A candidate can retain plausible lights while changing a key into a rim, moving a target, altering exposure semantics, or rewriting its report and artifact hashes.

Whole-frame black/white percentages are also insufficient visual evidence. A bright sky, floor, or practical can make a frame pass while the façade, face, product, or other intended subject remains crushed or clipped.

## Decision

`lighting` is a first-class asset kind with its own immutable library directory and `lighting` artifact role. Legacy verified `environment` packages containing a `lighting-rig` remain readable parents; new derived rigs publish as lighting assets.

`lighting-rig-transform-v1` is a bounded renderer-independent derivation. It may:

- apply one uniform scale, Y-axis rotation, and translation to every light position and target;
- scale emitter sizes with the same spatial scale;
- apply bounded global and per-purpose energy factors;
- multiply colours within bounded channels or declare a non-black world colour; and
- add derivation metadata.

It must preserve light count, order, identity, type, purpose, and the parent coherent AgX exposure contract. Build-time verification independently reconstructs the expected rig and compares positions, targets, sizes, energy, colours, world colour, topology, exposure, role coverage, and energy range.

Publication resolves and validates the immutable parent, checks parent/output content hashes, parses the normalized derivation, and repeats the complete semantic comparison from the live parent and candidate. A regression mutates a light position and rewrites the candidate, report, and asset hashes; approval still rejects it.

Authored lighting candidates must additionally declare measured exposure gates for the intended subject region. The renderer records black, white, and midtone percentages for that normalized screen region at semantic frames and fails closed when any bound is violated. Passing these measurements establishes tonal coverage, not artistic acceptance: contact sheets or equivalent rendered evidence still require visual review, and generated candidates remain `validated` until that review explicitly accepts them. A fixture whose subject representation prevents a meaningful artistic judgement must be replaced with a domain-appropriate static witness; unrelated character-motion work is not a prerequisite for lighting development.

## Rejected approaches

- Continue typing rigs as environments: rejected because asset identity, search, publication, and compatibility would remain semantically false.
- Copy lights into each campaign: rejected because it destroys lineage and prevents verified reuse.
- Permit arbitrary per-light replacement: rejected because that is new rig authoring, not bounded derivation.
- Trust compatibility flags or hashes alone: rejected because an attacker or broken producer can rewrite both.
- Validate only endpoint images: rejected because an attractive frame does not prove topology, target, role, or exposure preservation.

## Consequences

The 20-second Nocturne exhibition trailer derives and publishes `lighting.nocturne-gallery@1.0.0` from the verified legacy `environment.warm-bookshop-lighting@0.1.0` parent. Its five-shot 16:9 delivery passes at exactly 480 frames with zero campaign-specific orchestration files.

The unrelated Atelier Vessel fragrance teaser resolves the published rig directly as a first-class lighting asset, performs zero lighting adaptation, and passes a separate six-second 1:1 144-frame delivery. Camera placement and supplemental product light remain campaign data; asset resolution, semantic application, verification, rendering, and edit assembly remain shared subsystems.

Newly authored rigs also use the first-class `lighting` identity; the legacy environment type is compatibility-only. `lighting.bookshop-warm-interior@0.1.0` is the first authored candidate accepted through the static material witness and generic unrelated-set transfer operation. Its bookshop and contemporary-gallery Cycles evidence, bounded adaptation reconstruction, regional exposure reports, explicit visual review, scope limitations, and portability decision are hash-bound into the immutable package before publication.

Lighting acceptance no longer assumes a gallery transfer or trusts a persisted compatibility report. The review names source and transfer evidence directories that must remain inside the candidate. Approval reads all cited evidence, requires the transfer definition to consume the candidate's own source rig, reconstructs the adapted rig and semantic report from live definitions, contains the rendered preview, and only then removes an environment dependency when visual review explicitly declares portability.

`lighting.bookshop-dusk-exterior@0.1.0` is the second directly authored first-class release. Its old-city source retains 19–20% black coverage, 0% clipped white and visible cool-dusk/warm-practical separation. The same five-light topology transfers into the unrelated verified night-transit platform with 7% black, 0% clipped white and 90–91% midtones in the material/form witness region. It is accepted for dusk/night enclosures with warm motivated practicals, not as daylight, moonlight, firelight, candlelight, skin-close or neutral product lighting.

`lighting.moonlit-exterior@0.1.0` closes the moonlight-specific inventory gap without changing the contract. It combines a directional cool key, broader blue environment fill, silver rim, restrained ground bounce and warm aperture practical. The historic-courtyard source and contemporary-rooftop transfer use complete five-role topology and live bounded reconstruction. V1 was rejected for exposing a white area-emitter crescent; V2 for a flat emissive rooftop card; and V3 for an occluded aperture whose warm spill lacked visible motivation. V4 uses framed physical openings, glazing and separated interior emission surfaces. It passes at 18–30% source black coverage, 45–47% transfer black coverage, 0% clipped whites and 55–100% witness-region midtones. Acceptance is limited to background/medium night exteriors; visible practical geometry remains a separate synchronized host asset and time-varying clouds/light remain separate VFX.

`lighting.firelit-interior@0.1.0` extends the same first-class contract with renderer-independent temporal signals. A modulated rig light must name a stable signal; every light sharing that signal must declare identical modulation. A visible-source role may bind the signal to one host entity/material without making the rig own fireplace geometry. Blender bakes deterministic per-frame energy, colour temperature, colour and source emission, and persists authoritative samples. Acceptance reconstructs every sample from the live source and adapted rigs, verifies constant source-emission ratio and exact correlation across the practical, shaped key, bounce and rim, and rejects forged or decorrelated evidence. V1 was visually rejected for a flat yellow wash, weak cool separation and bulb-like embers. V2 transfers from a stone chamber to a contemporary lounge with restrained warm falloff, readable shadow structure and cool edge/ceiling separation. Its diagnostic flame geometry is explicitly not accepted as production combustion VFX.

The failed first Nocturne cross-hall render also exposed that the Blender backend interpolated endpoint Euler rotations instead of the declared semantic target path. [ADR 033](033-semantic-camera-path-fidelity-and-clearance.md) repairs that mismatch, adds renderer evidence, and introduces transformed/animated triangle clearance before rendering.
