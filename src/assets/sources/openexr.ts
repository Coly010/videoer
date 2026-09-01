import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface OpenExrChannelEvidence {
  name: 'R' | 'G' | 'B' | 'A';
  sampleType: 'half' | 'float';
  xSampling: 1;
  ySampling: 1;
}

export interface OpenExrInspection {
  widthPixels: number;
  heightPixels: number;
  storage: 'single-part-scanline';
  channels: OpenExrChannelEvidence[];
  dataWindow: [number, number, number, number];
  displayWindow: [number, number, number, number];
  colorSpace: EnvironmentRadianceColorSpaceEvidence;
  inspector: {
    tool: 'exrinfo';
    version: string;
    licenceSpdx: 'BSD-3-Clause';
    commandArguments: ['-v', '-s'];
    output: string;
  };
}

export interface EnvironmentRadianceChromaticities {
  red: [number, number];
  green: [number, number];
  blue: [number, number];
  white: [number, number];
}

export interface EnvironmentRadianceColorSpaceEvidence {
  name: 'scene-linear-rec709';
  transfer: 'linear';
  chromaticities: EnvironmentRadianceChromaticities;
  evidence:
    | {
        mode: 'openexr-default-rec709';
        standard: 'OpenEXR Technical Introduction 3.4';
        url: 'https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color';
      }
    | {
        mode: 'openexr-embedded-rec709';
        standard: 'OpenEXR chromaticities attribute';
        url: 'https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color';
      }
    | {
        mode: 'radiance-header-rec709';
        standard: 'Radiance File Formats';
        url: 'https://floyd.lbl.gov/radiance/refer/filefmts.pdf';
      };
}

export const rec709Chromaticities: EnvironmentRadianceChromaticities = {
  red: [0.64, 0.33],
  green: [0.3, 0.6],
  blue: [0.15, 0.06],
  white: [0.3127, 0.329],
};

function nearlyEqual(first: number, second: number) {
  return Math.abs(first - second) <= 0.0001;
}

export function requireRec709Chromaticities(
  chromaticities: EnvironmentRadianceChromaticities,
  source: string,
) {
  for (const key of ['red', 'green', 'blue', 'white'] as const)
    for (let index = 0; index < 2; index++)
      if (!nearlyEqual(chromaticities[key][index]!, rec709Chromaticities[key][index]!))
        throw new Error(`${source} uses unsupported non-Rec.709 chromaticities`);
  return chromaticities;
}

