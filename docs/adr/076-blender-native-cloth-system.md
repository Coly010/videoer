# ADR 076: Blender-native cloth system on the production human

## Status

Accepted — garment sourcing superseded by [ADR 077](077-cc0-mhclo-garments-are-the-production-wardrobe.md);
the mechanical gate, three-view evidence and the loose/hybrid cloth-sim class remain current.

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
renders side / rear three-quarter / front three-quarter contact-sheet evidence. Three garment
classes on one pipeline:

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

The 2026-09-03 re-verification (adding a front view) found four more, each of which had let the
first build pass its gate while looking wrong:

- **Freeze the body's shape keys on a fitted duplicate.** The MPFB human is a Basis plus macro-target
  shape keys, and a mesh with shape keys evaluates from the key data, not from `vertex.co`; the
  outward `surface_offset_m` written into the duplicated surface was silently ignored and every
  fitted garment rendered exactly *on* the skin (0.0 mm), z-fighting with it. The "body breaking
  through the trousers/pyjamas/sweater" was this. The Basis also differs from the rendered mix by
  up to ~10 cm, so all fitting reads the shape-key-mixed rest body, never `vertex.co`.
- **Mirror the body's armature stack.** MPFB/Rigify deforms the body through a linear Armature
  modifier plus a preserve-volume one applied as a multi-modifier blend masked by
  `mhmask-preserve-volume`; a garment with a single preserve-volume modifier bends its joints
  differently. The garment copies the stack modifier-for-modifier and deforms identically.
- **Name the helper deform bones in the region.** MPFB's `DEF-knee-helper` / `DEF-pelvis-helper` /
  `DEF-shoulder-helper` and Rigify's `DEF-spine.001` dominate the skin at the knees, hip crests and
  lower belly; a region of only the obvious limb bones cut a skin-coloured band out of every knee
  and a ragged waistband.
- **Cut the skirt waistband to the body's profile, not a circle.** The loose skirts used a circle of
  the maximum hip radius per ring; on the elliptical pelvis that left ~10 cm of air front and back —
  the "big ring floating around the waist" — and let the pinned waistband sit 13–15 cm off the
  body. Rings now follow the body's per-angle outer profile (plus clearance) and relax to round only
  towards the hem; waistband drift fell to ~2.5 cm.

**Superseded as the primary wardrobe source by [ADR 077](077-cc0-mhclo-garments-are-the-production-wardrobe.md).**
The fitted/loose/hybrid procedural classes above generate a garment by duplicating the body surface
itself, offsetting it outward and adding a Solidify shell — every garment they produce follows every
hollow and inflates every convexity of the underlying body, so even a garment that passes every check
below reads as an inflated body in a wetsuit, not as separately authored clothing. Where a cleared CC0
`.mhclo` asset exists, ADR 077's `assemble_and_render_mhclo_outfit` path is now the production route;
this procedural system is retained as the fallback for garments with no cleared asset, and remains the
only route to a genuinely simulated, swinging hem (every `.mhclo` garment is armature-only).

### Verification

Mechanical gate (headless, over the whole walk) + visual contact-sheet review; "cloth works" =
mechanical gate passes **and** the render reads as its fabric (finished output is the highest
surface, per ADR 072). The gate checks: no NaN, bbox explosion < 1.5, inter-frame velocity,
garment-into-body penetration (< 2% clip / < 5% frame), **body-through-garment poke-through**,
waistband anchor drift (loose only, < 6 cm), self-intersection, and **bulk percentile edge-strain**.
Edge-strain is deliberately percentile-based, not a single-edge hard max (inherited from ADR 030's
CPU *corrective* cloth): free-simulated fabric has invisible local stretch spikes at pinned seams,
so the gate judges the 99th/1st percentile (is the bulk near rest?) plus a blow-up catch that only
fires on genuine solver explosions. The p99 bound is **garment-class-aware** — fitted/anchored
fabric < 1.6, free-swinging hems < 1.9 — because a free hem physically stretches more at peak
stride; both are validated against the rendered contact sheets.

**Poke-through is the check the eye makes** and was missing: penetration only asks whether garment
*vertices* are inside the body, which is ~0 even when a body face pushes out between them (the
first knee patches passed at 0.0). The new check casts a ray inward from every skin vertex the
garment covers (its own body region — never a hand or foot swinging past); meeting the garment
within 2.5 cm while still inside the body means the fabric is under the skin there. Bound on the
worst frame: fitted < 0.5% (a handful of sub-5 mm vertices fold into the back-of-knee/groin
creases at peak stride without showing; a real patch is 1–5%), simulated hems < 2%. Every failing
check is also written into the report's `notes` in plain words ("BODY BREAKS THROUGH THE GARMENT
… do not accept until fixed"), so a mechanical fail is never silent.

**Three views, including the front.** The retargeted walks travel along +Y, so the original
"three-quarter" camera on the −Y side was a *rear* three-quarter: it never showed the tie, the
skirt front or the face. Evidence is now rendered from `side`, `three-quarter` (rear) and
`three-quarter-reverse` (the walker approaches the camera) — stills, mp4 and contact sheet each —
by the shared `render_expykit_action_reel.fixed_camera` helper, which derives "ahead" from the
root's travel sign rather than assuming it.

