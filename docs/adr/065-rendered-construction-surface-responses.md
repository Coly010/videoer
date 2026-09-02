# ADR 065: Rendered construction-surface responses

- Status: accepted
- Date: 2026-09-02

## Context

ADR 063 made construction-history participation explicit and ADR 064 bound wet dry-roughness to the receiving material. The remaining typed `constructionSurfaceResponse` declarations were validated by TypeScript and Blender preflight but were not consumed as construction behaviour. Joints, kerbs, gutters and exposed substrates still received the same generic colour/roughness treatment as modeled paving units. Increasing that treatment would have produced stronger arbitrary shading, not natural-joint clogging, polymeric failure, face-specific border response or exposed aggregate.

The persisted history field is coarser than the long joint strips it drives. Signed displacement without adequate target geometry would therefore only move a few large vertices and could not represent the declared physical response. Water UV binding also depends on the receiver's persisted source topology, so construction tessellation cannot precede water reconstruction.

## Decision

The canonical Blender renderer consumes every active typed construction response and fails closed when the declared target class, geometry or required signal is unavailable.

- Natural joints add loose and persistent dirt coverage without normalising away mass, apply declared onset/saturation, restrict response to upward joint faces, and produce positive fill displacement bounded by the authored joint depth. Residual microstructure is chained through the material normal input.
- Polymeric joints combine traffic and throughflow causality with seeded, metre-scaled coherent breakup. Response is exactly zero below the declared onset and produces negative recession above it, bounded by authored joint depth.
- Any response requiring height uses the Material Output displacement socket. Only faces assigned to the target construction material are tessellated, and their maximum segment length must be no greater than the source field cell size. A bump-only representation is not accepted as equivalent.
- Kerb and gutter masks use object positions and world-to-object normal transformation, so top and paving-facing classification remains correct under translation, rotation and non-uniform scale. Gutters distinguish a throughflow-cleaned core from retained-water/dirt margins; deposition is zero when dirt coverage is zero and optical redistribution does not alter the persisted dirt mass.
- Exposed substrate currently adds normal response only when the substrate has live exposure evidence. No substrate height is invented without a calibrated height contract.
- Raw throughflow and retained-water channels are supplied separately to construction responses rather than inferred from the already-composed runoff display channel.
- Optical water and receiver UV binding occur before construction tessellation, preserving the persisted receiver-index contract while keeping water as a separate surface.
- Unhandled renderer exceptions print a traceback and terminate Blender with a nonzero status. A native program must not be reported as successful because Blender's default Python launcher returned zero after an exception.

## Consequences

- Historic natural grit fills by up to `0.00288 m`; its target-material mesh is refined from a `10.17657 m` maximum segment to `0.119724 m`, below the `0.12 m` field-cell limit.
- Contemporary polymeric joint response recesses by up to `0.00165 m`; its target-material mesh is refined from `11.35176 m` to `0.119492 m` under the same limit.
- Canonical Blender witnesses prove natural onset/midpoint/saturation, exact-zero polymeric onset, seeded repeatability, transform-safe kerb masks, dirt-dependent gutter deposition, active-only substrate response and the nonzero renderer failure path.
- Both unrelated host scenes report the expected three construction materials and complete authoritative-profile probes. Their construction-response contact sheets differ from the preceding corrected-roughness probes by `39.679241 dB` PSNR historic and `47.327127 dB` contemporary.
- This is structural and rendered subsystem acceptance, not production-environment visual acceptance. Both hosts remain visibly synthetic because source character, facade/glazing/interior detail, mesoscale variation, precipitation and atmospheric integration are still insufficient.
