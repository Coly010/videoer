import { atmosphericVfxSchema, type AtmosphericVfx } from './model.js';

export function createRainyDuskVfx(): AtmosphericVfx {
  return atmosphericVfxSchema.parse({
    schemaVersion: 1,
    id: 'vfx.rainy-dusk-depth',
    placement: 'camera-relative',
    worldColor: [0.006, 0.012, 0.025],
    fog: { density: 0.008, color: [0.16, 0.2, 0.28] },
    rain: {
      enabled: true,
      windMetersPerSecond: [1.15, -0.22],
      surfaceFlux: {
        intensityMillimetersPerHour: 18,
        durationSeconds: 900,
        dropDiameterMillimeters: 1.8,
        impactSpeedMetersPerSecond: 7.4,
      },
      layers: [
        {
          id: 'foreground',
          count: 58,
          seed: 1701,
          depthMinimumMeters: 1.4,
          depthMaximumMeters: 3.2,
          horizontalSpanMeters: 6.4,
          verticalSpanMeters: 5.2,
          streakLengthMeters: 0.11,
          streakRadiusMeters: 0.0012,
          fallSpeedMetersPerSecond: 10.5,
          opacity: 0.28,
          color: [0.42, 0.62, 0.86],
        },
        {
          id: 'midground',
          count: 168,
          seed: 1702,
          depthMinimumMeters: 3.2,
          depthMaximumMeters: 6.5,
          horizontalSpanMeters: 10,
          verticalSpanMeters: 6.5,
          streakLengthMeters: 0.09,
          streakRadiusMeters: 0.0011,
          fallSpeedMetersPerSecond: 8.5,
          opacity: 0.25,
          color: [0.35, 0.55, 0.8],
        },
        {
          id: 'background',
          count: 260,
          seed: 1703,
          depthMinimumMeters: 6.5,
          depthMaximumMeters: 16,
          horizontalSpanMeters: 18,
          verticalSpanMeters: 9,
          streakLengthMeters: 0.06,
          streakRadiusMeters: 0.0007,
          fallSpeedMetersPerSecond: 7,
          opacity: 0.16,
          color: [0.3, 0.48, 0.72],
        },
      ],
      groundSplashes: {
        enabled: true,
        count: 58,
        seed: 1711,
        boundsMinimum: [-3.8, 0.015, -3.5],
        boundsMaximum: [5.2, 0.04, -1.05],
        radiusMinimumMeters: 0.008,
        radiusMaximumMeters: 0.026,
        crownHeightMeters: 0.012,
        lifetimeSeconds: 0.32,
        opacity: 0.18,
        color: [0.38, 0.58, 0.82],
      },
    },
    metadata: {
      generator: 'videoer.camera-depth-rain.v1',
      deterministicSeeds: [1701, 1702, 1703],
      separation: 'foreground-midground-background',
    },
  });
}

export function toCinematicAtmosphere(vfx: AtmosphericVfx) {
  return {
    worldColor: vfx.worldColor,
    fogDensity: vfx.fog.density,
    fogColor: vfx.fog.color,
    rain: vfx.rain,
  };
}
