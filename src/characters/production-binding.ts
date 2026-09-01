import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { sha256File } from '../assets/library.js';
import { assetReferenceSchema } from '../production/model.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const localIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine((path) => !isAbsolute(path), 'production-character artifact paths must be relative');

const componentSchema = z.object({
  asset: assetReferenceSchema,
  artifactRole: z.enum(['geometry', 'material']),
  path: relativeArtifactPathSchema,
  sha256: sha256Schema,
});

const rigProfileComponentSchema = z.object({
  id: z.string().regex(/^rig-profile\.[a-z][a-z0-9-]*$/u),
  version: assetReferenceSchema.shape.version,
  path: relativeArtifactPathSchema,
  sha256: sha256Schema,
});

const productionCharacterBindingSourceShape = {
  schemaVersion: z.literal(1),
  id: z.string().regex(/^character-binding\.[a-z][a-z0-9-]*$/u),
  character: assetReferenceSchema,
  body: componentSchema.extend({ artifactRole: z.literal('geometry') }),
  rigProfile: rigProfileComponentSchema,
  materialBindings: z
    .array(
      z.object({
        targetMaterialId: localIdSchema,
        material: componentSchema.extend({ artifactRole: z.literal('material') }),
      }),
    )
    .default([]),
  hair: componentSchema
    .extend({
      artifactRole: z.literal('geometry'),
      binding: z.literal('canonical-head-v1'),
    })
    .optional(),
  wardrobe: z
    .array(
      componentSchema.extend({
        artifactRole: z.literal('geometry'),
        binding: z.literal('full-rig-weight-transfer-v1'),
      }),
    )
    .default([]),
  compatibility: z.object({
    canonicalSkeleton: z.literal('videoer.canonical-humanoid-52'),
    bodyTopology: z.string().min(1),
  }),
  qualityTier: z.enum(['background', 'medium', 'hero', 'close-up']),
};

type BindingSourceShape = z.infer<z.ZodObject<typeof productionCharacterBindingSourceShape>>;

function refineBindingSource(binding: BindingSourceShape, context: z.RefinementCtx) {
  if (!binding.character.id.startsWith('character.'))
    context.addIssue({
      code: 'custom',
      path: ['character', 'id'],
      message: 'production-character identity must reference a character asset',
    });
  if (!binding.body.asset.id.startsWith('character.'))
    context.addIssue({
      code: 'custom',
      path: ['body', 'asset', 'id'],
      message: 'production-character body must reference a character asset',
    });
  if (binding.hair && !binding.hair.asset.id.startsWith('hair.'))
    context.addIssue({
      code: 'custom',
      path: ['hair', 'asset', 'id'],
      message: 'production-character hair must reference a hair asset',
    });
  binding.wardrobe.forEach((garment, index) => {
    if (!garment.asset.id.startsWith('clothing.'))
      context.addIssue({
        code: 'custom',
        path: ['wardrobe', index, 'asset', 'id'],
        message: 'production-character wardrobe must reference clothing assets',
      });
  });
  binding.materialBindings.forEach((material, index) => {
    if (!material.material.asset.id.startsWith('material.'))
      context.addIssue({
        code: 'custom',
        path: ['materialBindings', index, 'material', 'asset', 'id'],
        message: 'production-character material bindings must reference material assets',
      });
  });
  const targets = binding.materialBindings.map((item) => item.targetMaterialId);
  if (new Set(targets).size !== targets.length)
    context.addIssue({
      code: 'custom',
      path: ['materialBindings'],
      message: 'production-character material targets must be unique',
    });
  const garments = binding.wardrobe.map(
    (item) => `${item.asset.id}@${item.asset.version}:${item.artifactRole}`,
  );
  if (new Set(garments).size !== garments.length)
    context.addIssue({
      code: 'custom',
      path: ['wardrobe'],
      message: 'production-character wardrobe components must be unique',
    });
}

const productionCharacterBindingSourceSchema = z
  .object(productionCharacterBindingSourceShape)
  .superRefine(refineBindingSource);

