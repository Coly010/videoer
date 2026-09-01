import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import {
  boxPart,
  capsuleBetween,
  mergeMeshParts,
  openHalfRoundTroughPart,
  rectangularFrustumPart,
  type MeshPart,
} from '../geometry/primitives.js';
import { surfaceMaterialSchema } from '../materials/model.js';

export interface RainwaterSystemOptions {
  spanMeters?: number;
  eaveHeightMeters?: number;
  downpipeBottomMeters?: number;
  outletSide?: 'left' | 'right';
  facadeZ?: number;
  gutterRadiusMeters?: number;
  pipeRadiusMeters?: number;
}

export const canonicalRainwaterSystem = {
  spanMeters: 4.8,
  eaveHeightMeters: 4.2,
  downpipeBottomMeters: 0.22,
  facadeZ: 0,
  gutterRadiusMeters: 0.115,
  pipeRadiusMeters: 0.044,
} as const;

export const patinatedRainwaterSurface = surfaceMaterialSchema.parse({
  schemaVersion: 1,
  id: 'patinated-copper-rainwater',
  shadingModel: 'metallic-roughness',
  baseColor: {
    kind: 'procedural-palette',
    colors: [
      [0.055, 0.16, 0.14, 1],
      [0.09, 0.27, 0.22, 1],
      [0.19, 0.12, 0.055, 1],
      [0.035, 0.09, 0.08, 1],
    ],
    scaleMeters: 0.18,
    seed: 4117,
  },
  normal: { kind: 'procedural-noise', strength: 0.22, scaleMeters: 0.018 },
  roughness: { minimum: 0.35, maximum: 0.68, variationScaleMeters: 0.09, wetness: 0.18 },
  pattern: { kind: 'isotropic' },
  weathering: {
    verticalStreaks: { amount: 0.2, widthMeters: 0.028, lengthMeters: 0.7 },
    surfaceDirt: { amount: 0.12, scaleMeters: 0.045 },
  },
  metallic: 0.72,
  metadata: {
    representation: 'project-owned-procedural-patinated-metal',
    intendedShotDistance: ['background', 'medium'],
  },
});

function material(): GeometryMaterial {
  return {
    id: 'patinated-rainwater-metal',
    baseColor: [0.07, 0.2, 0.17, 1],
    roughness: 0.52,
    metallic: 0.72,
    emission: [0, 0, 0],
    emissionStrength: 0,
    surface: patinatedRainwaterSurface,
  };
}

function metalCapsule(
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
) {
  const part = capsuleBetween(start, end, radius, radius, 0, 0, 3, 14);
  part.materialId = 'patinated-rainwater-metal';
  return part;
}

