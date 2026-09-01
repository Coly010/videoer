import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inspectSafeZip } from '../src/assets/sources/archive.js';
import { importAmbientCgMaterialSource } from '../src/assets/sources/ambientcg.js';
import { sha256Bytes } from '../src/assets/sources/cache.js';
import {
  openMaterialSourceImportRequestSchema,
  openMaterialSourceManifestSchema,
} from '../src/assets/sources/model.js';

const exec = promisify(execFile);

function jpeg(label: string) {
  return new Uint8Array([0xff, 0xd8, 0xff, ...strToU8(label), 0xff, 0xd9]);
}

function materialZip(label = 'v1', overrides: Record<string, Uint8Array | null> = {}) {
  const files: Record<string, Uint8Array> = {
    'PavingStones036_1K-JPG_Color.jpg': jpeg(`color-${label}`),
    'PavingStones036_1K-JPG_NormalGL.jpg': jpeg(`normal-gl-${label}`),
    'PavingStones036_1K-JPG_NormalDX.jpg': jpeg(`normal-dx-${label}`),
    'PavingStones036_1K-JPG_Roughness.jpg': jpeg(`roughness-${label}`),
    'PavingStones036_1K-JPG_AmbientOcclusion.jpg': jpeg(`ao-${label}`),
    'PavingStones036_1K-JPG_Displacement.jpg': jpeg(`displacement-${label}`),
  };
  for (const [name, value] of Object.entries(overrides))
    if (value === null) delete files[name];
    else files[name] = value;
  return zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
}

interface FixtureState {
  archive: Uint8Array;
  dimensions?: { width: number; height: number; depth: number };
  declaredSizeDelta?: number;
  requestCount: number;
}

function fixtureTransport(state: FixtureState) {
  const origin = 'https://ambientcg.fixture.invalid';
  const fetcher: typeof fetch = async (input) => {
    state.requestCount++;
    const requested =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requested);
    if (url.pathname === '/api/v3/assets') {
      const body = JSON.stringify({
        totalResults: 1,
        assets: [
          {
            id: 'PavingStones036',
            type: 'material',
            releaseDate: '2018-11-28',
            title: 'Paving Stones 036',
            url: 'https://ambientcg.com/a/PavingStones036',
            tags: ['paving', 'stone'],
            dimensions: state.dimensions ?? { width: 110, height: 110, depth: 0 },
            maps: ['color', 'normal', 'roughness', 'ambient-occlusion', 'displacement'],
            technique: 'surface-photogrammetry',
            downloads: [
              {
                attributes: '1K-JPG',
                extension: 'zip',
                url: `${origin}/get/PavingStones036_1K-JPG.zip`,
                size: state.archive.byteLength + (state.declaredSizeDelta ?? 0),
              },
            ],
          },
        ],
      });
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
      });
    }
    if (url.pathname === '/get/PavingStones036_1K-JPG.zip') {
      return new Response(Buffer.from(state.archive), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-length': String(state.archive.byteLength),
        },
      });
    }
    return new Response('not found', { status: 404 });
  };
  return { baseUrl: origin, fetcher };
}

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'videoer-open-material-'));
  return { root, cache: join(root, 'cache'), output: join(root, 'candidates') };
}

