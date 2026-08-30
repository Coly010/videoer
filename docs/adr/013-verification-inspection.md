# ADR 013: Verification and inspection architecture

Status: Accepted

## Decision

Verification is a first-class deterministic subsystem. Small evaluators return checks with stable IDs, `pass`, `warning`, or `fail`, expected/actual context, relevant path or shot, an actionable message, and optional remediation. Aggregation adopts the worst status and produces a serializable report. Campaign/storyboard checks run locally; image metadata uses native parsing and video metadata uses ffprobe.

Inspection is separate: it creates or describes surfaces for qualitative human/Codex review. Reusable media primitives inspect metadata and build contact-sheet/frame-extraction operations. Campaign inspection directories hold previews, sampled frames, contact sheets, and metadata; reports hold objective verification results.

Future semantic evaluators may implement the same lightweight evaluator shape, but deterministic checks cannot depend on paid or generative services. Codex remains outside the repository and makes subjective judgements from inspection artifacts.

## Consequences

Known requirements are automatable and machine-readable without pretending artistic quality is mechanical. A small useful sampling set is preferred over hundreds of frames. ffprobe-dependent checks report precise environment failures.
