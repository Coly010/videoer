# Scene keyframes

`scene-keyframes` turns two to four related images into one evolving cinematic shot. The first image is the anchor; continuation and reveal frames advance action while retaining the anchor's environment, identities, designs, costume language, composition family, and lighting. Use it when something meaningful changes inside a shot. Use `image-motion` for a single tableau that only needs camera movement.

## Storyboard shape

```json
{
  "id": "ritual",
  "type": "scene-keyframes",
  "startSeconds": 2,
  "durationSeconds": 4,
  "text": "The old fire answered.",
  "prompt": "A lone mage performs a forbidden ritual in one continuous ruined chapel scene",
  "keyframes": [
    {
      "id": "anchor",
      "role": "anchor",
      "timeOffset": 0,
      "description": "The mage raises an unlit staff"
    },
    {
      "id": "ignition",
      "role": "continuation",
      "timeOffset": 1.6,
      "description": "Black fire crawls up the same staff"
    },
    {
      "id": "reveal",
      "role": "reveal",
      "timeOffset": 3,
      "description": "A fixed creature silhouette resolves behind the mage"
    }
  ],
  "continuity": {
    "lockBackground": true,
    "lockCharacterIdentity": true,
    "lockCostume": true,
    "lockLightingFamily": true,
    "lockCreatureDesign": true
  },
  "sceneMotion": {
    "blend": "parallax-blend",
    "camera": "push-in",
    "atmosphere": ["black smoke", "embers"],
    "blendSeconds": 0.45
  },
  "sfx": ["low ignition", "creature breath"]
}
```

The first keyframe must start at `0`, must have role `anchor`, and is the only anchor. Offsets are strictly increasing and must fall inside the shot. Two to four frames are supported. `assetPath` is absent while planned and added after generation. Each keyframe has its own revision/stale state, so a weak continuation can be replaced without invalidating its siblings.

## Generation and caching

Generation is sequential. The anchor prompt establishes the canonical scene. Each dependent request receives the anchor and latest available prior frame as provider references plus explicit instructions to preserve enabled continuity locks and change only its described action. Outputs use:

```text
generated/images/<shot-id>/<keyframe-id>.r<revision>.png
```

The request cache includes provider, prompt, reference paths, dimensions, and revision. A matching persisted output is reused unless `--force` or regeneration is requested.

```bash
npm run video -- generate-assets campaigns/my-trailer/campaign.yaml
npm run video -- generate-assets campaigns/my-trailer/campaign.yaml --shot ritual
npm run video -- shot regenerate campaigns/my-trailer/campaign.yaml ritual --keyframe reveal
npm run video -- shot regenerate campaigns/my-trailer/campaign.yaml ritual
```

Set `providers.image` in `campaign.yaml`, or pass `--provider`. The repository includes `fake` for workflow tests and `codex-experimental` as an explicitly selected adapter. Codex may also create persisted keyframe inputs with its image tool and record the same paths/provenance; that orchestration remains outside deterministic rendering.

## Rendering

The renderer loads every persisted keyframe before Remotion composition. It crossfades adjacent moments around their offsets, applies one camera move across the whole shot, and adds a subtle deterministic atmosphere/light layer when atmosphere cues exist. `parallax-blend` and `depth-blend` add differential drift; without authored masks or depth maps, `mask-blend` and `depth-blend` intentionally remain graceful approximations rather than inventing unavailable geometry. No provider is called during rendering.

## Review and limitations

Campaign verification checks asset completeness/existence, distinct action descriptions, explicit continuity locks, motivated blend/camera configuration, CTA destination, and whether a cinematic storyboard contains any evolving scene. These are planning/mechanical checks. A human or Codex must still inspect frames and motion for identity drift, background jumps, duplicate poses, implausible morphing, readable text, coherent transitions, consistent visual identity, and a correct CTA.

Regenerate a single weak dependent when the anchor is strong. Regenerate the whole shot when the anchor composition or canonical identity/design is wrong. Full semantic continuity scoring, authored masks, optical flow, and depth-map generation are not yet deterministic built-in capabilities.
