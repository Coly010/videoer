import { z } from 'zod';
import { canonicalSha256 } from '../assets/sources/cache.js';
import type { SceneTransform } from '../interactions/model.js';
import {
  surfaceWaterFieldSchema,
  verifyStaticSurfaceWaterField,
  type SurfaceWaterField,
} from './surface-water.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u);
const localIdentifier = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const vec2 = z.tuple([z.number().finite(), z.number().finite()]);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const surfaceHistoryTrafficPathSchema = z
  .object({
    id: localIdentifier,
    kind: z.enum(['pedestrian', 'vehicle-left-wheel', 'vehicle-right-wheel']),
    localPoints: z.array(vec2).min(2),
    halfWidthMeters: z.number().positive().max(10),
    falloffMeters: z.number().positive().max(10),
    equivalentPasses: z.number().nonnegative().max(1_000_000_000),
    wearPerPass: z.number().positive().max(1),
  })
  .superRefine((path, context) => {
    if (
      path.localPoints.every(
        (point) =>
          Math.hypot(point[0] - path.localPoints[0]![0], point[1] - path.localPoints[0]![1]) < 1e-9,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['localPoints'],
        message: 'traffic path must contain at least two non-coincident points',
      });
  });

export const surfaceHistoryProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    referenceDate: z.string().date(),
    installationAgeYears: z.number().nonnegative().max(1_000),
    trafficPaths: z.array(surfaceHistoryTrafficPathSchema).default([]),
    repairs: z
      .array(
        z.object({
          id: localIdentifier,
          ageYears: z.number().nonnegative().max(1_000),
        }),
      )
      .default([]),
    runoff: z.object({
      referenceDepthMeters: z.number().positive().max(1),
      edgeWeight: z.number().min(0).max(4).default(1),
      puddleWeight: z.number().min(0).max(4).default(0.5),
    }),
  })
  .superRefine((profile, context) => {
    for (const [field, values] of [
      ['trafficPaths', profile.trafficPaths.map((path) => path.id)],
      ['repairs', profile.repairs.map((repair) => repair.id)],
    ] as const)
      if (new Set(values).size !== values.length)
        context.addIssue({ code: 'custom', path: [field], message: `${field} ids must be unique` });
    for (const [index, repair] of profile.repairs.entries())
      if (repair.ageYears > profile.installationAgeYears)
        context.addIssue({
          code: 'custom',
          path: ['repairs', index, 'ageYears'],
          message: 'repair age cannot exceed installation age',
        });
  });

export type SurfaceHistoryProfile = z.infer<typeof surfaceHistoryProfileSchema>;

const repairPatchSchema = z.object({ id: localIdentifier, minimum: vec2, maximum: vec2 });

export const surfaceHistoryInputSchema = z.object({
  profile: surfaceHistoryProfileSchema,
  sourceWaterField: surfaceWaterFieldSchema,
  repairPatches: z.array(repairPatchSchema),
});

export type SurfaceHistoryInput = z.infer<typeof surfaceHistoryInputSchema>;

const surfaceHistoryCellSchema = z.object({
  index: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  worldPosition: vec3,
  triangleIndex: z.number().int().nonnegative(),
  materialId: localIdentifier,
  targetClass: z.enum(['modeled-unit', 'joint', 'substrate', 'border']),
  coverage: z.number().min(0).max(1),
  trafficWear: z.number().min(0).max(1),
  longTermExposure: z.number().min(0).max(1),
  runoffStaining: z.number().min(0).max(1),
  repairInfluence: z.number().min(0).max(1),
  repairId: localIdentifier.nullable(),
  repairRelativeAge: z.number().min(0).max(1),
});

