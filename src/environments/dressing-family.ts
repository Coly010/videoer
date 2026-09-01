import { z } from 'zod';
import { surfaceAlignedEuler, type SurfaceQueryProvider } from './surface-query.js';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
const vec2 = z.tuple([z.number().finite(), z.number().finite()]);

export const dressingFamilySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    title: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    intendedShotDistance: z.array(z.enum(['background', 'medium', 'close', 'hero-close'])).min(1),
    variants: z
      .array(
        z.object({
          id: identifier,
          geometryAssetId: identifier,
          geometryVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
          weight: z.number().positive(),
          footprintRadiusMeters: z.number().positive(),
          heightMeters: z.number().positive(),
          scale: z.object({ minimum: z.number().positive(), maximum: z.number().positive() }),
          yawDegrees: z.object({ minimum: z.number().finite(), maximum: z.number().finite() }),
          tags: z.array(z.string().min(1)).default([]),
        }),
      )
      .min(2),
    clusters: z
      .array(
        z.object({
          id: identifier,
          weight: z.number().positive(),
          yawDegrees: z.object({ minimum: z.number().finite(), maximum: z.number().finite() }),
          members: z
            .array(
              z.object({
                variantId: identifier,
                offset: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
                yawOffsetDegrees: z.number().finite().default(0),
                scaleMultiplier: z.number().positive().default(1),
              }),
            )
            .min(1),
        }),
      )
      .min(2),
    placement: z.object({
      surface: z.literal('ground'),
      distribution: z.enum(['uniform', 'edge-band']),
      edgeBandMeters: z.number().positive().optional(),
      minimumSpacingMeters: z.number().nonnegative(),
      preserveNavigationClearance: z.boolean(),
    }),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((family, context) => {
    const variants = new Set<string>();
    for (const [index, variant] of family.variants.entries()) {
      if (variants.has(variant.id))
        context.addIssue({
          code: 'custom',
          path: ['variants', index, 'id'],
          message: 'duplicate variant id',
        });
      variants.add(variant.id);
      if (variant.scale.minimum > variant.scale.maximum)
        context.addIssue({
          code: 'custom',
          path: ['variants', index, 'scale'],
          message: 'minimum scale exceeds maximum',
        });
      if (variant.yawDegrees.minimum > variant.yawDegrees.maximum)
        context.addIssue({
          code: 'custom',
          path: ['variants', index, 'yawDegrees'],
          message: 'minimum yaw exceeds maximum',
        });
    }
    const clusters = new Set<string>();
    for (const [index, cluster] of family.clusters.entries()) {
      if (clusters.has(cluster.id))
        context.addIssue({
          code: 'custom',
          path: ['clusters', index, 'id'],
          message: 'duplicate cluster id',
        });
      clusters.add(cluster.id);
      if (cluster.yawDegrees.minimum > cluster.yawDegrees.maximum)
        context.addIssue({
          code: 'custom',
          path: ['clusters', index, 'yawDegrees'],
          message: 'minimum yaw exceeds maximum',
        });
      for (const [memberIndex, member] of cluster.members.entries())
        if (!variants.has(member.variantId))
          context.addIssue({
            code: 'custom',
            path: ['clusters', index, 'members', memberIndex, 'variantId'],
            message: `unknown family variant '${member.variantId}'`,
          });
    }
    if (family.placement.distribution === 'edge-band' && !family.placement.edgeBandMeters)
      context.addIssue({
        code: 'custom',
        path: ['placement', 'edgeBandMeters'],
        message: 'edge-band placement requires a band width',
      });
  });

const exclusionSchema = z.discriminatedUnion('kind', [
  z.object({
    id: identifier,
    kind: z.literal('rectangle'),
    minimum: vec2,
    maximum: vec2,
    clearanceMeters: z.number().nonnegative().default(0),
  }),
  z.object({
    id: identifier,
    kind: z.literal('corridor'),
    start: vec2,
    end: vec2,
    halfWidthMeters: z.number().positive(),
    clearanceMeters: z.number().nonnegative().default(0),
  }),
]);

