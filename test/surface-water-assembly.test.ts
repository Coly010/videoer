import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256File } from '../src/assets/library.js';
import {
  createPavingSurfaceWaterField,
  createSurfaceWaterOpticalSurface,
  rebindCinematicSurfaceWaterReceiver,
  rebindSurfaceWaterAssemblyProfile,
  surfaceWaterAssemblyProfileSchema,
} from '../src/application/surface-water.js';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import {
  createContemporaryPaverDefinition,
  compileIrregularPaving,
} from '../src/environments/irregular-paving.js';
import { saveGeometry } from '../src/geometry/io.js';
import { createRainyDuskVfx } from '../src/vfx/rainy-dusk.js';
import { saveAtmosphericVfx } from '../src/vfx/io.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import { saveCinematicScene } from '../src/cinematic/io.js';
import { verifyCinematicScene } from '../src/cinematic/verification.js';
import { fingerprintCinematicScene } from '../src/cinematic/fingerprint.js';
import { createPavingGranularSurfaceMaterial } from '../src/materials/paving-joint.js';
import { createPavingSurfaceHistoryField } from '../src/application/surface-history.js';

const temporaryDirectories: string[] = [];
const exec = promisify(execFile);
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('paving surface-water assembly', () => {
  it('loads exact hash-bound inputs, derives target classes, and persists structural evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-surface-water-'));
    temporaryDirectories.push(directory);
    // This fixture exercises every contemporary target class, including the
    // utility repair and both borders, without compiling the full transfer-host
    // acreage in a contract test that also launches two independent CLI runs.
    const definition = createContemporaryPaverDefinition();
    definition.boundary = { kind: 'rectangle', minimum: [-3, -4.8], maximum: [4, -1] };
    const generated = compileIrregularPaving(definition);
    const targets = generated.report.surfaceMaterialTargets;
    const jointMaterial = generated.geometry.materials.find(
      (material) => material.id === targets.continuousJoint,
    )!;
    jointMaterial.surface = createPavingGranularSurfaceMaterial('natural-grit');
    const geometryPath = await saveGeometry(join(directory, 'paving.json'), generated.geometry);
    const vfxPath = await saveAtmosphericVfx(join(directory, 'rain.json'), createRainyDuskVfx());
    const targetClass = (materialId: string) => {
      if (targets.modeledUnits.includes(materialId)) return 'modeled-unit' as const;
      if (targets.continuousJoint === materialId) return 'joint' as const;
      if (targets.continuousSubstrate === materialId) return 'substrate' as const;
      return 'border' as const;
    };
    const responses = Object.fromEntries(
      generated.geometry.materials
        .filter((material) => material.id !== targets.continuousJoint)
        .map((material) => [
          material.id,
          {
            targetClass: targetClass(material.id),
            absorption: {
              capacityMeters: material.id === targets.continuousJoint ? 0.004 : 0.001,
              rateMetersPerSecond: material.id === targets.continuousJoint ? 0.00004 : 0.00001,
              initialSaturation: 0.2,
            },
            retention: {
              filmCapacityMeters: 0.0006,
              edgeCapacityMeters: 0.0015,
              maximumPuddleDepthMeters: 0.02,
            },
            wetRoughness: { dry: material.roughness, multiplier: 0.38, floor: 0.05 },
            splash: { minimumFreeWaterDepthMeters: 0.0003, maximumSlopeDegrees: 10 },
          },
        ]),
    );
    const profile = surfaceWaterAssemblyProfileSchema.parse({
      schemaVersion: 1,
      id: 'environment.contemporary-paver-water-field',
      receiverSha256: await sha256File(geometryPath),
      atmosphericVfxSha256: await sha256File(vfxPath),
      receiverTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      materialResponses: responses,
      shelters: [],
      grid: { cellSizeMeters: 0.24, supersample: 4, shelterRayMaximumMeters: 30 },
      solver: { edgeHeightThresholdMeters: 0.0025, maximumCellCount: 10_000 },
    });
    const sourceProfilePath = join(directory, 'source-profile.json');
    await writeFile(sourceProfilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    const reboundProfilePath = join(directory, 'derived', 'profile.json');
    const rebound = await rebindSurfaceWaterAssemblyProfile({
      sourceProfilePath,
      pavingGeometryPath: geometryPath,
      outputProfilePath: reboundProfilePath,
      profileId: 'environment.contemporary-paver-water-field-rebound',
    });
    expect(rebound).toMatchObject({
      path: reboundProfilePath,
      receiverSha256: profile.receiverSha256,
      shelterCount: 0,
      profile: {
        id: 'environment.contemporary-paver-water-field-rebound',
        receiverSha256: profile.receiverSha256,
        atmosphericVfxSha256: profile.atmosphericVfxSha256,
        materialResponses: profile.materialResponses,
      },
    });
    expect(rebound.sourceProfileSha256).toBe(await sha256File(sourceProfilePath));
    const outputPath = join(directory, 'surface-water-field.json');
    const result = await createPavingSurfaceWaterField({
      pavingGeometryPath: geometryPath,
      atmosphericVfxPath: vfxPath,
      profile,
      profileDirectory: directory,
      outputPath,
    });

    expect(result.field.grid.activeCellCount).toBeGreaterThan(100);
    expect(result.field.cells.some((cell) => cell.targetClass === 'joint')).toBe(true);
    expect(Math.abs(result.field.massBalance.errorCubicMeters)).toBeLessThan(1e-12);
    expect(result.report).toMatchObject({
      result: 'structural-pass',
      visualAcceptance: 'not-assessed',
      materialResponseSources: { embedded: [targets.continuousJoint] },
    });
    expect(await sha256File(result.path)).toMatch(/^[a-f0-9]{64}$/u);
    const routed = await createPavingSurfaceWaterField({
      pavingGeometryPath: geometryPath,
      atmosphericVfxPath: vfxPath,
      profile,
      profileDirectory: directory,
      outputPath: join(directory, 'surface-water-field-v2.json'),
      fieldSchemaVersion: 2,
    });
    expect(routed.field.cells).toEqual(result.field.cells);
    expect(routed.field.massBalance).toEqual(result.field.massBalance);
    expect(routed.field.routing.nodes).toHaveLength(routed.field.cells.length);
    const routedOptical = await createSurfaceWaterOpticalSurface({
      surfaceWaterFieldPath: routed.path,
      outputPath: join(directory, 'surface-water-v2-optical.json'),
      surface: {
        schemaVersion: 2,
        id: 'environment.contemporary-paver-routed-optical-water',
        contourDepthMeters: 0.00001,
        opticalOffsetMeters: 0.0002,
        maximumVolumeCorrectionFactor: 20,
        subcellDivisions: 4,
        appearance: {
          model: 'thin-dielectric-water-v1',
          ior: 1.333,
          roughness: 0.035,
          absorptionColorLinear: [0.72, 0.9, 0.95],
          absorptionDistanceMeters: 4,
        },
      },
    });
    expect(routedOptical.surface.sourceFieldSha256).toBe(routed.field.fieldSha256);
    expect(routedOptical.surface.report.reconstructedVolumeCubicMeters).toBeCloseTo(
      routed.field.massBalance.puddleCubicMeters,
      12,
    );
    expect(routedOptical.surface.schemaVersion).toBe(2);
    if (routedOptical.surface.schemaVersion !== 2)
      throw new Error('expected refined routed optical surface');
    expect(routedOptical.surface.report.refinedCellSizeMeters).toBeCloseTo(
      routed.field.grid.cellSizeMeters / 4,
      12,
    );
    const history = await createPavingSurfaceHistoryField({
      pavingGeometryPath: geometryPath,
      surfaceWaterFieldPath: result.path,
      profile: {
        schemaVersion: 1,
        id: 'environment.contemporary-paver-history',
        referenceDate: '2026-09-02',
        installationAgeYears: 18,
        trafficPaths: [
          {
            id: 'footfall',
            kind: 'pedestrian',
            localPoints: [
              [-3, -2],
              [4, -2],
            ],
            halfWidthMeters: 0.25,
            falloffMeters: 0.3,
            equivalentPasses: 100_000,
            wearPerPass: 0.00001,
          },
        ],
        repairs: [{ id: definition.repairPatches[0]!.id, ageYears: 3 }],
        runoff: { referenceDepthMeters: 0.002, edgeWeight: 1, puddleWeight: 0.5 },
      },
      outputPath: join(directory, 'surface-history-field.json'),
    });
    expect(history.report).toMatchObject({
      result: 'structural-pass',
      visualAcceptance: 'not-assessed',
    });
    const opticalPath = join(directory, 'surface-water-optical.json');
    const optical = await createSurfaceWaterOpticalSurface({
      surfaceWaterFieldPath: result.path,
      outputPath: opticalPath,
      surface: {
        schemaVersion: 1,
        id: 'environment.contemporary-paver-optical-water',
        contourDepthMeters: 0.00001,
        opticalOffsetMeters: 0.0002,
        maximumVolumeCorrectionFactor: 20,
      },
    });
    expect(optical.surface.sourceFieldSha256).toBe(result.field.fieldSha256);
    expect(optical.surface.report.triangleCount).toBeGreaterThan(0);
    expect(optical.surface.report.volumeErrorCubicMeters).toBeCloseTo(0, 12);

    const cliOpticalPath = join(directory, 'cli-surface-water-optical.json');
    const cliResult = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'environment',
      'create-surface-water-optical-surface',
      result.path,
      cliOpticalPath,
      '--id',
      'environment.contemporary-paver-cli-optical-water',
    ]);
    expect(JSON.parse(cliResult.stdout)).toMatchObject({
      ok: true,
      command: 'environment.create-surface-water-optical-surface',
      data: {
        surface: {
          sourceFieldSha256: result.field.fieldSha256,
          report: { triangleCount: optical.surface.report.triangleCount },
        },
        path: cliOpticalPath,
      },
    });

    const cliRefinedPath = join(directory, 'cli-surface-water-optical-v2.json');
    const cliRefinedResult = await exec(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('src/cli.ts'),
        '--json',
        'environment',
        'create-surface-water-optical-surface',
        result.path,
        cliRefinedPath,
        '--id',
        'environment.contemporary-paver-cli-optical-water-v2',
        '--schema-version',
        '2',
        '--subcell-divisions',
        '4',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(JSON.parse(cliRefinedResult.stdout)).toMatchObject({
      ok: true,
      data: {
        surface: {
          schemaVersion: 2,
          sourceFieldSha256: result.field.fieldSha256,
          appearance: {
            model: 'thin-dielectric-water-v1',
            ior: 1.333,
            roughness: 0.035,
            absorptionColorLinear: [0.72, 0.9, 0.95],
            absorptionDistanceMeters: 4,
          },
          report: { refinedCellSizeMeters: result.field.grid.cellSizeMeters / 4 },
        },
        path: cliRefinedPath,
      },
    });

    const scene = cinematicSceneSchema.parse({
      schemaVersion: 1,
      id: 'scene.surface-water-binding',
      durationSeconds: 1,
      fps: 24,
      resolution: { width: 320, height: 180, percentage: 100 },
      entities: [
        {
          id: 'receiver',
          role: 'environment',
          geometryPath: relative(directory, geometryPath),
          surfaceWaterFieldPath: relative(directory, result.path),
          surfaceHistoryFieldPath: relative(directory, history.path),
          surfaceWaterOpticalSurfacePath: relative(directory, cliRefinedPath),
          transform: profile.receiverTransform,
        },
      ],
      camera: {
        keyframes: [
          { time: 0, position: [2, 2, 4], target: [1, 0, 1], lensMillimeters: 50 },
          { time: 1, position: [2, 2, 4], target: [1, 0, 1], lensMillimeters: 50 },
        ],
      },
      lights: [
        {
          id: 'key',
          type: 'area',
          position: [1, 3, 2],
          target: [1, 0, 1],
          color: [1, 1, 1],
          energy: 500,
          sizeMeters: 2,
        },
      ],
      atmosphere: {},
      landmarks: [
        { id: 'start', progress: 0, description: 'Start' },
        { id: 'end', progress: 1, description: 'End' },
      ],
    });
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        entities: [{ ...scene.entities[0], surfaceWaterFieldPath: undefined }],
      }),
    ).toThrow(/require an exact source field path/u);
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        entities: [{ ...scene.entities[0], role: 'prop' }],
      }),
    ).toThrow(/only bind environment entities/u);
    expect(() =>
      cinematicSceneSchema.parse({
        ...scene,
        entities: [
          {
            ...scene.entities[0],
            surfaceWaterFieldPath: undefined,
            surfaceWaterOpticalSurfacePath: undefined,
          },
        ],
      }),
    ).toThrow(/surface-history fields require/u);
    const scenePath = await saveCinematicScene(join(directory, 'scene.json'), scene);
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({
      status: 'pass',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'receiver.surface-water-optical-surface',
          status: 'pass',
        }),
        expect.objectContaining({ id: 'receiver.surface-history-field', status: 'pass' }),
      ]),
    });
    const initialFingerprint = await fingerprintCinematicScene(scenePath);
    expect(initialFingerprint.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'surface-water:receiver',
          path: 'surface-water-field.json',
        }),
        expect.objectContaining({
          role: 'surface-water-optical:receiver',
          path: 'cli-surface-water-optical-v2.json',
        }),
        expect.objectContaining({
          role: 'surface-history:receiver',
          path: 'surface-history-field.json',
        }),
      ]),
    );

    const routedScene = await rebindCinematicSurfaceWaterReceiver({
      sourceScenePath: scenePath,
      receiverEntityId: 'receiver',
      pavingGeometryPath: geometryPath,
      surfaceWaterFieldPath: routed.path,
      surfaceWaterOpticalSurfacePath: routedOptical.path,
      outputScenePath: join(directory, 'routed-scene.json'),
      sceneId: 'scene.surface-water-v2-binding',
    });
    expect(routedScene.scene.entities[0]).toMatchObject({
      surfaceWaterFieldPath: resolve(routed.path),
      surfaceWaterOpticalSurfacePath: resolve(routedOptical.path),
    });
    expect(routedScene.scene.entities[0]!.surfaceHistoryFieldPath).toBeUndefined();
    expect(await verifyCinematicScene(routedScene.scene, routedScene.path)).toMatchObject({
      status: 'pass',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'receiver.surface-water-optical-surface',
          status: 'pass',
        }),
      ]),
    });

    const routedBytes = await readFile(routed.path, 'utf8');
    const forgedRouted = JSON.parse(routedBytes);
    forgedRouted.routing.nodes[0].rank = forgedRouted.routing.nodes[1].rank;
    await writeFile(routed.path, `${JSON.stringify(forgedRouted, null, 2)}\n`, 'utf8');
    await expect(
      rebindCinematicSurfaceWaterReceiver({
        sourceScenePath: scenePath,
        receiverEntityId: 'receiver',
        pavingGeometryPath: geometryPath,
        surfaceWaterFieldPath: routed.path,
        surfaceWaterOpticalSurfacePath: routedOptical.path,
        outputScenePath: join(directory, 'forged-routed-scene.json'),
        sceneId: 'scene.forged-surface-water-v2-binding',
      }),
    ).rejects.toThrow(/surface-water receiver field is invalid/u);
    await writeFile(routed.path, routedBytes, 'utf8');

    const opticalBytes = await readFile(cliRefinedPath, 'utf8');
    const forgedOptical = JSON.parse(opticalBytes);
    forgedOptical.sourceFieldSha256 = '0'.repeat(64);
    delete forgedOptical.reconstructionSha256;
    forgedOptical.reconstructionSha256 = canonicalSha256(forgedOptical);
    await writeFile(cliRefinedPath, `${JSON.stringify(forgedOptical, null, 2)}\n`, 'utf8');
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({
      status: 'fail',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'receiver.surface-water-optical-surface',
          status: 'fail',
          measurements: expect.objectContaining({ sourceFieldMatched: false }),
        }),
      ]),
    });
    expect((await fingerprintCinematicScene(scenePath)).renderSha256).not.toBe(
      initialFingerprint.renderSha256,
    );
    await writeFile(cliRefinedPath, opticalBytes, 'utf8');

    const movedScene = structuredClone(scene);
    movedScene.entities[0]!.transform.position[0] += 0.1;
    expect(await verifyCinematicScene(movedScene, scenePath)).toMatchObject({
      status: 'fail',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'receiver.surface-water-optical-surface',
          status: 'fail',
          measurements: expect.objectContaining({ receiverTransformMatched: false }),
        }),
      ]),
    });

    const forgedField = JSON.parse(await readFile(result.path, 'utf8'));
    forgedField.cells[0].filmDepthMeters += 0.001;
    await writeFile(result.path, `${JSON.stringify(forgedField, null, 2)}\n`, 'utf8');
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({ status: 'fail' });

    await expect(
      createPavingSurfaceWaterField({
        pavingGeometryPath: geometryPath,
        atmosphericVfxPath: vfxPath,
        profile: { ...profile, receiverSha256: '0'.repeat(64) },
        profileDirectory: directory,
        outputPath: join(directory, 'forged.json'),
      }),
    ).rejects.toThrow(/receiver hash mismatch/u);
    await expect(
      createPavingSurfaceWaterField({
        pavingGeometryPath: geometryPath,
        atmosphericVfxPath: vfxPath,
        profile: {
          ...profile,
          materialResponses: {
            ...profile.materialResponses,
            [targets.continuousJoint]: {
              targetClass: 'modeled-unit',
              absorption: jointMaterial.surface.surfaceWaterResponse!.absorption,
              retention: jointMaterial.surface.surfaceWaterResponse!.retention,
              wetRoughness: {
                dry: jointMaterial.roughness,
                ...jointMaterial.surface.surfaceWaterResponse!.wetRoughness,
              },
              splash: jointMaterial.surface.surfaceWaterResponse!.splash,
            },
          },
        },
        profileDirectory: directory,
        outputPath: join(directory, 'wrong-target.json'),
      }),
    ).rejects.toThrow(/expected joint/u);
  }, 15_000);
});
