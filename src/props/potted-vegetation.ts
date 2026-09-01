import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import {
  capsuleBetween,
  lanceolateLeafPart,
  mergeMeshParts,
  surfaceOfRevolutionPart,
  sweptTubePart,
  type MeshPart,
} from '../geometry/primitives.js';

const material = (
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial => ({
  id,
  baseColor,
  roughness,
  metallic,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

function planterParts(kind: 'terracotta' | 'galvanized') {
  const potMaterial = kind === 'terracotta' ? 'weathered-terracotta' : 'galvanized-zinc';
  return [
    surfaceOfRevolutionPart(
      [
        { radius: 0.24, y: 0.025 },
        { radius: 0.27, y: 0.08 },
        { radius: 0.34, y: 0.43 },
        { radius: 0.38, y: 0.48 },
        { radius: 0.39, y: 0.55 },
      ],
      32,
      0,
      potMaterial,
    ),
    surfaceOfRevolutionPart(
      [
        { radius: 0.345, y: 0.548 },
        { radius: 0.345, y: 0.562 },
      ],
      28,
      0,
      'dark-soil',
    ),
  ];
}

function leaf(start: Vec3, end: Vec3, width: number, materialId: string) {
  return lanceolateLeafPart({
    start,
    end,
    maximumWidth: width,
    bow: width * 0.16,
    bone: 0,
    materialId,
    doubleSided: true,
  });
}

export function createPottedFern(): GeometryAsset {
  const parts: MeshPart[] = planterParts('terracotta');
  const directions = [
    [-0.62, 0.5, -0.2],
    [0.58, 0.54, -0.28],
    [-0.45, 0.62, 0.42],
    [0.5, 0.58, 0.38],
    [-0.12, 0.74, -0.56],
    [0.16, 0.77, 0.53],
    [-0.72, 0.4, 0.18],
    [0.7, 0.43, 0.08],
    [-0.36, 0.68, -0.48],
    [0.4, 0.66, 0.46],
  ] as const;
  for (const [index, direction] of directions.entries()) {
    const start: Vec3 = [0, 0.55, 0];
    const tip: Vec3 = [direction[0], 0.58 + direction[1], direction[2]];
    parts.push(
      sweptTubePart({
        points: [start, [tip[0] * 0.48, tip[1] * 0.82, tip[2] * 0.48], tip],
        radius: 0.009,
        bone: 0,
        materialId: 'fern-stem',
        radialSegments: 8,
      }),
    );
    for (let segment = 1; segment <= 5; segment++) {
      const t = segment / 6;
      const centre: Vec3 = [tip[0] * t, 0.55 + (tip[1] - 0.55) * t, tip[2] * t];
      const side: Vec3 = [-tip[2], 0.08 + segment * 0.006, tip[0]];
      const sideLength = Math.hypot(side[0], side[2]) || 1;
      const reach = 0.24 * (1 - t * 0.4);
      const offset: Vec3 = [
        (side[0] / sideLength) * reach,
        side[1],
        (side[2] / sideLength) * reach,
      ];
      parts.push(
        leaf(
          centre,
          [centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]],
          0.068,
          index % 3 === 0 ? 'fern-light' : 'fern-dark',
        ),
        leaf(
          centre,
          [centre[0] - offset[0], centre[1] + offset[1], centre[2] - offset[2]],
          0.068,
          index % 3 === 1 ? 'fern-light' : 'fern-dark',
        ),
      );
    }
    const terminalStart: Vec3 = [tip[0] * 0.78, 0.55 + (tip[1] - 0.55) * 0.78, tip[2] * 0.78];
    parts.push(leaf(terminalStart, tip, 0.078, index % 2 ? 'fern-light' : 'fern-dark'));
  }
  const geometry = mergeMeshParts(
    'prop.potted-fern',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.potted-vegetation.v1',
      propClass: 'portable-potted-vegetation',
      physicalDimensionsMeters: [1.45, 1.35, 1.2],
      livingAsset: true,
      windResponseAnchor: 'foliage-crown',
    },
  );
  geometry.materials = [
    material('weathered-terracotta', [0.34, 0.095, 0.035, 1], 0.78),
    material('dark-soil', [0.035, 0.022, 0.012, 1], 0.95),
    material('fern-stem', [0.06, 0.18, 0.035, 1], 0.72),
    material('fern-dark', [0.035, 0.22, 0.055, 1], 0.66),
    material('fern-light', [0.1, 0.38, 0.095, 1], 0.62),
  ];
  geometry.attachments = {
    'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'pot-rim': { position: [0, 0.55, 0], rotation: [0, 0, 0], bone: 'root' },
    'foliage-crown': { position: [0, 1.02, 0], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}

export function createPottedShrub(): GeometryAsset {
  const parts: MeshPart[] = planterParts('galvanized');
  const branches: Vec3[] = [
    [-0.35, 1.35, -0.22],
    [0.38, 1.42, -0.16],
    [-0.3, 1.28, 0.3],
    [0.31, 1.34, 0.28],
    [0.02, 1.55, 0.03],
    [-0.52, 1.18, 0.04],
    [0.53, 1.22, 0.05],
    [-0.18, 1.48, -0.34],
    [0.2, 1.46, 0.36],
  ];
  for (const [index, tip] of branches.entries()) {
    const branch = capsuleBetween([0, 0.54, 0], tip, 0.014, 0.009, 0, 0, 3, 9);
    branch.materialId = 'shrub-branch';
    parts.push(branch);
    for (const t of [0.48, 0.72]) {
      const middle: Vec3 = [tip[0] * t, 0.54 + (tip[1] - 0.54) * t, tip[2] * t];
      const reach = 0.24 * (1 - (t - 0.48) * 0.3);
      parts.push(
        leaf(
          middle,
          [middle[0] - reach, middle[1] + 0.075, middle[2] + 0.09],
          0.095,
          index % 2 ? 'shrub-mid' : 'shrub-dark',
        ),
        leaf(
          middle,
          [middle[0] + reach, middle[1] + 0.085, middle[2] - 0.09],
          0.095,
          index % 3 ? 'shrub-mid' : 'shrub-light',
        ),
      );
    }
    const terminalStart: Vec3 = [tip[0] * 0.78, 0.54 + (tip[1] - 0.54) * 0.78, tip[2] * 0.78];
    parts.push(leaf(terminalStart, tip, 0.105, index % 2 ? 'shrub-light' : 'shrub-mid'));
  }
  const geometry = mergeMeshParts(
    'prop.potted-shrub',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.potted-vegetation.v1',
      propClass: 'portable-potted-vegetation',
      physicalDimensionsMeters: [1.05, 1.55, 0.9],
      livingAsset: true,
      windResponseAnchor: 'foliage-crown',
    },
  );
  geometry.materials = [
    material('galvanized-zinc', [0.22, 0.25, 0.26, 1], 0.38, 0.72),
    material('dark-soil', [0.035, 0.022, 0.012, 1], 0.95),
    material('shrub-branch', [0.11, 0.055, 0.018, 1], 0.76),
    material('shrub-dark', [0.025, 0.17, 0.04, 1], 0.7),
    material('shrub-mid', [0.055, 0.29, 0.065, 1], 0.64),
    material('shrub-light', [0.12, 0.42, 0.1, 1], 0.6),
  ];
  geometry.attachments = {
    'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'pot-rim': { position: [0, 0.55, 0], rotation: [0, 0, 0], bone: 'root' },
    'foliage-crown': { position: [0, 1.3, 0], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}