### Determinism

Blender's cloth solver has no RNG; reproducibility comes from pinned Blender 4.5 LTS,
`--factory-startup`, fixed substeps/collision quality, a fixed pre-roll + frame window, and the
identical garment mesh + baked body motion. Cross-platform bit-identity is neither guaranteed nor
required (ADR 072); reruns are cheap and the point-cache is invalidated per bake.

## Verified garments and outfits (on the Expy Kit `Walk_Loop`)

Re-verified 2026-09-03 with the three-view evidence and the poke-through gate, all from one code
state. Every garment and both outfits pass; each was also looked at from the front. Evidence lives
under the git-ignored `work/characters/production-rig-scene-integration/cloth-phase4/<name>/`
(`*-cloth-report.json`, `*-cloth-{side,three-quarter,three-quarter-reverse}.mp4` + contact
sheets, stills at the first/mid/last frame). The earlier `cloth-{v1,phase2,phase3}` evidence is
superseded: those garments sat on the skin and those skirts floated (see the four findings above).

| garment / outfit component | class | body poke-through (worst frame) | garment-into-body (clip) | waistband drift | edge p99 |
|---|---|---|---|---|---|
| crop top | fitted | 0.00% | 0.00% | – | 1.11 |
| jeans | fitted | 0.00% | 0.00% | – | 1.38 |
| trousers | fitted | 0.00% | 0.00% | – | 1.40 |
| shirt | fitted | 0.06% | 0.11% | – | 1.18 |
| sweater | fitted | 0.12% | 0.10% | – | 1.20 |
| pyjama top | fitted | 0.18% | 0.10% | – | 1.19 |
| pyjama bottoms | fitted | 0.00% | 0.00% | – | 1.43 |
| tie | fitted | 0.00% | 0.00% | – | 1.07 |
| mini skirt | loose (hybrid) | 0.00% | 0.00% | 2.5 cm | 1.09 |
| dress: bodice + skirt | hybrid two-piece | 0.00% / 0.00% | 0.10% / 0.01% | 3.3 cm | 1.19 / 1.26 |
| sweater + jeans | outfit | 0.12% / 0.00% | 0.10% / 0.00% | – | 1.20 / 1.38 |
| shirt + tie + trousers | outfit | 0.06% / 0.00% / 0.00% | 0.11% / 0.00% / 0.00% | – | 1.18 / 1.08 / 1.40 |

Bounds: poke-through < 0.5% fitted / < 2% loose; penetration < 2%; drift < 6 cm; edge p99 < 1.6
fitted / < 1.9 loose.

Honest quality notes (mechanical pass is necessary, not sufficient):

- **Fitted garments now stand off the skin** and read as clothes with volume (the sweater as a bulky
  knit, the pyjama bottoms as loose lounge pants); no knee or waistband holes; the tie is visible
  from the front and lies flat over the shirt in the outfit. The crop top reads as a bandeau-style
  top. Where the hanging arm presses the sleeve into the torso side the fabric genuinely
  interpenetrates the body (and the inner thighs likewise as the legs pass); that skin is occluded
  by the limb itself and is excluded from the gate as such — it is a known limitation of the fitted
  class, not a fixed one. The swinging hand's fingers clip into the hip of the trousers/skirt at
  peak stride: a motion-contact issue of the retargeted walk, outside the garment gate.
- **The mini skirt and dress skirt are cut to the waist** and hang from it (drift 2.5 / 3.3 cm,
  was 13–15 cm); the free hem drapes and swings over the legs and reads as fabric. The dress bodice
  conforms to the torso with zero poke-through.
- Full flowing loose garments (loose pyjama bottoms as free tubes, a free-swinging tie) were tried
  earlier and were unstable/unconvincing, so those garments use the reliable fitted route — the
  right call where drape is not essential. Loose cloth sim is reserved for where it genuinely adds
  value (skirt, dress).

## Supersedes / relates to

- **Supersedes [ADR 030](030-renderer-independent-temporal-clothing.md)** for the production cloth
  path (the CPU solver/corrective baker is retired; its *values and ideas* — strain thresholds,
  garment-region tags, hem weighting — were salvaged into the gate and the generator).
- Builds on ADR 074 (MPFB/Rigify human) and ADR 075 (Expy Kit motion).
- **Superseded (garment sourcing only) by [ADR 077](077-cc0-mhclo-garments-are-the-production-wardrobe.md)**,
  which adopts CC0 MakeHuman `.mhclo` garments fitted via MPFB's `ClothesService` as the production
  wardrobe; this ADR's mechanical gate, three-view evidence, report/notes convention, and the
  loose/hybrid cloth-sim class carry over unchanged and are reused by ADR 077's `mhclo` outfits.

## Not now (deferred per ADR 072)

Wiring cloth into the declarative cinematic-campaign pipeline as a resolvable wardrobe input, and full
multi-character/in-context validation — do these when a campaign needs a clothed walking character.
The MHCLO deferral in the previous revision of this section — "MPFB `ClothesService` + a pinned CC0
MHCLO pack for structured garments" — is discharged by [ADR 077](077-cc0-mhclo-garments-are-the-production-wardrobe.md),
which pins six CC0 packs, records their clearance, and fits them onto this same production human.
