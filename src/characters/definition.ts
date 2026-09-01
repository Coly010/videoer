import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { humanoidParametersSchema } from './mannequin.js';

const colorSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const characterDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^character\.[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  title: z.string().min(1),
  description: z.string().min(1),
  body: humanoidParametersSchema.default({
    height: 1.72,
    shoulderWidth: 0.42,
    hipWidth: 0.32,
    torsoLength: 0.49,
    chestDepth: 0.22,
    armLength: 0.62,
    legLength: 0.88,
    headScale: 1,
    handScale: 1,
    footScale: 1,
  }),
  appearance: z.object({
    skin: colorSchema.default([0.58, 0.34, 0.24, 1]),
    hair: colorSchema.default([0.025, 0.012, 0.009, 1]),
    eyes: colorSchema.default([0.055, 0.12, 0.11, 1]),
    dress: colorSchema.default([0.018, 0.025, 0.045, 1]),
    leather: colorSchema.default([0.025, 0.02, 0.018, 1]),
  }),
  hair: z
    .object({ style: z.enum(['long-pulled-back']).default('long-pulled-back') })
    .default({ style: 'long-pulled-back' }),
  wardrobe: z
    .object({ preset: z.enum(['long-dark-dress']).default('long-dark-dress') })
    .default({ preset: 'long-dark-dress' }),
  references: z.array(z.string()).default([]),
});

export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;

export async function loadCharacterDefinition(path: string) {
  return characterDefinitionSchema.parse(YAML.parse(await readFile(resolve(path), 'utf8')));
}
