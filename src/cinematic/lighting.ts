import type { LightingRig } from '../lighting/model.js';
import type { CinematicScene } from './model.js';

export const rigWorldColorPrecedence = 'lighting-rig-over-scene-atmosphere' as const;

/**
 * A bound lighting rig owns the world illumination colour. Shot atmosphere still owns fog,
 * rain, and aerosols; scenes without a rig retain their declared atmosphere world colour.
 */
export function resolveRigBoundAtmosphere(
  atmosphere: CinematicScene['atmosphere'],
  lightingRig: LightingRig | undefined,
): CinematicScene['atmosphere'] {
  return {
    ...atmosphere,
    worldColor: lightingRig ? [...lightingRig.worldColor] : [...atmosphere.worldColor],
  };
}