export const dressingLayoutRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    familyId: identifier,
    seed: z.number().int(),
    clusterCount: z.number().int().positive().max(250),
    requiredVariantIds: z.array(identifier).default([]),
    requiredRecipeIds: z.array(identifier).default([]),
    zone: z.object({ minimum: vec2, maximum: vec2, groundY: z.number().finite() }),
    surfaceQuery: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('flat') }),
        z.object({
          kind: z.literal('triangle-mesh'),
          geometryAssetId: identifier,
          maximumSlopeDegrees: z.number().min(0).max(60),
          alignToSurfaceNormal: z.boolean().default(true),
          verticalOffsetMeters: z.number().finite().default(0),
        }),
      ])
      .default({ kind: 'flat' }),
    exclusions: z.array(exclusionSchema).default([]),
    maximumAttemptsPerInstance: z.number().int().min(10).max(10_000).default(300),
  })
  .superRefine((request, context) => {
    if (
      request.zone.maximum[0] <= request.zone.minimum[0] ||
      request.zone.maximum[1] <= request.zone.minimum[1]
    )
      context.addIssue({
        code: 'custom',
        path: ['zone'],
        message: 'placement zone must have positive extent',
      });
    for (const [index, exclusion] of request.exclusions.entries())
      if (
        exclusion.kind === 'rectangle' &&
        (exclusion.maximum[0] <= exclusion.minimum[0] ||
          exclusion.maximum[1] <= exclusion.minimum[1])
      )
        context.addIssue({
          code: 'custom',
          path: ['exclusions', index],
          message: 'rectangle exclusion must have positive extent',
        });
  });

export type DressingFamily = z.infer<typeof dressingFamilySchema>;
export type DressingLayoutRequest = z.infer<typeof dressingLayoutRequestSchema>;
export type DressingLayoutRequestInput = z.input<typeof dressingLayoutRequestSchema>;

export interface DressingInstance {
  id: string;
  clusterId: string;
  recipeId: string;
  variantId: string;
  geometryAssetId: string;
  geometryVersion: string;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  footprintRadiusMeters: number;
  heightMeters: number;
  surface?: {
    geometryAssetId: string;
    triangleIndex: number;
    normal: [number, number, number];
    slopeDegrees: number;
  };
}

function deterministicRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function distanceToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  );
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t));
}

function intersectsExclusion(
  point: [number, number],
  radius: number,
  exclusion: DressingLayoutRequest['exclusions'][number],
) {
  if (exclusion.kind === 'corridor')
    return (
      distanceToSegment(point, exclusion.start, exclusion.end) <=
      radius + exclusion.halfWidthMeters + exclusion.clearanceMeters
    );
  const nearestX = Math.max(exclusion.minimum[0], Math.min(point[0], exclusion.maximum[0]));
  const nearestZ = Math.max(exclusion.minimum[1], Math.min(point[1], exclusion.maximum[1]));
  return Math.hypot(point[0] - nearestX, point[1] - nearestZ) <= radius + exclusion.clearanceMeters;
}

function weightedCluster(family: DressingFamily, random: () => number) {
  const total = family.clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
  let cursor = random() * total;
  for (const cluster of family.clusters) {
    cursor -= cluster.weight;
    if (cursor <= 0) return cluster;
  }
  return family.clusters.at(-1)!;
}

function samplePosition(
  family: DressingFamily,
  request: DressingLayoutRequest,
  radius: number,
  random: () => number,
): [number, number] {
  const minimumX = request.zone.minimum[0] + radius;
  const maximumX = request.zone.maximum[0] - radius;
  const minimumZ = request.zone.minimum[1] + radius;
  const maximumZ = request.zone.maximum[1] - radius;
  if (maximumX <= minimumX || maximumZ <= minimumZ)
    throw new Error(
      `Dressing family '${family.id}' does not fit inside layout zone '${request.id}'`,
    );
  if (family.placement.distribution === 'uniform')
    return [
      minimumX + random() * (maximumX - minimumX),
      minimumZ + random() * (maximumZ - minimumZ),
    ];
  const band = Math.min(
    family.placement.edgeBandMeters!,
    (maximumX - minimumX) * 0.5,
    (maximumZ - minimumZ) * 0.5,
  );
  const edge = Math.floor(random() * 4);
  if (edge === 0) return [minimumX + random() * (maximumX - minimumX), minimumZ + random() * band];
  if (edge === 1) return [minimumX + random() * (maximumX - minimumX), maximumZ - random() * band];
  if (edge === 2) return [minimumX + random() * band, minimumZ + random() * (maximumZ - minimumZ)];
  return [maximumX - random() * band, minimumZ + random() * (maximumZ - minimumZ)];
}

