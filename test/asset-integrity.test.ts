import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditAssetLibrary, repairAssetLibraryFromSources } from '../src/assets/integrity.js';
import { publishAsset, writeHashedAssetMetadata } from '../src/assets/library.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('asset-library integrity recovery', () => {
  it('restores only an exact accepted source byte match without rewriting metadata', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-library-integrity-'));
    const source = join(directory, 'accepted-source');
    const library = join(directory, 'library');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'geometry.json'), '{"accepted":true}\n', 'utf8');
    await writeHashedAssetMetadata(join(source, 'asset.yaml'), {
      schemaVersion: 1,
      id: 'prop.integrity-fixture',
      version: '1.0.0',
      type: 'prop',
      title: 'Integrity fixture',
      description: 'Test-only immutable recovery fixture.',
      status: 'verified',
      tags: ['test'],
      capabilities: ['integrity-test'],
      source: {
        kind: 'procedural',
        generator: 'test',
        references: [],
        licence: {
          spdx: 'LicenseRef-Videoer-Project',
          name: 'Test project asset',
          commercialUse: 'allowed',
          attributionRequired: false,
        },
        clearance: 'approved',
      },
      artifacts: [{ role: 'geometry', path: 'geometry.json', mediaType: 'application/json' }],
      compatibility: { renderers: [], requires: [] },
      verification: { checks: ['test'], artifacts: [], verifiedAt: '2026-09-01T00:00:00Z' },
    });
    const published = await publishAsset(source, library);
    const metadataBefore = await readFile(join(published.target, 'asset.yaml'), 'utf8');
    await writeFile(join(published.target, 'geometry.json'), '{"accepted":false}\n', 'utf8');
    expect((await auditAssetLibrary(library)).valid).toBe(false);
    const repair = await repairAssetLibraryFromSources(library, [source]);
    expect(repair.repaired).toHaveLength(1);
    expect(repair.unresolved).toEqual([]);
    expect(repair.after.valid).toBe(true);
    expect(await readFile(join(published.target, 'geometry.json'), 'utf8')).toBe(
      '{"accepted":true}\n',
    );
    expect(await readFile(join(published.target, 'asset.yaml'), 'utf8')).toBe(metadataBefore);
  });

  it('refuses to treat the library itself as a recovery source', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-library-integrity-source-'));
    await expect(repairAssetLibraryFromSources(directory, [directory])).rejects.toThrow(
      /separate from the library/,
    );
  });

  it('restores formatter-mutated JSON only when canonical bytes match the accepted hash', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-library-integrity-json-'));
    const source = join(directory, 'accepted-source');
    const unrelated = join(directory, 'unrelated-source');
    const library = join(directory, 'library');
    await mkdir(source, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    await writeFile(
      join(source, 'geometry.json'),
      `${JSON.stringify({ points: [[1, 2, 3]], accepted: true }, null, 2)}\n`,
      'utf8',
    );
    await writeHashedAssetMetadata(join(source, 'asset.yaml'), {
      schemaVersion: 1,
      id: 'prop.canonical-json-recovery-fixture',
      version: '1.0.0',
      type: 'prop',
      title: 'Canonical JSON recovery fixture',
      description: 'Test-only canonical byte recovery fixture.',
      status: 'verified',
      tags: ['test'],
      capabilities: ['integrity-test'],
      source: {
        kind: 'procedural',
        generator: 'test',
        references: [],
        licence: {
          spdx: 'LicenseRef-Videoer-Project',
          name: 'Test project asset',
          commercialUse: 'allowed',
          attributionRequired: false,
        },
        clearance: 'approved',
      },
      artifacts: [{ role: 'geometry', path: 'geometry.json', mediaType: 'application/json' }],
      compatibility: { renderers: [], requires: [] },
      verification: { checks: ['test'], artifacts: [], verifiedAt: '2026-09-01T00:00:00Z' },
    });
    const published = await publishAsset(source, library);
    await writeFile(
      join(published.target, 'geometry.json'),
      '{"points": [[1, 2, 3]], "accepted": true}\n',
      'utf8',
    );

    const repair = await repairAssetLibraryFromSources(library, [unrelated]);

    expect(repair.repaired).toHaveLength(1);
    expect(repair.repaired[0]?.recoveredFrom).toMatch(/^canonical-json:/);
    expect(repair.unresolved).toEqual([]);
    expect(repair.after.valid).toBe(true);
    expect(await readFile(join(published.target, 'geometry.json'), 'utf8')).toBe(
      `${JSON.stringify({ points: [[1, 2, 3]], accepted: true }, null, 2)}\n`,
    );
  });
});
