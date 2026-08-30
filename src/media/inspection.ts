import { readFile, stat } from 'node:fs/promises';
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
  const rows = Math.ceil(inputs.length / columns);
  return [
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    `xstack=inputs=${inputs.length}:grid=${columns}x${rows}:fill=black`,
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
