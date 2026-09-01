# Procedural environments

Create the benchmark's continuous street and bookshop set with:

```bash
npm run video -- environment create-bookshop work/old-city-bookshop
```

The output contains validated renderer-independent geometry, named exterior/interior attachments, a material-grouped mesh, six semantic verification views, a contact sheet, a turntable, and a Blender source file. The environment is deliberately an open-ceiling production set so cameras and light rigs can enter the interior.

The old-city generator is a reusable production-set module, not a benchmark-only mesh. Its deterministic dressing inventory separates façade framing, roof/skyline masses, signs, lanterns, drainage, street furniture, books, and window-display props so later campaigns can reuse, remove, or adapt those groups without rebuilding the street. Material bindings embed renderer-independent surfaces; Blender evaluates their palette, normal, roughness, wetness, and coat response in object-space metres.

Structural validity is not visual acceptance. The v3-v12 candidates add scale cues, interior habitation, gable roofs, a receding street, an off-axis tower, a subordinate painted/gilded sign, structured masonry and wood, true upper-window openings, and a projecting supported eave, but remain unpublished. Intended-camera previews rejected a frontal façade card, a near dark mass, a frontal terminus, an empty-axis composition, an oversized dark sign, and tooth-like rectangular eave supports before reaching the v12 checkpoint. V12 replaces the supports with slender diagonal braces and proves reusable window/eave modules. Glazing, plaster/stone response, set density, and final cinematic finish still fail the production bar.

Surface structure belongs to the material contract, not to Blender-only scene tricks. Masonry declares projection axes, real unit dimensions, mortar, row offset, edge relief, and bounded irregularity. Wood declares a domain grain axis, width, longitudinal scale, distortion, and ring contrast. Verification fixtures must expose those patterns on more than one orientation so an axis or projection error cannot pass as an attractive flat swatch.

Acceptance requires the exterior door/window openings, threshold, interior floor, shelves, and reading position to remain in one coordinate system. Visual verification must show the street facade, a readable threshold into the warm interior, open-backed shelves, the inside face of the original facade, and an overhead continuity view. An exterior-only render does not establish continuity.

## Portable dressing families

Create the project-owned storage family and its two cross-environment witnesses with:

```bash
npm run video -- environment create-street-storage-family work/street-storage-family
```

The operation emits independent barrel and slatted-crate prop candidates, a family manifest, seeded old-city and contemporary layouts, complete three-frame production-clean renders, exact-frame contact sheets and renderer reports. The family stores stable prop IDs and explicit versions—not file paths or Blender objects—and uses weighted semantic cluster recipes rather than uniform scatter.

Every navigation-preserving layout request must declare corridor or rectangle exclusions. Current placement is deliberately scoped to an explicit flat ground plane. Do not claim slope compatibility until a surface-query implementation evaluates local height and normal.

After visual review, add `family/verification/family-candidate-review.json` and run:

```bash
npm run video -- environment accept-street-storage-family work/street-storage-family
npm run video -- asset publish work/street-storage-family/props/storage-barrel --library library
npm run video -- asset publish work/street-storage-family/props/slatted-storage-crate --library library
npm run video -- asset publish work/street-storage-family/family --library library
```

Acceptance regenerates each layout, verifies member geometry and attachments, requires distinct semantic frames, executes all render gates and proves every generated entity is fully inspectable in at least one landmark. The first accepted inventory is `prop.storage-barrel@0.1.0`, `prop.slatted-storage-crate@0.1.0` and `environment.street-storage-family@0.1.0`, limited to background/medium shot distance.

## Portable architectural openings

Create and transfer-test the project-owned inset window with:

```bash
npm run video -- environment create-inset-window-module work/inset-window-module
```

The module supplies a deep reveal, painted timber frame, cross mullions, projecting sill and physical 8 mm glazing. It deliberately does not contain an opaque or emissive facade backing. A host must create the declared 1.28 × 0.96 m aperture using the shared wall-opening grammar and provide any room, dressing and motivated light visible through it. Supported wall thickness is currently 0.22–0.42 m.

After recording the qualitative review, accept and publish with:

```bash
npm run video -- environment accept-inset-window-module work/inset-window-module
npm run video -- asset publish work/inset-window-module --library library
```

Acceptance does not trust the opening report alone. It reads each host mesh and casts through the aperture centre over the host-wall triangles; an intact wall behind the window fails. The accepted `prop.inset-architectural-window@0.1.0` has distinct frontal and glancing evidence in brick and contemporary plaster hosts and is scoped to background/medium shots. It does not yet claim hero-close sash hardware, seals, fasteners or weathering.

## Portable rainwater systems

Create the project-owned gutter/downpipe assembly and its unrelated host witnesses with:

```bash
npm run video -- environment create-rainwater-system work/architectural-rainwater-system
```

The asset is not a capped tube relabelled as a gutter. Its half-round trough has independent inner and outer walls, annular ends, rolled lips and a physically open top. The assembly adds visible eave brackets, a tapered collector, three wall clips, a configurable left/right downpipe and a discharge shoe. Its host contract records the required facade plane, eave height, clear span, mounting continuity and ground clearance. Named attachments expose installation anchors and the discharge point.

