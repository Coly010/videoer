# ADR index

Current policy lives in [`docs/product-principles.md`](../product-principles.md). Where any ADR
below conflicts with it, the product policy and [ADR 072](072-pragmatic-production-realignment.md)
win.

Status legend:

- **Current** — ordinary, uncontroversial engineering decision. Still fully authoritative.
- **Narrowed** — the original decision is a valid, retained implementation, but ADR 072 removes
  the universal-mandate reading (renderer independence, cross-campaign transfer, benchmark
  conformance, or publication-as-precondition). See ADR 072's table for the specific narrowing.
  Available as tool-native, optional infrastructure, not a required path.
- **Reference** — narrow, domain-specific implementation decision (an environment/material/prop
  detail for the Blender-backed cinematic path). Retained as implementation documentation; not an
  architecture-level mandate and not individually narrowed by ADR 072.

| ADR | Title | Status |
| --- | --- | --- |
| 001 | Repository and package architecture | Current |
| 002 | TypeScript runtime and package manager | Current |
| 003 | Campaign and storyboard schemas | Current |
| 004 | Rendering architecture | Current |
| 005 | Template and style system | Current |
| 006 | Provider abstraction | Current |
| 007 | Asset storage cache and reproducibility | Current |
| 008 | CLI architecture | Current |
| 009 | Error handling, logging, and diagnostics | Current |
| 010 | Codex CLI image provider experiment | Current |
| 011 | Testing strategy | Current |
| 012 | Determinism versus generative operations | Current |
| 013 | Verification and inspection architecture | Current |
| 014 | External agent and application boundary | Current |
| 015 | Scene keyframes | Current |
| 016 | Scene composition and PixiJS VFX | Current |
| 017 | Autonomous production architecture | Current |
| 018 | Shared asset library | Narrowed — see [ADR 072](072-pragmatic-production-realignment.md) |
| 019 | Renderer-independent procedural geometry | Narrowed — see ADR 072 |
| 020 | Character skeleton and motion | Superseded for the production human — see [ADR 074](074-mpfb-rigify-is-the-production-human.md) (also narrowed by ADR 072) |
| 021 | Production renderer boundaries | Narrowed — see [ADR 073](073-three-js-is-a-conversion-utility-not-a-backend.md) (its Three.js line describes an unbuilt future adapter, not a current backend); otherwise a good example of the pragmatic tool-boundary approach ADR 072 asks for |
| 022 | Visual and temporal output as test surfaces | Current |
| 023 | Licensing and dependency policy | Current |
| 024 | Research-grounded phase motion synthesis | Demoted — see [ADR 074](074-mpfb-rigify-is-the-production-human.md) (human motion targets the Rigify rig; canonical gait is not the production path) |
| 025 | Articulated prop interactions | Reference |
| 026 | One continuous bookshop exterior/interior set | Reference |
| 027 | Executable cinematic scene contract | Narrowed — see ADR 072 |
| 028 | Treat benchmarks as conformance suites | Narrowed — see ADR 072 (the central doctrine ADR 072 corrects) |
| 029 | Cross-domain derived asset contracts | Narrowed — see ADR 072 |
| 030 | Renderer-independent temporal clothing | Narrowed — see ADR 072 |
| 031 | Deterministic audio treatment derivation | Narrowed — see ADR 072 |
| 032 | First-class lighting derivation and transfer | Narrowed — see ADR 072 |
| 033 | Semantic camera-path fidelity and clearance | Current |
| 034 | First-class editorial derivation and transfer | Narrowed — see ADR 072 |
| 035 | Autonomous campaign production loop | Current (production mechanics, not a transfer/conformance mandate) |
| 036 | Deterministic Blender render profiles | Current |
| 037 | Renderer-independent procedural sound effects | Narrowed — see ADR 072 |
| 038 | Physical atmospheric VFX layers and surface response | Reference |
| 039 | First-class modular hair assets | Narrowed — see ADR 072 |
| 040 | Portable practical fixtures | Reference |
| 041 | Semantic environment dressing families | Reference |
| 042 | Architectural modules require real host apertures | Reference |
| 043 | Metre-scaled environmental weathering | Reference |
| 044 | Portable open rainwater systems | Reference |
| 045 | Portable projecting signage with replaceable content | Reference |
| 046 | Layered projecting canopy systems | Reference |
| 047 | Authored-colour electrical practical modulation | Reference |
| 048 | Geometry-bound surface placement | Reference |
| 049 | Surface-bound vegetation families | Reference |
| 050 | Physical market merchandising families | Reference |
| 051 | Source-bound secondary atmosphere | Reference |
| 052 | Authored workshop workstations | Reference |
| 053 | Renderer-independent cinematic finishing | Narrowed — see ADR 072 |
| 054 | Cross-era interior furnishings and exact support semantics | Reference |
| 055 | Unit-aware paving surfaces | Reference |
| 056 | Receiver-aware static surface water | Reference |
| 057 | Granular paving construction materials | Reference |
| 058 | Conserved surface-water optical reconstruction | Reference |
| 059 | Provenance-bound environment illumination | Reference |
| 060 | Construction-semantic surface variation | Reference |
| 061 | Causal construction-surface history sidecars | Reference |
| 062 | Discriminable construction-surface history responses | Reference |
| 063 | Explicit construction-material history participation | Reference |
| 064 | Bound-surface dry-roughness provenance | Reference |
| 065 | Rendered construction-surface responses | Reference |
| 066 | Calibrated texture displacement | Reference |
| 067 | Poly Haven provider-file material sources | Reference |
| 068 | Support-conserving surface-water optics | Reference |
| 069 | Separate porous dampness from coherent water | Reference |
| 070 | Exact role-aware architectural-envelope material assembly | Reference |
| 071 | Typed shot intent over executable camera paths | Current |
| 072 | Pragmatic production realignment | Current — the superseding ADR |
| 073 | Three.js is a conversion utility, not a backend | Current — first follow-up decision from the realignment's cinematic backend evaluation |
| 074 | MPFB (hm08 CC0) + Rigify is the production human | Current — supersedes ADR 020's project-owned human, demotes ADR 024 |

## Why so many "Reference" entries

ADRs 025–026 and 038–070 are narrow, one-off decisions about a specific environment prop, material,
or surface behaviour. Under the current architecture-creation threshold in
`docs/product-principles.md`, none of these would warrant a fresh ADR today — ordinary
documentation would do. They are kept as ADRs because they already exist and rewriting fifty
files' framing would cost more than it returns; treat them as implementation notes for the
Blender-backed environment system, not as architecture.
