# ADR 025: Articulated prop interactions and multi-object verification

## Status

Accepted on 2026-08-30.

## Context

The benchmark requires head/body turns, hand reach, a hinged-door action, and a two-handed book read. A character-only clip cannot represent a moving handle or book, and endpoint metadata cannot prove that a rendered hand remains attached. Earlier gait work also showed that successful rendering and plausible scalar checks can still admit reversed travel, incorrect foot depth, or visually broken articulation.

## Decision

- Motion clips identify a compatible skeleton instead of being hard-coded to the humanoid skeleton. Character and prop skeletons use the same validated local-delta clip format.
- Props are project-owned indexed geometry with articulated bones and named attachments. The bookshop door exposes hinge, handle grip, threshold, and approach points; the book exposes bilateral grips, spine, and gaze target.
- Reach uses deterministic analytic two-bone IK with explicit left/right elbow poles, reachability reporting, joint-bend margins, and forward-kinematic endpoint proof.
- Door synthesis emits synchronized actor and target clips through approach, reach, grasp, handle turn, opening, release, and passage. Contact error is measured against the animated handle, not its rest position.
- Book synthesis animates the prop root while both hands remain attached for the complete low-hold, raise, settle, and read sequence. Gaze is derived from the animated gaze target.
- Blender probes load both skeletons, apply real scene transforms, render two viewpoints, extract every phase boundary, and persist contact sheets, videos, a `.blend` file, and quantitative gates.
- Mechanical success is necessary but insufficient. Occluded contact, T-poses, inward elbow folding, implausible prop scale, floating props, and sliding passage remain visual failures and require another iteration.

## Consequences

The renderer-independent action definitions can be reused with other compatible actors and props. Multi-object probes cost more render time, but they expose failures that isolated character or prop renders cannot. No provider or commercial DCC is invoked during synthesis or verification.