After inspecting both contact sheets, record `verification/rainwater-candidate-review.json`, then run:

```bash
npm run video -- environment accept-rainwater-system work/architectural-rainwater-system
npm run video -- asset publish work/architectural-rainwater-system --library library
```

Acceptance reloads the geometry and independently rejects a triangle bridging the gutter aperture. It also compares the embedded patinated-metal contract with `surface.json`, requires metre-scaled weathering, validates every mount/discharge attachment, proves that the exact geometry was reused against both host classes, checks distinct landmark pixels, and requires every render gate to pass.

`prop.architectural-rainwater-system@0.1.0` is accepted for background/medium architectural use. It does not claim hero-close seams or fasteners, simulated water flow, blockage/overflow behaviour, installation fall, expansion joints, or multi-span drainage sizing. See [ADR 044](adr/044-portable-open-rainwater-systems.md).

## Portable projecting signage

Create the project-owned hanging sign and its unrelated facade witnesses with:

```bash
npm run video -- environment create-projecting-sign work/projecting-hanging-sign
```

The sign separates smooth swept-tube mounting hardware, alternating closed chain links, a framed weathered board, and bounded two-sided content. Its canonical open-book emblem is verification content, not a requirement that every campaign use a book symbol. Campaigns may replace the two physical face treatments while retaining independent verified hardware.

After inspecting both faces in both contact sheets, record `verification/projecting-sign-candidate-review.json`, then run:

```bash
npm run video -- environment accept-projecting-sign work/projecting-hanging-sign
npm run video -- asset publish work/projecting-hanging-sign --library library
```

Acceptance does not trust the content declaration alone. It reads the live triangle groups and requires bounded page geometry on opposite physical faces, opposed face attachments, all mounts/pivots, exact geometry reuse, compatible facade height and clearance, distinct landmark pixels, and passing render gates.

`prop.projecting-hanging-sign@0.1.0` is accepted for background/medium use. Arbitrary typography, localisation, logo fitting, texture baking, wind motion, chain dynamics, and close-range weld/fastener detail are not yet claimed. See [ADR 045](adr/045-portable-projecting-signage.md).

## Portable projecting canopies

Create the layered supported canopy and its two facade witnesses with:

```bash
npm run video -- environment create-projecting-canopy work/projecting-supported-canopy
```

The asset uses a real sloped timber deck, continuous underlay, fifty staggered overlapping slate pieces, seven soffit boards, fascia, wall flashing, and three double-rail iron brackets. Its drainage contract records fall/run/gradient and a front discharge edge. Named anchors compose separately verified rainwater hardware and underside practical lights without fusing those systems into the roof.

After inspecting the elevated, underside, and glancing evidence, record `verification/projecting-canopy-candidate-review.json`, then run:

```bash
npm run video -- environment accept-projecting-canopy work/projecting-supported-canopy
npm run video -- asset publish work/projecting-supported-canopy --library library
```

Acceptance independently counts welded physical slate components, recomputes drainage mathematics, validates layered construction and all composition anchors, checks both hosts' span/height/clearance, requires exact geometry reuse and distinct pixels, and executes every render gate.

`prop.projecting-supported-canopy@0.1.0` is accepted for background/medium use. It does not claim hero-close fasteners/joinery, structural engineering, snow/standing-water response, or animated damage. See [ADR 046](adr/046-layered-projecting-canopy-systems.md).

## Portable non-flame practical lighting

Create the project-owned two-sided neon blade sign and both host witnesses with:

```bash
npm run video -- fixture create-neon-blade-sign work/fixtures/neon-blade-sign
```

The sign separates its physical cabinet, structural projecting bracket, two face-treatment slots, cyan tube geometry and local area emitters. Its host contract records vertical-wall compatibility, mounting-height range, clear wall width and projection clearance. Replacing campaign face content must not replace or duplicate the verified cabinet, mount or emitter contract.

Electrical instability is not implemented as fire flicker. Its seeded bounded signal preserves the authored cyan colour while driving useful-light power and visible-tube emission together. After inspecting the full twelve-frame façade render and unrelated warehouse transfer, record `verification/fixture-candidate-review.json`, then run:

```bash
npm run video -- fixture accept work/fixtures/neon-blade-sign
npm run video -- asset publish work/fixtures/neon-blade-sign --library library
```

`prop.projecting-neon-blade-sign@0.1.0` is accepted for background/medium atmosphere and wayfinding. The neutral glyph is replaceable verification content, not campaign identity. Hero-close typography, automatic text/logo tube generation, wiring/transformers, buzz audio and broken-tube simulation are not yet claimed. See [ADR 047](adr/047-authored-colour-electrical-practical-modulation.md).

## Surface-bound potted vegetation

Create the two portable plants, explicit-version family and non-flat host witnesses with:

```bash
npm run video -- environment create-potted-vegetation-family work/environments/potted-vegetation-family
```

The family uses live triangle height/normal queries rather than a constant ground height. Requests bind the exact support geometry, maximum slope, normal-alignment policy, vertical offset, required plant variants, circulation corridors and door/service exclusions. Persisted instances retain the supporting triangle, normal and measured slope.

