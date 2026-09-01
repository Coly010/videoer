# ADR 059: Provenance-bound environment illumination

## Status

Accepted on 2026-09-01.

## Context

The architectural-envelope audit isolated a shared rendering deficiency rather than another paving-specific problem: the flat world supplied no directional radiance for glossy materials, metal, glazing, or conserved optical puddles. It also exposed a Blender composition defect in which enabling fog could leave the declared world colour disconnected. Puddle opacity or roughness tuning under that reflection-poor world would overfit an invalid lighting context.

Reusable lighting already existed as `LightingRig`; creating a parallel HDRI subsystem would duplicate its exposure, adaptation, library, campaign, verification, and renderer boundaries. The missing capability was an exact environment-illumination source inside that contract.

## Decision

`LightingRig` may carry either hash-bound equirectangular radiance or an explicit physical-sky description. A hash-bound source records a normalized package-relative path, SHA-256, byte size, media type, exact 2:1 dimensions, scene-linear Rec.709 interpretation, yaw, and environment exposure. Scene exposure remains a separate explicit AgX contract. A physically meaningful environment may be the rig's only emitter; an empty rig with neither environment nor local emitters is invalid.

Cinematic scenes bind the exact lighting-rig path while retaining renderer-independent scene lights for entity-specific visible-source bindings. A bound rig owns world colour and exposure; shot atmosphere continues to own fog, rain and aerosols, so there is no silent scene-versus-rig world-colour ambiguity. Verification rejects drift from the rig, records that precedence, loads and checks its environment bytes, and fingerprints both rig and radiance artifacts. Adaptation may alter only bounded yaw and exposure while preserving source identity and dimensions. Moving an adapted rig restages and re-verifies the exact image bytes rather than retaining a path into another package or machine.

Open environment acquisition is an explicit, provider-free-after-ingestion boundary. The first adapter uses ambientCG v3 because its downloadable assets are CC0 and its API supports exact asset selection. It persists the exact API response, the provider's retrieved [licence page](https://docs.ambientcg.com/license/), a separate Videoer licence assessment, source archive, archive inventory, selected linear master, inspection evidence, hashes, approved final redirect origins, and an immutable source identity. Licence evidence is provider material; the adapter assessment is not allowed to masquerade as provider evidence. Online access is restricted to HTTPS ambientCG and its known download CDN, including every redirect. Offline reuse requires the exact recorded identity and no provider access.

Live provider verification overruled the initial fixtures in two important ways: ambientCG identifies downloads as `1K`, `2K`, and so on rather than `1K-HDR`; and current archives may contain a linear `*_HDR.exr` master instead of Radiance `.hdr`. The adapter therefore supports both formats explicitly and requires the decoded width to equal the requested resolution. RGBE is decoded with bounded pixel and dynamic-range checks and is accepted as scene-linear Rec.709 only when an explicit `PRIMARIES` header proves compatible chromaticities; the Radiance format's non-Rec.709 default is rejected. EXR is structurally inspected with a security-patched BSD-3-Clause `exrinfo`, requiring one scanline part, RGB/RGBA half/float channels, matching zero-origin windows, requested dimensions, and exact 2:1 projection. Explicit non-Rec.709 chromaticities are rejected. When the attribute is absent, the recorded `openexr-default-rec709` evidence follows the [OpenEXR Technical Introduction 3.4](https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color), which specifies Rec. ITU-R BT.709-3 primaries and white as the default. It does not invent unavailable EXR pixel-range metrics.

Before derivation, Videoer re-hashes every source artifact, re-parses provider, licence and structural evidence, correlates manifest claims with the exact API response and archive entry, and deterministically recomputes the source identity. Validation happens before candidate output is created. Source-cache identities and derived candidate manifests, rigs and reports use exclusive create-or-identical writes; only the explicit `latest` cache pointer is mutable.

Blender independently verifies hash, size, media/decoded-format agreement, dimensions, colour space, projection, yaw, and exposure. The world builder owns one Background-to-World-Output surface. Environment mapping uses the outward direction derived from negated Geometry Incoming followed by bounded Z yaw; its regression proves source sky remains above source ground, spatial variation exists within one asymmetric-panorama render, and yaw moves recognizable regions rather than merely changing a flat sampled colour.

Atmospheric fog is never attached to World Output Volume because a World volume is infinite and can extinguish the same environment radiance the scene is meant to evaluate. Nonzero fog resolves to one finite, smoothly tapered mesh volume. A schema-v2 scene may request a bounded all-frame scene envelope with asymmetric below/above padding or an explicit box; both declare maximum extent and edge falloff. The renderer samples every render frame, expands or verifies against evaluated visible-mesh bounds plus camera positions and targets, resets the frame, and records deterministic containment evidence. The World Volume socket remains unlinked. Cycles is the authoritative image-based-lighting renderer. Eevee fails closed for this contract until a real, verified probe-bake path exists; displaying an environment background without illuminating surfaces is not an acceptable preview substitute.

## Consequences

- Exterior radiance, reflections, glossy response, glazing, and optical water can be judged under a portable reusable source rather than a campaign-local black world.
- New machines require the patched open-source OpenEXR inspection utility documented in `docs/install-openexr.md`; `video doctor` is authoritative.
- Provider API/archive drift becomes a testable ingestion error instead of silently selecting a tonemapped image or mislabeled format.
- Structural and rendered witness success do not publish a lighting asset. Direction, exposure, reflections, dynamic range, and unrelated-host transfer still require visual acceptance.
- Spatial colour entropy is only an anti-flatness signal. Authoritative acceptance requires a controlled diffuse/glossy surface witness plus unrelated-host renders; texture or noise alone must not be described as proof of illumination.
- Physical-sky parameters are reserved in the renderer-independent contract, but unsupported renderer consumption must fail closed until implemented and verified.
