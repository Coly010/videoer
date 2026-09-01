# ADR 026: One continuous exterior/interior bookshop set

## Status

Accepted on 2026-08-30.

## Context

The benchmark cuts from a rainy street to a door crossing and warm interior. Separate exterior and interior assets would make the door, window, threshold, character path, and lighting continuity implicit and fragile. A generic exterior turntable also cannot prove that an opaque building contains a usable aligned interior.

## Decision

- The old-city street, bookshop facade, door/window openings, threshold, interior floor/walls, counter, and shelves share one right-handed Y-up metre coordinate system.
- Named attachments define the door anchor, window gaze target, exterior path endpoints, door approach, interior threshold, reading position, and interior camera.
- The set is project-owned, deterministic, and open-ceiling for cinematic camera and light access. Open-backed framed shelves provide readable scale without blocking the interior.
- Environment verification uses dedicated street, three-quarter, threshold, interior-facing, facade-facing, and overhead continuity cameras. Generic exterior-only turntables are insufficient.
- The door action starts at negative Z, rotates the actor toward positive Z, resolves hand IK through the inverse actor scene transform, opens inward, and verifies that the passage ends on the interior side.

## Consequences

The `street` and `shop-interior` production requirements resolve to one immutable environment asset, preventing spatial drift. Shot renderers may add production dressing and lighting, but cannot relocate the door/window or invent a disconnected interior.
