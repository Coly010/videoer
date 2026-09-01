import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import {
  buildAssetIndex,
  deprecateAsset,
  loadAssetMetadata,
  publishAsset,
  searchAssetLibrary,
  validateLibraryAsset,
  writeHashedAssetMetadata,
} from '../src/assets/library.js';
import { resolveProductionAssets } from '../src/application/production.js';
import { productionPlanSchema } from '../src/production/model.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

async function createAsset(
  root: string,
  input: {
    id: string;
    type: 'environment' | 'prop';
    capabilities: string[];
    commercialUse?: 'allowed' | 'restricted' | 'unknown';
    version?: string;
  },
) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'asset.glb'), 'fixture', 'utf8');
  await writeFile(join(root, 'undeclared.tmp'), 'must not publish', 'utf8');
  await writeHashedAssetMetadata(join(root, 'asset.yaml'), {
    schemaVersion: 1,
    id: input.id,
    version: input.version ?? '1.0.0',
    type: input.type,
    title: input.id,
    description: 'A reusable wet medieval street and wooden door production asset',
    status: 'verified',
    tags: ['medieval', 'wet', input.type],
    capabilities: input.capabilities,
    source: {
      kind: 'self-authored',
      references: [],
      licence: {
        spdx: 'CC0-1.0',
        name: 'Creative Commons Zero v1.0',
        commercialUse: input.commercialUse ?? 'allowed',
        attributionRequired: false,
      },
      clearance: 'approved',
    },
    artifacts: [{ role: 'model', path: 'asset.glb', mediaType: 'model/gltf-binary' }],
    compatibility: { renderers: ['three', 'blender'], requires: [] },
    verification: {
      checks: ['geometry.valid'],
      artifacts: [],
      verifiedAt: '2026-08-30T12:00:00.000Z',
    },
  });
}

