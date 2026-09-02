import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalSha256, sha256Bytes } from '../src/assets/sources/cache.js';
import {
  openMaterialSourceManifestSchema,
  type MaterialTextureChannel,
} from '../src/assets/sources/model.js';
import { fingerprintCinematicScene } from '../src/cinematic/fingerprint.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import { verifyCinematicScene } from '../src/cinematic/verification.js';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import {
  surfaceMaterialSchema,
  textureMaterialApplicationSchema,
  type TextureMaterialApplication,
} from '../src/materials/model.js';
import {
  assessTextureMaterialSuitability,
  bindStagedSurfaceMaterial,
  deriveTextureSurfaceMaterial,
} from '../src/materials/texture-maps.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';
import { saveSurfaceMaterial } from '../src/materials/io.js';
import { adaptSurfaceMaterial } from '../src/materials/adaptation.js';

const exec = promisify(execFile);

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

async function sourcePackage(options: { unknownScale?: boolean } = {}) {
  directory = await mkdtemp(join(tmpdir(), 'videoer-texture-material-'));
  const root = join(directory, 'source-package');
  await mkdir(join(root, 'source'), { recursive: true });
  await mkdir(join(root, 'textures'), { recursive: true });
  const response = Buffer.from('{"fixture":"ambientcg-v3"}\n');
  const evidence = Buffer.from('{"licence":"CC0-1.0"}\n');
  const archive = Buffer.from('fixture-source-archive');
  await writeFile(join(root, 'source/api-response.json'), response);
  await writeFile(join(root, 'source/licence-evidence.json'), evidence);
  await writeFile(join(root, 'source/archive.zip'), archive);
  const definitions: Array<{
    semantic: MaterialTextureChannel['semantic'];
    providerName: string;
    colorSpace: MaterialTextureChannel['colorSpace'];
  }> = [
    { semantic: 'base-color', providerName: 'Color', colorSpace: 'srgb-texture' },
    { semantic: 'normal', providerName: 'NormalGL', colorSpace: 'non-color' },
    { semantic: 'roughness', providerName: 'Roughness', colorSpace: 'non-color' },
    { semantic: 'ambient-occlusion', providerName: 'AmbientOcclusion', colorSpace: 'non-color' },
    { semantic: 'displacement', providerName: 'Displacement', colorSpace: 'non-color' },
    { semantic: 'metallic', providerName: 'Metalness', colorSpace: 'non-color' },
    { semantic: 'opacity', providerName: 'Opacity', colorSpace: 'non-color' },
  ];
  const channels: MaterialTextureChannel[] = [];
  for (const definition of definitions) {
    const bytes = Buffer.from(`fixture-${definition.semantic}`);
    const path = `textures/${definition.semantic}.png`;
    await writeFile(join(root, path), bytes);
    channels.push({
      ...definition,
      path,
      mediaType: 'image/png',
      sha256: sha256Bytes(bytes),
      sizeBytes: bytes.byteLength,
      ...(definition.semantic === 'normal'
        ? { normalConvention: 'opengl-positive-green' as const }
        : {}),
    });
  }
  const manifest = openMaterialSourceManifestSchema.parse({
    schemaVersion: 1,
    sourceIdentitySha256: '0'.repeat(64),
    provider: 'ambientcg',
    adapterVersion: 'fixture-adapter-v1',
    providerApi: {
      version: 'ambientcg-v3',
      requestUrl: 'https://ambientcg.fixture.invalid/api/v3/assets?id=PavingStones036',
      responsePath: 'source/api-response.json',
      responseSha256: sha256Bytes(response),
      retrievedAt: '2026-09-01T12:00:00.000Z',
    },
    asset: {
      id: 'PavingStones036',
      type: 'material',
      title: 'Paving Stones 036',
      pageUrl: 'https://ambientcg.com/a/PavingStones036',
      releaseDate: '2018-11-28',
      tags: ['paving', 'stone'],
    },
    licence: {
      spdx: 'CC0-1.0',
      name: 'Creative Commons CC0 1.0 Universal',
      url: 'https://docs.ambientcg.com/license/',
      commercialUse: 'allowed',
      attributionRequired: false,
      evidencePath: 'source/licence-evidence.json',
      evidenceSha256: sha256Bytes(evidence),
    },
    selection: {
      resolution: '1K',
      encoding: 'PNG',
      archiveUrl: 'https://ambientcg.fixture.invalid/PavingStones036.zip',
      declaredSizeBytes: archive.byteLength,
    },
    sourceArchive: {
      path: 'source/archive.zip',
      sha256: sha256Bytes(archive),
      sizeBytes: archive.byteLength,
      inventory: channels.map((channel) => ({
        name: channel.path,
        compressedSizeBytes: channel.sizeBytes,
        expandedSizeBytes: channel.sizeBytes,
        compressionMethod: 0,
        selected: true,
        sha256: channel.sha256,
      })),
    },
    physicalScale: options.unknownScale
      ? { status: 'unknown', reason: 'fixture has no provider scale evidence' }
      : { status: 'known', widthMeters: 1.1, heightMeters: 1.1, source: 'fixture' },
    channels,
  });
  manifest.sourceIdentitySha256 = canonicalSha256({
    schemaVersion: 1,
    provider: manifest.provider,
    adapterVersion: manifest.adapterVersion,
    assetId: manifest.asset.id,
    variant: `${manifest.selection.resolution}-${manifest.selection.encoding}`,
    requestUrl: manifest.providerApi.requestUrl,
    responseSha256: manifest.providerApi.responseSha256,
    archiveSha256: manifest.sourceArchive.sha256,
    archiveUrl: manifest.selection.archiveUrl,
    declaredSizeBytes: manifest.selection.declaredSizeBytes,
  });
  const manifestPath = join(root, 'material-source.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest, manifestPath };
}

const flatGroundSuitability = {
  composition: 'continuous-layout-scan' as const,
  intendedConstructionDomains: ['flat-ground-surface' as const],
  rationale: 'The source records a complete paving layout intended for a flat ground host.',
};

const calibratedDisplacement = {
  policy: 'calibrated' as const,
  amplitudeMeters: 0.003,
  midpoint: 0.43,
  positiveDirection: 'higher-values-outward' as const,
  evidence: {
    basis: 'project-calibration' as const,
    reference: 'fixture metre reference v1',
  },
};

const flatGroundApplication: TextureMaterialApplication = {
  constructionDomain: 'flat-ground-surface',
  placement: {
    scalePolicy: 'preserve-source-physical-scale',
    orientation: 'world-horizontal',
    offsetMeters: [0.17, -0.31],
    rotationDegrees: 90,
    appearance: {
      exposureStops: -0.15,
      saturationScale: 0.9,
      hueShiftDegrees: 0,
      roughnessScale: 1.05,
      roughnessOffset: 0.02,
      weatheringAmount: 0.25,
    },
    macroVariation: {
      seed: 1847,
      scaleMeters: 4,
      valueAmplitude: 0.12,
      saturationAmplitude: 0.08,
      hueAmplitudeDegrees: 2,
      roughnessAmplitude: 0.1,
      weatheringAmplitude: 0.25,
    },
  },
};

function fixtureGeometry() {
  const geometry = mergeMeshParts(
    'environment.texture-material-fixture',
    [boxPart([-1, 0, -1], [1, 0.1, 1], 0, 'ground')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {},
  );
  geometry.materials = [
    {
      id: 'ground',
      baseColor: [0.2, 0.2, 0.2, 1],
      roughness: 0.5,
      metallic: 0,
      emission: [0, 0, 0],
      emissionStrength: 0,
    },
  ];
  return geometry;
}

describe('hash-bound texture surface materials', () => {
  it('rejects double-pattern and facade-host mismatches while accepting a homogeneous unit source', async () => {
    const source = await sourcePackage();
    const materialPath = join(directory, 'suitability/material.json');
    const derived = await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.suitability-fixture',
      sourceManifestPath: source.manifestPath,
      outputMaterialPath: materialPath,
      suitability: {
        composition: 'continuous-layout-scan',
        intendedConstructionDomains: [
          'flat-ground-surface',
          'modeled-paving-unit',
          'paving-joint-substrate',
          'flat-facade-surface',
          'modeled-masonry-unit',
        ],
        rationale:
          'Fixture intentionally declares broad domains so structural rejection is tested.',
      },
      displacementResponse: calibratedDisplacement,
    });
    const modeledSetts = structuredClone(flatGroundApplication);
    modeledSetts.constructionDomain = 'modeled-paving-unit';
    modeledSetts.placement.orientation = 'unit-local-uv-meters';
    expect(assessTextureMaterialSuitability(derived.material, modeledSetts)).toMatchObject({
      accepted: false,
      reasons: [
        expect.objectContaining({ code: 'layout-scan-on-modeled-units' }),
        expect.objectContaining({
          code: 'unit-local-mapping-requires-homogeneous-unit-material',
        }),
      ],
    });

    const facadePattern = structuredClone(derived.material);
    facadePattern.textureMaps!.suitability.composition = 'facade-course-pattern';
    expect(assessTextureMaterialSuitability(facadePattern, flatGroundApplication)).toMatchObject({
      accepted: false,
      reasons: [expect.objectContaining({ code: 'facade-pattern-on-non-facade' })],
    });

    const homogeneous = structuredClone(derived.material);
    homogeneous.textureMaps!.suitability.composition = 'homogeneous-unit-material';
    expect(assessTextureMaterialSuitability(homogeneous, modeledSetts)).toMatchObject({
      accepted: true,
      reasons: [],
    });
    const modeledMasonry = structuredClone(modeledSetts);
    modeledMasonry.constructionDomain = 'modeled-masonry-unit';
    expect(assessTextureMaterialSuitability(homogeneous, modeledMasonry)).toMatchObject({
      accepted: true,
      reasons: [],
    });

    const worldMappedSetts = structuredClone(modeledSetts);
    worldMappedSetts.placement.orientation = 'world-horizontal';
    expect(assessTextureMaterialSuitability(homogeneous, worldMappedSetts)).toMatchObject({
      accepted: false,
      reasons: [
        expect.objectContaining({
          code: 'modeled-paving-unit-requires-unit-local-mapping',
        }),
      ],
    });

    const unitMappedFlatGround = structuredClone(flatGroundApplication);
    unitMappedFlatGround.placement.orientation = 'unit-local-uv-meters';
    expect(assessTextureMaterialSuitability(homogeneous, unitMappedFlatGround)).toMatchObject({
      accepted: false,
      reasons: [expect.objectContaining({ code: 'unit-local-mapping-on-non-modeled-unit' })],
    });

    const jointBed = structuredClone(flatGroundApplication);
    jointBed.constructionDomain = 'paving-joint-substrate';
    expect(assessTextureMaterialSuitability(homogeneous, jointBed)).toMatchObject({
      accepted: true,
      reasons: [],
    });
    expect(assessTextureMaterialSuitability(derived.material, jointBed)).toMatchObject({
      accepted: false,
      reasons: [
        expect.objectContaining({
          code: 'paving-joint-substrate-composition-incompatible',
        }),
      ],
    });
    expect(assessTextureMaterialSuitability(facadePattern, jointBed)).toMatchObject({
      accepted: false,
      reasons: [
        expect.objectContaining({ code: 'facade-pattern-on-non-facade' }),
        expect.objectContaining({
          code: 'paving-joint-substrate-composition-incompatible',
        }),
      ],
    });
    const uvAuthoredJointBed = structuredClone(jointBed);
    uvAuthoredJointBed.placement.orientation = 'uv-authored';
    expect(assessTextureMaterialSuitability(homogeneous, uvAuthoredJointBed)).toMatchObject({
      accepted: false,
      reasons: [
        expect.objectContaining({
          code: 'paving-joint-substrate-requires-world-horizontal',
        }),
      ],
    });
    const uvAuthoredFlatGround = structuredClone(flatGroundApplication);
    uvAuthoredFlatGround.placement.orientation = 'uv-authored';
    expect(assessTextureMaterialSuitability(derived.material, uvAuthoredFlatGround)).toMatchObject({
      accepted: true,
      reasons: [],
    });

    expect(() =>
      textureMaterialApplicationSchema.parse({
        ...flatGroundApplication,
        placement: {
          ...flatGroundApplication.placement,
          appearance: { ...flatGroundApplication.placement.appearance, exposureStops: 1.1 },
        },
      }),
    ).toThrow();
    const tileScaleVariation = structuredClone(flatGroundApplication);
    tileScaleVariation.placement.macroVariation.scaleMeters = 1.5;
    expect(assessTextureMaterialSuitability(derived.material, tileScaleVariation)).toMatchObject({
      accepted: false,
      reasons: [expect.objectContaining({ code: 'macro-variation-scale-too-small' })],
    });
  });

  it('exposes derivation and suitability assessment through stable provider-free CLI JSON', async () => {
    const source = await sourcePackage();
    const basePath = join(directory, 'operator/base.json');
    const suitabilityPath = join(directory, 'operator/suitability.json');
    const applicationPath = join(directory, 'operator/application.json');
    const displacementResponsePath = join(directory, 'operator/displacement-response.json');
    const outputPath = join(directory, 'operator/derived/material.json');
    await saveSurfaceMaterial(basePath, createWetCobbleSurfaceMaterial());
    await writeFile(suitabilityPath, `${JSON.stringify(flatGroundSuitability, null, 2)}\n`);
    await writeFile(applicationPath, `${JSON.stringify(flatGroundApplication, null, 2)}\n`);
    await writeFile(
      displacementResponsePath,
      `${JSON.stringify(calibratedDisplacement, null, 2)}\n`,
    );
    const derived = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'material',
      'derive-texture',
      basePath,
      source.manifestPath,
      outputPath,
      '--id',
      'material.operator-texture-fixture',
      '--suitability',
      suitabilityPath,
      '--displacement-response',
      displacementResponsePath,
    ]);
    expect(JSON.parse(derived.stdout)).toMatchObject({
      version: 1,
      ok: true,
      command: 'material.derive-texture',
      data: { material: { id: 'material.operator-texture-fixture' } },
    });
    const assessed = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'material',
      'assess-texture-suitability',
      outputPath,
      '--application',
      applicationPath,
    ]);
    expect(JSON.parse(assessed.stdout)).toMatchObject({
      version: 1,
      ok: true,
      command: 'material.assess-texture-suitability',
      data: { accepted: true, reasons: [] },
    });
  }, 15_000);

  it('derives and stages every supported channel with explicit scale, colorspace, and portable paths', async () => {
    const source = await sourcePackage();
    const materialPath = join(directory, 'derived/material.json');
    const derived = await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.paving-stones-036',
      sourceManifestPath: source.manifestPath,
      outputMaterialPath: materialPath,
      suitability: flatGroundSuitability,
      displacementResponse: calibratedDisplacement,
    });
    expect(derived.material.textureMaps).toMatchObject({
      kind: 'hash-bound',
      physicalScale: { widthMeters: 1.1, heightMeters: 1.1 },
      displacementResponse: calibratedDisplacement,
      source: {
        provider: 'ambientcg',
        sourceIdentitySha256: source.manifest.sourceIdentitySha256,
        licenceSpdx: 'CC0-1.0',
      },
    });
    expect(derived.material.textureMaps?.channels.map((channel) => channel.semantic)).toEqual([
      'base-color',
      'normal',
      'roughness',
      'ambient-occlusion',
      'displacement',
      'metallic',
      'opacity',
    ]);
    expect(
      derived.material.textureMaps?.channels.every(
        (channel) => !channel.path.startsWith('/') && !channel.path.includes('..'),
      ),
    ).toBe(true);
    expect(
      derived.material.textureMaps?.channels.find((channel) => channel.semantic === 'base-color'),
    ).toMatchObject({ colorSpace: 'srgb-texture' });
    expect(
      derived.material.textureMaps?.channels.find((channel) => channel.semantic === 'normal'),
    ).toMatchObject({
      colorSpace: 'non-color',
      normalConvention: 'opengl-positive-green',
    });
    expect(createWetCobbleSurfaceMaterial()).not.toHaveProperty('textureMaps');
    const missingResponse = structuredClone(derived.material);
    delete missingResponse.textureMaps!.displacementResponse;
    expect(() => surfaceMaterialSchema.parse(missingResponse)).toThrow(
      /explicit calibrated or disabled-uncalibrated response/u,
    );
    const responseWithoutMap = structuredClone(derived.material);
    responseWithoutMap.textureMaps!.channels = responseWithoutMap.textureMaps!.channels.filter(
      (channel) => channel.semantic !== 'displacement',
    );
    expect(() => surfaceMaterialSchema.parse(responseWithoutMap)).toThrow(
      /response requires a displacement texture channel/u,
    );
    const excessiveAmplitude = structuredClone(derived.material);
    if (excessiveAmplitude.textureMaps!.displacementResponse?.policy === 'calibrated')
      excessiveAmplitude.textureMaps!.displacementResponse.amplitudeMeters = 1.2;
    expect(() => surfaceMaterialSchema.parse(excessiveAmplitude)).toThrow(
      /must not exceed the largest physical tile dimension/u,
    );
    const changedNormalScale = structuredClone(derived.material);
    changedNormalScale.normal.scaleMeters = 0.75;
    expect(changedNormalScale.textureMaps!.displacementResponse).toEqual(calibratedDisplacement);
    const adaptedNormal = adaptSurfaceMaterial(derived.material, {
      assetId: 'material.paving-stones-036.normal-adaptation',
      normal: { scaleMeters: 0.75 },
    });
    expect(adaptedNormal.textureMaps?.displacementResponse).toEqual(calibratedDisplacement);
    await writeFile(materialPath, 'different material bytes');
    await expect(
      deriveTextureSurfaceMaterial({
        base: createWetCobbleSurfaceMaterial(),
        assetId: 'material.paving-stones-036',
        sourceManifestPath: source.manifestPath,
        outputMaterialPath: materialPath,
        suitability: flatGroundSuitability,
        displacementResponse: calibratedDisplacement,
      }),
    ).rejects.toThrow(/staging target already contains different bytes/);
  });

  it('requires an explicit displacement policy and preserves a disabled source without enabling it', async () => {
    const source = await sourcePackage();
    await expect(
      deriveTextureSurfaceMaterial({
        base: createWetCobbleSurfaceMaterial(),
        assetId: 'material.missing-displacement-policy',
        sourceManifestPath: source.manifestPath,
        outputMaterialPath: join(directory, 'missing-policy/material.json'),
        suitability: flatGroundSuitability,
      }),
    ).rejects.toThrow(/explicit calibrated or disabled-uncalibrated displacement response/u);
    const disabled = await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.disabled-displacement',
      sourceManifestPath: source.manifestPath,
      outputMaterialPath: join(directory, 'disabled/material.json'),
      suitability: flatGroundSuitability,
      displacementResponse: {
        policy: 'disabled-uncalibrated',
        rationale: 'No physical height calibration exists for this source fixture.',
      },
    });
    expect(disabled.material.textureMaps?.displacementResponse).toEqual({
      policy: 'disabled-uncalibrated',
      rationale: 'No physical height calibration exists for this source fixture.',
    });
    expect(
      disabled.material.textureMaps?.channels.some(
        (channel) => channel.semantic === 'displacement',
      ),
    ).toBe(true);
  });

  it('stages only valid unit-local paving and world-horizontal joint applications', async () => {
    const source = await sourcePackage();
    const materialPath = join(directory, 'unit-material/material.json');
    await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.homogeneous-paving-fixture',
      sourceManifestPath: source.manifestPath,
      outputMaterialPath: materialPath,
      suitability: {
        composition: 'homogeneous-unit-material',
        intendedConstructionDomains: ['modeled-paving-unit', 'paving-joint-substrate'],
        rationale: 'Fixture isolates the modeled unit and continuous joint-bed mapping contracts.',
      },
      displacementResponse: calibratedDisplacement,
    });
    const unitApplication = structuredClone(flatGroundApplication);
    unitApplication.constructionDomain = 'modeled-paving-unit';
    unitApplication.placement.orientation = 'unit-local-uv-meters';
    const unitBound = await bindStagedSurfaceMaterial({
      geometry: fixtureGeometry(),
      targetMaterialId: 'ground',
      surfaceMaterialPath: materialPath,
      outputGeometryPath: join(directory, 'unit-bound/geometry.json'),
      application: unitApplication,
    });
    expect(unitBound.geometry.materials[0]!.surface!.textureMaps!.application).toMatchObject(
      unitApplication,
    );

    const jointApplication = structuredClone(flatGroundApplication);
    jointApplication.constructionDomain = 'paving-joint-substrate';
    const jointBound = await bindStagedSurfaceMaterial({
      geometry: fixtureGeometry(),
      targetMaterialId: 'ground',
      surfaceMaterialPath: materialPath,
      outputGeometryPath: join(directory, 'joint-bound/geometry.json'),
      application: jointApplication,
    });
    expect(jointBound.geometry.materials[0]!.surface!.textureMaps!.application).toMatchObject(
      jointApplication,
    );

    const invalidUnitApplication = structuredClone(unitApplication);
    invalidUnitApplication.placement.orientation = 'world-horizontal';
    await expect(
      bindStagedSurfaceMaterial({
        geometry: fixtureGeometry(),
        targetMaterialId: 'ground',
        surfaceMaterialPath: materialPath,
        outputGeometryPath: join(directory, 'invalid-unit-bound/geometry.json'),
        application: invalidUnitApplication,
      }),
    ).rejects.toThrow(/modeled-paving-unit-requires-unit-local-mapping/);

    const invalidJointApplication = structuredClone(jointApplication);
    invalidJointApplication.placement.orientation = 'unit-local-uv-meters';
    await expect(
      bindStagedSurfaceMaterial({
        geometry: fixtureGeometry(),
        targetMaterialId: 'ground',
        surfaceMaterialPath: materialPath,
        outputGeometryPath: join(directory, 'invalid-joint-bound/geometry.json'),
        application: invalidJointApplication,
      }),
    ).rejects.toThrow(/unit-local-mapping-on-non-modeled-unit/);
  });

  it('stages maps beside geometry and makes cinematic verification and fingerprints transitive', async () => {
    const source = await sourcePackage();
    const materialPath = join(directory, 'derived/material.json');
    await deriveTextureSurfaceMaterial({
      base: createWetCobbleSurfaceMaterial(),
      assetId: 'material.paving-stones-036',
      sourceManifestPath: source.manifestPath,
      outputMaterialPath: materialPath,
      suitability: flatGroundSuitability,
      displacementResponse: calibratedDisplacement,
    });
    const sceneDirectory = join(directory, 'scene');
    const geometryPath = join(sceneDirectory, 'ground.json');
    const bound = await bindStagedSurfaceMaterial({
      geometry: fixtureGeometry(),
      targetMaterialId: 'ground',
      surfaceMaterialPath: materialPath,
      outputGeometryPath: geometryPath,
      application: flatGroundApplication,
    });
    const channels = bound.geometry.materials[0]!.surface!.textureMaps!.channels;
    expect(channels.every((channel) => channel.path.startsWith('textures/'))).toBe(true);
    const scene = cinematicSceneSchema.parse({
      schemaVersion: 1,
      id: 'scene.texture-material-fixture',
      durationSeconds: 1,
      fps: 24,
      resolution: { width: 320, height: 180, percentage: 100 },
      entities: [
        {
          id: 'ground',
          role: 'environment',
          geometryPath: relative(sceneDirectory, geometryPath),
        },
      ],
      camera: {
        keyframes: [
          { time: 0, position: [0, 2, 4], target: [0, 0, 0], lensMillimeters: 50 },
          { time: 1, position: [0, 2, 4], target: [0, 0, 0], lensMillimeters: 50 },
        ],
      },
      lights: [
        {
          id: 'key',
          type: 'area',
          position: [0, 3, 2],
          color: [1, 1, 1],
          energy: 100,
        },
      ],
      landmarks: [
        { id: 'start', progress: 0, description: 'start' },
        { id: 'end', progress: 1, description: 'end' },
      ],
    });
    const scenePath = join(sceneDirectory, 'scene.json');
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
    const fingerprint = await fingerprintCinematicScene(scenePath);
    expect(
      fingerprint.artifacts.filter((artifact) => artifact.role.startsWith('texture:')),
    ).toHaveLength(7);
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({
      status: 'pass',
      checks: [expect.objectContaining({ id: 'ground.texture-dependencies', status: 'pass' })],
    });

    const rotatedGeometry = structuredClone(bound.geometry);
    rotatedGeometry.materials[0]!.surface!.textureMaps!.application!.placement.rotationDegrees = 45;
    await writeFile(geometryPath, `${JSON.stringify(rotatedGeometry, null, 2)}\n`);
    const rotatedFingerprint = await fingerprintCinematicScene(scenePath);
    expect(rotatedFingerprint.renderSha256).not.toBe(fingerprint.renderSha256);

    const recalibratedGeometry = structuredClone(bound.geometry);
    const response = recalibratedGeometry.materials[0]!.surface!.textureMaps!.displacementResponse;
    if (response?.policy === 'calibrated') response.amplitudeMeters = 0.004;
    await writeFile(geometryPath, `${JSON.stringify(recalibratedGeometry, null, 2)}\n`);
    const recalibratedFingerprint = await fingerprintCinematicScene(scenePath);
    expect(recalibratedFingerprint.renderSha256).not.toBe(fingerprint.renderSha256);

    const baseColor = channels.find((channel) => channel.semantic === 'base-color')!;
    await writeFile(join(sceneDirectory, baseColor.path), 'tampered texture bytes');
    await expect(fingerprintCinematicScene(scenePath)).rejects.toThrow(/(?:size|hash) mismatch/);
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({
      status: 'fail',
      checks: [expect.objectContaining({ id: 'ground.texture-dependencies', status: 'fail' })],
    });
  });

  it('fails closed on missing maps, path escape, and unknown physical scale', async () => {
    const forgedIdentity = await sourcePackage();
    forgedIdentity.manifest.sourceIdentitySha256 = 'f'.repeat(64);
    await writeFile(
      forgedIdentity.manifestPath,
      `${JSON.stringify(forgedIdentity.manifest, null, 2)}\n`,
    );
    await expect(
      deriveTextureSurfaceMaterial({
        base: createWetCobbleSurfaceMaterial(),
        assetId: 'material.forged-identity',
        sourceManifestPath: forgedIdentity.manifestPath,
        outputMaterialPath: join(directory, 'forged/material.json'),
        suitability: flatGroundSuitability,
        displacementResponse: calibratedDisplacement,
      }),
    ).rejects.toThrow(/source identity mismatch/);

    const missing = await sourcePackage();
    await unlink(join(missing.root, missing.manifest.channels[0]!.path));
    await expect(
      deriveTextureSurfaceMaterial({
        base: createWetCobbleSurfaceMaterial(),
        assetId: 'material.missing-map',
        sourceManifestPath: missing.manifestPath,
        outputMaterialPath: join(directory, 'missing/material.json'),
        suitability: flatGroundSuitability,
        displacementResponse: calibratedDisplacement,
      }),
    ).rejects.toThrow(/missing/);

    const base = createWetCobbleSurfaceMaterial();
    expect(() =>
      surfaceMaterialSchema.parse({
        ...base,
        textureMaps: {
          kind: 'hash-bound',
          source: {
            provider: 'ambientcg',
            sourceIdentitySha256: '0'.repeat(64),
            manifestSha256: '1'.repeat(64),
            licenceSpdx: 'CC0-1.0',
          },
          physicalScale: { widthMeters: 1, heightMeters: 1 },
          suitability: flatGroundSuitability,
          channels: ['base-color', 'normal', 'roughness'].map((semantic) => ({
            semantic,
            providerName: semantic,
            path: '../escape.png',
            mediaType: 'image/png',
            sha256: '2'.repeat(64),
            sizeBytes: 10,
            colorSpace: semantic === 'base-color' ? 'srgb-texture' : 'non-color',
            ...(semantic === 'normal' ? { normalConvention: 'opengl-positive-green' } : {}),
          })),
        },
      }),
    ).toThrow(/normalized relative path/);

    const unknown = await sourcePackage({ unknownScale: true });
    await expect(
      deriveTextureSurfaceMaterial({
        base,
        assetId: 'material.unknown-scale',
        sourceManifestPath: unknown.manifestPath,
        outputMaterialPath: join(directory, 'unknown/material.json'),
        suitability: flatGroundSuitability,
        displacementResponse: calibratedDisplacement,
      }),
    ).rejects.toThrow(/unknown physical scale/);
  });
});
