import type { GeometryMaterial } from '../geometry/model.js';
import {
  boxPart,
  ellipsoidBetween,
  mergeMeshParts,
  type MeshPart,
} from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';

function withMaterial(part: MeshPart, materialId: string): MeshPart {
  return { ...part, materialId };
}

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

/**
 * Static, renderer-independent interior-lighting witness. It deliberately
 * contains no skeleton or motion: a lighting rig must be judgeable without
 * inheriting the defects of a character or animation candidate.
 */
export function createInteriorLightingWitness() {
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const parts: MeshPart[] = [
    // Faceted portrait-scale form exposes key/fill ratio, shadow transition,
    // cheek-like curvature, top light, and warm/cool colour contamination.
    withMaterial(
      ellipsoidBetween([0, 1.12, 0], [0, 1.68, 0], 0.26, 0.225, 0, 0, 12, 24),
      'skin-witness',
    ),
    withMaterial(
      ellipsoidBetween([0, 0.58, 0], [0, 1.12, 0], 0.48, 0.27, 0, 0, 9, 20),
      'cloth-witness',
    ),
    // A projecting nose wedge and brow bar make light direction legible; this
    // is a photometric witness, not a proxy character or production face.
    boxPart([-0.17, 1.48, -0.235], [0.17, 1.53, -0.2], 0, 'skin-witness'),
    boxPart([-0.055, 1.3, -0.29], [0.055, 1.48, -0.21], 0, 'skin-witness'),
    // Standard material response row: diffuse grey, glossy dielectric-like
    // ceramic, dark metal, structured wood, and warm mineral plaster.
    withMaterial(
      ellipsoidBetween([-0.72, 0.18, 0], [-0.72, 0.5, 0], 0.16, 0.16, 0, 0, 10, 20),
      'neutral-grey',
    ),
    withMaterial(
      ellipsoidBetween([-0.36, 0.18, 0], [-0.36, 0.5, 0], 0.16, 0.16, 0, 0, 10, 20),
      'glossy-ceramic',
    ),
    withMaterial(
      ellipsoidBetween([0.36, 0.18, 0], [0.36, 0.5, 0], 0.16, 0.16, 0, 0, 10, 20),
      'dark-metal',
    ),
    boxPart([0.58, 0.16, -0.16], [0.88, 0.52, 0.16], 0, 'structured-wood'),
    boxPart([-0.88, 0.04, 0.2], [0.88, 0.14, 0.55], 0, 'warm-plaster'),
  ];
  const geometry = mergeMeshParts(
    'lighting-witness.interior-portrait-materials',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.interior-lighting-witness.v1',
      purpose: 'static-key-fill-rim-and-material-response-verification',
      productionCharacter: false,
      motionDependency: 'none',
      responses: [
        'skin-tone-proxy',
        'matte-cloth',
        'diffuse-grey',
        'gloss',
        'metal',
        'wood',
        'plaster',
      ],
    },
  );
  geometry.materials = [
    material('skin-witness', [0.48, 0.19, 0.105, 1], 0.48),
    material('cloth-witness', [0.055, 0.045, 0.052, 1], 0.86),
    material('neutral-grey', [0.18, 0.18, 0.18, 1], 0.55),
    material('glossy-ceramic', [0.48, 0.5, 0.52, 1], 0.09),
    material('dark-metal', [0.025, 0.03, 0.035, 1], 0.2, 0.92),
    {
      ...material('structured-wood', [0.11, 0.03, 0.009, 1], 0.38),
      surface: surfaces.get('oiled-shelf-wood'),
    },
    {
      ...material('warm-plaster', [0.4, 0.24, 0.13, 1], 0.76),
      surface: surfaces.get('warm-interior-plaster'),
    },
  ];
  return geometry;
}
