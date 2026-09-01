import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import {
  boxPart,
  ellipsoidBetween,
  extrudedConvexPolygonPart,
  mergeMeshParts,
  surfaceOfRevolutionPart,
  sweptTubePart,
  type MeshPart,
} from '../geometry/primitives.js';
import { surfaceMaterialSchema } from '../materials/model.js';

const rootSkeleton: GeometryAsset['skeleton'] = [
  { id: 'root', restPosition: [0, 0, 0], constraints: {} },
];

function material(
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial {
  return {
    id,
    baseColor,
    roughness,
    metallic,
    emission: [0, 0, 0],
    emissionStrength: 0,
  };
}

const marketMaterials: GeometryMaterial[] = [
  {
    ...material('stall-oak', [0.18, 0.065, 0.018, 1], 0.62),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.market-stall-oak',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.07, 0.018, 0.005, 1],
          [0.16, 0.052, 0.014, 1],
          [0.25, 0.095, 0.026, 1],
        ],
        scaleMeters: 0.16,
        seed: 7711,
      },
      normal: { kind: 'procedural-noise', strength: 0.27, scaleMeters: 0.014 },
      roughness: {
        minimum: 0.44,
        maximum: 0.78,
        variationScaleMeters: 0.12,
        wetness: 0.05,
      },
      pattern: {
        kind: 'directional-wood',
        grainAxis: 'y',
        grainWidthMeters: 0.014,
        longitudinalScaleMeters: 0.72,
        distortion: 5,
        ringContrast: 0.56,
      },
      metallic: 0,
      metadata: { generator: 'videoer.market-world-assets.v1' },
    }),
  },
  material('canopy-cream', [0.78, 0.58, 0.34, 1], 0.72),
  material('canopy-russet', [0.42, 0.055, 0.025, 1], 0.68),
  material('basket-willow', [0.43, 0.19, 0.055, 1], 0.66),
  material('basket-shadow', [0.055, 0.021, 0.006, 1], 0.88),
  material('produce-apple-red', [0.55, 0.025, 0.018, 1], 0.42),
  material('produce-apple-gold', [0.72, 0.32, 0.025, 1], 0.46),
  material('produce-leaf-green', [0.055, 0.23, 0.035, 1], 0.58),
  {
    ...material('sack-burlap', [0.38, 0.24, 0.105, 1], 0.9),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.market-sack-burlap',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.2, 0.11, 0.038, 1],
          [0.38, 0.24, 0.105, 1],
          [0.49, 0.34, 0.17, 1],
        ],
        scaleMeters: 0.035,
        seed: 7712,
      },
      normal: { kind: 'procedural-noise', strength: 0.52, scaleMeters: 0.006 },
      roughness: {
        minimum: 0.76,
        maximum: 0.98,
        variationScaleMeters: 0.024,
        wetness: 0,
      },
      pattern: { kind: 'isotropic' },
      metallic: 0,
      metadata: { generator: 'videoer.market-world-assets.v1', textile: 'coarse-burlap' },
    }),
  },
  material('sack-seam', [0.11, 0.058, 0.018, 1], 0.78),
];

function finish(
  id: string,
  parts: MeshPart[],
  dimensions: [number, number, number],
  attachments: GeometryAsset['attachments'],
  metadata: Record<string, unknown>,
) {
  const geometry = mergeMeshParts(id, parts, rootSkeleton, {
    generator: 'videoer.market-world-assets.v1',
    dimensionsMeters: dimensions,
    intendedShotDistance: ['background', 'medium'],
    placementSurface: 'ground',
    merchandisingAsset: true,
    ...metadata,
  });
  geometry.materials = marketMaterials;
  geometry.attachments = attachments;
  return geometry;
}

function circlePoints(radius: number, y: number, segments = 20): Vec3[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  });
}

