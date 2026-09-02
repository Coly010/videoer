# Construction-surface history research

Research date: 2026-09-02.

## Adopted foundations

- Blocken et al.'s wind-driven-rain literature defines facade rain as horizontal rainfall multiplied by a catch ratio dependent on geometry, wind and droplets. The open 2023 Zurich study provides the working definition and evidence basis ([Building and Environment, DOI 10.1016/j.buildenv.2023.110038](https://doi.org/10.1016/j.buildenv.2023.110038)). Videoer currently reuses the existing verified fractional exposure field; directional catch and deterministic hemisphere visibility are queued extensions, not claimed as implemented CFD.
- Chew and Tan report that ledges, joints and projections disturb runoff and determine facade staining ([Construction and Building Materials, DOI 10.1016/S0950-0618(02)00102-2](<https://doi.org/10.1016/S0950-0618(02)00102-2>)). Videoer adopts the causal distinction between exposure, flow and staining, without copying text, code or proprietary assets.
- Helbing, Keltsch and Molnár model active-walker trail reinforcement and decay ([arXiv:cond-mat/9805158](https://arxiv.org/abs/cond-mat/9805158)). The first implementation uses explicit routes and a deterministic lateral kernel; active route reinforcement remains an optional higher-value synthesis tier.
- FHWA reports wheel-wander standard deviations from 8 to 24 inches and publishes a public pavement-distress vocabulary covering wheel paths, polished aggregate, rutting, patching and spalling ([FHWA-HRT-12-072](https://www.fhwa.dot.gov/publications/research/infrastructure/pavements/12072/006.cfm), [FHWA-HRT-13-092](https://www.fhwa.dot.gov/publications/research/infrastructure/pavements/ltpp/13092/)). Future vehicle profiles must declare track gauge, tyre width and wander; the system will not hide one universal wheel-path number.
- Barnes, Lehman and Mulla's Priority-Flood work supports depression filling and spill connectivity on regular and irregular domains ([arXiv:1511.04463](https://arxiv.org/abs/1511.04463)). If richer persistent drainage is required, Videoer will implement the published algorithm cleanly. It will not copy RichDEM's GPL-3.0 implementation into the project.
- EPA SWMM documents bounded buildup and supply-limited washoff equations and explicitly warns that coefficients require calibration ([SWMM Water Quality Reference Manual](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P100P2NY.TXT), [official SWMM](https://www.epa.gov/water-research/storm-water-management-model-swmm)). The public-domain equations are the planned dirt-mass foundation. Published pollutant coefficients will not be relabelled as visual defaults.
- NOAA CDO and NASA POWER are possible persisted climate inputs ([NOAA Climate Data Online](https://www.ncdc.noaa.gov/cdo-web/), [NASA POWER](https://power.larc.nasa.gov/)). Rendering must remain provider-free; any fetched dataset needs exact product, retrieval date, hash and licence provenance.

## Licensing and adoption exclusions

- Do not copy RichDEM GPL-3.0, JuPedSim/libpedsim LGPL, or SUMO EPL code into the core without a deliberate licence decision.
- Do not bundle OpenStreetMap extracts as permissive defaults; ODbL provenance/share-alike obligations require an explicit campaign input decision.
- Do not use Google Street View, Quixel/Megascans, Substance-only generators, proprietary ASTM tables, AASHTOWare material or commercial texture libraries as reusable defaults.
- Recast Navigation is zlib and the `recast-navigation` JavaScript/WASM package is MIT; either may be evaluated for complex walkable route synthesis. A small project-owned deterministic route solver is preferable while current needs remain simple.

## Implemented boundary and calibration status

Version 2 persists the exact Priority-Flood parent tree from the conserved water solve and uses it for one-pass, mass-conserving loose-dirt transport. Material profiles declare annual loading, persistent fraction, runoff-depth washoff coefficient, per-cell capture fraction and kilogram-per-square-metre coverage references. Repair cells accumulate against repair age rather than the original installation age. The field records built, persistent, incoming, mobilized, deposited, final loose, outflow and exported kilograms separately; bounded coverage is derived only after mass accounting.

The public-domain EPA equations justify the bounded buildup/washoff shape, not the first numeric coefficients. Current historic and contemporary profiles are deterministic cinematic heuristics and must say so in review evidence. They are not surveyed histories or civil-engineering calibration. `calibrated` is reserved for a profile with a named dataset, licence, retrieval date, content hash, units, fitting method and measured residual/error. The next causal slices remain explicit pedestrian/twin-wheel pass density, event-led repair ledgers and multi-date verification; directional exposure is added only when a real shot proves the existing verified exposure insufficient.

## Version-3 response correction

The channel-isolation audit separated renderer attribution from field quality. Every v2 channel was independently live, but numerical inspection showed that Gaussian traffic tails, direct use of raw open-sky exposure, and a shared shallow runoff clamp—not missing Blender wiring—caused the weak real-host discrimination. Version 3 therefore preserves the exact v2 water routing and dirt kilograms while applying compact-support traffic and explicit half-response parameters. This is a response-model correction, not percentile normalization: the same physical input retains the same meaning across receivers, and no host-local histogram is used to manufacture contrast.

The first transfer parameters remain heuristic. Traffic half-response pass counts preserve the old centreline half-response implied by `ln(2) / wearPerPass`; exposure half-years are declared by host age class; runoff backgrounds and half-depths are selected from the existing routed-field distributions and recorded in the profile. Future calibrated replacements require the provenance package defined above.