After inspecting both three-view contact sheets, record `family/verification/family-candidate-review.json`, then run:

```bash
npm run video -- environment accept-potted-vegetation-family work/environments/potted-vegetation-family
npm run video -- asset publish work/environments/potted-vegetation-family/props/potted-fern --library library
npm run video -- asset publish work/environments/potted-vegetation-family/props/potted-shrub --library library
npm run video -- asset publish work/environments/potted-vegetation-family/family --library library
```

Acceptance reconstructs both layouts from the live support meshes, requires both silhouettes in each host, verifies all support records, member materials/attachments, distinct landmarks, renderer gates and qualitative review. The accepted releases are `prop.potted-fern@0.1.0`, `prop.potted-shrub@0.1.0` and `environment.potted-vegetation-family@0.1.0`, scoped to background/medium use. See [ADR 048](adr/048-geometry-bound-surface-placement.md) and [ADR 049](adr/049-surface-bound-vegetation-families.md).

## Market worlds and physical merchandising

`environment create-market-world-family <output>` creates a structural striped-canopy stall, a handled basket with individually modelled produce, and a tied provision sack. The market family composes these into complete stocked stalls and separate inventory caches while preserving customer and entrance corridors. Renderer-independent authored offsets are metres: counter and lower-stock heights remain stable even when individual props receive bounded scale variation.

Inspect both host contact sheets and record `family/verification/family-candidate-review.json`; creation deliberately leaves candidates at `validated`. `environment accept-market-world-family <output>` regenerates both layouts, requires all three variants, proves a complete stall/basket/sack cluster, requires at least two elevated counter baskets, verifies unrelated host identities and render gates, and promotes the family and all props through the shared family-acceptance core. The first verified inventory is documented in [ADR 050](adr/050-physical-market-merchandising-families.md).

## Workshop worlds and authored workstations

`environment create-workshop-world-family <output>` creates an interaction-ready joiner's workbench, a populated freestanding tool board and a rolling five-drawer parts cabinet. The family treats their relationship as authored production meaning: a complete workstation keeps the tool display behind the work surface, storage beside it and a declared operator/camera aisle clear.

Layout requests may use `requiredRecipeIds` when a complete assembly—not merely eventual variant coverage—is mandatory. Required recipes are placed before optional weighted clusters; unknown, repeated or impossible requirements fail. Existing requests without this field preserve their prior deterministic layouts.

The transfer fixture reuses bounded derivations of `lighting.bookshop-warm-interior@0.1.0` in historical-forge and contemporary-maker-lab hosts. After inspecting both contact sheets, record `family/verification/family-candidate-review.json`, then run:

```bash
npm run video -- environment accept-workshop-world-family work/environments/workshop-world-family
npm run video -- asset publish work/environments/workshop-world-family/props/joiners-workbench --library library
npm run video -- asset publish work/environments/workshop-world-family/props/freestanding-tool-board --library library
npm run video -- asset publish work/environments/workshop-world-family/props/rolling-parts-cabinet --library library
npm run video -- asset publish work/environments/workshop-world-family/family --library library
```

Acceptance recomputes the layout, complete recipe and live lighting derivations, requires distinct host/rig identities and executes every render gate. `prop.joiners-workbench@0.1.0`, `prop.freestanding-tool-board@0.1.0`, `prop.rolling-parts-cabinet@0.1.0` and `environment.workshop-world-family@0.1.0` are published for medium/background use. Tool silhouettes are not hero-close assets and no dynamic drawers, wheels, vise or tool interaction is claimed yet. See [ADR 052](adr/052-authored-workshop-workstations.md).

## Cross-era inhabited interiors

`environment create-interior-furnishings <output>` creates an upholstered timber reading chair, walnut pedestal table and supported ceramic/brass vessel set, plus canonical probes and two complete transfer fixtures. The family provides reading-corner, conversation and solitary-table recipes with occupant, side-table, tabletop, support, carry and focus anchors.

The historical library chamber and contemporary reading loft consume the exact same member geometry and family definition. Their lighting is a layout-aware bounded derivation of `lighting.bookshop-warm-interior@0.1.0`; the parent key target is mapped to the persisted family focus rather than tuned to campaign coordinates. A live camera-shell clearance gate prevents the wall-crossing failure found in the first transfer render.

After qualitative review, run:

```bash
npm run video -- environment accept-interior-furnishings work/environments/interior-furnishing-family
npm run video -- asset publish work/environments/interior-furnishing-family/props/upholstered-reading-chair
npm run video -- asset publish work/environments/interior-furnishing-family/props/pedestal-side-table
npm run video -- asset publish work/environments/interior-furnishing-family/props/decorative-vessel-set
npm run video -- asset publish work/environments/interior-furnishing-family/family
```

Acceptance independently regenerates both layouts and lighting derivations, requires exact physical tabletop support, complete recipe coverage, distinct landmarks, camera clearance and every render gate. The `0.1.0` releases are accepted only for background/medium use. See [ADR 054](adr/054-cross-era-interior-furnishings.md).
