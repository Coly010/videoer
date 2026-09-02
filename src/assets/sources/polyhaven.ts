import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { z } from 'zod';
import {
  canonicalSha256,
  loadContentObject,
  sha256Bytes,
  storeContentObject,
  writeImmutableFile,
} from './cache.js';
import {
  polyHavenMaterialSourceManifestSchema,
  sourceSha256Schema,
  type MaterialTextureChannel,
  type PolyHavenMaterialSourceManifest,
} from './model.js';

const adapterVersion = 'videoer.poly-haven-material-source.v2' as const;
const openApiVersion = '1.0.0' as const;
const reviewedTermsCommit = 'df4d579935b5e245b2a745635607b6a3c595d8dd' as const;
const reviewedTermsSha256 = '909a50da34e70cfeb2951fe195002dcc0c57cb342a37b13c869eb2d5dd678abd';
const userAgent = 'Videoer/0.1 poly-haven-material-source-v2';

const mapDefinitions = [
  { providerName: 'Diffuse', semantic: 'base-color', filename: 'base-color', required: true },
  { providerName: 'nor_gl', semantic: 'normal', filename: 'normal-gl', required: true },
  { providerName: 'Rough', semantic: 'roughness', filename: 'roughness', required: true },
  {
    providerName: 'Displacement',
    semantic: 'displacement',
    filename: 'displacement',
    required: false,
  },
  {
    providerName: 'AO',
    semantic: 'ambient-occlusion',
    filename: 'ambient-occlusion',
    required: false,
  },
  { providerName: 'Metal', semantic: 'metallic', filename: 'metallic', required: false },
  { providerName: 'Alpha', semantic: 'opacity', filename: 'opacity', required: false },
] as const;

const infoSchema = z
  .object({
    date_published: z.number().int().nonnegative(),
    name: z.string().min(1),
    categories: z.array(z.string().min(1)),
    type: z.literal(1),
    tags: z.array(z.string().min(1)),
    authors: z.record(z.string(), z.string()),
    dimensions: z.tuple([z.number().positive(), z.number().positive()]),
    max_resolution: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    files_hash: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .passthrough();

const providerFileSchema = z.object({
  size: z.number().int().positive(),
  url: z.string().url(),
  md5: z.string().regex(/^[a-f0-9]{32}$/),
});

interface HttpEvidence {
  requestedUrl: string;
  finalUrl: string;
  bytes: Uint8Array;
}

interface SelectedProviderFile {
  semantic: MaterialTextureChannel['semantic'];
  providerName: (typeof mapDefinitions)[number]['providerName'];
  filename: string;
  requestedUrl: string;
  finalUrl: string;
  declaredSizeBytes: number;
  providerMd5: string;
  sha256: string;
  bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'image/png';
  widthPixels: number;
  heightPixels: number;
}

export interface PolyHavenMaterialSourceOptions {
  assetId: string;
  resolution: `${number}k`;
  encoding: 'jpg' | 'png';
  cacheDirectory: string;
  outputDirectory: string;
  mode: 'online' | 'offline';
  refresh?: boolean;
  expectedSourceIdentitySha256?: string;
  apiBaseUrl?: string;
  currentTermsUrl?: string;
  reviewedTermsUrl?: string;
  licenceUrl?: string;
  approvedOrigins?: string[];
  visibleAttribution?: { confirmed: true; text: string; location: string };
  fetcher?: typeof fetch;
  now?: () => Date;
  maximumEvidenceBytes?: number;
  maximumFileBytes?: number;
}

function validAssetId(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(value))
    throw new Error(`Invalid Poly Haven asset ID: ${value}`);
  return value;
}

function approvedOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`Poly Haven acquisition requires HTTPS: ${value}`);
  if (url.username || url.password || (url.port && url.port !== '443'))
    throw new Error(
      `Poly Haven acquisition URL cannot contain credentials or a custom port: ${value}`,
    );
  return url.origin;
}

async function boundedResponse(response: Response, maximumBytes: number, label: string) {
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maximumBytes)
    throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
  if (!response.body) throw new Error(`${label} response has no body`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchApproved(
  fetcher: typeof fetch,
  requestedUrl: string,
  origins: Set<string>,
  maximumBytes: number,
  label: string,
): Promise<HttpEvidence> {
  let current = new URL(requestedUrl);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.username ||
      current.password ||
      (current.port && current.port !== '443') ||
      !origins.has(current.origin)
    )
      throw new Error(`${label} uses unapproved origin ${current.origin}`);
    const response = await fetcher(current, {
      headers: { 'user-agent': userAgent },
      redirect: 'manual',
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 5) throw new Error(`${label} exceeded five approved redirects`);
      const location = response.headers.get('location');
      if (!location) throw new Error(`${label} redirect omitted its Location header`);
      current = new URL(location, current);
      continue;
    }
    return {
      requestedUrl,
      finalUrl: current.toString(),
      bytes: await boundedResponse(response, maximumBytes, label),
    };
  }
  throw new Error(`${label} redirect handling failed`);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function assessTerms(current: Uint8Array, reviewed: Uint8Array, licence: Uint8Array) {
  if (sha256Bytes(reviewed) !== reviewedTermsSha256)
    throw new Error('Reviewed Poly Haven API terms no longer match pinned commit evidence');
  if (sha256Bytes(current) !== reviewedTermsSha256)
    throw new Error(
      'Current Poly Haven API terms differ from the reviewed commit; a new explicit terms review is required before live API use',
    );
  const currentText = new TextDecoder().decode(current);
  const reviewedText = new TextDecoder().decode(reviewed);
  const required = [
    'including commercial use, at no charge',
    'unique "Referer" header or user-agent that matches your software name',
    'you must make it clear to your users where that content comes from',
    'CC0 assets carry no attribution requirement whatsoever',
  ];
  for (const clause of required) {
    if (!reviewedText.includes(clause) || !currentText.includes(clause))
      throw new Error(`Poly Haven API terms contradict or omit reviewed clause: ${clause}`);
  }
  const licenceText = new TextDecoder().decode(licence);
  if (
    !/CC0/iu.test(licenceText) ||
    !/(?:any purpose[^.]{0,120}commercial|commercial[^.]{0,120}any purpose)/iu.test(licenceText) ||
    !/(?:no|without)[^.]{0,80}(?:credit|attribution)|(?:credit|attribution)[^.]{0,80}(?:not required|optional)/iu.test(
      licenceText,
    )
  )
    throw new Error(
      'Poly Haven licence evidence must prove CC0 commercial use and no asset attribution requirement',
    );
  return {
    kind: 'videoer-reviewed-poly-haven-api-assessment-v1' as const,
    reviewedCommit: reviewedTermsCommit,
    reviewedTermsSha256,
    currentTermsSha256: sha256Bytes(current),
    licenceEvidenceSha256: sha256Bytes(licence),
    liveApiCommercialUse: 'allowed' as const,
    liveApiRequiresUniqueUserAgent: true as const,
    liveApiAttributionRequired: true as const,
    downloadedAssetLicence: 'CC0-1.0' as const,
    downloadedAssetAttributionRequired: false as const,
  };
}

