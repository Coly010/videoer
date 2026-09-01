import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

export interface ImageInspection {
  path: string;
  format: 'png' | 'jpeg' | 'unknown';
  width?: number;
  height?: number;
  bytes: number;
}
export async function inspectImage(path: string): Promise<ImageInspection> {
  const [buffer, info] = await Promise.all([readFile(path), stat(path)]);
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return {
      path,
      format: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: info.size,
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1]!;
      const length = buffer.readUInt16BE(offset + 2);
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        return {
          path,
          format: 'jpeg',
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          bytes: info.size,
        };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return { path, format: 'unknown', bytes: info.size };
}

export function contactSheetArgs(inputs: string[], output: string, columns = 3): string[] {
  if (!inputs.length) throw new Error('Contact sheet requires at least one input');
  if (inputs.length === 1) return ['-i', inputs[0]!, '-frames:v', '1', '-y', output];
  const actualColumns = Math.min(columns, inputs.length);
  const layout = inputs
    .map((_, index) => {
      const column = index % actualColumns;
      const row = Math.floor(index / actualColumns);
      const x = column === 0 ? '0' : Array.from({ length: column }, (_, i) => `w${i}`).join('+');
      const y =
        row === 0 ? '0' : Array.from({ length: row }, (_, i) => `h${i * actualColumns}`).join('+');
      return `${x}_${y}`;
    })
    .join('|');
  return [
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    `xstack=inputs=${inputs.length}:layout=${layout}:fill=black`,
    '-frames:v',
    '1',
    '-y',
    output,
  ];
}

export async function inspectVideo(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path];
    const child = spawn('ffprobe', args);
    let out = '';
    let error = '';
    child.stdout.on('data', (data) => {
      out += String(data);
    });
    child.stderr.on('data', (data) => {
      error += String(data);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(JSON.parse(out) as Record<string, unknown>)
        : reject(new Error(`ffprobe failed (${code}): ${error}`)),
    );
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    let error = '';
    child.stderr.on('data', (data) => {
      error += String(data);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${error.trim()}`)),
    );
  });
}

export async function extractVideoFrame(video: string, seconds: number, output: string) {
  await mkdir(dirname(output), { recursive: true });
  await runFfmpeg([
    '-v',
    'error',
    '-ss',
    String(seconds),
    '-i',
    video,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    '-y',
    output,
  ]);
  return inspectImage(output);
}

export async function extractVideoFrameByIndex(
  video: string,
  zeroBasedFrameIndex: number,
  output: string,
) {
  if (!Number.isInteger(zeroBasedFrameIndex) || zeroBasedFrameIndex < 0)
    throw new Error('Video frame index must be a non-negative integer');
  await mkdir(dirname(output), { recursive: true });
  await runFfmpeg([
    '-v',
    'error',
    '-i',
    video,
    '-vf',
    `select=eq(n\\,${zeroBasedFrameIndex})`,
    '-frames:v',
    '1',
    '-fps_mode',
    'vfr',
    '-q:v',
    '2',
    '-y',
    output,
  ]);
  return inspectImage(output);
}

export async function createContactSheet(inputs: string[], output: string, columns = 3) {
  await mkdir(dirname(output), { recursive: true });
  await runFfmpeg(['-v', 'error', ...contactSheetArgs(inputs, output, columns)]);
  return inspectImage(output);
}

export async function inspectBlackPixelPercentage(path: string, threshold = 32) {
  return inspectPixelPercentage(path, `blackframe=amount=0:threshold=${threshold}`, 'black');
}

export async function inspectWhitePixelPercentage(path: string, threshold = 245) {
  return inspectPixelPercentage(
    path,
    `negate,blackframe=amount=0:threshold=${Math.max(32, 255 - threshold)}`,
    'white',
  );
}

export async function inspectWhitePixelPercentageInRegion(
  path: string,
  region: { x: number; y: number; width: number; height: number },
  threshold = 245,
) {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.max(1, Math.floor(region.width));
  const height = Math.max(1, Math.floor(region.height));
  return inspectPixelPercentage(
    path,
    `crop=${width}:${height}:${x}:${y},negate,blackframe=amount=0:threshold=${Math.max(32, 255 - threshold)}`,
    'white-region',
  );
}

export async function inspectBlackPixelPercentageInRegion(
  path: string,
  region: { x: number; y: number; width: number; height: number },
  threshold = 32,
) {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.max(1, Math.floor(region.width));
  const height = Math.max(1, Math.floor(region.height));
  return inspectPixelPercentage(
    path,
    `crop=${width}:${height}:${x}:${y},blackframe=amount=0:threshold=${threshold}`,
    'black-region',
  );
}

export async function inspectNormalizedColorEntropyInRegion(
  path: string,
  region: { x: number; y: number; width: number; height: number },
) {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.max(1, Math.floor(region.width));
  const height = Math.max(1, Math.floor(region.height));
  return new Promise<{ red: number; green: number; blue: number; mean: number }>(
    (resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-hide_banner',
        '-i',
        path,
        '-vf',
        `crop=${width}:${height}:${x}:${y},format=rgb24,entropy,metadata=print`,
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ]);
      let error = '';
      child.stderr.on('data', (data) => {
        error += String(data);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0)
          return reject(new Error(`ffmpeg color-entropy inspection failed: ${error}`));
        const channel = (name: 'R' | 'G' | 'B') => {
          const match = new RegExp(
            `lavfi\\.entropy\\.normalized_entropy\\.normal\\.${name}=([0-9.]+)`,
          ).exec(error);
          if (!match)
            throw new Error(`ffmpeg did not report normalized ${name} entropy for ${path}`);
          return Number(match[1]);
        };
        try {
          const red = channel('R');
          const green = channel('G');
          const blue = channel('B');
          resolve({ red, green, blue, mean: (red + green + blue) / 3 });
        } catch (inspectionError) {
          reject(inspectionError);
        }
      });
    },
  );
}

async function inspectPixelPercentage(path: string, filter: string, label: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner',
      '-i',
      path,
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ]);
    let error = '';
    child.stderr.on('data', (data) => {
      error += String(data);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${label}-pixel inspection failed: ${error}`));
      const match = /pblack:(\d+)/.exec(error);
      if (!match)
        return reject(new Error(`ffmpeg did not report ${label}-pixel coverage for ${path}`));
      resolve(Number(match[1]));
    });
  });
}
