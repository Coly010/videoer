# Videoer

Videoer is a composable, local-first marketing-video toolkit designed to be operated interactively by Codex or directly by a human. Codex is the conversational orchestrator outside this repository; Videoer provides inspectable TypeScript operations and a stable CLI for campaign loading, validation, inspection, verification, generation boundaries, and deterministic rendering.

The renderer is not implemented yet. Today the repository provides validated campaign/storyboard contracts, two style templates, reusable application operations, provider boundaries, filesystem state and provenance models, deterministic verification, image/video metadata inspection primitives, contact-sheet command construction, examples, and a thin CLI.

## Setup

- Node.js 22+
- npm 11
- FFmpeg and ffprobe for video inspection and future rendering (`video doctor` diagnoses them)

```bash
npm install
npm run check
npm run video -- --help
```

## Operating model

```text
references → campaign → storyboard → generation → inspection → verification
           → selective revision → draft render → verification → final render
```

Generative providers produce persisted, revisioned inputs with provenance. Inspection tells Codex or a human what to look at qualitatively. Verification answers objective questions with structured pass/warning/fail checks. Rendering consumes accepted persisted inputs and never silently regenerates them, so revising one shot does not rerun unrelated image, narration, or storyboard work.

The CLI is a stable adapter for humans and external agents, while `src/application` exposes the same operations to tests, future Tutarium integration, a web UI, or other Node callers. Business logic does not live only in command handlers.

## Current commands

Human-readable output is the default. Add global `--json` before the subcommand for a versioned machine-readable envelope.

```bash
npm run video -- validate campaigns/examples/cinematic-book/campaign.yaml
npm run video -- --json validate campaigns/examples/cinematic-book/campaign.yaml
npm run video -- inspect campaigns/examples/saas-promo/campaign.yaml
npm run video -- verify campaigns/examples/saas-promo/campaign.yaml
npm run video -- storyboard validate campaigns/examples/saas-promo/storyboard.json
npm run video -- doctor
```

`inspect` and `verify` are deliberately different. Inspection exposes metadata and future previews/contact sheets for judgement; verification runs known mechanical checks and can fail a workflow.

## Campaign workspace

Campaigns persist across Codex sessions using files rather than a database:

```text
campaign.yaml             intent and output requirements
storyboard.json           accepted timing and shot contract
campaign-state.json       generated provenance, render lineage, report references
references/               original briefs, covers, screenshots, notes
assets/                   supplied and imported inputs
generated/{images,clips,audio}/
renders/                  render-001.mp4, render-002.mp4, final.mp4
inspection/               previews, sampled frames, contact sheets, metadata
reports/                  verification reports
```

Directories are created as operations need them. Existing examples retain their compact legacy-compatible `assets/` layout.

## Codex usage example

Open Codex, attach or identify reference material, and ask for a trailer. Codex can create/update campaign files, invoke granular toolkit operations, inspect generated assets, regenerate a weak shot only, produce a draft, inspect and verify it, revise, and then render a final version. The application and verification foundations work today; automated storyboard generation, production rendering, sampled-frame generation, and a complete autonomous review loop remain future work.

## Source boundaries

- `src/domain`: schemas, persisted state, and loaders
- `src/application`: reusable use cases called by all interfaces
- `src/providers`: optional non-deterministic adapters and provenance contracts
- `src/renderer`: deterministic render-plan boundary
- `src/verification`: checks, evaluator composition, result aggregation
- `src/media`: dependency diagnostics and reusable inspection utilities
- `src/assets`: workspace paths, cache keys, revisioned filenames
- `src/cli.ts`: argument parsing, presentation, JSON envelopes, exit codes

The next goal should implement the first end-to-end local-asset draft/review/revise loop with a deterministic renderer, inspection artifacts, verification reports, selective shot revision, and rerendering without unrelated regeneration.
