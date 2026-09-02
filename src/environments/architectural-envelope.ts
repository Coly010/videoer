import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GeometryAsset, GeometryMaterial, Vec3 } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import {
  boxPart,
  extrudedConvexPolygonPart,
  gableRoofPart,
  mergeMeshParts,
  type MeshPart,
} from '../geometry/primitives.js';
import { wallWithRectangularOpeningsParts, type WallOpening } from './architectural-modules.js';
import {
  compileFacadeConstructionDetail,
  type FacadeConstructionDetailReport,
} from './facade-construction-detail.js';
import {
  applyFacadeSurfaceHistory,
  type FacadeSurfaceHistoryReport,
} from './facade-surface-history.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
const localIdentifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const architecturalEnvelopeMaterialRoleSchema = z.enum([
  'structure',
  'foundation',
  'facade-finish',
  'facade-trim',
  'facade-damp-course',
  'roof',
  'roof-trim',
  'threshold',
  'interior-wall',
  'dark-room',
  'lit-room',
  'occupancy',
]);

export type ArchitecturalEnvelopeMaterialRole = z.infer<
  typeof architecturalEnvelopeMaterialRoleSchema
>;

export const architecturalEnvelopeMaterialTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targets: z
    .array(
      z.object({
        materialId: localIdentifier,
        roles: z
          .array(architecturalEnvelopeMaterialRoleSchema)
          .min(1)
          .refine((roles) => new Set(roles).size === roles.length, 'material roles must be unique'),
      }),
    )
    .min(1)
    .refine(
      (targets) => new Set(targets.map((target) => target.materialId)).size === targets.length,
      'architectural material targets must be unique',
    ),
});

export type ArchitecturalEnvelopeMaterialTargets = z.infer<
  typeof architecturalEnvelopeMaterialTargetsSchema
>;

const openingSchema = z.object({
  id: localIdentifier,
  kind: z.enum(['door', 'window', 'shopfront']),
  widthMeters: z.number().positive(),
  heightMeters: z.number().positive(),
  sillMeters: z.number().nonnegative(),
  module: z.object({ assetId: identifier, version: semver }),
  room: z.object({
    depthMeters: z.number().positive(),
    occupancy: z.enum(['dark', 'lit-empty', 'inhabited']),
  }),
});

const storeySchema = z.object({
  id: localIdentifier,
  heightMeters: z.number().min(2).max(8),
  bays: z
    .array(
      z.object({
        id: localIdentifier,
        widthMeters: z.number().positive(),
        opening: openingSchema.optional(),
      }),
    )
    .min(1),
});

