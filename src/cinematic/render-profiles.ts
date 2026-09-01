import { cinematicRenderProfileSchema } from './model.js';

export const deterministicRenderProfileNames = [
  'standard',
  'production-clean',
  'hero-clean',
] as const;
export type DeterministicRenderProfileName = (typeof deterministicRenderProfileNames)[number];

/** Stable named policies keep campaign files from inventing machine-specific quality settings. */
export function createDeterministicRenderProfile(name: DeterministicRenderProfileName) {
  const profile = {
    standard: { samples: 64, denoise: false },
    'production-clean': { samples: 128, denoise: true },
    'hero-clean': { samples: 256, denoise: true },
  }[name];
  return cinematicRenderProfileSchema.parse({
    engine: 'cycles-cpu',
    seed: 1729,
    intent: 'deterministic-final',
    ...profile,
  });
}
