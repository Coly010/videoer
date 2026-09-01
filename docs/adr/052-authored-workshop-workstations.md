# ADR 052: Authored workshop workstations

## Status

Accepted.

## Context

Street storage, vegetation and markets proved deterministic set-dressing families, but a workshop is not credible when benches, tools and storage are independently scattered. Their working relationship—tool display behind a work surface, parts storage beside it, and clear operator access—is production meaning and must survive reuse.

## Decision

Workshop inventory remains three independently versioned renderer-independent props:

- a joiner's workbench with physical trestles, worktop, vise, bench dogs, loose hammer and interaction/task-light anchors;
- a freestanding populated tool board with physical peg pattern, shelves and distinct tool silhouettes;
- a rolling five-drawer parts cabinet with handles, castors, push handle, top and loose parts.

`environment.workshop-world-family` composes them through explicit authored workstation recipes. The layout request may now declare `requiredRecipeIds`; the solver places those recipes before weighted optional clusters and rejects unknown, repeated or impossible requirements. Existing requests default to no required recipes and preserve their deterministic output.

Verification renders the exact family in historical-forge and contemporary-maker-lab hosts. Both hosts derive bounded spatial, energy and colour treatments from the verified `lighting.bookshop-warm-interior@0.1.0` parent. Acceptance regenerates layout, requires the complete workstation recipe and all variants, verifies distinct host and lighting identities, reconstructs the lighting adaptation from the live parent, runs every render gate and requires qualitative review.

## Evidence and limits

V1 was rejected because distant framing made physical details too small to judge. V2 exposed a camera outside the contemporary host and failed at 79% black coverage. V3 constrains all cameras inside the host walls, requires every entity to reach at least 8% frame height and passes in both warm historic and cool contemporary treatments.

The assets are accepted for medium/background use. Simplified tool silhouettes are not hero-close inventory; drawers, wheels, vise and tools are static in this release; host rooms are verification sets rather than published environments.

## Consequences

- Coherent inhabited work areas can be reused without campaign-specific placement coordinates.
- Required authored assemblies are a first-class layout contract rather than a random-selection hope.
- Verified lighting derivation participates in environment-family acceptance without fusing lights into prop geometry.
- Future interactions can target stable work-surface, vise, operator, drawer, handle and tool-display attachments.
