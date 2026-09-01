# ADR 057: Granular paving construction materials

## Status

Accepted

## Context

Unit-aware paving removed the semantic error of photographing a second stone layout onto modeled paving units, but the continuous joint and substrate still used broad flat colours. In transfer renders this made joints read as pale graphic gaps and prevented the receiver-aware water solver from inheriting the physical absorption and retention of the actual bound construction materials.

Joint fill and compacted substrate are distinct construction layers. They need physical aggregate and fines scales, compaction and pore response, and they must remain independently replaceable without rebinding the modeled paving units. These are reusable environment properties, not benchmark styling controls.

## Decision

Videoer represents granular paving construction as renderer-independent `SurfaceMaterial` assets with:

- metre-scaled aggregate and fines frequencies;
- bounded aggregate contrast, pore amount, compaction and embedded dirt;
- explicit absorption, retention, wet-roughness and splash behavior;
- a shared `paving-joint-substrate` construction domain plus an explicit granular role;
- separate deterministic binding to the paving compiler's `continuousJoint` and `continuousSubstrate` targets.

Natural grit and polymeric sand are valid joint roles. Compacted base is the substrate role. The assembly rejects swapped roles, missing targets, overlapping targets, non-granular patterns and wrong construction domains. Modeled units and border targets remain untouched.

The Blender implementation derives color, relief and roughness from the portable physical parameters. Renderer node topology is not persisted in the asset contract.

Surface-water assembly first honors an explicit hash-bound profile override. Otherwise it resolves water behavior from the exact bound material and derives dry roughness from that material. A wet receiver with neither source fails closed.

## Consequences

- Joint and substrate appearance and hydrology can transfer across paving definitions and campaigns.
- Changing a bound construction material changes the receiver geometry hash, invalidating stale surface-water evidence.
- Visual acceptance still requires rendered transfer probes; schema validity alone does not make a material production-ready.
- Smooth optical reconstruction of puddle boundaries remains a separate field-rendering problem and is not approximated with visible solver-cell tiles.
