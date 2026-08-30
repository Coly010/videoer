# Codex Goal: Establish the Architecture and Initial Repository for the AI Marketing Video Generator

## Objective

Build the architectural foundation and initial repository structure for a **local-first, CLI-first AI marketing video generator** that can produce polished short-form marketing videos for:

- books
- Tutarium
- other products or projects later

The system must remain **style-agnostic**, **provider-independent**, and **modular**.

This task is not to build the complete product.

The goal is to create the architectural decisions, repo structure, contracts, validation, minimal runnable skeleton, and development foundations needed so subsequent implementation work can proceed without repeatedly reopening fundamental design questions.

Use Codex `/goal` mode and **continue iterating until all completion criteria are satisfied**.

Do not stop at a plan.

Do not stop after writing ADRs.

Do not stop after scaffolding empty folders.

Make the repository coherent, installable, testable, and ready for the first renderer implementation.

---

# Product Context

The project is a local-first system for generating short-form marketing videos for TikTok, Instagram Reels, YouTube Shorts, and similar platforms.

Typical output:

```text
10–20 seconds
1080 × 1920
9:16
30 FPS
H.264 MP4
AAC audio
```

An 18-second default is sensible.

The engine must support substantially different marketing styles through the same underlying architecture.

Examples include:

- cinematic fantasy book trailers
- thriller / romance trailers
- atmospheric AI-generated B-roll
- kinetic typography
- SaaS promos
- animated screenshots
- flashy product slideshows
- UI/product showcases
- feature-highlight videos
- launch announcements
- hybrid videos combining generated imagery, screenshots, text, clips, music, and narration

A Tutarium promo may effectively be a highly polished animated slideshow.

A fantasy trailer may use generated imagery, restrained camera motion, atmospheric effects, narration, and a cover reveal.

Neither is more "real" than the other.

The architecture must support both without treating either style as the primary special case.

---

# Product Principle

Optimize for:

> good-looking marketing output per unit of cost and effort

Do **not** optimize for maximum AI sophistication.

A strong marketing video may contain:

- screenshots
- supplied images
- generated stills
- animated typography
- simulated camera movement
- one optional AI-generated video clip
- music
- narration
- a logo or cover reveal

The system should make repeat generation cheaper and easier than manual editing.

---

# Initial MVP Direction

The first MVP eventually needs to prove that ordinary assets can be turned into polished vertical videos.

It must ultimately support two visibly different reference campaigns:

1. **Cinematic book trailer**
2. **Tutarium SaaS/product promo**

The initial architecture created by this task must make both straightforward to implement.

The MVP is intentionally:

- CLI-first
- local-first
- filesystem-based
- deterministic where possible
- easy to inspect
- easy to rerun
- easy to partially regenerate

Do not introduce:

- accounts
- authentication
- a database
- cloud queues
- hosted infrastructure
- distributed job systems
- a web UI
- premature Tutarium coupling

---

# Core Workflow

The intended high-level workflow is:

```text
Campaign Definition
↓
Storyboard
↓
Asset Resolution / Generation
↓
Optional Narration
↓
Rendering
↓
Audio Mix / Encoding
↓
Final MP4
```

The user should ultimately be able to run commands conceptually similar to:

```bash
video create campaign.yaml
video storyboard campaign.yaml
video generate-assets campaign.yaml
video generate-audio campaign.yaml
video render campaign.yaml
video preview campaign.yaml
video shot regenerate 3
```

The exact CLI syntax may change if a better design emerges, but the workflow must remain modular rather than becoming one giant opaque operation.

---

# Required Architectural Characteristics

## 1. Provider Independence

Do not tightly couple the engine to a specific AI vendor.

Design explicit provider boundaries for capabilities such as:

```ts
interface ImageProvider {
  generate(input: ImageGenerationRequest): Promise<GeneratedImage>
}

interface VideoProvider {
  generate(input: VideoGenerationRequest): Promise<GeneratedVideo>
}

interface VoiceProvider {
  synthesize(input: VoiceRequest): Promise<GeneratedAudio>
}

interface MusicProvider {
  getTrack(input: MusicRequest): Promise<AudioTrack>
}
```

