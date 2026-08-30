import { describe, expect, it } from 'vitest';
import { storyboardSchema } from '../src/domain/schemas.js';
import { cameraTransform } from '../src/scene/camera.js';
import { isVisibleAt, numericDepth, sceneItemOrder } from '../src/scene/model.js';
import {
  effectPresetNames,
  resolveEffectBundle,
  resolveEffectPreset,
} from '../src/vfx/registry.js';

const sceneShot = {
  id: 'layered',
  type: 'scene',
  startSeconds: 0,
  durationSeconds: 3,
  scene: {
    camera: { preset: 'slow-push-in' },
    layers: [
      {
        id: 'front',
        type: 'particle-system',
        preset: 'embers',
        depth: 'foreground',
        start: 1,
        end: 2.5,
      },
      { id: 'back', type: 'shape', shape: 'rectangle', depth: 'background' },
    ],
  },
};

describe('scene domain', () => {
  it('parses rich scenes while legacy storyboards remain compatible', () => {
    const rich = storyboardSchema.parse({
      schemaVersion: 1,
      campaignId: 'x',
      title: 'x',
      durationSeconds: 3,
      style: 'cinematic-fantasy',
      shots: [sceneShot],
    });
    expect(rich.shots[0]!.type).toBe('scene');
    expect(() =>
      storyboardSchema.parse({
        schemaVersion: 1,
        campaignId: 'x',
        title: 'x',
        durationSeconds: 1,
        style: 'saas-promo',
        shots: [{ id: 'old', type: 'static', startSeconds: 0, durationSeconds: 1 }],
      }),
    ).not.toThrow();
  });
  it('sorts layers by semantic depth and z-index', () => {
    expect(numericDepth('foreground')).toBeGreaterThan(numericDepth('midground'));
    expect(sceneItemOrder({ depth: 'background', zIndex: 9 })).toBeLessThan(
      sceneItemOrder({ depth: 'foreground', zIndex: -9 }),
    );
  });
  it('honours layer timing', () => {
    expect(isVisibleAt({ start: 1, end: 2 }, 0.9)).toBe(false);
    expect(isVisibleAt({ start: 1, end: 2 }, 1)).toBe(true);
    expect(isVisibleAt({ start: 1, end: 2 }, 2)).toBe(false);
  });
  it('calculates stronger parallax for nearer layers', () => {
    expect(cameraTransform('push-in', 'foreground', 1).scale).toBeGreaterThan(
      cameraTransform('push-in', 'background', 1).scale,
    );
    expect(cameraTransform('track-right', 'foreground', 1).x).toBeGreaterThan(
      cameraTransform('track-right', 'background', 1).x,
    );
  });
  it('validates masks, transforms, duplicate ids, and timing', () => {
    expect(() =>
      storyboardSchema.parse({
        schemaVersion: 1,
        campaignId: 'x',
        title: 'x',
        durationSeconds: 3,
        style: 'cinematic-fantasy',
        shots: [
          {
            ...sceneShot,
            scene: {
              layers: [
                {
                  id: 'same',
                  type: 'shape',
                  shape: 'circle',
                  mask: { type: 'circle', x: 50, y: 50, radius: 25 },
                  transform: { x: 3, scale: 1.2 },
                },
                { id: 'same', type: 'effect', preset: 'fog' },
              ],
            },
          },
        ],
      }),
    ).toThrow(/duplicate scene item/);
    expect(() =>
      storyboardSchema.parse({
        schemaVersion: 1,
        campaignId: 'x',
        title: 'x',
        durationSeconds: 3,
        style: 'cinematic-fantasy',
        shots: [
          {
            ...sceneShot,
            scene: { layers: [{ id: 'bad', type: 'shape', shape: 'circle', start: 2, end: 1 }] },
          },
        ],
      }),
    ).toThrow(/end must be greater/);
  });
  it('resolves effect presets and composable bundles', () => {
    for (const name of effectPresetNames) expect(resolveEffectPreset(name).name).toBe(name);
    expect(resolveEffectBundle('demonic-atmosphere').length).toBeGreaterThan(1);
    expect(() => resolveEffectPreset('missing')).toThrow(/Unknown VFX preset/);
    expect(() => resolveEffectPreset('flash', { at: 2 })).toThrow(/between 0 and 1/);
  });
});
