import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';
import { canonicalSha256 } from '../assets/sources/cache.js';
import {
  compileStaticSurfaceWater,
  surfaceWaterMaterialResponseSchema,
  verifyStaticSurfaceWaterField,
  verifyStaticSurfaceWaterFieldV2,
  type SurfaceWaterField,
  type SurfaceWaterFieldInput,
  type SurfaceWaterFieldV2,
} from '../environments/surface-water.js';
import {
  verifySurfaceHistoryFieldV2,
  verifySurfaceHistoryFieldV3,
} from '../environments/surface-history.js';
import {
  reconstructSurfaceWaterOpticalSurface,
  surfaceWaterOpticalSurfaceOptionsSchema,
  verifySurfaceWaterOpticalSurface,
  type SurfaceWaterOpticalSurfaceOptions,
} from '../environments/surface-water-surface.js';
import {
  compileSurfaceWaterReceiverAppearance,
  verifySurfaceWaterReceiverAppearance,
} from '../environments/surface-water-appearance.js';
import {
  loadCinematicScene,
  portableCinematicDependencyPath,
  rebaseCinematicSceneDependencies,
  saveCinematicScene,
} from '../cinematic/io.js';
import {
  irregularPavingDefinitionSchema,
  pavingSurfaceMaterialTargetsSchema,
} from '../environments/irregular-paving.js';
import { loadGeometry } from '../geometry/io.js';
import type { Vec3 } from '../geometry/model.js';
import { sceneTransformSchema, type SceneTransform } from '../interactions/model.js';
import { loadAtmosphericVfx } from '../vfx/io.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const localIdentifier = z.string().regex(/^[a-z][a-z0-9-]*$/u);

export const surfaceWaterAssemblyProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u),
  receiverSha256: sha256,
  atmosphericVfxSha256: sha256,
  receiverTransform: sceneTransformSchema.default({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }),
  materialResponses: z.record(localIdentifier, surfaceWaterMaterialResponseSchema).default({}),
  shelters: z
    .array(
      z.object({
        id: localIdentifier,
        geometryPath: z.string().min(1),
        geometrySha256: sha256,
        transform: sceneTransformSchema,
      }),
    )
    .default([]),
  grid: z.object({
    cellSizeMeters: z.number().positive().max(2),
    supersample: z.union([z.literal(1), z.literal(4), z.literal(9)]).default(4),
    shelterRayMaximumMeters: z.number().positive().max(1_000).default(100),
  }),
  solver: z
    .object({
      edgeHeightThresholdMeters: z.number().nonnegative().max(0.25).default(0.003),
      maximumCellCount: z.number().int().positive().max(1_000_000).default(250_000),
    })
    .default({ edgeHeightThresholdMeters: 0.003, maximumCellCount: 250_000 }),
});

export type SurfaceWaterAssemblyProfile = z.infer<typeof surfaceWaterAssemblyProfileSchema>;

function transformPoint(point: Vec3, transform: SceneTransform): Vec3 {
  let [x, y, zValue] = point.map((value, index) => value * transform.scale[index]!) as Vec3;
  const [rx, ry, rz] = transform.rotation;
  [y, zValue] = [
    y * Math.cos(rx) - zValue * Math.sin(rx),
    y * Math.sin(rx) + zValue * Math.cos(rx),
  ];
  [x, zValue] = [
    x * Math.cos(ry) + zValue * Math.sin(ry),
    -x * Math.sin(ry) + zValue * Math.cos(ry),
  ];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + transform.position[0], y + transform.position[1], zValue + transform.position[2]];
}

async function writeJsonAtomically(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, absolute);
  return absolute;
}

function expectedTargetClass(
  materialId: string,
  targets: z.infer<typeof pavingSurfaceMaterialTargetsSchema>,
) {
  if (targets.modeledUnits.includes(materialId)) return 'modeled-unit' as const;
  if (targets.continuousJoint === materialId) return 'joint' as const;
  if (targets.continuousSubstrate === materialId) return 'substrate' as const;
  if (targets.borders.includes(materialId)) return 'border' as const;
  return undefined;
}

