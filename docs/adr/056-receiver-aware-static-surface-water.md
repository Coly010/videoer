# ADR 056: Receiver-aware static surface water

## Status

Accepted for implementation; visual inventory remains rejected.

## Context

The earlier material path exposed one scalar `roughness.wetness` and the rain VFX placed splashes inside a rectangular world-space bound. Transfer renders proved both abstractions insufficient. Uniform wetness made paving read as plastic, while a camera-independent splash bound still knew nothing about the actual receiver, shelter, drainage, material absorption, free water or puddles. Visual rain density is also not a physical water-volume input.

The existing irregular paving already provides exact modeled geometry, disjoint unit/joint/substrate/border targets, a queryable support surface, drainage direction and named outlets. ADR 055 established unit-local material identity. Surface water therefore extends those contracts rather than creating a second paving or VFX system.

## Decision

Videoer owns a renderer-independent, content-addressed static surface-water field. Its inputs are the exact receiver geometry bytes and semantic geometry, scene transform, drainage direction and explicit gradient, outlet attachments, physical rain flux, per-material response profiles, exact shelter geometry/transforms, grid resolution and solver limits.

Physical rain flux declares intensity, exposure duration, drop diameter and impact speed independently of visible streak count. Material response declares absorption capacity/rate/saturation, film/edge/puddle retention, wet roughness and splash thresholds. The old presentation-only `roughness.wetness` value cannot substitute for these inputs.

The deterministic compiler:

- samples the highest transformed receiver triangle and live material group in every covered subcell;
- casts rays opposite the wind-driven incident-rain direction against exact transformed shelter triangles;
- converts rainfall depth into incident volume and applies bounded absorption and film retention;
- detects material/height edges without treating open receiver boundaries as storage edges;
- uses a priority flood over geometry elevation plus the declared drainage grade to fill depressions, route overflow and discharge through boundaries/outlets;
- records film, absorption, runoff, edge accumulation, puddle depth, effective roughness and splash eligibility per row-major cell;
- fails when geometry/material identity is unresolved, grids exceed the declared budget, receiver cells cannot reach an outlet, hashes disagree, or water mass is not conserved.

The field records both the exact file SHA-256 supplied and proven by the assembly layer and a canonical semantic geometry hash. These identities are not interchangeable. Scene fingerprints include the field bytes. Scene verification recomputes its semantic hash and mass balance, then requires its exact receiver geometry hash and transform to match the bound environment entity.

Blender consumes the same field through a continuous packed field texture and generated receiver UV layer. It modulates the existing material's albedo, roughness and clear coat rather than adding one transparent plane per solver cell. Splash positions are deterministically weighted among eligible exposed wet cells; the legacy rectangular bounds remain only for scenes without a field during migration.

## Verification

Acceptance of the structural subsystem requires:

- byte-identical fields and hashes for identical inputs;
- exact water-volume conservation;
- stable row-major topology and live material identities;
- zero incident water and splash eligibility beneath complete shelter;
- deterministic fractional exposure at shelter edges;
- lower absorption to increase runoff/puddle/discharge without changing receiver topology;
- a real sampled depression to retain bounded puddle water before overflow;
- translated/rotated transforms to change identity while preserving equivalent local response;
- stale geometry, VFX, shelter or field hashes and wrong target classes to fail closed;
- historic-sett and contemporary-paver transfer through the same compiler, assembly, scene verification and Blender implementation;
- visual inspection before publication.

The first Blender overlay implementation was rejected because thousands of separate transparent cell quads exposed the solver grid as white/black tiles and tar-like paving. The continuous field-texture implementation removes those artifacts. Current historic and contemporary renders remain visually rejected: historic wet stone is too dark and contrasty, contemporary units remain oversized/chalky, granular joint response is weak, and computed puddle topology does not yet read distinctly enough at the intended cameras.

## Consequences

Water response is now reusable across campaigns and tied to real construction rather than scene-specific gloss. Canopies measurably suppress incident water and splashes, and drainage/material changes alter conserved volumes. The current solver is a static exposure snapshot, not animated fluid simulation. Large shelter/receiver meshes still need a deterministic acceleration structure; renderer work still needs better smooth puddle-surface reconstruction and material-specific optical calibration. Those are explicit shared-system improvements, not reasons to weaken conservation or return to uniform wetness.
