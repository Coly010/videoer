# Codex production workflow

This is the concrete, step-by-step version of [`docs/product-principles.md`](../product-principles.md).
Read that first if a step here seems to conflict with it — the principles win.

```text
read brief + references
→ identify marketing structure
→ storyboard
→ choose a production strategy per shot
→ generate/build only required assets
→ produce shots
→ assemble draft
→ inspect the finished draft
→ identify the highest-impact weakness
→ repair the smallest useful unit, or change strategy if the current approach is failing
→ rerender
→ accept when the finished video meets the campaign goal
```

## 1. Read the brief, draft the storyboard

Read the brief and references. Create or update `campaign.yaml`; make the canonical destination
the `cta` value when it is a URL. Author `storyboard.json` as an editable timing plan.

## 2. Choose a production strategy per shot

Pick the cheapest credible technique for what the shot needs to look like — not the technically
simplest or architecturally purest one. Weigh: desired visual result, shot duration, available
supplied assets, required motion/performance, camera movement, needed consistency, cost, render
time, provider/model cost, expected iteration count, and whether a mature tool already solves it.

Available strategies, mix freely within one campaign:

| Strategy | Use when |
| --- | --- |
| `supplied-media` | Good artwork/footage already exists; don't regenerate it. |
| `image-motion` | A still image needs subtle pan/zoom/parallax, no real animation. |
| `layered-2d` (`scene`) | Independently timed image/video/text/shape/particle layers with a 2.5D camera. |
| `scene-keyframes` | Two or more related actions unfold within one shot/scene. |
| `generated-still` | No suitable supplied asset exists; a still is enough for the beat. |
| `image-to-video` | A generated/supplied still needs motion an AI video model can plausibly add. |
| `cinematic-3d` (declarative cinematic campaign) | Physical character/environment interaction, camera movement through 3D space, or simulated cloth/VFX that 2D compositing can't sell. |
| `ui-demo` | Product screenshots/UI need to look alive (Tutarium/SaaS promos). |
| `kinetic-text` | The beat is carried by typography, not imagery. |
| `slideshow` | Polished, editorial still-based pacing (e.g. a feature-highlight promo). |
| `stock/user-video` | Existing footage covers the beat. |
| `custom` | None of the above fits; say why before building something bespoke. |

A static fantasy battle image that only needs to live for four seconds is usually
`supplied/generated-still + layered VFX + subtle motion + good sound`, not a fully modelled 3D
battlefield. A hero physically opening a door in a moving-camera shot is a legitimate reason to
reach for `cinematic-3d`. A Tutarium feature announcement is usually `ui-demo + kinetic-text`, not
an excuse to invoke the cinematic-3D subsystem.

`cinematic-3d` uses the declarative cinematic campaign contract — prefer the complete resumable
loop when a campaign needs it:

```bash
npm run video -- cinematic-campaign produce campaigns/my-trailer/cinematic-campaign.yaml
npm run video -- cinematic-campaign production-status campaigns/my-trailer/cinematic-campaign.yaml
npm run video -- cinematic-campaign produce campaigns/my-trailer/cinematic-campaign.yaml --repair-shots weak-shot
npm run video -- cinematic-campaign review campaigns/my-trailer/cinematic-campaign.yaml campaigns/my-trailer/work/production/review.yaml
```

Authoritative Blender evidence uses the default fixed-seed Cycles CPU profile; use Eevee Next only
for an explicitly declared preview.

## 3. Validate, generate, render, inspect

Validate and verify before spending provider work. Resolve timing, missing source,
continuity-plan, scene-feel, and CTA-destination failures. Generate only missing assets; inspect
anchors before allowing dependent frames to define the shot. Render a draft, run `inspect-render`
for midpoint frames/contact sheet, and play the MP4.

```bash
npm run video -- verify campaigns/my-trailer/campaign.yaml
npm run video -- storyboard validate campaigns/my-trailer/storyboard.json
npm run video -- generate-assets campaigns/my-trailer/campaign.yaml
npm run video -- render campaigns/my-trailer/campaign.yaml --draft --change first-scene-pass
npm run video -- inspect-render campaigns/my-trailer/campaign.yaml latest
npm run video -- verify-render campaigns/my-trailer/campaign.yaml latest
```

## 4. Inspect the whole finished draft, not just each subsystem

Mechanical verification (files exist, assets resolve, duration/dimensions/FPS correct, no
clipping) catches real failures cheaply, but it is not acceptance. The question that matters is
whether the assembled video is good — not whether each shot's internal contract passed. Write a
[`finishedVideoReviewSchema`](../quality-model.md) review (`finished-video-review`)
covering: first-second hook, visual quality, shot-to-shot coherence, motion quality, pacing,
transitions, typography/readability, sound effects, music, mix balance, emotional/marketing
impact, branding, CTA, and obvious AI/rendering defects. Do not mark objective success as creative
acceptance.

## 5. Repair the smallest useful unit, or change strategy

Regenerate the smallest weak unit first: one keyframe for local drift, a whole scene shot for a bad
anchor, or revise text/motion without touching assets.

> After two materially unsuccessful attempts to fix the same visible problem using essentially the
> same strategy, reconsider the strategy itself — don't try a third variation of the same approach.

Reasonable responses to a stuck strategy: switch technique (2D instead of 3D or vice versa, a
different tool, a different supplied/generated asset), change the shot design, hide the limitation
through better cinematography/editing when creatively legitimate, or drop the shot. Do not respond
by adding another abstraction layer.

## 6. Rerender and finalize

Rerender a draft after material visual changes. When accepted, render `--final`, inspect it, run
`finished-video-review` again, and confirm `renders/final.mp4` matches the latest accepted
revision.

```bash
npm run video -- shot regenerate campaigns/my-trailer/campaign.yaml ritual --keyframe ignition
npm run video -- render campaigns/my-trailer/campaign.yaml --final --change accepted-scene-pass
```

Rerendering is deterministic and never generates assets. Provider actions are explicit, persisted,
revisioned, and separately reproducible. A campaign is complete when the finished video meets the
campaign goal — not when an asset has been published to the shared library or reused by another
campaign. Publishing to the shared library ([`docs/quality-model.md`](../quality-model.md),
[ADR 072](../adr/072-pragmatic-production-realignment.md)) is worth doing only when a specific
asset is likely to recur.