export const architecturalEnvelopeDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    seed: z.number().int(),
    detailTier: z.enum(['background', 'medium']),
    footprint: z.object({
      kind: z.literal('rectangle'),
      minimumX: z.number().finite(),
      maximumX: z.number().finite(),
      frontZ: z.number().finite(),
      depthMeters: z.number().positive(),
    }),
    storeys: z.array(storeySchema).min(1).max(12),
    shell: z.object({
      wallThicknessMeters: z.number().min(0.12).max(1.2),
      foundationHeightMeters: z.number().min(0.05).max(1.5),
      facadeLayers: z
        .array(
          z.object({
            id: localIdentifier,
            role: z.enum(['finish', 'trim', 'damp-course']),
            thicknessMeters: z.number().min(0.002).max(0.12),
            materialId: localIdentifier,
            minimumY: z.number().nonnegative().optional(),
            maximumY: z.number().positive().optional(),
          }),
        )
        .max(6),
      surfaceRepairs: z
        .array(
          z.object({
            id: localIdentifier,
            polygonXY: z
              .array(z.tuple([z.number().finite(), z.number().finite()]))
              .min(3)
              .max(12),
            intensity: z.number().positive().max(1),
          }),
        )
        .default([]),
    }),
    roof: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('flat-parapet'),
        overhangMeters: z.number().min(0).max(1.5),
        parapetHeightMeters: z.number().min(0.1).max(1.5),
        materialId: localIdentifier,
        trimMaterialId: localIdentifier,
      }),
      z.object({
        kind: z.literal('gable'),
        overhangMeters: z.number().min(0).max(1.5),
        riseMeters: z.number().min(0.25).max(8),
        materialId: localIdentifier,
        trimMaterialId: localIdentifier,
      }),
    ]),
    threshold: z.object({
      projectionMeters: z.number().min(0.08).max(2),
      riseMeters: z.number().min(0.02).max(0.5),
      fallDegrees: z.number().min(0).max(12),
      materialId: localIdentifier,
    }),
    anchors: z
      .array(
        z.object({
          id: localIdentifier,
          kind: z.enum([
            'facade-mount',
            'eave-span',
            'opening',
            'approach',
            'dressing-zone',
            'camera-focus',
          ]),
          bayId: localIdentifier.optional(),
          localOffset: vec3.default([0, 0, 0]),
        }),
      )
      .default([]),
    materials: z.object({
      structure: localIdentifier,
      foundation: localIdentifier,
      roof: localIdentifier,
      trim: localIdentifier,
      interior: localIdentifier,
      darkRoom: localIdentifier,
      litRoom: localIdentifier,
      occupancy: localIdentifier,
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((definition, context) => {
    const width = definition.footprint.maximumX - definition.footprint.minimumX;
    if (width <= 0)
      context.addIssue({
        code: 'custom',
        path: ['footprint'],
        message: 'facade width must be positive',
      });
    const ids = new Set<string>();
    const openingIds = new Set<string>();
    for (const [storeyIndex, storey] of definition.storeys.entries()) {
      if (ids.has(storey.id))
        context.addIssue({
          code: 'custom',
          path: ['storeys', storeyIndex, 'id'],
          message: 'duplicate storey id',
        });
      ids.add(storey.id);
      const bayWidth = storey.bays.reduce((sum, bay) => sum + bay.widthMeters, 0);
      if (Math.abs(bayWidth - width) > 1e-6)
        context.addIssue({
          code: 'custom',
          path: ['storeys', storeyIndex, 'bays'],
          message: `bay widths must sum to facade width ${width}`,
        });
      const bayIds = new Set<string>();
      for (const [bayIndex, bay] of storey.bays.entries()) {
        if (bayIds.has(bay.id))
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'id'],
            message: 'duplicate bay id within storey',
          });
        bayIds.add(bay.id);
        const opening = bay.opening;
        if (!opening) continue;
        if (openingIds.has(opening.id))
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'opening', 'id'],
            message: 'duplicate opening id',
          });
        openingIds.add(opening.id);
        if (opening.widthMeters >= bay.widthMeters - 0.12)
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'opening', 'widthMeters'],
            message: 'opening must leave structural jambs',
          });
        if (opening.sillMeters + opening.heightMeters >= storey.heightMeters - 0.08)
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'opening'],
            message: 'opening must leave a structural head',
          });
        if (opening.kind === 'door' && opening.sillMeters !== 0)
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'opening', 'sillMeters'],
            message: 'door sill must be zero',
          });
        if (opening.room.depthMeters <= definition.shell.wallThicknessMeters + 0.25)
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'opening', 'room', 'depthMeters'],
            message: 'room depth must extend materially behind the wall',
          });
        if (opening.room.depthMeters > definition.footprint.depthMeters - 0.1)
          context.addIssue({
            code: 'custom',
            path: ['storeys', storeyIndex, 'bays', bayIndex, 'opening', 'room', 'depthMeters'],
            message: 'room depth exceeds the building footprint',
          });
      }
    }
    const totalLayerThickness = definition.shell.facadeLayers.reduce(
      (sum, layer) => sum + layer.thicknessMeters,
      0,
    );
    if (totalLayerThickness > definition.shell.wallThicknessMeters * 0.75)
      context.addIssue({
        code: 'custom',
        path: ['shell', 'facadeLayers'],
        message: 'facade layers are implausibly thick relative to the structural wall',
      });
    const layerIds = new Set<string>();
    for (const [index, layer] of definition.shell.facadeLayers.entries()) {
      if (layerIds.has(layer.id))
        context.addIssue({
          code: 'custom',
          path: ['shell', 'facadeLayers', index, 'id'],
          message: 'duplicate facade layer id',
        });
      layerIds.add(layer.id);
      if (
        layer.minimumY !== undefined &&
        layer.maximumY !== undefined &&
        layer.maximumY <= layer.minimumY
      )
        context.addIssue({
          code: 'custom',
          path: ['shell', 'facadeLayers', index],
          message: 'facade layer vertical range must have positive extent',
        });
    }
    const anchorIds = new Set<string>();
    const allBayIds = new Set(
      definition.storeys.flatMap((storey) => storey.bays.map((bay) => bay.id)),
    );
    for (const [index, anchor] of definition.anchors.entries()) {
      if (anchorIds.has(anchor.id))
        context.addIssue({
          code: 'custom',
          path: ['anchors', index, 'id'],
          message: 'duplicate anchor id',
        });
      anchorIds.add(anchor.id);
      if (anchor.bayId && !allBayIds.has(anchor.bayId))
        context.addIssue({
          code: 'custom',
          path: ['anchors', index, 'bayId'],
          message: `unknown bay '${anchor.bayId}'`,
        });
    }
  });

export type ArchitecturalEnvelopeDefinition = z.infer<typeof architecturalEnvelopeDefinitionSchema>;
export type ArchitecturalEnvelopeDefinitionInput = z.input<
  typeof architecturalEnvelopeDefinitionSchema
>;

export interface ArchitecturalModulePlacement {
  openingId: string;
  kind: 'door' | 'window' | 'shopfront';
  assetId: string;
  version: string;
  position: Vec3;
  floorY: number;
  opening: WallOpening;
}

