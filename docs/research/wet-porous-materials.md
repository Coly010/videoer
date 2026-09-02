# Wet porous materials and coherent surface water

Status: primary-reference boundary for renderer-independent receiver-water appearance.

Review date: 2026-09-02.

This record separates supported physical/rendering mechanisms from Videoer's authored calibration
priors. It does not claim that a road-pavement texture statistic is a measured value for every
project material.

## Mechanism separation

Jensen, Legakis and Dorsey's [_Rendering of Wet
Materials_](https://graphics.stanford.edu/~henrik/papers/egwr99/egwr99.pdf) distinguishes liquid on
the surface from liquid inside a porous material. Its surface component models an air-liquid and
liquid-material interface; its porous component explains reduced scattering and increased
absorption when water replaces air in pores. The authors report subsurface scattering as the main
darkening mechanism in their experiments and surface water as the source of glaze. They also state
that their fitted scattering parameters were chosen for convincing appearance rather than direct
measurement. Videoer therefore adopts the separation of mechanisms, not numeric darkening values
from that paper.

The NCHRP report [_Improved Surface Drainage of
Pavements_](https://onlinepubs.trb.org/Onlinepubs/nchrp/nchrp_w16.pdf) defines total water depth as
mean texture depth plus water-film thickness. Water below mean texture depth is retained within
macrotexture; water-film thickness is measured above the tops of surface asperities. This is an
engineering drainage definition rather than an optical BRDF, but it supplies the correct physical
boundary: retained water inside texture is not automatically a smooth free-water interface.

## Texture-depth comparators

The Federal Highway Administration's [_Concrete Pavement
Texturing_](https://www.fhwa.dot.gov/pavement/pubs/hif17011.pdf) defines microtexture depth below
0.2 mm and macrotexture depth from 0.1 to 20 mm. It reports a concrete-pavement target average mean
texture depth of at least 0.8 mm with no individual result below 0.5 mm. FHWA Technical Advisory
[_Surface Texture for Asphalt and Concrete
Pavements_](https://www.fhwa.dot.gov/pavement/t504036.cfm) gives 0.7 mm mean texture depth for
exposed-aggregate concrete and requires project-specific texture targets.

Videoer may use 0.5-0.8 mm as a road-concrete validation comparator and 0.7 mm as an
exposed-aggregate comparator. These are not universal thresholds for artistic pavers. Each material
must carry its own evidence basis and should move from `heuristic-prior` to measured reference when
material-specific texture evidence exists.

## Dielectric boundary

PBRT's [_Specular Reflection and
Transmission_](https://pbr-book.org/3ed-2018/Reflection_Models/Specular_Reflection_and_Transmission)
lists water's visible-wavelength-average index of refraction as 1.333 and treats smooth dielectric
reflection/transmission with Fresnel equations. Google's official [_Physically Based Rendering in
Filament_](https://google.github.io/filament/Filament.md.html) gives
`F0 = ((IOR - 1) / (IOR + 1))^2`; water at IOR 1.333 therefore has normal-incidence reflectance of
approximately 0.0204. Videoer binds that IOR to an actual coherent water interface; it does not add
arbitrary specular energy to porous dampness.

## Production implications

Receiver-water appearance has three separate owners:

- porous dampness locally modulates the receiver's base colour and roughness using a
  material-specific calibrated response;
- coherent microfilm can add a receiver-conformal dielectric coat only when local film depth clears
  the material asperity envelope;
- macroscopic puddles belong exclusively to the separately conserved optical-water mesh.

Absorption alone, below-envelope retained water, edge storage without subcell support, and a distant
scene maximum cannot create coherent-film coverage. Calibration values remain explicit evidence and
must never be promoted to measured status merely because a render looks plausible.
