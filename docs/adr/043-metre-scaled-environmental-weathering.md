# ADR 043: Metre-scaled environmental weathering

## Status

Accepted.

## Context

The first procedural masonry, wood, plaster and stone contracts correctly separated palette, structural pattern, micro-normal, roughness and wet coat. In isolated probes, however, mineral plaster and limestone still read as clean flat swatches. Applying baked grime textures per building would add visual history but destroy scale portability, make provenance harder to audit and encourage campaign-specific material copies.

## Decision

Environmental history is a renderer-independent optional layer of `SurfaceMaterial`. It can declare:

- vertical runoff amount, width and length in metres;
- lower-wall damp amount and height in metres;
- bounded broad surface dirt amount and scale in metres.

Blender evaluates the layer from object-space coordinates after the base structural pattern and before final roughness/normal response. It combines independent masks without replacing masonry bond, wood grain, plaster trowel structure or cut-stone bedding. Materials without environmental exposure, such as warm interior plaster, omit the layer rather than setting arbitrary zero-filled fields.

Large architectural surfaces use `entity-set-frame-presence` verification. Unlike prop coverage, this gate does not require an entire wall to fit in frame. It requires each declared material-bearing entity to occupy a measured useful portion of at least one semantic frame. Prop and dressing acceptance continue to require fully framed geometry where that is the appropriate claim.

Publication requires three evidence layers: material/schema and swatch validation; distinct material-specific diagnostic views; and coverage in a real architectural transfer with complete camera, exposure and frame-area gates. A shared qualitative review records shot-distance limits and visual deficiencies.

## Rejected approaches

- Publish the first clean swatches because their node graphs were correct: rejected because structural validity did not create believable accumulated history.
- Bake unique grime imagery per façade: rejected because material scale and reuse would depend on one UV layout and one campaign.
- Apply dense uniform vertical streaks: rejected after the first façade looked blue and waterfall-like.
- Reuse full-object prop framing for walls: rejected because a useful wall inspection naturally extends outside the frame.
- Accept the first interior gallery after mechanical gates passed: rejected because saturated warm light collapsed plaster and wood into one orange response.

## Consequences

Seven versioned `0.2.0` environmental surfaces are independently published: dark brick, rain-aged mineral plaster, weathered exterior wood, aged limestone, warm lime plaster, oiled interior wood and physical window glazing. They are accepted for background/medium use, not hero macro photography. Plaster and limestone remain deliberately restrained; unique cracks, chips, decals, moss, condensation, fingerprints and scanned displacement are future layers rather than implied capabilities.
