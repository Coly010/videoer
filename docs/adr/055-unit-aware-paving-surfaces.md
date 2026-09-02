# ADR 055: Unit-aware paving surfaces

## Status

Accepted for implementation.

## Context

The architectural transfer audit proved that Videoer's physical paving units, recessed joint bed, repair patches, borders, drainage fall and queryable support surface are the correct construction foundation. It also proved that a continuous photographed paving layout applied to those modeled units creates a false second set of stones. Applying one homogeneous source in shared world coordinates avoids that double structure but repeats the same sample relationship across many units and does not make the joint/substrate boundary explicit enough for later water and dirt response.

Research on 2026-09-01 reviewed ambientCG, Poly Haven, MaterialX, OpenPBR, Blender named attributes and OpenUSD primvars. ambientCG remains the first cleared CC0 source. Poly Haven asset files are CC0, but contradictory current API terms block new automated live ingestion. MaterialX's distance-unit and geometric-property vocabulary, Khronos texture-transform semantics and OpenUSD interpolation domains are useful references; Videoer's JSON remains authoritative. Blender-specific random-per-island, pointiness or topology indices cannot define portable surface identity.

## Decision

Extend the existing irregular-paving grammar rather than introducing a parallel paving system.

Each generated unit has a stable unit ID and a deterministic surface frame derived from a dedicated sampling seed rather than geometry traversal state. The frame stores an allowed rotation and a metre offset. Offsets combine a seeded, spatially correlated batch field with bounded per-unit jitter so adjacent stones share plausible source character without exposing one identical sample relationship across an entire course. Unit UVs are authored in local physical metres for the top, chamfer, sides and underside. A texture placement mode named `unit-local-uv-meters` consumes those values without normalising them, then applies the material's bounded offset/rotation and divides by the verified source dimensions. It is valid only for modeled units and homogeneous-unit source material. Modeled paving rejects shared world projection and layout scans.

The compiled paving report and geometry metadata classify disjoint material targets for modeled units, the continuous recessed joint bed, the continuous substrate and borders. A dedicated `paving-joint-substrate` construction domain prevents joint material from masquerading as a paving unit or generic decorative ground plane. Joint/substrate materials use continuous horizontal metre mapping or procedural response independently of the units.

Construction validity is measured rather than inferred from mesh validity. The report records plan coverage, skipped boundary-cell count and maximum skipped span, and the minimum clearance between every tilted/settled unit top and the continuous joint plane. Generation fails when coverage drops below the host contract, a boundary omission is too wide, or any stone—including repair-patch stones—can disappear beneath the joint bed. Narrow boundary cells are retained or a short terminal remainder is split into explicit cut units instead of being silently discarded or hidden inside an oversized unit. These invariants prevent material debugging from concealing a construction failure.

Each definition also owns an evidence-bound physical-construction specification. It records exact factual-reference provenance and separately bounds nominal and generated whole-unit length, width, height, joint width and recess, aspect ratio, maximum exposed relief, and maximum absolute settlement. Product and installation publications contribute factual dimensions only; no external code, product geometry, texture, or proprietary design is adopted. Boundary cuts remain real geometry and participate in coverage, clearance and walkability, but are counted separately from product-unit tolerance evidence. A short terminal remainder is divided into bounded cut units rather than being hidden by stretching one nominal unit. The initial reference record and authored-vs-factual boundary are maintained in [`docs/research/paving-physical-construction.md`](../research/paving-physical-construction.md).

Large-scale correlated weathering remains the existing material macro-variation layer. Visual transfer proved that independent unit response is also necessary. Paving therefore emits three deterministic signed scalar vertex attributes for unit value, roughness and weathering. Values combine a spatially correlated batch field with bounded stable-ID jitter, remain constant over each unit, and use explicit vertex interpolation. Texture applications declare bounded amplitudes and exact attribute names; TypeScript and Blender reject missing, mistyped or non-paving use. Source texture microdetail, per-unit response and metre-scale macro variation remain separate layers, avoiding renderer-specific island randomness and hundreds of duplicate materials.

The next water tranche will derive one content-addressed surface-water field from this same paving asset, its exact geometry hash, transform, drainage, material response and rain/shelter inputs. That field—not uniform wetness or random AABB splashes—will drive film, absorption, runoff, bounded puddles and splash eligibility.

## Verification

Acceptance requires:

- identical input produces byte-identical geometry, UV frames and reports;
- changing only the sampling seed changes UVs and surface-frame evidence without changing positions, indices or unit dimensions;
- most units have distinct surface-frame signatures;
- the spatially correlated field is deterministic and a sampling-seed-only change leaves unit geometry byte-identical;
- unit, joint, substrate and border target sets are disjoint and reference live materials;
- plan coverage, maximum skipped boundary span and minimum unit-to-joint clearance pass their declared host thresholds;
- every nominal and generated whole-unit construction measurement remains within its definition's source-backed physical bounds, with boundary cuts explicitly counted;
- layout scans, missing physical scale, wrong domains, shared-world modeled-paving mapping and non-homogeneous unit sources fail closed in TypeScript and Blender;
- a synthetic multi-channel probe demonstrates synchronized base-colour, normal and roughness mapping across distinct units;
- real CC0 material transfer is visually inspected on both historic setts and contemporary pavers before any material or paving assembly is published.

## Consequences

The current paving geometry and material pipeline remain authoritative. Existing procedural and flat-surface materials are compatible. Historic and contemporary transfer renders show that unit-local mapping removes the false photographed-layout-on-modeled-layout structure and that clearance validation removes unit-sized holes caused by settled repair stones falling beneath the joint plane. Both hosts remain visually rejected: joint beds are pale and graphic, unit differentiation remains limited, the contemporary units remain oversized, and the source materials do not yet provide production weathering. Unit-local UVs improve reuse and repetition control without coupling persistent assets to Blender, but they do not by themselves solve joint granularity, edge wear, shelter, drainage, puddles or atmosphere; those remain explicit subsequent shared-system work.
