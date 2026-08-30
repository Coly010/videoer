# ADR 008: CLI architecture

Status: Accepted

## Decision

Commander is a thin adapter over exported application operations. Commands are granular, composable, non-interactive, discoverable through help, and accept explicit paths. Human-readable output is the default; `--json` emits a versioned envelope containing `ok`, `command`, and either `data` or a structured `error`. Workflow logic must not be duplicated between CLI and TypeScript callers.

## Consequences

Codex may use either the CLI or TypeScript API, and future Tutarium/UI adapters call the same operations. Exit 0 means success, 1 unexpected failure, 2 validation or verification failure, and 3 missing runtime dependency. JSON fields are compatibility surface and change deliberately.
