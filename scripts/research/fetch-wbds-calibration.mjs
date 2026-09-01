#!/usr/bin/env node

import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const source = Object.freeze({
  title:
    'A public data set of overground and treadmill walking kinematics and kinetics of healthy individuals',
  doi: '10.6084/m9.figshare.5722711.v5',
  licence: 'CC BY 4.0',
  figshareFileId: 10058986,
  archiveName: 'WBDSascii.zip',
  archiveBytes: 585_783_356,
  publishedArchiveMd5: 'ad9e6311d9b84b53acaf58d114d51c6d',
  url: 'https://ndownloader.figshare.com/files/10058986',
});

const outputDirectory = resolve(
  process.argv[2] ?? '.videoer-cache/research/wbds-v5/young-comfortable-overground',
);
const selectedName = /^WBDS(?:0[1-9]|1[0-9]|2[0-4])walkOCang\.txt$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchRange(start, end) {
  const response = await globalThis.fetch(source.url, {
    headers: { Range: `bytes=${start}-${end}` },
    redirect: 'follow',
  });
  assert(
    response.status === 206,
    `Expected HTTP 206 for ${start}-${end}, received ${response.status}`,
  );
  const contentRange = response.headers.get('content-range');
  assert(
    contentRange === `bytes ${start}-${end}/${source.archiveBytes}`,
    `Unexpected Content-Range '${contentRange}' for ${start}-${end}`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(
    bytes.length === end - start + 1,
    `Short range ${start}-${end}: received ${bytes.length} bytes`,
  );
  return bytes;
}

function findEndOfCentralDirectory(tail, tailOffset) {
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentBytes = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentBytes !== tail.length) continue;
    return {
      entryCount: tail.readUInt16LE(offset + 10),
      centralBytes: tail.readUInt32LE(offset + 12),
      centralOffset: tail.readUInt32LE(offset + 16),
      absoluteOffset: tailOffset + offset,
    };
  }
  throw new Error('ZIP end-of-central-directory record was not found');
}

function parseCentralDirectory(bytes, expectedEntries) {
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    assert(
      bytes.readUInt32LE(offset) === 0x02014b50,
      `Invalid central-directory signature at ${offset}`,
    );
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc32 = bytes.readUInt32LE(offset + 16);
    const compressedBytes = bytes.readUInt32LE(offset + 20);
    const uncompressedBytes = bytes.readUInt32LE(offset + 24);
    const nameBytes = bytes.readUInt16LE(offset + 28);
    const extraBytes = bytes.readUInt16LE(offset + 30);
    const commentBytes = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8');
    entries.push({
      name,
      flags,
      method,
      crc32,
      compressedBytes,
      uncompressedBytes,
      localOffset,
    });
    offset += 46 + nameBytes + extraBytes + commentBytes;
  }
  assert(offset === bytes.length, 'Central-directory size does not end on an entry boundary');
  assert(
    entries.length === expectedEntries,
    `Expected ${expectedEntries} ZIP entries, found ${entries.length}`,
  );
  return entries;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function extractEntry(entry) {
  assert((entry.flags & 1) === 0, `${entry.name} is encrypted`);
  assert(
    entry.method === 0 || entry.method === 8,
    `${entry.name} uses unsupported ZIP method ${entry.method}`,
  );
  const localHeader = await fetchRange(entry.localOffset, entry.localOffset + 29);
  assert(localHeader.readUInt32LE(0) === 0x04034b50, `${entry.name} has an invalid local header`);
  const nameBytes = localHeader.readUInt16LE(26);
  const extraBytes = localHeader.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameBytes + extraBytes;
  const compressed = await fetchRange(dataStart, dataStart + entry.compressedBytes - 1);
  const uncompressed = entry.method === 8 ? inflateRawSync(compressed) : compressed;
  assert(
    uncompressed.length === entry.uncompressedBytes,
    `${entry.name} expected ${entry.uncompressedBytes} bytes, received ${uncompressed.length}`,
  );
  assert(crc32(uncompressed) === entry.crc32, `${entry.name} failed its ZIP CRC-32 check`);
  return uncompressed;
}

const tailBytes = Math.min(65_557, source.archiveBytes);
const tailOffset = source.archiveBytes - tailBytes;
const tail = await fetchRange(tailOffset, source.archiveBytes - 1);
const end = findEndOfCentralDirectory(tail, tailOffset);
assert(
  end.centralOffset + end.centralBytes === end.absoluteOffset,
  'ZIP central directory is not contiguous with its end record',
);
const central = await fetchRange(end.centralOffset, end.centralOffset + end.centralBytes - 1);
const selected = parseCentralDirectory(central, end.entryCount)
  .filter((entry) => selectedName.test(entry.name))
  .sort((left, right) => left.name.localeCompare(right.name));
assert(
  selected.length === 24,
  `Expected 24 young comfortable-overground angle records, found ${selected.length}`,
);

await mkdir(outputDirectory, { recursive: true });
const manifestEntries = [];
for (const entry of selected) {
  const bytes = await extractEntry(entry);
  await writeFile(resolve(outputDirectory, entry.name), bytes);
  manifestEntries.push({
    name: entry.name,
    archiveOffset: entry.localOffset,
    compressedBytes: entry.compressedBytes,
    uncompressedBytes: entry.uncompressedBytes,
    crc32: entry.crc32.toString(16).padStart(8, '0'),
  });
  process.stderr.write(`verified ${entry.name}\n`);
}

const manifest = {
  schemaVersion: 1,
  source,
  retrieval: {
    method: 'HTTP byte ranges over the source ZIP; selected entries only',
    archiveStructure: {
      entries: end.entryCount,
      centralOffset: end.centralOffset,
      centralBytes: end.centralBytes,
    },
    selection: {
      population: 'young adults (subjects 01-24)',
      condition: 'overground, self-selected comfortable speed',
      signal: 'processed time-normalized pelvis and lower-extremity angles',
      filenamePattern: selectedName.source,
    },
  },
  entries: manifestEntries,
};
await writeFile(
  resolve(outputDirectory, 'provenance.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(`${outputDirectory}\n`);
