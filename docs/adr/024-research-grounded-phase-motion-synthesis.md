# ADR 024: Research-grounded phase and contact motion synthesis

Status: Accepted

## Context

The first procedural walk satisfied timing, skeleton compatibility, floor contact, and render completion, yet visual review exposed two fundamental failures: its knees could fold in the direction of travel and its feet could read behind the legs while the body appeared to walk backwards. Those defects demonstrate that generic keyframe interpolation plus ankle-height checks are not a sufficient motion system or acceptance standard.

Future cinematic actions also need the same underlying concepts: a turn has planted support phases; reaching has approach, acquisition, and attachment phases; opening a door constrains a hand to a moving handle; reading constrains two hands, gaze, and a prop. A walk-only controller would duplicate these mechanisms and make later interactions inconsistent.

## Decision

Videoer represents procedural motion as a renderer-independent `MotionDesign` containing parameters, named normalised phases, contact declarations, composable pose layers, invariants, and research provenance. Curves, layer composition, point-contact evaluation, and joint-limit evaluation are generic modules. A motion-specific synthesiser may add domain solvers, but it emits the existing canonical `MotionClip` format and never calls a provider while rendering or verifying.

Human walking uses eight gait phases and approximately 60% stance / 40% swing. Each leg uses heel, ankle, and forefoot rockers rather than a rigid flat foot. The mannequin therefore exposes separate heel and toe contact attachments, and the toe joint owns visible toe geometry. Pelvis translation/rotation, thorax counter-rotation, opposite-leg arm swing, elbow modulation, and head stabilisation are phase-locked whole-body layers. Character proportions and named style parameters determine stride, cadence, clearance, posture, and motion amplitudes.

The first accepted styles are neutral, cautious, and confident. They share phase topology and constraints but differ parametrically; they are not unrelated hand-authored clips.

## Verification requirements

A synthesised walk is rejected unless deterministic sampling verifies all of the following:

- canonical root travel is forward (`-Z`), and baked root travel matches the synthesised stride;
- knees flex behind the actor relative to travel;
- every toe remains anatomically ahead of its heel;
- at initial contact the landing heel leads the root and the opposite heel trails it;
- active heel/toe contact error, ground penetration, and swing clearance remain within bounds;
- joint limits and pelvis continuity pass over the dense analytic evaluation;
- required pelvis, torso, arm, head, and toe tracks exist;
- Blender side and three-quarter probes show all eight gait landmarks without limb separation, reversal, foot-order ambiguity, or invisible toe articulation;
- a hash-bound qualitative review separately evaluates directionality, anatomical foot order, temporal smoothness, planted contact, weight transfer, torso countermotion, arm dynamics, foot roll, silhouette separation, and human deformation. Any failed dimension forces rejection and concrete repair instructions.

Quantitative gates prevent known classes of regression; they do not replace visual review. The mechanical predecessor remains preserved as the `before` benchmark rather than being rewritten.

Motion tracks may carry explicit velocity and acceleration and select C² quintic Hermite interpolation. Natural gait is sampled densely enough to resolve initial contact, conditioned to the six-harmonic bandwidth used by the CC BY healthy-gait calibration, then reconstructed and reverified from the final persisted clip. The final verifier measures normalized jerk, jerk impulses, exact derivative seams, planted heel/toe error, swing clearance, ground penetration, anatomical foot order, and leading/trailing heel order. It does not trust the pre-conditioning analytic solver as evidence for the rendered clip. See [the calibration record](../research/human-gait-kinematics.md).

Visual review is intentionally not reducible to those metrics. The 2026-08-31 neutral-gait evidence passes direction, foot order, C² temporal behavior, and contact limits, but is rejected because stance loading remains columnar, the torso is stiff, the arms read as rigid pendulums, foot rollover is mechanical, three-quarter silhouettes bunch, and the capsule mannequin cannot demonstrate human deformation. This rejection is useful system evidence: it prevents the benchmark from certifying a reusable motion or character capability prematurely.

## Evidence and licensing

Phase topology and broad waveform relationships are grounded in public primary literature and the CC BY 4.0 Fukuchi healthy-gait dataset. Videoer does not redistribute the large dataset or copy its samples into runtime assets. All runtime curves and solvers are project-authored and deterministic. The evidence and engineering translation are recorded in [Human gait research basis](../research/human-gait.md).

## Consequences

- Walk synthesis is more complex, but the complexity lives in reusable motion primitives rather than a renderer or one clip.
- Toe articulation requires a new immutable mannequin version; old assets remain reproducible.
- If a named attachment and an evaluator target disagree, corrected rig and motion versions supersede the originals; library search prefers the latest semantic version without rewriting history.
- New action families must declare phases, contacts, layers, and invariants before they can be visually accepted.
- Renderer adapters consume canonical clips and cannot silently reinterpret travel direction or skeletal channels.