export interface ArchitecturalEnvelopeReport {
  definitionId: string;
  deterministicSha256: string;
  geometryValid: boolean;
  facadeWidthMeters: number;
  totalHeightMeters: number;
  openingCount: number;
  occupiedRoomCount: number;
  constructionDetail: FacadeConstructionDetailReport;
  facadeLayerDepths: Array<{ id: string; frontZ: number; backZ: number }>;
  apertures: Array<{ id: string; centreRayClear: boolean; roomDepthMeters: number }>;
  surfaceMaterialTargets: ArchitecturalEnvelopeMaterialTargets;
  facadeSurfaceHistory: FacadeSurfaceHistoryReport;
}

function compileSurfaceMaterialTargets(
  definition: ArchitecturalEnvelopeDefinition,
): ArchitecturalEnvelopeMaterialTargets {
  const roles = new Map<string, Set<ArchitecturalEnvelopeMaterialRole>>();
  const add = (materialId: string, role: ArchitecturalEnvelopeMaterialRole) => {
    const existing = roles.get(materialId) ?? new Set<ArchitecturalEnvelopeMaterialRole>();
    existing.add(role);
    roles.set(materialId, existing);
  };
  add(definition.materials.structure, 'structure');
  add(definition.materials.foundation, 'foundation');
  add(definition.materials.roof, 'roof');
  add(definition.materials.trim, 'facade-trim');
  add(definition.materials.interior, 'interior-wall');
  add(definition.materials.darkRoom, 'dark-room');
  add(definition.materials.litRoom, 'lit-room');
  add(definition.materials.occupancy, 'occupancy');
  for (const layer of definition.shell.facadeLayers)
    add(
      layer.materialId,
      layer.role === 'finish'
        ? 'facade-finish'
        : layer.role === 'trim'
          ? 'facade-trim'
          : 'facade-damp-course',
    );
  add(definition.roof.materialId, 'roof');
  add(definition.roof.trimMaterialId, 'roof-trim');
  add(definition.threshold.materialId, 'threshold');
  return architecturalEnvelopeMaterialTargetsSchema.parse({
    schemaVersion: 1,
    targets: [...roles.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([materialId, materialRoles]) => ({
        materialId,
        roles: [...materialRoles].sort(),
      })),
  });
}

function basicMaterial(id: string, index: number): GeometryMaterial {
  const palette: Array<[number, number, number, number]> = [
    [0.18, 0.15, 0.13, 1],
    [0.27, 0.25, 0.22, 1],
    [0.08, 0.07, 0.065, 1],
    [0.34, 0.2, 0.11, 1],
  ];
  return {
    id,
    baseColor: palette[index % palette.length]!,
    roughness: id.includes('glass') ? 0.12 : 0.68,
    metallic: id.includes('metal') ? 0.68 : 0,
    emission: id.includes('lit') ? [0.55, 0.14, 0.035] : [0, 0, 0],
    emissionStrength: id.includes('lit') ? 1.1 : 0,
  };
}

function pointInTriangle2d(x: number, y: number, a: Vec3, b: Vec3, c: Vec3) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) return false;
  const first = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
  const second = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
  const third = 1 - first - second;
  return first >= -1e-8 && second >= -1e-8 && third >= -1e-8;
}

function apertureRayClear(
  geometry: GeometryAsset,
  opening: WallOpening,
  wallMaterialIds: Set<string>,
  facadeExteriorZ: number,
  facadeInteriorZ: number,
) {
  const x = (opening.minimumX + opening.maximumX) * 0.5;
  const y = (opening.minimumY + opening.maximumY) * 0.5;
  for (const group of geometry.materialGroups) {
    if (!wallMaterialIds.has(group.materialId)) continue;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const a = geometry.positions[geometry.indices[offset]!]!;
      const b = geometry.positions[geometry.indices[offset + 1]!]!;
      const c = geometry.positions[geometry.indices[offset + 2]!]!;
      if (!pointInTriangle2d(x, y, a, b, c)) continue;
      const minimumZ = Math.min(a[2], b[2], c[2]);
      const maximumZ = Math.max(a[2], b[2], c[2]);
      if (maximumZ >= facadeExteriorZ && minimumZ <= facadeInteriorZ) return false;
    }
  }
  return true;
}

