# ADR 012: Determinism versus generative operations

Status: Accepted

## Decision

Parsing, validation, asset resolution, timing, template resolution, rendering, and encoding are deterministic. Storyboard creation and image/video/voice generation are explicit, non-deterministic commands that persist outputs and provenance. Render never invokes providers.

## Consequences

Rerendering cannot incur surprise cost or drift. Regeneration must name its shot/asset scope, increment only the affected revision, retain provenance, and leave unrelated assets reusable. Verification is deterministic and offline; future semantic evaluators are optional additions rather than mechanical quality gates.
