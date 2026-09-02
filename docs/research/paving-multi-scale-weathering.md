# Paving multi-scale weathering research

Research date: 2026-09-02.

## Sources and adoption boundary

- MaterialX 1.39 specification, Apache-2.0: custom geometric properties are typed, may be varying, and are described as equivalent to USD primvars. Adopted as a terminology and typing reference only; no MaterialX runtime or graph is copied.
- OpenUSD primvars documentation, Apache-2.0: distinguishes constant, uniform, varying, vertex and face-varying interpolation. Adopted the explicit `vertex` interpolation semantic for the first Videoer attribute slice; no USD runtime is required.
- Blender 4.5.13 Python/shader API, GPL application boundary: mesh point attributes and shader attribute lookup provide the current backend mapping. Blender remains a replaceable renderer and no Blender node identity enters the asset schema.

## Implemented model

The generic geometry contract carries named `float`, `vec2`, `vec3` and `vec4` attributes with explicit vertex interpolation and exact cardinality checks. Paving first used three signed scalar channels for unit value, roughness and weathering. It now also emits bounded edge-wear and dirt-accumulation masks. Every paving loop is normalized to outward winding, and the visible top owns an explicit inset band that interpolates stronger joint-adjacent exposure/dirt into a cleaner interior. The material owns bounded amplitudes and exact semantic names. This separates source microdetail, stable per-unit response, construction-local masks and metre-scale correlated response without relying on renderer-specific pointiness or island randomness.

Texture-placement variation remains the three-channel contract. Construction-semantic masks are surface-level only; declaring both paths is rejected to prevent double application. TypeScript and Blender validate names, pairing, ranges, live geometry and decoded render influence independently.

## Transfer finding

Historic and contemporary HDRI/water probes pass the new structural and renderer checks. Project-owned `cut-stone` and `granular-aggregate` materials remove the doubled photographed layout and the construction band produces a real, deterministic local response. Visual inspection still rejects both. Historic paving is too orderly and mineral-poor; contemporary paving is pale/chalky; neither carries coherent traffic, shelter, drainage, staining, repair or chipped-silhouette history across centimetre-to-metre scales. Increasing random amplitudes is still rejected. The next action is a renderer-independent surface-history field plus richer homogeneous mineral/concrete response and bounded construction irregularity; neither current paving material is publishable.
