import { z } from 'zod';

export const sourceSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/^[A-Za-z]:/u.test(value) &&
      !value.includes('\\') &&
      !value.split('/').some((part) => part === '' || part === '.' || part === '..'),
    'artifact path must be normalized and relative (a normalized relative path)',
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

const chromaticityPairSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const environmentRadianceColorSpaceSchema = z.object({
  name: z.literal('scene-linear-rec709'),
  transfer: z.literal('linear'),
  chromaticities: z.object({
    red: chromaticityPairSchema,
    green: chromaticityPairSchema,
    blue: chromaticityPairSchema,
    white: chromaticityPairSchema,
  }),
  evidence: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('openexr-default-rec709'),
      standard: z.literal('OpenEXR Technical Introduction 3.4'),
      url: z.literal('https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color'),
    }),
    z.object({
      mode: z.literal('openexr-embedded-rec709'),
      standard: z.literal('OpenEXR chromaticities attribute'),
      url: z.literal('https://openexr.com/en/latest/TechnicalIntroduction.html#rgb-color'),
    }),
    z.object({
      mode: z.literal('radiance-header-rec709'),
      standard: z.literal('Radiance File Formats'),
      url: z.literal('https://floyd.lbl.gov/radiance/refer/filefmts.pdf'),
    }),
  ]),
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

