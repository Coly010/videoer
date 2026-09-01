import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GeometryAsset, GeometryMaterial, Vec3, Vec4 } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { boxPart, mergeMeshParts, type MeshPart } from '../geometry/primitives.js';
import { createTriangleSurfaceQuery } from './surface-query.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
const localIdentifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const vec2 = z.tuple([z.number().finite(), z.number().finite()]);

export const irregularPavingDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    seed: z.number().int(),
    detailTier: z.enum(['background', 'medium']),
    boundary: z.object({
      kind: z.literal('rectangle'),
      minimum: vec2,
      maximum: vec2,
    }),
    baseY: z.number().finite(),
    courses: z.object({
      directionDegrees: z.union([z.literal(0), z.literal(90)]),
      nominalWidthMeters: z.number().positive(),
      widthVariation: z.number().min(0).max(0.4),
      staggerFraction: z.number().min(0).max(0.9),
      edgeJitterMeters: z.number().min(0).max(0.08),
    }),
    units: z.object({
      profile: z.enum(['irregular-sett', 'irregular-paver']),
      nominalLengthMeters: z.number().positive(),
      lengthVariation: z.number().min(0).max(0.45),
      widthVariation: z.number().min(0).max(0.35),
      cornerJitterMeters: z.number().min(0).max(0.06),
      yawVariationDegrees: z.number().min(0).max(12),
      settlementMeters: z.number().min(0).max(0.05),
      tiltDegrees: z.number().min(0).max(6),
      heightMeters: z.number().min(0.025).max(0.3),
      chamferMeters: z.number().min(0.001).max(0.04),
      chipProbability: z.number().min(0).max(0.8),
      maximumChipDepthMeters: z.number().min(0).max(0.025),
    }),
    joints: z.object({
      widthMeters: z.number().min(0.003).max(0.08),
      depthMeters: z.number().min(0.002).max(0.08),
      materialId: localIdentifier,
    }),
    borders: z
      .array(
        z.object({
          id: localIdentifier,
          kind: z.enum(['kerb', 'gutter', 'soldier-course']),
          side: z.enum(['minimum-x', 'maximum-x', 'minimum-z', 'maximum-z']),
          widthMeters: z.number().min(0.08).max(1.2),
          riseMeters: z.number().min(-0.12).max(0.35),
          fallDegrees: z.number().min(0).max(12),
          materialId: localIdentifier,
        }),
      )
      .default([]),
    repairPatches: z
      .array(
        z.object({
          id: localIdentifier,
          minimum: vec2,
          maximum: vec2,
          settlementBiasMeters: z.number().min(-0.04).max(0.04),
          materialIds: z.array(localIdentifier).min(1),
        }),
      )
      .default([]),
    materials: z.object({
      stoneIds: z.array(localIdentifier).min(2),
      substrateId: localIdentifier,
      kerbId: localIdentifier,
      gutterId: localIdentifier,
    }),
    drainage: z.object({
      fall: vec2,
      wetReceiverMaterialIds: z.array(localIdentifier).min(1),
      runoffAnchorIds: z.array(localIdentifier).default([]),
    }),
    walkability: z.object({
      maximumStepMeters: z.number().min(0.005).max(0.12),
      maximumSlopeDegrees: z.number().min(0).max(20),
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((definition, context) => {
    if (
      definition.boundary.maximum[0] <= definition.boundary.minimum[0] ||
      definition.boundary.maximum[1] <= definition.boundary.minimum[1]
    )
      context.addIssue({
        code: 'custom',
        path: ['boundary'],
        message: 'paving boundary must have positive extent',
      });
    if (
      definition.joints.widthMeters >=
      Math.min(definition.units.nominalLengthMeters, definition.courses.nominalWidthMeters) * 0.35
    )
      context.addIssue({
        code: 'custom',
        path: ['joints', 'widthMeters'],
        message: 'joint is too wide for the paving unit',
      });
    if (definition.units.chamferMeters >= definition.units.heightMeters * 0.45)
      context.addIssue({
        code: 'custom',
        path: ['units', 'chamferMeters'],
        message: 'chamfer must be less than 45% of unit height',
      });
    if (definition.units.maximumChipDepthMeters > definition.units.chamferMeters)
      context.addIssue({
        code: 'custom',
        path: ['units', 'maximumChipDepthMeters'],
        message: 'chip depth must not exceed the chamfer',
      });
    if (Math.hypot(...definition.drainage.fall) < 1e-8)
      context.addIssue({
        code: 'custom',
        path: ['drainage', 'fall'],
        message: 'drainage fall must have a direction',
      });
    const borderIds = new Set<string>();
    for (const [index, border] of definition.borders.entries()) {
      if (borderIds.has(border.id))
        context.addIssue({
          code: 'custom',
          path: ['borders', index, 'id'],
          message: 'duplicate border id',
        });
      borderIds.add(border.id);
    }
    const patchIds = new Set<string>();
    for (const [index, patch] of definition.repairPatches.entries()) {
      if (patchIds.has(patch.id))
        context.addIssue({
          code: 'custom',
          path: ['repairPatches', index, 'id'],
          message: 'duplicate repair patch id',
        });
      patchIds.add(patch.id);
      if (patch.maximum[0] <= patch.minimum[0] || patch.maximum[1] <= patch.minimum[1])
        context.addIssue({
          code: 'custom',
          path: ['repairPatches', index],
          message: 'repair patch must have positive extent',
        });
      if (
        patch.minimum[0] < definition.boundary.minimum[0] ||
        patch.maximum[0] > definition.boundary.maximum[0] ||
        patch.minimum[1] < definition.boundary.minimum[1] ||
        patch.maximum[1] > definition.boundary.maximum[1]
      )
        context.addIssue({
          code: 'custom',
          path: ['repairPatches', index],
          message: 'repair patch must remain inside the paving boundary',
        });
    }
    const validReceivers = new Set([
      ...definition.materials.stoneIds,
      ...definition.repairPatches.flatMap((patch) => patch.materialIds),
      definition.materials.kerbId,
      definition.materials.gutterId,
    ]);
    for (const [index, materialId] of definition.drainage.wetReceiverMaterialIds.entries())
      if (!validReceivers.has(materialId))
        context.addIssue({
          code: 'custom',
          path: ['drainage', 'wetReceiverMaterialIds', index],
          message: `unknown wet receiver material '${materialId}'`,
        });
  });

export type IrregularPavingDefinition = z.infer<typeof irregularPavingDefinitionSchema>;
export type IrregularPavingDefinitionInput = z.input<typeof irregularPavingDefinitionSchema>;

interface Point2 {
  x: number;
  z: number;
}

interface StoneEvidence {
  id: string;
  course: number;
  materialId: string;
  centre: [number, number];
  lengthMeters: number;
  widthMeters: number;
  yawDegrees: number;
  settlementMeters: number;
  tiltDegrees: [number, number];
  repairPatchId?: string;
  chipped: boolean;
}

export interface IrregularPavingReport {
  definitionId: string;
  deterministicSha256: string;
  geometryValid: boolean;
  supportGeometryValid: boolean;
  stoneCount: number;
  courseCount: number;
  uniqueFootprintSignatures: number;
  settlementRangeMeters: [number, number];
  maximumObservedStepMeters: number;
  maximumObservedTiltDegrees: number;
  repairPatchStoneCounts: Record<string, number>;
  supportQueryCoverage: { samples: number; hits: number };
  wetReceiverMaterialIds: string[];
  stones: StoneEvidence[];
}

function deterministicRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const first: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const second: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const value: Vec3 = [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
  const length = Math.hypot(...value);
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
}

function pavingStonePart(options: {
  plan: Point2[];
  centre: Point2;
  bottomY: number;
  topY: number;
  chamferMeters: number;
  tiltRadians: [number, number];
  materialId: string;
}): MeshPart {
  const { plan, centre, bottomY, topY, chamferMeters, tiltRadians, materialId } = options;
  const averageRadius =
    plan.reduce((sum, point) => sum + Math.hypot(point.x - centre.x, point.z - centre.z), 0) /
    plan.length;
  const insetScale = Math.max(0.82, 1 - chamferMeters / averageRadius);
  const topAt = (point: Point2) =>
    topY +
    Math.tan(tiltRadians[0]) * (point.x - centre.x) +
    Math.tan(tiltRadians[1]) * (point.z - centre.z);
  const topPlan = plan.map((point) => ({
    x: centre.x + (point.x - centre.x) * insetScale,
    z: centre.z + (point.z - centre.z) * insetScale,
  }));
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];
  const skinIndices: Vec4[] = [];
  const skinWeights: Vec4[] = [];
  const vertex = (position: Vec3, faceNormal: Vec3, uv: [number, number]) => {
    positions.push(position);
    normals.push(faceNormal);
    uvs.push(uv);
    skinIndices.push([0, 0, 0, 0]);
    skinWeights.push([1, 0, 0, 0]);
    return positions.length - 1;
  };
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    const faceNormal = normal(a, b, c);
    const start = positions.length;
    vertex(a, faceNormal, [0, 0]);
    vertex(b, faceNormal, [1, 0]);
    vertex(c, faceNormal, [1, 1]);
    vertex(d, faceNormal, [0, 1]);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  for (let index = 0; index < plan.length; index++) {
    const next = (index + 1) % plan.length;
    const a = plan[index]!;
    const b = plan[next]!;
    const at = topAt(a);
    const bt = topAt(b);
    quad(
      [a.x, bottomY, a.z],
      [b.x, bottomY, b.z],
      [b.x, bt - chamferMeters, b.z],
      [a.x, at - chamferMeters, a.z],
    );
    const ta = topPlan[index]!;
    const tb = topPlan[next]!;
    quad(
      [a.x, at - chamferMeters, a.z],
      [b.x, bt - chamferMeters, b.z],
      [tb.x, topAt(tb), tb.z],
      [ta.x, topAt(ta), ta.z],
    );
  }
  const topNormal = normal(
    [topPlan[0]!.x, topAt(topPlan[0]!), topPlan[0]!.z],
    [topPlan[1]!.x, topAt(topPlan[1]!), topPlan[1]!.z],
    [topPlan[2]!.x, topAt(topPlan[2]!), topPlan[2]!.z],
  );
  const topStart = positions.length;
  for (const point of topPlan)
    vertex([point.x, topAt(point), point.z], topNormal, [point.x, point.z]);
  for (let index = 1; index < topPlan.length - 1; index++)
    indices.push(topStart, topStart + index, topStart + index + 1);
  const bottomStart = positions.length;
  for (const point of [...plan].reverse())
    vertex([point.x, bottomY, point.z], [0, -1, 0], [point.x, point.z]);
  for (let index = 1; index < plan.length - 1; index++)
    indices.push(bottomStart, bottomStart + index, bottomStart + index + 1);
  return { positions, normals, uvs, indices, skinIndices, skinWeights, materialId };
}

function basicMaterial(id: string, index: number): GeometryMaterial {
  const palette: Array<[number, number, number, number]> = [
    [0.11, 0.13, 0.15, 1],
    [0.18, 0.17, 0.15, 1],
    [0.085, 0.1, 0.115, 1],
    [0.24, 0.22, 0.19, 1],
  ];
  return {
    id,
    baseColor: palette[index % palette.length]!,
    roughness: id.includes('wet') ? 0.2 : 0.64,
    metallic: 0,
    emission: [0, 0, 0],
    emissionStrength: 0,
  };
}

function insidePatch(
  point: [number, number],
  patch: IrregularPavingDefinition['repairPatches'][number],
) {
  return (
    point[0] >= patch.minimum[0] &&
    point[0] <= patch.maximum[0] &&
    point[1] >= patch.minimum[1] &&
    point[1] <= patch.maximum[1]
  );
}

function irregularPlan(
  centre: Point2,
  halfLength: number,
  halfWidth: number,
  yawRadians: number,
  jitter: number,
  random: () => number,
) {
  const cutX = () => Math.min(halfLength * 0.35, jitter * (0.35 + random() * 0.65));
  const cutZ = () => Math.min(halfWidth * 0.35, jitter * (0.35 + random() * 0.65));
  const local: Point2[] = [
    { x: -halfLength + cutX(), z: -halfWidth },
    { x: halfLength - cutX(), z: -halfWidth },
    { x: halfLength, z: -halfWidth + cutZ() },
    { x: halfLength, z: halfWidth - cutZ() },
    { x: halfLength - cutX(), z: halfWidth },
    { x: -halfLength + cutX(), z: halfWidth },
    { x: -halfLength, z: halfWidth - cutZ() },
    { x: -halfLength, z: -halfWidth + cutZ() },
  ];
  const cosine = Math.cos(yawRadians);
  const sine = Math.sin(yawRadians);
  return local.map((point) => ({
    x: centre.x + point.x * cosine - point.z * sine,
    z: centre.z + point.x * sine + point.z * cosine,
  }));
}

function borderPart(
  definition: IrregularPavingDefinition,
  border: IrregularPavingDefinition['borders'][number],
): MeshPart {
  const [minimumX, minimumZ] = definition.boundary.minimum;
  const [maximumX, maximumZ] = definition.boundary.maximum;
  let bounds: [number, number, number, number];
  if (border.side === 'minimum-x')
    bounds = [minimumX - border.widthMeters, minimumX, minimumZ, maximumZ];
  else if (border.side === 'maximum-x')
    bounds = [maximumX, maximumX + border.widthMeters, minimumZ, maximumZ];
  else if (border.side === 'minimum-z')
    bounds = [minimumX, maximumX, minimumZ - border.widthMeters, minimumZ];
  else bounds = [minimumX, maximumX, maximumZ, maximumZ + border.widthMeters];
  const centre = { x: (bounds[0] + bounds[1]) * 0.5, z: (bounds[2] + bounds[3]) * 0.5 };
  const fall = (border.fallDegrees * Math.PI) / 180;
  const tilt: [number, number] = border.side.endsWith('x') ? [fall, 0] : [0, fall];
  return pavingStonePart({
    plan: [
      { x: bounds[0], z: bounds[2] },
      { x: bounds[1], z: bounds[2] },
      { x: bounds[1], z: bounds[3] },
      { x: bounds[0], z: bounds[3] },
    ],
    centre,
    bottomY: definition.baseY - 0.16,
    topY: definition.baseY + border.riseMeters,
    chamferMeters: Math.min(0.012, border.widthMeters * 0.08),
    tiltRadians: tilt,
    materialId: border.materialId,
  });
}

export function compileIrregularPaving(input: IrregularPavingDefinitionInput): {
  definition: IrregularPavingDefinition;
  geometry: GeometryAsset;
  supportGeometry: GeometryAsset;
  report: IrregularPavingReport;
} {
  const definition = irregularPavingDefinitionSchema.parse(input);
  const random = deterministicRandom(definition.seed);
  const [minimumX, minimumZ] = definition.boundary.minimum;
  const [maximumX, maximumZ] = definition.boundary.maximum;
  const alongX = definition.courses.directionDegrees === 0;
  const minimumU = alongX ? minimumX : minimumZ;
  const maximumU = alongX ? maximumX : maximumZ;
  const minimumV = alongX ? minimumZ : minimumX;
  const maximumV = alongX ? maximumZ : maximumX;
  const parts: MeshPart[] = [
    boxPart(
      [
        minimumX,
        definition.baseY - definition.units.heightMeters - definition.joints.depthMeters,
        minimumZ,
      ],
      [maximumX, definition.baseY - definition.units.heightMeters, maximumZ],
      0,
      definition.materials.substrateId,
    ),
    boxPart(
      [minimumX, definition.baseY - definition.units.heightMeters, minimumZ],
      [maximumX, definition.baseY - definition.joints.depthMeters, maximumZ],
      0,
      definition.joints.materialId,
    ),
  ];
  const stones: StoneEvidence[] = [];
  let course = 0;
  let cursorV = minimumV;
  while (cursorV < maximumV - 1e-6) {
    const variedCourseWidth =
      definition.courses.nominalWidthMeters *
        (1 + (random() * 2 - 1) * definition.courses.widthVariation) +
      (random() * 2 - 1) * definition.courses.edgeJitterMeters;
    const courseMaximumV = Math.min(maximumV, cursorV + variedCourseWidth);
    const cellWidth = courseMaximumV - cursorV;
    const stagger =
      course % 2 === 1
        ? definition.units.nominalLengthMeters * definition.courses.staggerFraction
        : 0;
    let cursorU = minimumU - stagger;
    let unit = 0;
    while (cursorU < maximumU - 1e-6) {
      const cellLength =
        definition.units.nominalLengthMeters *
        (1 + (random() * 2 - 1) * definition.units.lengthVariation);
      const cellMinimumU = Math.max(minimumU, cursorU);
      const cellMaximumU = Math.min(maximumU, cursorU + cellLength);
      const availableLength = cellMaximumU - cellMinimumU - definition.joints.widthMeters;
      const availableWidth = cellWidth - definition.joints.widthMeters;
      if (
        availableLength > definition.joints.widthMeters * 1.5 &&
        availableWidth > definition.joints.widthMeters * 1.5
      ) {
        const centreU = (cellMinimumU + cellMaximumU) * 0.5;
        const centreV = (cursorV + courseMaximumV) * 0.5;
        const centre: Point2 = alongX ? { x: centreU, z: centreV } : { x: centreV, z: centreU };
        const widthMultiplier = 1 + (random() * 2 - 1) * definition.units.widthVariation;
        const rawHalfLength = availableLength * 0.5 * Math.min(1, widthMultiplier + 0.08);
        const rawHalfWidth = availableWidth * 0.5 * Math.min(1, widthMultiplier);
        const yawDegrees = (random() * 2 - 1) * definition.units.yawVariationDegrees;
        const yawRadians = (yawDegrees * Math.PI) / 180;
        const cosine = Math.abs(Math.cos(yawRadians));
        const sine = Math.abs(Math.sin(yawRadians));
        const boundingLength = rawHalfLength * cosine + rawHalfWidth * sine;
        const boundingWidth = rawHalfLength * sine + rawHalfWidth * cosine;
        const containmentScale = Math.min(
          1,
          availableLength / (2 * boundingLength),
          availableWidth / (2 * boundingWidth),
        );
        const halfLength = rawHalfLength * containmentScale;
        const halfWidth = rawHalfWidth * containmentScale;
        const settlement = (random() * 2 - 1) * definition.units.settlementMeters;
        const tiltDegrees: [number, number] = [
          (random() * 2 - 1) * definition.units.tiltDegrees,
          (random() * 2 - 1) * definition.units.tiltDegrees,
        ];
        const centreTuple: [number, number] = [centre.x, centre.z];
        const repairPatch = definition.repairPatches.find((patch) =>
          insidePatch(centreTuple, patch),
        );
        const materialPool = repairPatch?.materialIds ?? definition.materials.stoneIds;
        const materialId = materialPool[Math.floor(random() * materialPool.length)]!;
        const chipped = random() < definition.units.chipProbability;
        const chipDepth = chipped ? random() * definition.units.maximumChipDepthMeters : 0;
        const plan = irregularPlan(
          centre,
          halfLength,
          halfWidth,
          yawRadians + (alongX ? 0 : Math.PI / 2),
          definition.units.cornerJitterMeters + chipDepth,
          random,
        );
        parts.push(
          pavingStonePart({
            plan,
            centre,
            bottomY: definition.baseY - definition.units.heightMeters,
            topY: definition.baseY + settlement + (repairPatch?.settlementBiasMeters ?? 0),
            chamferMeters: definition.units.chamferMeters,
            tiltRadians: [(tiltDegrees[0] * Math.PI) / 180, (tiltDegrees[1] * Math.PI) / 180],
            materialId,
          }),
        );
        stones.push({
          id: `stone-${course}-${unit}`,
          course,
          materialId,
          centre: centreTuple,
          lengthMeters: halfLength * 2,
          widthMeters: halfWidth * 2,
          yawDegrees,
          settlementMeters: settlement + (repairPatch?.settlementBiasMeters ?? 0),
          tiltDegrees,
          ...(repairPatch ? { repairPatchId: repairPatch.id } : {}),
          chipped,
        });
      }
      cursorU += cellLength;
      unit += 1;
    }
    cursorV = courseMaximumV;
    course += 1;
  }
  parts.push(...definition.borders.map((border) => borderPart(definition, border)));
  const geometry = mergeMeshParts(
    definition.id,
    parts,
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.irregular-paving.v1',
      definition,
      stones,
      wetReceiverMaterialIds: definition.drainage.wetReceiverMaterialIds,
    },
  );
  for (const anchorId of definition.drainage.runoffAnchorIds)
    geometry.attachments[anchorId] = {
      position: [
        definition.drainage.fall[0] >= 0 ? maximumX : minimumX,
        definition.baseY,
        definition.drainage.fall[1] >= 0 ? maximumZ : minimumZ,
      ],
      rotation: [0, 0, 0],
      bone: 'root',
    };
  const materialIds = new Set([
    ...definition.materials.stoneIds,
    definition.materials.substrateId,
    definition.materials.kerbId,
    definition.materials.gutterId,
    definition.joints.materialId,
    ...definition.borders.map((border) => border.materialId),
    ...definition.repairPatches.flatMap((patch) => patch.materialIds),
  ]);
  geometry.materials = [...materialIds].sort().map(basicMaterial);

  const supportGeometry = mergeMeshParts(
    `${definition.id}.support`,
    [
      boxPart(
        [minimumX, definition.baseY - 0.025, minimumZ],
        [maximumX, definition.baseY, maximumZ],
        0,
        definition.joints.materialId,
      ),
    ],
    [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
    {
      generator: 'videoer.irregular-paving-support.v1',
      sourcePavingId: definition.id,
      maximumStepMeters: definition.walkability.maximumStepMeters,
      maximumSlopeDegrees: definition.walkability.maximumSlopeDegrees,
    },
  );
  supportGeometry.materials = [basicMaterial(definition.joints.materialId, 0)];
  const support = createTriangleSurfaceQuery(supportGeometry);
  let supportSamples = 0;
  let supportHits = 0;
  for (let xIndex = 0; xIndex < 5; xIndex++)
    for (let zIndex = 0; zIndex < 5; zIndex++) {
      const x = minimumX + ((maximumX - minimumX) * (xIndex + 0.5)) / 5;
      const z = minimumZ + ((maximumZ - minimumZ) * (zIndex + 0.5)) / 5;
      supportSamples += 1;
      if (support.query(x, z)) supportHits += 1;
    }
  const settlements = stones.map((stone) => stone.settlementMeters);
  const signatures = new Set(
    stones.map((stone) =>
      [stone.lengthMeters, stone.widthMeters, stone.yawDegrees, stone.settlementMeters]
        .map((value) => value.toFixed(3))
        .join(':'),
    ),
  );
  const maximumObservedStepMeters =
    settlements.length > 0 ? Math.max(...settlements) - Math.min(...settlements) : 0;
  const repairPatchStoneCounts = Object.fromEntries(
    definition.repairPatches.map((patch) => [
      patch.id,
      stones.filter((stone) => stone.repairPatchId === patch.id).length,
    ]),
  );
  const digestInput = JSON.stringify({ definition, geometry, supportGeometry });
  const report: IrregularPavingReport = {
    definitionId: definition.id,
    deterministicSha256: createHash('sha256').update(digestInput).digest('hex'),
    geometryValid: validateGeometry(geometry).valid,
    supportGeometryValid: validateGeometry(supportGeometry).valid,
    stoneCount: stones.length,
    courseCount: course,
    uniqueFootprintSignatures: signatures.size,
    settlementRangeMeters: settlements.length
      ? [Math.min(...settlements), Math.max(...settlements)]
      : [0, 0],
    maximumObservedStepMeters,
    maximumObservedTiltDegrees: Math.max(
      0,
      ...stones.flatMap((stone) => stone.tiltDegrees.map(Math.abs)),
    ),
    repairPatchStoneCounts,
    supportQueryCoverage: { samples: supportSamples, hits: supportHits },
    wetReceiverMaterialIds: definition.drainage.wetReceiverMaterialIds,
    stones,
  };
  return { definition, geometry, supportGeometry, report };
}

export function createHistoricSettPavingDefinition(): IrregularPavingDefinition {
  return irregularPavingDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'environment.historic-granite-sett-paving',
    seed: 1847,
    detailTier: 'medium',
    boundary: { kind: 'rectangle', minimum: [-4.6, -4.8], maximum: [4.6, -0.45] },
    baseY: 0,
    courses: {
      directionDegrees: 0,
      nominalWidthMeters: 0.2,
      widthVariation: 0.14,
      staggerFraction: 0.48,
      edgeJitterMeters: 0.007,
    },
    units: {
      profile: 'irregular-sett',
      nominalLengthMeters: 0.25,
      lengthVariation: 0.18,
      widthVariation: 0.12,
      cornerJitterMeters: 0.009,
      yawVariationDegrees: 2.2,
      settlementMeters: 0.004,
      tiltDegrees: 0.55,
      heightMeters: 0.075,
      chamferMeters: 0.006,
      chipProbability: 0.22,
      maximumChipDepthMeters: 0.004,
    },
    joints: { widthMeters: 0.01, depthMeters: 0.006, materialId: 'dark-grit-joint' },
    borders: [
      {
        id: 'shop-kerb',
        kind: 'kerb',
        side: 'maximum-z',
        widthMeters: 0.24,
        riseMeters: 0.09,
        fallDegrees: 1.5,
        materialId: 'granite-kerb',
      },
      {
        id: 'street-gutter',
        kind: 'gutter',
        side: 'minimum-z',
        widthMeters: 0.34,
        riseMeters: -0.025,
        fallDegrees: 3.2,
        materialId: 'dark-stone-gutter',
      },
    ],
    repairPatches: [
      {
        id: 'older-repair',
        minimum: [-2.8, -3.55],
        maximum: [-0.45, -2.05],
        settlementBiasMeters: -0.006,
        materialIds: ['warm-repair-stone', 'dark-repair-stone'],
      },
    ],
    materials: {
      stoneIds: ['wet-granite-a', 'wet-granite-b', 'wet-granite-c'],
      substrateId: 'dark-grit-joint',
      kerbId: 'granite-kerb',
      gutterId: 'dark-stone-gutter',
    },
    drainage: {
      fall: [0.12, -1],
      wetReceiverMaterialIds: [
        'wet-granite-a',
        'wet-granite-b',
        'wet-granite-c',
        'warm-repair-stone',
        'dark-repair-stone',
        'granite-kerb',
        'dark-stone-gutter',
      ],
      runoffAnchorIds: ['gutter-outfall'],
    },
    walkability: { maximumStepMeters: 0.035, maximumSlopeDegrees: 6 },
    metadata: { hostClass: 'historic-masonry-shopfront', transferFixture: true },
  });
}

