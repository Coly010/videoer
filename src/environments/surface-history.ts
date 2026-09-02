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

export const surfaceHistoryTrafficPathV3Schema = z
  .object({
    id: localIdentifier,
    kind: z.enum(['pedestrian', 'vehicle-left-wheel', 'vehicle-right-wheel']),
    localPoints: z.array(vec2).min(2),
    halfWidthMeters: z.number().positive().max(10),
    falloffWidthMeters: z.number().positive().max(10),
    equivalentPasses: z.number().nonnegative().max(1_000_000_000),
    passesAtHalfWear: z.number().positive().max(1_000_000_000),
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

const surfaceHistoryDirtMaterialResponseSchema = z.object({
  loadingKilogramsPerSquareMeterPerYear: z.number().nonnegative().max(100),
  persistentFraction: z.number().min(0).max(1),
  washoffCoefficientPerMeter: z.number().nonnegative().max(1_000_000),
  transportCaptureFraction: z.number().min(0).max(1),
  looseCoverageReferenceKilogramsPerSquareMeter: z.number().positive().max(20),
  persistentCoverageReferenceKilogramsPerSquareMeter: z.number().positive().max(20),
});

const surfaceHistoryDirtProfileSchema = z.object({
  materialResponses: z.record(localIdentifier, surfaceHistoryDirtMaterialResponseSchema),
});

export const surfaceHistoryV2ProfileSchema = surfaceHistoryProfileObjectSchema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(2),
    dirt: surfaceHistoryDirtProfileSchema,
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

export const surfaceHistoryV3ProfileSchema = z
  .object({
    schemaVersion: z.literal(3),
    id: identifier,
    referenceDate: z.string().date(),
    installationAgeYears: z.number().nonnegative().max(1_000),
    trafficPaths: z.array(surfaceHistoryTrafficPathV3Schema).default([]),
    repairs: surfaceHistoryProfileObjectSchema.shape.repairs,
    exposure: z.object({
      yearsAtHalfResponse: z.number().positive().max(1_000),
    }),
    runoff: z.object({
      backgroundThroughflowDepthMeters: z.number().nonnegative().max(1),
      throughflowExcessDepthAtHalfResponse: z.number().positive().max(1),
      edgeWeight: z.number().min(0).max(4).default(1),
      puddleWeight: z.number().min(0).max(4).default(0.5),
      backgroundRetainedDepthMeters: z.number().nonnegative().max(1),
      retainedExcessDepthAtHalfResponse: z.number().positive().max(1),
    }),
    dirt: surfaceHistoryDirtProfileSchema,
  })
  .superRefine(validateHistoryProfile);

export type SurfaceHistoryV3Profile = z.infer<typeof surfaceHistoryV3ProfileSchema>;

const surfaceHistoryV3CellSchema = surfaceHistoryV2CellSchema
  .omit({ longTermExposure: true, runoffStaining: true })
  .extend({
    rainExposureFraction: z.number().min(0).max(1),
    shelterProtection: z.number().min(0).max(1),
    exposureWeathering: z.number().min(0).max(1),
    runoffThroughflowStaining: z.number().min(0).max(1),
    retainedWaterStaining: z.number().min(0).max(1),
    runoffStaining: z.number().min(0).max(1),
  });

export const surfaceHistoryFieldV3Schema = surfaceHistoryFieldV2Schema
  .omit({ schemaVersion: true, generator: true, fieldSha256: true, cells: true })
  .extend({
    schemaVersion: z.literal(3),
    generator: z.literal('videoer.construction-surface-history.v3'),
    fieldSha256: sha256,
    cells: z.array(surfaceHistoryV3CellSchema),
    responseModel: z.object({
      profile: surfaceHistoryV3ProfileSchema,
      repairPatches: z.array(repairPatchSchema),
    }),
  });

export type SurfaceHistoryFieldV3 = z.infer<typeof surfaceHistoryFieldV3Schema>;
const surfaceHistoryFieldV3WithoutHashSchema = surfaceHistoryFieldV3Schema.omit({
  fieldSha256: true,
});

export const surfaceHistoryV3InputSchema = z.object({
  profile: surfaceHistoryV3ProfileSchema,
  sourceWaterField: surfaceWaterFieldV2Schema,
  repairPatches: z.array(repairPatchSchema),
});

export type SurfaceHistoryV3Input = z.infer<typeof surfaceHistoryV3InputSchema>;

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

function compactPathDose(
  point: readonly number[],
  path: z.infer<typeof surfaceHistoryTrafficPathV3Schema>,
) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.localPoints.length; index += 1)
    distance = Math.min(
      distance,
      pointSegmentDistance(point, path.localPoints[index - 1]!, path.localPoints[index]!),
    );
  const outside = Math.max(0, distance - path.halfWidthMeters);
  if (outside >= path.falloffWidthMeters) return 0;
  const normalized = outside / path.falloffWidthMeters;
  const kernel = outside === 0 ? 1 : (1 - normalized * normalized) ** 2;
  return (path.equivalentPasses / path.passesAtHalfWear) * kernel;
}

