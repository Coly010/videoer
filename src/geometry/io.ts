import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { geometryAssetSchema, type GeometryAsset } from './model.js';

export async function loadGeometry(path: string) {
  return geometryAssetSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveGeometry(path: string, geometry: GeometryAsset) {
  const absolute = resolve(path);
  const valid = geometryAssetSchema.parse(geometry);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(valid, null, 2)}\n`, 'utf8');
  return absolute;
}