function parseChromaticities(output: string): EnvironmentRadianceColorSpaceEvidence {
  const start = /^ {2}chromaticities: chromaticities\b.*$/mu.exec(output);
  if (!start)
    return {
      name: 'scene-linear-rec709',
      transfer: 'linear',
      chromaticities: rec709Chromaticities,
      evidence: {
        mode: 'openexr-default-rec709',
        standard: 'OpenEXR Technical Introduction 3.4',
        url: 'https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color',
      },
    };
  const lines = output.slice(start.index).split(/\r?\n/u);
  const evidenceLines = [lines[0]!];
  for (const line of lines.slice(1)) {
    if (/^ {2}\S/u.test(line)) break;
    evidenceLines.push(line);
  }
  const evidence = evidenceLines.join('\n');
  const hasLongNames =
    /\bred\b/iu.test(evidence) &&
    /\bgreen\b/iu.test(evidence) &&
    /\bblue\b/iu.test(evidence) &&
    /\bwhite\b/iu.test(evidence);
  const hasExrInfoNames =
    /\br\[/u.test(evidence) &&
    /\bg\[/u.test(evidence) &&
    /\bb\[/u.test(evidence) &&
    /\bw\[/u.test(evidence);
  if (!hasLongNames && !hasExrInfoNames)
    throw new Error('OpenEXR chromaticities evidence is malformed');
  const values = Array.from(
    evidence.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu),
    (match) => Number(match[0]),
  );
  if (values.length !== 8 || values.some((value) => !Number.isFinite(value)))
    throw new Error('OpenEXR chromaticities evidence must contain exactly eight finite values');
  const chromaticities: EnvironmentRadianceChromaticities = {
    red: [values[0]!, values[1]!],
    green: [values[2]!, values[3]!],
    blue: [values[4]!, values[5]!],
    white: [values[6]!, values[7]!],
  };
  requireRec709Chromaticities(chromaticities, 'OpenEXR source');
  return {
    name: 'scene-linear-rec709',
    transfer: 'linear',
    chromaticities,
    evidence: {
      mode: 'openexr-embedded-rec709',
      standard: 'OpenEXR chromaticities attribute',
      url: 'https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color',
    },
  };
}

export interface OpenExrInspectorLimits {
  maximumOutputBytes: number;
  timeoutMilliseconds: number;
  maximumPixels: number;
}

const defaultLimits: OpenExrInspectorLimits = {
  maximumOutputBytes: 1_000_000,
  timeoutMilliseconds: 15_000,
  maximumPixels: 134_217_728,
};

export type OpenExrInspector = (
  bytes: Uint8Array,
  limits?: OpenExrInspectorLimits,
) => Promise<OpenExrInspection>;

function cString(value: string) {
  return Buffer.from(`${value}\0`, 'ascii');
}

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function int32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
}

function float32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatLE(value);
  return bytes;
}

function attribute(name: string, type: string, value: Uint8Array) {
  return Buffer.concat([cString(name), cString(type), uint32(value.byteLength), value]);
}

/** A project-owned 2x1, uncompressed, scene-linear RGB OpenEXR used only for doctor probing. */
export function openExrDoctorFixtureBytes() {
  const channel = (name: string) =>
    Buffer.concat([cString(name), int32(1), Buffer.from([0, 0, 0, 0]), int32(1), int32(1)]);
  const box = Buffer.concat([int32(0), int32(0), int32(1), int32(0)]);
  const chromaticities = Buffer.concat(
    [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329].map(float32),
  );
  const header = Buffer.concat([
    Buffer.from([0x76, 0x2f, 0x31, 0x01]),
    uint32(2),
    attribute(
      'channels',
      'chlist',
      Buffer.concat([channel('B'), channel('G'), channel('R'), Buffer.from([0])]),
    ),
    attribute('chromaticities', 'chromaticities', chromaticities),
    attribute('compression', 'compression', Buffer.from([0])),
    attribute('dataWindow', 'box2i', box),
    attribute('displayWindow', 'box2i', box),
    attribute('lineOrder', 'lineOrder', Buffer.from([0])),
    attribute('pixelAspectRatio', 'float', float32(1)),
    attribute('screenWindowCenter', 'v2f', Buffer.concat([float32(0), float32(0)])),
    attribute('screenWindowWidth', 'float', float32(1)),
    Buffer.from([0]),
  ]);
  const scanlineOffset = Buffer.alloc(8);
  scanlineOffset.writeBigUInt64LE(BigInt(header.byteLength + scanlineOffset.byteLength));
  const halfOne = Buffer.from([0x00, 0x3c]);
  const pixels = Buffer.concat(Array.from({ length: 6 }, () => halfOne));
  const scanline = Buffer.concat([int32(0), uint32(pixels.byteLength), pixels]);
  return new Uint8Array(Buffer.concat([header, scanlineOffset, scanline]));
}

function patchedOpenExrVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return false;
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  return (
    major > 3 ||
    (major === 3 && minor > 4) ||
    (major === 3 && minor === 4 && patch >= 14) ||
    (major === 3 && minor === 3 && patch >= 13) ||
    (major === 3 && minor === 2 && patch >= 11)
  );
}

export function parseOpenExrToolVersion(versionOutput: string) {
  const versionMatch = /^exrinfo \(OpenEXR\) (\d+\.\d+\.\d+)\b/mu.exec(versionOutput);
  const version = versionMatch?.[1];
  if (!version || !patchedOpenExrVersion(version))
    throw new Error(
      `OpenEXR exrinfo is missing a security-patched version: ${version ?? 'unknown'}`,
    );
  if (!/License BSD-3-Clause/mu.test(versionOutput))
    throw new Error('OpenEXR exrinfo did not report its expected BSD-3-Clause licence');
  return { tool: 'exrinfo' as const, version, licenceSpdx: 'BSD-3-Clause' as const };
}

function parseWindow(output: string, name: string) {
  const match = new RegExp(
    `^  ${name}: box2i \\[ (-?\\d+), (-?\\d+) - (-?\\d+) (-?\\d+) \\] (\\d+) x (\\d+)$`,
    'mu',
  ).exec(output);
  if (!match) throw new Error(`OpenEXR inspection is missing an exact ${name}`);
  const [, minXText, minYText, maxXText, maxYText, widthText, heightText] = match;
  const window = [minXText, minYText, maxXText, maxYText].map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const width = Number(widthText);
  const height = Number(heightText);
  if (window[2] - window[0] + 1 !== width || window[3] - window[1] + 1 !== height)
    throw new Error(`OpenEXR ${name} extents disagree with its dimensions`);
  return { window, width, height };
}

