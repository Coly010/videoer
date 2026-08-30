# ADR 011: Testing strategy

Status: Accepted

## Decision

Use fast schema/domain tests, example-loading and CLI integration tests, provider contracts with fakes, and deterministic component tests. Later add ffprobe metadata assertions and opt-in slow Remotion smoke renders. Avoid giant snapshots.

## Consequences

Default tests remain offline and free. Media/tool tests can be skipped only with a precise environmental reason.
