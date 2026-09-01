import type { CinematicScene } from './model.js';

/** Canonical final clip name for edit assembly, including deterministic post-render overlays. */
export function cinematicDeliveryFilename(scene: CinematicScene) {
  const name = scene.id.split('.').at(-1)!;
  return `${name}${scene.finishProfilePath ? '-finished' : scene.overlays.length ? '-composited' : ''}.mp4`;
}
