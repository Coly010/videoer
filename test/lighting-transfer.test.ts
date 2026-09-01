import { describe, expect, it } from 'vitest';
import { createWarmInteriorLightingRig } from '../src/lighting/bookshop.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../src/lighting/adaptation.js';
import { lightingTransferProbeSchema } from '../src/lighting/transfer-probe.js';

const definition = {
  schemaVersion: 1 as const,
  id: 'lighting-probe.gallery-interior-v03',
  sourceRigPath: 'warm-interior/lighting-rig.json',
  environmentGeometryPath: '../../../../nocturne-exhibition-conformance/work/gallery/geometry.json',
  adaptation: {
    kind: 'lighting-rig-transform-v1' as const,
    assetId: 'lighting.gallery-interior-v03-transfer',
    transform: {
      translation: [-0.45, 0.15, -4.6] as [number, number, number],
      yawRadians: 0,
      uniformScale: 1,
    },
    energyScale: 0.92,
    purposeEnergyScale: { key: 1.1, fill: 1, rim: 1.1, practical: 1, environment: 1 },
    colorMultiply: [0.96, 0.94, 1] as [number, number, number],
    worldColor: [0.004, 0.006, 0.014] as [number, number, number],
  },
  witnessTransform: {
    position: [0, 0, -2.2] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  },
  camera: {
    start: {
      position: [-0.95, 1.45, -5.35] as [number, number, number],
      target: [0, 0.88, -2.2] as [number, number, number],
      lensMillimeters: 44,
    },
    end: {
      position: [-0.65, 1.48, -5.1] as [number, number, number],
      target: [0, 0.9, -2.18] as [number, number, number],
      lensMillimeters: 48,
    },
  },
  resolution: { width: 480, height: 480, percentage: 100 as const },
  exposureRegion: {
    x: 0.18,
    y: 0.12,
    width: 0.64,
    height: 0.78,
    maximumBlackPercentage: 55,
    maximumWhitePercentage: 10,
    minimumMidtonePercentage: 38,
  },
};

describe('lighting transfer probes', () => {
  it('persists a renderer-independent unrelated-set transfer definition', () => {
    const parsed = lightingTransferProbeSchema.parse(definition);
    const base = createWarmInteriorLightingRig();
    const adapted = adaptLightingRig(base, parsed.adaptation);
    expect(verifyLightingRigAdaptation(base, adapted, parsed.adaptation)).toMatchObject({
      valid: true,
      topologyPreserved: true,
      exposurePreserved: true,
      spatialTransformMatched: true,
    });
    expect(parsed.metadata).toEqual({});
  });

  it('rejects an exposure region outside the frame', () => {
    expect(() =>
      lightingTransferProbeSchema.parse({
        ...definition,
        exposureRegion: { ...definition.exposureRegion, x: 0.7, width: 0.5 },
      }),
    ).toThrow();
  });
});
