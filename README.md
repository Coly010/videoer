# Videoer

Videoer is a composable, local-first marketing-video toolkit designed to be operated interactively by Codex or directly by a human. Codex is the conversational orchestrator outside this repository; Videoer provides inspectable TypeScript operations and a stable CLI for campaign loading, validation, inspection, verification, generation boundaries, and deterministic rendering.

The repository includes validated campaign/storyboard contracts, two style templates, a deterministic Remotion renderer, reusable application operations, provider boundaries, filesystem state and provenance, sampled-frame/contact-sheet inspection, objective campaign/image/video verification, selective shot revision and scene-keyframe regeneration, examples, and a thin CLI.

Rich `scene` shots compose independently timed image, video, text, shape, sprite, particle, and effect layers with depth-aware 2.5D cameras, masks, filters, and blend modes. PixiJS provides a GPU-backed 2D adapter for dense particles and procedural VFX while Remotion remains the timeline and final-rendering layer. See [Scene composition and VFX](docs/scene-vfx.md), [Particle system](docs/particle-system.md), and the [Codex extension guide](docs/codex/scene-vfx.md).

`scene-keyframes` is the cinematic scene mode: one shot contains an anchor plus one to three related later frames, explicit continuity locks, and blend/camera instructions. It exists to create motivated intra-shot progression instead of treating every cinematic beat as a disconnected still. See [Scene keyframes](docs/scene-keyframes.md) and [Using scene keyframes from Codex](docs/codex/using-scene-keyframes.md).

## System requirements

- Node.js 22+
- npm 11
- FFmpeg 9+ and ffprobe with the capabilities used by the renderer and inspection pipeline:
  - `drawtext`, `xfade`, `zoompan`, `xstack`, and `subtitles` filters
  - H.264 (`libx264`) and AAC encoders
  - PNG and JPEG decoding

The small/default FFmpeg package supplied by some package managers omits required text and subtitle support. Install a full build rather than working around missing filters.

### macOS (Homebrew)

```bash
brew install ffmpeg-full
brew unlink ffmpeg            # only when the minimal formula is currently linked
brew link --overwrite ffmpeg-full
```

`ffmpeg-full` is keg-only. If linking is unsuitable for your machine, put it first on `PATH` instead:

```bash
export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"
```

### Debian/Ubuntu

Distribution FFmpeg builds commonly include these capabilities:

```bash
sudo apt-get update
sudo apt-get install ffmpeg fontconfig fonts-dejavu-core
```

Run the capability check after installation. A binary merely existing on `PATH` is not sufficient.

## Setup

```bash
npm install
npx remotion browser ensure
npm run video -- doctor
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
npm run video -- generate-assets campaigns/my-trailer/campaign.yaml --shot ritual
npm run video -- shot regenerate campaigns/my-trailer/campaign.yaml ritual --keyframe reveal
npm run video -- render campaigns/examples/saas-promo/campaign.yaml --draft --change initial-draft
npm run video -- inspect-render campaigns/examples/saas-promo/campaign.yaml latest
npm run video -- verify-render campaigns/examples/saas-promo/campaign.yaml latest
npm run video -- shot revise campaigns/examples/saas-promo/campaign.yaml hook --text "MORE TIME TO TEACH"
npm run video -- scene validate campaigns/fixtures/scene-vfx-cinematic/campaign.yaml
npm run video -- vfx list
npm run video -- particles list
npm run video -- shot render campaigns/fixtures/scene-vfx-product/campaign.yaml dashboard --preview
npm run video -- shot inspect campaigns/fixtures/scene-vfx-product/inspection/shots/dashboard-preview.mp4
npm run video -- render campaigns/examples/saas-promo/campaign.yaml --final --change revised-hook
npm run video -- doctor
```

`inspect` and `verify` are deliberately different. Inspection extracts metadata, midpoint frames, and a contact sheet for judgement; verification runs known mechanical checks, persists a structured report, and can fail a workflow.

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

Open Codex, attach or identify reference material, and ask for a trailer. Codex can create/update campaign files, choose scene-based or still-based shot strategies, generate an anchor and dependent scene keyframes through the provider boundary, produce a versioned draft, inspect its sampled frames and contact sheet, run objective verification, regenerate one weak keyframe, and render a versioned final. Rendering and verification never invoke providers. See [the cinematic trailer workflow](docs/codex/trailer-workflow.md). Full automatic creative storyboard authoring, audio authoring/mixing, and production provider adapters beyond the experimental boundary remain future capabilities.

## Source boundaries

- `src/domain`: schemas, persisted state, and loaders
- `src/application`: reusable use cases called by all interfaces
- `src/providers`: optional non-deterministic adapters and provenance contracts
- `src/renderer`: deterministic Remotion compositions and renderer adapter
- `src/verification`: checks, evaluator composition, result aggregation
- `src/media`: dependency diagnostics and reusable inspection utilities
- `src/assets`: workspace paths, cache keys, revisioned filenames
- `src/cli.ts`: argument parsing, presentation, JSON envelopes, exit codes

Remotion downloads a pinned Chrome Headless Shell into `node_modules/.remotion`; run `npx remotion browser ensure` during setup or whenever the Remotion version changes. Rendering may bind a temporary loopback port for the local browser bundle. All Remotion packages and Zod are exact-version pinned because Remotion treats version alignment as a runtime requirement.
