import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';
import {
  architecturalEnvelopeMaterialRoleSchema,
  architecturalEnvelopeMaterialTargetsSchema,
  type ArchitecturalEnvelopeMaterialRole,
} from '../environments/architectural-envelope.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import type { GeometryAsset } from '../geometry/model.js';
import { bindSurfaceMaterial } from '../materials/adaptation.js';
import { loadSurfaceMaterial } from '../materials/io.js';
import {
  constructionDomainSchema,
  textureMaterialApplicationSchema,
  type SurfaceMaterial,
  type TextureMaterialApplication,
} from '../materials/model.js';
import {
  bindStagedSurfaceMaterialValue,
  restageGeometryTextureDependencies,
} from '../materials/texture-maps.js';

const compatibilitySchema = z.object({
  constructionDomain: constructionDomainSchema,
  architecturalRoleCompatibility: z
    .array(architecturalEnvelopeMaterialRoleSchema)
    .min(1)
    .refine((roles) => new Set(roles).size === roles.length, 'compatible roles must be unique'),
  targetMaterialId: z.string().optional(),
});

type ConstructionDomain = z.infer<typeof constructionDomainSchema>;
type PatternKind = SurfaceMaterial['pattern']['kind'];

const acceptedDomains: Record<ArchitecturalEnvelopeMaterialRole, ConstructionDomain[]> = {
  structure: ['modeled-masonry-unit', 'monolithic-architectural-surface'],
  foundation: ['natural-rock-surface', 'monolithic-architectural-surface'],
  'facade-finish': ['flat-facade-surface', 'modeled-masonry-unit', 'natural-rock-surface'],
  'facade-trim': ['natural-rock-surface', 'monolithic-architectural-surface', 'prop-surface'],
  'facade-damp-course': ['natural-rock-surface', 'monolithic-architectural-surface'],
  roof: ['natural-rock-surface', 'monolithic-architectural-surface'],
  'roof-trim': ['natural-rock-surface', 'monolithic-architectural-surface', 'prop-surface'],
  threshold: ['natural-rock-surface', 'monolithic-architectural-surface'],
  'interior-wall': ['flat-facade-surface', 'monolithic-architectural-surface'],
  'dark-room': ['flat-facade-surface', 'monolithic-architectural-surface'],
  'lit-room': ['flat-facade-surface', 'monolithic-architectural-surface'],
  occupancy: ['prop-surface'],
};

const acceptedPatterns: Record<ArchitecturalEnvelopeMaterialRole, PatternKind[]> = {
  structure: ['masonry-bond', 'mineral-plaster', 'granular-aggregate', 'isotropic'],
  foundation: ['cut-stone', 'granular-aggregate', 'isotropic'],
  'facade-finish': ['mineral-plaster', 'masonry-bond', 'cut-stone', 'isotropic'],
  'facade-trim': ['directional-wood', 'brushed-metal', 'cut-stone', 'isotropic'],
  'facade-damp-course': ['cut-stone', 'granular-aggregate', 'isotropic'],
  roof: ['cut-stone', 'isotropic'],
  'roof-trim': ['directional-wood', 'brushed-metal', 'cut-stone', 'isotropic'],
  threshold: ['cut-stone', 'granular-aggregate', 'isotropic'],
  'interior-wall': ['mineral-plaster', 'isotropic'],
  'dark-room': ['mineral-plaster', 'isotropic'],
  'lit-room': ['mineral-plaster', 'isotropic'],
  occupancy: ['directional-wood', 'brushed-metal', 'woven-textile', 'isotropic'],
};

export interface BindArchitecturalEnvelopeMaterialsOptions {
  envelopeGeometryPath: string;
  materialPaths: Record<string, string>;
  outputGeometryPath: string;
  reportPath?: string;
  applications?: Record<string, TextureMaterialApplication>;
}

