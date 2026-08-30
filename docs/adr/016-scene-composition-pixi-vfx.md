# ADR 016: Renderer-independent scene composition and PixiJS VFX

Status: Accepted

## Context

Image motion and scene-keyframe blends create progression but cannot independently move a subject, foreground, atmosphere, particles, illumination, and typography. Encoding those concepts as React components in the storyboard would couple persisted campaigns to one renderer and make dense particle effects expensive.

## Decision

Add an optional `scene` shot with renderer-independent layers, effects, camera, depth, timing, transforms, masks, blend modes, and filters. Existing shots remain valid. Remotion continues to own timeline orchestration and final rendering.

Use a registry to route ordinary layers to React/Remotion and dense procedural 2D layers to PixiJS 8. Pixi was evaluated in the real pinned Chrome Headless Shell. Its retained Graphics API, transparent canvas composition, blend model, and WebGL batching fit particles and 2D VFX. Headless Chrome required explicit ANGLE mode; with ANGLE and `preserveDrawingBuffer`, representative Pixi frames render deterministically. Pixi is restricted to WebGL so an unavailable GPU adapter fails clearly instead of silently changing output.

Particle state is calculated by a pure seeded engine from storyboard, seed, time, and configuration. Presets are bounded data configurations. Depth controls ordering and camera-parallax magnitude. Screen depth remains camera-stable for typography.

## Consequences

Scenes are reusable for cinematic and product marketing. Rendering stays provider-free and repeatable. Pixi is an adapter, not an application model. A later Three.js backend can be registered for genuine 3D needs without migrating storyboards. One transparent GPU canvas is used per dense layer; particle counts are pooled and bounded. Visual fixtures and five-point frame extraction are required alongside logic tests.
