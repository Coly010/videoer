import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface TextOverlayLine {
  text: string;
  y: number;
  fontSize: number;
  color: string;
  borderWidth?: number;
  borderColor?: string;
}

export interface TextOverlayDesign {
  width: number;
  height: number;
  fontPath: string;
  lines: TextOverlayLine[];
}

function escapeDrawtext(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", '’').replaceAll(':', '\\:');
}

/** Deterministic transparent editorial overlay; copy and layout stay campaign data. */
export async function renderTextOverlay(design: TextOverlayDesign, outputPath: string) {
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  const font = escapeDrawtext(resolve(design.fontPath));
  const filters = design.lines
    .map(
      (line) =>
        `drawtext=fontfile='${font}':text='${escapeDrawtext(line.text)}':` +
        `fontcolor=${line.color}:fontsize=${line.fontSize}:x=(w-text_w)/2:y=${line.y}:` +
        `borderw=${line.borderWidth ?? 0}:bordercolor=${line.borderColor ?? 'black@0.0'}`,
    )
    .join(',');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${design.width}x${design.height}:d=1,format=rgba`,
    '-vf',
    filters,
    '-frames:v',
    '1',
    '-c:v',
    'png',
    '-y',
    output,
  ]);
  return output;
}
