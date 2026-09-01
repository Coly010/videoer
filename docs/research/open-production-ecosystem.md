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

1. Build provenance-aware Poly Haven and ambientCG source adapters that persist original files, source URL, licence snapshot, version/date, hashes, channel semantics, scale/colour-space mapping and canonical rendered probes.
2. Exercise the existing full MPFB/Rigify boundary with an exact CC0 Quaternius subset and add root-motion, forward-facing, floor contact, toe, wrist, finger and silhouette gates.
3. Compare selected Einar/BlenRig shoulder, elbow, hand, hip, knee and face deformation techniques without creating a parallel character architecture.
4. Build the generic construction-aware architectural-envelope and paving grammars identified by the production audit; use open footprints/assets/materials as inputs behind provenance-bearing adapters.
5. Establish shot-distance render profiles around AgX, exposure probes, adaptive Cycles sampling, denoising auxiliary passes and linear multilayer EXR.
6. Implement world-space surface-aware precipitation, followed by versioned baked OpenVDB hero flame/smoke tiers.
7. Broaden isolated sound inventory with clearly CC0 sources while preserving Videoer's deterministic renderer-owned mix path.

Every implementation must run a materially unrelated transfer fixture before publication. The benchmark remains a periodic consumer/audit, not the place where source-specific integration logic lives.
