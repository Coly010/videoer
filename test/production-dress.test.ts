import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createProductionTemplateHuman } from '../src/characters/production-template.js';
import { createProductionBoatNeckDress } from '../src/clothing/production-dress.js';
import { validateGeometry } from '../src/geometry/model.js';

describe('production-body-fitted dress', () => {
  it('derives separate valid topology from the production body with the exact full skeleton', async () => {
    const [source, weights] = await Promise.all([
      readFile('assets/character-bases/makehuman-hm08/base.obj', 'utf8'),
      readFile('assets/character-bases/makehuman-hm08/default_weights.mhw', 'utf8'),
    ]);
    const body = createProductionTemplateHuman(source, weights);
    const dress = createProductionBoatNeckDress(body);
    expect(validateGeometry(dress).valid).toBe(true);
    expect(dress.id).not.toBe(body.id);
    expect(dress.skeleton).toEqual(body.skeleton);
    expect(dress.metadata).toMatchObject({
      sourceTarget: body.id,
      topology: 'production-body-cross-section-bodice-measured-skirt-v1',
      garmentClearanceMeters: 0.012,
      boundaryLoopCount: 4,
      invalidBoundaryVertexCount: 0,
      connectedComponentCount: 2,
      weightTransferRegions: [
        expect.objectContaining({ id: 'fitted-bodice', maximumDistanceMeters: 0.065 }),
        expect.objectContaining({ id: 'flared-skirt', maximumDistanceMeters: 0.24 }),
      ],
    });
    expect(Number(dress.metadata.minimumMeasuredSectionClearanceMeters)).toBeGreaterThanOrEqual(
      0.006,
    );
    expect(dress.positions.length).toBeGreaterThan(1_000);
  });

  it('derives its fit measurements from a materially proportion-varied production body', async () => {
    const [source, weights] = await Promise.all([
      readFile('assets/character-bases/makehuman-hm08/base.obj', 'utf8'),
      readFile('assets/character-bases/makehuman-hm08/default_weights.mhw', 'utf8'),
    ]);
    const baseline = createProductionTemplateHuman(source, weights);
    const varied = createProductionTemplateHuman(source, weights, {
      height: 1.9,
      shoulderWidth: 0.48,
      hipWidth: 0.4,
      torsoLength: 0.56,
      legLength: 0.98,
    });
    const baselineDress = createProductionBoatNeckDress(baseline);
    const variedDress = createProductionBoatNeckDress(varied, {
      hemHeightRatio: 0.12,
      flareScaleX: 2.2,
      flareScaleZ: 2.1,
    });
    expect(variedDress.skeleton).toEqual(varied.skeleton);
    expect(Number(variedDress.metadata.waistY)).not.toBe(Number(baselineDress.metadata.waistY));
    expect(Number(variedDress.metadata.measuredWaistRadiusX)).not.toBe(
      Number(baselineDress.metadata.measuredWaistRadiusX),
    );
    expect(variedDress.metadata).toMatchObject({
      hemHeightRatio: 0.12,
      flareScaleX: 2.2,
      flareScaleZ: 2.1,
      boundaryLoopCount: 4,
      invalidBoundaryVertexCount: 0,
      connectedComponentCount: 2,
    });
  });
});
