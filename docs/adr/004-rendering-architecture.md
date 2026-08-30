# ADR 004: Rendering architecture

Status: Accepted

## Decision

Application operations validate campaign/storyboard identity and resolve a style template into a render plan. A Remotion composition maps the domain shot types, supplied local assets, timing, motion presets, typography, CTA treatment, and transitions to frames. Remotion renders H.264/AAC MP4s through its pinned browser runtime. FFmpeg-full handles capability diagnostics, probing, sampled-frame extraction, contact sheets, and delivery verification. Storyboards contain no React trees.

## Consequences

Rendering is deterministic and provider-free. Drafts use reduced dimensions while finals use campaign delivery settings. Remotion and FFmpeg remain replaceable adapters around a stable domain contract. The full system requirements are explicit and diagnosed rather than silently degraded.
