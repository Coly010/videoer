import { lightingRigSchema } from './model.js';

export function createDuskExteriorLightingRig() {
  return lightingRigSchema.parse({
    schemaVersion: 1,
    id: 'lighting.bookshop-dusk-exterior',
    exposure: { look: 'AgX - Medium High Contrast', coherentAcrossShots: true },
    worldColor: [0.006, 0.012, 0.025],
    lights: [
      {
        id: 'rainy-exterior-key',
        type: 'area',
        position: [-2.4, 3.4, -2.8],
        target: [0, 1, -0.2],
        color: [0.35, 0.55, 1],
        energy: 420,
        sizeMeters: 4.2,
        purpose: 'environment',
      },
      {
        id: 'rainy-sky-fill',
        type: 'area',
        position: [2.2, 6.8, -2.1],
        target: [0, 1.5, -1.2],
        color: [0.22, 0.34, 0.62],
        energy: 180,
        sizeMeters: 6,
        purpose: 'fill',
      },
      {
        id: 'bookshop-interior-glow',
        type: 'area',
        position: [0.2, 2.5, 2.2],
        target: [0, 1, 0],
        color: [1, 0.43, 0.16],
        energy: 720,
        sizeMeters: 2.4,
        purpose: 'practical',
      },
      {
        id: 'threshold-rim',
        type: 'spot',
        position: [1.4, 2.4, -0.6],
        target: [0, 1, 0.15],
        color: [0.62, 0.75, 1],
        energy: 300,
        angleDegrees: 58,
        purpose: 'rim',
      },
      {
        id: 'shop-window-character-key',
        type: 'area',
        position: [2.5, 2.7, -0.25],
        target: [2, 1.05, -1.3],
        color: [1, 0.58, 0.3],
        energy: 360,
        sizeMeters: 2.4,
        purpose: 'key',
      },
    ],
    metadata: {
      context: 'rainy-old-city-bookshop-exterior',
      practicalColorContrast: 'warm-window-cool-dusk',
      balanceStrategy: 'soft-environment-key-plus-large-sky-fill-with-local-practicals',
    },
  });
}

export function createWarmInteriorLightingRig() {
  return lightingRigSchema.parse({
    schemaVersion: 1,
    id: 'lighting.bookshop-warm-interior',
    exposure: { look: 'AgX - Medium High Contrast', coherentAcrossShots: true },
    worldColor: [0.009, 0.006, 0.004],
    lights: [
      {
        id: 'warm-reading-key',
        type: 'area',
        position: [-1.5, 2.5, 3.4],
        target: [0.45, 1.2, 2.4],
        color: [1, 0.7, 0.46],
        energy: 430,
        sizeMeters: 1.25,
        purpose: 'key',
      },
      {
        id: 'cool-window-fill',
        type: 'area',
        position: [2.15, 2.05, 3.05],
        target: [0.45, 1.2, 2.4],
        color: [0.34, 0.57, 1],
        energy: 300,
        sizeMeters: 2.9,
        purpose: 'fill',
      },
      {
        id: 'shelf-rim',
        type: 'spot',
        position: [0.55, 2.75, 1.15],
        target: [0.45, 1.25, 2.5],
        color: [1, 0.62, 0.34],
        energy: 230,
        angleDegrees: 42,
        purpose: 'rim',
      },
    ],
    metadata: {
      context: 'warm-bookshop-interior',
      faceKey: 'warm-reading-key',
      windowFill: 'cool-window-fill',
      balanceStrategy: 'off-axis-warm-key-plus-camera-side-cool-fill-and-rear-shelf-rim',
    },
  });
}

export function cinematicLights(rig: ReturnType<typeof createDuskExteriorLightingRig>) {
  return rig.lights.map((source) => {
    const { purpose, ...light } = source;
    void purpose;
    return light;
  });
}
