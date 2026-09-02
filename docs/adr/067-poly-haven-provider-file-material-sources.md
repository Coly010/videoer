# ADR 067: Poly Haven provider-file material sources

- Status: accepted
- Date: 2026-09-02

## Context

Poly Haven publishes material maps as independently addressed files with provider byte sizes and MD5 digests rather than as one material archive. Its asset files remain CC0, while use of the live API is governed by separate service terms. The terms reviewed at commit `df4d579935b5e245b2a745635607b6a3c595d8dd` permit commercial API use without a key or paid licence, require a unique application User-Agent or Referer, and require visible Poly Haven credit while the live service is used. The reviewed ToS bytes have SHA-256 `909a50da34e70cfeb2951fe195002dcc0c57cb342a37b13c869eb2d5dd678abd`.

The legacy archive-backed material-source manifest cannot truthfully represent this provider-file topology. Treating URLs, filenames, retrieval time or provider MD5 as source identity would also allow renderer-consumed scale, colour-space or channel claims to drift without a new identity.

## Decision

Add a schema-version-2 `provider-files` source manifest under the existing normalized material-source boundary. It records and binds:

- Poly Haven OpenAPI `1.0.0`, the Videoer User-Agent, approved HTTPS origins and the exact `/info/{slug}` and `/files/{slug}` response evidence;
- the reviewed and current API ToS, their exact hashes, the reviewed commit and a hashed fail-closed adapter assessment;
- separate CC0 asset-licence evidence and live-service attribution evidence;
- provider asset identity, authorship metadata, publication date, lateral physical scale and the provider's opaque `files_hash`;
- exact selected map URLs, redirects, provider sizes and MD5 values, Videoer SHA-256 values, decoded image dimensions, colour spaces, the OpenGL normal convention and portable candidate paths;
- the complete normalized renderer-channel projection and physical-scale evidence in the canonical source identity.

Base colour, `nor_gl` and roughness are required. Displacement, ambient occlusion, metallic and alpha are optional and are preserved only when the exact requested variant exists. JPEG and PNG bytes must decode successfully; signatures or header dimensions alone are insufficient. All selected maps must agree on dimensions and remain compatible with the provider's maximum aspect and size evidence.

Live acquisition checks the exact pinned ToS bytes before API calls, uses `Videoer/0.1 poly-haven-material-source-v2`, and requires confirmed visible credit naming Poly Haven. A change to either reviewed or current ToS bytes blocks live use pending explicit review. Offline reuse requires an exact cached source identity but does not create a new live-service attribution obligation; it preserves the attribution evidence recorded by acquisition.

Content objects and identity records are immutable. Refreshing unchanged bytes reuses the existing identity and original acquisition timestamp. Existing candidates must have an exact regular-file inventory with no symbolic links and byte-for-byte equality. Rendering and material derivation remain provider-free and reverify the manifest identity plus every evidence and texture hash before staging.

Poly Haven's normalized displacement map does not prove a physical height amplitude. It enters the material system only with the ADR 066 `disabled-uncalibrated` response until independent calibration evidence exists.

## Consequences

- The legacy archive-backed source contract remains intact; this is an additional provider topology, not a replacement source system.
- The public CLI can acquire or exactly replay a Poly Haven material candidate, but it never publishes, renders or silently fetches during deterministic production.
- Provider MD5 and `files_hash` remain upstream corroboration; Videoer SHA-256 and the canonical manifest identity remain authoritative locally.
- A changed provider response, selected file, redirect, origin, scale, channel claim, terms document or attribution declaration creates a different source identity or fails closed.
- This clears provenance-correct acquisition. It does not accept any material visually; neutral and unrelated-host render probes remain mandatory before library publication.
