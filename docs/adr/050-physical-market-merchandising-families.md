# ADR 050: Physical market merchandising families

## Status

Accepted — 2026-09-01

## Context

An inhabited market cannot be represented by random boxes around an empty canopy. The reusable system needs independent structural fixtures, recognizable inventory, authored relationships between display surfaces and stock, transfer across unrelated campaigns, and acceptance that rejects merchandise embedded in or floating around its host.

Storage and vegetation acceptance had also begun repeating candidate identity, qualitative-review, evidence-copy and metadata-promotion machinery. Adding a third bespoke pipeline would make later workshop and domestic families harder to maintain.

## Decision

Market production uses three independent project-owned assets:

- `prop.modular-market-stall@0.1.0`: timber frame, physical striped canopy, counter, lower shelf, price board and named display/stock/hanging anchors.
- `prop.produce-basket@0.1.0`: willow body, physical rim and handle, and individually modelled mixed produce.
- `prop.tied-provision-sack@0.1.0`: coarse procedural burlap response, cinched profile, physical tie and raised gathered seams.

`environment.market-world-family@0.1.0` composes those assets through renderer-independent authored clusters. The complete-stall recipe places basket bases at counter height and sacks at lower-stock height; separate produce and provision caches retain layout variation. Every transfer requires all three silhouettes and preserves explicit customer and entrance circulation.

Authored cluster offsets use metres in the host coordinate system. Per-member scale changes member geometry and footprint, but not its attachment offset. Earlier code scaled only Y while leaving X/Z unchanged; fail-closed market acceptance exposed the inconsistency when counter baskets were pulled below their 1.09 m anchors. The solver now treats all three axes consistently, with a regression fixture.

Family acceptance now shares `dressing-family-acceptance-core.ts`. The core owns candidate/member identity validation, topology, required attachments/materials/metadata, review evidence existence, evidence copying and verified metadata promotion. Domain wrappers retain checks that actually differ: live surface regeneration for vegetation and complete physical merchandising for markets. Street storage and vegetation have been migrated to the same core.

## Verification and acceptance

The exact family transfers between a historic market square and an unrelated contemporary pop-up host. Both deterministic layouts include a complete merchandised stall, a produce cluster and a provision cluster. Render evidence uses three distinct semantic landmarks, checks visibility and highlights, and requires every one of ten entities to be fully inspectable in at least one frame.

V1 was rejected because provision sacks read as smooth ceramic jars and the stall lacked a focal merchandising cue. V2 added a coarse burlap response, raised gathered seams and a physical price board. Its acceptance then failed because the shared solver scaled vertical authored offsets by per-member scale. V3 fixes the solver defect, visibly seats both baskets on the counter, retains lower-shelf stock, and passes both transfer probes.

## Consequences

The four releases are verified for background and medium shots, not close-ups. Basket weave and burlap fibres remain procedural surface responses; sacks use deterministic gathered geometry rather than cloth simulation. The two hosts are verification fixtures rather than publishable complete market environments. Future work can add awning sizes, fabric palettes, dry-goods/flower/tool inventories, hanging goods, animated cloth and vendor interaction without changing the family or acceptance architecture.
