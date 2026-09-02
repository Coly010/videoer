import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rebindCinematicEntityGeometry } from '../src/application/cinematic-scene-derivation.js';
import { loadCinematicScene, saveCinematicScene } from '../src/cinematic/io.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import { saveGeometry } from '../src/geometry/io.js';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

function scene(geometryPath: string, receiverBound = false) {
  return cinematicSceneSchema.parse({
    schemaVersion: 2,
    id: 'scene.geometry-rebind-source',
    durationSeconds: 0.125,
    fps: 24,
    resolution: { width: 320, height: 180, percentage: 100 },
    entities: [
      {
        id: 'receiver',
        role: 'environment',
        geometryPath,
        productionRigProfilePath: 'dependencies/rig-profile.json',
        productionCharacterBindingPath: 'dependencies/character-binding.json',
        fixturePath: 'dependencies/fixture.json',
        motion: { path: 'dependencies/motion.json' },
        ...(receiverBound ? { surfaceWaterFieldPath: 'stale-water.json' } : {}),
      },
      {
        id: 'untouched-set',
        role: 'set-dressing',
        geometryPath: 'untouched-geometry.json',
      },
    ],
    lightingRigPath: 'dependencies/lighting-rig.json',
    finishProfilePath: 'dependencies/finish-profile.json',
    overlays: [
      {
        imagePath: 'dependencies/overlay.png',
        startSeconds: 0,
        endSeconds: 0.125,
      },
    ],
    camera: {
      keyframes: [
        { time: 0, position: [2, 2, 2], target: [0, 0, 0], lensMillimeters: 50 },
        { time: 0.125, position: [2, 2, 2], target: [0, 0, 0], lensMillimeters: 50 },
      ],
    },
    lights: [
      {
        id: 'key',
        type: 'area',
        position: [2, 3, 2],
        target: [0, 0, 0],
        color: [1, 1, 1],
        energy: 400,
        sizeMeters: 2,
      },
    ],
    landmarks: [
      { id: 'start', progress: 0, description: 'Geometry rebind fixture start' },
      { id: 'end', progress: 1, description: 'Geometry rebind fixture end' },
    ],
  });
}

describe('cinematic scene geometry derivation', () => {
  it('rebinds one validated geometry and records derivation evidence', async () => {
    directory = await mkdtemp(join(tmpdir(), 'videoer-scene-rebind-'));
    const sourceGeometry = await saveGeometry(
      join(directory, 'source-geometry.json'),
      mergeMeshParts(
        'environment.source',
        [boxPart([-1, 0, -1], [1, 0.1, 1], 0)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      ),
    );
    const replacementGeometry = await saveGeometry(
      join(directory, 'replacement-geometry.json'),
      mergeMeshParts(
        'environment.replacement',
        [boxPart([-2, 0, -2], [2, 0.2, 2], 0)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      ),
    );
    const sourceScene = await saveCinematicScene(
      join(directory, 'source-scene.json'),
      scene(sourceGeometry),
    );
    const untouchedGeometry = await saveGeometry(
      join(directory, 'untouched-geometry.json'),
      mergeMeshParts(
        'environment.untouched',
        [boxPart([-1, 0, -1], [1, 0.1, 1], 0)],
        [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
        {},
      ),
    );
    await mkdir(join(directory, 'derived'), { recursive: true });
    const outputScene = join(directory, 'derived/derived-scene.json');
    await rebindCinematicEntityGeometry({
      sourceScenePath: sourceScene,
      entityId: 'receiver',
      geometryPath: replacementGeometry,
      outputScenePath: outputScene,
      sceneId: 'scene.geometry-rebind-derived',
    });
    const derived = await loadCinematicScene(outputScene);
    expect(derived).toMatchObject({
      id: 'scene.geometry-rebind-derived',
      entities: [
        { id: 'receiver', geometryPath: '../replacement-geometry.json' },
        { id: 'untouched-set', geometryPath: '../untouched-geometry.json' },
      ],
      metadata: {
        derivationGenerator: 'videoer.cinematic-entity-geometry-rebind.v1',
        sourceSceneId: 'scene.geometry-rebind-source',
        sourceSceneSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reboundGeometryId: 'environment.replacement',
        reboundGeometrySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(untouchedGeometry).toBe(join(directory, 'untouched-geometry.json'));
    expect(derived.entities[0]).toMatchObject({
      productionRigProfilePath: '../dependencies/rig-profile.json',
      productionCharacterBindingPath: '../dependencies/character-binding.json',
      fixturePath: '../dependencies/fixture.json',
      motion: { path: '../dependencies/motion.json' },
    });
    expect(derived).toMatchObject({
      lightingRigPath: '../dependencies/lighting-rig.json',
      finishProfilePath: '../dependencies/finish-profile.json',
      overlays: [{ imagePath: '../dependencies/overlay.png' }],
    });

    await saveCinematicScene(join(directory, 'receiver-bound.json'), scene(sourceGeometry, true));
    await expect(
      rebindCinematicEntityGeometry({
        sourceScenePath: join(directory, 'receiver-bound.json'),
        entityId: 'receiver',
        geometryPath: replacementGeometry,
        outputScenePath: join(directory, 'forbidden.json'),
        sceneId: 'scene.forbidden-rebind',
      }),
    ).rejects.toThrow(/receiver-bound water\/history evidence/);
  });
});
