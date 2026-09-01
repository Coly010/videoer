import { boxPart, mergeMeshParts, type MeshPart } from '../geometry/primitives.js';
import { geometryAssetSchema } from '../geometry/model.js';

function frontPlane(): MeshPart {
  return {
    positions: [
      [-0.325, -0.505, -0.031],
      [0.325, -0.505, -0.031],
      [0.325, 0.505, -0.031],
      [-0.325, 0.505, -0.031],
    ],
    normals: [
      [0, 0, -1],
      [0, 0, -1],
      [0, 0, -1],
      [0, 0, -1],
    ],
    uvs: [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    indices: [0, 1, 2, 0, 2, 3],
    skinIndices: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    skinWeights: [
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
    ],
    materialId: 'cover-front',
  };
}

export function createDimensionalCampaignCover() {
  const geometry = mergeMeshParts(
    'prop.rise-of-demons-cover',
    [boxPart([-0.33, -0.51, -0.03], [0.33, 0.51, 0.03], 0, 'cover-body'), frontPlane()],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.dimensional-cover.v1',
      propClass: 'dimensional-campaign-cover',
      frontTexture: 'cover.png',
      textureMaterialId: 'cover-front',
      physicalDimensionsMeters: [0.66, 1.02, 0.06],
    },
  );
  geometry.materials = [
    {
      id: 'cover-body',
      baseColor: [0.018, 0.007, 0.004, 1],
      roughness: 0.48,
      metallic: 0,
      emission: [0, 0, 0],
      emissionStrength: 0,
    },
    {
      id: 'cover-front',
      baseColor: [1, 1, 1, 1],
      roughness: 0.36,
      metallic: 0,
      emission: [0, 0, 0],
      emissionStrength: 0,
    },
  ];
  geometry.attachments = {
    'product-focus': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'camera-three-quarter': {
      position: [-0.0033, 0.0656, -2.4898],
      rotation: [0, 0, 0],
      bone: 'root',
    },
  };
  return geometryAssetSchema.parse(geometry);
}