export const productionCharacterBindingSchema = z
  .object({
    ...productionCharacterBindingSourceShape,
    derivation: z.object({
      kind: z.literal('production-character-assembly-v1'),
      generator: z.literal('videoer.production-character-binding.v1'),
      inputSha256: sha256Schema,
    }),
  })
  .superRefine(refineBindingSource);

export type ProductionCharacterBinding = z.infer<typeof productionCharacterBindingSchema>;
export type ProductionCharacterBindingSource = z.infer<
  typeof productionCharacterBindingSourceSchema
>;

function digestInputs(binding: ProductionCharacterBindingSource) {
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}

export function createProductionCharacterBinding(input: ProductionCharacterBindingSource) {
  const source = productionCharacterBindingSourceSchema.parse(input);
  return productionCharacterBindingSchema.parse({
    ...source,
    derivation: {
      kind: 'production-character-assembly-v1',
      generator: 'videoer.production-character-binding.v1',
      inputSha256: digestInputs(source),
    },
  });
}

function safeArtifactPath(bindingFile: string, artifactPath: string) {
  return resolve(dirname(resolve(bindingFile)), artifactPath);
}

export function productionCharacterBindingArtifacts(
  bindingFile: string,
  binding: ProductionCharacterBinding,
) {
  return [
    {
      role: 'body',
      path: safeArtifactPath(bindingFile, binding.body.path),
      sha256: binding.body.sha256,
    },
    {
      role: 'rig-profile',
      path: safeArtifactPath(bindingFile, binding.rigProfile.path),
      sha256: binding.rigProfile.sha256,
    },
    ...binding.materialBindings.map((item) => ({
      role: `material:${item.targetMaterialId}`,
      path: safeArtifactPath(bindingFile, item.material.path),
      sha256: item.material.sha256,
    })),
    ...(binding.hair
      ? [
          {
            role: 'hair',
            path: safeArtifactPath(bindingFile, binding.hair.path),
            sha256: binding.hair.sha256,
          },
        ]
      : []),
    ...binding.wardrobe.map((item, index) => ({
      role: `wardrobe:${index}:${item.asset.id}@${item.asset.version}`,
      path: safeArtifactPath(bindingFile, item.path),
      sha256: item.sha256,
    })),
  ];
}

export async function verifyProductionCharacterBinding(
  bindingFile: string,
  binding: ProductionCharacterBinding,
) {
  const { derivation, ...source } = binding;
  const issues: string[] = [];
  const expectedInputSha256 = digestInputs(source);
  if (derivation.inputSha256 !== expectedInputSha256)
    issues.push(
      `binding input digest mismatch: expected ${expectedInputSha256}, got ${derivation.inputSha256}`,
    );
  const artifacts = productionCharacterBindingArtifacts(bindingFile, binding);
  for (const artifact of artifacts) {
    let actual: string;
    try {
      actual = await sha256File(artifact.path);
    } catch (error) {
      issues.push(
        `${artifact.role} artifact cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (actual !== artifact.sha256)
      issues.push(
        `${artifact.role} artifact hash mismatch: expected ${artifact.sha256}, got ${actual}`,
      );
  }
  return {
    valid: issues.length === 0,
    issues,
    inputSha256: expectedInputSha256,
    artifacts,
  };
}

export async function loadProductionCharacterBinding(path: string) {
  const absolute = resolve(path);
  const binding = productionCharacterBindingSchema.parse(
    JSON.parse(await readFile(absolute, 'utf8')),
  );
  const verification = await verifyProductionCharacterBinding(absolute, binding);
  if (!verification.valid)
    throw new Error(
      `Invalid production-character binding ${absolute}: ${verification.issues.join('; ')}`,
    );
  return binding;
}

export async function saveProductionCharacterBinding(
  path: string,
  input: ProductionCharacterBindingSource,
) {
  const absolute = resolve(path);
  const binding = createProductionCharacterBinding(input);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  return absolute;
}
