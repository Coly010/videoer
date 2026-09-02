import { describe, expect, it } from 'vitest';
import { canonicalSha256 } from '../src/assets/sources/cache.js';
import type { GeometryAsset } from '../src/geometry/model.js';
import {
  compileStaticSurfaceWater,
  type SurfaceWaterFieldInput,
} from '../src/environments/surface-water.js';
import {
  compileSurfaceWaterReceiverAppearance,
  verifySurfaceWaterReceiverAppearance,
} from '../src/environments/surface-water-appearance.js';

function receiver(): GeometryAsset {
  const positions: Array<[number, number, number]> = [];
  for (let row = 0; row <= 4; row++)
    for (let column = 0; column <= 4; column++) {
      const depression = Math.hypot(column - 2, row - 2) < 1.25 ? -0.018 : 0;
      positions.push([column, depression, row]);
    }
  const indices: number[] = [];
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++) {
      const topLeft = row * 5 + column;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * 5 + column;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  return {
    schemaVersion: 1,
    id: 'environment.receiver-appearance-test',
    units: 'meters',
    coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
    positions,
    indices,
    materials: [
      {
        id: 'concrete',
        baseColor: [0.35, 0.34, 0.32, 1],
        roughness: 0.6,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
      },
    ],
    materialGroups: [{ materialId: 'concrete', start: 0, count: indices.length }],
    skeleton: [],
    morphTargets: [],
    attachments: {},
    metadata: { fixture: 'receiver-appearance' },
  };
}

function response(asperityEnvelopeMeters = 0.0007) {
  return {
    targetClass: 'modeled-unit' as const,
    absorption: {
      capacityMeters: 0.0014,
      rateMetersPerSecond: 0.000004,
      initialSaturation: 0.2,
    },
    retention: {
      filmCapacityMeters: 0.0004,
      edgeCapacityMeters: 0.0012,
      maximumPuddleDepthMeters: 0.018,
    },
    wetRoughness: { dry: 0.6, multiplier: 0.34, floor: 0.045 },
    receiverAppearance: {
      model: 'porous-damp-coherent-film-v1' as const,
      saturatedBaseColorMultiplier: 0.9,
      saturatedRoughnessMultiplier: 0.82,
      asperityEnvelopeMeters,
      coherenceTransitionMeters: 0.0002,
      maximumCoherentFilmCoverage: 1,
      waterIor: 1.333,
      interfaceRoughness: 0.12,
      normalMode: 'receiver-conformal' as const,
      evidence: {
        basis: 'heuristic-prior' as const,
        reference: 'FHWA concrete macrotexture reference; project visual calibration pending',
      },
    },
    splash: { minimumFreeWaterDepthMeters: 0.00025, maximumSlopeDegrees: 30 },
  };
}