function roomParts(
  opening: WallOpening,
  bayMinimumX: number,
  bayMaximumX: number,
  storeyMinimumY: number,
  storeyMaximumY: number,
  frontZ: number,
  roomDepthMeters: number,
  occupancy: 'dark' | 'lit-empty' | 'inhabited',
  materials: ArchitecturalEnvelopeDefinition['materials'],
): MeshPart[] {
  const roomFront = frontZ + 0.02;
  const roomBack = frontZ + roomDepthMeters;
  const roomMaterial = occupancy === 'dark' ? materials.darkRoom : materials.litRoom;
  const parts: MeshPart[] = [
    boxPart(
      [bayMinimumX + 0.04, storeyMinimumY, roomFront],
      [bayMaximumX - 0.04, storeyMinimumY + 0.05, roomBack],
      0,
      materials.interior,
    ),
    boxPart(
      [bayMinimumX + 0.04, storeyMaximumY - 0.06, roomFront],
      [bayMaximumX - 0.04, storeyMaximumY, roomBack],
      0,
      materials.interior,
    ),
    boxPart(
      [bayMinimumX + 0.04, storeyMinimumY, roomBack - 0.06],
      [bayMaximumX - 0.04, storeyMaximumY, roomBack],
      0,
      roomMaterial,
    ),
    boxPart(
      [bayMinimumX + 0.04, storeyMinimumY, roomFront],
      [bayMinimumX + 0.1, storeyMaximumY, roomBack],
      0,
      materials.interior,
    ),
    boxPart(
      [bayMaximumX - 0.1, storeyMinimumY, roomFront],
      [bayMaximumX - 0.04, storeyMaximumY, roomBack],
      0,
      materials.interior,
    ),
  ];
  if (occupancy === 'inhabited') {
    const centreX = (opening.minimumX + opening.maximumX) * 0.5;
    const shelfY = Math.max(storeyMinimumY + 0.35, opening.minimumY + 0.1);
    parts.push(
      boxPart(
        [bayMinimumX + 0.16, shelfY, roomBack - 0.24],
        [bayMaximumX - 0.16, shelfY + 0.08, roomBack - 0.12],
        0,
        materials.occupancy,
      ),
      boxPart(
        [centreX - 0.09, storeyMinimumY + 0.05, roomBack - 0.56],
        [centreX + 0.09, Math.min(storeyMaximumY - 0.15, storeyMinimumY + 1.72), roomBack - 0.38],
        0,
        materials.occupancy,
      ),
    );
  }
  return parts;
}

