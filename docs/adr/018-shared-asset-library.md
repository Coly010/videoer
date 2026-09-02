# ADR 018: Shared asset identity, versions, provenance, and reuse

Status: Accepted

**Narrowed by [ADR 072](072-pragmatic-production-realignment.md):** publication remains available
but is optional — no longer required before an asset or campaign counts as progress.

## Decision

Use a repository-level shared asset library with stable domain IDs and immutable semantic versions. Each version owns an `asset.yaml` declaring:

- type, stable identity, version, description, tags, and capabilities;
- provenance, SPDX licence identification, commercial-use status, and explicit clearance;
- artifacts and hashes where available;
- coordinate/skeleton/backend compatibility and dependencies;
- validation state and verification artifacts.

Published versions are never overwritten. Corrections and material adaptations publish a new semantic version. Campaigns pin exact versions in their asset manifest. Stable identity allows the production resolver to prefer reuse, then adaptation, then creation.

Published artifact bytes are also excluded from repository-wide formatters. Formatting a JSON or YAML artifact in place is still mutation even when its parsed value is equivalent, because the declared SHA-256 identifies the exact accepted bytes. `video asset audit-library` verifies every declared artifact in every version. `video asset repair-library --source ...` may repair damage only by finding a candidate whose live SHA-256 already equals the declared hash, or by reconstructing a known canonical serialisation whose bytes independently reproduce that declared hash, and restoring those exact bytes atomically; it must never rewrite metadata hashes to bless mutated output. A version whose accepted source bytes cannot be recovered remains invalid until it is regenerated and published correctly or explicitly superseded.

Search is an application API/CLI operation, not manual directory crawling. Ordinary search and automatic resolution exclude rejected, review-required, commercially restricted, and commercially unknown sources. The generated index is inspectable acceleration data, not canonical metadata.

## Consequences

Files without metadata are not production assets. Source inputs and generated derivatives remain distinguishable. The repository-level `work/` tree and campaign `work/` trees are mutable, reproducible candidate workspaces and are not versioned; anything worth preserving must be published with metadata, provenance, hashes, and verification evidence under `library/`, or promoted into an explicit stable verification fixture. Backends may advertise compatibility, but backend classes never appear in the asset identity or production requirement model. Immutable-library integrity is a live operational gate rather than an assumption based on Git history or parseability.
