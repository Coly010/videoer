import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  importAmbientCgEnvironmentRadianceSource,
  recomputeAmbientCgEnvironmentSourceIdentity,
} from '../src/assets/sources/ambientcg-environment.js';
import { sha256Bytes, writeImmutableFile } from '../src/assets/sources/cache.js';
import {
  openEnvironmentRadianceSourceManifestSchema,
  relativeArtifactPathSchema,
} from '../src/assets/sources/model.js';
import { parseOpenExrInfo, type OpenExrInspection } from '../src/assets/sources/openexr.js';
import { inspectRadianceHdr } from '../src/assets/sources/radiance-hdr.js';
import { createEnvironmentLightingRigFromSource } from '../src/lighting/environment-source.js';
import { loadLightingRig } from '../src/lighting/io.js';
import { checkOpenExrInspectorDependency } from '../src/media/dependencies.js';

const exec = promisify(execFile);

const rec709Primaries = '0.6400 0.3300 0.3000 0.6000 0.1500 0.0600 0.3127 0.3290';

describe('portable source-package artifact paths', () => {
  it('rejects POSIX, Windows-drive, backslash, and parent-relative paths', () => {
    expect(relativeArtifactPathSchema.parse('source/environment.exr')).toBe(
      'source/environment.exr',
    );
    for (const path of [
      '/tmp/environment.exr',
      'C:/secret.exr',
      'c:secret.exr',
      '..\\secret.exr',
      '../secret.exr',
    ])
      expect(() => relativeArtifactPathSchema.parse(path)).toThrow(/normalized and relative/u);
  });
});

function radianceHdr(
  width = 1024,
  height = 512,
  values = [1, 2, 4, 8, 16, 32, 64, 200],
  primaries: string | null = rec709Primaries,
) {
  const header = Buffer.from(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n${primaries ? `PRIMARIES=${primaries}\n` : ''}\n-Y ${height} +X ${width}\n`,
    'ascii',
  );
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const value = values[index % values.length]!;
    pixels[index * 4] = value;
    pixels[index * 4 + 1] = value;
    pixels[index * 4 + 2] = value;
    pixels[index * 4 + 3] = 129;
  }
  return new Uint8Array(Buffer.concat([header, pixels]));
}

function rleRadianceHdr() {
  const width = 8;
  const height = 4;
  const header = Buffer.from(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nPRIMARIES=${rec709Primaries}\n\n-Y ${height} +X ${width}\n`,
    'ascii',
  );
  const scanlines: Buffer[] = [];
  for (let row = 0; row < height; row++) {
    const bytes = [2, 2, 0, width];
    for (let channel = 0; channel < 3; channel++)
      bytes.push(width, ...Array.from({ length: width }, (_, index) => 1 + row + index));
    bytes.push(128 + width, 129);
    scanlines.push(Buffer.from(bytes));
  }
  return new Uint8Array(Buffer.concat([header, ...scanlines]));
}

function openExrVerboseOutput() {
  return `File 'fixture.exr': ver 2 flags shortnames
 parts: 1
 part 1: <single>
  channels: chlist 4 channels
   'A': half samp 1 1
   'B': half samp 1 1
   'G': half samp 1 1
   'R': half samp 1 1
  compression: compression 'piz' (0x04)
  dataWindow: box2i [ 0, 0 - 2047 1023 ] 2048 x 1024
  displayWindow: box2i [ 0, 0 - 2047 1023 ] 2048 x 1024
  lineOrder: lineOrder 0 (increasing)
  pixelAspectRatio: float 1
`;
}

interface FixtureState {
  hdr: Uint8Array;
  sourceName?: string;
  resolution?: `${number}K`;
  assets?: unknown[];
  declaredSizeDelta?: number;
  requestCount: number;
}

