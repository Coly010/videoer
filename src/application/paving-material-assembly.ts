import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256File } from '../assets/library.js';
import {
  irregularPavingDefinitionSchema,
  pavingSurfaceMaterialTargetsSchema,
} from '../environments/irregular-paving.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import { loadSurfaceMaterial } from '../materials/io.js';
import { bindSurfaceMaterial, bindSurfaceMaterialTargets } from '../materials/adaptation.js';
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
  borderMaterialPaths?: Record<string, string>;
  borderApplications?: Record<string, TextureMaterialApplication>;
}

export interface BindProceduralPavingUnitMaterialOptions {
  pavingGeometryPath: string;
  unitMaterialPath: string;
  outputGeometryPath: string;
}

type UnitVariationDeclaration = {
  valueAttribute: string;
  roughnessAttribute: string;
  weatheringAttribute: string;
  edgeWearAttribute?: string | undefined;
  dirtAccumulationAttribute?: string | undefined;
};

function assertUnitVariationAttributes(
  geometry: Awaited<ReturnType<typeof loadGeometry>>,
  variation: UnitVariationDeclaration,
) {
  const expectedRanges = [
    [variation.valueAttribute, -1, 1],
    [variation.roughnessAttribute, -1, 1],
    [variation.weatheringAttribute, -1, 1],
    ...(variation.edgeWearAttribute ? [[variation.edgeWearAttribute, 0, 1]] : []),
    ...(variation.dirtAccumulationAttribute ? [[variation.dirtAccumulationAttribute, 0, 1]] : []),
  ] as Array<[string, number, number]>;
  for (const [name, minimum, maximum] of expectedRanges) {
    const attribute = geometry.attributes?.[name];
    if (!attribute || attribute.dataType !== 'float' || attribute.interpolation !== 'vertex')
      throw new Error(`Paving unit variation requires float vertex attribute '${name}'`);
    const invalid = attribute.values.find((value) => value < minimum || value > maximum);
    if (invalid !== undefined)
      throw new Error(
        `Paving unit variation attribute '${name}' must remain within [${minimum}, ${maximum}]; received ${invalid}`,
      );
  }
}

function assertPavingTargetsLive(
  geometry: Awaited<ReturnType<typeof loadGeometry>>,
  targets: ReturnType<typeof pavingSurfaceMaterialTargetsSchema.parse>,
) {
  const materialIds = new Set(geometry.materials.map((material) => material.id));
  const groupedIds = new Set(geometry.materialGroups.map((group) => group.materialId));
  for (const target of [
    ...targets.modeledUnits,
    targets.continuousJoint,
    targets.continuousSubstrate,
    ...targets.borders,
  ]) {
    if (!materialIds.has(target))
      throw new Error(`Paving surface target '${target}' is absent from '${geometry.id}'`);
    if (!groupedIds.has(target))
      throw new Error(
        `Paving surface target '${target}' has no triangle group in '${geometry.id}'`,
      );
  }
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
  const requiredResponse =
    granularKind === 'natural-grit'
      ? 'natural-joint'
      : granularKind === 'polymeric-sand'
        ? 'polymeric-joint'
        : granularKind === 'compacted-base'
          ? 'exposed-substrate'
          : undefined;
  if (!requiredResponse || material.constructionSurfaceResponse?.kind !== requiredResponse)
    throw new Error(
      `Paving ${role} material '${material.id}' requires ${String(requiredResponse)} construction response`,
    );
}

