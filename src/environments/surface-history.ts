import { z } from 'zod';
import { canonicalSha256 } from '../assets/sources/cache.js';
import type { SceneTransform } from '../interactions/model.js';
import {
  surfaceWaterFieldSchema,
  surfaceWaterFieldV2Schema,
  verifyStaticSurfaceWaterField,
  verifyStaticSurfaceWaterFieldV2,
  type SurfaceWaterField,
  type SurfaceWaterFieldV2,
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

const surfaceHistoryProfileObjectSchema = z.object({
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
});

function validateHistoryProfile(
  profile: {
    installationAgeYears: number;
    trafficPaths: Array<{ id: string }>;
    repairs: Array<{ id: string; ageYears: number }>;
  },
  context: z.RefinementCtx,
) {
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
}

export const surfaceHistoryProfileSchema =
  surfaceHistoryProfileObjectSchema.superRefine(validateHistoryProfile);

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

export const surfaceHistoryV2ProfileSchema = surfaceHistoryProfileObjectSchema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(2),
    dirt: z.object({
      materialResponses: z.record(
        localIdentifier,
        z.object({
          loadingKilogramsPerSquareMeterPerYear: z.number().nonnegative().max(100),
          persistentFraction: z.number().min(0).max(1),
          washoffCoefficientPerMeter: z.number().nonnegative().max(1_000_000),
          transportCaptureFraction: z.number().min(0).max(1),
          looseCoverageReferenceKilogramsPerSquareMeter: z.number().positive().max(20),
          persistentCoverageReferenceKilogramsPerSquareMeter: z.number().positive().max(20),
        }),
      ),
    }),
  })
  .superRefine(validateHistoryProfile);

export type SurfaceHistoryV2Profile = z.infer<typeof surfaceHistoryV2ProfileSchema>;

const surfaceHistoryV2CellSchema = surfaceHistoryCellSchema.extend({
  dirt: z.object({
    builtUpMassKilograms: z.number().nonnegative(),
    persistentMassKilograms: z.number().nonnegative(),
    initialLooseMassKilograms: z.number().nonnegative(),
    incomingSuspendedMassKilograms: z.number().nonnegative(),
    mobilizedMassKilograms: z.number().nonnegative(),
    depositedMassKilograms: z.number().nonnegative(),
    finalLooseMassKilograms: z.number().nonnegative(),
    suspendedOutflowMassKilograms: z.number().nonnegative(),
    looseCoverage: z.number().min(0).max(1),
    persistentCoverage: z.number().min(0).max(1),
  }),
});

export const surfaceHistoryFieldV2Schema = surfaceHistoryFieldSchema
  .omit({
    schemaVersion: true,
    generator: true,
    fieldSha256: true,
    sourceWaterField: true,
    cells: true,
  })
  .extend({
    schemaVersion: z.literal(2),
    generator: z.literal('videoer.construction-surface-history.v2'),
    fieldSha256: sha256,
    sourceWaterField: z.object({ id: identifier, fieldSha256: sha256, routingSha256: sha256 }),
    cells: z.array(surfaceHistoryV2CellSchema),
    dirtMassBalance: z.object({
      inputKilograms: z.number().nonnegative(),
      persistentKilograms: z.number().nonnegative(),
      looseKilograms: z.number().nonnegative(),
      exportedKilograms: z.number().nonnegative(),
      mobilizedKilograms: z.number().nonnegative(),
      depositedKilograms: z.number().nonnegative(),
      errorKilograms: z.number(),
    }),
  });

export type SurfaceHistoryFieldV2 = z.infer<typeof surfaceHistoryFieldV2Schema>;
const surfaceHistoryFieldV2WithoutHashSchema = surfaceHistoryFieldV2Schema.omit({
  fieldSha256: true,
});

export const surfaceHistoryV2InputSchema = z.object({
  profile: surfaceHistoryV2ProfileSchema,
  sourceWaterField: surfaceWaterFieldV2Schema,
  repairPatches: z.array(repairPatchSchema),
});

export type SurfaceHistoryV2Input = z.infer<typeof surfaceHistoryV2InputSchema>;

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

