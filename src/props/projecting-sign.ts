import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import {
  boxPart,
  capsuleBetween,
  mergeMeshParts,
  sweptTubePart,
  type MeshPart,
} from '../geometry/primitives.js';
import { surfaceMaterialSchema } from '../materials/model.js';

const agedSignIron: GeometryMaterial = {
  id: 'aged-sign-iron',
  baseColor: [0.035, 0.042, 0.044, 1],
  roughness: 0.43,
  metallic: 0.78,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.aged-sign-iron',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.015, 0.019, 0.02, 1],
        [0.045, 0.052, 0.052, 1],
        [0.105, 0.055, 0.022, 1],
      ],
      scaleMeters: 0.075,
      seed: 5321,
    },
    normal: { kind: 'procedural-noise', strength: 0.2, scaleMeters: 0.007 },
    roughness: { minimum: 0.3, maximum: 0.67, variationScaleMeters: 0.055, wetness: 0.08 },
    pattern: { kind: 'isotropic' },
    weathering: { surfaceDirt: { amount: 0.16, scaleMeters: 0.035 } },
    metallic: 0.78,
    metadata: { generator: 'videoer.projecting-sign-materials.v1' },
  }),
};

const weatheredSignBoard: GeometryMaterial = {
  id: 'weathered-sign-board',
  baseColor: [0.1, 0.026, 0.009, 1],
  roughness: 0.62,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.weathered-sign-board',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.045, 0.012, 0.004, 1],
        [0.11, 0.027, 0.008, 1],
        [0.19, 0.065, 0.018, 1],
      ],
      scaleMeters: 0.11,
      seed: 5322,
    },
    normal: { kind: 'procedural-noise', strength: 0.25, scaleMeters: 0.012 },
    roughness: { minimum: 0.48, maximum: 0.78, variationScaleMeters: 0.08, wetness: 0.06 },
    pattern: {
      kind: 'directional-wood',
      grainAxis: 'y',
      grainWidthMeters: 0.01,
      longitudinalScaleMeters: 0.48,
      distortion: 6,
      ringContrast: 0.58,
    },
    weathering: { verticalStreaks: { amount: 0.12, widthMeters: 0.025, lengthMeters: 0.42 } },
    metallic: 0,
    metadata: { generator: 'videoer.projecting-sign-materials.v1' },
  }),
};

const agedSignGold: GeometryMaterial = {
  id: 'aged-sign-gold',
  baseColor: [0.32, 0.14, 0.025, 1],
  roughness: 0.38,
  metallic: 0.74,
  emission: [0, 0, 0],
  emissionStrength: 0,
};

const signEmblemPage: GeometryMaterial = {
  id: 'sign-emblem-page',
  baseColor: [0.52, 0.28, 0.07, 1],
  roughness: 0.48,
  metallic: 0.18,
  emission: [0, 0, 0],
  emissionStrength: 0,
};

function ironCapsule(start: Vec3, end: Vec3, radius: number) {
  const part = capsuleBetween(start, end, radius, radius, 0, 0, 3, 12);
  part.materialId = 'aged-sign-iron';
  return part;
}

function chainLoop(centre: Vec3, rotate: boolean) {
  const points: Vec3[] = [];
  for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2;
    points.push(
      rotate
        ? [centre[0], centre[1] + Math.sin(angle) * 0.052, centre[2] + Math.cos(angle) * 0.025]
        : [centre[0] + Math.cos(angle) * 0.025, centre[1] + Math.sin(angle) * 0.052, centre[2]],
    );
  }
  return sweptTubePart({
    points,
    radius: 0.006,
    bone: 0,
    materialId: 'aged-sign-iron',
    radialSegments: 8,
    closed: true,
    referenceAxis: rotate ? [1, 0, 0] : [0, 0, 1],
  });
}

function bookEmblemParts(faceX: number, normalDirection: -1 | 1): MeshPart[] {
  const pageX = faceX + normalDirection * 0.006;
  const x = faceX + normalDirection * 0.012;
  const parts: MeshPart[] = [];
  const page = (corners: [Vec3, Vec3, Vec3, Vec3]): MeshPart => ({
    positions: corners,
    normals: corners.map(() => [normalDirection, 0, 0] as Vec3),
    uvs: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    indices: normalDirection > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2],
    skinIndices: corners.map(() => [0, 0, 0, 0]),
    skinWeights: corners.map(() => [1, 0, 0, 0]),
    materialId: 'sign-emblem-page',
  });
  parts.push(
    page([
      [pageX, -0.4, -0.68],
      [pageX, -0.44, -0.86],
      [pageX, -0.65, -0.86],
      [pageX, -0.69, -0.68],
    ]),
    page([
      [pageX, -0.4, -0.68],
      [pageX, -0.69, -0.68],
      [pageX, -0.65, -0.5],
      [pageX, -0.44, -0.5],
    ]),
  );
  for (const [start, end] of [
    [
      [x, -0.4, -0.68],
      [x, -0.44, -0.86],
    ],
    [
      [x, -0.44, -0.86],
      [x, -0.64, -0.86],
    ],
    [
      [x, -0.64, -0.86],
      [x, -0.69, -0.68],
    ],
    [
      [x, -0.4, -0.68],
      [x, -0.44, -0.5],
    ],
    [
      [x, -0.44, -0.5],
      [x, -0.64, -0.5],
    ],
    [
      [x, -0.64, -0.5],
      [x, -0.69, -0.68],
    ],
  ] as Array<[Vec3, Vec3]>) {
    const line = capsuleBetween(start, end, 0.012, 0.012, 0, 0, 2, 8);
    line.materialId = 'aged-sign-gold';
    parts.push(line);
  }
  parts.push(ironCapsule([x, -0.69, -0.68], [x, -0.36, -0.68], 0.009));
  parts.at(-1)!.materialId = 'aged-sign-gold';
  return parts;
}

