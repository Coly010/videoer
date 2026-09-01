# MakeHuman hm08 production-base source

This directory contains the unmodified MakeHuman `hm08` base OBJ as a legally clean source topology for Videoer's project-owned production-character derivations.

- Upstream repository: `https://github.com/makehumancommunity/makehuman`
- Upstream path: `makehuman/data/3dobjs/base.obj`
- Pinned source commit: `3c701a8e52f09e69922e8b598d23be2d7dfc49e3`
- Downloaded: 2026-08-31
- Source SHA-256: `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`
- Authored base weights path: `makehuman/data/rigs/default_weights.mhw`
- Authored base weights commit: `101de03dae28a612ab336524167b96222bd8217f`
- Authored base weights SHA-256: `0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625`
- Licence: CC0 1.0 Universal
- Licence file SHA-256: `f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c`

The OBJ header explicitly records its September 2020 CC0 release and copyright holders. The upstream repository's asset licence independently states that bundled graphical assets—including the base mesh, proxies, targets, textures, clothes, poses, and expressions—are CC0. Videoer does not vendor, link, or invoke MakeHuman's AGPL application code.

The unmodified source includes a 13,378-quad `body` plus separate ocular, oral, eyelash, hair-helper, clothing-helper, and landmark groups. The separate CC0 weight map declares itself as symmetric weights for the default MakeHuman mesh. Production conversion must explicitly allowlist required graphical groups; helper clothing, genital, landmark-cube, and other rig-authoring groups must not leak into a rendered character accidentally. Upstream weight names must be explicitly mapped into Videoer's stable canonical joint vocabulary, limited to four normalized influences per vertex, and reverified in Videoer's deformation runtime.

## MPFB rig audit

MPFB 2.0.17 commit `437dd513888a92399d1d3200d2e80859fae55abc` contains a `data/3dobjs/base.obj` with SHA-256 `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`, byte-identical to this directory's `base.obj`. Its CC0 production-rig assets were verified as:

- default rig: `8b949de35c2dd70dbb5094e57a8586c3b9a9f650775a293212581a8f67be6797`;
- default weights: `154b866774a8c2b055a8e86419f22a87b76c60440fdcb70bcb78345f00924e89`;
- Rigify human-with-toes metarig: `970f19f9e426528052a0f8bfc2cd6f1eea627aa607517ff4e43ae88d96488846`;
- Rigify human-with-toes weights: `edcbca3323b03080fe750caa292c673ecbacdd200ebf0062d00d3b425e13a999`.

The original `default_weights.mhw` remains pinned for reproducibility of earlier Videoer evidence, but it is not assumed to be the highest-quality production binding. The MPFB audit found a 163-bone full default rig and a generated 209-deform-bone Rigify binding, versus Videoer's current 52-joint reduction. Future production comparisons must preserve both inputs and identify the exact binding used; never overwrite historical weight evidence silently.

Videoer remains responsible for:

- conversion into metres and its right-handed, Y-up, forward-negative-Z coordinates;
- mapping to the stable Videoer canonical skeleton;
- reusable skin weights and pose-space correctives;
- body and identity morphs;
- materials, modular hair, wardrobe, and accessories;
- mechanical and hash-bound visual acceptance;
- publishing only derived assets whose exact source and evidence remain content-addressed.

CC0 suitability removes a licensing blocker; it does not make the topology visually or mechanically accepted by itself.
