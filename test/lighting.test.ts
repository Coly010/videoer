import { describe, expect, it } from 'vitest';
import {
  createDuskExteriorLightingRig,
  createWarmInteriorLightingRig,
} from '../src/lighting/bookshop.js';
import { adaptLightingRig, verifyLightingRigAdaptation } from '../src/lighting/adaptation.js';
import { createInteriorLightingWitness } from '../src/lighting/witness.js';
import { validateGeometry } from '../src/geometry/model.js';
import { createMoonlitExteriorLightingRig } from '../src/lighting/moonlit.js';
import {
  createContemporaryFireLoungeHost,
  createContemporaryRooftopHost,
  createFirelitChamberHost,
  createMoonlitCourtyardHost,
} from '../src/lighting/hosts.js';
import { createFirelitInteriorLightingRig } from '../src/lighting/firelit.js';
import { lightingRigSchema } from '../src/lighting/model.js';
import { blackbodyRgb, temporalLightingEvidencePass } from '../src/lighting/temporal-evidence.js';

const galleryAdaptation = {
  kind: 'lighting-rig-transform-v1' as const,
  assetId: 'lighting.gallery-stage',
  transform: {
    translation: [1.2, 0.3, -2.4] as [number, number, number],
    yawRadians: 0.4,
    uniformScale: 1.15,
  },
  energyScale: 0.82,
  purposeEnergyScale: { key: 1.2, fill: 0.8, rim: 1.1, practical: 0.9, environment: 0.75 },
  colorMultiply: [0.94, 0.9, 1] as [number, number, number],
  metadata: { usage: 'gallery-stage' },
};

