import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { sourceSha256Schema } from './model.js';

export function sha256Bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalSha256(value: unknown) {
  return sha256Bytes(Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'));
}

export function contentObjectPath(cacheDirectory: string, sha256: string) {
  sourceSha256Schema.parse(sha256);
  return join(resolve(cacheDirectory), 'objects', 'sha256', sha256.slice(0, 2), sha256);
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function storeContentObject(cacheDirectory: string, bytes: Uint8Array) {
  const sha256 = sha256Bytes(bytes);
  const path = contentObjectPath(cacheDirectory, sha256);
  if (await exists(path)) {
    if (sha256Bytes(await readFile(path)) !== sha256)
      throw new Error(`Content-addressed cache object is corrupt: ${sha256}`);
    return { path, sha256, sizeBytes: bytes.byteLength };
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.incoming-${process.pid}-${Date.now()}`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  if (sha256Bytes(await readFile(temporary)) !== sha256)
    throw new Error(`Content-addressed cache write changed bytes: ${sha256}`);
  await rename(temporary, path);
  return { path, sha256, sizeBytes: bytes.byteLength };
}

export async function loadContentObject(cacheDirectory: string, sha256: string) {
  const path = contentObjectPath(cacheDirectory, sha256);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Offline source cache is missing SHA-256 object ${sha256}`);
    throw error;
  }
  const actual = sha256Bytes(bytes);
  if (actual !== sha256)
    throw new Error(
      `Content-addressed cache object hash mismatch: expected ${sha256}, got ${actual}`,
    );
  return bytes;
}

const cacheRecordSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentitySha256: sourceSha256Schema,
  provider: z.literal('ambientcg'),
  adapterVersion: z.string().min(1),
  assetId: z.string().min(1),
  variant: z.string().min(1),
  retrievedAt: z.string().datetime(),
  requestUrl: z.string().url(),
  responseSha256: sourceSha256Schema,
  archiveSha256: sourceSha256Schema,
  archiveUrl: z.string().url(),
  declaredSizeBytes: z.number().int().positive(),
});

export type SourceCacheRecord = z.infer<typeof cacheRecordSchema>;

function recordIdentity(record: Omit<SourceCacheRecord, 'sourceIdentitySha256' | 'retrievedAt'>) {
  return canonicalSha256(record);
}

function validateRecordIdentity(record: SourceCacheRecord) {
  const identityFields = {
    schemaVersion: record.schemaVersion,
    provider: record.provider,
    adapterVersion: record.adapterVersion,
    assetId: record.assetId,
    variant: record.variant,
    requestUrl: record.requestUrl,
    responseSha256: record.responseSha256,
    archiveSha256: record.archiveSha256,
    archiveUrl: record.archiveUrl,
    declaredSizeBytes: record.declaredSizeBytes,
  };
  const expected = recordIdentity(identityFields);
  if (record.sourceIdentitySha256 !== expected)
    throw new Error(
      `Source cache record identity mismatch: expected ${expected}, got ${record.sourceIdentitySha256}`,
    );
  return record;
}

function safeSegment(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/iu.test(value)) throw new Error(`Unsafe cache key segment: ${value}`);
  return value.toLowerCase();
}

function recordDirectory(cacheDirectory: string, assetId: string, variant: string) {
  return join(
    resolve(cacheDirectory),
    'records',
    'ambientcg',
    safeSegment(assetId),
    safeSegment(variant),
  );
}

async function writeJsonAtomic(path: string, value: unknown) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.incoming-${process.pid}-${Date.now()}`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, path);
}

export async function writeSourceCacheRecord(cacheDirectory: string, record: SourceCacheRecord) {
  const parsed = validateRecordIdentity(cacheRecordSchema.parse(record));
  const directory = recordDirectory(cacheDirectory, parsed.assetId, parsed.variant);
  const recordPath = join(directory, `${parsed.sourceIdentitySha256}.json`);
  let immutable = parsed;
  try {
    immutable = validateRecordIdentity(
      cacheRecordSchema.parse(JSON.parse(await readFile(recordPath, 'utf8'))),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeJsonAtomic(recordPath, parsed);
  }
  await writeJsonAtomic(join(directory, 'latest.json'), immutable);
  return immutable;
}

export async function readSourceCacheRecord(
  cacheDirectory: string,
  assetId: string,
  variant: string,
  expectedSourceIdentitySha256?: string,
) {
  const directory = recordDirectory(cacheDirectory, assetId, variant);
  const path = join(
    directory,
    expectedSourceIdentitySha256 ? `${expectedSourceIdentitySha256}.json` : 'latest.json',
  );
  try {
    const record = validateRecordIdentity(
      cacheRecordSchema.parse(JSON.parse(await readFile(path, 'utf8'))),
    );
    if (record.assetId.toLowerCase() !== assetId.toLowerCase() || record.variant !== variant)
      throw new Error('Source cache record identity does not match its lookup key');
    if (
      expectedSourceIdentitySha256 &&
      record.sourceIdentitySha256 !== expectedSourceIdentitySha256
    )
      throw new Error('Source cache record does not match the requested exact identity');
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(
        `Offline source cache has no ${assetId} ${variant}${expectedSourceIdentitySha256 ? ` identity ${expectedSourceIdentitySha256}` : ''}`,
      );
    throw error;
  }
}
