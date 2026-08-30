# Codex Goal: Evolve the Architecture for Agent-Operated Generation, Verification, and Iteration

## Objective

Update the existing AI Marketing Video Generator repository so that its architecture explicitly supports **Codex as the primary operator/interface during development and likely during normal personal usage**.

The repository already has an initial set of ADRs, a repo structure, schemas, CLI foundations, provider abstractions, example campaigns, and documentation from the previous architecture goal.

This task is **not** to throw that work away.

Instead:

1. inspect the current repository and ADRs
2. identify which existing architectural decisions remain valid
3. amend or supersede only the ADRs that materially change
4. create new ADRs where the new agent-operated workflow introduces genuinely new concerns
5. evolve the repository structure and code boundaries accordingly
6. update the README and architecture documentation so the project accurately reflects the new operating model
7. verify that all existing checks still pass after the architectural changes

Use Codex `/goal` mode and **continue iterating until all completion criteria are satisfied**.

Do not stop after writing documentation.

Do not stop after renaming folders.

Do not introduce speculative abstractions that are not needed to support the workflow described here.

---

# New Product Direction

The project should now be understood as:

> A composable, local-first marketing-video generation toolkit that can be operated interactively by Codex, with explicit support for generation, inspection, verification, revision, and final rendering.

The CLI remains important.

The underlying application API is equally important.

Codex should be able to use the project as a set of composable primitives rather than being forced through one opaque command.

The intended user experience is likely to be:

```text
Open Codex
↓
provide reference images / text / book metadata / screenshots
↓
ask:
"Generate me a 15-second cinematic trailer for The Rise of Demons"
↓
Codex imports or copies relevant references into a campaign workspace
↓
Codex creates/updates campaign configuration and storyboard
↓
Codex invokes the toolkit
↓
Codex generates required stills/assets
↓
Codex inspects them
↓
Codex regenerates weak assets where necessary
↓
Codex produces a draft render
↓
Codex inspects and verifies the video
↓
Codex modifies only the weak portions
↓
Codex rerenders
↓
final verified output
```

Codex becomes the orchestration and conversational layer.

The repository should provide the deterministic and generative building blocks that Codex operates.

---

# Important Architectural Principle

Do **not** attempt to build an agent framework inside this repository.

Codex already provides the agent.

The project should instead expose:

- clear application-level operations
- granular CLI commands
- structured machine-readable output
- inspectable files
- explicit verification commands
- reproducible campaign state
- selective regeneration
- revision history
- deterministic boundaries

The project should be easy for an external agent to understand and operate.

That is different from embedding an agent into the project itself.

---

# Revised Mental Model

The previous conceptual pipeline:

```text
Campaign
↓
Storyboard
↓
Assets
↓
Render
```

should now evolve toward:

```text
Campaign
↓
Plan / Storyboard
↓
Generate Assets
↓
Inspect
↓
Evaluate / Verify
↓
Revise
↓
Draft Render
↓
Inspect / Verify
↓
Selective Revision
↓
Final Render
```

Every meaningful stage should be independently invokable.

The architecture should make it cheap to rerun only the part that changed.

---

# Core Architectural Change: Application API + CLI

The CLI must remain a thin adapter over reusable application-level functions.

The repository should expose operations conceptually similar to:

```ts
createCampaign()
importAsset()
loadCampaign()
saveCampaign()

generateStoryboard()
validateStoryboard()

generateShot()
regenerateShot()
renderShot()
inspectShot()

generateAudio()
mixAudio()

renderCampaign()

inspectImage()
inspectRender()

verifyCampaign()
verifyStoryboard()
verifyAsset()
verifyRender()
```

Do not copy this list blindly.

Inspect the existing code and define the smallest coherent application API needed to support the intended workflow.

The same application services should be usable by:

- CLI
- tests
- future Tutarium integration
- future web UI
- other Node/TypeScript callers

There should not be separate business logic implementations for CLI and SDK usage.

---

# Codex as an External Operator

Design the command surface so Codex can:

