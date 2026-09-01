import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { extractSelectedSafeZipEntries, type SafeArchiveLimits } from './archive.js';
import {
  canonicalSha256,
  loadContentObject,
  readSourceCacheRecord,
  sha256Bytes,
  storeContentObject,
  writeSourceCacheRecord,
  type SourceCacheRecord,
} from './cache.js';
import {
  ambientCgApiResponseSchema,
  openMaterialSourceManifestSchema,
  type MaterialTextureChannel,
  type OpenMaterialSourceManifest,
} from './model.js';

const adapterVersion = 'videoer.ambientcg-material-source.v1';
const apiVersion = 'ambientcg-v3';
const licenceUrl = 'https://docs.ambientcg.com/license/';

export interface AmbientCgMaterialSourceOptions {
  assetId: string;
  resolution: `${number}K`;
  encoding: 'JPG' | 'PNG';
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
  archiveLimits?: SafeArchiveLimits;
}

interface LoadedSource {
  record: SourceCacheRecord;
  responseBytes: Uint8Array;
  archiveBytes: Uint8Array;
  fromCache: boolean;
}

function validAssetId(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/iu.test(value))
    throw new Error(`Invalid ambientCG asset ID: ${value}`);
  return value;
}

async function responseBytes(response: Response, maximumBytes: number, label: string) {
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maximumBytes)
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
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseAmbientCgResponse(bytes: Uint8Array, assetId: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('ambientCG v3 returned invalid JSON');
  }
  const response = ambientCgApiResponseSchema.parse(raw);
  const matches = response.assets.filter(
    (asset) => asset.id.toLowerCase() === assetId.toLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      `ambientCG v3 must return exactly one '${assetId}' material, received ${matches.length}`,
    );
  return matches[0]!;
}

function selectedDownload(
  asset: ReturnType<typeof parseAmbientCgResponse>,
  resolution: string,
  encoding: string,
) {
  const attribute = `${resolution}-${encoding}`;
  const matches = asset.downloads.filter(
    (download) => download.attributes === attribute && download.extension.toLowerCase() === 'zip',
  );
  if (matches.length !== 1)
    throw new Error(
      `ambientCG material requires exactly one ${attribute} ZIP, received ${matches.length}`,
    );
  return matches[0]!;
}

function requestUrl(baseUrl: string, assetId: string) {
  const url = new URL('/api/v3/assets', baseUrl);
  url.searchParams.set('id', assetId);
  url.searchParams.set(
    'include',
    'type,releaseDate,title,url,tags,dimensions,maps,technique,downloads',
  );
  return url.toString();
}

async function acquireOnline(options: AmbientCgMaterialSourceOptions): Promise<LoadedSource> {
  const fetcher = options.fetcher ?? fetch;
  const requested = requestUrl(options.apiBaseUrl ?? 'https://ambientcg.com', options.assetId);
  const apiResponse = await fetcher(requested, {
    headers: { 'user-agent': 'Videoer/0.1 open-asset-source ambientCG' },
    redirect: 'follow',
  });
  const response = await responseBytes(
    apiResponse,
    options.maximumApiBytes ?? 2_000_000,
    'ambientCG API',
  );
  const asset = parseAmbientCgResponse(response, options.assetId);
  const download = selectedDownload(asset, options.resolution, options.encoding);
  const archiveResponse = await fetcher(download.url, {
    headers: { 'user-agent': 'Videoer/0.1 open-asset-source ambientCG' },
    redirect: 'follow',
  });
  const archive = await responseBytes(
    archiveResponse,
    options.maximumArchiveBytes ?? 1_100_000_000,
    'ambientCG archive',
  );
  if (archive.byteLength !== download.size)
    throw new Error(
      `ambientCG archive size mismatch: declared ${download.size}, received ${archive.byteLength}`,
    );
  const [responseObject, archiveObject] = await Promise.all([
    storeContentObject(options.cacheDirectory, response),
    storeContentObject(options.cacheDirectory, archive),
  ]);
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const identityFields = {
    schemaVersion: 1 as const,
    provider: 'ambientcg' as const,
    adapterVersion,
    assetId: asset.id,
    variant: `${options.resolution}-${options.encoding}`,
    requestUrl: requested,
    responseSha256: responseObject.sha256,
    archiveSha256: archiveObject.sha256,
    archiveUrl: download.url,
    declaredSizeBytes: download.size,
  };
  const identity = canonicalSha256(identityFields);
  if (options.expectedSourceIdentitySha256 && identity !== options.expectedSourceIdentitySha256)
    throw new Error(
      `ambientCG source identity mismatch: expected ${options.expectedSourceIdentitySha256}, got ${identity}`,
    );
  const record = await writeSourceCacheRecord(options.cacheDirectory, {
    schemaVersion: 1,
    sourceIdentitySha256: identity,
    provider: 'ambientcg',
    adapterVersion,
    assetId: asset.id,
    variant: `${options.resolution}-${options.encoding}`,
    retrievedAt,
    requestUrl: requested,
    responseSha256: responseObject.sha256,
    archiveSha256: archiveObject.sha256,
    archiveUrl: download.url,
    declaredSizeBytes: download.size,
  });
  return { record, responseBytes: response, archiveBytes: archive, fromCache: false };
}

