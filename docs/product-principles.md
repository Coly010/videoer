# Product principles

This is the durable north star for Videoer. When any other document, ADR, or piece of code
conflicts with this file, this file wins. `AGENTS.md` points here instead of restating it.

Superseded/narrowed by this policy: [ADR 072](adr/072-pragmatic-production-realignment.md). See
[`docs/adr/README.md`](adr/README.md) for which earlier ADRs remain fully current versus narrowed.

## Canonical product goal

> Optimise for good-looking marketing output per unit of cost and effort.

A second, equally important test:

> Creating another good marketing video should feel easier than manually editing one.

Quality means the finished piece feels deliberate, visually attractive, appropriately cinematic
or energetic for its style, well paced, well sounded, readable, coherent, and compelling enough
for normal TikTok/Reels/Shorts viewing. Ambitious cinematic quality is welcome when a campaign
needs it — but sophistication that does not materially improve the finished video is not progress.

## Priority order

When two of these pull in different directions, the higher one wins. Lower priorities must not
routinely defeat higher ones.

1. Finished-video effectiveness and user-visible quality
2. Suitability of technique for the shot/campaign
3. Production cost and iteration speed
4. Reliability and maintainability
5. Useful reuse
6. Reproducibility/determinism where valuable
7. Abstraction purity

## Cinematic production is first-class

Videoer must remain capable of genuinely cinematic trailers — fantasy book trailers, thriller/
romance, atmospheric promos — alongside product films, SaaS promos, UI showcases, kinetic
typography, and polished slideshows, plus hybrids of all of these. A cinematic trailer is a
*creative output style*, not a rendering implementation: it may be entirely Blender, entirely 2D
composite, or any mix. Choose whatever combination makes the finished shot convincing.

## Tool selection is pragmatic, not principled portability

Tool lock-in is acceptable. Backend-specific implementations are acceptable. Campaign-specific
solutions are acceptable. Replacing a tool with a better one is acceptable. Prefer a mature tool's
native representation over recreating that representation inside Videoer.

**Renderer independence is not a universal requirement.** It is fine for `cinematic-3d → Blender`
to simply be a production decision, using Blender-native geometry, materials, Geometry Nodes,
Rigify rigs, constraints, actions, simulations, and compositor nodes directly. This does not
require a generic scene engine, canonical geometry/material/skeleton/motion, or a Blender/Three.js
adapter pair — unless those intermediate layers independently earn their keep (see the
architecture-creation threshold below). Where a renderer-independent layer already exists and
provides real automation value (e.g. driving both Blender shape keys and a Three.js preview from
one motion contract), keep it; where it exists mainly because portability was assumed to be
intrinsically valuable, treat it as optional infrastructure, not a mandate.

Generative-**provider** independence (image/video/voice providers) is a separate, still-useful
concern, because those providers genuinely change over time. Do not confuse it with renderer
independence — accepting media from many providers is compatible with deliberately using one
production renderer for a shot class.

Videoer should orchestrate mature production software (rigging, skinning, IK, retargeting,
actions, constraints, cloth, hair, particles, fluids, materials, PBR, cameras, lighting,
compositing, colour management, motion blur) rather than recreate it. Project-owned code
concentrates on automation, direction, technique selection, tool configuration, moving assets
between stages, assembly, inspection, revision, and reproducibility where it is worth the cost.

## Shot strategy selection

Before doing significant production work for a shot, choose the cheapest credible technique for
the desired result — not the technically simplest or architecturally purest one. Consider desired
visual result, duration, available supplied assets, required motion/performance, camera movement,
consistency needs, cost, render time, provider/model cost, expected iteration count, and whether a
mature external/local tool already solves the problem. Example techniques: supplied-media,
image-motion, layered-2d, scene-composite, generated-still, image-to-video, cinematic-3d, ui-demo,
kinetic-text, slideshow, stock/user-video, custom. A campaign may freely mix shots produced by
different techniques — normalisation happens at the **rendered media boundary**, not by forcing
every renderer's internal scene representation into one canonical form.

