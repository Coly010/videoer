# ADR 047: Authored-colour electrical practical modulation

## Status

Accepted — 2026-09-01

## Context

The first portable practical-light contract supported deterministic candle and flame flicker. Its modulation intentionally converted useful-light and visible-source colour through a bounded black-body temperature range. Reusing that mode for neon would have produced the wrong physical and artistic semantics: electrical instability changes neon output intensity, but should not silently turn an authored cyan tube into fire-coloured light.

## Decision

Temporal practical-light modulation is a discriminated renderer-independent contract. `seeded-flicker` retains bounded intensity plus black-body colour-temperature variation for combustion sources. `seeded-electrical-instability` adds a bounded deterministic intensity process and dropout probability while preserving each emitter's authored colour.

Both modes use a stable seed, frequency and smooth frame sampling. Useful-light power is exactly the base wattage multiplied by the sampled signal. When a visible source material is bound, its emission strength must use the same signal at a constant ratio. A multi-emitter fixture must provide valid evidence for every modulated emitter, including emitters that intentionally have no independent visible-source binding.

The first consumer is `prop.projecting-neon-blade-sign@0.1.0`: a two-sided physical cabinet, structural wall mount, replaceable face-treatment slots, host projection/height clearance, two local area emitters and a cyan tube material. The same electrical mode can support fluorescent fixtures, faulty industrial indicators, science-fiction panels and magical/electrical practicals without embedding those genres in the contract.

## Verification and acceptance

The façade witness renders all twelve frames at the deterministic production-clean profile. Evidence records the declared mode, seed, frequency, dropout probability, authored-colour behaviour, useful-light power, visible-source emission and bounded sample range. A second unrelated industrial host reuses the exact geometry and fixture.

V1 was rejected because the sign occupied 46.9–57.3% of frame height against a 38% maximum and two views crossed the upper margin. V2 moved the camera around the sign's actual optical centre and increased distance without weakening the margin. It passes at 29.75%, 36.47% and 33.70% screen height, 0% clipped-white coverage and 32–49% black coverage. Visual review accepts the physical two-sided form, edge-on construction evidence, cyan spill and cross-host transfer for medium/background use.

## Consequences

Electrical practicals no longer masquerade as flame emitters, and renderer adapters cannot infer temporal colour semantics from a generic noise value. The neutral glyph and cabinet are not hero-close typography. Automatic text/logo-to-tube authoring, transformers, wiring, buzz audio, broken tube segments and higher-detail fasteners remain later reusable capabilities.
