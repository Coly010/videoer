import { describe, expect, it } from 'vitest';
import {
  createInteriorFurnishingFamily,
  layoutDressingFamily,
} from '../src/environments/dressing-family.js';
import { geometryAssetSchema } from '../src/geometry/model.js';
import { mergeMeshParts, roundedBoxPart } from '../src/geometry/primitives.js';
import {
  createDecorativeVesselSet,
  createPedestalSideTable,
  createUpholsteredReadingChair,
} from '../src/props/interior-furnishings.js';

describe('portable inhabited-interior furnishings', () => {
  it('owns a renderer-independent rounded upholstery primitive with finite outward geometry', () => {
    const asset = mergeMeshParts(
      'prop.rounded-box-test',
      [roundedBoxPart([-1, 0, -0.5], [1, 0.4, 0.5], 0.12, 0, 'test-upholstery', 8)],
      [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
      {},
    );
    asset.materials = [
      {
        id: 'test-upholstery',
        baseColor: [0.2, 0.3, 0.4, 1],
        roughness: 0.8,
        metallic: 0,
        emission: [0, 0, 0],
        emissionStrength: 0,
      },
    ];
    const parsed = geometryAssetSchema.parse(asset);
    expect(parsed.positions.length).toBeGreaterThan(400);
    expect(parsed.indices.length).toBeGreaterThan(1000);
  });

  it('builds valid physical props with interaction and support semantics', () => {
    const chair = geometryAssetSchema.parse(createUpholsteredReadingChair());
    const table = geometryAssetSchema.parse(createPedestalSideTable());
    const vessels = geometryAssetSchema.parse(createDecorativeVesselSet());

    expect(chair.attachments['occupant-position']).toBeDefined();
    expect(chair.attachments['side-table-right']).toBeDefined();
    expect(chair.metadata.upholstered).toBe(true);
    expect(table.attachments['tabletop-centre']?.position[1]).toBeCloseTo(0.77);
    expect(table.metadata.physicalTableSurface).toBe(true);
    expect(vessels.attachments['tabletop-base']).toBeDefined();
    expect(vessels.metadata.physicalVesselCount).toBe(3);
    for (const asset of [chair, table, vessels]) {
      expect(asset.indices.length).toBeGreaterThan(300);
      expect(asset.materialGroups.length).toBeGreaterThan(1);
    }
  });

  it('lays out an authored reading corner deterministically while preserving circulation', () => {
    const family = createInteriorFurnishingFamily();
    const request = {
      schemaVersion: 1 as const,
      id: 'layout.interior-furnishing-test',
      familyId: family.id,
      seed: 9431,
      clusterCount: 1,
      requiredVariantIds: ['reading-chair', 'pedestal-table', 'vessel-set'],
      requiredRecipeIds: ['complete-reading-corner'],
      zone: {
        minimum: [-5, -4] as [number, number],
        maximum: [5, 4] as [number, number],
        groundY: 0,
      },
      exclusions: [
        {
          id: 'central-circulation',
          kind: 'corridor' as const,
          start: [-4, 0] as [number, number],
          end: [4, 0] as [number, number],
          halfWidthMeters: 0.75,
          clearanceMeters: 0.2,
        },
      ],
    };
    const first = layoutDressingFamily(family, request);
    const second = layoutDressingFamily(family, request);
    expect(first).toEqual(second);
    expect(new Set(first.instances.map((instance) => instance.variantId))).toEqual(
      new Set(['reading-chair', 'pedestal-table', 'vessel-set']),
    );
    expect(
      first.instances.every((instance) => instance.recipeId === 'complete-reading-corner'),
    ).toBe(true);
    const table = first.instances.find((instance) => instance.variantId === 'pedestal-table')!;
    const vessels = first.instances.find((instance) => instance.variantId === 'vessel-set')!;
    expect(table.transform.scale).toEqual([1, 1, 1]);
    expect(vessels.transform.position[0]).toBeCloseTo(table.transform.position[0]);
    expect(vessels.transform.position[2]).toBeCloseTo(table.transform.position[2]);
    expect(vessels.transform.position[1]).toBeCloseTo(
      table.transform.position[1] + table.heightMeters * table.transform.scale[1],
    );
  });
});
