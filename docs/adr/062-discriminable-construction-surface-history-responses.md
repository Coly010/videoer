# ADR 062: Discriminable construction-surface history responses

## Status

Accepted.

## Context

The version-2 field proved exact routed dirt conservation and independent renderer consumption, but its bounded optical signals were not sufficiently discriminable on real receivers. Gaussian traffic had non-zero tails across most cells, raw open-sky exposure was used directly as accumulated weathering, and throughflow plus retained water shared one shallow hard clamp. Increasing material amplitude would have hidden those field defects rather than corrected them.

## Decision

Surface-history version 3 is an additive sidecar version. Versions 1 and 2 retain their schemas, identities and renderer response contract. Version 3 continues to bind the exact surface-water-v2 field and routing hash and reuses the version-2 physical dirt operator without modification.

Version 3 changes only the bounded causal-response semantics:

- traffic uses a compact-support biweight lateral kernel and an explicit `passesAtHalfWear`; cells outside `halfWidthMeters + falloffWidthMeters` are exactly zero;
- `rainExposureFraction` remains the exact water-field observation, `shelterProtection` is its verified complement, and `exposureWeathering` uses effective age with an explicit `yearsAtHalfResponse`;
- routed throughflow and retained edge/puddle water have separate background onsets and half-response depths;
- combined runoff staining is `1 - (1 - throughflow) * (1 - retained)`;
- materials opt into the distinct `historyResponseV3` contract, whose packed green channel is accumulated `exposureWeathering`, not raw exposure.

Profiles, paths, repairs and material-response records are canonicalized before hashing. Version 3 persists the canonical profile and repair patches as its response model, allowing verification to recompile and compare the entire expected field rather than trusting a rehashed output. The application verifies the exact paving receiver, water-v2 identity, routing identity, live repairs and actual non-zero path support over active receiver cells before atomically writing a field and percentile-ready channel report.

## Verification

Acceptance requires deterministic compilation and hashes, exact source topology, raw exposure equality, shelter complement, runoff composition, compact traffic support, half-response behavior, canonical ordering, per-edge and global conserved dirt mass, and a native Blender consumer that rejects invalid v3 composition, stale render-preflight bytes and dirt-only material fallback. The TypeScript preflight receipt binds the verified history and water file hashes plus semantic/routing identities into the resolved render manifest; Blender rechecks the receipt before consuming either file. Historic and contemporary transfer hosts must retain byte-equal v2/v3 dirt cells while demonstrating materially narrower traffic footprints and non-clipped response distributions. Camera probes remain qualitative and cannot publish the host environments by themselves.

## Consequences

On the current unrelated hosts, traffic affects 1,163 of 3,157 historic cells and 1,462 of 3,654 contemporary cells, with no traffic values at or above `0.99`. Maximum exposure weathering is `0.7073` and `0.4186`; separate throughflow and retained-water signals preserve ordering before composition. Dirt cells and whole-field balances are byte-equal to version 2, including errors of approximately `-7.78e-13 kg` and `-1.78e-13 kg`.

The corrected fields and native material path pass structural verification, but the environments remain visually rejected. Historic paving is still too orderly and uniformly processed; contemporary paving remains pale, glossy and ceramic-like; facade, glazing, interior and precipitation quality remain below photographic acceptance. The benchmark is unchanged because this is reusable system work and the two unrelated transfer hosts already expose the remaining gaps.
