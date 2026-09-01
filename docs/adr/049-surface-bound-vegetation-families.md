# ADR 049: Surface-bound vegetation families

## Status

Accepted — 2026-09-01

## Context

Environment habitation needs living silhouettes as well as storage, architecture and signage. A useful vegetation subsystem must not fuse plants into one campaign set, treat one random species as universal, claim sloped placement from a constant Y value, or publish mechanically valid foliage that still reads as beads and sticks.

## Decision

Potted vegetation uses the existing explicit-version dressing-family contract. Each plant remains an independently reusable prop with a ground origin, pot rim, foliage crown, living-asset semantics and future wind-response anchor. Families compose those assets through authored clusters, bounded scale/yaw variation, required-variant coverage, navigation exclusions and geometry-bound surface queries.

The shared geometry layer now supplies a renderer-independent lanceolate leaf: a tapered, subtly bowed, optionally double-sided blade with stable UVs, normals and skeletal ownership. It replaces ellipsoid foliage proxies where a readable leaf edge and tip matter at medium distance.

The first family contains `prop.potted-fern@0.1.0` and `prop.potted-shrub@0.1.0`. The fern uses swept frond stems and repeated paired leaflets in a weathered terracotta planter. The shrub uses visible branching, broader three-tone foliage and a galvanized planter. Every transfer request requires both variants so cross-host evidence cannot accidentally prove only one silhouette.

## Verification and acceptance

The exact family is laid out on a historic courtyard sloped along X and an unrelated contemporary rooftop sloped along Z. Both surfaces measure 3.43 degrees. Acceptance reloads each live surface mesh, binds its identity to the request, regenerates the complete layout, compares persisted transforms and triangle/normal/slope evidence, checks required variants, validates member topology/material groups/attachments, executes every render gate and requires distinct landmark pixels plus qualitative review.

V1 passed mechanical gates but was rejected because ellipsoid foliage read as bead clusters. V2 introduced tapered leaves but was rejected because narrow, frequently edge-on foliage read as bare twigs and one host sampled only fern. V3 increases real compound-leaf area and density, brightens foliage separation, adds rooftop skyline context and enforces both variants per host. It passes at 45% and 61% maximum black coverage, 0% clipped whites and complete entity inspection coverage.

## Consequences

The published family is suitable for background/medium habitation in courtyards, terraces, interiors and streets. It is not botanically exact hero-close vegetation. Translucency, vein normals, damaged/seasonal variants, growth parameters, wind animation, animated support surfaces and soil-suitability semantics remain future capabilities.
