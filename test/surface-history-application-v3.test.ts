import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256File } from '../src/assets/library.js';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import {
  createPavingSurfaceHistoryV3Field,
  loadSurfaceHistoryV3Profile,
} from '../src/application/surface-history.js';
import { rebindCinematicSurfaceWaterReceiver } from '../src/application/surface-water.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import { saveCinematicScene } from '../src/cinematic/io.js';
import { verifyCinematicScene } from '../src/cinematic/verification.js';
import { createContemporaryPaverDefinition } from '../src/environments/irregular-paving.js';
import {
  surfaceHistoryFieldV3Schema,
  type SurfaceHistoryV3Profile,
} from '../src/environments/surface-history.js';
import {
  compileStaticSurfaceWater,
  type SurfaceWaterFieldInput,
} from '../src/environments/surface-water.js';
import { saveGeometry } from '../src/geometry/io.js';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import { createPavingUnitSurfaceMaterial } from '../src/materials/paving-unit.js';

const exec = promisify(execFile);

function profile(): SurfaceHistoryV3Profile {
  return {
    schemaVersion: 3,
    id: 'environment.surface-history-application-v3-fixture',
    referenceDate: '2026-09-02',
    installationAgeYears: 40,
    trafficPaths: [
      {
        id: 'main-footfall',
        kind: 'pedestrian',
        localPoints: [
          [-1, 0],
          [1, 0],
        ],
        halfWidthMeters: 0.15,
        falloffWidthMeters: 0.3,
        equivalentPasses: 10_000,
        passesAtHalfWear: 5_000,
      },
    ],
    repairs: [{ id: 'utility-reinstatement', ageYears: 4 }],
    exposure: { yearsAtHalfResponse: 20 },
    runoff: {
      backgroundThroughflowDepthMeters: 0,
      throughflowExcessDepthAtHalfResponse: 0.001,
      edgeWeight: 1,
      puddleWeight: 0.5,
      backgroundRetainedDepthMeters: 0,
      retainedExcessDepthAtHalfResponse: 0.001,
    },
    dirt: {
      materialResponses: {
        stone: {
          loadingKilogramsPerSquareMeterPerYear: 0.02,
          persistentFraction: 0.25,
          washoffCoefficientPerMeter: 4_000,
          transportCaptureFraction: 0.2,
          looseCoverageReferenceKilogramsPerSquareMeter: 0.2,
          persistentCoverageReferenceKilogramsPerSquareMeter: 0.2,
        },
      },
    },
  };
}

