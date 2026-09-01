# Steering Check: AAA-Inspired Character Production Pipeline

Continue pursuing the existing autonomous cinematic production-system goal.
This is a **cautionary steering instruction**, not a replacement goal.

Before making architectural changes, inspect the current character/humanoid implementation, existing ADRs, current progress notes, and any work already underway.
The first task is to determine whether the system is **already moving toward the production-character architecture described below**.

Do not duplicate working infrastructure.
Do not rewrite or replace existing systems merely because this instruction uses different terminology.
If the current implementation already satisfies a requirement, document that fact and continue from the largest remaining quality gap.

---

## Why This Check Exists

The current procedural humanoid has successfully proved several foundational capabilities:

- programmatic human geometry
- skeleton/rig integration
- animation
- rendering
- verification
- iterative visual improvement

The current model is still visibly crude, but that is not itself evidence that the architecture is wrong.
It may simply be an early proxy or blockout.

Before changing direction, determine whether the current system already distinguishes between:

1. proxy / motion-test geometry
2. reusable production humanoid topology
3. character-specific appearance
4. clothing/hair/material layers
5. stable skeleton and reusable motion

If it already does, do not create parallel systems.

---

## Architectural Question to Answer First

Inspect the current system and explicitly answer:

> Is the current humanoid intended to be the final production character representation, or is it already functioning as a proxy/blockout that will eventually drive a higher-quality reusable production mesh?

Also determine whether the current architecture already includes or plans:

- a canonical human base mesh
- reusable topology
- a canonical humanoid skeleton
- reusable skin weights
- morph targets / body-shape parameters
- face-shape parameters
- corrective morphs
- modular clothing
- modular hair
- reusable materials
- animation retargeting
- IK / interaction constraints
- reusable motion layers

Record the answer in the existing progress/architecture documentation.

---

## If The Current Architecture Already Supports This Direction

If the project is already converging on the architecture below:

- preserve it
- do not create replacements
- identify the largest visible deficiency
- continue improving through the existing abstractions

For example, if a canonical mesh and morph system already exist but the face is crude, improve the face system.
If the skeleton is already stable but shoulder deformation is poor, improve weighting/correctives.
If clothing is already modular, do not invent a second wardrobe system.

---

## If The Current Architecture Does Not Support This Direction

Then evolve it toward an AAA-inspired production-character pipeline.

The goal is **not** to recreate a AAA studio workflow or depend on manual artist labour.
The goal is to adopt the reusable engineering principles that make high-quality game/cinematic characters scalable.

---

## Core Principle

Do not generate every production character from geometric primitives from scratch.

Use procedural primitives where they are useful for:

- blockouts
- proxy bodies
- rig tests
- proportions
- collision
- animation testing

For final reusable characters, prefer a stable production-oriented representation such as:

```text
canonical base human
+
body morphs
+
face morphs
+
skin weights
+
materials
+
hair
+
clothing
+
animation
```

---

## Character Representation Layers

### 1. Proxy / Motion Body

Purpose:

- gait development
- IK
- interactions
- animation validation
- collision/contact testing

This representation may remain visually crude.

Do not waste excessive effort making the proxy photorealistic.

### 2. Production Base Human

Purpose:

- reusable deformation topology
- skinning
- morph targets
- character derivation
- clothing fitting
- higher-quality rendering

This should eventually have clean, reusable topology appropriate for:

- shoulders
- elbows
- wrists
- hips
- knees
- eyes
- mouth
- jaw
- nose
- facial deformation

The production base should be project-owned or use a dependency that is legally suitable and architecturally replaceable.

### 3. Character Instance

A specific character should primarily be derived from reusable systems:

```text
base mesh
+
body parameters
+
face parameters
+
skin/material
+
hair
+
wardrobe
+
accessories
```

Do not require a completely new human topology for every campaign character unless there is a compelling reason.

---

## Canonical Skeleton

Check whether the project already has a stable canonical humanoid skeleton.

If it does, preserve it unless there is a demonstrated structural defect.
If it does not, establish one.

The skeleton should eventually support:

- root
- hips
- spine
- chest
- neck
- head
- clavicles
- upper arms
- forearms
- hands
- thighs
- shins
- feet
- toes

Consider support bones where useful:

- forearm twist
- upper-arm twist
- thigh twist
- calf twist
- secondary cloth/hair bones

Do not casually mutate the skeleton between character versions.

Stable skeletons enable:

- motion reuse
- retargeting
- IK
- predictable interactions
- library growth

---

## Production Pose

Evaluate whether the production base should use an A-pose rather than a strict T-pose.

Do not change this merely because this instruction mentions it.

Test whether it materially improves:

- shoulder deformation
- clavicle behaviour
- arm weighting
- clothing fitting

Keep T-pose if it remains useful for diagnostics.

---

## Skinning

Do not rely solely on naive nearest-bone weighting if it produces poor deformation.

The long-term system should support:

- reusable base skin weights
- automatic weighting
- joint-specific corrections
- weight normalisation

Pay particular attention to:

- shoulders
- elbows
- wrists
- hips
- knees

These areas should have dedicated verification poses.

---

## Corrective Deformation

Evaluate support for corrective morphs / pose-space deformation.

Examples:

- raised-arm shoulder correction
- bent-elbow volume preservation
- hip flexion correction
- bent-knee correction

The point is not anatomical simulation.

The goal is cinematic believability.

Use targeted deformation cheats where they visibly improve output.

