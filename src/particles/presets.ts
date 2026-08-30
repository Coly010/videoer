import type { ParticleEmitter } from './engine.js';

export const particlePresetNames = [
  'embers',
  'sparks',
  'ash',
  'dust',
  'floating-motes',
  'snow',
  'rain',
  'fireflies',
  'magical-particles',
  'debris',
  'confetti',
  'sparkle',
  'bokeh',
  'subtle-accent-particles',
] as const;
export type ParticlePresetName = (typeof particlePresetNames)[number];
export interface ResolvedParticlePreset {
  name: ParticlePresetName;
  emitters: ParticleEmitter[];
}

const fade = [
  { at: 0, value: 0 },
  { at: 0.12, value: 1 },
  { at: 0.78, value: 0.8 },
  { at: 1, value: 0 },
];
const swell = [
  { at: 0, value: 0.25 },
  { at: 0.3, value: 1 },
  { at: 1, value: 0.45 },
];
const base = (overrides: Partial<ParticleEmitter> = {}): ParticleEmitter => ({
  spawnRate: 18,
  maxParticles: 90,
  region: { type: 'full-frame' },
  particle: {
    lifetime: { min: 2, max: 4 },
    size: { min: 3, max: 8 },
    opacity: { min: 0.35, max: 0.9 },
    color: '#ffffff',
  },
  physics: { velocityY: { min: -22, max: -8 }, turbulence: 5, drag: 0.08 },
  evolution: { opacity: fade, scale: swell },
  ...overrides,
});