export function createArchitecturalRainwaterSystem(
  options: RainwaterSystemOptions = {},
): GeometryAsset {
  const span = options.spanMeters ?? canonicalRainwaterSystem.spanMeters;
  const eaveHeight = options.eaveHeightMeters ?? canonicalRainwaterSystem.eaveHeightMeters;
  const bottom = options.downpipeBottomMeters ?? canonicalRainwaterSystem.downpipeBottomMeters;
  const outletSide = options.outletSide ?? 'right';
  const facadeZ = options.facadeZ ?? canonicalRainwaterSystem.facadeZ;
  const gutterRadius = options.gutterRadiusMeters ?? canonicalRainwaterSystem.gutterRadiusMeters;
  const pipeRadius = options.pipeRadiusMeters ?? canonicalRainwaterSystem.pipeRadiusMeters;
  if (span < 1.2 || span > 12)
    throw new Error('Rainwater-system span must be between 1.2 and 12 metres');
  if (eaveHeight - bottom < 1.5)
    throw new Error('Rainwater-system vertical drop must be at least 1.5 metres');
  if (gutterRadius < 0.07 || gutterRadius > 0.22)
    throw new Error('Rainwater-system gutter radius must be between 0.07 and 0.22 metres');
  if (pipeRadius < 0.025 || pipeRadius > 0.09 || pipeRadius >= gutterRadius)
    throw new Error('Rainwater-system pipe radius is outside the supported range');

  const halfSpan = span * 0.5;
  const gutterCentreZ = facadeZ - gutterRadius - 0.055;
  const outletX = (outletSide === 'left' ? -1 : 1) * (halfSpan - 0.24);
  const pipeZ = facadeZ - 0.115;
  const hopperTop = eaveHeight - gutterRadius * 0.95;
  const pipeTop = eaveHeight - 0.43;
  const parts: MeshPart[] = [
    openHalfRoundTroughPart({
      minimumX: -halfSpan,
      maximumX: halfSpan,
      centreY: eaveHeight,
      centreZ: gutterCentreZ,
      outerRadius: gutterRadius,
      thickness: Math.max(0.006, gutterRadius * 0.065),
      arcSegments: 24,
      bone: 0,
      materialId: 'patinated-rainwater-metal',
    }),
    // A tapered collector makes the gutter-to-pipe transition explicit while
    // retaining a manufacturable, reusable architectural silhouette.
    rectangularFrustumPart(
      outletX,
      (gutterCentreZ + facadeZ - 0.045) * 0.5,
      hopperTop - 0.22,
      hopperTop + 0.04,
      [0.072, 0.064],
      [0.13, 0.13],
      0,
      'patinated-rainwater-metal',
    ),
    boxPart(
      [outletX - 0.075, hopperTop - 0.31, pipeZ - 0.065],
      [outletX + 0.075, hopperTop - 0.17, pipeZ + 0.065],
      0,
      'patinated-rainwater-metal',
    ),
    metalCapsule([outletX, pipeTop, pipeZ], [outletX, bottom + 0.22, pipeZ], pipeRadius),
    metalCapsule(
      [outletX, bottom + 0.22, pipeZ],
      [outletX, bottom + 0.08, pipeZ - 0.19],
      pipeRadius * 1.04,
    ),
    // Rolled lips catch a thin highlight and make the open channel readable at
    // medium distance without filling the aperture.
    metalCapsule(
      [-halfSpan + 0.012, eaveHeight, gutterCentreZ - gutterRadius],
      [halfSpan - 0.012, eaveHeight, gutterCentreZ - gutterRadius],
      Math.max(0.007, gutterRadius * 0.07),
    ),
    metalCapsule(
      [-halfSpan + 0.012, eaveHeight, gutterCentreZ + gutterRadius],
      [halfSpan - 0.012, eaveHeight, gutterCentreZ + gutterRadius],
      Math.max(0.007, gutterRadius * 0.07),
    ),
  ];

  // Open gutter brackets visibly connect the trough to its host rather than
  // leaving a long floating channel. Pipe clips add independent wall support.
  const bracketCount = Math.max(3, Math.ceil(span / 0.85));
  for (let index = 0; index < bracketCount; index++) {
    const x = -halfSpan + 0.2 + ((span - 0.4) * index) / Math.max(1, bracketCount - 1);
    parts.push(
      boxPart(
        [x - 0.012, eaveHeight - gutterRadius - 0.035, facadeZ - 0.075],
        [x + 0.012, eaveHeight + 0.025, facadeZ - 0.035],
        0,
        'patinated-rainwater-metal',
      ),
      metalCapsule(
        [x, eaveHeight - gutterRadius * 0.68, facadeZ - 0.055],
        [x, eaveHeight - gutterRadius * 0.9, gutterCentreZ - gutterRadius * 0.58],
        0.011,
      ),
    );
  }
  for (const y of [bottom + 0.72, (bottom + pipeTop) * 0.52, pipeTop - 0.42]) {
    parts.push(
      boxPart(
        [outletX - 0.095, y - 0.025, facadeZ - 0.045],
        [outletX + 0.095, y + 0.025, facadeZ - 0.015],
        0,
        'patinated-rainwater-metal',
      ),
      metalCapsule(
        [outletX - 0.064, y, facadeZ - 0.05],
        [outletX - 0.064, y, pipeZ - 0.018],
        0.009,
      ),
      metalCapsule(
        [outletX + 0.064, y, facadeZ - 0.05],
        [outletX + 0.064, y, pipeZ - 0.018],
        0.009,
      ),
    );
  }

  const geometry = mergeMeshParts(
    'prop.architectural-rainwater-system',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.architectural-rainwater-system.v1',
      intendedShotDistance: ['background', 'medium'],
      hostContract: {
        kind: 'facade-eave-span',
        facadePlaneZ: facadeZ,
        minimumClearSpanMeters: span,
        eaveHeightMeters: eaveHeight,
        minimumGroundClearanceMeters: bottom,
        exteriorNormal: [0, 0, -1],
        requiresContinuousMountingSurface: true,
      },
      parameters: { span, eaveHeight, bottom, outletSide, gutterRadius, pipeRadius },
      waterPath: {
        gutterOpenTop: true,
        outletSide,
        dischargeDirection: [0, -0.59, -0.81],
      },
    },
  );
  geometry.materials = [material()];
  geometry.attachments = {
    'eave-left': { position: [-halfSpan, eaveHeight, facadeZ], rotation: [0, 0, 0], bone: 'root' },
    'eave-right': { position: [halfSpan, eaveHeight, facadeZ], rotation: [0, 0, 0], bone: 'root' },
    'wall-mount-upper': {
      position: [outletX, pipeTop - 0.42, facadeZ],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'wall-mount-lower': {
      position: [outletX, bottom + 0.72, facadeZ],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'downpipe-outlet': {
      position: [outletX, bottom + 0.08, pipeZ - 0.19],
      rotation: [-0.63, 0, 0],
      bone: 'root',
    },
    'exterior-focus': {
      position: [outletX * 0.35, eaveHeight * 0.55, gutterCentreZ],
      rotation: [0, 0, 0],
      bone: 'root',
    },
  };
  return geometry;
}
