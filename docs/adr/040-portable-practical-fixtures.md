# ADR 040: Portable practical fixtures

## Status

Accepted.

## Context

Environment dressing previously existed as mesh fragments fused into one generated set. A wall lantern could look illuminated because its material emitted, while its useful scene light remained a separately authored world-space light. That prevented the model and illumination from being searched, placed, transformed, versioned, or transferred as one production asset.

Embedding Blender light objects in geometry would solve only one backend. Requiring campaigns to recreate matching lights would preserve the coupling and allow geometry and illumination to drift apart.

## Decision

A practical fixture consists of an ordinary renderer-independent prop geometry asset plus a separate renderer-independent fixture definition. The definition binds the expected geometry identity and mount attachment and declares one or more local emitters with physical position, optional target, linear colour, power in watts, source size, angle, inverse-square falloff, and practical purpose.

Executable scene entities may reference both `geometryPath` and `fixturePath`. The Blender adapter validates the identity and mount, creates backend lights, and parents their local transforms to the same entity armature as the mesh. The fixture therefore follows scene placement, rotation, scaling, and future entity motion without hand-authored world-space duplication. Stored data contains no Blender classes or node names.

Practical geometry still carries an emissive visible source where appropriate, but emission is not treated as a substitute for a local light capable of illuminating nearby surfaces. Isolated and unrelated-set probes must show both fixture form and the surrounding light pool. Probe evidence is iteration-only; immutable publication requires explicit visual acceptance.

Practical emitters may also declare deterministic `seeded-flicker` modulation: frequency, bounded intensity multipliers, bounded colour-temperature range, and smooth interpolation. A fixture may bind that modulation to one named visible-source material. Renderer adapters must animate both useful illumination and the visible emissive source from the same sampled signal, so a flame cannot brighten while its wall pool remains static. Stored definitions contain no Blender curves or noise nodes. Static fixtures remain valid and immutable published versions are never retroactively animated.

## Consequences

Portable practicals can become searchable prop inventory and can be reused as coherent model-plus-light units across environments. The first implementation supports point, spot, and area emitters and a project-owned glazed wall lantern. Future fixture categories can add candles, desk lamps, neon signs, vehicle lamps, magical sources, and animated intensity without changing the geometry contract.
