import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { z } from 'zod';
import { extractSelectedSafeZipEntries, type SafeArchiveLimits } from './archive.js';
import {
  canonicalSha256,
  loadContentObject,
  sha256Bytes,
  storeContentObject,
  storeContentObjectFile,
  writeImmutableFile,
} from './cache.js';
import {
  environmentRadianceColorSpaceSchema,
  openEnvironmentRadianceSourceManifestSchema,
  sourceSha256Schema,
  type OpenEnvironmentRadianceSourceManifest,
} from './model.js';
import {
  inspectOpenExrWithTool,
  parseOpenExrInfo,
  type OpenExrInspection,
  type OpenExrInspector,
  type OpenExrInspectorLimits,
} from './openexr.js';
import { inspectRadianceHdr, type RadianceHdrLimits } from './radiance-hdr.js';

const adapterVersion = 'videoer.ambientcg-environment-radiance-source.v3';
const apiVersion = 'ambientcg-v3';
const licenceUrl = 'https://docs.ambientcg.com/license/';
const licenceAssessmentKind = 'videoer-reviewed-provider-licence-assessment-v1' as const;

const apiResponseSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  assets: z.array(
    z.object({
      id: z.string().min(1),
      type: z.literal('hdri'),
      releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      title: z.string().min(1),
      url: z.string().url(),
      tags: z.array(z.string().min(1)).default([]),
      technique: z.string().min(1),
      downloads: z.array(
        z.object({
          attributes: z.string().min(1),
          extension: z.string().min(1),
          url: z.string().url(),
          size: z.number().int().positive(),
        }),
      ),
    }),
  ),
});

const cacheRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceIdentitySha256: sourceSha256Schema,
    provider: z.literal('ambientcg'),
    adapterVersion: z.literal(adapterVersion),
    providerApiVersion: z.literal(apiVersion),
    assetId: z.string().min(1),
    variant: z.string().min(1),
    retrievedAt: z.string().datetime(),
    requestUrl: z.string().url(),
    responseFinalUrl: z.string().url(),
    responseSha256: sourceSha256Schema,
    licenceUrl: z.literal(licenceUrl),
    licenceFinalUrl: z.string().url(),
    licenceEvidenceSha256: sourceSha256Schema,
    licenceEvidenceSizeBytes: z.number().int().positive(),
    archiveUrl: z.string().url(),
    archiveFinalUrl: z.string().url(),
    archiveSha256: sourceSha256Schema,
    archiveSizeBytes: z.number().int().positive(),
    declaredSizeBytes: z.number().int().positive(),
    radianceEntry: z.string().min(1),
    radianceSha256: sourceSha256Schema,
    radianceSizeBytes: z.number().int().positive(),
    sourceEncoding: z.enum(['radiance-rgbe', 'openexr']),
    widthPixels: z.number().int().positive(),
    heightPixels: z.number().int().positive(),
    colorSpace: environmentRadianceColorSpaceSchema,
    inspection: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('radiance-rgbe'),
        minimumPositiveRadiance: z.number().positive().finite(),
        maximumRadiance: z.number().positive().finite(),
        dynamicRangeRatio: z.number().gt(1).finite(),
      }),
      z.object({
        kind: z.literal('openexr'),
        storage: z.literal('single-part-scanline'),
        channels: z.array(
          z.object({
            name: z.enum(['R', 'G', 'B', 'A']),
            sampleType: z.enum(['half', 'float']),
            xSampling: z.literal(1),
            ySampling: z.literal(1),
          }),
        ),
        dataWindow: z.tuple([
          z.number().int(),
          z.number().int(),
          z.number().int(),
          z.number().int(),
        ]),
        displayWindow: z.tuple([
          z.number().int(),
          z.number().int(),
          z.number().int(),
          z.number().int(),
        ]),
        inspectorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
        inspectorLicenceSpdx: z.literal('BSD-3-Clause'),
        evidenceSha256: sourceSha256Schema,
      }),
    ]),
    technique: z.string().min(1),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((record, ctx) => {
    if (record.sourceEncoding !== record.inspection.kind)
      ctx.addIssue({
        code: 'custom',
        path: ['sourceEncoding'],
        message: 'cached environment encoding must match its inspection evidence',
      });
    if (record.widthPixels !== record.heightPixels * 2)
      ctx.addIssue({
        code: 'custom',
        path: ['widthPixels'],
        message: 'cached environment dimensions must have an exact 2:1 aspect ratio',
      });
    const requestedWidth = Number.parseInt(record.variant, 10) * 1024;
    if (record.widthPixels !== requestedWidth)
      ctx.addIssue({
        code: 'custom',
        path: ['widthPixels'],
        message: 'cached environment dimensions must match the requested resolution',
      });
    const expectedEvidencePrefix = record.sourceEncoding === 'openexr' ? 'openexr-' : 'radiance-';
    if (!record.colorSpace.evidence.mode.startsWith(expectedEvidencePrefix))
      ctx.addIssue({
        code: 'custom',
        path: ['colorSpace', 'evidence', 'mode'],
        message: 'cached colour-space evidence must match the source encoding',
      });
  });

type CacheRecord = z.infer<typeof cacheRecordSchema>;

export interface AmbientCgEnvironmentRadianceSourceOptions {
  assetId: string;
  resolution: `${number}K`;
  cacheDirectory: string;
  outputDirectory: string;
  mode: 'online' | 'offline';
  refresh?: boolean;
  expectedSourceIdentitySha256?: string;
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  maximumApiBytes?: number;
  maximumArchiveBytes?: number;
  providerTimeoutMilliseconds?: number;
  archiveLimits?: SafeArchiveLimits;
  radianceLimits?: RadianceHdrLimits;
  openExrInspector?: OpenExrInspector;
  openExrLimits?: OpenExrInspectorLimits;
}

interface LoadedSource {
  record: CacheRecord;
  responseBytes: Uint8Array;
  archiveBytes: Uint8Array;
  radianceBytes: Uint8Array;
  inspectionEvidenceBytes?: Uint8Array;
  licenceEvidenceBytes: Uint8Array;
  fromCache: boolean;
}

function safeSegment(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/iu.test(value))
    throw new Error(`Unsafe ambientCG environment source key: ${value}`);
  return value.toLowerCase();
}

function variant(options: AmbientCgEnvironmentRadianceSourceOptions) {
  if (!/^\d+K$/u.test(options.resolution))
    throw new Error(`Invalid ambientCG HDRI resolution: ${options.resolution}`);
  return `${options.resolution}-environment-radiance-v3`;
}