const definitions: Record<ParticlePresetName, ParticleEmitter[]> = {
  embers: [
    base({
      spawnRate: 20,
      maxParticles: 80,
      region: { type: 'box', x: 0, y: 0.55, width: 1, height: 0.5 },
      particle: {
        lifetime: { min: 2.2, max: 4.5 },
        size: { min: 2, max: 6 },
        opacity: { min: 0.5, max: 1 },
        color: '#ff7b22',
        glow: 8,
      },
      physics: {
        velocityX: { min: -8, max: 14 },
        velocityY: { min: -70, max: -20 },
        turbulence: 12,
        drag: 0.08,
      },
      evolution: { opacity: fade, scale: swell },
    }),
    base({
      spawnRate: 7,
      maxParticles: 24,
      region: { type: 'edge', edge: 'bottom' },
      particle: {
        lifetime: { min: 1.4, max: 3 },
        size: { min: 7, max: 15 },
        opacity: { min: 0.25, max: 0.6 },
        color: '#ffb248',
        blur: 2,
        glow: 12,
      },
      physics: {
        velocityX: { min: -18, max: 24 },
        velocityY: { min: -110, max: -45 },
        turbulence: 18,
      },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  sparks: [
    base({
      spawnRate: 28,
      maxParticles: 100,
      burst: 16,
      region: { type: 'point', x: 0.5, y: 0.58 },
      particle: {
        lifetime: { min: 0.45, max: 1.1 },
        size: { min: 2, max: 5 },
        opacity: { min: 0.7, max: 1 },
        color: '#ffe3a1',
        glow: 7,
        shape: 'streak',
      },
      physics: {
        velocityX: { min: -160, max: 160 },
        velocityY: { min: -180, max: 20 },
        gravity: 190,
        drag: 0.3,
      },
      evolution: {
        opacity: fade,
        scale: [
          { at: 0, value: 1 },
          { at: 1, value: 0.15 },
        ],
      },
    }),
  ],
  ash: [
    base({
      spawnRate: 12,
      maxParticles: 60,
      particle: {
        lifetime: { min: 4, max: 7 },
        size: { min: 3, max: 9 },
        opacity: { min: 0.18, max: 0.45 },
        color: '#b8b0a8',
        blur: 0.8,
      },
      physics: {
        velocityX: { min: -10, max: 15 },
        velocityY: { min: -14, max: 8 },
        turbulence: 15,
      },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  dust: [
    base({
      spawnRate: 8,
      maxParticles: 45,
      particle: {
        lifetime: { min: 5, max: 9 },
        size: { min: 4, max: 12 },
        opacity: { min: 0.08, max: 0.3 },
        color: '#ddcaa5',
        blur: 1.5,
      },
      physics: { velocityX: { min: -4, max: 9 }, velocityY: { min: -6, max: 2 }, turbulence: 6 },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  'floating-motes': [
    base({
      spawnRate: 10,
      maxParticles: 55,
      particle: {
        lifetime: { min: 4, max: 8 },
        size: { min: 3, max: 10 },
        opacity: { min: 0.15, max: 0.6 },
        color: '#fff4c7',
        glow: 5,
      },
      physics: { velocityX: { min: -8, max: 8 }, velocityY: { min: -10, max: 4 }, turbulence: 10 },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  snow: [
    base({
      spawnRate: 30,
      maxParticles: 180,
      region: { type: 'edge', edge: 'top' },
      particle: {
        lifetime: { min: 4, max: 7 },
        size: { min: 3, max: 9 },
        opacity: { min: 0.4, max: 0.9 },
        color: '#f4f8ff',
        blur: 0.5,
      },
      physics: {
        velocityX: { min: -18, max: 18 },
        velocityY: { min: 70, max: 125 },
        turbulence: 18,
      },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  rain: [
    base({
      spawnRate: 90,
      maxParticles: 260,
      region: { type: 'edge', edge: 'top' },
      particle: {
        lifetime: { min: 0.9, max: 1.5 },
        size: { min: 9, max: 18 },
        opacity: { min: 0.25, max: 0.6 },
        color: '#a9c9e8',
        shape: 'streak',
      },
      physics: { velocityX: { min: -55, max: -35 }, velocityY: { min: 650, max: 850 } },
      evolution: {
        opacity: [
          { at: 0, value: 0 },
          { at: 0.05, value: 1 },
          { at: 0.95, value: 1 },
          { at: 1, value: 0 },
        ],
        scale: [
          { at: 0, value: 1 },
          { at: 1, value: 1 },
        ],
      },
    }),
  ],
  fireflies: [
    base({
      spawnRate: 5,
      maxParticles: 28,
      particle: {
        lifetime: { min: 4, max: 8 },
        size: { min: 5, max: 12 },
        opacity: { min: 0.5, max: 1 },
        color: '#d9ff72',
        glow: 14,
      },
      physics: {
        velocityX: { min: -15, max: 15 },
        velocityY: { min: -12, max: 12 },
        turbulence: 20,
      },
      evolution: {
        opacity: [
          { at: 0, value: 0 },
          { at: 0.2, value: 1 },
          { at: 0.5, value: 0.35 },
          { at: 0.75, value: 1 },
          { at: 1, value: 0 },
        ],
        scale: swell,
      },
    }),
  ],
  'magical-particles': [
    base({
      spawnRate: 24,
      maxParticles: 110,
      burst: 8,
      region: { type: 'circle', x: 0.5, y: 0.5, radius: 0.32 },
      particle: {
        lifetime: { min: 1.8, max: 3.8 },
        size: { min: 3, max: 10 },
        opacity: { min: 0.45, max: 1 },
        color: '#b78cff',
        glow: 16,
      },
      physics: {
        velocityX: { min: -18, max: 18 },
        velocityY: { min: -32, max: 12 },
        turbulence: 18,
      },
      evolution: {
        opacity: fade,
        scale: [
          { at: 0, value: 0 },
          { at: 0.35, value: 1.25 },
          { at: 1, value: 0 },
        ],
      },
    }),
  ],
  debris: [
    base({
      spawnRate: 10,
      maxParticles: 44,
      burst: 18,
      region: { type: 'point', x: 0.5, y: 0.7 },
      particle: {
        lifetime: { min: 1.4, max: 2.8 },
        size: { min: 5, max: 14 },
        opacity: { min: 0.4, max: 0.85 },
        rotation: { min: 0, max: 6.28 },
        color: '#6f6257',
        shape: 'square',
      },
      physics: {
        velocityX: { min: -120, max: 120 },
        velocityY: { min: -180, max: -40 },
        gravity: 220,
        angularVelocity: { min: -5, max: 5 },
      },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  confetti: [
    base({
      spawnRate: 36,
      maxParticles: 150,
      burst: 30,
      region: { type: 'edge', edge: 'top' },
      particle: {
        lifetime: { min: 2.5, max: 5 },
        size: { min: 7, max: 15 },
        opacity: { min: 0.65, max: 1 },
        rotation: { min: 0, max: 6.28 },
        color: '#7c5cff',
        shape: 'square',
      },
      physics: {
        velocityX: { min: -60, max: 60 },
        velocityY: { min: 100, max: 210 },
        turbulence: 35,
        angularVelocity: { min: -7, max: 7 },
      },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  sparkle: [
    base({
      spawnRate: 12,
      maxParticles: 60,
      particle: {
        lifetime: { min: 0.6, max: 1.5 },
        size: { min: 3, max: 11 },
        opacity: { min: 0.6, max: 1 },
        color: '#ffffff',
        glow: 12,
      },
      physics: { turbulence: 2 },
      evolution: {
        opacity: [
          { at: 0, value: 0 },
          { at: 0.35, value: 1 },
          { at: 0.6, value: 0.25 },
          { at: 1, value: 0 },
        ],
        scale: swell,
      },
    }),
  ],
  bokeh: [
    base({
      spawnRate: 4,
      maxParticles: 24,
      particle: {
        lifetime: { min: 5, max: 9 },
        size: { min: 25, max: 70 },
        opacity: { min: 0.05, max: 0.18 },
        color: '#ffd4a4',
        blur: 5,
      },
      physics: { velocityX: { min: -8, max: 8 }, velocityY: { min: -10, max: 2 } },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
  'subtle-accent-particles': [
    base({
      spawnRate: 7,
      maxParticles: 36,
      particle: {
        lifetime: { min: 3, max: 6 },
        size: { min: 3, max: 8 },
        opacity: { min: 0.18, max: 0.5 },
        color: '#8d72ff',
        glow: 5,
      },
      physics: { velocityX: { min: -6, max: 6 }, velocityY: { min: -12, max: 0 }, turbulence: 7 },
      evolution: { opacity: fade, scale: swell },
    }),
  ],
};

export function resolveParticlePreset(
  name: string,
  params: Record<string, unknown> = {},
): ResolvedParticlePreset {
  if (!particlePresetNames.includes(name as ParticlePresetName))
    throw new Error(`Unknown particle preset '${name}'`);
  if (params.intensity !== undefined && typeof params.intensity !== 'number')
    throw new Error(`Particle preset '${name}' parameter 'intensity' must be a number`);
  if (params.wind !== undefined && typeof params.wind !== 'number')
    throw new Error(`Particle preset '${name}' parameter 'wind' must be a number`);
  if (params.color !== undefined && typeof params.color !== 'string')
    throw new Error(`Particle preset '${name}' parameter 'color' must be a string`);
  const intensity =
    typeof params.intensity === 'number' ? Math.max(0, Math.min(2, params.intensity)) : 1;
  const wind = typeof params.wind === 'number' ? params.wind : 0;
  const color = typeof params.color === 'string' ? params.color : undefined;
  return {
    name: name as ParticlePresetName,
    emitters: definitions[name as ParticlePresetName].map((emitter) => ({
      ...emitter,
      spawnRate: emitter.spawnRate * intensity,
      maxParticles: Math.ceil(emitter.maxParticles * Math.max(0.25, intensity)),
      particle: { ...emitter.particle, ...(color ? { color } : {}) },
      physics: {
        ...emitter.physics,
        velocityX:
          typeof emitter.physics.velocityX === 'number'
            ? emitter.physics.velocityX + wind * 40
            : emitter.physics.velocityX
              ? {
                  min: emitter.physics.velocityX.min + wind * 40,
                  max: emitter.physics.velocityX.max + wind * 40,
                }
              : wind * 40,
      },
    })),
  };
}
