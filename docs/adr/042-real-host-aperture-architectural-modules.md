# ADR 042: Architectural modules require real host apertures

## Status

Accepted.

## Context

Windows and doors embedded in one environment generator can look correct while remaining unusable as portable production assets. A module placed over an opaque host wall is only facade decoration: transmitted light, interior depth, camera sightlines and physical interaction are false even when a frontal render is attractive. The existing bookshop also repeated manual wall segmentation that would become increasingly fragile as architectural inventory grew.

## Decision

Rectangular architectural openings are host-geometry operations. `wallWithRectangularOpeningsParts` partitions a wall into non-overlapping solids around validated, named apertures. Portable window and door modules declare the opening dimensions, supported wall-thickness interval and exterior orientation they require; they do not silently cut geometry and they do not ship an opaque facade backing.

The portable inset-window module supplies its reveal, frame, projecting sill, mullions and physical 8 mm glazing separately from the host wall. Its mount, opening centre, exterior/interior focus and sill attachments make placement and camera/light blocking explicit. Host environments remain responsible for the room or exterior depth visible through the opening.

Acceptance requires two unrelated host styles, distinct multi-angle production-clean evidence and all declared render gates. It also loads the actual witness geometry and casts a segment through the centre of the declared aperture over the host-wall material group. Any intersecting host-wall triangle fails acceptance. Persisted metadata or a visually dark pane cannot substitute for this geometric proof.

## Rejected approaches

- Place a framed transparent pane in front of an intact wall: rejected because it is not an opening.
- Include a luminous or opaque backing in every module: rejected after evidence read as a flat glowing rectangle and concealed the host interior.
- Trust only the generator name or opening report: rejected because acceptance must detect tampered or incorrectly assembled witness geometry.
- Accept the first attractive angle: rejected because reveal depth and glazing response must remain legible from both glancing views and frontally.

## Consequences

`prop.inset-architectural-window@0.1.0` is published for background/medium use after transfer to 0.30 m brick and 0.26 m plaster hosts. It is not a hero-close asset: operable sashes, hardware, seals, fasteners and detailed weathering remain future variants. The same opening grammar now owns the bookshop facade segmentation and can support reusable doors, vents and storefront modules without parallel wall-cutting systems.
