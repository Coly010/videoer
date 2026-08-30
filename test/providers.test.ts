import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeImageProvider } from '../src/providers/fake-image.js';
import { ProviderError, ProviderRegistry } from '../src/providers/contracts.js';
import { assetCacheKey, generatedFilename } from '../src/assets/layout.js';
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
});
