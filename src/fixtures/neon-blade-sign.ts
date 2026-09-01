import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import {
  boxPart,
  capsuleBetween,
  mergeMeshParts,
  sweptTubePart,
  type MeshPart,
} from '../geometry/primitives.js';
import { practicalFixtureSchema, type PracticalFixture } from './model.js';

const material = (
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
  metallic = 0,
  emission: [number, number, number] = [0, 0, 0],
  emissionStrength = 0,
): GeometryMaterial => ({ id, baseColor, roughness, metallic, emission, emissionStrength });

function tube(points: Vec3[], radius: number, materialId: string, closed = false) {
  return sweptTubePart({ points, radius, bone: 0, materialId, radialSegments: 12, closed });
}

export function createNeonBladeSignGeometry(): GeometryAsset {
  const parts: MeshPart[] = [
    // Load-bearing wall plates and triangular projecting rails.
    boxPart([-0.18, 2.08, -0.035], [0.18, 2.34, 0.025], 0, 'blackened-steel'),
    boxPart([-0.18, 2.82, -0.035], [0.18, 3.08, 0.025], 0, 'blackened-steel'),
    tube(
      [
        [0, 2.21, -0.015],
        [0, 2.21, -0.44],
        [0, 2.34, -0.64],
      ],
      0.022,
      'blackened-steel',
    ),
    tube(
      [
        [0, 2.95, -0.015],
        [0, 2.95, -0.44],
        [0, 2.82, -0.64],
      ],
      0.022,
      'blackened-steel',
    ),
    tube(
      [
        [0, 2.21, -0.16],
        [0, 2.95, -0.16],
      ],
      0.014,
      'blackened-steel',
    ),
    // A real projecting cabinet, readable from either side and below.
    boxPart([-0.055, 2.16, -1.34], [0.055, 3.1, -0.48], 0, 'enamel-edge'),
    boxPart([-0.061, 2.22, -1.28], [-0.056, 3.04, -0.54], 0, 'dark-face'),
    boxPart([0.056, 2.22, -1.28], [0.061, 3.04, -0.54], 0, 'dark-face'),
  ];

  // One neutral wayfinding glyph is physically present on both faces. The two
  // face slots are replaceable without changing cabinet, mount, or emitters.
  const glyph: Vec3[] = [
    [0, 2.36, -1.12],
    [0, 2.88, -1.12],
    [0, 2.36, -0.72],
    [0, 2.88, -0.72],
  ];
  for (const x of [-0.073, 0.073]) {
    parts.push(
      tube(
        glyph.map((point) => [x, point[1], point[2]]),
        0.018,
        'cyan-neon',
      ),
    );
    parts.push(
      tube(
        [
          [x, 2.36, -1.12],
          [x, 2.88, -0.72],
        ],
        0.018,
        'cyan-neon',
      ),
    );
  }

  // Stand-offs keep luminous glass visibly separate from the backing panel.
  for (const x of [-0.064, 0.064])
    for (const y of [2.38, 2.86])
      for (const z of [-1.1, -0.74]) {
        const support = capsuleBetween(
          [x > 0 ? 0.058 : -0.058, y, z],
          [x, y, z],
          0.006,
          0.006,
          0,
          0,
          2,
          8,
        );
        support.materialId = 'ceramic-standoff';
        parts.push(support);
      }

  const geometry = mergeMeshParts(
    'prop.projecting-neon-blade-sign',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.projecting-neon-blade-sign.v1',
      propClass: 'portable-practical-fixture',
      fixtureDefinition: 'fixture.json',
      physicalDimensionsMeters: [0.146, 1.1, 1.365],
      mountingConvention: 'local-origin-at-facade-plane-facing-negative-z',
      hostContract: {
        compatibleSurface: 'vertical-wall',
        minimumClearWallWidthMeters: 0.46,
        minimumProjectionClearanceMeters: 1.42,
        mountingHeightRangeMeters: [2.1, 4.8],
      },
      replaceableFaceTreatment: {
        slots: ['face-left', 'face-right'],
        invariantComponents: ['cabinet', 'mount', 'emitters'],
        treatmentMayReplace: ['dark-face', 'cyan-neon'],
      },
    },
  );
  geometry.positions = geometry.positions.map(([x, y, z]) => [x, y - 2.58, z]);
  geometry.materials = [
    material('blackened-steel', [0.018, 0.025, 0.032, 1], 0.34, 0.82),
    material('enamel-edge', [0.045, 0.055, 0.065, 1], 0.27, 0.55),
    material('dark-face', [0.012, 0.018, 0.023, 1], 0.42, 0.18),
    material('ceramic-standoff', [0.68, 0.72, 0.7, 1], 0.48),
    material('cyan-neon', [0.12, 0.94, 1, 1], 0.12, 0, [0.02, 0.92, 1], 4.2),
  ];
  geometry.attachments = {
    'wall-mount': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'face-left': { position: [-0.073, 0.05, -0.92], rotation: [0, -90, 0], bone: 'root' },
    'face-right': { position: [0.073, 0.05, -0.92], rotation: [0, 90, 0], bone: 'root' },
    'light-origin-left': { position: [-0.1, 0.05, -0.92], rotation: [0, 0, 0], bone: 'root' },
    'light-origin-right': { position: [0.1, 0.05, -0.92], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}

export function createNeonBladeSignFixture(): PracticalFixture {
  const modulation = {
    kind: 'seeded-electrical-instability' as const,
    seed: 9107,
    frequencyHz: 5.5,
    intensityMinimumMultiplier: 0.62,
    intensityMaximumMultiplier: 1.04,
    dropoutProbability: 0.12,
  };
  return practicalFixtureSchema.parse({
    schemaVersion: 1,
    id: 'fixture.projecting-neon-blade-sign',
    geometryAssetId: 'prop.projecting-neon-blade-sign',
    mountAttachmentId: 'wall-mount',
    emitters: [
      {
        id: 'cyan-face-left',
        type: 'area',
        position: [-0.12, 0.05, -0.92],
        target: [-1, -0.03, -0.92],
        color: [0.05, 0.78, 1],
        powerWatts: 92,
        sizeMeters: 0.52,
        visibleSourceMaterialId: 'cyan-neon',
        temporalModulation: modulation,
      },
      {
        id: 'cyan-face-right',
        type: 'area',
        position: [0.12, 0.05, -0.92],
        target: [1, -0.03, -0.92],
        color: [0.05, 0.78, 1],
        powerWatts: 92,
        sizeMeters: 0.52,
        temporalModulation: modulation,
      },
    ],
    metadata: {
      generator: 'videoer.projecting-neon-blade-sign.v1',
      photometricIntent: 'cold-two-sided-local-wayfinding-practical',
      compatibleMount: 'vertical-wall',
      modulationSemantics: 'bounded-seeded-electrical-instability-with-authored-colour',
    },
  });
}