export function compileArchitecturalEnvelope(input: ArchitecturalEnvelopeDefinitionInput): {
  definition: ArchitecturalEnvelopeDefinition;
  geometry: GeometryAsset;
  modulePlacements: ArchitecturalModulePlacement[];
  report: ArchitecturalEnvelopeReport;
} {
  const definition = architecturalEnvelopeDefinitionSchema.parse(input);
  const { minimumX, maximumX, frontZ, depthMeters } = definition.footprint;
  const backZ = frontZ + definition.shell.wallThicknessMeters;
  const totalHeight = definition.storeys.reduce((sum, storey) => sum + storey.heightMeters, 0);
  const parts: MeshPart[] = [];
  const modulePlacements: ArchitecturalModulePlacement[] = [];
  const allOpenings: Array<WallOpening & { roomDepthMeters: number }> = [];
  const bayCentres = new Map<string, Vec3>();
  let storeyMinimumY = 0;
  for (const storey of definition.storeys) {
    const storeyMaximumY = storeyMinimumY + storey.heightMeters;
    let cursorX = minimumX;
    const openings: WallOpening[] = [];
    const bayBounds = new Map<string, [number, number]>();
    for (const bay of storey.bays) {
      const bayMinimumX = cursorX;
      const bayMaximumX = cursorX + bay.widthMeters;
      bayBounds.set(bay.id, [bayMinimumX, bayMaximumX]);
      bayCentres.set(bay.id, [
        (bayMinimumX + bayMaximumX) * 0.5,
        (storeyMinimumY + storeyMaximumY) * 0.5,
        frontZ,
      ]);
      if (bay.opening) {
        const opening: WallOpening = {
          id: bay.opening.id,
          minimumX: (bayMinimumX + bayMaximumX - bay.opening.widthMeters) * 0.5,
          maximumX: (bayMinimumX + bayMaximumX + bay.opening.widthMeters) * 0.5,
          minimumY: storeyMinimumY + bay.opening.sillMeters,
          maximumY: storeyMinimumY + bay.opening.sillMeters + bay.opening.heightMeters,
        };
        openings.push(opening);
        allOpenings.push({ ...opening, roomDepthMeters: bay.opening.room.depthMeters });
        modulePlacements.push({
          openingId: opening.id,
          kind: bay.opening.kind,
          assetId: bay.opening.module.assetId,
          version: bay.opening.module.version,
          position: [(opening.minimumX + opening.maximumX) * 0.5, opening.minimumY, frontZ],
          floorY: storeyMinimumY,
          opening,
        });
        parts.push(
          ...roomParts(
            opening,
            bayMinimumX,
            bayMaximumX,
            storeyMinimumY,
            storeyMaximumY,
            backZ,
            bay.opening.room.depthMeters,
            bay.opening.room.occupancy,
            definition.materials,
          ),
        );
      }
      cursorX = bayMaximumX;
    }
    parts.push(
      ...wallWithRectangularOpeningsParts({
        minimumX,
        maximumX,
        minimumY: storeyMinimumY,
        maximumY: storeyMaximumY,
        frontZ,
        backZ,
        materialId: definition.materials.structure,
        openings,
      }),
    );
    let layerBackZ = frontZ;
    for (const layer of definition.shell.facadeLayers) {
      const layerFrontZ = layerBackZ - layer.thicknessMeters;
      const layerMinimumY = Math.max(storeyMinimumY, layer.minimumY ?? storeyMinimumY);
      const layerMaximumY = Math.min(storeyMaximumY, layer.maximumY ?? storeyMaximumY);
      if (layerMaximumY > layerMinimumY) {
        const layerOpenings = openings
          .filter((opening) => opening.maximumY > layerMinimumY && opening.minimumY < layerMaximumY)
          .map((opening) => ({
            ...opening,
            minimumY: Math.max(opening.minimumY, layerMinimumY),
            maximumY: Math.min(opening.maximumY, layerMaximumY),
          }));
        parts.push(
          ...wallWithRectangularOpeningsParts({
            minimumX,
            maximumX,
            minimumY: layerMinimumY,
            maximumY: layerMaximumY,
            frontZ: layerFrontZ,
            backZ: layerBackZ,
            materialId: layer.materialId,
            openings: layerOpenings,
            allowOpeningsAtTopBoundary: true,
          }),
        );
      }
      layerBackZ = layerFrontZ;
    }
    for (const bay of storey.bays) {
      const [bayMinimumX, bayMaximumX] = bayBounds.get(bay.id)!;
      if (bay.opening?.kind === 'door') {
        const opening = openings.find((candidate) => candidate.id === bay.opening!.id)!;
        const slopeDrop =
          Math.tan((definition.threshold.fallDegrees * Math.PI) / 180) *
          definition.threshold.projectionMeters;
        parts.push(
          extrudedConvexPolygonPart({
            minimumX: opening.minimumX - 0.08,
            maximumX: opening.maximumX + 0.08,
            crossSectionYZ: [
              [-slopeDrop, frontZ - definition.threshold.projectionMeters],
              [
                definition.threshold.riseMeters - slopeDrop,
                frontZ - definition.threshold.projectionMeters,
              ],
              [definition.threshold.riseMeters, frontZ - 0.01],
              [0, frontZ - 0.01],
            ],
            bone: 0,
            materialId: definition.threshold.materialId,
          }),
        );
      }
      void bayMinimumX;
      void bayMaximumX;
    }
    storeyMinimumY = storeyMaximumY;
  }

  const facadeExteriorZ =
    frontZ - definition.shell.facadeLayers.reduce((sum, layer) => sum + layer.thicknessMeters, 0);
  let facadeLayerBackZ = frontZ;
  const facadeLayerFrontZByMaterialId: Record<string, number> = {};
  for (const layer of definition.shell.facadeLayers) {
    const layerFrontZ = facadeLayerBackZ - layer.thicknessMeters;
    facadeLayerFrontZByMaterialId[layer.materialId] = Math.min(
      facadeLayerFrontZByMaterialId[layer.materialId] ?? Infinity,
      layerFrontZ,
    );
    facadeLayerBackZ = layerFrontZ;
  }
  const wearReceiverLayer = definition.shell.facadeLayers.find((layer) => layer.role === 'finish');
  if (!wearReceiverLayer)
    throw new Error(`Architectural envelope '${definition.id}' requires a facade finish layer`);
  const constructionDetail = compileFacadeConstructionDetail({
    schemaVersion: 1,
    id: `${definition.id}.construction-detail`,
    seed: definition.seed,
    style: definition.roof.kind === 'gable' ? 'historic-masonry' : 'contemporary-plaster',
    minimumX,
    maximumX,
    totalHeightMeters: totalHeight,
    facadeExteriorZ,
    wearReceiverFrontZ: facadeLayerFrontZByMaterialId[wearReceiverLayer.materialId],
    openings: modulePlacements.map((placement) => ({
      id: placement.openingId,
      kind: placement.kind,
      minimumX: placement.opening.minimumX,
      maximumX: placement.opening.maximumX,
      minimumY: placement.opening.minimumY,
      maximumY: placement.opening.maximumY,
    })),
    trimMaterialId: definition.materials.trim,
    wearReceiverMaterialId:
      definition.shell.facadeLayers[0]?.materialId ?? definition.materials.structure,
    surfaceRepairs: definition.shell.surfaceRepairs,
  });
  parts.push(...constructionDetail.parts);

  const surfaceMaterialTargets = compileSurfaceMaterialTargets(definition);

  parts.push(
    boxPart(
      [minimumX, -definition.shell.foundationHeightMeters, frontZ],
      [maximumX, 0, frontZ + depthMeters],
      0,
      definition.materials.foundation,
    ),
    boxPart(
      [minimumX, 0, frontZ + depthMeters - definition.shell.wallThicknessMeters],
      [maximumX, totalHeight, frontZ + depthMeters],
      0,
      definition.materials.structure,
    ),
    boxPart(
      [minimumX, 0, backZ],
      [minimumX + definition.shell.wallThicknessMeters, totalHeight, frontZ + depthMeters],
      0,
      definition.materials.structure,
    ),
    boxPart(
      [maximumX - definition.shell.wallThicknessMeters, 0, backZ],
      [maximumX, totalHeight, frontZ + depthMeters],
      0,
      definition.materials.structure,
    ),
  );
  const roofMinimum: Vec3 = [
    minimumX - definition.roof.overhangMeters,
    totalHeight,
    frontZ - definition.roof.overhangMeters,
  ];
  const roofMaximum: Vec3 = [
    maximumX + definition.roof.overhangMeters,
    definition.roof.kind === 'gable'
      ? totalHeight + definition.roof.riseMeters
      : totalHeight + 0.16,
    frontZ + depthMeters + definition.roof.overhangMeters,
  ];
  if (definition.roof.kind === 'gable')
    parts.push(gableRoofPart(roofMinimum, roofMaximum, 'x', 0, definition.roof.materialId));
  else {
    parts.push(
      boxPart(roofMinimum, roofMaximum, 0, definition.roof.materialId),
      boxPart(
        [roofMinimum[0], totalHeight + 0.16, roofMinimum[2]],
        [
          roofMaximum[0],
          totalHeight + 0.16 + definition.roof.parapetHeightMeters,
          roofMinimum[2] + 0.16,
        ],
        0,
        definition.roof.trimMaterialId,
      ),
    );
  }

  let geometry = mergeMeshParts(
    definition.id,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.architectural-envelope.v1',
      definition,
      facadeExteriorZ,
      facadeInteriorZ: backZ,
      detailTier: definition.detailTier,
      modulePlacements,
      constructionDetail: constructionDetail.report,
      architecturalMaterialTargets: surfaceMaterialTargets,
    },
  );
  const materialIds = new Set([
    ...Object.values(definition.materials),
    ...definition.shell.facadeLayers.map((layer) => layer.materialId),
    definition.roof.materialId,
    definition.roof.trimMaterialId,
    definition.threshold.materialId,
  ]);
  geometry.materials = [...materialIds].sort().map(basicMaterial);
  const facadeSurfaceHistory = applyFacadeSurfaceHistory({
    geometry,
    seed: definition.seed,
    receiverMaterialIds: [wearReceiverLayer.materialId],
    receiverFrontZByMaterialId: {
      [wearReceiverLayer.materialId]: facadeLayerFrontZByMaterialId[wearReceiverLayer.materialId]!,
    },
    zones: constructionDetail.report.dirtReceiverZones,
    maximumFinishIrregularityMeters: definition.roof.kind === 'gable' ? 0.0018 : 0.0009,
  });
  geometry = facadeSurfaceHistory.geometry;
  for (const placement of modulePlacements) {
    const roomDepth = allOpenings.find(
      (opening) => opening.id === placement.openingId,
    )!.roomDepthMeters;
    const openingCentreX = (placement.opening.minimumX + placement.opening.maximumX) * 0.5;
    const openingCentreY = (placement.opening.minimumY + placement.opening.maximumY) * 0.5;
    geometry.attachments[`opening-${placement.openingId}`] = {
      position: placement.position,
      rotation: [0, 0, 0],
      bone: 'root',
    };
    geometry.attachments[`room-focus-${placement.openingId}`] = {
      position: [openingCentreX, openingCentreY, backZ + roomDepth * 0.62],
      rotation: [0, 0, 0],
      bone: 'root',
    };
    geometry.attachments[`interior-depth-near-${placement.openingId}`] = {
      position: [openingCentreX, placement.floorY, backZ + Math.min(0.9, roomDepth * 0.28)],
      rotation: [0, 0, 0],
      bone: 'root',
    };
    geometry.attachments[`interior-depth-far-${placement.openingId}`] = {
      position: [openingCentreX, placement.floorY, backZ + roomDepth * 0.78],
      rotation: [0, 0, 0],
      bone: 'root',
    };
  }
  for (const anchor of definition.anchors) {
    const base = anchor.bayId ? bayCentres.get(anchor.bayId)! : ([0, 0, frontZ] as Vec3);
    geometry.attachments[anchor.id] = {
      position: [
        base[0] + anchor.localOffset[0],
        base[1] + anchor.localOffset[1],
        base[2] + anchor.localOffset[2],
      ],
      rotation: [0, 0, 0],
      bone: 'root',
    };
  }
  const validation = validateGeometry(geometry);
  const wallMaterialIds = new Set([
    definition.materials.structure,
    ...definition.shell.facadeLayers.map((layer) => layer.materialId),
  ]);
  const facadeLayerDepths: ArchitecturalEnvelopeReport['facadeLayerDepths'] = [];
  let layerBack = frontZ;
  for (const layer of definition.shell.facadeLayers) {
    facadeLayerDepths.push({
      id: layer.id,
      frontZ: layerBack - layer.thicknessMeters,
      backZ: layerBack,
    });
    layerBack -= layer.thicknessMeters;
  }
  const digestInput = JSON.stringify({ definition, geometry, modulePlacements });
  const report: ArchitecturalEnvelopeReport = {
    definitionId: definition.id,
    deterministicSha256: createHash('sha256').update(digestInput).digest('hex'),
    geometryValid: validation.valid,
    facadeWidthMeters: maximumX - minimumX,
    totalHeightMeters: totalHeight,
    openingCount: allOpenings.length,
    occupiedRoomCount: definition.storeys
      .flatMap((storey) => storey.bays)
      .filter((bay) => bay.opening?.room.occupancy === 'inhabited').length,
    constructionDetail: constructionDetail.report,
    facadeLayerDepths,
    apertures: allOpenings.map((opening) => ({
      id: opening.id,
      centreRayClear: apertureRayClear(
        geometry,
        opening,
        wallMaterialIds,
        frontZ -
          definition.shell.facadeLayers.reduce((sum, layer) => sum + layer.thicknessMeters, 0),
        backZ,
      ),
      roomDepthMeters: opening.roomDepthMeters,
    })),
    surfaceMaterialTargets,
    facadeSurfaceHistory: facadeSurfaceHistory.report,
  };
  return { definition, geometry, modulePlacements, report };
}

