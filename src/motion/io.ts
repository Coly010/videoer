import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { motionClipSchema, type MotionClip } from './model.js';

export async function loadMotionClip(path: string) {
  return motionClipSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveMotionClip(path: string, clip: MotionClip) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(motionClipSchema.parse(clip), null, 2)}\n`, 'utf8');
  return absolute;
}
