import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { soundtrackPlanSchema, type SoundtrackPlan } from './model.js';

export async function loadSoundtrackPlan(path: string) {
  return soundtrackPlanSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveSoundtrackPlan(path: string, plan: SoundtrackPlan) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(soundtrackPlanSchema.parse(plan), null, 2)}\n`, 'utf8');
  return output;
}
