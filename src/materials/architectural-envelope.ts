import type { ArchitecturalEnvelopeMaterialRole } from '../environments/architectural-envelope.js';
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export type ArchitecturalEnvelopeMaterialHost =
  'historic-masonry-shopfront' | 'contemporary-plaster-mixed-use';

type Color = [number, number, number, number];
type MaterialSpec = {
  target: string;
  roles: ArchitecturalEnvelopeMaterialRole[];
  constructionDomain:
    | 'flat-facade-surface'
    | 'modeled-masonry-unit'
    | 'monolithic-architectural-surface'
    | 'natural-rock-surface'
    | 'prop-surface';
  colors: Color[];
  seed: number;
  colorScaleMeters: number;
  normalStrength: number;
  normalScaleMeters: number;
  roughness: [number, number];
  roughnessScaleMeters: number;
  metallic?: number;
  wetness?: number;
  pattern: SurfaceMaterial['pattern'];
  weathering?: SurfaceMaterial['weathering'];
};

function material(host: ArchitecturalEnvelopeMaterialHost, spec: MaterialSpec): SurfaceMaterial {
  return surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: `material.architectural-envelope.${host}.${spec.target}`,
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: spec.colors,
      scaleMeters: spec.colorScaleMeters,
      seed: spec.seed,
    },
    normal: {
      kind: spec.normalStrength === 0 ? 'flat' : 'procedural-noise',
      strength: spec.normalStrength,
      scaleMeters: spec.normalScaleMeters,
    },
    roughness: {
      minimum: spec.roughness[0],
      maximum: spec.roughness[1],
      variationScaleMeters: spec.roughnessScaleMeters,
      wetness: spec.wetness ?? 0,
    },
    pattern: spec.pattern,
    weathering: spec.weathering,
    metallic: spec.metallic ?? 0,
    metadata: {
      generator: 'videoer.architectural-envelope-material-library.v1',
      hostClass: host,
      targetMaterialId: spec.target,
      constructionDomain: spec.constructionDomain,
      architecturalRoleCompatibility: [...spec.roles].sort(),
      coordinateScale: 'object-space-metres',
      evidenceStatus: 'project-owned-procedural-prior-requires-visual-acceptance',
      benchmarkSpecific: false,
    },
  });
}

const mineralWeathering = (amount: number, dampHeight: number): SurfaceMaterial['weathering'] => ({
  verticalStreaks: { amount, widthMeters: 0.11, lengthMeters: 1.15 },
  lowerDamp: { amount: Math.min(0.58, amount + 0.12), heightMeters: dampHeight },
  surfaceDirt: { amount: amount * 0.62, scaleMeters: 0.58 },
});

