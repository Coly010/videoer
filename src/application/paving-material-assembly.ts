import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import {
  pavingSurfaceMaterialTargetsSchema,
  pavingUnitAppearanceAttributeNames,
} from '../environments/irregular-paving.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { loadSurfaceMaterial } from '../materials/io.js';
import { bindSurfaceMaterial } from '../materials/adaptation.js';
import {
  textureMaterialApplicationSchema,
  type SurfaceMaterial,
  type TextureMaterialApplication,
} from '../materials/model.js';
import {
  bindStagedSurfaceMaterialValue,
  bindStagedSurfaceMaterialValueToTargets,
  restageGeometryTextureDependencies,
} from '../materials/texture-maps.js';

export interface BindPavingUnitMaterialOptions {
  pavingGeometryPath: string;
  unitMaterialPath: string;
  unitApplication: TextureMaterialApplication;
  outputGeometryPath: string;
  reportPath?: string;
}

export interface BindPavingConstructionMaterialsOptions {
  pavingGeometryPath: string;
  jointMaterialPath: string;
  substrateMaterialPath: string;
  outputGeometryPath: string;
  jointApplication?: TextureMaterialApplication;
  substrateApplication?: TextureMaterialApplication;
}

function assertGranularConstructionMaterial(
  material: SurfaceMaterial,
  role: 'joint' | 'substrate',
) {
  if (material.metadata.constructionDomain !== 'paving-joint-substrate')
    throw new Error(
      `Paving ${role} material '${material.id}' has wrong construction domain; expected paving-joint-substrate`,
    );
  if (material.pattern.kind !== 'granular-aggregate')
    throw new Error(
      `Paving ${role} material '${material.id}' has wrong pattern kind; expected granular-aggregate`,
    );
  const granularKind = material.metadata.granularKind;
  if (role === 'joint' && granularKind !== 'natural-grit' && granularKind !== 'polymeric-sand')
    throw new Error(
      `Paving joint material '${material.id}' has wrong granular kind '${String(granularKind)}'`,
    );
  if (role === 'substrate' && granularKind !== 'compacted-base')
    throw new Error(
      `Paving substrate material '${material.id}' has wrong granular kind '${String(granularKind)}'`,
    );
}

function assertLiveConstructionTarget(
  geometry: Awaited<ReturnType<typeof loadGeometry>>,
  materialId: string,
  role: 'continuousJoint' | 'continuousSubstrate',
) {
  if (!geometry.materials.some((material) => material.id === materialId))
    throw new Error(
      `Paving ${role} target '${materialId}' is absent from geometry '${geometry.id}'`,
    );
  if (!geometry.materialGroups.some((group) => group.materialId === materialId))
    throw new Error(
      `Paving ${role} target '${materialId}' has no triangle group in geometry '${geometry.id}'`,
    );
}

/**
 * Binds granular joint and substrate surfaces only through the disjoint construction targets
 * authored by the paving generator. The final geometry file appears atomically after both roles
 * and every texture dependency have passed validation.
 */
export async function bindPavingConstructionMaterials(
  options: BindPavingConstructionMaterialsOptions,
) {
  const sourceGeometryPath = resolve(options.pavingGeometryPath);
  const outputGeometryPath = resolve(options.outputGeometryPath);
  const jointMaterialPath = resolve(options.jointMaterialPath);
  const substrateMaterialPath = resolve(options.substrateMaterialPath);
  const geometry = await loadGeometry(sourceGeometryPath);
  const targets = pavingSurfaceMaterialTargetsSchema.parse(
    geometry.metadata.surfaceMaterialTargets,
  );
  assertLiveConstructionTarget(geometry, targets.continuousJoint, 'continuousJoint');
  assertLiveConstructionTarget(geometry, targets.continuousSubstrate, 'continuousSubstrate');

  const joint = await loadSurfaceMaterial(jointMaterialPath);
  const substrate = await loadSurfaceMaterial(substrateMaterialPath);
  assertGranularConstructionMaterial(joint, 'joint');
  assertGranularConstructionMaterial(substrate, 'substrate');

  await mkdir(dirname(outputGeometryPath), { recursive: true });
  const temporaryPath = `${outputGeometryPath}.incoming-${process.pid}-${randomUUID()}`;
  let bound = await restageGeometryTextureDependencies({
    geometry,
    sourceGeometryPath,
    outputGeometryPath,
  });
  try {
    if (joint.textureMaps) {
      if (!options.jointApplication)
        throw new Error(
          `Texture-backed paving joint material '${joint.id}' requires an application`,
        );
      bound = (
        await bindStagedSurfaceMaterialValue({
          geometry: bound,
          targetMaterialId: targets.continuousJoint,
          surface: joint,
          sourceTextureDirectory: dirname(jointMaterialPath),
          outputGeometryPath: temporaryPath,
          application: options.jointApplication,
        })
      ).geometry;
    } else bound = bindSurfaceMaterial(bound, targets.continuousJoint, joint);

    if (substrate.textureMaps) {
      if (!options.substrateApplication)
        throw new Error(
          `Texture-backed paving substrate material '${substrate.id}' requires an application`,
        );
      bound = (
        await bindStagedSurfaceMaterialValue({
          geometry: bound,
          targetMaterialId: targets.continuousSubstrate,
          surface: substrate,
          sourceTextureDirectory: dirname(substrateMaterialPath),
          outputGeometryPath: temporaryPath,
          application: options.substrateApplication,
        })
      ).geometry;
    } else bound = bindSurfaceMaterial(bound, targets.continuousSubstrate, substrate);

    await saveGeometry(temporaryPath, bound);
    await rename(temporaryPath, outputGeometryPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    geometry: bound,
    path: outputGeometryPath,
    targets: {
      joint: targets.continuousJoint,
      substrate: targets.continuousSubstrate,
    },
    materials: { joint: joint.id, substrate: substrate.id },
  };
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
    { surfaceSampling?: { kind?: unknown } } | undefined;
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
  if (application.placement.unitVariation)
    for (const name of Object.values(pavingUnitAppearanceAttributeNames)) {
      const attribute = geometry.attributes?.[name];
      if (!attribute || attribute.dataType !== 'float' || attribute.interpolation !== 'vertex')
        throw new Error(`Paving unit variation requires float vertex attribute '${name}'`);
    }
  const surface = await loadSurfaceMaterial(sourceMaterialPath);
  const bound = (
    await bindStagedSurfaceMaterialValueToTargets({
      geometry,
      targetMaterialIds: targets.modeledUnits,
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
