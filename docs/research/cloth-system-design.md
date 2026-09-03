# Cloth system design (Blender-native)

Status: research / recommended design. No production code changed by this document.

## Goal

A cloth system that produces believable garments on the production human — MPFB (hm08 CC0)
mesh + Rigify rig ([ADR 074](../adr/074-mpfb-rigify-is-the-production-human.md)) — animated by
Expy-Kit-retargeted CC0 walk/jog actions
([ADR 075](../adr/075-expykit-humanoid-retargeting.md)). It must run headless via
`blender --background --python`, be reproducible enough to cache, and be verified mechanically
**and** visually across the walk cycle for these outfits: **dress; pyjamas; shirt + tie +
trousers; mini skirt + crop top; sweater + jeans**.

## Policy fit

This is squarely inside [`docs/product-principles.md`](../product-principles.md): "orchestrate
mature production software (… cloth …) rather than recreate it." [ADR 030](../adr/030-renderer-independent-temporal-clothing.md)'s
renderer-independent CPU cloth is **narrowed by ADR 072** — Blender-native cloth is now the
recommended path, because the human, its rig, its motion, and its render are already all
Blender-native. We keep useful *values* from the old system (thresholds, garment-region tags,
the drape weight formula) but replace the CPU solver/corrective-baker with Blender's Cloth
modifier. Determinism is "valuable where it pays for itself" — we pin the tool and settings and
content-address the bake, not chase byte-identity.

## What we verified before designing

All facts below were confirmed on the machine, not from memory:

- **Blender 4.5.13 LTS** is the installed/pinned renderer; its Cloth API was introspected directly
  (see "Verified Cloth API").
- **MPFB 2.0.17** (already installed, [`scripts/install-mpfb-extension.sh`](../../scripts/install-mpfb-extension.sh))
  exposes a headless **`ClothesService`** with `fit_clothes_to_human(...)` and an
  **`AssetService.list_mhclo_assets()`** — i.e. MakeHuman's clothes system is scriptable
  headless. **But the pinned install ships zero garment assets** (`list_mhclo_assets()` → 0); a
  CC0 MakeHuman clothes pack must be added to use it.
- A **throwaway proof** (`scratchpad/proof_skirt_settle.py`) draped a procedurally generated,
  waist-pinned skirt (2,880 verts) over the real static MPFB body (19,158 verts) as a Collision
  object and baked a 45-frame settle **headless in 12 s**: **zero NaN**, bbox explosion ratio
  **1.11** (stable), and it correctly **failed** the penetration gate (worst 11.3% of skirt verts
  inside the body). That failure is the expected consequence of a naive un-fitted drop and is the
  reason the design below initialises garments *outside* the body and pre-rolls a settle. The
  headless bake + metric harness itself works and the gate has teeth.

## Recommended architecture

```
MPFB hm08 body + Rigify rig  ──(Expy Kit)──►  baked walk/jog action  ──► animated body
        │                                                                     │
        │ (Collision modifier: thickness_outer, cloth_friction)               │
        ▼                                                                     ▼
   garment mesh (procedural from body  OR  MPFB-fitted MHCLO)          per-frame collider
        │
        ├─ FITTED garments  → armature deform (weight-transfer from body) → follow the body
        └─ LOOSE garments   → Cloth modifier (pinned vertex group) → simulate + bake point cache
                                     │
                                     ▼
        headless verification (NaN / explosion / penetration / anchor / self-intersect / strain)
                                     │
                                     ▼
             visual contact sheets (side + 3/4 across the walk cycle)  → pass/fail gate
```

Two garment classes, one pipeline:

- **Fitted** (tight, moves with skin): duplicate/generate the mesh, transfer Rigify deform
  weights from the body (the existing `production_character_assembly.transfer_body_weights` BVH +
  barycentric transfer already does exactly this), bind an Armature modifier. No sim. Cheap,
  rock-stable. Use the [`drape.ts`](../../src/clothing/drape.ts) hem/pelvis weight idea for
  hybrid hems.
- **Loose** (drapes, swings): Cloth modifier over the body-as-Collision, pinned at the waistband/
  shoulders via a vertex group, pre-rolled to settle, then baked over the walk. This is the new
  work.
- **Hybrid**: fitted bodice/upper + simulated skirt/hem/sleeves (dress, sweater, pyjama top,
  wide trousers). The fitted part is armature-deformed; the loose part is cloth, pinned to the
  fitted seam.

### Verified Cloth API (Blender 4.5.13, introspected)