These interfaces do not need to match this example exactly.

Improve them where useful.

Provider implementations should be replaceable without changing storyboard or renderer code.

Potential future providers may include:

- Codex CLI
- OpenAI APIs
- local image models
- Kling
- Runway
- Veo
- Seedance
- Wan
- LTX Video
- other future providers

The architecture must not care which provider generated an asset once that asset has entered the pipeline.

---

## 2. Codex CLI as an Experimental Image Provider

The architecture should explicitly allow investigation of **Codex CLI as a still-image provider** for local/personal usage.

This is an experiment, not a foundational dependency.

Create an ADR covering this approach and the reliability concerns.

The conceptual flow is:

```text
CodexImageProvider.generate()
↓
construct prompt
↓
invoke Codex non-interactively
↓
request deterministic output path
↓
wait for completion
↓
verify image exists
↓
validate output
↓
return generated asset
```

Potential invocation may resemble:

```bash
codex exec --ephemeral --skip-git-repo-check "..."
```

but **do not assume exact CLI flags are correct without checking local CLI help/documentation available in the environment**.

Important constraints:

- Codex is an agent, not a deterministic image API.
- Exit code 0 does not prove an image exists.
- Output location may be unreliable.
- The provider must verify expected files.
- It should support explicit retries.
- It should fail clearly.
- It should not silently pretend generation succeeded.
- The rest of the product must continue working if this provider is removed later.

Create a small experimental spike or harness if practical, but do not make successful external image generation a prerequisite for this architecture task if the environment does not support it.

The repository should make this experiment easy to run later.

---

## 3. Structured Storyboard as the Central Intermediate Representation

Every video must be representable as structured data before rendering.

The storyboard is the central intermediate representation between campaign intent and final rendering.

It must support multiple shot types and reusable render modes.

Potential render modes include:

```ts
type ShotRenderMode =
  | "image-motion"
  | "image-to-video"
  | "screenshot"
  | "slideshow"
  | "kinetic-text"
  | "ui-demo"
  | "static"
  | "custom";
```

Improve this model if necessary.

Storyboard concerns should include:

- duration
- sequence
- shot IDs
- shot type
- timing
- source assets
- generated asset instructions
- visual text
- captions
- voiceover text
- motion preset
- transitions
- style/template references
- per-shot metadata
- regeneration state where useful

The storyboard must be:

- serializable
- human editable
- schema validated
- stable enough to become a public project contract
- capable of individual-shot replacement/regeneration

Avoid putting implementation-specific React details directly into campaign data unless there is a compelling reason.

---

## 4. Campaign Definition

Campaign configuration should be separate from the generated storyboard.

Support YAML as the primary human-authored format.

A campaign may include:

- title / project name
- campaign type
- duration
- output format
- target audience
- description / blurb
- product messaging
- tone
- CTA
- style template
- supplied assets
- brand definition
- voice preferences
- music preferences
- provider preferences
- render settings

Use runtime schema validation.

Prefer a single canonical domain model with inferred TypeScript types rather than hand-maintaining duplicated validation/type definitions.

---

## 5. Rendering Technology

Preferred stack:

- **TypeScript**
- **Node.js**
- **Remotion** for composition
- **FFmpeg** for encoding/audio/media operations where appropriate

Remotion should eventually handle:

- layout
- shot composition
- reusable visual components
- transitions
- text animation
- image motion
- screenshots
- overlays
- branding
- captions
- CTA frames

FFmpeg may handle:

- final encoding
- audio processing
- resizing
- normalization
- concatenation where appropriate
- frame-rate conversion
- final delivery optimization

The project must remain scriptable from the command line.

If local investigation demonstrates a materially better architecture, document the choice in an ADR rather than silently diverging.

---

# Required ADRs

Create an `docs/adr/` directory using a consistent ADR format.

At minimum write and accept ADRs covering the following.

## ADR 001: Repository and Package Architecture

Decide whether this should be:

- a single package
- a workspace/monorepo
- another modular structure

The initial design should be proportional to the project.

