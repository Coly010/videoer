import { describe, expect, it } from 'vitest';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import type { GeometryAsset } from '../src/geometry/model.js';
import { compileStaticSurfaceWater } from '../src/environments/surface-water.js';
import {
  reconstructSurfaceWaterOpticalSurface,
  verifySurfaceWaterOpticalSurface,
} from '../src/environments/surface-water-surface.js';

function depressionReceiver(): GeometryAsset {
  const positions: Array<[number, number, number]> = [];
  for (let row = 0; row <= 4; row++)
    for (let column = 0; column <= 4; column++) {
      const distance = Math.hypot(column - 2, row - 2);
      const y = distance < 1 ? -0.075 : distance < 1.8 ? -0.035 : 0;
      positions.push([column, y, row]);
    }
  const indices: number[] = [];
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++) {
      const a = row * 5 + column;
      const b = a + 1;
      const d = (row + 1) * 5 + column;
      const c = d + 1;
      indices.push(a, d, b, b, d, c);
    }
  return {
    schemaVersion: 1,
    id: 'environment.optical-water-depression',
    units: 'meters',
    coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
    positions,
    indices,
    materials: [
      {
        id: 'stone',
        baseColor: [0.2, 0.2, 0.2, 1],
        roughness: 0.72,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
      },
    ],
    materialGroups: [{ materialId: 'stone', start: 0, count: indices.length }],
    skeleton: [],
    morphTargets: [],
    attachments: {},
    metadata: { fixture: 'optical-water-depression' },
  };
}

function puddleField() {
  const geometry = depressionReceiver();
  return compileStaticSurfaceWater({
    schemaVersion: 1,
    id: 'environment.optical-water-field',
    receiver: {
      geometry,
      geometrySha256: canonicalSha256(geometry),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
    drainage: {
      localDirection: [1, 0],
      gradientMetersPerMeter: 0.0001,
      outlets: [{ id: 'south-outlet', worldPosition: [2, 0, 0], radiusMeters: 0.55 }],
    },
    precipitation: {
      intensityMillimetersPerHour: 360,
      durationSeconds: 600,
      windMetersPerSecond: [0, 0],
      impactSpeedMetersPerSecond: 8,
      dropDiameterMillimeters: 2,
    },
    materialResponses: {
      stone: {
        targetClass: 'modeled-unit',
        absorption: { capacityMeters: 0, rateMetersPerSecond: 0, initialSaturation: 0 },
        retention: {
          filmCapacityMeters: 0.0002,
          edgeCapacityMeters: 0,
          maximumPuddleDepthMeters: 0.07,
        },
        wetRoughness: { dry: 0.72, multiplier: 0.35, floor: 0.14 },
        splash: { minimumFreeWaterDepthMeters: 0.0001, maximumSlopeDegrees: 30 },
      },
    },
    shelters: [],
    grid: { cellSizeMeters: 0.5, supersample: 4, shelterRayMaximumMeters: 10 },
    solver: { edgeHeightThresholdMeters: 0.002, maximumCellCount: 1_000 },
  });
}

const options = {
  schemaVersion: 1 as const,
  id: 'environment.optical-water-surface',
  contourDepthMeters: 0.000_01,
  opticalOffsetMeters: 0.000_2,
  maximumVolumeCorrectionFactor: 30,
};

describe('smooth surface-water optical reconstruction', () => {
  it('creates deterministic shared triangulation with interpolated non-cell boundary vertices', () => {
    const field = puddleField();
    const first = reconstructSurfaceWaterOpticalSurface(field, options);
    const second = reconstructSurfaceWaterOpticalSurface(field, options);

    expect(first).toEqual(second);
    expect(first.reconstructionSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.indices.length).toBeGreaterThan(0);
    expect(first.positions.length).toBeLessThan(first.indices.length);
    expect(first.report.boundaryVertexCount).toBeGreaterThan(0);
    expect(first.report.nonGridAlignedBoundaryVertexCount).toBeGreaterThan(0);
    expect(first.report.triangleCount).toBe(first.indices.length / 3);
    expect(first.report.sourceWetCellCount).toBeGreaterThan(0);
    expect(verifySurfaceWaterOpticalSurface(first)).toMatchObject({ valid: true, issues: [] });
  });

  it('preserves conserved puddle volume and explicit ground/depth semantics', () => {
    const surface = reconstructSurfaceWaterOpticalSurface(puddleField(), options);

    expect(surface.report.reconstructedVolumeCubicMeters).toBeCloseTo(
      surface.report.sourcePuddleVolumeCubicMeters,
      12,
    );
    expect(Math.abs(surface.report.volumeErrorCubicMeters)).toBeLessThan(1e-12);
    expect(
      surface.positions.every(
        (position, index) =>
          Math.abs(
            position[1] -
              surface.groundHeightsMeters[index]! -
              surface.options.opticalOffsetMeters -
              surface.depthsMeters[index]!,
          ) < 1e-10,
      ),
    ).toBe(true);
    expect(surface.report.maximumReconstructedDepthMeters).toBeGreaterThan(0);
  });

  it('content-addresses reconstruction choices and detects forged geometry/depth evidence', () => {
    const field = puddleField();
    const fine = reconstructSurfaceWaterOpticalSurface(field, options);
    const inset = reconstructSurfaceWaterOpticalSurface(field, {
      ...options,
      contourDepthMeters: 0.000_02,
    });
    expect(inset.sourceFieldSha256).toBe(fine.sourceFieldSha256);
    expect(inset.reconstructionSha256).not.toBe(fine.reconstructionSha256);
    expect(inset.report.reconstructedVolumeCubicMeters).toBeCloseTo(
      fine.report.reconstructedVolumeCubicMeters,
      12,
    );

    const forged = structuredClone(fine);
    forged.depthsMeters[0]! += 0.001;
    expect(verifySurfaceWaterOpticalSurface(forged).valid).toBe(false);

    const invalidField = structuredClone(field);
    invalidField.cells[0]!.puddleDepthMeters += 0.01;
    expect(() => reconstructSurfaceWaterOpticalSurface(invalidField, options)).toThrow(
      /invalid surface-water field/u,
    );
  });
});
