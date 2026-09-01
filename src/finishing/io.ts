import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cinematicFinishProfileSchema } from './model.js';

export async function loadCinematicFinishProfile(path: string) {
  return cinematicFinishProfileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function saveCinematicFinishProfile(path: string, profile: unknown) {
  const parsed = cinematicFinishProfileSchema.parse(profile);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return path;
}
