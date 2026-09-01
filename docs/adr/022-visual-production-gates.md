# ADR 022: Visual and temporal output are required test surfaces

Status: Accepted

## Decision

Every asset factory must emit inspection artifacts appropriate to its type. Character publication requires canonical views plus idle/walk/turn/reach clips. Every cinematic shot requires start, quarter, middle, three-quarter, end frames and a preview. Final renders require representative frames, a contact sheet, media verification, and a persisted critique.

Candidate transfer work may use the generic `cinematic probe` path to render only declared semantic landmarks at the scene's authoritative profile. This is a compute-allocation mechanism, not a quality downgrade: the probe retains the exact renderer, sampling, denoising, camera, lighting, atmosphere, and geometry contracts. Probe reports are explicitly ineligible for publication because they cannot establish temporal stability or delivery integrity. Once the landmarks pass visual review, the unchanged scene proceeds to the complete render and ordinary gates.

Quality gates combine mechanical checks (geometry, skeleton, weights, transforms, attachment distances, floor contact, continuity, media properties) with Codex visual judgement (identity, proportions, deformation, interaction, lighting, depth, framing, pacing, and typography). Failed shots are selectively repaired and rerendered. Compilation and successful process exit are never sufficient acceptance criteria.

Deterministic seeds and stable probes are mandatory. Exact-pixel assertions are used only where backend output is stable enough to make them meaningful.
