# ADR 048: Geometry-bound surface placement

## Status

Accepted — 2026-09-01

## Context

The first semantic dressing family correctly preserved navigation corridors, spacing, explicit member versions and deterministic authored clusters, but every request supplied one constant `groundY`. That made placement truthful only on a flat plane. Claiming support for courtyards, ramps, embankments, roofs, rubble or terrain from a slope-limit metadata field would not have proved where an instance actually touched live geometry.

## Decision

A non-flat dressing request declares a `triangle-mesh` surface query with the exact geometry asset ID, maximum accepted slope, normal-alignment policy and vertical offset. The runtime provider is bound to the same geometry identity; a declaration/provider mismatch fails before placement.

The provider transforms live geometry into world space, casts each requested X/Z point through the actual triangles, selects the highest upward-facing hit, and returns height, normal, triangle index and measured slope. Cluster placement rejects missing support and slopes beyond the declared limit. Accepted instances persist the supporting geometry identity, triangle index, normal and slope alongside their ordinary renderer-independent transform.

Normal alignment is derived from a stable quaternion that first maps canonical up onto the surface normal and then applies authored yaw around that normal. Flat requests retain the existing constant-ground path and output contract.

## Verification

The deterministic test fixture uses a two-triangle courtyard ramp with an analytically known 0.2 rise per metre. It verifies queried height, 11.31-degree slope, out-of-bounds failure, deterministic repeated family output, non-flat transforms, supporting-triangle evidence, required-provider failure and declared-versus-live geometry identity rejection.

The first intended production consumer is the potted-vegetation family. Its rendered cross-host acceptance remains separate: mathematical contact is necessary but does not prove a believable planted scene.

## Consequences

Environment families can now grow beyond flat storage layouts without renderer-specific ray casting or unverified height metadata. The current query targets static geometry. Animated/deforming ground, overhang preference, soil-depth suitability, foot/leg adaptation, geospatial terrain streaming and physics settling remain future contracts rather than implicit claims.
