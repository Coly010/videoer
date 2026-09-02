import { createHash } from 'node:crypto';
import { z } from 'zod';
import { boxPart, extrudedPolygonAlongZPart, type MeshPart } from '../geometry/primitives.js';

const openingSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: z.enum(['door', 'window', 'shopfront']),
  minimumX: z.number().finite(),
  maximumX: z.number().finite(),
  minimumY: z.number().nonnegative(),
  maximumY: z.number().positive(),
});

export const facadeConstructionDetailDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
    seed: z.number().int(),
    style: z.enum(['historic-masonry', 'contemporary-plaster']),
    minimumX: z.number().finite(),
    maximumX: z.number().finite(),
    totalHeightMeters: z.number().positive(),
    facadeExteriorZ: z.number().finite(),
    wearReceiverFrontZ: z.number().finite().optional(),
    openings: z.array(openingSchema).min(1),
    trimMaterialId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    wearReceiverMaterialId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    surfaceRepairs: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]*$/),
          polygonXY: z
            .array(z.tuple([z.number().finite(), z.number().finite()]))
            .min(3)
            .max(12),
          intensity: z.number().positive().max(1),
        }),
      )
      .default([]),
  })
  .superRefine((definition, context) => {
    const ids = new Set<string>();
    for (const [index, repair] of definition.surfaceRepairs.entries()) {
      if (ids.has(repair.id))
        context.addIssue({
          code: 'custom',
          path: ['surfaceRepairs', index, 'id'],
          message: 'duplicate repair id',
        });
      ids.add(repair.id);
      const minimumX = Math.min(...repair.polygonXY.map((point) => point[0]));
      const maximumX = Math.max(...repair.polygonXY.map((point) => point[0]));
      const minimumY = Math.min(...repair.polygonXY.map((point) => point[1]));
      const maximumY = Math.max(...repair.polygonXY.map((point) => point[1]));
      if (
        minimumX < definition.minimumX ||
        maximumX > definition.maximumX ||
        minimumY < 0 ||
        maximumY > definition.totalHeightMeters
      )
        context.addIssue({
          code: 'custom',
          path: ['surfaceRepairs', index, 'polygonXY'],
          message: 'repair polygon must remain within the facade bounds',
        });
      if (
        definition.openings.some(
          (opening) =>
            minimumX < opening.maximumX &&
            maximumX > opening.minimumX &&
            minimumY < opening.maximumY &&
            maximumY > opening.minimumY,
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['surfaceRepairs', index, 'polygonXY'],
          message: 'repair polygon bounding box must not overlap an aperture',
        });
    }
  });

export type FacadeConstructionDetailDefinitionInput = z.input<
  typeof facadeConstructionDetailDefinitionSchema
>;

export interface FacadeDirtReceiverZone {
  id: string;
  role:
    'lower-damp' | 'opening-runoff' | 'corner-weathering' | 'parapet-runoff' | 'repair-influence';
  minimum: [number, number, number];
  maximum: [number, number, number];
  intensity: number;
  polygonXY?: Array<[number, number]>;
}

export interface FacadeConstructionDetailReport {
  definitionId: string;
  deterministicSha256: string;
  style: 'historic-masonry' | 'contemporary-plaster';
  physicalDetailPartCount: number;
  openingHeadCount: number;
  revealBandCount: number;
  cornerTreatmentCount: number;
  horizontalBandCount: number;
  repairPatchCount: number;
  dirtReceiverZones: FacadeDirtReceiverZone[];
}

function receiverZones(
  definition: z.infer<typeof facadeConstructionDetailDefinitionSchema>,
): FacadeDirtReceiverZone[] {
  const z = definition.facadeExteriorZ - 0.012;
  const zones: FacadeDirtReceiverZone[] = [
    {
      id: 'lower-damp-zone',
      role: 'lower-damp',
      minimum: [definition.minimumX, 0, z],
      maximum: [definition.maximumX, 0.72, z],
      intensity: definition.style === 'historic-masonry' ? 0.78 : 0.38,
    },
    {
      id: 'left-corner-weathering',
      role: 'corner-weathering',
      minimum: [definition.minimumX, 0, z],
      maximum: [definition.minimumX + 0.34, definition.totalHeightMeters, z],
      intensity: 0.45,
    },
    {
      id: 'right-corner-weathering',
      role: 'corner-weathering',
      minimum: [definition.maximumX - 0.34, 0, z],
      maximum: [definition.maximumX, definition.totalHeightMeters, z],
      intensity: 0.45,
    },
  ];
  for (const opening of definition.openings) {
    zones.push({
      id: `runoff-${opening.id}`,
      role: 'opening-runoff',
      minimum: [opening.minimumX - 0.08, Math.max(0, opening.minimumY - 0.82), z],
      maximum: [opening.maximumX + 0.08, opening.minimumY, z],
      intensity: opening.kind === 'shopfront' ? 0.28 : 0.52,
    });
  }
  if (definition.style === 'contemporary-plaster')
    zones.push({
      id: 'parapet-runoff-zone',
      role: 'parapet-runoff',
      minimum: [definition.minimumX, definition.totalHeightMeters - 0.8, z],
      maximum: [definition.maximumX, definition.totalHeightMeters, z],
      intensity: 0.32,
    });
  for (const repair of definition.surfaceRepairs) {
    const minimumX = Math.min(...repair.polygonXY.map((point) => point[0]));
    const maximumX = Math.max(...repair.polygonXY.map((point) => point[0]));
    const minimumY = Math.min(...repair.polygonXY.map((point) => point[1]));
    const maximumY = Math.max(...repair.polygonXY.map((point) => point[1]));
    zones.push({
      id: `repair-${repair.id}`,
      role: 'repair-influence',
      minimum: [minimumX, minimumY, z],
      maximum: [maximumX, maximumY, z],
      intensity: repair.intensity,
      polygonXY: repair.polygonXY,
    });
  }
  return zones;
}