export function layoutDressingFamily(
  familyInput: DressingFamily,
  requestInput: DressingLayoutRequestInput,
  options: { surfaceQuery?: SurfaceQueryProvider } = {},
) {
  const family = dressingFamilySchema.parse(familyInput);
  const request = dressingLayoutRequestSchema.parse(requestInput);
  const surfaceContract = request.surfaceQuery;
  if (request.familyId !== family.id)
    throw new Error(`Dressing layout family '${request.familyId}' does not match '${family.id}'`);
  if (family.placement.preserveNavigationClearance && request.exclusions.length === 0)
    throw new Error(`Dressing family '${family.id}' requires an explicit navigation exclusion`);
  if (surfaceContract.kind === 'triangle-mesh' && !options.surfaceQuery)
    throw new Error(
      `Dressing layout '${request.id}' requires its declared triangle-mesh surface query`,
    );
  if (
    surfaceContract.kind === 'triangle-mesh' &&
    options.surfaceQuery?.geometryAssetId !== surfaceContract.geometryAssetId
  )
    throw new Error(
      `Dressing layout '${request.id}' declares surface '${surfaceContract.geometryAssetId}' but received '${options.surfaceQuery?.geometryAssetId}'`,
    );
  const random = deterministicRandom(request.seed);
  for (const variantId of request.requiredVariantIds)
    if (!family.variants.some((variant) => variant.id === variantId))
      throw new Error(`Dressing layout '${request.id}' requires unknown variant '${variantId}'`);
  if (new Set(request.requiredRecipeIds).size !== request.requiredRecipeIds.length)
    throw new Error(`Dressing layout '${request.id}' repeats a required recipe identity`);
  for (const recipeId of request.requiredRecipeIds)
    if (!family.clusters.some((cluster) => cluster.id === recipeId))
      throw new Error(`Dressing layout '${request.id}' requires unknown recipe '${recipeId}'`);
  if (request.requiredRecipeIds.length > request.clusterCount)
    throw new Error(`Dressing layout '${request.id}' requires more recipes than its cluster count`);
  const instances: DressingInstance[] = [];
  let attempts = 0;
  let placedClusters = 0;
  while (placedClusters < request.clusterCount) {
    let accepted = false;
    for (let localAttempt = 0; localAttempt < request.maximumAttemptsPerInstance; localAttempt++) {
      attempts++;
      const requiredRecipeId = request.requiredRecipeIds[placedClusters];
      const recipe = requiredRecipeId
        ? family.clusters.find((cluster) => cluster.id === requiredRecipeId)!
        : weightedCluster(family, random);
      const clusterYawDegrees =
        recipe.yawDegrees.minimum +
        random() * (recipe.yawDegrees.maximum - recipe.yawDegrees.minimum);
      const clusterYaw = (clusterYawDegrees * Math.PI) / 180;
      const candidates = recipe.members.map((member) => {
        const variant = family.variants.find((value) => value.id === member.variantId)!;
        const rawScale =
          variant.scale.minimum + random() * (variant.scale.maximum - variant.scale.minimum);
        const scale = rawScale * member.scaleMultiplier;
        const localX =
          member.offset[0] * Math.cos(clusterYaw) - member.offset[2] * Math.sin(clusterYaw);
        const localZ =
          member.offset[0] * Math.sin(clusterYaw) + member.offset[2] * Math.cos(clusterYaw);
        const variantYaw =
          variant.yawDegrees.minimum +
          random() * (variant.yawDegrees.maximum - variant.yawDegrees.minimum);
        return {
          member,
          variant,
          scale,
          localX,
          localZ,
          yaw: clusterYawDegrees + member.yawOffsetDegrees + variantYaw,
          radius: variant.footprintRadiusMeters * scale,
        };
      });
      const clusterRadius = Math.max(
        ...candidates.map(
          (candidate) => Math.hypot(candidate.localX, candidate.localZ) + candidate.radius,
        ),
      );
      const [anchorX, anchorZ] = samplePosition(family, request, clusterRadius, random);
      const positioned = candidates.map((candidate) => ({
        ...candidate,
        x: anchorX + candidate.localX,
        z: anchorZ + candidate.localZ,
      }));
      const surfaced = positioned.map((candidate) => ({
        ...candidate,
        hit: options.surfaceQuery?.query(candidate.x, candidate.z),
      }));
      if (
        surfaceContract.kind === 'triangle-mesh' &&
        surfaced.some(
          (candidate) =>
            !candidate.hit || candidate.hit.slopeDegrees > surfaceContract.maximumSlopeDegrees,
        )
      )
        continue;
      if (
        surfaced.some((candidate) =>
          request.exclusions.some((exclusion) =>
            intersectsExclusion([candidate.x, candidate.z], candidate.radius, exclusion),
          ),
        )
      )
        continue;
      if (
        surfaced.some((candidate) =>
          instances.some(
            (instance) =>
              Math.hypot(
                candidate.x - instance.transform.position[0],
                candidate.z - instance.transform.position[2],
              ) <
              candidate.radius +
                instance.footprintRadiusMeters +
                family.placement.minimumSpacingMeters,
          ),
        )
      )
        continue;
      const clusterId = `${request.id}.cluster-${String(placedClusters + 1).padStart(3, '0')}`;
      for (const [memberIndex, candidate] of surfaced.entries()) {
        const yawRadians = (candidate.yaw * Math.PI) / 180;
        const surface = surfaceContract.kind === 'triangle-mesh' ? candidate.hit! : undefined;
        instances.push({
          id: `${clusterId}.member-${String(memberIndex + 1).padStart(2, '0')}`,
          clusterId,
          recipeId: recipe.id,
          variantId: candidate.variant.id,
          geometryAssetId: candidate.variant.geometryAssetId,
          geometryVersion: candidate.variant.geometryVersion,
          transform: {
            position: [
              candidate.x,
              (surface?.position[1] ?? request.zone.groundY) +
                (surfaceContract.kind === 'triangle-mesh'
                  ? surfaceContract.verticalOffsetMeters
                  : 0) +
                // Cluster offsets are authored placement metres. X/Z are intentionally not
                // multiplied by per-member asset variation, so Y must preserve the same
                // coordinate contract (for example a basket base on a 1.09 m counter).
                candidate.member.offset[1],
              candidate.z,
            ],
            rotation:
              surface &&
              surfaceContract.kind === 'triangle-mesh' &&
              surfaceContract.alignToSurfaceNormal
                ? surfaceAlignedEuler(surface.normal, yawRadians)
                : [0, yawRadians, 0],
            scale: [candidate.scale, candidate.scale, candidate.scale],
          },
          footprintRadiusMeters: candidate.radius,
          heightMeters: candidate.variant.heightMeters * candidate.scale,
          ...(surface
            ? {
                surface: {
                  geometryAssetId:
                    surfaceContract.kind === 'triangle-mesh'
                      ? surfaceContract.geometryAssetId
                      : 'environment.unknown-surface',
                  triangleIndex: surface.triangleIndex,
                  normal: surface.normal,
                  slopeDegrees: surface.slopeDegrees,
                },
              }
            : {}),
        });
      }
      placedClusters++;
      accepted = true;
      break;
    }
    if (!accepted)
      throw new Error(
        `Could not place ${request.clusterCount} clusters of '${family.id}' in '${request.id}' without overlap or exclusion intrusion`,
      );
  }
  const placedVariants = new Set(instances.map((instance) => instance.variantId));
  const missingRequiredVariants = request.requiredVariantIds.filter(
    (variantId) => !placedVariants.has(variantId),
  );
  if (missingRequiredVariants.length)
    throw new Error(
      `Dressing layout '${request.id}' is missing required variants: ${missingRequiredVariants.join(', ')}`,
    );
  return {
    schemaVersion: 1 as const,
    requestId: request.id,
    familyId: family.id,
    seed: request.seed,
    attempts,
    instances,
    verification: {
      requestedClusterCount: request.clusterCount,
      placedClusterCount: placedClusters,
      placedCount: instances.length,
      requiredVariantIds: request.requiredVariantIds,
      ...(request.requiredRecipeIds.length > 0
        ? { requiredRecipeIds: request.requiredRecipeIds }
        : {}),
      allRequiredVariantsPresent: true,
      exclusionCount: request.exclusions.length,
      deterministic: true,
      overlapFree: true,
      navigationClearancePreserved: family.placement.preserveNavigationClearance,
    },
  };
}

