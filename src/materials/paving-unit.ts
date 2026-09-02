import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export type PavingUnitMaterialKind = 'historic-cut-granite' | 'contemporary-concrete-paver';

const unitVariation = {
  kind: 'vertex-scalar-attributes-v1' as const,
  valueAttribute: 'videoer_unit_value_variation' as const,
  roughnessAttribute: 'videoer_unit_roughness_variation' as const,
  weatheringAttribute: 'videoer_unit_weathering_variation' as const,
  edgeWearAttribute: 'videoer_paving_edge_wear' as const,
  dirtAccumulationAttribute: 'videoer_paving_dirt_accumulation' as const,
  valueAmplitude: 0.08,
  roughnessAmplitude: 0.07,
  weatheringAmplitude: 0.2,
  edgeWearAmount: 0.5,
  dirtAccumulationAmount: 0.68,
};

export function createPavingUnitSurfaceMaterial(kind: PavingUnitMaterialKind): SurfaceMaterial {
  const historic = kind === 'historic-cut-granite';
  return surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: `material.${kind}`,
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: historic
        ? [
            [0.16, 0.155, 0.145, 1],
            [0.22, 0.205, 0.18, 1],
            [0.11, 0.12, 0.125, 1],
            [0.28, 0.255, 0.22, 1],
          ]
        : [
            [0.31, 0.3, 0.275, 1],
            [0.39, 0.375, 0.34, 1],
            [0.24, 0.245, 0.235, 1],
          ],
      scaleMeters: historic ? 0.018 : 0.012,
      seed: historic ? 1307 : 2203,
    },
    normal: {
      kind: 'procedural-noise',
      strength: historic ? 0.55 : 0.34,
      scaleMeters: historic ? 0.004 : 0.0025,
    },
    roughness: {
      minimum: historic ? 0.48 : 0.5,
      maximum: historic ? 0.74 : 0.68,
      variationScaleMeters: historic ? 0.012 : 0.008,
      wetness: 0,
    },
    pattern: historic
      ? {
          kind: 'cut-stone',
          beddingAxis: 'x',
          beddingScaleMeters: 0.035,
          grainScaleMeters: 0.006,
          veinContrast: 0.18,
          poreAmount: 0.16,
        }
      : {
          kind: 'granular-aggregate',
          aggregateScaleMeters: 0.006,
          finesScaleMeters: 0.0012,
          aggregateContrast: 0.38,
          poreAmount: 0.13,
          compaction: 0.82,
          embeddedDirtAmount: 0.12,
        },
    unitVariation: {
      ...unitVariation,
      ...(historic
        ? { valueAmplitude: 0.09, roughnessAmplitude: 0.08, weatheringAmplitude: 0.24 }
        : { edgeWearAmount: 0.38, dirtAccumulationAmount: 0.48 }),
    },
    historyResponse: historic
      ? {
          trafficWear: { colorMultiplier: 1.04, roughnessOffset: -0.16 },
          longTermExposure: { colorMultiplier: 1.025, roughnessOffset: 0.025 },
          runoffStaining: { colorMultiplier: 0.72, roughnessOffset: 0.13 },
          repairInfluence: { colorMultiplier: 1.1, roughnessOffset: -0.04 },
        }
      : {
          trafficWear: { colorMultiplier: 1.025, roughnessOffset: -0.12 },
          longTermExposure: { colorMultiplier: 1.04, roughnessOffset: 0.04 },
          runoffStaining: { colorMultiplier: 0.78, roughnessOffset: 0.1 },
          repairInfluence: { colorMultiplier: 1.07, roughnessOffset: -0.025 },
        },
    dirtMassResponse: historic
      ? {
          loose: { colorMultiplier: 0.72, roughnessOffset: 0.16 },
          persistent: { colorMultiplier: 0.8, roughnessOffset: 0.1 },
        }
      : {
          loose: { colorMultiplier: 0.76, roughnessOffset: 0.14 },
          persistent: { colorMultiplier: 0.84, roughnessOffset: 0.08 },
        },
    metallic: 0,
    metadata: {
      generator: 'videoer.procedural-paving-unit-material.v1',
      constructionDomain: 'modeled-paving-unit',
      materialKind: kind,
      provenance: 'project-owned-procedural-definition',
    },
  });
}
