# ADR 010: Codex CLI image provider experiment

Status: Accepted (experimental)

## Context

Codex may reuse an existing personal allowance, but it is an agent rather than a deterministic image API. Local help confirms `codex exec --ephemeral --skip-git-repo-check` exists today; flags remain subject to change.

## Decision

Keep `CodexImageProvider` behind `ImageProvider`, never as a core dependency. Request one 9:16 image at an absolute deterministic path, wait, then validate that exact file. Exit zero alone is insufficient. Retry explicitly and fail clearly.

The repeatable spike should make 10–20 requests, preserve per-run prompt, path, duration, exit code, file validation, and error metadata. Adopt only if output-path success and quality are acceptable; otherwise remove the adapter without changing callers.

## Consequences

The harness exists but external generation is not required by tests or rendering.