export function createStreetStorageFamily(): DressingFamily {
  return dressingFamilySchema.parse({
    schemaVersion: 1,
    id: 'environment.street-storage-family',
    title: 'Portable street storage and edge dressing',
    tags: ['street', 'storage', 'crate', 'barrel', 'inhabited-environment'],
    intendedShotDistance: ['background', 'medium'],
    variants: [
      {
        id: 'barrel',
        geometryAssetId: 'prop.storage-barrel',
        geometryVersion: '0.1.0',
        weight: 0.42,
        footprintRadiusMeters: 0.4,
        heightMeters: 0.925,
        scale: { minimum: 0.9, maximum: 1.08 },
        yawDegrees: { minimum: -180, maximum: 180 },
        tags: ['round', 'vertical'],
      },
      {
        id: 'slatted-crate',
        geometryAssetId: 'prop.slatted-storage-crate',
        geometryVersion: '0.1.0',
        weight: 0.58,
        footprintRadiusMeters: 0.47,
        heightMeters: 0.58,
        scale: { minimum: 0.88, maximum: 1.12 },
        yawDegrees: { minimum: -22, maximum: 22 },
        tags: ['rectangular', 'stackable'],
      },
    ],
    clusters: [
      {
        id: 'mixed-cache',
        weight: 0.38,
        yawDegrees: { minimum: -28, maximum: 28 },
        members: [
          { variantId: 'barrel', offset: [-0.43, 0, 0], yawOffsetDegrees: -8, scaleMultiplier: 1 },
          {
            variantId: 'slatted-crate',
            offset: [0.43, 0, 0.08],
            yawOffsetDegrees: 8,
            scaleMultiplier: 0.96,
          },
        ],
      },
      {
        id: 'barrel-pair',
        weight: 0.24,
        yawDegrees: { minimum: -35, maximum: 35 },
        members: [
          { variantId: 'barrel', offset: [-0.32, 0, 0], yawOffsetDegrees: -5, scaleMultiplier: 1 },
          {
            variantId: 'barrel',
            offset: [0.36, 0, 0.12],
            yawOffsetDegrees: 9,
            scaleMultiplier: 0.88,
          },
        ],
      },
      {
        id: 'crate-corner',
        weight: 0.25,
        yawDegrees: { minimum: -24, maximum: 24 },
        members: [
          {
            variantId: 'slatted-crate',
            offset: [-0.37, 0, 0],
            yawOffsetDegrees: -7,
            scaleMultiplier: 1,
          },
          {
            variantId: 'slatted-crate',
            offset: [0.38, 0, 0.16],
            yawOffsetDegrees: 19,
            scaleMultiplier: 0.9,
          },
        ],
      },
      {
        id: 'crate-stack',
        weight: 0.13,
        yawDegrees: { minimum: -18, maximum: 18 },
        members: [
          {
            variantId: 'slatted-crate',
            offset: [0, 0, 0],
            yawOffsetDegrees: 0,
            scaleMultiplier: 1,
          },
          {
            variantId: 'slatted-crate',
            offset: [0.02, 0.58, 0.01],
            yawOffsetDegrees: 7,
            scaleMultiplier: 0.92,
          },
        ],
      },
    ],
    placement: {
      surface: 'ground',
      distribution: 'edge-band',
      edgeBandMeters: 1.15,
      minimumSpacingMeters: 0.12,
      preserveNavigationClearance: true,
    },
    metadata: {
      generator: 'videoer.environment-dressing-family.v1',
      assetResolution: 'stable-id-and-explicit-version',
      layoutOutput: 'renderer-independent-transforms',
    },
  });
}

