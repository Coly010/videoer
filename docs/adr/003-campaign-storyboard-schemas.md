# ADR 003: Campaign and storyboard schemas

Status: Accepted

## Decision

Campaign YAML is concise human-authored intent. Storyboard JSON is a separate persisted, editable rendering contract. Zod owns runtime schemas and inferred TypeScript types. Both carry integer `schemaVersion`; readers reject unknown versions.

## Consequences

Generative planning can be rerun without overwriting an accepted storyboard. Additive changes retain a version; breaking changes increment it and receive explicit migration functions before support is claimed.
