import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export type OldCitySurfaceId =
  | 'dark-brick'
  | 'rain-aged-plaster'
  | 'weathered-wood'
  | 'limestone-trim'
  | 'warm-interior-plaster'
  | 'oiled-shelf-wood'
  | 'old-window-glazing';

export interface OldCitySurfacePreset {
  id: OldCitySurfaceId;
  title: string;
  description: string;
  tags: string[];
  material: SurfaceMaterial;
}

const surface = (
  id: string,
  colors: Array<[number, number, number, number]>,
  options: {
    seed: number;
    colorScaleMeters: number;
    normalStrength: number;
    normalScaleMeters: number;
    roughness: [number, number];
    roughnessScaleMeters: number;
    wetness: number;
    pattern?: SurfaceMaterial['pattern'];
    weathering?: SurfaceMaterial['weathering'];
  },
) =>
  surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id,
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors,
      scaleMeters: options.colorScaleMeters,
      seed: options.seed,
    },
    normal: {
      kind: 'procedural-noise',
      strength: options.normalStrength,
      scaleMeters: options.normalScaleMeters,
    },
    roughness: {
      minimum: options.roughness[0],
      maximum: options.roughness[1],
      variationScaleMeters: options.roughnessScaleMeters,
      wetness: options.wetness,
    },
    pattern: options.pattern ?? { kind: 'isotropic' },
    weathering: options.weathering,
    metallic: 0,
    metadata: {
      generator: 'videoer.old-city-surface-library.v3',
      coordinateScale: 'object-space-metres',
      layeredResponse: [
        'surface-specific-pattern',
        'palette',
        'micro-normal',
        'roughness-variation',
        'wet-coat',
      ],
    },
  });