export function createHistoricShopfrontEnvelopeDefinition(): ArchitecturalEnvelopeDefinition {
  return architecturalEnvelopeDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'environment.historic-masonry-shopfront-envelope',
    seed: 1847,
    detailTier: 'medium',
    footprint: { kind: 'rectangle', minimumX: -3.4, maximumX: 3.4, frontZ: 0, depthMeters: 5.4 },
    storeys: [
      {
        id: 'ground',
        heightMeters: 3.25,
        bays: [
          {
            id: 'entry',
            widthMeters: 1.5,
            opening: {
              id: 'entry-door',
              kind: 'door',
              widthMeters: 1.2,
              heightMeters: 2.16,
              sillMeters: 0,
              module: { assetId: 'prop.bookshop-door', version: '0.1.0' },
              room: { depthMeters: 3.8, occupancy: 'lit-empty' },
            },
          },
          {
            id: 'display',
            widthMeters: 3.3,
            opening: {
              id: 'display-window',
              kind: 'shopfront',
              widthMeters: 2.72,
              heightMeters: 2.15,
              sillMeters: 0.62,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 4.2, occupancy: 'inhabited' },
            },
          },
          {
            id: 'service',
            widthMeters: 2.0,
            opening: {
              id: 'service-window',
              kind: 'window',
              widthMeters: 1.28,
              heightMeters: 0.96,
              sillMeters: 1.24,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 3.1, occupancy: 'dark' },
            },
          },
        ],
      },
      {
        id: 'upper',
        heightMeters: 2.85,
        bays: [
          {
            id: 'upper-left',
            widthMeters: 2.05,
            opening: {
              id: 'upper-left-window',
              kind: 'window',
              widthMeters: 1.28,
              heightMeters: 0.96,
              sillMeters: 1.02,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 3.2, occupancy: 'lit-empty' },
            },
          },
          {
            id: 'upper-centre',
            widthMeters: 2.55,
            opening: {
              id: 'upper-centre-window',
              kind: 'window',
              widthMeters: 1.28,
              heightMeters: 0.96,
              sillMeters: 1.02,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 3.5, occupancy: 'inhabited' },
            },
          },
          {
            id: 'upper-right',
            widthMeters: 2.2,
            opening: {
              id: 'upper-right-window',
              kind: 'window',
              widthMeters: 1.28,
              heightMeters: 0.96,
              sillMeters: 1.02,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 2.9, occupancy: 'dark' },
            },
          },
        ],
      },
    ],
    shell: {
      wallThicknessMeters: 0.34,
      foundationHeightMeters: 0.42,
      facadeLayers: [
        {
          id: 'lime-finish',
          role: 'finish',
          thicknessMeters: 0.024,
          materialId: 'rain-aged-plaster',
        },
        {
          id: 'stone-damp-course',
          role: 'damp-course',
          thicknessMeters: 0.036,
          materialId: 'aged-limestone',
          minimumY: 0,
          maximumY: 0.58,
        },
      ],
      surfaceRepairs: [
        {
          id: 'upper-entry-lime-repair',
          polygonXY: [
            [-3.24, 2.3],
            [-3.02, 2.25],
            [-2.79, 2.32],
            [-2.73, 2.55],
            [-2.84, 2.79],
            [-3.08, 2.83],
            [-3.28, 2.68],
          ],
          intensity: 0.74,
        },
      ],
    },
    roof: {
      kind: 'gable',
      overhangMeters: 0.32,
      riseMeters: 1.72,
      materialId: 'weathered-slate',
      trimMaterialId: 'dark-timber',
    },
    threshold: {
      projectionMeters: 0.38,
      riseMeters: 0.1,
      fallDegrees: 2.2,
      materialId: 'aged-limestone',
    },
    anchors: [
      { id: 'canopy-mount', kind: 'facade-mount', bayId: 'display', localOffset: [0, 1.28, -0.04] },
      { id: 'sign-mount', kind: 'facade-mount', bayId: 'entry', localOffset: [0.55, 1.12, -0.08] },
      { id: 'rainwater-span', kind: 'eave-span', localOffset: [0, 5.98, -0.12] },
      { id: 'door-approach', kind: 'approach', bayId: 'entry', localOffset: [0, -1.625, -0.9] },
    ],
    materials: {
      structure: 'historic-masonry',
      foundation: 'aged-limestone',
      roof: 'weathered-slate',
      trim: 'dark-timber',
      interior: 'warm-interior-plaster',
      darkRoom: 'dark-room',
      litRoom: 'lit-room',
      occupancy: 'interior-wood',
    },
    metadata: { hostClass: 'historic-masonry-shopfront', transferFixture: true },
  });
}

