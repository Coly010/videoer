import type { SceneCameraPresets } from './types-internal.js';
import { numericDepth, type SceneDepth } from './model.js';

export interface CameraTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}
const ease = (value: number, kind: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out') => {
  if (kind === 'linear') return value;
  if (kind === 'ease-in') return value * value;
  if (kind === 'ease-out') return 1 - (1 - value) ** 2;
  return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
};

export function cameraTransform(
  preset: SceneCameraPresets,
  depth: SceneDepth,
  progressInput: number,
  intensity = 1,
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' = 'ease-in-out',
): CameraTransform {
  const progress = ease(Math.min(1, Math.max(0, progressInput)), easing);
  const depthFactor = 0.28 + (numericDepth(depth) / 100) * 0.72;
  const amount = intensity * depthFactor;
  const wave = Math.sin(progress * Math.PI * 2);
  switch (preset) {
    case 'push-in':
      return { x: 0, y: 0, scale: 1 + progress * 0.11 * amount, rotation: 0 };
    case 'slow-push-in':
      return { x: 0, y: 0, scale: 1 + progress * 0.065 * amount, rotation: 0 };
    case 'pull-out':
      return { x: 0, y: 0, scale: 1.1 - progress * 0.1 * amount, rotation: 0 };
    case 'pan':
    case 'track-right':
      return { x: (-2.5 + progress * 5) * amount, y: 0, scale: 1.06, rotation: 0 };
    case 'track-left':
      return { x: (2.5 - progress * 5) * amount, y: 0, scale: 1.06, rotation: 0 };
    case 'pan-up':
      return { x: 0, y: (2.5 - progress * 5) * amount, scale: 1.06, rotation: 0 };
    case 'pan-down':
      return { x: 0, y: (-2.5 + progress * 5) * amount, scale: 1.06, rotation: 0 };
    case 'drift':
      return {
        x: wave * 1.25 * amount,
        y: Math.cos(progress * Math.PI) * 0.7 * amount,
        scale: 1.025,
        rotation: wave * 0.12 * amount,
      };
    case 'shake':
      return {
        x: Math.sin(progress * 97) * 0.55 * amount,
        y: Math.sin(progress * 137) * 0.42 * amount,
        scale: 1.018,
        rotation: Math.sin(progress * 83) * 0.08 * amount,
      };
    case 'handheld':
      return {
        x: (Math.sin(progress * 31) + Math.sin(progress * 73) * 0.4) * 0.45 * amount,
        y: Math.sin(progress * 47) * 0.35 * amount,
        scale: 1.025,
        rotation: Math.sin(progress * 29) * 0.1 * amount,
      };
    case 'punch':
      return {
        x: 0,
        y: 0,
        scale: 1 + Math.sin(Math.min(1, progress * 2) * Math.PI) * 0.12 * amount,
        rotation: 0,
      };
    case 'scale-pop':
      return { x: 0, y: 0, scale: 0.78 + Math.min(1, progress * 4) * 0.22, rotation: 0 };
    case 'slide-in':
      return { x: (1 - Math.min(1, progress * 4)) * 16 * amount, y: 0, scale: 1, rotation: 0 };
    default:
      return { x: 0, y: 0, scale: 1, rotation: 0 };
  }
}

export function cameraCss(transform: CameraTransform): string {
  return `translate(${transform.x}%, ${transform.y}%) scale(${transform.scale}) rotate(${transform.rotation}deg)`;
}
