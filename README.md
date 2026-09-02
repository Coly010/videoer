# Videoer

Videoer is a composable, local-first toolkit for producing short-form marketing videos, designed to be operated interactively by Codex or directly by a human. It targets the same finished-video bar a good human editor would: a deliberate, watchable 10–20 second vertical piece, not a technically-correct-but-flat render.

## What you can create

- cinematic fantasy book trailers, thriller/romance trailers, atmospheric cinematic promos
- product films, SaaS/Tutarium promos, animated UI showcases
- kinetic-typography videos and polished slideshow-style marketing
- hybrids of any of the above in one edit

There is no single "correct" technique. A shot may be a supplied image with layered VFX and subtle motion, an AI-generated image-to-video clip, a full Blender 3D render, a Remotion/PixiJS 2D composite, or a screenshot with kinetic typography — chosen per shot for whatever makes it convincing at the lowest reasonable cost. `projects/the-rise-of-demons` (a shipped dark-fantasy book teaser) uses supplied artwork plus 2D VFX and typography with no 3D at all; `campaigns/reference-cinematic-benchmark` uses full Blender-backed 3D production. Both are legitimate uses of the same toolkit. See [`docs/product-principles.md`](docs/product-principles.md) for the durable policy behind these choices, and [the cinematic trailer workflow](docs/codex/trailer-workflow.md) for how Codex picks a technique and iterates.

Codex is the conversational orchestrator outside this repository; Videoer provides inspectable TypeScript operations and a stable CLI for campaign loading, validation, inspection, verification, generation boundaries, and deterministic rendering.

The repository includes validated campaign/storyboard contracts, two style templates, a deterministic Remotion renderer, reusable application operations, provider boundaries, filesystem state and provenance, sampled-frame/contact-sheet inspection, objective campaign/image/video verification, selective shot revision and scene-keyframe regeneration, examples, and a thin CLI.

Rich `scene` shots compose independently timed image, video, text, shape, sprite, particle, and effect layers with depth-aware 2.5D cameras, masks, filters, and blend modes. PixiJS provides a GPU-backed 2D adapter for dense particles and procedural VFX while Remotion remains the timeline and final-rendering layer. See [Scene composition and VFX](docs/scene-vfx.md), [Particle system](docs/particle-system.md), and the [Codex extension guide](docs/codex/scene-vfx.md).

`scene-keyframes` is the cinematic scene mode: one shot contains an anchor plus one to three related later frames, explicit continuity locks, and blend/camera instructions. It exists to create motivated intra-shot progression instead of treating every cinematic beat as a disconnected still. See [Scene keyframes](docs/scene-keyframes.md) and [Using scene keyframes from Codex](docs/codex/using-scene-keyframes.md).

## Optional Blender-backed 3D production path

For shots that need real 3D — physical characters, environments, simulated cloth/VFX — the cinematic production layer adds Blender-native production plans and a shared, versioned asset library. This is a chosen implementation for that shot class, not a universal requirement; see [ADR 072](docs/adr/072-pragmatic-production-realignment.md). A plan names shots, continuity, actions, camera/lighting direction, and required characters, environments, props, clothing, materials, motion, VFX, and audio. Resolution searches commercially cleared inventory and persists an explicit reuse/adapt/create manifest before factories or renderers run.

Atmospheric VFX, surface materials, and clothing can be reusable derivation domains when reuse is worth the cost, rather than only campaign-local styling shortcuts. Declarative campaigns can adapt verified parents through bounded, hash-linked contracts and publish the reviewed outputs for another campaign to resolve unchanged — the Rainwalk Square/Rainwalk Banner pair demonstrates this working, as optional evidence, not as a requirement every campaign repeats.

Non-speech score treatment follows the same optional rule: declarative audio derivations can select an exact interval from a verified parent, apply bounded filter/dynamics/stereo/mastering parameters, add optional exact-sample deterministic accents, and publish after temporal-envelope, contribution, format, peak, and re-render gates pass — useful when a treatment is worth reusing, not mandatory for every soundtrack. See [ADR 031](docs/adr/031-deterministic-audio-treatment-derivation.md).

Reusable lighting rigs and editorial identities can resolve through the same library manifest when that's the cheapest path. Editorial derivations preserve the parent font and motif while bounding copy, palette, safe area, contrast, and responsive typography; approval independently rerenders and measures the result before publication. The original eight-shot reference benchmark runs entirely through `cinematic-campaign build` as one reference example — it is a fixture, not a conformance gate other campaigns must pass. Character and standalone clothing generation share temporal collision, silhouette, and pose-space-correction contracts, so a defect discovered in one campaign can become a reusable capability when that's worth doing. Production-human v2 extends the stable retargeting core with audited articulated finger chains and bilateral hand evidence; see [character creation and acceptance](docs/characters.md) and the [retopology research record](docs/research/character-retopology.md).

