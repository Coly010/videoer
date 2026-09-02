import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import * as jpegCodec from 'jpeg-js';
import {
  importPolyHavenMaterialSource,
  recomputePolyHavenMaterialSourceIdentity,
} from '../src/assets/sources/polyhaven.js';
import { polyHavenMaterialSourceManifestSchema } from '../src/assets/sources/model.js';
import { deriveTextureSurfaceMaterial } from '../src/materials/texture-maps.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';

const exec = promisify(execFile);

const reviewedTerms = await readFile(resolve('test/fixtures/polyhaven-api-tos-df4d579.md'));
const roughConcreteInfo = {
  date_published: 1678752000,
  name: 'Rough Concrete',
  categories: ['man made', 'plaster-concrete', 'concrete'],
  type: 1,
  tags: ['rough', 'concrete', 'dry', 'plaster', 'coarse', 'white', 'grey'],
  authors: { 'Dimitrios Savva': 'All' },
  dimensions: [1230.0000190734863, 1230.0000190734863],
  max_resolution: [8192, 8192],
  files_hash: '38d884db7ce867ff2e6445a31abfe70aa5adc7b5',
};

const jpegFixtures = new Map<string, Uint8Array>();

function jpeg(width = 1024, height = 1024, label = 0) {
  const key = `${width}x${height}-${label}`;
  const existing = jpegFixtures.get(key);
  if (existing) return existing;
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    const pixel = offset / 4;
    data[offset] = (label + pixel) % 256;
    data[offset + 1] = (128 + label + Math.floor(pixel / Math.max(1, width))) % 256;
    data[offset + 2] = (255 - label + pixel * 3) % 256;
    data[offset + 3] = 255;
  }
  const encoded = Uint8Array.from(jpegCodec.encode({ width, height, data }, 82).data);
  jpegFixtures.set(key, encoded);
  return encoded;
}

function md5(bytes: Uint8Array) {
  return createHash('md5').update(bytes).digest('hex');
}

interface FixtureOptions {
  terms?: Uint8Array;
  dimensions?: [number, number];
  omit?: string | string[];
  duplicateDiffuse?: boolean;
  corruptMd5?: boolean;
  imageWidth?: number;
  normalWidth?: number;
  maxResolution?: [number, number];
  licence?: string;
  includeOptional?: boolean;
  undecodable?: boolean;
  optionalWithoutRequestedVariant?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const origin = 'https://polyhaven.fixture.invalid';
  const info = structuredClone(roughConcreteInfo);
  info.dimensions = options.dimensions ?? [1230.0000190734863, 1230.0000190734863];
  info.max_resolution = options.maxResolution ?? [8192, 8192];
  const definitions: Array<readonly [string, string]> = [
    ['Diffuse', 'diff'],
    ['nor_gl', 'nor_gl'],
    ['Rough', 'rough'],
    ['Displacement', 'disp'],
    ['AO', 'ao'],
  ];
  if (options.includeOptional) definitions.push(['Metal', 'metal'], ['Alpha', 'alpha']);
  const images = new Map<string, Uint8Array>();
  const files: Record<string, unknown> = {};
  definitions.forEach(([providerName, suffix], index) => {
    if (
      providerName === options.omit ||
      (Array.isArray(options.omit) && options.omit.includes(providerName))
    )
      return;
    const variant = (resolution: '1k' | '2k', pixels: number) => {
      const path = `/textures/rough_concrete_${suffix}_${resolution}.jpg`;
      const width =
        providerName === 'nor_gl' && options.normalWidth
          ? options.normalWidth
          : (options.imageWidth ?? pixels);
      const bytes =
        options.undecodable && providerName === 'Diffuse'
          ? Uint8Array.from([
              0xff,
              0xd8,
              0xff,
              0xc0,
              0,
              11,
              8,
              (pixels >>> 8) & 0xff,
              pixels & 0xff,
              (width >>> 8) & 0xff,
              width & 0xff,
              1,
              1,
              0x11,
              0,
              0xff,
              0xd9,
            ])
          : jpeg(width, pixels, index);
      images.set(path, bytes);
      return {
        size: bytes.byteLength,
        url: `${origin}${path}`,
        md5: options.corruptMd5 && providerName === 'Diffuse' ? '0'.repeat(32) : md5(bytes),
      };
    };
    files[providerName] = {
      '1k': { jpg: variant('1k', 1024) },
      '2k': { jpg: variant('2k', 2048) },
    };
  });
  if (options.optionalWithoutRequestedVariant)
    files.AO = {
      '1k': {
        png: {
          size: 1,
          url: `${origin}/textures/rough_concrete_ao_1k.png`,
          md5: '0'.repeat(32),
        },
      },
    };
  if (options.duplicateDiffuse) files.diffuse = files.Diffuse;
  const requests: Array<{ url: string; userAgent: string | null }> = [];
  const currentTerms = options.terms ?? reviewedTerms;
  const licence = Buffer.from(
    options.licence ??
      '<html><body>Poly Haven assets are CC0 and may be used for any purpose, including commercial work. No credit or attribution is required for assets.</body></html>',
  );
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, userAgent: headers.get('user-agent') });
    const path = new URL(url).pathname;
    if (path === '/terms-current.md') return new Response(Buffer.from(currentTerms));
    if (path === '/terms-reviewed.md') return new Response(Buffer.from(reviewedTerms));
    if (path === '/license') return new Response(licence);
    if (path === '/info/rough_concrete') return Response.json(info);
    if (path === '/files/rough_concrete') return Response.json(files);
    const image = images.get(path);
    if (image)
      return new Response(Buffer.from(image), {
        headers: { 'content-length': String(image.byteLength) },
      });
    return new Response('not found', { status: 404 });
  };
  return { origin, fetcher, requests };
}

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'videoer-polyhaven-source-'));
  return { root, cache: join(root, 'cache'), output: join(root, 'output') };
}

