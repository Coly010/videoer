# Deterministic particle system

The particle engine is a pure, renderer-independent calculation in `src/particles/engine.ts`. Given the same emitter, seed, time, width, and height it returns the same bounded particle states. Rendering never calls `Math.random()`.

An emitter defines a spawn rate, maximum pool size, optional burst and time window, spawn region, particle ranges, analytic physics, and lifetime evolution curves. Point, line, box, circle, edge, and full-frame regions are supported. Physics includes velocity, acceleration, gravity, drag, turbulence, and angular velocity. Opacity, scale, and rotation can evolve over life. Particles fade to zero before cleanup in the supplied presets, avoiding visible end-of-life popping.

Presets in `src/particles/presets.ts` are data-first emitter configurations. The library includes embers, sparks, ash, dust, floating motes, snow, rain, fireflies, magical particles, debris, confetti, sparkle, bokeh, and subtle accent particles. A preset may contain multiple emitters, as `embers` does for background and foreground depth. Callers normally set only `intensity`, `wind`, and `color`; bad parameter types fail validation.

The active pool is bounded by `maxParticles`. Old deterministic spawn IDs roll out as new particles enter, so long-running emitters continue without accumulating objects. PixiJS draws all particles for one layer into one `Graphics` command buffer and one canvas, rather than creating React elements per particle.