## System requirements

- Node.js 22+
- npm 11
- Blender 4.5 LTS or newer with working background Python, bundled OpenVDB and NumPy modules, fixed-seed Cycles CPU final rendering, and Eevee preview rendering (GPL tooling)
- OpenEXR `exrinfo` from a security-patched OpenEXR release for fail-closed inspection of CC0 environment-radiance sources (BSD-3-Clause tooling)
- MPFB 2.0.17 commit `437dd513888a92399d1d3200d2e80859fae55abc` plus Blender's bundled Rigify addon for the production-character rig backend (GPL tooling with CC0 rig/weight/mesh assets; installed by the repository script). MPFB's hm08 CC0 mesh + Rigify is the production human ([ADR 074](docs/adr/074-mpfb-rigify-is-the-production-human.md)).
- Expy Kit v0.6.1 commit `3c4d5d7b8b9aa585e9e304f6b9ed35c2690238ae` for retargeting CC0 Unreal-Mannequin actions onto the Rigify production human (GPL tooling; pinned and installed by `scripts/install-expykit-extension.sh` into the git-ignored `.venv-blender/`; see [ADR 075](docs/adr/075-expykit-humanoid-retargeting.md))
- eSpeak NG 1.52+ with development headers for deterministic speech audio and native phoneme timing (GPL-3.0-or-later)
- A C compiler for the small eSpeak NG event bridge (Apple Clang/Xcode Command Line Tools on macOS, build-essential on Debian/Ubuntu)
- Cormorant Garamond installed as a system font for the benchmark editorial treatment (OFL-1.1)
- FFmpeg 9+ and ffprobe with the capabilities used by the renderer and inspection pipeline:
  - visual composition filters: `drawtext`, `xfade`, `zoompan`, `xstack`, and `subtitles`
  - deterministic audio-treatment filters: `highpass`, `lowpass`, `acompressor`, `extrastereo`, `loudnorm`, `afade`, `adelay`, `amix`, `apad`, `atrim`, `aresample`, and `aformat`
  - deterministic cinematic-finishing filters: `eq`, `colorchannelmixer`, `lutrgb`, `gblur`, `blend`, `vignette`, and `noise`
  - H.264 (`libx264`) and AAC encoders
  - PNG and JPEG decoding

The small/default FFmpeg package supplied by some package managers omits required text and subtitle support. Install a full build rather than working around missing filters.

### macOS (Homebrew)

```bash
brew install ffmpeg-full
brew install espeak-ng
brew install openexr
brew install --cask blender font-cormorant-garamond
scripts/install-mpfb-extension.sh
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
sudo apt-get install espeak-ng libespeak-ng-dev build-essential
```

Run the capability check after installation. A binary merely existing on `PATH` is not sufficient.

### Blender and production typography

Blender is required production infrastructure for headless geometry, rigging, animation, conversion, simulation, and visual probes. On macOS, install the official application or Homebrew cask:

```bash
brew install --cask blender
brew install --cask font-cormorant-garamond
```

Videoer prefers `/Applications/Blender.app/Contents/MacOS/Blender` on macOS and otherwise resolves `blender` from `PATH`. Set `VIDEOER_BLENDER` only when the installation lives elsewhere.

The npm dependency `@fontsource/cormorant-garamond` pins the web-rendering copy, while Blender/FFmpeg require the matching system font. Both are open source under OFL-1.1. Do not substitute a metrically different font silently because it changes title and cover layout.

The doctor check imports `bpy` in background mode and verifies Blender's bundled `openvdb` and `numpy` modules; `blender --version` alone is not sufficient. Those OSS modules power project-owned deterministic sparse-volume simulation and must be available on every production machine. In a restricted Codex run, Blender may exit with signal 11/139 in `supports_barycentric_whitelist` because the sandbox hides `MTLCreateSystemDefaultDevice()`. Approve host/GPU execution and rerun the same command. The official `bpy` wheel reaches the same native Metal detector and does not avoid this failure. Do not respond by downgrading output, skipping probes, reinstalling `bpy`, switching architectures, or carrying an unnecessary private Blender fork. See [Blender installation and Metal diagnostics](docs/install-blender.md).

OpenEXR environment-source inspection requires the patched BSD-3-Clause `exrinfo` utility. The doctor checks its version and licence evidence and performs a bounded `-v -s` inspection of a project-owned smoke fixture; see [OpenEXR source-inspection installation](docs/install-openexr.md). This records the current ambientCG EXR archive convention for reproducible setup on new machines.

### Deterministic speech and lip synchronization

Videoer uses eSpeak NG as an open-source, provider-free speech runtime. It renders persisted WAV audio and exposes the engine's native phoneme timestamps through a project-owned C bridge; those timestamps drive renderer-independent viseme tracks on the exact campaign frame grid. This keeps speech rendering deterministic and makes audiovisual synchronization objectively verifiable. It does not call a generative provider during rendering.

