import { describe, expect, it } from 'vitest';
import { boxPart, mergeMeshParts } from '../src/geometry/primitives.js';
import {
  adaptSurfaceMaterial,
  bindSurfaceMaterial,
  verifySurfaceMaterialAdaptation,
} from '../src/materials/adaptation.js';
import { createWetCobbleSurfaceMaterial } from '../src/materials/wet-cobble.js';

describe('surface material derivation and binding', () => {
  it('specialises a surface without changing its renderer-independent shading models', () => {
    const base = createWetCobbleSurfaceMaterial();
    const adapted = adaptSurfaceMaterial(base, {
      assetId: 'material.dry-morning-cobble',
      baseColor: { seed: 2718, scaleMeters: 0.38 },
      roughness: { minimum: 0.42, maximum: 0.68, wetness: 0.16 },
      metallic: 0.02,
    });
    expect(verifySurfaceMaterialAdaptation(base, adapted)).toMatchObject({
      valid: true,
      issues: [],
      shadingModelPreserved: true,
      baseColorModelPreserved: true,
      normalModelPreserved: true,
      changedFields: expect.arrayContaining(['baseColor.seed', 'roughness.wetness']),
    });
  });

  it('rejects model substitution even if numeric material values remain plausible', () => {
    const base = createWetCobbleSurfaceMaterial();
    const adapted = adaptSurfaceMaterial(base, {
      assetId: 'material.dry-morning-cobble',
      roughness: { wetness: 0.16 },
    });
    const forged = structuredClone(adapted) as typeof adapted;
    forged.baseColor.kind = 'constant';
    expect(verifySurfaceMaterialAdaptation(base, forged)).toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/base-color model changed/)],
      baseColorModelPreserved: false,
    });
  });

  it('embeds the complete surface contract into renderable geometry', () => {
    const geometry = mergeMeshParts(
      'prop.material-binding-fixture',
      [boxPart([-1, 0, -1], [1, 0.1, 1], 0, 'ground')],
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      {},
    );
    geometry.materials = [
      {
        id: 'ground',
        baseColor: [0.2, 0.2, 0.2, 1],
        roughness: 0.5,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
      },
    ];
    const surface = createWetCobbleSurfaceMaterial();
    const bound = bindSurfaceMaterial(geometry, 'ground', surface);
    expect(bound.materials[0]).toMatchObject({
      id: 'ground',
      surface: {
        id: 'material.wet-old-city-cobble',
        baseColor: { kind: 'procedural-palette', seed: 1847 },
      },
    });
    expect(bound.metadata.surfaceBindings).toEqual([
      { targetMaterialId: 'ground', surfaceMaterial: 'material.wet-old-city-cobble' },
    ]);
    const reboundSurface = adaptSurfaceMaterial(surface, {
      assetId: 'material.rebound-ground',
      roughness: { minimum: 0.3 },
    });
    const rebound = bindSurfaceMaterial(bound, 'ground', reboundSurface);
    expect(rebound.metadata.surfaceBindings).toEqual([
      { targetMaterialId: 'ground', surfaceMaterial: 'material.rebound-ground' },
    ]);
  });
});
