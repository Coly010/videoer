# Reusable cinematic lighting

Lighting rigs are renderer-independent first-class library assets. A rig owns semantic light identity, type, purpose, position/target, colour, energy, emitter size, world colour and coherent AgX exposure. Campaigns may reuse a verified rig unchanged, apply the bounded `lighting-rig-transform-v1` derivation, and add explicit shot-local motivated supplements.

Do not copy light lists into campaigns or use finishing to compensate for an unverified rig. A lighting candidate must demonstrate:

- exact source camera execution and subject-region black/white/midtone bounds;
- visual key/fill/rim/practical separation on an appropriate static form/material witness;
- a transfer into an unrelated environment through the same rig topology;
- live reconstruction of spatial, energy, colour and size adaptation during acceptance;
- explicit visual strengths, limitations, intended scope and environment portability; and
- immutable publication with every source/transfer artifact hash-bound.

The review declares `sourceEvidenceDirectory` and `transferEvidenceDirectory`; both must remain inside the candidate. Acceptance reads every cited artifact, requires the transfer definition to consume the candidate's own `lighting-rig.json`, rebuilds the expected adapted rig from live data, compares the persisted rig/report, verifies source and transfer render gates, and contains the preview inside the declared evidence directory.

Current verified inventory:

- `lighting.bookshop-warm-interior@0.1.0`: off-axis warm key, broad cool fill and restrained rear rim for medium-distance warm interiors; transferred to a contemporary gallery.
- `lighting.nocturne-gallery@1.0.0`: first-class gallery/event rig with separate product-campaign reuse.
- `lighting.bookshop-dusk-exterior@0.1.0`: broad cool dusk environment/key, warm motivated practicals and threshold rim; transferred to the verified night-transit platform. Despite its origin name, acceptance removes the old-city dependency. It is scoped to dusk/night enclosures with warm practical motivation.
- `lighting.moonlit-exterior@0.1.0`: directional cool moon key, broad night-sky fill, silver rim, restrained ground bounce and a warm aperture depth cue; authored in a historic courtyard and transferred through the same five-role topology to a contemporary rooftop. It is scoped to background/medium night exteriors rather than hero skin, product macro, moving-cloud, lightning or firelight work.
- `lighting.firelit-interior@0.1.0`: one seeded `primary-fire` signal drives the visible hearth material, practical, shaped key, ground bounce and edge rim while a static cool environment source preserves depth. The historic chamber source transfers to a contemporary lounge with identical temporal correlation. It is scoped to background/medium firelit interiors; its probe hearth is not production flame, smoke, sparks or heat distortion.

Legacy environment-typed lighting packages remain readable parents but should not be used for newly authored releases.

Create and transfer a candidate with:

```bash
npm run video -- lighting create-bookshop-rigs path/to/environment.json path/to/character.json work/lighting --only exterior
npm run video -- lighting create-moonlit-exterior work/lighting/moonlit-exterior
npm run video -- lighting create-firelit-interior work/lighting/firelit-interior
npm run video -- lighting transfer-probe path/to/transfer-definition.json path/to/candidate/verification/transfer/host-name
npm run video -- lighting accept-candidate path/to/candidate
npm run video -- asset validate path/to/candidate
npm run video -- asset publish path/to/candidate --library library
```

The character argument is retained for CLI compatibility only; current lighting probes deliberately use a static witness so rejected gait or deformation work cannot block world-lighting development. See [ADR 032](adr/032-first-class-lighting-derivation.md).

Temporal rigs declare renderer-independent modulation plus a stable signal ID. Several lights may share one signal only when their modulation definitions are byte-equivalent. A host may bind one visible source material to a declared source role. Blender animates light energy/colour and that material's emission from the same sampled signal, then persists every frame in `lighting-modulation-report.json`. Acceptance reconstructs power, colour temperature, colour, bounds, source-emission ratio and cross-light correlation from the live rig. Independent random flicker, a drifting source/light relationship, or a rewritten report fails closed.