Avoid enterprise cosplay.

The architecture should, however, make clear boundaries between:

- CLI
- domain/config/schema
- rendering
- providers
- templates
- shared media utilities

Explain why the chosen package layout is preferable.

---

## ADR 002: TypeScript Runtime and Package Manager

Choose:

- Node version policy
- package manager
- module system
- TypeScript build strategy

Prefer modern, boring, well-supported tooling.

Include version pinning or tooling mechanisms so future Codex sessions reproduce the environment reliably.

---

## ADR 003: Campaign and Storyboard Schemas

Document:

- why campaign YAML and storyboard JSON are separate
- validation strategy
- schema ownership
- versioning strategy
- compatibility expectations
- migration strategy if schemas evolve later

---

## ADR 004: Rendering Architecture

Define the relationship between:

- domain storyboard
- template/style resolution
- shot renderers
- Remotion compositions
- FFmpeg/media processing
- final output

Avoid making the storyboard itself a raw Remotion component tree.

---

## ADR 005: Template and Style System

Define how reusable styles control:

- pacing
- typography
- motion presets
- transition defaults
- caption behavior
- CTA presentation
- preferred asset types
- music/narration defaults

The design must allow at least:

```text
cinematic-fantasy
saas-promo
```

without duplicated renderer architecture.

---

## ADR 006: Provider Abstraction

Define:

- provider interfaces
- configuration
- provider lookup/registry
- capabilities
- error handling
- retry ownership
- generated asset metadata
- how unsupported capabilities are represented

Do not make external providers part of the core rendering package.

---

## ADR 007: Asset Storage, Cache, and Reproducibility

Define the campaign filesystem layout.

A sensible direction is:

```text
campaigns/
  some-campaign/
    campaign.yaml
    storyboard.json

    assets/
      ...

    generated/
      images/
      clips/
      audio/

    output/
      final.mp4
      captions.srt
      script.txt
```

Decide:

- deterministic filenames
- generated asset metadata
- cache keys
- overwrite behaviour
- invalidation
- reproducible rerenders
- how supplied vs generated assets differ
- how a single shot can be regenerated without destroying unrelated assets

---

## ADR 008: CLI Architecture

Define command boundaries and orchestration.

The CLI should stay thin.

Business logic should live in reusable modules so a future web UI or Tutarium integration can call the same operations without shelling into the CLI.

---

## ADR 009: Error Handling, Logging, and Diagnostics

Define conventions for:

- user-facing CLI errors
- provider errors
- renderer errors
- validation failures
- missing external dependencies
- verbose/debug output
- exit codes
- machine-readable diagnostics where useful

Failures should be actionable.

---

## ADR 010: Codex CLI Image Provider Experiment

Document:

- why it is potentially valuable
- that it may use existing ChatGPT/Codex allowance
- why it is not deterministic enough to become an architectural dependency
- expected output verification
- retry behaviour
- path checking
- how to run a spike
- criteria for adopting or rejecting it

Recommended experiment:

```text
request one 9:16 image
↓
deterministic filename
↓
wait for command
↓
verify expected path
↓
validate image
↓
record timing/result
```

Design the experiment so it could be repeated 10–20 times later to measure reliability.

---

## ADR 011: Testing Strategy

Define test layers.

At minimum consider:

- schema tests
- domain/unit tests
- CLI integration tests
- deterministic renderer/component tests
- media metadata validation
- optional slow render smoke tests
- provider contract tests with fakes

Avoid snapshot-testing giant blobs simply because snapshot testing exists and humanity apparently enjoys unreadable diffs.

---

## ADR 012: Determinism vs Generative Operations

Explicitly separate:

### deterministic pipeline work

- config parsing
- storyboard validation
- asset lookup
- timing
- template resolution
- rendering
- encoding

from:

### generative/non-deterministic work

- storyboard generation
- image generation
- video generation
- voice generation where external

The user must be able to rerender an existing storyboard without accidentally regenerating generative assets.

This distinction is central to cost control and reproducibility.

---

# Initial Repository Structure

Create the repository structure that follows from the ADRs.