describe('surface-history v3 application assembly', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function fixture() {
    directory = await mkdtemp(join(tmpdir(), 'videoer-surface-history-v3-'));
    const geometry = mergeMeshParts(
      'environment.surface-history-v3-receiver',
      [boxPart([0, -0.1, 0], [2, 0, 2], 0, 'stone')],
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      { definition: createContemporaryPaverDefinition() },
    );
    geometry.materials = [
      {
        id: 'stone',
        baseColor: [0.2, 0.2, 0.2, 1],
        roughness: 0.7,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
        surface: createPavingUnitSurfaceMaterial('historic-cut-granite'),
      },
    ];
    const geometryPath = join(directory, 'paving.json');
    await saveGeometry(geometryPath, geometry);
    const geometrySha256 = await sha256File(geometryPath);
    const waterInput: SurfaceWaterFieldInput = {
      schemaVersion: 1,
      id: 'environment.surface-history-v3-water',
      receiver: {
        geometry,
        geometrySha256,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
      drainage: { localDirection: [1, 0], gradientMetersPerMeter: 0.02, outlets: [] },
      precipitation: {
        intensityMillimetersPerHour: 100,
        durationSeconds: 300,
        windMetersPerSecond: [0, 0],
        impactSpeedMetersPerSecond: 8,
        dropDiameterMillimeters: 2,
      },
      materialResponses: {
        stone: {
          targetClass: 'modeled-unit',
          absorption: { capacityMeters: 0, rateMetersPerSecond: 0, initialSaturation: 0 },
          retention: {
            filmCapacityMeters: 0.0005,
            edgeCapacityMeters: 0.001,
            maximumPuddleDepthMeters: 0.04,
          },
          wetRoughness: { dry: 0.7, multiplier: 0.5, floor: 0.1 },
          splash: { minimumFreeWaterDepthMeters: 0.0001, maximumSlopeDegrees: 15 },
        },
      },
      shelters: [],
      grid: { cellSizeMeters: 0.5, supersample: 1, shelterRayMaximumMeters: 10 },
      solver: { edgeHeightThresholdMeters: 0.002, maximumCellCount: 1_000 },
    };
    const water = compileStaticSurfaceWater(waterInput, { schemaVersion: 2 });
    const waterPath = join(directory, 'water-v2.json');
    await writeFile(waterPath, `${JSON.stringify(water, null, 2)}\n`, 'utf8');
    return { geometryPath, waterPath };
  }

  it('loads, verifies and reports a persisted v3 field without collapsing causal channels', async () => {
    const { geometryPath, waterPath } = await fixture();
    const profilePath = join(directory!, 'profile-v3.json');
    const outputPath = join(directory!, 'history-v3.json');
    await writeFile(profilePath, `${JSON.stringify(profile(), null, 2)}\n`, 'utf8');

    const loaded = await loadSurfaceHistoryV3Profile(profilePath);
    const result = await createPavingSurfaceHistoryV3Field({
      pavingGeometryPath: geometryPath,
      surfaceWaterFieldPath: waterPath,
      profile: loaded,
      outputPath,
    });
    const persisted = surfaceHistoryFieldV3Schema.parse(
      JSON.parse(await readFile(outputPath, 'utf8')),
    );
    const report = result.report as {
      schemaVersion: number;
      generator: string;
      field: { semanticSha256: string };
      sourceWater: { routingSha256: string };
      channelRanges: Record<string, { minimum: number; maximum: number }>;
    };

    expect(persisted).toEqual(result.field);
    expect(report).toMatchObject({
      schemaVersion: 3,
      generator: 'videoer.surface-history-assembly.v3',
      field: { semanticSha256: result.field.fieldSha256 },
      sourceWater: { routingSha256: result.field.sourceWaterField.routingSha256 },
    });
    expect(Object.keys(report.channelRanges).sort()).toEqual(
      [
        'exposureWeathering',
        'rainExposureFraction',
        'repairInfluence',
        'repairRelativeAge',
        'retainedWaterStaining',
        'runoffStaining',
        'runoffThroughflowStaining',
        'shelterProtection',
        'trafficWear',
      ].sort(),
    );
    expect(canonicalSha256(persisted.receiver)).toBe(canonicalSha256(result.field.receiver));

    const cliOutputPath = join(directory!, 'history-v3-cli.json');
    const cliResult = await exec(process.execPath, [
      '--import',
      'tsx',
      resolve('src/cli.ts'),
      '--json',
      'environment',
      'create-surface-history-v3-field',
      geometryPath,
      waterPath,
      profilePath,
      cliOutputPath,
    ]);
    expect(JSON.parse(cliResult.stdout)).toMatchObject({
      ok: true,
      command: 'environment.create-surface-history-v3-field',
      data: {
        path: cliOutputPath,
        field: { schemaVersion: 3, fieldSha256: result.field.fieldSha256 },
      },
    });

    const sourceScene = cinematicSceneSchema.parse({
      schemaVersion: 1,
      id: 'scene.surface-history-v3-source',
      durationSeconds: 1,
      fps: 24,
      resolution: { width: 320, height: 180, percentage: 100 },
      entities: [
        {
          id: 'receiver',
          role: 'environment',
          geometryPath,
          surfaceWaterFieldPath: waterPath,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      ],
      camera: {
        keyframes: [
          { time: 0, position: [2, 2, 4], target: [0, 0, 0], lensMillimeters: 50 },
          { time: 1, position: [2, 2, 4], target: [0, 0, 0], lensMillimeters: 50 },
        ],
      },
      lights: [
        {
          id: 'key',
          type: 'area',
          position: [1, 3, 2],
          target: [0, 0, 0],
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
    const sourceScenePath = await saveCinematicScene(
      join(directory!, 'source-scene.json'),
      sourceScene,
    );
    const rebound = await rebindCinematicSurfaceWaterReceiver({
      sourceScenePath,
      receiverEntityId: 'receiver',
      pavingGeometryPath: geometryPath,
      surfaceWaterFieldPath: waterPath,
      surfaceHistoryFieldPath: outputPath,
      outputScenePath: join(directory!, 'v3-bound-scene.json'),
    });
    expect(rebound.scene.entities[0]!.surfaceHistoryFieldPath).toBe(outputPath);
    expect(await verifyCinematicScene(rebound.scene, rebound.path)).toMatchObject({
      status: 'pass',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'receiver.surface-history-field',
          status: 'pass',
          measurements: expect.objectContaining({ schemaVersion: 3 }),
        }),
      ]),
    });
    const wrongVersionPath = join(directory!, 'history-wrong-version.json');
    await writeFile(
      wrongVersionPath,
      `${JSON.stringify({ ...result.field, schemaVersion: 1 }, null, 2)}\n`,
      'utf8',
    );
    await expect(
      rebindCinematicSurfaceWaterReceiver({
        sourceScenePath,
        receiverEntityId: 'receiver',
        pavingGeometryPath: geometryPath,
        surfaceWaterFieldPath: waterPath,
        surfaceHistoryFieldPath: wrongVersionPath,
        outputScenePath: join(directory!, 'wrong-version-scene.json'),
      }),
    ).rejects.toThrow(/accepts only surface-history v2 or v3/u);
    const forgedHistoryPath = join(directory!, 'history-forged.json');
    const forgedHistory = structuredClone(result.field);
    forgedHistory.cells[0]!.trafficWear = forgedHistory.cells[0]!.trafficWear === 0 ? 0.2 : 0;
    await writeFile(forgedHistoryPath, `${JSON.stringify(forgedHistory, null, 2)}\n`, 'utf8');
    await expect(
      rebindCinematicSurfaceWaterReceiver({
        sourceScenePath,
        receiverEntityId: 'receiver',
        pavingGeometryPath: geometryPath,
        surfaceWaterFieldPath: waterPath,
        surfaceHistoryFieldPath: forgedHistoryPath,
        outputScenePath: join(directory!, 'forged-history-scene.json'),
      }),
    ).rejects.toThrow(/field is invalid/u);
  });

  it('fails closed when a v3 traffic path cannot affect the paving definition', async () => {
    const { geometryPath, waterPath } = await fixture();
    const invalidProfile = profile();
    invalidProfile.trafficPaths[0]!.localPoints = [
      [50, 50],
      [51, 50],
    ];

    await expect(
      createPavingSurfaceHistoryV3Field({
        pavingGeometryPath: geometryPath,
        surfaceWaterFieldPath: waterPath,
        profile: invalidProfile,
        outputPath: join(directory!, 'invalid-history-v3.json'),
      }),
    ).rejects.toThrow(/does not affect any active receiver cell/u);
  });
});
