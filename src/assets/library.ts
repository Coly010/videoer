import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';
import { z, ZodError } from 'zod';
import {
  assetKindSchema,
  assetKinds,
  assetReferenceSchema,
  type AssetKind,
  type AssetReference,
} from '../production/model.js';

const licenceSchema = z.object({
  spdx: z.string().min(1),
  name: z.string().min(1),
  commercialUse: z.enum(['allowed', 'restricted', 'unknown']),
  attributionRequired: z.boolean().default(false),
  url: z.string().url().optional(),
});

export const assetMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: assetReferenceSchema.shape.id,
    version: assetReferenceSchema.shape.version,
    type: assetKindSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(['draft', 'validated', 'verified', 'deprecated']).default('draft'),
    tags: z.array(z.string().min(1)).default([]),
    capabilities: z.array(z.string().min(1)).default([]),
    source: z.object({
      kind: z.enum(['self-authored', 'supplied', 'generated', 'imported', 'procedural']),
      generator: z.string().optional(),
      sourceAsset: z.string().optional(),
      sourceAssets: z.array(z.string().min(1)).optional(),
      references: z.array(z.string()).default([]),
      licence: licenceSchema,
      clearance: z.enum(['approved', 'review-required', 'rejected']),
    }),
    artifacts: z
      .array(
        z.object({
          role: z.string().min(1),
          path: z.string().min(1),
          mediaType: z.string().min(1),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        }),
      )
      .min(1),
    compatibility: z
      .object({
        coordinateSystem: z.string().optional(),
        skeleton: z.string().optional(),
        renderers: z.array(z.string()).default([]),
        requires: z.array(assetReferenceSchema).default([]),
      })
      .default({ renderers: [], requires: [] }),
    verification: z
      .object({
        checks: z.array(z.string()).default([]),
        artifacts: z.array(z.string()).default([]),
        verifiedAt: z.string().datetime().optional(),
      })
      .default({ checks: [], artifacts: [] }),
    deprecatedBy: assetReferenceSchema.optional(),
    deprecatedAt: z.string().datetime().optional(),
    deprecationReason: z.string().min(1).optional(),
  })
  .superRefine((asset, ctx) => {
    if (!asset.id.startsWith(`${asset.type}.`))
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: `asset id must begin with '${asset.type}.'`,
      });
    if (asset.status === 'verified' && !asset.verification.verifiedAt)
      ctx.addIssue({
        code: 'custom',
        path: ['verification', 'verifiedAt'],
        message: 'verified assets require verifiedAt',
      });
    if (
      asset.status === 'deprecated' &&
      (!asset.deprecatedBy || !asset.deprecatedAt || !asset.deprecationReason)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['deprecatedBy'],
        message: 'deprecated assets require successor, timestamp, and reason',
      });
  });

export type AssetMetadata = z.infer<typeof assetMetadataSchema>;
export interface LibraryAsset extends AssetMetadata {
  metadataPath: string;
  directory: string;
}

const directories: Record<AssetKind, string> = {
  character: 'characters',
  environment: 'environments',
  prop: 'props',
  material: 'materials',
  clothing: 'clothing',
  hair: 'hair',
  motion: 'motions',
  vfx: 'vfx',
  audio: 'audio',
  lighting: 'lighting',
  editorial: 'editorial',
};

function explainZod(error: ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

export async function loadAssetMetadata(path: string): Promise<LibraryAsset> {
  const absolute = resolve(path);
  try {
    const metadata = assetMetadataSchema.parse(YAML.parse(await readFile(absolute, 'utf8')));
    return { ...metadata, metadataPath: absolute, directory: dirname(absolute) };
  } catch (error) {
    if (error instanceof ZodError)
      throw new Error(`Invalid asset metadata ${absolute}: ${explainZod(error)}`);
    throw error;
  }
}

async function metadataFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === 'asset.yaml') output.push(path);
    }
  }
  await visit(resolve(root));
  return output.sort();
}

export async function scanAssetLibrary(root: string): Promise<LibraryAsset[]> {
  return Promise.all((await metadataFiles(root)).map(loadAssetMetadata));
}

