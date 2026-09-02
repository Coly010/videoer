# Goal: Create a Cinematic Trailer for _The Rise of Demons_

Create a polished **15-second vertical cinematic book trailer** for my fantasy novel **The Rise of Demons** using the marketing-video system in this repository.

Treat this as a real production run, not a renderer demo.

You are responsible for taking the campaign from initial creative direction through storyboard, asset generation, rendering, inspection, iteration, and final output.

## Primary Goal

Produce a trailer that could realistically be posted to TikTok, Instagram Reels, or YouTube Shorts to advertise _The Rise of Demons_.

The finished video should feel:

- dark
- cinematic
- ominous
- epic
- mysterious
- high fantasy rather than generic horror

It should create curiosity about the story rather than attempt to explain the whole plot.

The viewer should come away with the impression that:

> something ancient and terrifying has returned, and the people of Onaem are badly unprepared for what is coming.

## Book Context

_The Rise of Demons_ is the first book of **The Dark War Trilogy**.

The setting is the fantasy world of **Onaem**.

Important elements you may use visually include:

- medieval / high-fantasy cities and landscapes
- mages and magical conflict
- dark forests
- castles
- forbidden or corrupted magic
- fire and black fire
- a growing demonic threat
- an increasingly apocalyptic sense that something long gone is returning

The story builds toward the return of **Mordeutzel**, an enormous demonic figure approximately 40 feet tall when fully manifested.

Do not make the trailer look like modern urban fantasy, steampunk, anime, or a generic Dungeons & Dragons advert.

Do not invent major plot claims simply because they sound dramatic.

Prefer atmosphere, implication, imagery, and short marketing copy over plot exposition.

## Canon Grounding / Defined Terms

The following invented names are part of the book’s canon. Do not guess at them loosely or reinterpret them into unrelated fantasy tropes.

- **Onaem**: the fantasy world in which the story takes place.
- **Dolgrim**: demons. They are a real demonic threat within the story world.
- **Mordeutzel**: a powerful demonic entity and major threat. At full manifestation, he is enormous — roughly 40 feet tall. He should feel ancient, terrifying, powerful, and mythic rather than campy or cartoonish.
- **Daerites**: human followers aligned with the dark side of the conflict and associated with the demonic threat. They are not monsters or undead. Visually, they should read as dark-fantasy human antagonists / cult-aligned or militant followers, not generic zombies.
- **Black fire**: a corrupted or unnatural magical fire. It should feel dark, magical, and threatening rather than like ordinary orange flame.

If you use these concepts visually, keep them coherent with this guidance.

## Creative Direction

Aim for something resembling a compact cinematic teaser trailer.

A possible emotional progression is:

**unease → discovery → escalation → demonic reveal → book reveal**

Do not feel required to follow that structure exactly if you can devise something stronger.

Potential imagery might include things such as:

- an apparently peaceful fantasy landscape with something subtly wrong
- a lone mage or traveller moving through rain, fog, ruined streets, woodland, or firelight
- evidence that dark magic has been used
- distant conflict, dark followers, or signs of organised threat
- a brief glimpse of something enormous emerging through smoke, fire, darkness, or magical energy
- the final book cover / title reveal

Avoid trying to show too much.

Four or five excellent visual beats are preferable to eight mediocre ones.

## Copy / Narration

Keep spoken or on-screen copy extremely concise.

This is a trailer, not a synopsis.

You may write the trailer copy yourself.

A direction such as:

> They thought the demons were gone.

followed by escalating imagery would be appropriate, but do not treat that exact sentence as mandatory.

The final title reveal must clearly communicate:

**THE RISE OF DEMONS**

Also include:

**By Colum Ferry**

Do not bury the video beneath captions. Let the visuals breathe.

## CTA

The trailer should end with a simple, readable CTA.

Use the following CTA logic:

- If an exact, clean, real book link is available in the campaign assets or session context, use it on the final frame.
- If no clean link is available, use: **Available now on Amazon**
- Do not invent, guess, or hallucinate a URL.

Keep the CTA visually restrained and readable. The final frame should primarily feature:

- book title
- author name
- CTA
- book cover if available

## Visual Generation

Use the repository's existing image-generation/provider system.