export const surfaceHistoryFieldSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  generator: z.literal('videoer.construction-surface-history.v1'),
  inputSha256: sha256,
  fieldSha256: sha256,
  referenceDate: z.string().date(),
  installationAgeYears: z.number().nonnegative(),
  receiver: surfaceWaterFieldSchema.shape.receiver,
  sourceWaterField: z.object({ id: identifier, fieldSha256: sha256 }),
  grid: surfaceWaterFieldSchema.shape.grid,
  profileSha256: sha256,
  cells: z.array(surfaceHistoryCellSchema),
});

export type SurfaceHistoryField = z.infer<typeof surfaceHistoryFieldSchema>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function inverseTransformPoint(
  point: readonly [number, number, number],
  transform: SceneTransform,
): [number, number, number] {
  let x = point[0] - transform.position[0];
  let y = point[1] - transform.position[1];
  let zValue = point[2] - transform.position[2];
  const [rx, ry, rz] = transform.rotation;
  [x, y] = [x * Math.cos(rz) + y * Math.sin(rz), -x * Math.sin(rz) + y * Math.cos(rz)];
  [x, zValue] = [
    x * Math.cos(ry) - zValue * Math.sin(ry),
    x * Math.sin(ry) + zValue * Math.cos(ry),
  ];
  [y, zValue] = [
    y * Math.cos(rx) + zValue * Math.sin(rx),
    -y * Math.sin(rx) + zValue * Math.cos(rx),
  ];
  return [x / transform.scale[0], y / transform.scale[1], zValue / transform.scale[2]];
}

function pointSegmentDistance(
  point: readonly number[],
  a: readonly number[],
  b: readonly number[],
) {
  const dx = b[0]! - a[0]!;
  const dz = b[1]! - a[1]!;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-18) return Math.hypot(point[0]! - a[0]!, point[1]! - a[1]!);
  const t = clamp01(((point[0]! - a[0]!) * dx + (point[1]! - a[1]!) * dz) / lengthSquared);
  return Math.hypot(point[0]! - (a[0]! + dx * t), point[1]! - (a[1]! + dz * t));
}

function pathWear(point: readonly number[], path: z.infer<typeof surfaceHistoryTrafficPathSchema>) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.localPoints.length; index += 1)
    distance = Math.min(
      distance,
      pointSegmentDistance(point, path.localPoints[index - 1]!, path.localPoints[index]!),
    );
  const outside = Math.max(0, distance - path.halfWidthMeters);
  if (outside >= path.falloffMeters * 4) return 0;
  const lateral = Math.exp(-0.5 * (outside / path.falloffMeters) ** 2);
  return 1 - Math.exp(-path.wearPerPass * path.equivalentPasses * lateral);
}

