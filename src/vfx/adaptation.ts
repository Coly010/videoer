import { atmosphericVfxSchema, type AtmosphericVfx } from './model.js';

export interface AtmosphericTreatment {
  assetId: string;
  worldColor?: [number, number, number] | undefined;
  fog?:
    | {
        density?: number | undefined;
        color?: [number, number, number] | undefined;
      }
    | undefined;
  rain?:
    | {
        enabled?: boolean | undefined;
        layers?:
          | Array<{
              id: 'foreground' | 'midground' | 'background';
              count?: number | undefined;
              streakLengthMeters?: number | undefined;
              streakRadiusMeters?: number | undefined;
              fallSpeedMetersPerSecond?: number | undefined;
              opacity?: number | undefined;
              color?: [number, number, number] | undefined;
            }>
          | undefined;
        groundSplashes?:
          | {
              boundsMinimum: [number, number, number];
              boundsMaximum: [number, number, number];
            }
          | undefined;
      }
    | undefined;
  metadata?: Record<string, unknown> | undefined;
}

const invariantLayerFields = [
  'id',
  'seed',
  'depthMinimumMeters',
  'depthMaximumMeters',
  'horizontalSpanMeters',
  'verticalSpanMeters',
] as const;

export function adaptAtmosphericVfx(
  base: AtmosphericVfx,
  treatment: AtmosphericTreatment,
): AtmosphericVfx {
  const layerOverrides = new Map((treatment.rain?.layers ?? []).map((layer) => [layer.id, layer]));
  return atmosphericVfxSchema.parse({
    ...structuredClone(base),
    id: treatment.assetId,
    ...(treatment.worldColor ? { worldColor: treatment.worldColor } : {}),
    fog: {
      ...base.fog,
      ...(treatment.fog?.density !== undefined ? { density: treatment.fog.density } : {}),
      ...(treatment.fog?.color ? { color: treatment.fog.color } : {}),
    },
    rain: {
      ...base.rain,
      ...(treatment.rain?.enabled !== undefined ? { enabled: treatment.rain.enabled } : {}),
      layers: base.rain.layers.map((layer) => {
        const override = layerOverrides.get(layer.id);
        if (!override) return layer;
        return {
          ...layer,
          ...(override.count !== undefined ? { count: override.count } : {}),
          ...(override.streakLengthMeters !== undefined
            ? { streakLengthMeters: override.streakLengthMeters }
            : {}),
          ...(override.streakRadiusMeters !== undefined
            ? { streakRadiusMeters: override.streakRadiusMeters }
            : {}),
          ...(override.fallSpeedMetersPerSecond !== undefined
            ? { fallSpeedMetersPerSecond: override.fallSpeedMetersPerSecond }
            : {}),
          ...(override.opacity !== undefined ? { opacity: override.opacity } : {}),
          ...(override.color ? { color: override.color } : {}),
        };
      }),
      ...(treatment.rain?.groundSplashes && base.rain.groundSplashes
        ? {
            groundSplashes: {
              ...base.rain.groundSplashes,
              boundsMinimum: treatment.rain.groundSplashes.boundsMinimum,
              boundsMaximum: treatment.rain.groundSplashes.boundsMaximum,
            },
          }
        : {}),
    },
    metadata: {
      ...base.metadata,
      ...treatment.metadata,
      sourceVfx: base.id,
      adaptationGenerator: 'videoer.atmospheric-treatment.v1',
    },
  });
}

export function verifyAtmosphericVfxAdaptation(base: AtmosphericVfx, adapted: AtmosphericVfx) {
  const issues: string[] = [];
  const parsed = atmosphericVfxSchema.safeParse(adapted);
  if (!parsed.success)
    issues.push(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  if (base.id === adapted.id) issues.push('adapted VFX must have a distinct asset id');
  if (adapted.placement !== base.placement) issues.push('camera-relative placement changed');
  if (adapted.rain.layers.length !== base.rain.layers.length)
    issues.push('rain layer topology changed');
  for (const [index, baseLayer] of base.rain.layers.entries()) {
    const adaptedLayer = adapted.rain.layers[index];
    if (!adaptedLayer) continue;
    for (const field of invariantLayerFields)
      if (adaptedLayer[field] !== baseLayer[field])
        issues.push(`rain layer ${baseLayer.id} changed invariant '${field}'`);
  }
  const baseSplashes = base.rain.groundSplashes;
  const adaptedSplashes = adapted.rain.groundSplashes;
  if (Boolean(baseSplashes) !== Boolean(adaptedSplashes))
    issues.push('ground-splash topology changed');
  if (baseSplashes && adaptedSplashes)
    for (const field of [
      'enabled',
      'count',
      'seed',
      'radiusMinimumMeters',
      'radiusMaximumMeters',
      'crownHeightMeters',
      'lifetimeSeconds',
      'opacity',
      'color',
    ] as const)
      if (JSON.stringify(adaptedSplashes[field]) !== JSON.stringify(baseSplashes[field]))
        issues.push(`ground splashes changed invariant '${field}'`);
  const changedFields: string[] = [];
  if (JSON.stringify(base.worldColor) !== JSON.stringify(adapted.worldColor))
    changedFields.push('worldColor');
  if (base.fog.density !== adapted.fog.density) changedFields.push('fog.density');
  if (JSON.stringify(base.fog.color) !== JSON.stringify(adapted.fog.color))
    changedFields.push('fog.color');
  if (base.rain.enabled !== adapted.rain.enabled) changedFields.push('rain.enabled');
  for (const [index, baseLayer] of base.rain.layers.entries()) {
    const adaptedLayer = adapted.rain.layers[index];
    if (!adaptedLayer) continue;
    for (const field of [
      'count',
      'streakLengthMeters',
      'streakRadiusMeters',
      'fallSpeedMetersPerSecond',
      'opacity',
      'color',
    ] as const)
      if (JSON.stringify(adaptedLayer[field]) !== JSON.stringify(baseLayer[field]))
        changedFields.push(`rain.layers.${baseLayer.id}.${field}`);
  }
  if (
    baseSplashes &&
    adaptedSplashes &&
    JSON.stringify(baseSplashes.boundsMinimum) !== JSON.stringify(adaptedSplashes.boundsMinimum)
  )
    changedFields.push('rain.groundSplashes.boundsMinimum');
  if (
    baseSplashes &&
    adaptedSplashes &&
    JSON.stringify(baseSplashes.boundsMaximum) !== JSON.stringify(adaptedSplashes.boundsMaximum)
  )
    changedFields.push('rain.groundSplashes.boundsMaximum');
  if (!changedFields.length) issues.push('atmospheric treatment made no semantic change');
  return {
    valid: issues.length === 0,
    issues,
    placementPreserved: adapted.placement === base.placement,
    deterministicLayerTopologyPreserved:
      adapted.rain.layers.length === base.rain.layers.length &&
      base.rain.layers.every((layer, index) =>
        invariantLayerFields.every((field) => adapted.rain.layers[index]?.[field] === layer[field]),
      ),
    changedFields,
  };
}
