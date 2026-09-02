# Character creation and acceptance

> **Direction ([ADR 074](adr/074-mpfb-rigify-is-the-production-human.md)): the production human is
> MPFB's hm08 CC0 mesh + a Rigify rig. Everything that needs a human character points there.**
> Videoer's own procedural body mesh and canonical 52-joint production skeleton (the
> `geometry production-human` / `createProductionTemplateHuman` foundation described lower down) are
> **retired as production targets** — they were persistently visually rejected, and the MPFB/Rigify
> human built on the same CC0 base is dramatically higher quality. The owned-human code below is
> **deprecated-for-production and kept only until a migration removes or repoints it**; it is
> documented here as history, not as the recommended path. No code was removed when this direction
> was set — see ADR 074's "Not now".

Videoer separates mechanical character validity from visual production acceptance. A valid mesh, completed Blender render, or passing walk report does not make a character production-ready.

## Production human: MPFB (hm08 CC0) + Rigify

The production human is created by MPFB — the same pinned CC0 hm08 base, but kept as MPFB's *full*
mesh with a generated Rigify rig, rather than reduced into a project-owned contract. See
`scripts/blender/render_mpfb_motion_probe.py` (`create_rigged_human`) for how the body and
`rigify.human_toes` rig are generated, and `docs/install-blender.md` for the MPFB/Rigify install.
Human motion is authored against the Rigify rig as native actions — see the source-provenanced CC0
bake path below (`scripts/blender/render_cc0_rigify_action_reel.py`), which is the current
motion-authoring direction. That walk is grounded and strides correctly but its arm carriage is
still unsolved (see the CC0→Rigify section further down); the model + rig direction is settled, the
walking performance is not.

## Deprecated: the project-owned human foundation

> Retained for the existing benchmark and as history only. Do not build new production characters
> this way — use MPFB/Rigify (above).

```bash
npm run video -- geometry production-human work/character \
  --id character.example \
  --asset-version 0.1.0 \
  --height 1.72
```

The generator writes renderer-independent geometry, validation, metadata, canonical views, face and bilateral hand close-ups, and a turntable. Version 2 preserves the canonical 22-joint retargeting core and adds 30 named finger joints, project-owned palm/finger surfaces, deterministic ownership/blending checks, and measured flexion response. The continuous body and hand surfaces use the declared `deterministic-dual-quaternion-v1` skinning mode. Blender is only an adapter; the serialized asset contains no Blender or Three.js classes. This owned mesh is exactly the representation ADR 074 retires; it is documented for the benchmark that still uses it, not recommended for new work.

Generated foundations remain `validated`. Visual evidence generation is not approval.

## Stable-topology production-base experiment (deprecated, see ADR 074)

`createProductionTemplateHuman` converts the pinned CC0 hm08 OBJ and authored weight file under `assets/character-bases/makehuman-hm08/` into the same renderer-independent character contract. It preserves the canonical 52-joint hierarchy, uses an anatomical A-pose, and records the source hashes, licence, topology, skinning mode, and deterministic weight-reduction policy. The procedural mannequin remains the motion/IK proxy; it is not the production mesh.

Proxy-authored walking motion must use the explicit A-pose upper-arm/forearm retarget profile. Full-chain correction is invalid for this template because it distorts anatomical clavicle orientation, and profile mode must not inject wrist or hand tracks. After retargeting, run geometry-driven grounding and the production walk deformation report before rendering. The report samples both shoulders, both hands, both feet, and both toe regions; it rejects the historical left-hand counter-rotation and metatarsal/toe collapse.

The source rig has multiple toe chains while the stable locomotion skeleton exposes one toe-roll joint per foot. The reduction therefore uses the `foot-1` metatarsal landmark plus a height-scaled shared-hinge transition. Do not restore the `foot-2` toe-tip pivot or directly sum all toe groups: that configuration visibly distorted toe-off and failed the surface-strain gate.

