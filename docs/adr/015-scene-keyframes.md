# ADR 015: Scene keyframes for evolving cinematic shots

## Status

Accepted.

## Decision

Add `scene-keyframes` as an additive storyboard/render mode. A scene shot owns two to four ordered keyframes, one anchor, continuity locks, shot-level blend/camera/atmosphere instructions, and per-keyframe generation revisions. Generative providers create persisted inputs sequentially with the anchor/latest frame passed as references. Remotion deterministically blends those inputs; it never invokes a provider.

The cinematic template prefers this mode for scene intents with two or more action beats. Mechanical verification detects missing inputs, weak continuity plans, absent progression, and cinematic storyboards composed only of single stills. Qualitative continuity still requires visual inspection.

## Rationale

Single images with Ken Burns motion are useful for establishing tableaux but cannot express a creature emerging, ritual energy building, or character action changing inside one shot. Splitting every moment into unrelated image shots produces a polished moodboard rather than a coherent trailer. A small keyframe sequence preserves the existing editable storyboard abstraction while adding scene evolution and selective regeneration.

## Alternatives considered

- Prompt single stills more aggressively: inexpensive, but cannot create temporal action.
- Make image-to-video mandatory: potentially fluid, but provider-specific, expensive, less reproducible, and unsuitable for deterministic rendering.
- Encode arbitrary Remotion component trees in storyboards: flexible, but breaks the stable domain/renderer boundary.
- Automatically use optical flow/depth/masks: promising later, but those inputs and capabilities are not consistently available today.

## Consequences

Campaigns remain backward compatible. Scene shots require more generated assets and qualitative review. Crossfade/parallax behavior is available everywhere; authored masks, true depth warping, optical flow, and automatic semantic continuity scoring remain future extensions rather than silent platform-dependent fallbacks.