function request(transport: ReturnType<typeof fixture>, paths: Awaited<ReturnType<typeof roots>>) {
  return {
    assetId: 'rough_concrete',
    resolution: '1k' as const,
    encoding: 'jpg' as const,
    cacheDirectory: paths.cache,
    outputDirectory: paths.output,
    mode: 'online' as const,
    apiBaseUrl: transport.origin,
    currentTermsUrl: `${transport.origin}/terms-current.md`,
    reviewedTermsUrl: `${transport.origin}/terms-reviewed.md`,
    licenceUrl: `${transport.origin}/license`,
    approvedOrigins: [transport.origin],
    visibleAttribution: {
      confirmed: true as const,
      text: 'Textures from Poly Haven',
      location: 'material source browser',
    },
    fetcher: transport.fetcher,
    now: () => new Date('2026-09-02T10:00:00.000Z'),
  };
}

describe('Poly Haven provider-files material source', () => {
  it('persists complete evidence, exact provider files, scale, terms, and a reproducible identity', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));

    expect(transport.requests.slice(0, 3).map((entry) => new URL(entry.url).pathname)).toEqual([
      '/terms-current.md',
      '/terms-reviewed.md',
      '/license',
    ]);
    expect(transport.requests[3]!.url).toContain('/info/rough_concrete');
    expect(
      transport.requests.every(
        (entry) => entry.userAgent === 'Videoer/0.1 poly-haven-material-source-v2',
      ),
    ).toBe(true);
    expect(imported.manifest).toMatchObject({
      schemaVersion: 2,
      kind: 'provider-files',
      provider: 'poly-haven',
      providerApi: {
        openApiVersion: '1.0.0',
        providerFilesHash: {
          algorithm: 'sha1',
          value: roughConcreteInfo.files_hash,
          treatment: 'provider-opaque-response-binding',
        },
      },
      serviceTerms: {
        reviewedCommit: 'df4d579935b5e245b2a745635607b6a3c595d8dd',
        liveApiCommercialUse: 'allowed',
        liveApiAttributionRequired: true,
      },
      assetLicence: { spdx: 'CC0-1.0', attributionRequired: false },
      physicalScale: {
        widthMeters: 1.2300000190734863,
        heightMeters: 1.2300000190734863,
        relativeTolerance: 0.05,
      },
    });
    expect(imported.manifest.providerFiles.map((file) => file.semantic)).toEqual([
      'ambient-occlusion',
      'base-color',
      'displacement',
      'normal',
      'roughness',
    ]);
    expect(
      imported.manifest.providerFiles.every(
        (file) => file.widthPixels === 1024 && file.heightPixels === 1024,
      ),
    ).toBe(true);
    expect(polyHavenMaterialSourceManifestSchema.parse(imported.manifest)).toEqual(
      imported.manifest,
    );
    expect(recomputePolyHavenMaterialSourceIdentity(imported.manifest)).toBe(
      imported.manifest.sourceIdentitySha256,
    );
    for (const evidence of [
      imported.manifest.providerApi.info,
      imported.manifest.providerApi.files,
      imported.manifest.serviceTerms.current,
      imported.manifest.serviceTerms.reviewed,
      imported.manifest.assetLicence.evidence,
    ])
      expect(
        createHash('sha256')
          .update(await readFile(join(imported.candidate, evidence.path)))
          .digest('hex'),
      ).toBe(evidence.sha256);
    for (const file of imported.manifest.providerFiles) {
      const bytes = await readFile(join(imported.candidate, file.path));
      expect(md5(bytes)).toBe(file.providerMd5);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  });

  it('reconstructs only an exact cached identity offline and never overwrites candidate bytes', async () => {
    const paths = await roots();
    const transport = fixture();
    const first = await importPolyHavenMaterialSource(request(transport, paths));
    const offlineOutput = join(paths.root, 'offline');
    const offline = await importPolyHavenMaterialSource({
      ...request(transport, paths),
      outputDirectory: offlineOutput,
      mode: 'offline',
      expectedSourceIdentitySha256: first.manifest.sourceIdentitySha256,
      fetcher: async () => {
        throw new Error('offline import attempted network access');
      },
    });
    expect(offline.fromCache).toBe(true);
    expect(offline.manifest.sourceIdentitySha256).toBe(first.manifest.sourceIdentitySha256);

    const protectedPath = join(offline.candidate, offline.manifest.providerApi.info.path);
    const userBytes = Buffer.from('user-owned bytes');
    await writeFile(protectedPath, userBytes);
    await expect(
      importPolyHavenMaterialSource({
        ...request(transport, paths),
        outputDirectory: offlineOutput,
        mode: 'offline',
        expectedSourceIdentitySha256: first.manifest.sourceIdentitySha256,
      }),
    ).rejects.toThrow(/already exists with different bytes/);
    expect(await readFile(protectedPath)).toEqual(userBytes);

    await expect(
      importPolyHavenMaterialSource({
        ...request(transport, paths),
        mode: 'offline',
        expectedSourceIdentitySha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/no exact source identity/);
  });

  it('reuses the validated latest record online and only refresh contacts Poly Haven', async () => {
    const paths = await roots();
    const transport = fixture();
    const first = await importPolyHavenMaterialSource(request(transport, paths));
    const count = transport.requests.length;
    const cached = await importPolyHavenMaterialSource(request(transport, paths));
    expect(cached.fromCache).toBe(true);
    expect(cached.manifest.sourceIdentitySha256).toBe(first.manifest.sourceIdentitySha256);
    expect(transport.requests).toHaveLength(count);
    const refreshed = await importPolyHavenMaterialSource({
      ...request(transport, paths),
      refresh: true,
      now: () => new Date('2026-09-02T11:00:00.000Z'),
    });
    expect(refreshed.fromCache).toBe(false);
    expect(transport.requests.length).toBeGreaterThan(count);
    expect(refreshed.manifest.sourceIdentitySha256).toBe(first.manifest.sourceIdentitySha256);
    expect(refreshed.manifest.providerApi.info.retrievedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('scopes latest cache records by resolution and includes exact optional maps when available', async () => {
    const paths = await roots();
    const transport = fixture({ includeOptional: true });
    const oneK = await importPolyHavenMaterialSource(request(transport, paths));
    expect(oneK.manifest.providerFiles.map((file) => file.semantic)).toEqual([
      'ambient-occlusion',
      'base-color',
      'displacement',
      'metallic',
      'normal',
      'opacity',
      'roughness',
    ]);
    const afterOneK = transport.requests.length;
    const twoK = await importPolyHavenMaterialSource({
      ...request(transport, paths),
      resolution: '2k',
    });
    expect(twoK.fromCache).toBe(false);
    expect(transport.requests.length).toBeGreaterThan(afterOneK);
    expect(twoK.manifest.providerFiles.every((file) => file.widthPixels === 2048)).toBe(true);
    const afterTwoK = transport.requests.length;
    const twoKCached = await importPolyHavenMaterialSource({
      ...request(transport, paths),
      resolution: '2k',
    });
    expect(twoKCached.fromCache).toBe(true);
    expect(transport.requests).toHaveLength(afterTwoK);
  });

  it('accepts the exact three required maps when all optional maps are absent', async () => {
    const paths = await roots();
    const transport = fixture({ omit: ['Displacement', 'AO'] });
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    expect(imported.manifest.providerFiles.map((file) => file.semantic)).toEqual([
      'base-color',
      'normal',
      'roughness',
    ]);
    const derived = await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.polyhaven-required-only',
      sourceManifestPath: imported.manifestPath,
      outputMaterialPath: join(paths.root, 'derived-required-only/material.json'),
      suitability: {
        composition: 'homogeneous-unit-material',
        intendedConstructionDomains: ['modeled-paving-unit'],
        rationale: 'Required-only fixture contains no displacement channel.',
      },
    });
    expect(derived.material.textureMaps?.displacementResponse).toBeUndefined();
  });

  it('skips an optional map that lacks the exact requested encoding', async () => {
    const paths = await roots();
    const transport = fixture({
      omit: 'Displacement',
      optionalWithoutRequestedVariant: true,
    });
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    expect(imported.manifest.providerFiles.map((file) => file.semantic)).toEqual([
      'base-color',
      'normal',
      'roughness',
    ]);
  });

  it('rejects a cache-record filename traversal before publishing any candidate', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    const recordPath = join(
      paths.cache,
      'records/poly-haven/rough_concrete/1k-jpg',
      `${imported.manifest.sourceIdentitySha256}.json`,
    );
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
      selected: Array<{ filename: string }>;
    };
    record.selected[0]!.filename = '../../escaped';
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    const offlineOutput = join(paths.root, 'traversal-output');
    await expect(
      importPolyHavenMaterialSource({
        ...request(transport, paths),
        outputDirectory: offlineOutput,
        mode: 'offline',
        expectedSourceIdentitySha256: imported.manifest.sourceIdentitySha256,
      }),
    ).rejects.toThrow();
    await expect(readFile(join(offlineOutput, 'escaped.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('binds renderer-consumed scale and channel claims into the source identity', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    const manifest = structuredClone(imported.manifest);
    manifest.physicalScale.widthMeters *= 2;
    manifest.physicalScale.evidenceBoundsMeters.width = [
      manifest.physicalScale.widthMeters * 0.95,
      manifest.physicalScale.widthMeters * 1.05,
    ];
    manifest.sourceIdentitySha256 = recomputePolyHavenMaterialSourceIdentity(manifest);
    const tamperedPath = join(imported.candidate, 'tampered-material-source.json');
    await writeFile(tamperedPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(
      deriveTextureSurfaceMaterial({
        base: createWetCobbleSurfaceMaterial(),
        assetId: 'material.polyhaven-tampered-scale',
        sourceManifestPath: tamperedPath,
        outputMaterialPath: join(paths.root, 'derived-tampered/material.json'),
        suitability: {
          composition: 'homogeneous-unit-material',
          intendedConstructionDomains: ['modeled-paving-unit'],
          rationale: 'Fixture exercises identity verification before texture staging.',
        },
        displacementResponse: {
          policy: 'disabled-uncalibrated',
          rationale: 'Poly Haven does not publish a physical displacement amplitude.',
        },
      }),
    ).rejects.toThrow(/physical scale contradicts persisted info evidence/);
  });

  it('rejects package symlinks before a consumer can follow them', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    const channel = imported.manifest.providerFiles.find((file) => file.semantic === 'base-color')!;
    const channelPath = join(imported.candidate, channel.path);
    const outside = join(paths.root, 'outside-texture.jpg');
    await writeFile(outside, await readFile(channelPath));
    await unlink(channelPath);
    await symlink(outside, channelPath);
    await expect(
      deriveTextureSurfaceMaterial({
        base: createWetCobbleSurfaceMaterial(),
        assetId: 'material.polyhaven-symlink',
        sourceManifestPath: imported.manifestPath,
        outputMaterialPath: join(paths.root, 'derived-symlink/material.json'),
        suitability: {
          composition: 'homogeneous-unit-material',
          intendedConstructionDomains: ['modeled-paving-unit'],
          rationale: 'Fixture exercises package containment.',
        },
        displacementResponse: {
          policy: 'disabled-uncalibrated',
          rationale: 'Fixture source has no physical height calibration.',
        },
      }),
    ).rejects.toThrow(/cannot be a symbolic link/);
  });

  it('rejects extra candidate inventory during exact replay', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    await writeFile(join(imported.candidate, 'unexpected.txt'), 'not part of the source package');
    await expect(
      importPolyHavenMaterialSource({
        ...request(transport, paths),
        mode: 'offline',
        expectedSourceIdentitySha256: imported.manifest.sourceIdentitySha256,
      }),
    ).rejects.toThrow(/inventory is not exactly immutable evidence/);
  });

  it('derives a provenance-bound material and preserves uncalibrated displacement as disabled', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    const derived = await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.polyhaven-rough-concrete',
      sourceManifestPath: imported.manifestPath,
      outputMaterialPath: join(paths.root, 'derived/material.json'),
      suitability: {
        composition: 'homogeneous-unit-material',
        intendedConstructionDomains: ['modeled-paving-unit'],
        rationale: 'Rough concrete supplies local material response, not modeled unit layout.',
      },
      displacementResponse: {
        policy: 'disabled-uncalibrated',
        rationale: 'Poly Haven does not publish a physical displacement amplitude.',
      },
    });
    expect(derived.material.textureMaps).toMatchObject({
      source: {
        provider: 'poly-haven',
        sourceIdentitySha256: imported.manifest.sourceIdentitySha256,
        licenceSpdx: 'CC0-1.0',
      },
      displacementResponse: { policy: 'disabled-uncalibrated' },
    });
    expect(derived.material.textureMaps?.channels).toHaveLength(5);
  });

  it('replays an exact cached source through the public CLI without network access', async () => {
    const paths = await roots();
    const transport = fixture();
    const imported = await importPolyHavenMaterialSource(request(transport, paths));
    const cliOutput = join(paths.root, 'cli-output');
    const { stdout } = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'asset',
      'source',
      'import-material',
      'poly-haven',
      '--asset',
      'rough_concrete',
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
      imported.manifest.sourceIdentitySha256,
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      version: 1,
      ok: true,
      command: 'asset.source.import-material.poly-haven',
      data: {
        fromCache: true,
        manifest: {
          provider: 'poly-haven',
          sourceIdentitySha256: imported.manifest.sourceIdentitySha256,
        },
      },
    });
  });

  it('fails closed on terms contradiction, ambiguous or missing maps, scale, hashes, and image dimensions', async () => {
    const cases: Array<[FixtureOptions, RegExp]> = [
      [{ terms: Buffer.from('commercial use is prohibited') }, /explicit terms review is required/],
      [{ omit: 'nor_gl' }, /missing required 'nor_gl' map/],
      [{ duplicateDiffuse: true }, /ambiguous for 'Diffuse'/],
      [{ dimensions: [0, 0] }, /expected number to be >0/],
      [{ corruptMd5: true }, /MD5 mismatch/],
      [{ imageWidth: 512 }, /(?:do not match 1k|aspect ratio does not match)/],
      [{ normalWidth: 1010 }, /pixel dimensions must be identical/],
      [{ maxResolution: [0, 8192] }, /expected number to be >0/],
      [{ licence: '<html>CC0 assets</html>' }, /must prove CC0 commercial use/],
      [{ undecodable: true }, /JPEG cannot be decoded/],
    ];
    for (const [fixtureOptions, message] of cases) {
      const paths = await roots();
      const transport = fixture(fixtureOptions);
      await expect(importPolyHavenMaterialSource(request(transport, paths))).rejects.toThrow(
        message,
      );
      try {
        expect(
          (await readdir(paths.output)).filter((name) => name.startsWith('rough_concrete-')),
        ).toEqual([]);
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
    }
  });

  it('rejects missing attribution and unapproved redirect origins before accepting bytes', async () => {
    const paths = await roots();
    const transport = fixture();
    await expect(
      importPolyHavenMaterialSource({
        ...request(transport, paths),
        visibleAttribution: { confirmed: true, text: 'Open textures', location: 'browser' },
      }),
    ).rejects.toThrow(/visible attribution naming Poly Haven/);

    const redirecting: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).pathname === '/terms-current.md')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.invalid/terms' },
        });
      return transport.fetcher(input, init);
    };
    await expect(
      importPolyHavenMaterialSource({
        ...request(transport, paths),
        fetcher: redirecting,
      }),
    ).rejects.toThrow(/unapproved origin/);
  });
});
