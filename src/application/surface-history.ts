import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import { loadGeometry } from '../geometry/io.js';
import { irregularPavingDefinitionSchema } from '../environments/irregular-paving.js';
import {
  compileSurfaceHistory,
  compileSurfaceHistoryV2,
  compileSurfaceHistoryV3,
  surfaceHistoryProfileSchema,
  surfaceHistoryV2ProfileSchema,
  surfaceHistoryV3ProfileSchema,
  surfaceHistoryTrafficPathDoseAtWorldPoint,
  verifySurfaceHistoryField,
  verifySurfaceHistoryFieldV2,
  verifySurfaceHistoryFieldV3,
  type SurfaceHistoryField,
  type SurfaceHistoryFieldV2,
  type SurfaceHistoryFieldV3,
  type SurfaceHistoryProfile,
  type SurfaceHistoryV2Profile,
  type SurfaceHistoryV3Profile,
} from '../environments/surface-history.js';
import {
  verifyStaticSurfaceWaterField,
  verifyStaticSurfaceWaterFieldV2,
  type SurfaceWaterField,
  type SurfaceWaterFieldV2,
} from '../environments/surface-water.js';

async function writeJsonAtomically(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, absolute);
  return absolute;
}

export async function loadSurfaceHistoryProfile(path: string) {
  return surfaceHistoryProfileSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function loadSurfaceHistoryV2Profile(path: string) {
  return surfaceHistoryV2ProfileSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function loadSurfaceHistoryV3Profile(path: string) {
  return surfaceHistoryV3ProfileSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function createPavingSurfaceHistoryField(options: {
  pavingGeometryPath: string;
  surfaceWaterFieldPath: string;
  profile: SurfaceHistoryProfile;
  outputPath: string;
  reportPath?: string;
}): Promise<{ field: SurfaceHistoryField; path: string; report: unknown; reportPath: string }> {
  const profile = surfaceHistoryProfileSchema.parse(options.profile);
  const pavingPath = resolve(options.pavingGeometryPath);
  const waterPath = resolve(options.surfaceWaterFieldPath);
  const [geometry, geometrySha256, waterBytes, waterSha256] = await Promise.all([
    loadGeometry(pavingPath),
    sha256File(pavingPath),
    readFile(waterPath, 'utf8'),
    sha256File(waterPath),
  ]);
  const waterVerification = verifyStaticSurfaceWaterField(JSON.parse(waterBytes)) as ReturnType<
    typeof verifyStaticSurfaceWaterField
  > & { field: SurfaceWaterField };
  if (!waterVerification.valid)
    throw new Error(
      `surface-history source water is invalid: ${waterVerification.issues.join('; ')}`,
    );
  const water = waterVerification.field;
  if (water.receiver.geometryId !== geometry.id || water.receiver.geometrySha256 !== geometrySha256)
    throw new Error('surface-history receiver does not match the exact source-water receiver');
  const definition = irregularPavingDefinitionSchema.parse(geometry.metadata.definition);
  const liveRepairIds = new Set(definition.repairPatches.map((patch) => patch.id));
  for (const repair of profile.repairs)
    if (!liveRepairIds.has(repair.id))
      throw new Error(`surface-history profile references absent repair '${repair.id}'`);
  for (const path of profile.trafficPaths) {
    const reach = path.halfWidthMeters + path.falloffMeters;
    const pathMinimum = [
      Math.min(...path.localPoints.map((point) => point[0])) - reach,
      Math.min(...path.localPoints.map((point) => point[1])) - reach,
    ];
    const pathMaximum = [
      Math.max(...path.localPoints.map((point) => point[0])) + reach,
      Math.max(...path.localPoints.map((point) => point[1])) + reach,
    ];
    const intersectsBoundary =
      pathMaximum[0]! >= definition.boundary.minimum[0] &&
      pathMinimum[0]! <= definition.boundary.maximum[0] &&
      pathMaximum[1]! >= definition.boundary.minimum[1] &&
      pathMinimum[1]! <= definition.boundary.maximum[1];
    if (!intersectsBoundary)
      throw new Error(`surface-history traffic path '${path.id}' does not intersect the receiver`);
  }
  const field = compileSurfaceHistory({
    profile,
    sourceWaterField: water,
    repairPatches: definition.repairPatches.map(({ id, minimum, maximum }) => ({
      id,
      minimum,
      maximum,
    })),
  });
  const verification = verifySurfaceHistoryField(field, water);
  if (!verification.valid)
    throw new Error(`compiled surface-history field is invalid: ${verification.issues.join('; ')}`);
  const outputPath = await writeJsonAtomically(options.outputPath, field);
  const reportPath = resolve(
    options.reportPath ?? `${options.outputPath.replace(/\.json$/u, '')}-report.json`,
  );
  const ranges = Object.fromEntries(
    (
      [
        'trafficWear',
        'longTermExposure',
        'runoffStaining',
        'repairInfluence',
        'repairRelativeAge',
      ] as const
    ).map((channel) => {
      const range = field.cells.reduce(
        (current, cell) => ({
          minimum: Math.min(current.minimum, cell[channel]),
          maximum: Math.max(current.maximum, cell[channel]),
        }),
        { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
      );
      return [channel, range];
    }),
  );
  const report = {
    schemaVersion: 1,
    generator: 'videoer.surface-history-assembly.v1',
    result: 'structural-pass',
    field: {
      path: outputPath,
      sha256: await sha256File(outputPath),
      semanticSha256: field.fieldSha256,
    },
    receiver: { id: geometry.id, path: pavingPath, sha256: geometrySha256 },
    sourceWater: {
      id: water.id,
      path: waterPath,
      sha256: waterSha256,
      semanticSha256: water.fieldSha256,
    },
    cellCount: field.cells.length,
    trafficPathIds: profile.trafficPaths.map((path) => path.id).sort(),
    repairIds: profile.repairs.map((repair) => repair.id).sort(),
    channelRanges: ranges,
    visualAcceptance: 'not-assessed',
  };
  await writeJsonAtomically(reportPath, report);
  return { field, path: outputPath, report, reportPath };
}

export async function createPavingSurfaceHistoryV2Field(options: {
  pavingGeometryPath: string;
  surfaceWaterFieldPath: string;
  profile: SurfaceHistoryV2Profile;
  outputPath: string;
  reportPath?: string;
}): Promise<{ field: SurfaceHistoryFieldV2; path: string; report: unknown; reportPath: string }> {
  const profile = surfaceHistoryV2ProfileSchema.parse(options.profile);
  const pavingPath = resolve(options.pavingGeometryPath);
  const waterPath = resolve(options.surfaceWaterFieldPath);
  const [geometry, geometrySha256, waterBytes, waterSha256] = await Promise.all([
    loadGeometry(pavingPath),
    sha256File(pavingPath),
    readFile(waterPath, 'utf8'),
    sha256File(waterPath),
  ]);
  const waterVerification = verifyStaticSurfaceWaterFieldV2(JSON.parse(waterBytes)) as ReturnType<
    typeof verifyStaticSurfaceWaterFieldV2
  > & { field: SurfaceWaterFieldV2 };
  if (!waterVerification.valid)
    throw new Error(
      `surface-history v2 source water is invalid: ${waterVerification.issues.join('; ')}`,
    );
  const water = waterVerification.field;
  if (water.receiver.geometryId !== geometry.id || water.receiver.geometrySha256 !== geometrySha256)
    throw new Error('surface-history v2 receiver does not match the exact source-water receiver');
  const definition = irregularPavingDefinitionSchema.parse(geometry.metadata.definition);
  const liveRepairIds = new Set(definition.repairPatches.map((patch) => patch.id));
  for (const repair of profile.repairs)
    if (!liveRepairIds.has(repair.id))
      throw new Error(`surface-history v2 profile references absent repair '${repair.id}'`);
  const field = compileSurfaceHistoryV2({
    profile,
    sourceWaterField: water,
    repairPatches: definition.repairPatches.map(({ id, minimum, maximum }) => ({
      id,
      minimum,
      maximum,
    })),
  });
  const verification = verifySurfaceHistoryFieldV2(field, water);
  if (!verification.valid)
    throw new Error(
      `compiled surface-history v2 field is invalid: ${verification.issues.join('; ')}`,
    );
  const outputPath = await writeJsonAtomically(options.outputPath, field);
  const reportPath = resolve(
    options.reportPath ?? `${options.outputPath.replace(/\.json$/u, '')}-report.json`,
  );
  const report = {
    schemaVersion: 2,
    generator: 'videoer.surface-history-assembly.v2',
    result: 'structural-pass',
    field: {
      path: outputPath,
      sha256: await sha256File(outputPath),
      semanticSha256: field.fieldSha256,
    },
    receiver: { id: geometry.id, path: pavingPath, sha256: geometrySha256 },
    sourceWater: {
      id: water.id,
      path: waterPath,
      sha256: waterSha256,
      semanticSha256: water.fieldSha256,
      routingSha256: water.routing.routingSha256,
    },
    cellCount: field.cells.length,
    trafficPathIds: profile.trafficPaths.map((path) => path.id).sort(),
    repairIds: profile.repairs.map((repair) => repair.id).sort(),
    dirtMassBalance: field.dirtMassBalance,
    dirtCoverageRanges: field.cells.reduce(
      (ranges, cell) => ({
        loose: {
          minimum: Math.min(ranges.loose.minimum, cell.dirt.looseCoverage),
          maximum: Math.max(ranges.loose.maximum, cell.dirt.looseCoverage),
        },
        persistent: {
          minimum: Math.min(ranges.persistent.minimum, cell.dirt.persistentCoverage),
          maximum: Math.max(ranges.persistent.maximum, cell.dirt.persistentCoverage),
        },
      }),
      {
        loose: { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
        persistent: { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
      },
    ),
    visualAcceptance: 'not-assessed',
  };
  await writeJsonAtomically(reportPath, report);
  return { field, path: outputPath, report, reportPath };
}

export async function createPavingSurfaceHistoryV3Field(options: {
  pavingGeometryPath: string;
  surfaceWaterFieldPath: string;
  profile: SurfaceHistoryV3Profile;
  outputPath: string;
  reportPath?: string;
}): Promise<{ field: SurfaceHistoryFieldV3; path: string; report: unknown; reportPath: string }> {
  const profile = surfaceHistoryV3ProfileSchema.parse(options.profile);
  const pavingPath = resolve(options.pavingGeometryPath);
  const waterPath = resolve(options.surfaceWaterFieldPath);
  const [geometry, geometrySha256, waterBytes, waterSha256] = await Promise.all([
    loadGeometry(pavingPath),
    sha256File(pavingPath),
    readFile(waterPath, 'utf8'),
    sha256File(waterPath),
  ]);
  const waterVerification = verifyStaticSurfaceWaterFieldV2(JSON.parse(waterBytes)) as ReturnType<
    typeof verifyStaticSurfaceWaterFieldV2
  > & { field: SurfaceWaterFieldV2 };
  if (!waterVerification.valid)
    throw new Error(
      `surface-history v3 source water is invalid: ${waterVerification.issues.join('; ')}`,
    );
  const water = waterVerification.field;
  if (water.receiver.geometryId !== geometry.id || water.receiver.geometrySha256 !== geometrySha256)
    throw new Error('surface-history v3 receiver does not match the exact source-water receiver');
  const definition = irregularPavingDefinitionSchema.parse(geometry.metadata.definition);
  const liveRepairIds = new Set(definition.repairPatches.map((patch) => patch.id));
  for (const repair of profile.repairs)
    if (!liveRepairIds.has(repair.id))
      throw new Error(`surface-history v3 profile references absent repair '${repair.id}'`);
  const field = compileSurfaceHistoryV3({
    profile,
    sourceWaterField: water,
    repairPatches: definition.repairPatches.map(({ id, minimum, maximum }) => ({
      id,
      minimum,
      maximum,
    })),
  });
  const verification = verifySurfaceHistoryFieldV3(field, water);
  if (!verification.valid)
    throw new Error(
      `compiled surface-history v3 field is invalid: ${verification.issues.join('; ')}`,
    );
  for (const path of profile.trafficPaths)
    if (
      !field.cells.some(
        (cell) =>
          surfaceHistoryTrafficPathDoseAtWorldPoint(
            cell.worldPosition,
            field.receiver.transform,
            path,
          ) > 0,
      )
    )
      throw new Error(
        `surface-history v3 traffic path '${path.id}' does not affect any active receiver cell`,
      );
  const outputPath = await writeJsonAtomically(options.outputPath, field);
  const reportPath = resolve(
    options.reportPath ?? `${options.outputPath.replace(/\.json$/u, '')}-report.json`,
  );
  const channelRanges = Object.fromEntries(
    (
      [
        'trafficWear',
        'rainExposureFraction',
        'shelterProtection',
        'exposureWeathering',
        'runoffThroughflowStaining',
        'retainedWaterStaining',
        'runoffStaining',
        'repairInfluence',
        'repairRelativeAge',
      ] as const
    ).map((channel) => {
      const range = field.cells.reduce(
        (current, cell) => ({
          minimum: Math.min(current.minimum, cell[channel]),
          maximum: Math.max(current.maximum, cell[channel]),
        }),
        { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
      );
      return [channel, range];
    }),
  );
  const report = {
    schemaVersion: 3,
    generator: 'videoer.surface-history-assembly.v3',
    result: 'structural-pass',
    field: {
      path: outputPath,
      sha256: await sha256File(outputPath),
      semanticSha256: field.fieldSha256,
    },
    receiver: { id: geometry.id, path: pavingPath, sha256: geometrySha256 },
    sourceWater: {
      id: water.id,
      path: waterPath,
      sha256: waterSha256,
      semanticSha256: water.fieldSha256,
      routingSha256: water.routing.routingSha256,
    },
    cellCount: field.cells.length,
    trafficPathIds: profile.trafficPaths.map((path) => path.id).sort(),
    repairIds: profile.repairs.map((repair) => repair.id).sort(),
    channelRanges,
    dirtMassBalance: field.dirtMassBalance,
    dirtCoverageRanges: field.cells.reduce(
      (ranges, cell) => ({
        loose: {
          minimum: Math.min(ranges.loose.minimum, cell.dirt.looseCoverage),
          maximum: Math.max(ranges.loose.maximum, cell.dirt.looseCoverage),
        },
        persistent: {
          minimum: Math.min(ranges.persistent.minimum, cell.dirt.persistentCoverage),
          maximum: Math.max(ranges.persistent.maximum, cell.dirt.persistentCoverage),
        },
      }),
      {
        loose: { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
        persistent: { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY },
      },
    ),
    visualAcceptance: 'not-assessed',
  };
  await writeJsonAtomically(reportPath, report);
  return { field, path: outputPath, report, reportPath };
}
