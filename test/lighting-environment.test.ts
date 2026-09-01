import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../src/lighting/adaptation.js';
import { createDuskExteriorLightingRig } from '../src/lighting/bookshop.js';
import { loadLightingRig, saveLightingRig } from '../src/lighting/io.js';
import { lightingRigSchema } from '../src/lighting/model.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import { saveCinematicScene } from '../src/cinematic/io.js';
import { verifyCinematicScene } from '../src/cinematic/verification.js';
import { fingerprintCinematicScene } from '../src/cinematic/fingerprint.js';

const radianceSource = {
  path: 'radiance/courtyard.hdr',
  sha256: 'a'.repeat(64),
  sizeBytes: 2048,
  mediaType: 'image/vnd.radiance' as const,
};

function radianceRig() {
  return lightingRigSchema.parse({
    ...createDuskExteriorLightingRig(),
    schemaVersion: 2,
    environmentIllumination: {
      kind: 'hash-bound-equirectangular-radiance',
      source: radianceSource,
      sourcePackage: {
        manifest: {
          path: 'environment-radiance-source.json',
          sha256: 'b'.repeat(64),
          sizeBytes: 1,
          mediaType: 'application/vnd.videoer.environment-radiance-source+json',
        },
      },
      colorSpace: 'scene-linear-rec709',
      projection: 'equirectangular',
      dimensions: { widthPixels: 2048, heightPixels: 1024 },
      yawDegrees: 170,
      exposureStops: 0.5,
    },
  });
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function sourcePackage(directory: string, radiance: Buffer) {
  const response = Buffer.from('{}');
  const licence = Buffer.from('<html>CC0 licence</html>');
  const assessment = Buffer.from('{"kind":"videoer-reviewed-provider-licence-assessment-v1"}');
  const archive = Buffer.from('source archive');
  await mkdir(join(directory, 'source'), { recursive: true });
  await mkdir(join(directory, 'radiance'), { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'source', 'api-response.json'), response),
    writeFile(join(directory, 'source', 'licence.json'), licence),
    writeFile(join(directory, 'source', 'licence-assessment.json'), assessment),
    writeFile(join(directory, 'source', 'archive.zip'), archive),
    writeFile(join(directory, 'radiance', 'courtyard.hdr'), radiance),
  ]);
  const manifest = {
    schemaVersion: 1,
    sourceIdentitySha256: 'c'.repeat(64),
    provider: 'ambientcg',
    adapterVersion: 'test.environment-source.v1',
    providerApi: {
      version: 'ambientcg-v3',
      requestUrl: 'https://example.com/api',
      finalUrl: 'https://example.com/api',
      responsePath: 'source/api-response.json',
      responseSha256: digest(response),
      retrievedAt: '2026-09-01T00:00:00.000Z',
    },
    asset: {
      id: 'test-environment',
      type: 'hdri',
      title: 'Test environment',
      pageUrl: 'https://example.com/environment',
      releaseDate: '2026-09-01',
      technique: 'procedural-test',
      tags: ['test'],
    },
    licence: {
      spdx: 'CC0-1.0',
      name: 'Creative Commons CC0 1.0 Universal',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      commercialUse: 'allowed',
      attributionRequired: false,
      providerEvidence: {
        requestedUrl: 'https://example.com/licence',
        finalUrl: 'https://example.com/licence',
        mediaType: 'text/html',
        path: 'source/licence.json',
        sha256: digest(licence),
        sizeBytes: licence.byteLength,
        retrievedAt: '2026-09-01T00:00:00.000Z',
      },
      adapterAssessment: {
        path: 'source/licence-assessment.json',
        sha256: digest(assessment),
        kind: 'videoer-reviewed-provider-licence-assessment-v1',
      },
    },
    selection: {
      resolution: '2K',
      encoding: 'HDR',
      archiveUrl: 'https://example.com/environment.zip',
      archiveFinalUrl: 'https://example.com/environment.zip',
      declaredSizeBytes: archive.byteLength,
    },
    sourceArchive: {
      path: 'source/archive.zip',
      sha256: digest(archive),
      sizeBytes: archive.byteLength,
      inventory: [
        {
          name: 'courtyard.hdr',
          compressedSizeBytes: radiance.byteLength,
          expandedSizeBytes: radiance.byteLength,
          compressionMethod: 0,
          selected: true,
          sha256: digest(radiance),
        },
      ],
    },
    radiance: {
      path: 'radiance/courtyard.hdr',
      archiveEntry: 'courtyard.hdr',
      mediaType: 'image/vnd.radiance',
      sha256: digest(radiance),
      sizeBytes: radiance.byteLength,
      encoding: 'radiance-rgbe',
      projection: 'equirectangular-latlong',
      orientation: '-Y +X',
      widthPixels: 2048,
      heightPixels: 1024,
      colorSpace: {
        name: 'scene-linear-rec709',
        transfer: 'linear',
        chromaticities: {
          red: [0.64, 0.33],
          green: [0.3, 0.6],
          blue: [0.15, 0.06],
          white: [0.3127, 0.329],
        },
        evidence: {
          mode: 'radiance-header-rec709',
          standard: 'Radiance File Formats',
          url: 'https://floyd.lbl.gov/radiance/refer/filefmts.pdf',
        },
      },
      pixelRange: {
        method: 'decoded-rgbe-luminance',
        minimumPositiveRadiance: 0.01,
        maximumRadiance: 10,
        dynamicRangeRatio: 1000,
      },
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(directory, 'environment-radiance-source.json'), manifestBytes);
  const rig = radianceRig();
  if (rig.environmentIllumination?.kind === 'hash-bound-equirectangular-radiance') {
    rig.environmentIllumination.source = {
      ...rig.environmentIllumination.source,
      sizeBytes: radiance.byteLength,
      sha256: digest(radiance),
    };
    rig.environmentIllumination.sourcePackage.manifest = {
      path: 'environment-radiance-source.json',
      sha256: digest(manifestBytes),
      sizeBytes: manifestBytes.byteLength,
      mediaType: 'application/vnd.videoer.environment-radiance-source+json',
    };
  }
  return rig;
}

