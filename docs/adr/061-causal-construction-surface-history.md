# ADR 061: Causal construction-surface history sidecars

## Status

Accepted for incremental implementation.

## Context

Unit-local value variation and edge/dirt masks cannot explain metre-scale construction history. Traffic follows routes, shelter changes rain exposure, runoff transports material, and repairs have explicit footprints and dates. Baking these signals into paving vertices would also create a content-addressing cycle: the verified water field binds the exact receiver bytes, while surface history derives from that water field. Adding derived attributes to the receiver would immediately stale its source.

## Decision

Persistent construction history is a renderer-independent, content-addressed sidecar over the exact verified surface-water grid. It does not mutate receiver geometry and does not recompute shelter or drainage. Version 1 stores separate bounded causal channels:

- traffic wear from explicit local-space pedestrian or wheel paths;
- long-term exposure copied exactly from verified water exposure;
- runoff staining derived from verified runoff, edge retention and ponding with explicit reference depth and weights;
- repair influence and relative age keyed to live paving repair IDs.

The field binds the exact water semantic hash, receiver file/semantic hashes, transform, grid and row-major cell topology. Profiles carry a reference date, installation age, explicit path geometry and equivalent passes, path width/falloff and wear response, repair ages, and runoff normalization. Traffic uses a bounded four-sigma lateral kernel and saturating dose response. This is declared cinematic construction-history evidence, not inferred human movement or a calibrated civil-engineering prediction.

`SurfaceMaterial.historyResponse` is separate from broad object-space `weathering`, construction-local `unitVariation`, and transient `surfaceWaterResponse`. It maps each causal channel independently to bounded colour and roughness changes. Blender consumes the sidecar before copying the receiver materials for transient wet optics. Renderer identities do not enter the persistent field.

Future versions will extend the causal state rather than collapse it into one grime scalar: directional exposure, drainage distance, loose and persistent dirt mass, washoff/export balance, pedestrian and twin-wheel pass density, event-led repair ledgers, and temporal samples remain separate planned channels.

## Verification

Acceptance requires:

- byte-identical fields for identical inputs and rejection of forged hashes;
- exact source-water and receiver identity, transform, grid and cell-topology checks;
- finite `[0, 1]` channels, unique paths/repairs, non-coincident path points and live repair IDs;
- analytic traffic falloff, channel independence and zero traffic when no path is declared;
- exact reuse of water exposure/runoff rather than parallel shelter or drainage solvers;
- scene fingerprinting and verification of field bytes and semantic identities;
- native Blender rejection of stale topology/ranges and a semantic/control render pair with measurable decoded-pixel change;
- transfer through unrelated historic and contemporary paving receivers before visual publication.

## Consequences

The first historic and contemporary transfer fields pass structural verification over 3,157 and 3,654 exact water cells. They are not accepted as photographic environments: the profiles are explicit synthesis fixtures rather than site observations, richer dirt transport and event history are still missing, and the host worlds retain previously recorded material/environment defects. This tranche creates reusable causal infrastructure; it does not claim that the benchmark or either transfer host is finished.
