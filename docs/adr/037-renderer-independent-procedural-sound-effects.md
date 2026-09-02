# ADR 037: Renderer-independent procedural sound-effect assets

## Status

Accepted.

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** a valid technique; a supplied
or generated sound is equally acceptable when cheaper or better for the shot.

## Context

Videoer could render deterministic soundtrack plans and derive complete audio treatments, but its benchmark door and page cues were generic filtered white-noise intervals embedded inside one score. They were not isolated inventory, could not carry action synchronization points, and could not be independently searched, adapted, verified, or reused. A verified soundtrack therefore did not prove a reusable sound-effects pipeline.

## Decision

Sound effects use a renderer-independent recipe containing exact duration, 48 kHz stereo delivery, target peak, project-owned metadata, and ordered deterministic layers. Initial layer primitives are:

- band-limited white, pink, or brown noise with envelope, pan, and amplitude modulation;
- sine or triangle resonances with optional pitch sweep; and
- seeded stochastic impulse trains with decay and frequency variation.

The project-owned renderer synthesizes samples directly, uses cascaded high/low-pass stages, equal-power stereo panning, exact sample-domain envelopes, peak normalization, and deterministic 24-bit PCM encoding. Verification rerenders from the live recipe and requires an identical SHA-256, exact RIFF/WAVE byte length, declared duration/channels/sample rate, non-silent RMS, and target peak. FFmpeg creates waveform and logarithmic spectrogram evidence; it does not own the recipe semantics.

Each candidate is an isolated `audio` asset with its recipe, WAV master, synchronization metadata, verification report, waveform, and spectrogram. Generated candidates remain `validated` and carry `auditory.generated-not-accepted` until listening review explicitly accepts their material identity, scale, dynamics, and mix usefulness.

## Rejected approaches

- Continue embedding noise bursts inside campaign scores: rejected because it prevents isolated reuse and disguises generic synthesis as action-specific foley.
- Depend on a commercial sound library: rejected because it would make production rights and machine setup conditional on a paid catalogue.
- Treat determinism and a plausible spectrogram as auditory acceptance: rejected because structural evidence cannot prove that a door, page, rain bed, or footstep sounds convincing.
- Keep one-pole filters: rejected after the first spectrograms exposed excessive broadband leakage above the declared material bands. The renderer now cascades four stages.

## Consequences

The initial candidate set contains rain on stone, a wooden door opening, a parchment page turn, and a wet-stone footstep. They establish reusable synthesis, timing, evidence, and library contracts; none is published until auditory review. Future campaigns may place these masters through ordinary `audio-source` cues, and future recipe layers may add convolution, spatial distance, or captured project-owned impulses without changing campaign semantics.
