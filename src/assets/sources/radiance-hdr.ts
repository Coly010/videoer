import {
  requireRec709Chromaticities,
  type EnvironmentRadianceChromaticities,
  type EnvironmentRadianceColorSpaceEvidence,
} from './openexr.js';

export interface RadianceHdrInspection {
  widthPixels: number;
  heightPixels: number;
  orientation: '-Y +X';
  minimumPositiveRadiance: number;
  maximumRadiance: number;
  dynamicRangeRatio: number;
  colorSpace: EnvironmentRadianceColorSpaceEvidence;
}

function parseColorSpace(lines: string[]): EnvironmentRadianceColorSpaceEvidence {
  const primaries = lines.filter((line) => line.startsWith('PRIMARIES='));
  if (primaries.length !== 1)
    throw new Error(
      primaries.length === 0
        ? 'Radiance HDR has no PRIMARIES header; the Radiance default is not Rec.709'
        : 'Radiance HDR requires exactly one PRIMARIES header',
    );
  const values = primaries[0]!.slice('PRIMARIES='.length).trim().split(/\s+/u).map(Number);
  if (values.length !== 8 || values.some((value) => !Number.isFinite(value)))
    throw new Error('Radiance HDR PRIMARIES must contain exactly eight finite values');
  const chromaticities: EnvironmentRadianceChromaticities = {
    red: [values[0]!, values[1]!],
    green: [values[2]!, values[3]!],
    blue: [values[4]!, values[5]!],
    white: [values[6]!, values[7]!],
  };
  requireRec709Chromaticities(chromaticities, 'Radiance HDR source');
  return {
    name: 'scene-linear-rec709',
    transfer: 'linear',
    chromaticities,
    evidence: {
      mode: 'radiance-header-rec709',
      standard: 'Radiance File Formats',
      url: 'https://floyd.lbl.gov/radiance/refer/filefmts.pdf',
    },
  };
}

export interface RadianceHdrLimits {
  maximumHeaderBytes: number;
  maximumPixels: number;
}

const defaultLimits: RadianceHdrLimits = {
  maximumHeaderBytes: 64 * 1024,
  maximumPixels: 134_217_728,
};

function headerEnd(bytes: Uint8Array, maximum: number) {
  const boundary = Math.min(bytes.byteLength - 1, maximum);
  for (let index = 0; index < boundary; index++)
    if (bytes[index] === 0x0a && bytes[index + 1] === 0x0a) return index + 2;
  throw new Error(`Radiance HDR header is missing its terminator within ${maximum} bytes`);
}

function decodeScanline(bytes: Uint8Array, offset: number, width: number, destination: Uint8Array) {
  if (offset + 4 > bytes.byteLength) throw new Error('Radiance HDR has a truncated scanline');
  if (
    width < 8 ||
    width > 0x7fff ||
    bytes[offset] !== 2 ||
    bytes[offset + 1] !== 2 ||
    (bytes[offset + 2]! & 0x80) !== 0
  ) {
    const end = offset + width * 4;
    if (end > bytes.byteLength) throw new Error('Radiance HDR has truncated RGBE pixels');
    destination.set(bytes.subarray(offset, end));
    return end;
  }
  const encodedWidth = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
  if (encodedWidth !== width)
    throw new Error(`Radiance HDR scanline width ${encodedWidth} does not match ${width}`);
  offset += 4;
  for (let channel = 0; channel < 4; channel++) {
    let pixel = 0;
    while (pixel < width) {
      if (offset >= bytes.byteLength) throw new Error('Radiance HDR has truncated RLE data');
      const code = bytes[offset++]!;
      if (code > 128) {
        const count = code - 128;
        if (count === 0 || pixel + count > width || offset >= bytes.byteLength)
          throw new Error('Radiance HDR has an invalid RLE run');
        const value = bytes[offset++]!;
        for (let index = 0; index < count; index++) destination[pixel++ * 4 + channel] = value;
      } else {
        const count = code;
        if (count === 0 || pixel + count > width || offset + count > bytes.byteLength)
          throw new Error('Radiance HDR has an invalid RLE literal');
        for (let index = 0; index < count; index++)
          destination[pixel++ * 4 + channel] = bytes[offset++]!;
      }
    }
  }
  return offset;
}

