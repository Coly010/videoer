# Renderer-independent materials

Videoer surface assets store physical and visual intent without Blender node or Three.js class references. A surface separates palette, structural pattern, metre-scaled normal detail, roughness variation, wet coat and optional environmental history.

Create the current environmental suite with:

```bash
npm run video -- material create-old-city-suite work/environmental-surface-suite
```

The suite produces one immutable candidate directory per material. Diagnostic geometry deliberately exposes multiple orientations: masonry walls, orthogonal wood members, plaster/stone corners and physical standing glazing. These probes are necessary but not sufficient for acceptance.

Render real architectural transfers with:

```bash
npm run video -- material create-environmental-gallery work/environmental-gallery
```

Use `--only exterior` or `--only interior` while iterating on one unchanged witness. The exterior gallery uses a true wall aperture and visible room depth. The interior gallery uses an off-axis warm key, camera-side cool fill and shelf rim so warm plaster, oiled wood and stone cannot pass as one uniformly orange surface.

After visual review, store `verification/surface-suite-review.json` and run:

```bash
npm run video -- material accept-environmental-suite work/environmental-surface-suite \
  --exterior-gallery work/environmental-gallery/exterior \
  --interior-gallery work/environmental-gallery/interior
```

Acceptance verifies complete material identity, valid swatch geometry, distinct diagnostic frames, relevant material-bearing entity coverage in a complete transfer render, exterior-weathering semantics where applicable and physical glazing thickness/transmission. It copies and hash-binds the shared transfer evidence into each independently publishable asset.

Environmental weathering uses object-space metres. Vertical runoff width/length, lower damp height and dirt scale therefore remain stable when a material moves between differently sized assets. Do not replace these semantics with object-normalised generated coordinates or campaign-local baked grime. Use unique decals, chips or scanned displacement only when close shot distance justifies a separately versioned detail layer.

The production pattern vocabulary also includes `woven-textile`, `brushed-metal` and `glazed-ceramic`. Textile contracts record warp/weft spacing, thread contrast and fuzz; metal records brush spacing, scratch contrast and patina; ceramic records glaze/coat response and physical speckle scale. These are renderer-independent metre-scaled semantics, not Blender node names. The first accepted consumers are the cross-era interior furnishings documented in [ADR 054](adr/054-cross-era-interior-furnishings.md).

## Provenance-bound open material sources

Open material acquisition is an explicit candidate operation, never a renderer dependency. ambientCG uses the archive-backed v1 source contract. Poly Haven uses the ADR 067 provider-file v2 contract because it publishes individually sized and MD5-hashed maps. Live Poly Haven acquisition requires Videoer's identifying User-Agent and visible service credit; exact offline replay uses only persisted bytes and preserves the acquisition evidence. Downloaded assets are separately recorded as CC0.

```bash
npm run video -- asset source import-material poly-haven \
  --asset rough_concrete --resolution 2K --encoding PNG \
  --cache work/material-sources/cache \
  --output work/material-sources/candidates --mode online

npm run video -- material derive-texture \
  path/to/base-material.json path/to/candidate/material-source.json \
  work/material-sources/derived/example/material.json \
  --id material.example --suitability path/to/suitability.json \
  --displacement-response path/to/displacement-response.json

npm run video -- material probe \
  work/material-sources/derived/example/material.json \
  work/material-sources/probes/example \
  --application path/to/construction-application.json
```

The generic probe stages and hash-verifies every texture into a self-contained swatch package, binds an explicit construction domain and placement, and renders deterministic top, raking, close and glancing views plus a turntable. A texture-backed material cannot be probed without that application. Provider lateral dimensions preserve tiling scale but do not calibrate displacement height; retain displacement as `disabled-uncalibrated` until reviewed physical amplitude and midpoint evidence exists.
