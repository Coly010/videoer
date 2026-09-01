import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, capsuleBetween, mergeMeshParts } from '../geometry/primitives.js';

export function createBookshopDoor(): GeometryAsset {
  const skeleton: GeometryAsset['skeleton'] = [
    { id: 'root', restPosition: [0, 0, 0], constraints: {} },
    {
      id: 'door-leaf',
      parent: 'root',
      restPosition: [-0.52, 0, 0],
      constraints: { rotationMin: [0, -Math.PI * 0.55, 0], rotationMax: [0, 0.05, 0] },
    },
    {
      id: 'handle',
      parent: 'door-leaf',
      restPosition: [0.82, 1.02, -0.08],
      constraints: { rotationMin: [-0.55, 0, 0], rotationMax: [0.1, 0, 0] },
    },
  ];
  const parts = [
    boxPart([-0.52, 0.02, -0.055], [0.5, 2.04, 0.055], 1, 'wood'),
    boxPart([-0.39, 1.12, -0.062], [0.37, 1.88, -0.052], 1, 'glass'),
    boxPart([-0.61, 0, -0.12], [-0.53, 2.16, 0.12], 0, 'frame'),
    boxPart([0.51, 0, -0.12], [0.59, 2.16, 0.12], 0, 'frame'),
    boxPart([-0.61, 2.08, -0.12], [0.59, 2.16, 0.12], 0, 'frame'),
    capsuleBetween([0.3, 1.02, -0.12], [0.44, 1.02, -0.12], 0.026, 0.026, 2, 2, 4, 12),
  ];
  parts.at(-1)!.materialId = 'metal';
  const asset = mergeMeshParts('prop.bookshop-door', parts, skeleton, {
    generator: 'videoer.bookshop-door.v1',
    parameters: { height: 2.16, width: 1.2, leafWidth: 1.02 },
    propClass: 'hinged-glazed-door',
  });
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
  asset.materials = [
    material('wood', [0.18, 0.055, 0.025, 1], 0.58),
    material('glass', [0.18, 0.32, 0.38, 0.72], 0.18),
    material('frame', [0.055, 0.025, 0.015, 1], 0.7),
    material('metal', [0.16, 0.12, 0.07, 1], 0.24, 0.72),
  ];
  asset.attachments = {
    hinge: { position: [-0.52, 0, 0], rotation: [0, 0, 0], bone: 'door-leaf' },
    'handle-grip': { position: [0.44, 1.02, -0.12], rotation: [0, 0, 0], bone: 'handle' },
    threshold: { position: [0, 0, -0.16], rotation: [0, 0, 0], bone: 'root' },
    approach: { position: [0.22, 0, -0.72], rotation: [0, 0, 0], bone: 'root' },
  };
  return asset;
}
