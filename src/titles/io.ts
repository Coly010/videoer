import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { titleTreatmentSchema, type TitleTreatment } from './model.js';

export async function loadTitleTreatment(path: string) {
  return titleTreatmentSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function saveTitleTreatment(path: string, treatment: TitleTreatment) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(titleTreatmentSchema.parse(treatment), null, 2)}\n`,
    'utf8',
  );
  return output;
}