export function compileSurfaceHistory(inputValue: SurfaceHistoryInput): SurfaceHistoryField {
  const input = surfaceHistoryInputSchema.parse(inputValue);
  const waterVerification = verifyStaticSurfaceWaterField(input.sourceWaterField);
  if (!waterVerification.valid)
    throw new Error(
      `source surface-water field is invalid: ${waterVerification.issues.join('; ')}`,
    );
  const water = waterVerification.field;
  const repairIds = new Set(input.repairPatches.map((patch) => patch.id));
  for (const repair of input.profile.repairs)
    if (!repairIds.has(repair.id))
      throw new Error(`surface-history repair '${repair.id}' is not live`);
  const repairProfile = new Map(input.profile.repairs.map((repair) => [repair.id, repair]));
  const cells = water.cells.map((cell) => {
    const local = inverseTransformPoint(cell.worldPosition, water.receiver.transform);
    let combinedSurvival = 1;
    for (const path of input.profile.trafficPaths)
      combinedSurvival *= 1 - pathWear([local[0], local[2]], path);
    const patch = input.repairPatches.find(
      (candidate) =>
        local[0] >= candidate.minimum[0] &&
        local[0] <= candidate.maximum[0] &&
        local[2] >= candidate.minimum[1] &&
        local[2] <= candidate.maximum[1],
    );
    const repair = patch ? repairProfile.get(patch.id) : undefined;
    const runoffDose =
      cell.runoffDepthMeters +
      cell.edgeAccumulationDepthMeters * input.profile.runoff.edgeWeight +
      cell.puddleDepthMeters * input.profile.runoff.puddleWeight;
    return {
      index: cell.index,
      column: cell.column,
      row: cell.row,
      worldPosition: cell.worldPosition,
      triangleIndex: cell.triangleIndex,
      materialId: cell.materialId,
      targetClass: cell.targetClass,
      coverage: cell.coverage,
      trafficWear: clamp01(1 - combinedSurvival),
      longTermExposure: cell.exposure,
      runoffStaining: clamp01(runoffDose / input.profile.runoff.referenceDepthMeters),
      repairInfluence: repair ? 1 : 0,
      repairId: repair?.id ?? null,
      repairRelativeAge:
        repair && input.profile.installationAgeYears > 0
          ? clamp01(repair.ageYears / input.profile.installationAgeYears)
          : 0,
    };
  });
  const profileSha256 = canonicalSha256(input.profile);
  const inputSha256 = canonicalSha256({
    profileSha256,
    sourceWaterFieldSha256: water.fieldSha256,
    repairPatches: input.repairPatches,
  });
  const withoutHash = {
    schemaVersion: 1 as const,
    id: input.profile.id,
    generator: 'videoer.construction-surface-history.v1' as const,
    inputSha256,
    referenceDate: input.profile.referenceDate,
    installationAgeYears: input.profile.installationAgeYears,
    receiver: water.receiver,
    sourceWaterField: { id: water.id, fieldSha256: water.fieldSha256 },
    grid: water.grid,
    profileSha256,
    cells,
  };
  return surfaceHistoryFieldSchema.parse({
    ...withoutHash,
    fieldSha256: canonicalSha256(withoutHash),
  });
}

export function verifySurfaceHistoryField(value: unknown, sourceWater?: SurfaceWaterField) {
  const field = surfaceHistoryFieldSchema.parse(value);
  const { fieldSha256, ...withoutHash } = field;
  const issues: string[] = [];
  const expectedFieldSha256 = canonicalSha256(withoutHash);
  if (fieldSha256 !== expectedFieldSha256)
    issues.push(
      `surface-history field hash mismatch: expected ${expectedFieldSha256}, got ${fieldSha256}`,
    );
  if (field.cells.length !== field.grid.activeCellCount)
    issues.push('surface-history cell count does not equal declared active cell count');
  if (sourceWater) {
    const verification = verifyStaticSurfaceWaterField(sourceWater);
    if (!verification.valid) issues.push(...verification.issues.map((issue) => `source: ${issue}`));
    if (
      field.sourceWaterField.id !== sourceWater.id ||
      field.sourceWaterField.fieldSha256 !== sourceWater.fieldSha256
    )
      issues.push('surface-history source-water identity mismatch');
    if (canonicalSha256(field.receiver) !== canonicalSha256(sourceWater.receiver))
      issues.push('surface-history receiver identity mismatch');
    if (canonicalSha256(field.grid) !== canonicalSha256(sourceWater.grid))
      issues.push('surface-history grid identity mismatch');
    if (field.cells.length !== sourceWater.cells.length)
      issues.push('surface-history topology length mismatch');
    else
      for (let index = 0; index < field.cells.length; index += 1) {
        const history = field.cells[index]!;
        const water = sourceWater.cells[index]!;
        if (
          history.index !== water.index ||
          history.row !== water.row ||
          history.column !== water.column ||
          history.triangleIndex !== water.triangleIndex ||
          history.materialId !== water.materialId ||
          canonicalSha256(history.worldPosition) !== canonicalSha256(water.worldPosition)
        ) {
          issues.push(`surface-history topology mismatch at cell ${index}`);
          break;
        }
      }
  }
  return { valid: issues.length === 0, issues, field, expectedFieldSha256 };
}
