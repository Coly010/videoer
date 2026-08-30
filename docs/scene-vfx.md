# Scene composition and VFX

`scene` shots turn accepted local assets into deterministic layered 2D/2.5D compositions. The domain contract in `src/scene/model.ts` has no React, Remotion, PixiJS, or Three.js types. Remotion owns shot timing and final rendering; the renderer registry chooses React DOM for ordinary media/text/shapes and PixiJS for dense particles and procedural effects.

## Storyboard contract

```json
{
  "id": "castle",
  "type": "scene",
  "startSeconds": 0,
  "durationSeconds": 4,
  "scene": {
    "camera": { "preset": "slow-push-in", "intensity": 1 },
    "layers": [
      {
        "id": "environment",
        "type": "image",
        "asset": "generated/shot-03/environment.png",
        "depth": "background"
      },
      { "id": "fog", "type": "effect", "preset": "low-fog", "depth": 25 },
      { "id": "subject", "type": "image", "asset": "generated/shot-03/character.png", "depth": 50 },
      {
        "id": "embers",
        "type": "particle-system",
        "preset": "embers",
        "seed": "shot-03",
        "params": { "intensity": 0.55, "wind": 0.2 },
        "depth": 70
      },
      { "id": "copy", "type": "text", "text": "THE GATE OPENS", "depth": "screen" }
    ],
    "effects": [{ "id": "flicker", "type": "flicker", "intensity": 0.2, "depth": "screen" }]
  }
}
```

Layer types are `image`, `video`, `text`, `shape`, `sprite`, `particle-system`, and `effect`. Common properties include numeric or semantic `depth`, `zIndex`, `start`/`end` seconds, opacity, transform, motion, blend mode, mask, and filters. Semantic depths map to stable numeric bands: background 0, midground 40, foreground 75, and screen 100. Screen layers do not inherit camera transforms.

Rectangle, circle, and asset-alpha masks are supported. Filters support blur, brightness, contrast, saturation, hue rotation, and glow. Missing assets, masks, renderers, presets, and invalid known parameters are fatal in normal rendering and report campaign, shot, item, renderer, and cause.

## Camera and ordering

The camera supports push/pull, pan/track, vertical pans, drift, shake, handheld, punch, and static motion with easing. A layer's numeric depth scales camera displacement and zoom, producing stronger motion in the foreground. Layers are sorted by depth and then `zIndex`. Layer motion is composed with the camera and the layer's base transform.

## Commands

```bash
npm run video -- scene validate campaigns/fixtures/scene-vfx-cinematic/campaign.yaml
npm run video -- scene inspect campaigns/fixtures/scene-vfx-cinematic/campaign.yaml
npm run video -- vfx list
npm run video -- particles list
npm run video -- shot render campaigns/fixtures/scene-vfx-cinematic/campaign.yaml castle-awakens --preview
npm run video -- shot render campaigns/fixtures/scene-vfx-cinematic/campaign.yaml castle-awakens --preview --from 1 --to 2
npm run video -- shot inspect campaigns/fixtures/scene-vfx-cinematic/inspection/shots/castle-awakens-preview.mp4
```

Shot inspection writes `000.png`, `025.png`, `050.png`, `075.png`, `100.png`, and `contact-sheet.png` beside the render in a `verification` directory.
