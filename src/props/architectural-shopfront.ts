import { z } from 'zod';
import { insetWindowParts } from '../environments/architectural-modules.js';
import type { GeometryMaterial } from '../geometry/model.js';
import { boxPart, mergeMeshParts } from '../geometry/primitives.js';
import { createOldCitySurfacePresets } from '../materials/old-city.js';
import { surfaceMaterialSchema } from '../materials/model.js';

export const architecturalShopfrontDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
  openingWidthMeters: z.number().min(1.8).max(8),
  openingHeightMeters: z.number().min(1.8).max(4.5),
  wallThicknessMeters: z.number().min(0.18).max(0.6),
  mullionCount: z.number().int().min(1).max(8),
  stallRiserMeters: z.number().min(0.18).max(1.2),
  interiorDepthMeters: z.number().min(1).max(12),
  finishStyle: z.enum(['historic-timber', 'contemporary-metal']).default('historic-timber'),
});

export type ArchitecturalShopfrontDefinition = z.infer<
  typeof architecturalShopfrontDefinitionSchema
>;
export type ArchitecturalShopfrontDefinitionInput = z.input<
  typeof architecturalShopfrontDefinitionSchema
>;

const material = (
  id: string,
  color: [number, number, number, number],
  roughness: number,
  metallic = 0,
): GeometryMaterial => ({
  id,
  baseColor: color,
  roughness,
  metallic,
  emission: [0, 0, 0],
  emissionStrength: 0,
});

/**
 * Compiles a shopfront for one declared opening contract. Dimensions are used
 * during construction; scene transforms must remain unit scale.
 */
export function createArchitecturalShopfront(input: ArchitecturalShopfrontDefinitionInput) {
  const definition = architecturalShopfrontDefinitionSchema.parse(input);
  const halfWidth = definition.openingWidthMeters * 0.5;
  const frameWidth = Math.min(0.11, definition.openingWidthMeters * 0.035);
  const glassMinimumY = definition.stallRiserMeters;
  const parts = insetWindowParts({
    minimumX: -halfWidth,
    maximumX: halfWidth,
    minimumY: glassMinimumY,
    maximumY: definition.openingHeightMeters,
    facadeFrontZ: 0,
    facadeBackZ: definition.wallThicknessMeters,
    frameMaterialId: 'shopfront-frame',
    glassMaterialId: 'shopfront-glass',
    interiorMaterialId: 'shopfront-interior',
    glazingThicknessMeters: 0.01,
    mullions: 'none',
    includeInteriorBacking: false,
  });
  parts.push(
    boxPart(
      [-halfWidth, 0, -0.055],
      [halfWidth, definition.stallRiserMeters, definition.wallThicknessMeters + 0.02],
      0,
      'shopfront-riser',
    ),
    boxPart(
      [-halfWidth - frameWidth, definition.openingHeightMeters, -0.09],
      [halfWidth + frameWidth, definition.openingHeightMeters + 0.16, definition.wallThicknessMeters],
      0,
      'shopfront-lintel',
    ),
  );
  for (let index = 1; index <= definition.mullionCount; index++) {
    const x = -halfWidth + (definition.openingWidthMeters * index) / (definition.mullionCount + 1);
    parts.push(
      boxPart(
        [x - frameWidth * 0.45, glassMinimumY, -0.055],
        [x + frameWidth * 0.45, definition.openingHeightMeters, 0.11],
        0,
        'shopfront-frame',
      ),
    );
  }
  const geometry = mergeMeshParts(
    definition.id,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.architectural-shopfront.v1',
      hostContract: {
        kind: 'exact-rectangular-shopfront-opening',
        openingWidthMeters: definition.openingWidthMeters,
        openingHeightMeters: definition.openingHeightMeters,
        wallThicknessMeters: definition.wallThicknessMeters,
        scalingPermitted: false,
      },
      construction: ['deep-reveals', 'projecting-sill', 'lintel', 'stall-riser', 'glazing', 'mullions'],
    },
  );
  const surfaces = new Map(
    createOldCitySurfacePresets().map((preset) => [preset.id, preset.material]),
  );
  const sourceGlazing = surfaces.get('old-window-glazing')!;
  const displayGlazing = surfaceMaterialSchema.parse({
    ...structuredClone(sourceGlazing),
    id: 'material.clear-architectural-shopfront-glazing',
    roughness: { ...sourceGlazing.roughness, minimum: 0.008, maximum: 0.028 },
    normal: { ...sourceGlazing.normal, strength: 0.018 },
    pattern: {
      ...sourceGlazing.pattern,
      transmission: 0.985,
      dirtAmount: 0.018,
    },
    metadata: {
      ...sourceGlazing.metadata,
      generator: 'videoer.clear-architectural-shopfront-glazing.v1',
      parentMaterial: sourceGlazing.id,
    },
  });
  geometry.materials = [
    definition.finishStyle === 'historic-timber'
      ? { ...material('shopfront-frame', [0.12, 0.035, 0.012, 1], 0.58), surface: surfaces.get('weathered-wood') }
      : material('shopfront-frame', [0.035, 0.048, 0.06, 1], 0.3, 0.72),
    { ...material('shopfront-glass', [0.88, 0.94, 0.96, 1], 0.025), surface: displayGlazing },
    definition.finishStyle === 'historic-timber'
      ? { ...material('shopfront-riser', [0.085, 0.022, 0.008, 1], 0.66), surface: surfaces.get('weathered-wood') }
      : material('shopfront-riser', [0.045, 0.055, 0.065, 1], 0.34, 0.66),
    definition.finishStyle === 'historic-timber'
      ? material('shopfront-lintel', [0.15, 0.11, 0.075, 1], 0.7)
      : material('shopfront-lintel', [0.11, 0.12, 0.13, 1], 0.42, 0.48),
  ];
  geometry.attachments = {
    'wall-mount': { position: [0, 0, 0], rotation: [0, 0, 0], bone: 'root' },
    'interior-depth-near': { position: [0, definition.stallRiserMeters, definition.wallThicknessMeters + 0.8], rotation: [0, 0, 0], bone: 'root' },
    'interior-depth-far': { position: [0, definition.stallRiserMeters, Math.min(definition.interiorDepthMeters, definition.wallThicknessMeters + 2.8)], rotation: [0, 0, 0], bone: 'root' },
    'display-focus': { position: [0, definition.openingHeightMeters * 0.55, definition.wallThicknessMeters + 0.9], rotation: [0, 0, 0], bone: 'root' },
  };
  return geometry;
}
