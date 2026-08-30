# ADR 014: External agent and application boundary

Status: Accepted

## Decision

Codex is an external operator, not a dependency or embedded agent framework. `src/application` owns reusable use cases; CLI and future interfaces adapt them. Meaningful stages remain independently invokable and persist inspectable results in the campaign workspace.

The project will not add a planner, autonomous loop, prompt graph, internal tool-calling framework, database, queue, or MCP server merely to orchestrate itself. Add application operations only as working capabilities require them.

## Consequences

Codex can compose operations, inspect artifacts, selectively revise weak work, and resume from filesystem state. The same operations remain suitable for tests, Tutarium integration, a web UI, and other TypeScript callers.
