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
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

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
}

/**
 * Converts a verified open-material source package into a renderer-independent SurfaceMaterial.
 * Existing procedural values remain the explicit fallback; no colour, scale, or PBR value is
 * guessed from filenames or provider defaults.
 */
export async function deriveTextureSurfaceMaterial(
  options: DeriveTextureSurfaceMaterialOptions,
) {
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
      left.materialId.localeCompare(right.materialId) || left.semantic.localeCompare(right.semantic),
  );
  return dependencies;
}

export interface BindStagedSurfaceMaterialOptions {
  geometry: GeometryAsset;
  targetMaterialId: string;
  surfaceMaterialPath: string;
  outputGeometryPath: string;
}

export interface BindStagedSurfaceMaterialValueOptions {
  geometry: GeometryAsset;
  targetMaterialId: string;
  surface: SurfaceMaterial;
  sourceTextureDirectory: string;
  outputGeometryPath: string;
}

/** Copies every declared texture byte beside the bound geometry and rewrites only portable paths. */
export async function bindStagedSurfaceMaterialValue(
  options: BindStagedSurfaceMaterialValueOptions,
) {
  const outputPath = resolve(options.outputGeometryPath);
  const outputDirectory = dirname(outputPath);
  const staged = structuredClone(surfaceMaterialSchema.parse(options.surface));
  if (staged.textureMaps) {
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
  });
}