function assertTargetsLive(
  geometry: GeometryAsset,
  targets: ReturnType<typeof architecturalEnvelopeMaterialTargetsSchema.parse>,
) {
  const materialIds = new Set(geometry.materials.map((material) => material.id));
  const groupedIds = new Set(geometry.materialGroups.map((group) => group.materialId));
  for (const target of targets.targets) {
    if (!materialIds.has(target.materialId))
      throw new Error(
        `Architectural material target '${target.materialId}' is absent from '${geometry.id}'`,
      );
    if (!groupedIds.has(target.materialId))
      throw new Error(
        `Architectural material target '${target.materialId}' has no triangle group in '${geometry.id}'`,
      );
  }
}

function assertExactCoverage(expected: string[], supplied: string[], label: string) {
  const missing = expected.filter((target) => !supplied.includes(target));
  const extra = supplied.filter((target) => !expected.includes(target));
  if (missing.length > 0 || extra.length > 0)
    throw new Error(
      `${label} must exactly match live architectural targets; missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
    );
}

function assertCompatible(
  target: { materialId: string; roles: ArchitecturalEnvelopeMaterialRole[] },
  surface: SurfaceMaterial,
) {
  const compatibility = compatibilitySchema.parse(surface.metadata);
  if (
    compatibility.targetMaterialId !== undefined &&
    compatibility.targetMaterialId !== target.materialId
  )
    throw new Error(
      `Architectural material '${surface.id}' was authored for target '${compatibility.targetMaterialId}', not '${target.materialId}'`,
    );
  const missingRoles = target.roles.filter(
    (role) => !compatibility.architecturalRoleCompatibility.includes(role),
  );
  if (missingRoles.length > 0)
    throw new Error(
      `Architectural material '${surface.id}' is incompatible with '${target.materialId}' roles [${missingRoles.join(', ')}]`,
    );
  for (const role of target.roles) {
    if (!acceptedDomains[role].includes(compatibility.constructionDomain))
      throw new Error(
        `Architectural material '${surface.id}' uses domain '${compatibility.constructionDomain}' for incompatible role '${role}'`,
      );
    if (!acceptedPatterns[role].includes(surface.pattern.kind))
      throw new Error(
        `Architectural material '${surface.id}' uses pattern '${surface.pattern.kind}' for incompatible role '${role}'`,
      );
  }
  return compatibility;
}

function assertGeometryTopologyPreserved(source: GeometryAsset, output: GeometryAsset) {
  for (const field of [
    'positions',
    'indices',
    'materialGroups',
    'attachments',
    'skeleton',
  ] as const)
    if (JSON.stringify(source[field]) !== JSON.stringify(output[field]))
      throw new Error(`Architectural material assembly mutated geometry field '${field}'`);
}

/**
 * Atomically binds one compatible surface to every compiler-authored envelope material target.
 * Missing and extra targets are both rejected so scalar fallbacks cannot survive unnoticed.
 */
export async function bindArchitecturalEnvelopeMaterials(
  options: BindArchitecturalEnvelopeMaterialsOptions,
) {
  const sourceGeometryPath = resolve(options.envelopeGeometryPath);
  const outputGeometryPath = resolve(options.outputGeometryPath);
  const reportPath = resolve(
    options.reportPath ??
      join(dirname(outputGeometryPath), 'architectural-envelope-material-binding-report.json'),
  );
  const source = await loadGeometry(sourceGeometryPath);
  const targets = architecturalEnvelopeMaterialTargetsSchema.parse(
    source.metadata.architecturalMaterialTargets,
  );
  assertTargetsLive(source, targets);
  const expected = targets.targets.map((target) => target.materialId).sort();
  const supplied = Object.keys(options.materialPaths).sort();
  assertExactCoverage(expected, supplied, 'Architectural material paths');
  const orphanApplications = Object.keys(options.applications ?? {}).filter(
    (target) => !supplied.includes(target),
  );
  if (orphanApplications.length > 0)
    throw new Error(
      `Architectural material applications have no material binding for [${orphanApplications.sort().join(', ')}]`,
    );

  const loaded = new Map<
    string,
    { path: string; surface: SurfaceMaterial; sha256: string; domain: ConstructionDomain }
  >();
  for (const target of targets.targets) {
    const path = resolve(options.materialPaths[target.materialId]!);
    const surface = await loadSurfaceMaterial(path);
    const compatibility = assertCompatible(target, surface);
    loaded.set(target.materialId, {
      path,
      surface,
      sha256: await sha256File(path),
      domain: compatibility.constructionDomain,
    });
  }

  await mkdir(dirname(outputGeometryPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  const nonce = `${process.pid}-${randomUUID()}`;
  const temporaryGeometryPath = `${outputGeometryPath}.incoming-${nonce}`;
  const temporaryReportPath = `${reportPath}.incoming-${nonce}`;
  let bound = await restageGeometryTextureDependencies({
    geometry: source,
    sourceGeometryPath,
    outputGeometryPath: temporaryGeometryPath,
  });
  try {
    for (const target of targets.targets) {
      const entry = loaded.get(target.materialId)!;
      if (entry.surface.textureMaps) {
        const application = options.applications?.[target.materialId];
        if (!application)
          throw new Error(
            `Texture-backed architectural material '${entry.surface.id}' requires an application for '${target.materialId}'`,
          );
        const parsedApplication = textureMaterialApplicationSchema.parse(application);
        if (parsedApplication.constructionDomain !== entry.domain)
          throw new Error(
            `Architectural application domain '${parsedApplication.constructionDomain}' does not match material domain '${entry.domain}' for '${target.materialId}'`,
          );
        bound = (
          await bindStagedSurfaceMaterialValue({
            geometry: bound,
            targetMaterialId: target.materialId,
            surface: entry.surface,
            sourceTextureDirectory: dirname(entry.path),
            outputGeometryPath: temporaryGeometryPath,
            application: parsedApplication,
          })
        ).geometry;
      } else {
        if (options.applications?.[target.materialId])
          throw new Error(
            `Procedural architectural material '${entry.surface.id}' must not receive a texture application`,
          );
        bound = bindSurfaceMaterial(bound, target.materialId, entry.surface);
      }
    }
    assertGeometryTopologyPreserved(source, bound);
    const unboundTargets = targets.targets
      .map((target) => target.materialId)
      .filter((target) => !bound.materials.find((material) => material.id === target)?.surface);
    if (unboundTargets.length > 0)
      throw new Error(`Architectural targets remain unbound [${unboundTargets.join(', ')}]`);
    await saveGeometry(temporaryGeometryPath, bound);
    await rename(temporaryGeometryPath, outputGeometryPath);
    const report = {
      schemaVersion: 1,
      operation: 'videoer.bind-architectural-envelope-materials.v1',
      sourceGeometry: {
        id: source.id,
        path: sourceGeometryPath,
        sha256: await sha256File(sourceGeometryPath),
      },
      outputGeometry: {
        id: bound.id,
        path: outputGeometryPath,
        sha256: await sha256File(outputGeometryPath),
      },
      exactCoverage: true,
      topologyPreserved: true,
      unboundTargetCount: 0,
      bindings: targets.targets.map((target) => {
        const entry = loaded.get(target.materialId)!;
        return {
          targetMaterialId: target.materialId,
          roles: target.roles,
          surfaceMaterialId: entry.surface.id,
          constructionDomain: entry.domain,
          pattern: entry.surface.pattern.kind,
          materialFileSha256: entry.sha256,
          textureBacked: Boolean(entry.surface.textureMaps),
        };
      }),
    };
    await writeFile(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temporaryReportPath, reportPath);
    return { geometry: bound, path: outputGeometryPath, reportPath, report };
  } catch (error) {
    await rm(temporaryGeometryPath, { force: true });
    await rm(temporaryReportPath, { force: true });
    throw error;
  }
}
