import { readFile, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import { ZodError, type ZodType } from 'zod';
import { campaignSchema, storyboardSchema, type Campaign, type Storyboard } from './schemas.js';
export class ValidationError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid ${file}:\n${issues.map((x) => `  - ${x}`).join('\n')}`);
    this.name = 'ValidationError';
  }
}
function parse<T>(schema: ZodType<T>, value: unknown, file: string): T {
  try {
    return schema.parse(value);
  } catch (e) {
    if (e instanceof ZodError)
      throw new ValidationError(
        file,
        e.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
      );
    throw e;
  }
}
export async function loadCampaign(path: string): Promise<Campaign> {
  let value: unknown;
  try {
    value = YAML.parse(await readFile(path, 'utf8'));
  } catch (e) {
    throw new Error(
      `Could not read campaign ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parse(campaignSchema, value, path);
}
export async function loadStoryboard(path: string): Promise<Storyboard> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    throw new Error(
      `Could not read storyboard ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parse(storyboardSchema, value, path);
}
export async function saveStoryboard(path: string, value: Storyboard) {
  const valid = parse(storyboardSchema, value, path);
  await writeFile(path, JSON.stringify(valid, null, 2) + '\n', 'utf8');
}
