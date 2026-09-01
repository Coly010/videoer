import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import YAML from 'yaml';
import { declarativeCinematicCampaignSchema } from './cinematic-campaign.js';

export async function loadDeclarativeCinematicCampaign(path: string) {
  const absolute = resolve(path);
  const source = await readFile(absolute, 'utf8');
  const parsed =
    extname(absolute).toLowerCase() === '.json' ? JSON.parse(source) : YAML.parse(source);
  return declarativeCinematicCampaignSchema.parse(parsed);
}
