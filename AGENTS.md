# Repository agent instructions

## Required system capabilities

Videoer is a media application. Treat the documented runtime and media dependencies as requirements, not optional conveniences.

- Before implementing a workaround for a missing binary, codec, decoder, encoder, or FFmpeg filter, compare the machine with the requirements in `README.md` and run `npm run video -- doctor`.
- If an expected system capability is absent, install or repair the documented dependency when the user has authorized system changes, then update the installation guide if the requirement was unclear.
- Do not silently reduce output quality, skip media inputs, substitute placeholder rendering, or build a parallel implementation merely because the local FFmpeg build is minimal.
- Cross-platform fallback behavior must be an explicit product decision backed by an ADR and tests; it must not arise accidentally from one developer machine.
- Keep deterministic rendering and verification provider-free. Generative providers may create persisted inputs, but rendering must never invoke them.

On macOS, Videoer expects Homebrew `ffmpeg-full`, linked ahead of the minimal `ffmpeg` formula. The doctor command is the authoritative capability check.

Remotion's pinned Chrome Headless Shell is also required. Install it with `npx remotion browser ensure`; do not replace browser composition with a lower-fidelity renderer when it is missing. Keep all Remotion packages and the Remotion-compatible Zod release exact-version aligned.
