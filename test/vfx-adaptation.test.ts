import { describe, expect, it } from 'vitest';
import { adaptAtmosphericVfx, verifyAtmosphericVfxAdaptation } from '../src/vfx/adaptation.js';
import { createRainyDuskVfx } from '../src/vfx/rainy-dusk.js';

describe('atmospheric VFX derivation', () => {
  it('specialises treatment while preserving deterministic camera-depth topology', () => {
    const base = createRainyDuskVfx();
    const adapted = adaptAtmosphericVfx(base, {
      assetId: 'vfx.silver-morning-drizzle',
      worldColor: [0.018, 0.024, 0.034],
      fog: { density: 0.004, color: [0.24, 0.28, 0.34] },
      rain: {
        layers: [
          { id: 'foreground', count: 28, opacity: 0.42 },
          { id: 'midground', count: 72, opacity: 0.32 },
          { id: 'background', count: 112, opacity: 0.2 },
        ],
      },
    });
    const verification = verifyAtmosphericVfxAdaptation(base, adapted);
    expect(verification).toMatchObject({
      valid: true,
      issues: [],
      placementPreserved: true,
      deterministicLayerTopologyPreserved: true,
    });
    expect(verification.changedFields).toContain('fog.density');
    expect(adapted.rain.layers.map((layer) => layer.seed)).toEqual(
      base.rain.layers.map((layer) => layer.seed),
    );
    expect(adapted.rain.windMetersPerSecond).toEqual(base.rain.windMetersPerSecond);
    expect(adapted.rain.groundSplashes).toEqual(base.rain.groundSplashes);
  });

  it('rejects semantic tampering even when the result still passes the VFX schema', () => {
    const base = createRainyDuskVfx();
    const adapted = adaptAtmosphericVfx(base, {
      assetId: 'vfx.silver-morning-drizzle',
      fog: { density: 0.004 },
    });
    adapted.rain.layers[0]!.seed += 9000;
    expect(verifyAtmosphericVfxAdaptation(base, adapted)).toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/changed invariant 'seed'/)],
      deterministicLayerTopologyPreserved: false,
    });
  });

  it('moves only the world-space splash receiver for a different environment', () => {
    const base = createRainyDuskVfx();
    const adapted = adaptAtmosphericVfx(base, {
      assetId: 'vfx.rainy-dusk-depth.receiver-night-platform',
      rain: {
        groundSplashes: {
          boundsMinimum: [-2.5, 0.005, -2],
          boundsMaximum: [2.5, 0.025, 1],
        },
      },
    });
    const verification = verifyAtmosphericVfxAdaptation(base, adapted);
    expect(verification.valid, verification.issues.join(', ')).toBe(true);
    expect(verification.changedFields).toEqual([
      'rain.groundSplashes.boundsMinimum',
      'rain.groundSplashes.boundsMaximum',
    ]);
    expect(adapted.rain.layers).toEqual(base.rain.layers);
    expect(adapted.rain.groundSplashes).toMatchObject({ count: 58, seed: 1711 });
  });

  it('rejects identity derivations that add no reusable semantic capability', () => {
    const base = createRainyDuskVfx();
    const unchanged = structuredClone(base);
    unchanged.id = 'vfx.renamed-only';
    expect(verifyAtmosphericVfxAdaptation(base, unchanged)).toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/no semantic change/)],
    });
  });
});