function safeRelativePath(directory: string, candidate: string) {
  if (isAbsolute(candidate)) throw new Error(`Asset artifact path must be relative: ${candidate}`);
  const absolute = resolve(directory, candidate);
  const rel = relative(directory, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`))
    throw new Error(`Asset artifact escapes its asset directory: ${candidate}`);
  return absolute;
}

export async function sha256File(path: string) {
  return new Promise<string>((fulfil, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => fulfil(hash.digest('hex')));
  });
}

export async function validateLibraryAsset(asset: LibraryAsset) {
  const issues: string[] = [];
  if (asset.source.licence.commercialUse !== 'allowed')
    issues.push(`licence commercial use is ${asset.source.licence.commercialUse}`);
  if (asset.source.clearance !== 'approved')
    issues.push(`source clearance is ${asset.source.clearance}`);
  for (const artifact of asset.artifacts) {
    try {
      const path = safeRelativePath(asset.directory, artifact.path);
      await access(path);
      if ((asset.status === 'verified' || asset.status === 'deprecated') && !artifact.sha256)
        issues.push(`verified artifact lacks SHA-256: ${artifact.path}`);
      if (artifact.sha256) {
        const actual = await sha256File(path);
        if (actual !== artifact.sha256)
          issues.push(
            `artifact hash mismatch for ${artifact.path}: expected ${artifact.sha256}, got ${actual}`,
          );
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const artifact of asset.verification.artifacts) {
    try {
      await access(safeRelativePath(asset.directory, artifact));
      const declared = asset.artifacts.find((candidate) => candidate.path === artifact);
      if (
        (asset.status === 'verified' || asset.status === 'deprecated') &&
        (!declared || !declared.sha256)
      )
        issues.push(`verified evidence lacks a hashed artifact declaration: ${artifact}`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { valid: issues.length === 0, issues };
}

function mediaTypeForArtifact(path: string) {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'application/yaml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.blend')) return 'application/x-blender';
  return 'application/octet-stream';
}

/** Persist metadata only after every release artifact and verification file is content-addressed. */
export async function writeHashedAssetMetadata(metadataPath: string, input: AssetMetadata) {
  const absolute = resolve(metadataPath);
  const directory = dirname(absolute);
  const parsed = assetMetadataSchema.parse(input);
  const artifacts = parsed.artifacts.map((artifact) => ({ ...artifact }));
  for (const verificationPath of parsed.verification.artifacts)
    if (!artifacts.some((artifact) => artifact.path === verificationPath))
      artifacts.push({
        role: `verification-${verificationPath
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')}`,
        path: verificationPath,
        mediaType: mediaTypeForArtifact(verificationPath),
      });
  const hashedArtifacts = await Promise.all(
    artifacts.map(async (artifact) => ({
      ...artifact,
      sha256: await sha256File(safeRelativePath(directory, artifact.path)),
    })),
  );
  const metadata = assetMetadataSchema.parse({ ...parsed, artifacts: hashedArtifacts });
  await mkdir(directory, { recursive: true });
  await writeFile(absolute, YAML.stringify(metadata), 'utf8');
  return { ...metadata, metadataPath: absolute, directory } satisfies LibraryAsset;
}

export interface AssetSearchOptions {
  query?: string;
  type?: AssetKind;
  tags?: string[];
  capabilities?: string[];
  includeUncleared?: boolean;
  includeDeprecated?: boolean;
}

