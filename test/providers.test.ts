import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeImageProvider } from '../src/providers/fake-image.js';
import { ProviderError, ProviderRegistry } from '../src/providers/contracts.js';
import { assetCacheKey, generatedFilename } from '../src/assets/layout.js';
import { generateSceneKeyframes, regenerateSceneKeyframe } from '../src/application/generation.js';
import { loadCampaignState } from '../src/domain/state.js';
import { loadStoryboard, saveStoryboard } from '../src/domain/io.js';
import { storyboardSchema } from '../src/domain/schemas.js';
let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
describe('providers and assets', () => {
  it('fake provider writes deterministic local output', async () => {
    dir = await mkdtemp(join(tmpdir(), 'videoer-'));
    const path = join(dir, 'shot.txt');
    const a = await new FakeImageProvider().generate({
      prompt: 'castle',
      outputPath: path,
      width: 1080,
      height: 1920,
    });
    expect(await readFile(path, 'utf8')).toContain('castle');
    expect(a.metadata.fake).toBe(true);
  });
  it('creates stable keys and revisioned names', () => {
    expect(assetCacheKey({ a: 1 })).toBe(assetCacheKey({ a: 1 }));
    expect(generatedFilename('s1', 'image', 2, '.png')).toBe('s1.image.r2.png');
  });
  it('resolves capabilities explicitly and reports missing providers', () => {
    const registry = new ProviderRegistry().registerImage(new FakeImageProvider());
    expect(registry.image('fake').capabilities).toContain('image');
    expect(registry.has('image', 'fake')).toBe(true);
    expect(() => registry.voice('missing')).toThrow(ProviderError);
  });
  it('generates related scene keyframes, caches them, and selectively regenerates one', async () => {
    dir = await mkdtemp(join(tmpdir(), 'videoer-scene-'));
    await cp(resolve('campaigns/examples/cinematic-book'), dir, { recursive: true });
    const storyboardPath = join(dir, 'storyboard.json');
    const original = await loadStoryboard(storyboardPath);
    await saveStoryboard(
      storyboardPath,
      storyboardSchema.parse({
        ...original,
        shots: [
          {
            id: 'ritual',
            type: 'scene-keyframes',
            startSeconds: 0,
            durationSeconds: original.durationSeconds,
            prompt: 'A mage summons black fire in one continuous street scene',
            keyframes: [
              { id: 'anchor', role: 'anchor', timeOffset: 0, description: 'The mage sees smoke' },
              {
                id: 'flare',
                role: 'continuation',
                timeOffset: 6,
                description: 'Black fire reaches the staff',
              },
              {
                id: 'reveal',
                role: 'reveal',
                timeOffset: 12,
                description: 'A creature emerges behind the mage',
              },
            ],
          },
        ],
      }),
    );
    const campaign = join(dir, 'campaign.yaml');
    const provider = new FakeImageProvider();
    const first = await generateSceneKeyframes(campaign, provider);
    expect(first.generated.map((item) => item.cached)).toEqual([false, false, false]);
    const generatedStoryboard = await loadStoryboard(storyboardPath);
    const shot = generatedStoryboard.shots[0]!;
    expect(shot.type).toBe('scene-keyframes');
    if (shot.type !== 'scene-keyframes') throw new Error('expected scene-keyframes');
    expect(shot.keyframes.map((keyframe) => keyframe.assetPath)).toEqual([
      'generated/images/ritual/anchor.r0.png',
      'generated/images/ritual/flare.r0.png',
      'generated/images/ritual/reveal.r0.png',
    ]);
    expect(await readFile(join(dir, shot.keyframes[1]!.assetPath!), 'utf8')).toContain(
      'SAME continuous shot',
    );
    const second = await generateSceneKeyframes(campaign, provider);
    expect(second.generated.every((item) => item.cached)).toBe(true);
    await regenerateSceneKeyframe(campaign, provider, 'ritual', 'flare');
    const revised = await loadStoryboard(storyboardPath);
    const revisedShot = revised.shots[0]!;
    if (revisedShot.type !== 'scene-keyframes') throw new Error('expected scene-keyframes');
    expect(revisedShot.keyframes.map((keyframe) => keyframe.generation.revision)).toEqual([
      0, 1, 0,
    ]);
    expect(revisedShot.keyframes[1]!.assetPath).toBe('generated/images/ritual/flare.r1.png');
    expect(
      (await loadCampaignState(join(dir, 'campaign-state.json'))).generatedAssets,
    ).toHaveLength(4);
  });
});
