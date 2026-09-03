# ADR 077: CC0 MakeHuman `.mhclo` garments fitted with MPFB's ClothesService are the production wardrobe

## Status

Accepted. Supersedes [ADR 076](076-blender-native-cloth-system.md)'s garment-**sourcing** decision
only; ADR 076's mechanical gate, three-view evidence and the loose/hybrid cloth-sim class remain
current.

## Context

ADR 076 dressed the production human (MPFB hm08 CC0 + Rigify, [ADR 074](074-mpfb-rigify-is-the-production-human.md);
Expy-Kit-retargeted walk, [ADR 075](075-expykit-humanoid-retargeting.md)) with a **procedural fitted
class**: duplicate a body surface region, offset it outward 12–40 mm, transfer the body's Rigify
weights, armature-deform. Re-verified 2026-09-03 with a poke-through gate and three fixed camera
views, every procedural garment mechanically passed. It still read wrong: a duplicated-and-offset
surface follows every hollow and inflates every convexity in the underlying body, and the added
6–12 mm Solidify shell puts a fat lip on every hem. A body in these garments reads as an inflated
body wearing a wetsuit, not as a person wearing clothes — because it *is* the body, pushed out and
thickened, never an independently authored garment that touches at support points and bridges
concavities the way real fabric does. The user compared the renders against artist-made clothing
references and made the call: where a licence-clean, artist-modelled CC0 garment exists, use it
instead of generating one.

ADR 076 itself named this exact gap and deferred it: its "Not now" section lists "MPFB
`ClothesService` + a pinned CC0 MHCLO pack for structured garments" as future work, done only "when
a campaign needs a clothed walking character." This ADR discharges that deferral. A spike
(`spike_mhclo_walk.py`, evidence under `spike-{a,b,c,d}-*`) fitted real CC0 MakeHuman `.mhclo`
garments onto the same production human via `HumanService.add_mhclo_asset` in roughly a second per
garment, with no new skinning code: fitting happens against the shape-key MIX (the actual macro body
Rigify renders), body weights interpolate automatically onto the garment (DEF-\* plus helper bones),
and the garments deformed correctly through the whole Expy Kit walk. This is the same
orchestrate-a-mature-tool policy (`docs/product-principles.md`) that produced ADR 074 and ADR 075:
MPFB's clothes system, not a bespoke generator, is the mature tool for this job.

## Decision

**The production wardrobe is CC0 MakeHuman `.mhclo` garments, fitted onto the MPFB/Rigify production
human via MPFB's `ClothesService`/`HumanService.add_mhclo_asset`.** The procedural
fitted/loose/hybrid generator from ADR 076 becomes a **fallback**: used only where no cleared CC0
asset exists, and retained as the *only* route to a genuinely simulated, swinging hem (an `.mhclo`
garment is armature-only).

Pipeline, end to end:

1. **Install the packs.** `scripts/install-makehuman-clothes-packs.sh` downloads, byte-size- and
   sha256-verifies, and extracts six pinned CC0 MakeHuman Community asset packs (`shirts01`,
   `pants01`, `dress01`, `skirts01`, `shoes01`, `suits01`; ~237 MiB total) into
   `${VIDEOER_MH_CLOTHES_ROOT:-work/sources/makehuman-cc0-clothes-packs-v1}` (git-ignored), then runs
   the clearance scanner's `--check` as a drift gate against the committed record.
2. **Clearance record.** `scripts/blender/mhclo_asset_manifest.py` (pure Python, no `bpy`) scans
   `clothes/<name>/<name>.mhclo` + `packs/<pack>.json` across the six packs (64 garments) and writes a
   deterministic, content-addressed licence/clearance record, committed at
   `assets/wardrobe/makehuman-cc0-clothes-packs-v1.json` (+ `assets/wardrobe/PROVENANCE.md`). Every
   asset carries two independent licence signals — the pack manifest's `license` field and the
   `.mhclo` header's own comments — and **the more restrictive of the two governs**; an unrecognised
   header licence is never treated as silence and is forced to the most-restrictive tier. Only
   `clearance: approved` assets resolve automatically, per [ADR 023](023-licensing-dependency-policy.md).
   Current result: **56 approved, 1 review-required, 7 rejected** of 64.