function words(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function compareSemanticVersionsDescending(left: string, right: string) {
  const parse = (value: string) => {
    const [core, prerelease] = value.split('-', 2);
    return {
      numbers: core!.split('.').map(Number),
      prerelease,
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    const difference = b.numbers[index]! - a.numbers[index]!;
    if (difference) return difference;
  }
  if (a.prerelease === undefined && b.prerelease !== undefined) return -1;
  if (a.prerelease !== undefined && b.prerelease === undefined) return 1;
  return (b.prerelease ?? '').localeCompare(a.prerelease ?? '', undefined, { numeric: true });
}

export async function searchAssetLibrary(root: string, options: AssetSearchOptions = {}) {
  const query = new Set(words(options.query ?? ''));
  const tags = new Set((options.tags ?? []).map((tag) => tag.toLowerCase()));
  const capabilities = new Set((options.capabilities ?? []).map((item) => item.toLowerCase()));
  const results: Array<{
    asset: LibraryAsset;
    score: number;
    matchedTags: string[];
    missingCapabilities: string[];
  }> = [];
  for (const asset of await scanAssetLibrary(root)) {
    if (options.type && asset.type !== options.type) continue;
    if (!options.includeDeprecated && asset.status === 'deprecated') continue;
    if (
      !options.includeUncleared &&
      (asset.source.clearance !== 'approved' || asset.source.licence.commercialUse !== 'allowed')
    )
      continue;
    const searchable = new Set(
      words(
        [asset.id, asset.title, asset.description, ...asset.tags, ...asset.capabilities].join(' '),
      ),
    );
    const queryMatches = [...query].filter((word) => searchable.has(word));
    if (query.size && queryMatches.length === 0) continue;
    const normalizedTags = asset.tags.map((tag) => tag.toLowerCase());
    const matchedTags = [...tags].filter((tag) => normalizedTags.includes(tag));
    const normalizedCapabilities = asset.capabilities.map((item) => item.toLowerCase());
    const missingCapabilities = [...capabilities].filter(
      (item) => !normalizedCapabilities.includes(item),
    );
    const score =
      queryMatches.length * 4 +
      matchedTags.length * 3 +
      (capabilities.size - missingCapabilities.length) * 5 +
      (asset.status === 'verified' ? 3 : asset.status === 'validated' ? 1 : 0);
    results.push({ asset, score, matchedTags, missingCapabilities });
  }
  return results.sort(
    (a, b) =>
      b.score - a.score ||
      a.asset.id.localeCompare(b.asset.id) ||
      compareSemanticVersionsDescending(a.asset.version, b.asset.version),
  );
}

export async function findAsset(root: string, reference: AssetReference) {
  return (await scanAssetLibrary(root)).find(
    (asset) => asset.id === reference.id && asset.version === reference.version,
  );
}

export function canonicalAssetDirectory(
  root: string,
  asset: Pick<AssetMetadata, 'id' | 'version' | 'type'>,
) {
  const name = asset.id.slice(asset.type.length + 1).replaceAll('.', '-');
  return join(resolve(root), directories[asset.type], name, asset.version);
}

export async function publishAsset(sourceDirectory: string, libraryRoot: string) {
  const source = resolve(sourceDirectory);
  const asset = await loadAssetMetadata(join(source, 'asset.yaml'));
  const validation = await validateLibraryAsset(asset);
  if (!validation.valid)
    throw new Error(`Asset cannot be published: ${validation.issues.join('; ')}`);
  const target = canonicalAssetDirectory(libraryRoot, asset);
  try {
    await access(target);
    throw new Error(`Asset version already exists: ${asset.id}@${asset.version}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const declared = new Set([
    'asset.yaml',
    ...asset.artifacts.map((artifact) => artifact.path),
    ...asset.verification.artifacts,
  ]);
  await mkdir(target, { recursive: true });
  try {
    for (const path of declared) {
      const sourceFile = safeRelativePath(source, path);
      const targetFile = safeRelativePath(target, path);
      await mkdir(dirname(targetFile), { recursive: true });
      await copyFile(sourceFile, targetFile);
    }
    const index = await buildAssetIndex(libraryRoot);
    return { asset: { id: asset.id, version: asset.version }, target, index: index.path };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    try {
      await buildAssetIndex(libraryRoot);
    } catch {
      // Preserve the publication failure as the primary diagnostic. The
      // previous on-disk index remains available if rollback reindexing also
      // encounters a pre-existing invalid asset.
    }
    throw error;
  }
}

export async function deprecateAsset(
  libraryRoot: string,
  reference: AssetReference,
  deprecatedBy: AssetReference,
  reason: string,
) {
  if (!reason.trim()) throw new Error('Asset deprecation requires a reason');
  if (reference.id !== deprecatedBy.id)
    throw new Error('Asset deprecation successor must preserve the stable asset ID');
  if (reference.version === deprecatedBy.version)
    throw new Error('Asset version cannot deprecate itself');
  const [asset, successor] = await Promise.all([
    findAsset(libraryRoot, reference),
    findAsset(libraryRoot, deprecatedBy),
  ]);
  if (!asset) throw new Error(`Asset does not exist: ${reference.id}@${reference.version}`);
  if (!successor)
    throw new Error(
      `Deprecation successor does not exist: ${deprecatedBy.id}@${deprecatedBy.version}`,
    );
  if (successor.status !== 'verified')
    throw new Error(
      `Deprecation successor must be verified: ${deprecatedBy.id}@${deprecatedBy.version}`,
    );
  if (asset.status === 'deprecated')
    throw new Error(`Asset is already deprecated: ${reference.id}@${reference.version}`);
  const raw = YAML.parse(await readFile(asset.metadataPath, 'utf8')) as Record<string, unknown>;
  raw.status = 'deprecated';
  raw.deprecatedBy = deprecatedBy;
  raw.deprecatedAt = new Date().toISOString();
  raw.deprecationReason = reason.trim();
  const validated = assetMetadataSchema.parse(raw);
  await writeFile(asset.metadataPath, YAML.stringify(validated), 'utf8');
  const index = await buildAssetIndex(libraryRoot);
  return {
    asset: reference,
    deprecatedBy,
    reason: reason.trim(),
    metadataPath: asset.metadataPath,
    index: index.path,
  };
}

export async function buildAssetIndex(root: string) {
  const assets = await scanAssetLibrary(root);
  const index = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    assets: assets.map((asset) => ({
      id: asset.id,
      version: asset.version,
      type: asset.type,
      title: asset.title,
      status: asset.status,
      tags: asset.tags,
      capabilities: asset.capabilities,
      metadataPath: relative(resolve(root), asset.metadataPath),
    })),
  };
  const path = join(resolve(root), 'index', 'assets.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return { path, ...index };
}

export function isAssetKind(value: string): value is AssetKind {
  return (assetKinds as readonly string[]).includes(value);
}
