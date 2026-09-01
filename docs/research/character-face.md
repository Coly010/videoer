# Production-human face research

## Reusable boundary

The face system belongs to the character domain, not to Elara or the reference benchmark. A face identity is a renderer-independent set of continuous parameters, authored topology/material regions, sparse expression morphs, and verification evidence. Blender adapts and renders those values but does not own the identity definition.

Version 2 currently exposes jaw width/taper, cheek volume, nose length/width, eye scale/spacing, brow height, chin projection, mouth width, and lip fullness. Changing those parameters alters geometry while retaining the stable 52-joint body/hand skeleton. The generated face includes recessed socket cavities, embedded sclera/iris geometry, separate lid and brow surfaces, upper/lower lips, an oral cavity, and four sparse morphs: smile, jaw-open, left blink, and right blink.

## Rendered iteration

The first face render was rejected as a theatrical mask: protruding eyes, floating slab eyelids, ruler brows, sausage lips, and over-carved cheek shadows. The second pass reduced eye/nose/cheek projection, rebuilt thin lid margins and arched brows, and split the upper lip into two lobes. Expression renders then exposed two mechanical-looking failures: jaw-open detached the lower lip over empty background, while blink moved lid strips below eyes that remained open. The next pass added a deforming oral cavity and collapsed the complete eye aperture during blink.

Those controls now have distinct semantics, but the face remains far below production acceptance. Front and three-quarter evidence still show an egg-shaped/faceted cranium, flat facial depth, absent ears and nostrils, protruding eyes, crude jaw/chin/neck anatomy, graphic insert-like lips/brows, a rectangular open mouth, a white blink seam, no surrounding tissue recruitment, and uniform porcelain material response.

The current seven-artifact, content-addressed rejection is:

`campaigns/reference-cinematic-benchmark/work/characters/production-human-articulated-v0.2.0/verification/face-visual-review.json`

The next correct route is a project-owned anatomical facial template with explicit forehead, temple, zygomatic, maxilla, mandible, chin, ear, lid-loop, nasal, and perioral topology. The current SDF landmarks remain a useful parameter and verification prototype; they are not a surface to polish indefinitely or publish as a production face.