Do not create empty architectural theatre.

Every package/module introduced should have at least a real purpose, exports, basic tests, or a concrete implementation skeleton.

A possible structure might resemble:

```text
/
  apps/
    cli/
    renderer/

  packages/
    core/
    schemas/
    providers/
    templates/
    media/

  campaigns/
    examples/

  docs/
    adr/

  scripts/

  package.json
  tsconfig...
```

This is only an example.

Choose the structure based on the ADR.

---

# Required Initial Implementation

The repository should include enough implementation that the architectural choices are executable.

At minimum:

## Configuration

- campaign YAML loader
- campaign schema
- useful validation errors

## Storyboard

- storyboard schema
- typed shot model
- support for several initial shot types
- storyboard load/save helpers
- schema version field

Initial shot types should be sufficient to represent both target demos.

For example:

- kinetic text
- image motion
- screenshot
- slideshow
- cover reveal
- CTA/logo frame

Do not over-model every conceivable future shot.

---

## Templates

Create skeleton/template definitions for:

### `cinematic-fantasy`

and

### `saas-promo`

They do not need final production design yet.

They must demonstrate that the same storyboard/rendering architecture can resolve two substantially different style configurations.

---

## Motion Presets

Define an initial motion preset vocabulary such as:

- push-in
- pull-out
- track-left
- track-right
- pan-up
- pan-down
- scale-pop
- slide-in
- swipe
- crossfade
- static

Centralize these rather than scattering string literals everywhere.

---

## CLI

Create a functioning CLI entrypoint.

At minimum implement useful versions of:

```bash
video validate <campaign>
video inspect <campaign>
video storyboard validate <storyboard>
```

If practical, also scaffold:

```bash
video render <campaign>
```

so that it can route into the renderer even if only a minimal composition is available.

The CLI should provide:

- help
- useful exit codes
- readable validation failures
- debug/verbose mode if appropriate

---

## Provider Contracts

Create provider interfaces and at least one fake/test implementation.

Do not require external API keys.

Include the architectural home for:

```text
CodexImageProvider
```

but it is acceptable for the real provider to remain experimental or partially implemented if image tool invocation cannot be validated in the current environment.

A fake provider should let later renderer/storyboard work proceed without external cost.

---

## Media / External Dependency Checks

Add a clean mechanism for checking runtime dependencies such as:

- FFmpeg
- possibly ffprobe

The CLI should produce a useful message if a required binary is missing.

Do not fail mysteriously three layers later.

---

# Example Campaigns

Create two minimal example campaigns under version control.

## Example A: cinematic book trailer

Use placeholder/local sample assets if no real assets are available.

The campaign should clearly represent:

```text
type: book
style: cinematic-fantasy
duration: ~18s
```

The storyboard should demonstrate cinematic-friendly shot types.

---

## Example B: Tutarium SaaS promo

Use placeholder/local sample assets.

The campaign should represent:

```text
type: product
style: saas-promo
duration: ~12–15s
```

The storyboard should demonstrate:

- kinetic text
- screenshots/cards
- slideshow or feature bursts
- CTA/logo treatment

The two storyboards should visibly differ in structure and pacing.

They exist to prove architecture flexibility.

---

# Repository Quality

Set up practical development tooling.

Include, where appropriate:

- formatter
- linter
- TypeScript strictness
- tests
- build/typecheck scripts
- package-manager scripts
- `.gitignore`
- environment example only if actually needed
- editor configuration if useful
- README
- CONTRIBUTING or development notes only if they add real value

Do not add boilerplate policies or ceremony simply to inflate the repository.

---

# README Requirements

The README should explain:

1. what the project is
2. what it is not
3. the current architectural status
4. local prerequisites
5. install instructions
6. core commands
7. campaign → storyboard → render mental model
8. repository layout
9. how the two sample campaigns differ
10. provider philosophy
11. deterministic vs generative operations
12. current limitations
13. next implementation milestone

Keep it useful for both a human maintainer and future Codex sessions.

---

# Architecture Documentation

In addition to ADRs, create a concise architecture overview such as:

```text
docs/architecture.md
```

