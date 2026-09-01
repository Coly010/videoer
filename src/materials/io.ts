import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export async function loadSurfaceMaterial(path: string) {
  return surfaceMaterialSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveSurfaceMaterial(path: string, material: SurfaceMaterial) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(surfaceMaterialSchema.parse(material), null, 2)}\n`,
    'utf8',
  );
  return output;
}
