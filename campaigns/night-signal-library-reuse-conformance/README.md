# Night Signal library reuse conformance campaign

This two-shot campaign is the downstream half of the declarative publication test. It does not contain the night-platform recipe. Instead, the ordinary campaign resolver selects the immutable, commercially cleared `environment.night-transit-platform@1.0.1` geometry and its semantic attachments from the shared library, then combines that world with a new campaign-owned signal prop, editorial treatment, soundtrack, and shot grammar.

```bash
npm run video -- cinematic-campaign validate campaigns/night-signal-library-reuse-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/night-signal-library-reuse-conformance/cinematic-campaign.yaml
```

The resulting `work/asset-manifest.yaml` must record `platform` as `reuse` and `signal-orb` as `create`. No campaign-specific application or rendering source is permitted.

The accepted delivery is 640×360, 24 fps, 144 frames, and exactly 6.000 seconds with H.264/yuv420p video and AAC stereo 48 kHz audio. The orb's close-shot projection remains fully inside frame at 64.7–73.6% screen height, and both whole-frame and subject-local highlight gates pass.
