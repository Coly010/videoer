import { describe, expect, it } from 'vitest';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import { compileStaticSurfaceWater } from '../src/environments/surface-water.js';
import {
  compileSurfaceHistory,
  verifySurfaceHistoryField,
  type SurfaceHistoryProfile,
} from '../src/environments/surface-history.js';

function sourceWater() {
  const geometry = mergeMeshParts(
    'environment.surface-history-receiver',
    [boxPart([0, -0.1, 0], [2, 0, 2], 0, 'stone')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { fixture: 'surface-history' },
  );
  geometry.materials = [
    {
      id: 'stone',
      baseColor: [0.2, 0.2, 0.2, 1],
      roughness: 0.7,
      metallic: 0,
      emission: [0, 0, 0],
      emissionStrength: 0,
    },
  ];
  return compileStaticSurfaceWater({
    schemaVersion: 1,
    id: 'environment.surface-history-water',
    receiver: {
      geometry,
      geometrySha256: canonicalSha256(geometry),
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
    grid: { cellSizeMeters: 0.25, supersample: 1, shelterRayMaximumMeters: 10 },
    solver: { edgeHeightThresholdMeters: 0.002, maximumCellCount: 1_000 },
  });
}

function profile(): SurfaceHistoryProfile {
  return {
    schemaVersion: 1,
    id: 'environment.surface-history-fixture',
    referenceDate: '2026-09-02',
    installationAgeYears: 80,
    trafficPaths: [
      {
        id: 'main-footfall',
        kind: 'pedestrian',
        localPoints: [
          [0, 1],
          [2, 1],
        ],
        halfWidthMeters: 0.1,
        falloffMeters: 0.2,
        equivalentPasses: 10_000,
        wearPerPass: 0.0001,
      },
    ],
    repairs: [{ id: 'repair-a', ageYears: 5 }],
    runoff: { referenceDepthMeters: 0.002, edgeWeight: 1, puddleWeight: 0.5 },
  };
}

describe('renderer-independent construction surface history', () => {
  it('is deterministic, content-addressed and topology-identical to source water', () => {
    const water = sourceWater();
    const input = {
      profile: profile(),
      sourceWaterField: water,
      repairPatches: [
        {
          id: 'repair-a',
          minimum: [0, 0] as [number, number],
          maximum: [1, 2] as [number, number],
        },
      ],
    };
    const first = compileSurfaceHistory(input);
    const second = compileSurfaceHistory(input);

    expect(first).toEqual(second);
    expect(
      first.cells.map((cell) => [cell.index, cell.row, cell.column, cell.worldPosition]),
    ).toEqual(water.cells.map((cell) => [cell.index, cell.row, cell.column, cell.worldPosition]));
    expect(first.cells.some((cell) => cell.trafficWear > 0.5)).toBe(true);
    expect(first.cells.some((cell) => cell.repairInfluence === 1)).toBe(true);
    expect(first.cells.every((cell) => cell.longTermExposure === 1)).toBe(true);
    expect(verifySurfaceHistoryField(first, water)).toMatchObject({ valid: true });

    const forged = structuredClone(first);
    forged.cells[0]!.trafficWear = 0;
    expect(verifySurfaceHistoryField(forged, water)).toMatchObject({ valid: false });
  });

  it('keeps causal channels independent and rejects stale source identities', () => {
    const water = sourceWater();
    const base = compileSurfaceHistory({
      profile: profile(),
      sourceWaterField: water,
      repairPatches: [{ id: 'repair-a', minimum: [0, 0], maximum: [1, 2] }],
    });
    const noTrafficProfile = profile();
    noTrafficProfile.trafficPaths = [];
    const noTraffic = compileSurfaceHistory({
      profile: noTrafficProfile,
      sourceWaterField: water,
      repairPatches: [{ id: 'repair-a', minimum: [0, 0], maximum: [1, 2] }],
    });

    expect(noTraffic.cells.every((cell) => cell.trafficWear === 0)).toBe(true);
    expect(noTraffic.cells.map((cell) => cell.runoffStaining)).toEqual(
      base.cells.map((cell) => cell.runoffStaining),
    );
    expect(noTraffic.cells.map((cell) => cell.repairInfluence)).toEqual(
      base.cells.map((cell) => cell.repairInfluence),
    );
    const wrongWater = structuredClone(water);
    wrongWater.id = 'environment.different-water';
    expect(verifySurfaceHistoryField(base, wrongWater)).toMatchObject({ valid: false });
    expect(() =>
      compileSurfaceHistory({
        profile: profile(),
        sourceWaterField: water,
        repairPatches: [],
      }),
    ).toThrow(/not live/u);
  });
});