export function createModularMarketStall() {
  const parts: MeshPart[] = [];
  for (const x of [-1.42, 1.42])
    for (const z of [-0.72, 0.72])
      parts.push(boxPart([x - 0.055, 0, z - 0.055], [x + 0.055, 2.58, z + 0.055], 0, 'stall-oak'));
  parts.push(
    boxPart([-1.55, 0.86, -0.84], [1.55, 1.03, -0.58], 0, 'stall-oak'),
    boxPart([-1.44, 0.28, -0.48], [1.44, 0.39, 0.54], 0, 'stall-oak'),
    boxPart([-1.5, 2.45, -0.79], [1.5, 2.57, -0.66], 0, 'stall-oak'),
    boxPart([-1.5, 2.45, 0.66], [1.5, 2.57, 0.79], 0, 'stall-oak'),
    boxPart([-0.055, 2.5, -0.78], [0.055, 2.82, 0.78], 0, 'stall-oak'),
  );
  // A segmented fabric roof creates a readable striped canopy without baking a renderer material.
  const stripeWidth = 3.14 / 7;
  for (let stripe = 0; stripe < 7; stripe++) {
    const minimumX = -1.57 + stripe * stripeWidth;
    const fabric = stripe % 2 === 0 ? 'canopy-cream' : 'canopy-russet';
    parts.push(
      extrudedConvexPolygonPart({
        minimumX,
        maximumX: minimumX + stripeWidth + 0.008,
        crossSectionYZ: [
          [2.47, -0.94],
          [2.52, -0.94],
          [2.84, 0],
          [2.78, 0],
        ],
        bone: 0,
        materialId: fabric,
      }),
      extrudedConvexPolygonPart({
        minimumX,
        maximumX: minimumX + stripeWidth + 0.008,
        crossSectionYZ: [
          [2.78, 0],
          [2.84, 0],
          [2.52, 0.94],
          [2.47, 0.94],
        ],
        bone: 0,
        materialId: fabric,
      }),
      boxPart([minimumX, 2.31, -0.97], [minimumX + stripeWidth + 0.008, 2.49, -0.91], 0, fabric),
    );
  }
  // Shelf lips make the display planes legible and stop inventory reading as floating clutter.
  parts.push(
    boxPart([-1.48, 1.0, -0.6], [1.48, 1.09, -0.53], 0, 'stall-oak'),
    boxPart([-1.42, 0.37, -0.5], [1.42, 0.45, -0.43], 0, 'stall-oak'),
    boxPart([-0.42, 1.95, -0.985], [0.42, 2.29, -0.935], 0, 'stall-oak'),
    boxPart([-0.3, 2.09, -0.995], [0.3, 2.15, -0.925], 0, 'canopy-cream'),
  );
  return finish(
    'prop.modular-market-stall',
    parts,
    [3.14, 2.84, 1.94],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'display-left': { position: [-0.88, 1.09, -0.63], rotation: [0, 0, 0] },
      'display-centre': { position: [0, 1.09, -0.63], rotation: [0, 0, 0] },
      'display-right': { position: [0.88, 1.09, -0.63], rotation: [0, 0, 0] },
      'lower-stock': { position: [0, 0.45, -0.18], rotation: [0, 0, 0] },
      'canopy-hook': { position: [0, 2.43, -0.86], rotation: [0, 0, 0] },
    },
    { modularStructure: true, displaySurfaceCount: 4 },
  );
}

