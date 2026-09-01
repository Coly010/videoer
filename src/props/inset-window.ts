import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { mergeMeshParts } from '../geometry/primitives.js';
import { insetWindowParts } from '../environments/architectural-modules.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';

const material = (
  id: string,
  baseColor: [number, number, number, number],
  roughness: number,
): GeometryMaterial => ({
  id,
  baseColor,
  roughness,
  metallic: 0,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

export const insetWindowOpening = {
  widthMeters: 1.28,
  heightMeters: 0.96,
  supportedWallThicknessMeters: { minimum: 0.22, maximum: 0.42 },
  canonicalWallThicknessMeters: 0.3,
} as const;

export function createInsetArchitecturalWindow(): GeometryAsset {
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const halfWidth = insetWindowOpening.widthMeters * 0.5;
  const geometry = mergeMeshParts(
    'prop.inset-architectural-window',
    insetWindowParts({
      minimumX: -halfWidth,
      maximumX: halfWidth,
      minimumY: 0,
      maximumY: insetWindowOpening.heightMeters,
      facadeFrontZ: 0,
      facadeBackZ: insetWindowOpening.canonicalWallThicknessMeters,
      frameMaterialId: 'painted-timber-frame',
      glassMaterialId: 'architectural-glass',
      interiorMaterialId: 'dim-interior-witness',
      glazingThicknessMeters: 0.008,
      mullions: 'cross',
      includeInteriorBacking: false,
    }),
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.inset-architectural-window.v1',
      intendedShotDistance: ['background', 'medium'],
      hostContract: {
        kind: 'rectangular-wall-opening',
        cutoutRequired: true,
        openingWidthMeters: insetWindowOpening.widthMeters,
        openingHeightMeters: insetWindowOpening.heightMeters,
        supportedWallThicknessMeters: insetWindowOpening.supportedWallThicknessMeters,
        exteriorNormal: [0, 0, -1],
      },
      glazingThicknessMeters: 0.008,
    },
  );
  geometry.materials = [
    {
      ...material('painted-timber-frame', [0.17, 0.032, 0.012, 1], 0.5),
      surface: surfaces.get('weathered-wood'),
    },
    {
      ...material('architectural-glass', [0.76, 0.84, 0.88, 1], 0.08),
      surface: surfaces.get('old-window-glazing'),
    },
  ];
  geometry.attachments = {
    'wall-mount': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'opening-centre': {
      position: [0, insetWindowOpening.heightMeters * 0.5, 0.15],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'exterior-focus': {
      position: [0, insetWindowOpening.heightMeters * 0.52, -0.08],
      rotation: [0, 0, 0],
      bone: 'root',
    },
    'interior-focus': {
      position: [0, insetWindowOpening.heightMeters * 0.52, 0.38],
      rotation: [0, Math.PI, 0],
      bone: 'root',
    },
    'sill-top': { position: [0, -0.055, 0.02], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}