3. **`OUTFIT_SPECS` entries with `"kind": "mhclo"`** in `scripts/blender/render_cloth_walk.py` list an
   outfit's components **innermost first** (boots/shoes, then trousers/pants, then the layer worn over
   them). Each component is a dict: `asset` (the cleared asset name), `delete_group`
   (`"shipped"` / `"generate"` / `"extend"` / `"none"`), `erode_passes`, `clear_over` (names of earlier
   components this one must be pushed clear of), `clear_skin` (push this garment clear of skin it is
   authored too close to), `bump_strength`, and `subdiv`.
4. **Per component**, `assemble_and_render_mhclo_outfit` runs: fit via `add_mhclo_garment` (mirrors
   `HumanService.add_mhclo_asset` — fits to the shape-key mix, parents to the Rigify armature,
   interpolates DEF-\*/helper weights, MakeSkin material, Subdivision modifier) → sha256-verify the
   on-disk `.mhclo`/`.obj`/`.mhmat` against the clearance record's own digests
   (`_verify_asset_integrity`, never bypassed) → optional `clear_garment_over_skin` (push the garment
   clear of skin it pokes through) → optional `clear_outer_over_inner` against each named `clear_over`
   component (push the outer garment clear of the inner one) → spatial `garment_skin_footprint`
   (rays along the mix-normal surface, never `mhclo.verts`) → a delete group via `ensure_delete_group`
   (shipped as-is / generated from the eroded footprint / shipped-and-extended by the eroded
   footprint) → `tune_makeskin_material` (Bump Strength default 0.25) → the same mechanical gate as the
   procedural classes (`run_gate(..., garment_class="mhclo")`) → an informational
   `garment_pair_report` for every declared `clear_over` pair → three-view evidence via the shared
   `assemble_and_render_mhclo_outfit` renderer.
5. **Clearance rule (repeated at the point of use):** `CC0 < CC-BY < CC-BY-SA / CC-BY-ND < CC-BY-NC* <
   AGPL/GPL/unrecognised`; disagreement resolves to the more restrictive side; true header silence
   (no licence line at all) is not a conflict and defers to whichever side does declare one.

**What is kept from ADR 076:** the mechanical gate itself (NaN / bbox-explosion / inter-frame
velocity / garment-into-body penetration / body-through-garment poke-through / edge-strain, now with
an `mhclo`-specific deleted-skin-coverage check added), the three fixed camera views
(side / rear three-quarter / front three-quarter) and their contact sheets, the report
schema and plain-words `notes` convention, the pinned-Blender-LTS determinism discipline, and the
loose/hybrid Cloth-sim class — retained as the fallback and as the only route to a simulated,
swinging hem.

**What is retired as the primary sourcing route:** the procedural duplicate-offset-Solidify generator,
for every garment where a cleared `.mhclo` asset exists. It is not deleted; it remains available (and
its own regression outfits — `sweater`, `shirt-tie-trousers` — were re-verified unchanged, see
Verification below) for garments with no cleared CC0 equivalent.

## Hard-won details

1. **Many assets are fitted to MPFB HELPER geometry, not skin** (the skin `body` vertex group is base
   indices 0–13379): the suit, dress, boots and flats all reference zero skin vertices in their own
   `.mhclo` correspondence data. Skin coverage therefore has to be computed **spatially**
   (`garment_skin_footprint`: an outward ray 6 cm, or an inward ray 3 cm, or fabric within 5 mm,
   all along the shape-key-MIX normal), never from `mhclo.verts`. Shipped delete groups stay
   authoritative where they exist. `ClothesService.create_new_delete_group` itself is unusable here —
   it is helper-geometry-based, O(vertex-count × mesh-count), and reaches the hem.
2. **10 of 64 assets ship no delete group at all** despite covering real skin (visible skin dots at
   the shoulders/chest/waist). Fix: a generated footprint delete group, eroded with MPFB's own
   `ClothesService._conservative_mask` so the mask never reaches the hem. `extend` mode unions the
   shipped group with the eroded footprint rather than replacing it, for assets whose shipped group is
   real but under-covers.
3. **Layering ignores `z_depth`** — it is `50` on 61 of 64 assets, and Blender does not use it for
   draw order or collision anyway. A hem authored inside a waistband (both layers at the same
   `z_depth`) is fixed by `clear_outer_over_inner`: a proximity-limited push of the OUTER garment
   clear of the inner one, feathered over two one-ring passes, reach capped at 6 cm. Never a uniform
   inflate (the bulk problem this whole decision exists to remove), never masking the inner garment
   (a ragged hem), never lifting a whole open rim uniformly (a flared, sawtooth frill), never widening
   the reach past 6 cm (a 12 cm reach let a sweater hem's ray cross to the trousers' far thigh and
   push out a triangular flap at the crotch).
