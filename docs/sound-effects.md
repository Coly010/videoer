# Procedural sound effects

Create the project-owned candidate library with:

```bash
npm run video -- audio create-sfx-library work/production-sfx-candidates
npm run video -- audio create-sfx-audition work/production-sfx-candidates work/sfx-audition
```

Every candidate contains:

- `sound-effect-recipe.json`: renderer-independent layers and synchronization metadata;
- a deterministic 48 kHz stereo 24-bit WAV master;
- a byte-identical rerender report;
- a waveform; and
- a logarithmic spectrogram.

Recipes are defined in `src/audio/sound-effect-presets.ts` and rendered by `src/audio/sound-effect.ts`. Use layered noise, resonance, and impulse primitives to describe the audible event. Keep action landmarks such as latch, movement, impact, heel, or page-settle times in metadata so a campaign can align the isolated master to animation without baking campaign timing into the asset.

`create-sfx-audition` places the isolated effects in a stable eight-second miniature scene. It records the plan, cue timing, source hashes, byte-identical rerender hash, waveform, and spectrogram. This is an auditory-review fixture, not an automatic acceptance mechanism: its report remains `not-accepted` until a listener judges material identity, scale, balance, repetition, and usefulness in context.

Do not publish a candidate merely because its hash, duration, waveform, and spectrogram pass. Listen to the isolated master and in at least one representative mix. Reject synthetic buzzing, broadband hiss, wrong material scale, excessive transients, masking, or a sound that only works in the benchmark. Once accepted, publish it through the ordinary immutable asset workflow and use it from soundtrack plans as an `audio-source` cue.

## Mix review record

Use `soundMixReviewSchema` from `src/audio/review.ts` to record a listener's decision for a published audio asset. The record binds the review to an immutable master hash, its provenance record, the deterministic soundtrack-plan ID/hash, and distinct isolated, integrated, and motion evidence. Its validator also ensures every cue claimed by hierarchy, masking, spatial depth, sync, continuity, or material-identity findings exists in the plan.

An accepted review must show controlled masking, credible material identity, unbroken continuity, and sync within its recorded tolerance. It complements render hashes and loudness checks: the reviewer remains responsible for hierarchy, scale, spatial depth, and reuse beyond one campaign.

The first generated set is intentionally `validated`, not `verified`. The v1 one-pole filter experiment is rejected evidence: its door and footstep spectrograms leaked excessive broadband energy. The current renderer uses four cascaded high-pass and low-pass stages before candidate regeneration.