export function parseOpenExrInfo(verboseOutput: string, versionOutput: string): OpenExrInspection {
  const { version } = parseOpenExrToolVersion(versionOutput);
  const unsupportedColorMetadata =
    /^(?: {2})(colorInteropID|renderingTransform|lookModTransform):/mu.exec(verboseOutput);
  if (unsupportedColorMetadata)
    throw new Error(
      `OpenEXR source declares unsupported explicit colour transform metadata '${unsupportedColorMetadata[1]}'`,
    );
  const firstLine = verboseOutput.split(/\r?\n/u)[0] ?? '';
  if (!/^File .+: ver \d+ flags(?: shortnames)?$/u.test(firstLine))
    throw new Error('OpenEXR source must be an ordinary scanline image without tiled/deep flags');
  if (!/^ parts: 1$/mu.test(verboseOutput) || !/^ part 1: <single>$/mu.test(verboseOutput))
    throw new Error('OpenEXR source must contain exactly one non-multipart image part');

  const channelCountMatch = /^ {2}channels: chlist (\d+) channels$/mu.exec(verboseOutput);
  if (!channelCountMatch) throw new Error('OpenEXR inspection is missing its channel count');
  const channels: OpenExrChannelEvidence[] = [];
  const channelPattern = /^ {3}'([^']+)': (\w+) samp (\d+) (\d+)$/gmu;
  for (const match of verboseOutput.matchAll(channelPattern)) {
    const [, name, sampleType, xSampling, ySampling] = match;
    if (!['R', 'G', 'B', 'A'].includes(name!))
      throw new Error(`OpenEXR contains unsupported channel '${name}'`);
    if (sampleType !== 'half' && sampleType !== 'float')
      throw new Error(`OpenEXR channel '${name}' must use half or float samples`);
    if (xSampling !== '1' || ySampling !== '1')
      throw new Error(`OpenEXR channel '${name}' must use 1x1 sampling`);
    channels.push({
      name: name as OpenExrChannelEvidence['name'],
      sampleType,
      xSampling: 1,
      ySampling: 1,
    });
  }
  if (channels.length !== Number(channelCountMatch[1]))
    throw new Error('OpenEXR channel evidence does not match its declared channel count');
  const channelNames = channels
    .map((channel) => channel.name)
    .sort()
    .join('');
  if (channelNames !== 'BGR' && channelNames !== 'ABGR')
    throw new Error('OpenEXR environment source requires exactly RGB or RGBA channels');

  const data = parseWindow(verboseOutput, 'dataWindow');
  const display = parseWindow(verboseOutput, 'displayWindow');
  if (data.window.some((value, index) => value !== display.window[index]))
    throw new Error('OpenEXR dataWindow and displayWindow must match exactly');
  if (data.window[0] !== 0 || data.window[1] !== 0)
    throw new Error('OpenEXR environment source window must begin at 0,0');
  if (data.width !== data.height * 2)
    throw new Error('OpenEXR environment source must have an exact 2:1 aspect ratio');
  const pixelCount = data.width * data.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > defaultLimits.maximumPixels)
    throw new Error(`OpenEXR pixel count exceeds ${defaultLimits.maximumPixels}`);
  return {
    widthPixels: data.width,
    heightPixels: data.height,
    storage: 'single-part-scanline',
    channels,
    dataWindow: data.window,
    displayWindow: display.window,
    colorSpace: parseChromaticities(verboseOutput),
    inspector: {
      tool: 'exrinfo',
      version,
      licenceSpdx: 'BSD-3-Clause',
      commandArguments: ['-v', '-s'],
      output: verboseOutput,
    },
  };
}

export const inspectOpenExrWithTool: OpenExrInspector = async (bytes, limits = defaultLimits) => {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x76 ||
    bytes[1] !== 0x2f ||
    bytes[2] !== 0x31 ||
    bytes[3] !== 0x01
  )
    throw new Error('OpenEXR source has an invalid magic signature');
  const directory = await mkdtemp(join(tmpdir(), 'videoer-openexr-inspection-'));
  const path = join(directory, 'source.exr');
  try {
    await writeFile(path, bytes, { flag: 'wx' });
    const commandOptions = {
      encoding: 'utf8' as const,
      timeout: limits.timeoutMilliseconds,
      maxBuffer: limits.maximumOutputBytes,
    };
    const [{ stdout: versionOutput }, { stdout: verboseOutput }] = await Promise.all([
      exec('exrinfo', ['--version'], commandOptions),
      exec('exrinfo', ['-v', '-s', path], commandOptions),
    ]);
    const inspection = parseOpenExrInfo(verboseOutput, versionOutput);
    const pixelCount = inspection.widthPixels * inspection.heightPixels;
    if (pixelCount > limits.maximumPixels)
      throw new Error(`OpenEXR pixel count exceeds ${limits.maximumPixels}`);
    return inspection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('Required patched OpenEXR exrinfo binary is not installed');
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
