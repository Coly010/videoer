# ADR 035: Autonomous campaign production loop

## Status

Accepted — 2026-08-31

## Decision

`cinematic-campaign produce` is the campaign-level control plane. It validates the request, writes a renderer-independent production plan before construction, resolves reuse/adapt/create requirements, builds assets and executable scenes, fingerprints every scene plus its live geometry/motion/editorial dependencies, renders only stale or explicitly requested shots, runs objective inspection, assembles only from passing shots, and persists a resumable `production-run.json` ledger.

Each shot has two content identities. `renderInputSha256` covers only pixel-affecting scene data and live artifact bytes. `inputSha256` additionally covers landmarks, quality gates, render gates, overlay semantic IDs, and review metadata. A render-hash change or missing/tampered video invokes the final renderer. An evidence-only change invokes Blender in `inspect-only` mode to rebuild evaluated projected bounds and camera evidence, extracts the new semantic frames from the unchanged video, reruns all objective gates, and invalidates qualitative review without touching pixel media or reassembling the edit.

Objective success does not imply creative acceptance. `cinematic-campaign review` requires a hash-bound accountable review of every shot and the complete delivery across framing, motion, continuity, lighting, editorial, pacing, audio, and composition. Any failing dimension requires a concrete repair. Only a complete current-hash pass sets `completed` and `publish-ready`.

Authoritative cinematic renders use the scene's explicit `cycles-cpu` `deterministic-final` profile: fixed seed, non-animated sampling, lossless PNG frames, and project-owned single-thread x264/AAC assembly with normalized metadata. Eevee Next is available only as an explicitly declared preview profile. On Blender 4.5.13/Apple Metal, Eevee's virtual-shadow-map path changed decoded pixels across identical independent renders; disabling shadows was rejected. Fixed-seed multithreaded Cycles CPU produced identical decoded pixels across processes and thread counts while retaining shadows and final quality.

Semantic review claims must be executable where possible. Named `overlay-visibility` gates bind overlays to review landmarks and minimum effective opacity. The renderer fails when copy is absent or still inside a fade at a landmark, preventing prose labels from claiming evidence the pixels cannot contain.

## Consequences

- A no-op resume performs no Blender render and preserves an accepted review only when source, scene dependencies, edit inputs, and evidence remain current.
- A local repair rerenders only affected shots and reuses passing peers byte-for-byte.
- Landmark, gate, or review-metadata changes refresh evidence without paying for a pixel render.
- Live video hashes are persisted; missing or changed media cannot enter the evidence-only path.
- Renderer changes invalidate scene fingerprints once, as they should.
- Final rendering is slower than Eevee preview rendering. Selective repair and content-addressed reuse contain that cost without weakening quality.
- Provider calls remain outside planning, rendering, inspection, repair, assembly, and review.

## Evidence

The unrelated Nocturne programme announcement completed the loop and then resumed with zero stale/rendered shots. Atelier Vessel initially rendered two shots, later rerendered only `atelier-identity` while preserving `vessel-form`, and completed a hash-bound review. Two independent full Cycles renders produced identical SHA-256 values for base (`acf08e…`), editorial composite (`8413d0…`), and delivery (`7cc14e…`) files; the reused peer remained `d26552…`. A subsequent landmark-only edit refreshed one shot's evidence in 0.98 seconds and its restoration in 1.06 seconds, with zero pixel renders and unchanged hashes/mtimes for all four MP4s.
