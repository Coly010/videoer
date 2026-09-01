import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  aerosolVfxSchema,
  atmosphericVfxSchema,
  type AerosolVfx,
  type AtmosphericVfx,
} from './model.js';

export async function loadAtmosphericVfx(path: string) {
  return atmosphericVfxSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveAtmosphericVfx(path: string, vfx: AtmosphericVfx) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(atmosphericVfxSchema.parse(vfx), null, 2)}\n`, 'utf8');
  return output;
}

export async function loadAerosolVfx(path: string) {
  return aerosolVfxSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveAerosolVfx(path: string, vfx: AerosolVfx) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(aerosolVfxSchema.parse(vfx), null, 2)}\n`, 'utf8');
  return output;
}