## Reuse is a benefit, not an acceptance requirement

Reuse — templates, effects, transitions, sound assets, Blender assets, animations, rigs, material
libraries, lighting setups, campaign patterns, UI components, prompts, brand presets — remains
valuable and should be kept where it creates real leverage. But the policy is:

```text
solve current production well → did it prove useful? → is it likely to recur? → promote it if worthwhile
```

not:

```text
build reusable system first → transfer it → publish it → use it
```

Campaign-specific work is allowed. A finished campaign does not need to prove unrelated
cross-campaign transfer. A useful bespoke implementation is not an architectural failure.

## Shared asset library: optional leverage, not a required lifecycle

Default lifecycle:

```text
working/experimental asset → campaign-local accepted asset → used successfully → optional shared candidate → shared/published when reuse justifies the work
```

Every successful campaign asset does **not** need to become immutable shared inventory, and no
campaign needs unrelated transfer evidence before it can ship. Provenance and licence tracking
remain important for externally sourced assets and commercial-use safety, but that infrastructure
must not become more expensive than the production value it protects.

## Determinism: valuable where it pays for itself

Determinism remains useful for render reproducibility, caching, revision safety, selective
rerendering, debugging, and verification. It is not a universal quality requirement. Prefer
"deterministic where it materially improves production reliability or cost" over "deterministic
regardless of engineering/rendering expense." Bounded nondeterminism in a tool or renderer is
acceptable if it materially improves output or speed, output remains inspectable, and reruns stay
operationally manageable. Byte-identical output is only required where byte identity itself
delivers real product value — do not sacrifice better rendering technology to preserve identical
hashes.

## Verification serves finished-output quality

Mechanical verification (files exist, assets resolve, video decodes, duration/dimensions/FPS
correct, audio exists, timeline coherent, text on screen when expected, no clipping/corruption,
inexpensive geometry/camera sanity) remains useful for diagnosing and preventing real failures. It
is not a parallel product and should not consume more effort than the marketing video itself.

The highest-order acceptance surface is the finished video. The operative question is not "did
each subsystem satisfy its internal contract?" — it is "would this be a good marketing video?"
Review: first-second hook, visual quality, composition, cinematic credibility where relevant,
shot-to-shot coherence, motion quality, pacing, transitions, typography/readability, sound
effects, music, mix balance, emotional/marketing impact, branding, CTA, obvious AI/rendering
defects, and whether the piece feels postable. See [`docs/quality-model.md`](quality-model.md) and
`src/quality/model.ts`'s `finishedVideoReviewSchema` for the schema this maps to.

## Iteration economics

For every significant production iteration, know: what visible problem is being fixed, what
change is being attempted, why it should materially improve the final output, and what evidence
will tell us whether it worked.

> After two materially unsuccessful attempts to fix the same visible problem using essentially the
> same strategy, reconsider the strategy itself.

Responses to a stuck strategy include: change implementation, use a different tool, use a
different asset, change the shot design, use generated media instead of procedural media, use 2D
instead of 3D (or vice versa), use a mature external/local asset, remove the shot, or hide the
limitation through better cinematography/editing when creatively legitimate. Do not respond
automatically by adding another abstraction layer.

## Architecture-creation threshold

Do not create a new reusable subsystem merely because a current task can be expressed as one. A
new abstraction should normally satisfy at least one of:

1. It immediately simplifies multiple existing production paths.
2. The same problem has already occurred more than once.
3. It substantially reduces future production cost.
4. It isolates genuinely unstable third-party/tool behaviour.
5. It creates a clearly valuable user-facing capability.

An ADR should represent an actual significant architectural decision — not every material
property, prop subtype, visual tweak, or implementation technique. Prefer ordinary documentation
for ordinary implementation details.

## Final test

When uncertain between two approaches, ask:

> Which approach is most likely to produce the better finished marketing video with reasonable
> cost, effort, and iteration time?

Not which approach produces the most reusable abstraction, is most renderer-independent, or
creates the most impressive architecture. Videoer exists to make videos. Its architecture exists
to make that easier.
