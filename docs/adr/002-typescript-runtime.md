# ADR 002: TypeScript runtime and package manager

Status: Accepted

## Decision

Require Node 22+, npm 11, ESM/NodeNext, strict TypeScript, `tsx` for development, and `tsc` output for distribution. Pin policy with `.nvmrc`, `engines`, and `packageManager`.

## Consequences

The stack is modern and reproducible without a custom runtime or bundler.
