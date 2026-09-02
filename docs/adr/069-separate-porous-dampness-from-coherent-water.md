# ADR 069: Separate porous dampness from coherent water interfaces

## Status

Accepted for additive receiver-water appearance schema v1. Existing surface-water and optical-water
schemas remain supported.

## Context

Optical-water schema v3 corrected a `4.8751x` puddle-support inflation while preserving exact water
volume. The unrelated contemporary host still looked broadly polished because the receiver shader
collapsed four different states into one scene-global wet strength: absorbed water, retained film,
edge storage and puddles. A distant maximum free-water depth normalized every cell; absorbed-only
cells could receive a dielectric coat; 3,595 film-positive cells reached median coat weight `0.445`
with fixed coat roughness `0.055`; and puddles were partly represented both by the receiver coat and
their own optical mesh.

Removing that coat exposed a second coupling. The hydraulic solver's legacy `effectiveRoughness`
channel reduced Granular Concrete from dry midpoint `0.59` toward approximately `0.20` across the
receiver. That value is useful to the legacy response but is not a calibrated porous-material
shader model. Reusing it still produced broad polish even when coherent-film coverage was exactly
zero.

Primary research recorded in `docs/research/wet-porous-materials.md` supports distinct porous and
free-surface mechanisms. Retained water below surface asperity tops is not automatically a coherent
optical film; water's dielectric interface uses IOR `1.333`, while porous darkening/roughness require
material-specific calibration.

## Decision

Add a content-addressed `videoer.surface-water-receiver-appearance.v1` sidecar that binds the exact
water field, receiver geometry and semantic hashes, transform, sorted material responses and every
derived cell.

- A water field that uses receiver-appearance calibration persists its complete sorted material
  response map, including responses inherited from bound geometry. This lets downstream appearance
  compilation recover exact embedded responses without requiring a partial assembly profile to
  duplicate them. Fields without appearance calibration omit the map and remain content-identical.
- Porous dampness is reconstructed locally from absorption saturation, retained-film saturation and
  edge-storage saturation. It drives explicit saturated base-colour and saturated roughness
  multipliers. It never uses a scene-global maximum.
- Coherent microfilm uses a smooth local transition only above the material's asperity envelope,
  with declared maximum coverage, interface roughness and water IOR. Absorbed-only and
  below-envelope water produce zero coat.
- Puddle cells produce zero receiver coat. The support- and volume-conserving optical-water v3 mesh
  exclusively owns their dielectric interface.
- Blender packs base multiplier, roughness multiplier, coherent coverage and interface roughness
  into a verified field image. Inactive texels are identity values so linear filtering cannot darken
  receiver boundaries.
- Coat weight comes only from coherent coverage, coat IOR is material-declared `1.333`, and coat
  normals reuse the receiver's exact normal chain. Existing coat ownership, stale cells, stale
  reports, missing material calibration, scene-global normalization and puddle overlap fail closed.
- The legacy receiver-water shader remains available only for scenes without the additive sidecar;
  no existing field or scene identity is silently reinterpreted.

## Consequences

The real unrelated host passes 5/5 cinematic gates and the focused Blender 4.5.13 witness rejects a
forged coherent-film channel while proving exact packed values, water IOR and receiver-conformal
normal linkage. All 3,654 active cells are locally damp over `52.3152 m2`; none clears its declared
asperity envelope, so coherent-film area is exactly zero and the separate puddle surface remains
`2.894400000000019 m2` at `0.002290209275070598 m3`.

The first sidecar render, which still reused hydraulic roughness, and the corrected porous-roughness
render differ at SSIM `0.957684` and PSNR `30.911078 dB`. Visual inspection confirms that the
receiver-wide polished response is removed while bounded puddles remain. Publication is still
rejected: the concrete response uses documented heuristic priors rather than material-specific
measurements, small puddles remain dark and weakly integrated, and the facade, glazing, inhabited
interior and precipitation remain visibly simplified.

Production clothing remains queued separately as reusable-system work. This decision neither
reprioritises it nor turns its panel, seam, hem, thickness, deformation, cloth-material, simulation
or temporal-verification gaps into benchmark-specific polishing.
