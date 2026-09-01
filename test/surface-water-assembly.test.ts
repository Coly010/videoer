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

const temporaryDirectories: string[] = [];
const exec = promisify(execFile);
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('paving surface-water assembly', () => {
  it('loads exact hash-bound inputs, derives target classes, and persists structural evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'videoer-surface-water-'));
    temporaryDirectories.push(directory);
    const generated = compileIrregularPaving(createContemporaryPaverDefinition());
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
          surfaceWaterOpticalSurfacePath: relative(directory, optical.path),
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
    const scenePath = await saveCinematicScene(join(directory, 'scene.json'), scene);
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({
      status: 'pass',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'receiver.surface-water-optical-surface',
          status: 'pass',
        }),
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
          path: 'surface-water-optical.json',
        }),
      ]),
    );

    const opticalBytes = await readFile(optical.path, 'utf8');
    const forgedOptical = JSON.parse(opticalBytes);
    forgedOptical.sourceFieldSha256 = '0'.repeat(64);
    delete forgedOptical.reconstructionSha256;
    forgedOptical.reconstructionSha256 = canonicalSha256(forgedOptical);
    await writeFile(optical.path, `${JSON.stringify(forgedOptical, null, 2)}\n`, 'utf8');
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
    await writeFile(optical.path, opticalBytes, 'utf8');

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
  });
});