export function createPottedVegetationFamily(): DressingFamily {
  return dressingFamilySchema.parse({
    schemaVersion: 1,
    id: 'environment.potted-vegetation-family',
    title: 'Portable inhabited-space potted vegetation',
    tags: ['vegetation', 'planter', 'courtyard', 'interior', 'inhabited-environment'],
    intendedShotDistance: ['background', 'medium'],
    variants: [
      {
        id: 'potted-fern',
        geometryAssetId: 'prop.potted-fern',
        geometryVersion: '0.1.0',
        weight: 0.56,
        footprintRadiusMeters: 0.74,
        heightMeters: 1.35,
        scale: { minimum: 0.96, maximum: 1.18 },
        yawDegrees: { minimum: -180, maximum: 180 },
        tags: ['broad', 'soft-silhouette', 'terracotta'],
      },
      {
        id: 'potted-shrub',
        geometryAssetId: 'prop.potted-shrub',
        geometryVersion: '0.1.0',
        weight: 0.44,
        footprintRadiusMeters: 0.56,
        heightMeters: 1.55,
        scale: { minimum: 0.94, maximum: 1.2 },
        yawDegrees: { minimum: -180, maximum: 180 },
        tags: ['upright', 'branching', 'galvanized'],
      },
    ],
    clusters: [
      {
        id: 'mixed-threshold-pair',
        weight: 0.42,
        yawDegrees: { minimum: -28, maximum: 28 },
        members: [
          { variantId: 'potted-fern', offset: [-0.62, 0, 0], yawOffsetDegrees: -12 },
          {
            variantId: 'potted-shrub',
            offset: [0.58, 0, 0.12],
            yawOffsetDegrees: 16,
            scaleMultiplier: 0.9,
          },
        ],
      },
      {
        id: 'fern-corner',
        weight: 0.31,
        yawDegrees: { minimum: -38, maximum: 38 },
        members: [{ variantId: 'potted-fern', offset: [0, 0, 0] }],
      },
      {
        id: 'shrub-pair',
        weight: 0.27,
        yawDegrees: { minimum: -24, maximum: 24 },
        members: [
          { variantId: 'potted-shrub', offset: [-0.48, 0, 0], yawOffsetDegrees: -14 },
          {
            variantId: 'potted-shrub',
            offset: [0.49, 0, 0.1],
            yawOffsetDegrees: 18,
            scaleMultiplier: 0.84,
          },
        ],
      },
    ],
    placement: {
      surface: 'ground',
      distribution: 'edge-band',
      edgeBandMeters: 1.5,
      minimumSpacingMeters: 0.16,
      preserveNavigationClearance: true,
    },
    metadata: {
      generator: 'videoer.potted-vegetation-family.v1',
      assetResolution: 'stable-id-and-explicit-version',
      layoutOutput: 'renderer-independent-surface-bound-transforms',
      supportsTriangleSurfaceQuery: true,
    },
  });
}

