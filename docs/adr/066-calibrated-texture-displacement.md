# ADR 066: Calibrated texture displacement

- Status: accepted
- Date: 2026-09-02

## Context

Hash-bound material sources preserve provider displacement bytes, but a normalized height image does not establish its physical amplitude or neutral midpoint. The Blender texture path nevertheless hard-coded a `0.5` midpoint and used `surface.normal.scaleMeters` as displacement amplitude. That field describes normal-feature spacing, not height. A source with good maps could therefore inflate or recess geometry by an unrelated value while still appearing provenance-complete.

## Decision

A hash-bound texture set containing a displacement channel must carry exactly one explicit renderer-neutral response:

- `disabled-uncalibrated` preserves the source channel and a nonempty rationale but cannot connect it to Material Output;
- `calibrated` declares positive `amplitudeMeters`, a `0..1` midpoint, `higher-values-outward`, and evidence whose basis is provider declaration, measured reference or project calibration.

The signed-height contract is `signed metres = (sample - midpoint) * amplitudeMeters`. Calibrated amplitude cannot exceed the source tile's largest physical dimension. A response without a displacement channel and a channel without a response both fail validation. No migration infers calibration from normal scale, provider lateral dimensions or filenames.

Blender keeps normal strength independent, links only calibrated displacement, reports the exact policy/formula/defaults, and enables combined bump/displacement where supported. Construction-response displacement continues to chain an existing texture displacement rather than replacing it.

## Consequences

- Existing materials without displacement are unchanged.
- Existing displacement-bearing derived materials must be regenerated with an explicit calibrated or disabled policy.
- Native Blender proves a deliberately divergent `0.003 m` amplitude, `0.43` midpoint and `0.7` normal strength, plus a disabled source whose bytes remain registered but whose displacement is not enabled.
- Wet/dry response cannot change displacement calibration or source identity.
- This closes an unsafe rendering ambiguity; it does not itself make the current environment probes photorealistic.
