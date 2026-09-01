import { describe, expect, it } from 'vitest';
import { compileFacadeConstructionDetail } from '../src/environments/facade-construction-detail.js';

const openings = [
  { id: 'entry', kind: 'door' as const, minimumX: -2.8, maximumX: -1.6, minimumY: 0, maximumY: 2.16 },
  { id: 'display', kind: 'shopfront' as const, minimumX: -1.2, maximumX: 1.5, minimumY: 0.62, maximumY: 2.77 },
  { id: 'upper', kind: 'window' as const, minimumX: -0.64, maximumX: 0.64, minimumY: 4.27, maximumY: 5.23 },
];

describe('generic facade construction detail', () => {
  it('compiles deterministic historic load-bearing detail and receiver zones', () => {
    const input = {
      schemaVersion: 1 as const,
      id: 'environment.test-historic-detail',
      seed: 1847,
      style: 'historic-masonry' as const,
      minimumX: -3.4,
      maximumX: 3.4,
      totalHeightMeters: 6.1,
      facadeExteriorZ: -0.06,
      openings,
      trimMaterialId: 'dark-timber',
      wearReceiverMaterialId: 'rain-aged-plaster',
    };
    const first = compileFacadeConstructionDetail(input);
    const second = compileFacadeConstructionDetail(input);
    expect(first).toEqual(second);
    expect(first.report.openingHeadCount).toBe(openings.length);
    expect(first.report.cornerTreatmentCount).toBeGreaterThan(24);
    expect(first.report.horizontalBandCount).toBe(1);
    expect(first.report.dirtReceiverZones).toHaveLength(openings.length + 3);
  });

  it('transfers to contemporary reveal bands, coping and expansion edges', () => {
    const contemporary = compileFacadeConstructionDetail({
      schemaVersion: 1,
      id: 'environment.test-contemporary-detail',
      seed: 90211,
      style: 'contemporary-plaster',
      minimumX: -4.2,
      maximumX: 4.2,
      totalHeightMeters: 6.55,
      facadeExteriorZ: -0.018,
      openings,
      trimMaterialId: 'charcoal-metal',
      wearReceiverMaterialId: 'mineral-plaster',
    });
    expect(contemporary.report.revealBandCount).toBe(openings.length * 3);
    expect(contemporary.report.cornerTreatmentCount).toBe(2);
    expect(contemporary.report.horizontalBandCount).toBe(2);
    expect(contemporary.report.dirtReceiverZones.some((zone) => zone.role === 'parapet-runoff')).toBe(true);
    expect(contemporary.report.deterministicSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