On macOS, `brew install espeak-ng` installs both the runtime and development headers. Install Apple's Command Line Tools with `xcode-select --install` if `cc --version` fails. On Debian/Ubuntu, install `espeak-ng libespeak-ng-dev build-essential`. `npm run video -- doctor` checks both capabilities. See [Speech runtime installation and diagnostics](docs/install-speech.md).

## Setup

```bash
npm install
npx remotion browser ensure
scripts/install-mpfb-extension.sh
scripts/install-expykit-extension.sh   # humanoid action retargeting (ADR 075); needed only for human motion
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
npm run video -- production validate campaigns/reference-cinematic-benchmark/production-plan.yaml
npm run video -- production resolve campaigns/reference-cinematic-benchmark/production-plan.yaml --library library
npm run video -- asset search "wet medieval door" --type prop
npm run video -- asset validate work/candidate-door
npm run video -- asset publish work/candidate-door --library library
npm run video -- asset index --library library
npm run video -- asset audit-library --library library
npm run video -- asset repair-library --library library --source work campaigns
npm run video -- geometry mannequin work/mannequin
npm run video -- geometry production-human work/production-human --id character.example --asset-version 0.1.0
npm run video -- geometry validate work/mannequin/geometry.json
npm run video -- geometry probe work/mannequin/geometry.json --output work/mannequin/verification
npm run video -- character inspect-anatomy work/production-human/geometry.json --output work/production-human/anatomy-report.json
npm run video -- motion create-walk work/walk-neutral.json --style neutral
npm run video -- motion create-walk work/walk-cautious.json --style cautious
npm run video -- motion create-walk work/walk-confident.json --style confident
npm run video -- motion probe work/mannequin/geometry.json work/walk-neutral.json --output work/walk-neutral-verification
npm run video -- character create campaigns/reference-cinematic-benchmark/heroine.yaml work/elara-vale
npm run video -- interaction create open-door work/elara-vale/geometry.json work/open-door
npm run video -- interaction create read-book work/elara-vale/geometry.json work/read-book
npm run video -- interaction create-turn work/elara-vale/geometry.json work/turn-orientation
npm run video -- environment create-bookshop work/old-city-bookshop
npm run video -- clothing extract-dark-dress work/elara-vale/geometry.json work/elara-midnight-dress
# Legacy geometry without embedded assetVersion additionally needs: --character-version <version>
npm run video -- material create-wet-cobble work/wet-cobble
npm run video -- asset source import-material poly-haven --asset rough_concrete --resolution 2K --encoding PNG --cache work/material-sources/cache --output work/material-sources/candidates --mode online
npm run video -- material derive-texture path/to/base-material.json path/to/material-source.json work/material-sources/derived/example/material.json --id material.example --suitability path/to/suitability.json --displacement-response path/to/displacement-response.json
npm run video -- material probe work/material-sources/derived/example/material.json work/material-sources/probes/example --application path/to/construction-application.json
npm run video -- vfx create-rainy-dusk work/old-city-bookshop/geometry.json work/rainy-dusk
npm run video -- lighting create-bookshop-rigs work/old-city-bookshop/geometry.json work/elara-vale/geometry.json work/lighting
npm run video -- editorial create-assets campaigns/reference-cinematic-benchmark/references/cover.png work/editorial
npm run video -- cinematic-campaign validate campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml
npm run video -- cinematic-campaign produce campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml
npm run video -- cinematic-campaign production-status campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml
npm run video -- cinematic-campaign review campaigns/reference-cinematic-benchmark/cinematic-campaign.yaml path/to/review.yaml
npm run video -- cinematic verify campaigns/reference-cinematic-benchmark/work/scenes/enter-bookshop/scene.json
npm run video -- cinematic render path/to/scene.json --output work/scene/verification
npm run video -- edit assemble campaigns/reference-cinematic-benchmark/work/edit/edit-plan.json campaigns/reference-cinematic-benchmark/delivery-declarative
npm run video -- cinematic-campaign validate campaigns/beacon-one-product-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/beacon-one-product-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/breathe-again-awareness-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/after-hours-character-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/night-signal-library-reuse-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/last-platform-multicharacter-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/last-call-dialogue-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/voices-of-midnight-documentary-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/rainwalk-square-crossdomain-conformance/cinematic-campaign.yaml
npm run video -- cinematic-campaign build campaigns/rainwalk-banner-library-reuse/cinematic-campaign.yaml
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

## Real project workspace

Use `projects/` for real, user-facing productions. This separates completed/client work from the product's examples, fixtures, conformance campaigns, and experiments in `campaigns/`.

```text
projects/project-name/
  project.yaml
  README.md
  source/              campaign workspace and production material
  output/              versioned delivery renders and final.mp4
