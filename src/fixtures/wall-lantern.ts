import type { GeometryAsset, GeometryMaterial } from '../geometry/model.js';
import {
  boxPart,
  capsuleBetween,
  ellipsoidBetween,
  gableRoofPart,
  mergeMeshParts,
  type MeshPart,
} from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { surfaceMaterialSchema } from '../materials/model.js';
import { practicalFixtureSchema, type PracticalFixture } from './model.js';

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

function ironCapsule(
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
) {
  const part = capsuleBetween(start, end, radius, radius, 0, 0, 3, 12);
  part.materialId = 'aged-iron';
  return part;
}

export function createOldCityWallLanternGeometry(): GeometryAsset {
  const parts: MeshPart[] = [
    // Wall plate and a triangulated bracket provide a believable load path.
    boxPart([-0.115, -0.14, -0.026], [0.115, 0.14, 0.014], 0, 'aged-iron'),
    ironCapsule([0, 0.035, -0.025], [0, 0.035, -0.36], 0.018),
    ironCapsule([0, -0.14, -0.018], [0, 0.03, -0.285], 0.014),
    ironCapsule([0, 0.035, -0.36], [0, -0.105, -0.405], 0.014),
    // Four independent 8 mm panes make transmission and glancing edges real.
    boxPart([-0.13, -0.51, -0.628], [0.13, -0.2, -0.62], 0, 'lantern-glass'),
    boxPart([-0.13, -0.51, -0.34], [0.13, -0.2, -0.332], 0, 'lantern-glass'),
    boxPart([-0.138, -0.51, -0.62], [-0.13, -0.2, -0.34], 0, 'lantern-glass'),
    boxPart([0.13, -0.51, -0.62], [0.138, -0.2, -0.34], 0, 'lantern-glass'),
    boxPart([-0.17, -0.56, -0.66], [0.17, -0.51, -0.3], 0, 'aged-iron'),
    boxPart([-0.17, -0.2, -0.66], [0.17, -0.15, -0.3], 0, 'aged-iron'),
    gableRoofPart([-0.185, -0.15, -0.675], [0.185, -0.055, -0.285], 'z', 0, 'aged-iron'),
    ironCapsule([0, -0.055, -0.48], [0, 0.005, -0.48], 0.015),
    ironCapsule([0, -0.56, -0.48], [0, -0.69, -0.48], 0.014),
  ];
  for (const x of [-0.145, 0.145])
    for (const z of [-0.635, -0.325]) parts.push(ironCapsule([x, -0.51, z], [x, -0.2, z], 0.011));
  // A small candle and flame provide a readable source without turning every
  // transmissive pane into a large clipped reflection of one bright volume.
  parts.push(boxPart([-0.018, -0.51, -0.498], [0.018, -0.405, -0.462], 0, 'candle-wax'));
  const flame = ellipsoidBetween(
    [0, -0.402, -0.48],
    [0, -0.348, -0.48],
    0.0055,
    0.0035,
    0,
    0,
    9,
    16,
  );
  flame.materialId = 'warm-flame';
  parts.push(flame);

  const geometry = mergeMeshParts(
    'prop.old-city-wall-lantern',
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.portable-wall-lantern.v5',
      propClass: 'portable-practical-fixture',
      fixtureDefinition: 'fixture.json',
      physicalDimensionsMeters: [0.37, 0.835, 0.675],
      mountingConvention: 'local-origin-at-wall-plate-centre-facing-negative-z',
    },
  );
  const architecturalGlazing = createOldCitySurfacePresets().find(
    (preset) => preset.id === 'old-window-glazing',
  )!.material;
  const glazing = surfaceMaterialSchema.parse({
    ...structuredClone(architecturalGlazing),
    id: 'material.clear-lantern-glazing',
    baseColor: {
      ...architecturalGlazing.baseColor,
      colors: [
        [0.9, 0.95, 0.96, 1],
        [0.98, 0.99, 0.98, 1],
        [0.82, 0.9, 0.92, 1],
      ],
    },
    normal: { ...architecturalGlazing.normal, strength: 0.025 },
    roughness: { ...architecturalGlazing.roughness, minimum: 0.018, maximum: 0.065 },
    pattern: {
      ...architecturalGlazing.pattern,
      transmission: 0.98,
      dirtAmount: 0.025,
    },
    metadata: {
      ...architecturalGlazing.metadata,
      generator: 'videoer.clear-lantern-glazing.v1',
      parentMaterial: architecturalGlazing.id,
    },
  });
  geometry.materials = [
    material('aged-iron', [0.045, 0.052, 0.06, 1], 0.4, 0.68),
    {
      ...material('lantern-glass', [0.72, 0.82, 0.84, 1], 0.08),
      surface: glazing,
    },
    {
      ...material('candle-wax', [0.58, 0.27, 0.08, 1], 0.58),
    },
    {
      ...material('warm-flame', [1, 0.34, 0.055, 1], 0.28),
      emission: [1, 0.16, 0.018],
      emissionStrength: 0.65,
    },
  ];
  geometry.attachments = {
    'wall-mount': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'light-origin': { position: [0, -0.37, -0.48], rotation: [0, 0, 0], bone: 'root' },
    'fixture-focus': { position: [0, -0.36, -0.48], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}

export function createOldCityWallLanternFixture(): PracticalFixture {
  return practicalFixtureSchema.parse({
    schemaVersion: 1,
    id: 'fixture.old-city-wall-lantern',
    geometryAssetId: 'prop.old-city-wall-lantern',
    mountAttachmentId: 'wall-mount',
    emitters: [
      {
        id: 'warm-lantern-source',
        type: 'point',
        position: [0, -0.37, -0.48],
        color: [1, 0.34, 0.11],
        powerWatts: 52,
        // Renderer adapters interpret this as emitter radius. Match the
        // visible flame instead of creating an 170 mm glossy source image.
        sizeMeters: 0.006,
        visibleSourceMaterialId: 'warm-flame',
        temporalModulation: {
          kind: 'seeded-flicker',
          seed: 2417,
          frequencyHz: 7.2,
          intensityMinimumMultiplier: 0.78,
          intensityMaximumMultiplier: 1.12,
          colorTemperatureMinimumKelvin: 1780,
          colorTemperatureMaximumKelvin: 2050,
        },
      },
    ],
    metadata: {
      generator: 'videoer.portable-wall-lantern.v5',
      photometricIntent: 'warm-local-practical-with-inverse-square-falloff',
      compatibleMount: 'vertical-wall',
    },
  });
}
