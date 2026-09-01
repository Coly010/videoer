import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProductionSoundEffectRecipes } from '../src/audio/sound-effect-presets.js';
import {
  renderSoundEffectRecipe,
  soundEffectRecipeSchema,
  verifySoundEffectRecipe,
} from '../src/audio/sound-effect.js';
import { createProductionSoundEffectLibrary } from '../src/application/sound-effects.js';
import { createSoundEffectAudition } from '../src/application/sound-effect-audition.js';
import { validateLibraryAsset } from '../src/assets/library.js';

describe('procedural sound effects', () => {
  it('defines isolated reusable ambience and foley recipes', () => {
    const recipes = createProductionSoundEffectRecipes();
    expect(recipes.map((entry) => entry.id)).toEqual([
      'audio.sfx.rain-on-stone-ambience',
      'audio.sfx.wooden-door-open',
      'audio.sfx.page-turn-parchment',
      'audio.sfx.footstep-wet-stone',
    ]);
    expect(recipes.every((entry) => entry.metadata.generator === 'videoer.procedural-sfx.v1')).toBe(
      true,
    );
    expect(recipes.every((entry) => entry.layers.length >= 3)).toBe(true);
  });

  it('renders deterministic 24-bit stereo PCM with exact duration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-sfx-test-'));
    const recipe = createProductionSoundEffectRecipes()[2]!;
    const first = join(root, 'first.wav');
    const second = join(root, 'second.wav');
    const result = await renderSoundEffectRecipe(recipe, first);
    await renderSoundEffectRecipe(recipe, second);
    expect(await readFile(first)).toEqual(await readFile(second));
    expect(result).toMatchObject({ sampleRate: 48000, channels: 2, durationSeconds: 0.95 });
    expect(result.peak).toBeCloseTo(10 ** (-5 / 20), 8);
    expect(result.rms).toBeGreaterThan(0.001);
    expect(await verifySoundEffectRecipe(recipe, first)).toMatchObject({
      valid: true,
      deterministic: true,
      pcmBits: 24,
      exactByteLength: true,
    });
  });

  it('rejects invalid filtering and duplicate layer identities', () => {
    const source = createProductionSoundEffectRecipes()[0]!;
    expect(() =>
      soundEffectRecipeSchema.parse({
        ...source,
        layers: [{ ...source.layers[0], lowpassHz: 100 }, { ...source.layers[0] }],
      }),
    ).toThrow();
  });

  it('packages evidence-rich candidates without claiming auditory acceptance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-sfx-library-test-'));
    const result = await createProductionSoundEffectLibrary(root);
    expect(result.assets).toHaveLength(4);
    for (const candidate of result.assets) {
      const asset = candidate.assetFile;
      expect(asset.status).toBe('validated');
      expect(asset.verification.checks).toContain('auditory.generated-not-accepted');
      expect(asset.artifacts.map((entry) => entry.role)).toEqual(
        expect.arrayContaining([
          'sound-effect-recipe',
          'master',
          'waveform',
          'spectrogram',
          'verification-report',
        ]),
      );
      expect(await validateLibraryAsset(asset)).toMatchObject({ valid: true });
    }
  });

  it('creates a deterministic representative mix without claiming auditory acceptance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'videoer-sfx-audition-test-'));
    const candidates = join(root, 'candidates');
    await createProductionSoundEffectLibrary(candidates);
    const result = await createSoundEffectAudition(candidates, join(root, 'audition'));
    expect(result.verification).toMatchObject({
      status: 'technically-validated-awaiting-auditory-review',
      qualitativeStatus: 'not-accepted',
      deterministic: true,
      durationSeconds: 8,
      sampleRate: 48000,
      channels: 2,
    });
    expect(result.verification.sources).toHaveLength(4);
    expect(result.verification.masterSha256).toBe(result.verification.deterministicRerenderSha256);
  }, 20_000);
});