function field(asperityEnvelopeMeters = 0.0007) {
  const geometry = receiver();
  const materialResponses = { concrete: response(asperityEnvelopeMeters) };
  const input: SurfaceWaterFieldInput = {
    schemaVersion: 1,
    id: 'environment.receiver-appearance-water',
    receiver: {
      geometry,
      geometrySha256: canonicalSha256(geometry),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
    drainage: {
      localDirection: [1, 0],
      gradientMetersPerMeter: 0.0001,
      outlets: [{ id: 'edge-outlet', worldPosition: [4, 0, 2], radiusMeters: 0.5 }],
    },
    precipitation: {
      intensityMillimetersPerHour: 180,
      durationSeconds: 600,
      windMetersPerSecond: [0, 0],
      impactSpeedMetersPerSecond: 8,
      dropDiameterMillimeters: 2,
    },
    materialResponses,
    shelters: [],
    grid: { cellSizeMeters: 0.5, supersample: 4, shelterRayMaximumMeters: 10 },
    solver: { edgeHeightThresholdMeters: 0.002, maximumCellCount: 1_000 },
  };
  return { field: compileStaticSurfaceWater(input, { schemaVersion: 2 }), materialResponses };
}

describe('surface-water receiver appearance', () => {
  it('keeps sub-asperity retained water porous and deterministic without a dielectric coat', () => {
    const source = field();
    const first = compileSurfaceWaterReceiverAppearance(
      source.field,
      source.materialResponses,
      'environment.receiver-appearance',
    );
    const repeated = compileSurfaceWaterReceiverAppearance(
      source.field,
      source.materialResponses,
      'environment.receiver-appearance',
    );

    expect(first).toEqual(repeated);
    expect(first.report.dampCellCount).toBeGreaterThan(0);
    expect(first.report.coherentFilmCellCount).toBe(0);
    expect(first.report.coherentFilmAreaSquareMeters).toBe(0);
    expect(first.report.sceneGlobalNormalizationUsed).toBe(false);
    expect(first.cells.some((cell) => cell.baseColorMultiplier < 1)).toBe(true);
    expect(first.cells.some((cell) => cell.roughnessMultiplier < 1)).toBe(true);
    expect(verifySurfaceWaterReceiverAppearance(first, source.field)).toMatchObject({
      valid: true,
      issues: [],
    });
  });

  it('admits coherent film only above the material envelope and never under puddles', () => {
    const source = field(0.0001);
    const appearance = compileSurfaceWaterReceiverAppearance(
      source.field,
      source.materialResponses,
      'environment.receiver-appearance-coherent',
    );

    expect(appearance.report.coherentFilmCellCount).toBeGreaterThan(0);
    expect(appearance.report.absorbedOnlyCoherentFilmCellCount).toBe(0);
    expect(appearance.report.belowAsperityCoherentFilmCellCount).toBe(0);
    expect(appearance.report.puddleOverlapCoherentFilmCellCount).toBe(0);
    for (const cell of appearance.cells.filter((cell) => cell.coherentFilmCoverage > 0)) {
      const sourceCell = source.field.cells.find((candidate) => candidate.index === cell.index)!;
      expect(sourceCell.filmDepthMeters).toBeGreaterThan(0.0001);
      expect(sourceCell.puddleDepthMeters).toBe(0);
    }
  });

  it('is local: a distant deeper puddle cannot change another cell appearance', () => {
    const source = field();
    const baseline = compileSurfaceWaterReceiverAppearance(
      source.field,
      source.materialResponses,
      'environment.receiver-appearance-locality',
    );
    const modified = structuredClone(source.field);
    const distant = modified.cells.find((cell) => cell.puddleDepthMeters > 0)!;
    const unaffected = modified.cells.find(
      (cell) => cell.index !== distant.index && cell.puddleDepthMeters === 0,
    )!;
    const addedDepth = 0.0001;
    distant.puddleDepthMeters += addedDepth;
    const addedVolume = addedDepth * modified.grid.cellSizeMeters ** 2 * distant.coverage;
    modified.massBalance.puddleCubicMeters += addedVolume;
    modified.massBalance.dischargedCubicMeters -= addedVolume;
    const { fieldSha256: _discarded, ...withoutHash } = modified;
    void _discarded;
    modified.fieldSha256 = canonicalSha256(withoutHash);
    const changed = compileSurfaceWaterReceiverAppearance(
      modified,
      source.materialResponses,
      'environment.receiver-appearance-locality',
    );

    expect(changed.cells.find((cell) => cell.index === unaffected.index)).toEqual(
      baseline.cells.find((cell) => cell.index === unaffected.index),
    );
  });

  it('fails closed for missing calibration and forged persisted channels', () => {
    const source = field();
    const missing = {
      concrete: {
        ...structuredClone(source.materialResponses.concrete),
        receiverAppearance: undefined,
      },
    };
    expect(() =>
      compileSurfaceWaterReceiverAppearance(
        source.field,
        missing,
        'environment.receiver-appearance-missing',
      ),
    ).toThrow(/material-response hash mismatch|lacks a receiver-appearance calibration/u);

    const appearance = compileSurfaceWaterReceiverAppearance(
      source.field,
      source.materialResponses,
      'environment.receiver-appearance-forged',
    );
    const forged = structuredClone(appearance);
    forged.cells[0]!.coherentFilmCoverage = 1;
    const { appearanceSha256: _discarded, ...withoutHash } = forged;
    void _discarded;
    forged.appearanceSha256 = canonicalSha256(withoutHash);
    expect(verifySurfaceWaterReceiverAppearance(forged, source.field).valid).toBe(false);
  });
});