The reduced 52-joint binding is no longer presumed to be the eventual Blender production rig. The exact same hm08 mesh is supported by MPFB's full 163-bone default rig and its Rigify human-with-toes generator. Install the pinned open-source dependency and run the audit described in [Blender installation and Metal diagnostics](install-blender.md). Videoer's canonical skeleton remains the reusable motion and interaction contract; the experimental adapter maps it to Rigify only at the renderer boundary and grounds the evaluated full-weight surface independently. The typed profile owns MPFB's non-generic coordinate convention: canonical left/up/forward maps to Blender `+X/+Z/-Y` because the imported hm08 body faces `-Y`.

Declarative cinematic geometry sources may now name `productionRigProfilePath`. Campaign construction validates that the profile maps the complete source skeleton, scene fingerprints include the profile bytes, and the Blender backend generates the MPFB/Rigify human and transfers the ordinary canonical scene motion while preserving semantic entity transforms. The direct fixture at `work/characters/production-rig-scene-integration/scene.json` proves that the normal cinematic renderer—not only the specialist comparison script—can render the full rig. Its contact sheet remains visually rejected: backend integration does not supply accepted identity, skin material, hair, wardrobe, grounding for every motion class, or naturalistic motion. Do not use a nude foundation render as a substitute for a finished campaign character.

The canonical mapping is an interchange and diagnostic route, not the only permissible performance authority. `scripts/blender/render_native_rigify_walk_probe.py` is an explicit experimental alternative that creates the MPFB/Rigify body and keys animator-facing Rigify root, torso, arm, IK-foot, pole, heel, spin, and toe controls directly. It does not load a canonical motion clip or write the 52 mapped controls. Its first rendered walk remains rejected: direct controls expose the required authoring surface but do not manufacture a natural performance. Keep resulting actions Blender-native and clearly labelled experimental until a source-provenanced action, evaluated contact/deformation gates, and multi-view visual review accept them. A CC0 Quaternius locomotion subset is the next candidate input to retarget and bake onto this full rig; the canonical derivative then becomes companion metadata rather than the production action source.

`scripts/blender/render_cc0_rigify_action_reel.py` is the first source-provenanced experiment on that path. It imports the immutable `Universal Animation Library[Standard].zip` source workspace (official CC0 archive, SHA-256 `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`), retains the source armature only for evaluation, and bakes selected source torso, limb, hand, finger, toe, and root channels onto native Rigify FK controls. It never reads a Videoer canonical motion asset. The mapping is source-specific control adaptation, not a canonical interchange asset, and the source mannequin is explicitly hidden from evidence renders. The first walk, jog, and interaction MP4s are deliberately `experimental-not-accepted`: they prove the provider-free MPFB/Rigify action pipeline and expose remaining posture, arm-carriage, contact, and wardrobe work. Do not publish these actions to the reusable library until the source adapter has complete animated-channel coverage, independent contact/continuity gates, an accepted clothed multi-view review, and source-free baked-action playback verification.

The reel exposes a `VIDEOER_CC0_REEL_MODE` selector over three retarget bakes, developed in that order:

- `ik-end-effectors` (default, v1): drives Rigify IK hand/foot targets from source end-effector world positions. Grounds the feet but leaves the torso and arms at rest, so the body reads as a stiff mannequin sliding along a walk path.
- `world-fk` (v12): retargets every mapped bone's world-space rotation delta onto Rigify FK controls plus the scaled world root travel. This strides and grounds the legs but splays the arms out horizontally, because the arm chain's source/target bone-axis conventions differ enough that a world-space delta mis-orients them.
- `local-fk-grounded` (v13): local-space FK rotation deltas + the world-space metre-scaled root translation that grounds the feet. Grounds the body and strides the legs, but the arms sit in a bent-up "guard" in front of the chest.
- `rest-compensated` (v14): rest-pose-compensated rotation transfer, `T_pose = T_rest · S_rest⁻¹ · S_pose` per bone — the textbook fix for two rigs with different rest poses. Marginally cleaner arm world-orientation than v13, but the arms still stay in the same bent-up guard through the whole cycle.

