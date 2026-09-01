import { createHash } from 'node:crypto';
import { access, copyFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { scanAssetLibrary, sha256File, validateLibraryAsset } from './library.js';

export interface CorruptLibraryArtifact {
  assetId: string;
  version: string;
  path: string;
  target: string;
  expectedSha256: string;
  actualSha256: string | null;
}

export async function auditAssetLibrary(libraryRoot: string) {
  const root = resolve(libraryRoot);
  const assets = await scanAssetLibrary(root);
  const corruptArtifacts: CorruptLibraryArtifact[] = [];
  const invalidAssets: Array<{ id: string; version: string; issues: string[] }> = [];
  for (const asset of assets) {
    const validation = await validateLibraryAsset(asset);
    if (!validation.valid)
      invalidAssets.push({ id: asset.id, version: asset.version, issues: validation.issues });
    const seen = new Set<string>();
    for (const artifact of asset.artifacts) {
      if (!artifact.sha256 || seen.has(artifact.path)) continue;
      seen.add(artifact.path);
      const target = resolve(asset.directory, artifact.path);
      let actualSha256: string | null = null;
      try {
        await access(target);
        actualSha256 = await sha256File(target);
      } catch {
        // Missing files remain recoverable when an exact source copy exists.
      }
      if (actualSha256 !== artifact.sha256)
        corruptArtifacts.push({
          assetId: asset.id,
          version: asset.version,
          path: artifact.path,
          target,
          expectedSha256: artifact.sha256,
          actualSha256,
        });
    }
  }
  return {
    schemaVersion: 1 as const,
    libraryRoot: root,
    assetCount: assets.length,
    valid: invalidAssets.length === 0,
    invalidAssets,
    corruptArtifacts,
  };
}

function isInside(parent: string, candidate: string) {
  const value = relative(parent, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..');
}

async function matchingCandidateFiles(root: string, names: Set<string>) {
  const output: string[] = [];
  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && names.has(entry.name)) output.push(path);
    }
  }
  await visit(root);
  return output;
}

async function exactCanonicalJsonCandidate(target: string, expectedSha256: string) {
  if (extname(target).toLowerCase() !== '.json') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(target, 'utf8'));
  } catch {
    return null;
  }
  for (const bytes of [
    Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8'),
    Buffer.from(JSON.stringify(parsed, null, 2), 'utf8'),
  ]) {
    if (sha256Bytes(bytes) === expectedSha256) return bytes;
  }
  return null;
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function repairAssetLibraryFromSources(libraryRoot: string, recoveryRoots: string[]) {
  const root = resolve(libraryRoot);
  const sources = [...new Set(recoveryRoots.map((source) => resolve(source)))];
  if (!sources.length) throw new Error('Library repair requires at least one recovery source root');
  for (const source of sources)
    if (isInside(root, source) || isInside(source, root))
      throw new Error('Recovery sources must be separate from the library being repaired');
  const before = await auditAssetLibrary(root);
  if (before.corruptArtifacts.length === 0)
    return { before, repaired: [], unresolved: [], after: before };
  const names = new Set(before.corruptArtifacts.map((artifact) => basename(artifact.path)));
  const candidates = (
    await Promise.all(sources.map((source) => matchingCandidateFiles(source, names)))
  ).flat();
  const wantedHashes = new Set(before.corruptArtifacts.map((artifact) => artifact.expectedSha256));
  const candidateByHash = new Map<string, string>();
  for (const candidate of candidates) {
    const hash = await sha256File(candidate);
    if (wantedHashes.has(hash) && !candidateByHash.has(hash)) candidateByHash.set(hash, candidate);
  }
  const repaired: Array<CorruptLibraryArtifact & { recoveredFrom: string }> = [];
  const unresolved: CorruptLibraryArtifact[] = [];
  for (const artifact of before.corruptArtifacts) {
    const recoveredFrom = candidateByHash.get(artifact.expectedSha256);
    const canonicalJson = recoveredFrom
      ? null
      : await exactCanonicalJsonCandidate(artifact.target, artifact.expectedSha256);
    if (!recoveredFrom && !canonicalJson) {
      unresolved.push(artifact);
      continue;
    }
    const temporary = `${artifact.target}.integrity-repair-${process.pid}`;
    try {
      if (recoveredFrom) await copyFile(recoveredFrom, temporary);
      else await writeFile(temporary, canonicalJson!);
      const copiedHash = await sha256File(temporary);
      if (copiedHash !== artifact.expectedSha256)
        throw new Error(
          recoveredFrom
            ? `Recovery copy changed while reading: ${recoveredFrom}`
            : `Canonical JSON recovery did not preserve the accepted hash: ${artifact.target}`,
        );
      await rename(temporary, artifact.target);
      repaired.push({
        ...artifact,
        recoveredFrom: recoveredFrom ?? `canonical-json:${artifact.target}`,
      });
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const after = await auditAssetLibrary(root);
  return { before, repaired, unresolved, after };
}
