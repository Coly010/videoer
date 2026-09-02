# ADR 076: Blender-native cloth system on the production human

## Status

Accepted.

## Context

The production human is MPFB (hm08 CC0) + Rigify ([ADR 074](074-mpfb-rigify-is-the-production-human.md)),
animated by CC0 actions retargeted with Expy Kit ([ADR 075](075-expykit-humanoid-retargeting.md)).
Clothing on that human needs to look believable and stay coherent over the walk/jog.

[ADR 030](030-renderer-independent-temporal-clothing.md)'s renderer-independent CPU cloth (a
project-owned solver + corrective baker targeting the retired canonical skeleton) is superseded for
this path by [ADR 072](072-pragmatic-production-realignment.md): the human, its rig, its motion and
its render are all Blender-native, so cloth should orchestrate Blender's own tools rather than run a
bespoke solver. A tooling survey ([`docs/research/cloth-system-design.md`](../research/cloth-system-design.md))
confirmed the licence-clean, headless, commercial-OK options are Blender's **built-in Cloth
modifier** (simulation) and **MPFB's `ClothesService`** (fitting); the paid sewing addons (Cloth
Weaver, Garment Tool, Simply Cloth) are UI-only and were rejected.

## Decision

A Blender-native cloth system, `scripts/blender/render_cloth_walk.py`, parametrized by
`GARMENT_SPECS`. It builds the MPFB/Rigify body + Expy Kit walk, generates a garment, simulates/
deforms it over the walk headlessly and deterministically, runs a headless mechanical gate, and
renders side/three-quarter contact-sheet evidence. Three garment classes on one pipeline:

- **Fitted** (tight, moves with skin): duplicate the relevant body *surface* region, offset slightly,
  transfer the body's Rigify weights, armature-deform. No sim — rock-stable. (crop top, jeans,
  trousers, shirt, sweater, pyjama top.)
- **Loose** (drapes/swings): Cloth modifier over the body-as-Collision, with the waistband/collar
  armature-locked to a stable bone hoop and a gradient pin fading to a free hem that drapes. (mini
  skirt hem, tie, pyjama bottoms, dress skirt.)
- **Hybrid**: fitted upper + loose hem/sleeves (dress = fitted bodice + loose skirt).

Key hard-won details (see the script and its commits): the garment must be **generated from the
body surface** (exact topology, no shrinkwrap seam collapse); loose garments must be **armature-
locked to a stable hoop** (never to the independently-swinging thighs, which tears the mesh); the
Blender **disk point-cache must be invalidated per bake** (a stale cache silently ignores parameter
changes); and the fitting cross-section must **exclude the arms/hands** (which hang at waist height
in the A-pose rest and get encircled).

### Verification

Mechanical gate (headless, over the whole walk) + visual contact-sheet review; "cloth works" =
mechanical gate passes **and** the render reads as its fabric (finished output is the highest
surface, per ADR 072). The gate checks: no NaN, bbox explosion < 1.5, inter-frame velocity,
body-penetration (< 2% clip / < 5% frame), waistband anchor drift (loose only), self-intersection,
and **bulk percentile edge-strain**. Edge-strain is deliberately percentile-based, not a single-edge
hard max (inherited from ADR 030's CPU *corrective* cloth): free-simulated fabric has invisible
local stretch spikes at pinned seams, so the gate judges the 99th/1st percentile (is the bulk near
rest?) plus a blow-up catch that only fires on genuine solver explosions. The p99 bound is
**garment-class-aware** — fitted/anchored fabric < 1.6, free-swinging hems < 1.9 — because a free
hem physically stretches more at peak stride; both are validated against the rendered contact
sheets.

### Determinism

Blender's cloth solver has no RNG; reproducibility comes from pinned Blender 4.5 LTS,
`--factory-startup`, fixed substeps/collision quality, a fixed pre-roll + frame window, and the
identical garment mesh + baked body motion. Cross-platform bit-identity is neither guaranteed nor
required (ADR 072); reruns are cheap and the point-cache is invalidated per bake.

## Verified garments and outfits (on the Expy Kit `Walk_Loop`)

Every garment across the five required outfits passes the mechanical gate and was visually confirmed
on the walking rig; two multi-garment outfits were assembled and verified together. Evidence lives
under the git-ignored `work/characters/production-rig-scene-integration/cloth-{v1,phase2,phase3}/`.

- **Fitted (armature-deformed body-surface garments), full 9/9 gate pass:** crop top, jeans,
  trousers, shirt, sweater, pyjama top, pyjama bottoms, tie.
- **Loose / hybrid (cloth-simulated), gate pass:** mini skirt (hybrid; free hem drapes and swings)
  and dress (hybrid two-piece — fitted bodice conforming to the torso with zero penetration + a
  cloth-simulated flared skirt on the pelvis-hoop path).
- **Assembled multi-garment outfits (several garments on one walking body, shared body collider):**
  sweater + jeans; shirt + tie + trousers — each garment passes its gate together and the layers
  read coherently.

Honest quality notes (mechanical pass is necessary, not sufficient): the fitted garments and the
dress read well; the mini skirt is believable but slightly stiff; the tie is a stable centred chest
placket. Full flowing loose garments (loose pyjama bottoms as free tubes, a free-swinging tie) were
tried and were unstable/unconvincing, so those garments use the reliable fitted route — the right
call where drape is not essential (they hang close to the body). Loose cloth sim is reserved for
where it genuinely adds value (skirt, dress).

## Supersedes / relates to

- **Supersedes [ADR 030](030-renderer-independent-temporal-clothing.md)** for the production cloth
  path (the CPU solver/corrective baker is retired; its *values and ideas* — strain thresholds,
  garment-region tags, hem weighting — were salvaged into the gate and the generator).
- Builds on ADR 074 (MPFB/Rigify human) and ADR 075 (Expy Kit motion).

## Not now (deferred per ADR 072)

Wiring cloth into the declarative cinematic-campaign pipeline as a resolvable wardrobe input, MPFB
`ClothesService` + a pinned CC0 MHCLO pack for structured garments (the procedural generator covers
the current outfits licence-clean), and full multi-character/in-context validation — do these when
a campaign needs a clothed walking character.
