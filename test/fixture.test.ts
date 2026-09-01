import { describe, expect, it } from 'vitest';
import { practicalFixtureSchema } from '../src/fixtures/model.js';
import { cinematicSceneSchema } from '../src/cinematic/model.js';
import {
  createOldCityWallLanternFixture,
  createOldCityWallLanternGeometry,
} from '../src/fixtures/wall-lantern.js';
import { validateGeometry } from '../src/geometry/model.js';
import {
  createNeonBladeSignFixture,
  createNeonBladeSignGeometry,
} from '../src/fixtures/neon-blade-sign.js';

describe('portable practical fixtures', () => {
  it('defines physical local emitters independently of a renderer', () => {
    const fixture = practicalFixtureSchema.parse({
      schemaVersion: 1,
      id: 'fixture.test-wall-light',
      geometryAssetId: 'prop.test-wall-light',
      mountAttachmentId: 'wall-mount',
      emitters: [
        {
          id: 'warm-source',
          type: 'point',
          position: [0, -0.35, -0.45],
          color: [1, 0.42, 0.16],
          powerWatts: 48,
          sizeMeters: 0.09,
        },
      ],
    });
    expect(fixture.emitters[0]).toMatchObject({
      falloff: 'inverse-square',
      purpose: 'practical',
    });
  });

  it('rejects duplicate emitters and directional emitters without local targets', () => {
    const base = {
      schemaVersion: 1,
      id: 'fixture.test-wall-light',
      geometryAssetId: 'prop.test-wall-light',
      mountAttachmentId: 'wall-mount',
    } as const;
    expect(() =>
      practicalFixtureSchema.parse({
        ...base,
        emitters: [
          {
            id: 'source',
            type: 'point',
            position: [0, 0, 0],
            color: [1, 1, 1],
            powerWatts: 10,
          },
          {
            id: 'source',
            type: 'spot',
            position: [0, 0, 0],
            color: [1, 1, 1],
            powerWatts: 10,
          },
        ],
      }),
    ).toThrow();
  });

  it('binds a fixture definition to an ordinary portable scene entity', () => {
    const scene = cinematicSceneSchema.parse({
      schemaVersion: 1,
      id: 'scene.fixture-contract',
      durationSeconds: 1,
      fps: 24,
      resolution: { width: 320, height: 180 },
      entities: [
        {
          id: 'lantern',
          role: 'prop',
          geometryPath: 'lantern/geometry.json',
          fixturePath: 'lantern/fixture.json',
        },
      ],
      camera: {
        keyframes: [
          { time: 0, position: [0, 1, -3], target: [0, 1, 0], lensMillimeters: 50 },
          { time: 1, position: [0, 1, -3], target: [0, 1, 0], lensMillimeters: 50 },
        ],
      },
      lights: [
        {
          id: 'ambient-fill',
          type: 'area',
          position: [0, 3, -2],
          target: [0, 1, 0],
          color: [0.2, 0.3, 0.5],
          energy: 20,
        },
      ],
      landmarks: [
        { id: 'start', progress: 0, description: 'start' },
        { id: 'end', progress: 1, description: 'end' },
      ],
    });
    expect(scene.entities[0]!.fixturePath).toBe('lantern/fixture.json');
  });

  it('builds a validated independently mountable glazed lantern', () => {
    const geometry = createOldCityWallLanternGeometry();
    const fixture = createOldCityWallLanternFixture();
    expect(validateGeometry(geometry).valid).toBe(true);
    expect(fixture.geometryAssetId).toBe(geometry.id);
    expect(geometry.attachments).toHaveProperty(fixture.mountAttachmentId);
    expect(
      geometry.materials.find((item) => item.id === 'lantern-glass')?.surface?.pattern,
    ).toMatchObject({ kind: 'architectural-glazing', thicknessMeters: 0.008 });
    expect(fixture.emitters[0]).toMatchObject({ type: 'point', powerWatts: 52 });
    expect(fixture.emitters[0]!.visibleSourceMaterialId).toBe('warm-flame');
    expect(fixture.emitters[0]!.temporalModulation).toMatchObject({
      kind: 'seeded-flicker',
      seed: 2417,
    });
  });

  it('rejects inverted temporal intensity and colour-temperature ranges', () => {
    const fixture = createOldCityWallLanternFixture();
    const emitter = fixture.emitters[0]!;
    expect(() =>
      practicalFixtureSchema.parse({
        ...fixture,
        emitters: [
          {
            ...emitter,
            temporalModulation: {
              ...emitter.temporalModulation!,
              intensityMinimumMultiplier: 1.2,
              intensityMaximumMultiplier: 0.8,
              colorTemperatureMinimumKelvin: 2200,
              colorTemperatureMaximumKelvin: 1800,
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('builds a portable neon sign with replaceable faces and electrical modulation', () => {
    const geometry = createNeonBladeSignGeometry();
    const fixture = createNeonBladeSignFixture();
    expect(validateGeometry(geometry).valid).toBe(true);
    expect(fixture.geometryAssetId).toBe(geometry.id);
    expect(geometry.attachments).toHaveProperty('face-left');
    expect(geometry.attachments).toHaveProperty('face-right');
    expect(geometry.metadata.hostContract).toMatchObject({
      compatibleSurface: 'vertical-wall',
      minimumProjectionClearanceMeters: 1.42,
    });
    expect(geometry.metadata.replaceableFaceTreatment).toMatchObject({
      slots: ['face-left', 'face-right'],
    });
    expect(fixture.emitters).toHaveLength(2);
    expect(fixture.emitters[0]!.temporalModulation).toMatchObject({
      kind: 'seeded-electrical-instability',
      dropoutProbability: 0.12,
    });
    expect(fixture.emitters[0]!.visibleSourceMaterialId).toBe('cyan-neon');
    expect(fixture.emitters[1]!.visibleSourceMaterialId).toBeUndefined();
  });

  it('rejects unsafe or unbounded electrical-instability declarations', () => {
    const fixture = createNeonBladeSignFixture();
    const emitter = fixture.emitters[0]!;
    expect(() =>
      practicalFixtureSchema.parse({
        ...fixture,
        emitters: [
          {
            ...emitter,
            temporalModulation: {
              ...emitter.temporalModulation!,
              intensityMinimumMultiplier: 1.3,
              intensityMaximumMultiplier: 0.4,
              dropoutProbability: 0.9,
            },
          },
        ],
      }),
    ).toThrow();
  });
});
