# Animation approach evaluation: getting a good walk (and other actions) on the MPFB/Rigify human

> Research/evaluation only. This document does not change production code, tests, or other docs.
> It weighs how Videoer should produce human motion on the ADR 074 production human
> (MPFB hm08 CC0 mesh + Rigify rig), against `docs/product-principles.md`
> (finished-video-first, orchestrate mature tools, provider-free/local-first, GPL/CC0-only,
> don't over-engineer).

## TL;DR

- **The current arm failure is NOT the source clip.** I measured the Quaternius source directly in
  Blender: the `Walk_Loop` arms hang at the sides (hand ~0.50 m below the shoulder) with a healthy,
  natural ~0.30 m forward/back swing in opposite phase; jog/sprint have proper ~90° bent-elbow
  pumping. The source arm animation is *good*. The rendered "bent-up guard" / "T-pose splay" is
  introduced entirely by the **hand-rolled retarget**. `docs/characters.md`'s leading hypothesis
  ("the source clip's stylised game-engine arm carriage is the ceiling") is **refuted by the data**.
- The "four retarget modes fail identically, so it must be the source" argument is a logical
  fallacy: all four modes share the *same* clavicle→shoulder mapping and the *same* MPFB↔Rigify
  arm rest-pose/bone-roll relationship, so a single shared bug fails all four the same way.
- **Recommendation (ranked):**
  1. **Stop hand-rolling retarget math. Orchestrate a preset-based Blender retargeter — Expy Kit
     (GPLv3, free, maintained, ships Unreal-Mannequin *and* Rigify presets)** — to bind the existing
     CC0 source to Rigify and bake. This is the exact "use a mature tool's native representation"
     move the product principles call for, and the source is already the single most-supported
     retarget rig (the Unreal Engine 5 Mannequin).
  2. **Keep the native Rigify authoring path (`render_native_rigify_walk_probe.py`) as the
     deterministic fallback, and as an arm-only corrective layer** over the (already good) baked CC0
     legs/hips/torso. The native probe already produces the *best* arm carriage of everything tried,
     because keying Rigify's own FK arm controls has no cross-rig mismatch.
- **Do not** build a dependency on Auto-Rig Pro (paid) or Mixamo (online Adobe service — violates
  provider-free/local-first). Do not switch CC0 libraries to fix the arms — the Quaternius walk is
  fine; the retarget is the problem.

---

## 1. What the downloaded source set actually is

**Path:** `work/sources/quaternius-universal-animation-library-standard-v3/extracted/Universal Animation Library[Standard]/`
(immutable archive SHA-256 `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`).

**Licence: CC0 1.0 Universal (Public Domain Dedication).** Confirmed from both `README.txt` and
`License.txt`. This is the cleanest possible licence — no attribution required, commercial use fine,
redistribution fine. Nothing to fix here.

**Contents (Quaternius "Universal Animation Library [Standard]" v3):**
- Two engine folders: `Unity/` (FBX) and `Unreal-Godot/` (glTF/GLB). Each has a `_RM` variant with
  **root motion baked in** and a plain variant that is **in-place** (root motion disabled). The
  current pipeline imports `Unity/UAL1_Standard.fbx` (in-place, ~23 MB).
- **One shared mesh + skeleton, 43 actions** stored as FBX takes. The rig is the
  **Unreal Engine 5 "Mannequin" (Epic humanoid) skeleton** — 65 bones, canonical Epic naming:
  `root → pelvis → spine_01/02/03 → neck_01 → Head`, arms `clavicle_[lr] → upperarm → lowerarm →
  hand` with full `index/middle/ring/pinky/thumb_0N_[lr]` finger chains (+ `_leaf` tip bones), legs
  `thigh → calf → foot → ball (+ ball_leaf)`. This matters enormously (see §3): the source is the
  *most widely supported retarget skeleton in existence*.
- **Actions (43):** `Walk_Loop`, `Walk_Formal_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Crouch_Fwd_Loop`,
  `Crouch_Idle_Loop`, `Idle_Loop`, `Idle_Talking_Loop`, `Idle_Torch_Loop`, `Interact`, `PickUp_Table`,
  `Push_Loop`, `Driving_Loop`, `Fixing_Kneeling`, `Sitting_Enter/Idle_Loop/Talking_Loop/Exit`,
  `Dance_Loop`, `Death01`, `Hit_Chest`, `Hit_Head`, `Jump_Start/Loop/Land`, `Roll`, `Swim_Fwd_Loop`,
  `Swim_Idle_Loop`, `Punch_Jab/Cross`, `Pistol_*` (6), `Spell_Simple_*` (4), `Sword_Attack/Idle`,
  `A_TPose`. This is a strong, general-purpose locomotion + interaction + idle set — more than enough
  for marketing shots (walk, formal walk, jog, idle, talking idle, sit, pick up, push, dance).

**Bottom line:** the source is licence-perfect (CC0), content-rich, and on the ideal skeleton. There
is no source-side reason to look elsewhere for a walk.

---

## 2. Evidence I gathered (headless Blender inspection)

Measured with a throwaway `blender --background` script (source arm bones sampled across each cycle).
Numbers are hand-head position **relative to the shoulder**, in the armature's world frame; `Y` is
forward/back, `Z` is up/down; elbow angle in degrees.

| Source clip | Elbow (L) | Hand vertical (mean Z) | Fwd/back swing amplitude (Y) | Reading |
|---|---|---|---|---|
| `Walk_Loop`   | 32°→40°→32° | −0.50 m (arms down) | **0.30 m** (L/R opposite phase) | natural relaxed walk swing |
| `Jog_Fwd_Loop`| 79°→94°     | −0.28 m             | **0.51 m** | proper bent-elbow jog pump |
| `Sprint_Loop` | 79°→94°     | −0.30 m             | **0.44 m** | proper sprint pump |
| `Idle_Loop`   | ~30°        | −0.50 m             | 0.03 m | still, arms at sides |

**The source `Walk_Loop`: arms hang at the sides and swing ~30 cm front-to-back in opposite phase —
a well-animated, natural human walk.**

Rendered evidence (existing stills, `work/characters/production-rig-scene-integration/`):
- `cc0-rigify-walk-rest-compensated-v14/Walk_Loop-021.png` → **boxer's guard**, forearms crossed at
  the sternum, hands at chest height.
- `cc0-rigify-walk-local-fk-grounded-v13/Walk_Loop-021.png` → the **same guard**.
- `cc0-rigify-walk-world-fk-v12/Walk_Loop-021.png` → arms **splayed horizontally** (scarecrow/T).
- `native-rigify-walk-v1/three-quarter-013.png` (the *native* probe, no retarget) → arms **hang at
  the sides with a modest swing** — the most natural arm carriage of any render in the folder.

None of the three retarget renders resembles the source pose at that frame (down-and-forward, elbow
~40°). The guard/splay is manufactured by the retarget, and the mismatch is on the **arm chain
specifically** (legs, hips, grounding and forward travel are good in all FK modes).

---

## 3. Honest diagnosis of the arm problem

**Is the source the ceiling? No.** The source arm animation is good (§2). The failure is in the
transfer, and it is a *fixable* class of bug, not a fundamental limit.

**Why all four hand-rolled modes fail the same way (the real cause):** they share the same two things:

1. **The `clavicle_[lr]` → `shoulder.[LR]` mapping** (`full_control_map()` in
   `render_cc0_rigify_action_reel.py`). Rigify's `shoulder.*` is a very different control from the
   Epic `clavicle_*` (different pivot, rest orientation, and length). Driving it with the source
   clavicle's rotation twists the base of the whole arm chain, and every downstream error compounds.
2. **The MPFB/Rigify arm rest pose + bone roll vs the Epic mannequin's.** Rigify arms rest angled
   down-and-out with their own per-bone roll; the mannequin arms rest differently. The world-space
   modes force each Rigify arm bone's *world* orientation from a source world-delta but only override
   rotation (`posed.translation = control.matrix.translation`), so a wrong bend axis on `forearm_fk`
   turns the source's gentle elbow flex into a large up-and-in fold — exactly the observed "guard".
   The `world-fk` variant instead lands the arm in the mannequin's near-horizontal rest → the T-splay.

Every mode inherits both of these, so they all fail identically. That is the fallacy in "four modes
failed, so it's the source": four formulations *over the same broken bone map and rest handling* is
one experiment, not four. **`docs/characters.md`'s "don't add a v15 retarget mode" advice is
correct** — but the conclusion should be "replace the hand-rolled math with a tool that already
encodes each rig's bone axes," not "the source clip is the limit."

The native probe is the control experiment that proves this: with **no** cross-rig transfer (it keys
Rigify's own FK arm controls directly), the arms behave. The bug lives in the hand-rolled
mannequin→Rigify arm transfer, nowhere else.

---

## 4. The approaches, with concrete tradeoffs

### A. Keep hand-rolling retarget math (the current path) — **dead end for arms**
Legs/hips/torso/grounding/forward-travel are already good, and the code is provider-free and
deterministic. But hand-authoring correct per-bone rest/roll compensation for the arm chain is
exactly the reinvention the product principles say to avoid, and four iterations have not cracked it.
Per "after two materially unsuccessful attempts with the same strategy, change the strategy" — stop.
Do not write a v15. Salvage value: the leg/root/grounding half is a good baked base to *combine*
with B or C.

### B. Use a preset-based Blender retargeter (recommended) — orchestrate a mature tool
The source is the Unreal mannequin and the target is Rigify — the single best-supported retarget
pair. Off-the-shelf tools already ship bone maps for both, encoding the exact bone-axis/roll
knowledge the hand-rolled code is missing.

| Tool | Licence | Cost | Provider-free / local? | UE-mannequin + Rigify presets? | Headless? | Verdict |
|---|---|---|---|---|---|---|
| **Expy Kit** (`pKrime/Expy-Kit`) | **GPLv3** (explicit in `__init__.py`) | Free | Yes, fully local | **Yes** — ships `Unreal_Mannequin`, `Unreal_Mannequin_5_0`, `Rigify_Controls`, `Rigify_Metarig`, `Rigify_Deform` presets (also Mixamo/ActorCore/MocapOnline/RenderPeople/Daz) | **Yes** — `bpy.ops` operators: `armature.expykit_constrain_to_armature` (bind via preset map) + `armature.expykit_bake_constrained_actions` (+ `expykit_add_rootmotion`, `expykit_convert_bone_names`) | **Top pick.** Maintained (last commit 2025-12). |
| Rokoko Studio Live (Blender) | **LGPLv3** | Free (retarget needs no premium/account) | Retarget is local; only Studio Live streaming / motion library need an account | Auto-detects/maps humanoids; no named Rigify *control* preset but maps to Rigify deform fine | Possible but GUI-first; scripting the retarget panel is fiddlier | Solid fallback if Expy Kit's headless binding proves awkward |
| Epic **UE-to-Rigify** (`EpicGames/BlenderTools`) | **MIT** | Free | Yes, local | Purpose-built UE-mannequin ↔ Rigify (its whole reason to exist) | Node-template driven; scriptable but heavier | Purpose-fit but heavier; last commit 2024-07, Blender-4.5 compatibility is a **risk to verify** |
| **Auto-Rig Pro** (Remap) | GPL code, but **commercial/paid** (~$40 full, ~$20 lite on Superhive) | Paid | Local | Yes (excellent remapper) | Yes | **Avoid as a dependency** — a free local-first toolkit should not require users to buy a $40 addon. Not redistributable/bundleable. |

**Effort for the top pick (Expy Kit):** moderate. A `blender --background --python` harness must:
import the CC0 FBX; generate the MPFB/Rigify human (existing `render_mpfb_motion_probe.create_rigged_human`);
set the source preset = `Unreal_Mannequin_5_0`, target preset = `Rigify_Controls`; call
`expykit_constrain_to_armature`; then `expykit_bake_constrained_actions` per clip. The one real risk:
these operators are GUI-first and depend on operator context (active/selected objects, pose mode,
scene preset properties), so the harness needs a context-override and a **one-clip validation render
(a "spike") to confirm the arms come out right before wiring it into the reel.** This is normal
tool-integration cost, not reinvention, and it directly reuses the CC0 clips and the working
leg/grounding pipeline.

**Quality ceiling:** high — you keep the mocap-quality source performance (good arms *and* legs) and
just transfer it correctly. This is the best quality-per-effort option.

### C. Natively author the walk on Rigify (extend `render_native_rigify_walk_probe.py`)
Rigify exposes exactly the animator surface you'd want: FK/IK arms and legs, IK feet with foot-roll
(`foot_heel_ik`, `foot_spin_ik`, `toe_ik`), pole targets, spine FK, `hips`/`chest`. The existing
probe keys these procedurally (pelvis load/release, torso counter-rotation, IK-planted stance feet,
toe clearance in swing, delayed FK arm pendulum) and is **fully deterministic, headless, provider-
free and licence-free** (pure Python keying).

- **What good hand-authoring realistically involves:** a convincing walk cycle is ~8–12 keyed poses
  per limb with weight shift, foot roll (strike→flat→toe-off), hip drop/rise, torso counter-rotation,
  arm overlap/settle and follow-through. Scripting it deterministically is very doable (the probe is
  90% of the skeleton of this), but *reading as non-generic* is the hard part — this is precisely the
  "reads as a mannequin / posed" limitation that got the owned procedural gait retired in ADR 074.
- **Quality ceiling:** a *good generic* walk, not mocap-lifelike. Fine for mid/background shots or a
  single stylised hero walk; weaker than mocap for a close, front-on hero moment.
- **Effort:** medium. Cheap to iterate (no cross-rig math), instant to re-render.
- **Best use — the hybrid, and the cheapest certain win:** bake the CC0 source for legs/hips/torso/
  grounding (already good), and key **only the two FK arms** natively over it (this is
  `docs/characters.md` option (c)). Because the source arms are a clean pendulum, even a simple
  scripted arm swing matches them well, and there is zero cross-rig arm transfer to go wrong. This is
  a concrete, low-risk path to a shippable walk *even if every retargeter disappoints on arms.*

### D. A different source clip or CC0 library — mostly unnecessary
- **Within Quaternius (CC0, same skeleton, free):** `Walk_Formal_Loop` is a restrained-arm alternate
  (I measured only ~6 cm arm swing — deliberately formal); `Jog_Fwd_Loop`/`Sprint_Loop` give the
  energetic variants. No need to leave the library.
- **CMU Graphics Lab mocap (BVH):** free for commercial use, may not be resold even converted
  (effectively public-domain-ish, *not* formally CC0). ~2,500 clips. Needs its own retarget (CMU
  skeleton), and is older/noisier. Only worth it if you later need *variety* the Quaternius set lacks.
- **Truebones:** **paid** ($99+ packs). Skip for a free toolkit.
- **Mixamo (Adobe):** royalty-free commercial use, but it is an **online Adobe service requiring an
  Adobe account**, and animations may not be redistributed standalone. **This violates Videoer's
  provider-free / local-first principle** — it is a generative-provider dependency in disguise. Do
  not build the human-motion pipeline on it. (Named here only to flag it honestly.)

### E. Procedural gait synthesis — retired
ADR 074 retired the owned procedural gait as the production motion source. Note only that approach C
(native Rigify authoring) is *procedural authoring on a mature rig*, which is different and allowed —
it targets Rigify's real controls, not a project-owned skeleton, and is best scoped to the arm-only
corrective layer, not a from-scratch full-body gait.

---

## 5. Ranked recommendation (matched to finished-video-first + pragmatic tooling)

1. **First — integrate Expy Kit (GPLv3) as the retargeter; retire the hand-rolled arm math.**
   Highest quality-per-effort; keeps the CC0 mocap performance intact; is the textbook "orchestrate
   the mature tool" move; provider-free and licence-clean. Validate with a single-clip spike render
   before wiring into the reel. If Expy Kit's headless operators fight the context system, fall back
   to Rokoko (LGPL, local) or Epic's UE-to-Rigify (MIT) — both provider-free.
2. **Second — keep the native Rigify authoring path as (a) the deterministic fallback and (b) an
   arm-only corrective layer over the baked CC0 legs.** This is the guaranteed shippable walk that
   needs no third-party addon, and the CC0-legs + native-arms hybrid is the cheapest certain fix if
   retargeting arms stays stubborn.
3. **Do not:** add a v15 hand-rolled retarget mode; adopt Auto-Rig Pro (paid) or Mixamo (online,
   provider-violating) as a dependency; or switch CC0 libraries to "fix" the arms (the arms aren't a
   source problem).

Sequence for whoever picks this up when a campaign needs a walking human: (1) spike Expy Kit on
`Walk_Loop` headless → confirm arms; if good, generalise to the action set. (2) If the spike is
disappointing, ship the CC0-legs + native-arms hybrid. Both are provider-free and licence-clean.

## 6. Cheap, separate presentation fix (not the arms)
The "weaving" in the evidence MP4s is the render camera being glued to the root (it cancels the
straight-ahead forward travel; `rootTravel` for `Walk_Loop` is dead-straight). Un-glue the camera
from the root or use a path/locked camera and the forward stride will read. This is independent of
the arm work and nearly free — do it whenever these clips are used in a shot.

## 7. Licence / constraint summary

| Thing | Licence | Provider-free / local | Cost | Fit |
|---|---|---|---|---|
| Quaternius UAL Standard v3 (current source) | CC0 1.0 | Yes | Free | Keep — ideal |
| Expy Kit retargeter | GPLv3 | Yes | Free | **Adopt (top pick)** |
| Rokoko Blender plugin (retarget) | LGPLv3 | Yes (retarget local; account only for streaming/library) | Free | Fallback |
| Epic UE-to-Rigify (BlenderTools) | MIT | Yes | Free | Fallback (verify Blender 4.5) |
| Auto-Rig Pro | GPL code, commercial product | Local | ~$40 | Avoid as dependency |
| CMU mocap BVH | Free commercial, no resale | Yes | Free | Optional, only for variety |
| Truebones | Proprietary | Yes | Paid | Skip |
| **Mixamo** | Adobe royalty-free, no standalone redistribution | **No — online Adobe account** | Free | **Reject: violates provider-free** |
| Native Rigify authoring (probe) | n/a (own code) | Yes | Free | **Keep as fallback + arm layer** |