export function createContemporaryPaverDefinition(): IrregularPavingDefinition {
  return irregularPavingDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'environment.contemporary-repaired-paver-field',
    seed: 90211,
    detailTier: 'medium',
    boundary: { kind: 'rectangle', minimum: [-5.2, -5.1], maximum: [5.2, -0.55] },
    baseY: 0,
    courses: {
      directionDegrees: 90,
      nominalWidthMeters: 0.3,
      widthVariation: 0.1,
      staggerFraction: 0.34,
      edgeJitterMeters: 0.004,
    },
    units: {
      profile: 'irregular-paver',
      nominalLengthMeters: 0.42,
      lengthVariation: 0.1,
      widthVariation: 0.07,
      cornerJitterMeters: 0.005,
      yawVariationDegrees: 0.8,
      settlementMeters: 0.0025,
      tiltDegrees: 0.3,
      heightMeters: 0.065,
      chamferMeters: 0.004,
      chipProbability: 0.08,
      maximumChipDepthMeters: 0.003,
    },
    joints: { widthMeters: 0.008, depthMeters: 0.004, materialId: 'polymeric-dark-joint' },
    borders: [
      {
        id: 'channel-drain',
        kind: 'gutter',
        side: 'maximum-z',
        widthMeters: 0.18,
        riseMeters: -0.012,
        fallDegrees: 2.4,
        materialId: 'linear-channel-stone',
      },
      {
        id: 'street-edge',
        kind: 'soldier-course',
        side: 'minimum-z',
        widthMeters: 0.28,
        riseMeters: 0.015,
        fallDegrees: 1.1,
        materialId: 'contemporary-kerb',
      },
    ],
    repairPatches: [
      {
        id: 'utility-reinstatement',
        minimum: [1.15, -4.45],
        maximum: [3.65, -2.4],
        settlementBiasMeters: -0.003,
        materialIds: ['reinstatement-paver-a', 'reinstatement-paver-b'],
      },
    ],
    materials: {
      stoneIds: ['concrete-paver-a', 'concrete-paver-b', 'concrete-paver-c'],
      substrateId: 'polymeric-dark-joint',
      kerbId: 'contemporary-kerb',
      gutterId: 'linear-channel-stone',
    },
    drainage: {
      fall: [-0.08, 1],
      wetReceiverMaterialIds: [
        'concrete-paver-a',
        'concrete-paver-b',
        'concrete-paver-c',
        'reinstatement-paver-a',
        'reinstatement-paver-b',
        'contemporary-kerb',
        'linear-channel-stone',
      ],
      runoffAnchorIds: ['channel-outfall'],
    },
    walkability: { maximumStepMeters: 0.022, maximumSlopeDegrees: 4 },
    metadata: { hostClass: 'contemporary-plaster-mixed-use', transferFixture: true },
  });
}
