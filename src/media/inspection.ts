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
  const actualColumns = Math.min(columns, inputs.length);
  const layout = inputs.map((_, index) => {
    const column = index % actualColumns;
    const row = Math.floor(index / actualColumns);
    const x = column === 0 ? '0' : Array.from({ length: column }, (_, i) => `w${i}`).join('+');
    const y = row === 0 ? '0' : Array.from({ length: row }, (_, i) => `h${i * actualColumns}`).join('+');
    return `${x}_${y}`;
  }).join('|');
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
    child.stderr.on('data', (data) => { error += String(data); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${error.trim()}`)));
  });
}

export async function extractVideoFrame(video: string, seconds: number, output: string) {
  await mkdir(dirname(output), { recursive: true });
  await runFfmpeg(['-v', 'error', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-q:v', '2', '-y', output]);
  return inspectImage(output);
}

export async function createContactSheet(inputs: string[], output: string, columns = 3) {
  await mkdir(dirname(output), { recursive: true });
  await runFfmpeg(['-v', 'error', ...contactSheetArgs(inputs, output, columns)]);
  return inspectImage(output);
}
