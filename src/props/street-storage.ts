import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import {
  boxPart,
  mergeMeshParts,
  surfaceOfRevolutionPart,
  type MeshPart,
} from '../geometry/primitives.js';
import { surfaceMaterialSchema } from '../materials/model.js';

const rootSkeleton: GeometryAsset['skeleton'] = [
  { id: 'root', restPosition: [0, 0, 0], constraints: {} },
];

const weatheredStorageWood: GeometryMaterial = {
  id: 'weathered-storage-wood',
  baseColor: [0.16, 0.055, 0.018, 1],
  roughness: 0.63,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.weathered-storage-wood',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.055, 0.017, 0.006, 1],
        [0.12, 0.038, 0.012, 1],
        [0.19, 0.072, 0.022, 1],
        [0.085, 0.026, 0.009, 1],
      ],
      scaleMeters: 0.13,
      seed: 6411,
    },
    normal: { kind: 'procedural-noise', strength: 0.3, scaleMeters: 0.012 },
    roughness: {
      minimum: 0.45,
      maximum: 0.78,
      variationScaleMeters: 0.1,
      wetness: 0.12,
    },
    pattern: {
      kind: 'directional-wood',
      grainAxis: 'y',
      grainWidthMeters: 0.012,
      longitudinalScaleMeters: 0.65,
      distortion: 7,
      ringContrast: 0.68,
    },
    metallic: 0,
    metadata: { generator: 'videoer.street-storage-materials.v1' },
  }),
};

const agedHoopIron: GeometryMaterial = {
  id: 'aged-hoop-iron',
  baseColor: [0.035, 0.042, 0.045, 1],
  roughness: 0.42,
  metallic: 0.82,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.aged-hoop-iron',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.018, 0.022, 0.024, 1],
        [0.052, 0.058, 0.059, 1],
        [0.075, 0.045, 0.025, 1],
      ],
      scaleMeters: 0.08,
      seed: 6412,
    },
    normal: { kind: 'procedural-noise', strength: 0.22, scaleMeters: 0.008 },
    roughness: {
      minimum: 0.28,
      maximum: 0.62,
      variationScaleMeters: 0.07,
      wetness: 0.08,
    },
    pattern: { kind: 'isotropic' },
    metallic: 0.82,
    metadata: { generator: 'videoer.street-storage-materials.v1' },
  }),
};

const darkInterior: GeometryMaterial = {
  id: 'crate-interior',
  baseColor: [0.012, 0.009, 0.007, 1],
  roughness: 0.9,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
};

function finishStaticProp(
  id: string,
  parts: MeshPart[],
  dimensions: [number, number, number],
  attachments: GeometryAsset['attachments'],
) {
  const geometry = mergeMeshParts(id, parts, rootSkeleton, {
    generator: 'videoer.street-storage-props.v1',
    dimensionsMeters: dimensions,
    intendedShotDistance: ['background', 'medium'],
    placementSurface: 'ground',
  });
  geometry.materials = [weatheredStorageWood, agedHoopIron, darkInterior];
  geometry.attachments = attachments;
  return geometry;
}

export function createStorageBarrel() {
  const parts: MeshPart[] = [
    surfaceOfRevolutionPart(
      [
        { radius: 0.305, y: 0.015 },
        { radius: 0.34, y: 0.08 },
        { radius: 0.382, y: 0.34 },
        { radius: 0.388, y: 0.48 },
        { radius: 0.372, y: 0.7 },
        { radius: 0.335, y: 0.86 },
        { radius: 0.305, y: 0.91 },
      ],
      24,
      0,
      'weathered-storage-wood',
      true,
    ),
  ];
  for (const y of [0.075, 0.26, 0.65, 0.845])
    parts.push(
      surfaceOfRevolutionPart(
        [
          { radius: y < 0.2 || y > 0.8 ? 0.342 : 0.386, y: y - 0.018 },
          { radius: y < 0.2 || y > 0.8 ? 0.345 : 0.39, y: y + 0.018 },
        ],
        24,
        0,
        'aged-hoop-iron',
        false,
      ),
    );
  // Slightly raised head boards keep the ends from reading as featureless caps.
  parts.push(
    surfaceOfRevolutionPart(
      [
        { radius: 0.275, y: 0.912 },
        { radius: 0.275, y: 0.925 },
      ],
      24,
      0,
      'weathered-storage-wood',
      true,
    ),
  );
  return finishStaticProp('prop.storage-barrel', parts, [0.78, 0.925, 0.78], {
    'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
    'stack-top': { position: [0, 0.925, 0], rotation: [0, 0, 0] },
    'carry-centre': { position: [0, 0.48, 0], rotation: [0, 0, 0] },
  });
}

export function createSlattedStorageCrate() {
  const width = 0.72;
  const depth = 0.56;
  const height = 0.58;
  const parts: MeshPart[] = [
    boxPart([-0.31, 0.06, -0.23], [0.31, 0.51, 0.23], 0, 'crate-interior'),
    boxPart([-0.36, 0, -0.28], [0.36, 0.055, 0.28], 0, 'weathered-storage-wood'),
  ];
  const boardHeight = 0.105;
  for (let row = 0; row < 4; row++) {
    const minimumY = 0.07 + row * 0.125;
    parts.push(
      boxPart(
        [-0.36, minimumY, -0.292],
        [0.36, minimumY + boardHeight, -0.252],
        0,
        'weathered-storage-wood',
      ),
      boxPart(
        [-0.36, minimumY, 0.252],
        [0.36, minimumY + boardHeight, 0.292],
        0,
        'weathered-storage-wood',
      ),
      boxPart(
        [-0.372, minimumY, -0.252],
        [-0.332, minimumY + boardHeight, 0.252],
        0,
        'weathered-storage-wood',
      ),
      boxPart(
        [0.332, minimumY, -0.252],
        [0.372, minimumY + boardHeight, 0.252],
        0,
        'weathered-storage-wood',
      ),
    );
  }
  for (const x of [-0.36, 0.31])
    for (const z of [-0.285, 0.235])
      parts.push(boxPart([x, 0.035, z], [x + 0.05, height, z + 0.05], 0, 'aged-hoop-iron'));
  // Five separated lid boards preserve the slatted construction in high-angle shots.
  for (let index = 0; index < 5; index++) {
    const x = -0.345 + index * 0.14;
    parts.push(boxPart([x, 0.53, -0.28], [x + 0.125, height, 0.28], 0, 'weathered-storage-wood'));
  }
  return finishStaticProp('prop.slatted-storage-crate', parts, [width, height, depth], {
    'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
    'stack-top': { position: [0, height, 0], rotation: [0, 0, 0] },
    'grip-left': { position: [-width * 0.5, height * 0.58, 0], rotation: [0, 0, 0] },
    'grip-right': { position: [width * 0.5, height * 0.58, 0], rotation: [0, 0, 0] },
  });
}
