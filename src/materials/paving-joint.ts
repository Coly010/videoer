import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export type PavingGranularKind = 'natural-grit' | 'polymeric-sand' | 'compacted-base';

const definitions: Record<
  PavingGranularKind,
  {
    id: string;
    colors: Array<[number, number, number, number]>;
    aggregateScaleMeters: number;
    finesScaleMeters: number;
    aggregateContrast: number;
    poreAmount: number;
    compaction: number;
    embeddedDirtAmount: number;
    roughness: [number, number];
    absorptionCapacityMeters: number;
    absorptionRateMetersPerSecond: number;
  }
> = {
  'natural-grit': {
    id: 'material.paving-joint-natural-grit',
    colors: [
      [0.006, 0.0045, 0.003, 1],
      [0.018, 0.013, 0.009, 1],
      [0.003, 0.002, 0.0015, 1],
      [0.032, 0.024, 0.016, 1],
    ],
    aggregateScaleMeters: 0.007,
    finesScaleMeters: 0.0012,
    aggregateContrast: 0.72,
    poreAmount: 0.58,
    compaction: 0.42,
    embeddedDirtAmount: 0.38,
    roughness: [0.62, 0.91],
    absorptionCapacityMeters: 0.005,
    absorptionRateMetersPerSecond: 0.00002,
  },
  'polymeric-sand': {
    id: 'material.paving-joint-polymeric-sand',
    colors: [
      [0.01, 0.0095, 0.0085, 1],
      [0.026, 0.024, 0.021, 1],
      [0.005, 0.0048, 0.0044, 1],
      [0.042, 0.038, 0.032, 1],
    ],
    aggregateScaleMeters: 0.0045,
    finesScaleMeters: 0.00075,
    aggregateContrast: 0.5,
    poreAmount: 0.32,
    compaction: 0.74,
    embeddedDirtAmount: 0.22,
    roughness: [0.58, 0.84],
    absorptionCapacityMeters: 0.0012,
    absorptionRateMetersPerSecond: 0.000004,
  },
  'compacted-base': {
    id: 'material.paving-substrate-compacted-base',
    colors: [
      [0.014, 0.012, 0.009, 1],
      [0.04, 0.032, 0.023, 1],
      [0.007, 0.006, 0.0045, 1],
      [0.065, 0.052, 0.037, 1],
    ],
    aggregateScaleMeters: 0.018,
    finesScaleMeters: 0.002,
    aggregateContrast: 0.64,
    poreAmount: 0.45,
    compaction: 0.82,
    embeddedDirtAmount: 0.46,
    roughness: [0.68, 0.94],
    absorptionCapacityMeters: 0.012,
    absorptionRateMetersPerSecond: 0.000035,
  },
};