export function createMarketWorldFamily(): DressingFamily {
  return dressingFamilySchema.parse({
    schemaVersion: 1,
    id: 'environment.market-world-family',
    title: 'Portable market stall and physical merchandising family',
    tags: ['market', 'stall', 'merchandising', 'produce', 'inhabited-environment'],
    intendedShotDistance: ['background', 'medium'],
    variants: [
      {
        id: 'market-stall',
        geometryAssetId: 'prop.modular-market-stall',
        geometryVersion: '0.1.0',
        weight: 0.28,
        footprintRadiusMeters: 1.86,
        heightMeters: 2.84,
        scale: { minimum: 0.98, maximum: 1.03 },
        yawDegrees: { minimum: -5, maximum: 5 },
        tags: ['structure', 'canopy', 'display-surfaces'],
      },
      {
        id: 'produce-basket',
        geometryAssetId: 'prop.produce-basket',
        geometryVersion: '0.1.0',
        weight: 0.45,
        footprintRadiusMeters: 0.47,
        heightMeters: 0.81,
        scale: { minimum: 0.92, maximum: 1.08 },
        yawDegrees: { minimum: -35, maximum: 35 },
        tags: ['inventory', 'produce', 'carryable'],
      },
      {
        id: 'provision-sack',
        geometryAssetId: 'prop.tied-provision-sack',
        geometryVersion: '0.1.0',
        weight: 0.27,
        footprintRadiusMeters: 0.41,
        heightMeters: 0.94,
        scale: { minimum: 0.9, maximum: 1.1 },
        yawDegrees: { minimum: -30, maximum: 30 },
        tags: ['inventory', 'dry-provisions', 'carryable'],
      },
    ],
    clusters: [
      {
        id: 'complete-merchandised-stall',
        weight: 0.54,
        yawDegrees: { minimum: -12, maximum: 12 },
        members: [
          { variantId: 'market-stall', offset: [0, 0, 0], yawOffsetDegrees: 0, scaleMultiplier: 1 },
          {
            variantId: 'produce-basket',
            offset: [-0.78, 1.09, -0.62],
            yawOffsetDegrees: -7,
            scaleMultiplier: 0.72,
          },
          {
            variantId: 'produce-basket',
            offset: [0.76, 1.09, -0.62],
            yawOffsetDegrees: 9,
            scaleMultiplier: 0.68,
          },
          {
            variantId: 'provision-sack',
            offset: [-0.93, 0.42, -0.12],
            yawOffsetDegrees: -12,
            scaleMultiplier: 0.74,
          },
          {
            variantId: 'provision-sack',
            offset: [0.92, 0.42, -0.08],
            yawOffsetDegrees: 14,
            scaleMultiplier: 0.7,
          },
        ],
      },
      {
        id: 'produce-display-trio',
        weight: 0.19,
        yawDegrees: { minimum: -28, maximum: 28 },
        members: [
          {
            variantId: 'produce-basket',
            offset: [-0.58, 0, 0.05],
            yawOffsetDegrees: -10,
            scaleMultiplier: 1,
          },
          {
            variantId: 'produce-basket',
            offset: [0, 0, -0.1],
            yawOffsetDegrees: 6,
            scaleMultiplier: 0.92,
          },
          {
            variantId: 'produce-basket',
            offset: [0.56, 0, 0.08],
            yawOffsetDegrees: 16,
            scaleMultiplier: 0.86,
          },
        ],
      },
      {
        id: 'provision-cache',
        weight: 0.15,
        yawDegrees: { minimum: -22, maximum: 22 },
        members: [
          {
            variantId: 'provision-sack',
            offset: [-0.38, 0, 0],
            yawOffsetDegrees: -9,
            scaleMultiplier: 1,
          },
          {
            variantId: 'provision-sack',
            offset: [0.38, 0, 0.08],
            yawOffsetDegrees: 11,
            scaleMultiplier: 0.91,
          },
        ],
      },
      {
        id: 'side-stock',
        weight: 0.12,
        yawDegrees: { minimum: -25, maximum: 25 },
        members: [
          {
            variantId: 'produce-basket',
            offset: [-0.36, 0, 0],
            yawOffsetDegrees: -8,
            scaleMultiplier: 0.92,
          },
          {
            variantId: 'provision-sack',
            offset: [0.39, 0, 0.04],
            yawOffsetDegrees: 10,
            scaleMultiplier: 0.94,
          },
        ],
      },
    ],
    placement: {
      surface: 'ground',
      distribution: 'edge-band',
      edgeBandMeters: 1.4,
      minimumSpacingMeters: 0.22,
      preserveNavigationClearance: true,
    },
    metadata: {
      generator: 'videoer.market-world-family.v1',
      assetResolution: 'stable-id-and-explicit-version',
      layoutOutput: 'renderer-independent-transforms',
      clusterSemantics: 'authored-physical-merchandising',
    },
  });
}

