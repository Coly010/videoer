# ADR 046: Layered projecting canopy systems

## Status

Accepted — 2026-09-01

## Context

The old-city environment's projecting eave helper produced one axis-aligned box and four capsule braces. It improved an early silhouette but did not represent roof fall, covering, underlay, soffit assembly, flashing, fascia, a measurable load path, drainage composition, practical-light mounting, host clearance, or reusable asset identity.

## Decision

Projecting canopies are portable, layered architectural props with renderer-independent construction, drainage, host, and composition contracts.

The shared geometry layer now extrudes validated convex Y/Z profiles along X. This creates actual wedges and sloped panels without renderer-specific mesh modifiers and is reusable for roofs, beams, fascia, flashings, sills, and housings.

`prop.projecting-supported-canopy` contains a sloped timber structural deck, continuous weather underlay, fifty staggered overlapping physical slate pieces in four rows, seven separated soffit boards, timber fascia, metal wall flashing, and three double-rail iron support paths. It exposes wall mounts, front-edge anchors, compatible rainwater mounts, underside practical-light anchors, and a focus point.

The roof contract records fall, run, gradient, direction, and front discharge edge. The host contract requires a vertical facade, clear wall span, mount-height range, and unobstructed projection volume. A canopy does not silently include drainage or lighting fixtures: campaigns compose separately verified rainwater and practical assets through the named anchors.

## Verification and acceptance

The exact portable geometry is rendered at elevated, low frontal, and glancing production-clean Cycles landmarks against old-city plaster/timber and contemporary gallery concrete/steel hosts.

V1 was rejected because the frontal witness occupied 99.8% of frame width against a three-percent margin and the claimed slate covering still read as one smooth sheet. V2 widens only that camera and adds physical staggered slate inventory over the underlay.

Acceptance reopens the live mesh and welds coincident vertices for connected-component analysis. It requires the declared number of independent slate components plus the continuous underlay rather than trusting `roofTileCount`. It recomputes drainage gradient from fall/run, verifies layered construction and every wall/rainwater/practical attachment, checks both hosts' span/height/clearance, requires exact geometry reuse, hashes distinct frames, executes all gates, and requires qualitative review.

## Consequences

Later environments can assemble a facade from independently versioned wall openings, canopy, rainwater hardware, signage, and practical lights. The canopy is accepted for background/medium use only. Tile chips, fasteners, bracket welds, flashing folds, timber joinery, engineering loads, snow, standing water, and damage remain future capabilities.

The old axis-aligned eave helper remains legacy environment geometry until the bookshop is migrated to placed library instances. It must not be treated as equivalent to this asset.