export function compileSurfaceHistoryV2(inputValue: SurfaceHistoryV2Input): SurfaceHistoryFieldV2 {
  const input = surfaceHistoryV2InputSchema.parse(inputValue);
  const waterVerification = verifyStaticSurfaceWaterFieldV2(input.sourceWaterField);
  if (!waterVerification.valid)
    throw new Error(
      `source surface-water v2 field is invalid: ${waterVerification.issues.join('; ')}`,
    );
  const water = waterVerification.field;
  const repairIds = new Set(input.repairPatches.map((patch) => patch.id));
  const repairProfile = new Map(input.profile.repairs.map((repair) => [repair.id, repair]));
  for (const patch of input.repairPatches)
    if (!repairProfile.has(patch.id))
      throw new Error(`surface-history v2 requires an explicit age for repair '${patch.id}'`);
  for (const repair of input.profile.repairs)
    if (!repairIds.has(repair.id))
      throw new Error(`surface-history repair '${repair.id}' is not live`);
  const materialResponses = new Map(Object.entries(input.profile.dirt.materialResponses));
  for (const materialId of new Set(water.cells.map((cell) => cell.materialId)))
    if (!materialResponses.has(materialId))
      throw new Error(`surface-history dirt response is missing for material '${materialId}'`);
  const baseByIndex = new Map<
    number,
    z.infer<typeof surfaceHistoryCellSchema> & {
      local: [number, number, number];
      effectiveAgeYears: number;
    }
  >();
  for (const cell of water.cells) {
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
    baseByIndex.set(cell.index, {
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
      local,
      effectiveAgeYears: repair?.ageYears ?? input.profile.installationAgeYears,
    });
  }
  const stateByIndex = new Map<
    number,
    {
      builtUp: number;
      persistent: number;
      initialLoose: number;
      incoming: number;
      mobilized: number;
      deposited: number;
      finalLoose: number;
      outflow: number;
      looseReference: number;
      persistentReference: number;
    }
  >();
  for (const cell of water.cells) {
    const base = baseByIndex.get(cell.index)!;
    const response = materialResponses.get(cell.materialId)!;
    const area = water.grid.cellSizeMeters ** 2 * cell.coverage;
    const builtUp = response.loadingKilogramsPerSquareMeterPerYear * base.effectiveAgeYears * area;
    const persistent = builtUp * response.persistentFraction;
    const initialLoose = builtUp - persistent;
    const mobilized =
      initialLoose * (1 - Math.exp(-response.washoffCoefficientPerMeter * cell.runoffDepthMeters));
    stateByIndex.set(cell.index, {
      builtUp,
      persistent,
      initialLoose,
      incoming: 0,
      mobilized,
      deposited: 0,
      finalLoose: 0,
      outflow: 0,
      looseReference: response.looseCoverageReferenceKilogramsPerSquareMeter * area,
      persistentReference: response.persistentCoverageReferenceKilogramsPerSquareMeter * area,
    });
  }
  let exportedKilograms = 0;
  for (const node of [...water.routing.nodes].sort(
    (left, right) => right.rank - left.rank || left.index - right.index,
  )) {
    const state = stateByIndex.get(node.index)!;
    const response = materialResponses.get(baseByIndex.get(node.index)!.materialId)!;
    const stream = state.incoming + state.mobilized;
    state.deposited = stream * response.transportCaptureFraction;
    state.outflow = stream - state.deposited;
    state.finalLoose = state.initialLoose - state.mobilized + state.deposited;
    if (node.downstreamIndex === null) exportedKilograms += state.outflow;
    else stateByIndex.get(node.downstreamIndex)!.incoming += state.outflow;
  }
  const cells = water.cells.map((cell) => {
    const base = surfaceHistoryCellSchema.parse(baseByIndex.get(cell.index)!);
    const state = stateByIndex.get(cell.index)!;
    return {
      ...base,
      dirt: {
        builtUpMassKilograms: state.builtUp,
        persistentMassKilograms: state.persistent,
        initialLooseMassKilograms: state.initialLoose,
        incomingSuspendedMassKilograms: state.incoming,
        mobilizedMassKilograms: state.mobilized,
        depositedMassKilograms: state.deposited,
        finalLooseMassKilograms: state.finalLoose,
        suspendedOutflowMassKilograms: state.outflow,
        looseCoverage:
          state.looseReference > 0
            ? clamp01(1 - Math.exp(-state.finalLoose / state.looseReference))
            : 0,
        persistentCoverage:
          state.persistentReference > 0
            ? clamp01(1 - Math.exp(-state.persistent / state.persistentReference))
            : 0,
      },
    };
  });
  const inputKilograms = cells.reduce((sum, cell) => sum + cell.dirt.builtUpMassKilograms, 0);
  const persistentKilograms = cells.reduce(
    (sum, cell) => sum + cell.dirt.persistentMassKilograms,
    0,
  );
  const looseKilograms = cells.reduce((sum, cell) => sum + cell.dirt.finalLooseMassKilograms, 0);
  const mobilizedKilograms = cells.reduce((sum, cell) => sum + cell.dirt.mobilizedMassKilograms, 0);
  const depositedKilograms = cells.reduce((sum, cell) => sum + cell.dirt.depositedMassKilograms, 0);
  const errorKilograms =
    inputKilograms - (persistentKilograms + looseKilograms + exportedKilograms);
  const tolerance = Math.max(1e-12, inputKilograms * 1e-10);
  if (Math.abs(errorKilograms) > tolerance)
    throw new Error(
      `surface-history dirt mass balance error ${errorKilograms} exceeds ${tolerance}`,
    );
  for (const cell of cells) {
    const dirt = cell.dirt;
    const cellError =
      dirt.initialLooseMassKilograms +
      dirt.incomingSuspendedMassKilograms -
      (dirt.finalLooseMassKilograms + dirt.suspendedOutflowMassKilograms);
    if (Math.abs(cellError) > Math.max(1e-12, dirt.initialLooseMassKilograms * 1e-10))
      throw new Error(`surface-history dirt cell ${cell.index} does not conserve loose mass`);
  }
  const profileSha256 = canonicalSha256(input.profile);
  const inputSha256 = canonicalSha256({
    profileSha256,
    sourceWaterFieldSha256: water.fieldSha256,
    routingSha256: water.routing.routingSha256,
    repairPatches: input.repairPatches,
  });
  const withoutHash = {
    schemaVersion: 2 as const,
    id: input.profile.id,
    generator: 'videoer.construction-surface-history.v2' as const,
    inputSha256,
    referenceDate: input.profile.referenceDate,
    installationAgeYears: input.profile.installationAgeYears,
    receiver: water.receiver,
    sourceWaterField: {
      id: water.id,
      fieldSha256: water.fieldSha256,
      routingSha256: water.routing.routingSha256,
    },
    grid: water.grid,
    profileSha256,
    cells,
    dirtMassBalance: {
      inputKilograms,
      persistentKilograms,
      looseKilograms,
      exportedKilograms,
      mobilizedKilograms,
      depositedKilograms,
      errorKilograms,
    },
  };
  const canonicalField = surfaceHistoryFieldV2WithoutHashSchema.parse(withoutHash);
  return surfaceHistoryFieldV2Schema.parse({
    ...canonicalField,
    fieldSha256: canonicalSha256(canonicalField),
  });
}