export function createPavingGranularSurfaceMaterial(kind: PavingGranularKind): SurfaceMaterial {
  const definition = definitions[kind];
  const historyResponseV3 =
    kind === 'natural-grit'
      ? {
          trafficWear: { colorMultiplier: 1.02, roughnessOffset: -0.08 },
          exposureWeathering: { colorMultiplier: 0.96, roughnessOffset: 0.05 },
          runoffStaining: { colorMultiplier: 0.68, roughnessOffset: 0.15 },
          repairInfluence: { colorMultiplier: 1.05, roughnessOffset: -0.02 },
        }
      : kind === 'polymeric-sand'
        ? {
            trafficWear: { colorMultiplier: 1.02, roughnessOffset: -0.07 },
            exposureWeathering: { colorMultiplier: 1.03, roughnessOffset: 0.03 },
            runoffStaining: { colorMultiplier: 0.74, roughnessOffset: 0.12 },
            repairInfluence: { colorMultiplier: 1.06, roughnessOffset: -0.03 },
          }
        : {
            trafficWear: { colorMultiplier: 0.94, roughnessOffset: -0.12 },
            exposureWeathering: { colorMultiplier: 1.02, roughnessOffset: 0.02 },
            runoffStaining: { colorMultiplier: 0.64, roughnessOffset: 0.16 },
            repairInfluence: { colorMultiplier: 1.08, roughnessOffset: -0.02 },
          };
  const dirtMassResponse =
    kind === 'natural-grit'
      ? {
          loose: { colorMultiplier: 0.58, roughnessOffset: 0.18 },
          persistent: { colorMultiplier: 0.68, roughnessOffset: 0.12 },
        }
      : kind === 'polymeric-sand'
        ? {
            loose: { colorMultiplier: 0.66, roughnessOffset: 0.15 },
            persistent: { colorMultiplier: 0.75, roughnessOffset: 0.1 },
          }
        : {
            loose: { colorMultiplier: 0.55, roughnessOffset: 0.18 },
            persistent: { colorMultiplier: 0.65, roughnessOffset: 0.12 },
          };
  const constructionSurfaceResponse =
    kind === 'natural-grit'
      ? {
          kind: 'natural-joint' as const,
          geometryBasis: 'authored-joint-recession' as const,
          heightRepresentation: 'render-mesh-displacement-required' as const,
          clogging: {
            driver: 'dirt-coverage' as const,
            looseWeight: 0.65,
            persistentWeight: 1,
            onsetCoverage: 0.15,
            saturationCoverage: 0.85,
            maximumFillFractionOfRecession: 0.72,
          },
          normal: { intactStrengthScale: 1, changedStrengthScale: 0.45 },
        }
      : kind === 'polymeric-sand'
        ? {
            kind: 'polymeric-joint' as const,
            geometryBasis: 'authored-joint-recession' as const,
            heightRepresentation: 'render-mesh-displacement-required' as const,
            coherentFailure: {
              driver: 'traffic-and-throughflow' as const,
              trafficWeight: 0.68,
              throughflowWeight: 0.82,
              onset: 0.58,
              saturation: 0.86,
              coherenceScaleMeters: 0.18,
              seed: 90_217,
              maximumAdditionalRecessionFraction: 0.55,
            },
            normal: { intactStrengthScale: 0.75, changedStrengthScale: 1.4 },
          }
        : {
            kind: 'exposed-substrate' as const,
            activation: 'active-history-cells-only' as const,
            heightRepresentation: 'none-no-calibrated-height' as const,
            normal: { strengthScale: 1.1 },
            dirtDepositionScale: 1.25,
          };
  return surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: definition.colors,
      scaleMeters: 0.18,
      seed: kind === 'natural-grit' ? 1849 : kind === 'polymeric-sand' ? 90213 : 44117,
    },
    normal: {
      kind: 'procedural-noise',
      strength: kind === 'natural-grit' ? 0.72 : kind === 'polymeric-sand' ? 0.48 : 0.62,
      scaleMeters: definition.finesScaleMeters,
    },
    roughness: {
      minimum: definition.roughness[0],
      maximum: definition.roughness[1],
      variationScaleMeters: definition.aggregateScaleMeters,
      wetness: 0,
    },
    surfaceWaterResponse: {
      absorption: {
        capacityMeters: definition.absorptionCapacityMeters,
        rateMetersPerSecond: definition.absorptionRateMetersPerSecond,
        initialSaturation: 0.25,
      },
      retention: {
        filmCapacityMeters: 0.00025,
        edgeCapacityMeters:
          kind === 'natural-grit' ? 0.0025 : kind === 'polymeric-sand' ? 0.0015 : 0.004,
        maximumPuddleDepthMeters:
          kind === 'natural-grit' ? 0.025 : kind === 'polymeric-sand' ? 0.018 : 0.04,
      },
      wetRoughness: { multiplier: 0.52, floor: 0.12 },
      splash: { minimumFreeWaterDepthMeters: 0.0003, maximumSlopeDegrees: 12 },
    },
    pattern: {
      kind: 'granular-aggregate',
      aggregateScaleMeters: definition.aggregateScaleMeters,
      finesScaleMeters: definition.finesScaleMeters,
      aggregateContrast: definition.aggregateContrast,
      poreAmount: definition.poreAmount,
      compaction: definition.compaction,
      embeddedDirtAmount: definition.embeddedDirtAmount,
    },
    weathering: {
      surfaceDirt: {
        amount: definition.embeddedDirtAmount,
        scaleMeters: kind === 'natural-grit' ? 0.22 : kind === 'polymeric-sand' ? 0.35 : 0.45,
      },
    },
    historyResponseV3,
    dirtMassResponse,
    surfaceHistoryV3Participation: { policy: 'optical-response' },
    constructionSurfaceResponse,
    metallic: 0,
    metadata: {
      generator: 'videoer.paving-joint-material.v1',
      constructionDomain: 'paving-joint-substrate',
      granularKind: kind,
      physicalScale: 'object-space-metres',
    },
  });
}

export function createPavingGranularSwatch(kind: PavingGranularKind): GeometryAsset {
  const material = createPavingGranularSurfaceMaterial(kind);
  const geometry = mergeMeshParts(
    `material-swatch.paving-joint-${kind}`,
    [boxPart([-1.2, -0.03, -0.7], [1.2, 0, 0.7], 0, 'joint-surface')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.paving-granular-swatch.v1',
      materialClass: 'surface-swatch',
      granularKind: kind,
    },
  );
  const geometryMaterial: GeometryMaterial = {
    id: 'joint-surface',
    baseColor: material.baseColor.colors[1]!,
    roughness: (material.roughness.minimum + material.roughness.maximum) / 2,
    metallic: 0,
    emission: [0, 0, 0],
    emissionStrength: 0,
    surface: material,
  };
  geometry.materials = [geometryMaterial];
  return geometry;
}