describe('bookshop lighting rigs', () => {
  it('provides a static multi-response witness with no motion dependency', () => {
    const witness = createInteriorLightingWitness();
    expect(validateGeometry(witness).valid).toBe(true);
    expect(witness.skeleton.map((joint) => joint.id)).toEqual(['root']);
    expect(witness.metadata).toMatchObject({
      productionCharacter: false,
      motionDependency: 'none',
    });
    expect(witness.materials.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'skin-witness',
        'cloth-witness',
        'neutral-grey',
        'glossy-ceramic',
        'dark-metal',
        'structured-wood',
        'warm-plaster',
      ]),
    );
  });

  it('separates cool dusk environment light from warm practicals', () => {
    const rig = createDuskExteriorLightingRig();
    expect(rig.exposure.coherentAcrossShots).toBe(true);
    expect(
      rig.lights.some((light) => light.purpose === 'practical' && light.color[0] > light.color[2]),
    ).toBe(true);
    expect(
      rig.lights.some(
        (light) => light.purpose === 'environment' && light.color[2] > light.color[0],
      ),
    ).toBe(true);
    expect(rig.lights.some((light) => light.purpose === 'fill' && light.sizeMeters === 6)).toBe(
      true,
    );
    const key = rig.lights.find((light) => light.id === 'rainy-exterior-key')!;
    const fill = rig.lights.find((light) => light.id === 'rainy-sky-fill')!;
    expect(fill.energy).toBeLessThan(key.energy);
  });

  it('defines an explicit warm face key and cool window fill', () => {
    const rig = createWarmInteriorLightingRig();
    const key = rig.lights.find((light) => light.purpose === 'key')!;
    const fill = rig.lights.find((light) => light.purpose === 'fill')!;
    expect(key.color[0]).toBeGreaterThan(key.color[2]);
    expect(fill.color[2]).toBeGreaterThan(fill.color[0]);
    expect(rig.metadata).toMatchObject({ faceKey: key.id, windowFill: fill.id });
    expect(key.target).toBeDefined();
    expect(fill.target).toBeDefined();
    expect(key.position[0]).toBeLessThan(key.target![0]);
    expect(fill.position[0]).toBeGreaterThan(fill.target![0]);
    expect(key.position[2]).toBeGreaterThan(key.target![2]);
    expect(fill.position[2]).toBeGreaterThan(fill.target![2]);
    const rim = rig.lights.find((light) => light.purpose === 'rim')!;
    expect(rim.target).toBeDefined();
    expect(rim.position[2]).toBeLessThan(rim.target![2]);
    expect(key.sizeMeters).toBeLessThan(fill.sizeMeters!);
  });

  it('defines a complete moonlit exterior role topology and two valid unrelated hosts', () => {
    const rig = createMoonlitExteriorLightingRig();
    expect(rig.id).toBe('lighting.moonlit-exterior');
    expect(new Set(rig.lights.map((light) => light.purpose))).toEqual(
      new Set(['key', 'environment', 'rim', 'practical', 'fill']),
    );
    const moon = rig.lights.find((light) => light.id === 'moon-directional-key')!;
    const practical = rig.lights.find((light) => light.id === 'warm-aperture-practical')!;
    expect(moon.color[2]).toBeGreaterThan(moon.color[0]);
    expect(practical.color[0]).toBeGreaterThan(practical.color[2]);
    const courtyard = createMoonlitCourtyardHost();
    const rooftop = createContemporaryRooftopHost();
    expect(validateGeometry(courtyard).valid).toBe(true);
    expect(validateGeometry(rooftop).valid).toBe(true);
    expect(courtyard.metadata.hostClass).toBe('historic-courtyard');
    expect(rooftop.metadata.hostClass).toBe('contemporary-rooftop');
    expect(courtyard.id).not.toBe(rooftop.id);
  });

  it('defines correlated source-bound firelight and valid unrelated interior hosts', () => {
    const rig = createFirelitInteriorLightingRig();
    const modulated = rig.lights.filter((light) => light.temporalModulation);
    expect(modulated).toHaveLength(4);
    expect(new Set(modulated.map((light) => light.temporalSignalId))).toEqual(
      new Set(['primary-fire']),
    );
    expect(modulated.filter((light) => light.visibleSourceRole === 'primary-fire')).toHaveLength(1);
    expect(
      rig.lights.some((light) => !light.temporalModulation && light.purpose === 'environment'),
    ).toBe(true);
    const chamber = createFirelitChamberHost();
    const lounge = createContemporaryFireLoungeHost();
    expect(validateGeometry(chamber).valid).toBe(true);
    expect(validateGeometry(lounge).valid).toBe(true);
    expect(chamber.metadata.hostClass).toBe('historic-firelit-chamber');
    expect(lounge.metadata.hostClass).toBe('contemporary-fire-lounge');
    expect(
      chamber.materials.find((entry) => entry.id === 'hearth-embers')?.emissionStrength,
    ).toBeGreaterThan(0);
    expect(chamber.id).not.toBe(lounge.id);
  });

  it('rejects conflicting modulation definitions on one semantic signal', () => {
    const value = createFirelitInteriorLightingRig();
    const conflicting = structuredClone(value);
    conflicting.lights[1]!.temporalModulation!.frequencyHz += 0.2;
    expect(() => lightingRigSchema.parse(conflicting)).toThrow(/identical modulation/);
  });

  it('validates authoritative correlated temporal and visible-source evidence', () => {
    const rig = createFirelitInteriorLightingRig();
    const multipliers = [0.84, 0.87, 0.92, 1.04, 1.1, 1.08, 0.96, 0.83, 0.88, 1.02, 1.11, 0.9];
    const kelvin = [1340, 1410, 1490, 1640, 1810, 1740, 1570, 1320, 1450, 1690, 1830, 1510];
    const report = {
      schemaVersion: 1,
      frameCount: 12,
      lights: rig.lights
        .filter((light) => light.temporalModulation)
        .map((light) => ({
          lightId: light.id,
          kind: light.temporalModulation!.kind,
          seed: light.temporalModulation!.seed,
          frequencyHz: light.temporalModulation!.frequencyHz,
          temporalSignalId: light.temporalSignalId,
          visibleSourceRole: light.visibleSourceRole,
          baseEnergy: light.energy,
          baseColor: light.color,
          samples: multipliers.map((intensityMultiplier, index) => ({
            frame: index + 1,
            intensityMultiplier,
            powerWatts: light.energy * intensityMultiplier,
            colorTemperatureKelvin: kelvin[index],
            lightColor: blackbodyRgb(kelvin[index]!),
            sourceEmissionStrength: light.visibleSourceRole ? 3.6 * intensityMultiplier : null,
          })),
        })),
    };
    expect(temporalLightingEvidencePass(report, rig)).toBe(true);
    const decorrelated = structuredClone(report);
    decorrelated.lights[1]!.samples[4]!.intensityMultiplier -= 0.02;
    decorrelated.lights[1]!.samples[4]!.powerWatts =
      rig.lights[1]!.energy * decorrelated.lights[1]!.samples[4]!.intensityMultiplier;
    expect(temporalLightingEvidencePass(decorrelated, rig)).toBe(false);
    const forgedSource = structuredClone(report);
    forgedSource.lights[0]!.samples[5]!.sourceEmissionStrength! += 0.2;
    expect(temporalLightingEvidencePass(forgedSource, rig)).toBe(false);
  });

  it('derives a bounded rig while preserving topology and exposure semantics', () => {
    const base = createWarmInteriorLightingRig();
    const adapted = adaptLightingRig(base, galleryAdaptation);
    const verification = verifyLightingRigAdaptation(base, adapted, galleryAdaptation);
    expect(verification).toMatchObject({
      valid: true,
      topologyPreserved: true,
      exposurePreserved: true,
      spatialTransformMatched: true,
      energyTransformMatched: true,
      colorTransformMatched: true,
      sizeTransformMatched: true,
    });
    expect(adapted.id).toBe('lighting.gallery-stage');
    expect(adapted.metadata).toMatchObject({
      derivedFrom: base.id,
      lightingAdaptation: 'lighting-rig-transform-v1',
      usage: 'gallery-stage',
    });
  });

  it.each([
    [
      'position',
      (rig: ReturnType<typeof createWarmInteriorLightingRig>) =>
        (rig.lights[0]!.position[0] += 0.1),
    ],
    [
      'energy',
      (rig: ReturnType<typeof createWarmInteriorLightingRig>) => (rig.lights[0]!.energy *= 1.1),
    ],
    [
      'color',
      (rig: ReturnType<typeof createWarmInteriorLightingRig>) => (rig.lights[0]!.color[0] *= 0.8),
    ],
    [
      'purpose',
      (rig: ReturnType<typeof createWarmInteriorLightingRig>) => (rig.lights[0]!.purpose = 'rim'),
    ],
  ])('rejects forged %s semantics', (_field, mutate) => {
    const base = createWarmInteriorLightingRig();
    const forged = adaptLightingRig(base, galleryAdaptation);
    mutate(forged);
    expect(verifyLightingRigAdaptation(base, forged, galleryAdaptation).valid).toBe(false);
  });
});
