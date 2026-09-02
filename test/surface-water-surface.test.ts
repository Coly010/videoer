import { describe, expect, it } from 'vitest';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import type { GeometryAsset } from '../src/geometry/model.js';
import {
  compileStaticSurfaceWater,
  type SurfaceWaterField,
  type SurfaceWaterFieldInput,
  type SurfaceWaterFieldV2,
} from '../src/environments/surface-water.js';
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

function puddleField(): SurfaceWaterField;
function puddleField(schemaVersion: 2): SurfaceWaterFieldV2;
function puddleField(schemaVersion?: 2): SurfaceWaterField | SurfaceWaterFieldV2 {
  const geometry = depressionReceiver();
  const input: SurfaceWaterFieldInput = {
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
  };
  return schemaVersion === 2
    ? compileStaticSurfaceWater(input, { schemaVersion: 2 })
    : compileStaticSurfaceWater(input);
}

const options = {
  schemaVersion: 1 as const,
  id: 'environment.optical-water-surface',
  contourDepthMeters: 0.000_01,
  opticalOffsetMeters: 0.000_2,
  maximumVolumeCorrectionFactor: 30,
};

const refinedOptions = {
  schemaVersion: 2 as const,
  id: 'environment.optical-water-surface-refined',
  contourDepthMeters: 0.000_01,
  opticalOffsetMeters: 0.000_2,
  maximumVolumeCorrectionFactor: 30,
  subcellDivisions: 4,
  appearance: {
    model: 'thin-dielectric-water-v1' as const,
    ior: 1.333,
    roughness: 0.035,
    absorptionColorLinear: [0.72, 0.9, 0.95] as [number, number, number],
    absorptionDistanceMeters: 4,
  },
};

const conservativeOptions = {
  schemaVersion: 3 as const,
  id: 'environment.optical-water-surface-conservative',
  opticalOffsetMeters: 0.000_2,
  maximumVolumeCorrectionFactor: 30,
  subcellDivisions: 8,
  appearance: refinedOptions.appearance,
};