export function verifySurfaceHistoryFieldV2(value: unknown, sourceWater?: SurfaceWaterFieldV2) {
  const field = surfaceHistoryFieldV2Schema.parse(value);
  const { fieldSha256, ...withoutHash } = field;
  const issues: string[] = [];
  const expectedFieldSha256 = canonicalSha256(withoutHash);
  if (fieldSha256 !== expectedFieldSha256)
    issues.push(
      `surface-history v2 field hash mismatch: expected ${expectedFieldSha256}, got ${fieldSha256}`,
    );
  const accounted =
    field.dirtMassBalance.persistentKilograms +
    field.dirtMassBalance.looseKilograms +
    field.dirtMassBalance.exportedKilograms;
  const error = field.dirtMassBalance.inputKilograms - accounted;
  const tolerance = Math.max(1e-12, field.dirtMassBalance.inputKilograms * 1e-10);
  if (
    Math.abs(error) > tolerance ||
    Math.abs(error - field.dirtMassBalance.errorKilograms) > tolerance
  )
    issues.push(`surface-history v2 dirt mass balance is invalid by ${error} kilograms`);
  const measuredTotals = {
    inputKilograms: field.cells.reduce((sum, cell) => sum + cell.dirt.builtUpMassKilograms, 0),
    persistentKilograms: field.cells.reduce(
      (sum, cell) => sum + cell.dirt.persistentMassKilograms,
      0,
    ),
    looseKilograms: field.cells.reduce((sum, cell) => sum + cell.dirt.finalLooseMassKilograms, 0),
    mobilizedKilograms: field.cells.reduce(
      (sum, cell) => sum + cell.dirt.mobilizedMassKilograms,
      0,
    ),
    depositedKilograms: field.cells.reduce(
      (sum, cell) => sum + cell.dirt.depositedMassKilograms,
      0,
    ),
  };
  for (const [channel, measured] of Object.entries(measuredTotals) as Array<
    [keyof typeof measuredTotals, number]
  >)
    if (Math.abs(field.dirtMassBalance[channel] - measured) > tolerance)
      issues.push(`surface-history v2 dirt total '${channel}' differs from its cells`);
  for (const cell of field.cells) {
    const dirt = cell.dirt;
    const cellTolerance = Math.max(1e-12, dirt.builtUpMassKilograms * 1e-10);
    if (
      Math.abs(
        dirt.builtUpMassKilograms - (dirt.persistentMassKilograms + dirt.initialLooseMassKilograms),
      ) > cellTolerance
    )
      issues.push(`surface-history v2 dirt cell ${cell.index} violates buildup partition`);
    if (dirt.mobilizedMassKilograms > dirt.initialLooseMassKilograms + cellTolerance)
      issues.push(`surface-history v2 dirt cell ${cell.index} mobilizes unavailable mass`);
    if (
      Math.abs(
        dirt.incomingSuspendedMassKilograms +
          dirt.mobilizedMassKilograms -
          dirt.depositedMassKilograms -
          dirt.suspendedOutflowMassKilograms,
      ) > cellTolerance
    )
      issues.push(`surface-history v2 dirt cell ${cell.index} violates transport balance`);
    const cellError =
      dirt.initialLooseMassKilograms +
      dirt.incomingSuspendedMassKilograms -
      (dirt.finalLooseMassKilograms + dirt.suspendedOutflowMassKilograms);
    if (Math.abs(cellError) > Math.max(1e-12, dirt.initialLooseMassKilograms * 1e-10))
      issues.push(`surface-history v2 dirt cell ${cell.index} violates loose-mass balance`);
  }
  if (sourceWater) {
    const verification = verifyStaticSurfaceWaterFieldV2(sourceWater);
    if (!verification.valid) issues.push(...verification.issues.map((issue) => `water: ${issue}`));
    if (
      field.sourceWaterField.id !== sourceWater.id ||
      field.sourceWaterField.fieldSha256 !== sourceWater.fieldSha256 ||
      field.sourceWaterField.routingSha256 !== sourceWater.routing.routingSha256
    )
      issues.push('surface-history v2 source-water identity mismatch');
    if (canonicalSha256(field.receiver) !== canonicalSha256(sourceWater.receiver))
      issues.push('surface-history v2 receiver identity mismatch');
    if (canonicalSha256(field.grid) !== canonicalSha256(sourceWater.grid))
      issues.push('surface-history v2 grid identity mismatch');
    if (field.cells.length !== sourceWater.cells.length)
      issues.push('surface-history v2 topology length mismatch');
    else
      for (let index = 0; index < field.cells.length; index += 1) {
        const history = field.cells[index]!;
        const waterCell = sourceWater.cells[index]!;
        if (
          history.index !== waterCell.index ||
          history.row !== waterCell.row ||
          history.column !== waterCell.column ||
          history.triangleIndex !== waterCell.triangleIndex ||
          history.materialId !== waterCell.materialId ||
          history.targetClass !== waterCell.targetClass ||
          history.coverage !== waterCell.coverage ||
          canonicalSha256(history.worldPosition) !== canonicalSha256(waterCell.worldPosition)
        ) {
          issues.push(`surface-history v2 topology mismatch at cell ${index}`);
          break;
        }
      }
    const historyByIndex = new Map(field.cells.map((cell) => [cell.index, cell]));
    const measuredExport = sourceWater.routing.nodes.reduce(
      (sum, node) =>
        node.downstreamIndex === null
          ? sum + (historyByIndex.get(node.index)?.dirt.suspendedOutflowMassKilograms ?? 0)
          : sum,
      0,
    );
    if (Math.abs(field.dirtMassBalance.exportedKilograms - measuredExport) > tolerance)
      issues.push('surface-history v2 exported dirt total differs from routing roots');
  }
  return { valid: issues.length === 0, issues, field, expectedFieldSha256 };
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
