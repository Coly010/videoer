import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import { pavingSurfaceMaterialTargetsSchema } from '../environments/irregular-paving.js';
import { loadGeometry } from '../geometry/io.js';
import { loadSurfaceMaterial } from '../materials/io.js';
import {
  textureMaterialApplicationSchema,
  type TextureMaterialApplication,
} from '../materials/model.js';
import { bindStagedSurfaceMaterialValue } from '../materials/texture-maps.js';

export interface BindPavingUnitMaterialOptions {
  pavingGeometryPath: string;
  unitMaterialPath: string;
  unitApplication: TextureMaterialApplication;
  outputGeometryPath: string;
  reportPath?: string;
}

/**
 * Applies one homogeneous, physically scaled source across every modeled paving-unit material
 * target while preserving each unit's generator-authored local-metre UV frame. Joint, substrate,
 * and border targets remain independent and are never silently rebound as stone.
 */
export async function bindPavingUnitMaterial(options: BindPavingUnitMaterialOptions) {
  const sourceGeometryPath = resolve(options.pavingGeometryPath);
  const sourceMaterialPath = resolve(options.unitMaterialPath);
  const outputGeometryPath = resolve(options.outputGeometryPath);
  const reportPath = resolve(
    options.reportPath ?? join(dirname(outputGeometryPath), 'paving-material-binding-report.json'),
  );
  const geometry = await loadGeometry(sourceGeometryPath);
  const targets = pavingSurfaceMaterialTargetsSchema.parse(
    geometry.metadata.surfaceMaterialTargets,
  );
  const definition = geometry.metadata.definition as
    | { surfaceSampling?: { kind?: unknown } }
    | undefined;
  if (definition?.surfaceSampling?.kind !== 'deterministic-unit-local-uv-meters')
    throw new Error(
      `Paving geometry '${geometry.id}' does not declare deterministic unit-local metre sampling`,
    );
  const liveMaterialIds = new Set(geometry.materials.map((material) => material.id));
  for (const target of [
    ...targets.modeledUnits,
    targets.continuousJoint,
    targets.continuousSubstrate,
    ...targets.borders,
  ])
    if (!liveMaterialIds.has(target))
      throw new Error(`Paving surface target '${target}' is absent from '${geometry.id}'`);

  const application = textureMaterialApplicationSchema.parse(options.unitApplication);
  if (
    application.constructionDomain !== 'modeled-paving-unit' ||
    application.placement.orientation !== 'unit-local-uv-meters'
  )
    throw new Error(
      'Paving unit binding requires modeled-paving-unit with unit-local-uv-meters placement',
    );
  const surface = await loadSurfaceMaterial(sourceMaterialPath);
  let bound = geometry;
  for (const targetMaterialId of targets.modeledUnits)
    bound = (
      await bindStagedSurfaceMaterialValue({
        geometry: bound,
        targetMaterialId,
        surface,
        sourceTextureDirectory: dirname(sourceMaterialPath),
        outputGeometryPath,
        application,
      })
    ).geometry;

  const report = {
    schemaVersion: 1,
    generator: 'videoer.unit-aware-paving-material-binding.v1',
    pavingGeometry: {
      id: geometry.id,
      sourcePath: sourceGeometryPath,
      sourceSha256: await sha256File(sourceGeometryPath),
      outputPath: outputGeometryPath,
      outputSha256: await sha256File(outputGeometryPath),
    },
    surfaceMaterial: {
      id: surface.id,
      sourcePath: sourceMaterialPath,
      sourceSha256: await sha256File(sourceMaterialPath),
    },
    application,
    modeledUnitTargets: targets.modeledUnits,
    preservedTargets: {
      joint: targets.continuousJoint,
      substrate: targets.continuousSubstrate,
      borders: targets.borders,
    },
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { geometry: bound, path: outputGeometryPath, report, reportPath };
}