export function surfaceHistoryTrafficPathDoseAtWorldPoint(
  worldPoint: readonly [number, number, number],
  transform: SceneTransform,
  pathValue: z.input<typeof surfaceHistoryTrafficPathV3Schema>,
) {
  const path = surfaceHistoryTrafficPathV3Schema.parse(pathValue);
  const local = inverseTransformPoint(worldPoint, transform);
  return compactPathDose([local[0], local[2]], path);
}

function halfResponse(excess: number, halfResponse: number) {
  return excess <= 0 ? 0 : excess / (excess + halfResponse);
}

function compileDirtMass(
  water: SurfaceWaterFieldV2,
  baseByIndex: Map<number, { materialId: string; effectiveAgeYears: number }>,
  materialResponses: Map<string, z.infer<typeof surfaceHistoryDirtMaterialResponseSchema>>,
) {
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
    const response = materialResponses.get(cell.materialId);
    if (!response)
      throw new Error(`surface-history dirt response is missing for material '${cell.materialId}'`);
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
  const dirtByIndex = new Map(
    water.cells.map((cell) => {
      const state = stateByIndex.get(cell.index)!;
      return [
        cell.index,
        {
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
      ] as const;
    }),
  );
  const dirtValues = [...dirtByIndex.values()];
  const inputKilograms = dirtValues.reduce((sum, dirt) => sum + dirt.builtUpMassKilograms, 0);
  const persistentKilograms = dirtValues.reduce(
    (sum, dirt) => sum + dirt.persistentMassKilograms,
    0,
  );
  const looseKilograms = dirtValues.reduce((sum, dirt) => sum + dirt.finalLooseMassKilograms, 0);
  const mobilizedKilograms = dirtValues.reduce((sum, dirt) => sum + dirt.mobilizedMassKilograms, 0);
  const depositedKilograms = dirtValues.reduce((sum, dirt) => sum + dirt.depositedMassKilograms, 0);
  const errorKilograms =
    inputKilograms - (persistentKilograms + looseKilograms + exportedKilograms);
  const tolerance = Math.max(1e-12, inputKilograms * 1e-10);
  if (Math.abs(errorKilograms) > tolerance)
    throw new Error(
      `surface-history dirt mass balance error ${errorKilograms} exceeds ${tolerance}`,
    );
  for (const [index, dirt] of dirtByIndex) {
    const cellError =
      dirt.initialLooseMassKilograms +
      dirt.incomingSuspendedMassKilograms -
      (dirt.finalLooseMassKilograms + dirt.suspendedOutflowMassKilograms);
    if (Math.abs(cellError) > Math.max(1e-12, dirt.initialLooseMassKilograms * 1e-10))
      throw new Error(`surface-history dirt cell ${index} does not conserve loose mass`);
  }
  return {
    dirtByIndex,
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
  const { dirtByIndex, dirtMassBalance } = compileDirtMass(water, baseByIndex, materialResponses);
  const cells = water.cells.map((cell) => {
    const base = surfaceHistoryCellSchema.parse(baseByIndex.get(cell.index)!);
    return { ...base, dirt: dirtByIndex.get(cell.index)! };
  });
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
    dirtMassBalance,
  };
  const canonicalField = surfaceHistoryFieldV2WithoutHashSchema.parse(withoutHash);
  return surfaceHistoryFieldV2Schema.parse({
    ...canonicalField,
    fieldSha256: canonicalSha256(canonicalField),
  });
}

export function canonicalSurfaceHistoryV3Profile(value: SurfaceHistoryV3Profile) {
  const profile = surfaceHistoryV3ProfileSchema.parse(value);
  return surfaceHistoryV3ProfileSchema.parse({
    ...profile,
    trafficPaths: [...profile.trafficPaths].sort((left, right) => left.id.localeCompare(right.id)),
    repairs: [...profile.repairs].sort((left, right) => left.id.localeCompare(right.id)),
    dirt: {
      materialResponses: Object.fromEntries(
        Object.entries(profile.dirt.materialResponses).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    },
  });
}

export function compileSurfaceHistoryV3(inputValue: SurfaceHistoryV3Input): SurfaceHistoryFieldV3 {
  const parsed = surfaceHistoryV3InputSchema.parse(inputValue);
  const profile = canonicalSurfaceHistoryV3Profile(parsed.profile);
  const repairPatches = [...parsed.repairPatches].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const waterVerification = verifyStaticSurfaceWaterFieldV2(parsed.sourceWaterField);
  if (!waterVerification.valid)
    throw new Error(
      `source surface-water v2 field is invalid: ${waterVerification.issues.join('; ')}`,
    );
  const water = waterVerification.field;
  const repairIds = new Set(repairPatches.map((patch) => patch.id));
  const repairProfile = new Map(profile.repairs.map((repair) => [repair.id, repair]));
  for (const patch of repairPatches)
    if (!repairProfile.has(patch.id))
      throw new Error(`surface-history v3 requires an explicit age for repair '${patch.id}'`);
  for (const repair of profile.repairs)
    if (!repairIds.has(repair.id))
      throw new Error(`surface-history repair '${repair.id}' is not live`);
  const materialResponses = new Map(Object.entries(profile.dirt.materialResponses));
  for (const materialId of new Set(water.cells.map((cell) => cell.materialId)))
    if (!materialResponses.has(materialId))
      throw new Error(`surface-history dirt response is missing for material '${materialId}'`);
  const baseByIndex = new Map<
    number,
    z.infer<typeof surfaceHistoryV3CellSchema> & {
      effectiveAgeYears: number;
    }
  >();
  for (const cell of water.cells) {
    const local = inverseTransformPoint(cell.worldPosition, water.receiver.transform);
    const trafficDose = profile.trafficPaths.reduce(
      (sum, path) => sum + compactPathDose([local[0], local[2]], path),
      0,
    );
    const patch = repairPatches.find(
      (candidate) =>
        local[0] >= candidate.minimum[0] &&
        local[0] <= candidate.maximum[0] &&
        local[2] >= candidate.minimum[1] &&
        local[2] <= candidate.maximum[1],
    );
    const repair = patch ? repairProfile.get(patch.id) : undefined;
    const effectiveAgeYears = repair?.ageYears ?? profile.installationAgeYears;
    const rainExposureFraction = cell.exposure;
    const runoffThroughflowStaining = halfResponse(
      Math.max(0, cell.runoffDepthMeters - profile.runoff.backgroundThroughflowDepthMeters),
      profile.runoff.throughflowExcessDepthAtHalfResponse,
    );
    const retainedDepth =
      cell.edgeAccumulationDepthMeters * profile.runoff.edgeWeight +
      cell.puddleDepthMeters * profile.runoff.puddleWeight;
    const retainedWaterStaining = halfResponse(
      Math.max(0, retainedDepth - profile.runoff.backgroundRetainedDepthMeters),
      profile.runoff.retainedExcessDepthAtHalfResponse,
    );
    baseByIndex.set(cell.index, {
      index: cell.index,
      column: cell.column,
      row: cell.row,
      worldPosition: cell.worldPosition,
      triangleIndex: cell.triangleIndex,
      materialId: cell.materialId,
      targetClass: cell.targetClass,
      coverage: cell.coverage,
      trafficWear: trafficDose / (1 + trafficDose),
      rainExposureFraction,
      shelterProtection: 1 - rainExposureFraction,
      exposureWeathering: halfResponse(
        effectiveAgeYears * rainExposureFraction,
        profile.exposure.yearsAtHalfResponse,
      ),
      runoffThroughflowStaining,
      retainedWaterStaining,
      runoffStaining: 1 - (1 - runoffThroughflowStaining) * (1 - retainedWaterStaining),
      repairInfluence: repair ? 1 : 0,
      repairId: repair?.id ?? null,
      repairRelativeAge:
        repair && profile.installationAgeYears > 0
          ? clamp01(repair.ageYears / profile.installationAgeYears)
          : 0,
      dirt: {
        builtUpMassKilograms: 0,
        persistentMassKilograms: 0,
        initialLooseMassKilograms: 0,
        incomingSuspendedMassKilograms: 0,
        mobilizedMassKilograms: 0,
        depositedMassKilograms: 0,
        finalLooseMassKilograms: 0,
        suspendedOutflowMassKilograms: 0,
        looseCoverage: 0,
        persistentCoverage: 0,
      },
      effectiveAgeYears,
    });
  }
  const { dirtByIndex, dirtMassBalance } = compileDirtMass(water, baseByIndex, materialResponses);
  const cells = water.cells.map((cell) => {
    const { effectiveAgeYears: _effectiveAgeYears, ...base } = baseByIndex.get(cell.index)!;
    void _effectiveAgeYears;
    return { ...base, dirt: dirtByIndex.get(cell.index)! };
  });
  const profileSha256 = canonicalSha256(profile);
  const inputSha256 = canonicalSha256({
    profileSha256,
    sourceWaterFieldSha256: water.fieldSha256,
    routingSha256: water.routing.routingSha256,
    repairPatches,
  });
  const withoutHash = surfaceHistoryFieldV3WithoutHashSchema.parse({
    schemaVersion: 3,
    id: profile.id,
    generator: 'videoer.construction-surface-history.v3',
    inputSha256,
    referenceDate: profile.referenceDate,
    installationAgeYears: profile.installationAgeYears,
    receiver: water.receiver,
    sourceWaterField: {
      id: water.id,
      fieldSha256: water.fieldSha256,
      routingSha256: water.routing.routingSha256,
    },
    grid: water.grid,
    profileSha256,
    cells,
    dirtMassBalance,
    responseModel: { profile, repairPatches },
  });
  return surfaceHistoryFieldV3Schema.parse({
    ...withoutHash,
    fieldSha256: canonicalSha256(withoutHash),
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
    const expectedIncoming = new Map(field.cells.map((cell) => [cell.index, 0]));
    for (const node of sourceWater.routing.nodes)
      if (node.downstreamIndex !== null)
        expectedIncoming.set(
          node.downstreamIndex,
          expectedIncoming.get(node.downstreamIndex)! +
            historyByIndex.get(node.index)!.dirt.suspendedOutflowMassKilograms,
        );
    for (const cell of field.cells)
      if (
        Math.abs(cell.dirt.incomingSuspendedMassKilograms - expectedIncoming.get(cell.index)!) >
        Math.max(
          1e-12,
          Math.max(cell.dirt.incomingSuspendedMassKilograms, expectedIncoming.get(cell.index)!) *
            1e-10,
        )
      ) {
        issues.push(`surface-history v2 dirt routing continuity mismatch at cell ${cell.index}`);
        break;
      }
  }
  return { valid: issues.length === 0, issues, field, expectedFieldSha256 };
}

export function verifySurfaceHistoryFieldV3(value: unknown, sourceWater: SurfaceWaterFieldV2) {
  const field = surfaceHistoryFieldV3Schema.parse(value);
  const { fieldSha256, ...withoutHash } = field;
  const issues: string[] = [];
  const expectedFieldSha256 = canonicalSha256(withoutHash);
  if (fieldSha256 !== expectedFieldSha256)
    issues.push(
      `surface-history v3 field hash mismatch: expected ${expectedFieldSha256}, got ${fieldSha256}`,
    );
  if (field.cells.length !== field.grid.activeCellCount)
    issues.push('surface-history v3 cell count does not equal declared active cell count');
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
    issues.push(`surface-history v3 dirt mass balance is invalid by ${error} kilograms`);
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
      issues.push(`surface-history v3 dirt total '${channel}' differs from its cells`);
  for (const cell of field.cells) {
    const dirt = cell.dirt;
    const cellTolerance = Math.max(1e-12, dirt.builtUpMassKilograms * 1e-10);
    if (
      Math.abs(
        dirt.builtUpMassKilograms - (dirt.persistentMassKilograms + dirt.initialLooseMassKilograms),
      ) > cellTolerance
    )
      issues.push(`surface-history v3 dirt cell ${cell.index} violates buildup partition`);
    if (dirt.mobilizedMassKilograms > dirt.initialLooseMassKilograms + cellTolerance)
      issues.push(`surface-history v3 dirt cell ${cell.index} mobilizes unavailable mass`);
    if (
      Math.abs(
        dirt.incomingSuspendedMassKilograms +
          dirt.mobilizedMassKilograms -
          dirt.depositedMassKilograms -
          dirt.suspendedOutflowMassKilograms,
      ) > cellTolerance
    )
      issues.push(`surface-history v3 dirt cell ${cell.index} violates transport balance`);
    const cellError =
      dirt.initialLooseMassKilograms +
      dirt.incomingSuspendedMassKilograms -
      (dirt.finalLooseMassKilograms + dirt.suspendedOutflowMassKilograms);
    if (Math.abs(cellError) > Math.max(1e-12, dirt.initialLooseMassKilograms * 1e-10))
      issues.push(`surface-history v3 dirt cell ${cell.index} violates loose-mass balance`);
    if (Math.abs(cell.shelterProtection - (1 - cell.rainExposureFraction)) > 1e-12)
      issues.push(`surface-history v3 cell ${cell.index} violates shelter complement`);
    const combinedRunoff =
      1 - (1 - cell.runoffThroughflowStaining) * (1 - cell.retainedWaterStaining);
    if (Math.abs(cell.runoffStaining - combinedRunoff) > 1e-12)
      issues.push(`surface-history v3 cell ${cell.index} violates runoff composition`);
  }
  {
    const verification = verifyStaticSurfaceWaterFieldV2(sourceWater);
    if (!verification.valid) issues.push(...verification.issues.map((issue) => `water: ${issue}`));
    if (
      field.sourceWaterField.id !== sourceWater.id ||
      field.sourceWaterField.fieldSha256 !== sourceWater.fieldSha256 ||
      field.sourceWaterField.routingSha256 !== sourceWater.routing.routingSha256
    )
      issues.push('surface-history v3 source-water identity mismatch');
    if (canonicalSha256(field.receiver) !== canonicalSha256(sourceWater.receiver))
      issues.push('surface-history v3 receiver identity mismatch');
    if (canonicalSha256(field.grid) !== canonicalSha256(sourceWater.grid))
      issues.push('surface-history v3 grid identity mismatch');
    if (field.cells.length !== sourceWater.cells.length)
      issues.push('surface-history v3 topology length mismatch');
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
          issues.push(`surface-history v3 topology mismatch at cell ${index}`);
          break;
        }
        if (Math.abs(history.rainExposureFraction - waterCell.exposure) > 1e-12) {
          issues.push(`surface-history v3 exposure source mismatch at cell ${index}`);
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
      issues.push('surface-history v3 exported dirt total differs from routing roots');
    const expectedIncoming = new Map(field.cells.map((cell) => [cell.index, 0]));
    for (const node of sourceWater.routing.nodes)
      if (node.downstreamIndex !== null)
        expectedIncoming.set(
          node.downstreamIndex,
          expectedIncoming.get(node.downstreamIndex)! +
            historyByIndex.get(node.index)!.dirt.suspendedOutflowMassKilograms,
        );
    for (const cell of field.cells)
      if (
        Math.abs(cell.dirt.incomingSuspendedMassKilograms - expectedIncoming.get(cell.index)!) >
        Math.max(
          1e-12,
          Math.max(cell.dirt.incomingSuspendedMassKilograms, expectedIncoming.get(cell.index)!) *
            1e-10,
        )
      ) {
        issues.push(`surface-history v3 dirt routing continuity mismatch at cell ${cell.index}`);
        break;
      }
    const expected = compileSurfaceHistoryV3({
      profile: field.responseModel.profile,
      sourceWaterField: sourceWater,
      repairPatches: field.responseModel.repairPatches,
    });
    if (canonicalSha256(expected) !== canonicalSha256(field))
      issues.push('surface-history v3 field differs from its embedded response model');
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