function assertPavingBorderMaterial(
  material: SurfaceMaterial,
  targetMaterialId: string,
  expectedKinds: Array<'kerb' | 'gutter' | 'soldier-course'>,
) {
  if (material.metadata.constructionDomain !== 'paving-border')
    throw new Error(
      `Paving border material '${material.id}' has wrong construction domain; expected paving-border`,
    );
  if (!material.pavingBorder)
    throw new Error(`Paving border material '${material.id}' has no typed border compatibility`);
  if (material.constructionSurfaceResponse?.kind !== 'paving-border')
    throw new Error(
      `Paving border material '${material.id}' requires paving-border construction response`,
    );
  const incompatible = expectedKinds.filter(
    (kind) => !material.pavingBorder!.compatibleKinds.includes(kind),
  );
  if (incompatible.length > 0)
    throw new Error(
      `Paving border material '${material.id}' is incompatible with target '${targetMaterialId}' kinds ${incompatible.join(', ')}`,
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
 * Binds granular joint/substrate surfaces and, when declared, the exact border-material set
 * through the disjoint construction targets authored by the paving generator. The final geometry
 * file appears atomically after every role and texture dependency has passed validation.
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
  const definition = irregularPavingDefinitionSchema.parse(geometry.metadata.definition);
  assertLiveConstructionTarget(geometry, targets.continuousJoint, 'continuousJoint');
  assertLiveConstructionTarget(geometry, targets.continuousSubstrate, 'continuousSubstrate');

  const joint = await loadSurfaceMaterial(jointMaterialPath);
  const substrate = await loadSurfaceMaterial(substrateMaterialPath);
  assertGranularConstructionMaterial(joint, 'joint');
  assertGranularConstructionMaterial(substrate, 'substrate');
  const suppliedBorderTargets = Object.keys(options.borderMaterialPaths ?? {}).sort();
  const expectedBorderTargets = [...targets.borders].sort();
  if (options.borderMaterialPaths) {
    const missing = expectedBorderTargets.filter(
      (target) => !suppliedBorderTargets.includes(target),
    );
    const extra = suppliedBorderTargets.filter((target) => !expectedBorderTargets.includes(target));
    if (missing.length > 0 || extra.length > 0)
      throw new Error(
        `Paving border material bindings must exactly match live targets; missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
      );
  }
  const extraApplications = Object.keys(options.borderApplications ?? {}).filter(
    (target) => !suppliedBorderTargets.includes(target),
  );
  if (extraApplications.length > 0)
    throw new Error(
      `Paving border applications have no material binding for [${extraApplications.sort().join(', ')}]`,
    );
  const borderMaterials = new Map<string, { material: SurfaceMaterial; path: string }>();
  for (const target of suppliedBorderTargets) {
    const path = resolve(options.borderMaterialPaths![target]!);
    const material = await loadSurfaceMaterial(path);
    const kinds = [
      ...new Set(
        definition.borders
          .filter((border) => border.materialId === target)
          .map((border) => border.kind),
      ),
    ];
    if (kinds.length === 0)
      throw new Error(`Paving border target '${target}' has no live border definition`);
    assertPavingBorderMaterial(material, target, kinds);
    borderMaterials.set(target, { material, path });
  }

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

    for (const target of suppliedBorderTargets) {
      const { material, path } = borderMaterials.get(target)!;
      if (material.textureMaps) {
        const applicationValue = options.borderApplications?.[target];
        if (!applicationValue)
          throw new Error(
            `Texture-backed paving border material '${material.id}' requires an application for '${target}'`,
          );
        const application = textureMaterialApplicationSchema.parse(applicationValue);
        if (application.constructionDomain !== 'paving-border')
          throw new Error(
            `Paving border application for '${target}' requires paving-border construction domain`,
          );
        bound = (
          await bindStagedSurfaceMaterialValue({
            geometry: bound,
            targetMaterialId: target,
            surface: material,
            sourceTextureDirectory: dirname(path),
            outputGeometryPath: temporaryPath,
            application,
          })
        ).geometry;
      } else bound = bindSurfaceMaterial(bound, target, material);
    }

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
    borderTargets: suppliedBorderTargets,
    materials: {
      joint: joint.id,
      substrate: substrate.id,
      borders: Object.fromEntries(
        suppliedBorderTargets.map((target) => [target, borderMaterials.get(target)!.material.id]),
      ),
    },
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
  assertPavingTargetsLive(geometry, targets);
  const definition = geometry.metadata.definition as
    { surfaceSampling?: { kind?: unknown } } | undefined;
  if (definition?.surfaceSampling?.kind !== 'deterministic-unit-local-uv-meters')
    throw new Error(
      `Paving geometry '${geometry.id}' does not declare deterministic unit-local metre sampling`,
    );
  const application = textureMaterialApplicationSchema.parse(options.unitApplication);
  if (
    application.constructionDomain !== 'modeled-paving-unit' ||
    application.placement.orientation !== 'unit-local-uv-meters'
  )
    throw new Error(
      'Paving unit binding requires modeled-paving-unit with unit-local-uv-meters placement',
    );
  if (application.placement.unitVariation)
    assertUnitVariationAttributes(geometry, application.placement.unitVariation);
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

export async function bindProceduralPavingUnitMaterial(
  options: BindProceduralPavingUnitMaterialOptions,
) {
  const sourceGeometryPath = resolve(options.pavingGeometryPath);
  const outputGeometryPath = resolve(options.outputGeometryPath);
  const geometry = await loadGeometry(sourceGeometryPath);
  const targets = pavingSurfaceMaterialTargetsSchema.parse(
    geometry.metadata.surfaceMaterialTargets,
  );
  assertPavingTargetsLive(geometry, targets);
  const surface = await loadSurfaceMaterial(options.unitMaterialPath);
  if (surface.textureMaps)
    throw new Error('Procedural paving unit binding does not accept texture-backed materials');
  if (surface.metadata.constructionDomain !== 'modeled-paving-unit' || !surface.unitVariation)
    throw new Error(
      `Procedural paving material '${surface.id}' requires modeled-paving-unit metadata and unit variation`,
    );
  assertUnitVariationAttributes(geometry, surface.unitVariation);
  const bound = bindSurfaceMaterialTargets(geometry, targets.modeledUnits, surface);
  await mkdir(dirname(outputGeometryPath), { recursive: true });
  const temporaryPath = `${outputGeometryPath}.incoming-${process.pid}-${randomUUID()}`;
  try {
    await saveGeometry(temporaryPath, bound);
    await rename(temporaryPath, outputGeometryPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    geometry: bound,
    path: outputGeometryPath,
    materialId: surface.id,
    modeledUnitTargets: targets.modeledUnits,
  };
}
