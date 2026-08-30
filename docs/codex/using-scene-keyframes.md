# Using scene keyframes from Codex

Choose `scene-keyframes` when a cinematic shot contains at least two visible action states that should occur in the same place: ignition, emergence, a pose or weapon change, fog/particles intensifying, a reveal, or a motivated lighting shift. Prefer `image-motion` for an establishing tableau with no in-scene progression, `kinetic-text` for a copy beat, `cover-reveal` for the product, and `image-to-video` only when a compatible clip source/provider is intentionally used.

## Plan the scene

Write one stable scene sentence, then list two to four moments. The anchor should have the cleanest composition and define every invariant. Dependent descriptions should state only what changes. Do not write each keyframe as a complete standalone art prompt; that invites moodboard alternatives.

Good:

```text
Scene: same rain-dark medieval street, lone mage foreground, fixed ruined arch behind.
Anchor: mage lowers an unlit staff; empty arch.
Continuation: black fire curls around the same staff; cloak lifts in the wind.
Reveal: two fixed Daerite silhouettes emerge beneath the same arch; fire brightens faces.
```

Weak:

```text
Dark fantasy mage artwork. / Cool demon artwork. / Epic fire artwork.
```

Enable continuity locks that matter. Background, identity/design, costume, and lighting should normally be locked. Disable a lock only when its change is the point of the shot. Space offsets so a state has time to register; in a four-second shot, `0`, `1.5`, and `3.0` is a useful starting rhythm.

## Generate, inspect, and revise

1. Validate the storyboard and run campaign verification.
2. Generate the anchor first, then dependents. The application operation does this automatically.
3. Inspect the image files before rendering. Reject a bad anchor immediately; every dependent inherits it.
4. Render a draft, inspect the contact sheet and the actual motion near each keyframe boundary, then verify it.
5. Regenerate only a drifting/weak dependent when the anchor is sound. Regenerate the entire shot when composition, subject identity, or canonical entity design is wrong.

```bash
npm run video -- storyboard validate campaigns/my-trailer/storyboard.json
npm run video -- generate-assets campaigns/my-trailer/campaign.yaml --shot ritual
npm run video -- render campaigns/my-trailer/campaign.yaml --draft --change scene-keyframes-preview
npm run video -- inspect-render campaigns/my-trailer/campaign.yaml latest
npm run video -- verify campaigns/my-trailer/campaign.yaml
npm run video -- shot regenerate campaigns/my-trailer/campaign.yaml ritual --keyframe reveal
```

Review continuity, intra-shot progression, motivated movement, absence of jarring image swaps, scene-to-scene identity, text safe areas/readability, transition rhythm, and CTA copy/destination. Mechanical passes do not mean the shot is creatively accepted.