export function createWorkshopWorldFamily(): DressingFamily {
  return dressingFamilySchema.parse({
    schemaVersion: 1,
    id: 'environment.workshop-world-family',
    title: 'Portable workshop workstation and tool-storage family',
    tags: ['workshop', 'workbench', 'tools', 'craft', 'inhabited-interior'],
    intendedShotDistance: ['background', 'medium'],
    variants: [
      {
        id: 'joiners-workbench',
        geometryAssetId: 'prop.joiners-workbench',
        geometryVersion: '0.1.0',
        weight: 0.34,
        footprintRadiusMeters: 1.25,
        heightMeters: 1.04,
        scale: { minimum: 0.98, maximum: 1.03 },
        yawDegrees: { minimum: -4, maximum: 4 },
        tags: ['work-surface', 'vise', 'interaction-anchors'],
      },
      {
        id: 'freestanding-tool-board',
        geometryAssetId: 'prop.freestanding-tool-board',
        geometryVersion: '0.1.0',
        weight: 0.32,
        footprintRadiusMeters: 0.96,
        heightMeters: 2.12,
        scale: { minimum: 0.97, maximum: 1.04 },
        yawDegrees: { minimum: -5, maximum: 5 },
        tags: ['tool-display', 'storage', 'silhouette'],
      },
      {
        id: 'rolling-parts-cabinet',
        geometryAssetId: 'prop.rolling-parts-cabinet',
        geometryVersion: '0.1.0',
        weight: 0.34,
        footprintRadiusMeters: 0.64,
        heightMeters: 1.02,
        scale: { minimum: 0.94, maximum: 1.06 },
        yawDegrees: { minimum: -12, maximum: 12 },
        tags: ['drawers', 'portable-storage', 'parts'],
      },
    ],
    clusters: [
      {
        id: 'complete-craft-workstation',
        weight: 0.58,
        yawDegrees: { minimum: -10, maximum: 10 },
        members: [
          { variantId: 'joiners-workbench', offset: [0, 0, 0], yawOffsetDegrees: 0 },
          {
            variantId: 'freestanding-tool-board',
            offset: [0, 0, 0.84],
            yawOffsetDegrees: 0,
          },
          {
            variantId: 'rolling-parts-cabinet',
            offset: [1.67, 0, 0.22],
            yawOffsetDegrees: -5,
            scaleMultiplier: 0.94,
          },
        ],
      },
      {
        id: 'bench-and-cabinet',
        weight: 0.24,
        yawDegrees: { minimum: -18, maximum: 18 },
        members: [
          { variantId: 'joiners-workbench', offset: [-0.48, 0, 0] },
          {
            variantId: 'rolling-parts-cabinet',
            offset: [1.32, 0, 0.18],
            yawOffsetDegrees: -8,
          },
        ],
      },
      {
        id: 'tool-storage-bay',
        weight: 0.18,
        yawDegrees: { minimum: -16, maximum: 16 },
        members: [
          { variantId: 'freestanding-tool-board', offset: [-0.56, 0, 0] },
          {
            variantId: 'rolling-parts-cabinet',
            offset: [0.86, 0, -0.06],
            yawOffsetDegrees: 7,
          },
        ],
      },
    ],
    placement: {
      surface: 'ground',
      distribution: 'edge-band',
      edgeBandMeters: 2.15,
      minimumSpacingMeters: 0.22,
      preserveNavigationClearance: true,
    },
    metadata: {
      generator: 'videoer.workshop-world-family.v1',
      assetResolution: 'stable-id-and-explicit-version',
      layoutOutput: 'renderer-independent-authored-workstation-transforms',
      workstationSemantics: true,
    },
  });
}

