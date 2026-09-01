import { describe, expect, it } from 'vitest';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import type { GeometryAsset } from '../src/geometry/model.js';
import {
  compileStaticSurfaceWater,
  verifyStaticSurfaceWaterField,
  type SurfaceWaterFieldInput,
} from '../src/environments/surface-water.js';

function receiver() {
  const geometry = mergeMeshParts(
    'environment.surface-water-receiver',
    [boxPart([0, -0.1, 0], [2, 0, 2], 0, 'stone')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { fixture: 'surface-water' },
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
  return geometry;
}

function shelter() {
  const geometry = mergeMeshParts(
    'prop.surface-water-shelter',
    [boxPart([0, 0.9, 0], [1, 1, 2], 0, 'roof')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    { fixture: 'surface-water-shelter' },
  );
  geometry.materials = [
    {
      id: 'roof',
      baseColor: [0.1, 0.1, 0.1, 1],
      roughness: 0.6,
      metallic: 0,
      emission: [0, 0, 0],
      emissionStrength: 0,
    },
  ];
  return geometry;
}

function response(absorptionCapacityMeters = 0.001) {
  return {
    targetClass: 'modeled-unit' as const,
    absorption: {
      capacityMeters: absorptionCapacityMeters,
      rateMetersPerSecond: 0.001,
      initialSaturation: 0,
    },
    retention: {
      filmCapacityMeters: 0.0005,
      edgeCapacityMeters: 0.0005,
      maximumPuddleDepthMeters: 0.04,
    },
    wetRoughness: { dry: 0.72, multiplier: 0.4, floor: 0.16 },
    splash: { minimumFreeWaterDepthMeters: 0.0002, maximumSlopeDegrees: 12 },
  };
}

function input(
  options: { sheltered?: boolean; absorptionCapacityMeters?: number } = {},
): SurfaceWaterFieldInput {
  return {
    schemaVersion: 1 as const,
    id: 'environment.static-surface-water-fixture',
    receiver: {
      geometry: receiver(),
      geometrySha256: canonicalSha256(receiver()),
      transform: { position: [0, 0, 0] as const, rotation: [0, 0, 0] as const, scale: [1, 1, 1] as const },
    },
    drainage: {
      localDirection: [1, 0] as const,
      gradientMetersPerMeter: 0.02,
      outlets: [{ id: 'east-outlet', worldPosition: [2, 0, 1] as const, radiusMeters: 0.3 }],
    },
    precipitation: {
      intensityMillimetersPerHour: 120,
      durationSeconds: 300,
      windMetersPerSecond: [0, 0] as const,
      impactSpeedMetersPerSecond: 8,
      dropDiameterMillimeters: 2,
    },
    materialResponses: { stone: response(options.absorptionCapacityMeters) },
    shelters: options.sheltered
      ? [
          {
            id: 'half-canopy',
            geometry: shelter(),
            geometrySha256: canonicalSha256(shelter()),
            transform: {
              position: [0, 0, 0] as const,
              rotation: [0, 0, 0] as const,
              scale: [1, 1, 1] as const,
            },
          },
        ]
      : [],
    grid: { cellSizeMeters: 0.5, supersample: 4 as const, shelterRayMaximumMeters: 10 },
    solver: { edgeHeightThresholdMeters: 0.002, maximumCellCount: 1_000 },
  };
}

function depressionReceiver(): GeometryAsset {
  const positions: Array<[number, number, number]> = [];
  for (let row = 0; row <= 3; row++)
    for (let column = 0; column <= 3; column++) {
      const interior = (column === 1 || column === 2) && (row === 1 || row === 2);
      positions.push([column, interior ? -0.06 : 0, row]);
    }
  const indices: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++) {
      const a = row * 4 + column;
      const b = a + 1;
      const d = (row + 1) * 4 + column;
      const c = d + 1;
      indices.push(a, d, b, b, d, c);
    }
  return {
    schemaVersion: 1,
    id: 'environment.synthetic-drainage-depression',
    units: 'meters',
    coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
    positions,
    indices,
    materials: [
      {
        id: 'stone',
        baseColor: [0.2, 0.2, 0.2, 1],
        roughness: 0.7,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
      },
    ],
    materialGroups: [{ materialId: 'stone', start: 0, count: indices.length }],
    skeleton: [],
    morphTargets: [],
    attachments: {},
    metadata: { fixture: 'surface-water-depression' },
  };
}

describe('receiver-aware static surface-water fields', () => {
  it('is deterministic, row-major, content-addressed, and exactly mass conserving', () => {
    const first = compileStaticSurfaceWater(input());
    const second = compileStaticSurfaceWater(input());

    expect(first).toEqual(second);
    expect(first.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.fieldSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.cells.map((cell) => cell.index)).toEqual(
      [...first.cells.map((cell) => cell.index)].sort((left, right) => left - right),
    );
    expect(first.cells.every((cell) => cell.materialId === 'stone')).toBe(true);
    expect(first.cells.some((cell) => cell.runoffDepthMeters > 0)).toBe(true);
    expect(first.cells.some((cell) => cell.splashEligible)).toBe(true);
    expect(Math.abs(first.massBalance.errorCubicMeters)).toBeLessThan(1e-12);
    expect(
      first.massBalance.absorbedCubicMeters +
        first.massBalance.filmCubicMeters +
        first.massBalance.edgeCubicMeters +
        first.massBalance.puddleCubicMeters +
        first.massBalance.dischargedCubicMeters,
    ).toBeCloseTo(first.massBalance.incidentCubicMeters, 12);
    expect(verifyStaticSurfaceWaterField(first).valid).toBe(true);
    const forged = structuredClone(first);
    forged.cells[0]!.filmDepthMeters += 0.001;
    expect(verifyStaticSurfaceWaterField(forged)).toMatchObject({ valid: false });
  });

  it('derives fractional shelter exposure from exact transformed shelter triangles', () => {
    const open = compileStaticSurfaceWater(input());
    const sheltered = compileStaticSurfaceWater(input({ sheltered: true }));
    const covered = sheltered.cells.filter((cell) => cell.worldPosition[0] < 1);
    const exposed = sheltered.cells.filter((cell) => cell.worldPosition[0] > 1);

    expect(covered.every((cell) => cell.exposure === 0)).toBe(true);
    expect(exposed.every((cell) => cell.exposure === 1)).toBe(true);
    expect(sheltered.massBalance.incidentCubicMeters).toBeLessThan(
      open.massBalance.incidentCubicMeters,
    );
    expect(covered.every((cell) => !cell.splashEligible)).toBe(true);
    expect(sheltered.shelters[0]).toMatchObject({ id: 'half-canopy' });
  });

  it('responds to explicit absorption without changing receiver topology', () => {
    const porous = compileStaticSurfaceWater(input({ absorptionCapacityMeters: 0.008 }));
    const sealed = compileStaticSurfaceWater(input({ absorptionCapacityMeters: 0 }));

    expect(porous.cells.map((cell) => [cell.index, cell.triangleIndex, cell.worldPosition])).toEqual(
      sealed.cells.map((cell) => [cell.index, cell.triangleIndex, cell.worldPosition]),
    );
    expect(porous.massBalance.absorbedCubicMeters).toBeGreaterThan(
      sealed.massBalance.absorbedCubicMeters,
    );
    expect(porous.massBalance.dischargedCubicMeters).toBeLessThan(
      sealed.massBalance.dischargedCubicMeters,
    );
    expect(porous.inputSha256).not.toBe(sealed.inputSha256);
  });

  it('stores bounded water in an actual sampled depression before routing overflow', () => {
    const value = input({ absorptionCapacityMeters: 0 });
    value.receiver.geometry = depressionReceiver();
    value.grid.cellSizeMeters = 1;
    value.drainage.gradientMetersPerMeter = 0.0001;
    value.drainage.outlets = [
      { id: 'south-outlet', worldPosition: [1.5, 0, 0], radiusMeters: 0.6 },
    ];
    const field = compileStaticSurfaceWater(value);

    expect(field.cells.some((cell) => cell.puddleDepthMeters > 0)).toBe(true);
    expect(
      Math.max(...field.cells.map((cell) => cell.puddleDepthMeters)),
    ).toBeLessThanOrEqual(response(0).retention.maximumPuddleDepthMeters);
    expect(Math.abs(field.massBalance.errorCubicMeters)).toBeLessThan(1e-12);
  });

  it('hashes receiver transforms and fails closed on unresolved surface materials', () => {
    const originalInput = input();
    const translatedInput = structuredClone(originalInput);
    translatedInput.receiver.transform.position = [4, 0, -3];
    translatedInput.drainage.outlets![0]!.worldPosition = [6, 0, -2];
    const original = compileStaticSurfaceWater(originalInput);
    const translated = compileStaticSurfaceWater(translatedInput);

    expect(translated.receiver.geometrySha256).toBe(original.receiver.geometrySha256);
    expect(translated.receiver.transformSha256).not.toBe(original.receiver.transformSha256);
    expect(translated.inputSha256).not.toBe(original.inputSha256);
    expect(translated.cells.map((cell) => cell.filmDepthMeters)).toEqual(
      original.cells.map((cell) => cell.filmDepthMeters),
    );

    const unresolved = input();
    unresolved.materialResponses = {};
    expect(() => compileStaticSurfaceWater(unresolved)).toThrow(/missing for 'stone'/u);
  });
});
