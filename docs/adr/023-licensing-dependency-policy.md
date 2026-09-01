# ADR 023: Licensing and dependency policy

Status: Accepted

## Decision

Foundational production infrastructure must be permissive open source, project-authored, or—when functionally justified—copyleft tooling whose use does not impose a commercial runtime licence on produced media. Commercially licensed generators, parametric humans, stock libraries, and hosted asset services are not foundational dependencies.

Substantial production work begins with a documented research survey rather than an assumption that the subsystem must be invented locally. Search current permissively licensed OSS implementations and assets, open datasets, research papers, technical blogs, community wikis, standards, and authoritative engine/DCC documentation across character rigs, geometry, environments, textures, materials, lighting, render configuration, simulation, hair/fluid/particle systems, VFX, sound, compositing, and verification. Record the source, licence, version or access date, compatibility, relevant evidence, and the exact artifact, data, convention, algorithm, or setting adopted. Prefer direct reuse through replaceable boundaries when the licence, quality, determinism, and architecture are suitable; otherwise use the documented knowledge to accelerate a project-owned implementation. Do not duplicate a solved compatible subsystem merely to make it local, and do not treat an uncited blog recipe or unknown-license asset as cleared production input.

Every third-party asset, model, generator, library, and tool used in production must record its identity, version, licence, source, attribution obligation, commercial-use status, and clearance. Automatic production resolution selects only `commercialUse: allowed` plus `clearance: approved`. Unknown or restricted material remains quarantined from automatic use.

Generative providers may create persisted, provenance-bearing inputs. Deterministic render and verification may never invoke them. A research model cannot silently move into the production path; that requires a recorded ADR, licence review, reproducibility plan, tests, and an explicit replaceability boundary.

The dated candidate inventory and adoption cautions are maintained in [Open production ecosystem survey](../research/open-production-ecosystem.md). Listing is research evidence, not automatic clearance or adoption.

## Consequences

Three.js (MIT), Blender (GPL), FFmpeg under its installed build terms, Remotion, PixiJS, and future dependencies are audited in documentation before becoming required production infrastructure. Generated media must not depend on a live paid service to render again.

MPFB is an approved open-source production-character dependency when used through the documented Blender adapter. MPFB application code is GPL-3.0-or-later; its bundled base mesh, rigs, weights, poses, expressions, and other output-contributing data are CC0-1.0 under MPFB's explicit code/asset licence split. Blender's bundled Rigify addon is GPL-2.0-or-later. Commercial rendered output is permitted; if Videoer ever distributes generated Rigify scripts or modified GPL program code, those program artifacts must retain the applicable GPL source and notices. The reproducible installer pins MPFB commit `437dd513888a92399d1d3200d2e80859fae55abc` and verifies the exact CC0 rig-asset hashes before installation.
