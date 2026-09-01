import { unzipSync } from 'fflate';

export interface SafeArchiveLimits {
  maximumEntries: number;
  maximumCompressedBytes: number;
  maximumExpandedBytes: number;
  maximumEntryBytes: number;
  maximumCompressionRatio: number;
}

export const defaultSafeArchiveLimits: SafeArchiveLimits = {
  maximumEntries: 64,
  maximumCompressedBytes: 1_100_000_000,
  maximumExpandedBytes: 2_200_000_000,
  maximumEntryBytes: 1_100_000_000,
  maximumCompressionRatio: 250,
};

export interface SafeArchiveEntry {
  name: string;
  compressedSizeBytes: number;
  expandedSizeBytes: number;
  compressionMethod: number;
}

function uint16(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset--)
    if (uint32(bytes, offset) === 0x06054b50) return offset;
  throw new Error('Unsafe ZIP: end-of-central-directory record is missing');
}

function safeName(name: string) {
  if (
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[a-z]:/iu.test(name) ||
    name.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new Error(`Unsafe ZIP path: ${JSON.stringify(name)}`);
}

export function inspectSafeZip(
  bytes: Uint8Array,
  limits: SafeArchiveLimits = defaultSafeArchiveLimits,
) {
  if (bytes.length > limits.maximumCompressedBytes)
    throw new Error(
      `Unsafe ZIP: compressed size ${bytes.length} exceeds ${limits.maximumCompressedBytes}`,
    );
  const end = findEndOfCentralDirectory(bytes);
  if (uint16(bytes, end + 4) !== 0 || uint16(bytes, end + 6) !== 0)
    throw new Error('Unsafe ZIP: multi-disk archives are not supported');
  const entryCount = uint16(bytes, end + 10);
  const centralSize = uint32(bytes, end + 12);
  let offset = uint32(bytes, end + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff)
    throw new Error('Unsafe ZIP: ZIP64 archives are not supported');
  if (entryCount > limits.maximumEntries)
    throw new Error(`Unsafe ZIP: ${entryCount} entries exceeds ${limits.maximumEntries}`);
  if (offset + centralSize > end)
    throw new Error('Unsafe ZIP: central directory escapes archive bounds');

  const entries: SafeArchiveEntry[] = [];
  const names = new Set<string>();
  let expandedTotal = 0;
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const legacy = new TextDecoder('latin1');
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > bytes.length || uint32(bytes, offset) !== 0x02014b50)
      throw new Error('Unsafe ZIP: malformed central-directory entry');
    const flags = uint16(bytes, offset + 8);
    const compressionMethod = uint16(bytes, offset + 10);
    const compressedSizeBytes = uint32(bytes, offset + 20);
    const expandedSizeBytes = uint32(bytes, offset + 24);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const commentLength = uint16(bytes, offset + 32);
    const externalAttributes = uint32(bytes, offset + 38);
    if (
      compressedSizeBytes === 0xffffffff ||
      expandedSizeBytes === 0xffffffff ||
      uint32(bytes, offset + 42) === 0xffffffff
    )
      throw new Error('Unsafe ZIP: ZIP64 entries are not supported');
    if ((flags & 1) !== 0) throw new Error('Unsafe ZIP: encrypted entries are not supported');
    if (compressionMethod !== 0 && compressionMethod !== 8)
      throw new Error(`Unsafe ZIP: compression method ${compressionMethod} is not supported`);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > bytes.length)
      throw new Error('Unsafe ZIP: entry metadata escapes archive bounds');
    const name =
      (flags & 0x800) !== 0
        ? utf8.decode(bytes.subarray(nameStart, nameEnd))
        : legacy.decode(bytes.subarray(nameStart, nameEnd));
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000)
      throw new Error(`Unsafe ZIP: symbolic link entry ${JSON.stringify(name)}`);
    const directory = name.endsWith('/');
    const collisionName = directory ? name.slice(0, -1) : name;
    safeName(collisionName);
    const folded = collisionName.normalize('NFC').toLocaleLowerCase('en-US');
    if (names.has(folded)) throw new Error(`Unsafe ZIP: duplicate path ${JSON.stringify(name)}`);
    names.add(folded);
    if (directory) {
      if (compressedSizeBytes !== 0 || expandedSizeBytes !== 0)
        throw new Error(`Unsafe ZIP: directory entry contains data ${JSON.stringify(name)}`);
    } else {
      if (expandedSizeBytes > limits.maximumEntryBytes)
        throw new Error(`Unsafe ZIP: entry ${JSON.stringify(name)} exceeds the per-entry limit`);
      const ratio = expandedSizeBytes / Math.max(1, compressedSizeBytes);
      if (ratio > limits.maximumCompressionRatio)
        throw new Error(
          `Unsafe ZIP: entry ${JSON.stringify(name)} exceeds compression-ratio limit`,
        );
      expandedTotal += expandedSizeBytes;
      if (expandedTotal > limits.maximumExpandedBytes)
        throw new Error(`Unsafe ZIP: expanded size exceeds ${limits.maximumExpandedBytes}`);
      entries.push({ name, compressedSizeBytes, expandedSizeBytes, compressionMethod });
    }
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== uint32(bytes, end + 16) + centralSize)
    throw new Error('Unsafe ZIP: central-directory size does not match its entries');
  return entries;
}

export function extractSelectedSafeZipEntries(
  bytes: Uint8Array,
  selectedNames: ReadonlySet<string>,
  limits: SafeArchiveLimits = defaultSafeArchiveLimits,
) {
  const inventory = inspectSafeZip(bytes, limits);
  const known = new Set(inventory.map((entry) => entry.name));
  for (const name of selectedNames)
    if (!known.has(name)) throw new Error(`ZIP selection does not exist: ${name}`);
  const extracted = unzipSync(bytes, { filter: (entry) => selectedNames.has(entry.name) });
  const output = new Map<string, Uint8Array>();
  for (const name of selectedNames) {
    const value = extracted[name];
    if (!value) throw new Error(`ZIP extraction did not produce selected entry: ${name}`);
    const expected = inventory.find((entry) => entry.name === name)!;
    if (value.byteLength !== expected.expandedSizeBytes)
      throw new Error(`ZIP extraction size mismatch for ${name}`);
    output.set(name, value);
  }
  return { inventory, extracted: output };
}