function fixtureTransport(state: FixtureState) {
  const origin = 'https://ambientcg-hdri.fixture.invalid';
  const resolution = state.resolution ?? '1K';
  const archive = () =>
    zipSync(
      {
        [state.sourceName ?? `SkyOnlyHDRI001_${resolution}.hdr`]: state.hdr,
        'SkyOnlyHDRI001_Preview.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      },
      { level: 0, mtime: new Date('2026-01-01T00:00:00Z') },
    );
  const canonicalAsset = () => ({
    id: 'SkyOnlyHDRI001',
    type: 'hdri',
    releaseDate: '2026-05-17',
    title: 'Sky Only HDRI 001',
    url: 'https://ambientcg.com/a/SkyOnlyHDRI001',
    tags: ['sky', 'clear'],
    technique: 'hdri-bracketed-panorama-horizon-clearing',
    downloads: [
      {
        attributes: resolution,
        extension: 'zip',
        url: `${origin}/get/SkyOnlyHDRI001_${resolution}.zip`,
        size: archive().byteLength + (state.declaredSizeDelta ?? 0),
      },
    ],
  });
  const licenceDocument = `<!doctype html><html><body>
All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License.
You can use them for commercial purposes. You don't need to give credit.
</body></html>`;
  const fetcher: typeof fetch = async (input) => {
    state.requestCount++;
    const requested =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requested);
    if (url.pathname === '/api/v3/assets') {
      const assets = state.assets ?? [canonicalAsset()];
      const body = JSON.stringify({ totalResults: assets.length, assets });
      return new Response(body, {
        status: 200,
        headers: { 'content-length': String(Buffer.byteLength(body)) },
      });
    }
    if (url.pathname === `/get/SkyOnlyHDRI001_${resolution}.zip`) {
      const bytes = archive();
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      });
    }
    if (url.pathname === '/license/') {
      return new Response(licenceDocument, {
        status: 200,
        headers: { 'content-length': String(Buffer.byteLength(licenceDocument)) },
      });
    }
    return new Response('not found', { status: 404 });
  };
  return { origin, fetcher, canonicalAsset };
}

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'videoer-open-hdri-'));
  return { root, cache: join(root, 'cache'), output: join(root, 'candidates') };
}

