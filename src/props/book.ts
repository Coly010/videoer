import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';

export function createSignificantBook(): GeometryAsset {
  const skeleton: GeometryAsset['skeleton'] = [
    { id: 'root', restPosition: [0, 0, 0], constraints: {} },
    {
      id: 'left-cover',
      parent: 'root',
      restPosition: [0, 0, 0],
      constraints: { rotationMin: [0, -0.15, 0], rotationMax: [0, 1.4, 0] },
    },
    {
      id: 'right-cover',
      parent: 'root',
      restPosition: [0, 0, 0],
      constraints: { rotationMin: [0, -1.4, 0], rotationMax: [0, 0.15, 0] },
    },
  ];
  const asset = mergeMeshParts(
    'prop.significant-book',
    [
      boxPart([-0.19, -0.14, -0.018], [-0.008, 0.14, 0.018], 1, 'cover'),
      boxPart([0.008, -0.14, -0.018], [0.19, 0.14, 0.018], 2, 'cover'),
      boxPart([-0.175, -0.127, -0.026], [-0.013, 0.127, -0.019], 1, 'pages'),
      boxPart([0.013, -0.127, -0.026], [0.175, 0.127, -0.019], 2, 'pages'),
      boxPart([-0.013, -0.14, -0.03], [0.013, 0.14, 0.03], 0, 'spine'),
    ],
    skeleton,
    {
      generator: 'videoer.significant-book.v1',
      parameters: { width: 0.38, height: 0.28, depth: 0.06 },
      propClass: 'openable-hardback-book',
    },
  );
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
    material('cover', [0.045, 0.075, 0.095, 1], 0.5),
    material('pages', [0.72, 0.62, 0.45, 1], 0.82),
    material('spine', [0.025, 0.04, 0.055, 1], 0.58),
  ];
  asset.attachments = {
    'left-grip': { position: [0.16, -0.05, -0.03], rotation: [0, 0, 0], bone: 'right-cover' },
    'right-grip': { position: [-0.16, -0.05, -0.03], rotation: [0, 0, 0], bone: 'left-cover' },
    'gaze-target': { position: [0, 0.075, -0.035], rotation: [0, 0, 0], bone: 'root' },
    spine: { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
  };
  return asset;
}
