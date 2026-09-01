# ADR 036: Deterministic Blender render profiles

## Status

Accepted — 2026-08-31

## Decision

Cinematic scene contracts declare a render profile. Named policies prevent campaigns from inventing machine-specific settings: `standard` is 64 samples without denoising, `production-clean` is 128 samples with CPU OpenImageDenoise, and `hero-clean` is 256 samples with CPU OpenImageDenoise. All three use fixed seed 1729, animated and adaptive sampling disabled, lossless PNG interchange, output dithering disabled, and deterministic project-owned FFmpeg encoding. `production-clean` is the default for newly authored scenes. `eevee-next` is permitted only with `intent: preview`; its output must not be treated as content-addressable final evidence.

The `production-clean` policy was accepted after a same-scene gallery witness comparison on 2026-09-01. A 64-sample baseline was rendered once and the 128-sample/OIDN candidate was rendered twice in fresh Blender processes. Candidate videos and all semantic frames were byte-identical across the two runs. Visual review found substantial removal of speckled sampling noise from the dark wall, floor, and glossy reflections while preserving hard silhouette edges, deliberately faceted geometry, material separation, reflection shapes, and key/fill/rim intent. Evidence is retained under `campaigns/reference-cinematic-benchmark/work/render-profiles/gallery-production-clean-v1`.

This is a render-tier decision, not a shadow or quality downgrade. Investigation isolated Blender 4.5.13 Eevee Next variation to the Metal shadow path: shadow-enabled independent renders changed decoded pixels, while shadow-disabled controls were pixel-identical. Removing shadows was rejected. The supported Cycles CPU path retained the scene's shadows and produced identical decoded pixels at 64 samples across independent processes and between one-thread and automatic multithread execution.

## Installation impact

New machines must run Blender with the required host access, run `video doctor`, and complete an actual fixed-seed Cycles render probe. A successful Eevee preview or `blender --version` is not final-render acceptance. Preserve the Blender version, render profile, seed, samples, and output hashes in evidence when diagnosing drift.
