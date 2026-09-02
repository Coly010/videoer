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

## Construction-domain optical response

One history value must not imply one universal shader response. The renderer-independent response layer should classify at least natural joint, stabilized/polymeric joint, kerb top, kerb road face, gutter invert and exposed compacted substrate. Dynamic wetness remains separate from irreversible history.

- Natural grit joints can be compacted and filled with traffic-borne detritus while concentrated tyre shear or routed water removes coarse joint material. Model fill recession and fine-material clogging separately: a recessed joint may later acquire a dark crust. CMHA treats a 12 mm sand drop as a maintenance threshold; use that only as a visible failure landmark, not a universal calibration.
- Stabilized/polymeric joints are a distinct bound material. High cohesion suppresses gradual granular loss; threshold failure should form coherent cracks, flakes or local separation. Product-specific UV, freeze/thaw and colour rates are not portable defaults.
- Kerb tops, road-facing faces, rear faces and arrises require separate semantic masks. Pedestrian polish belongs mainly on top faces; tyre scuff requires trajectory/contact evidence on the road face; toe staining and retained dirt follow drainage. Chips change geometry or normals rather than colour alone.
- Gutter throughflow may clean loose dirt from the fast-flow core while persistent staining remains. Sediment accumulates preferentially at low-velocity margins, local minima and upstream of obstructions or inlets. A single `more runoff = more dirt` response is therefore invalid.
- Exposed compacted substrate can lose micro-relief under traffic and develop rutting, corrugation, raveling, coarse-aggregate exposure or downslope erosion. These need height/normal response and routed sediment transfer. Do not weather substrate hidden beneath intact paving.

The following deterministic equations are **heuristic priors**, not empirical calibration:

```text
half(x, h) = x / (x + h)
flowCleaning = runoffThroughflow * (1 - retainedWater)
depositionPotential = dirtSupply * (1 - flowShear) * (0.25 + 0.75 * retainedWater)
lossHazard = trafficShear * trafficDisplacementResponse
           + runoffThroughflow * runoffErosionResponse
recession = maximumVisibleRecession * half(lossHazard * age, erosionHalfResponse)
          * (1 - cohesion)
jointClogging = half(persistentDirtMass / exposedJointArea, cloggingMassHalfResponse)
hardSurfacePolish = trafficWear^trafficExponent * trafficPolishResponse
```

Profiles using these equations must retain `heuristic-prior` provenance until a named, licensed dataset supplies units, fit method and residual/error. Natural and stabilized joints need different cohesion/failure parameters rather than scalar variants of the same appearance recipe.

Required probes are: identical fields through natural-versus-stabilized joints; isolated pedestrian, vehicle braking/turning, throughflow, retained-water and clean-control states; kerb top/road-face/back-face isolation; a gutter with a cleaned flow core and deposited margins/minima; and exposed substrate showing micro-relief loss plus routed erosion/deposition. Verification must preserve dirt mass, irreversible temporal monotonicity, fixed-lighting channel witnesses and a neutral material baseline.

### Licensing-safe evidence

- The FHWA [Gravel Roads Construction and Maintenance Guide (2015)](https://www.fhwa.dot.gov/construction/pubs/ots15002.pdf), [Unpaved Road Dust Management chapter 5](https://www.fhwa.dot.gov/clas/ctip/unpaved_roads_dust/ch_5.aspx) and [chapter 6](https://www.fhwa.dot.gov/clas/ctip/unpaved_roads_dust/ch_6.aspx) support the drainage, compaction, raveling, washboarding, fines-loss and erosion mechanisms. FHWA web information is distributable public information, but contractor-created figures may retain separate rights; adopt facts and do not import unverified illustrations.
- FHWA's [Permeable Interlocking Concrete Pavement guide (2015)](https://www.fhwa.dot.gov/pavement/concrete/pubs/hif15006.pdf) documents near-surface sediment-jammed aggregate. The linked [USGS 2014–2016 permeable-pavement dataset](https://data.usgs.gov/datacatalog/data/USGS%3A5995b535e4b0fe2b9fea75ed) is explicitly US public domain and is suitable for future sediment/runoff calibration. Permeable-pavement clogging depths must not be generalized to dense or stabilized joints.
- CMHA's [joint-sand selection](https://www.cmha.org/resource/pav-tec-017/), [maintenance](https://www.cmha.org/resource/pav-tec-006/), [stabilization](https://www.cmha.org/resource/pav-tec-005/) and [edge-restraint](https://www.cmha.org/resource/pav-tec-003/) notes support traffic-borne detritus, sand loss, stabilization and concentrated-flow distinctions. They are factual guidance only: CMHA text and figures are not permissively licensed project assets.
- [Material Maker 1.6](https://github.com/RodZill4/material-maker) is MIT-licensed and may inform deterministic graph-based PBR authoring and channel isolation. [ASAM OpenCRG](https://github.com/asam-ev/OpenCRG) is Apache-2.0 and may inform portable road-aligned scalar-field interchange; it is not a weathering algorithm.
- [Poly Haven Pavement 05](https://polyhaven.com/a/pavement_05) and [ambientCG](https://ambientcg.com/) provide CC0 PBR baselines. Persist exact asset identity and hashes. Use them as neutral optical references, never as causal history masks.

Do not adopt manufacturer colour claims, forum anecdotes, facade black-crust chemistry, proprietary standards tables or copied commercial material graphs as calibration. Do not encode uniform traffic polishing, uniform gutter darkening or invisible substrate weathering merely to increase visual contrast.
