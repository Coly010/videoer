# Paving multi-scale weathering research

Research date: 2026-09-02.

## Sources and adoption boundary

- MaterialX 1.39 specification, Apache-2.0: custom geometric properties are typed, may be varying, and are described as equivalent to USD primvars. Adopted as a terminology and typing reference only; no MaterialX runtime or graph is copied.
- OpenUSD primvars documentation, Apache-2.0: distinguishes constant, uniform, varying, vertex and face-varying interpolation. Adopted the explicit `vertex` interpolation semantic for the first Videoer attribute slice; no USD runtime is required.
- Blender 4.5.13 Python/shader API, GPL application boundary: mesh point attributes and shader attribute lookup provide the current backend mapping. Blender remains a replaceable renderer and no Blender node identity enters the asset schema.

## Implemented model

The generic geometry contract now carries named `float`, `vec2`, `vec3` and `vec4` attributes with explicit vertex interpolation and exact cardinality checks. Paving uses three signed scalar channels for unit value, roughness and weathering. The material application owns bounded amplitudes and exact semantic names. This creates three independent scales: source-map microdetail, stable per-unit response, and metre-scale correlated macro response.

## Transfer finding

Historic and contemporary HDRI/water probes pass the new structural and renderer checks. The per-unit layer breaks exact uniformity without creating tiled materials or colour noise. Visual improvement remains limited because Rock043S is still excessively high-frequency/noisy for historic setts and Concrete046 remains chalky for contemporary pavers. Increasing attribute amplitudes would amplify source mismatch rather than create believable material history. The next action is better homogeneous source selection or project-owned source synthesis, followed by local dirt/wear masks; neither current paving material is publishable.