---

## Body Morph System

If not already present, support reusable body morph dimensions such as:

- height
- shoulder width
- torso length
- chest depth
- waist
- hip width
- arm length
- leg length
- hand scale
- foot scale
- body build

Avoid hard-coded categorical body types where continuous parameters work better.

---

## Face System

The current face should not remain merely a smooth head volume with features attached if the final system is expected to support cinematic character identity.

Check whether proper face topology / morph infrastructure already exists.

If not, evolve toward a reusable facial base with meaningful control over:

- eye size
- eye spacing
- brow height
- cheek volume
- jaw width
- jaw taper
- chin
- nose length
- nose width
- mouth width
- lip shape
- forehead

Do not attempt to model every pore geometrically.

Use geometry for form and materials/normal maps for surface detail.

---

## Facial Verification

Create or reuse consistent verification views:

```text
front
three-quarter
profile
close-up
```

For identity-critical characters, also compare against accepted reference evidence.

Do not accept a character merely because the mesh is structurally valid.

---

## Hair

Check whether hair is already modular.

If not, treat it as a separate reusable asset category.

Prefer manageable techniques initially:

- mesh hair
- cards
- strips
- grouped hair masses

Add more expensive strand/groom systems only when justified.

Hair assets should support reuse across characters/campaigns where appropriate.

---

## Clothing

Check whether the clothing work currently underway already follows a modular system.

If yes, preserve it.

The preferred model is:

```text
base character
+
garment assets
```

rather than:

```text
new fused body mesh for each outfit
```

Garments should become reusable library inventory.

Useful garment metadata may include:

- compatible skeleton/body
- fit parameters
- material
- length
- sleeve style
- simulation settings

---

## Materials

Continue treating materials as reusable production assets.

Character quality should increasingly come from:

- proper normals
- roughness variation
- skin shading
- cloth response
- specular control
- microdetail

Do not compensate for every visual deficiency by adding geometry.

---

## Animation Architecture

Check whether the motion system already separates:

- locomotion
- upper-body action
- gaze
- IK
- additive posture
- secondary motion

If it does, continue using it.
If not, evolve toward layered motion.

Examples:

```text
walk
+
look-left

walk
+
hold-book

idle
+
raise-sword
```

Avoid one monolithic animation for every combination.

---

## Motion Retargeting

The character system should eventually allow a motion authored once to be applied to multiple compatible characters.

Retargeting should account for:

- limb lengths
- height
- stride scale
- root motion
- foot contact

Do not rebuild identical animations for every character.

---

## Shot-Distance Quality Strategy

Do not demand close-up digital-human quality from every asset.

Introduce or preserve a quality strategy based on intended shot distance.

For example:

```text
background character
medium character
hero character
close-up character
```

Use more expensive:

- geometry
- facial detail
- material detail
- deformation polish

only where the shot requires it.

The benchmark target is short-form cinematic video, not feature-film digital doubles.

---

## Verification Philosophy

For every meaningful improvement:

```text
implement
↓
render canonical probes
↓
inspect
↓
identify largest visible defect
↓
fix
↓
repeat
```

Verification should include both:

- structural checks
- visual checks

Do not accept a character because the mesh validates.
Do not reject a useful architecture merely because an early proxy looks ugly.

---

## Required Verification Set

Maintain or create reusable verification fixtures for:

```text
neutral pose
A-pose/T-pose
arms raised
elbows bent
knees bent
walk
turn
reach
close face
three-quarter face
clothed character
```

These should be deterministic and easy for Codex to inspect.

---

## Library Behaviour

Once a character, garment, material, hair asset, or motion reaches an accepted quality level:

- publish it to the reusable asset library
- preserve provenance
- preserve versioning
- record verification status

Prefer:

```text
reuse
↓
adapt
↓
create new
```

---

## Avoid These Failure Modes

Do not:

- rebuild the humanoid pipeline if the current one already implements these principles
- treat the proxy mannequin as final production topology by accident
- generate completely new topology for every human without a reason
- let character-specific hacks leak into generic rig code
- casually change the canonical skeleton
- fuse every outfit permanently into the body
- optimise the entire system around the current benchmark heroine
- spend excessive time polishing invisible details
- chase photorealism before deformation, silhouette, motion, and continuity work

---

## Immediate Deliverable

Before making major changes, produce a concise assessment in the project progress documentation:

```text
AAA-inspired production-character pipeline assessment
Already implemented:
- ...
Partially implemented:
- ...
Missing:
- ...
Current largest visual blocker:
- ...
Recommended next change:
- ...
```

Then continue implementation using the existing architecture wherever possible.

---

## Completion Condition For This Steering Check

This steering task is complete when:

1. the current humanoid architecture has been inspected
2. duplication has been avoided
3. the current proxy-vs-production strategy is explicit
4. canonical skeleton strategy is explicit
5. production mesh/topology strategy is explicit
6. morph strategy is explicit
7. clothing/hair/material reuse strategy is explicit
8. animation layering/retargeting strategy is explicit
9. verification strategy is explicit
10. the next implementation step targets the largest real quality gap

Then resume the broader autonomous cinematic production goal.

This wording gives Codex permission to say, effectively, **“already doing this, carry on”** rather than interpreting the steer as an order to raze its current work and erect `HumanPipeline2FinalFinal`. It also forces it to document where the current implementation actually sits, which should make the next few hours of logs much easier to interpret.
