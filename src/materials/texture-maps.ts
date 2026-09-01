import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { canonicalSha256, sha256Bytes } from '../assets/sources/cache.js';
import {
  openMaterialSourceManifestSchema,
  type MaterialTextureChannel,
  type OpenMaterialSourceManifest,
} from '../assets/sources/model.js';
import { loadGeometry, saveGeometry } from '../geometry/io.js';
import type { GeometryAsset } from '../geometry/model.js';
import { bindSurfaceMaterial } from './adaptation.js';
import { loadSurfaceMaterial } from './io.js';
import {
  surfaceMaterialSchema,
  textureMaterialApplicationSchema,
  textureMaterialSuitabilitySchema,
  type SurfaceMaterial,
  type TextureMaterialApplication,
  type TextureMaterialSuitability,
} from './model.js';

function containedPath(root: string, portablePath: string) {
  const base = resolve(root);
  const target = resolve(base, portablePath);
  if (target !== base && !target.startsWith(`${base}${sep}`))
    throw new Error(`Texture dependency escapes its package: ${portablePath}`);
  return target;
}

function portablePath(fromDirectory: string, target: string) {
  const value = relative(resolve(fromDirectory), resolve(target)).split(sep).join('/');
  if (!value || value === '..' || value.startsWith('../') || value.includes('/../'))
    throw new Error(`Texture staging produced a non-portable path: ${value}`);
  return value;
}