- discover commands through help
- invoke individual pipeline stages
- understand failures
- parse structured results
- inspect generated artifacts
- request machine-readable output
- rerun individual operations
- work safely within a campaign directory

Important CLI capabilities should generally support:

```text
human-readable default output
+
optional --json output
```

Machine-readable output should be stable enough for agent use.

Do not emit arbitrary prose where structured output would be more useful.

---

# Granular CLI Direction

The exact command names should follow the existing CLI design where sensible.

However, the architecture should support operations broadly equivalent to:

```bash
video campaign init <name>
video campaign inspect <campaign>
video campaign verify <campaign>

video asset import <path>
video asset list
video asset inspect <asset>

video storyboard generate <campaign>
video storyboard validate <storyboard>
video storyboard inspect <storyboard>

video shot generate <shot-id>
video shot regenerate <shot-id>
video shot render <shot-id>
video shot inspect <shot-id>
video shot verify <shot-id>

video audio generate <campaign>
video audio mix <campaign>

video render <campaign> --draft
video render <campaign> --final

video inspect render <render-id|latest>
video verify render <render-id|latest>
```

Do **not** implement every listed command merely because it appears here.

The goal is to align architecture and repo structure around this composable model.

Implement enough representative operations to prove the design.

---

# Verification Must Become a First-Class Subsystem

Verification is no longer a small utility concern.

Create a clear architectural boundary for:

```text
verification
```

or an equivalent concept.

Verification should combine:

1. deterministic mechanical checks
2. inspection artifacts for human/agent judgement
3. room for future semantic/AI-assisted evaluators

Do not make the verification subsystem dependent on generative AI.

---

# Mechanical Verification

The system should be able to verify objective properties automatically.

## Image Checks

Examples:

- file exists
- file decodes successfully
- expected format
- expected dimensions
- expected aspect ratio
- reasonable file size
- image is not entirely blank
- transparency is allowed/disallowed as expected
- expected asset metadata exists

## Video Checks

Examples:

- file exists
- media can be probed
- container is valid
- expected duration within tolerance
- expected dimensions
- expected aspect ratio
- expected FPS
- expected video codec
- expected audio codec
- audio presence/absence matches campaign
- no unexpected zero-length output
- no obviously broken timeline
- expected render metadata exists

## Storyboard Checks

Examples:

- schema valid
- total duration valid
- all shot references resolve
- all required assets exist
- shot render types supported
- no negative/zero duration
- timing is coherent
- CTA requirements satisfied where applicable
- narration timing does not obviously exceed available shot/timeline duration

## Campaign Checks

Examples:

- campaign schema valid
- required supplied assets exist
- chosen template exists
- configured providers exist or are optional as intended
- render settings valid
- campaign state internally consistent

Use explicit pass / warn / fail semantics where appropriate.

---

# Verification Result Model

Create or formalize a structured verification result.

Conceptually:

```ts
type VerificationStatus = "pass" | "warning" | "fail";

interface VerificationResult {
  status: VerificationStatus;
  checks: VerificationCheck[];
}
```

A check should carry useful context such as:

- check ID
- status
- expected value
- actual value
- file or shot ID
- actionable message
- optional remediation hint

Machine-readable verification output should be suitable for Codex to consume.

---

# Inspection and Verification Are Different

Preserve an explicit distinction.

## Verify

Answers:

> Does this artifact satisfy known objective requirements?

## Inspect

Answers:

> What should an agent or human look at to make a qualitative judgement?

Do not collapse these concepts into one command or one data model if doing so makes either less useful.

---

# Agent-Friendly Image Inspection

Generated images should produce or support inspection artifacts.

Possible inspection layout:

```text
inspection/
  shots/
    shot-03/
      preview.png
      metadata.json
      verification.json
```

If multiple candidates exist:

```text
inspection/
  shots/
    shot-03/
      candidate-a.png
      candidate-b.png
      candidate-c.png
      contact-sheet.png
      metadata.json
```

Codex should be able to visually inspect these outputs and decide whether:

