import { describe, expect, it } from 'vitest';
import { validateGeometry } from '../src/geometry/model.js';
import {
  surfaceMaterialSchema,
  surfaceUnitVariationSchema,
  textureUnitVariationSchema,
} from '../src/materials/model.js';
import {
  createWetCobbleSurfaceMaterial,
  createWetCobbleSwatch,
  wetCobbleGeometryMaterials,
} from '../src/materials/wet-cobble.js';
import {
  createPavingGranularSurfaceMaterial,
  createPavingGranularSwatch,
} from '../src/materials/paving-joint.js';
import { createPavingBorderSurfaceMaterial } from '../src/materials/paving-border.js';
import { createPavingUnitSurfaceMaterial } from '../src/materials/paving-unit.js';
import { createSurfaceMaterialSwatch } from '../src/materials/old-city.js';

describe('renderer-independent reusable materials', () => {
  it('separates texture-placement variation from construction-semantic surface masks', () => {
    const core = {
      kind: 'vertex-scalar-attributes-v1' as const,
      valueAttribute: 'videoer_unit_value_variation' as const,
      roughnessAttribute: 'videoer_unit_roughness_variation' as const,
      weatheringAttribute: 'videoer_unit_weathering_variation' as const,
      valueAmplitude: 0.08,
      roughnessAmplitude: 0.06,
      weatheringAmplitude: 0.2,
    };
    expect(textureUnitVariationSchema.parse(core)).toEqual(core);
    expect(() =>
      textureUnitVariationSchema.parse({
        ...core,
        edgeWearAttribute: 'videoer_paving_edge_wear',
        edgeWearAmount: 0.5,
      }),
    ).toThrow();
    expect(() =>
      surfaceUnitVariationSchema.parse({
        ...core,
        edgeWearAttribute: 'videoer_paving_edge_wear',
      }),
    ).toThrow(/must be declared together/u);
  });

  it('defines wet cobble with procedural albedo, normal relief, and varied roughness', () => {
    const material = createWetCobbleSurfaceMaterial();
    expect(material).toMatchObject({
      id: 'material.wet-old-city-cobble',
      baseColor: { kind: 'procedural-palette', seed: 1847 },
      normal: { kind: 'procedural-noise', scaleMeters: 0.055 },
      roughness: { wetness: 0.86 },
      pattern: { kind: 'isotropic' },
    });
    expect(material.baseColor.colors).toHaveLength(3);
    expect(material.roughness.minimum).toBeLessThan(material.roughness.maximum);
    expect(wetCobbleGeometryMaterials().map((item) => item.roughness)).toEqual([0.12, 0.21, 0.3]);
    expect(wetCobbleGeometryMaterials().every((item) => item.surface?.id === material.id)).toBe(
      true,
    );
  });

  it('renders through a deterministic topology-valid geometry swatch', () => {
    const swatch = createWetCobbleSwatch();
    expect(validateGeometry(swatch).valid).toBe(true);
    expect(swatch.positions.length).toBeGreaterThan(1_000);
    expect(swatch.materials).toHaveLength(3);
  });

  it('gives generic unit-material swatches every renderer-required variation attribute', () => {
    const material = createPavingUnitSurfaceMaterial('contemporary-concrete-paver');
    const swatch = createSurfaceMaterialSwatch(material);
    expect(validateGeometry(swatch).valid).toBe(true);
    for (const name of [
      material.unitVariation!.valueAttribute,
      material.unitVariation!.roughnessAttribute,
      material.unitVariation!.weatheringAttribute,
      material.unitVariation!.edgeWearAttribute!,
      material.unitVariation!.dirtAccumulationAttribute!,
    ]) {
      expect(swatch.attributes?.[name]).toMatchObject({
        dataType: 'float',
        interpolation: 'vertex',
      });
      expect(swatch.attributes?.[name]?.values).toHaveLength(swatch.positions.length);
    }
  });

  it('rejects inverted roughness ranges', () => {
    expect(() =>
      surfaceMaterialSchema.parse({
        ...createWetCobbleSurfaceMaterial(),
        roughness: {
          ...createWetCobbleSurfaceMaterial().roughness,
          minimum: 0.8,
          maximum: 0.2,
        },
      }),
    ).toThrow(/minimum must not exceed/);
  });

  it('rejects masonry mortar wider than the declared unit can support', () => {
    expect(() =>
      surfaceMaterialSchema.parse({
        ...createWetCobbleSurfaceMaterial(),
        pattern: {
          kind: 'masonry-bond',
          projectionAxes: ['x', 'y'],
          unitWidthMeters: 0.2,
          unitHeightMeters: 0.08,
          mortarWidthMeters: 0.05,
          rowOffset: 0.5,
          mortarColor: [0.1, 0.1, 0.1, 1],
          edgeReliefMeters: 0.003,
        },
      }),
    ).toThrow(/mortar must be narrower/);
  });

  it('rejects physically meaningless environmental weathering scales', () => {
    expect(() =>
      surfaceMaterialSchema.parse({
        ...createWetCobbleSurfaceMaterial(),
        weathering: {
          verticalStreaks: { amount: 0.5, widthMeters: 0, lengthMeters: 0.8 },
        },
      }),
    ).toThrow();
  });

  it('validates explicit physical surface-water response independently of presentation wetness', () => {
    const base = createWetCobbleSurfaceMaterial();
    const material = surfaceMaterialSchema.parse({
      ...base,
      surfaceWaterResponse: {
        absorption: {
          capacityMeters: 0.0018,
          rateMetersPerSecond: 0.000015,
          initialSaturation: 0.25,
        },
        retention: {
          filmCapacityMeters: 0.0008,
          edgeCapacityMeters: 0.002,
          maximumPuddleDepthMeters: 0.018,
        },
        wetRoughness: { multiplier: 0.34, floor: 0.045 },
        splash: { minimumFreeWaterDepthMeters: 0.00035, maximumSlopeDegrees: 12 },
      },
    });
    expect(material.surfaceWaterResponse?.absorption.capacityMeters).toBe(0.0018);
    expect(material.roughness.wetness).toBe(base.roughness.wetness);
    expect(() =>
      surfaceMaterialSchema.parse({
        ...material,
        surfaceWaterResponse: {
          ...material.surfaceWaterResponse,
          absorption: { ...material.surfaceWaterResponse!.absorption, initialSaturation: 1.1 },
        },
      }),
    ).toThrow();
  });

  it('supports metre-scaled textile, brushed-metal, and ceramic production surfaces', () => {
    const base = createWetCobbleSurfaceMaterial();
    expect(
      surfaceMaterialSchema.parse({
        ...base,
        id: 'material.test-woven-wool',
        pattern: {
          kind: 'woven-textile',
          warpAxis: 'y',
          warpSpacingMeters: 0.003,
          weftSpacingMeters: 0.0035,
          threadContrast: 0.4,
          fuzzAmount: 0.35,
        },
      }).pattern.kind,
    ).toBe('woven-textile');
    expect(
      surfaceMaterialSchema.parse({
        ...base,
        id: 'material.test-brushed-brass',
        metallic: 0.9,
        pattern: {
          kind: 'brushed-metal',
          brushAxis: 'y',
          brushSpacingMeters: 0.0015,
          scratchContrast: 0.5,
          patinaAmount: 0.12,
        },
      }).pattern.kind,
    ).toBe('brushed-metal');
    expect(
      surfaceMaterialSchema.parse({
        ...base,
        id: 'material.test-glazed-ceramic',
        pattern: {
          kind: 'glazed-ceramic',
          glazeAmount: 0.7,
          glazeRoughness: 0.18,
          speckleScaleMeters: 0.004,
          speckleAmount: 0.2,
        },
      }).pattern.kind,
    ).toBe('glazed-ceramic');
  });

  it('defines distinct physical joint and substrate granular materials', () => {
    const grit = createPavingGranularSurfaceMaterial('natural-grit');
    const polymeric = createPavingGranularSurfaceMaterial('polymeric-sand');
    const substrate = createPavingGranularSurfaceMaterial('compacted-base');
    expect(grit.pattern).toMatchObject({ kind: 'granular-aggregate', compaction: 0.42 });
    expect(polymeric.pattern).toMatchObject({ kind: 'granular-aggregate', compaction: 0.74 });
    expect(substrate.pattern).toMatchObject({
      kind: 'granular-aggregate',
      aggregateScaleMeters: 0.018,
    });
    expect(grit.surfaceWaterResponse!.absorption.capacityMeters).toBeGreaterThan(
      polymeric.surfaceWaterResponse!.absorption.capacityMeters,
    );
    expect(substrate.surfaceWaterResponse!.absorption.capacityMeters).toBeGreaterThan(
      grit.surfaceWaterResponse!.absorption.capacityMeters,
    );
    expect(grit.constructionSurfaceResponse).toMatchObject({
      kind: 'natural-joint',
      geometryBasis: 'authored-joint-recession',
      clogging: { driver: 'dirt-coverage', maximumFillFractionOfRecession: 0.72 },
    });
    expect(polymeric.constructionSurfaceResponse).toMatchObject({
      kind: 'polymeric-joint',
      coherentFailure: { onset: 0.58, coherenceScaleMeters: 0.18 },
    });
    expect(substrate.constructionSurfaceResponse).toMatchObject({
      kind: 'exposed-substrate',
      activation: 'active-history-cells-only',
    });
    for (const kind of ['natural-grit', 'polymeric-sand', 'compacted-base'] as const)
      expect(validateGeometry(createPavingGranularSwatch(kind)).valid).toBe(true);
  });

  it('rejects granular fines that are not smaller than aggregate', () => {
    const material = createPavingGranularSurfaceMaterial('natural-grit');
    expect(() =>
      surfaceMaterialSchema.parse({
        ...material,
        pattern: { ...material.pattern, finesScaleMeters: 0.007 },
      }),
    ).toThrow(/fines must be smaller/);
  });

  it('bounds and cross-validates construction-domain surface response', () => {
    const natural = createPavingGranularSurfaceMaterial('natural-grit');
    const polymeric = createPavingGranularSurfaceMaterial('polymeric-sand');
    const naturalResponse = natural.constructionSurfaceResponse;
    const polymericResponse = polymeric.constructionSurfaceResponse;
    if (naturalResponse?.kind !== 'natural-joint' || polymericResponse?.kind !== 'polymeric-joint')
      throw new Error('Construction response fixture kinds are invalid');

    expect(() =>
      surfaceMaterialSchema.parse({
        ...natural,
        constructionSurfaceResponse: {
          ...naturalResponse,
          clogging: {
            ...naturalResponse.clogging,
            looseWeight: 0,
            persistentWeight: 0,
          },
        },
      }),
    ).toThrow(/positive dirt weight/u);
    expect(() =>
      surfaceMaterialSchema.parse({
        ...polymeric,
        constructionSurfaceResponse: {
          ...polymericResponse,
          coherentFailure: {
            ...polymericResponse.coherentFailure,
            saturation: polymericResponse.coherentFailure.onset,
          },
        },
      }),
    ).toThrow(/saturation must exceed onset/u);
    expect(() =>
      surfaceMaterialSchema.parse({
        ...natural,
        constructionSurfaceResponse: polymericResponse,
      }),
    ).toThrow(/requires natural-joint/u);
    expect(() =>
      surfaceMaterialSchema.parse({
        ...natural,
        metadata: { ...natural.metadata, constructionDomain: 'flat-ground-surface' },
      }),
    ).toThrow(/requires paving-joint-substrate material metadata/u);

    const gutter = createPavingBorderSurfaceMaterial('historic-dark-stone-gutter');
    const gutterResponse = gutter.constructionSurfaceResponse;
    if (gutterResponse?.kind !== 'paving-border' || !gutterResponse.gutterZones)
      throw new Error('Gutter response fixture is invalid');
    expect(gutterResponse.historyFaces).toEqual(['top']);
    expect(() =>
      surfaceMaterialSchema.parse({
        ...gutter,
        constructionSurfaceResponse: { ...gutterResponse, gutterZones: undefined },
      }),
    ).toThrow(/gutter-compatible material requires gutter zones/u);

    const kerb = createPavingBorderSurfaceMaterial('historic-granite-kerb');
    expect(kerb.constructionSurfaceResponse).toMatchObject({
      kind: 'paving-border',
      historyFaces: ['top', 'paving-facing'],
    });
    expect(() =>
      surfaceMaterialSchema.parse({
        ...kerb,
        constructionSurfaceResponse: {
          ...kerb.constructionSurfaceResponse,
          gutterZones: gutterResponse.gutterZones,
        },
      }),
    ).toThrow(/non-gutter material must not declare gutter zones/u);
  });
});
