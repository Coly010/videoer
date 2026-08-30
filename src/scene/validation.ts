import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Storyboard } from '../domain/schemas.js';
import { resolveParticlePreset } from '../particles/presets.js';
import { rendererFor } from '../renderers/registry.js';
import { isEffectBundle, resolveEffectBundle, resolveEffectPreset } from '../vfx/registry.js';

export interface SceneValidationIssue {
  shotId: string;
  itemId: string;
  renderer: string;
  cause: string;
}
export interface SceneValidationResult {
  valid: boolean;
  scenes: number;
  layers: number;
  effects: number;
  issues: SceneValidationIssue[];
}

export async function validateStoryboardScenes(
  storyboard: Storyboard,
  campaignFile: string,
): Promise<SceneValidationResult> {
  const issues: SceneValidationIssue[] = [];
  let scenes = 0;
  let layers = 0;
  let effects = 0;
  const root = dirname(resolve(campaignFile));
  for (const shot of storyboard.shots) {
    if (shot.type !== 'scene') continue;
    scenes++;
    layers += shot.scene.layers.length;
    effects += shot.scene.effects.length;
    for (const layer of shot.scene.layers) {
      let renderer = 'unresolved';
      try {
        if (layer.type === 'effect' && isEffectBundle(layer.preset)) {
          for (const item of resolveEffectBundle(layer.preset))
            resolveEffectPreset(item.preset, { ...item.params, ...layer.params });
          continue;
        }
        renderer = rendererFor(layer);
        if (layer.type === 'particle-system') resolveParticlePreset(layer.preset, layer.params);
        if (layer.type === 'effect') resolveEffectPreset(layer.preset, layer.params);
        if ('asset' in layer) await access(resolve(root, layer.asset));
        if (layer.mask?.type === 'asset') await access(resolve(root, layer.mask.asset));
      } catch (error) {
        issues.push({
          shotId: shot.id,
          itemId: layer.id,
          renderer,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const effect of shot.scene.effects) {
      try {
        resolveEffectPreset(effect.type, effect.params);
      } catch (error) {
        issues.push({
          shotId: shot.id,
          itemId: effect.id,
          renderer: 'effect-registry',
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { valid: issues.length === 0, scenes, layers, effects, issues };
}
