# ADR 033: Semantic camera-path fidelity and clearance

## Status

Accepted.

## Context

Executable scenes declared camera position, target, lens, and per-segment easing keyframes. The Blender backend placed the camera at those endpoints, converted each target into an Euler rotation, and asked Blender to interpolate the rotations with one hard-coded Bezier mode. This did not execute the declared target path: intermediate orientation could aim somewhere no semantic target specified, and `linear` easing was ignored.

The first Nocturne cross-hall render exposed the defect. Its endpoints were plausible, but the interpolated Euler orientation aimed through an occluding partition and the midpoint visibility gate rejected a nearly black frame. Merely adding more rendered samples would detect more failures after expensive rendering without repairing the renderer/contract mismatch.

Camera-body collision and target occlusion were also implicit. A scene could place clear endpoint cameras while passing the camera or its semantic sightline through static or moving geometry between them.

## Decision

The renderer now implements the declarative camera contract directly:

- a dedicated animated target object follows declared target keyframes;
- the camera uses a `TRACK_TO` constraint with negative-Z tracking and Y-up;
- camera position, target, and lens share normalized exact-frame key placement;
- `linear` segments use linear interpolation in the shared sampler;
- `ease-in-out` segments use deterministic sinusoidal ease-in-out in that sampler;
- position, target, and lens are baked from that sampler at every delivered frame and stored as linear Blender keys, avoiding backend curve approximations; and
- the framing report independently compares evaluated Blender position, target, and lens against the renderer-independent sampler at every semantic frame.

Rendering fails closed unless position and target errors remain within 10 micrometres and lens error remains within 0.005 mm. An attempted direct Blender `SINE/EASE_IN_OUT` curve was rejected after it diverged from the declared sampler by 0.01646 mm of lens at a Nocturne landmark. Frame baking removes that semantic approximation while leaving only Blender property float quantization inside the explicit tolerance.

`camera-path-clearance` is a renderer-independent pre-render quality gate. It declares obstacle entity IDs, sample count, minimum camera-body clearance, and a small target-end tolerance that permits the intended subject surface immediately before its semantic target. At every sample it:

- uses the same camera/target/easing sampler as the renderer;
- loads the real geometry and applies entity transforms;
- retimes any obstacle motion through the scene binding;
- applies morph targets and CPU linear-blend skinning in renderer order;
- measures camera-to-triangle clearance; and
- ray-tests the camera-to-target segment for intersections materially before the target.

The gate reports triangle/sample counts, minimum clearance, maximum early occlusion, blocked sample count, time, and responsible entity. Animated obstacles are evaluated, not rejected as unsupported.

## Rejected approaches

- More semantic render frames alone: rejected because it detects symptoms after rendering and leaves the backend semantics false.
- Widen the black-frame threshold: rejected because the rejected frame was genuinely occluded.
- Interpolate endpoint Euler rotations: rejected because rotations do not preserve an intended moving look target.
- Ignore declared easing: rejected because authored timing is part of the camera contract.
- Static-only collision checks: rejected because characters, doors, props, and set pieces can enter the camera path over time.
- Bounding boxes alone: rejected because they over-reject open or concave geometry and cannot identify actual sightline intersections.
- Trust Blender without measured evidence: rejected because endpoint agreement does not prove intermediate renderer fidelity.

## Consequences

Nocturne's five shots now each evaluate 49 samples against 1,400 transformed venue triangles; minimum measured camera clearance ranges from 1.0 m to 2.397 m and every target sightline remains clear inside the explicit 0.5 m target-surface tolerance. Atelier Vessel evaluates 37 samples against 316 product-stage triangles in each shot; both pass without lighting or camera-specific orchestration code.

Synthetic regressions independently cover exact linear/eased sampling, a blocked sightline, a clear sightline, camera-body proximity, transformed obstacle geometry, and an animated skinned wall entering the sightline. A real Blender rerender records zero position/target error and passes the automatic renderer-camera contract.

Existing campaigns remain valid, but new spatial productions should declare obstacle entities wherever architecture, set dressing, or moving objects can interfere with the camera. The gate complements rather than replaces rendered visibility, exposure, framing, and qualitative review.
