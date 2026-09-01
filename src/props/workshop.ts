import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import { boxPart, mergeMeshParts, sweptTubePart, type MeshPart } from '../geometry/primitives.js';
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

const workshopMaterials: GeometryMaterial[] = [
  {
    ...material('workshop-hardwood', [0.2, 0.075, 0.022, 1], 0.67),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.workshop-oiled-hardwood',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.055, 0.012, 0.003, 1],
          [0.18, 0.052, 0.012, 1],
          [0.31, 0.13, 0.034, 1],
        ],
        scaleMeters: 0.12,
        seed: 8811,
      },
      normal: { kind: 'procedural-noise', strength: 0.24, scaleMeters: 0.009 },
      roughness: {
        minimum: 0.42,
        maximum: 0.78,
        variationScaleMeters: 0.09,
        wetness: 0.02,
      },
      pattern: {
        kind: 'directional-wood',
        grainAxis: 'x',
        grainWidthMeters: 0.011,
        longitudinalScaleMeters: 0.9,
        distortion: 4.2,
        ringContrast: 0.5,
      },
      metallic: 0,
      metadata: { generator: 'videoer.workshop-assets.v1' },
    }),
  },
  {
    ...material('workshop-aged-steel', [0.09, 0.105, 0.115, 1], 0.45, 0.74),
    surface: surfaceMaterialSchema.parse({
      schemaVersion: 1,
      id: 'material.workshop-aged-steel',
      shadingModel: 'metallic-roughness',
      baseColor: {
        kind: 'procedural-palette',
        colors: [
          [0.025, 0.03, 0.034, 1],
          [0.085, 0.1, 0.11, 1],
          [0.2, 0.16, 0.11, 1],
        ],
        scaleMeters: 0.045,
        seed: 8812,
      },
      normal: { kind: 'procedural-noise', strength: 0.18, scaleMeters: 0.006 },
      roughness: {
        minimum: 0.28,
        maximum: 0.62,
        variationScaleMeters: 0.055,
        wetness: 0,
      },
      pattern: { kind: 'isotropic' },
      metallic: 0.74,
      metadata: { generator: 'videoer.workshop-assets.v1', finish: 'aged-tool-steel' },
    }),
  },
  material('workshop-painted-steel', [0.055, 0.13, 0.16, 1], 0.38, 0.56),
  material('workshop-dark-recess', [0.008, 0.012, 0.014, 1], 0.9, 0.12),
  material('workshop-brass', [0.48, 0.22, 0.045, 1], 0.32, 0.82),
  material('workshop-rubber', [0.012, 0.014, 0.015, 1], 0.88),
  material('workshop-chalk', [0.63, 0.48, 0.22, 1], 0.82),
];

function finish(
  id: string,
  parts: MeshPart[],
  dimensions: [number, number, number],
  attachments: GeometryAsset['attachments'],
  metadata: Record<string, unknown>,
) {
  const geometry = mergeMeshParts(id, parts, rootSkeleton, {
    generator: 'videoer.workshop-assets.v1',
    dimensionsMeters: dimensions,
    intendedShotDistance: ['background', 'medium'],
    placementSurface: 'ground',
    workshopAsset: true,
    ...metadata,
  });
  geometry.materials = workshopMaterials;
  geometry.attachments = attachments;
  return geometry;
}

function tube(points: Vec3[], radius: number, materialId = 'workshop-aged-steel') {
  return sweptTubePart({ points, radius, bone: 0, materialId, radialSegments: 8 });
}

