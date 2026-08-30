export const effectPresetNames = [
  'fog',
  'low-fog',
  'smoke',
  'haze',
  'light-mist',
  'film-grain',
  'animated-grain',
  'vignette',
  'chromatic-aberration',
  'camera-shake',
  'light-leak',
  'flash',
  'blur-pulse',
  'rack-focus',
  'glow',
  'flicker',
  'pulse',
  'bloom',
  'animated-illumination',
  'displacement',
  'heat-shimmer',
  'magical-warping',
  'screen-distortion',
  'glitch',
  'letterbox',
  'lens-dirt',
  'exposure-flicker',
  'motion-blur',
] as const;
export type EffectPresetName = (typeof effectPresetNames)[number];
export type EffectBackend = 'react' | 'pixi';

export interface EffectDefinition {
  name: EffectPresetName;
  backend: EffectBackend;
  family: 'atmosphere' | 'camera' | 'light' | 'distortion' | 'finish';
  description: string;
}

const pixi = new Set<EffectPresetName>([
  'fog',
  'low-fog',
  'smoke',
  'light-mist',
  'light-leak',
  'glow',
  'bloom',
  'animated-illumination',
  'displacement',
  'heat-shimmer',
  'magical-warping',
]);
const atmosphere = new Set<EffectPresetName>(['fog', 'low-fog', 'smoke', 'haze', 'light-mist']);
const camera = new Set<EffectPresetName>([
  'camera-shake',
  'blur-pulse',
  'rack-focus',
  'motion-blur',
]);
const light = new Set<EffectPresetName>([
  'light-leak',
  'flash',
  'glow',
  'flicker',
  'pulse',
  'bloom',
  'animated-illumination',
  'exposure-flicker',
]);
const distortion = new Set<EffectPresetName>([
  'chromatic-aberration',
  'displacement',
  'heat-shimmer',
  'magical-warping',
  'screen-distortion',
  'glitch',
]);

export const effectRegistry: ReadonlyMap<EffectPresetName, EffectDefinition> = new Map(
  effectPresetNames.map((name) => [
    name,
    {
      name,
      backend: pixi.has(name) ? 'pixi' : 'react',
      family: atmosphere.has(name)
        ? 'atmosphere'
        : camera.has(name)
          ? 'camera'
          : light.has(name)
            ? 'light'
            : distortion.has(name)
              ? 'distortion'
              : 'finish',
      description: name.replaceAll('-', ' '),
    },
  ]),
);

export const effectBundleNames = [
  'demonic-atmosphere',
  'magical-reveal',
  'product-polish',
] as const;
export type EffectBundleName = (typeof effectBundleNames)[number];
export interface EffectBundleItem {
  preset: EffectPresetName;
  intensity: number;
  params?: Record<string, unknown>;
}
const bundles: Record<EffectBundleName, EffectBundleItem[]> = {
  'demonic-atmosphere': [
    { preset: 'low-fog', intensity: 0.5 },
    { preset: 'flicker', intensity: 0.22 },
    { preset: 'film-grain', intensity: 0.22 },
    { preset: 'vignette', intensity: 0.55 },
  ],
  'magical-reveal': [
    { preset: 'glow', intensity: 0.55 },
    { preset: 'pulse', intensity: 0.5 },
    { preset: 'flash', intensity: 0.45, params: { at: 0.62 } },
    { preset: 'chromatic-aberration', intensity: 0.18 },
  ],
  'product-polish': [
    { preset: 'animated-illumination', intensity: 0.25 },
    { preset: 'glow', intensity: 0.18 },
    { preset: 'vignette', intensity: 0.12 },
  ],
};

export function resolveEffectPreset(
  name: string,
  params: Record<string, unknown> = {},
): EffectDefinition {
  const effect = effectRegistry.get(name as EffectPresetName);
  if (!effect) throw new Error(`Unknown VFX preset '${name}'`);
  if (params.intensity !== undefined && typeof params.intensity !== 'number')
    throw new Error(`VFX preset '${name}' parameter 'intensity' must be a number`);
  if (params.color !== undefined && typeof params.color !== 'string')
    throw new Error(`VFX preset '${name}' parameter 'color' must be a string`);
  if (params.at !== undefined && (typeof params.at !== 'number' || params.at < 0 || params.at > 1))
    throw new Error(`VFX preset '${name}' parameter 'at' must be between 0 and 1`);
  return effect;
}
export function resolveEffectBundle(name: string): EffectBundleItem[] {
  if (!effectBundleNames.includes(name as EffectBundleName))
    throw new Error(`Unknown VFX bundle '${name}'`);
  return bundles[name as EffectBundleName].map((item) => ({
    ...item,
    ...(item.params ? { params: { ...item.params } } : {}),
  }));
}
export const isEffectBundle = (name: string): name is EffectBundleName =>
  effectBundleNames.includes(name as EffectBundleName);