export function createProduceBasket() {
  const parts: MeshPart[] = [
    surfaceOfRevolutionPart(
      [
        { radius: 0.25, y: 0.02 },
        { radius: 0.31, y: 0.08 },
        { radius: 0.41, y: 0.26 },
        { radius: 0.44, y: 0.38 },
      ],
      24,
      0,
      'basket-willow',
      true,
    ),
    sweptTubePart({
      points: circlePoints(0.445, 0.39),
      radius: 0.025,
      bone: 0,
      materialId: 'basket-willow',
      radialSegments: 8,
      closed: true,
    }),
    sweptTubePart({
      points: [
        [-0.39, 0.35, 0],
        [-0.31, 0.66, 0],
        [0, 0.79, 0],
        [0.31, 0.66, 0],
        [0.39, 0.35, 0],
      ],
      radius: 0.022,
      bone: 0,
      materialId: 'basket-willow',
      radialSegments: 8,
    }),
  ];
  const produce: Array<{ at: Vec3; color: string; radius: number }> = [
    { at: [-0.22, 0.42, -0.08], color: 'produce-apple-red', radius: 0.12 },
    { at: [0.02, 0.43, -0.15], color: 'produce-apple-gold', radius: 0.13 },
    { at: [0.24, 0.42, -0.03], color: 'produce-apple-red', radius: 0.115 },
    { at: [-0.08, 0.47, 0.1], color: 'produce-leaf-green', radius: 0.13 },
    { at: [0.17, 0.49, 0.13], color: 'produce-apple-gold', radius: 0.11 },
  ];
  for (const item of produce)
    parts.push({
      ...ellipsoidBetween(
        [item.at[0], item.at[1] - item.radius, item.at[2]],
        [item.at[0], item.at[1] + item.radius, item.at[2]],
        item.radius,
        item.radius * 0.9,
        0,
      ),
      materialId: item.color,
    });
  return finish(
    'prop.produce-basket',
    parts,
    [0.89, 0.81, 0.89],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'carry-handle': { position: [0, 0.79, 0], rotation: [0, 0, 0] },
      'display-base': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'produce-centre': { position: [0, 0.48, 0], rotation: [0, 0, 0] },
    },
    { physicalInventory: true, inventoryCategory: 'produce' },
  );
}

export function createTiedProvisionSack() {
  const parts: MeshPart[] = [
    surfaceOfRevolutionPart(
      [
        { radius: 0.23, y: 0.015 },
        { radius: 0.34, y: 0.08 },
        { radius: 0.39, y: 0.28 },
        { radius: 0.36, y: 0.58 },
        { radius: 0.24, y: 0.76 },
        { radius: 0.15, y: 0.83 },
        { radius: 0.13, y: 0.94 },
      ],
      24,
      0,
      'sack-burlap',
      true,
    ),
    sweptTubePart({
      points: circlePoints(0.155, 0.825),
      radius: 0.018,
      bone: 0,
      materialId: 'sack-seam',
      radialSegments: 8,
      closed: true,
    }),
    sweptTubePart({
      points: [
        [-0.14, 0.83, 0],
        [-0.27, 0.79, -0.02],
        [-0.31, 0.71, -0.04],
      ],
      radius: 0.012,
      bone: 0,
      materialId: 'sack-seam',
      radialSegments: 8,
    }),
    sweptTubePart({
      points: [
        [0.14, 0.83, 0],
        [0.25, 0.77, 0.03],
        [0.28, 0.69, 0.05],
      ],
      radius: 0.012,
      bone: 0,
      materialId: 'sack-seam',
      radialSegments: 8,
    }),
  ];
  // Raised gathered seams break the rotational silhouette and communicate soft, cinched fabric.
  const foldProfile = [
    { radius: 0.235, y: 0.06 },
    { radius: 0.345, y: 0.18 },
    { radius: 0.365, y: 0.42 },
    { radius: 0.31, y: 0.65 },
    { radius: 0.19, y: 0.79 },
  ];
  for (let fold = 0; fold < 7; fold++) {
    const angle = (fold / 7) * Math.PI * 2 + 0.12;
    parts.push(
      sweptTubePart({
        points: foldProfile.map(
          ({ radius, y }) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as Vec3,
        ),
        radius: 0.008,
        bone: 0,
        materialId: 'sack-seam',
        radialSegments: 6,
      }),
    );
  }
  return finish(
    'prop.tied-provision-sack',
    parts,
    [0.78, 0.94, 0.78],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'tie-grip': { position: [0, 0.84, 0], rotation: [0, 0, 0] },
      'stack-centre': { position: [0, 0.48, 0], rotation: [0, 0, 0] },
    },
    { physicalInventory: true, inventoryCategory: 'dry-provisions' },
  );
}
