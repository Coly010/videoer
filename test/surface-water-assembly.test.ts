import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256File } from '../src/assets/library.js';
import {
  createPavingSurfaceWaterField,
  surfaceWaterAssemblyProfileSchema,
} from '../src/application/surface-water.js';
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
          geometryPath,
          surfaceWaterFieldPath: result.path,
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
    const scenePath = await saveCinematicScene(join(directory, 'scene.json'), scene);
    expect(await verifyCinematicScene(scene, scenePath)).toMatchObject({ status: 'pass' });
    expect((await fingerprintCinematicScene(scenePath)).artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'surface-water:receiver', path: result.path }),
      ]),
    );

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