async function acquireCached(options: AmbientCgMaterialSourceOptions): Promise<LoadedSource> {
  const record = await readSourceCacheRecord(
    options.cacheDirectory,
    options.assetId,
    `${options.resolution}-${options.encoding}`,
    options.expectedSourceIdentitySha256,
  );
  const [response, archive] = await Promise.all([
    loadContentObject(options.cacheDirectory, record.responseSha256),
    loadContentObject(options.cacheDirectory, record.archiveSha256),
  ]);
  if (archive.byteLength !== record.declaredSizeBytes)
    throw new Error('Cached ambientCG archive no longer matches its declared size');
  return { record, responseBytes: response, archiveBytes: archive, fromCache: true };
}

async function cacheRecordExists(options: AmbientCgMaterialSourceOptions) {
  try {
    await readSourceCacheRecord(
      options.cacheDirectory,
      options.assetId,
      `${options.resolution}-${options.encoding}`,
      options.expectedSourceIdentitySha256,
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Offline source cache has no '))
      return false;
    throw error;
  }
}

const channelNames: Array<{
  providerName: string;
  semantic: MaterialTextureChannel['semantic'];
  filename: string;
}> = [
  { providerName: 'Color', semantic: 'base-color', filename: 'base-color' },
  { providerName: 'NormalGL', semantic: 'normal', filename: 'normal-gl' },
  { providerName: 'Roughness', semantic: 'roughness', filename: 'roughness' },
  { providerName: 'Metalness', semantic: 'metallic', filename: 'metallic' },
  { providerName: 'Metallic', semantic: 'metallic', filename: 'metallic' },
  {
    providerName: 'AmbientOcclusion',
    semantic: 'ambient-occlusion',
    filename: 'ambient-occlusion',
  },
  { providerName: 'Displacement', semantic: 'displacement', filename: 'displacement' },
  { providerName: 'Opacity', semantic: 'opacity', filename: 'opacity' },
];

function channelSelection(names: string[], resolution: string, encoding: string) {
  const selected = new Map<
    MaterialTextureChannel['semantic'],
    { source: string; providerName: string; filename: string }
  >();
  const variantMarker = `_${resolution}-${encoding}_`.toLowerCase();
  for (const name of names) {
    const extension = extname(name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.exr', '.tif', '.tiff'].includes(extension)) continue;
    if (!name.toLowerCase().includes(variantMarker)) continue;
    for (const definition of channelNames) {
      if (!name.toLowerCase().endsWith(`_${definition.providerName.toLowerCase()}${extension}`))
        continue;
      if (selected.has(definition.semantic))
        throw new Error(`ambientCG archive has duplicate ${definition.semantic} channels`);
      selected.set(definition.semantic, {
        source: name,
        providerName: definition.providerName,
        filename: definition.filename,
      });
    }
  }
  for (const required of ['base-color', 'normal', 'roughness'] as const)
    if (!selected.has(required))
      throw new Error(`ambientCG archive is missing required ${required} channel`);
  return selected;
}

function validateTextureSignature(extension: string, bytes: Uint8Array, source: string) {
  const matches =
    ((extension === '.jpg' || extension === '.jpeg') &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (extension === '.png' &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )) ||
    (extension === '.exr' &&
      bytes[0] === 0x76 &&
      bytes[1] === 0x2f &&
      bytes[2] === 0x31 &&
      bytes[3] === 0x01) ||
    ((extension === '.tif' || extension === '.tiff') &&
      ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
        (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)));
  if (!matches) throw new Error(`ambientCG channel has invalid ${extension} signature: ${source}`);
}

function mediaType(extension: string) {
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.exr') return 'image/x-exr';
  if (extension === '.tif' || extension === '.tiff') return 'image/tiff';
  throw new Error(`Unsupported texture extension: ${extension}`);
}

async function exactFile(path: string, bytes: Uint8Array) {
  try {
    const existing = await readFile(path);
    if (sha256Bytes(existing) !== sha256Bytes(bytes))
      throw new Error(`Candidate artifact already exists with different bytes: ${path}`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, bytes, { flag: 'wx' });
}

export async function importAmbientCgMaterialSource(options: AmbientCgMaterialSourceOptions) {
  validAssetId(options.assetId);
  if (options.refresh && options.mode === 'offline')
    throw new Error('ambientCG source refresh requires online mode');
  const loaded =
    options.mode === 'offline' || (!options.refresh && (await cacheRecordExists(options)))
      ? await acquireCached(options)
      : await acquireOnline(options);
  const asset = parseAmbientCgResponse(loaded.responseBytes, options.assetId);
  const download = selectedDownload(asset, options.resolution, options.encoding);
  if (
    loaded.record.archiveUrl !== download.url ||
    loaded.record.declaredSizeBytes !== download.size
  )
    throw new Error('Cached ambientCG selection no longer matches its API response');
  const allEntries = extractSelectedSafeZipEntries(
    loaded.archiveBytes,
    new Set<string>(),
    options.archiveLimits,
  ).inventory;
  const selection = channelSelection(
    allEntries.map((entry) => entry.name),
    options.resolution,
    options.encoding,
  );
  const chosenNames = new Set([...selection.values()].map((entry) => entry.source));
  const { inventory, extracted } = extractSelectedSafeZipEntries(
    loaded.archiveBytes,
    chosenNames,
    options.archiveLimits,
  );
  const candidate = join(
    resolve(options.outputDirectory),
    `${asset.id.toLowerCase()}-${loaded.record.sourceIdentitySha256}`,
  );
  const sourceDirectory = join(candidate, 'source');
  const texturesDirectory = join(candidate, 'textures');
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(texturesDirectory, { recursive: true });
  const responsePath = join(sourceDirectory, 'api-response.json');
  const archivePath = join(sourceDirectory, 'archive.zip');
  await exactFile(responsePath, loaded.responseBytes);
  await exactFile(archivePath, loaded.archiveBytes);
  if (sha256Bytes(await readFile(archivePath)) !== loaded.record.archiveSha256)
    throw new Error('Candidate archive copy failed integrity validation');

  const channels: MaterialTextureChannel[] = [];
  for (const [semantic, selected] of selection) {
    const bytes = extracted.get(selected.source)!;
    const extension = extname(selected.source).toLowerCase();
    validateTextureSignature(extension, bytes, selected.source);
    const relative = `textures/${selected.filename}${extension}`;
    await exactFile(join(candidate, relative), bytes);
    channels.push({
      semantic,
      providerName: selected.providerName,
      path: relative,
      mediaType: mediaType(extension),
      sha256: sha256Bytes(bytes),
      sizeBytes: bytes.byteLength,
      colorSpace: semantic === 'base-color' ? 'srgb-texture' : 'non-color',
      ...(semantic === 'normal' ? { normalConvention: 'opengl-positive-green' as const } : {}),
    });
  }
  channels.sort((left, right) => left.semantic.localeCompare(right.semantic));

  const evidence = {
    schemaVersion: 1,
    provider: 'ambientcg',
    spdx: 'CC0-1.0',
    licenceUrl,
    reviewedAt: loaded.record.retrievedAt,
    providerStatement:
      'ambientCG documents downloadable assets and material preview renders as Creative Commons CC0 1.0 Universal.',
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const evidencePath = join(sourceDirectory, 'licence-evidence.json');
  await exactFile(evidencePath, evidenceBytes);

  const selectedHashes = new Map(
    channels.map((channel) => [selection.get(channel.semantic)!.source, channel.sha256]),
  );
  const manifest: OpenMaterialSourceManifest = openMaterialSourceManifestSchema.parse({
    schemaVersion: 1,
    sourceIdentitySha256: loaded.record.sourceIdentitySha256,
    provider: 'ambientcg',
    adapterVersion,
    providerApi: {
      version: apiVersion,
      requestUrl: loaded.record.requestUrl,
      responsePath: 'source/api-response.json',
      responseSha256: loaded.record.responseSha256,
      retrievedAt: loaded.record.retrievedAt,
    },
    asset: {
      id: asset.id,
      type: 'material',
      title: asset.title,
      pageUrl: asset.url,
      releaseDate: asset.releaseDate,
      ...(asset.technique ? { technique: asset.technique } : {}),
      tags: asset.tags,
    },
    licence: {
      spdx: 'CC0-1.0',
      name: 'Creative Commons CC0 1.0 Universal',
      url: licenceUrl,
      commercialUse: 'allowed',
      attributionRequired: false,
      evidencePath: 'source/licence-evidence.json',
      evidenceSha256: sha256Bytes(evidenceBytes),
    },
    selection: {
      resolution: options.resolution,
      encoding: options.encoding,
      archiveUrl: download.url,
      declaredSizeBytes: download.size,
    },
    sourceArchive: {
      path: 'source/archive.zip',
      sha256: loaded.record.archiveSha256,
      sizeBytes: loaded.archiveBytes.byteLength,
      inventory: inventory.map((entry) => ({
        ...entry,
        selected: chosenNames.has(entry.name),
        ...(selectedHashes.get(entry.name) ? { sha256: selectedHashes.get(entry.name) } : {}),
      })),
    },
    physicalScale:
      asset.dimensions.width > 0 && asset.dimensions.height > 0
        ? {
            status: 'known',
            widthMeters: asset.dimensions.width / 100,
            heightMeters: asset.dimensions.height / 100,
            source: 'ambientcg-api-v3-centimetres',
          }
        : {
            status: 'unknown',
            reason: 'ambientCG v3 dimensions are zero or incomplete; scale must not be inferred',
          },
    channels,
  });
  const manifestPath = join(candidate, 'material-source.json');
  await exactFile(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  return { candidate, manifestPath, manifest, fromCache: loaded.fromCache };
}
