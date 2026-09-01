import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import {
  boxPart,
  extrudedConvexPolygonPart,
  mergeMeshParts,
  sweptTubePart,
  type MeshPart,
} from '../geometry/primitives.js';
import { surfaceMaterialSchema } from '../materials/model.js';

export interface ProjectingCanopyOptions {
  spanMeters?: number;
  projectionMeters?: number;
  roofFallMeters?: number;
  bracketCount?: number;
}

export const canonicalProjectingCanopy = {
  spanMeters: 4.6,
  projectionMeters: 0.98,
  roofFallMeters: 0.17,
  bracketCount: 3,
} as const;

const canopyTimber: GeometryMaterial = {
  id: 'canopy-timber',
  baseColor: [0.085, 0.026, 0.009, 1],
  roughness: 0.61,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.weathered-canopy-timber',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.04, 0.011, 0.004, 1],
        [0.09, 0.026, 0.008, 1],
        [0.16, 0.057, 0.018, 1],
      ],
      scaleMeters: 0.16,
      seed: 6171,
    },
    normal: { kind: 'procedural-noise', strength: 0.23, scaleMeters: 0.013 },
    roughness: { minimum: 0.46, maximum: 0.77, variationScaleMeters: 0.1, wetness: 0.08 },
    pattern: {
      kind: 'directional-wood',
      grainAxis: 'x',
      grainWidthMeters: 0.012,
      longitudinalScaleMeters: 0.72,
      distortion: 6,
      ringContrast: 0.55,
    },
    weathering: { verticalStreaks: { amount: 0.1, widthMeters: 0.03, lengthMeters: 0.35 } },
    metallic: 0,
    metadata: { generator: 'videoer.projecting-canopy-materials.v1' },
  }),
};

const canopySlate: GeometryMaterial = {
  id: 'canopy-slate',
  baseColor: [0.04, 0.052, 0.068, 1],
  roughness: 0.57,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.weathered-canopy-slate',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.018, 0.026, 0.038, 1],
        [0.04, 0.055, 0.073, 1],
        [0.075, 0.086, 0.095, 1],
      ],
      scaleMeters: 0.21,
      seed: 6172,
    },
    normal: { kind: 'geometry-relief', strength: 0.24, scaleMeters: 0.045 },
    roughness: { minimum: 0.43, maximum: 0.68, variationScaleMeters: 0.12, wetness: 0.18 },
    pattern: {
      kind: 'cut-stone',
      beddingAxis: 'x',
      beddingScaleMeters: 0.18,
      grainScaleMeters: 0.035,
      veinContrast: 0.2,
      poreAmount: 0.18,
    },
    weathering: { surfaceDirt: { amount: 0.12, scaleMeters: 0.06 } },
    metallic: 0,
    metadata: { generator: 'videoer.projecting-canopy-materials.v1' },
  }),
};

const canopyIron: GeometryMaterial = {
  id: 'canopy-iron',
  baseColor: [0.026, 0.033, 0.038, 1],
  roughness: 0.39,
  metallic: 0.8,
  emission: [0, 0, 0],
  emissionStrength: 0,
  surface: surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.aged-canopy-iron',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.012, 0.016, 0.019, 1],
        [0.04, 0.047, 0.05, 1],
        [0.095, 0.045, 0.018, 1],
      ],
      scaleMeters: 0.075,
      seed: 6173,
    },
    normal: { kind: 'procedural-noise', strength: 0.18, scaleMeters: 0.007 },
    roughness: { minimum: 0.28, maximum: 0.62, variationScaleMeters: 0.06, wetness: 0.1 },
    pattern: { kind: 'isotropic' },
    weathering: { surfaceDirt: { amount: 0.15, scaleMeters: 0.04 } },
    metallic: 0.8,
    metadata: { generator: 'videoer.projecting-canopy-materials.v1' },
  }),
};

const canopyFlashing: GeometryMaterial = {
  id: 'canopy-flashing',
  baseColor: [0.12, 0.13, 0.135, 1],
  roughness: 0.38,
  metallic: 0.72,
  emission: [0, 0, 0],
  emissionStrength: 0,
};