export function createJoinersWorkbench() {
  const parts: MeshPart[] = [
    boxPart([-1.25, 0.82, -0.48], [1.25, 1.02, 0.48], 0, 'workshop-hardwood'),
    boxPart([-1.08, 0.12, -0.37], [-0.89, 0.82, -0.18], 0, 'workshop-hardwood'),
    boxPart([0.89, 0.12, -0.37], [1.08, 0.82, -0.18], 0, 'workshop-hardwood'),
    boxPart([-1.08, 0.12, 0.18], [-0.89, 0.82, 0.37], 0, 'workshop-hardwood'),
    boxPart([0.89, 0.12, 0.18], [1.08, 0.82, 0.37], 0, 'workshop-hardwood'),
    boxPart([-0.98, 0.34, -0.13], [0.98, 0.47, 0.13], 0, 'workshop-hardwood'),
    boxPart([-1.28, 0.69, -0.57], [-0.7, 0.96, -0.49], 0, 'workshop-aged-steel'),
    boxPart([-1.21, 0.72, -0.67], [-0.77, 0.91, -0.58], 0, 'workshop-hardwood'),
    tube(
      [
        [-0.99, 0.81, -0.68],
        [-0.99, 0.81, -0.91],
      ],
      0.035,
    ),
    tube(
      [
        [-1.25, 0.81, -0.91],
        [-0.73, 0.81, -0.91],
      ],
      0.022,
      'workshop-brass',
    ),
    // Readable bench dogs and a small loose hammer make the surface feel used.
    ...[-0.55, 0, 0.55].map((x) =>
      tube(
        [
          [x, 1.015, 0.23],
          [x, 1.075, 0.23],
        ],
        0.025,
      ),
    ),
    tube(
      [
        [0.35, 1.055, -0.06],
        [0.72, 1.055, 0.12],
      ],
      0.025,
      'workshop-hardwood',
    ),
    boxPart([0.66, 1.025, 0.06], [0.86, 1.11, 0.2], 0, 'workshop-aged-steel'),
  ];
  return finish(
    'prop.joiners-workbench',
    parts,
    [2.5, 1.11, 1.39],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'work-surface': { position: [0, 1.03, 0], rotation: [0, 0, 0] },
      'vise-grip': { position: [-0.99, 0.81, -0.91], rotation: [0, 0, 0] },
      'operator-position': { position: [0, 0, -1.08], rotation: [0, 0, 0] },
      'task-light-target': { position: [0.2, 1.05, 0], rotation: [0, 0, 0] },
    },
    { workstationStructure: true, physicalVise: true, looseToolCount: 1 },
  );
}

export function createFreestandingToolBoard() {
  const parts: MeshPart[] = [
    boxPart([-0.93, 0.03, 0.1], [0.93, 0.12, 0.56], 0, 'workshop-aged-steel'),
    boxPart([-0.86, 0.1, 0.22], [-0.72, 2.12, 0.38], 0, 'workshop-aged-steel'),
    boxPart([0.72, 0.1, 0.22], [0.86, 2.12, 0.38], 0, 'workshop-aged-steel'),
    boxPart([-0.75, 0.72, 0.31], [0.75, 2.02, 0.37], 0, 'workshop-painted-steel'),
    boxPart([-0.78, 0.61, 0.12], [0.78, 0.72, 0.47], 0, 'workshop-hardwood'),
    boxPart([-0.67, 1.25, 0.02], [0.67, 1.31, 0.3], 0, 'workshop-hardwood'),
  ];
  // Peg pattern provides scale and material breakup without a texture dependency.
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 7; column++) {
      const x = -0.58 + column * 0.195;
      const y = 0.88 + row * 0.25;
      parts.push(
        tube(
          [
            [x, y, 0.29],
            [x, y, 0.2],
          ],
          0.008,
          'workshop-dark-recess',
        ),
      );
    }
  // Hammer, square, tongs and two long handled tools retain recognizable silhouettes.
  parts.push(
    tube(
      [
        [-0.48, 1.78, 0.18],
        [-0.48, 1.37, 0.18],
      ],
      0.022,
      'workshop-hardwood',
    ),
    boxPart([-0.64, 1.76, 0.13], [-0.31, 1.88, 0.23], 0, 'workshop-aged-steel'),
    tube(
      [
        [-0.13, 1.82, 0.18],
        [-0.13, 1.42, 0.18],
        [0.12, 1.42, 0.18],
      ],
      0.018,
    ),
    tube(
      [
        [0.33, 1.86, 0.18],
        [0.27, 1.55, 0.18],
        [0.41, 1.38, 0.18],
      ],
      0.017,
    ),
    tube(
      [
        [0.57, 1.83, 0.18],
        [0.5, 1.54, 0.18],
        [0.6, 1.31, 0.18],
      ],
      0.017,
    ),
    tube(
      [
        [-0.52, 1.22, 0.09],
        [-0.52, 0.83, 0.09],
      ],
      0.017,
      'workshop-hardwood',
    ),
    boxPart([-0.59, 0.78, 0.03], [-0.45, 0.9, 0.15], 0, 'workshop-aged-steel'),
  );
  return finish(
    'prop.freestanding-tool-board',
    parts,
    [1.86, 2.12, 0.56],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'tool-display-centre': { position: [0, 1.45, 0.12], rotation: [0, 0, 0] },
      'shelf-left': { position: [-0.42, 1.31, 0.02], rotation: [0, 0, 0] },
      'shelf-right': { position: [0.42, 1.31, 0.02], rotation: [0, 0, 0] },
    },
    { physicalToolDisplay: true, displayedToolCount: 7, pegCount: 28 },
  );
}

