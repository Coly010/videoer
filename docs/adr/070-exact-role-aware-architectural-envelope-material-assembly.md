# ADR 070: Exact role-aware architectural-envelope material assembly

## Status

Accepted for reusable system architecture on 2026-09-02. The first two material profiles remain
visual candidates and are not accepted library assets.

## Context

The architectural-envelope compiler already produced physical wall thickness, facade finish and
damp-course layers, foundations, roof and parapet construction, thresholds, aperture reveals,
interior room shells and occupied-room proxies. Despite that structure, it replaced every material
slot with a scalar fallback containing only a palette colour, roughness, metallic value and optional
room emission. The contemporary transfer therefore had nine live material slots and zero bound
`SurfaceMaterial` values. A scene could pass geometry and framing gates while its frame-dominant
facade, roof, plinth, trim and interiors remained materially undifferentiated.

Binding surfaces by a target-name convention would reproduce the same hidden coupling. Binding one
generic material across the complete envelope would also erase real construction distinctions.

## Decision

The renderer-independent compiler now emits `architecturalMaterialTargets` as an exact sorted set of
live material IDs and one or more construction roles. Roles cover structure, foundation, facade
finish/trim/damp course, roof/trim, threshold, interior wall, dark/lit room and occupancy. A shared
material ID retains every applicable role; for example, the same stone may serve a foundation,
damp course and threshold.

The application layer binds a complete target-to-material map atomically. It rejects:

- missing or extra material targets;
- targets absent from either the material table or triangle groups;
- material metadata that does not include every live role;
- construction domains incompatible with any target role;
- patterns incompatible with a role;
- a material explicitly authored for a different target;
- texture-backed materials without a domain-matched application;
- texture applications supplied to procedural materials; and
- any mutation of positions, indices, groups, attachments or skeleton.

The report binds source/output geometry hashes, exact material-file hashes, roles, construction
domains, pattern kinds and the zero-unbound-target result. Existing texture dependencies are
restaged through the established portable geometry path.

Two project-owned procedural profiles exercise the contract on unrelated hosts. They distinguish
historic masonry, mineral plaster, limestone, slate, timber and interior surfaces from contemporary
blockwork, mineral render, stone plinth, roof membrane, painted metal and interior surfaces. Their
parameters are explicit project priors, not claims of measured material calibration or visual
acceptance.

Public CLI operations create either profile and bind any exact compatible material map. The transfer
fixture consumes this same public assembly rather than a benchmark-local path.

## Verification and visual finding

Focused TypeScript coverage proves deterministic cross-host compilation and binding, exact-coverage
failure, role failure and preservation of geometry/installation contracts. Videoer's documented
doctor passes with Blender 4.5.13, NumPy and OpenVDB under host Metal access. Both neutral Cycles
transfers pass all eight structural/render checks and bind all nine live targets with no fallback.

The same-camera contemporary fallback comparison differs materially at 17.407596, 19.729910 and
18.780990 dB PSNR across the three canonical views, proving that the new renderer path is active.
Visual publication remains rejected. Both buildings still read as clean procedural blockouts:
facade planes are too perfect, macro construction variation and local repair/weathering are weak,
edge wear and join ageing are absent, glazing/interior density is sparse, and the neutral fixture is
not a photographic reference-matched acceptance setup.

## Consequences

The scalar fallback remains useful only as compiler bootstrap state; a production envelope must pass
through exact material assembly. Texture/source improvements can now replace one role without
changing envelope geometry or introducing campaign-specific logic. The next generic envelope work
can target multi-scale facade history and construction irregularity against the unchanged contract,
followed by the separately recorded inhabited-interior and atmospheric-composition gaps.

Production clothing remains queued behind this active environment/material tranche as reusable
system work. This decision does not narrow, reprioritise or convert that queue into benchmark
polishing.
