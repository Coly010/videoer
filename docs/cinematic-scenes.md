# Executable cinematic scenes

Videoer's cinematic scene contract composes verified geometry and motion assets into one renderer-independent 3D shot. A scene declares entities and transforms, retimed motion bindings, a complete animated camera, production lights, deterministic atmosphere, semantic inspection landmarks, and fail-closed quality gates. Blender is the current deterministic backend; scene data does not contain Blender object or API types.

```bash
npm run video -- cinematic-campaign build campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml
npm run video -- cinematic verify campaigns/reference-cinematic-benchmark/work/scenes/enter-bookshop/scene.json
npm run video -- cinematic render path/to/scene.json --output work/scene/verification
npm run video -- cinematic probe path/to/scene.json --output work/scene/probe
```

`cinematic probe` renders only the declared semantic landmarks using the scene's full declared render profile. It is the preferred feedback loop for camera, lighting, material, and set-transfer iteration because it preserves authoritative shading while avoiding a complete frame sequence for a candidate that may be rejected. Its report is deliberately marked `publicationEligible: false`; publication still requires the complete temporal render, render gates, delivery inspection, and visual review.

Source-bound secondary atmosphere is declared under the same renderer-independent scene boundary. An aerosol VFX asset supplies smoke, ember or dust layers; the scene binds it to an entity and named geometry attachment. Resolution applies the entity's live world transform and persists the source asset, entity, geometry, attachment and resulting origin. Blender writes the generated layer/particle evidence to `aerosol-report.json`; stored campaign data never names a Blender volume, particle object or node. The initial analytic smoke plume is intentionally unaccepted, while the binding and evidence contract is retained for a future turbulent volumetric/fluid implementation. See [ADR 051](adr/051-source-bound-secondary-atmosphere.md).

When inspection code or evidence metadata changes without changing pixels, add `--reuse-existing-pixels`. The command verifies that every landmark image, the Blender source, and framing evidence exist before rebuilding the probe report and contact sheet; it never silently converts incomplete evidence into a pass.

The generic declarative builder creates all eight executable benchmark shots: city establish, character approach, window attraction, window pause, bookshop entrance, book discovery, title reveal, and cover reveal. It resolves the environment, character, props, motions, lighting rigs, VFX, reviewed editorial image, and soundtrack through ordinary verified-library requirements. Each verification directory contains the resolved portable manifest, H.264 vertical preview, Blender source where applicable, semantic frames, contact sheet, probed media metadata, renderer log, and structured quality report. Editorial overlays are declared in scene data and composited deterministically after the 3D render.

The generic edit-plan contract orders these scene outputs and binds a verified soundtrack. The benchmark instance allocates `[34, 58, 43, 38, 43, 53, 43, 48]` frames: exactly 360 frames and 15.000 seconds at 24 fps. Assembly fails closed unless ffprobe confirms the requested codec, pixel format, resolution, frame count, frame rate, duration, AAC audio, 48 kHz sample rate, and stereo layout.

## Acceptance conditions

- Duration must resolve to a whole frame count. The rendered MP4 duration and declared duration must match exactly; Blender's inclusive endpoint frame is mapped onto the final delivery frame rather than appended.
- A `directional-motion` gate compares root displacement with the entity's transformed canonical forward vector. Minimum travel and normalized dot-product thresholds explicitly reject the earlier case where the knees and torso faced forward while the body travelled backward.
- An `axis-crossing` gate records the required direction, boundary, and clearance. The entrance scene must begin at least 0.25 m outside negative Z and end at least 0.25 m inside positive Z.
- Upstream interaction gates remain mandatory after composition: hand/handle and two-hand/book contact, joint limits, phase order, gaze, and root continuity are not waived by a successful scene render.
- Semantic frames are extracted at named action landmarks, not arbitrary equal intervals. Visual review must prove readable contact, correct side mapping, prop scale, environment continuity, and non-occluded action silhouettes.
- `frame-visibility` gates measure black-pixel coverage at declared semantic frames. They catch camera/environment occlusion such as the rejected approach shot whose midpoint was 100% black; intentionally dark editorial frames opt into separate treatment-specific checks rather than being misclassified.
- `camera-path-clearance` runs before rendering across an explicit sample count. It evaluates transformed and animated/skinned obstacle triangles, measures camera-body clearance, and rejects a camera-to-semantic-target intersection that occurs materially before the intended target surface. The Blender backend animates the semantic target itself through a tracking constraint and emits exact-frame position/target/lens error evidence; approval does not assume endpoint Euler interpolation represents the declared path.
- `frame-overexposure` gates invert and measure near-white pixel coverage at semantic frames. They were added after a third campaign's first seedling render retained geometry but lost leaf detail to clipped lighting; visibility alone could not detect that failure.
- Camera selection is part of verification. The entrance uses the handle-side rear three-quarter because the opposite camera hid the reaching hand behind the torso and was rejected.
- Gait assets retain dual-view phase sampling and the separate toe/heel, knee-polarity, planted-contact, swing-clearance, and limb-occlusion checks documented by motion verification.
- Integrated long dresses use the same pelvis-dominant drape weighting and temporal deformation contracts as standalone fitted garments. Static hem influence is checked first; 49-pose CPU skinning then measures body penetration, silhouette expansion and flicker, and local edge strain. A failing garment/body/motion tuple receives deterministic structural-and-bending pose-space correctives, is reverified, and is content-addressed for reuse by other shots. The accepted Elara 0.1.4 neutral and cautious gait evidence reports zero colliding samples without relaxing motion or camera gates.

The benchmark entrance records positive root travel aligned with transformed character forward and a negative-to-positive threshold crossing. The approach shot additionally records black-pixel coverage below its 40% maximum. The assembled declarative delivery is H.264/yuv420p at 540×960, 24 fps, 360 frames, exactly 15.000 seconds, with AAC stereo 48 kHz audio.

# Cinematic finishing

A scene may declare `finishProfilePath` to apply a bounded renderer-independent finish after the base Blender render and all image overlays. The delivery then uses `<scene-id>-finished.mp4`; the profile hash participates in render fingerprints, so changing it invalidates the pixels without invalidating unrelated geometry or motion evidence.

Use verified library profiles where possible. `vfx.soft-atmospheric-finish@0.1.0` is accepted for restrained medium-distance display-referred delivery. It preserves source topology and has independent byte-identical transfer evidence across warm square and cool vertical sources. It is not a relighting tool, HDR master, hero-close skin grade, or justification for accepting poor source exposure.

The host FFmpeg must provide `eq`, `colorchannelmixer`, `lutrgb`, `gblur`, `blend`, `vignette`, and `noise`; `npm run video -- doctor` checks them. See [ADR 053](adr/053-renderer-independent-cinematic-finishing.md).