describe('provenance-aware ambientCG material source', () => {
  it('rejects ambiguous offline and refresh operator requests at the source schema boundary', () => {
    const base = {
      provider: 'ambientcg' as const,
      assetId: 'PavingStones036',
      resolution: '1K' as const,
      encoding: 'JPG' as const,
      cacheDirectory: '/fixture/cache',
      outputDirectory: '/fixture/output',
    };
    expect(
      openMaterialSourceImportRequestSchema.safeParse({
        ...base,
        mode: 'offline',
        refresh: false,
      }).success,
    ).toBe(false);
    expect(
      openMaterialSourceImportRequestSchema.safeParse({
        ...base,
        mode: 'offline',
        refresh: true,
        expectedSourceIdentitySha256: '0'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      openMaterialSourceImportRequestSchema.safeParse({
        ...base,
        mode: 'online',
        refresh: false,
      }).success,
    ).toBe(true);
  });

  it('exposes an offline, exact-identity CLI import with stable JSON and no provider access', async () => {
    const paths = await roots();
    const state = { archive: materialZip(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const seeded = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    const requestCountAfterSeed = state.requestCount;
    const cliOutput = join(paths.root, 'cli-candidates');
    const { stdout, stderr } = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'asset',
      'source',
      'import-material',
      'ambientcg',
      '--asset',
      'PavingStones036',
      '--resolution',
      '1K',
      '--encoding',
      'JPG',
      '--cache',
      paths.cache,
      '--output',
      cliOutput,
      '--mode',
      'offline',
      '--exact-identity',
      seeded.manifest.sourceIdentitySha256,
    ]);
    expect(stderr).toBe('');
    expect(state.requestCount).toBe(requestCountAfterSeed);
    const response = JSON.parse(stdout) as Record<string, unknown>;
    expect(response).toMatchObject({
      version: 1,
      ok: true,
      command: 'asset.source.import-material.ambientcg',
      data: {
        fromCache: true,
        manifest: {
          provider: 'ambientcg',
          sourceIdentitySha256: seeded.manifest.sourceIdentitySha256,
        },
      },
    });
  }, 15_000);

  it('normalizes a v3 material into a hashed, scale-aware, renderer-independent source package', async () => {
    const paths = await roots();
    const state = { archive: materialZip(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const imported = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
      now: () => new Date('2026-09-01T12:00:00Z'),
    });

    expect(imported.fromCache).toBe(false);
    expect(state.requestCount).toBe(2);
    expect(imported.manifest).toMatchObject({
      provider: 'ambientcg',
      providerApi: { version: 'ambientcg-v3', retrievedAt: '2026-09-01T12:00:00.000Z' },
      asset: { id: 'PavingStones036', type: 'material' },
      licence: {
        spdx: 'CC0-1.0',
        commercialUse: 'allowed',
        attributionRequired: false,
      },
      physicalScale: { status: 'known', widthMeters: 1.1, heightMeters: 1.1 },
    });
    expect(openMaterialSourceManifestSchema.parse(imported.manifest)).toEqual(imported.manifest);
    expect(imported.manifest.channels.map((channel) => channel.semantic)).toEqual([
      'ambient-occlusion',
      'base-color',
      'displacement',
      'normal',
      'roughness',
    ]);
    expect(
      imported.manifest.channels.find((channel) => channel.semantic === 'base-color'),
    ).toMatchObject({
      colorSpace: 'srgb-texture',
    });
    expect(
      imported.manifest.channels.find((channel) => channel.semantic === 'normal'),
    ).toMatchObject({
      providerName: 'NormalGL',
      colorSpace: 'non-color',
      normalConvention: 'opengl-positive-green',
    });
    expect(imported.manifest.sourceArchive.inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'PavingStones036_1K-JPG_NormalDX.jpg', selected: false }),
      ]),
    );
    for (const channel of imported.manifest.channels)
      expect(sha256Bytes(await readFile(join(imported.candidate, channel.path)))).toBe(
        channel.sha256,
      );
  });

  it('reuses validated content offline and does not contact a provider during cache resolution', async () => {
    const paths = await roots();
    const state = { archive: materialZip(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const first = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    const before = state.requestCount;
    const offline = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: join(paths.root, 'offline-candidates'),
      mode: 'offline',
      expectedSourceIdentitySha256: first.manifest.sourceIdentitySha256,
      apiBaseUrl: 'https://must-not-be-contacted.invalid',
      fetcher: async () => {
        throw new Error('offline import attempted network access');
      },
    });
    expect(state.requestCount).toBe(before);
    expect(offline.fromCache).toBe(true);
    expect(offline.manifest.sourceIdentitySha256).toBe(first.manifest.sourceIdentitySha256);
    expect(offline.manifest.sourceArchive.sha256).toBe(first.manifest.sourceArchive.sha256);
  });

  it('fails offline when the exact source identity has not been cached', async () => {
    const paths = await roots();
    await expect(
      importAmbientCgMaterialSource({
        assetId: 'PavingStones036',
        resolution: '1K',
        encoding: 'JPG',
        cacheDirectory: paths.cache,
        outputDirectory: paths.output,
        mode: 'offline',
        expectedSourceIdentitySha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/Offline source cache has no/);
  });

  it('never overwrites an existing candidate artifact with different bytes', async () => {
    const paths = await roots();
    const state = { archive: materialZip(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const first = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    const archivePath = join(first.candidate, first.manifest.sourceArchive.path);
    const corrupt = Buffer.from('user-owned-different-bytes');
    await writeFile(archivePath, corrupt);
    await expect(
      importAmbientCgMaterialSource({
        assetId: 'PavingStones036',
        resolution: '1K',
        encoding: 'JPG',
        cacheDirectory: paths.cache,
        outputDirectory: paths.output,
        mode: 'offline',
        expectedSourceIdentitySha256: first.manifest.sourceIdentitySha256,
      }),
    ).rejects.toThrow(/already exists with different bytes/);
    expect(await readFile(archivePath)).toEqual(corrupt);
  });

  it('rejects a rewritten cache record even when its JSON schema remains valid', async () => {
    const paths = await roots();
    const state = { archive: materialZip(), requestCount: 0 };
    const transport = fixtureTransport(state);
    await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    const latest = join(
      paths.cache,
      'records',
      'ambientcg',
      'pavingstones036',
      '1k-jpg',
      'latest.json',
    );
    const forged = JSON.parse(await readFile(latest, 'utf8')) as Record<string, unknown>;
    forged.archiveSha256 = '0'.repeat(64);
    await writeFile(latest, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');
    await expect(
      importAmbientCgMaterialSource({
        assetId: 'PavingStones036',
        resolution: '1K',
        encoding: 'JPG',
        cacheDirectory: paths.cache,
        outputDirectory: join(paths.root, 'forged-cache-candidate'),
        mode: 'offline',
      }),
    ).rejects.toThrow(/Source cache record identity mismatch/);
  });

  it('requires explicit refresh before upstream byte changes can replace the latest cache record', async () => {
    const paths = await roots();
    const state = { archive: materialZip('v1'), requestCount: 0 };
    const transport = fixtureTransport(state);
    const first = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    state.archive = materialZip('v2');
    const requestsBeforeCacheHit = state.requestCount;
    const cached = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    expect(state.requestCount).toBe(requestsBeforeCacheHit);
    expect(cached.manifest.sourceIdentitySha256).toBe(first.manifest.sourceIdentitySha256);

    const refreshed = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      refresh: true,
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    expect(refreshed.manifest.sourceIdentitySha256).not.toBe(first.manifest.sourceIdentitySha256);
    expect(refreshed.manifest.sourceArchive.sha256).not.toBe(first.manifest.sourceArchive.sha256);
  });

  it('records unknown physical scale instead of inventing a tile size', async () => {
    const paths = await roots();
    const state: FixtureState = {
      archive: materialZip(),
      dimensions: { width: 0, height: 0, depth: 0 },
      requestCount: 0,
    };
    const transport = fixtureTransport(state);
    const imported = await importAmbientCgMaterialSource({
      assetId: 'PavingStones036',
      resolution: '1K',
      encoding: 'JPG',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.baseUrl,
      fetcher: transport.fetcher,
    });
    expect(imported.manifest.physicalScale).toMatchObject({ status: 'unknown' });
  });

  it('fails closed on provider size mismatch or a missing OpenGL normal channel', async () => {
    const sizePaths = await roots();
    const sizeState: FixtureState = {
      archive: materialZip(),
      declaredSizeDelta: 1,
      requestCount: 0,
    };
    const sizeTransport = fixtureTransport(sizeState);
    await expect(
      importAmbientCgMaterialSource({
        assetId: 'PavingStones036',
        resolution: '1K',
        encoding: 'JPG',
        cacheDirectory: sizePaths.cache,
        outputDirectory: sizePaths.output,
        mode: 'online',
        apiBaseUrl: sizeTransport.baseUrl,
        fetcher: sizeTransport.fetcher,
      }),
    ).rejects.toThrow(/archive size mismatch/);

    const normalPaths = await roots();
    const normalState = {
      archive: materialZip('missing-gl', {
        'PavingStones036_1K-JPG_NormalGL.jpg': null,
      }),
      requestCount: 0,
    };
    const normalTransport = fixtureTransport(normalState);
    await expect(
      importAmbientCgMaterialSource({
        assetId: 'PavingStones036',
        resolution: '1K',
        encoding: 'JPG',
        cacheDirectory: normalPaths.cache,
        outputDirectory: normalPaths.output,
        mode: 'online',
        apiBaseUrl: normalTransport.baseUrl,
        fetcher: normalTransport.fetcher,
      }),
    ).rejects.toThrow(/missing required normal channel/);
  });
});

describe('fail-closed ZIP inspection', () => {
  it('rejects path traversal before extracting any bytes', () => {
    const archive = zipSync({
      '../escape.jpg': jpeg('escape'),
      'PavingStones036_1K-JPG_Color.jpg': jpeg('color'),
    });
    expect(() => inspectSafeZip(archive)).toThrow(/Unsafe ZIP path/);
  });

  it('rejects symbolic links and archive-bomb compression ratios from central-directory metadata', () => {
    const symbolic = zipSync({
      'linked.jpg': [strToU8('target'), { os: 3, attrs: 0o120777 << 16 }],
    } satisfies Zippable);
    expect(() => inspectSafeZip(symbolic)).toThrow(/symbolic link/);

    const compressed = zipSync({ 'large.bin': new Uint8Array(50_000) }, { level: 9 });
    expect(() =>
      inspectSafeZip(compressed, {
        maximumEntries: 2,
        maximumCompressedBytes: 100_000,
        maximumExpandedBytes: 100_000,
        maximumEntryBytes: 100_000,
        maximumCompressionRatio: 5,
      }),
    ).toThrow(/compression-ratio limit/);
  });
});
