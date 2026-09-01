# ADR 038: Physical atmospheric VFX layers and surface response

## Status

Accepted.

## Context

The first reusable rainy-dusk asset proved deterministic camera-relative foreground, midground, and background streaks plus volumetric fog. Its drops nevertheless shared one length, speed, and hard-coded slant per layer, while rain ended at the camera volume without interacting with a surface. That can satisfy topology checks while still reading as animated line geometry.

Screen-space splash sprites would be cheap, but they would not remain grounded under camera motion and would couple the persistent VFX asset to one compositor. Surface response belongs in the renderer-independent atmospheric contract.

## Decision

Rain declares a horizontal wind velocity in metres per second. Each depth layer retains immutable identity, seed, depth interval, and span while declaring bounded seeded length and speed variation. Renderers derive streak direction from wind and each drop's travel time rather than from a visual slant constant.

Optional ground splashes declare a deterministic seed, world-space bounds, radius range, crown height, lifetime, opacity, and colour. Blender reconstructs each impact as a small ring and crown in the world ground plane and animates impact, expansion, and collapse. Splash placement is not camera-parented. Environment-receiver adaptation may replace only the world-space minimum and maximum bounds; seed, count, radius, crown, lifetime, opacity, colour, rain topology, and wind remain invariant and are reverified. This makes receiver placement explicit without turning it into a shot-local geometry hack.

Atmospheric factories emit `validated` candidates. Structural success and a rendered contact sheet do not imply visual acceptance or publication. Review must reject floating impacts, missed receivers, diagrammatic crowns, oversized near-camera streaks, synchronized repetition, excessive emission, and loss of subject readability.

Transfer review uses `vfx transfer-probe`: it composes a VFX JSON asset with any existing executable scene, resolves that scene's dependencies without changing them, and renders its semantic landmarks at the scene's authoritative profile. This proves the same atmosphere under intended cameras and set receivers without campaign-specific orchestration. Like every cinematic landmark probe, it is iteration-only and cannot publish an asset without complete temporal evidence.

Close ground response uses `vfx ground-response-probe`. It renders the unchanged declared splash count, bounds, seed, size, lifetime, opacity, and rain topology for twelve production-profile frames from a deterministic low raking camera. The fixture may improve evidence visibility through camera and lighting, but it must not concentrate impacts into a smaller receiver or increase their opacity merely to pass review. Acceptance requires impacts to remain attached to the receiver, evolve across phases, and read as restrained water response rather than wire crowns or diagrammatic rings.

The first close probe rejected the v4 renderer reconstruction: world placement and phase variation were correct, but five-segment ripple fragments and three-point crown strokes read as angular wire glyphs. A second probe with smoother, thinner curves removed the sharp angles but still read as luminous drawn arcs. A third representation correctly replaced strokes with shallow annular water-wave surfaces and volumetric droplets, but complete uniform rings still read as graphic donuts on rough stone. The corrected surface reconstruction therefore introduces stronger bounded radial irregularity, deterministic broken wavefronts, and a broader lower-specular water response. It keeps the same domain declaration, density, opacity, timing, size, and receiver bounds; this remains a renderer repair rather than an asset adaptation.

The broken-wave surface passed the close old-city fixture but failed the unrelated smooth night-transit platform, where its coloured Principled body produced many bright graphic loops. Publication remained rejected. Ground response now uses the same declared opacity with a physically water-like backend material: dark neutral body, 1.333 IOR, high transmission, and restrained specular level. Receiver lighting may reveal the wave surface, but the mesh must not contribute a diffuse blue ring independent of its surroundings.

## Consequences

Atmospheric assets can now describe wind and physical surface response once, adapt their density and exposure across campaigns, and render through replaceable backends. World-space bounds require environment-aware adaptation, which is intentional: a wet street, rooftop, and forest canopy do not share one receiver region.

The first v1 wind/splash probe was rejected despite correct ground placement. Its closest streaks became large bright bars and its emissive splash crowns read as wire flowers. V2 reduces foreground scale/opacity, increases smaller distant density, removes splash emission, and shortens/shrinks the crowns. Rejected evidence is retained as part of the visual iteration record.