describe('environment illumination contracts', () => {
  it('allows an environment to be the sole physical emitter but rejects an unlit rig', () => {
    const environmentRig = radianceRig();
    expect(
      lightingRigSchema.parse({
        ...radianceRig(),
        lights: [],
      }).lights,
    ).toEqual([]);
    expect(() =>
      lightingRigSchema.parse({
        ...createDuskExteriorLightingRig(),
        lights: [],
      }),
    ).toThrow();
    expect(() => lightingRigSchema.parse({ ...environmentRig, schemaVersion: 1 })).toThrow(
      /never|Invalid input/u,
    );
  });

  it('reads legacy v1 rigs while making the exposure transform explicit', () => {
    const legacy = createDuskExteriorLightingRig();
    const parsed = lightingRigSchema.parse({
      ...legacy,
      exposure: { look: 'AgX - Medium High Contrast', coherentAcrossShots: true },
    });
    expect(parsed.exposure).toEqual({
      viewTransform: 'AgX',
      look: 'AgX - Medium High Contrast',
      exposureStops: 0,
      coherentAcrossShots: true,
    });
    expect(parsed.environmentIllumination).toBeUndefined();
  });

  it('fails closed for non-portable, malformed, or non-2:1 radiance bindings', () => {
    const valid = radianceRig();
    expect(valid.environmentIllumination?.kind).toBe('hash-bound-equirectangular-radiance');
    for (const path of ['/tmp/map.hdr', '../map.hdr', 'maps\\map.hdr'])
      expect(() =>
        lightingRigSchema.parse({
          ...valid,
          environmentIllumination: {
            ...valid.environmentIllumination,
            source: { ...radianceSource, path },
          },
        }),
      ).toThrow(/normalized and relative/u);
    expect(() =>
      lightingRigSchema.parse({
        ...valid,
        environmentIllumination: {
          ...valid.environmentIllumination,
          dimensions: { widthPixels: 2000, heightPixels: 1024 },
        },
      }),
    ).toThrow(/exact 2:1/u);
  });

  it('supports an explicit bounded physical sky', () => {
    const rig = lightingRigSchema.parse({
      ...createDuskExteriorLightingRig(),
      schemaVersion: 2,
      environmentIllumination: {
        kind: 'physical-sky',
        model: 'nishita',
        sun: {
          azimuthDegrees: 35,
          elevationDegrees: 12,
          angularDiameterDegrees: 0.53,
          intensity: 1,
        },
        atmosphere: {
          altitudeMeters: 60,
          airDensity: 1,
          dustDensity: 1.8,
          ozoneDensity: 1,
          groundAlbedo: [0.18, 0.18, 0.18],
        },
        exposureStops: -0.5,
      },
    });
    expect(rig.environmentIllumination?.kind).toBe('physical-sky');
    expect(() =>
      lightingRigSchema.parse({
        ...rig,
        environmentIllumination: {
          ...rig.environmentIllumination,
          sun: { ...(rig.environmentIllumination as { sun: object }).sun, intensity: 101 },
        },
      }),
    ).toThrow();
  });

  it('adapts only bounded yaw and exposure while preserving radiance identity', () => {
    const base = radianceRig();
    const adaptation = {
      kind: 'lighting-rig-transform-v1' as const,
      assetId: 'lighting.radiance-adapted',
      environmentIllumination: { yawDegreesOffset: 20, exposureStopsOffset: 1 },
    };
    const adapted = adaptLightingRig(base, adaptation);
    expect(adapted.environmentIllumination).toMatchObject({ yawDegrees: -170, exposureStops: 1.5 });
    expect(adapted.environmentIllumination as typeof base.environmentIllumination).toMatchObject({
      source: radianceSource,
      dimensions: { widthPixels: 2048, heightPixels: 1024 },
    });
    const verification = verifyLightingRigAdaptation(base, adapted, adaptation);
    expect(verification.valid).toBe(true);
    expect(verification.environmentSourceIdentityPreserved).toBe(true);

    const forged = structuredClone(adapted);
    if (forged.environmentIllumination?.kind === 'hash-bound-equirectangular-radiance')
      forged.environmentIllumination.source.sha256 = 'b'.repeat(64);
    expect(verifyLightingRigAdaptation(base, forged, adaptation).valid).toBe(false);
  });

  it('rejects environment adaptation when the base has no environment', () => {
    expect(() =>
      adaptLightingRig(createDuskExteriorLightingRig(), {
        kind: 'lighting-rig-transform-v1',
        assetId: 'lighting.invalid-environment-adaptation',
        environmentIllumination: { yawDegreesOffset: 1, exposureStopsOffset: 0 },
      }),
    ).toThrow(/requires a base/u);
  });

  it('verifies hash and size when loading a bound radiance artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-lighting-'));
    const artifact = Buffer.from('deterministic radiance fixture');
    const artifactPath = join(directory, 'radiance', 'courtyard.hdr');
    const rig = await sourcePackage(directory, artifact);
    const rigPath = join(directory, 'lighting-rig.json');
    await saveLightingRig(rigPath, rig);
    await expect(loadLightingRig(rigPath)).resolves.toMatchObject({ id: rig.id });
    const manifestPath = join(directory, 'environment-radiance-source.json');
    const manifestBytes = await readFile(manifestPath);
    await writeFile(manifestPath, Buffer.concat([manifestBytes, Buffer.from(' ')]));
    await expect(loadLightingRig(rigPath)).rejects.toThrow(/source-package manifest/u);
    await writeFile(manifestPath, manifestBytes);
    await writeFile(artifactPath, Buffer.from('tampered radiance fixture'));
    await expect(loadLightingRig(rigPath)).rejects.toThrow(/sha256|byte size/u);
  });

  it('restages bound radiance portably when an adapted rig moves directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-lighting-transfer-'));
    const sourceDirectory = join(directory, 'library', 'source');
    const targetDirectory = join(directory, 'campaign', 'adapted');
    const artifact = Buffer.from('portable environment radiance');
    const base = await sourcePackage(sourceDirectory, artifact);
    const sourceRigPath = join(sourceDirectory, 'lighting-rig.json');
    await saveLightingRig(sourceRigPath, base);
    const adapted = adaptLightingRig(base, {
      kind: 'lighting-rig-transform-v1',
      assetId: 'lighting.portable-radiance-transfer',
      environmentIllumination: { yawDegreesOffset: 12, exposureStopsOffset: 0.5 },
    });
    const targetRigPath = join(targetDirectory, 'lighting-rig.json');
    await saveLightingRig(targetRigPath, adapted, { environmentSourceRigPath: sourceRigPath });

    expect(await readFile(join(targetDirectory, 'radiance', 'courtyard.hdr'))).toEqual(artifact);
    expect(await readFile(join(targetDirectory, 'source', 'licence.json'))).toEqual(
      Buffer.from('<html>CC0 licence</html>'),
    );
    await expect(loadLightingRig(targetRigPath)).resolves.toMatchObject({ id: adapted.id });
    expect((await loadLightingRig(targetRigPath)).environmentIllumination).toMatchObject({
      source: { path: 'radiance/courtyard.hdr' },
      yawDegrees: -178,
      exposureStops: 1,
    });

    const collisionDirectory = join(directory, 'campaign', 'collision');
    await mkdir(join(collisionDirectory, 'source'), { recursive: true });
    await writeFile(join(collisionDirectory, 'source', 'licence.json'), 'different licence');
    await expect(
      saveLightingRig(join(collisionDirectory, 'lighting-rig.json'), adapted, {
        environmentSourceRigPath: sourceRigPath,
      }),
    ).rejects.toThrow(/artifact collision/u);
    expect(await readFile(join(collisionDirectory, 'source', 'licence.json'), 'utf8')).toBe(
      'different licence',
    );
    await expect(
      readFile(join(collisionDirectory, 'environment-radiance-source.json')),
    ).rejects.toThrow();
  });

  it('binds an environment-only rig and its exact radiance bytes into scene verification and fingerprints', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-cinematic-environment-lighting-'));
    const artifact = Buffer.from('scene-bound environment radiance');
    const rig = await sourcePackage(join(directory, 'lighting'), artifact);
    rig.lights = [];
    await saveLightingRig(join(directory, 'lighting', 'lighting-rig.json'), rig);
    await writeFile(
      join(directory, 'witness.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        id: 'prop.environment-lighting-witness',
        units: 'meters',
        coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
        positions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        indices: [0, 1, 2],
      })}\n`,
    );
    const scene = cinematicSceneSchema.parse({
      schemaVersion: 2,
      id: 'scene.environment-only',
      durationSeconds: 1,
      fps: 24,
      resolution: { width: 64, height: 64 },
      entities: [
        {
          id: 'witness',
          role: 'prop',
          geometryPath: 'witness.json',
        },
      ],
      camera: {
        keyframes: [
          { time: 0, position: [0, 1, -3], target: [0, 0, 0], lensMillimeters: 50 },
          { time: 1, position: [0, 1, -3], target: [0, 0, 0], lensMillimeters: 50 },
        ],
      },
      lightingRigPath: 'lighting/lighting-rig.json',
      lights: [],
      atmosphere: {},
      landmarks: [
        { id: 'start', progress: 0, description: 'start' },
        { id: 'end', progress: 1, description: 'end' },
      ],
    });
    const scenePath = await saveCinematicScene(join(directory, 'scene.json'), scene);
    const verification = await verifyCinematicScene(scene, scenePath);
    expect(verification.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lighting-rig-binding', status: 'pass' }),
      ]),
    );
    const fingerprint = await fingerprintCinematicScene(scenePath);
    expect(fingerprint.sceneFile).toBe('scene.json');
    expect(fingerprint.artifacts.every((entry) => !entry.path.startsWith('/'))).toBe(true);
    expect(fingerprint.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'lighting-rig' }),
        expect.objectContaining({ role: 'lighting-source-package-manifest' }),
        expect.objectContaining({ role: 'lighting-source-package-api-response' }),
        expect.objectContaining({ role: 'lighting-source-package-provider-licence-evidence' }),
        expect.objectContaining({ role: 'lighting-source-package-licence-assessment' }),
        expect.objectContaining({ role: 'lighting-source-package-archive' }),
        expect.objectContaining({ role: 'lighting-source-package-radiance' }),
      ]),
    );
    await writeFile(join(directory, 'lighting', 'source', 'licence.json'), 'tampered licence');
    await expect(fingerprintCinematicScene(scenePath)).rejects.toThrow(/sha256|byte size/u);
  });
});