Include a simple Mermaid diagram if useful.

It should show dependencies and data flow, for example:

```text
CLI
↓
Application Services
↓
Campaign / Storyboard Domain
↓
Template Resolver
↓
Renderer
↓
Remotion / Media
```

with generative providers off to the side as optional collaborators rather than sitting at the centre of everything.

---

# Guardrails

## Avoid Premature Complexity

Do not introduce:

- dependency injection frameworks
- elaborate plugin protocols
- message buses
- event sourcing
- databases
- queues
- cloud abstractions
- Kubernetes-shaped thoughts
- generic workflow engines

Simple TypeScript factories, registries, interfaces, and filesystem conventions are likely sufficient.

---

## Keep the Renderer Independent of AI

A fully supplied campaign/storyboard must be renderable without any AI provider being configured.

This is a hard requirement.

AI should create inputs to the renderer.

AI must not be required for the renderer to function.

---

## Preserve Partial Regeneration

Architect the filesystem and domain model so that later we can do something equivalent to:

```bash
video shot regenerate 3
```

without regenerating:

- every image
- narration
- unrelated shots
- the full storyboard

---

## Reproducibility

A completed campaign should eventually contain enough persisted information to rerender the same video from the same assets.

Do not hide critical state only in process memory.

---

# Verification

Before considering this goal complete, run the repository's actual checks.

At minimum:

```text
install dependencies
typecheck
lint
tests
build
CLI help
campaign validation for both examples
storyboard validation for both examples
```

If a minimal renderer is implemented, perform at least one smoke render or Remotion composition validation.

If FFmpeg/Remotion cannot execute because of environment restrictions, ensure the failure is identified and documented precisely.

Do not mark the work complete because files exist.

---

# Completion Criteria

Continue iterating until all of the following are true:

- [ ] Repository architecture is decided and documented.
- [ ] At least 12 meaningful ADRs exist and are internally consistent.
- [ ] `docs/architecture.md` exists.
- [ ] Repository is scaffolded according to the ADRs.
- [ ] Package manager/runtime/tooling are configured.
- [ ] TypeScript compiles under strict settings.
- [ ] Campaign YAML schema exists.
- [ ] Storyboard schema exists.
- [ ] Storyboard schema has explicit versioning.
- [ ] Storyboard supports enough shot types for both initial demo styles.
- [ ] Campaign and storyboard loaders exist.
- [ ] Validation errors are user-friendly.
- [ ] Motion presets are centralized.
- [ ] `cinematic-fantasy` template skeleton exists.
- [ ] `saas-promo` template skeleton exists.
- [ ] Provider contracts exist.
- [ ] Fake/test providers exist where useful.
- [ ] Codex image-provider experiment has a documented architectural home.
- [ ] Asset/cache conventions are implemented or clearly represented in code.
- [ ] CLI entrypoint works.
- [ ] CLI can validate campaign files.
- [ ] CLI can validate storyboard files.
- [ ] Two distinct example campaigns exist.
- [ ] Two distinct example storyboards exist.
- [ ] Tests cover important schema/domain behaviour.
- [ ] Development commands work.
- [ ] README accurately reflects the repository.
- [ ] No external paid API is required for tests or basic development.
- [ ] Renderer architecture can operate without AI providers.
- [ ] All checks pass, or any environment-only blocker is narrowly documented with evidence.

---

# Final Codex Output

When the goal is complete, provide a concise completion report containing:

## Architecture

- chosen repo/package structure
- major architectural boundaries
- key decisions that are most important for future work

## ADRs

List the ADR titles.

## Implemented Foundation

Summarize actual runnable functionality.

## Verification

List commands executed and whether they passed.

## Known Limitations

Only include real remaining limitations.

## Recommended Next Goal

The next goal should normally be:

> Implement the deterministic Remotion renderer and produce the first polished end-to-end sample renders for both `cinematic-fantasy` and `saas-promo` using supplied/local assets only.

Do not begin major later phases merely to make this task look more complete.

The purpose of this goal is to leave behind a strong architectural foundation that the renderer can now be built on confidently.
