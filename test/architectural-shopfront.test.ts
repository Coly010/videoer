import { describe, expect, it } from 'vitest';
import {
  architecturalShopfrontDefinitionSchema,
  createArchitecturalShopfront,
} from '../src/props/architectural-shopfront.js';
import { validateGeometry } from '../src/geometry/model.js';

describe('exact-contract architectural shopfront', () => {
  it('compiles physical reveals, glazing, sill, lintel and interior-depth anchors without scaling', () => {
    const geometry = createArchitecturalShopfront({
      schemaVersion: 1,
      id: 'prop.architectural-shopfront.transfer-test',
      openingWidthMeters: 3.8,
      openingHeightMeters: 2.5,
      wallThicknessMeters: 0.28,
      mullionCount: 3,
      stallRiserMeters: 0.28,
      interiorDepthMeters: 5.2,
    });

    expect(validateGeometry(geometry).valid).toBe(true);
    expect(geometry.attachments['wall-mount']?.position).toEqual([0, 0, 0]);
    expect(geometry.attachments['interior-depth-near']?.position[2]).toBeGreaterThan(0.28);
    expect(geometry.attachments['interior-depth-far']?.position[2]).toBeGreaterThan(
      geometry.attachments['interior-depth-near']!.position[2],
    );
    expect(geometry.metadata.hostContract).toMatchObject({
      openingWidthMeters: 3.8,
      openingHeightMeters: 2.5,
      scalingPermitted: false,
    });
    const materialIds = new Set(geometry.materialGroups.map((group) => group.materialId));
    expect(materialIds.size).toBe(4);
    expect(materialIds).toContain('shopfront-glass');
  });

  it('rejects decorative or implausible dimensions at the contract boundary', () => {
    expect(
      architecturalShopfrontDefinitionSchema.safeParse({
        schemaVersion: 1,
        id: 'prop.bad-shopfront',
        openingWidthMeters: 0.8,
        openingHeightMeters: 2.5,
        wallThicknessMeters: 0.28,
        mullionCount: 0,
        stallRiserMeters: 0.28,
        interiorDepthMeters: 5.2,
      }).success,
    ).toBe(false);
  });
});
