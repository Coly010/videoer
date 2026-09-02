# ADR 060: Construction-semantic surface variation

## Status

Accepted for implementation.

## Context

Per-unit value, roughness and weathering variation removed exact material uniformity from modeled paving, but it could not describe _where_ wear or dirt belongs on a constructed unit. Raising random amplitudes produced arbitrary colour noise rather than material history. The first geometry-aware experiment also exposed a pre-existing winding defect: paving loops were counter-clockwise in the X/Z ground plane, making authored top, bevel and side normals face inward or downward while double-sided rendering concealed the error.

## Decision

Construction-semantic response is renderer-independent geometry data. Modeled paving emits two bounded vertex masks in addition to its three signed per-unit channels:

- `videoer_paving_edge_wear` in `[0, 1]`;
- `videoer_paving_dirt_accumulation` in `[0, 1]`.

Every unit loop is normalized to outward winding before mesh generation. The bevel carries maximum edge exposure. The visible top contains an explicit deterministic inset construction band: joint-adjacent vertices carry stronger dirt and edge exposure, interpolating into a cleaner interior. Sides and bottoms retain separate semantic values. This extra topology is real portable geometry, not a Blender pointiness, ambient-occlusion or island-random shortcut.

Surface-level unit variation and texture-placement unit variation are distinct contracts. Texture placement supports the established three per-unit channels. A procedural surface may additionally declare the two construction masks and bounded amounts. A material that declares both surface and texture-placement variation is rejected because applying the same signals twice is ambiguous. TypeScript and Blender both reject unknown fields, missing attribute/amount pairs, invalid fixed names, missing attributes, out-of-range amplitudes and out-of-range geometry values.

The first project-owned paving-unit materials use existing metre-scaled `cut-stone` and `granular-aggregate` patterns. They remain replaceable `SurfaceMaterial` definitions with no provider or renderer dependency. Procedural binding verifies every modeled-unit, joint, substrate and border target before atomically replacing its output.

## Verification

Acceptance requires:

- deterministic outward winding with upward top normals, outward side/bevel normals and downward bottoms;
- exact vertex cardinality and semantic ranges for all five attributes;
- normal-correlated proof that top band, interior, bevel, side and bottom receive the intended masks;
- fail-closed TypeScript and Blender tests for missing, malformed, duplicated and out-of-range declarations;
- a native Blender render pair that changes only edge/dirt masks and measures a non-zero decoded-pixel difference;
- unrelated historic-granite and contemporary-concrete transfer renders before publication.

## Consequences

Geometry-aware dirt and wear are now reusable surface inputs rather than audit-scene grading. The historic and contemporary transfer fixtures prove the contract and renderer boundary, but both materials remain visually rejected. At medium distance the new top band is visible yet still too orderly; the worlds lack the irregular silhouette, mineral colour complexity, traffic paths, staining, repairs and multi-scale construction history needed for photographic paving. Those deficiencies require richer reusable geometry/material/history systems, not larger random amplitudes. No material or environment asset is published by this decision.
