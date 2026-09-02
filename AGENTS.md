# Repository agent instructions

## Product policy

The durable product policy lives in [`docs/product-principles.md`](docs/product-principles.md).
Read it before making architectural decisions. In short:

- **Finished-video quality first.** Optimise for good-looking marketing output per unit of cost
  and effort; a good video that ships beats a pure abstraction that doesn't.
- **Pragmatic tool selection, not renderer independence.** Tool lock-in, backend-specific code,
  and campaign-specific solutions are all acceptable. Renderer independence is not a universal
  requirement — using Blender's (or any tool's) native representation directly is valid.
- **Cinematic production remains first-class.** Fantasy trailers, thriller/romance, atmospheric
  promos, and full 3D production are not being deprecated; they just don't have to be the centre
  of the architecture.
- **Reuse and generalisation are optional optimisations, decided after the fact** — never a
  precondition for shipping a campaign. Do not require cross-campaign transfer, publication, or
  benchmark conformance for a campaign to be considered done.
- **Switch strategy after two failed attempts on the same visible problem** using the same
  approach — see the iteration-economics section of the product policy.
- **Do not create new architecture/abstraction without demonstrated value** (see the
  architecture-creation threshold in the product policy). A bug fix or one shot doesn't need a
  reusable subsystem.

See [`docs/adr/README.md`](docs/adr/README.md) for which historical ADRs remain fully current
versus narrowed by [ADR 072](docs/adr/072-pragmatic-production-realignment.md).

## Surface rendered visual evidence in the final summary

When a task renders anything used to judge the work visually — a final/draft MP4, a contact sheet,
sampled PNG frames, a per-shot preview — the task's closing summary **must list the path to each
artifact you actually looked at**, so the operator can open it and see for themselves. This is the
finished-video-quality-first policy in practice: "it rendered and passed the gates" is not a
substitute for the operator being able to watch the result.

- Give the real path (repo-relative, or absolute for local-only files). The terminal renders paths
  as clickable. Most render output lives under the git-ignored `work/`, `projects/`, or a scratch
  directory and is local-only — that is expected; the operator is on the same machine.
- Link the specific frames/sheets/clips that back up your claims, not just the run directory. If
  you assert "the walk reads correctly," point at the exact frames that show it.
- Prefer the assembled MP4 or a contact sheet over loose frames when one exists, because motion and
  pacing only show up in the moving/whole-video artifact.

## Required system capabilities

Videoer is a media application. Treat the documented runtime and media dependencies as requirements, not optional conveniences.

- Before implementing a workaround for a missing binary, codec, decoder, encoder, or FFmpeg filter, compare the machine with the requirements in `README.md` and run `npm run video -- doctor`.
- If an expected system capability is absent, install or repair the documented dependency when the user has authorized system changes, then update the installation guide if the requirement was unclear.
- Do not silently reduce output quality, skip media inputs, substitute placeholder rendering, or build a parallel implementation merely because the local FFmpeg build is minimal.
- Cross-platform fallback behavior must be an explicit product decision backed by an ADR and tests; it must not arise accidentally from one developer machine.
- Keep deterministic rendering and verification provider-free. Generative providers may create persisted inputs, but rendering must never invoke them.

On macOS, Videoer expects Homebrew `ffmpeg-full`, linked ahead of the minimal `ffmpeg` formula. The doctor command is the authoritative capability check.

Remotion's pinned Chrome Headless Shell is also required. Install it with `npx remotion browser ensure`; do not replace browser composition with a lower-fidelity renderer when it is missing. Keep all Remotion packages and the Remotion-compatible Zod release exact-version aligned.