export function createOldCitySurfacePresets(): OldCitySurfacePreset[] {
  return [
    {
      id: 'dark-brick',
      title: 'Rain-aged dark brick',
      description:
        'Deep umber old-city masonry with metre-scaled tonal variation, porous micro-relief, and restrained rain sheen.',
      tags: ['brick', 'masonry', 'old-city', 'wet'],
      material: surface(
        'material.old-city-dark-brick',
        [
          [0.014, 0.004, 0.002, 1],
          [0.038, 0.009, 0.004, 1],
          [0.008, 0.0025, 0.0015, 1],
          [0.062, 0.016, 0.006, 1],
        ],
        {
          seed: 2311,
          colorScaleMeters: 0.32,
          normalStrength: 0.42,
          normalScaleMeters: 0.028,
          roughness: [0.38, 0.68],
          roughnessScaleMeters: 0.21,
          wetness: 0.34,
          pattern: {
            kind: 'masonry-bond',
            projectionAxes: ['x', 'y'],
            unitWidthMeters: 0.29,
            unitHeightMeters: 0.082,
            mortarWidthMeters: 0.009,
            rowOffset: 0.5,
            mortarColor: [0.009, 0.008, 0.007, 1],
            edgeReliefMeters: 0.0045,
            irregularityMeters: 0.004,
          },
          weathering: {
            verticalStreaks: { amount: 0.34, widthMeters: 0.085, lengthMeters: 0.9 },
            lowerDamp: { amount: 0.42, heightMeters: 0.62 },
            surfaceDirt: { amount: 0.18, scaleMeters: 0.48 },
          },
        },
      ),
    },
    {
      id: 'rain-aged-plaster',
      title: 'Rain-aged mineral plaster',
      description:
        'Cool desaturated exterior plaster with broad weathering variation, fine mineral relief, and intermittent damp response.',
      tags: ['plaster', 'facade', 'old-city', 'weathered'],
      material: surface(
        'material.rain-aged-mineral-plaster',
        [
          [0.11, 0.12, 0.13, 1],
          [0.18, 0.17, 0.16, 1],
          [0.075, 0.085, 0.095, 1],
          [0.22, 0.2, 0.17, 1],
        ],
        {
          seed: 2312,
          colorScaleMeters: 0.85,
          normalStrength: 0.28,
          normalScaleMeters: 0.042,
          roughness: [0.46, 0.78],
          roughnessScaleMeters: 0.52,
          wetness: 0.24,
          pattern: {
            kind: 'mineral-plaster',
            trowelScaleMeters: 0.62,
            aggregateScaleMeters: 0.018,
            trowelContrast: 0.38,
            porosity: 0.66,
          },
          weathering: {
            verticalStreaks: { amount: 0.28, widthMeters: 0.12, lengthMeters: 1.2 },
            lowerDamp: { amount: 0.34, heightMeters: 0.72 },
            surfaceDirt: { amount: 0.18, scaleMeters: 0.64 },
          },
        },
      ),
    },
    {
      id: 'weathered-wood',
      title: 'Weathered dark exterior wood',
      description:
        'Dark stained exterior joinery with small-scale grain breakup, worn roughness, and a thin rain coat.',
      tags: ['wood', 'joinery', 'exterior', 'weathered'],
      material: surface(
        'material.weathered-dark-exterior-wood',
        [
          [0.055, 0.016, 0.007, 1],
          [0.115, 0.035, 0.012, 1],
          [0.035, 0.011, 0.006, 1],
          [0.16, 0.055, 0.018, 1],
        ],
        {
          seed: 2313,
          colorScaleMeters: 0.14,
          normalStrength: 0.24,
          normalScaleMeters: 0.018,
          roughness: [0.3, 0.58],
          roughnessScaleMeters: 0.12,
          wetness: 0.3,
          pattern: {
            kind: 'directional-wood',
            grainAxis: 'y',
            grainWidthMeters: 0.018,
            longitudinalScaleMeters: 0.78,
            distortion: 6.5,
            ringContrast: 0.64,
          },
          weathering: {
            verticalStreaks: { amount: 0.22, widthMeters: 0.055, lengthMeters: 0.72 },
            lowerDamp: { amount: 0.28, heightMeters: 0.45 },
            surfaceDirt: { amount: 0.16, scaleMeters: 0.32 },
          },
        },
      ),
    },
    {
      id: 'limestone-trim',
      title: 'Aged limestone trim',
      description:
        'Muted warm-grey carved stone for sills, thresholds, lintels, and facade trim with fine granular relief.',
      tags: ['stone', 'limestone', 'trim', 'architectural'],
      material: surface(
        'material.aged-limestone-trim',
        [
          [0.23, 0.22, 0.2, 1],
          [0.34, 0.31, 0.26, 1],
          [0.17, 0.18, 0.18, 1],
        ],
        {
          seed: 2314,
          colorScaleMeters: 0.38,
          normalStrength: 0.3,
          normalScaleMeters: 0.032,
          roughness: [0.42, 0.7],
          roughnessScaleMeters: 0.3,
          wetness: 0.18,
          pattern: {
            kind: 'cut-stone',
            beddingAxis: 'x',
            beddingScaleMeters: 0.21,
            grainScaleMeters: 0.024,
            veinContrast: 0.28,
            poreAmount: 0.42,
          },
          weathering: {
            verticalStreaks: { amount: 0.2, widthMeters: 0.1, lengthMeters: 0.95 },
            lowerDamp: { amount: 0.3, heightMeters: 0.5 },
            surfaceDirt: { amount: 0.14, scaleMeters: 0.42 },
          },
        },
      ),
    },
    {
      id: 'warm-interior-plaster',
      title: 'Warm lime-plaster interior',
      description:
        'Warm, matte interior lime plaster with broad hand-applied tonal movement and restrained fine relief.',
      tags: ['plaster', 'interior', 'warm', 'bookshop'],
      material: surface(
        'material.warm-lime-plaster-interior',
        [
          [0.3, 0.22, 0.16, 1],
          [0.46, 0.35, 0.25, 1],
          [0.24, 0.17, 0.115, 1],
        ],
        {
          seed: 2315,
          colorScaleMeters: 0.72,
          normalStrength: 0.18,
          normalScaleMeters: 0.055,
          roughness: [0.67, 0.86],
          roughnessScaleMeters: 0.46,
          wetness: 0,
          pattern: {
            kind: 'mineral-plaster',
            trowelScaleMeters: 0.78,
            aggregateScaleMeters: 0.022,
            trowelContrast: 0.24,
            porosity: 0.48,
          },
        },
      ),
    },
    {
      id: 'oiled-shelf-wood',
      title: 'Oiled dark bookshop wood',
      description:
        'Warm dark shelving and counter wood with varied oil response and close-range grain breakup.',
      tags: ['wood', 'interior', 'shelving', 'bookshop'],
      material: surface(
        'material.oiled-dark-bookshop-wood',
        [
          [0.06, 0.014, 0.005, 1],
          [0.14, 0.038, 0.01, 1],
          [0.09, 0.022, 0.006, 1],
          [0.19, 0.065, 0.016, 1],
        ],
        {
          seed: 2316,
          colorScaleMeters: 0.17,
          normalStrength: 0.2,
          normalScaleMeters: 0.016,
          roughness: [0.28, 0.52],
          roughnessScaleMeters: 0.13,
          wetness: 0.08,
          pattern: {
            kind: 'directional-wood',
            grainAxis: 'x',
            grainWidthMeters: 0.014,
            longitudinalScaleMeters: 0.62,
            distortion: 5.2,
            ringContrast: 0.58,
          },
        },
      ),
    },
    {
      id: 'old-window-glazing',
      title: 'Old-city window glazing',
      description:
        'Slightly imperfect architectural glass with physically declared transmission, IOR, thickness, fine scratches, and restrained accumulated dirt.',
      tags: ['glass', 'glazing', 'window', 'architectural'],
      material: surface(
        'material.old-city-window-glazing',
        [
          [0.72, 0.82, 0.84, 1],
          [0.88, 0.94, 0.92, 1],
          [0.62, 0.74, 0.78, 1],
        ],
        {
          seed: 2317,
          colorScaleMeters: 0.9,
          normalStrength: 0.06,
          normalScaleMeters: 0.012,
          roughness: [0.035, 0.14],
          roughnessScaleMeters: 0.34,
          wetness: 0.06,
          pattern: {
            kind: 'architectural-glazing',
            ior: 1.52,
            transmission: 0.94,
            thicknessMeters: 0.008,
            microScratchScaleMeters: 0.003,
            dirtAmount: 0.12,
          },
        },
      ),
    },
  ];
}

