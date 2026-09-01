import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cinematicSceneSchema, type CinematicScene } from '../src/cinematic/model.js';
import { resolveRigBoundAtmosphere } from '../src/cinematic/lighting.js';
import { verifyCinematicScene } from '../src/cinematic/verification.js';
import { createDuskExteriorLightingRig } from '../src/lighting/bookshop.js';
import { saveLightingRig } from '../src/lighting/io.js';
import { lightingRigSchema, type LightingRig } from '../src/lighting/model.js';

const localPractical = {
  id: 'shot-local-lantern',
  type: 'point' as const,
  position: [0.4, 1.6, -0.2] as [number, number, number],
  color: [1, 0.42, 0.12] as [number, number, number],
  energy: 85,
  sizeMeters: 0.18,
  angleDegrees: 45,
};

function environmentOnlyRig() {
  return lightingRigSchema.parse({
    schemaVersion: 2,
    id: 'lighting.test-physical-sky',
    exposure: {
      viewTransform: 'AgX',
      look: 'AgX - Medium High Contrast',
      exposureStops: 0,
      coherentAcrossShots: true,
    },
    worldColor: [0.01, 0.015, 0.025],
    lights: [],
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
        altitudeMeters: 0,
        airDensity: 1,
        dustDensity: 1,
        ozoneDensity: 1,
        groundAlbedo: [0.18, 0.18, 0.18],
      },
      exposureStops: 0,
    },
  });
}

function sceneForRig(rig: LightingRig, lights: CinematicScene['lights']) {
  return cinematicSceneSchema.parse({
    schemaVersion: 2,
    id: 'scene.lighting-composition',
    durationSeconds: 1,
    fps: 24,
    resolution: { width: 64, height: 64 },
    entities: [{ id: 'witness', role: 'prop', geometryPath: 'missing-witness.json' }],
    camera: {
      keyframes: [
        { time: 0, position: [0, 1, -3], target: [0, 1, 0], lensMillimeters: 50 },
        { time: 1, position: [0, 1, -3], target: [0, 1, 0], lensMillimeters: 50 },
      ],
    },
    lightingRigPath: 'lighting-rig.json',
    lights,
    atmosphere: {},
    landmarks: [
      { id: 'start', progress: 0, description: 'start' },
      { id: 'end', progress: 1, description: 'end' },
    ],
    metadata: { lightingRigId: rig.id },
  });
}

const inlineRigLights = (rig: LightingRig): CinematicScene['lights'] =>
  rig.lights.map(({ purpose, ...light }) => {
    void purpose;
    return light;
  });

function lightingBinding(report: Awaited<ReturnType<typeof verifyCinematicScene>>) {
  return report.checks.find((check) => check.id === 'lighting-rig-binding')!;
}

async function verify(rig: LightingRig, scene: CinematicScene) {
  const directory = await mkdtemp(join(tmpdir(), 'videoer-lighting-composition-'));
  await saveLightingRig(join(directory, 'lighting-rig.json'), rig);
  return verifyCinematicScene(scene, join(directory, 'scene.json'));
}

describe('cinematic lighting rig composition', () => {
  it('permits a shot-local practical alongside an environment-only rig', async () => {
    const rig = environmentOnlyRig();
    const check = lightingBinding(await verify(rig, sceneForRig(rig, [localPractical])));

    expect(check).toMatchObject({
      status: 'pass',
      measurements: {
        rigLightCount: 0,
        supplementalLightCount: 1,
        supplementalLightIds: ['shot-local-lantern'],
        missingRigLightIds: [],
        driftedRigLightIds: [],
      },
    });
  });

  it('permits a shot-local practical alongside every exact emitter-rig light', async () => {
    const rig = createDuskExteriorLightingRig();
    const scene = sceneForRig(rig, [...inlineRigLights(rig), localPractical]);
    const check = lightingBinding(await verify(rig, scene));

    expect(check).toMatchObject({
      status: 'pass',
      measurements: {
        rigLightCount: rig.lights.length,
        supplementalLightCount: 1,
        supplementalLightIds: ['shot-local-lantern'],
        resolvedWorldColor: rig.worldColor,
        worldColorPrecedence: 'lighting-rig-over-scene-atmosphere',
      },
    });
    expect(resolveRigBoundAtmosphere(scene.atmosphere, rig).worldColor).toEqual(rig.worldColor);
  });

  it('fails when a rig-owned light is missing or has drifted', async () => {
    const rig = createDuskExteriorLightingRig();
    const exactLights = inlineRigLights(rig);
    const missingId = exactLights[0]!.id;
    const missing = sceneForRig(rig, exactLights.slice(1));
    expect(lightingBinding(await verify(rig, missing))).toMatchObject({
      status: 'fail',
      measurements: { missingRigLightIds: [missingId], driftedRigLightIds: [] },
    });

    const driftedId = exactLights[1]!.id;
    const driftedLights = structuredClone(exactLights);
    driftedLights[1]!.energy += 1;
    const drifted = sceneForRig(rig, driftedLights);
    expect(lightingBinding(await verify(rig, drifted))).toMatchObject({
      status: 'fail',
      measurements: { missingRigLightIds: [], driftedRigLightIds: [driftedId] },
    });
  });

  it('fails closed on duplicate scene light IDs at verifier level', async () => {
    const rig = environmentOnlyRig();
    const scene = sceneForRig(rig, [localPractical]);
    scene.lights.push(structuredClone(scene.lights[0]!));
    const check = lightingBinding(await verify(rig, scene));

    expect(check).toMatchObject({
      status: 'fail',
      measurements: {
        duplicateSceneLightIds: ['shot-local-lantern'],
        supplementalLightCount: 2,
      },
    });
  });
});