`object.modifiers.new(name, 'CLOTH')` → `mod.settings` (`ClothSettings`) and
`mod.collision_settings` (`ClothCollisionSettings`); the body gets `modifiers.new(name,'COLLISION')`
→ `body.collision` (`CollisionSettings`). Key properties and the values this design uses:

| Setting | Property | Default | Use |
|---|---|---|---|
| Sim substeps (quality) | `settings.quality` (int) | 5 | **8–10** for stability/determinism |
| Mass | `settings.mass` | 0.30 | ~0.3 (denim heavier, silk lighter) |
| Stiffness | `settings.tension_/compression_/shear_/bending_stiffness` | 15/15/5/0.5 | stiff denim vs soft knit |
| Bending model | `settings.bending_model` | `ANGULAR` | keep ANGULAR (more accurate than LINEAR) |
| Air damping | `settings.air_damping` | 1.0 | 1.0 |
| **Pin group** | `settings.vertex_group_mass` + `settings.pin_stiffness` | `""` / 1.0 | waistband/shoulders held |
| Spatial stiffness | `settings.vertex_group_structural_stiffness` / `_bending` | `""` | stiff waistband, soft hem |
| Internal springs | `settings.use_internal_springs` + `vertex_group_intern` | off | volume for thick sweaters |
| Pressure | `settings.use_pressure` / `uniform_pressure_force` | off | optional puffiness |
| Rest shape | `settings.rest_shape_key` | None | drape from a pre-shaped rest |
| Object collision | `collision_settings.use_collision` / `collision_quality` / `distance_min` | on / 2 / 0.015 | **quality 6–8**, distance ~0.005 |
| **Anti-explosion** | `collision_settings.impulse_clamp` / `self_impulse_clamp` | 0 / 0 | **set 4–10** to cap impulses |
| Self-collision | `collision_settings.use_self_collision` / `self_distance_min` | off / 0.015 | **on** for skirts/dresses |
| Collider limit | `collision_settings.collection` | None | point at a body-only collection (perf) |
| Body collider | `body.collision.thickness_outer` / `.thickness_inner` / `.cloth_friction` | 0.0 / 0.0 / 0.0 | **set ~0.008 / 0.02 / 5** |
| Bake window | `mod.point_cache.frame_start/frame_end/use_disk_cache` | 0/0/off | fixed window + disk cache |

Bake headless with a context override on `bpy.ops.ptcache.bake(bake=True)`, or step
`scene.frame_set(f)` across the window and read `obj.evaluated_get(depsgraph)` (the proof used
stepping). Prefer `use_disk_cache=True` so the bake persists and can be content-addressed.

### Determinism & reproducibility

Blender's cloth solver has **no RNG seed** — it is deterministic given identical inputs. Reproducible
runs require: pinned **Blender 4.5.x LTS**, `--factory-startup`, fixed `quality` (substeps) and
`collision_quality`, a fixed pre-roll + frame window, the identical garment mesh, and the identical
baked body motion. Cross-version / cross-platform *bit*-identity is not guaranteed (floating point)
and is not required by policy — output stays inspectable and reruns are cheap (12 s for the proof).
Cache the point cache + `report.json`, content-addressed by `SHA256(garment mesh) +
SHA256(body+motion) + SHA256(sim settings)`, mirroring [ADR 030](../adr/030-renderer-independent-temporal-clothing.md)'s
cache discipline but over the Blender bake instead of a CPU derivation.

### Stability pitfalls and how this design avoids them

- **Explosion / NaN** — raise `quality` (substeps); set `impulse_clamp`/`self_impulse_clamp`
  (4–10); keep stiffness moderate; ANGULAR bending. (Proof: ratio 1.11, no NaN.)
- **Tunneling / penetration** — the biggest risk under a fast walk. Mitigations, all in the plan:
  (1) **initialise the garment outside the body** (shrinkwrap-OUT with clearance, or generate from
  body normals + offset) so it never starts interpenetrating; (2) higher `collision_quality`;
  (3) body `thickness_outer` ~0.008; (4) a **pre-roll settle** (hold the first walk pose ~20–40
  frames) before the motion begins. The proof's 11.3% penetration came from skipping (1)+(4) — a
  deliberately naive drop — which is exactly what the gate flags.
- **Self-collapse of folds** — enable self-collision with `self_distance_min` (loose garments only;
  it is expensive, so scope it with the collider collection).
- **Pin popping** — `pin_stiffness` plus a soft anchor; keep waistband stiff via
  `vertex_group_structural_stiffness`.

## Garment sourcing plan (all outfits)

The brief lists five outfits comprising these garments. Each is tagged **Fitted** (weight-transfer,
deforms with body), **Loose** (cloth-sim), or **Hybrid** (fitted part + simulated part), with a
sourcing route.

