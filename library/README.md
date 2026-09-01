# Shared production asset library

This directory is Videoer's reusable, cross-campaign production inventory. Assets are published through `video asset publish`, searched through `video asset search`, and indexed through `video asset index`. Campaign code must not infer reusable assets by manually walking ad-hoc folders.

Each immutable asset version lives at:

```text
library/<type>/<stable-name>/<semantic-version>/
  asset.yaml
  <declared artifacts>
  verification/
```

`asset.yaml` owns stable identity, semantic version, provenance, licence and commercial-use clearance, capabilities, renderer compatibility, declared artifacts, and validation state. Rendering backends are compatibility metadata only; asset identities and production requirements remain renderer-independent.

Ordinary search and production resolution exclude assets whose source is not explicitly approved for commercial use. A restricted asset may be catalogued for audit purposes but cannot be selected by the production resolver.

Useful commands:

```bash
npm run video -- asset validate path/to/candidate
npm run video -- asset publish path/to/candidate --library library
npm run video -- asset search "wet medieval door" --type prop
npm run video -- asset inspect prop.medieval-door 1.0.0
npm run video -- asset index
```
