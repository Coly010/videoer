# ADR 007: Asset storage, cache, and reproducibility

Status: Accepted

## Decision

Each campaign is a durable workspace. It stores source config and storyboard beside identifiable `references`, supplied/imported `assets`, revisioned `generated/images|clips|audio`, versioned `renders`, `inspection`, `reports`, and a small `campaign-state.json`. Cache keys hash canonical request data; filenames include shot ID, kind, and revision. Existing files are not overwritten without an explicit regeneration operation.

Generated-asset state retains provider, prompt/request, references, source shot, attempt, request hash, output path, and creation time. Render state uses sequential IDs, draft/final kind, optional parent, and a short changes list. Filesystem JSON is the state store.

## Consequences

Supplied assets are immutable inputs. Raising one shot revision invalidates only its outputs; render consumes valid persisted assets and never triggers generation. Prior renders remain available instead of being casually overwritten.
