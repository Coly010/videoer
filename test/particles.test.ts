import { describe, expect, it } from 'vitest';
import {
  evaluateCurve,
  particlesAt,
  seededRandom,
  spawnPosition,
  type ParticleEmitter,
} from '../src/particles/engine.js';
import { particlePresetNames, resolveParticlePreset } from '../src/particles/presets.js';

const emitter: ParticleEmitter = {
  spawnRate: 10,
  maxParticles: 5,
  region: { type: 'box', x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
  particle: { lifetime: 2, size: 10, opacity: 1, color: '#fff' },
  physics: { velocityX: 10, velocityY: -20, gravity: 5 },
  evolution: {
    opacity: [
      { at: 0, value: 0 },
      { at: 0.5, value: 1 },
      { at: 1, value: 0 },
    ],
    scale: [
      { at: 0, value: 0.5 },
      { at: 1, value: 1.5 },
    ],
  },
};

describe('particle engine', () => {
  it('is seeded and deterministic at a frame', () => {
    expect(particlesAt(emitter, 'same', 1, 100, 200)).toEqual(
      particlesAt(emitter, 'same', 1, 100, 200),
    );
    expect(seededRandom(1, 2, 3)).not.toBe(seededRandom(2, 2, 3));
  });
  it('bounds the active pool and continues after old particles die', () => {
    expect(particlesAt(emitter, 1, 1, 100, 200).length).toBeLessThanOrEqual(5);
    expect(particlesAt(emitter, 1, 8, 100, 200).length).toBeGreaterThan(0);
    expect(particlesAt(emitter, 1, 8, 100, 200).length).toBeLessThanOrEqual(5);
  });
  it('applies lifetime cleanup and opacity/scale evolution', () => {
    const burst = { ...emitter, spawnRate: 0, maxParticles: 1, burst: 1 };
    expect(particlesAt(burst, 1, 0.1, 100, 100)[0]!.opacity).toBeCloseTo(0.1);
    expect(particlesAt(burst, 1, 1, 100, 100)[0]!.size).toBe(10);
    expect(particlesAt(burst, 1, 2, 100, 100)).toEqual([]);
    expect(
      evaluateCurve(
        [
          { at: 0, value: 0 },
          { at: 1, value: 10 },
        ],
        0.25,
      ),
    ).toBe(2.5);
  });
  it('supports point, line, box, circle, edge, and full-frame emitters', () => {
    expect(spawnPosition({ type: 'point', x: 0.5, y: 0.25 }, 0, 0, 100, 200)).toEqual({
      x: 50,
      y: 50,
    });
    expect(spawnPosition({ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, 0.5, 0, 100, 200)).toEqual({
      x: 50,
      y: 100,
    });
    expect(
      spawnPosition({ type: 'box', x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 0.5, 0.5, 100, 200),
    ).toEqual({ x: 45, y: 90 });
    expect(spawnPosition({ type: 'circle', x: 0.5, y: 0.5, radius: 0.1 }, 0, 1, 100, 100)).toEqual({
      x: 60,
      y: 50,
    });
    expect(spawnPosition({ type: 'edge', edge: 'top' }, 0.4, 0.7, 100, 200)).toEqual({
      x: 40,
      y: 0,
    });
    expect(spawnPosition({ type: 'full-frame' }, 0.4, 0.7, 100, 200)).toEqual({ x: 40, y: 140 });
  });
  it('resolves every data-driven preset and parameter override', () => {
    for (const name of particlePresetNames)
      expect(resolveParticlePreset(name).emitters.length).toBeGreaterThan(0);
    const normal = resolveParticlePreset('embers').emitters[0]!;
    const custom = resolveParticlePreset('embers', { intensity: 0.5, wind: 1, color: '#00ff00' })
      .emitters[0]!;
    expect(custom.spawnRate).toBe(normal.spawnRate / 2);
    expect(custom.particle.color).toBe('#00ff00');
    expect(() => resolveParticlePreset('missing')).toThrow(/Unknown particle preset/);
    expect(() => resolveParticlePreset('embers', { intensity: 'lots' })).toThrow(
      /must be a number/,
    );
  });
});
