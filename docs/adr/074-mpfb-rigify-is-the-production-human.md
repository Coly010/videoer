# ADR 074: MPFB (hm08 CC0) + Rigify is the production human; retire Videoer's own body and skeleton

## Status

Accepted. Direction-setting; no code removed yet (see "Not now" below).

## Context

[ADR 020](020-character-skeleton-motion.md) established a *project-owned* human: a procedural
continuous body mesh plus a canonical 52-joint skeleton and canonical motion, with MPFB/Rigify
demoted to "a backend adapter." Everything human — `geometry production-human`,
`createProductionTemplateHuman`, the canonical skeleton, the research-grounded procedural gait
([ADR 024](024-research-grounded-phase-motion-synthesis.md)) — was built around that owned
representation.

In practice it has never reached production quality. Across ~20 iterations the owned body is
blobby, the face and hands are weak, and the gait reads as a mannequin — it is the persistently
`blocked`, visually-rejected weak link in the cinematic path (see
`docs/progress/cinematic-system.md` and the last subsystem scorecard).

The CC0→Rigify experiments render the **same** hm08 CC0 base through MPFB's *full* mesh and a
Rigify rig, and the body is dramatically higher quality than the reduced project-owned version (see
the `cc0-rigify-walk-*` evidence under
`work/characters/production-rig-scene-integration/`). MPFB (MakeHuman) and Rigify are mature,
maintained, licence-clean (CC0 assets / GPL tooling) systems that already solve mesh, rig, and
skinning far better than a project-owned reimplementation ever has here.

Per [`docs/product-principles.md`](../product-principles.md) and
[ADR 072](072-pragmatic-production-realignment.md): orchestrate mature production software rather
than recreate it; a project-owned substitute needs a strong concrete reason to exist. For the human
model and rig, the reason now runs the other way — the owned version is strictly the worse copy of
the same base.

## Decision

**The production human is MPFB's hm08 CC0 mesh + a Rigify rig. Everything that needs a human
character points there.**

- Videoer's *own* human model — the procedural continuous body / production-template mesh produced
  by `geometry production-human` and `createProductionTemplateHuman` — and its canonical 52-joint
  *production* skeleton are **retired as production targets**. They are no longer "the character";
  the MPFB body + Rigify rig is.
- Human motion is authored against the **Rigify rig** (native actions — e.g. the source-provenanced
  CC0 bake path in `scripts/blender/render_cc0_rigify_action_reel.py`), not against a project-owned
  skeleton.
- All human-character documentation, examples, and guidance point at MPFB/Rigify as the default and
  only recommended production human.

This is applying, not contradicting, the pragmatic-tooling policy: the human is now a tool-native
representation (MPFB mesh + Rigify rig + native actions), exactly like `cinematic-3d → Blender`.

## Not now (deliberately deferred)

The user's instruction was to set direction, not to fix or delete anything today. Accordingly:

- **No code is removed or repointed in this ADR.** `geometry production-human`,
  `createProductionTemplateHuman`, the canonical skeleton, and the procedural gait remain in the
  tree, marked deprecated-for-production, so existing campaigns and tests keep working unchanged.
- The **removal/repointing migration** — deleting or repointing the owned-human code, moving the
  reference benchmark onto the MPFB/Rigify human, and deciding each call site — is a follow-up
  task, done when a campaign needs a production human or when someone picks up the cleanup.
- The MPFB/Rigify **motion is still unsolved** (the arm carriage; see `docs/characters.md`). This
  ADR is about the model + rig *direction*, not a claim the walking performance is finished.

## What this supersedes / narrows

- **[ADR 020](020-character-skeleton-motion.md):** its core decision — "the project-owned body and
  canonical skeleton are the production character" — is superseded. (ADR 072 had already narrowed
  its renderer-independence framing; this replaces the human target outright.)
- **[ADR 024](024-research-grounded-phase-motion-synthesis.md) and the canonical-motion
  interchange:** demoted. Human gait/performance targets the Rigify rig. Whether the canonical
  skeleton survives *only* as an optional motion-authoring interchange is an explicitly **open,
  deferred question**; either way it is no longer the character's rig.
- Character-related mentions in [ADR 025](025-articulated-prop-interactions.md),
  [ADR 030](030-renderer-independent-temporal-clothing.md), and
  [ADR 039](039-first-class-modular-hair.md) that assume the owned skeleton should, at migration
  time, be read against the Rigify rig instead. Not rewritten now.

## Consequences

- New human-character work points at MPFB/Rigify. `docs/characters.md`, `docs/architecture.md`, and
  `docs/current-state.md` are updated to lead with it and mark the owned human deprecated.
- The owned human mesh, canonical production skeleton, and procedural gait become
  deprecated-for-production, retained temporarily so the existing benchmark still renders.
- No behaviour changes and no tests change in this step, because only documentation and this ADR
  are edited. The heavy lifting is a later, separate migration.
