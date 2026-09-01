import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import {
  boxPart,
  ellipsoidBetween,
  mergeMeshParts,
  roundedBoxPart,
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

const furnishingMaterials: GeometryMaterial[] = [
  {
    ...material('furnishing-walnut', [0.16, 0.045, 0.012, 1], 0.58),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.furnishing-oiled-walnut',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.035, 0.006, 0.002, 1],
          [0.13, 0.028, 0.006, 1],
          [0.28, 0.095, 0.018, 1],
        ],
        scaleMeters: 0.1,
        seed: 9431,
      },
      normal: { kind: 'procedural-noise', strength: 0.17, scaleMeters: 0.006 },
      roughness: {
        minimum: 0.38,
        maximum: 0.7,
        variationScaleMeters: 0.08,
        wetness: 0,
      },
      pattern: {
        kind: 'directional-wood',
        grainAxis: 'x',
        grainWidthMeters: 0.009,
        longitudinalScaleMeters: 0.8,
        distortion: 3.4,
        ringContrast: 0.42,
      },
      metallic: 0,
      metadata: { generator: 'videoer.interior-furnishings.v1' },
    }),
  },
  {
    ...material('furnishing-woven-wool', [0.18, 0.31, 0.34, 1], 0.82),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.furnishing-woven-wool',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.045, 0.11, 0.13, 1],
          [0.13, 0.29, 0.32, 1],
          [0.25, 0.43, 0.44, 1],
        ],
        scaleMeters: 0.032,
        seed: 9432,
      },
      normal: { kind: 'procedural-noise', strength: 0.32, scaleMeters: 0.0025 },
      roughness: {
        minimum: 0.68,
        maximum: 0.92,
        variationScaleMeters: 0.018,
        wetness: 0,
      },
      pattern: {
        kind: 'woven-textile',
        warpAxis: 'x',
        warpSpacingMeters: 0.0032,
        weftSpacingMeters: 0.0026,
        threadContrast: 0.36,
        fuzzAmount: 0.48,
      },
      metallic: 0,
      metadata: { generator: 'videoer.interior-furnishings.v1', fibre: 'wool-blend' },
    }),
  },
  {
    ...material('furnishing-aged-brass', [0.44, 0.23, 0.055, 1], 0.38, 0.82),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.furnishing-aged-brass',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.11, 0.06, 0.018, 1],
          [0.42, 0.22, 0.045, 1],
          [0.64, 0.38, 0.11, 1],
        ],
        scaleMeters: 0.028,
        seed: 9433,
      },
      normal: { kind: 'procedural-noise', strength: 0.13, scaleMeters: 0.0018 },
      roughness: {
        minimum: 0.24,
        maximum: 0.58,
        variationScaleMeters: 0.026,
        wetness: 0,
      },
      pattern: {
        kind: 'brushed-metal',
        brushAxis: 'x',
        brushSpacingMeters: 0.0015,
        scratchContrast: 0.24,
        patinaAmount: 0.21,
      },
      metallic: 0.82,
      metadata: { generator: 'videoer.interior-furnishings.v1', finish: 'aged-brass' },
    }),
  },
  {
    ...material('furnishing-glazed-ceramic', [0.72, 0.5, 0.26, 1], 0.3),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.furnishing-glazed-ceramic',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.24, 0.075, 0.018, 1],
          [0.66, 0.34, 0.11, 1],
          [0.88, 0.69, 0.36, 1],
        ],
        scaleMeters: 0.042,
        seed: 9434,
      },
      normal: { kind: 'procedural-noise', strength: 0.08, scaleMeters: 0.004 },
      roughness: {
        minimum: 0.18,
        maximum: 0.42,
        variationScaleMeters: 0.036,
        wetness: 0,
      },
      pattern: {
        kind: 'glazed-ceramic',
        glazeAmount: 0.82,
        glazeRoughness: 0.16,
        speckleScaleMeters: 0.006,
        speckleAmount: 0.18,
      },
      metallic: 0,
      metadata: { generator: 'videoer.interior-furnishings.v1', finish: 'reactive-glaze' },
    }),
  },
  material('furnishing-dark-recess', [0.008, 0.012, 0.013, 1], 0.88),
];