export function createSurfaceMaterialSwatch(
  material: SurfaceMaterial,
  swatchId = material.id.replace(/^material\./u, 'material-swatch.'),
): GeometryAsset {
  const parts = [];
  for (let row = 0; row < 7; row++)
    for (let column = 0; column < 7; column++) {
      const offset = row % 2 ? 0.21 : 0;
      const x = (column - 3) * 0.44 + offset;
      const z = (row - 3) * 0.48;
      const variation = ((row * 19 + column * 37 + material.baseColor.seed) % 13) / 13;
      parts.push(
        boxPart(
          [x - 0.195, -0.035, z - 0.215],
          [x + 0.195, variation * 0.014, z + 0.215],
          0,
          'surface',
        ),
      );
    }
  if (material.pattern.kind === 'masonry-bond') {
    // A wall-oriented witness is mandatory: a floor-only swatch cannot prove
    // an explicitly X/Y-projected bond or its real-world course dimensions.
    parts.push(boxPart([-1.62, 0.04, 1.5], [1.62, 1.72, 1.58], 0, 'surface'));
  } else if (material.pattern.kind === 'directional-wood') {
    // Orthogonal members reveal whether declared domain-axis grain survives
    // on both long and cross-cut faces instead of following object bounds.
    parts.push(
      boxPart([-1.5, 0.1, 1.48], [-1.18, 1.72, 1.72], 0, 'surface'),
      boxPart([-1.08, 1.24, 1.48], [1.48, 1.56, 1.72], 0, 'surface'),
    );
  } else if (material.pattern.kind === 'mineral-plaster' || material.pattern.kind === 'cut-stone') {
    parts.push(
      boxPart([-1.62, 0.04, 1.5], [1.62, 1.72, 1.58], 0, 'surface'),
      boxPart([-1.62, 0.04, 1.58], [-1.5, 1.72, 2.36], 0, 'surface'),
    );
  } else if (material.pattern.kind === 'architectural-glazing') {
    parts.splice(0, parts.length);
    parts.push(
      boxPart([-1.35, 0.4, -0.004], [1.35, 2.45, 0.004], 0, 'surface'),
      boxPart([-1.06, 0.66, -0.62], [-0.16, 2.14, -0.44], 0, 'witness-cool'),
      boxPart([0.16, 0.66, -0.62], [1.06, 2.14, -0.44], 0, 'witness-warm'),
    );
  }
  const geometry = mergeMeshParts(
    swatchId,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.surface-material-swatch.v1',
      material: material.id,
      materialClass: 'surface-swatch',
      witnessGeometry:
        material.pattern.kind === 'masonry-bond'
          ? 'floor-grid-plus-vertical-wall'
          : material.pattern.kind === 'directional-wood'
            ? 'floor-grid-plus-orthogonal-members'
            : material.pattern.kind === 'architectural-glazing'
              ? 'standing-transmissive-pane'
              : material.pattern.kind === 'mineral-plaster' || material.pattern.kind === 'cut-stone'
                ? 'floor-grid-plus-orthogonal-wall-corner'
                : 'floor-grid',
      deterministicSeed: material.baseColor.seed,
    },
  );
  const average = material.baseColor.colors
    .reduce(
      (sum, color) =>
        sum.map((value, index) => value + color[index]!) as [number, number, number, number],
      [0, 0, 0, 0] as [number, number, number, number],
    )
    .map((value) => value / material.baseColor.colors.length) as [number, number, number, number];
  const renderMaterial: GeometryMaterial = {
    id: 'surface',
    baseColor: average,
    roughness: (material.roughness.minimum + material.roughness.maximum) * 0.5,
    metallic: material.metallic,
    emission: [0, 0, 0],
    emissionStrength: 0,
    surface: material,
  };
  if (material.unitVariation) {
    const perBox = (salt: number, minimum: number, maximum: number) =>
      geometry.positions.map((_, vertexIndex) => {
        const boxIndex = Math.floor(vertexIndex / 24);
        const unit = ((boxIndex * 37 + material.baseColor.seed + salt) % 101) / 100;
        return minimum + unit * (maximum - minimum);
      });
    geometry.attributes = {
      ...(geometry.attributes ?? {}),
      [material.unitVariation.valueAttribute]: {
        dataType: 'float',
        interpolation: 'vertex',
        values: perBox(11, -1, 1),
      },
      [material.unitVariation.roughnessAttribute]: {
        dataType: 'float',
        interpolation: 'vertex',
        values: perBox(29, -1, 1),
      },
      [material.unitVariation.weatheringAttribute]: {
        dataType: 'float',
        interpolation: 'vertex',
        values: perBox(47, -1, 1),
      },
      ...(material.unitVariation.edgeWearAttribute
        ? {
            [material.unitVariation.edgeWearAttribute]: {
              dataType: 'float' as const,
              interpolation: 'vertex' as const,
              values: perBox(61, 0, 1),
            },
          }
        : {}),
      ...(material.unitVariation.dirtAccumulationAttribute
        ? {
            [material.unitVariation.dirtAccumulationAttribute]: {
              dataType: 'float' as const,
              interpolation: 'vertex' as const,
              values: perBox(79, 0, 1),
            },
          }
        : {}),
    };
  }
  geometry.materials = [
    renderMaterial,
    ...(material.pattern.kind === 'architectural-glazing'
      ? [
          {
            id: 'witness-cool',
            baseColor: [0.04, 0.22, 0.72, 1] as [number, number, number, number],
            roughness: 0.48,
            metallic: 0,
            emission: [0, 0, 0] as [number, number, number],
            emissionStrength: 0,
          },
          {
            id: 'witness-warm',
            baseColor: [0.88, 0.16, 0.035, 1] as [number, number, number, number],
            roughness: 0.34,
            metallic: 0,
            emission: [0, 0, 0] as [number, number, number],
            emissionStrength: 0,
          },
        ]
      : []),
  ];
  return geometry;
}