function requestUrl(baseUrl: string, assetId: string) {
  const url = new URL('/api/v3/assets', baseUrl);
  url.searchParams.set('id', assetId);
  url.searchParams.set('include', 'type,releaseDate,title,url,tags,technique,downloads');
  return url.toString();
}

function assertAllowedProviderUrl(value: string, apiOrigin: string, label: string) {
  const url = new URL(value);
  const api = new URL(apiOrigin);
  const officialHost =
    url.hostname === 'ambientcg.com' ||
    url.hostname.endsWith('.ambientcg.com') ||
    url.hostname === 'acg-download.struffelproductions.com';
  const exactOperatorOrigin = url.origin === api.origin;
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (!officialHost && !exactOperatorOrigin) ||
    (url.port !== '' && !exactOperatorOrigin)
  )
    throw new Error(`${label} URL is outside the approved HTTPS ambientCG/CDN origins: ${value}`);
  return url;
}

async function fetchBoundedProviderResponse(
  fetcher: typeof fetch,
  initialUrl: string,
  apiOrigin: string,
  maximumBytes: number,
  label: string,
  timeoutMilliseconds: number,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  const controller = new AbortController();
  const bounded = async <T>(operation: Promise<T>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${label} timed out after ${timeoutMilliseconds}ms`);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`));
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  let current = assertAllowedProviderUrl(initialUrl, apiOrigin, label);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await bounded(
      fetcher(current, {
        headers: { 'user-agent': 'Videoer/0.1 open-environment-radiance-source ambientCG' },
        redirect: 'manual',
        signal: controller.signal,
      }),
    );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 5) throw new Error(`${label} exceeded five approved redirects`);
      const location = response.headers.get('location');
      if (!location) throw new Error(`${label} redirect omitted its Location header`);
      current = assertAllowedProviderUrl(new URL(location, current).toString(), apiOrigin, label);
      continue;
    }
    return {
      bytes: await boundedResponse(response, maximumBytes, label, bounded),
      finalUrl: current.toString(),
    };
  }
  throw new Error(`${label} redirect handling failed`);
}

async function fetchBoundedProviderResponseToFile(
  fetcher: typeof fetch,
  initialUrl: string,
  apiOrigin: string,
  maximumBytes: number,
  label: string,
  directory: string,
  timeoutMilliseconds: number,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  const controller = new AbortController();
  const bounded = async <T>(operation: Promise<T>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${label} timed out after ${timeoutMilliseconds}ms`);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`));
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  let current = assertAllowedProviderUrl(initialUrl, apiOrigin, label);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await bounded(
      fetcher(current, {
        headers: { 'user-agent': 'Videoer/0.1 open-environment-radiance-source ambientCG' },
        redirect: 'manual',
        signal: controller.signal,
      }),
    );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 5) throw new Error(`${label} exceeded five approved redirects`);
      const location = response.headers.get('location');
      if (!location) throw new Error(`${label} redirect omitted its Location header`);
      current = assertAllowedProviderUrl(new URL(location, current).toString(), apiOrigin, label);
      continue;
    }
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > maximumBytes)
      throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
    if (!response.body) throw new Error(`${label} response has no body`);
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'response.bin');
    const handle = await open(path, 'wx');
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let sizeBytes = 0;
    try {
      while (true) {
        const { value, done } = await bounded(reader.read());
        if (done) break;
        sizeBytes += value.byteLength;
        if (sizeBytes > maximumBytes) {
          await reader.cancel();
          throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
        }
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await bounded(
            handle.write(value, offset, value.byteLength - offset),
          );
          if (bytesWritten <= 0) throw new Error(`${label} archive write made no progress`);
          offset += bytesWritten;
        }
      }
      await handle.sync();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
    return { path, sizeBytes, sha256: hash.digest('hex'), finalUrl: current.toString() };
  }
  throw new Error(`${label} redirect handling failed`);
}

function validateProviderLicenceEvidence(bytes: Uint8Array) {
  let document: string;
  try {
    document = new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('ambientCG licence evidence is not valid UTF-8');
  }
  if (
    !/All ambientCG assets are provided under the[\s\S]{0,500}Creative Commons CC0 1\.0 Universal License/iu.test(
      document,
    ) ||
    !/commercial purposes/iu.test(document) ||
    !/don['’]t need to give credit/iu.test(document)
  )
    throw new Error('ambientCG provider licence evidence no longer proves CC0 commercial use');
  return document;
}

async function boundedResponse(
  response: Response,
  maximumBytes: number,
  label: string,
  bounded: <T>(operation: Promise<T>) => Promise<T>,
) {
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maximumBytes)
    throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
  if (!response.body) throw new Error(`${label} response has no body`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await bounded(reader.read());
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseAsset(bytes: Uint8Array, requestedId: string) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('ambientCG v3 returned invalid JSON for an HDRI request');
  }
  const response = apiResponseSchema.parse(value);
  if (
    response.totalResults !== 1 ||
    response.assets.length !== 1 ||
    response.assets[0]!.id !== requestedId
  )
    throw new Error(
      `ambientCG v3 must return exactly one HDRI with exact ID '${requestedId}', received ${response.assets.length}`,
    );
  return response.assets[0]!;
}

function selectDownload(asset: ReturnType<typeof parseAsset>, requestedResolution: string) {
  const matches = asset.downloads.filter(
    (download) =>
      download.attributes === requestedResolution && download.extension.toLowerCase() === 'zip',
  );
  if (matches.length !== 1)
    throw new Error(
      `ambientCG HDRI requires exactly one ${requestedResolution} ZIP, received ${matches.length}`,
    );
  return matches[0]!;
}

function selectEnvironmentEntry(
  inventory: Array<{ name: string }>,
  assetId: string,
  resolution: string,
) {
  const hdrNames = [`${assetId}_${resolution}.hdr`, `${assetId}_${resolution}_hdr.hdr`].map(
    (value) => value.toLowerCase(),
  );
  const hdrMatches = inventory.filter(
    (entry) =>
      extname(entry.name).toLowerCase() === '.hdr' &&
      hdrNames.includes(basename(entry.name).toLowerCase()),
  );
  if (hdrMatches.length > 1)
    throw new Error(
      `ambientCG HDRI archive contains ambiguous ${resolution} Radiance .hdr sources: ${hdrMatches.length}`,
    );
  if (hdrMatches.length === 1)
    return { entry: hdrMatches[0]!.name, encoding: 'radiance-rgbe' as const };
  const exrName = `${assetId}_${resolution}_hdr.exr`.toLowerCase();
  const exrMatches = inventory.filter((entry) => basename(entry.name).toLowerCase() === exrName);
  if (exrMatches.length !== 1)
    throw new Error(
      `ambientCG HDRI archive has no Radiance .hdr and requires exactly one ${resolution}_HDR.exr source, received ${exrMatches.length}`,
    );
  return { entry: exrMatches[0]!.name, encoding: 'openexr' as const };
}