Where recurring people, creatures, places, costume language, architecture, or visual motifs appear across shots, make a deliberate effort to maintain visual continuity.

Generated images should be designed specifically for **9:16 vertical composition** and should leave appropriate space where typography will appear.

Use cinematic still-image motion wherever it works well.

Use real image-to-video generation only if the system currently supports it and you judge that it materially improves a shot.

Do not introduce external paid services merely to complete this test.

## Motion

The finished piece should not look like a slideshow of AI images.

Use restrained cinematic movement such as:

- slow push-ins
- tracking
- parallax
- atmospheric movement
- particles
- embers
- fog
- rain
- light flicker
- subtle shake
- depth
- transitions motivated by light, darkness, smoke, movement, or sound

Avoid excessive zooming and cheesy preset transitions.

Motion should support the illusion that these are moments from a larger film.

## Sound

Use suitable music and sound design available through the project.

Audio is important to this test.

Build toward the reveal rather than using a flat music bed.

Where useful, include subtle effects such as:

- distant impact
- low rumble
- fire
- wind
- magical energy
- transition hits
- demonic or environmental texture

If narration is supported and produces a better trailer, use it.

Balance narration, music, and effects properly.

## Book Cover / Reference Assets

Inspect the available campaign assets and any reference materials supplied in the current Codex session.

Use relevant supplied references rather than regenerating things unnecessarily.

If a book cover is available, use the actual supplied cover for the final reveal rather than attempting to recreate it.

Copy session-provided assets into the appropriate campaign asset structure where necessary so the campaign remains reproducible.

## Campaign

Create an appropriate campaign for this trailer, following the repository's established conventions.

Suggested identity:

`rise-of-demons-cinematic-trailer`

Target:

- duration: approximately 15 seconds
- aspect ratio: 9:16
- resolution: 1080 × 1920
- frame rate: 30fps
- output: H.264 MP4 with AAC audio
- style/template: cinematic fantasy

Persist the storyboard and campaign configuration so individual shots can later be regenerated without rebuilding the entire campaign.

## Quality Loop

Do not stop simply because the first render completes successfully.

Use the inspection and verification capabilities built into the repository.

After creating the storyboard:

1. inspect whether the sequence actually tells a coherent 15-second visual story
2. inspect generated visual assets
3. reject or regenerate visibly weak assets before final rendering

After rendering:

1. inspect representative frames and/or the rendered video using the available verification tooling
2. check composition, continuity, text readability, timing, transitions, audio balance, image quality, and overall cinematic coherence
3. identify shots or elements that materially weaken the result
4. regenerate or adjust those individual elements
5. render again
6. repeat where justified

Do not chase microscopic imperfections indefinitely.

The goal is a strong social-media trailer, not mathematical perfection.

## Things to Actively Reject

Regenerate or repair assets containing obvious problems such as:

- malformed faces or bodies
- accidental duplicate people
- nonsensical weapons
- broken architecture
- unreadable generated text
- wildly inconsistent character appearance
- obvious visual-style changes between adjacent shots
- imagery that looks cartoonish when the rest is cinematic
- badly cropped subjects
- title or captions obscured by composition
- bland imagery that lacks a clear focal point
- motion that exposes the underlying still-image trick
- abrupt or amateur-looking transitions
- audio clipping or dialogue buried beneath music

## Creative Autonomy

You have permission to make creative decisions required to achieve the goal.

Do not ask me to approve every storyboard or shot.

Use the repository, its documentation, available assets, existing ADRs, campaign conventions, and verification tooling to determine the correct workflow.

If an implementation bug prevents you from completing the trailer and the fix is reasonably within scope, fix it, verify the fix, and continue production.

Do not weaken the output merely to work around an obvious defect in the tool.

## Deliverables

At completion I should have:

- the campaign configuration
- the final storyboard
- generated source assets
- any narration/audio used
- the final rendered MP4
- inspection/verification artifacts produced by the system
- a concise record of any shots you regenerated and why

Most importantly:

**Produce the actual final trailer.**

Success is not that the pipeline ran.

Success is that the resulting 15-second video feels like a convincing cinematic advertisement for _The Rise of Demons_.
