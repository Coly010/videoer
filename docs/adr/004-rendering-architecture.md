# ADR 004: Rendering architecture

Status: Accepted

## Decision

Application operations validate a storyboard and resolve a style template into a render plan. Shot renderers later map domain shot types to Remotion components. FFmpeg handles probing, audio, and delivery encoding. Storyboards contain no React trees.

## Consequences

Rendering is deterministic and provider-free. Remotion and FFmpeg remain replaceable adapters around a stable domain contract.
