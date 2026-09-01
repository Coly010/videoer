import { describe, expect, it } from 'vitest';
import {
  createDeterministicRenderProfile,
  deterministicRenderProfileNames,
} from '../src/cinematic/render-profiles.js';

describe('deterministic cinematic render profiles', () => {
  it('provides stable final-quality policies instead of machine-specific campaign settings', () => {
    expect(deterministicRenderProfileNames).toEqual(['standard', 'production-clean', 'hero-clean']);
    expect(createDeterministicRenderProfile('standard')).toMatchObject({
      engine: 'cycles-cpu',
      samples: 64,
      denoise: false,
      seed: 1729,
      intent: 'deterministic-final',
    });
    expect(createDeterministicRenderProfile('production-clean')).toMatchObject({
      samples: 128,
      denoise: true,
    });
    expect(createDeterministicRenderProfile('hero-clean')).toMatchObject({
      samples: 256,
      denoise: true,
    });
  });
});