function exrEvidenceBytes(inspection: OpenExrInspection) {
  return Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tool: inspection.inspector.tool,
        version: inspection.inspector.version,
        licenceSpdx: inspection.inspector.licenceSpdx,
        commandArguments: inspection.inspector.commandArguments,
        verboseOutput: inspection.inspector.output,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function validateRecord(record: CacheRecord) {
  const { sourceIdentitySha256 } = record;
  const identity: Record<string, unknown> = { ...record };
  delete identity.sourceIdentitySha256;
  delete identity.retrievedAt;
  const expected = canonicalSha256(identity);
  if (sourceIdentitySha256 !== expected)
    throw new Error(
      `Environment source cache record identity mismatch: expected ${expected}, got ${sourceIdentitySha256}`,
    );
  return record;
}

function recordDirectory(cacheDirectory: string, assetId: string, sourceVariant: string) {
  return join(
    resolve(cacheDirectory),
    'records',
    'ambientcg-environment-radiance',
    safeSegment(assetId),
    safeSegment(sourceVariant),
  );
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.incoming-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

async function writeRecord(cacheDirectory: string, value: CacheRecord) {
  const record = validateRecord(cacheRecordSchema.parse(value));
  const directory = recordDirectory(cacheDirectory, record.assetId, record.variant);
  const immutablePath = join(directory, `${record.sourceIdentitySha256}.json`);
  let immutable = record;
  try {
    immutable = validateRecord(
      cacheRecordSchema.parse(JSON.parse(await readFile(immutablePath, 'utf8'))),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      await writeImmutableFile(
        immutablePath,
        Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'),
      );
    } catch (writeError) {
      if (
        !(writeError instanceof Error) ||
        !writeError.message.includes('Immutable source-cache collision')
      )
        throw writeError;
      immutable = validateRecord(
        cacheRecordSchema.parse(JSON.parse(await readFile(immutablePath, 'utf8'))),
      );
      if (immutable.sourceIdentitySha256 !== record.sourceIdentitySha256) throw writeError;
    }
  }
  await writeJsonAtomic(join(directory, 'latest.json'), immutable);
  return immutable;
}

async function readRecord(
  cacheDirectory: string,
  assetId: string,
  sourceVariant: string,
  exactIdentity?: string,
) {
  const path = join(
    recordDirectory(cacheDirectory, assetId, sourceVariant),
    exactIdentity ? `${sourceSha256Schema.parse(exactIdentity)}.json` : 'latest.json',
  );
  try {
    const record = validateRecord(
      cacheRecordSchema.parse(JSON.parse(await readFile(path, 'utf8'))),
    );
    if (record.assetId !== assetId || record.variant !== sourceVariant)
      throw new Error('Environment source cache record does not match its lookup key');
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(
        `Offline environment source cache has no ${assetId} ${sourceVariant}${exactIdentity ? ` identity ${exactIdentity}` : ''}`,
      );
    throw error;
  }
}

async function recordExists(options: AmbientCgEnvironmentRadianceSourceOptions) {
  try {
    await readRecord(
      options.cacheDirectory,
      options.assetId,
      variant(options),
      options.expectedSourceIdentitySha256,
    );
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Offline environment source cache has no ')
    )
      return false;
    throw error;
  }
}

async function acquireOnline(
  options: AmbientCgEnvironmentRadianceSourceOptions,
): Promise<LoadedSource> {
  const fetcher = options.fetcher ?? fetch;
  const apiOrigin = options.apiBaseUrl ?? 'https://ambientcg.com';
  const requested = requestUrl(apiOrigin, options.assetId);
  const apiResponse = await fetchBoundedProviderResponse(
    fetcher,
    requested,
    apiOrigin,
    options.maximumApiBytes ?? 2_000_000,
    'ambientCG API',
    options.providerTimeoutMilliseconds ?? 300_000,
  );
  const responseBytes = apiResponse.bytes;
  const asset = parseAsset(responseBytes, options.assetId);
  assertAllowedProviderUrl(asset.url, apiOrigin, 'ambientCG asset page');
  const download = selectDownload(asset, options.resolution);
  const incomingParent = join(resolve(options.cacheDirectory), 'incoming');
  await mkdir(incomingParent, { recursive: true });
  const incomingDirectory = await mkdtemp(join(incomingParent, 'ambientcg-environment-'));
  let archiveResponse: Awaited<ReturnType<typeof fetchBoundedProviderResponseToFile>>;
  let licenceResponse: Awaited<ReturnType<typeof fetchBoundedProviderResponse>>;
  let archiveBytes: Uint8Array;
  let archiveObject: Awaited<ReturnType<typeof storeContentObjectFile>>;
  try {
    [archiveResponse, licenceResponse] = await Promise.all([
      fetchBoundedProviderResponseToFile(
        fetcher,
        download.url,
        apiOrigin,
        options.maximumArchiveBytes ?? 1_100_000_000,
        'ambientCG HDRI archive',
        incomingDirectory,
        options.providerTimeoutMilliseconds ?? 300_000,
      ),
      fetchBoundedProviderResponse(
        fetcher,
        licenceUrl,
        apiOrigin,
        options.maximumApiBytes ?? 2_000_000,
        'ambientCG licence evidence',
        options.providerTimeoutMilliseconds ?? 300_000,
      ),
    ]);
    archiveObject = await storeContentObjectFile(
      options.cacheDirectory,
      archiveResponse.path,
      archiveResponse.sha256,
      archiveResponse.sizeBytes,
    );
    archiveBytes = await readFile(archiveObject.path);
  } finally {
    await rm(incomingDirectory, { recursive: true, force: true });
  }
  const licenceEvidenceBytes = licenceResponse.bytes;
  validateProviderLicenceEvidence(licenceEvidenceBytes);
  if (archiveBytes.byteLength !== download.size)
    throw new Error(
      `ambientCG HDRI archive size mismatch: declared ${download.size}, received ${archiveBytes.byteLength}`,
    );
  const inventory = extractSelectedSafeZipEntries(
    archiveBytes,
    new Set<string>(),
    options.archiveLimits,
  ).inventory;
  const selected = selectEnvironmentEntry(inventory, options.assetId, options.resolution);
  const radianceEntry = selected.entry;
  const radianceBytes = extractSelectedSafeZipEntries(
    archiveBytes,
    new Set([radianceEntry]),
    options.archiveLimits,
  ).extracted.get(radianceEntry)!;
  if (
    selected.encoding === 'openexr' &&
    (radianceBytes.byteLength < 4 ||
      radianceBytes[0] !== 0x76 ||
      radianceBytes[1] !== 0x2f ||
      radianceBytes[2] !== 0x31 ||
      radianceBytes[3] !== 0x01)
  )
    throw new Error('ambientCG OpenEXR source has an invalid magic signature');
  const radianceInspection =
    selected.encoding === 'radiance-rgbe'
      ? inspectRadianceHdr(radianceBytes, options.radianceLimits)
      : undefined;
  const openExrInspection =
    selected.encoding === 'openexr'
      ? await (options.openExrInspector ?? inspectOpenExrWithTool)(
          radianceBytes,
          options.openExrLimits,
        )
      : undefined;
  const sourceInspection = radianceInspection ?? openExrInspection!;
  if (sourceInspection.widthPixels !== Number.parseInt(options.resolution, 10) * 1024)
    throw new Error(
      `ambientCG ${options.resolution} environment width mismatch: received ${sourceInspection.widthPixels}`,
    );
  const inspectionEvidenceBytes = openExrInspection
    ? exrEvidenceBytes(openExrInspection)
    : undefined;
  const [responseObject, licenceObject, radianceObject, evidenceObject] = await Promise.all([
    storeContentObject(options.cacheDirectory, responseBytes),
    storeContentObject(options.cacheDirectory, licenceEvidenceBytes),
    storeContentObject(options.cacheDirectory, radianceBytes),
    inspectionEvidenceBytes
      ? storeContentObject(options.cacheDirectory, inspectionEvidenceBytes)
      : Promise.resolve(undefined),
  ]);
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const identity = {
    schemaVersion: 1 as const,
    provider: 'ambientcg' as const,
    adapterVersion: adapterVersion as typeof adapterVersion,
    providerApiVersion: apiVersion as typeof apiVersion,
    assetId: asset.id,
    variant: variant(options),
    requestUrl: requested,
    responseFinalUrl: apiResponse.finalUrl,
    responseSha256: responseObject.sha256,
    licenceUrl: licenceUrl as typeof licenceUrl,
    licenceFinalUrl: licenceResponse.finalUrl,
    licenceEvidenceSha256: licenceObject.sha256,
    licenceEvidenceSizeBytes: licenceObject.sizeBytes,
    archiveUrl: download.url,
    archiveFinalUrl: archiveResponse.finalUrl,
    archiveSha256: archiveObject.sha256,
    archiveSizeBytes: archiveObject.sizeBytes,
    declaredSizeBytes: download.size,
    radianceEntry,
    radianceSha256: radianceObject.sha256,
    radianceSizeBytes: radianceObject.sizeBytes,
    sourceEncoding: selected.encoding,
    widthPixels: (radianceInspection ?? openExrInspection)!.widthPixels,
    heightPixels: (radianceInspection ?? openExrInspection)!.heightPixels,
    colorSpace: sourceInspection.colorSpace,
    inspection: radianceInspection
      ? {
          kind: 'radiance-rgbe' as const,
          minimumPositiveRadiance: radianceInspection.minimumPositiveRadiance,
          maximumRadiance: radianceInspection.maximumRadiance,
          dynamicRangeRatio: radianceInspection.dynamicRangeRatio,
        }
      : {
          kind: 'openexr' as const,
          storage: openExrInspection!.storage,
          channels: openExrInspection!.channels,
          dataWindow: openExrInspection!.dataWindow,
          displayWindow: openExrInspection!.displayWindow,
          inspectorVersion: openExrInspection!.inspector.version,
          inspectorLicenceSpdx: openExrInspection!.inspector.licenceSpdx,
          evidenceSha256: evidenceObject!.sha256,
        },
    technique: asset.technique,
    releaseDate: asset.releaseDate,
  };
  const sourceIdentitySha256 = canonicalSha256(identity);
  if (
    options.expectedSourceIdentitySha256 &&
    sourceIdentitySha256 !== options.expectedSourceIdentitySha256
  )
    throw new Error(
      `ambientCG HDRI source identity mismatch: expected ${options.expectedSourceIdentitySha256}, got ${sourceIdentitySha256}`,
    );
  const record = await writeRecord(options.cacheDirectory, {
    ...identity,
    sourceIdentitySha256,
    retrievedAt,
  });
  return {
    record,
    responseBytes,
    archiveBytes,
    radianceBytes,
    licenceEvidenceBytes,
    ...(inspectionEvidenceBytes ? { inspectionEvidenceBytes } : {}),
    fromCache: false,
  };
}

async function acquireCached(
  options: AmbientCgEnvironmentRadianceSourceOptions,
): Promise<LoadedSource> {
  const record = await readRecord(
    options.cacheDirectory,
    options.assetId,
    variant(options),
    options.expectedSourceIdentitySha256,
  );
  const [
    responseBytes,
    licenceEvidenceBytes,
    archiveBytes,
    radianceBytes,
    inspectionEvidenceBytes,
  ] = await Promise.all([
    loadContentObject(options.cacheDirectory, record.responseSha256),
    loadContentObject(options.cacheDirectory, record.licenceEvidenceSha256),
    loadContentObject(options.cacheDirectory, record.archiveSha256),
    loadContentObject(options.cacheDirectory, record.radianceSha256),
    record.inspection.kind === 'openexr'
      ? loadContentObject(options.cacheDirectory, record.inspection.evidenceSha256)
      : Promise.resolve(undefined),
  ]);
  if (
    licenceEvidenceBytes.byteLength !== record.licenceEvidenceSizeBytes ||
    archiveBytes.byteLength !== record.archiveSizeBytes ||
    radianceBytes.byteLength !== record.radianceSizeBytes
  )
    throw new Error('Cached ambientCG HDRI byte sizes no longer match their record');
  return {
    record,
    responseBytes,
    archiveBytes,
    radianceBytes,
    licenceEvidenceBytes,
    ...(inspectionEvidenceBytes ? { inspectionEvidenceBytes } : {}),
    fromCache: true,
  };
}

async function exactFile(path: string, bytes: Uint8Array) {
  try {
    await writeImmutableFile(path, bytes);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Immutable source-cache collision'))
      throw new Error(`Candidate artifact already exists with different bytes: ${path}`);
    throw error;
  }
}

function identityPayloadFromManifest(manifest: OpenEnvironmentRadianceSourceManifest) {
  const inspection =
    manifest.radiance.encoding === 'radiance-rgbe'
      ? {
          kind: 'radiance-rgbe' as const,
          minimumPositiveRadiance: manifest.radiance.pixelRange.minimumPositiveRadiance,
          maximumRadiance: manifest.radiance.pixelRange.maximumRadiance,
          dynamicRangeRatio: manifest.radiance.pixelRange.dynamicRangeRatio,
        }
      : {
          kind: 'openexr' as const,
          storage: manifest.radiance.structuralEvidence.storage,
          channels: manifest.radiance.structuralEvidence.channels,
          dataWindow: manifest.radiance.structuralEvidence.dataWindow,
          displayWindow: manifest.radiance.structuralEvidence.displayWindow,
          inspectorVersion: manifest.radiance.structuralEvidence.inspector.version,
          inspectorLicenceSpdx: manifest.radiance.structuralEvidence.inspector.licenceSpdx,
          evidenceSha256: manifest.radiance.structuralEvidence.inspector.evidenceSha256,
        };
  return {
    schemaVersion: 1 as const,
    provider: 'ambientcg' as const,
    adapterVersion,
    providerApiVersion: manifest.providerApi.version,
    assetId: manifest.asset.id,
    variant: `${manifest.selection.resolution}-environment-radiance-v3`,
    requestUrl: manifest.providerApi.requestUrl,
    responseFinalUrl: manifest.providerApi.finalUrl,
    responseSha256: manifest.providerApi.responseSha256,
    licenceUrl: manifest.licence.providerEvidence.requestedUrl,
    licenceFinalUrl: manifest.licence.providerEvidence.finalUrl,
    licenceEvidenceSha256: manifest.licence.providerEvidence.sha256,
    licenceEvidenceSizeBytes: manifest.licence.providerEvidence.sizeBytes,
    archiveUrl: manifest.selection.archiveUrl,
    archiveFinalUrl: manifest.selection.archiveFinalUrl,
    archiveSha256: manifest.sourceArchive.sha256,
    archiveSizeBytes: manifest.sourceArchive.sizeBytes,
    declaredSizeBytes: manifest.selection.declaredSizeBytes,
    radianceEntry: manifest.radiance.archiveEntry,
    radianceSha256: manifest.radiance.sha256,
    radianceSizeBytes: manifest.radiance.sizeBytes,
    sourceEncoding: manifest.radiance.encoding,
    widthPixels: manifest.radiance.widthPixels,
    heightPixels: manifest.radiance.heightPixels,
    colorSpace: manifest.radiance.colorSpace,
    inspection,
    technique: manifest.asset.technique,
    releaseDate: manifest.asset.releaseDate,
  };
}

export function recomputeAmbientCgEnvironmentSourceIdentity(
  input: OpenEnvironmentRadianceSourceManifest,
) {
  const manifest = openEnvironmentRadianceSourceManifestSchema.parse(input);
  if (
    manifest.provider !== 'ambientcg' ||
    manifest.adapterVersion !== adapterVersion ||
    manifest.providerApi.version !== apiVersion
  )
    throw new Error('Unsupported environment source provider or adapter identity');
  return canonicalSha256(identityPayloadFromManifest(manifest));
}

export interface AmbientCgEnvironmentSourceEvidence {
  responseBytes: Uint8Array;
  licenceEvidenceBytes: Uint8Array;
  licenceAssessmentBytes: Uint8Array;
  archiveBytes: Uint8Array;
  radianceBytes: Uint8Array;
  inspectionEvidenceBytes?: Uint8Array;
}

export function validateAmbientCgEnvironmentSourceEvidence(
  input: OpenEnvironmentRadianceSourceManifest,
  evidence: AmbientCgEnvironmentSourceEvidence,
) {
  const manifest = openEnvironmentRadianceSourceManifestSchema.parse(input);
  if (
    manifest.provider !== 'ambientcg' ||
    manifest.adapterVersion !== adapterVersion ||
    manifest.providerApi.version !== apiVersion
  )
    throw new Error('Unsupported environment source provider or adapter identity');
  const expectedIdentity = recomputeAmbientCgEnvironmentSourceIdentity(manifest);
  if (manifest.sourceIdentitySha256 !== expectedIdentity)
    throw new Error(
      `Environment source manifest identity mismatch: expected ${expectedIdentity}, got ${manifest.sourceIdentitySha256}`,
    );
  const byteBindings = [
    [evidence.responseBytes, manifest.providerApi.responseSha256, 'API response'],
    [
      evidence.licenceEvidenceBytes,
      manifest.licence.providerEvidence.sha256,
      'provider licence evidence',
    ],
    [
      evidence.licenceAssessmentBytes,
      manifest.licence.adapterAssessment.sha256,
      'licence assessment',
    ],
    [evidence.archiveBytes, manifest.sourceArchive.sha256, 'source archive'],
    [evidence.radianceBytes, manifest.radiance.sha256, 'radiance source'],
  ] as const;
  for (const [bytes, expected, label] of byteBindings)
    if (sha256Bytes(bytes) !== expected)
      throw new Error(`Environment source ${label} SHA-256 mismatch`);
  if (
    evidence.licenceEvidenceBytes.byteLength !== manifest.licence.providerEvidence.sizeBytes ||
    evidence.archiveBytes.byteLength !== manifest.sourceArchive.sizeBytes ||
    evidence.radianceBytes.byteLength !== manifest.radiance.sizeBytes
  )
    throw new Error('Environment source evidence byte size mismatch');

  const asset = parseAsset(evidence.responseBytes, manifest.asset.id);
  const manifestAsset = {
    id: manifest.asset.id,
    type: manifest.asset.type,
    releaseDate: manifest.asset.releaseDate,
    title: manifest.asset.title,
    url: manifest.asset.pageUrl,
    tags: manifest.asset.tags,
    technique: manifest.asset.technique,
  };
  const apiAsset = {
    id: asset.id,
    type: asset.type,
    releaseDate: asset.releaseDate,
    title: asset.title,
    url: asset.url,
    tags: asset.tags,
    technique: asset.technique,
  };
  if (canonicalSha256(manifestAsset) !== canonicalSha256(apiAsset))
    throw new Error('Environment source manifest asset contradicts its API response');
  const requested = requestUrl(new URL(manifest.providerApi.requestUrl).origin, manifest.asset.id);
  if (requested !== manifest.providerApi.requestUrl)
    throw new Error('Environment source API request URL contradicts its exact asset identity');
  const download = selectDownload(asset, manifest.selection.resolution);
  if (
    download.url !== manifest.selection.archiveUrl ||
    download.size !== manifest.selection.declaredSizeBytes
  )
    throw new Error('Environment source selection contradicts its API response');

  const apiOrigin = new URL(manifest.providerApi.requestUrl).origin;
  for (const [url, label] of [
    [manifest.providerApi.requestUrl, 'ambientCG API'],
    [manifest.providerApi.finalUrl, 'ambientCG API'],
    [manifest.asset.pageUrl, 'ambientCG asset page'],
    [manifest.selection.archiveUrl, 'ambientCG HDRI archive'],
    [manifest.selection.archiveFinalUrl, 'ambientCG HDRI archive'],
    [manifest.licence.providerEvidence.requestedUrl, 'ambientCG licence evidence'],
    [manifest.licence.providerEvidence.finalUrl, 'ambientCG licence evidence'],
  ] as const)
    assertAllowedProviderUrl(url, apiOrigin, label);
  if (
    manifest.licence.url !== licenceUrl ||
    manifest.licence.providerEvidence.requestedUrl !== licenceUrl
  )
    throw new Error('Environment source licence URLs do not match the reviewed provider source');
  validateProviderLicenceEvidence(evidence.licenceEvidenceBytes);
  let assessment: unknown;
  try {
    assessment = JSON.parse(new TextDecoder().decode(evidence.licenceAssessmentBytes));
  } catch {
    throw new Error('Environment source licence assessment is invalid JSON');
  }
  const expectedAssessment = {
    schemaVersion: 1,
    kind: licenceAssessmentKind,
    provider: 'ambientcg',
    spdx: 'CC0-1.0',
    licenceUrl,
    reviewedAt: manifest.licence.providerEvidence.retrievedAt,
    providerEvidence: {
      path: manifest.licence.providerEvidence.path,
      sha256: manifest.licence.providerEvidence.sha256,
      requestedUrl: manifest.licence.providerEvidence.requestedUrl,
      finalUrl: manifest.licence.providerEvidence.finalUrl,
    },
    providerStatement:
      'ambientCG documents all downloadable assets as Creative Commons CC0 1.0 Universal, including commercial use and raw redistribution.',
  };
  if (canonicalSha256(assessment) !== canonicalSha256(expectedAssessment))
    throw new Error('Environment source licence assessment contradicts provider evidence');

  const extraction = extractSelectedSafeZipEntries(
    evidence.archiveBytes,
    new Set([manifest.radiance.archiveEntry]),
  );
  const selectedInventory = manifest.sourceArchive.inventory.filter((entry) => entry.selected);
  if (
    selectedInventory.length !== 1 ||
    selectedInventory[0]!.name !== manifest.radiance.archiveEntry ||
    selectedInventory[0]!.sha256 !== manifest.radiance.sha256
  )
    throw new Error('Environment source inventory does not bind exactly one radiance artifact');
  const extracted = extraction.extracted.get(manifest.radiance.archiveEntry);
  if (!extracted || !Buffer.from(extracted).equals(Buffer.from(evidence.radianceBytes)))
    throw new Error('Environment source radiance bytes do not match the selected archive entry');

  if (manifest.radiance.encoding === 'radiance-rgbe') {
    const inspection = inspectRadianceHdr(evidence.radianceBytes);
    const expected = {
      widthPixels: manifest.radiance.widthPixels,
      heightPixels: manifest.radiance.heightPixels,
      orientation: manifest.radiance.orientation,
      minimumPositiveRadiance: manifest.radiance.pixelRange.minimumPositiveRadiance,
      maximumRadiance: manifest.radiance.pixelRange.maximumRadiance,
      dynamicRangeRatio: manifest.radiance.pixelRange.dynamicRangeRatio,
      colorSpace: manifest.radiance.colorSpace,
    };
    if (canonicalSha256(inspection) !== canonicalSha256(expected))
      throw new Error('Environment Radiance evidence contradicts its source manifest');
  } else {
    if (!evidence.inspectionEvidenceBytes)
      throw new Error('Environment OpenEXR inspection evidence is missing');
    if (
      sha256Bytes(evidence.inspectionEvidenceBytes) !==
      manifest.radiance.structuralEvidence.inspector.evidenceSha256
    )
      throw new Error('Environment OpenEXR inspection evidence SHA-256 mismatch');
    let inspectionDocument: {
      version?: string;
      licenceSpdx?: string;
      verboseOutput?: string;
    };
    try {
      inspectionDocument = JSON.parse(new TextDecoder().decode(evidence.inspectionEvidenceBytes));
    } catch {
      throw new Error('Environment OpenEXR inspection evidence is invalid JSON');
    }
    if (
      inspectionDocument.version !== manifest.radiance.structuralEvidence.inspector.version ||
      inspectionDocument.licenceSpdx !==
        manifest.radiance.structuralEvidence.inspector.licenceSpdx ||
      typeof inspectionDocument.verboseOutput !== 'string'
    )
      throw new Error('Environment OpenEXR tool evidence contradicts its source manifest');
    const inspection = parseOpenExrInfo(
      inspectionDocument.verboseOutput,
      `exrinfo (OpenEXR) ${inspectionDocument.version}\nLicense ${inspectionDocument.licenceSpdx}\n`,
    );
    const expected = {
      widthPixels: manifest.radiance.widthPixels,
      heightPixels: manifest.radiance.heightPixels,
      storage: manifest.radiance.structuralEvidence.storage,
      channels: manifest.radiance.structuralEvidence.channels,
      dataWindow: manifest.radiance.structuralEvidence.dataWindow,
      displayWindow: manifest.radiance.structuralEvidence.displayWindow,
      colorSpace: manifest.radiance.colorSpace,
    };
    const actual = {
      widthPixels: inspection.widthPixels,
      heightPixels: inspection.heightPixels,
      storage: inspection.storage,
      channels: inspection.channels,
      dataWindow: inspection.dataWindow,
      displayWindow: inspection.displayWindow,
      colorSpace: inspection.colorSpace,
    };
    if (canonicalSha256(actual) !== canonicalSha256(expected))
      throw new Error('Environment OpenEXR structural evidence contradicts its source manifest');
  }
  return manifest;
}

export async function importAmbientCgEnvironmentRadianceSource(
  options: AmbientCgEnvironmentRadianceSourceOptions,
) {
  safeSegment(options.assetId);
  variant(options);
  if (options.mode === 'offline' && !options.expectedSourceIdentitySha256)
    throw new Error('Offline ambientCG HDRI imports require an exact source identity');
  if (options.mode === 'offline' && options.refresh)
    throw new Error('ambientCG HDRI source refresh requires online mode');
  const loaded =
    options.mode === 'offline' || (!options.refresh && (await recordExists(options)))
      ? await acquireCached(options)
      : await acquireOnline(options);
  const asset = parseAsset(loaded.responseBytes, options.assetId);
  const download = selectDownload(asset, options.resolution);
  const recordedApiOrigin = new URL(loaded.record.requestUrl).origin;
  assertAllowedProviderUrl(loaded.record.requestUrl, recordedApiOrigin, 'ambientCG API');
  assertAllowedProviderUrl(loaded.record.responseFinalUrl, recordedApiOrigin, 'ambientCG API');
  assertAllowedProviderUrl(loaded.record.archiveUrl, recordedApiOrigin, 'ambientCG HDRI archive');
  assertAllowedProviderUrl(
    loaded.record.archiveFinalUrl,
    recordedApiOrigin,
    'ambientCG HDRI archive',
  );
  assertAllowedProviderUrl(
    loaded.record.licenceUrl,
    recordedApiOrigin,
    'ambientCG licence evidence',
  );
  assertAllowedProviderUrl(
    loaded.record.licenceFinalUrl,
    recordedApiOrigin,
    'ambientCG licence evidence',
  );
  if (
    sha256Bytes(loaded.licenceEvidenceBytes) !== loaded.record.licenceEvidenceSha256 ||
    loaded.licenceEvidenceBytes.byteLength !== loaded.record.licenceEvidenceSizeBytes
  )
    throw new Error('Cached ambientCG provider licence evidence contradicts its record');
  validateProviderLicenceEvidence(loaded.licenceEvidenceBytes);
  if (
    download.url !== loaded.record.archiveUrl ||
    download.size !== loaded.record.declaredSizeBytes ||
    asset.technique !== loaded.record.technique ||
    asset.releaseDate !== loaded.record.releaseDate
  )
    throw new Error('Cached ambientCG HDRI selection no longer matches its API response');
  const inventory = extractSelectedSafeZipEntries(
    loaded.archiveBytes,
    new Set<string>(),
    options.archiveLimits,
  ).inventory;
  const selected = selectEnvironmentEntry(inventory, options.assetId, options.resolution);
  const selectedEntry = selected.entry;
  if (
    selectedEntry !== loaded.record.radianceEntry ||
    selected.encoding !== loaded.record.sourceEncoding
  )
    throw new Error('Cached ambientCG HDRI archive entry no longer matches its record');
  const extracted = extractSelectedSafeZipEntries(
    loaded.archiveBytes,
    new Set([selectedEntry]),
    options.archiveLimits,
  ).extracted.get(selectedEntry)!;
  if (
    sha256Bytes(extracted) !== loaded.record.radianceSha256 ||
    sha256Bytes(loaded.radianceBytes) !== loaded.record.radianceSha256
  )
    throw new Error('Cached ambientCG Radiance source no longer matches its archive');
  const inspection =
    selected.encoding === 'radiance-rgbe'
      ? inspectRadianceHdr(loaded.radianceBytes, options.radianceLimits)
      : undefined;
  if (
    inspection &&
    (inspection.widthPixels !== loaded.record.widthPixels ||
      inspection.heightPixels !== loaded.record.heightPixels ||
      canonicalSha256(inspection.colorSpace) !== canonicalSha256(loaded.record.colorSpace))
  )
    throw new Error('Cached ambientCG HDRI dimensions no longer match its record');
  if (loaded.record.inspection.kind === 'openexr') {
    if (!loaded.inspectionEvidenceBytes)
      throw new Error('Cached ambientCG OpenEXR inspection evidence is missing');
    if (sha256Bytes(loaded.inspectionEvidenceBytes) !== loaded.record.inspection.evidenceSha256)
      throw new Error('Cached ambientCG OpenEXR inspection evidence hash mismatch');
    let evidence: {
      version?: string;
      licenceSpdx?: string;
      verboseOutput?: string;
    };
    try {
      evidence = JSON.parse(new TextDecoder().decode(loaded.inspectionEvidenceBytes));
    } catch {
      throw new Error('Cached ambientCG OpenEXR inspection evidence is invalid JSON');
    }
    if (
      evidence.version !== loaded.record.inspection.inspectorVersion ||
      evidence.licenceSpdx !== loaded.record.inspection.inspectorLicenceSpdx ||
      typeof evidence.verboseOutput !== 'string'
    )
      throw new Error('Cached ambientCG OpenEXR inspection evidence contradicts its record');
    const reparsed = parseOpenExrInfo(
      evidence.verboseOutput,
      `exrinfo (OpenEXR) ${evidence.version}\nLicense ${evidence.licenceSpdx}\n`,
    );
    if (
      canonicalSha256({
        widthPixels: reparsed.widthPixels,
        heightPixels: reparsed.heightPixels,
        storage: reparsed.storage,
        channels: reparsed.channels,
        dataWindow: reparsed.dataWindow,
        displayWindow: reparsed.displayWindow,
        colorSpace: reparsed.colorSpace,
      }) !==
      canonicalSha256({
        widthPixels: loaded.record.widthPixels,
        heightPixels: loaded.record.heightPixels,
        storage: loaded.record.inspection.storage,
        channels: loaded.record.inspection.channels,
        dataWindow: loaded.record.inspection.dataWindow,
        displayWindow: loaded.record.inspection.displayWindow,
        colorSpace: loaded.record.colorSpace,
      })
    )
      throw new Error('Cached ambientCG OpenEXR structural evidence contradicts its record');
  }
  const expectedWidth = Number.parseInt(options.resolution, 10) * 1024;
  if (loaded.record.widthPixels !== expectedWidth)
    throw new Error(
      `Cached ambientCG ${options.resolution} environment width mismatch: received ${loaded.record.widthPixels}`,
    );

  const candidate = join(
    resolve(options.outputDirectory),
    `${asset.id.toLowerCase()}-${loaded.record.sourceIdentitySha256}`,
  );
  const apiPath = join(candidate, 'source', 'api-response.json');
  const archivePath = join(candidate, 'source', 'archive.zip');
  const artifactExtension = selected.encoding === 'radiance-rgbe' ? '.hdr' : '.exr';
  const radianceRelativePath = `radiance/environment${artifactExtension}`;
  const radiancePath = join(candidate, radianceRelativePath);
  await exactFile(apiPath, loaded.responseBytes);
  await exactFile(archivePath, loaded.archiveBytes);
  await exactFile(radiancePath, loaded.radianceBytes);
  const providerLicencePath = join(candidate, 'source', 'provider-licence.html');
  await exactFile(providerLicencePath, loaded.licenceEvidenceBytes);
  if (loaded.inspectionEvidenceBytes)
    await exactFile(
      join(candidate, 'source', 'openexr-inspection.json'),
      loaded.inspectionEvidenceBytes,
    );
  const assessment = {
    schemaVersion: 1,
    kind: licenceAssessmentKind,
    provider: 'ambientcg',
    spdx: 'CC0-1.0',
    licenceUrl,
    reviewedAt: loaded.record.retrievedAt,
    providerEvidence: {
      path: 'source/provider-licence.html',
      sha256: loaded.record.licenceEvidenceSha256,
      requestedUrl: loaded.record.licenceUrl,
      finalUrl: loaded.record.licenceFinalUrl,
    },
    providerStatement:
      'ambientCG documents all downloadable assets as Creative Commons CC0 1.0 Universal, including commercial use and raw redistribution.',
  };
  const assessmentBytes = Buffer.from(`${JSON.stringify(assessment, null, 2)}\n`, 'utf8');
  await exactFile(join(candidate, 'source', 'licence-assessment.json'), assessmentBytes);

  const manifest: OpenEnvironmentRadianceSourceManifest =
    openEnvironmentRadianceSourceManifestSchema.parse({
      schemaVersion: 1,
      sourceIdentitySha256: loaded.record.sourceIdentitySha256,
      provider: 'ambientcg',
      adapterVersion,
      providerApi: {
        version: apiVersion,
        requestUrl: loaded.record.requestUrl,
        finalUrl: loaded.record.responseFinalUrl,
        responsePath: 'source/api-response.json',
        responseSha256: loaded.record.responseSha256,
        retrievedAt: loaded.record.retrievedAt,
      },
      asset: {
        id: asset.id,
        type: 'hdri',
        title: asset.title,
        pageUrl: asset.url,
        releaseDate: asset.releaseDate,
        technique: asset.technique,
        tags: asset.tags,
      },
      licence: {
        spdx: 'CC0-1.0',
        name: 'Creative Commons CC0 1.0 Universal',
        url: licenceUrl,
        commercialUse: 'allowed',
        attributionRequired: false,
        providerEvidence: {
          requestedUrl: loaded.record.licenceUrl,
          finalUrl: loaded.record.licenceFinalUrl,
          mediaType: 'text/html',
          path: 'source/provider-licence.html',
          sha256: loaded.record.licenceEvidenceSha256,
          sizeBytes: loaded.record.licenceEvidenceSizeBytes,
          retrievedAt: loaded.record.retrievedAt,
        },
        adapterAssessment: {
          path: 'source/licence-assessment.json',
          sha256: sha256Bytes(assessmentBytes),
          kind: licenceAssessmentKind,
        },
      },
      selection: {
        resolution: options.resolution,
        encoding: selected.encoding === 'radiance-rgbe' ? 'HDR' : 'EXR',
        archiveUrl: download.url,
        archiveFinalUrl: loaded.record.archiveFinalUrl,
        declaredSizeBytes: download.size,
      },
      sourceArchive: {
        path: 'source/archive.zip',
        sha256: loaded.record.archiveSha256,
        sizeBytes: loaded.archiveBytes.byteLength,
        inventory: inventory.map((entry) => ({
          ...entry,
          selected: entry.name === selectedEntry,
          ...(entry.name === selectedEntry ? { sha256: loaded.record.radianceSha256 } : {}),
        })),
      },
      radiance:
        loaded.record.inspection.kind === 'radiance-rgbe'
          ? {
              path: radianceRelativePath,
              archiveEntry: selectedEntry,
              mediaType: 'image/vnd.radiance',
              sha256: loaded.record.radianceSha256,
              sizeBytes: loaded.radianceBytes.byteLength,
              encoding: 'radiance-rgbe',
              projection: 'equirectangular-latlong',
              orientation: '-Y +X',
              widthPixels: loaded.record.widthPixels,
              heightPixels: loaded.record.heightPixels,
              colorSpace: loaded.record.colorSpace,
              pixelRange: {
                method: 'decoded-rgbe-luminance',
                minimumPositiveRadiance: loaded.record.inspection.minimumPositiveRadiance,
                maximumRadiance: loaded.record.inspection.maximumRadiance,
                dynamicRangeRatio: loaded.record.inspection.dynamicRangeRatio,
              },
            }
          : {
              path: radianceRelativePath,
              archiveEntry: selectedEntry,
              mediaType: 'image/x-exr',
              sha256: loaded.record.radianceSha256,
              sizeBytes: loaded.radianceBytes.byteLength,
              encoding: 'openexr',
              projection: 'equirectangular-latlong',
              orientation: 'openexr-latlong-y-up',
              widthPixels: loaded.record.widthPixels,
              heightPixels: loaded.record.heightPixels,
              colorSpace: loaded.record.colorSpace,
              structuralEvidence: {
                storage: loaded.record.inspection.storage,
                channels: loaded.record.inspection.channels,
                dataWindow: loaded.record.inspection.dataWindow,
                displayWindow: loaded.record.inspection.displayWindow,
                inspector: {
                  tool: 'exrinfo',
                  version: loaded.record.inspection.inspectorVersion,
                  licenceSpdx: loaded.record.inspection.inspectorLicenceSpdx,
                  commandArguments: ['-v', '-s'],
                  evidencePath: 'source/openexr-inspection.json',
                  evidenceSha256: loaded.record.inspection.evidenceSha256,
                },
              },
            },
    });
  const recomputedIdentity = recomputeAmbientCgEnvironmentSourceIdentity(manifest);
  if (recomputedIdentity !== loaded.record.sourceIdentitySha256)
    throw new Error(
      `Environment source manifest identity mismatch: expected ${loaded.record.sourceIdentitySha256}, got ${recomputedIdentity}`,
    );
  validateAmbientCgEnvironmentSourceEvidence(manifest, {
    responseBytes: loaded.responseBytes,
    licenceEvidenceBytes: loaded.licenceEvidenceBytes,
    licenceAssessmentBytes: assessmentBytes,
    archiveBytes: loaded.archiveBytes,
    radianceBytes: loaded.radianceBytes,
    ...(loaded.inspectionEvidenceBytes
      ? { inspectionEvidenceBytes: loaded.inspectionEvidenceBytes }
      : {}),
  });
  const manifestPath = join(candidate, 'environment-radiance-source.json');
  await exactFile(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  return { candidate, manifestPath, manifest, fromCache: loaded.fromCache };
}
