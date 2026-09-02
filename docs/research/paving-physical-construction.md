# Physical paving construction references

Status: factual construction reference for the renderer-independent irregular-paving grammar.

Review date: 2026-09-02.

This record separates factual product and installation data from Videoer's authored production
limits. The linked publications supply dimensional facts only. Videoer does not adopt, execute,
translate, or redistribute source code from them, and no product geometry, texture, brand identity,
or proprietary design is copied. The built-in fixtures remain original procedural definitions.

## Historic natural granite setts

Primary references:

- [Aggregate Industries / Charcon, _Commercial landscaping portfolio: Natural Granite Setts product data_](https://cms.esi.info/Media/documents/77639_1443535270289.pdf) lists 100 x 100 mm and 100 x 200 mm nominal plans, 100 mm wide random 250/300 mm lengths, and nominal thicknesses of 50, 60, 75, or 100 mm.
- [Granite Setts Direct, _Black Natural Split Granite Setts_](https://www.granitesettsdirect.co.uk/shop/natural-split-granite-setts/black-natural-split-granite-setts/) lists natural-split 100 x 100 and 200 x 100 mm units at 50 or 100 mm depth and states that its coverage estimate assumes a 10–12 mm mortar joint.

The generic historic fixture therefore uses a 200 x 100 x 75 mm nominal unit and a 10 mm joint.
The product facts establish plausible unit and joint classes; they do not prescribe Videoer's
surface settlement, tilt, chamfer, joint-bed recess, or visual ageing. Those remain explicit,
bounded authored values. The corrected fixture limits nominal joint recess to 4 mm, nominal
settlement amplitude to 1 mm, tilt to 0.2 degrees, and chamfer to 3 mm so a historically irregular
surface does not become exaggerated floating slabs or deep black slots.

## Contemporary concrete block paving

Primary references:

- [Marshalls, _Standard Block Paving 200 x 100 x 50mm datasheet_](https://media.marshalls.co.uk/image/upload/standard_block_paving_200x100x50mm_datasheet.pdf) declares 200 x 100 x 50 mm nominal dimensions and 198 x 98 x 50 mm work dimensions.
- [Marshalls, _Installation details for standard concrete block paving_](https://media.marshalls.co.uk/image/upload/v1580297534/standard-concrete-block-paving-january-2020.pdf) requires cut-block joints to remain within 2–5 mm and says cut blocks should be no smaller than one quarter of a block.

The contemporary fixture therefore uses 200 x 100 x 50 mm nominal blocks and a 4 mm joint. Its
previous 420 x 300 x 65 mm values described large slabs rather than the declared standard block
class. Settlement is now bounded to 0.8 mm, tilt to 0.15 degrees, chamfer to 2 mm, and visible
joint-bed recess to 3 mm. These are Videoer production limits, not claims attributed to Marshalls.

## Verification boundary

Every irregular-paving definition carries its own physical-construction specification and exact
reference provenance. The schema validates nominal unit length, width, height, joint width and
recess, aspect ratio, maximum exposed relief, and maximum absolute settlement against declared
bounds. Compilation measures the same properties on generated whole units and fails when any
observed range escapes the definition's actual bounds.

Boundary cuts are identified and counted but excluded from product-unit tolerance statistics:
cutting a unit necessarily changes its dimensions. The generator still preserves those units in the
geometry, plan-coverage, gap, clearance, and walkability checks. A short terminal remainder is split
into bounded cut units instead of being concealed by stretching a nominal block beyond its declared
class.

This is construction evidence, not an asset licence or brand endorsement. Future definitions may
represent other legitimate classes, including large-format slabs, only by declaring their own exact
factual references and physical bounds rather than weakening these fixtures.