- the subject matches references
- visual tone is correct
- obvious generation defects exist
- the image is compositionally usable
- another attempt is needed

The toolkit does not need to make subjective artistic decisions itself.

It needs to make those decisions easy for Codex.

---

# Agent-Friendly Video Inspection

Do not rely on the final MP4 being the only inspection surface.

A rendered video should be able to produce useful inspection artifacts such as:

```text
inspection/
  renders/
    render-003/
      metadata.json
      verification.json
      contact-sheet.jpg

      frames/
        frame-000.jpg
        frame-001.jpg
        ...

      shots/
        shot-01-start.jpg
        shot-01-middle.jpg
        shot-01-end.jpg
        shot-02-start.jpg
        ...
```

The exact sampling strategy should be practical.

It should help Codex evaluate:

- framing
- typography
- cropping
- visual continuity
- repeated imagery
- transitions
- CTA readability
- rough pacing
- whether a shot visually fails

Do not generate hundreds of redundant frames.

A small, useful inspection set is preferable.

---

# Contact Sheets

Treat contact-sheet generation as a useful primitive.

Support contact sheets for:

- image candidate sets
- sampled video frames
- shot boundary/midpoint frames

This should be implemented through reusable media utilities rather than one-off shell commands buried in CLI handlers.

---

# Campaigns as Durable Agent Workspaces

Campaign directories should now explicitly function as persistent workspaces.

Review and update the current campaign layout.

A possible evolved structure is:

```text
campaigns/
  rise-of-demons-001/
    campaign.yaml
    storyboard.json
    campaign-state.json

    references/
      cover.jpg
      blurb.md
      character-vivrel.png
      world-notes.md

    assets/
      supplied/
      imported/

    generated/
      images/
      clips/
      audio/

    renders/
      render-001.mp4
      render-002.mp4
      final.mp4

    inspection/
      shots/
      renders/

    reports/
      render-001.json
      render-002.json
```

Do not adopt this blindly.

Compare it with the current architecture and choose the smallest coherent evolution.

Important properties:

- original reference material remains identifiable
- supplied/imported assets are distinguishable from generated assets
- generated assets are cacheable
- outputs are versioned rather than casually overwritten
- inspection output has a predictable home
- verification reports have a predictable home
- campaign state persists across Codex sessions

---

# Reference Provenance

The system should preserve why a generated asset exists and what inputs produced it.

A generated asset should be able to record metadata such as:

```json
{
  "shotId": "shot-03",
  "provider": "codex",
  "attempt": 3,
  "prompt": "...",
  "references": [
    "references/vivrel.png",
    "references/morsden.jpg"
  ]
}
```

Improve the shape as needed.

The point is to retain:

- provider
- request/prompt
- references
- generation attempt
- source shot
- output path
- timestamps if useful
- hash/cache information where already supported

This allows Codex to understand and selectively regenerate weak assets without reconstructing history from scratch.

---

# Selective Regeneration

Selective regeneration is now a hard architectural requirement.

Codex should be able to change one portion of a campaign without causing unrelated generative work to rerun.

Examples:

```text
regenerate shot-03 still
```

must not automatically regenerate:

- other shot images
- narration
- storyboard
- supplied assets

Likewise:

```text
rerender campaign
```

should reuse valid existing assets unless explicit invalidation requires otherwise.

Revisit the existing asset/cache ADR and implementation accordingly.

---

# Render Revision History

Do not casually overwrite the latest render during iterative work.

Introduce a lightweight render revision model.

Conceptually:

```text
renders/
  render-001.mp4
  render-002.mp4
  render-003.mp4
  final.mp4
```

A render manifest/state record may capture:

```json
{
  "renderId": "render-003",
  "parent": "render-002",
  "changes": [
    "regenerated shot-03",
    "updated CTA timing"
  ]
}
```

Keep this lightweight.

Do not build Git inside the application.

The purpose is:

- compare iterations
- inspect prior versions
- avoid accidental loss
- let Codex understand what changed

---

# Draft vs Final Render Lifecycle

Represent the distinction between:

```text
draft
```

and:

```text
final
```