async function readExact(path: string, expectedSha256: string, expectedSize?: number) {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Texture dependency is missing: ${path}`);
    throw error;
  }
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize)
    throw new Error(
      `Texture dependency size mismatch for ${path}: expected ${expectedSize}, got ${bytes.byteLength}`,
    );
  const actual = sha256Bytes(bytes);
  if (actual !== expectedSha256)
    throw new Error(
      `Texture dependency hash mismatch for ${path}: expected ${expectedSha256}, got ${actual}`,
    );
  return bytes;
}

async function writeExact(path: string, bytes: Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (sha256Bytes(await readFile(path)) !== sha256Bytes(bytes))
      throw new Error(`Texture staging target already contains different bytes: ${path}`);
  }
}

async function verifyManifestPackage(
  manifestDirectory: string,
  manifest: OpenMaterialSourceManifest,
) {
  if (manifest.provider === 'ambientcg') {
    const expectedIdentity = canonicalSha256({
      schemaVersion: 1,
      provider: manifest.provider,
      adapterVersion: manifest.adapterVersion,
      assetId: manifest.asset.id,
      variant: `${manifest.selection.resolution}-${manifest.selection.encoding}`,
      requestUrl: manifest.providerApi.requestUrl,
      responseSha256: manifest.providerApi.responseSha256,
      archiveSha256: manifest.sourceArchive.sha256,
      archiveUrl: manifest.selection.archiveUrl,
      declaredSizeBytes: manifest.selection.declaredSizeBytes,
    });
    if (manifest.sourceIdentitySha256 !== expectedIdentity)
      throw new Error(
        `Open material source identity mismatch: expected ${expectedIdentity}, got ${manifest.sourceIdentitySha256}`,
      );
  }
  await readExact(
    containedPath(manifestDirectory, manifest.providerApi.responsePath),
    manifest.providerApi.responseSha256,
  );
  await readExact(
    containedPath(manifestDirectory, manifest.licence.evidencePath),
    manifest.licence.evidenceSha256,
  );
  await readExact(
    containedPath(manifestDirectory, manifest.sourceArchive.path),
    manifest.sourceArchive.sha256,
    manifest.sourceArchive.sizeBytes,
  );
  return Promise.all(
    manifest.channels.map(async (channel) => ({
      channel,
      bytes: await readExact(
        containedPath(manifestDirectory, channel.path),
        channel.sha256,
        channel.sizeBytes,
      ),
    })),
  );
}

export interface DeriveTextureSurfaceMaterialOptions {
  base: SurfaceMaterial;
  assetId: string;
  sourceManifestPath: string;
  outputMaterialPath: string;
  suitability: TextureMaterialSuitability;
}

/**
 * Converts a verified open-material source package into a renderer-independent SurfaceMaterial.
 * Existing procedural values remain the explicit fallback; no colour, scale, or PBR value is
 * guessed from filenames or provider defaults.
 */
export async function deriveTextureSurfaceMaterial(options: DeriveTextureSurfaceMaterialOptions) {
  const manifestPath = resolve(options.sourceManifestPath);
  const manifestBytes = await readFile(manifestPath);
  const manifest = openMaterialSourceManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(manifestBytes)),
  );
  if (manifest.physicalScale.status !== 'known')
    throw new Error(
      `Open material '${manifest.asset.id}' has unknown physical scale; supply corrected source evidence before derivation`,
    );
  const channels = await verifyManifestPackage(dirname(manifestPath), manifest);
  const outputPath = resolve(options.outputMaterialPath);
  const outputDirectory = dirname(outputPath);
  const stagedChannels = [];
  for (const { channel, bytes } of channels) {
    const extension = extname(channel.path).toLowerCase();
    const target = join(
      outputDirectory,
      'textures',
      `${channel.semantic}-${channel.sha256}${extension}`,
    );
    await writeExact(target, bytes);
    stagedChannels.push({
      ...channel,
      path: portablePath(outputDirectory, target),
    });
  }
  const material = surfaceMaterialSchema.parse({
    ...structuredClone(surfaceMaterialSchema.parse(options.base)),
    id: options.assetId,
    textureMaps: {
      kind: 'hash-bound',
      source: {
        provider: manifest.provider,
        sourceIdentitySha256: manifest.sourceIdentitySha256,
        manifestSha256: sha256Bytes(manifestBytes),
        licenceSpdx: manifest.licence.spdx,
      },
      physicalScale: {
        widthMeters: manifest.physicalScale.widthMeters,
        heightMeters: manifest.physicalScale.heightMeters,
      },
      suitability: textureMaterialSuitabilitySchema.parse(options.suitability),
      channels: stagedChannels,
    },
    metadata: {
      ...options.base.metadata,
      sourceMaterial: options.base.id,
      sourceAsset: manifest.asset.id,
      derivationGenerator: 'videoer.hash-bound-texture-material.v1',
    },
  });
  await writeExact(outputPath, Buffer.from(`${JSON.stringify(material, null, 2)}\n`, 'utf8'));
  return { material, path: outputPath };
}

export interface TextureDependency {
  materialId: string;
  semantic: MaterialTextureChannel['semantic'];
  path: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Restages every already-bound texture dependency when geometry is derived into a new package.
 * Surface channel paths are package-relative, so copying only the JSON would create a valid-looking
 * asset whose live dependencies resolve against the wrong directory.
 */
export async function restageGeometryTextureDependencies(options: {
  geometry: GeometryAsset;
  sourceGeometryPath: string;
  outputGeometryPath: string;
}) {
  const geometry = structuredClone(options.geometry);
  const sourceDirectory = dirname(resolve(options.sourceGeometryPath));
  const outputDirectory = dirname(resolve(options.outputGeometryPath));
  for (const material of geometry.materials) {
    const channels = material.surface?.textureMaps?.channels;
    if (!channels) continue;
    for (const channel of channels) {
      const sourcePath = containedPath(sourceDirectory, channel.path);
      const bytes = await readExact(sourcePath, channel.sha256, channel.sizeBytes);
      const extension = extname(channel.path).toLowerCase();
      const target = join(
        outputDirectory,
        'textures',
        `${channel.semantic}-${channel.sha256}${extension}`,
      );
      await writeExact(target, bytes);
      channel.path = portablePath(outputDirectory, target);
    }
  }
  return geometry;
}

export interface TextureMaterialRejectionReason {
  code:
    | 'not-texture-backed'
    | 'construction-domain-not-declared'
    | 'layout-scan-on-modeled-units'
    | 'facade-pattern-on-non-facade'
    | 'modeled-paving-unit-requires-unit-local-mapping'
    | 'unit-local-mapping-on-non-modeled-unit'
    | 'unit-local-mapping-requires-homogeneous-unit-material'
    | 'paving-joint-substrate-requires-world-horizontal'
    | 'paving-joint-substrate-composition-incompatible'
    | 'orientation-incompatible'
    | 'macro-variation-scale-too-small';
  message: string;
}

export function assessTextureMaterialSuitability(
  surface: SurfaceMaterial,
  application: TextureMaterialApplication,
) {
  const parsed = surfaceMaterialSchema.parse(surface);
  const applied = textureMaterialApplicationSchema.parse(application);
  const textureMaps = parsed.textureMaps;
  const reasons: TextureMaterialRejectionReason[] = [];
  if (!textureMaps) {
    reasons.push({
      code: 'not-texture-backed',
      message: `Surface material '${parsed.id}' has no hash-bound texture source to assess`,
    });
    return { accepted: false as const, reasons, materialId: parsed.id, application: applied };
  }
  const domain = applied.constructionDomain;
  if (!textureMaps.suitability.intendedConstructionDomains.includes(domain))
    reasons.push({
      code: 'construction-domain-not-declared',
      message: `Material '${parsed.id}' does not declare '${domain}' as an intended construction domain`,
    });
  if (
    textureMaps.suitability.composition === 'continuous-layout-scan' &&
    (domain === 'modeled-paving-unit' || domain === 'modeled-masonry-unit')
  )
    reasons.push({
      code: 'layout-scan-on-modeled-units',
      message:
        'A continuous photographed layout cannot be applied to individually modeled construction units',
    });
  if (
    textureMaps.suitability.composition === 'facade-course-pattern' &&
    domain !== 'flat-facade-surface'
  )
    reasons.push({
      code: 'facade-pattern-on-non-facade',
      message: 'A photographed facade course/pattern requires a flat facade host',
    });
  const modeledUnitDomain = domain === 'modeled-paving-unit' || domain === 'modeled-masonry-unit';
  if (domain === 'modeled-paving-unit' && applied.placement.orientation !== 'unit-local-uv-meters')
    reasons.push({
      code: 'modeled-paving-unit-requires-unit-local-mapping',
      message: 'Individually modeled paving units require unit-local UV coordinates in metres',
    });
  if (applied.placement.orientation === 'unit-local-uv-meters' && !modeledUnitDomain)
    reasons.push({
      code: 'unit-local-mapping-on-non-modeled-unit',
      message: `Unit-local UV mapping cannot be applied to '${domain}'`,
    });
  if (
    applied.placement.orientation === 'unit-local-uv-meters' &&
    textureMaps.suitability.composition !== 'homogeneous-unit-material'
  )
    reasons.push({
      code: 'unit-local-mapping-requires-homogeneous-unit-material',
      message: 'Unit-local UV mapping requires a homogeneous unit material',
    });
  if (domain === 'paving-joint-substrate' && applied.placement.orientation !== 'world-horizontal')
    reasons.push({
      code: 'paving-joint-substrate-requires-world-horizontal',
      message: 'A paving joint/substrate bed requires world-horizontal mapping',
    });
  if (
    domain === 'paving-joint-substrate' &&
    textureMaps.suitability.composition !== 'homogeneous-unit-material'
  )
    reasons.push({
      code: 'paving-joint-substrate-composition-incompatible',
      message:
        'A paving joint/substrate bed cannot use a photographed paving layout or facade course',
    });
  const horizontalDomain =
    domain === 'flat-ground-surface' ||
    domain === 'modeled-paving-unit' ||
    domain === 'paving-joint-substrate';
  const verticalDomain = domain === 'flat-facade-surface' || domain === 'modeled-masonry-unit';
  if (
    (horizontalDomain && applied.placement.orientation === 'world-vertical') ||
    (verticalDomain && applied.placement.orientation === 'world-horizontal')
  )
    reasons.push({
      code: 'orientation-incompatible',
      message: `Placement orientation '${applied.placement.orientation}' is incompatible with '${domain}'`,
    });
  const minimumMacroScale =
    Math.max(textureMaps.physicalScale.widthMeters, textureMaps.physicalScale.heightMeters) * 2;
  if (applied.placement.macroVariation.scaleMeters < minimumMacroScale)
    reasons.push({
      code: 'macro-variation-scale-too-small',
      message: `Macro variation scale must be at least ${minimumMacroScale}m to remain larger than the source tile`,
    });
  return {
    accepted: reasons.length === 0,
    reasons,
    materialId: parsed.id,
    composition: textureMaps.suitability.composition,
    application: applied,
  };
}

export async function geometryTextureDependencies(geometryPath: string) {
  const source = resolve(geometryPath);
  const geometry = await loadGeometry(source);
  const dependencies: Array<{
    materialId: string;
    semantic: MaterialTextureChannel['semantic'];
    path: string;
    sha256: string;
    sizeBytes: number;
  }> = [];
  for (const material of geometry.materials) {
    if (material.surface?.textureMaps) {
      if (!material.surface.textureMaps.application)
        throw new Error(
          `Bound texture material '${material.surface.id}' is missing its construction application`,
        );
      const assessment = assessTextureMaterialSuitability(
        material.surface,
        material.surface.textureMaps.application,
      );
      if (!assessment.accepted)
        throw new Error(
          `Bound texture material '${material.surface.id}' is unsuitable: ${assessment.reasons.map((reason) => `${reason.code}: ${reason.message}`).join('; ')}`,
        );
    }
    for (const channel of material.surface?.textureMaps?.channels ?? []) {
      const path = containedPath(dirname(source), channel.path);
      await readExact(path, channel.sha256, channel.sizeBytes);
      dependencies.push({
        materialId: material.id,
        semantic: channel.semantic,
        path,
        sha256: channel.sha256,
        sizeBytes: channel.sizeBytes,
      });
    }
  }
  dependencies.sort(
    (left, right) =>
      left.materialId.localeCompare(right.materialId) ||
      left.semantic.localeCompare(right.semantic),
  );
  return dependencies;
}

export interface BindStagedSurfaceMaterialOptions {
  geometry: GeometryAsset;
  targetMaterialId: string;
  surfaceMaterialPath: string;
  outputGeometryPath: string;
  application: TextureMaterialApplication;
}

export interface BindStagedSurfaceMaterialValueOptions {
  geometry: GeometryAsset;
  targetMaterialId: string;
  surface: SurfaceMaterial;
  sourceTextureDirectory: string;
  outputGeometryPath: string;
  application: TextureMaterialApplication;
}

/** Copies every declared texture byte beside the bound geometry and rewrites only portable paths. */
export async function bindStagedSurfaceMaterialValue(
  options: BindStagedSurfaceMaterialValueOptions,
) {
  const outputPath = resolve(options.outputGeometryPath);
  const outputDirectory = dirname(outputPath);
  const staged = structuredClone(surfaceMaterialSchema.parse(options.surface));
  if (staged.textureMaps) {
    const assessment = assessTextureMaterialSuitability(staged, options.application);
    if (!assessment.accepted)
      throw new Error(
        `Texture material suitability rejected: ${assessment.reasons.map((reason) => `${reason.code}: ${reason.message}`).join('; ')}`,
      );
    staged.textureMaps.application = assessment.application;
    for (const channel of staged.textureMaps.channels) {
      const sourcePath = containedPath(options.sourceTextureDirectory, channel.path);
      const bytes = await readExact(sourcePath, channel.sha256, channel.sizeBytes);
      const target = join(
        outputDirectory,
        'textures',
        `${channel.semantic}-${channel.sha256}${extname(channel.path).toLowerCase()}`,
      );
      await writeExact(target, bytes);
      channel.path = portablePath(outputDirectory, target);
    }
  }
  const bound = bindSurfaceMaterial(options.geometry, options.targetMaterialId, staged);
  await saveGeometry(outputPath, bound);
  await geometryTextureDependencies(outputPath);
  return { geometry: bound, path: outputPath };
}

export async function bindStagedSurfaceMaterial(options: BindStagedSurfaceMaterialOptions) {
  const sourceMaterialPath = resolve(options.surfaceMaterialPath);
  return bindStagedSurfaceMaterialValue({
    geometry: options.geometry,
    targetMaterialId: options.targetMaterialId,
    surface: await loadSurfaceMaterial(sourceMaterialPath),
    sourceTextureDirectory: dirname(sourceMaterialPath),
    outputGeometryPath: options.outputGeometryPath,
    application: options.application,
  });
}
