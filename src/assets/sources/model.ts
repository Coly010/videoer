import { z } from 'zod';

export const sourceSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((part) => part === '' || part === '.' || part === '..'),
    'source artifact path must be a normalized relative path',
  );

export const materialChannelSemanticSchema = z.enum([
  'base-color',
  'normal',
  'roughness',
  'metallic',
  'ambient-occlusion',
  'displacement',
  'opacity',
]);

export const materialTextureChannelSchema = z.object({
  semantic: materialChannelSemanticSchema,
  providerName: z.string().min(1),
  path: relativeArtifactPathSchema,
  mediaType: z.string().min(1),
  sha256: sourceSha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  colorSpace: z.enum(['srgb-texture', 'non-color']),
  normalConvention: z.enum(['opengl-positive-green']).optional(),
});

export const materialPhysicalScaleSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('known'),
    widthMeters: z.number().positive(),
    heightMeters: z.number().positive(),
    source: z.string().min(1),
  }),
  z.object({
    status: z.literal('unknown'),
    reason: z.string().min(1),
  }),
]);

const archiveInventoryEntrySchema = z.object({
  name: z.string().min(1),
  compressedSizeBytes: z.number().int().nonnegative(),
  expandedSizeBytes: z.number().int().nonnegative(),
  compressionMethod: z.number().int().nonnegative(),
  selected: z.boolean(),
  sha256: sourceSha256Schema.optional(),
});

export const openMaterialSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceIdentitySha256: sourceSha256Schema,
    provider: z.enum(['ambientcg', 'poly-haven']),
    adapterVersion: z.string().min(1),
    providerApi: z.object({
      version: z.string().min(1),
      requestUrl: z.string().url(),
      responsePath: relativeArtifactPathSchema,
      responseSha256: sourceSha256Schema,
      retrievedAt: z.string().datetime(),
    }),
    asset: z.object({
      id: z.string().min(1),
      type: z.literal('material'),
      title: z.string().min(1),
      pageUrl: z.string().url(),
      releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      technique: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)),
    }),
    licence: z.object({
      spdx: z.literal('CC0-1.0'),
      name: z.literal('Creative Commons CC0 1.0 Universal'),
      url: z.string().url(),
      commercialUse: z.literal('allowed'),
      attributionRequired: z.literal(false),
      evidencePath: relativeArtifactPathSchema,
      evidenceSha256: sourceSha256Schema,
    }),
    selection: z.object({
      resolution: z.string().regex(/^\d+K$/),
      encoding: z.enum(['JPG', 'PNG']),
      archiveUrl: z.string().url(),
      declaredSizeBytes: z.number().int().positive(),
    }),
    sourceArchive: z.object({
      path: relativeArtifactPathSchema,
      sha256: sourceSha256Schema,
      sizeBytes: z.number().int().positive(),
      inventory: z.array(archiveInventoryEntrySchema).min(1),
    }),
    physicalScale: materialPhysicalScaleSchema,
    channels: z.array(materialTextureChannelSchema).min(3),
  })
  .superRefine((manifest, ctx) => {
    const semantics = manifest.channels.map((channel) => channel.semantic);
    if (new Set(semantics).size !== semantics.length)
      ctx.addIssue({
        code: 'custom',
        path: ['channels'],
        message: 'material channels must be unique',
      });
    for (const required of ['base-color', 'normal', 'roughness'] as const)
      if (!semantics.includes(required))
        ctx.addIssue({
          code: 'custom',
          path: ['channels'],
          message: `material source requires ${required}`,
        });
    for (const channel of manifest.channels) {
      const expected = channel.semantic === 'base-color' ? 'srgb-texture' : 'non-color';
      if (channel.colorSpace !== expected)
        ctx.addIssue({
          code: 'custom',
          path: ['channels'],
          message: `${channel.semantic} must use ${expected}`,
        });
      if (channel.semantic === 'normal' && channel.normalConvention !== 'opengl-positive-green')
        ctx.addIssue({
          code: 'custom',
          path: ['channels'],
          message: 'normal channel requires the canonical OpenGL convention',
        });
    }
  });

export type OpenMaterialSourceManifest = z.infer<typeof openMaterialSourceManifestSchema>;
export type MaterialTextureChannel = z.infer<typeof materialTextureChannelSchema>;

export const openMaterialSourceImportRequestSchema = z
  .object({
    provider: z.literal('ambientcg'),
    assetId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/i),
    resolution: z.custom<`${number}K`>(
      (value) => typeof value === 'string' && /^\d+K$/.test(value),
      'resolution must use the canonical form such as 1K or 2K',
    ),
    encoding: z.enum(['JPG', 'PNG']),
    cacheDirectory: z.string().min(1),
    outputDirectory: z.string().min(1),
    mode: z.enum(['online', 'offline']),
    refresh: z.boolean(),
    expectedSourceIdentitySha256: sourceSha256Schema.optional(),
  })
  .superRefine((request, ctx) => {
    if (request.mode === 'offline' && !request.expectedSourceIdentitySha256)
      ctx.addIssue({
        code: 'custom',
        path: ['expectedSourceIdentitySha256'],
        message: 'offline material imports require an exact source identity',
      });
    if (request.mode === 'offline' && request.refresh)
      ctx.addIssue({
        code: 'custom',
        path: ['refresh'],
        message: 'source refresh requires online mode',
      });
  });

export type OpenMaterialSourceImportRequest = z.infer<
  typeof openMaterialSourceImportRequestSchema
>;

export const ambientCgApiResponseSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  assets: z.array(
    z.object({
      id: z.string().min(1),
      type: z.literal('material'),
      releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      title: z.string().min(1),
      url: z.string().url(),
      tags: z.array(z.string().min(1)).default([]),
      dimensions: z.object({
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        depth: z.number().nonnegative(),
      }),
      maps: z.array(z.string().min(1)),
      technique: z.string().min(1).optional(),
      downloads: z.array(
        z.object({
          attributes: z.string().min(1),
          extension: z.string().min(1),
          url: z.string().url(),
          size: z.number().int().positive(),
        }),
      ),
    }),
  ),
});
