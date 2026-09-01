import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { practicalFixtureSchema, type PracticalFixture } from './model.js';

export async function loadPracticalFixture(path: string) {
  return practicalFixtureSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function savePracticalFixture(path: string, fixture: PracticalFixture) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(practicalFixtureSchema.parse(fixture), null, 2)}\n`,
    'utf8',
  );
  return output;
}