in a simple, explicit way.

Draft renders may prioritize:

- speed
- lower resolution
- reduced encoding cost
- faster inspection

Final renders should use the requested campaign output settings.

If implementing lower-quality draft rendering is premature, architect the lifecycle without forcing it yet.

Document that decision.

---

# Verification Evaluator Architecture

Consider a small evaluator abstraction.

Conceptually:

```ts
interface Evaluator<T> {
  evaluate(input: T): Promise<EvaluationResult>;
}
```

Possible deterministic evaluators:

```text
ImageDimensionEvaluator
ImageDecodeEvaluator
ImageAspectRatioEvaluator

VideoDurationEvaluator
VideoCodecEvaluator
VideoDimensionsEvaluator
AudioPresenceEvaluator

StoryboardTimingEvaluator
StoryboardAssetEvaluator
CampaignConsistencyEvaluator
```

This should remain lightweight.

Avoid dependency-injection frameworks.

A simple registry/list/composition system is probably sufficient.

---

# Future Semantic Evaluators

The architecture should allow, but not implement prematurely, evaluators such as:

```text
VisualQualityEvaluator
PromptAlignmentEvaluator
CharacterConsistencyEvaluator
BrandConsistencyEvaluator
```

These may eventually call multimodal models.

They are **not** required for this task.

The main short-term semantic reviewer is Codex itself inspecting generated artifacts.

Document this separation clearly.

---

# New / Updated ADR Work

Inspect the existing ADR directory before making changes.

Do not duplicate decisions already documented.

Use the project's existing ADR numbering and format.

For each existing ADR:

- leave it alone if still correct
- amend it if the original decision remains valid but needs additional consequences/context
- supersede it if the decision itself has materially changed
- create a new ADR only when there is a distinct new architectural decision

At minimum ensure the ADR set now addresses the following concerns.

---

## Application API and CLI Boundary

Document that:

- the CLI is an adapter
- application services contain reusable operations
- future interfaces should reuse the same services
- Codex may operate through CLI or direct TypeScript API depending on environment
- there must not be two separate implementations of workflow logic

This may amend the existing CLI architecture ADR or warrant a new ADR depending on current content.

---

## Agent-Operable Command Design

Document conventions for:

- granular commands
- composability
- `--json`
- stable machine-readable result envelopes
- exit codes
- discoverability
- paths
- errors
- non-interactive use
- avoiding prompts where explicit flags/input are better

The CLI should remain pleasant for humans while being reliable for Codex.

---

## Verification Architecture

Create or update an ADR covering:

- mechanical verification
- pass/warn/fail
- evaluator composition
- structured verification reports
- deterministic vs future semantic evaluators
- relationship between verification and rendering

---

## Inspection Artifact Architecture

Document:

- inspection vs verification
- generated previews
- contact sheets
- sampled video frames
- shot boundary frames
- metadata/report layout
- how these artifacts support multimodal agent review

---

## Campaign Workspace and State

Update the filesystem/cache ADR or create a new ADR covering:

- campaign as persistent agent workspace
- references
- imported assets
- generated assets
- inspection
- reports
- render history
- persisted state

---

## Reference Provenance and Generation Metadata

Document how generated assets retain:

- prompt/request
- provider
- reference assets
- source shot
- attempt/version
- cache identity

Avoid storing critical generation context only in transient logs.

---

## Revision and Render History

Document:

- render IDs
- draft/final distinction
- lightweight parent/change metadata
- overwrite policy
- retention expectations

---

## Selective Regeneration / Invalidation

Ensure the ADR set clearly specifies:

- asset-level invalidation
- shot-level regeneration
- rerender without regeneration
- dependency relationships
- when cache reuse is valid
- explicit forced regeneration

---

# Repository Structure Review

Review the current package layout.

The architecture may now benefit from boundaries equivalent to:

```text
packages/
  core/
  application/
  providers/
  renderer/
  verification/
  templates/
  media/

apps/
  cli/
```

This is not mandatory.

Use the existing structure where possible.

The desired conceptual boundaries are:

## Core / Domain

Owns:

- campaign types
- storyboard types
- schema-defined concepts
- IDs
- generation metadata
- render metadata

## Application

Owns use cases such as:

- create/import/update campaign
- generate/regenerate shot
- render campaign
- inspect artifacts
- verify artifacts

## Providers

Owns external generative integrations.

## Renderer

Owns deterministic visual composition.

## Verification

Owns deterministic quality checks and result models.

## Media

Owns low-level reusable operations such as:

- ffprobe
- frame extraction
- contact-sheet generation
- image metadata
- media metadata

## CLI

Owns:

- argument parsing
- presentation
- JSON serialization
- process exit codes

Do not create a package solely to make this diagram symmetrical.

---

# Initial Implementation Changes

This goal is primarily architectural, but update enough implementation to prove the revised design.

At minimum:

## Application Layer

Extract or create application-level operations so representative CLI commands do not directly contain domain/provider/renderer orchestration.

---

## Structured CLI Output

At least representative existing commands should support:

```bash
--json
```

with stable structured output.

Good candidates:

```text
campaign validation
storyboard validation
campaign inspection
verification
```

---

## Verification Foundation

Implement a real verification subsystem with several useful deterministic checks.

At minimum include checks that prove the architecture across:

- campaign/storyboard
- image or generic asset
- video/media metadata where practical

Use fakes/fixtures if a full render is not yet available.

---

## Inspection Foundation

Implement useful primitives for at least some of:

- image metadata inspection
- frame extraction
- contact-sheet generation
- video metadata inspection

If current renderer/media support is not mature enough for all of these, implement the reusable media layer and test it against fixtures.

---

## Render/Generation Metadata

Update generated asset records or manifests so provenance can be retained.

---

## Campaign State

Introduce only the minimum persistent state needed to support:

- generated asset metadata
- render history
- verification/inspection references

Do not create an application database.

Filesystem JSON is sufficient unless the existing architecture has a better equivalent.

---

# README Update

Rewrite the relevant README sections so they accurately describe the new product model.

The README should now make clear:

## What the project is

A local-first, agent-operable marketing-video toolkit.

## Primary interface

Codex is expected to be a major interactive orchestration surface during development and personal use.

The CLI remains a first-class stable interface.

## Why both CLI and application API exist

The CLI is one adapter over reusable application services.

## Intended workflow

Describe:

```text
references
→ campaign
→ storyboard
→ generation
→ inspection
→ verification
→ revision
→ render
```

## Deterministic vs generative work

Explain that rerendering should not accidentally regenerate assets.

## Verification

Document available checks and the distinction between:

- inspect
- verify

## Campaign workspace

Explain the campaign directory and where:

- references
- generated assets
- renders
- inspection
- reports

live.

## Codex workflow example

Include a concise example showing how a user may:

```text
open Codex
attach references
request a trailer
allow Codex to create the campaign
generate assets
inspect them
regenerate weak shots
render
verify
revise
finish
```

Do not imply this is fully autonomous if some stages remain future work.

Clearly separate current capability from intended workflow.

---

# Architecture Documentation Update

Update:

```text
docs/architecture.md
```

The diagram should reflect Codex as an **external operator**, not an internal package dependency.

A conceptual shape may be:

```text
               Codex / Human
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
         CLI           TypeScript API
          └─────────┬─────────┘
                    ▼
             Application Layer
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
   Domain        Providers      Renderer
      │                             │
      └─────────────┬───────────────┘
                    ▼
                Media Layer
                    │
                    ▼
              Verification
```

Improve the dependency direction if necessary.

Verification may consume outputs from several layers rather than literally sitting below media.

The documentation should show the actual architecture, not force the code to match a decorative diagram.

---

# Guardrails

## Do Not Build an Agent Framework

No:

- planner framework
- autonomous loop engine
- internal LLM agent
- prompt graph
- tool-calling framework
- MCP server unless an existing concrete need justifies it separately

Codex is the agent.

This repo supplies tools.

---

## Do Not Overengineer State

