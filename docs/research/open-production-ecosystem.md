# Open production ecosystem survey

Status: preliminary research inventory; no candidate is adopted merely by appearing here.

Survey date: 2026-09-01

This record implements the research-first requirement in ADR 023. Before Videoer builds or materially extends a production subsystem, inspect current permissively licensed/open implementations, assets, datasets and authoritative technical knowledge. Any later adoption still requires an exact version or artifact, licence proof, provenance, hashes where applicable, compatibility evaluation, renderer-independent boundary, deterministic verification and intended-camera visual acceptance.

## Highest-value candidates

| Domain | Candidate | Licence / clearance | Potential value | Required caution |
| --- | --- | --- | --- | --- |
| Human/rig | [MakeHuman and MPFB licensing](https://static.makehumancommunity.org/about/license.html), [official asset packs](https://static.makehumancommunity.org/assets/assetpacks.html) | Core output assets are CC0; application code is GPL/AGPL; inspect community assets individually | Production mesh, morphs, skins, hair, wardrobe, face units/visemes, poses and full Rigify generation | Preserve per-artifact provenance; independently verify deformation and wardrobe quality |
| Rig | [Blender Rigify manual](https://docs.blender.org/manual/en/latest/addons/rigify/index.html) | GPL and bundled with Blender | Full control rigs, fingers, IK/FK and extensible metarigs | Rig generator, not a complete retargeting/quality solution; Videoer still owns stable maps and gates |
| Motion | [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) | CC0 | Independent locomotion/action corpus for root-motion, facing, feet, toes, wrists, hands and turn tests | Normalise rest pose, scale, axes and root semantics; verify the exact downloadable subset |
| Character reference | [Blender Studio Einar](https://studio.blender.org/characters/einar/v1/), [character library](https://studio.blender.org/blog/new-the-character-library/) | CC-BY | Production deformation, shading, grooming and control-rig comparison fixture | Attribution and Blender-version compatibility; reference fixture rather than generic Videoer identity |
| Deformation reference | [BlenRig](https://github.com/jpbouza/BlenRig), [Blender Studio training](https://studio.blender.org/training/blenrig/chapter/569663dfc379cf44546120e5/) | GPL code; training material CC-BY | Mesh-deform cages, lattices, weight-transfer meshes, correctives, face and hand techniques | Version-sensitive/beta; mine or compare techniques without replacing the working Rigify path by default |
| HDRI/material/environment | [Poly Haven licence](https://polyhaven.com/license), [public API](https://polyhaven.com/af/our-api) | CC0 assets | HDRIs, PBR materials, props and architectural/environment models | Use the API rather than scraping; persist source/version/licence/hash metadata and render probes |
| PBR material | [ambientCG licence](https://docs.ambientcg.com/license/) | CC0 assets and previews | Paving, masonry, wood, plaster, cloth, wear and other multi-channel PBR surfaces | Confirm API rules; normalise channel conventions, scale and colour space; verify at intended distance |
| Urban layout | [BlenderGIS](https://github.com/domlysz/blendergis), [OSM import](https://github.com/domlysz/BlenderGIS/wiki/OSM-import) | Add-on GPL; OpenStreetMap data ODbL | Real footprints, road hierarchy, terrain and macro-layout inputs | Attribution/database obligations; layout does not supply production façades; exclude uncleared proprietary 3D tiles |
| Material schema | [MaterialX / OpenPBR](https://github.com/AcademySoftwareFoundation/MaterialX) | Apache-2.0 | Durable vocabulary, colour-space metadata and reference shading model | Map incrementally into Videoer's domain; do not create a competing runtime material system |
| Asset pipeline | [Blender Studio tools and pipeline](https://studio.blender.org/tools/), [asset pipeline](https://studio.blender.org/tools/addons/asset_pipeline) | GPL tools; Creative Commons documentation | Layering, linking, publish/version, ownership and shot assembly design patterns | Adapt principles to autonomous local production rather than importing a manual studio workflow wholesale |
| Render/colour | [Blender 4.5 colour management](https://docs.blender.org/manual/en/4.5/render/color_management.html), [Cycles sampling](https://docs.blender.org/manual/en/4.5/render/cycles/render_settings/sampling.html), [OpenEXR](https://openexr.com/en/latest/license.html) | Blender/Cycles open source; OpenEXR BSD-3-Clause; manual CC-BY-SA | AgX, exposure diagnostics, adaptive sampling, denoising auxiliaries, linear multilayer EXR and downstream grading | Settings cannot repair crude geometry/materials; profiles need shot-distance/noise budgets and visual probes |
| Simulation/VFX | [Blender fire/smoke flow](https://docs.blender.org/manual/en/4.5/physics/fluid/type/flow.html), [Geometry Nodes simulation](https://docs.blender.org/manual/en/4.5/physics/simulation_nodes.html), [Geometry Nodes raycast](https://docs.blender.org/manual/en/4.5/modeling/geometry_nodes/geometry/sample/raycast.html), [OpenVDB](https://www.openvdb.org/) | Blender GPL; OpenVDB current releases Apache-2.0 | Baked flame/smoke and world-space surface-aware rain, splashes, drip/runoff and portable volume caches | Pin versions and bake manifests; verify cache compatibility, cost, LODs, host interaction and determinism |
| Audio | [Kenney audio assets](https://kenney.nl/assets/category:Audio), [licence support](https://kenney.nl/support) | CC0 | Simple provenance-bearing impacts, UI, ambience and basic SFX inventory | Often game-like/stylised; useful coverage but insufficient alone for hero cinematic sound |

## Conditional candidates

- The open-source Rokoko Blender retargeter may contain useful mapping, scale and rest-pose techniques, but its exact tag/licence must be audited because historical metadata has been inconsistent. Online service/login/download paths cannot become a production dependency.
- Freesound can be considered only through manual per-asset licence review. Its free API is noncommercial, and noncommercial assets are prohibited from the automatic commercial production library.
- Mixed-license bulk marketplaces require artifact-by-artifact clearance and are not default production sources.

## Explicit exclusions from the foundational path

Do not make Mixamo, Auto-Rig Pro, Human Generator, proprietary environment importers, commercial stock libraries, Google 3D-city data, noncommercial SFX collections or paid hosted generators foundational dependencies. A future user-approved optional integration would still require an ADR and replaceable boundary.

## First research-backed implementation opportunities

1. Build the provenance-aware ambientCG-v3 material ingestion slice specified below, then add Poly Haven through the same source boundary. Persist original files, source URL, licence evidence, version/date, hashes, channel semantics, scale/colour-space mapping and canonical rendered probes.
2. Exercise the existing full MPFB/Rigify boundary with an exact CC0 Quaternius subset and add root-motion, forward-facing, floor contact, toe, wrist, finger and silhouette gates.
3. Compare selected Einar/BlenRig shoulder, elbow, hand, hip, knee and face deformation techniques without creating a parallel character architecture.
4. Build the generic construction-aware architectural-envelope and paving grammars identified by the production audit; use open footprints/assets/materials as inputs behind provenance-bearing adapters.
5. Establish shot-distance render profiles around AgX, exposure probes, adaptive Cycles sampling, denoising auxiliary passes and linear multilayer EXR.
6. Implement world-space surface-aware precipitation, followed by versioned baked OpenVDB hero flame/smoke tiers.
7. Broaden isolated sound inventory with clearly CC0 sources while preserving Videoer's deterministic renderer-owned mix path.

Every implementation must run a materially unrelated transfer fixture before publication. The benchmark remains a periodic consumer/audit, not the place where source-specific integration logic lives.

## Adopted open-asset ingestion contract

Decision date: 2026-09-01. This adopts an implementation direction, not any individual asset. Each selected asset must still pass its own licence, integrity, semantic and visual review.

### Source order and leverage

Implement one ambientCG v3 material vertical slice first, then a Poly Haven adapter behind the same normalized source contract. ambientCG is first because its focused material catalogue and current read-only v3 endpoint provide the shortest path to exercising the complete texture-set boundary on paving or masonry. Poly Haven is second because the same boundary can then expand to per-file PBR maps, HDRIs and models with stronger provider-side file metadata and dependency declarations.

This tranche offers faster immediate leverage on surface realism than further procedural colour/noise tuning, especially for paving, masonry, plaster, wood and wear. It does **not** supersede construction-aware envelope and irregular-paving geometry: image maps cannot repair monolithic silhouettes, shallow openings, missing roof/eave/foundation construction or rectangular paving profiles. Material ingestion and envelope geometry are multiplicative workstreams; the first imported material should be verified on both a neutral swatch and the new construction grammar rather than used to postpone that grammar.

### Current primary-source facts

- [ambientCG licence](https://docs.ambientcg.com/license/): downloadable assets and material preview renders are CC0 1.0; commercial use and inclusion of raw files are allowed without attribution.
- [ambientCG API v3](https://docs.ambientcg.com/api/v3/) and [`/api/v3/assets`](https://docs.ambientcg.com/api/v3/assets/): new integrations should use the read-only v3 API. It returns asset identity, release date, URL, tags, dimensions, channel names, technique and downloadable variants when requested. The service is explicitly not presented as an enterprise-reliability dependency.
- [ambientCG technical updates](https://docs.ambientcg.com/updates/): the 2025 repackaging changed archive structure and filenames, added Blender 4.2, MaterialX/OpenPBR, USD and Godot artifacts, changed HDRI packaging, and removed useful v2 `zipContent` data. This is why the adapter must use v3, inspect the downloaded archive and identify content by semantics rather than assumed historical filenames.
- [Poly Haven asset licence](https://polyhaven.com/license): its HDRIs, textures and models are CC0 and may be used commercially without attribution.
- [Poly Haven API announcement](https://polyhaven.com/our-api), [API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md), and [API repository](https://github.com/Poly-Haven/Public-API): the 2026-07-18 announcement says commercial API use is allowed, but the current repository terms still restrict use to non-commercial projects. Videoer therefore fails closed on new live Poly Haven API ingestion until Poly Haven reconciles those primary sources. Already acquired, independently verified asset bytes remain governed by their recorded CC0 evidence; the API service terms do not retrospectively change an asset licence.
- Poly Haven's current OpenAPI document identifies API version `1.0.0`. `GET /assets` supplies asset metadata including publication date, physical dimensions where available and `files_hash`; `GET /files/{id}` supplies variants, byte sizes, MD5 digests and dependency files. Provider MD5 and `files_hash` are corroborating upstream revision evidence, not substitutes for Videoer's SHA-256 of every downloaded byte.

### Provenance and immutable source package

An import is an explicit networked asset operation. It stages a candidate outside `library/`; rendering, verification, campaign production and ordinary library resolution must never call either provider. Publication copies only self-contained, hashed files into the immutable shared library.

Every candidate must contain a machine-readable source manifest recording:

- provider (`ambientcg` or `poly-haven`), adapter schema/version and provider API version;
- provider asset ID/type, canonical asset-page URL, exact request URLs and retrieval timestamp;
- the unmodified API response bytes and their SHA-256;
- release/publication date, authors when supplied, provider revision fields, selected resolution/encoding and declared dimensions;
- SPDX `CC0-1.0`, the provider licence URL, review date and a small hashed licence-evidence record; API-service terms remain distinct from the asset licence;
- every requested URL, declared size and provider digest, when present, plus the observed size and Videoer SHA-256;
- the raw archive or direct source files, the safe-extraction inventory, normalized channel mapping, declared colour space, physical scale decision and every derived artifact/hash.

ambientCG v3 currently supplies archive URL and size but no provider checksum. Preserve the raw ZIP and make its observed SHA-256 the source-byte identity; `releaseDate` is descriptive metadata, not proof that a later archive with the same URL is unchanged. Poly Haven imports must validate declared size and MD5 before recording their own SHA-256, and must recursively acquire and hash every `include` dependency for a selected glTF, MaterialX or Blender artifact. An upstream content change creates a new candidate/library version; it never mutates a published version.

### Artifact and channel normalization

The first ambientCG slice accepts a single material ZIP at an explicit resolution and encoding. Safe extraction must reject absolute paths, `..` traversal, links, duplicate/case-colliding names, unexpected entry counts and excessive expanded size. Preserve the ZIP; copy only recognized source members into the candidate. Current archives can contain Color, AmbientOcclusion, Displacement, NormalDX, NormalGL and Roughness maps plus MaterialX/OpenPBR, USD, Blender, Godot and preview files. Use `NormalGL` for Blender and Videoer's canonical convention; retain `NormalDX` as provenance but do not silently select or rewrite it. Do not recompress source images.

The renderer-independent texture-set descriptor maps provider names to semantic channels:

| Semantic channel | Input colour space | Notes |
| --- | --- | --- |
| base colour / diffuse | sRGB texture | Decode to scene-linear for shading; alpha remains explicitly described rather than inferred. |
| normal (OpenGL) | non-colour / linear data | Tangent-space, positive-green convention; strength is a separate bounded parameter. |
| roughness | non-colour / linear data | Roughness, never silently inverted from gloss. |
| metallic | non-colour / linear data | Optional; absent means a declared dielectric default, not a missing-file guess. |
| ambient occlusion | non-colour / linear data | Optional layer with explicit combination semantics; never treated as sRGB. |
| displacement / height | non-colour / linear data | Mid-level, sign and metre amplitude must be explicit before displacement is enabled. Unknown scale permits a bump-only candidate, not an invented physical displacement. |
| opacity | non-colour / linear data | Optional and explicit. |

Physical coverage is expressed in metres in Videoer's descriptor. Convert provider dimensions only when the provider's unit semantics are authoritative and non-zero. Zero, absent or ambiguous dimensions become `scaleStatus: unknown` and block scale-verified publication until a documented calibration is supplied; the adapter must not assume a convenient one-metre tile. Mapping, UV transform and projection remain renderer-independent. Provider MaterialX/OpenPBR files are useful corroborating inputs, but do not become the stored domain model or the only executable representation.

Poly Haven follows the same descriptor. Prefer explicit maps for material ingestion and a portable glTF plus its complete dependency closure for model ingestion; preserve `.blend` or `.mtlx` only as optional source artifacts. HDRIs retain unclipped linear HDR/EXR bytes, declared resolution/dynamic-range metadata and a renderer-independent rotation/exposure binding.

### Deterministic cache and offline boundary

Discovery responses may use a short-lived, explicitly refreshable cache, but accepted source bytes may not. A download is first streamed to a temporary file with bounded size, then validated and moved into a content-addressed cache keyed by its complete SHA-256. A normalized derivation key hashes the adapter version, source SHA-256 values, exact channel selection, scale/colour-space mapping and conversion parameters. Cache hits revalidate manifests and live hashes; they never trust filenames, URLs, timestamps or existence alone. `--refresh` may discover new upstream bytes but must produce a new candidate identity. `--offline` resolves only exact cached content and fails with a precise missing-hash diagnostic.

The provider adapter belongs at the application/asset-source boundary, not inside Blender or Remotion. A suitable implementation seam is `src/assets/sources/` for provider-neutral source manifests plus `ambientcg.ts` and `poly-haven.ts`, an explicit `video asset source search|import|refresh` CLI family in `src/cli.ts`, and a texture-backed material discriminant or companion manifest beside the existing procedural contract in `src/materials/model.ts`. Publication continues through `writeHashedAssetMetadata`, `validateLibraryAsset` and `publishAsset` in `src/assets/library.ts`; the existing procedural materials remain valid and are not replaced.

### Verification and tests

Before a material can become `verified`, generate deterministic, provider-free probes from the persisted files:

1. channel inventory and decoded-image checks: dimensions, finite values, expected component count, colour-space assignment, normal-vector sanity and non-flat roughness/height ranges;
2. a metre-marked planar scale/tiling witness plus one-tile and repeated-tile seam views;
3. top, raking, close and glancing swatch views under a neutral calibrated rig, with displacement/bump silhouette evidence where enabled;
4. neutral-dry and intended wet/night lighting views so attractive grading cannot hide broken albedo, normal or roughness response;
5. one architectural application and one materially unrelated transfer fixture at the claimed shot-distance tier;
6. a qualitative accepted/rejected review that may not pass solely because hashes and schemas are valid.

Reuse `src/application/material-gallery.ts` and `src/application/environmental-material-acceptance.ts` as acceptance patterns, extending them rather than creating a parallel gallery. Add fixture-backed adapter tests with saved official response shapes and a local HTTP server: no test should require internet access. Coverage must include v3 selection, upstream-repack detection, missing provider checksums, Poly Haven dependency closure, SHA-256/MD5 mismatch, truncated downloads, redirect handling, malicious ZIP entries, archive-bomb limits, channel aliases, DX/GL normal choice, unknown physical scale, colour-space mapping, cache idempotence, explicit refresh, offline success/failure, immutable publication, renderer isolation and an unrelated material transfer. `test/materials.test.ts`, `test/asset-integrity.test.ts` and a focused `test/open-asset-sources.test.ts` are the natural verification seams.
