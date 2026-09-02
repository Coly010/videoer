# ADR 053: Renderer-independent cinematic finishing

## Status

Accepted.

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** a valid finishing pass;
byte-identical rerender required only where that identity has product value.

## Context

Blender scenes already use a controlled AgX view transform and 2D scene effects can add grain or vignette, but complete cinematic deliveries had no reusable finishing contract after 3D rendering and editorial compositing. Embedding an FFmpeg graph in one campaign would make the look non-searchable, non-versioned and impossible to invalidate through scene fingerprints. Applying a heavy global grade would also conceal weak lighting and materials instead of improving them.

## Decision

A cinematic finish is a bounded renderer-independent VFX profile containing tonal controls, a thresholded bloom, vignette and seeded temporal grain. It runs after Blender output and image overlays, before final edit assembly. Direct cinematic scenes declare `finishProfilePath`; declarative campaigns resolve local or verified-library `finishSources` and shots reference them by semantic ID. The production plan, asset manifest, canonical delivery filename and content fingerprint all include the finish dependency.

FFmpeg implements the current backend. Tonal temperature/tint uses luminance-preserving channel gains rather than the `colorbalance` filter. The latter was rejected after a real dark-scene transfer created severe shadow hue segmentation and a false blue central island. Output retains exact resolution, frame rate, frame count, duration and audio-stream topology. Acceptance independently rerenders every declared transfer and requires byte-identical H.264 output.

The profile is deliberately display-referred and bounded. It is not a LUT authoring system, a relighting mechanism, an HDR mastering path, or permission to repair deficient source exposure in post. Shot-specific colour direction remains upstream campaign/lighting/material work.

## Verification and evidence

`vfx.soft-atmospheric-finish@0.1.0` was evaluated against two unrelated verified sources: a square warm lime-plaster material turntable and a vertical cool rainy-depth scene. Iteration one crushed dark coverage and introduced a green-biased result. Iteration two isolated `colorbalance` as the shadow-segmentation defect. Iteration three uses restrained luminance-preserving colour gains and a reduced vignette; it preserves black/highlight bounds, source topology and practical-light separation.

The release is accepted for medium-distance short-form delivery. It is not certified for hero close-ups, HDR or skin-critical finishing. Source lighting, material response and atmosphere remain visible quality gates.

## Consequences

- Finishing profiles are immutable searchable production inventory rather than campaign-owned command strings.
- A profile change invalidates only the consuming scene pixels and dependent edit.
- 3D scenes, editorial overlays and declarative campaigns share one finishing boundary.
- Future profiles can add shot-distance-specific or HDR semantics without changing stored scene meaning.
- Weak source renders must still be rejected; a finish cannot serve as acceptance evidence for upstream lighting or material quality.