function wheelLoop(x: number, z: number) {
  const points: Vec3[] = [];
  for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2;
    points.push([x + Math.cos(angle) * 0.075, 0.085 + Math.sin(angle) * 0.075, z]);
  }
  return sweptTubePart({
    points,
    radius: 0.022,
    bone: 0,
    materialId: 'workshop-rubber',
    radialSegments: 6,
    closed: true,
    referenceAxis: [0, 0, 1],
  });
}

export function createRollingPartsCabinet() {
  const parts: MeshPart[] = [
    boxPart([-0.48, 0.16, -0.35], [0.48, 0.95, 0.35], 0, 'workshop-painted-steel'),
    boxPart([-0.52, 0.92, -0.39], [0.52, 1.02, 0.39], 0, 'workshop-hardwood'),
    boxPart([-0.43, 0.2, -0.365], [0.43, 0.88, -0.35], 0, 'workshop-dark-recess'),
  ];
  for (let drawer = 0; drawer < 5; drawer++) {
    const minimumY = 0.24 + drawer * 0.125;
    parts.push(
      boxPart([-0.4, minimumY, -0.385], [0.4, minimumY + 0.1, -0.36], 0, 'workshop-aged-steel'),
      tube(
        [
          [-0.13, minimumY + 0.05, -0.415],
          [0.13, minimumY + 0.05, -0.415],
        ],
        0.014,
        'workshop-brass',
      ),
    );
  }
  for (const x of [-0.37, 0.37]) for (const z of [-0.27, 0.27]) parts.push(wheelLoop(x, z));
  parts.push(
    tube(
      [
        [-0.5, 0.82, 0.18],
        [-0.68, 0.82, 0.18],
        [-0.68, 0.72, 0.18],
      ],
      0.022,
    ),
    boxPart([-0.27, 1.025, -0.16], [-0.08, 1.07, 0.08], 0, 'workshop-aged-steel'),
    boxPart([0.02, 1.025, -0.08], [0.23, 1.055, 0.12], 0, 'workshop-chalk'),
  );
  return finish(
    'prop.rolling-parts-cabinet',
    parts,
    [1.2, 1.07, 0.83],
    {
      'ground-origin': { position: [0, 0, 0], rotation: [0, 0, 0] },
      'top-tray': { position: [0, 1.04, 0], rotation: [0, 0, 0] },
      'push-handle': { position: [-0.68, 0.78, 0.18], rotation: [0, 0, 0] },
      'drawer-centre': { position: [0, 0.55, -0.4], rotation: [0, 0, 0] },
    },
    { physicalDrawerCount: 5, rollingStorage: true, loosePartCount: 2 },
  );
}