**Honest status of the arms (unsolved).** Watched across the full 41-frame cycle, all four modes leave the arms in a bent-up guard posture that never opens into a natural swing. When four different retarget formulations (IK, world-FK, local-FK, rest-compensated) fail the *same* way, the cause is almost certainly not the retarget math — it is most likely the source clip's own stylised game-engine arm carriage, or something in the arm/hand skin binding. Another rotation-space tweak will not fix it. Do not add a v15 retarget mode chasing this; that is the rabbit hole.

**Side-to-side, diagnosed.** `rootTravel` for the Walk_Loop is `[0, 1.78, 0]` — dead-straight forward, zero lateral drift. The weaving in the evidence MP4 is the render camera being glued to the root (cancelling that forward travel) plus torso yaw, not a motion defect. A fixed or path-tracking camera that lets the forward travel read would remove it. Cheap presentation fix, separate from the arm problem.

**Where this leaves the experiment.** The pipeline is proven (source-provenanced CC0 action → grounded native Rigify bake), and legs/grounding/forward-travel are good. The arm carriage is the remaining blocker and is not a quick retarget fix. Under [ADR 072](adr/072-pragmatic-production-realignment.md) this stays `experimental-not-accepted` and nothing depends on it, so the right move is to **stop here** rather than grind. When a real campaign needs a walking character, the higher-value paths to weigh are: (a) try a different, less stylised source walk clip or animation library; (b) use Videoer's own canonical procedural gait, which has no cross-rig mismatch and was rejected only for weight/foot-roll/silhouette, not broken arms; or (c) accept the CC0 legs and hand-correct only the arm carriage. Do not pursue any of these speculatively ahead of a shot that needs them.

Blender 4.5 stores imported FBX takes in action slots. The adapter must select both the source action and its object slot before sampling; action-only selection evaluates the rest pose and creates a frozen movie. Frozen MP4s are rejected evidence even when their duration and codec are valid. The repair is covered by frame-separated video review, not by the encoding check alone.

The reel accepts an optional production-character binding after its body geometry, source FBX, and output directory. That binding is the look-selection boundary: it chooses the exact body, Rigify profile, skin material, hair, and one or more independently hashed wardrobe assets. The adapter verifies each selected component and lets `production_character_assembly.py` weight-transfer it to the one generated Rigify armature; a stale asset hash rejects the render. This enables a deterministic `model + look + action` selection without embedding campaign wardrobe choices in the motion importer. The reverified ordinary-scene binding is a working dress-and-hair preview only. Future looks must add separate, versioned tops, trousers, jackets, outerwear, shoes, and formal/casual garment families with their own static and temporal acceptance evidence; they must not overwrite that baseline dress.

Current evidence is deliberately rejected, but the earlier adapter, lateral-base, and deformed/open-hand defects are no longer the primary reason. V22 preserves Rigify control translations, keeps bilateral elbow angles within 1.17 degrees of the canonical clip, travels in the body's authored forward direction, and passes evaluated heel/forefoot gates for heel strike, flat support, toe-off, and swing. It retains at least 86.1 mm evaluated sole separation, 14.4 mm anatomical-side margin, and 1.17 support-root transfer without repeating v19's 1.32–1.38 overshoot. The reusable walking-hand v3 layer curls four fingers into palm depth and opposes the thumb; Rigify preserves finger flexion within 2.39 degrees and thumb distance ratio within 0.046 error. Phase-gait v3 adds a measured 0.0625-cycle global thorax delay instead of exact inverted synchronization. Five-view renders still read as posed, with mannequin-like arm carriage, narrow frontal tracking/apparent hip sway, and insufficient loading/release. A mature rig fixes deformation/control capability, not the authored gait. Do not claim success based on rig generation alone.