describe('smooth surface-water optical reconstruction', () => {
  it('creates deterministic shared triangulation with interpolated non-cell boundary vertices', () => {
    const field = puddleField();
    const first = reconstructSurfaceWaterOpticalSurface(field, options);
    const second = reconstructSurfaceWaterOpticalSurface(field, options);

    expect(first).toEqual(second);
    // Locks the original v1 content identity while v2 evolves independently.
    expect(first.reconstructionSha256).toBe(
      '60ab2ae604cc8fdbbbc45002d006dbc86eac01a334bd894bd0ba66970a6f9592',
    );
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

  it('deterministically refines contours below solver-cell scale with bounded mass correction', () => {
    const field = puddleField();
    const coarse = reconstructSurfaceWaterOpticalSurface(field, {
      ...refinedOptions,
      subcellDivisions: 2,
    });
    const refined = reconstructSurfaceWaterOpticalSurface(field, {
      ...refinedOptions,
      subcellDivisions: 8,
    });
    const repeated = reconstructSurfaceWaterOpticalSurface(field, {
      ...refinedOptions,
      subcellDivisions: 8,
    });

    expect(refined).toEqual(repeated);
    expect(refined.report.refinedCellSizeMeters).toBeCloseTo(field.grid.cellSizeMeters / 8, 12);
    expect(refined.report.triangleCount).toBeGreaterThan(coarse.report.triangleCount);
    expect(refined.report.boundaryEdgeCount).toBeGreaterThan(coarse.report.boundaryEdgeCount);
    expect(refined.report.maximumAxisAlignedBoundaryRunMeters).toBeLessThanOrEqual(
      coarse.report.maximumAxisAlignedBoundaryRunMeters,
    );
    expect(refined.report.axisAlignedBoundaryLengthRatio).toBeLessThan(
      coarse.report.axisAlignedBoundaryLengthRatio,
    );
    expect(refined.report.volumeCorrectionFactor).toBeLessThanOrEqual(
      refined.options.maximumVolumeCorrectionFactor,
    );
    expect(refined.report.reconstructedVolumeCubicMeters).toBeCloseTo(
      refined.report.sourcePuddleVolumeCubicMeters,
      12,
    );
    expect(verifySurfaceWaterOpticalSurface(refined)).toMatchObject({ valid: true, issues: [] });
  });

  it('binds thin-dielectric appearance and rejects forged appearance and boundary evidence', () => {
    const surface = reconstructSurfaceWaterOpticalSurface(puddleField(), refinedOptions);

    expect(surface).toMatchObject({
      schemaVersion: 2,
      generator: 'videoer.surface-water-optical-surface.v2',
      appearance: refinedOptions.appearance,
    });
    const forgedAppearance = structuredClone(surface);
    forgedAppearance.appearance.ior = 1.34;
    expect(verifySurfaceWaterOpticalSurface(forgedAppearance).valid).toBe(false);

    const forgedBoundary = structuredClone(surface);
    forgedBoundary.report.axisAlignedBoundaryLengthRatio = 0;
    const { reconstructionSha256: _discarded, ...forgedBoundaryWithoutHash } = forgedBoundary;
    void _discarded;
    forgedBoundary.reconstructionSha256 = canonicalSha256(forgedBoundaryWithoutHash);
    expect(verifySurfaceWaterOpticalSurface(forgedBoundary).valid).toBe(false);

    expect(() =>
      reconstructSurfaceWaterOpticalSurface(puddleField(), {
        ...refinedOptions,
        appearance: { ...refinedOptions.appearance, ior: 1.5 },
      }),
    ).toThrow();
  });

  it('preserves refined optical reconstruction when the exact source field adds v2 routing', () => {
    const legacyField = puddleField();
    const field = puddleField(2);
    const legacySurface = reconstructSurfaceWaterOpticalSurface(legacyField, refinedOptions);
    const surface = reconstructSurfaceWaterOpticalSurface(field, refinedOptions);

    expect(surface.sourceFieldSha256).toBe(field.fieldSha256);
    expect(surface.sourceFieldSha256).not.toBe(legacySurface.sourceFieldSha256);
    expect(surface.reconstructionSha256).not.toBe(legacySurface.reconstructionSha256);
    expect(surface.positions).toEqual(legacySurface.positions);
    expect(surface.groundHeightsMeters).toEqual(legacySurface.groundHeightsMeters);
    expect(surface.depthsMeters).toEqual(legacySurface.depthsMeters);
    expect(surface.indices).toEqual(legacySurface.indices);
    expect(surface.report).toEqual(legacySurface.report);
    expect(surface.report.sourcePuddleVolumeCubicMeters).toBeCloseTo(
      field.massBalance.puddleCubicMeters,
      12,
    );
    expect(surface.report.reconstructedVolumeCubicMeters).toBeCloseTo(
      field.massBalance.puddleCubicMeters,
      12,
    );
    expect(surface.report.refinedCellSizeMeters).toBeCloseTo(field.grid.cellSizeMeters / 4, 12);
    expect(verifySurfaceWaterOpticalSurface(surface)).toMatchObject({ valid: true, issues: [] });

    const forged = structuredClone(field);
    forged.routing.nodes[0]!.rank = forged.routing.nodes[1]!.rank;
    expect(() => reconstructSurfaceWaterOpticalSurface(forged, refinedOptions)).toThrow(
      /invalid surface-water field/u,
    );
  });

  it('separates v3 wet support from depth while conserving source area, volume and peak depth', () => {
    const field = puddleField(2);
    const first = reconstructSurfaceWaterOpticalSurface(field, conservativeOptions);
    const repeated = reconstructSurfaceWaterOpticalSurface(field, conservativeOptions);
    const sourceSupportArea = field.cells
      .filter((cell) => cell.puddleDepthMeters > 0)
      .reduce((sum, cell) => sum + cell.coverage * field.grid.cellSizeMeters ** 2, 0);

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      schemaVersion: 3,
      generator: 'videoer.surface-water-optical-surface.v3',
      supportModel: 'wendland-c2-area-calibrated-v1',
      appearance: conservativeOptions.appearance,
    });
    expect(first.report.sourceSupportAreaSquareMeters).toBeCloseTo(sourceSupportArea, 10);
    expect(first.report.projectedAreaSquareMeters).toBeCloseTo(sourceSupportArea, 8);
    expect(first.report.projectedAreaRatio).toBeCloseTo(1, 8);
    expect(first.report.reconstructedVolumeCubicMeters).toBeCloseTo(
      field.massBalance.puddleCubicMeters,
      12,
    );
    expect(first.report.maximumReconstructedDepthMeters).toBeLessThanOrEqual(
      first.report.maximumSourcePuddleDepthMeters + 1e-12,
    );
    expect(first.report.receiverEscapeAreaSquareMeters).toBe(0);
    expect(first.report.nonGridAlignedBoundaryVertexCount).toBeGreaterThan(0);
    expect(verifySurfaceWaterOpticalSurface(first)).toMatchObject({ valid: true, issues: [] });

    const forged = structuredClone(first);
    forged.report.projectedAreaSquareMeters *= 1.25;
    const { reconstructionSha256: _discarded, ...withoutHash } = forged;
    void _discarded;
    forged.reconstructionSha256 = canonicalSha256(withoutHash);
    expect(verifySurfaceWaterOpticalSurface(forged).valid).toBe(false);
  });

  it('fails closed when a legacy field cannot locate partial wet-cell support', () => {
    const field = structuredClone(puddleField());
    const wetCell = field.cells.find((cell) => cell.puddleDepthMeters > 0)!;
    wetCell.coverage = 0.5;
    const { fieldSha256: _discarded, ...withoutHash } = field;
    void _discarded;
    field.fieldSha256 = canonicalSha256(withoutHash);

    expect(() => reconstructSurfaceWaterOpticalSurface(field, conservativeOptions)).toThrow(
      /persisted subcell receiver mask/u,
    );
  });
});