export function createProjectingHangingSign(): GeometryAsset {
  const parts: MeshPart[] = [
    boxPart([-0.09, -0.36, -0.035], [0.09, 0.37, 0.018], 0, 'aged-sign-iron'),
    sweptTubePart({
      points: [
        [0, 0.29, -0.02],
        [0, 0.31, -0.3],
        [0, 0.3, -0.68],
        [0, 0.25, -1.03],
      ],
      radius: 0.022,
      bone: 0,
      materialId: 'aged-sign-iron',
      radialSegments: 14,
      referenceAxis: [1, 0, 0],
    }),
    sweptTubePart({
      points: [
        [0, -0.27, -0.02],
        [0, -0.1, -0.3],
        [0, 0.08, -0.58],
        [0, 0.24, -0.88],
      ],
      radius: 0.015,
      bone: 0,
      materialId: 'aged-sign-iron',
      radialSegments: 12,
      referenceAxis: [1, 0, 0],
    }),
    boxPart([-0.035, -0.97, -0.98], [0.035, -0.29, -0.38], 0, 'weathered-sign-board'),
  ];
  // Independent rounded frame members keep the panel readable from both sides.
  for (const x of [-0.047, 0.047]) {
    parts.push(
      ironCapsule([x, -0.99, -1.01], [x, -0.27, -1.01], 0.018),
      ironCapsule([x, -0.99, -0.35], [x, -0.27, -0.35], 0.018),
      ironCapsule([x, -0.99, -1.0], [x, -0.99, -0.36], 0.018),
      ironCapsule([x, -0.27, -1.0], [x, -0.27, -0.36], 0.018),
    );
  }
  for (const z of [-0.48, -0.88])
    for (let link = 0; link < 5; link++)
      parts.push(chainLoop([0, 0.2 - link * 0.105, z], link % 2 === 1));
  parts.push(...bookEmblemParts(-0.035, -1), ...bookEmblemParts(0.035, 1));

  const geometry = mergeMeshParts(
    'prop.projecting-hanging-sign',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.projecting-hanging-sign.v1',
      intendedShotDistance: ['background', 'medium'],
      hostContract: {
        kind: 'vertical-facade-mount',
        facadePlaneZ: 0,
        exteriorNormal: [0, 0, -1],
        requiredMountHeightMeters: { minimum: 2.35, maximum: 4.8 },
        requiredClearanceVolumeMeters: {
          minimum: [-0.14, -1.05, -1.08],
          maximum: [0.14, 0.43, 0.06],
        },
      },
      contentContract: {
        kind: 'replaceable-two-sided-sign-face',
        contentBoundsMeters: { height: 0.5, width: 0.42 },
        canonicalTreatment: 'embossed-open-book-emblem',
        campaignMayReplaceFaceTreatment: true,
        hardwareMustRemainIndependent: true,
      },
      physicalDimensionsMeters: [0.28, 1.48, 1.14],
    },
  );
  geometry.materials = [agedSignIron, weatheredSignBoard, signEmblemPage, agedSignGold];
  geometry.attachments = {
    'wall-mount': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'wall-mount-upper': { position: [0, 0.29, 0], rotation: [0, 0, 0], bone: 'root' },
    'wall-mount-lower': { position: [0, -0.27, 0], rotation: [0, 0, 0], bone: 'root' },
    'hanging-pivot-left': { position: [0, 0.25, -0.48], rotation: [0, 0, 0], bone: 'root' },
    'hanging-pivot-right': { position: [0, 0.25, -0.88], rotation: [0, 0, 0], bone: 'root' },
    'sign-face-front': {
      position: [-0.055, -0.63, -0.68],
      rotation: [0, -Math.PI / 2, 0],
      bone: 'root',
    },
    'sign-face-back': {
      position: [0.055, -0.63, -0.68],
      rotation: [0, Math.PI / 2, 0],
      bone: 'root',
    },
    'content-centre': { position: [0, -0.56, -0.68], rotation: [0, 0, 0], bone: 'root' },
    'sign-focus': { position: [0, -0.52, -0.68], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}
