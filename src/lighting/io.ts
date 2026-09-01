import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { lightingRigSchema, type LightingRig } from './model.js';

export async function loadLightingRig(path: string) {
  return lightingRigSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveLightingRig(path: string, rig: LightingRig) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(lightingRigSchema.parse(rig), null, 2)}\n`, 'utf8');
  return output;
}