function boundSurfaceDryRoughness(
  geometry: Awaited<ReturnType<typeof loadGeometry>>,
  materialId: string,
) {
  const surface = geometry.materials.find((material) => material.id === materialId)?.surface;
  return surface ? (surface.roughness.minimum + surface.roughness.maximum) / 2 : undefined;
}

type CreatePavingSurfaceWaterFieldOptions = {
  pavingGeometryPath: string;
  atmosphericVfxPath: string;
  profile: SurfaceWaterAssemblyProfile;
  profileDirectory: string;
  outputPath: string;
  reportPath?: string;
};

export function createPavingSurfaceWaterField(
  options: CreatePavingSurfaceWaterFieldOptions & { fieldSchemaVersion: 2 },
): Promise<{ field: SurfaceWaterFieldV2; path: string; report: unknown; reportPath: string }>;
export function createPavingSurfaceWaterField(
  options: CreatePavingSurfaceWaterFieldOptions & { fieldSchemaVersion?: 1 },
): Promise<{ field: SurfaceWaterField; path: string; report: unknown; reportPath: string }>;
export async function createPavingSurfaceWaterField(
  options: CreatePavingSurfaceWaterFieldOptions & { fieldSchemaVersion?: 1 | 2 },
): Promise<{
  field: SurfaceWaterField | SurfaceWaterFieldV2;
  path: string;
  report: unknown;
  reportPath: string;
}> {
  const profile = surfaceWaterAssemblyProfileSchema.parse(options.profile);
  const pavingPath = resolve(options.pavingGeometryPath);
  const vfxPath = resolve(options.atmosphericVfxPath);
  const [geometry, vfx, liveGeometrySha256, liveVfxSha256] = await Promise.all([
    loadGeometry(pavingPath),
    loadAtmosphericVfx(vfxPath),
    sha256File(pavingPath),
    sha256File(vfxPath),
  ]);
  if (liveGeometrySha256 !== profile.receiverSha256)
    throw new Error(
      `surface-water receiver hash mismatch: expected ${profile.receiverSha256}, got ${liveGeometrySha256}`,
    );
  if (liveVfxSha256 !== profile.atmosphericVfxSha256)
    throw new Error(
      `surface-water atmosphere hash mismatch: expected ${profile.atmosphericVfxSha256}, got ${liveVfxSha256}`,
    );
  if (!vfx.rain.enabled || !vfx.rain.surfaceFlux)
    throw new Error('surface-water assembly requires enabled rain with an explicit surfaceFlux');

  const definition = irregularPavingDefinitionSchema.parse(geometry.metadata.definition);
  const targets = pavingSurfaceMaterialTargetsSchema.parse(
    geometry.metadata.surfaceMaterialTargets,
  );
  const liveMaterials = new Set(geometry.materials.map((material) => material.id));
  const materialDryRoughnessSources: Record<string, 'bound-surface' | 'profile'> = {};
  for (const [materialId, response] of Object.entries(profile.materialResponses)) {
    if (!liveMaterials.has(materialId))
      throw new Error(`surface-water profile references absent material '${materialId}'`);
    const expected = expectedTargetClass(materialId, targets);
    if (!expected)
      throw new Error(`surface-water material '${materialId}' has no paving target class`);
    if (response.targetClass !== expected)
      throw new Error(
        `surface-water material '${materialId}' declares ${response.targetClass}, expected ${expected}`,
      );
    const boundDry = boundSurfaceDryRoughness(geometry, materialId);
    if (boundDry !== undefined) {
      if (Math.abs(response.wetRoughness.dry - boundDry) > 1e-12)
        throw new Error(
          `surface-water material '${materialId}' dry roughness ${response.wetRoughness.dry} is stale; bound surface requires ${boundDry}`,
        );
      materialDryRoughnessSources[materialId] = 'bound-surface';
    } else materialDryRoughnessSources[materialId] = 'profile';
  }
  const materialResponses = { ...profile.materialResponses };
  const embeddedResponseMaterialIds: string[] = [];
  for (const materialId of definition.drainage.wetReceiverMaterialIds) {
    if (materialResponses[materialId]) continue;
    const material = geometry.materials.find((candidate) => candidate.id === materialId);
    const surface = material?.surface;
    const response = surface?.surfaceWaterResponse;
    const expected = expectedTargetClass(materialId, targets);
    if (!material || !response || !expected)
      throw new Error(
        `surface-water wet receiver '${materialId}' has neither a profile response nor an embedded material response`,
      );
    materialResponses[materialId] = surfaceWaterMaterialResponseSchema.parse({
      targetClass: expected,
      absorption: response.absorption,
      retention: response.retention,
      wetRoughness: {
        dry: (surface.roughness.minimum + surface.roughness.maximum) / 2,
        multiplier: response.wetRoughness.multiplier,
        floor: response.wetRoughness.floor,
      },
      ...(response.receiverAppearance ? { receiverAppearance: response.receiverAppearance } : {}),
      splash: response.splash,
    });
    embeddedResponseMaterialIds.push(materialId);
    materialDryRoughnessSources[materialId] = 'bound-surface';
  }

  const shelterDirectory = resolve(options.profileDirectory);
  const shelters = await Promise.all(
    profile.shelters.map(async (shelter) => {
      const path = resolve(shelterDirectory, shelter.geometryPath);
      const actualSha256 = await sha256File(path);
      if (actualSha256 !== shelter.geometrySha256)
        throw new Error(
          `surface-water shelter '${shelter.id}' hash mismatch: expected ${shelter.geometrySha256}, got ${actualSha256}`,
        );
      return {
        id: shelter.id,
        geometry: await loadGeometry(path),
        geometrySha256: actualSha256,
        transform: shelter.transform,
      };
    }),
  );
  const outlets = definition.drainage.runoffAnchorIds.map((id) => {
    const attachment = geometry.attachments[id];
    if (!attachment) throw new Error(`surface-water runoff attachment '${id}' is missing`);
    return {
      id,
      worldPosition: transformPoint(attachment.position, profile.receiverTransform),
      radiusMeters: Math.max(profile.grid.cellSizeMeters, definition.joints.widthMeters * 2),
    };
  });
  const flux = vfx.rain.surfaceFlux;
  const fieldInput: SurfaceWaterFieldInput = {
    schemaVersion: 1,
    id: profile.id,
    receiver: {
      geometry,
      geometrySha256: liveGeometrySha256,
      transform: profile.receiverTransform,
    },
    drainage: {
      localDirection: definition.drainage.fall,
      gradientMetersPerMeter: definition.drainage.gradientMetersPerMeter,
      outlets,
    },
    precipitation: {
      intensityMillimetersPerHour: flux.intensityMillimetersPerHour,
      durationSeconds: flux.durationSeconds,
      windMetersPerSecond: vfx.rain.windMetersPerSecond,
      impactSpeedMetersPerSecond: flux.impactSpeedMetersPerSecond,
      dropDiameterMillimeters: flux.dropDiameterMillimeters,
    },
    materialResponses,
    shelters,
    grid: profile.grid,
    solver: profile.solver,
  };
  const field: SurfaceWaterField | SurfaceWaterFieldV2 =
    options.fieldSchemaVersion === 2
      ? compileStaticSurfaceWater(fieldInput, { schemaVersion: 2 })
      : compileStaticSurfaceWater(fieldInput);
  const path = await writeJsonAtomically(options.outputPath, field);
  const reportPath = resolve(
    options.reportPath ?? `${options.outputPath.replace(/\.json$/u, '')}-report.json`,
  );
  const report = {
    schemaVersion: 1,
    generator: 'videoer.surface-water-assembly.v1',
    result: 'structural-pass',
    field: { path, sha256: await sha256File(path), semanticSha256: field.fieldSha256 },
    receiver: { id: geometry.id, path: pavingPath, sha256: liveGeometrySha256 },
    atmosphere: { id: vfx.id, path: vfxPath, sha256: liveVfxSha256 },
    activeCellCount: field.grid.activeCellCount,
    fieldSchemaVersion: field.schemaVersion,
    ...(field.schemaVersion === 2
      ? { routingSha256: field.routing.routingSha256, routingNodeCount: field.routing.nodes.length }
      : {}),
    splashEligibleCellCount: field.cells.filter((cell) => cell.splashEligible).length,
    massBalance: field.massBalance,
    materialResponseSources: {
      profile: Object.keys(profile.materialResponses).sort(),
      embedded: embeddedResponseMaterialIds.sort(),
      dryRoughness: Object.fromEntries(
        Object.entries(materialDryRoughnessSources).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    },
    visualAcceptance: 'not-assessed',
  };
  await writeJsonAtomically(reportPath, report);
  return { field, path, report, reportPath };
}

export async function loadSurfaceWaterAssemblyProfile(path: string) {
  return surfaceWaterAssemblyProfileSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function rebindSurfaceWaterAssemblyProfile(options: {
  sourceProfilePath: string;
  pavingGeometryPath: string;
  outputProfilePath: string;
  profileId?: string;
}) {
  const sourceProfilePath = resolve(options.sourceProfilePath);
  const pavingGeometryPath = resolve(options.pavingGeometryPath);
  const outputProfilePath = resolve(options.outputProfilePath);
  const sourceProfileDirectory = dirname(sourceProfilePath);
  const outputProfileDirectory = dirname(outputProfilePath);
  const [sourceProfile, sourceProfileSha256, geometry, receiverSha256] = await Promise.all([
    loadSurfaceWaterAssemblyProfile(sourceProfilePath),
    sha256File(sourceProfilePath),
    loadGeometry(pavingGeometryPath),
    sha256File(pavingGeometryPath),
  ]);
  const definition = irregularPavingDefinitionSchema.parse(geometry.metadata.definition);
  const targets = pavingSurfaceMaterialTargetsSchema.parse(
    geometry.metadata.surfaceMaterialTargets,
  );
  const liveMaterials = new Map(geometry.materials.map((material) => [material.id, material]));
  const materialResponses = Object.fromEntries(
    Object.entries(sourceProfile.materialResponses).map(([materialId, response]) => {
      const surface = liveMaterials.get(materialId)?.surface;
      return [
        materialId,
        surface
          ? {
              ...response,
              wetRoughness: {
                ...response.wetRoughness,
                dry: (surface.roughness.minimum + surface.roughness.maximum) / 2,
              },
            }
          : response,
      ];
    }),
  );
  for (const [materialId, response] of Object.entries(sourceProfile.materialResponses)) {
    if (!liveMaterials.has(materialId))
      throw new Error(`surface-water profile references absent material '${materialId}'`);
    const expected = expectedTargetClass(materialId, targets);
    if (!expected)
      throw new Error(`surface-water material '${materialId}' has no paving target class`);
    if (response.targetClass !== expected)
      throw new Error(
        `surface-water material '${materialId}' declares ${response.targetClass}, expected ${expected}`,
      );
  }
  for (const materialId of definition.drainage.wetReceiverMaterialIds) {
    if (sourceProfile.materialResponses[materialId]) continue;
    if (!liveMaterials.get(materialId)?.surface?.surfaceWaterResponse)
      throw new Error(
        `surface-water wet receiver '${materialId}' has neither a profile response nor an embedded material response`,
      );
  }
  const shelters = await Promise.all(
    sourceProfile.shelters.map(async (shelter) => {
      const shelterPath = resolve(sourceProfileDirectory, shelter.geometryPath);
      const actualSha256 = await sha256File(shelterPath);
      if (actualSha256 !== shelter.geometrySha256)
        throw new Error(
          `surface-water shelter '${shelter.id}' hash mismatch: expected ${shelter.geometrySha256}, got ${actualSha256}`,
        );
      return {
        ...shelter,
        geometryPath: relative(outputProfileDirectory, shelterPath),
      };
    }),
  );
  const profile = surfaceWaterAssemblyProfileSchema.parse({
    ...sourceProfile,
    ...(options.profileId ? { id: options.profileId } : {}),
    receiverSha256,
    materialResponses,
    shelters,
  });
  const path = await writeJsonAtomically(outputProfilePath, profile);
  return {
    profile,
    path,
    sourceProfilePath,
    sourceProfileSha256,
    pavingGeometryPath,
    receiverSha256,
    shelterCount: shelters.length,
  };
}

export async function createSurfaceWaterOpticalSurface(options: {
  surfaceWaterFieldPath: string;
  outputPath: string;
  surface: SurfaceWaterOpticalSurfaceOptions;
}) {
  const fieldPath = resolve(options.surfaceWaterFieldPath);
  const fieldValue = JSON.parse(await readFile(fieldPath, 'utf8'));
  const fieldVerification =
    fieldValue.schemaVersion === 2
      ? verifyStaticSurfaceWaterFieldV2(fieldValue)
      : verifyStaticSurfaceWaterField(fieldValue);
  if (!fieldVerification.valid)
    throw new Error(
      `surface-water optical source field is invalid: ${fieldVerification.issues.join('; ')}`,
    );
  const surfaceOptions = surfaceWaterOpticalSurfaceOptionsSchema.parse(options.surface);
  const surface = reconstructSurfaceWaterOpticalSurface(fieldVerification.field, surfaceOptions);
  const verification = verifySurfaceWaterOpticalSurface(surface);
  if (!verification.valid)
    throw new Error(`surface-water optical surface is invalid: ${verification.issues.join('; ')}`);
  if (
    surface.sourceFieldId !== fieldVerification.field.id ||
    surface.sourceFieldSha256 !== fieldVerification.field.fieldSha256
  )
    throw new Error('surface-water optical surface does not preserve its exact source field');
  const path = await writeJsonAtomically(options.outputPath, surface);
  return {
    surface,
    path,
    sourceFieldPath: fieldPath,
    sourceFieldSha256: fieldVerification.field.fieldSha256,
    sourceFieldFileSha256: await sha256File(fieldPath),
  };
}

export async function createSurfaceWaterReceiverAppearance(options: {
  surfaceWaterFieldPath: string;
  assemblyProfilePath: string;
  outputPath: string;
  id: string;
}) {
  const fieldPath = resolve(options.surfaceWaterFieldPath);
  const profilePath = resolve(options.assemblyProfilePath);
  const [fieldValue, profile] = await Promise.all([
    readFile(fieldPath, 'utf8').then((value) => JSON.parse(value)),
    loadSurfaceWaterAssemblyProfile(profilePath),
  ]);
  const fieldVerification =
    fieldValue.schemaVersion === 2
      ? verifyStaticSurfaceWaterFieldV2(fieldValue)
      : verifyStaticSurfaceWaterField(fieldValue);
  if (!fieldVerification.valid)
    throw new Error(
      `surface-water receiver-appearance source field is invalid: ${fieldVerification.issues.join('; ')}`,
    );
  const materialResponses = fieldVerification.field.materialResponses ?? profile.materialResponses;
  if (fieldVerification.field.materialResponses)
    for (const [materialId, profileResponse] of Object.entries(profile.materialResponses)) {
      const embeddedResponse = fieldVerification.field.materialResponses[materialId];
      if (
        !embeddedResponse ||
        canonicalSha256(embeddedResponse) !== canonicalSha256(profileResponse)
      )
        throw new Error(
          `surface-water receiver-appearance profile response '${materialId}' differs from the exact field response`,
        );
    }
  const appearance = compileSurfaceWaterReceiverAppearance(
    fieldVerification.field,
    materialResponses,
    options.id,
  );
  const verification = verifySurfaceWaterReceiverAppearance(appearance, fieldVerification.field);
  if (!verification.valid)
    throw new Error(
      `surface-water receiver appearance is invalid: ${verification.issues.join('; ')}`,
    );
  const path = await writeJsonAtomically(options.outputPath, appearance);
  return {
    appearance,
    path,
    sourceFieldPath: fieldPath,
    sourceFieldFileSha256: await sha256File(fieldPath),
    assemblyProfilePath: profilePath,
    assemblyProfileFileSha256: await sha256File(profilePath),
  };
}

export async function rebindCinematicSurfaceWaterReceiver(options: {
  sourceScenePath: string;
  receiverEntityId: string;
  pavingGeometryPath: string;
  surfaceWaterFieldPath: string;
  surfaceWaterReceiverAppearancePath?: string;
  surfaceHistoryFieldPath?: string;
  surfaceWaterOpticalSurfacePath?: string;
  outputScenePath: string;
  sceneId?: string;
}) {
  const outputScenePath = resolve(options.outputScenePath);
  const scene = rebaseCinematicSceneDependencies(
    await loadCinematicScene(options.sourceScenePath),
    options.sourceScenePath,
    outputScenePath,
  );
  const geometryPath = resolve(options.pavingGeometryPath);
  const fieldPath = resolve(options.surfaceWaterFieldPath);
  const [geometry, geometrySha256, rawField] = await Promise.all([
    loadGeometry(geometryPath),
    sha256File(geometryPath),
    readFile(fieldPath, 'utf8').then((value) => JSON.parse(value)),
  ]);
  const fieldVerification =
    rawField.schemaVersion === 2
      ? verifyStaticSurfaceWaterFieldV2(rawField)
      : verifyStaticSurfaceWaterField(rawField);
  if (!fieldVerification.valid)
    throw new Error(
      `surface-water receiver field is invalid: ${fieldVerification.issues.join('; ')}`,
    );
  const field = fieldVerification.field;
  if (field.receiver.geometryId !== geometry.id || field.receiver.geometrySha256 !== geometrySha256)
    throw new Error('surface-water field does not bind the requested paving geometry');
  const entity = scene.entities.find((candidate) => candidate.id === options.receiverEntityId);
  if (!entity) throw new Error(`scene receiver entity '${options.receiverEntityId}' is missing`);
  if (JSON.stringify(entity.transform) !== JSON.stringify(field.receiver.transform))
    throw new Error(
      `scene receiver entity '${entity.id}' transform does not match surface-water field`,
    );
  entity.geometryPath = portableCinematicDependencyPath(outputScenePath, geometryPath);
  entity.surfaceWaterFieldPath = portableCinematicDependencyPath(outputScenePath, fieldPath);
  if (options.surfaceWaterReceiverAppearancePath) {
    const appearancePath = resolve(options.surfaceWaterReceiverAppearancePath);
    const appearanceVerification = verifySurfaceWaterReceiverAppearance(
      JSON.parse(await readFile(appearancePath, 'utf8')),
      field,
    );
    if (!appearanceVerification.valid)
      throw new Error(
        `surface-water receiver appearance is invalid: ${appearanceVerification.issues.join('; ')}`,
      );
    entity.surfaceWaterReceiverAppearancePath = portableCinematicDependencyPath(
      outputScenePath,
      appearancePath,
    );
  } else delete entity.surfaceWaterReceiverAppearancePath;
  if (options.surfaceHistoryFieldPath) {
    if (field.schemaVersion !== 2)
      throw new Error('surface-history v2/v3 binding requires a surface-water v2 field');
    const historyPath = resolve(options.surfaceHistoryFieldPath);
    const rawHistory = JSON.parse(await readFile(historyPath, 'utf8'));
    const historyVerification =
      rawHistory.schemaVersion === 3
        ? verifySurfaceHistoryFieldV3(rawHistory, field)
        : rawHistory.schemaVersion === 2
          ? verifySurfaceHistoryFieldV2(rawHistory, field)
          : (() => {
              throw new Error('surface-water v2 accepts only surface-history v2 or v3 fields');
            })();
    if (!historyVerification.valid)
      throw new Error(
        `surface-history v${rawHistory.schemaVersion} field is invalid: ${historyVerification.issues.join('; ')}`,
      );
    entity.surfaceHistoryFieldPath = portableCinematicDependencyPath(outputScenePath, historyPath);
  } else delete entity.surfaceHistoryFieldPath;
  if (options.surfaceWaterOpticalSurfacePath) {
    const opticalPath = resolve(options.surfaceWaterOpticalSurfacePath);
    const verification = verifySurfaceWaterOpticalSurface(
      JSON.parse(await readFile(opticalPath, 'utf8')),
    );
    if (!verification.valid)
      throw new Error(
        `surface-water optical surface is invalid: ${verification.issues.join('; ')}`,
      );
    if (
      verification.surface.sourceFieldId !== field.id ||
      verification.surface.sourceFieldSha256 !== field.fieldSha256
    )
      throw new Error('surface-water optical surface does not bind the requested field');
    entity.surfaceWaterOpticalSurfacePath = portableCinematicDependencyPath(
      outputScenePath,
      opticalPath,
    );
  } else delete entity.surfaceWaterOpticalSurfacePath;
  if (options.sceneId) scene.id = options.sceneId;
  const path = await saveCinematicScene(outputScenePath, scene);
  return {
    scene,
    path,
    receiverEntityId: entity.id,
    geometrySha256,
    fieldSha256: field.fieldSha256,
  };
}