export function compileFacadeConstructionDetail(input: FacadeConstructionDetailDefinitionInput): {
  parts: MeshPart[];
  report: FacadeConstructionDetailReport;
} {
  const definition = facadeConstructionDetailDefinitionSchema.parse(input);
  const parts: MeshPart[] = [];
  const front = definition.facadeExteriorZ - 0.075;
  const back = definition.facadeExteriorZ - 0.008;
  let openingHeadCount = 0;
  let revealBandCount = 0;
  let cornerTreatmentCount = 0;
  let horizontalBandCount = 0;
  let repairPatchCount = 0;

  if (definition.style === 'historic-masonry') {
    const quoinHeight = 0.38;
    for (let y = 0; y < definition.totalHeightMeters - 0.02; y += quoinHeight) {
      const inset = Math.floor(y / quoinHeight) % 2 === 0 ? 0 : 0.055;
      const height = Math.min(quoinHeight - 0.018, definition.totalHeightMeters - y);
      parts.push(
        boxPart(
          [definition.minimumX - 0.025, y, front - inset * 0.18],
          [definition.minimumX + 0.31 - inset, y + height, back],
          0,
          definition.trimMaterialId,
        ),
        boxPart(
          [definition.maximumX - 0.31 + inset, y, front - inset * 0.18],
          [definition.maximumX + 0.025, y + height, back],
          0,
          definition.trimMaterialId,
        ),
      );
      cornerTreatmentCount += 2;
    }
    parts.push(
      boxPart(
        [definition.minimumX - 0.025, 3.08, front - 0.025],
        [definition.maximumX + 0.025, 3.23, back],
        0,
        definition.trimMaterialId,
      ),
    );
    horizontalBandCount += 1;
    for (const opening of definition.openings) {
      const overhang = opening.kind === 'shopfront' ? 0.14 : 0.1;
      parts.push(
        boxPart(
          [opening.minimumX - overhang, opening.maximumY + 0.035, front - 0.018],
          [opening.maximumX + overhang, opening.maximumY + 0.16, back],
          0,
          definition.trimMaterialId,
        ),
      );
      openingHeadCount += 1;
    }
  } else {
    const bandDepth = 0.048;
    parts.push(
      boxPart(
        [definition.minimumX - 0.04, definition.totalHeightMeters - 0.22, front],
        [definition.maximumX + 0.04, definition.totalHeightMeters - 0.08, back],
        0,
        definition.trimMaterialId,
      ),
      boxPart(
        [definition.minimumX, 3.4, front + 0.012],
        [definition.maximumX, 3.46, back],
        0,
        definition.trimMaterialId,
      ),
    );
    horizontalBandCount += 2;
    for (const x of [definition.minimumX + 0.055, definition.maximumX - 0.075]) {
      parts.push(
        boxPart(
          [x - 0.022, 0, front],
          [x + 0.022, definition.totalHeightMeters, back],
          0,
          definition.trimMaterialId,
        ),
      );
      cornerTreatmentCount += 1;
    }
    for (const opening of definition.openings) {
      parts.push(
        boxPart(
          [opening.minimumX - bandDepth, opening.minimumY - bandDepth, front],
          [opening.minimumX, opening.maximumY + bandDepth, back],
          0,
          definition.trimMaterialId,
        ),
        boxPart(
          [opening.maximumX, opening.minimumY - bandDepth, front],
          [opening.maximumX + bandDepth, opening.maximumY + bandDepth, back],
          0,
          definition.trimMaterialId,
        ),
        boxPart(
          [opening.minimumX, opening.maximumY, front],
          [opening.maximumX, opening.maximumY + bandDepth, back],
          0,
          definition.trimMaterialId,
        ),
      );
      revealBandCount += 3;
    }
  }

  const wearReceiverFrontZ = definition.wearReceiverFrontZ ?? definition.facadeExteriorZ;
  for (const repair of definition.surfaceRepairs) {
    parts.push(
      extrudedPolygonAlongZPart(
        repair.polygonXY,
        wearReceiverFrontZ - 0.004,
        wearReceiverFrontZ - 0.001,
        0,
        definition.wearReceiverMaterialId,
      ),
    );
    repairPatchCount += 1;
  }

  const dirtReceiverZones = receiverZones(definition);
  const reportWithoutHash = {
    definitionId: definition.id,
    style: definition.style,
    physicalDetailPartCount: parts.length,
    openingHeadCount,
    revealBandCount,
    cornerTreatmentCount,
    horizontalBandCount,
    repairPatchCount,
    dirtReceiverZones,
  };
  return {
    parts,
    report: {
      ...reportWithoutHash,
      deterministicSha256: createHash('sha256')
        .update(JSON.stringify({ definition, parts, dirtReceiverZones }))
        .digest('hex'),
    },
  };
}
