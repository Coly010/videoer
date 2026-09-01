import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { editPlanSchema, type EditPlan } from './model.js';

export async function loadEditPlan(path: string) {
  return editPlanSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveEditPlan(path: string, plan: EditPlan) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(editPlanSchema.parse(plan), null, 2)}\n`, 'utf8');
  return output;
}