| Garment | Class | Source | Notes |
|---|---|---|---|
| Crop top | Fitted | Procedural (torso region → shrinkwrap-out → solidify) | tight; armature deform |
| Shirt | Hybrid | MPFB MHCLO (`shirts01`, CC0) or procedural | fitted body, simulate open hem/cuffs |
| Tie | Loose | Procedural strip pinned at collar | light cloth, swings |
| Trousers | Fitted (+sim cuffs) | MPFB MHCLO (`pants01`, CC0) or procedural | tailored = fitted; wide = hybrid |
| Jeans | Fitted | MPFB MHCLO (`pants01`, CC0) or procedural | stiff denim, close fit, minimal sim |
| Sweater | Hybrid | Procedural (knit) | high bending; simulate hem/sleeves; internal springs |
| Mini skirt | Loose | Procedural (hip cross-section, as in the proof) | pinned waistband; self-collision |
| Dress | Hybrid | Procedural bodice + skirt, or MPFB `dress01` (CC0) | bodice fitted, skirt cloth pinned at waist |
| Pyjama top | Hybrid | Procedural | loose fit, light sim |
| Pyjama bottoms | Loose | Procedural (leg tubes, drawstring waist pin) | soft, low stiffness |

**Recommended sourcing, in priority order (revised by [ADR 077](../adr/077-cc0-mhclo-garments-are-the-production-wardrobe.md),**
**Phase 5 below — this flips the original priority order once real assets were fitted and compared**
**against the procedural output):**

1. **MPFB `ClothesService`/`HumanService.add_mhclo_asset` + six pinned CC0 MakeHuman clothes packs**
   — *primary*. `shirts01`, `pants01`, `dress01`, `skirts01`, `shoes01`, `suits01` are pinned by URL,
   byte size, and sha256 (`scripts/install-makehuman-clothes-packs.sh`) and licence-scanned into a
   committed clearance record (`scripts/blender/mhclo_asset_manifest.py`): 56 of 64 garments
   approved. Fitting is headless and fast (~1 s/garment) and produces artist-modelled garments that
   touch the body at support points and bridge concavities — the procedural class below cannot do
   either, because it duplicates the body surface itself. Caveats now known from actually fitting all
   64: many assets are authored to MPFB's HELPER geometry and reference zero skin vertices (coverage
   must be computed spatially, never from the asset's own vertex list); 10 of 64 ship no delete group
   and need one generated; inter-garment layering ignores the asset's `z_depth` field entirely; and
   licence metadata disagrees within single assets often enough that the more-restrictive-wins rule is
   load-bearing, not a formality. See ADR 077 for the full pipeline and every fix.
2. **Procedural generation from the hm08 body** — *fallback*, used only where no cleared CC0 asset
   exists for a needed garment, and the only route to a genuinely simulated, swinging hem (every
   fitted `.mhclo` garment is armature-only). Select a torso/leg vertex region on the CC0 body,
   duplicate, shrinkwrap outward with clearance, solidify, offset; derive the waistband/shoulder pin
   group from the top ring. Fully **licence-clean** (a derivative of CC0 hm08), controllable,
   headless, no downloads. Its output reads as an inflated body rather than separately authored
   clothing (ADR 077's Context), which is exactly why it is no longer the primary route.
3. **Other CC0 garment packs** — *fallback only*; each needs per-asset licence verification and
   retopo/fit work. Lower priority; the first two cover the outfits verified so far.

Fitted garments reuse the existing, proven
[`production_character_assembly.transfer_body_weights`](../../scripts/blender/production_character_assembly.py)
(BVH nearest + barycentric weight transfer from the MPFB body to the garment) — no new skinning code.

## Tooling options (third-party addon survey)

Licence + commercial-use terms were web-checked (Sept 2026), not recalled. Hard requirement:
commercial use OK **and** headless-scriptable **and** licence-clean.

| Tool | Licence / cost | Commercial | Headless | Verdict |
|---|---|---|---|---|
| **Blender Cloth modifier** (built-in) | GPL, free | Yes | **Yes** (fully scripted; proof) | **Adopt — baseline simulator** |
| **MPFB `ClothesService`** + CC0 MakeHuman clothes packs | GPL tool / **CC0** assets | Yes | **Yes** (`fit_clothes_to_human`) | **Adopt — garment fitting/sourcing** (add a pinned CC0 pack) |
| Bystedt's Cloth Builder | Free (Gumroad); code GPL, **asset licence unstated** | Likely | UI-oriented, doubtful headless | Don't adopt; **borrow** its GeoNodes thickness/seam + vertex-group presets idea |
| Cloth Weaver | **Paid ~$39**, perpetual | Yes | UI-only | Flag paid; not needed |
| Garment Tool (Styperek) | **Paid ~$40** (business tier > $140k rev) | Yes | UI-only (2D-pattern sewing) | Flag paid; not needed |
| Simply Cloth Studio / Pro | **Paid ~$170** full commercial | Yes | UI-only | Flag paid; not needed |

**Recommendation:** adopt **Blender's built-in Cloth modifier** (simulation) + **MPFB's clothes
system** (fitting/sourcing) — both free/GPL-or-CC0, commercial-OK, headless, and *already
installed*. No paid addon is worth adopting: the three sewing/cloth addons are all UI-first (poor
headless fit) and paid, so none delivers the batch, provider-free, licence-clean win we need — the
"orchestrate a mature tool" win here is **MPFB's clothes system**, the direct analogue of the Expy
Kit retargeting win. Bystedt's free addon is UI-oriented too; take its *ideas* (Geometry-Nodes
thickness/seams, vertex-group-driven cloth presets) into our own scripts rather than the addon.

