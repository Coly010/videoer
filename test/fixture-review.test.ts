import { describe, expect, it } from 'vitest';
import { portableFixtureCandidateReviewSchema } from '../src/fixtures/review.js';
import {
  probeEvidencePass,
  temporalModulationEvidencePass,
} from '../src/application/fixture-acceptance.js';

describe('portable fixture qualitative review', () => {
  it('records independent fixture and prop identity with a quality tier', () => {
    const review = portableFixtureCandidateReviewSchema.parse({
      schemaVersion: 1,
      assetId: 'prop.old-city-wall-lantern',
      fixtureId: 'fixture.old-city-wall-lantern',
      decision: 'accepted',
      reviewer: 'Codex visual review',
      reviewedAt: '2026-09-01T05:00:00.000Z',
      intendedShotDistance: 'medium',
      evidence: ['facade.png', 'warehouse.png'],
      strengths: ['portable light pool'],
      limitations: ['not a hero close-up asset'],
      notes: 'Accepted after cross-set review.',
    });
    expect(review.fixtureId).toBe('fixture.old-city-wall-lantern');
  });
});

describe('portable fixture acceptance evidence', () => {
  it('accepts a full temporal render only when every renderer gate passes', () => {
    expect(
      probeEvidencePass({
        verification: { status: 'pass' },
        frames: [{}, {}, {}],
        renderChecks: [{ status: 'pass' }, { status: 'pass' }, { status: 'pass' }],
      }),
    ).toBe(true);
    expect(
      probeEvidencePass({
        verification: { status: 'pass' },
        frames: [{}, {}, {}],
        renderChecks: [{ status: 'pass' }, { status: 'fail' }, { status: 'pass' }],
      }),
    ).toBe(false);
  });

  it('requires bounded variation and one shared useful-light/source signal', () => {
    const emitter = {
      id: 'warm-source',
      type: 'point' as const,
      position: [0, 0, 0] as [number, number, number],
      color: [1, 0.4, 0.1] as [number, number, number],
      powerWatts: 50,
      sizeMeters: 0.01,
      angleDegrees: 45,
      falloff: 'inverse-square' as const,
      purpose: 'practical' as const,
      visibleSourceMaterialId: 'flame',
      temporalModulation: {
        kind: 'seeded-flicker' as const,
        seed: 7,
        frequencyHz: 6,
        intensityMinimumMultiplier: 0.8,
        intensityMaximumMultiplier: 1.1,
        colorTemperatureMinimumKelvin: 1800,
        colorTemperatureMaximumKelvin: 2100,
        interpolation: 'smooth' as const,
      },
    };
    const samples = Array.from({ length: 12 }, (_, index) => {
      const multiplier = index % 2 === 0 ? 0.85 : 1.05;
      return {
        frame: index + 1,
        intensityMultiplier: multiplier,
        powerWatts: 50 * multiplier,
        colorTemperatureKelvin: 1900,
        sourceEmissionStrength: 0.6 * multiplier,
      };
    });
    const report = {
      schemaVersion: 1,
      frameCount: 12,
      emitters: [
        {
          emitterId: 'warm-source',
          kind: 'seeded-flicker',
          seed: 7,
          frequencyHz: 6,
          visibleSourceMaterialId: 'flame',
          samples,
        },
      ],
    };
    expect(temporalModulationEvidencePass(report, emitter)).toBe(true);
    const broken = structuredClone(report);
    broken.emitters[0]!.samples[5]!.sourceEmissionStrength = 0.1;
    expect(temporalModulationEvidencePass(broken, emitter)).toBe(false);
  });

  it('accepts authored-colour electrical evidence without inventing a Kelvin signal', () => {
    const emitter = {
      id: 'cyan-source',
      type: 'area' as const,
      position: [0, 0, 0] as [number, number, number],
      target: [-1, 0, 0] as [number, number, number],
      color: [0.05, 0.78, 1] as [number, number, number],
      powerWatts: 90,
      sizeMeters: 0.5,
      angleDegrees: 45,
      falloff: 'inverse-square' as const,
      purpose: 'practical' as const,
      visibleSourceMaterialId: 'cyan-neon',
      temporalModulation: {
        kind: 'seeded-electrical-instability' as const,
        seed: 91,
        frequencyHz: 5.5,
        intensityMinimumMultiplier: 0.62,
        intensityMaximumMultiplier: 1.04,
        dropoutProbability: 0.12,
        interpolation: 'smooth' as const,
      },
    };
    const samples = Array.from({ length: 12 }, (_, index) => {
      const multiplier = index % 2 === 0 ? 0.68 : 0.98;
      return {
        frame: index + 1,
        intensityMultiplier: multiplier,
        powerWatts: 90 * multiplier,
        colorTemperatureKelvin: null,
        lightColor: [0.05, 0.78, 1],
        sourceEmissionStrength: 4.2 * multiplier,
      };
    });
    expect(
      temporalModulationEvidencePass(
        {
          schemaVersion: 1,
          frameCount: 12,
          emitters: [
            {
              emitterId: 'cyan-source',
              kind: 'seeded-electrical-instability',
              seed: 91,
              frequencyHz: 5.5,
              dropoutProbability: 0.12,
              visibleSourceMaterialId: 'cyan-neon',
              samples,
            },
          ],
        },
        emitter,
      ),
    ).toBe(true);

    const recoloured = {
      schemaVersion: 1,
      frameCount: 12,
      emitters: [
        {
          emitterId: 'cyan-source',
          kind: 'seeded-electrical-instability',
          seed: 91,
          frequencyHz: 5.5,
          dropoutProbability: 0.12,
          visibleSourceMaterialId: 'cyan-neon',
          samples: structuredClone(samples),
        },
      ],
    };
    recoloured.emitters[0]!.samples[4]!.lightColor = [1, 0.2, 0.05];
    expect(temporalModulationEvidencePass(recoloured, emitter)).toBe(false);
  });
});
