# Codex cinematic trailer workflow

1. Read the brief and references. Create or update `campaign.yaml`; make the canonical destination the `cta` value when it is a URL.
2. Author `storyboard.json` as an editable timing plan. For every beat, choose among `kinetic-text`, `cover-reveal`, `image-motion`, `scene-keyframes`, or intentionally configured `image-to-video`. Use `scene-keyframes` when two or more related actions unfold within one scene.
3. Validate and verify before spending provider work. Resolve timing, missing source, continuity-plan, scene-feel, and CTA-destination failures.
4. Generate only missing assets. Inspect anchors before allowing dependent frames to define the shot.
5. Render a draft. Run `inspect-render` for midpoint frames/contact sheet and play the MP4 to inspect blend boundaries, pacing, text, and audio.
6. Run campaign and render verification. Add a short qualitative review record covering continuity, progression, motivated motion, visual identity, transitions, readable copy, and CTA correctness.
7. Regenerate the smallest weak unit: one keyframe for local drift, a whole scene shot for a bad anchor, or revise text/motion without touching assets.
8. Rerender a draft after material visual changes. When accepted, render `--final`, inspect it, verify it, and confirm `renders/final.mp4` matches the latest accepted final revision.

Typical commands:

```bash
npm run video -- verify campaigns/my-trailer/campaign.yaml
npm run video -- storyboard validate campaigns/my-trailer/storyboard.json
npm run video -- generate-assets campaigns/my-trailer/campaign.yaml
npm run video -- render campaigns/my-trailer/campaign.yaml --draft --change first-scene-pass
npm run video -- inspect-render campaigns/my-trailer/campaign.yaml latest
npm run video -- verify-render campaigns/my-trailer/campaign.yaml latest
npm run video -- shot regenerate campaigns/my-trailer/campaign.yaml ritual --keyframe ignition
npm run video -- render campaigns/my-trailer/campaign.yaml --final --change accepted-scene-pass
```

Rerendering is deterministic and never generates assets. Provider actions are explicit, persisted, revisioned, and separately reproducible.

For declarative 3D campaigns, prefer the complete resumable loop:

```bash
npm run video -- cinematic-campaign produce campaigns/my-trailer/cinematic-campaign.yaml
npm run video -- cinematic-campaign production-status campaigns/my-trailer/cinematic-campaign.yaml
npm run video -- cinematic-campaign produce campaigns/my-trailer/cinematic-campaign.yaml --repair-shots weak-shot
npm run video -- cinematic-campaign review campaigns/my-trailer/cinematic-campaign.yaml campaigns/my-trailer/work/production/review.yaml
```

Do not mark objective success as creative acceptance. Inspect every shot contact sheet and the complete delivery, record all review dimensions, and bind the review to the current hashes. Authoritative evidence uses the default fixed-seed Cycles CPU profile; use Eevee Next only for an explicitly declared preview.
