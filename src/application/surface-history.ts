import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import { loadGeometry } from '../geometry/io.js';
import { irregularPavingDefinitionSchema } from '../environments/irregular-paving.js';
import {
  compileSurfaceHistory,
  surfaceHistoryProfileSchema,
  verifySurfaceHistoryField,
  type SurfaceHistoryField,
  type SurfaceHistoryProfile,
} from '../environments/surface-history.js';
import {
  verifyStaticSurfaceWaterField,
  type SurfaceWaterField,
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
    ).map((channel) => [
      channel,
      {
        minimum: Math.min(...field.cells.map((cell) => cell[channel])),
        maximum: Math.max(...field.cells.map((cell) => cell[channel])),
      },
    ]),
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
