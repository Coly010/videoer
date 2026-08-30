import type { SceneLayer } from '../scene/model.js';
import { resolveEffectPreset } from '../vfx/registry.js';

export type RendererBackendId = 'react-dom' | 'pixi-2d';
export interface RendererRegistration {
  layerType: SceneLayer['type'];
  backend: RendererBackendId;
}

export const rendererRegistry: ReadonlyMap<SceneLayer['type'], RendererRegistration> = new Map([
  ['image', { layerType: 'image', backend: 'react-dom' }],
  ['video', { layerType: 'video', backend: 'react-dom' }],
  ['text', { layerType: 'text', backend: 'react-dom' }],
  ['shape', { layerType: 'shape', backend: 'react-dom' }],
  ['sprite', { layerType: 'sprite', backend: 'react-dom' }],
  ['particle-system', { layerType: 'particle-system', backend: 'pixi-2d' }],
  ['effect', { layerType: 'effect', backend: 'react-dom' }],
]);

export function rendererFor(layer: SceneLayer): RendererBackendId {
  if (layer.type === 'effect')
    return resolveEffectPreset(layer.preset).backend === 'pixi' ? 'pixi-2d' : 'react-dom';
  const registration = rendererRegistry.get(layer.type);
  if (!registration) throw new Error(`No renderer registered for scene layer type '${layer.type}'`);
  return registration.backend;
}