export function createInteriorFurnishingFamily(): DressingFamily {
  return dressingFamilySchema.parse({
    schemaVersion: 1,
    id: 'environment.interior-furnishing-family',
    title: 'Cross-era inhabited-interior furnishing family',
    tags: ['interior', 'furniture', 'seating', 'tabletop', 'inhabited-environment'],
    intendedShotDistance: ['background', 'medium'],
    variants: [
      {
        id: 'reading-chair',
        geometryAssetId: 'prop.upholstered-reading-chair',
        geometryVersion: '0.1.0',
        weight: 0.42,
        footprintRadiusMeters: 0.72,
        heightMeters: 1.7,
        scale: { minimum: 0.96, maximum: 1.04 },
        yawDegrees: { minimum: -4, maximum: 4 },
        tags: ['seating', 'upholstered', 'interaction-anchors'],
      },
      {
        id: 'pedestal-table',
        geometryAssetId: 'prop.pedestal-side-table',
        geometryVersion: '0.1.0',
        weight: 0.34,
        footprintRadiusMeters: 0.58,
        heightMeters: 0.77,
        // Authored world-space support offsets require the support table to
        // remain canonical so tabletop inventory is exactly grounded.
        scale: { minimum: 1, maximum: 1 },
        yawDegrees: { minimum: -12, maximum: 12 },
        tags: ['table', 'interaction-surface', 'brass-inlay'],
      },
      {
        id: 'vessel-set',
        geometryAssetId: 'prop.decorative-vessel-set',
        geometryVersion: '0.1.0',
        weight: 0.24,
        footprintRadiusMeters: 0.42,
        heightMeters: 0.65,
        scale: { minimum: 0.9, maximum: 1.08 },
        yawDegrees: { minimum: -25, maximum: 25 },
        tags: ['tabletop', 'ceramic', 'brass', 'portable-inventory'],
      },
    ],
    clusters: [
      {
        id: 'complete-reading-corner',
        weight: 0.54,
        yawDegrees: { minimum: -18, maximum: 18 },
        members: [
          { variantId: 'reading-chair', offset: [-0.72, 0, 0.08], yawOffsetDegrees: 12 },
          { variantId: 'pedestal-table', offset: [0.62, 0, -0.06], yawOffsetDegrees: -4 },
          {
            variantId: 'vessel-set',
            offset: [0.62, 0.77, -0.06],
            yawOffsetDegrees: 8,
            scaleMultiplier: 0.72,
          },
        ],
      },
      {
        id: 'conversation-setting',
        weight: 0.3,
        yawDegrees: { minimum: -24, maximum: 24 },
        members: [
          { variantId: 'reading-chair', offset: [-1.1, 0, 0.05], yawOffsetDegrees: 52 },
          { variantId: 'reading-chair', offset: [1.1, 0, 0.05], yawOffsetDegrees: -52 },
          { variantId: 'pedestal-table', offset: [0, 0, -0.26] },
          { variantId: 'vessel-set', offset: [0, 0.77, -0.26], scaleMultiplier: 0.7 },
        ],
      },
      {
        id: 'solitary-table-vignette',
        weight: 0.16,
        yawDegrees: { minimum: -35, maximum: 35 },
        members: [
          { variantId: 'pedestal-table', offset: [0, 0, 0] },
          {
            variantId: 'vessel-set',
            offset: [0, 0.77, 0],
            yawOffsetDegrees: 14,
            scaleMultiplier: 0.76,
          },
        ],
      },
    ],
    placement: {
      surface: 'ground',
      distribution: 'edge-band',
      edgeBandMeters: 2.25,
      minimumSpacingMeters: 0.24,
      preserveNavigationClearance: true,
    },
    metadata: {
      generator: 'videoer.interior-furnishing-family.v1',
      assetResolution: 'stable-id-and-explicit-version',
      layoutOutput: 'renderer-independent-authored-furnishing-transforms',
      crossEraTransferFixture: true,
      tabletopSupportHeightMeters: 0.77,
    },
  });
}