describe('production domain and shared asset library', () => {
  it('rejects verified releases without hashes or hashed evidence declarations', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-library-integrity-'));
    const source = join(directory, 'source');
    await createAsset(source, {
      id: 'environment.integrity-fixture',
      type: 'environment',
      capabilities: ['deterministic'],
    });
    const metadataFile = join(source, 'asset.yaml');
    const raw = YAML.parse(await readFile(metadataFile, 'utf8'));
    delete raw.artifacts[0].sha256;
    await writeFile(metadataFile, YAML.stringify(raw), 'utf8');
    await expect(
      validateLibraryAsset(await loadAssetMetadata(metadataFile)),
    ).resolves.toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/lacks SHA-256/)],
    });

    raw.artifacts[0].sha256 = createHash('sha256').update('fixture').digest('hex');
    raw.verification.artifacts = ['verification/report.json'];
    await mkdir(join(source, 'verification'), { recursive: true });
    await writeFile(join(source, 'verification/report.json'), '{}', 'utf8');
    await writeFile(metadataFile, YAML.stringify(raw), 'utf8');
    await expect(
      validateLibraryAsset(await loadAssetMetadata(metadataFile)),
    ).resolves.toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/evidence lacks a hashed artifact declaration/)],
    });
  });

  it('rejects references to nonexistent production shots and requirements', () => {
    expect(() =>
      productionPlanSchema.parse({
        schemaVersion: 1,
        campaignId: 'benchmark',
        title: 'Benchmark',
        summary: 'Exercise continuity and interaction.',
        shots: [
          {
            id: 'exterior',
            purpose: 'Establish the street',
            durationSeconds: 2,
            requirements: ['missing'],
          },
        ],
        requirements: [
          {
            id: 'street',
            type: 'environment',
            description: 'Wet medieval street',
            requiredShots: ['unknown-shot'],
          },
        ],
      }),
    ).toThrow(/unknown shot id|unknown requirement id/);
  });

  it('validates, searches, publishes, and indexes immutable cleared assets', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-library-'));
    const source = join(directory, 'source');
    const library = join(directory, 'library');
    await createAsset(source, {
      id: 'environment.medieval-street',
      type: 'environment',
      capabilities: ['deterministic', 'wet-surfaces'],
    });
    const metadata = await loadAssetMetadata(join(source, 'asset.yaml'));
    await expect(validateLibraryAsset(metadata)).resolves.toEqual({ valid: true, issues: [] });
    const raw = YAML.parse(await readFile(join(source, 'asset.yaml'), 'utf8'));
    raw.artifacts[0].sha256 = createHash('sha256').update('different content').digest('hex');
    await writeFile(join(source, 'asset.yaml'), YAML.stringify(raw), 'utf8');
    await expect(
      validateLibraryAsset(await loadAssetMetadata(join(source, 'asset.yaml'))),
    ).resolves.toMatchObject({ valid: false, issues: [expect.stringMatching(/hash mismatch/)] });
    raw.artifacts[0].sha256 = createHash('sha256').update('fixture').digest('hex');
    await writeFile(join(source, 'asset.yaml'), YAML.stringify(raw), 'utf8');
    const published = await publishAsset(source, library);
    expect(published.target).toMatch(/environments\/medieval-street\/1\.0\.0$/);
    expect(published.index).toBe(join(library, 'index', 'assets.json'));
    expect(JSON.parse(await readFile(published.index, 'utf8')).assets).toEqual([
      expect.objectContaining({ id: 'environment.medieval-street', version: '1.0.0' }),
    ]);
    await expect(publishAsset(source, library)).rejects.toThrow(/already exists/);
    await expect(access(join(published.target, 'undeclared.tmp'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const matches = await searchAssetLibrary(library, {
      query: 'wet medieval street',
      type: 'environment',
      capabilities: ['deterministic', 'wet-surfaces'],
    });
    expect(matches[0]).toMatchObject({
      asset: { id: 'environment.medieval-street', version: '1.0.0' },
      missingCapabilities: [],
    });
    const index = await buildAssetIndex(library);
    expect(index.assets).toHaveLength(1);
    expect(JSON.parse(await readFile(index.path, 'utf8')).assets[0].id).toBe(
      'environment.medieval-street',
    );
  });

  it('excludes licence-restricted assets from ordinary search', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-licence-'));
    const asset = join(directory, 'library', 'props', 'door', '1.0.0');
    await createAsset(asset, {
      id: 'prop.door',
      type: 'prop',
      capabilities: ['openable'],
      commercialUse: 'restricted',
    });
    await expect(
      searchAssetLibrary(join(directory, 'library'), { query: 'door' }),
    ).resolves.toEqual([]);
    await expect(
      searchAssetLibrary(join(directory, 'library'), { query: 'door', includeUncleared: true }),
    ).resolves.toHaveLength(1);
  });

  it('prefers the newest immutable semantic version when relevance is tied', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-version-order-'));
    const library = join(directory, 'library');
    for (const version of ['1.0.0', '1.1.0', '1.10.0', '2.0.0-beta.1', '2.0.0'])
      await createAsset(join(library, 'props', 'door', version), {
        id: 'prop.door',
        type: 'prop',
        capabilities: ['openable'],
        version,
      });
    const matches = await searchAssetLibrary(library, { query: 'door' });
    expect(matches.map((match) => match.asset.version)).toEqual([
      '2.0.0',
      '2.0.0-beta.1',
      '1.10.0',
      '1.1.0',
      '1.0.0',
    ]);
    await deprecateAsset(
      library,
      { id: 'prop.door', version: '1.0.0' },
      { id: 'prop.door', version: '1.1.0' },
      'The successor adds corrected immutable provenance.',
    );
    await expect(searchAssetLibrary(library, { query: 'door' })).resolves.toSatisfy(
      (results: Awaited<ReturnType<typeof searchAssetLibrary>>) =>
        results.every((result) => result.asset.version !== '1.0.0'),
    );
    const audit = await searchAssetLibrary(library, { query: 'door', includeDeprecated: true });
    expect(audit.find((result) => result.asset.version === '1.0.0')?.asset).toMatchObject({
      status: 'deprecated',
      deprecatedBy: { id: 'prop.door', version: '1.1.0' },
      deprecationReason: 'The successor adds corrected immutable provenance.',
    });
  });

  it('resolves requirements explicitly to reuse, adapt, or create', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-production-'));
    const library = join(directory, 'library');
    await createAsset(join(library, 'environments', 'street', '1.0.0'), {
      id: 'environment.medieval-street',
      type: 'environment',
      capabilities: ['wet-surfaces', 'deterministic'],
    });
    await createAsset(join(library, 'props', 'door', '1.0.0'), {
      id: 'prop.wooden-door',
      type: 'prop',
      capabilities: ['wooden'],
    });
    const plan = join(directory, 'campaign', 'production-plan.yaml');
    await mkdir(join(directory, 'campaign'), { recursive: true });
    await writeFile(
      plan,
      YAML.stringify({
        schemaVersion: 1,
        campaignId: 'benchmark',
        title: 'Reference-class benchmark',
        summary: 'Recurring character enters a wet bookshop and reads a book.',
        shots: [
          {
            id: 'exterior',
            purpose: 'Establish location and character',
            durationSeconds: 4,
            requirements: ['street', 'door', 'woman'],
          },
        ],
        requirements: [
          {
            id: 'street',
            type: 'environment',
            description: 'Wet medieval street',
            requiredShots: ['exterior'],
            tags: ['medieval', 'wet'],
            capabilities: ['wet-surfaces', 'deterministic'],
          },
          {
            id: 'door',
            type: 'prop',
            description: 'Wooden door',
            requiredShots: ['exterior'],
            tags: ['wooden'],
            capabilities: ['openable', 'handle-interaction-point'],
          },
          {
            id: 'woman',
            type: 'character',
            description: 'Recurring woman in dark dress',
            requiredShots: ['exterior'],
            capabilities: ['humanoid-rig'],
          },
        ],
      }),
      'utf8',
    );
    const result = await resolveProductionAssets(plan, library);
    expect(result.counts).toEqual({ reuse: 1, adapt: 1, create: 1 });
    expect(result.manifest.resolutions.map((item) => item.decision)).toEqual([
      'reuse',
      'adapt',
      'create',
    ]);
  });
});