```

A `source/campaign.yaml` under a directory containing `project.yaml` is a project campaign. The normal render command automatically delivers `render-###.mp4` and `final.mp4` to that project's `output/` directory; all other campaign material remains in `source/`. The entire `projects/` tree is intentionally Git-ignored because it may contain client source material and delivery media.

## Codex usage example

Open Codex, attach or identify reference material, and ask for a trailer. Codex picks a production technique per shot (see [shot strategy selection](docs/codex/trailer-workflow.md)), can create/update campaign files, choose scene-based or still-based shot strategies, compose 3D assets and interactions when that's the right technique, generate deterministic atmosphere, lighting, editorial, and audio, produce a frame-exact edit, inspect semantic frames and contact sheets, run objective verification, and selectively rebuild weak shots or switch strategy after repeated failed attempts. Rendering and verification never invoke providers. The reference cinematic benchmark (`campaigns/reference-cinematic-benchmark`) is a fixture and worked example, not the product API and not a gate other campaigns must pass — see [ADR 028](docs/adr/028-benchmark-as-conformance-suite.md) as narrowed by [ADR 072](docs/adr/072-pragmatic-production-realignment.md).

The Blender-backed path's reusable capabilities — cross-domain VFX/material/clothing derivation ([ADR 029](docs/adr/029-cross-domain-derived-asset-contracts.md)), first-class lighting ([ADR 032](docs/adr/032-first-class-lighting-derivation.md)), semantic camera execution ([ADR 033](docs/adr/033-semantic-camera-path-fidelity-and-clearance.md)), editorial derivation ([ADR 034](docs/adr/034-first-class-editorial-derivation-and-transfer.md)), the autonomous campaign production loop ([ADR 035](docs/adr/035-autonomous-campaign-production-loop.md), [ADR 036](docs/adr/036-deterministic-blender-render-profiles.md)), procedural sound effects ([ADR 037](docs/adr/037-renderer-independent-procedural-sound-effects.md), [docs/sound-effects.md](docs/sound-effects.md)), and animated fitted clothing ([ADR 030](docs/adr/030-renderer-independent-temporal-clothing.md)) — remain available, working implementations for shots that need them. See [`docs/adr/README.md`](docs/adr/README.md) for the full ADR index. None of these are required for a campaign that doesn't need them.

Project-owned human generation and its fail-closed acceptance workflow are documented in [Character creation and acceptance](docs/characters.md). The continuous body and preserve-volume deformation foundation pass structural gates but remain visually rejected; canonical renders, face evidence, and dual-angle gait probes never imply production acceptance by themselves.

## Source boundaries

- `src/domain`: schemas, persisted state, and loaders
- `src/application`: reusable use cases called by all interfaces
- `src/providers`: optional non-deterministic adapters and provenance contracts
- `src/renderer`: deterministic Remotion compositions and renderer adapter
- `src/verification`: checks, evaluator composition, result aggregation
- `src/media`: dependency diagnostics and reusable inspection utilities
- `src/assets`: workspace paths, cache keys, revisioned filenames
- `src/production`: renderer-independent production plans, typed asset requirements, and resolution manifests
- `src/production/cinematic-campaign.ts`: validated data-driven geometry, shot, editorial, audio, and delivery contract
- `src/interactions`: phased actor/prop contracts, analytic IK synthesis, scene transforms, and multi-object Blender probes
- `src/cinematic`: executable 3D scene contracts, semantic quality gates, portable persistence, and Blender rendering
- `src/cinematic/assembly.ts`: semantic attachment resolution and reusable shot templates
- `src/editing`: generic frame-exact edit plans and deterministic FFmpeg assembly
- `src/audio`, `src/lighting`, `src/vfx`, `src/titles`: reusable provider-free production subsystems
- `library`: immutable, licence-aware reusable production inventory
- `src/cli.ts`: argument parsing, presentation, JSON envelopes, exit codes

Remotion downloads a pinned Chrome Headless Shell into `node_modules/.remotion`; run `npx remotion browser ensure` during setup or whenever the Remotion version changes. Rendering may bind a temporary loopback port for the local browser bundle. All Remotion packages and Zod are exact-version pinned because Remotion treats version alignment as a runtime requirement.

The Beacon One example campaign is intentionally unlike the narrative benchmark: it is a three-shot non-narrative product launch with no character, gait, bookshop, door, or story interaction. Its complete product geometry, materials, attachments, shots, lighting, atmosphere, typography, soundtrack, gates, and edit are declared in one validated YAML file, and the generic builder produces it with zero campaign-specific orchestration source files. That is a useful demonstration that the declarative builder generalises beyond one trailer grammar — not a requirement any other campaign has to repeat.