function historicSpecs(): MaterialSpec[] {
  return [
    {
      target: 'historic-masonry',
      roles: ['structure'],
      constructionDomain: 'modeled-masonry-unit',
      colors: [
        [0.055, 0.025, 0.016, 1],
        [0.12, 0.055, 0.03, 1],
        [0.035, 0.018, 0.014, 1],
      ],
      seed: 4811,
      colorScaleMeters: 0.31,
      normalStrength: 0.38,
      normalScaleMeters: 0.025,
      roughness: [0.54, 0.79],
      roughnessScaleMeters: 0.22,
      wetness: 0.12,
      pattern: {
        kind: 'masonry-bond',
        projectionAxes: ['x', 'y'],
        unitWidthMeters: 0.225,
        unitHeightMeters: 0.072,
        mortarWidthMeters: 0.009,
        rowOffset: 0.5,
        mortarColor: [0.06, 0.055, 0.05, 1],
        edgeReliefMeters: 0.003,
        irregularityMeters: 0.0035,
      },
      weathering: mineralWeathering(0.28, 0.68),
    },
    {
      target: 'rain-aged-plaster',
      roles: ['facade-finish'],
      constructionDomain: 'flat-facade-surface',
      colors: [
        [0.31, 0.29, 0.25, 1],
        [0.43, 0.4, 0.34, 1],
        [0.22, 0.23, 0.22, 1],
      ],
      seed: 4812,
      colorScaleMeters: 0.88,
      normalStrength: 0.27,
      normalScaleMeters: 0.019,
      roughness: [0.58, 0.82],
      roughnessScaleMeters: 0.48,
      wetness: 0.1,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.64,
        aggregateScaleMeters: 0.012,
        trowelContrast: 0.28,
        porosity: 0.64,
      },
      weathering: mineralWeathering(0.34, 0.82),
    },
    {
      target: 'aged-limestone',
      roles: ['foundation', 'facade-damp-course', 'threshold'],
      constructionDomain: 'natural-rock-surface',
      colors: [
        [0.29, 0.27, 0.23, 1],
        [0.42, 0.39, 0.32, 1],
        [0.2, 0.21, 0.2, 1],
      ],
      seed: 4813,
      colorScaleMeters: 0.42,
      normalStrength: 0.31,
      normalScaleMeters: 0.018,
      roughness: [0.46, 0.73],
      roughnessScaleMeters: 0.29,
      wetness: 0.13,
      pattern: {
        kind: 'cut-stone',
        beddingAxis: 'x',
        beddingScaleMeters: 0.23,
        grainScaleMeters: 0.017,
        veinContrast: 0.25,
        poreAmount: 0.4,
      },
      weathering: mineralWeathering(0.24, 0.55),
    },
    {
      target: 'weathered-slate',
      roles: ['roof'],
      constructionDomain: 'natural-rock-surface',
      colors: [
        [0.035, 0.045, 0.052, 1],
        [0.075, 0.083, 0.09, 1],
        [0.022, 0.028, 0.034, 1],
      ],
      seed: 4814,
      colorScaleMeters: 0.31,
      normalStrength: 0.24,
      normalScaleMeters: 0.011,
      roughness: [0.38, 0.65],
      roughnessScaleMeters: 0.25,
      wetness: 0.17,
      pattern: {
        kind: 'cut-stone',
        beddingAxis: 'x',
        beddingScaleMeters: 0.16,
        grainScaleMeters: 0.009,
        veinContrast: 0.14,
        poreAmount: 0.18,
      },
      weathering: { surfaceDirt: { amount: 0.19, scaleMeters: 0.38 } },
    },
    {
      target: 'dark-timber',
      roles: ['facade-trim', 'roof-trim'],
      constructionDomain: 'prop-surface',
      colors: [
        [0.025, 0.012, 0.007, 1],
        [0.075, 0.031, 0.014, 1],
        [0.014, 0.008, 0.006, 1],
      ],
      seed: 4815,
      colorScaleMeters: 0.16,
      normalStrength: 0.23,
      normalScaleMeters: 0.012,
      roughness: [0.34, 0.59],
      roughnessScaleMeters: 0.14,
      wetness: 0.08,
      pattern: {
        kind: 'directional-wood',
        grainAxis: 'y',
        grainWidthMeters: 0.014,
        longitudinalScaleMeters: 0.72,
        distortion: 5.4,
        ringContrast: 0.55,
      },
    },
    {
      target: 'warm-interior-plaster',
      roles: ['interior-wall'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.34, 0.25, 0.17, 1],
        [0.48, 0.37, 0.25, 1],
        [0.25, 0.18, 0.12, 1],
      ],
      seed: 4816,
      colorScaleMeters: 0.76,
      normalStrength: 0.16,
      normalScaleMeters: 0.026,
      roughness: [0.66, 0.85],
      roughnessScaleMeters: 0.45,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.72,
        aggregateScaleMeters: 0.015,
        trowelContrast: 0.2,
        porosity: 0.46,
      },
    },
    {
      target: 'dark-room',
      roles: ['dark-room'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.012, 0.013, 0.014, 1],
        [0.028, 0.026, 0.024, 1],
      ],
      seed: 4817,
      colorScaleMeters: 0.9,
      normalStrength: 0.11,
      normalScaleMeters: 0.03,
      roughness: [0.72, 0.88],
      roughnessScaleMeters: 0.6,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.78,
        aggregateScaleMeters: 0.016,
        trowelContrast: 0.12,
        porosity: 0.4,
      },
    },
    {
      target: 'lit-room',
      roles: ['lit-room'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.38, 0.24, 0.13, 1],
        [0.54, 0.39, 0.24, 1],
        [0.29, 0.19, 0.11, 1],
      ],
      seed: 4818,
      colorScaleMeters: 0.82,
      normalStrength: 0.12,
      normalScaleMeters: 0.03,
      roughness: [0.64, 0.82],
      roughnessScaleMeters: 0.52,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.7,
        aggregateScaleMeters: 0.015,
        trowelContrast: 0.16,
        porosity: 0.42,
      },
    },
    {
      target: 'interior-wood',
      roles: ['occupancy'],
      constructionDomain: 'prop-surface',
      colors: [
        [0.055, 0.021, 0.008, 1],
        [0.15, 0.06, 0.018, 1],
        [0.09, 0.034, 0.011, 1],
      ],
      seed: 4819,
      colorScaleMeters: 0.15,
      normalStrength: 0.2,
      normalScaleMeters: 0.012,
      roughness: [0.32, 0.55],
      roughnessScaleMeters: 0.13,
      pattern: {
        kind: 'directional-wood',
        grainAxis: 'x',
        grainWidthMeters: 0.012,
        longitudinalScaleMeters: 0.58,
        distortion: 4.8,
        ringContrast: 0.52,
      },
    },
  ];
}

