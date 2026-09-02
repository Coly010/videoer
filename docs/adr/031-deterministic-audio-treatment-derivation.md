# ADR 031: Deterministic non-speech audio treatment derivation

## Status

Accepted.

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** a valid reusable derivation;
byte-identical rerender is required only where byte identity itself has product value.

## Context

Videoer could create a campaign-local procedural soundtrack or reuse a verified WAV unchanged, but it could not derive and publish a new non-speech treatment from a verified score. Adding an ad hoc FFmpeg graph to one product trailer would have produced sound without a reusable parameter contract, protected parent lineage, independent semantic approval, or downstream reuse.

Audio integrity is not proved by container metadata alone. A forged candidate can retain duration, codec, sample rate, channels, and plausible loudness while changing its selected source interval, dynamics, filter intent, or synchronized accents.

## Decision

`cinematic-audio-treatment-v1` is a renderer-independent declarative derivation. It specifies:

- the exact verified parent asset and artifact role;
- a sample-bounded source interval and output duration;
- high-pass and low-pass bounds;
- gain, compressor threshold/ratio/attack/release, and stereo width;
- fade intervals, integrated-loudness target, and true-peak ceiling; and
- optional tonal or deterministically seeded noise accents with exact 48 kHz start/end sample positions.

The open-source FFmpeg runtime renders 24-bit PCM at 48 kHz stereo. The compatibility report records parent/output SHA-256 hashes, the normalized treatment, container evidence, selected-interval duration error, temporal-envelope correlation, onset/end deltas, activity fraction, RMS/sample peak, exact accent samples, and each accent's interval-local contribution relative to a deterministic base-only render.

Verification fails closed unless:

- the selected interval exists in the parent;
- output duration is exact to one sample;
- output is stereo 48 kHz 24-bit PCM and not silent;
- peak remains within the declared safety tolerance;
- source and output temporal envelopes correlate by at least 0.72;
- meaningful onset and ending positions remain bounded;
- every accent is sample-aligned and contributes at least 3 dB above outside-interval render difference; and
- an independent re-render from the live verified parent is byte-identical to the candidate.

Approval does not trust candidate hashes or reports alone. It resolves and validates the immutable parent, verifies the declared parent/output hashes, parses the treatment schema, and repeats the complete render and semantic comparison before writing review state.

The doctor command checks every FFmpeg filter required by the contract: `highpass`, `lowpass`, `acompressor`, `extrastereo`, `loudnorm`, `afade`, `adelay`, `amix`, `apad`, `atrim`, `aresample`, and `aformat`. A minimal FFmpeg build is not an acceptable fallback.

## Rejected approaches

- Campaign-specific FFmpeg filter graphs: rejected because their intent, bounds, and lineage cannot be resolved or reused as assets.
- Container, duration, and loudness checks alone: rejected because semantically altered audio can preserve all three.
- Trusting a compatibility report plus rewritten hashes: rejected by a regression that changes gain semantics, rewrites the audio/report/asset hashes, and still fails the independent re-render.
- Filter-only adaptation: rejected after the first Beacon One spectrogram retained a broad bed but added no explicit product beats. The shared contract gained declared, sample-aligned accent layers and measurable contribution gates.
- Millisecond delay rounding: rejected for frame/sample-exact work. Accent delays are expressed as integer 48 kHz samples.
- Provider-based mastering or commercial audio tools: rejected because deterministic rendering and verification must remain local, provider-free, and commercially unencumbered.

## Consequences

Beacon One derives and publishes `audio.beacon-one-product-pulse@1.0.0` from `audio.rainy-bookshop-score@0.1.0`. Its nine-second treatment preserves a 0.872 temporal-envelope correlation and adds two sample-aligned accents whose measured interval-local contributions are 47.5 dB and 43.2 dB above outside-interval difference. Its exact 216-frame product delivery passes.

The unrelated Last Platform multi-character film resolves that immutable audio release through ordinary capability search, performs zero audio adaptation, and produces a separate 16:9 216-frame delivery with all gates passing. Thus the benchmark did not own the feature, the creating campaign does not own the renderer, and the consuming campaign requires no copied filter graph.