function uniqueCaseInsensitiveKey(
  value: Record<string, unknown>,
  expected: string,
  required: boolean,
) {
  const matches = Object.keys(value).filter((key) => key.toLowerCase() === expected.toLowerCase());
  if (matches.length > 1)
    throw new Error(`Poly Haven files response is ambiguous for '${expected}'`);
  if (matches.length === 0) {
    if (required)
      throw new Error(`Poly Haven files response is missing required '${expected}' map`);
    return undefined;
  }
  return matches[0]!;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Poly Haven files response has invalid ${label}`);
  return value as Record<string, unknown>;
}

function selectFiles(raw: unknown, resolution: string, encoding: string) {
  const root = objectValue(raw, 'root');
  return mapDefinitions.flatMap((definition) => {
    const mapKey = uniqueCaseInsensitiveKey(root, definition.providerName, definition.required);
    if (!mapKey) return [];
    const resolutions = objectValue(root[mapKey], `${mapKey} map`);
    const resolutionKey = uniqueCaseInsensitiveKey(resolutions, resolution, definition.required);
    if (!resolutionKey) return [];
    if (resolutionKey !== resolution)
      throw new Error(`Poly Haven resolution keys must be lowercase '${resolution}'`);
    const encodings = objectValue(resolutions[resolutionKey], `${mapKey}.${resolution}`);
    const encodingKey = uniqueCaseInsensitiveKey(encodings, encoding, definition.required);
    if (!encodingKey) return [];
    if (encodingKey !== encoding)
      throw new Error(`Poly Haven encoding keys must be lowercase '${encoding}'`);
    return [{ definition, provider: providerFileSchema.parse(encodings[encodingKey]) }];
  });
}

function imageStructure(bytes: Uint8Array, encoding: 'jpg' | 'png') {
  if (encoding === 'png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (
      bytes.length < 45 ||
      !signature.every((value, index) => bytes[index] === value) ||
      new TextDecoder().decode(bytes.slice(12, 16)) !== 'IHDR' ||
      new TextDecoder().decode(bytes.slice(-8, -4)) !== 'IEND'
    )
      throw new Error('Poly Haven PNG has an invalid signature or truncated IHDR');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const widthPixels = view.getUint32(16);
    const heightPixels = view.getUint32(20);
    if (widthPixels === 0 || heightPixels === 0)
      throw new Error('Poly Haven PNG has invalid dimensions');
    let decoded: PNG;
    try {
      decoded = PNG.sync.read(Buffer.from(bytes), { checkCRC: true });
    } catch (error) {
      throw new Error(
        `Poly Haven PNG cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (decoded.width !== widthPixels || decoded.height !== heightPixels)
      throw new Error('Poly Haven PNG decoded dimensions contradict its IHDR');
    return { widthPixels, heightPixels, mediaType: 'image/png' as const };
  }
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error('Poly Haven JPEG has an invalid signature');
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
    throw new Error('Poly Haven JPEG is truncated before its end-of-image marker');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  const startsOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 8 < bytes.length) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (startsOfFrame.has(marker)) {
      const heightPixels = view.getUint16(offset + 3);
      const widthPixels = view.getUint16(offset + 5);
      if (widthPixels === 0 || heightPixels === 0)
        throw new Error('Poly Haven JPEG has invalid dimensions');
      let decoded: jpeg.RawImageData<Uint8Array>;
      try {
        decoded = jpeg.decode(bytes, {
          useTArray: true,
          tolerantDecoding: false,
          formatAsRGBA: true,
          maxResolutionInMP: 100,
          maxMemoryUsageInMB: 1024,
        });
      } catch (error) {
        throw new Error(
          `Poly Haven JPEG cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (decoded.width !== widthPixels || decoded.height !== heightPixels)
        throw new Error('Poly Haven JPEG decoded dimensions contradict its start-of-frame');
      return { widthPixels, heightPixels, mediaType: 'image/jpeg' as const };
    }
    offset += length;
  }
  throw new Error('Poly Haven JPEG lacks a supported start-of-frame marker');
}

function validateResolution(width: number, height: number, resolution: string) {
  const expected = Number.parseInt(resolution, 10) * 1024;
  const observed = Math.max(width, height);
  if (Math.abs(observed - expected) / expected > 0.05)
    throw new Error(
      `Poly Haven image dimensions ${width}x${height} do not match ${resolution} within 5%`,
    );
}

function validateSelectedDimensions(
  files: Array<{ widthPixels: number; heightPixels: number }>,
  maximum: [number, number],
) {
  const dimensions = new Set(files.map((file) => `${file.widthPixels}x${file.heightPixels}`));
  if (dimensions.size !== 1)
    throw new Error('Poly Haven selected channel pixel dimensions must be identical');
  const first = files[0]!;
  const selectedAspect = first.widthPixels / first.heightPixels;
  const providerAspect = maximum[0] / maximum[1];
  if (Math.abs(selectedAspect / providerAspect - 1) > 0.05)
    throw new Error(
      'Poly Haven selected channel aspect ratio does not match provider max_resolution within 5%',
    );
  if (first.widthPixels > maximum[0] * 1.05 || first.heightPixels > maximum[1] * 1.05)
    throw new Error('Poly Haven selected channel dimensions exceed provider max_resolution');
}

function md5Bytes(bytes: Uint8Array) {
  return createHash('md5').update(bytes).digest('hex');
}

const cachedFileSchema = z
  .object({
    semantic: z.enum([
      'base-color',
      'normal',
      'roughness',
      'displacement',
      'ambient-occlusion',
      'metallic',
      'opacity',
    ]),
    providerName: z.enum(['Diffuse', 'nor_gl', 'Rough', 'Displacement', 'AO', 'Metal', 'Alpha']),
    filename: z.enum([
      'base-color',
      'normal-gl',
      'roughness',
      'displacement',
      'ambient-occlusion',
      'metallic',
      'opacity',
    ]),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    declaredSizeBytes: z.number().int().positive(),
    providerMd5: z.string().regex(/^[a-f0-9]{32}$/),
    sha256: sourceSha256Schema,
    mediaType: z.enum(['image/jpeg', 'image/png']),
    widthPixels: z.number().int().positive(),
    heightPixels: z.number().int().positive(),
  })
  .superRefine((file, context) => {
    const definition = mapDefinitions.find((entry) => entry.providerName === file.providerName);
    if (
      !definition ||
      definition.semantic !== file.semantic ||
      definition.filename !== file.filename
    )
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'cached Poly Haven file must use the canonical provider/semantic/filename mapping',
      });
  });

const cacheRecordSchema = z.object({
  schemaVersion: z.literal(2),
  sourceIdentitySha256: sourceSha256Schema,
  identity: z.record(z.string(), z.unknown()),
  retrievedAt: z.string().datetime(),
  objects: z.object({
    info: sourceSha256Schema,
    files: sourceSha256Schema,
    currentTerms: sourceSha256Schema,
    reviewedTerms: sourceSha256Schema,
    licence: sourceSha256Schema,
    assessment: sourceSha256Schema,
  }),
  selected: z.array(cachedFileSchema).min(3),
});

type CacheRecord = z.infer<typeof cacheRecordSchema>;

function variantKey(resolution: string, encoding: string) {
  if (!/^[1-9]\d*k$/u.test(resolution) || !['jpg', 'png'].includes(encoding))
    throw new Error(`Unsafe Poly Haven cache variant: ${resolution}-${encoding}`);
  return `${resolution}-${encoding}`;
}

function cacheRecordPath(
  cacheDirectory: string,
  assetId: string,
  resolution: string,
  encoding: string,
  identity: string,
) {
  return join(
    resolve(cacheDirectory),
    'records',
    'poly-haven',
    assetId,
    variantKey(resolution, encoding),
    `${identity}.json`,
  );
}

function latestRecordPath(
  cacheDirectory: string,
  assetId: string,
  resolution: string,
  encoding: string,
) {
  return join(
    resolve(cacheDirectory),
    'records',
    'poly-haven',
    assetId,
    variantKey(resolution, encoding),
    'latest.json',
  );
}

async function writeLatestRecord(
  cacheDirectory: string,
  assetId: string,
  resolution: string,
  encoding: string,
  identity: string,
) {
  const path = latestRecordPath(cacheDirectory, assetId, resolution, encoding);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.incoming-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify({ sourceIdentitySha256: identity }, null, 2)}\n`, {
    flag: 'wx',
  });
  await rename(temporary, path);
}

async function readLatestIdentity(
  cacheDirectory: string,
  assetId: string,
  resolution: string,
  encoding: string,
) {
  try {
    const value = JSON.parse(
      await readFile(latestRecordPath(cacheDirectory, assetId, resolution, encoding), 'utf8'),
    ) as {
      sourceIdentitySha256?: unknown;
    };
    return sourceSha256Schema.parse(value.sourceIdentitySha256);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function cachedExactIdentity(
  cacheDirectory: string,
  assetId: string,
  resolution: string,
  encoding: string,
  identity: string,
) {
  try {
    await readFile(cacheRecordPath(cacheDirectory, assetId, resolution, encoding, identity));
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function validateCacheRecord(value: unknown) {
  const record = cacheRecordSchema.parse(value);
  const expected = canonicalSha256(record.identity);
  if (expected !== record.sourceIdentitySha256)
    throw new Error(
      `Poly Haven cache identity mismatch: expected ${expected}, got ${record.sourceIdentitySha256}`,
    );
  return record;
}

async function exactFile(path: string, bytes: Uint8Array) {
  try {
    const existing = await readFile(path);
    if (!Buffer.from(existing).equals(Buffer.from(bytes)))
      throw new Error(`Candidate artifact already exists with different bytes: ${path}`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeImmutableFile(path, bytes);
}

async function publishCandidate(
  outputDirectory: string,
  candidate: string,
  artifacts: Array<[string, Uint8Array]>,
) {
  await mkdir(resolve(outputDirectory), { recursive: true });
  const temporary = await mkdtemp(join(resolve(outputDirectory), '.polyhaven-candidate-'));
  try {
    for (const [relative, bytes] of artifacts) await exactFile(join(temporary, relative), bytes);
    try {
      await rename(temporary, candidate);
      return;
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error;
    }
    // Existing candidates are immutable: verify every expected byte and never
    // repair, merge, or overwrite a partial/user-owned directory.
    const rootStat = await lstat(candidate);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new Error(`Existing Poly Haven candidate is not a real directory: ${candidate}`);
    const actualInventory: string[] = [];
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const path = join(directory, entry.name);
        const status = await lstat(path);
        if (status.isSymbolicLink())
          throw new Error(`Existing Poly Haven candidate contains a symbolic link: ${relative}`);
        if (status.isDirectory()) await walk(path, relative);
        else if (status.isFile()) actualInventory.push(relative);
        else throw new Error(`Existing Poly Haven candidate contains a non-file: ${relative}`);
      }
    };
    await walk(candidate);
    const expectedInventory = artifacts.map(([relative]) => relative).sort();
    actualInventory.sort();
    if (JSON.stringify(actualInventory) !== JSON.stringify(expectedInventory))
      throw new Error('Existing Poly Haven candidate inventory is not exactly immutable evidence');
    for (const [relative, bytes] of artifacts) {
      let existing: Uint8Array;
      try {
        existing = await readFile(join(candidate, relative));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new Error(
            `Candidate already exists but is incomplete: ${join(candidate, relative)}`,
          );
        throw error;
      }
      if (!Buffer.from(existing).equals(Buffer.from(bytes)))
        throw new Error(
          `Candidate artifact already exists with different bytes: ${join(candidate, relative)}`,
        );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function onlineAcquisition(options: PolyHavenMaterialSourceOptions, origins: Set<string>) {
  if (
    !options.visibleAttribution?.confirmed ||
    !options.visibleAttribution.text.toLowerCase().includes('poly haven')
  )
    throw new Error(
      'Live Poly Haven API access requires confirmed visible attribution naming Poly Haven',
    );
  const visibleAttribution = options.visibleAttribution;
  const fetcher = options.fetcher ?? fetch;
  const apiBase = options.apiBaseUrl ?? 'https://api.polyhaven.com';
  const currentTermsUrl =
    options.currentTermsUrl ??
    'https://raw.githubusercontent.com/Poly-Haven/Public-API/master/ToS.md';
  const reviewedTermsUrl =
    options.reviewedTermsUrl ??
    `https://raw.githubusercontent.com/Poly-Haven/Public-API/${reviewedTermsCommit}/ToS.md`;
  const licenceUrl = options.licenceUrl ?? 'https://polyhaven.com/license';
  const evidenceLimit = options.maximumEvidenceBytes ?? 8_000_000;
  // Terms are intentionally acquired and assessed before any live API call.
  const currentTerms = await fetchApproved(
    fetcher,
    currentTermsUrl,
    origins,
    evidenceLimit,
    'Poly Haven current API terms',
  );
  const reviewedTerms = await fetchApproved(
    fetcher,
    reviewedTermsUrl,
    origins,
    evidenceLimit,
    'Poly Haven reviewed API terms',
  );
  const licence = await fetchApproved(
    fetcher,
    licenceUrl,
    origins,
    evidenceLimit,
    'Poly Haven licence page',
  );
  const assessmentValue = assessTerms(currentTerms.bytes, reviewedTerms.bytes, licence.bytes);
  const assessment = Buffer.from(`${JSON.stringify(assessmentValue, null, 2)}\n`, 'utf8');

  const infoUrl = new URL(`/info/${options.assetId}`, apiBase).toString();
  const filesUrl = new URL(`/files/${options.assetId}`, apiBase).toString();
  const info = await fetchApproved(fetcher, infoUrl, origins, evidenceLimit, 'Poly Haven info API');
  const files = await fetchApproved(
    fetcher,
    filesUrl,
    origins,
    evidenceLimit,
    'Poly Haven files API',
  );
  const parsedInfo = infoSchema.parse(parseJson(info.bytes, 'Poly Haven info API'));
  const chosen = selectFiles(
    parseJson(files.bytes, 'Poly Haven files API'),
    options.resolution,
    options.encoding,
  );
  const selected: SelectedProviderFile[] = [];
  for (const choice of chosen) {
    const fetched = await fetchApproved(
      fetcher,
      choice.provider.url,
      origins,
      Math.min(options.maximumFileBytes ?? 500_000_000, choice.provider.size),
      `Poly Haven ${choice.definition.providerName}`,
    );
    if (fetched.bytes.byteLength !== choice.provider.size)
      throw new Error(
        `Poly Haven ${choice.definition.providerName} size mismatch: declared ${choice.provider.size}, received ${fetched.bytes.byteLength}`,
      );
    const md5 = md5Bytes(fetched.bytes);
    if (md5 !== choice.provider.md5)
      throw new Error(
        `Poly Haven ${choice.definition.providerName} MD5 mismatch: expected ${choice.provider.md5}, got ${md5}`,
      );
    const structure = imageStructure(fetched.bytes, options.encoding);
    validateResolution(structure.widthPixels, structure.heightPixels, options.resolution);
    selected.push({
      semantic: choice.definition.semantic,
      providerName: choice.definition.providerName,
      filename: choice.definition.filename,
      requestedUrl: fetched.requestedUrl,
      finalUrl: fetched.finalUrl,
      declaredSizeBytes: choice.provider.size,
      providerMd5: choice.provider.md5,
      sha256: sha256Bytes(fetched.bytes),
      bytes: fetched.bytes,
      ...structure,
    });
  }
  selected.sort((left, right) => left.semantic.localeCompare(right.semantic));
  validateSelectedDimensions(selected, parsedInfo.max_resolution);
  const objects = {
    info: await storeContentObject(options.cacheDirectory, info.bytes),
    files: await storeContentObject(options.cacheDirectory, files.bytes),
    currentTerms: await storeContentObject(options.cacheDirectory, currentTerms.bytes),
    reviewedTerms: await storeContentObject(options.cacheDirectory, reviewedTerms.bytes),
    licence: await storeContentObject(options.cacheDirectory, licence.bytes),
    assessment: await storeContentObject(options.cacheDirectory, assessment),
  };
  for (const file of selected) await storeContentObject(options.cacheDirectory, file.bytes);
  const assetIdentity = {
    id: options.assetId,
    type: 'material',
    providerType: 1,
    title: parsedInfo.name,
    pageUrl: `https://polyhaven.com/a/${options.assetId}`,
    releaseDate: new Date(parsedInfo.date_published * 1000).toISOString().slice(0, 10),
    tags: parsedInfo.tags,
    categories: parsedInfo.categories,
    authors: parsedInfo.authors,
  };
  const physicalScaleIdentity = {
    status: 'known',
    widthMeters: parsedInfo.dimensions[0] / 1000,
    heightMeters: parsedInfo.dimensions[1] / 1000,
    providerDimensionsMillimetres: parsedInfo.dimensions,
    providerMaxResolutionPixels: parsedInfo.max_resolution,
    relativeTolerance: 0.05,
    evidenceBoundsMeters: {
      width: [(parsedInfo.dimensions[0] / 1000) * 0.95, (parsedInfo.dimensions[0] / 1000) * 1.05],
      height: [(parsedInfo.dimensions[1] / 1000) * 0.95, (parsedInfo.dimensions[1] / 1000) * 1.05],
    },
    source: 'poly-haven-info-dimensions-millimetres',
  };
  const normalizedProviderFiles = selected.map((file) => {
    const colorSpace = file.semantic === 'base-color' ? 'srgb-texture' : 'non-color';
    return {
      semantic: file.semantic,
      providerName: file.providerName,
      requestedUrl: file.requestedUrl,
      finalUrl: file.finalUrl,
      declaredSizeBytes: file.declaredSizeBytes,
      providerMd5: file.providerMd5,
      sha256: file.sha256,
      path: `textures/${file.filename}.${options.encoding}`,
      mediaType: file.mediaType,
      widthPixels: file.widthPixels,
      heightPixels: file.heightPixels,
      colorSpace,
      ...(file.semantic === 'normal' ? { normalConvention: 'opengl-positive-green' } : {}),
    };
  });
  const normalizedChannels = normalizedProviderFiles.map((file) => ({
    semantic: file.semantic,
    providerName: file.providerName,
    path: file.path,
    mediaType: file.mediaType,
    sha256: file.sha256,
    sizeBytes: file.declaredSizeBytes,
    colorSpace: file.colorSpace,
    ...(file.normalConvention ? { normalConvention: file.normalConvention } : {}),
  }));
  const identity = {
    schemaVersion: 2,
    kind: 'provider-files',
    provider: 'poly-haven',
    adapterVersion,
    openApiVersion,
    userAgent,
    asset: assetIdentity,
    selection: { resolution: options.resolution, encoding: options.encoding },
    physicalScale: physicalScaleIdentity,
    approvedOrigins: [...origins].sort(),
    attribution: visibleAttribution,
    evidence: {
      info: {
        requestedUrl: info.requestedUrl,
        finalUrl: info.finalUrl,
        sha256: objects.info.sha256,
        sizeBytes: info.bytes.byteLength,
      },
      files: {
        requestedUrl: files.requestedUrl,
        finalUrl: files.finalUrl,
        sha256: objects.files.sha256,
        sizeBytes: files.bytes.byteLength,
        providerFilesHash: parsedInfo.files_hash,
      },
      currentTerms: {
        requestedUrl: currentTerms.requestedUrl,
        finalUrl: currentTerms.finalUrl,
        sha256: objects.currentTerms.sha256,
        sizeBytes: currentTerms.bytes.byteLength,
      },
      reviewedTerms: {
        requestedUrl: reviewedTerms.requestedUrl,
        finalUrl: reviewedTerms.finalUrl,
        sha256: objects.reviewedTerms.sha256,
        sizeBytes: reviewedTerms.bytes.byteLength,
        commit: reviewedTermsCommit,
      },
      licence: {
        requestedUrl: licence.requestedUrl,
        finalUrl: licence.finalUrl,
        sha256: objects.licence.sha256,
        sizeBytes: licence.bytes.byteLength,
      },
      assessmentSha256: objects.assessment.sha256,
    },
    providerFiles: normalizedProviderFiles,
    channels: normalizedChannels,
  };
  const sourceIdentitySha256 = canonicalSha256(identity);
  if (
    options.expectedSourceIdentitySha256 &&
    options.expectedSourceIdentitySha256 !== sourceIdentitySha256
  )
    throw new Error(
      `Poly Haven source identity mismatch: expected ${options.expectedSourceIdentitySha256}, got ${sourceIdentitySha256}`,
    );
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const acquiredRecord: CacheRecord = validateCacheRecord({
    schemaVersion: 2,
    sourceIdentitySha256,
    identity,
    retrievedAt,
    objects: Object.fromEntries(
      Object.entries(objects).map(([key, object]) => [key, object.sha256]),
    ),
    selected: selected.map((file) => ({
      semantic: file.semantic,
      providerName: file.providerName,
      filename: file.filename,
      requestedUrl: file.requestedUrl,
      finalUrl: file.finalUrl,
      declaredSizeBytes: file.declaredSizeBytes,
      providerMd5: file.providerMd5,
      sha256: file.sha256,
      mediaType: file.mediaType,
      widthPixels: file.widthPixels,
      heightPixels: file.heightPixels,
    })),
  });
  const immutableRecordPath = cacheRecordPath(
    options.cacheDirectory,
    options.assetId,
    options.resolution,
    options.encoding,
    sourceIdentitySha256,
  );
  let record = acquiredRecord;
  try {
    record = validateCacheRecord(JSON.parse(await readFile(immutableRecordPath, 'utf8')));
    if (JSON.stringify(record.identity) !== JSON.stringify(acquiredRecord.identity))
      throw new Error('Existing Poly Haven identity record contradicts refreshed acquisition');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeImmutableFile(
      immutableRecordPath,
      Buffer.from(`${JSON.stringify(acquiredRecord, null, 2)}\n`, 'utf8'),
    );
  }
  await writeLatestRecord(
    options.cacheDirectory,
    options.assetId,
    options.resolution,
    options.encoding,
    sourceIdentitySha256,
  );
  return {
    record,
    info,
    files,
    currentTerms,
    reviewedTerms,
    licence,
    assessment,
    selected,
    fromCache: false,
  };
}

async function offlineAcquisition(options: PolyHavenMaterialSourceOptions) {
  const identity = sourceSha256Schema.parse(options.expectedSourceIdentitySha256);
  let record: CacheRecord;
  try {
    record = validateCacheRecord(
      JSON.parse(
        await readFile(
          cacheRecordPath(
            options.cacheDirectory,
            options.assetId,
            options.resolution,
            options.encoding,
            identity,
          ),
          'utf8',
        ),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Offline Poly Haven cache has no exact source identity ${identity}`);
    throw error;
  }
  const loadEvidence = async (key: keyof CacheRecord['objects']) =>
    loadContentObject(options.cacheDirectory, record.objects[key]);
  const [infoBytes, filesBytes, currentTermsBytes, reviewedTermsBytes, licenceBytes, assessment] =
    await Promise.all([
      loadEvidence('info'),
      loadEvidence('files'),
      loadEvidence('currentTerms'),
      loadEvidence('reviewedTerms'),
      loadEvidence('licence'),
      loadEvidence('assessment'),
    ]);
  assessTerms(currentTermsBytes, reviewedTermsBytes, licenceBytes);
  const evidence = record.identity.evidence as Record<string, Record<string, unknown>>;
  const restored = (name: string, bytes: Uint8Array): HttpEvidence => ({
    requestedUrl: String(evidence[name]!.requestedUrl),
    finalUrl: String(evidence[name]!.finalUrl),
    bytes,
  });
  const selected: SelectedProviderFile[] = await Promise.all(
    record.selected.map(async (file) => ({
      ...file,
      semantic: file.semantic as MaterialTextureChannel['semantic'],
      providerName: file.providerName as SelectedProviderFile['providerName'],
      bytes: await loadContentObject(options.cacheDirectory, file.sha256),
    })),
  );
  for (const file of selected) {
    if (
      file.bytes.byteLength !== file.declaredSizeBytes ||
      md5Bytes(file.bytes) !== file.providerMd5
    )
      throw new Error(`Cached Poly Haven ${file.providerName} no longer matches provider evidence`);
    const structure = imageStructure(file.bytes, options.encoding);
    if (structure.widthPixels !== file.widthPixels || structure.heightPixels !== file.heightPixels)
      throw new Error(`Cached Poly Haven ${file.providerName} image structure changed`);
    validateResolution(structure.widthPixels, structure.heightPixels, options.resolution);
  }
  return {
    record,
    info: restored('info', infoBytes),
    files: restored('files', filesBytes),
    currentTerms: restored('currentTerms', currentTermsBytes),
    reviewedTerms: restored('reviewedTerms', reviewedTermsBytes),
    licence: restored('licence', licenceBytes),
    assessment,
    selected,
    fromCache: true,
  };
}

function evidenceRecord(evidence: HttpEvidence, path: string, retrievedAt: string) {
  return {
    requestedUrl: evidence.requestedUrl,
    finalUrl: evidence.finalUrl,
    path,
    sha256: sha256Bytes(evidence.bytes),
    sizeBytes: evidence.bytes.byteLength,
    retrievedAt,
  };
}

export function recomputePolyHavenMaterialSourceIdentity(
  manifest: PolyHavenMaterialSourceManifest,
) {
  return canonicalSha256({
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    provider: manifest.provider,
    adapterVersion: manifest.adapterVersion,
    openApiVersion: manifest.providerApi.openApiVersion,
    userAgent: manifest.providerApi.userAgent,
    asset: manifest.asset,
    selection: manifest.selection,
    physicalScale: manifest.physicalScale,
    approvedOrigins: manifest.approvedOrigins,
    attribution: manifest.serviceTerms.visibleAttribution,
    evidence: {
      info: {
        requestedUrl: manifest.providerApi.info.requestedUrl,
        finalUrl: manifest.providerApi.info.finalUrl,
        sha256: manifest.providerApi.info.sha256,
        sizeBytes: manifest.providerApi.info.sizeBytes,
      },
      files: {
        requestedUrl: manifest.providerApi.files.requestedUrl,
        finalUrl: manifest.providerApi.files.finalUrl,
        sha256: manifest.providerApi.files.sha256,
        sizeBytes: manifest.providerApi.files.sizeBytes,
        providerFilesHash: manifest.providerApi.providerFilesHash.value,
      },
      currentTerms: {
        requestedUrl: manifest.serviceTerms.current.requestedUrl,
        finalUrl: manifest.serviceTerms.current.finalUrl,
        sha256: manifest.serviceTerms.current.sha256,
        sizeBytes: manifest.serviceTerms.current.sizeBytes,
      },
      reviewedTerms: {
        requestedUrl: manifest.serviceTerms.reviewed.requestedUrl,
        finalUrl: manifest.serviceTerms.reviewed.finalUrl,
        sha256: manifest.serviceTerms.reviewed.sha256,
        sizeBytes: manifest.serviceTerms.reviewed.sizeBytes,
        commit: manifest.serviceTerms.reviewedCommit,
      },
      licence: {
        requestedUrl: manifest.assetLicence.evidence.requestedUrl,
        finalUrl: manifest.assetLicence.evidence.finalUrl,
        sha256: manifest.assetLicence.evidence.sha256,
        sizeBytes: manifest.assetLicence.evidence.sizeBytes,
      },
      assessmentSha256: manifest.serviceTerms.adapterAssessment.sha256,
    },
    providerFiles: manifest.providerFiles,
    channels: manifest.channels,
  });
}

/**
 * Reconstruct the normalized provider projection from the persisted official
 * responses. Consumers call this before staging so a rewritten manifest cannot
 * contradict its own evidence while remaining internally self-consistent.
 */
export async function verifyPolyHavenMaterialSourceEvidence(
  manifest: PolyHavenMaterialSourceManifest,
  loadArtifact: (
    path: string,
    expectedSha256: string,
    expectedSizeBytes?: number,
  ) => Promise<Uint8Array>,
) {
  const [infoBytes, filesBytes, currentTerms, reviewedTerms, licence, assessment] =
    await Promise.all([
      loadArtifact(
        manifest.providerApi.info.path,
        manifest.providerApi.info.sha256,
        manifest.providerApi.info.sizeBytes,
      ),
      loadArtifact(
        manifest.providerApi.files.path,
        manifest.providerApi.files.sha256,
        manifest.providerApi.files.sizeBytes,
      ),
      loadArtifact(
        manifest.serviceTerms.current.path,
        manifest.serviceTerms.current.sha256,
        manifest.serviceTerms.current.sizeBytes,
      ),
      loadArtifact(
        manifest.serviceTerms.reviewed.path,
        manifest.serviceTerms.reviewed.sha256,
        manifest.serviceTerms.reviewed.sizeBytes,
      ),
      loadArtifact(
        manifest.assetLicence.evidence.path,
        manifest.assetLicence.evidence.sha256,
        manifest.assetLicence.evidence.sizeBytes,
      ),
      loadArtifact(
        manifest.serviceTerms.adapterAssessment.path,
        manifest.serviceTerms.adapterAssessment.sha256,
      ),
    ]);
  const expectedAssessment = Buffer.from(
    `${JSON.stringify(assessTerms(currentTerms, reviewedTerms, licence), null, 2)}\n`,
    'utf8',
  );
  if (!Buffer.from(assessment).equals(expectedAssessment))
    throw new Error('Poly Haven adapter assessment contradicts persisted terms evidence');

  const info = infoSchema.parse(parseJson(infoBytes, 'Poly Haven info API'));
  const expectedAsset = {
    id: manifest.asset.id,
    type: 'material',
    providerType: 1,
    title: info.name,
    pageUrl: `https://polyhaven.com/a/${manifest.asset.id}`,
    releaseDate: new Date(info.date_published * 1000).toISOString().slice(0, 10),
    tags: info.tags,
    categories: info.categories,
    authors: info.authors,
  };
  if (canonicalSha256(manifest.asset) !== canonicalSha256(expectedAsset))
    throw new Error('Poly Haven normalized asset metadata contradicts persisted info evidence');
  if (manifest.providerApi.providerFilesHash.value !== info.files_hash)
    throw new Error('Poly Haven provider files hash contradicts persisted info evidence');

  const widthMeters = info.dimensions[0] / 1000;
  const heightMeters = info.dimensions[1] / 1000;
  const expectedScale = {
    status: 'known',
    widthMeters,
    heightMeters,
    providerDimensionsMillimetres: info.dimensions,
    providerMaxResolutionPixels: info.max_resolution,
    relativeTolerance: 0.05,
    evidenceBoundsMeters: {
      width: [widthMeters * 0.95, widthMeters * 1.05],
      height: [heightMeters * 0.95, heightMeters * 1.05],
    },
    source: 'poly-haven-info-dimensions-millimetres',
  };
  if (canonicalSha256(manifest.physicalScale) !== canonicalSha256(expectedScale))
    throw new Error('Poly Haven physical scale contradicts persisted info evidence');

  const selected = selectFiles(
    parseJson(filesBytes, 'Poly Haven files API'),
    manifest.selection.resolution,
    manifest.selection.encoding,
  );
  if (selected.length !== manifest.providerFiles.length)
    throw new Error('Poly Haven normalized map inventory contradicts persisted files evidence');
  for (const choice of selected) {
    const file = manifest.providerFiles.find(
      (candidate) => candidate.providerName === choice.definition.providerName,
    );
    if (
      !file ||
      file.semantic !== choice.definition.semantic ||
      file.requestedUrl !== choice.provider.url ||
      file.declaredSizeBytes !== choice.provider.size ||
      file.providerMd5 !== choice.provider.md5
    )
      throw new Error(
        `Poly Haven normalized ${choice.definition.providerName} map contradicts persisted files evidence`,
      );
    const bytes = await loadArtifact(file.path, file.sha256, file.declaredSizeBytes);
    if (md5Bytes(bytes) !== file.providerMd5)
      throw new Error(`Poly Haven ${file.providerName} bytes contradict provider MD5 evidence`);
    const structure = imageStructure(bytes, manifest.selection.encoding);
    if (
      structure.mediaType !== file.mediaType ||
      structure.widthPixels !== file.widthPixels ||
      structure.heightPixels !== file.heightPixels
    )
      throw new Error(`Poly Haven ${file.providerName} structure contradicts the manifest`);
    validateResolution(
      structure.widthPixels,
      structure.heightPixels,
      manifest.selection.resolution,
    );
  }
  validateSelectedDimensions(manifest.providerFiles, info.max_resolution);
}

export async function importPolyHavenMaterialSource(options: PolyHavenMaterialSourceOptions) {
  validAssetId(options.assetId);
  for (const [name, value] of [
    ['maximumEvidenceBytes', options.maximumEvidenceBytes],
    ['maximumFileBytes', options.maximumFileBytes],
  ] as const)
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new Error(`${name} must be a positive safe integer`);
  if (!/^[1-9]\d*k$/u.test(options.resolution))
    throw new Error('Poly Haven resolution must be lowercase, such as 1k or 2k');
  if (!['jpg', 'png'].includes(options.encoding))
    throw new Error('Poly Haven encoding must be lowercase jpg or png');
  if (
    options.mode === 'online' &&
    (!options.visibleAttribution?.confirmed ||
      !options.visibleAttribution.text.toLowerCase().includes('poly haven'))
  )
    throw new Error(
      'Live Poly Haven API access requires confirmed visible attribution naming Poly Haven',
    );
  if (options.mode === 'offline' && !options.expectedSourceIdentitySha256)
    throw new Error('Offline Poly Haven imports require an exact source identity');
  if (options.mode === 'offline' && options.refresh)
    throw new Error('Poly Haven source refresh requires online mode');
  const apiBase = options.apiBaseUrl ?? 'https://api.polyhaven.com';
  const configuredUrls = [
    apiBase,
    options.currentTermsUrl ??
      'https://raw.githubusercontent.com/Poly-Haven/Public-API/master/ToS.md',
    options.reviewedTermsUrl ??
      `https://raw.githubusercontent.com/Poly-Haven/Public-API/${reviewedTermsCommit}/ToS.md`,
    options.licenceUrl ?? 'https://polyhaven.com/license',
    'https://dl.polyhaven.org',
    ...(options.approvedOrigins ?? []),
  ];
  const origins = new Set(configuredUrls.map(approvedOrigin));
  const latestIdentity =
    options.mode === 'online' && !options.refresh
      ? options.expectedSourceIdentitySha256
        ? await cachedExactIdentity(
            options.cacheDirectory,
            options.assetId,
            options.resolution,
            options.encoding,
            sourceSha256Schema.parse(options.expectedSourceIdentitySha256),
          )
        : await readLatestIdentity(
            options.cacheDirectory,
            options.assetId,
            options.resolution,
            options.encoding,
          )
      : undefined;
  const loaded =
    options.mode === 'offline'
      ? await offlineAcquisition(options)
      : latestIdentity
        ? await offlineAcquisition({
            ...options,
            mode: 'offline',
            expectedSourceIdentitySha256: latestIdentity,
          })
        : await onlineAcquisition(options, origins);
  const recordedSelection = loaded.record.identity.selection as
    { resolution?: unknown; encoding?: unknown } | undefined;
  if (
    recordedSelection?.resolution !== options.resolution ||
    recordedSelection.encoding !== options.encoding
  )
    throw new Error('Exact Poly Haven cache identity does not match the requested variant');
  const recordedAttribution = z
    .object({
      confirmed: z.literal(true),
      text: z.string().min(1),
      location: z.string().min(1),
    })
    .parse(loaded.record.identity.attribution);
  if (
    options.visibleAttribution &&
    JSON.stringify(recordedAttribution) !== JSON.stringify(options.visibleAttribution)
  )
    throw new Error(
      'Exact Poly Haven cache identity does not match the visible attribution declaration',
    );
  const recordedOrigins = z
    .array(z.string().url())
    .min(1)
    .parse(loaded.record.identity.approvedOrigins);
  const info = infoSchema.parse(parseJson(loaded.info.bytes, 'Poly Haven info API'));
  validateSelectedDimensions(loaded.selected, info.max_resolution);
  const filesRaw = parseJson(loaded.files.bytes, 'Poly Haven files API');
  selectFiles(filesRaw, options.resolution, options.encoding);
  const candidate = join(
    resolve(options.outputDirectory),
    `${options.assetId}-${loaded.record.sourceIdentitySha256}`,
  );
  const artifacts: Array<[string, Uint8Array]> = [
    ['source/info-response.json', loaded.info.bytes],
    ['source/files-response.json', loaded.files.bytes],
    ['source/api-terms-current.md', loaded.currentTerms.bytes],
    ['source/api-terms-reviewed.md', loaded.reviewedTerms.bytes],
    ['source/licence-page.html', loaded.licence.bytes],
    ['source/adapter-assessment.json', loaded.assessment],
  ];
  const providerFiles = [];
  const channels: MaterialTextureChannel[] = [];
  for (const file of loaded.selected) {
    const extension = options.encoding === 'jpg' ? '.jpg' : '.png';
    const relative = `textures/${file.filename}${extension}`;
    artifacts.push([relative, file.bytes]);
    const colorSpace =
      file.semantic === 'base-color' ? ('srgb-texture' as const) : ('non-color' as const);
    providerFiles.push({
      semantic: file.semantic,
      providerName: file.providerName,
      requestedUrl: file.requestedUrl,
      finalUrl: file.finalUrl,
      declaredSizeBytes: file.declaredSizeBytes,
      providerMd5: file.providerMd5,
      sha256: file.sha256,
      path: relative,
      mediaType: file.mediaType,
      widthPixels: file.widthPixels,
      heightPixels: file.heightPixels,
      colorSpace,
      ...(file.semantic === 'normal' ? { normalConvention: 'opengl-positive-green' as const } : {}),
    });
    channels.push({
      semantic: file.semantic,
      providerName: file.providerName,
      path: relative,
      mediaType: file.mediaType,
      sha256: file.sha256,
      sizeBytes: file.declaredSizeBytes,
      colorSpace,
      ...(file.semantic === 'normal' ? { normalConvention: 'opengl-positive-green' as const } : {}),
    });
  }
  const retrievedAt = loaded.record.retrievedAt;
  const manifest = polyHavenMaterialSourceManifestSchema.parse({
    schemaVersion: 2,
    kind: 'provider-files',
    sourceIdentitySha256: loaded.record.sourceIdentitySha256,
    provider: 'poly-haven',
    adapterVersion,
    approvedOrigins: recordedOrigins,
    providerApi: {
      openApiVersion,
      userAgent,
      info: evidenceRecord(loaded.info, 'source/info-response.json', retrievedAt),
      files: evidenceRecord(loaded.files, 'source/files-response.json', retrievedAt),
      providerFilesHash: {
        algorithm: 'sha1',
        value: info.files_hash,
        treatment: 'provider-opaque-response-binding',
      },
    },
    asset: {
      id: options.assetId,
      type: 'material',
      providerType: 1,
      title: info.name,
      pageUrl: `https://polyhaven.com/a/${options.assetId}`,
      releaseDate: new Date(info.date_published * 1000).toISOString().slice(0, 10),
      tags: info.tags,
      categories: info.categories,
      authors: info.authors,
    },
    serviceTerms: {
      reviewedCommit: reviewedTermsCommit,
      reviewed: evidenceRecord(loaded.reviewedTerms, 'source/api-terms-reviewed.md', retrievedAt),
      current: evidenceRecord(loaded.currentTerms, 'source/api-terms-current.md', retrievedAt),
      adapterAssessment: {
        kind: 'videoer-reviewed-poly-haven-api-assessment-v1',
        path: 'source/adapter-assessment.json',
        sha256: sha256Bytes(loaded.assessment),
      },
      liveApiCommercialUse: 'allowed',
      liveApiAttributionRequired: true,
      visibleAttribution: recordedAttribution,
    },
    assetLicence: {
      spdx: 'CC0-1.0',
      name: 'Creative Commons CC0 1.0 Universal',
      commercialUse: 'allowed',
      attributionRequired: false,
      evidence: evidenceRecord(loaded.licence, 'source/licence-page.html', retrievedAt),
    },
    selection: { resolution: options.resolution, encoding: options.encoding },
    physicalScale: {
      status: 'known',
      widthMeters: info.dimensions[0] / 1000,
      heightMeters: info.dimensions[1] / 1000,
      providerDimensionsMillimetres: info.dimensions,
      providerMaxResolutionPixels: info.max_resolution,
      relativeTolerance: 0.05,
      evidenceBoundsMeters: {
        width: [(info.dimensions[0] / 1000) * 0.95, (info.dimensions[0] / 1000) * 1.05],
        height: [(info.dimensions[1] / 1000) * 0.95, (info.dimensions[1] / 1000) * 1.05],
      },
      source: 'poly-haven-info-dimensions-millimetres',
    },
    providerFiles,
    channels,
  });
  const recomputed = recomputePolyHavenMaterialSourceIdentity(manifest);
  if (recomputed !== manifest.sourceIdentitySha256)
    throw new Error(
      `Poly Haven manifest identity mismatch: expected ${recomputed}, got ${manifest.sourceIdentitySha256}`,
    );
  const manifestPath = join(candidate, 'material-source.json');
  artifacts.push([
    'material-source.json',
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ]);
  await publishCandidate(options.outputDirectory, candidate, artifacts);
  return { candidate, manifestPath, manifest, fromCache: loaded.fromCache };
}