Use filesystem state.

Do not introduce:

- SQLite
- Postgres
- Redis
- queues
- event sourcing

unless the current repository already proves a concrete unavoidable need.

It almost certainly does not.

---

## Keep Verification Mostly Deterministic

The architecture should permit semantic evaluators later.

Do not make verification rely on:

- OpenAI
- Codex
- an image model
- an external paid API

Mechanical quality gates must run locally.

---

## Preserve Existing Working Decisions

Do not rewrite ADRs merely because this is a new goal.

A clean architecture evolution is better than churn.

---

# Tests

Add or update tests for the new architectural contracts.

At minimum cover:

- application service boundaries where practical
- `--json` output shape
- verification result aggregation
- pass/warn/fail behaviour
- generated asset provenance serialization
- campaign state serialization
- render revision metadata
- selective invalidation/regeneration logic if implemented
- media inspection utilities

Avoid tests that merely assert implementation details.

---

# Verification of This Goal

Before declaring completion:

1. run install if dependencies changed
2. run formatter/check
3. run lint
4. run typecheck
5. run unit tests
6. run integration tests
7. run build
8. run representative CLI help
9. run representative commands with human output
10. run the same representative commands with `--json`
11. run verification against example campaigns/storyboards
12. exercise inspection utilities against real fixtures
13. confirm existing example campaigns still validate

If current rendering is functional, also:

14. inspect at least one rendered media file
15. generate at least one verification report

Do not mark the task complete simply because documentation compiles.

---

# Completion Criteria

Continue iterating until all of the following are true:

- [ ] Existing ADRs were reviewed rather than blindly replaced.
- [ ] ADRs that remain valid are unchanged or minimally amended.
- [ ] Superseded ADRs clearly point to replacement decisions.
- [ ] Application API / CLI boundary is explicitly documented.
- [ ] Agent-operable CLI conventions are documented.
- [ ] Verification is a first-class architectural concern.
- [ ] Inspection and verification are explicitly distinct.
- [ ] Campaign workspace/state architecture supports persistent Codex sessions.
- [ ] Generated asset provenance is represented.
- [ ] Selective regeneration is architecturally supported.
- [ ] Render revision/history behaviour is documented.
- [ ] Draft/final render lifecycle is documented.
- [ ] Repo package/module structure reflects the revised boundaries.
- [ ] CLI business logic is not the sole implementation of workflows.
- [ ] Representative application services exist.
- [ ] Representative CLI commands support stable `--json` output.
- [ ] A verification result model exists.
- [ ] Several real deterministic evaluators/checks exist.
- [ ] Inspection/media utilities exist for useful artifacts.
- [ ] Contact-sheet/frame inspection is implemented or cleanly scaffolded with tested reusable primitives.
- [ ] Campaign state remains filesystem-based.
- [ ] No paid external API is required to run verification/tests.
- [ ] README accurately explains Codex as an external orchestration interface.
- [ ] `docs/architecture.md` reflects the revised architecture.
- [ ] Existing example campaigns remain valid.
- [ ] Tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] Any genuine environment limitation is documented precisely rather than hand-waved.

---

# Final Codex Report

When complete, provide a concise report with:

## ADR Changes

For every ADR touched:

- title
- whether it was unchanged / amended / superseded / new
- one-line reason

## Architecture Changes

Summarize:

- application API boundary
- CLI changes
- verification
- inspection
- campaign state
- revision model

## Repository Changes

Show the relevant updated directory tree.

## Implemented Functionality

Only list things that actually work.

## Verification

List commands run and whether they passed.

## Remaining Limitations

List concrete limitations only.

## Recommended Next Goal

Recommend the next goal based on the actual state of the repository.

If the deterministic renderer is still the major missing component, the next goal should likely be:

> Build the first end-to-end agent-operated draft/review/revise loop using local/supplied assets: generate or load a storyboard, render a campaign, produce inspection artifacts, run verification, revise a selected shot, and rerender without regenerating unrelated assets.

Do not begin that next goal as part of this task unless required to prove the architecture.