export const openEnvironmentRadianceSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceIdentitySha256: sourceSha256Schema,
    provider: z.enum(['ambientcg', 'poly-haven']),
    adapterVersion: z.string().min(1),
    providerApi: z.object({
      version: z.string().min(1),
      requestUrl: z.string().url(),
      finalUrl: z.string().url(),
      responsePath: relativeArtifactPathSchema,
      responseSha256: sourceSha256Schema,
      retrievedAt: z.string().datetime(),
    }),
    asset: z.object({
      id: z.string().min(1),
      type: z.literal('hdri'),
      title: z.string().min(1),
      pageUrl: z.string().url(),
      releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      technique: z.string().min(1),
      tags: z.array(z.string().min(1)),
    }),
    licence: z.object({
      spdx: z.literal('CC0-1.0'),
      name: z.literal('Creative Commons CC0 1.0 Universal'),
      url: z.string().url(),
      commercialUse: z.literal('allowed'),
      attributionRequired: z.literal(false),
      providerEvidence: z.object({
        requestedUrl: z.string().url(),
        finalUrl: z.string().url(),
        mediaType: z.literal('text/html'),
        path: relativeArtifactPathSchema,
        sha256: sourceSha256Schema,
        sizeBytes: z.number().int().positive(),
        retrievedAt: z.string().datetime(),
      }),
      adapterAssessment: z.object({
        path: relativeArtifactPathSchema,
        sha256: sourceSha256Schema,
        kind: z.literal('videoer-reviewed-provider-licence-assessment-v1'),
      }),
    }),
    selection: z.object({
      resolution: z.string().regex(/^\d+K$/),
      encoding: z.enum(['HDR', 'EXR']),
      archiveUrl: z.string().url(),
      archiveFinalUrl: z.string().url(),
      declaredSizeBytes: z.number().int().positive(),
    }),
    sourceArchive: z.object({
      path: relativeArtifactPathSchema,
      sha256: sourceSha256Schema,
      sizeBytes: z.number().int().positive(),
      inventory: z.array(archiveInventoryEntrySchema).min(1),
    }),
    radiance: z.discriminatedUnion('encoding', [
      z.object({
        path: relativeArtifactPathSchema,
        archiveEntry: relativeArtifactPathSchema,
        mediaType: z.literal('image/vnd.radiance'),
        sha256: sourceSha256Schema,
        sizeBytes: z.number().int().positive(),
        encoding: z.literal('radiance-rgbe'),
        projection: z.literal('equirectangular-latlong'),
        orientation: z.literal('-Y +X'),
        widthPixels: z.number().int().positive(),
        heightPixels: z.number().int().positive(),
        colorSpace: environmentRadianceColorSpaceSchema,
        pixelRange: z.object({
          method: z.literal('decoded-rgbe-luminance'),
          minimumPositiveRadiance: z.number().positive().finite(),
          maximumRadiance: z.number().positive().finite(),
          dynamicRangeRatio: z.number().gt(1).finite(),
        }),
      }),
      z.object({
        path: relativeArtifactPathSchema,
        archiveEntry: relativeArtifactPathSchema,
        mediaType: z.literal('image/x-exr'),
        sha256: sourceSha256Schema,
        sizeBytes: z.number().int().positive(),
        encoding: z.literal('openexr'),
        projection: z.literal('equirectangular-latlong'),
        orientation: z.literal('openexr-latlong-y-up'),
        widthPixels: z.number().int().positive(),
        heightPixels: z.number().int().positive(),
        colorSpace: environmentRadianceColorSpaceSchema,
        structuralEvidence: z.object({
          storage: z.literal('single-part-scanline'),
          channels: z
            .array(
              z.object({
                name: z.enum(['R', 'G', 'B', 'A']),
                sampleType: z.enum(['half', 'float']),
                xSampling: z.literal(1),
                ySampling: z.literal(1),
              }),
            )
            .min(3)
            .max(4),
          dataWindow: z.tuple([
            z.number().int(),
            z.number().int(),
            z.number().int(),
            z.number().int(),
          ]),
          displayWindow: z.tuple([
            z.number().int(),
            z.number().int(),
            z.number().int(),
            z.number().int(),
          ]),
          inspector: z.object({
            tool: z.literal('exrinfo'),
            version: z.string().regex(/^\d+\.\d+\.\d+$/),
            licenceSpdx: z.literal('BSD-3-Clause'),
            commandArguments: z.tuple([z.literal('-v'), z.literal('-s')]),
            evidencePath: relativeArtifactPathSchema,
            evidenceSha256: sourceSha256Schema,
          }),
        }),
      }),
    ]),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.provider === 'ambientcg' && manifest.providerApi.version !== 'ambientcg-v3')
      ctx.addIssue({
        code: 'custom',
        path: ['providerApi', 'version'],
        message: 'ambientCG environment sources require the exact ambientcg-v3 API contract',
      });
    if (manifest.providerApi.retrievedAt !== manifest.licence.providerEvidence.retrievedAt)
      ctx.addIssue({
        code: 'custom',
        path: ['licence', 'providerEvidence', 'retrievedAt'],
        message: 'environment provider and licence evidence must share one acquisition time',
      });
    const expectedSelection = manifest.radiance.encoding === 'openexr' ? 'EXR' : 'HDR';
    if (manifest.selection.encoding !== expectedSelection)
      ctx.addIssue({
        code: 'custom',
        path: ['selection', 'encoding'],
        message: `environment selection encoding must match ${manifest.radiance.encoding}`,
      });
    if (manifest.radiance.widthPixels !== manifest.radiance.heightPixels * 2)
      ctx.addIssue({
        code: 'custom',
        path: ['radiance'],
        message: 'environment radiance source must have an exact 2:1 aspect ratio',
      });
    const expectedWidth = Number.parseInt(manifest.selection.resolution, 10) * 1024;
    if (manifest.radiance.widthPixels !== expectedWidth)
      ctx.addIssue({
        code: 'custom',
        path: ['radiance', 'widthPixels'],
        message: `environment radiance width must match requested ${manifest.selection.resolution}`,
      });
    const expectedEvidencePrefix =
      manifest.radiance.encoding === 'openexr' ? 'openexr-' : 'radiance-';
    if (!manifest.radiance.colorSpace.evidence.mode.startsWith(expectedEvidencePrefix))
      ctx.addIssue({
        code: 'custom',
        path: ['radiance', 'colorSpace', 'evidence', 'mode'],
        message: 'environment colour-space evidence must match the source encoding',
      });
  });

export type OpenEnvironmentRadianceSourceManifest = z.infer<
  typeof openEnvironmentRadianceSourceManifestSchema
>;

export const openEnvironmentRadianceSourceImportRequestSchema = z
  .object({
    provider: z.literal('ambientcg'),
    assetId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/i),
    resolution: z.custom<`${number}K`>(
      (value) => typeof value === 'string' && /^\d+K$/.test(value),
      'resolution must use the canonical form such as 1K or 2K',
    ),
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
        message: 'offline environment-radiance imports require an exact source identity',
      });
    if (request.mode === 'offline' && request.refresh)
      ctx.addIssue({
        code: 'custom',
        path: ['refresh'],
        message: 'environment-radiance source refresh requires online mode',
      });
  });

export type OpenEnvironmentRadianceSourceImportRequest = z.infer<
  typeof openEnvironmentRadianceSourceImportRequestSchema
>;

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

export type OpenMaterialSourceImportRequest = z.infer<typeof openMaterialSourceImportRequestSchema>;

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
