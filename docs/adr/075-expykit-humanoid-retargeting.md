# ADR 075: Retarget CC0 actions onto the production human with Expy Kit, not hand-rolled math

## Status

Accepted.

## Context

[ADR 074](074-mpfb-rigify-is-the-production-human.md) made MPFB (hm08 CC0) + Rigify the production
human. Its motion is authored by baking CC0 mocap-style actions (the Quaternius Universal Animation
Library, CC0 1.0, on the Unreal-Engine Mannequin skeleton) onto the Rigify rig.

The first four attempts baked those actions with **hand-rolled retarget math** (IK end-effectors,
world-space FK, local-space FK, rest-pose-compensated) in
`scripts/blender/render_cc0_rigify_action_reel.py`. All four produced a broken bent-up "guard" arm
posture. This was misdiagnosed for a while as the source clip's fault; direct measurement
(`docs/research/animation-approach-evaluation.md`) refuted that — the source arms are a good natural
swing and Rigify's own FK arms hang correctly. The guard was manufactured by the hand-rolled
cross-rig transfer, which never correctly reconciled the Quaternius↔Rigify arm rest pose and
bone-roll.

Two validated spikes fixed it (see `work/characters/production-rig-scene-integration/spikeA-*`,
`spikeB-*`): **Expy Kit**, a maintained GPL retargeting addon that ships the exact
`Unreal_Mannequin → Rigify_Controls` preset pair, produced a natural full-body walk (arms and body)
that preserves the mocap performance; a dependency-free native-FK arm-correction produced a good but
walk-only, more mechanical result.

Per [`docs/product-principles.md`](../product-principles.md) / [ADR 072](072-pragmatic-production-realignment.md):
orchestrate a mature tool rather than reinvent it, and don't keep grinding hand-rolled math.

## Decision

Adopt **Expy Kit** (GitHub `pKrime/Expy-Kit`, v0.6.1, commit
`3c4d5d7b8b9aa585e9e304f6b9ed35c2690238ae`, GPL) as the humanoid-retargeting tool for the production
human. It is pinned and installed by `scripts/install-expykit-extension.sh` into the git-ignored
repo-local `.venv-blender/expy_kit`, mirroring how MPFB is a pinned, verified, licence-clean Blender
dependency ([ADR 023](023-licensing-dependency-policy.md)). The install script registers it
headlessly as its capability check.

`scripts/blender/render_expykit_action_reel.py` is the durable retarget path: it creates the
MPFB/Rigify human, constrains `Rigify_Controls` to the `Unreal_Mannequin` source with
`match_transform='Bone'`, drives the source action + slot, and bakes with `nla.bake` (the addon's
own headless bake left the source at rest, so we bake directly — a documented gotcha). It
generalises to the whole CC0 clip library via env `VIDEOER_EXPYKIT_ACTIONS`.

The hand-rolled retarget modes in `render_cc0_rigify_action_reel.py` are **superseded** by this and
retained only as history; do not add new hand-rolled retarget modes.

## Scope / not now

This adopts the retargeting *tool and script*. Wiring Expy-Kit-retargeted actions into the
declarative cinematic-campaign pipeline as a resolvable character-motion input, and clothed /
multi-character / full-campaign validation, remain follow-ups to do when a campaign needs a walking
character — not built speculatively (ADR 072). Provider-free/local-first is preserved: Expy Kit is a
local GPL addon; Mixamo (online Adobe service) was rejected for violating that constraint.

## Consequences

- Human motion is now produced by a mature retarget tool; the arm blocker is solved.
- A new pinned GPL Blender dependency exists, installed and verified like MPFB; recorded in the
  README system requirements and the install steps.
- Existing campaigns and tests are unaffected (this is a Blender-side script + install; no TS
  behaviour changes). The hand-rolled reel remains present but superseded.