4. **Basis vs shape-key mix**: a garment must fit against the same evaluated mix mesh Rigify renders,
   not the Basis (`vertex.co`) — the two differ by up to ~10 cm on this body. `body_rest_surface`
   returns both coordinates and normals from the evaluated mix, and `_assert_mhclo_world_space` /
   `_assert_body_world_space` guard that both the body and every `.mhclo` fit share the rig's world
   origin so garment and skin coordinates compare directly.
5. **Nearest-point SIGN tests are undefined near a garment's own open edges.** An early attempt at
   `garment_skin_footprint` used "closest point, which side" and over-deleted a 6 cm band of skin
   beyond the halter dress's neckline and open back (45% holes); it also misreports inter-garment
   layering at open hems. Rays, not nearest-point sign tests, decide coverage and clearance
   everywhere in this pipeline.
6. **The hidden-skin gate tests only the BOUNDARY of a masked region**, against the union of every
   garment in the outfit, not just the one that hid it. A masked vertex deep inside a closed region
   (deleted toes inside a closed boot toe cap) shows nothing if uncovered — there is no visible hole —
   so it is informational only; a hole is only visible where masked skin borders un-masked skin and
   every "covered" test still misses there. Skin occluded by another body part (the crotch, an
   overlapping limb) is excluded from this test the same way it is excluded from the ordinary
   poke-through check.
7. **The garment-PAIR layering check (`garment_pair_report`) is informational only**, not gated.
   Both a nearest-sign and a ray formulation misreport at a garment's own open hem: an inner garment
   that legitimately continues below the outer garment's hem line reads as protrusion either way.
   Layering is accepted on the rendered contact sheets instead, until this is recalibrated.
8. **MPFB's `mhmask-preserve-volume` group covers the two hands only** (2880 skin vertices, two blobs
   at hip height — the fingers, in the A-pose rest) — it is not a waistband. No `.mhclo` garment in
   this wardrobe needs the preserve-volume modifier; MPFB's own single linear-blend Armature modifier
   on the clothes matches the linear stack that covers the skin they actually fit.
9. **Residual seam poke-through (skin visible a few mm outside a garment) can be pushed clear with
   `clear_garment_over_skin`** (2 mm clearance, 15 mm cap) — it fixed the halter dress's strap edge
   (12 → 5 vertices) and the harem pants (1479 vertices moved), but made the tucked t-shirt WORSE
   (1.0% → 8.3%, saturated pushes fold it — it is authored too close to the skin for a capped push to
   fix) and, on the wool pants, pushed hidden fabric outward into the sweater above it. Use it only on
   a garment whose covered skin is actually visible, and validate its effect on both the poke-through
   number and the neighbouring garment. Tuning levers, in order of preference: delete-group erosion
   passes, `clear_over` clearance, `clear_skin` — never loosen a gate bound.
10. **MakeSkin's Bump node at its shipped default (Strength 1.0) reads a knit as a net.** Every
    MakeSkin material is retuned to 0.2–0.25 by `tune_makeskin_material`.
11. **Licence metadata contradicts itself within single assets.** 7 `.mhclo` headers declare
    `# license AGPL3` against CC0 pack manifests; 1 declares CC-BY against a CC0 header; 4 have only a
    free-form author-signature line (e.g. `# Cortu Johnstone - CC0`) with no machine-readable
    `# license` key. Rule: on disagreement the more restrictive licence wins; unrecognised header
    licences and any NC modifier are always rejected, never treated as silence. Result: 56 approved /
    1 review-required / 7 rejected, all recorded machine-readably in
    `assets/wardrobe/makehuman-cc0-clothes-packs-v1.json`. The installer pins all six pack zips by
    sha256 + byte size (~237 MiB, git-ignored under `work/sources/makehuman-cc0-clothes-packs-v1/`)
    and fails on drift; every fitted asset's `.mhclo`/`.obj`/`.mhmat` is sha256-verified again at load
    time (`_verify_asset_integrity`), so pointing `VIDEOER_MH_CLOTHES_ROOT` at an unverified tree
    cannot launder an unapproved mesh under an approved name.
