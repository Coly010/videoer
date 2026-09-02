# Production quality reel

This is a representative production reel manifest, not a replacement benchmark
or a new rendering architecture. It composes verified, reusable assets from the
shared library into four deliberately different coverage patterns: a deep
environment establish, a practical/material detail, an animated character
crossing, and a threshold resolution. Its job is to make cross-system changes
visible together and to reveal failures that isolated probes cannot.

The reel is intentionally campaign-neutral: no benchmark IDs, benchmark camera
coordinates, or campaign-specific source code are reused. Every production
dependency is pinned by immutable asset ID and version, and the manifest uses
only the generic declarative campaign builder.

## Coverage and review route

| Shot | Principal systems exercised | Required visual review |
| --- | --- | --- |
| `wet-street-establish` | environment depth, set dressing, wet architectural materials, exterior lighting, rain/fog, finish | scale, lighting hierarchy, atmosphere, compositing |
| `practical-material-detail` | portable practical prop, material response, lighting, camera detail grammar | material response, highlight control, practical plausibility |
| `character-crossing` | production character, integrated dress/hair, gait, camera motion, wet set continuity | silhouette, motion, continuity, screen-space framing |
| `threshold-resolve` | portable door/lantern props, environment/character interaction space, VFX, sound and finishing | continuity, atmosphere, compositing, audio hierarchy |

Build with `npm run video -- cinematic-campaign produce
campaigns/production-quality-reel/cinematic-campaign.yaml`. Compare its
generated contact sheet and short clips against the retained accepted baseline
identified in `docs/reviews/production-quality-scorecard-2026-09-02.yaml`.
Acceptance requires both the declared mechanical gates and an independent
review of the criteria in that scorecard; a passing render is evidence, not a
quality decision. The campaign does not publish assets: improvements belong in
their domain library only after their own provenance and transfer checks pass.

After a complete render, create a `quality-review.yaml` alongside this README
and verify it with `npm run video -- production-quality-reel-review
campaigns/production-quality-reel/quality-review.yaml`. That additive review
record binds SHA-256 values for the campaign manifest, retained scorecard,
every shot contact sheet, motion clip and render-gate report, plus the final
delivery/contact sheet/edit report. It must inspect all nine review criteria,
cite only bound evidence, preserve limitations, state the visible baseline
delta, and give a concrete repair whenever it rejects a result. An accepted
record fails validation unless the visible baseline delta is a material
improvement. This accompanies—rather than replaces—the normal cinematic
production review and its objective gates.

## Current build finding

The initial no-render build is deliberately retained as **rejected**. It stops
at the shared motion verifier because the pinned, immutable
`motion.walk-natural-cautious-elara@1.1.0` omits the
`left-upper-arm:rotation-euler` track required by the current whole-body gait
contract. This is a library contract/version-compatibility defect, not a reel
configuration error. Do not weaken the verifier, edit the immutable release,
or replace the performance with a proxy merely to produce a reel. A newly
verified whole-body motion release is required before rendering resumes.
