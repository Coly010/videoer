# Current state

Short-form context for a new agent session. For durable policy, read
[`docs/product-principles.md`](product-principles.md) first; this document is a snapshot, not
policy.

## What Videoer is

A local-first, CLI-first toolkit for producing short (10–20s, 9:16) marketing videos, operated by
Codex or a human through a stable TypeScript API/CLI. It is not a renderer-independent graphics
engine; it is an editorial/production tool that picks whichever technique makes a shot convincing.

## Production paths that exist today

- **Ordinary storyboard path** (`campaign.yaml` + `storyboard.json`, Remotion + PixiJS rendering).
  Covers kinetic-text, cover-reveal, image-motion, `scene`/layered-2D VFX, `scene-keyframes`, and
  image-to-video shots. No 3D involved. This is what `projects/the-rise-of-demons` uses end to end.
- **Declarative cinematic-campaign path** (`cinematic-campaign.yaml`, Blender-backed). Covers
  physical characters/environments, simulated cloth/VFX, camera moves through 3D space, spoken
  performance. `campaigns/reference-cinematic-benchmark` is its worked example/fixture, not a gate.
- Both paths render through the same edit/verification/inspection layer and can be mixed in one
  campaign at the shot level.

## Tools in use

| Tool | Role | Status |
| --- | --- | --- |
| Remotion + React | Timeline, final composition, 2D layers, delivery encode | Stable, load-bearing |
| PixiJS/WebGL | Dense 2D particles/procedural VFX behind the scene registry | Stable |
| FFmpeg-full | Diagnostics, probing, frame extraction, contact sheets, delivery codecs | Stable, required |
| Blender 4.5 + MPFB/Rigify | Headless 3D geometry, rigging, simulation, rendering for the cinematic path | Stable for the shots it's used on. **MPFB (hm08 CC0) + Rigify is the production human (ADR 074)**; the project-owned body/skeleton is retired. |
| Expy Kit (GPL, pinned) | Retargets CC0 Unreal-Mannequin actions onto the Rigify production human (ADR 075) | Adopted. Produces a natural full-body walk (arms solved) and generalises across the CC0 clip library. Not yet wired into the declarative campaign pipeline (follow-up when a campaign needs a walking character). |
| MPFB ClothesService + pinned CC0 MakeHuman garment packs + `render_cloth_walk.py` (Blender Cloth retained for simulated hems) | Production wardrobe on the walking human (ADR 077, supersedes ADR 076's garment sourcing): real CC0 `.mhclo` garments fitted via MPFB, armature-deformed; the earlier procedural fitted/loose/hybrid generator is now a fallback (no cleared asset) and the only route to a simulated, swinging hem | Adopted. Four outfits verified 2026-09-03 on `Walk_Loop`: `mh-suit-boots` passes the mechanical gate; `mh-sweater-wool-boots`, `mh-halter-dress-boots`, `mh-tshirt-harem-boots` render clean at 1024 px but each fails one small localized poke-through/hidden-skin check. Clearance record: 56 approved / 1 review-required / 7 rejected (AGPL-quarantined) of 64 garments across 6 pinned packs (sha256+size verified at install and again at load time). Not yet wired into the campaign pipeline (follow-up). |
| eSpeak NG | Deterministic speech audio + native phoneme timing for lip sync | Stable |
| Three.js | Structural geometry/skeleton/morph conversion utility (`src/renderers/three-geometry.ts`), not a rendering backend | Decided (ADR 073): kept as a devDependency/test-only utility; not a production dependency. No `three-3d` backend exists or is planned unless a concrete need (e.g. live in-browser preview) appears. |
| Poly Haven / ambientCG source adapters | Import CC0/licence-clear materials and HDR environments | Stable |
| Shared asset library (`library/`) | Optional, immutable versioned reuse for assets worth publishing | Stable, optional — not required for any campaign to ship |

## How Codex chooses between paths

See [`docs/codex/trailer-workflow.md`](codex/trailer-workflow.md): pick the cheapest credible
technique per shot, mix techniques within a campaign, inspect the whole finished draft (not each
subsystem), and switch strategy after two failed attempts at the same fix rather than iterating
indefinitely or adding another abstraction layer.

## Stable

Campaign/storyboard schemas, Remotion rendering, provider boundaries, verification/inspection
architecture, render revision history and selective regeneration, the scene/PixiJS VFX layer,
scene-keyframes, the declarative cinematic-campaign builder, the shared asset library's
publish/audit/repair mechanics (used only when reuse is worth it), speech/lip-sync via eSpeak NG,
Blender render profiles (fixed-seed Cycles CPU authoritative, Eevee Next preview-only).

## Deprecated for production (ADR 074)

The project-owned human — the procedural continuous body mesh (`geometry production-human` /
`createProductionTemplateHuman`), the canonical 52-joint production skeleton, and the
research-grounded procedural gait — is retired as a production target. The production human is
MPFB's hm08 CC0 mesh + a Rigify rig. This code is still in the tree (the benchmark uses it) and was
not removed when the direction was set; a later migration removes or repoints it. Do not build new
human characters the owned way.

## Experimental / R&D

Human motion via Expy Kit (`scripts/blender/render_expykit_action_reel.py`, ADR 075) now produces a
good full-body walk but is not yet wired into the declarative campaign pipeline, and clothed /
multi-character / full-campaign validation is still to do (when a campaign needs it). The hand-rolled
retarget modes in `render_cc0_rigify_action_reel.py` are superseded. Also still around but superseded
by ADR 074: continuous-body face/hand topology and the frozen human gait synthesis
(`docs/research/character-face.md`, `character-retopology.md`, `human-gait.md`).

## Known weak points (from the last subsystem scorecard, now a secondary diagnostic — see
[`docs/quality-model.md`](quality-model.md))

Production-character fidelity (face, hands, gait) and clothing/hair temporal fidelity are the
weakest links in the Blender cinematic path. Camera grammar above raw paths and an accountable
audio-mix review are also flagged as incomplete. None of this blocks shipping a campaign that
doesn't need photoreal hero characters — `projects/the-rise-of-demons` shipped without touching any
of it.

## What should be improved next

See the final section of the [migration report](migration-report-2026-09-02.md) for the three
recommended next tasks.

## What should not be rebuilt

Do not re-architect the renderer-independent geometry/material/motion/clothing/lighting/audio
contracts to "finish" cross-renderer portability — that portability is not required (ADR 072). Do
not invest further in the project-owned human body, canonical production skeleton, or procedural
gait — they are retired in favour of MPFB/Rigify (ADR 074); the only human work worth doing is on
the MPFB/Rigify path, and only when a campaign needs it. Do not build a `three-3d` rendering backend
speculatively — Three.js's role is decided (ADR 073):
a conversion-utility test dependency, not a backend, unless a concrete need like live in-browser
preview appears.
