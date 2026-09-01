import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256File } from '../src/assets/library.js';
import {
  createProductionCharacterBinding,
  loadProductionCharacterBinding,
  saveProductionCharacterBinding,
  type ProductionCharacterBindingSource,
} from '../src/characters/production-binding.js';

let directory = '';

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('production-character assembly binding', () => {
  async function fixture() {
    directory = await mkdtemp(join(tmpdir(), 'videoer-production-character-binding-'));
    const files = {
      body: join(directory, 'body.json'),
      rig: join(directory, 'rig-profile.json'),
      skin: join(directory, 'skin.json'),
      hair: join(directory, 'hair.json'),
      dress: join(directory, 'dress.json'),
    };
    await Promise.all(
      Object.entries(files).map(([name, path]) => writeFile(path, `${name}-artifact\n`, 'utf8')),
    );
    const source: ProductionCharacterBindingSource = {
      schemaVersion: 1,
      id: 'character-binding.test-hero',
      character: { id: 'character.test-hero', version: '1.0.0' },
      body: {
        asset: { id: 'character.production-human', version: '1.0.0' },
        artifactRole: 'geometry',
        path: 'body.json',
        sha256: await sha256File(files.body),
      },
      rigProfile: {
        id: 'rig-profile.mpfb-rigify-human-toes',
        version: '0.1.0',
        path: 'rig-profile.json',
        sha256: await sha256File(files.rig),
      },
      materialBindings: [
        {
          targetMaterialId: 'skin',
          material: {
            asset: { id: 'material.test-skin', version: '1.0.0' },
            artifactRole: 'material',
            path: 'skin.json',
            sha256: await sha256File(files.skin),
          },
        },
      ],
      hair: {
        asset: { id: 'hair.test-style', version: '1.0.0' },
        artifactRole: 'geometry',
        path: 'hair.json',
        sha256: await sha256File(files.hair),
        binding: 'canonical-head-v1',
      },
      wardrobe: [
        {
          asset: { id: 'clothing.test-dress', version: '1.0.0' },
          artifactRole: 'geometry',
          path: 'dress.json',
          sha256: await sha256File(files.dress),
          binding: 'full-rig-weight-transfer-v1',
        },
      ],
      compatibility: {
        canonicalSkeleton: 'videoer.canonical-humanoid-52',
        bodyTopology: 'makehuman-hm08-cc0-derived-v1',
      },
      qualityTier: 'medium',
    };
    const bindingFile = join(directory, 'production-character.json');
    await saveProductionCharacterBinding(bindingFile, source);
    return { files, source, bindingFile };
  }

  it('persists and verifies every assembly input by exact content', async () => {
    const { bindingFile } = await fixture();
    const binding = await loadProductionCharacterBinding(bindingFile);
    expect(binding).toMatchObject({
      id: 'character-binding.test-hero',
      character: { id: 'character.test-hero', version: '1.0.0' },
      derivation: {
        kind: 'production-character-assembly-v1',
        generator: 'videoer.production-character-binding.v1',
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      materialBindings: [{ targetMaterialId: 'skin' }],
      hair: { binding: 'canonical-head-v1' },
      wardrobe: [{ binding: 'full-rig-weight-transfer-v1' }],
    });
  });

  it('rejects changed component bytes and a rewritten derivation declaration', async () => {
    const { files, source, bindingFile } = await fixture();
    await writeFile(files.hair, 'changed-hair-artifact\n', 'utf8');
    await expect(loadProductionCharacterBinding(bindingFile)).rejects.toThrow(
      'hair artifact hash mismatch',
    );

    await writeFile(files.hair, 'hair-artifact\n', 'utf8');
    const rewritten = JSON.parse(await readFile(bindingFile, 'utf8'));
    rewritten.qualityTier = 'hero';
    await writeFile(bindingFile, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8');
    await expect(loadProductionCharacterBinding(bindingFile)).rejects.toThrow(
      'binding input digest mismatch',
    );
    expect(createProductionCharacterBinding(source).qualityTier).toBe('medium');
  });

  it('rejects wrong asset domains, duplicate slots, and absolute artifact paths', async () => {
    const { source } = await fixture();
    expect(() =>
      createProductionCharacterBinding({
        ...source,
        body: { ...source.body, path: join(directory, 'body.json') },
      }),
    ).toThrow('must be relative');
    expect(() =>
      createProductionCharacterBinding({
        ...source,
        hair: source.hair
          ? { ...source.hair, asset: { id: 'prop.not-hair', version: '1.0.0' } }
          : undefined,
      }),
    ).toThrow('must reference a hair asset');
    expect(() =>
      createProductionCharacterBinding({
        ...source,
        materialBindings: [source.materialBindings[0]!, source.materialBindings[0]!],
      }),
    ).toThrow('material targets must be unique');
  });
});