12. **Blender Cloth (ADR 076's loose/hybrid class) remains the only route to a swinging hem** — every
    `.mhclo` garment in this wardrobe is armature-only; nothing here simulates.
13. **Bounds were never loosened to get a pass.** Where the mechanical gate and the rendered contact
    sheet disagree, the report says so in `notes`, and the outfit is not accepted for production —
    see the sweater/t-shirt/harem-pants/dress failures below, all left as recorded mechanical
    failures rather than relaxed thresholds.

## Verification

Verified 2026-09-03 on Blender 4.5.13 LTS, MPFB 2.0.17, the Expy Kit `Walk_Loop`, 1024 px render
resolution, Subdivision level 1. Evidence:
`work/characters/production-rig-scene-integration/cloth-phase5-mhclo/<outfit>/Walk_Loop-cloth-report.json`
(+ `regression-sweater/`, `shirt-tie-trousers/` for the ADR 076 procedural regressions), contact
sheets `Walk_Loop-cloth-{side,three-quarter,three-quarter-reverse}-contact-sheet.png`.

| outfit | component | body poke-through (worst frame) | hidden-skin boundary uncovered (worst frame / boundary verts) | garment-into-body (clip) | edge p99 | delete group | status |
|---|---|---|---|---|---|---|---|
| mh-suit-boots | toigo_ankle_boots_male | 0.00% | 0.00% / 40 | 0.00% | 1.061 | shipped (2206) | pass |
| mh-suit-boots | toigo_male_suit_tie_and_jacket | 0.00% | 0.00% / 122 | 0.00% | 1.248 | shipped (3430) | pass |
| mh-sweater-wool-boots | toigo_ankle_boots_female | 0.00% (nothing to measure) | n/a (no boundary) | 0.00% | 1.067 | shipped (2166) | pass |
| mh-sweater-wool-boots | toigo_wool_pants | 0.00% | 0.00% / 58 | 0.00% | 1.341 | generated, 2 erosion passes (1148) | pass |
| mh-sweater-wool-boots | toigo_fisherman_sweater | 1.03% (7 of 41 frames, deepest 2.5 mm; bound 0.5%) | 0.00% / 120 | 0.01% | 1.206 | generated (2246); clear_over pants: 399 verts pushed, 2 saturated | FAIL |
| mh-halter-dress-boots | toigo_ankle_boots_female | 0.00% | 0.00% / 40 | 0.00% | 1.067 | shipped (2166) | pass |
| mh-halter-dress-boots | toigo_halter_dress_knee_length | 0.52% (5 persistent verts at the neck strap edge, z≈1.43 m; bound 0.5%) | 0.64% / 156 (transient; bound 0.5%) | 0.02% | 1.481 | extended (shipped 987 + footprint = 1271); clear_skin moved 800 verts | FAIL (marginal) |
| mh-tshirt-harem-boots | toigo_ankle_boots_male | 0.00% | 0.00% / 30 | 0.00% | 1.061 | shipped (2206) | pass |
| mh-tshirt-harem-boots | toigo_basic_tucked_t-shirt | 1.02% (41 of 41 frames, deepest 1.9 mm) | 0.00% / 124 | 0.00% | 1.134 | generated (1480) | FAIL |
| mh-tshirt-harem-boots | toigo_harem_pants | 1.30% (4 of 41 frames, deepest 2.1 mm) | 0.00% / 76 | 0.00% | 1.374 | extended (1305); clear_skin moved 1479 verts | FAIL |

**Outfit status: `mh-suit-boots` PASSES the mechanical gate.** The other three (`mh-sweater-wool-boots`,
`mh-halter-dress-boots`, `mh-tshirt-harem-boots`) FAIL mechanically, each on one component's
poke-through and/or hidden-skin-boundary bound, at the margins recorded above. Every component in
every outfit has `integrity: sha256-verified`, all MakeSkin textures resolved, and
`preserveVolume: not-applicable` (item 8). Garment-pair layering metrics are reported but
**informational** (`gated: false`, item 7) — the sweater-over-wool-pants pair shows a 10.3% inside
fraction and 49.7 mm depth p99, which is the open-hem misreport, not a real defect. The ADR 076
procedural regressions are unchanged by this work: the `sweater` garment alone (poke 0.12%, edge p99
1.20) and the `shirt-tie-trousers` outfit both still pass.

**Honest visual review of the 1024 px close-ups** (mechanical pass is necessary, not sufficient):

- **Suit** — clean everywhere, on both components, from all three views.
- **Sweater + wool pants + boots** — the sweater's hem genuinely drapes over the trousers front and
  back, and the knit reads as knit (not a net). One visible defect: a grey trouser patch shows through
  the knit at the hip on the side view at peak stride, because the two garments deform under
  different bones and cross each other at pose time — no rest-mesh clearance push fixes a pose-time
  crossing.
- **Halter dress + boots** — clean neckline, open back, bust and hem; the 5 poking vertices at the
  strap edge are not visible at 1024 px.
- **Tucked t-shirt + harem pants + boots** — the waistband is smooth and the tucked look reads
  correctly; a thin bare-skin strip shows between the hem and waistband at the lower back at peak
  stride; the 1.9–2.1 mm seam pokes are not visible.
- Ballet flats and the mj cloth shoes were tried and rejected before boots replaced them (toes/instep
  show through: 27% / 11% of covered skin, worst frame); `cortu_cargo_pants` was rejected (a
  211-vertex asset with a ragged waistband and a bare midriff strip above it) in favour of the harem
  pants.
- Compared with the ADR 076 procedural garments (a uniform 12–40 mm offset plus a 6–12 mm Solidify
  shell), every `.mhclo` outfit here reads as clothing worn on a body, not an inflated body — that
  visual difference is the entire point of this decision, and it holds even where the mechanical gate
  still fails on a small, localized check.

## Determinism

Same discipline as ADR 076, extended to the asset supply chain: pinned **Blender 4.5.13 LTS**,
`--factory-startup`, the pinned MPFB commit ([ADR 023](023-licensing-dependency-policy.md)), the six
CC0 pack zips pinned by sha256 + byte size and verified again by the installer's drift gate against
the committed clearance record, and every fitted asset's `.mhclo`/`.obj`/`.mhmat` re-verified by
sha256 at load time regardless of what `VIDEOER_MH_CLOTHES_ROOT` points at. Cross-platform
bit-identity is neither guaranteed nor required (ADR 072); reruns are cheap.

## Supersedes / relates to

- **Supersedes [ADR 076](076-blender-native-cloth-system.md)'s garment-sourcing decision only.** The
  mechanical gate, the three fixed camera views and contact-sheet evidence, the report/notes
  convention, and the loose/hybrid cloth-sim class are unchanged and remain current; only the
  *primary* route for structured garments changes, from procedural generation to fitted CC0 `.mhclo`
  assets. Discharges the "MPFB `ClothesService` + a pinned CC0 MHCLO pack" item from ADR 076's
  "Not now."
- Builds on [ADR 074](074-mpfb-rigify-is-the-production-human.md) (MPFB/Rigify production human),
  [ADR 075](075-expykit-humanoid-retargeting.md) (Expy Kit motion), and
  [ADR 023](023-licensing-dependency-policy.md) (licensing/dependency policy — the pinned-pack
  installer and the clearance scanner follow the same pattern MPFB itself uses).

## Not now (deferred per ADR 072)

- **Calibrating the garment-pair layering check.** `garment_pair_report` is informational only
  (item 7); both formulations tried misreport at a garment's own open hem. Fix it, or accept a
  documented approximation, before gating on it.
- **Per-garment poke-through denominators for small hidden-skin boundary rings**, as distinct from a
  single fixed fractional bound — a boundary ring of a few dozen vertices behaves differently under a
  percentage bound than the thousands-of-vertices rings the bound was validated against.
- **Cloth-simulating an `.mhclo` garment's hem** with the existing loose/hybrid class (item 12) —
  every garment here is armature-only; a genuinely swinging `.mhclo` skirt hem is unbuilt.
- **Body-macro-aware asset selection.** The production human's default macro mix is gender 0.5;
  garment fit and the clearance record were validated against that one body, not the full macro
  range.
- **Wiring this wardrobe into the declarative cinematic-campaign pipeline** as a resolvable wardrobe
  input — still a follow-up for when a campaign needs it, matching ADR 075's and ADR 076's own
  deferrals.
- **More packs need per-asset clearance.** Only the six packs pinned by the installer (64 garments)
  have been scanned and recorded; other MakeHuman community packs are not yet cleared for use.
