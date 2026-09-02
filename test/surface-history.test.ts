import { describe, expect, it } from 'vitest';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import {
  compileStaticSurfaceWater,
  type SurfaceWaterField,
  type SurfaceWaterFieldInput,
  type SurfaceWaterFieldV2,
} from '../src/environments/surface-water.js';
import {
  compileSurfaceHistory,
  compileSurfaceHistoryV2,
  compileSurfaceHistoryV3,
  verifySurfaceHistoryField,
  verifySurfaceHistoryFieldV2,
  verifySurfaceHistoryFieldV3,
  type SurfaceHistoryProfile,
  type SurfaceHistoryV3Profile,
} from '../src/environments/surface-history.js';

function sourceWater(): SurfaceWaterField;
function sourceWater(version: 2): SurfaceWaterFieldV2;
function sourceWater(version?: 2): SurfaceWaterField | SurfaceWaterFieldV2 {
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
  const input: SurfaceWaterFieldInput = {
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
  };
  return version === 2
    ? compileStaticSurfaceWater(input, { schemaVersion: 2 })
    : compileStaticSurfaceWater(input);
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

function profileV3(): SurfaceHistoryV3Profile {
  return {
    schemaVersion: 3,
    id: 'environment.surface-history-fixture-v3',
    referenceDate: '2026-09-02',
    installationAgeYears: 80,
    trafficPaths: [
      {
        id: 'main-footfall',
        kind: 'pedestrian',
        localPoints: [
          [-1, 0],
          [1, 0],
        ],
        halfWidthMeters: 0.13,
        falloffWidthMeters: 0.2,
        equivalentPasses: 100,
        passesAtHalfWear: 100,
      },
    ],
    repairs: [{ id: 'repair-a', ageYears: 5 }],
    exposure: { yearsAtHalfResponse: 80 },
    runoff: {
      backgroundThroughflowDepthMeters: 0,
      throughflowExcessDepthAtHalfResponse: 0.008,
      edgeWeight: 1,
      puddleWeight: 0.5,
      backgroundRetainedDepthMeters: 0,
      retainedExcessDepthAtHalfResponse: 0.002,
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
    expect(first.fieldSha256).toBe(
      '4552a873a921fcfa05333dded14c54805e177f90f65282182cbc26bd91b48ef6',
    );
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

  it('conserves physical dirt mass over the exact water-v2 parent tree', () => {
    const water = sourceWater(2);
    const result = compileSurfaceHistoryV2({
      profile: {
        ...profile(),
        schemaVersion: 2,
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
      },
      sourceWaterField: water,
      repairPatches: [{ id: 'repair-a', minimum: [0, 0], maximum: [1, 2] }],
    });

    expect(result.dirtMassBalance.inputKilograms).toBeGreaterThan(0);
    expect(result.fieldSha256).toBe(
      'e29cf0e58168ce155373bd1444dc13d1e7e271de7894d707e0846ad5c6fb8f16',
    );
    expect(result.dirtMassBalance.mobilizedKilograms).toBeGreaterThan(0);
    expect(result.dirtMassBalance.exportedKilograms).toBeGreaterThan(0);
    expect(result.dirtMassBalance.errorKilograms).toBeCloseTo(0, 12);
    expect(result.cells.some((cell) => cell.dirt.depositedMassKilograms > 0)).toBe(true);
    expect(verifySurfaceHistoryFieldV2(result, water)).toMatchObject({ valid: true });
    const repaired = result.cells.filter((cell) => cell.repairId === 'repair-a');
    const original = result.cells.filter((cell) => cell.repairId === null);
    expect(Math.max(...repaired.map((cell) => cell.dirt.builtUpMassKilograms))).toBeLessThan(
      Math.min(...original.map((cell) => cell.dirt.builtUpMassKilograms)),
    );

    const forged = structuredClone(result);
    forged.cells[0]!.dirt.finalLooseMassKilograms += 0.01;
    expect(verifySurfaceHistoryFieldV2(forged, water)).toMatchObject({ valid: false });
    const forgedTotals = structuredClone(result);
    forgedTotals.dirtMassBalance.mobilizedKilograms += 0.01;
    const { fieldSha256: _discardedTotalHash, ...forgedTotalsWithoutHash } = forgedTotals;
    void _discardedTotalHash;
    forgedTotals.fieldSha256 = canonicalSha256(forgedTotalsWithoutHash);
    expect(verifySurfaceHistoryFieldV2(forgedTotals, water)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.stringContaining("dirt total 'mobilizedKilograms' differs"),
      ]),
    });
    const forgedReceiver = structuredClone(result);
    forgedReceiver.receiver.transform.position[0] += 1;
    const { fieldSha256: _discardedReceiverHash, ...forgedReceiverWithoutHash } = forgedReceiver;
    void _discardedReceiverHash;
    forgedReceiver.fieldSha256 = canonicalSha256(forgedReceiverWithoutHash);
    expect(verifySurfaceHistoryFieldV2(forgedReceiver, water)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['surface-history v2 receiver identity mismatch']),
    });
    const routedCells = result.cells.filter(
      (cell) =>
        cell.dirt.incomingSuspendedMassKilograms > 1e-6 &&
        cell.dirt.depositedMassKilograms > 1e-6 &&
        cell.dirt.finalLooseMassKilograms > 1e-6,
    );
    expect(routedCells.length).toBeGreaterThanOrEqual(2);
    const forgedRouting = structuredClone(result);
    const firstRouted = forgedRouting.cells.find((cell) => cell.index === routedCells[0]!.index)!;
    const secondRouted = forgedRouting.cells.find((cell) => cell.index === routedCells[1]!.index)!;
    const transfer =
      Math.min(
        firstRouted.dirt.incomingSuspendedMassKilograms,
        firstRouted.dirt.depositedMassKilograms,
        firstRouted.dirt.finalLooseMassKilograms,
      ) / 2;
    firstRouted.dirt.incomingSuspendedMassKilograms -= transfer;
    firstRouted.dirt.depositedMassKilograms -= transfer;
    firstRouted.dirt.finalLooseMassKilograms -= transfer;
    secondRouted.dirt.incomingSuspendedMassKilograms += transfer;
    secondRouted.dirt.depositedMassKilograms += transfer;
    secondRouted.dirt.finalLooseMassKilograms += transfer;
    const { fieldSha256: _routingHash, ...forgedRoutingWithoutHash } = forgedRouting;
    void _routingHash;
    forgedRouting.fieldSha256 = canonicalSha256(forgedRoutingWithoutHash);
    expect(verifySurfaceHistoryFieldV2(forgedRouting, water)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.stringContaining('routing continuity mismatch')]),
    });
    expect(() =>
      compileSurfaceHistoryV2({
        profile: {
          ...profile(),
          schemaVersion: 2,
          dirt: { materialResponses: {} },
        },
        sourceWaterField: water,
        repairPatches: [{ id: 'repair-a', minimum: [0, 0], maximum: [1, 2] }],
      }),
    ).toThrow(/response is missing/u);
  });

  it('uses compact, half-response v3 channels while preserving the dirt operator', () => {
    const water = sourceWater(2);
    const repairPatches = [
      { id: 'repair-a', minimum: [0, 0] as [number, number], maximum: [1, 2] as [number, number] },
    ];
    const v3 = compileSurfaceHistoryV3({
      profile: profileV3(),
      sourceWaterField: water,
      repairPatches,
    });
    const v2 = compileSurfaceHistoryV2({
      profile: {
        ...profile(),
        schemaVersion: 2,
        dirt: profileV3().dirt,
      },
      sourceWaterField: water,
      repairPatches,
    });

    expect(verifySurfaceHistoryFieldV3(v3, water)).toMatchObject({ valid: true });
    expect(v3.cells.map((cell) => cell.dirt)).toEqual(v2.cells.map((cell) => cell.dirt));
    expect(v3.dirtMassBalance).toEqual(v2.dirtMassBalance);
    expect(v3.cells.some((cell) => cell.trafficWear === 0)).toBe(true);
    expect(v3.cells.some((cell) => cell.trafficWear === 0.5)).toBe(true);
    expect(
      v3.cells
        .filter((cell) => cell.repairId === null)
        .every(
          (cell) =>
            cell.rainExposureFraction === 1 &&
            cell.shelterProtection === 0 &&
            cell.exposureWeathering === 0.5,
        ),
    ).toBe(true);
    expect(v3.cells.every((cell) => cell.runoffStaining < 1)).toBe(true);

    const noRunoffProfile = profileV3();
    noRunoffProfile.runoff.backgroundThroughflowDepthMeters = 1;
    noRunoffProfile.runoff.backgroundRetainedDepthMeters = 1;
    const noRunoff = compileSurfaceHistoryV3({
      profile: noRunoffProfile,
      sourceWaterField: water,
      repairPatches,
    });
    expect(noRunoff.cells.every((cell) => cell.runoffThroughflowStaining === 0)).toBe(true);
    expect(noRunoff.cells.every((cell) => cell.retainedWaterStaining === 0)).toBe(true);
    expect(noRunoff.cells.every((cell) => cell.runoffStaining === 0)).toBe(true);
  });

  it('canonicalizes v3 path and repair ordering into one field identity', () => {
    const water = sourceWater(2);
    const firstProfile = profileV3();
    firstProfile.trafficPaths.push({
      ...firstProfile.trafficPaths[0]!,
      id: 'secondary-footfall',
      localPoints: [
        [-1, 0.5],
        [1, 0.5],
      ],
    });
    const secondProfile = structuredClone(firstProfile);
    secondProfile.trafficPaths.reverse();
    const first = compileSurfaceHistoryV3({
      profile: firstProfile,
      sourceWaterField: water,
      repairPatches: [{ id: 'repair-a', minimum: [0, 0], maximum: [1, 2] }],
    });
    const second = compileSurfaceHistoryV3({
      profile: secondProfile,
      sourceWaterField: water,
      repairPatches: [{ id: 'repair-a', minimum: [0, 0], maximum: [1, 2] }],
    });

    expect(first).toEqual(second);
    for (const channel of [
      'trafficWear',
      'exposureWeathering',
      'runoffThroughflowStaining',
      'retainedWaterStaining',
    ] as const) {
      const forged = structuredClone(first);
      forged.cells[0]![channel] = forged.cells[0]![channel] === 0.25 ? 0.5 : 0.25;
      if (channel === 'runoffThroughflowStaining' || channel === 'retainedWaterStaining') {
        const cell = forged.cells[0]!;
        cell.runoffStaining =
          1 - (1 - cell.runoffThroughflowStaining) * (1 - cell.retainedWaterStaining);
      }
      const { fieldSha256: _hash, ...withoutHash } = forged;
      void _hash;
      forged.fieldSha256 = canonicalSha256(withoutHash);
      expect(verifySurfaceHistoryFieldV3(forged, water)).toMatchObject({
        valid: false,
        issues: expect.arrayContaining([
          'surface-history v3 field differs from its embedded response model',
        ]),
      });
    }
  });
});
