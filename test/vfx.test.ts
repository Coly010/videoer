import { describe, expect, it } from 'vitest';
import { createRainyDuskVfx, toCinematicAtmosphere } from '../src/vfx/rainy-dusk.js';
import { createAtmosphericGroundResponseScene } from '../src/application/vfx.js';
import {
  aerosolOriginDistance,
  createHearthSmokeAndEmbersVfx,
  resolveAerosolVfx,
} from '../src/vfx/aerosol.js';
import { aerosolVfxSchema } from '../src/vfx/model.js';
import type { GeometryAsset } from '../src/geometry/model.js';

describe('rainy dusk atmospheric VFX', () => {
  it('defines deterministic non-overlapping camera-depth bands', () => {
    const vfx = createRainyDuskVfx();
    expect(vfx.placement).toBe('camera-relative');
    expect(vfx.rain.layers.map((layer) => layer.id)).toEqual([
      'foreground',
      'midground',
      'background',
    ]);
    expect(new Set(vfx.rain.layers.map((layer) => layer.seed)).size).toBe(3);
    expect(vfx.rain.layers[0]!.depthMaximumMeters).toBeLessThanOrEqual(
      vfx.rain.layers[1]!.depthMinimumMeters,
    );
    expect(vfx.rain.layers[1]!.depthMaximumMeters).toBeLessThanOrEqual(
      vfx.rain.layers[2]!.depthMinimumMeters,
    );
  });

  it('reduces streak scale and opacity with camera depth', () => {
    const layers = createRainyDuskVfx().rain.layers;
    expect(layers[0]!.streakLengthMeters).toBeGreaterThan(layers[1]!.streakLengthMeters);
    expect(layers[1]!.streakLengthMeters).toBeGreaterThan(layers[2]!.streakLengthMeters);
    expect(layers[0]!.opacity).toBeGreaterThan(layers[1]!.opacity);
    expect(layers[1]!.opacity).toBeGreaterThan(layers[2]!.opacity);
  });

  it('maps without loss into the cinematic atmosphere contract', () => {
    const vfx = createRainyDuskVfx();
    const atmosphere = toCinematicAtmosphere(vfx);
    expect(atmosphere.rain.layers).toEqual(vfx.rain.layers);
    expect(atmosphere.fogColor).toEqual(vfx.fog.color);
    expect(atmosphere.rain.windMetersPerSecond).toEqual([1.15, -0.22]);
    expect(atmosphere.rain.groundSplashes).toMatchObject({
      enabled: true,
      count: 58,
      seed: 1711,
    });
  });

  it('declares non-uniform drops and physically located surface response', () => {
    const rain = createRainyDuskVfx().rain;
    expect(rain.surfaceFlux).toEqual({
      intensityMillimetersPerHour: 18,
      durationSeconds: 900,
      dropDiameterMillimeters: 1.8,
      impactSpeedMetersPerSecond: 7.4,
    });
    expect(rain.layers.every((layer) => layer.lengthVariation > 0)).toBe(true);
    expect(rain.layers.every((layer) => layer.speedVariation > 0)).toBe(true);
    expect(rain.groundSplashes?.boundsMinimum[1]).toBeGreaterThanOrEqual(0);
    expect(rain.groundSplashes?.radiusMinimumMeters).toBeLessThan(
      rain.groundSplashes!.radiusMaximumMeters,
    );
    expect(rain.layers[0]!.depthMinimumMeters).toBeGreaterThanOrEqual(1.4);
    expect(rain.layers[0]!.streakRadiusMeters).toBeLessThanOrEqual(0.0012);
    expect(rain.layers[0]!.streakLengthMeters).toBeLessThanOrEqual(0.11);
    expect(rain.groundSplashes!.crownHeightMeters).toBeLessThanOrEqual(0.012);
  });

  it('builds a full-temporal low-angle ground-response verification scene', () => {
    const vfx = createRainyDuskVfx();
    const scene = createAtmosphericGroundResponseScene('/tmp/receiver.json', vfx);
    expect(scene.durationSeconds * scene.fps).toBe(12);
    expect(scene.landmarks).toHaveLength(5);
    expect(scene.camera.keyframes.every((keyframe) => keyframe.position[1] < 0.5)).toBe(true);
    expect(scene.atmosphere.rain.groundSplashes).toEqual(vfx.rain.groundSplashes);
    expect(scene.metadata).toMatchObject({
      verificationPurpose: 'close-range-world-space-ground-response',
      preservesDeclaredSplashDensity: true,
    });
  });
});

describe('source-bound world-space aerosol VFX', () => {
  const source: GeometryAsset = {
    schemaVersion: 1,
    id: 'prop.test-forge-source',
    units: 'meters',
    coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
    positions: [],
    indices: [],
    materials: [],
    materialGroups: [],
    skeleton: [],
    morphTargets: [],
    attachments: {
      'aerosol-origin': { position: [0, 1.2, 0], rotation: [0, Math.PI / 2, 0] },
    },
    metadata: {},
  };

  it('defines distinct true-volume smoke and emissive particle layers', () => {
    const vfx = createHearthSmokeAndEmbersVfx();
    expect(vfx.placement).toBe('source-relative');
    expect(vfx.layers.map((layer) => layer.kind)).toEqual(['smoke-volume', 'ember-particles']);
    expect(new Set(vfx.layers.map((layer) => layer.seed)).size).toBe(vfx.layers.length);
    expect(vfx.layers.every((layer) => layer.count > 0 && layer.turbulenceMeters > 0)).toBe(true);
  });

  it('resolves source-relative origins from live geometry attachments and transforms', () => {
    const resolved = resolveAerosolVfx(createHearthSmokeAndEmbersVfx(), {
      entityId: 'forge-source',
      geometry: source,
      attachmentId: 'aerosol-origin',
      transform: {
        position: [2, 0, -3],
        rotation: [0, Math.PI / 2, 0],
        scale: [1, 1, 1],
      },
    });
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.source).toMatchObject({
      entityId: 'forge-source',
      geometryAssetId: source.id,
      attachmentId: 'aerosol-origin',
    });
    expect(
      aerosolOriginDistance(resolved[0]!.origin, resolved[0]!.source.resolvedAttachmentPosition),
    ).toBeCloseTo(0.08, 8);
  });

  it('rejects duplicate layer seeds and inverted physical ranges', () => {
    const vfx = createHearthSmokeAndEmbersVfx();
    expect(() =>
      aerosolVfxSchema.parse({
        ...vfx,
        layers: vfx.layers.map((layer, index) => ({
          ...layer,
          seed: 99,
          ...(index === 0 ? { riseSpeedMetersPerSecond: { minimum: 2, maximum: 1 } } : {}),
        })),
      }),
    ).toThrow();
  });
});