function translate(part: MeshPart, offset: Vec3): MeshPart {
  return {
    ...part,
    positions: part.positions.map((position) => [
      position[0] + offset[0],
      position[1] + offset[1],
      position[2] + offset[2],
    ]),
  };
}

function withMaterial(part: MeshPart, materialId: string): MeshPart {
  return { ...part, materialId };
}

function tube(points: Vec3[], radius: number, materialId = 'furnishing-walnut') {
  return sweptTubePart({ points, radius, bone: 0, materialId, radialSegments: 12 });
}

function finish(
  id: string,
  parts: MeshPart[],
  dimensions: [number, number, number],
  attachments: GeometryAsset['attachments'],
  metadata: Record<string, unknown>,
) {
  const geometry = mergeMeshParts(id, parts, rootSkeleton, {
    generator: 'videoer.interior-furnishings.v1',
    dimensionsMeters: dimensions,
    intendedShotDistance: ['background', 'medium'],
    placementSurface: 'ground',
    domesticFurnishing: true,
    ...metadata,
  });
  geometry.materials = furnishingMaterials;
  geometry.attachments = attachments;
  return geometry;
}

export function createUpholsteredReadingChair() {
  const parts: MeshPart[] = [
    // A visible timber frame, tailored cushions and curved arms retain a readable
    // furniture silhouette without proxy-like inflated volumes.
    boxPart([-0.57, 0.4, -0.5], [0.57, 0.51, 0.44], 0, 'furnishing-walnut'),
    roundedBoxPart([-0.5, 0.51, -0.42], [0.5, 0.69, 0.31], 0.075, 0, 'furnishing-woven-wool', 10),
    roundedBoxPart([-0.48, 0.76, 0.25], [0.48, 1.54, 0.45], 0.08, 0, 'furnishing-woven-wool', 10),
    boxPart([-0.53, 0.39, -0.48], [0.53, 0.48, -0.4], 0, 'furnishing-walnut'),
    tube(
      [
        [-0.48, 0.43, -0.38],
        [-0.5, 0.08, -0.43],
      ],
      0.055,
    ),
    tube(
      [
        [0.48, 0.43, -0.38],
        [0.5, 0.08, -0.43],
      ],
      0.055,
    ),
    tube(
      [
        [-0.48, 0.43, 0.36],
        [-0.54, 0.08, 0.46],
      ],
      0.055,
    ),
    tube(
      [
        [0.48, 0.43, 0.36],
        [0.54, 0.08, 0.46],
      ],
      0.055,
    ),
    tube(
      [
        [-0.6, 0.58, -0.25],
        [-0.64, 0.88, 0.08],
        [-0.58, 0.93, 0.37],
      ],
      0.045,
    ),
    tube(
      [
        [0.6, 0.58, -0.25],
        [0.64, 0.88, 0.08],
        [0.58, 0.93, 0.37],
      ],
      0.045,
    ),
    tube(
      [
        [-0.48, 0.58, 0.38],
        [-0.5, 1.66, 0.48],
      ],
      0.04,
    ),
    tube(
      [
        [0.48, 0.58, 0.38],
        [0.5, 1.66, 0.48],
      ],
      0.04,
    ),
    tube(
      [
        [-0.49, 0.7, -0.41],
        [0.49, 0.7, -0.41],
        [0.49, 0.7, 0.3],
        [-0.49, 0.7, 0.3],
        [-0.49, 0.7, -0.41],
      ],
      0.012,
      'furnishing-woven-wool',
    ),
    tube(
      [
        [-0.47, 0.77, 0.235],
        [0.47, 0.77, 0.235],
        [0.47, 1.53, 0.235],
        [-0.47, 1.53, 0.235],
        [-0.47, 0.77, 0.235],
      ],
      0.011,
      'furnishing-woven-wool',
    ),
  ];
  for (const x of [-0.22, 0, 0.22])
    parts.push(
      withMaterial(
        ellipsoidBetween([x - 0.018, 1.28, 0.225], [x + 0.018, 1.28, 0.225], 0.018, 0.015, 0),
        'furnishing-aged-brass',
      ),
    );
  return finish(
    'prop.upholstered-reading-chair',
    parts,
    [1.28, 1.7, 1.02],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'seat-centre': { position: [0, 0.66, -0.03], rotation: [0, 0, 0] },
      'occupant-position': { position: [0, 0.67, -0.08], rotation: [0, 0, 0] },
      'back-rest': { position: [0, 1.24, 0.24], rotation: [0, 0, 0] },
      'side-table-left': { position: [-1.05, 0, -0.05], rotation: [0, 0, 0] },
      'side-table-right': { position: [1.05, 0, -0.05], rotation: [0, 0, 0] },
    },
    { seatingCapacity: 1, upholstered: true, physicalFrame: true, tuftButtonCount: 3 },
  );
}

