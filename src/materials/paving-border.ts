import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export type PavingBorderMaterialKind =
  | 'historic-granite-kerb'
  | 'historic-dark-stone-gutter'
  | 'contemporary-concrete-kerb'
  | 'contemporary-channel-stone';

export function createPavingBorderSurfaceMaterial(kind: PavingBorderMaterialKind): SurfaceMaterial {
  const historic = kind.startsWith('historic-');
  const gutter = kind.endsWith('gutter') || kind.endsWith('channel-stone');
  const concrete = kind === 'contemporary-concrete-kerb';
  return surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: `material.paving-border-${kind}`,
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: concrete
        ? [
            [0.29, 0.285, 0.27, 1],
            [0.37, 0.355, 0.33, 1],
            [0.22, 0.225, 0.215, 1],
          ]
        : gutter
          ? [
              [0.055, 0.052, 0.048, 1],
              [0.09, 0.084, 0.075, 1],
              [0.035, 0.036, 0.037, 1],
            ]
          : [
              [0.2, 0.195, 0.185, 1],
              [0.28, 0.265, 0.24, 1],
              [0.135, 0.14, 0.145, 1],
            ],
      scaleMeters: concrete ? 0.014 : 0.022,
      seed: concrete ? 73_011 : gutter ? 73_019 : 73_027,
    },
    normal: {
      kind: 'procedural-noise',
      strength: concrete ? 0.3 : 0.48,
      scaleMeters: concrete ? 0.003 : 0.005,
    },
    roughness: {
      minimum: gutter ? 0.46 : concrete ? 0.54 : 0.5,
      maximum: gutter ? 0.7 : concrete ? 0.72 : 0.76,
      variationScaleMeters: concrete ? 0.01 : 0.018,
      wetness: 0,
    },
    surfaceWaterResponse: {
      absorption: {
        capacityMeters: concrete ? 0.0018 : 0.0007,
        rateMetersPerSecond: concrete ? 0.000006 : 0.000002,
        initialSaturation: 0.2,
      },
      retention: {
        filmCapacityMeters: 0.00045,
        edgeCapacityMeters: gutter ? 0.004 : 0.0015,
        maximumPuddleDepthMeters: gutter ? 0.05 : 0.025,
      },
      wetRoughness: { multiplier: gutter ? 0.4 : 0.48, floor: 0.1 },
      splash: { minimumFreeWaterDepthMeters: 0.00025, maximumSlopeDegrees: 18 },
    },
    pattern: concrete
      ? {
          kind: 'granular-aggregate',
          aggregateScaleMeters: 0.006,
          finesScaleMeters: 0.0012,
          aggregateContrast: 0.34,
          poreAmount: 0.12,
          compaction: 0.86,
          embeddedDirtAmount: 0.14,
        }
      : {
          kind: 'cut-stone',
          beddingAxis: 'x',
          beddingScaleMeters: 0.05,
          grainScaleMeters: 0.008,
          veinContrast: historic ? 0.16 : 0.12,
          poreAmount: historic ? 0.12 : 0.08,
        },
    historyResponseV3: {
      trafficWear: {
        colorMultiplier: gutter ? 1.015 : 1.035,
        roughnessOffset: gutter ? -0.08 : -0.12,
      },
      exposureWeathering: {
        colorMultiplier: concrete ? 1.035 : 1.015,
        roughnessOffset: concrete ? 0.035 : 0.02,
      },
      runoffStaining: {
        colorMultiplier: gutter ? 0.64 : 0.74,
        roughnessOffset: gutter ? 0.15 : 0.11,
      },
      repairInfluence: { colorMultiplier: 1.06, roughnessOffset: -0.025 },
    },
    dirtMassResponse: {
      loose: {
        colorMultiplier: gutter ? 0.62 : 0.7,
        roughnessOffset: gutter ? 0.16 : 0.13,
      },
      persistent: {
        colorMultiplier: gutter ? 0.7 : 0.78,
        roughnessOffset: gutter ? 0.11 : 0.08,
      },
    },
    surfaceHistoryV3Participation: { policy: 'optical-response' },
    constructionSurfaceResponse: {
      kind: 'paving-border',
      geometryBasis: 'authored-border-profile',
      historyFaces: gutter ? ['top'] : ['top', 'paving-facing'],
      faceTransitionCosine: gutter ? 0.72 : 0.64,
      ...(gutter
        ? {
            gutterZones: {
              coreWidthFraction: 0.46,
              transitionWidthFraction: 0.12,
              coreThroughflowCleaning: historic ? 0.78 : 0.7,
              marginRetainedDeposition: historic ? 1.25 : 1.12,
            },
          }
        : {}),
    },
    pavingBorder: {
      compatibleKinds: gutter ? ['gutter'] : concrete ? ['kerb', 'soldier-course'] : ['kerb'],
    },
    metallic: 0,
    metadata: {
      generator: 'videoer.paving-border-material.v1',
      constructionDomain: 'paving-border',
      materialKind: kind,
      physicalScale: 'object-space-metres',
      provenance: 'project-owned-procedural-definition',
    },
  });
}

export function createPavingBorderSwatch(kind: PavingBorderMaterialKind): GeometryAsset {
  const material = createPavingBorderSurfaceMaterial(kind);
  const geometry = mergeMeshParts(
    `material-swatch.paving-border-${kind}`,
    [boxPart([-1.2, -0.08, -0.7], [1.2, 0, 0.7], 0, 'border-surface')],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.paving-border-swatch.v1',
      materialClass: 'surface-swatch',
      pavingBorderMaterialKind: kind,
    },
  );
  const geometryMaterial: GeometryMaterial = {
    id: 'border-surface',
    baseColor: material.baseColor.colors[1]!,
    roughness: (material.roughness.minimum + material.roughness.maximum) / 2,
    metallic: material.metallic,
    emission: [0, 0, 0],
    emissionStrength: 0,
    surface: material,
  };
  geometry.materials = [geometryMaterial];
  return geometry;
}
