# ADR 071: Typed shot intent over executable camera paths

## Status

Accepted.

## Context

Camera keyframes are the correct executable source for position, semantic target, lens, and easing. They do not, however, state why the shot moves, whether an apparent push actually closes distance to its target, or whether its timing remains inside a production-safe speed and acceleration envelope. Reviewers therefore had to infer intent from raw coordinates, and a path could satisfy collision clearance while contradicting its editorial brief.

Framing cannot be reliably inferred from camera distance: character height, product dimensions, lens, occlusion, and layout all affect the resulting pixels. Existing renderer image gates already measure subject coverage and framing, so a second approximate geometry-only framing system would duplicate and weaken that evidence.

## Decision

`camera.intent` is an optional typed editorial brief layered over, not substituted for, the existing camera keyframe contract. It declares a stable ID, purpose, movement grammar, referenced framing render gates, deterministic sample count, motion envelope, minimum progress, and tolerance. `camera-shot-intent` is an explicit quality gate that binds the brief into fail-closed scene verification.

The verifier samples `sampleCinematicCamera`, the same normalized linear/sinusoidal sampler used by path clearance and Blender camera baking. It measures camera translation speed, finite-difference acceleration, endpoint target distance, and displacement. Grammar has bounded, observable meanings: locked-off remains within tolerance; push/pull changes camera-to-semantic-target distance; lateral/vertical moves meet directional progress; and free moves meet declared progress. The report records all measurements and framing-gate bindings.

Intent framing references only renderer gates capable of proving subject or entity-set framing/coverage. Those render gates, not an estimated camera distance, remain authoritative for still-image composition. Existing scenes remain valid because the brief and its gate are opt-in.

## Rejected approaches

- Replacing keyframes with named shots: rejected because renderers and clearance need the exact path, target, lens, and easing contract.
- Classifying movement from endpoint labels alone: rejected because an authored label does not prove temporal speed, acceleration, or actual path direction.
- Estimating framing from target distance: rejected because it ignores lens, geometry scale, layout, and occlusion.
- Making shot intent campaign-specific metadata: rejected because a reusable production grammar must be verified identically across trailers, product films, and documentary coverage.

## Consequences

New productions can retain generic, renderer-independent camera paths while attaching an auditable editorial vocabulary. A representative scene can require both its camera-intent gate and its existing pixel framing gates before acceptance. The capability does not claim handheld noise synthesis, complex spline curvature classification, or subjective cinematic quality; visual review remains necessary for composition, continuity, and motion feel.