## Phased build plan

Start with **one garment end-to-end on the walk**, then generalise. Do not build all outfits or the
pipeline integration speculatively (ADR 072).

- **Phase 0 — spike (done).** Confirm the 4.5 Cloth API, headless bake, and metric harness on the
  real MPFB body. Delivered by `scratchpad/proof_skirt_settle.py` (12 s; stable; gate discriminates).
- **Phase 1 — ONE garment, the mini skirt, on the Expy Kit walk.** Chosen because it is pure loose
  sim (clearest cloth win) and procedural (extends the proof). Build:
  1. MPFB/Rigify body + baked `Walk_Loop` action (reuse `render_expykit_action_reel.py`).
  2. Procedurally generate the skirt from the hip cross-section; **shrinkwrap-out with clearance**
     so it starts outside the body; derive + pin the waistband vertex group.
  3. Body → Collision modifier (`thickness_outer` ~0.008, `cloth_friction` 5).
  4. Cloth on the skirt (`quality` 8–10, `collision_quality` 6, self-collision on, `impulse_clamp`).
  5. **Pre-roll** ~20–40 static settle frames at the first walk pose, then simulate through the
     walk; bake to disk cache.
  6. Run the headless verification gate + render side/three-quarter contact sheets (reuse
     `contact_sheet()` / `fixed_camera()`).
  New durable script (e.g. `scripts/blender/render_cloth_walk.py`) + `report.json`; evidence under
  `work/characters/.../cloth-v1/`. Target: mechanical gate passes and the contact sheet reads as
  fabric.
- **Phase 2 — fitted + hybrid garments.** Add the fitted route (crop top, jeans, trousers) via
  `transfer_body_weights`, and the first hybrid (dress: fitted bodice + simulated skirt pinned at
  the waist seam). Add the MPFB `ClothesService` path with a pinned CC0 clothes pack for structured
  garments.
- **Phase 3 — all outfits + layering.** Remaining outfits including multi-garment layers
  (shirt + tie + trousers): several cloth objects colliding via a shared collider collection +
  inter-garment collision. Per-garment fabric presets (denim stiff, knit soft, silk light). Run the
  full gate across walk **and** jog; produce per-outfit contact sheets; do the visual acceptance
  review that binds the evidence by hash.
- **Phase 4 — caching + pipeline integration (only when a campaign needs it).** Content-address the
  point-cache bake by garment+body+motion+settings hash; expose clothing as a resolvable wardrobe
  input in the cinematic pipeline. Deferred per ADR 072.
- **Phase 5 — CC0 `.mhclo` production wardrobe ([ADR 077](../adr/077-cc0-mhclo-garments-are-the-production-wardrobe.md), done).**
  Pinned six CC0 MakeHuman clothes packs (`shirts01`, `pants01`, `dress01`, `skirts01`, `shoes01`,
  `suits01`; sha256 + byte size) and licence-scanned all 64 garments into a committed clearance
  record. Fitted real garments via `HumanService.add_mhclo_asset` for four multi-garment outfits on
  the same Expy Kit walk, computing skin coverage spatially (many assets fit MPFB's HELPER geometry,
  not skin), generating delete groups where none shipped, resolving inner/outer garment overlap with
  a proximity-limited clearance push, and taming MakeSkin's Bump node. Ran the same mechanical gate
  plus a new hidden-skin-boundary-coverage check and an informational inter-garment clearance check.
  Result: one of four outfits (`mh-suit-boots`) passes the mechanical gate outright; the other three
  read clean at 1024 px but each fails one small, localized poke-through/hidden-skin check. This
  supersedes item 1 of the sourcing priority above (MPFB `ClothesService` is now primary), demoting
  procedural generation to a fallback for garments with no cleared asset and the only route to a
  simulated hem.

