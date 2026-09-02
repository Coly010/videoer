# ADR 068: Conserve optical-water support independently from depth

## Status

Accepted for renderer-independent optical-surface schema v3. Schemas v1 and v2 remain supported and content-identical.

## Context

Surface-water optical schema v2 conserved puddle volume, refined contours below solver-cell scale and kept the continuous receiver film separate. It nevertheless reconstructed a single scalar by averaging `puddleDepthMeters * coverage` from each finite-volume solver cell onto four surrounding lattice corners. A near-zero depth contour then decided both where water existed and how deep it was. Sparse puddles consequently spread into neighboring dry cells; the global depth correction conserved litres but could not repair the invented support area.

The unrelated contemporary construction host exposed the defect quantitatively. Its 201 full-coverage puddle cells represented `2.894400 m²` and `0.0022902092750705983 m³`, but schema v2 emitted `14.110623141880128 m²`: `4.8751×` the source support. Raising the contour threshold reduced area only by concentrating the same volume into depths above the source maximum, so threshold tuning was rejected.

## Decision

Optical-surface schema v3 separates support, volume moment and receiver support.

- A fixed compact Wendland C2 kernel reconstructs wet support from wet-cell coverage and reconstructs the separate moment `coverage * puddleDepthMeters`.
- A deterministic 64-iteration contour solve makes projected optical area equal `sum(wet coverage * cell area)` within `max(1e-8 m², source area * 1e-4)`.
- A separately calibrated receiver-support contour clips the wet contour. The portable mesh therefore cannot escape its reconstructed receiver domain.
- Depth is `moment / support`, preserving a convex blend of source depths. A deterministic bounded solve conserves volume while clamping every reconstructed depth to the maximum source puddle depth.
- The report persists source/projected area, error and ratio; source mean depth; wet and receiver contour thresholds; correction factor; depth bound; receiver model and zero escape area. TypeScript verification, exact scene reconstruction and Blender independently remeasure the portable artifact.
- Legacy fields are accepted only when every wet cell has full coverage. Coverage alone does not locate a partial receiver footprint inside a cell. Partial wet cells fail closed until a future surface-water field version persists a content-addressed subcell receiver mask.

The fixed kernel and area solve belong to the schema model, not to a campaign or material option. V1 and v2 code paths and identities are unchanged.

## Consequences

The contemporary Granular Concrete transfer now emits `2.894400000000019 m²`, conserves the exact `0.002290209275070598 m³` reconstructed volume with `4.34e-19 m³` error, and never exceeds the `0.0027837045208499714 m` source maximum. The correction factor is `1.003863305292891`; all 37,168 triangles pass the canonical scene and Blender checks.

Visual comparison removes the large dark contiguous puddle patches admitted by v2 (close-view v2/v3 SSIM `0.964758`, PSNR `34.854765 dB`). It does not make the host photographic. The receiver still carries near-continuous film response over 3,595 of 3,654 active cells, so the paving remains broadly glossy; its facade, glazing, interior and precipitation are also simplified. Those are now separate visible deficiencies rather than reasons to re-inflate optical puddles.

Production clothing remains queued separately as reusable-system work; this decision neither reprioritises nor narrows that queue to the benchmark.
