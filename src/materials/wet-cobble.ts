import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { surfaceMaterialSchema } from './model.js';

export function createWetCobbleSurfaceMaterial() {
  return surfaceMaterialSchema.parse({
    schemaVersion: 1,
    id: 'material.wet-old-city-cobble',
    shadingModel: 'metallic-roughness',
    baseColor: {
      kind: 'procedural-palette',
      colors: [
        [0.042, 0.052, 0.067, 1],
        [0.07, 0.082, 0.095, 1],
        [0.032, 0.043, 0.055, 1],
      ],
      scaleMeters: 0.45,
      seed: 1847,
    },
    normal: { kind: 'procedural-noise', strength: 0.34, scaleMeters: 0.055 },
    roughness: { minimum: 0.12, maximum: 0.3, variationScaleMeters: 0.45, wetness: 0.86 },
    metallic: 0.045,
    metadata: {
      generator: 'videoer.wet-cobble-material.v1',
      intendedSurfaces: ['street', 'courtyard', 'rain-darkened-stone'],
    },
  });
}

export function wetCobbleGeometryMaterials(): GeometryMaterial[] {
  const material = createWetCobbleSurfaceMaterial();
  return material.baseColor.colors.map((baseColor, index) => ({
    id: `wet-cobble-${index + 1}`,
    baseColor,
    roughness:
      material.roughness.minimum +
      (material.roughness.maximum - material.roughness.minimum) *
        (index / Math.max(1, material.baseColor.colors.length - 1)),
    metallic: material.metallic,
    emission: [0, 0, 0],
    emissionStrength: 0,
    surface: material,
  }));
}

export function createWetCobbleSwatch(): GeometryAsset {
  const parts = [];
  const colors = wetCobbleGeometryMaterials();
  for (let row = 0; row < 7; row++)
    for (let column = 0; column < 7; column++) {
      const offset = row % 2 ? 0.22 : 0;
      const x = (column - 3) * 0.45 + offset;
      const z = (row - 3) * 0.5;
      const variation = ((row * 17 + column * 31 + 1847) % 11) / 11;
      parts.push(
        boxPart(
          [x - 0.2, -0.035, z - 0.225],
          [x + 0.2, variation * 0.018, z + 0.225],
          0,
          colors[(row * 7 + column) % colors.length]!.id,
        ),
      );
    }
  const geometry = mergeMeshParts(
    'material-swatch.wet-old-city-cobble',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.wet-cobble-swatch.v1',
      material: 'material.wet-old-city-cobble',
      materialClass: 'surface-swatch',
      deterministicSeed: 1847,
    },
  );
  geometry.materials = colors;
  return geometry;
}
