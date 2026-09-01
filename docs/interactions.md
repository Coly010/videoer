# Procedural interactions

Videoer synthesizes actor-to-prop actions as synchronized, renderer-independent motion clips. The current fixtures are `open-door` and `read-book`; both accept any geometry compatible with `videoer.canonical-humanoid.v1`.

```bash
npm run video -- interaction create open-door path/to/actor/geometry.json work/open-door
npm run video -- interaction create read-book path/to/actor/geometry.json work/read-book
```

Each output contains actor and target geometry, actor and target motion where applicable, the normalized interaction definition, quantitative verification, and a Blender verification directory. That directory contains two MP4 viewpoints, phase-boundary PNGs, two contact sheets, `interaction.blend`, and `interaction-probe.json`.

Acceptance requires all of the following:

- named actor effectors and prop attachments resolve through explicit scene transforms;
- requested targets are reachable without limb stretching and elbows retain a non-singular bend;
- the door hand remains within 6 mm of the animated handle throughout grasp, handle turn, and opening;
- the door actor begins outside at negative Z, faces the positive-Z threshold through an explicit actor transform, and finishes the passage on the interior side;
- both book hands remain within 6 mm of their moving grips for the complete clip;
- gaze turns toward the animated book target;
- phase ordering is contiguous and covers the complete clip;
- visual review from both views shows correct side mapping, readable contact, plausible prop scale, no floating object, no T-pose or crossed limbs, and a leg-driven rather than sliding passage beat.

Locomotion retains the separate gait gates for canonical forward travel (`-Z`), knees folding behind travel, toes ahead of heels, the leading heel ahead of the root, and the trailing heel behind it. Those checks explicitly reject the earlier backwards-walk and foot-behind-leg failures.
