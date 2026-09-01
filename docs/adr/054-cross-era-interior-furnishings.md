# ADR 054: Cross-era interior furnishings and exact support semantics

## Status

Accepted — 2026-09-01.

## Context

The shared world library had strong old-city architecture, street storage, vegetation, market and workshop inventory, but little portable domestic furniture. Campaign-local chair/table coordinates would not accumulate into reusable production capability. Existing box and ellipsoid primitives also forced upholstered furniture toward either rigid slabs or inflated proxy volumes.

## Decision

Videoer owns a renderer-independent rounded-cuboid primitive. It samples a signed-distance rounded-box surface into ordinary positions, normals, UVs, indices and skin weights, so upholstery shape is identical in Blender and future Three.js/WebGPU adapters. No renderer bevel modifier is part of the asset contract.

`environment.interior-furnishing-family` composes three independently publishable assets:

- `prop.upholstered-reading-chair@0.1.0`;
- `prop.pedestal-side-table@0.1.0`;
- `prop.decorative-vessel-set@0.1.0`.

The family owns authored reading-corner, conversation and solitary-table recipes. Props expose occupant, side-table, tabletop, support, carry and focus attachments. Placement remains seeded and navigation-aware.

Authored family offsets are world-space metres. Therefore any variant used as a physical support must remain at canonical scale until the layout model gains explicit attachment-to-attachment composition. The pedestal table is fixed at scale 1.0 and its vessel set begins at exactly the table's 0.77 metre support height. Acceptance recomputes this relation from the persisted layout and requires zero support error.

Woven textile, brushed metal and glazed ceramic extend the renderer-independent surface-pattern vocabulary. Each stores physical spacing or speckle scales in metres and is reconstructed procedurally by Blender without external texture dependencies.

Lighting reuse is layout-aware. A bounded adaptation of `lighting.bookshop-warm-interior@0.1.0` maps the parent key target onto the mean persisted furnishing position, records that focus in adaptation metadata, and retains the parent's light identities, purposes and exposure contract. Acceptance reconstructs the adaptation live.

## Verification

The same assets and family definition render in a historical library chamber and contemporary reading loft. Acceptance requires:

- deterministic regeneration of both layouts;
- one complete reading-corner recipe and all three variants;
- exact vessel/table support;
- distinct host and adapted-light identities;
- layout-bound reconstruction of the verified lighting parent;
- a 25-sample camera-to-host-shell clearance gate;
- no uncovered furnishing entity;
- at most 55% black coverage and at most 4% clipped-white coverage;
- three distinct semantic frames per host;
- an explicit qualitative review limited to background/medium use.

The first ellipsoidal chair and later box-built chair were rejected. Camera-wall occlusion, permissive black coverage, underlit modern materials and independent table scaling were also corrected before publication.

## Consequences

Domestic furniture and tabletop inventory can now transfer across campaigns without campaign coordinates or renderer modifiers. The rounded-cuboid primitive is reusable for sofas, beds, cases, cushions and product packaging. This release does not claim hero-close joinery, dynamic seating, object pickup, cloth simulation or publishable host rooms.
