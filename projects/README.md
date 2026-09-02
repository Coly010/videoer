# Real projects

`projects/` is for real, user-facing productions made with Videoer. It is intentionally separate from `campaigns/`, which contains examples, fixtures, conformance work, experiments, and reusable product development.

Each real project has this layout:

```text
projects/
  project-name/
    project.yaml       project marker and concise client-facing metadata
    README.md          project-specific status and render command
    source/            Videoer campaign workspace: brief, assets, storyboard, generated inputs, and reports
    output/            versioned delivery renders and final.mp4
```

Use `source/campaign.yaml` with the normal CLI. When a campaign is in a marked project `source/` directory, Videoer writes numbered renders and `final.mp4` to the sibling `output/` directory automatically:

```bash
npm run video -- render projects/project-name/source/campaign.yaml --final --change "describe the change"
npm run video -- verify-render projects/project-name/source/campaign.yaml latest
```

`output/final.mp4` is always the current approved delivery file. Keep project materials in `source/`; do not use `output/` for working assets or documentation.