export function createProjectingSupportedCanopy(
  options: ProjectingCanopyOptions = {},
): GeometryAsset {
  const span = options.spanMeters ?? canonicalProjectingCanopy.spanMeters;
  const projection = options.projectionMeters ?? canonicalProjectingCanopy.projectionMeters;
  const fall = options.roofFallMeters ?? canonicalProjectingCanopy.roofFallMeters;
  const bracketCount = options.bracketCount ?? canonicalProjectingCanopy.bracketCount;
  if (span < 1.5 || span > 10)
    throw new Error('Projecting-canopy span must be between 1.5 and 10 metres');
  if (projection < 0.55 || projection > 2)
    throw new Error('Projecting-canopy projection must be between 0.55 and 2 metres');
  if (fall < 0.06 || fall > projection * 0.5)
    throw new Error('Projecting-canopy roof fall is outside the supported range');
  if (!Number.isInteger(bracketCount) || bracketCount < 2 || bracketCount > 8)
    throw new Error('Projecting-canopy bracket count must be an integer between 2 and 8');
  const halfSpan = span * 0.5;
  const frontZ = -projection;
  const backUpperY = 0.05;
  const frontUpperY = backUpperY - fall;
  const parts: MeshPart[] = [
    extrudedConvexPolygonPart({
      minimumX: -halfSpan,
      maximumX: halfSpan,
      crossSectionYZ: [
        [-0.12, -0.02],
        [backUpperY, -0.02],
        [frontUpperY, frontZ],
        [frontUpperY - 0.1, frontZ],
      ],
      bone: 0,
      materialId: 'canopy-timber',
    }),
    extrudedConvexPolygonPart({
      minimumX: -halfSpan - 0.045,
      maximumX: halfSpan + 0.045,
      crossSectionYZ: [
        [backUpperY, -0.035],
        [backUpperY + 0.038, -0.035],
        [frontUpperY + 0.038, frontZ - 0.035],
        [frontUpperY, frontZ - 0.035],
      ],
      bone: 0,
      materialId: 'canopy-slate',
    }),
    boxPart(
      [-halfSpan - 0.07, frontUpperY - 0.16, frontZ - 0.065],
      [halfSpan + 0.07, frontUpperY + 0.035, frontZ + 0.035],
      0,
      'canopy-timber',
    ),
    boxPart([-halfSpan - 0.06, 0.01, -0.055], [halfSpan + 0.06, 0.15, 0.018], 0, 'canopy-flashing'),
  ];

  // Physical staggered slate inventory sits above the continuous weathering
  // layer. At medium distance the overlap and front edges remain readable in
  // silhouette rather than relying on a shader to imply construction.
  const roofRows = 4;
  const roofColumns = 12;
  const tileWidth = span / roofColumns;
  let roofTileCount = 0;
  for (let row = 0; row < roofRows; row++) {
    const backT = row / roofRows;
    const frontT = Math.min(1.035, (row + 1.16) / roofRows);
    const backZ = -0.04 - projection * backT;
    const frontTileZ = -0.04 - projection * frontT;
    const backY = backUpperY + 0.043 - fall * backT + row * 0.0015;
    const frontY = backUpperY + 0.043 - fall * frontT + row * 0.0015;
    const stagger = row % 2 ? tileWidth * 0.5 : 0;
    for (let column = -1; column <= roofColumns; column++) {
      const rawMinimumX = -halfSpan + column * tileWidth + stagger + 0.008;
      const rawMaximumX = rawMinimumX + tileWidth - 0.016;
      const minimumX = Math.max(-halfSpan - 0.04, rawMinimumX);
      const maximumX = Math.min(halfSpan + 0.04, rawMaximumX);
      if (maximumX - minimumX < 0.08) continue;
      parts.push(
        extrudedConvexPolygonPart({
          minimumX,
          maximumX,
          crossSectionYZ: [
            [backY, backZ],
            [backY + 0.012, backZ],
            [frontY + 0.012, frontTileZ],
            [frontY, frontTileZ],
          ],
          bone: 0,
          materialId: 'canopy-slate',
        }),
      );
      roofTileCount++;
    }
  }

  // Narrow cross-facade boards give the soffit real assembly seams and catch
  // glancing light without adding a fake texture-only construction claim.
  const slatCount = 7;
  for (let index = 0; index < slatCount; index++) {
    const t0 = (index + 0.08) / slatCount;
    const t1 = (index + 0.83) / slatCount;
    const z0 = -0.03 - projection * t0;
    const z1 = -0.03 - projection * Math.min(0.98, t1);
    const upper0 = -0.12 - fall * t0;
    const upper1 = -0.12 - fall * Math.min(0.98, t1);
    parts.push(
      extrudedConvexPolygonPart({
        minimumX: -halfSpan + 0.04,
        maximumX: halfSpan - 0.04,
        crossSectionYZ: [
          [upper0 - 0.028, z0],
          [upper0, z0],
          [upper1, z1],
          [upper1 - 0.028, z1],
        ],
        bone: 0,
        materialId: 'canopy-timber',
      }),
    );
  }

  const bracketXs = Array.from(
    { length: bracketCount },
    (_, index) => -halfSpan + 0.34 + ((span - 0.68) * index) / Math.max(1, bracketCount - 1),
  );
  for (const x of bracketXs) {
    parts.push(
      boxPart([x - 0.045, -0.72, -0.035], [x + 0.045, -0.08, 0.015], 0, 'canopy-iron'),
      sweptTubePart({
        points: [
          [x, -0.68, -0.035],
          [x, -0.52, -0.3],
          [x, -0.34, -0.62],
          [x, frontUpperY - 0.07, frontZ + 0.03],
        ],
        radius: 0.024,
        bone: 0,
        materialId: 'canopy-iron',
        radialSegments: 14,
        referenceAxis: [1, 0, 0],
      }),
      sweptTubePart({
        points: [
          [x, -0.17, -0.035],
          [x, -0.2, -0.36],
          [x, -0.23, -0.68],
          [x, frontUpperY - 0.04, frontZ + 0.03],
        ],
        radius: 0.016,
        bone: 0,
        materialId: 'canopy-iron',
        radialSegments: 12,
        referenceAxis: [1, 0, 0],
      }),
    );
  }
  const geometry = mergeMeshParts(
    'prop.projecting-supported-canopy',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.projecting-supported-canopy.v1',
      intendedShotDistance: ['background', 'medium'],
      hostContract: {
        kind: 'vertical-facade-canopy-mount',
        facadePlaneZ: 0,
        requiredMountHeightMeters: { minimum: 2.6, maximum: 5.5 },
        requiredClearWallSpanMeters: span + 0.16,
        requiredClearanceVolumeMeters: {
          minimum: [-halfSpan - 0.12, -0.78, frontZ - 0.1],
          maximum: [halfSpan + 0.12, 0.2, 0.08],
        },
      },
      roofDrainage: {
        kind: 'single-fall-projecting-roof',
        fallMeters: fall,
        runMeters: projection,
        gradient: fall / projection,
        dischargeEdge: 'front',
        direction: [0, -fall / projection, -1],
      },
      construction: {
        layeredRoof: true,
        covering: 'slate',
        structuralDeck: 'timber',
        flashing: 'metal',
        soffitSlatCount: slatCount,
        roofTileCount,
        roofTileRows: roofRows,
        bracketCount,
      },
      parameters: { span, projection, fall, bracketCount },
    },
  );
  geometry.materials = [canopyTimber, canopySlate, canopyIron, canopyFlashing];
  geometry.attachments = {
    'wall-mount-left': { position: [-halfSpan, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'wall-mount-centre': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'wall-mount-right': { position: [halfSpan, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'front-edge-left': {
      position: [-halfSpan, frontUpperY, frontZ],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'front-edge-right': {
      position: [halfSpan, frontUpperY, frontZ],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'rainwater-mount-left': {
      position: [-halfSpan, frontUpperY - 0.04, frontZ - 0.045],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'rainwater-mount-right': {
      position: [halfSpan, frontUpperY - 0.04, frontZ - 0.045],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'underside-practical-left': {
      position: [-span * 0.25, -0.2, -projection * 0.5],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'underside-practical-right': {
      position: [span * 0.25, -0.2, -projection * 0.5],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'canopy-focus': { position: [0, -0.12, -projection * 0.52], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}