export function createContemporaryMixedUseEnvelopeDefinition(): ArchitecturalEnvelopeDefinition {
  return architecturalEnvelopeDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'environment.contemporary-plaster-mixed-use-envelope',
    seed: 90211,
    detailTier: 'medium',
    footprint: { kind: 'rectangle', minimumX: -4.2, maximumX: 4.2, frontZ: 0, depthMeters: 6.1 },
    storeys: [
      {
        id: 'street-level',
        heightMeters: 3.5,
        bays: [
          {
            id: 'lobby',
            widthMeters: 2.0,
            opening: {
              id: 'lobby-door',
              kind: 'door',
              widthMeters: 1.2,
              heightMeters: 2.16,
              sillMeters: 0,
              module: { assetId: 'prop.bookshop-door', version: '0.1.0' },
              room: { depthMeters: 4.4, occupancy: 'lit-empty' },
            },
          },
          {
            id: 'studio',
            widthMeters: 4.6,
            opening: {
              id: 'studio-window',
              kind: 'shopfront',
              widthMeters: 3.8,
              heightMeters: 2.5,
              sillMeters: 0.48,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 5.2, occupancy: 'inhabited' },
            },
          },
          {
            id: 'service',
            widthMeters: 1.8,
            opening: {
              id: 'service-door',
              kind: 'door',
              widthMeters: 1.2,
              heightMeters: 2.16,
              sillMeters: 0,
              module: { assetId: 'prop.bookshop-door', version: '0.1.0' },
              room: { depthMeters: 3.6, occupancy: 'dark' },
            },
          },
        ],
      },
      {
        id: 'office-level',
        heightMeters: 3.05,
        bays: [
          {
            id: 'office-west',
            widthMeters: 3.1,
            opening: {
              id: 'office-west-window',
              kind: 'window',
              widthMeters: 1.28,
              heightMeters: 0.96,
              sillMeters: 1.03,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 4.5, occupancy: 'lit-empty' },
            },
          },
          { id: 'office-core', widthMeters: 1.9 },
          {
            id: 'office-east',
            widthMeters: 3.4,
            opening: {
              id: 'office-east-window',
              kind: 'window',
              widthMeters: 1.28,
              heightMeters: 0.96,
              sillMeters: 1.03,
              module: { assetId: 'prop.inset-architectural-window', version: '0.1.0' },
              room: { depthMeters: 4.9, occupancy: 'inhabited' },
            },
          },
        ],
      },
    ],
    shell: {
      wallThicknessMeters: 0.26,
      foundationHeightMeters: 0.28,
      facadeLayers: [
        {
          id: 'mineral-render',
          role: 'finish',
          thicknessMeters: 0.018,
          materialId: 'contemporary-mineral-render',
        },
        {
          id: 'dark-plinth',
          role: 'damp-course',
          thicknessMeters: 0.022,
          materialId: 'dark-stone-plinth',
          minimumY: 0,
          maximumY: 0.5,
        },
      ],
      surfaceRepairs: [
        {
          id: 'office-core-render-repair',
          polygonXY: [
            [-0.92, 4.5],
            [-0.62, 4.42],
            [-0.24, 4.48],
            [-0.08, 4.72],
            [-0.16, 5.08],
            [-0.48, 5.22],
            [-0.83, 5.13],
            [-1, 4.84],
          ],
          intensity: 0.46,
        },
      ],
    },
    roof: {
      kind: 'flat-parapet',
      overhangMeters: 0.08,
      parapetHeightMeters: 0.52,
      materialId: 'flat-roof-membrane',
      trimMaterialId: 'painted-metal-trim',
    },
    threshold: {
      projectionMeters: 0.28,
      riseMeters: 0.06,
      fallDegrees: 1.5,
      materialId: 'dark-stone-plinth',
    },
    anchors: [
      {
        id: 'blade-sign-mount',
        kind: 'facade-mount',
        bayId: 'lobby',
        localOffset: [0.62, 1.3, -0.08],
      },
      {
        id: 'studio-canopy-mount',
        kind: 'facade-mount',
        bayId: 'studio',
        localOffset: [0, 1.36, -0.05],
      },
      {
        id: 'service-approach',
        kind: 'approach',
        bayId: 'service',
        localOffset: [0, -1.75, -0.88],
      },
    ],
    materials: {
      structure: 'concrete-block',
      foundation: 'dark-stone-plinth',
      roof: 'flat-roof-membrane',
      trim: 'painted-metal-trim',
      interior: 'neutral-interior-plaster',
      darkRoom: 'dark-room',
      litRoom: 'lit-room',
      occupancy: 'painted-metal-interior',
    },
    metadata: { hostClass: 'contemporary-plaster-mixed-use', transferFixture: true },
  });
}