export function createPedestalSideTable() {
  const parts: MeshPart[] = [
    surfaceOfRevolutionPart(
      [
        { radius: 0.4, y: 0.02 },
        { radius: 0.45, y: 0.08 },
        { radius: 0.2, y: 0.13 },
        { radius: 0.12, y: 0.22 },
        { radius: 0.1, y: 0.58 },
        { radius: 0.18, y: 0.65 },
        { radius: 0.54, y: 0.68 },
        { radius: 0.56, y: 0.75 },
      ],
      32,
      0,
      'furnishing-walnut',
    ),
  ];
  const ring: Vec3[] = [];
  for (let index = 0; index <= 32; index++) {
    const angle = (index / 32) * Math.PI * 2;
    ring.push([Math.cos(angle) * 0.49, 0.755, Math.sin(angle) * 0.49]);
  }
  parts.push(tube(ring, 0.012, 'furnishing-aged-brass'));
  return finish(
    'prop.pedestal-side-table',
    parts,
    [1.12, 0.77, 1.12],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'tabletop-centre': { position: [0, 0.77, 0], rotation: [0, 0, 0] },
      'tabletop-left': { position: [-0.34, 0.77, 0], rotation: [0, 0, 0] },
      'tabletop-right': { position: [0.34, 0.77, 0], rotation: [0, 0, 0] },
      'chair-position': { position: [1.05, 0, 0], rotation: [0, 0, 0] },
    },
    { physicalTableSurface: true, brassInlay: true, interactionHeightMeters: 0.77 },
  );
}

export function createDecorativeVesselSet() {
  const parts: MeshPart[] = [
    withMaterial(
      surfaceOfRevolutionPart(
        [
          { radius: 0.35, y: 0.01 },
          { radius: 0.4, y: 0.035 },
          { radius: 0.38, y: 0.065 },
        ],
        28,
        0,
        'furnishing-aged-brass',
      ),
      'furnishing-aged-brass',
    ),
    translate(
      surfaceOfRevolutionPart(
        [
          { radius: 0.13, y: 0.06 },
          { radius: 0.19, y: 0.13 },
          { radius: 0.2, y: 0.29 },
          { radius: 0.13, y: 0.43 },
          { radius: 0.1, y: 0.58 },
          { radius: 0.12, y: 0.64 },
        ],
        28,
        0,
        'furnishing-glazed-ceramic',
      ),
      [-0.13, 0, 0.02],
    ),
    translate(
      surfaceOfRevolutionPart(
        [
          { radius: 0.09, y: 0.06 },
          { radius: 0.14, y: 0.11 },
          { radius: 0.16, y: 0.22 },
          { radius: 0.11, y: 0.34 },
          { radius: 0.1, y: 0.39 },
        ],
        24,
        0,
        'furnishing-glazed-ceramic',
      ),
      [0.2, 0, -0.08],
    ),
    translate(
      surfaceOfRevolutionPart(
        [
          { radius: 0.08, y: 0.06 },
          { radius: 0.12, y: 0.1 },
          { radius: 0.13, y: 0.19 },
          { radius: 0.09, y: 0.27 },
          { radius: 0.08, y: 0.31 },
        ],
        24,
        0,
        'furnishing-aged-brass',
      ),
      [0.12, 0, 0.2],
    ),
  ];
  return finish(
    'prop.decorative-vessel-set',
    parts,
    [0.8, 0.65, 0.8],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'tabletop-base': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'carry-point': { position: [0, 0.13, 0], rotation: [0, 0, 0] },
      'vessel-focus': { position: [-0.05, 0.35, 0.02], rotation: [0, 0, 0] },
    },
    { tabletopAsset: true, physicalVesselCount: 3, physicalTray: true },
  );
}
