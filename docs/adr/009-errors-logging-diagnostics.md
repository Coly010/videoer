# ADR 009: Error handling, logging, and diagnostics

Status: Accepted

## Decision

Domain validation reports file, field path, and message. Provider errors name the provider and retryability. Dependency checks name missing binaries. Normal CLI output is concise; `--debug` adds stacks. JSON mode writes a stable versioned success/error envelope with a machine-readable error code and validation details where available.

## Consequences

Failures occur at boundaries with actionable context and stable exit-code categories.