export function inspectRadianceHdr(
  bytes: Uint8Array,
  limits: RadianceHdrLimits = defaultLimits,
): RadianceHdrInspection {
  if (bytes.byteLength < 32) throw new Error('Radiance HDR source is too small');
  const end = headerEnd(bytes, limits.maximumHeaderBytes);
  let header: string;
  try {
    header = new TextDecoder('ascii', { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    throw new Error('Radiance HDR header is not ASCII');
  }
  const lines = header.trimEnd().split(/\r?\n/u);
  if (lines[0] !== '#?RADIANCE' && lines[0] !== '#?RGBE')
    throw new Error('Radiance HDR signature is missing');
  const formats = lines.filter((line) => line.startsWith('FORMAT='));
  if (formats.length !== 1 || formats[0] !== 'FORMAT=32-bit_rle_rgbe')
    throw new Error('Radiance HDR requires exactly FORMAT=32-bit_rle_rgbe');
  const colorSpace = parseColorSpace(lines);

  const newline = bytes.indexOf(0x0a, end);
  if (newline < 0 || newline - end > 128)
    throw new Error('Radiance HDR resolution line is missing or too long');
  const resolution = new TextDecoder('ascii').decode(bytes.subarray(end, newline)).trim();
  const match = /^-Y (\d+) \+X (\d+)$/u.exec(resolution);
  if (!match) throw new Error('Radiance HDR requires canonical -Y height +X width orientation');
  const heightPixels = Number(match[1]);
  const widthPixels = Number(match[2]);
  if (!Number.isSafeInteger(widthPixels) || !Number.isSafeInteger(heightPixels))
    throw new Error('Radiance HDR dimensions are not safe integers');
  if (widthPixels <= 0 || heightPixels <= 0 || widthPixels !== heightPixels * 2)
    throw new Error('Radiance HDR equirectangular dimensions must have an exact 2:1 aspect ratio');
  const pixelCount = widthPixels * heightPixels;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > limits.maximumPixels)
    throw new Error(`Radiance HDR pixel count exceeds ${limits.maximumPixels}`);

  let offset = newline + 1;
  let minimumPositiveRadiance = Number.POSITIVE_INFINITY;
  let maximumRadiance = 0;
  const scanline = new Uint8Array(widthPixels * 4);
  for (let row = 0; row < heightPixels; row++) {
    offset = decodeScanline(bytes, offset, widthPixels, scanline);
    for (let column = 0; column < widthPixels; column++) {
      const pixelOffset = column * 4;
      const exponent = scanline[pixelOffset + 3]!;
      if (exponent === 0) continue;
      const scale = 2 ** (exponent - 136);
      const radiance =
        (0.2126 * scanline[pixelOffset]! +
          0.7152 * scanline[pixelOffset + 1]! +
          0.0722 * scanline[pixelOffset + 2]!) *
        scale;
      if (!Number.isFinite(radiance)) throw new Error('Radiance HDR contains non-finite radiance');
      if (radiance > 0) {
        minimumPositiveRadiance = Math.min(minimumPositiveRadiance, radiance);
        maximumRadiance = Math.max(maximumRadiance, radiance);
      }
    }
  }
  if (offset !== bytes.byteLength) throw new Error('Radiance HDR contains trailing pixel data');
  if (!Number.isFinite(minimumPositiveRadiance) || maximumRadiance <= 0)
    throw new Error('Radiance HDR contains no nonzero radiance');
  const dynamicRangeRatio = maximumRadiance / minimumPositiveRadiance;
  if (!Number.isFinite(dynamicRangeRatio) || dynamicRangeRatio <= 1)
    throw new Error('Radiance HDR does not contain measurable dynamic range greater than 1');
  return {
    widthPixels,
    heightPixels,
    orientation: '-Y +X',
    minimumPositiveRadiance,
    maximumRadiance,
    dynamicRangeRatio,
    colorSpace,
  };
}
