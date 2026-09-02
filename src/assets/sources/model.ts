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

const polyHavenHttpEvidenceSchema = z.object({
  requestedUrl: z.string().url(),
  finalUrl: z.string().url(),
  path: relativeArtifactPathSchema,
  sha256: sourceSha256Schema,
  sizeBytes: z.number().int().positive(),
  retrievedAt: z.string().datetime(),
});

const providerMd5Schema = z.string().regex(/^[a-f0-9]{32}$/);
const providerSha1Schema = z.string().regex(/^[a-f0-9]{40}$/);

/**
 * Poly Haven publishes texture maps as individually hashed provider files, not
 * as one archive. This v2 manifest deliberately keeps that provenance model
 * separate from the legacy archive-backed material-source schema above.
 */
export const polyHavenMaterialSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal('provider-files'),
    sourceIdentitySha256: sourceSha256Schema,
    provider: z.literal('poly-haven'),
    adapterVersion: z.literal('videoer.poly-haven-material-source.v2'),
    approvedOrigins: z.array(z.string().url()).min(1),
    providerApi: z.object({
      openApiVersion: z.literal('1.0.0'),
      userAgent: z.literal('Videoer/0.1 poly-haven-material-source-v2'),
      info: polyHavenHttpEvidenceSchema,
      files: polyHavenHttpEvidenceSchema,
      providerFilesHash: z.object({
        algorithm: z.literal('sha1'),
        value: providerSha1Schema,
        treatment: z.literal('provider-opaque-response-binding'),
      }),
    }),
    asset: z.object({
      id: z.string().min(1),
      type: z.literal('material'),
      providerType: z.literal(1),
      title: z.string().min(1),
      pageUrl: z.string().url(),
      releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tags: z.array(z.string().min(1)),
      categories: z.array(z.string().min(1)),
      authors: z.record(z.string(), z.string()),
    }),
    serviceTerms: z.object({
      reviewedCommit: z.literal('df4d579935b5e245b2a745635607b6a3c595d8dd'),
      reviewed: polyHavenHttpEvidenceSchema,
      current: polyHavenHttpEvidenceSchema,
      adapterAssessment: z.object({
        kind: z.literal('videoer-reviewed-poly-haven-api-assessment-v1'),
        path: relativeArtifactPathSchema,
        sha256: sourceSha256Schema,
      }),
      liveApiCommercialUse: z.literal('allowed'),
      liveApiAttributionRequired: z.literal(true),
      visibleAttribution: z.object({
        confirmed: z.literal(true),
        text: z.string().min(1),
        location: z.string().min(1),
      }),
    }),
    assetLicence: z.object({
      spdx: z.literal('CC0-1.0'),
      name: z.literal('Creative Commons CC0 1.0 Universal'),
      commercialUse: z.literal('allowed'),
      attributionRequired: z.literal(false),
      evidence: polyHavenHttpEvidenceSchema,
    }),
    selection: z.object({
      resolution: z.string().regex(/^\d+k$/),
      encoding: z.enum(['jpg', 'png']),
    }),
    physicalScale: z.object({
      status: z.literal('known'),
      widthMeters: z.number().positive(),
      heightMeters: z.number().positive(),
      providerDimensionsMillimetres: z.tuple([z.number().positive(), z.number().positive()]),
      providerMaxResolutionPixels: z.tuple([
        z.number().int().positive(),
        z.number().int().positive(),
      ]),
      relativeTolerance: z.literal(0.05),
      evidenceBoundsMeters: z.object({
        width: z.tuple([z.number().positive(), z.number().positive()]),
        height: z.tuple([z.number().positive(), z.number().positive()]),
      }),
      source: z.literal('poly-haven-info-dimensions-millimetres'),
    }),
    providerFiles: z
      .array(
        z.object({
          semantic: materialChannelSemanticSchema,
          providerName: z.enum([
            'Diffuse',
            'nor_gl',
            'Rough',
            'Displacement',
            'AO',
            'Metal',
            'Alpha',
          ]),
          requestedUrl: z.string().url(),
          finalUrl: z.string().url(),
          declaredSizeBytes: z.number().int().positive(),
          providerMd5: providerMd5Schema,
          sha256: sourceSha256Schema,
          path: relativeArtifactPathSchema,
          mediaType: z.enum(['image/jpeg', 'image/png']),
          widthPixels: z.number().int().positive(),
          heightPixels: z.number().int().positive(),
          colorSpace: z.enum(['srgb-texture', 'non-color']),
          normalConvention: z.literal('opengl-positive-green').optional(),
        }),
      )
      .min(3)
      .max(7),
    channels: z.array(materialTextureChannelSchema).min(3).max(7),
  })
  .superRefine((manifest, context) => {
    if (!manifest.serviceTerms.visibleAttribution.text.toLowerCase().includes('poly haven'))
      context.addIssue({
        code: 'custom',
        path: ['serviceTerms', 'visibleAttribution', 'text'],
        message: 'visible live-API attribution must name Poly Haven',
      });
    const semantics = manifest.providerFiles.map((file) => file.semantic);
    if (new Set(semantics).size !== semantics.length)
      context.addIssue({
        code: 'custom',
        path: ['providerFiles'],
        message: 'provider file semantics must be unique',
      });
    for (const required of ['base-color', 'normal', 'roughness'] as const)
      if (!semantics.includes(required))
        context.addIssue({
          code: 'custom',
          path: ['providerFiles'],
          message: `material source requires ${required}`,
        });
    const canonicalMaps = {
      Diffuse: ['base-color', 'base-color'],
      nor_gl: ['normal', 'normal-gl'],
      Rough: ['roughness', 'roughness'],
      Displacement: ['displacement', 'displacement'],
      AO: ['ambient-occlusion', 'ambient-occlusion'],
      Metal: ['metallic', 'metallic'],
      Alpha: ['opacity', 'opacity'],
    } as const;
    const expectedExtension = manifest.selection.encoding === 'jpg' ? '.jpg' : '.png';
    const expectedMediaType = manifest.selection.encoding === 'jpg' ? 'image/jpeg' : 'image/png';
    const approvedOrigins = new Set(manifest.approvedOrigins.map((value) => new URL(value).origin));
    const dimensions = new Set(
      manifest.providerFiles.map((file) => `${file.widthPixels}x${file.heightPixels}`),
    );
    if (dimensions.size !== 1)
      context.addIssue({
        code: 'custom',
        path: ['providerFiles'],
        message: 'all selected Poly Haven map dimensions must be identical',
      });
    for (const [index, file] of manifest.providerFiles.entries()) {
      const [expectedSemantic, expectedFilename] = canonicalMaps[file.providerName];
      const expectedPath = `textures/${expectedFilename}${expectedExtension}`;
      if (file.semantic !== expectedSemantic || file.path !== expectedPath)
        context.addIssue({
          code: 'custom',
          path: ['providerFiles', index],
          message: 'provider map must use its canonical semantic and portable texture path',
        });
      if (file.mediaType !== expectedMediaType)
        context.addIssue({
          code: 'custom',
          path: ['providerFiles', index, 'mediaType'],
          message: 'provider map media type must match the selected encoding',
        });
      const expectedColorSpace = file.semantic === 'base-color' ? 'srgb-texture' : 'non-color';
      if (file.colorSpace !== expectedColorSpace)
        context.addIssue({
          code: 'custom',
          path: ['providerFiles', index, 'colorSpace'],
          message: `${file.semantic} must use ${expectedColorSpace}`,
        });
      if (
        (file.semantic === 'normal' && file.normalConvention !== 'opengl-positive-green') ||
        (file.semantic !== 'normal' && file.normalConvention !== undefined)
      )
        context.addIssue({
          code: 'custom',
          path: ['providerFiles', index, 'normalConvention'],
          message: 'only the nor_gl map may declare the OpenGL normal convention',
        });
      for (const [field, value] of [
        ['requestedUrl', file.requestedUrl],
        ['finalUrl', file.finalUrl],
      ] as const)
        if (!approvedOrigins.has(new URL(value).origin))
          context.addIssue({
            code: 'custom',
            path: ['providerFiles', index, field],
            message: 'provider file URL must use a recorded approved origin',
          });
    }
    const orderedSemantics = [...semantics].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(semantics) !== JSON.stringify(orderedSemantics))
      context.addIssue({
        code: 'custom',
        path: ['providerFiles'],
        message: 'provider files must use canonical semantic order',
      });
    const channelIdentity = manifest.channels.map((channel) => ({
      semantic: channel.semantic,
      providerName: channel.providerName,
      path: channel.path,
      sha256: channel.sha256,
      sizeBytes: channel.sizeBytes,
      mediaType: channel.mediaType,
      colorSpace: channel.colorSpace,
      normalConvention: channel.normalConvention,
    }));
    const fileIdentity = manifest.providerFiles.map((file) => ({
      semantic: file.semantic,
      providerName: file.providerName,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.declaredSizeBytes,
      mediaType: file.mediaType,
      colorSpace: file.colorSpace,
      normalConvention: file.normalConvention,
    }));
    if (JSON.stringify(channelIdentity) !== JSON.stringify(fileIdentity))
      context.addIssue({
        code: 'custom',
        path: ['channels'],
        message: 'renderer channels must exactly mirror provider-file order and hashes',
      });
    const tolerance = manifest.physicalScale.relativeTolerance;
    const expectedBounds = {
      width: [
        manifest.physicalScale.widthMeters * (1 - tolerance),
        manifest.physicalScale.widthMeters * (1 + tolerance),
      ],
      height: [
        manifest.physicalScale.heightMeters * (1 - tolerance),
        manifest.physicalScale.heightMeters * (1 + tolerance),
      ],
    };
    for (const axis of ['width', 'height'] as const)
      if (
        manifest.physicalScale.evidenceBoundsMeters[axis].some(
          (value, index) => Math.abs(value - expectedBounds[axis][index]!) > 1e-12,
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['physicalScale', 'evidenceBoundsMeters', axis],
          message: `${axis} evidence bounds must encode the declared ±5% tolerance`,
        });
  });

