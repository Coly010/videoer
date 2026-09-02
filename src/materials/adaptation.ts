import type { GeometryAsset } from '../geometry/model.js';
import { validateGeometry } from '../geometry/model.js';
import { surfaceMaterialSchema, type SurfaceMaterial } from './model.js';

export interface SurfaceTreatment {
  assetId: string;
  baseColor?:
    | {
        colors?: Array<[number, number, number, number]> | undefined;
        scaleMeters?: number | undefined;
        seed?: number | undefined;
      }
    | undefined;
  normal?:
    | {
        strength?: number | undefined;
        scaleMeters?: number | undefined;
      }
    | undefined;
  roughness?:
    | {
        minimum?: number | undefined;
        maximum?: number | undefined;
        variationScaleMeters?: number | undefined;
        wetness?: number | undefined;
      }
    | undefined;
  metallic?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export function adaptSurfaceMaterial(
  base: SurfaceMaterial,
  treatment: SurfaceTreatment,
): SurfaceMaterial {
  return surfaceMaterialSchema.parse({
    ...structuredClone(base),
    id: treatment.assetId,
    baseColor: {
      ...base.baseColor,
      ...(treatment.baseColor?.colors ? { colors: treatment.baseColor.colors } : {}),
      ...(treatment.baseColor?.scaleMeters !== undefined
        ? { scaleMeters: treatment.baseColor.scaleMeters }
        : {}),
      ...(treatment.baseColor?.seed !== undefined ? { seed: treatment.baseColor.seed } : {}),
    },
    normal: {
      ...base.normal,
      ...(treatment.normal?.strength !== undefined ? { strength: treatment.normal.strength } : {}),
      ...(treatment.normal?.scaleMeters !== undefined
        ? { scaleMeters: treatment.normal.scaleMeters }
        : {}),
    },
    roughness: {
      ...base.roughness,
      ...(treatment.roughness?.minimum !== undefined
        ? { minimum: treatment.roughness.minimum }
        : {}),
      ...(treatment.roughness?.maximum !== undefined
        ? { maximum: treatment.roughness.maximum }
        : {}),
      ...(treatment.roughness?.variationScaleMeters !== undefined
        ? { variationScaleMeters: treatment.roughness.variationScaleMeters }
        : {}),
      ...(treatment.roughness?.wetness !== undefined
        ? { wetness: treatment.roughness.wetness }
        : {}),
    },
    ...(treatment.metallic !== undefined ? { metallic: treatment.metallic } : {}),
    metadata: {
      ...base.metadata,
      ...treatment.metadata,
      sourceMaterial: base.id,
      adaptationGenerator: 'videoer.surface-treatment.v1',
    },
  });
}

export function verifySurfaceMaterialAdaptation(base: SurfaceMaterial, adapted: SurfaceMaterial) {
  const issues: string[] = [];
  const parsed = surfaceMaterialSchema.safeParse(adapted);
  if (!parsed.success)
    issues.push(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  if (base.id === adapted.id) issues.push('adapted material must have a distinct asset id');
  if (base.shadingModel !== adapted.shadingModel) issues.push('shading model changed');
  if (base.baseColor.kind !== adapted.baseColor.kind) issues.push('base-color model changed');
  if (base.normal.kind !== adapted.normal.kind) issues.push('normal model changed');
  const changedFields: string[] = [];
  for (const [field, before, after] of [
    ['baseColor.colors', base.baseColor.colors, adapted.baseColor.colors],
    ['baseColor.scaleMeters', base.baseColor.scaleMeters, adapted.baseColor.scaleMeters],
    ['baseColor.seed', base.baseColor.seed, adapted.baseColor.seed],
    ['normal.strength', base.normal.strength, adapted.normal.strength],
    ['normal.scaleMeters', base.normal.scaleMeters, adapted.normal.scaleMeters],
    ['roughness.minimum', base.roughness.minimum, adapted.roughness.minimum],
    ['roughness.maximum', base.roughness.maximum, adapted.roughness.maximum],
    [
      'roughness.variationScaleMeters',
      base.roughness.variationScaleMeters,
      adapted.roughness.variationScaleMeters,
    ],
    ['roughness.wetness', base.roughness.wetness, adapted.roughness.wetness],
    ['metallic', base.metallic, adapted.metallic],
  ] as const)
    if (JSON.stringify(before) !== JSON.stringify(after)) changedFields.push(field);
  if (!changedFields.length) issues.push('surface treatment made no semantic change');
  return {
    valid: issues.length === 0,
    issues,
    shadingModelPreserved: base.shadingModel === adapted.shadingModel,
    baseColorModelPreserved: base.baseColor.kind === adapted.baseColor.kind,
    normalModelPreserved: base.normal.kind === adapted.normal.kind,
    changedFields,
  };
}

export function bindSurfaceMaterial(
  geometry: GeometryAsset,
  targetMaterialId: string,
  surface: SurfaceMaterial,
): GeometryAsset {
  return bindSurfaceMaterialTargets(geometry, [targetMaterialId], surface);
}

/** Binds one surface to multiple live material slots with one clone and validation pass. */
export function bindSurfaceMaterialTargets(
  geometry: GeometryAsset,
  targetMaterialIds: string[],
  surface: SurfaceMaterial,
): GeometryAsset {
  if (targetMaterialIds.length === 0)
    throw new Error('Surface binding requires at least one target material');
  const targets = new Set(targetMaterialIds);
  if (targets.size !== targetMaterialIds.length)
    throw new Error('Surface binding target materials must be unique');
  for (const targetMaterialId of targets)
    if (!geometry.materials.some((material) => material.id === targetMaterialId))
      throw new Error(
        `Geometry '${geometry.id}' has no material '${targetMaterialId}' for surface binding`,
      );
  const colors = surface.baseColor.colors;
  const retainedBindings = ((geometry.metadata.surfaceBindings as unknown[]) ?? []).filter(
    (binding) => {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return true;
      const target = (binding as { targetMaterialId?: unknown }).targetMaterialId;
      return typeof target !== 'string' || !targets.has(target);
    },
  );
  const averageColor = colors
    .reduce(
      (sum, color) =>
        sum.map((value, index) => value + color[index]!) as [number, number, number, number],
      [0, 0, 0, 0] as [number, number, number, number],
    )
    .map((value) => value / colors.length) as [number, number, number, number];
  const output = {
    ...structuredClone(geometry),
    materials: geometry.materials.map((material) =>
      targets.has(material.id)
        ? {
            ...material,
            baseColor: averageColor,
            roughness: (surface.roughness.minimum + surface.roughness.maximum) / 2,
            metallic: surface.metallic,
            surface,
          }
        : material,
    ),
    metadata: {
      ...geometry.metadata,
      surfaceBindings: [
        ...retainedBindings,
        ...targetMaterialIds.map((targetMaterialId) => ({
          targetMaterialId,
          surfaceMaterial: surface.id,
        })),
      ],
    },
  };
  const validation = validateGeometry(output);
  if (!validation.valid)
    throw new Error(
      `Surface binding failed geometry validation: ${validation.issues.map((issue) => issue.message).join('; ')}`,
    );
  return output;
}
