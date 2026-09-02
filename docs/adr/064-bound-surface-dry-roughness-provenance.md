# ADR 064: Bound-surface dry-roughness provenance

- Status: accepted
- Date: 2026-09-02

## Context

The construction-history audit continued to show an implausibly glossy contemporary paving receiver after all active materials gained explicit optical participation. Both transfer hosts used the same lighting, fog, water optics and field topology, so the remaining difference could be measured at the material/water boundary.

The surface-water assembly profile stored a complete `wetRoughness` response, including freely authored `dry`. Historic and contemporary profiles declared `0.21` and `0.18`, while their bound paving-unit materials declared midpoint roughness of `0.61` and `0.59`. With a `0.34` wet multiplier and wet film over 95–98% of cells, the fields produced median effective roughness of `0.0714` and `0.0612`. Blender then combined that response with the separate thin-dielectric optical water surface. The result was numerically consistent with the profile but inconsistent with the actual bound material.

## Decision

When a receiver geometry material has a bound `SurfaceMaterial`, surface-water `wetRoughness.dry` is derived from and must exactly match the midpoint of that material's declared roughness range within `1e-12`.

- profile rebinding replaces stale dry values with the live bound-surface midpoint;
- direct field assembly rejects a stale profile instead of silently correcting it;
- the core v1/v2 compiler enforces the same invariant, so callers cannot bypass the application layer;
- legacy receiver materials without a bound `SurfaceMaterial` may retain explicit profile dry roughness;
- wet multiplier and floor remain material/assembly response parameters rather than being inferred from dry appearance;
- reports identify whether dry roughness came from a bound surface or a legacy profile.

This does not alter rainfall, storage, routing, water volume, dirt conservation or the separate optical-water reconstruction.

## Consequences

- A water profile cannot make a rough paving material behave like polished ceramic by contradicting its dry contract.
- Material replacement followed by the existing profile-rebind operation updates dry roughness automatically and content-addressably.
- Historic and contemporary transfer fields retain their cell counts, routing identities and conservation errors while median effective wet roughness rises to `0.2074` and `0.2006`.
- The fixed-light rerenders still fail photographic acceptance, proving that pale base color, limited mesoscale structure, simplified environment construction and the broad optical-water layer remain distinct quality gaps.