export type PolyHavenMaterialSourceManifest = z.infer<typeof polyHavenMaterialSourceManifestSchema>;

export const materialSourceManifestSchema = z.union([
  openMaterialSourceManifestSchema,
  polyHavenMaterialSourceManifestSchema,
]);

export type MaterialSourceManifest = z.infer<typeof materialSourceManifestSchema>;

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

export const polyHavenMaterialSourceImportRequestSchema = z
  .object({
    provider: z.literal('poly-haven'),
    assetId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
    resolution: z.custom<`${number}K`>(
      (value) => typeof value === 'string' && /^[1-9]\d*K$/u.test(value),
      'resolution must use the canonical form such as 1K or 2K',
    ),
    encoding: z.enum(['JPG', 'PNG']),
    cacheDirectory: z.string().min(1),
    outputDirectory: z.string().min(1),
    mode: z.enum(['online', 'offline']),
    refresh: z.boolean(),
    expectedSourceIdentitySha256: sourceSha256Schema.optional(),
  })
  .superRefine((request, context) => {
    if (request.mode === 'offline' && !request.expectedSourceIdentitySha256)
      context.addIssue({
        code: 'custom',
        path: ['expectedSourceIdentitySha256'],
        message: 'offline Poly Haven material imports require an exact source identity',
      });
    if (request.mode === 'offline' && request.refresh)
      context.addIssue({
        code: 'custom',
        path: ['refresh'],
        message: 'Poly Haven source refresh requires online mode',
      });
  });

export type PolyHavenMaterialSourceImportRequest = z.infer<
  typeof polyHavenMaterialSourceImportRequestSchema
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