The reduced template's deformation gate is rotation-invariant and temporally dense. It samples 32 gait phases and detects a triangle inversion relative to coherently oriented posed edge-neighbours; comparing posed normals directly to bind-space normals is invalid because rigid rotation alone can cross ninety degrees. This audit exposed one mirrored shoulder collapse and one thumb-base fold that the old eight-phase gate aliased. Deterministic topology-neighbour smoothing is restricted to the reduced upper-arm/clavicle/spine and hand/thumb chains, records its parameters in geometry metadata, and lets v13 retain the authored hand pose with zero local inversion events. MPFB/Rigify continues to use its own full authored weights.

For the reduced production template, contact witnesses are derived from the final rigidly owned outsole surface rather than MakeHuman heel/toe helper centres. The generator and verifier share the same heel/forefoot region definition. This repaired the false 15.9 mm leading-heel gap without relaxing the 12 mm acceptance threshold; the v4 probe measures about 8.1 mm at initial heel contact and keeps toe-off and swing clearance valid. This is mechanical acceptance of contact semantics, not visual acceptance of the walk.

## Audit an existing character

```bash
npm run video -- character inspect-anatomy path/to/geometry.json \
  --output path/to/anatomy-report.json
```

The command exits with status 2 when the body fails. It measures:

- a single closed manifold body surface;
- the complete canonical skeleton and anatomical attachments;
- multi-bone coverage at 19 torso, shoulder, arm, wrist, hip, leg, ankle, and toe zones;
- geometry ownership by the head, hands, feet, and toes;
- raised-arm, bent-elbow, and bent-knee area preservation using the asset's declared skinning mode.

## Render deformation evidence

```bash
npm run video -- motion create-walk work/character/verification/walk/motion.json --style neutral
npm run video -- motion probe work/character/geometry.json \
  work/character/verification/walk/motion.json \
  --output work/character/verification/walk
```

Inspect the canonical contact sheet, face close-up, turntable, side gait, and three-quarter gait. A character review must bind those live files plus geometry and mechanical reports by SHA-256.

Required qualitative dimensions are topology continuity, deformation mechanics, body proportions, joint contours, hands, feet, face, hair, silhouette, motion naturalism, and material response. Any failed dimension forces `rejected` and concrete repair instructions. Changing any evidence file makes the review stale.

Hands additionally use a focused six-artifact review binding geometry, the live mechanical report, bilateral rest close-ups, and bilateral flexion close-ups. It separately grades anthropometric proportions, palm/wrist topology, finger silhouette, thumb opposition, flexion deformation, and knuckle/nail landmarks. The current v2 hand rejection is stored at `campaigns/reference-cinematic-benchmark/work/characters/production-human-articulated-v0.2.0/verification/hand-visual-review.json`.

Faces use a focused seven-artifact review binding geometry, the live mechanical report, neutral front and three-quarter views, smile, jaw-open, and blink. It grades identity differentiation, cranium/jaw/chin, eyes/brows/lids, nose/cheeks, lips/oral cavity, expression deformation, and skin/landmark response. The current v2 face rejection is stored at `campaigns/reference-cinematic-benchmark/work/characters/production-human-articulated-v0.2.0/verification/face-visual-review.json`; the iteration record is in `docs/research/character-face.md`.

The current production-human foundation review is intentionally rejected at:

`campaigns/reference-cinematic-benchmark/work/characters/production-human-foundation-v1/verification/visual-review.json`

## Extension rules

- Preserve the canonical core joint IDs so existing motions and interactions remain retargetable.
- Finger and facial extensions may add bones or morphs; do not encode them in campaign-specific code.
- Articulated hands require bilateral close-ups plus finger ownership, blending, and flexion evidence; a palm blob or hidden finger rig is a rejection.
- New topology must pass the same renderer-independent anatomy audit before visual review.
- Implement a declared skinning mode in every claimed renderer adapter; never silently fall back to rigid or linear skinning.
- Keep clothing and hair separable reusable assets. Do not fuse wardrobe into the body merely to make one campaign render.
- Do not publish `production-human-anatomy` or mark a character `verified` while its current hash-bound visual review is rejected.
