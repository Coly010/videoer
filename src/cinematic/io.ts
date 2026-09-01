import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cinematicSceneSchema, type CinematicScene } from './model.js';

export async function loadCinematicScene(path: string) {
  return cinematicSceneSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveCinematicScene(path: string, scene: CinematicScene) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(cinematicSceneSchema.parse(scene), null, 2)}\n`,
    'utf8',
  );
  return output;
}
