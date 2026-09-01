# ADR 017: Autonomous cinematic production architecture

Status: Accepted

## Context

The existing campaign/storyboard pipeline renders persisted 2D inputs reliably, but it cannot plan, source, construct, validate, and repair recurring characters, environments, props, motion, or interactions. Adding those concepts directly to Remotion components would make persisted work renderer-specific and difficult for an external operator to inspect.

## Decision

Codex remains the external production controller. Videoer exposes deterministic, independently invokable production operations and persists every meaningful stage:

```text
campaign → production plan → asset resolution → asset factories → verified assets
         → executable scenes → shot renders → visual critique → selective repair → final render
```

`production-plan.yaml` is the renderer-independent contract between campaign intent and construction. It identifies shots, continuity groups, actions, camera/lighting direction, and typed asset requirements. `asset-manifest.yaml` records whether each requirement will reuse, adapt, or create a commercially cleared asset. Later factories consume those decisions; they do not reinterpret campaign prose invisibly.

The application layer owns operations, the CLI adapts them for Codex/humans, and campaign workspaces retain inspectable intermediate artifacts. Rendering and verification remain provider-free.

## Consequences

Autonomy is resumable filesystem state rather than an embedded agent framework. Every generated capability can become reusable inventory. A command succeeding is only stage completion; production completion still requires rendered visual gates and repair.
