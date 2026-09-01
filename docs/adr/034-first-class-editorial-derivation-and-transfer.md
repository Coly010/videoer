# ADR 034: First-class editorial derivation and transfer

## Status

Accepted.

## Context

Videoer could generate campaign-local text overlays and resolve reviewed images, but it could not derive, verify, publish, and transfer an editorial identity as a first-class asset. Recreating a title card in each campaign loses lineage and can silently change the font, motif, safe area, contrast, or copy layout. Hashes alone are insufficient because a broken producer can rewrite an altered PNG, its treatment JSON, its report, and all declared hashes together.

## Decision

`editorial` is a first-class asset kind with an immutable library directory and `transparent-overlay` artifact role. Existing verified `material` packages containing title treatments remain readable parents; new derived treatments publish as editorial assets.

`editorial-treatment-v1` is a bounded renderer-independent derivation. It may declare a new canvas, safe-area margins, eyebrow/title/call-to-action copy, palette, motif opacity, typography scale, and metadata. It must preserve the parent's exact font contract and motif kind. Canvas, copy, margins, opacity, and typography scale have explicit schema bounds.

The deterministic renderer produces both the transparent composited overlay and independent text layers. Verification performs a second byte-identical render, measures each line's alpha bounds, requires every line to remain inside the declared safe area, enforces foreground/background contrast of at least 4.5 and accent/background contrast of at least 3, and records the exact font-file digest.

Publication embeds and hashes the campaign source, treatment, overlay, compatibility report, and rendered evidence. Approval compares the candidate with the current on-disk campaign declaration, reloads the immutable parent, recomputes the expected treatment, resolves the live font, independently rerenders the overlay, and repeats layout and contrast measurement. Rewriting the PNG, treatment, report, and their hashes cannot authorize a different identity. If the campaign source changes after candidate creation, the candidate must be rebuilt.

## Rejected approaches

- Keep editorial as campaign-local drawtext: rejected because it prevents identity-level lineage, publication, and unchanged cross-deliverable reuse.
- Treat the PNG alone as the source of truth: rejected because pixels do not retain the semantic copy, typeface, motif, or safe-area contract needed for adaptation.
- Trust hashes and compatibility flags: rejected because both can be rewritten around altered content.
- Reuse one font size at every resolution: rejected after the first Nocturne render was mechanically valid but visually undersized. The shared responsive layout factors were corrected and reverified instead of accepting weak typography or adding a campaign-only override.
- Permit arbitrary font or motif replacement during adaptation: rejected because that creates a new identity rather than a bounded derivation.

## Consequences

The Nocturne exhibition campaign derives and publishes `editorial.nocturne-event-lockup@1.0.0` from the verified legacy `material.rise-of-demons-title-treatment@0.1.1` parent. The published 480×270 overlay preserves Cormorant Garamond and the threshold-line motif while carrying new event copy, palette, safe-area, contrast, and deterministic-render evidence.

The separate four-second Nocturne programme-announcement campaign resolves that release unchanged (`reusedEditorialSources: 1`, `adaptedEditorialSources: 0`) and combines it with new geometry, camera, timing, and audio plus the independently reusable Nocturne lighting rig. Its exact 96-frame delivery passes camera-clearance, visibility, codec, pixel-format, frame-rate, duration, and audio checks with zero bespoke orchestration source files.
