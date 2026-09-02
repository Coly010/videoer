# Quality model

Two acceptance surfaces exist. Per [`docs/product-principles.md`](product-principles.md)'s
priority order, the first dominates the second.

## Primary: finished-video review

`src/quality/model.ts` exports `finishedVideoReviewSchema`; validate one with:

```bash
npm run video -- finished-video-review path/to/review.yaml
```

This is a whole-video, human/Codex qualitative review, not a per-subsystem audit. It answers one
question: **would this be a good marketing video?** It scores hook strength, visual quality,
shot-to-shot coherence, motion quality, pacing, typography readability, audio impact, message
clarity, and CTA quality (0–5 each); records a free-text `defects` list for obvious AI/rendering
problems; and requires an `economics` block naming the technique used, the iteration count so far,
and what visibly improved since the previous revision. `verdict` is one of `postable`,
`needs-revision`, or `rejected`.

Run this after every draft render, before deciding whether to iterate again, change strategy, or
ship. It is the highest-order acceptance surface in the project — a campaign with a `postable`
finished-video review is done, regardless of whether any asset was published to the shared library
or reused by another campaign.

## Secondary: subsystem engineering scorecard

`qualityScorecardSchema` (same file) remains for diagnosing a specific subsystem's engineering
readiness (e.g. "is the lighting-rig derivation contract holding up across environments?"). Its
`transfer` and `reuseOutsideBenchmark` score fields are now **optional** — reuse is useful evidence
when you have it, not a required dimension. Validate one with:

```bash
npm run video -- quality-scorecard validate path/to/scorecard.yaml
```

Existing scorecards (e.g. `docs/reviews/production-quality-scorecard-2026-09-02.yaml`) remain valid
historical evidence about the Blender cinematic subsystem's internal state. Read them as
engineering diagnostics, not as the definition of whether Videoer is producing good videos —
`projects/the-rise-of-demons` shipped a good finished video while scoring on none of these
dimensions, because it used a completely different, simpler technique.

## What this replaces

Before [ADR 072](adr/072-pragmatic-production-realignment.md), the subsystem scorecard's `transfer`
and `reuseOutsideBenchmark` dimensions were mandatory and weighted equally with visual/temporal
quality, and ADR 028 required cross-campaign transfer for "general-system acceptance." Neither is
required any more. Reuse is still worth capturing when it happens — it just no longer gates
whether a campaign, or the system, counts as working.
