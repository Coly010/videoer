# ADR 006: Provider abstraction

Status: Accepted

## Decision

Capability-specific interfaces accept explicit requests and return provider-neutral generated-asset metadata. A small registry resolves configured providers. Unsupported or absent providers throw actionable `ProviderError`s. Providers own service retries; orchestration owns workflow retries.

## Consequences

External SDKs stay outside the domain and renderer. Fakes support free contract tests. Capabilities are explicit instead of guessed.
