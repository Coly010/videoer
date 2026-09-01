import { describe, expect, it } from 'vitest';
import { validateGeometry } from '../src/geometry/model.js';
import {
  createOldCitySurfacePresets,
  createSurfaceMaterialSwatch,
} from '../src/materials/old-city.js';

describe('old-city production surface library', () => {
  it('provides distinct metre-scaled reusable facade and interior materials', () => {
    const presets = createOldCitySurfacePresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      'dark-brick',
      'rain-aged-plaster',
      'weathered-wood',
      'limestone-trim',
      'warm-interior-plaster',
      'oiled-shelf-wood',
      'old-window-glazing',
    ]);
    expect(new Set(presets.map((preset) => preset.material.id)).size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.material.metadata.coordinateScale).toBe('object-space-metres');
      expect(preset.material.normal.kind).toBe('procedural-noise');
      expect(preset.material.baseColor.colors.length).toBeGreaterThanOrEqual(3);
      expect(preset.material.roughness.minimum).toBeLessThan(preset.material.roughness.maximum);
    }
    expect(presets.find((preset) => preset.id === 'dark-brick')?.material.pattern).toMatchObject({
      kind: 'masonry-bond',
      projectionAxes: ['x', 'y'],
    });
    expect(
      presets.find((preset) => preset.id === 'weathered-wood')?.material.pattern,
    ).toMatchObject({
      kind: 'directional-wood',
      grainAxis: 'y',
    });
    expect(
      presets.find((preset) => preset.id === 'rain-aged-plaster')?.material.pattern,
    ).toMatchObject({ kind: 'mineral-plaster' });
    expect(
      presets.find((preset) => preset.id === 'limestone-trim')?.material.pattern,
    ).toMatchObject({ kind: 'cut-stone' });
    expect(
      presets.find((preset) => preset.id === 'old-window-glazing')?.material.pattern,
    ).toMatchObject({ kind: 'architectural-glazing', transmission: 0.94, ior: 1.52 });
    for (const id of ['dark-brick', 'rain-aged-plaster', 'weathered-wood', 'limestone-trim'])
      expect(presets.find((preset) => preset.id === id)?.material.weathering).toMatchObject({
        verticalStreaks: { amount: expect.any(Number) },
        lowerDamp: { amount: expect.any(Number) },
        surfaceDirt: { amount: expect.any(Number) },
      });
    expect(
      presets.find((preset) => preset.id === 'warm-interior-plaster')?.material.weathering,
    ).toBeUndefined();
  });

  it('embeds each complete surface contract into a deterministic render swatch', () => {
    for (const preset of createOldCitySurfacePresets()) {
      const swatch = createSurfaceMaterialSwatch(preset.material);
      expect(validateGeometry(swatch).valid).toBe(true);
      expect(swatch.materials).toHaveLength(
        preset.material.pattern.kind === 'architectural-glazing' ? 3 : 1,
      );
      expect(swatch.materials[0]!.surface?.id).toBe(preset.material.id);
      expect(swatch.metadata.materialClass).toBe('surface-swatch');
      if (preset.material.pattern.kind !== 'isotropic') {
        expect(swatch.metadata.witnessGeometry).not.toBe('floor-grid');
        expect(Math.max(...swatch.positions.map((position) => position[1]))).toBeGreaterThan(1.5);
      }
      if (preset.material.pattern.kind === 'architectural-glazing') {
        expect(swatch.materials.slice(1).map((entry) => entry.id)).toEqual([
          'witness-cool',
          'witness-warm',
        ]);
        const paneDepth =
          Math.max(
            ...swatch.positions
              .map((position) => position[2])
              .filter((value) => Math.abs(value) < 0.01),
          ) -
          Math.min(
            ...swatch.positions
              .map((position) => position[2])
              .filter((value) => Math.abs(value) < 0.01),
          );
        expect(paneDepth).toBeCloseTo(0.008, 6);
      }
    }
  });
});