function contemporarySpecs(): MaterialSpec[] {
  return [
    {
      target: 'concrete-block',
      roles: ['structure'],
      constructionDomain: 'modeled-masonry-unit',
      colors: [
        [0.2, 0.21, 0.21, 1],
        [0.29, 0.3, 0.29, 1],
        [0.15, 0.16, 0.16, 1],
      ],
      seed: 5821,
      colorScaleMeters: 0.38,
      normalStrength: 0.3,
      normalScaleMeters: 0.014,
      roughness: [0.57, 0.8],
      roughnessScaleMeters: 0.31,
      pattern: {
        kind: 'masonry-bond',
        projectionAxes: ['x', 'y'],
        unitWidthMeters: 0.44,
        unitHeightMeters: 0.215,
        mortarWidthMeters: 0.01,
        rowOffset: 0.5,
        mortarColor: [0.15, 0.15, 0.15, 1],
        edgeReliefMeters: 0.002,
        irregularityMeters: 0.001,
      },
    },
    {
      target: 'contemporary-mineral-render',
      roles: ['facade-finish'],
      constructionDomain: 'flat-facade-surface',
      colors: [
        [0.52, 0.51, 0.47, 1],
        [0.64, 0.62, 0.56, 1],
        [0.42, 0.43, 0.42, 1],
      ],
      seed: 5822,
      colorScaleMeters: 0.92,
      normalStrength: 0.24,
      normalScaleMeters: 0.012,
      roughness: [0.55, 0.76],
      roughnessScaleMeters: 0.5,
      wetness: 0.06,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.78,
        aggregateScaleMeters: 0.008,
        trowelContrast: 0.2,
        porosity: 0.52,
      },
      weathering: mineralWeathering(0.16, 0.54),
    },
    {
      target: 'dark-stone-plinth',
      roles: ['foundation', 'facade-damp-course', 'threshold'],
      constructionDomain: 'natural-rock-surface',
      colors: [
        [0.055, 0.06, 0.062, 1],
        [0.11, 0.115, 0.112, 1],
        [0.035, 0.04, 0.043, 1],
      ],
      seed: 5823,
      colorScaleMeters: 0.46,
      normalStrength: 0.25,
      normalScaleMeters: 0.013,
      roughness: [0.36, 0.61],
      roughnessScaleMeters: 0.3,
      wetness: 0.1,
      pattern: {
        kind: 'cut-stone',
        beddingAxis: 'x',
        beddingScaleMeters: 0.28,
        grainScaleMeters: 0.014,
        veinContrast: 0.16,
        poreAmount: 0.24,
      },
      weathering: mineralWeathering(0.18, 0.45),
    },
    {
      target: 'flat-roof-membrane',
      roles: ['roof'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.045, 0.048, 0.05, 1],
        [0.075, 0.078, 0.08, 1],
      ],
      seed: 5824,
      colorScaleMeters: 0.62,
      normalStrength: 0.14,
      normalScaleMeters: 0.01,
      roughness: [0.48, 0.67],
      roughnessScaleMeters: 0.41,
      wetness: 0.08,
      pattern: { kind: 'isotropic' },
    },
    {
      target: 'painted-metal-trim',
      roles: ['facade-trim', 'roof-trim'],
      constructionDomain: 'prop-surface',
      colors: [
        [0.06, 0.065, 0.07, 1],
        [0.12, 0.125, 0.13, 1],
        [0.035, 0.04, 0.045, 1],
      ],
      seed: 5825,
      colorScaleMeters: 0.24,
      normalStrength: 0.11,
      normalScaleMeters: 0.004,
      roughness: [0.25, 0.44],
      roughnessScaleMeters: 0.18,
      metallic: 0.68,
      pattern: {
        kind: 'brushed-metal',
        brushAxis: 'x',
        brushSpacingMeters: 0.0012,
        scratchContrast: 0.24,
        patinaAmount: 0.08,
      },
    },
    {
      target: 'neutral-interior-plaster',
      roles: ['interior-wall'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.48, 0.47, 0.44, 1],
        [0.62, 0.59, 0.54, 1],
        [0.4, 0.41, 0.4, 1],
      ],
      seed: 5826,
      colorScaleMeters: 0.8,
      normalStrength: 0.13,
      normalScaleMeters: 0.018,
      roughness: [0.64, 0.82],
      roughnessScaleMeters: 0.47,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.75,
        aggregateScaleMeters: 0.011,
        trowelContrast: 0.13,
        porosity: 0.4,
      },
    },
    {
      target: 'dark-room',
      roles: ['dark-room'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.014, 0.016, 0.018, 1],
        [0.035, 0.038, 0.04, 1],
      ],
      seed: 5827,
      colorScaleMeters: 0.86,
      normalStrength: 0.09,
      normalScaleMeters: 0.02,
      roughness: [0.68, 0.84],
      roughnessScaleMeters: 0.5,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.8,
        aggregateScaleMeters: 0.012,
        trowelContrast: 0.1,
        porosity: 0.34,
      },
    },
    {
      target: 'lit-room',
      roles: ['lit-room'],
      constructionDomain: 'monolithic-architectural-surface',
      colors: [
        [0.38, 0.31, 0.23, 1],
        [0.56, 0.46, 0.34, 1],
        [0.3, 0.25, 0.2, 1],
      ],
      seed: 5828,
      colorScaleMeters: 0.84,
      normalStrength: 0.1,
      normalScaleMeters: 0.02,
      roughness: [0.61, 0.79],
      roughnessScaleMeters: 0.5,
      pattern: {
        kind: 'mineral-plaster',
        trowelScaleMeters: 0.74,
        aggregateScaleMeters: 0.012,
        trowelContrast: 0.12,
        porosity: 0.36,
      },
    },
    {
      target: 'painted-metal-interior',
      roles: ['occupancy'],
      constructionDomain: 'prop-surface',
      colors: [
        [0.1, 0.11, 0.115, 1],
        [0.19, 0.2, 0.2, 1],
        [0.065, 0.07, 0.075, 1],
      ],
      seed: 5829,
      colorScaleMeters: 0.22,
      normalStrength: 0.08,
      normalScaleMeters: 0.004,
      roughness: [0.3, 0.5],
      roughnessScaleMeters: 0.17,
      metallic: 0.5,
      pattern: {
        kind: 'brushed-metal',
        brushAxis: 'y',
        brushSpacingMeters: 0.0015,
        scratchContrast: 0.18,
        patinaAmount: 0.04,
      },
    },
  ];
}

export function createArchitecturalEnvelopeSurfaceProfile(
  host: ArchitecturalEnvelopeMaterialHost,
): Record<string, SurfaceMaterial> {
  const entries = (
    host === 'historic-masonry-shopfront' ? historicSpecs() : contemporarySpecs()
  ).map((spec) => [spec.target, material(host, spec)] as const);
  return Object.fromEntries(entries);
}