describe('provider-neutral open environment radiance sources', () => {
  it('exposes an offline exact-identity CLI command without provider access', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const seeded = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    const requestCount = state.requestCount;
    const { stdout, stderr } = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'asset',
      'source',
      'import-environment-radiance',
      'ambientcg',
      '--asset',
      'SkyOnlyHDRI001',
      '--resolution',
      '1K',
      '--cache',
      paths.cache,
      '--output',
      join(paths.root, 'cli-candidates'),
      '--mode',
      'offline',
      '--exact-identity',
      seeded.manifest.sourceIdentitySha256,
    ]);
    expect(stderr).toBe('');
    expect(state.requestCount).toBe(requestCount);
    expect(JSON.parse(stdout)).toMatchObject({
      version: 1,
      ok: true,
      command: 'asset.source.import-environment-radiance.ambientcg',
      data: {
        fromCache: true,
        manifest: {
          provider: 'ambientcg',
          sourceIdentitySha256: seeded.manifest.sourceIdentitySha256,
        },
      },
    });
  }, 15_000);

  it('normalizes one exact ambientCG v3 HDRI into a provenance-complete package', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const imported = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
      now: () => new Date('2026-09-01T12:00:00Z'),
    });

    expect(state.requestCount).toBe(3);
    expect(imported.fromCache).toBe(false);
    expect(imported.manifest).toMatchObject({
      provider: 'ambientcg',
      providerApi: {
        version: 'ambientcg-v3',
        finalUrl: `${transport.origin}/api/v3/assets?id=SkyOnlyHDRI001&include=type%2CreleaseDate%2Ctitle%2Curl%2Ctags%2Ctechnique%2Cdownloads`,
        retrievedAt: '2026-09-01T12:00:00.000Z',
      },
      asset: {
        id: 'SkyOnlyHDRI001',
        type: 'hdri',
        technique: 'hdri-bracketed-panorama-horizon-clearing',
        releaseDate: '2026-05-17',
      },
      licence: {
        spdx: 'CC0-1.0',
        commercialUse: 'allowed',
        attributionRequired: false,
        providerEvidence: {
          requestedUrl: 'https://docs.ambientcg.com/license/',
          mediaType: 'text/html',
          path: 'source/provider-licence.html',
        },
        adapterAssessment: {
          kind: 'videoer-reviewed-provider-licence-assessment-v1',
          path: 'source/licence-assessment.json',
        },
      },
      selection: {
        archiveFinalUrl: `${transport.origin}/get/SkyOnlyHDRI001_1K.zip`,
      },
      radiance: {
        mediaType: 'image/vnd.radiance',
        projection: 'equirectangular-latlong',
        orientation: '-Y +X',
        widthPixels: 1024,
        heightPixels: 512,
        colorSpace: {
          name: 'scene-linear-rec709',
          evidence: { mode: 'radiance-header-rec709' },
        },
        pixelRange: { dynamicRangeRatio: 200 },
      },
    });
    expect(openEnvironmentRadianceSourceManifestSchema.parse(imported.manifest)).toEqual(
      imported.manifest,
    );
    expect(
      sha256Bytes(await readFile(join(imported.candidate, imported.manifest.radiance.path))),
    ).toBe(imported.manifest.radiance.sha256);
    expect(
      sha256Bytes(
        await readFile(join(imported.candidate, imported.manifest.providerApi.responsePath)),
      ),
    ).toBe(imported.manifest.providerApi.responseSha256);
    expect(imported.manifest.sourceArchive.inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'SkyOnlyHDRI001_1K.hdr',
          selected: true,
          sha256: imported.manifest.radiance.sha256,
        }),
      ]),
    );
  });

  it('derives a portable environment-only lighting candidate from exact source bytes', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const imported = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    const candidate = await createEnvironmentLightingRigFromSource({
      sourceManifestPath: imported.manifestPath,
      outputDirectory: join(paths.root, 'lighting-candidate'),
      assetId: 'lighting.sky-only-hdri',
      yawDegrees: 42,
      environmentExposureStops: -0.5,
      sceneExposureStops: 0.25,
    });
    expect(candidate.rig).toMatchObject({
      id: 'lighting.sky-only-hdri',
      lights: [],
      environmentIllumination: {
        kind: 'hash-bound-equirectangular-radiance',
        source: { mediaType: 'image/vnd.radiance' },
        dimensions: { widthPixels: 1024, heightPixels: 512 },
        sourcePackage: {
          manifest: {
            path: 'environment-radiance-source.json',
            mediaType: 'application/vnd.videoer.environment-radiance-source+json',
          },
        },
        yawDegrees: 42,
        exposureStops: -0.5,
      },
      exposure: { exposureStops: 0.25 },
    });
    await expect(loadLightingRig(candidate.rigPath)).resolves.toMatchObject({
      id: 'lighting.sky-only-hdri',
    });
    expect(await readFile(join(candidate.output, imported.manifest.radiance.path))).toEqual(
      await readFile(join(imported.candidate, imported.manifest.radiance.path)),
    );
    expect(candidate.report.stagedArtifacts).toHaveLength(5);
    expect(candidate.report).toMatchObject({
      lightingRigPath: 'lighting-rig.json',
      sourceManifestPath: 'environment-radiance-source.json',
    });
    await expect(
      createEnvironmentLightingRigFromSource({
        sourceManifestPath: imported.manifestPath,
        outputDirectory: candidate.output,
        assetId: 'lighting.sky-only-hdri',
        yawDegrees: 43,
        environmentExposureStops: -0.5,
        sceneExposureStops: 0.25,
      }),
    ).rejects.toThrow(/lighting-rig collision/);
    await expect(loadLightingRig(candidate.rigPath)).resolves.toMatchObject({
      environmentIllumination: { yawDegrees: 42 },
    });
    const { stdout, stderr } = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'lighting',
      'create-environment-rig',
      imported.manifestPath,
      join(paths.root, 'cli-lighting-candidate'),
      '--id',
      'lighting.sky-only-cli',
      '--yaw',
      '-18',
      '--environment-exposure',
      '0.75',
      '--scene-exposure',
      '-0.25',
    ]);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: 'lighting.create-environment-rig',
      data: {
        rig: {
          id: 'lighting.sky-only-cli',
          environmentIllumination: { yawDegrees: -18, exposureStops: 0.75 },
          exposure: { exposureStops: -0.25 },
        },
      },
    });
  });

  it('falls back to one exact OpenEXR source and records structural tool evidence', async () => {
    const paths = await roots();
    const exrBytes = new Uint8Array([0x76, 0x2f, 0x31, 0x01, 0, 0, 0, 0]);
    const state: FixtureState = {
      hdr: exrBytes,
      sourceName: 'SkyOnlyHDRI001_2K_HDR.exr',
      resolution: '2K',
      requestCount: 0,
    };
    const transport = fixtureTransport(state);
    let inspections = 0;
    const inspection: OpenExrInspection = {
      widthPixels: 2048,
      heightPixels: 1024,
      storage: 'single-part-scanline',
      channels: [
        { name: 'A', sampleType: 'half', xSampling: 1, ySampling: 1 },
        { name: 'B', sampleType: 'half', xSampling: 1, ySampling: 1 },
        { name: 'G', sampleType: 'half', xSampling: 1, ySampling: 1 },
        { name: 'R', sampleType: 'half', xSampling: 1, ySampling: 1 },
      ],
      dataWindow: [0, 0, 2047, 1023],
      displayWindow: [0, 0, 2047, 1023],
      colorSpace: parseOpenExrInfo(
        openExrVerboseOutput(),
        'exrinfo (OpenEXR) 3.4.15\nLicense BSD-3-Clause\n',
      ).colorSpace,
      inspector: {
        tool: 'exrinfo',
        version: '3.4.15',
        licenceSpdx: 'BSD-3-Clause',
        commandArguments: ['-v', '-s'],
        output: openExrVerboseOutput(),
      },
    };
    const imported = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '2K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
      openExrInspector: async () => {
        inspections++;
        return inspection;
      },
    });
    expect(inspections).toBe(1);
    expect(imported.manifest.selection.encoding).toBe('EXR');
    expect(imported.manifest.radiance).toMatchObject({
      encoding: 'openexr',
      mediaType: 'image/x-exr',
      path: 'radiance/environment.exr',
      widthPixels: 2048,
      heightPixels: 1024,
      structuralEvidence: {
        storage: 'single-part-scanline',
        inspector: {
          tool: 'exrinfo',
          version: '3.4.15',
          licenceSpdx: 'BSD-3-Clause',
          commandArguments: ['-v', '-s'],
          evidencePath: 'source/openexr-inspection.json',
        },
      },
      colorSpace: {
        name: 'scene-linear-rec709',
        evidence: { mode: 'openexr-default-rec709' },
      },
    });
    expect(imported.manifest.radiance).not.toHaveProperty('pixelRange');
    if (imported.manifest.radiance.encoding !== 'openexr')
      throw new Error('fixture did not produce an OpenEXR manifest');
    const evidenceBytes = await readFile(
      join(
        imported.candidate,
        imported.manifest.radiance.structuralEvidence.inspector.evidencePath,
      ),
    );
    expect(sha256Bytes(evidenceBytes)).toBe(
      imported.manifest.radiance.structuralEvidence.inspector.evidenceSha256,
    );

    const offline = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '2K',
      cacheDirectory: paths.cache,
      outputDirectory: join(paths.root, 'offline-exr'),
      mode: 'offline',
      expectedSourceIdentitySha256: imported.manifest.sourceIdentitySha256,
      openExrInspector: async () => {
        throw new Error('offline cache validation must use persisted structural evidence');
      },
    });
    expect(offline.manifest).toEqual(imported.manifest);
  });

  it('requires exactly one exact requested HDRI rather than accepting provider ambiguity', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    state.assets = [
      transport.canonicalAsset(),
      { ...transport.canonicalAsset(), id: 'SkyOnlyHDRI001-copy' },
    ];
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: paths.cache,
        outputDirectory: paths.output,
        mode: 'online',
        apiBaseUrl: transport.origin,
        fetcher: transport.fetcher,
      }),
    ).rejects.toThrow(/exactly one HDRI with exact ID/);

    const wrongCasePaths = await roots();
    state.assets = [{ ...transport.canonicalAsset(), id: 'skyonlyhdri001' }];
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: wrongCasePaths.cache,
        outputDirectory: wrongCasePaths.output,
        mode: 'online',
        apiBaseUrl: transport.origin,
        fetcher: transport.fetcher,
      }),
    ).rejects.toThrow(/exactly one HDRI with exact ID/);
  });

  it('reuses an exact identity offline without any provider or renderer access', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const seeded = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    const requestCount = state.requestCount;
    const offline = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: join(paths.root, 'offline'),
      mode: 'offline',
      expectedSourceIdentitySha256: seeded.manifest.sourceIdentitySha256,
      fetcher: async () => {
        throw new Error('offline import attempted network access');
      },
    });
    expect(state.requestCount).toBe(requestCount);
    expect(offline.fromCache).toBe(true);
    expect(offline.manifest.sourceIdentitySha256).toBe(seeded.manifest.sourceIdentitySha256);
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: paths.cache,
        outputDirectory: paths.output,
        mode: 'offline',
      }),
    ).rejects.toThrow(/require an exact source identity/);
  });

  it('keeps online cache hits stable and changes identity only on explicit refresh', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const first = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    state.hdr = radianceHdr(1024, 512, [3, 5, 9, 17, 33, 65, 129, 199]);
    const requestCount = state.requestCount;
    const cached = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    expect(state.requestCount).toBe(requestCount);
    expect(cached.manifest.sourceIdentitySha256).toBe(first.manifest.sourceIdentitySha256);

    const refreshed = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      refresh: true,
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    expect(refreshed.manifest.sourceIdentitySha256).not.toBe(first.manifest.sourceIdentitySha256);
    expect(refreshed.manifest.radiance.sha256).not.toBe(first.manifest.radiance.sha256);
  });

  it('recomputes identity and correlates manifest claims with persisted provider evidence', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const imported = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    const forged = structuredClone(imported.manifest);
    forged.asset.title = 'Forged title with otherwise valid exact bytes';
    forged.sourceIdentitySha256 = recomputeAmbientCgEnvironmentSourceIdentity(forged);
    await writeFile(imported.manifestPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');
    await expect(
      createEnvironmentLightingRigFromSource({
        sourceManifestPath: imported.manifestPath,
        outputDirectory: join(paths.root, 'forged-lighting'),
        assetId: 'lighting.forged-source',
      }),
    ).rejects.toThrow(/asset contradicts its API response/);
    await expect(
      readFile(join(paths.root, 'forged-lighting', 'environment-radiance-source.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const arbitraryIdentity = structuredClone(imported.manifest);
    arbitraryIdentity.sourceIdentitySha256 = 'f'.repeat(64);
    await writeFile(
      imported.manifestPath,
      `${JSON.stringify(arbitraryIdentity, null, 2)}\n`,
      'utf8',
    );
    await expect(
      createEnvironmentLightingRigFromSource({
        sourceManifestPath: imported.manifestPath,
        outputDirectory: join(paths.root, 'arbitrary-identity-lighting'),
        assetId: 'lighting.arbitrary-identity',
      }),
    ).rejects.toThrow(/manifest identity mismatch/);
  });

  it('constrains provider downloads and every redirect to approved HTTPS origins', async () => {
    const initialPaths = await roots();
    const initialState: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const initialTransport = fixtureTransport(initialState);
    const unsafeAsset = initialTransport.canonicalAsset();
    unsafeAsset.downloads[0]!.url = 'http://127.0.0.1/internal-environment.zip';
    initialState.assets = [unsafeAsset];
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: initialPaths.cache,
        outputDirectory: initialPaths.output,
        mode: 'online',
        apiBaseUrl: initialTransport.origin,
        fetcher: initialTransport.fetcher,
      }),
    ).rejects.toThrow(/approved HTTPS ambientCG\/CDN origins/);

    const redirectPaths = await roots();
    const redirectState: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const redirectTransport = fixtureTransport(redirectState);
    const redirectingFetcher: typeof fetch = async (input, init) => {
      const requested =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(requested).pathname.startsWith('/get/'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.invalid/provider-drift.zip' },
        });
      return redirectTransport.fetcher(input, init);
    };
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: redirectPaths.cache,
        outputDirectory: redirectPaths.output,
        mode: 'online',
        apiBaseUrl: redirectTransport.origin,
        fetcher: redirectingFetcher,
      }),
    ).rejects.toThrow(/approved HTTPS ambientCG\/CDN origins/);

    const approvedPaths = await roots();
    const approvedState: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const approvedTransport = fixtureTransport(approvedState);
    const approvedFinal = 'https://cdn.ambientcg.com/SkyOnlyHDRI001_1K.zip';
    const approvedRedirectFetcher: typeof fetch = async (input, init) => {
      const requested =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requested);
      if (url.origin === approvedTransport.origin && url.pathname.startsWith('/get/'))
        return new Response(null, { status: 302, headers: { location: approvedFinal } });
      if (requested === approvedFinal)
        return approvedTransport.fetcher(
          `${approvedTransport.origin}/get/SkyOnlyHDRI001_1K.zip`,
          init,
        );
      return approvedTransport.fetcher(input, init);
    };
    const approved = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: approvedPaths.cache,
      outputDirectory: approvedPaths.output,
      mode: 'online',
      apiBaseUrl: approvedTransport.origin,
      fetcher: approvedRedirectFetcher,
    });
    expect(approved.manifest.selection.archiveFinalUrl).toBe(approvedFinal);
  });

  it('creates immutable cache paths exclusively and accepts only identical races', async () => {
    const paths = await roots();
    const immutable = join(paths.cache, 'records', 'exact.json');
    const bytes = Buffer.from('exact immutable source record');
    await Promise.all([writeImmutableFile(immutable, bytes), writeImmutableFile(immutable, bytes)]);
    await expect(writeImmutableFile(immutable, Buffer.from('different bytes'))).rejects.toThrow(
      /Immutable source-cache collision/,
    );
    expect(await readFile(immutable)).toEqual(bytes);
  });

  it('fails closed on provider size mismatch and malformed Radiance sources', async () => {
    const sizePaths = await roots();
    const sizeState: FixtureState = {
      hdr: radianceHdr(),
      declaredSizeDelta: 1,
      requestCount: 0,
    };
    const sizeTransport = fixtureTransport(sizeState);
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: sizePaths.cache,
        outputDirectory: sizePaths.output,
        mode: 'online',
        apiBaseUrl: sizeTransport.origin,
        fetcher: sizeTransport.fetcher,
      }),
    ).rejects.toThrow(/archive size mismatch/);

    const resolutionPaths = await roots();
    const resolutionState: FixtureState = { hdr: radianceHdr(4, 2), requestCount: 0 };
    const resolutionTransport = fixtureTransport(resolutionState);
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: resolutionPaths.cache,
        outputDirectory: resolutionPaths.output,
        mode: 'online',
        apiBaseUrl: resolutionTransport.origin,
        fetcher: resolutionTransport.fetcher,
      }),
    ).rejects.toThrow(/1K environment width mismatch/);

    const selectionPaths = await roots();
    const selectionState: FixtureState = {
      hdr: radianceHdr(),
      sourceName: 'SkyOnlyHDRI001_1K_preview-extra.hdr',
      requestCount: 0,
    };
    const selectionTransport = fixtureTransport(selectionState);
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: selectionPaths.cache,
        outputDirectory: selectionPaths.output,
        mode: 'online',
        apiBaseUrl: selectionTransport.origin,
        fetcher: selectionTransport.fetcher,
      }),
    ).rejects.toThrow(/requires exactly one 1K_HDR\.exr source/);

    for (const [resolution, sourceName] of [
      ['1K', 'WrongAsset_1K.hdr'],
      ['2K', 'WrongAsset_2K_HDR.exr'],
    ] as const) {
      const wrongIdPaths = await roots();
      const wrongIdState: FixtureState = {
        hdr:
          resolution === '1K'
            ? radianceHdr()
            : new Uint8Array([0x76, 0x2f, 0x31, 0x01, 0, 0, 0, 0]),
        sourceName,
        resolution,
        requestCount: 0,
      };
      const wrongIdTransport = fixtureTransport(wrongIdState);
      await expect(
        importAmbientCgEnvironmentRadianceSource({
          assetId: 'SkyOnlyHDRI001',
          resolution,
          cacheDirectory: wrongIdPaths.cache,
          outputDirectory: wrongIdPaths.output,
          mode: 'online',
          apiBaseUrl: wrongIdTransport.origin,
          fetcher: wrongIdTransport.fetcher,
        }),
      ).rejects.toThrow(/requires exactly one|has no Radiance/);
    }

    expect(() => inspectRadianceHdr(radianceHdr(3, 2))).toThrow(/exact 2:1/);
    expect(() => inspectRadianceHdr(radianceHdr(4, 2, Array(8).fill(0)))).toThrow(
      /no nonzero radiance/,
    );
    expect(() => inspectRadianceHdr(radianceHdr(4, 2, Array(8).fill(10)))).toThrow(
      /dynamic range greater than 1/,
    );
    expect(() => inspectRadianceHdr(radianceHdr(4, 2, undefined, null))).toThrow(
      /Radiance default is not Rec\.709/,
    );
    expect(() =>
      inspectRadianceHdr(radianceHdr(4, 2, undefined, '0.7 0.3 0.3 0.6 0.15 0.06 0.3127 0.329')),
    ).toThrow(/unsupported non-Rec\.709 chromaticities/);
    expect(inspectRadianceHdr(rleRadianceHdr())).toMatchObject({
      widthPixels: 8,
      heightPixels: 4,
      orientation: '-Y +X',
    });
    const malformedRle = rleRadianceHdr();
    const firstScanline = Buffer.from(malformedRle).indexOf(Buffer.from([2, 2, 0, 8]));
    malformedRle[firstScanline + 4] = 128 + 9;
    expect(() => inspectRadianceHdr(malformedRle)).toThrow(/invalid RLE run/);
    const truncated = radianceHdr().subarray(0, radianceHdr().byteLength - 1);
    expect(() => inspectRadianceHdr(truncated)).toThrow(/truncated RGBE pixels/);
  });

  it('bounds provider time and streaming bytes even without Content-Length', async () => {
    const stalledPaths = await roots();
    const stalledState: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const stalledTransport = fixtureTransport(stalledState);
    const stalledFetcher: typeof fetch = async (input, init) => {
      const requested =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(requested).pathname === '/api/v3/assets')
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
      return stalledTransport.fetcher(input, init);
    };
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: stalledPaths.cache,
        outputDirectory: stalledPaths.output,
        mode: 'online',
        apiBaseUrl: stalledTransport.origin,
        fetcher: stalledFetcher,
        providerTimeoutMilliseconds: 20,
      }),
    ).rejects.toThrow(/timed out after 20ms/);

    const stalledArchivePaths = await roots();
    const stalledArchiveState: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const stalledArchiveTransport = fixtureTransport(stalledArchiveState);
    const stalledArchiveFetcher: typeof fetch = async (input, init) => {
      const requested =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(requested).pathname === '/get/SkyOnlyHDRI001_1K.zip')
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
      return stalledArchiveTransport.fetcher(input, init);
    };
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: stalledArchivePaths.cache,
        outputDirectory: stalledArchivePaths.output,
        mode: 'online',
        apiBaseUrl: stalledArchiveTransport.origin,
        fetcher: stalledArchiveFetcher,
        providerTimeoutMilliseconds: 20,
      }),
    ).rejects.toThrow(/timed out after 20ms/);

    const oversizedPaths = await roots();
    const oversizedState: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const oversizedTransport = fixtureTransport(oversizedState);
    const oversizedFetcher: typeof fetch = async (input, init) => {
      const requested =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(requested).pathname === '/get/SkyOnlyHDRI001_1K.zip')
        return new Response(new Uint8Array(65), { status: 200 });
      return oversizedTransport.fetcher(input, init);
    };
    await expect(
      importAmbientCgEnvironmentRadianceSource({
        assetId: 'SkyOnlyHDRI001',
        resolution: '1K',
        cacheDirectory: oversizedPaths.cache,
        outputDirectory: oversizedPaths.output,
        mode: 'online',
        apiBaseUrl: oversizedTransport.origin,
        fetcher: oversizedFetcher,
        maximumArchiveBytes: 64,
      }),
    ).rejects.toThrow(/response exceeds 64 bytes/);
  });

  it('identity-binds the exact ambientCG v3 provider API contract', async () => {
    const paths = await roots();
    const state: FixtureState = { hdr: radianceHdr(), requestCount: 0 };
    const transport = fixtureTransport(state);
    const imported = await importAmbientCgEnvironmentRadianceSource({
      assetId: 'SkyOnlyHDRI001',
      resolution: '1K',
      cacheDirectory: paths.cache,
      outputDirectory: paths.output,
      mode: 'online',
      apiBaseUrl: transport.origin,
      fetcher: transport.fetcher,
    });
    const tampered = structuredClone(imported.manifest);
    tampered.providerApi.version = 'ambientcg-v99';
    expect(() => recomputeAmbientCgEnvironmentSourceIdentity(tampered)).toThrow(
      /exact ambientcg-v3 API contract/,
    );
  });

  it('parses exact patched exrinfo evidence and rejects unsupported EXR structure', () => {
    const version = `exrinfo (OpenEXR) 3.4.15 https://openexr.com
License BSD-3-Clause
`;
    expect(parseOpenExrInfo(openExrVerboseOutput(), version)).toMatchObject({
      widthPixels: 2048,
      heightPixels: 1024,
      storage: 'single-part-scanline',
    });
    expect(() =>
      parseOpenExrInfo(openExrVerboseOutput().replace('parts: 1', 'parts: 2'), version),
    ).toThrow(/exactly one/);
    expect(() =>
      parseOpenExrInfo(openExrVerboseOutput().replace("'A': half", "'Z': half"), version),
    ).toThrow(/unsupported channel/);
    expect(() =>
      parseOpenExrInfo(openExrVerboseOutput(), version.replace('3.4.15', '3.4.13')),
    ).toThrow(/security-patched/);
    const embedded = openExrVerboseOutput().replace(
      "  compression: compression 'piz' (0x04)",
      `  chromaticities: chromaticities
   red(0.6400 0.3300)
   green(0.3000 0.6000)
   blue(0.1500 0.0600)
   white(0.3127 0.3290)
  compression: compression 'piz' (0x04)`,
    );
    expect(parseOpenExrInfo(embedded, version).colorSpace.evidence.mode).toBe(
      'openexr-embedded-rec709',
    );
    expect(() => parseOpenExrInfo(embedded.replace('red(0.6400', 'red(0.7000'), version)).toThrow(
      /unsupported non-Rec\.709 chromaticities/,
    );
    for (const attribute of ['colorInteropID', 'renderingTransform', 'lookModTransform'])
      expect(() =>
        parseOpenExrInfo(
          openExrVerboseOutput().replace(
            "  compression: compression 'piz' (0x04)",
            `  ${attribute}: string 'unsupported'\n  compression: compression 'piz' (0x04)`,
          ),
          version,
        ),
      ).toThrow(/unsupported explicit colour transform metadata/);
  });

  it('doctor proves bounded OpenEXR inspection capability, not only a version string', async () => {
    let fixtureBytes: Uint8Array | undefined;
    const available = await checkOpenExrInspectorDependency(async (bytes) => {
      fixtureBytes = bytes;
      return parseOpenExrInfo(
        openExrVerboseOutput()
          .replace('2047 1023 ] 2048 x 1024', '1 0 ] 2 x 1')
          .replace('2047 1023 ] 2048 x 1024', '1 0 ] 2 x 1'),
        'exrinfo (OpenEXR) 3.4.15\nLicense BSD-3-Clause\n',
      );
    });
    expect(fixtureBytes?.subarray(0, 4)).toEqual(new Uint8Array([0x76, 0x2f, 0x31, 0x01]));
    expect(available).toMatchObject({ available: true, detail: expect.stringMatching(/-v -s/) });
    await expect(
      checkOpenExrInspectorDependency(async () => ({
        ...(await Promise.resolve(
          parseOpenExrInfo(
            openExrVerboseOutput(),
            'exrinfo (OpenEXR) 3.4.15\nLicense BSD-3-Clause\n',
          ),
        )),
      })),
    ).resolves.toMatchObject({
      available: false,
      detail: expect.stringMatching(/incorrect dimensions/),
    });
  });
});