## Headless verification

All mechanical checks run without a render, over the baked cache; the visual check is a contact
sheet. "Cloth works" = **mechanical gate passes AND visual review accepts** — mechanical pass is
necessary but not sufficient (echoing [ADR 030](../adr/030-renderer-independent-temporal-clothing.md)
and [`docs/characters.md`](../characters.md); finished output is the highest surface).

Mechanical gate (per garment, over the whole walk; thresholds tunable per garment class, seeded
from the old [`temporal.ts`](../../src/clothing/temporal.ts) values):

- **NaN/inf** on any garment vertex, any frame → FAIL.
- **Bbox explosion**: garment world-bbox diagonal ÷ rest diagonal > **1.5** → FAIL (proof: 1.11).
- **Max inter-frame vertex velocity** > a body-height fraction/frame → FAIL (catches launches).
- **Body penetration**: BVH of the body per frame, fraction of garment verts inside (signed
  distance < −tolerance) **< 2% over the clip and < 5% on any single frame** → else FAIL
  (proof's naive skirt hit 11.3% → correctly FAILED).
- **Body poke-through (body → garment)**: for every skin vertex under the garment, cast a ray
  *inward* along the skin normal; meeting the garment within ~2.5 cm means the fabric is under the
  skin there — the body has broken through and skin shows. Gated on the worst frame: **~0 for
  fitted** (a fitted garment deforms identically to the skin, so any poke-through is a defect),
  **< 2% for simulated hems** (brief collision misses over fast legs). This is the check the eye
  makes; the garment-into-body penetration check above misses a body *face* pushing out between
  garment vertices, which is exactly what the knee/shoulder skin patches on the first fitted
  trousers/sweater were (their penetration fractions were ~0). A failing poke-through is written
  into the report's `notes` in plain words so it is never silent.
- **Anchor drift**: pinned waistband/shoulder verts stay within tolerance of their fitted position
  relative to the body → keeps the garment on. The waistband is cut to the body's own cross-section
  profile (not a circle of the maximum hip radius), so the bound is tight (6 cm).
- **Self-intersection sampling**: sample non-adjacent garment vertex pairs closer than
  `self_distance_min` → catches collapse (sampled to stay cheap).
- **Edge strain**: local edge stretch ≤ **1.35×**, compression ≥ **0.65×** (reused thresholds) →
  catches solver blow-ups and over-stretch.

Visual: N-frame contact sheets across the walk cycle from **three fixed views** — side, rear
three-quarter (the walker recedes; back of the garments) and **front three-quarter**
(`three-quarter-reverse`: the walker approaches the camera, so the face, chest, tie and skirt/dress
front are judged) — reusing the Expy Kit reel's fixed-camera + `contact_sheet` helpers, reviewed for
silhouette, fold quality, no poke-through, and whether the drape reads as its fabric — folded into
the finished-video review. The retargeted walks travel along +Y, so the original single
three-quarter camera on the −Y side only ever saw the back; the front view is what caught the
floating skirt waistbands and the never-visible tie.

## Reuse assessment of the retired clothing code

`src/clothing/*` targets the **retired canonical 52-joint skeleton / project-owned body**, so it is
not directly runnable and the CPU solver/corrective-baker is superseded by Blender's cloth solver.
Salvage the *values and ideas*, not the code:

- [`temporal.ts`](../../src/clothing/temporal.ts): verification thresholds (collision depth,
  silhouette expansion, edge stretch/compression, adjacent-frame delta) → seed the mechanical gate.
- [`drape.ts`](../../src/clothing/drape.ts): the hem pelvis-vs-thigh weight formula → hybrid-hem
  weighting for fitted skirts/dresses.
- [`adaptation.ts`](../../src/clothing/adaptation.ts) / [`production-dress.ts`](../../src/clothing/production-dress.ts):
  garment-region tagging (fitted-bodice vs flared-skirt with per-region distance budgets) and the
  cross-section / superellipse extrusion idea → the procedural garment generator.

The scene-integration harness reuses cleanly as-is: `resolveBlenderExecutable()` +
`execFile('--background --python …')`, the `render_geometry_probe` scene/mesh helpers,
`render_expykit_action_reel`'s body build + camera/contact-sheet helpers, and
`production_character_assembly.transfer_body_weights` for fitted garments.
