import { describe, expect, it } from 'vitest';
import { createHumanoidMannequin } from '../src/characters/mannequin.js';
import { fitCanonicalClothing, verifyCanonicalClothingFit } from '../src/clothing/adaptation.js';
import { extractMaterialGeometry } from '../src/geometry/extract.js';

describe('canonical clothing fitting', () => {
  const appearance = {
    skin: [0.55, 0.34, 0.24, 1] as [number, number, number, number],
    hair: [0.04, 0.03, 0.025, 1] as [number, number, number, number],
    eyes: [0.08, 0.12, 0.15, 1] as [number, number, number, number],
    dress: [0.035, 0.04, 0.055, 1] as [number, number, number, number],
    leather: [0.12, 0.065, 0.035, 1] as [number, number, number, number],
  };

  it('retargets skinned garment vertices and the exact target rest skeleton without changing topology', () => {
    const sourceCharacter = createHumanoidMannequin({}, appearance);
    const garment = extractMaterialGeometry(
      sourceCharacter,
      ['dress'],
      'clothing.test-source-dress',
      { fitCharacter: sourceCharacter.id },
    );
    const target = createHumanoidMannequin({
      height: 1.9,
      shoulderWidth: 0.48,
      hipWidth: 0.38,
      torsoLength: 0.55,
      legLength: 0.98,
    });
    const fitted = fitCanonicalClothing(garment, target, 'clothing.test-fitted-dress', {
      skinningPolicy: 'long-dress-drape-v1',
    });
    const verification = verifyCanonicalClothingFit(garment, target, fitted);
    expect(verification).toMatchObject({
      valid: true,
      issues: [],
      topologyPreserved: true,
      skinningPreserved: false,
      skinningPolicy: 'long-dress-drape-v1',
      drapeSkinningValid: true,
      targetSkeletonMatched: true,
      canonicalSkeletonCompatible: true,
    });
    expect(verification.changedVertexCount).toBe(garment.positions.length);
    expect(verification.maximumVertexDisplacement).toBeGreaterThan(0.05);
    expect(verification.maximumHemNonPelvisWeight).toBeLessThanOrEqual(0.13);
  });

  it('rejects fitted geometry whose target skeleton lineage is subsequently forged', () => {
    const sourceCharacter = createHumanoidMannequin({}, appearance);
    const garment = extractMaterialGeometry(
      sourceCharacter,
      ['dress'],
      'clothing.test-source-dress',
    );
    const target = createHumanoidMannequin({ height: 1.86, legLength: 0.96 });
    const fitted = fitCanonicalClothing(garment, target, 'clothing.test-fitted-dress');
    fitted.skeleton[1]!.restPosition[1] += 0.03;
    expect(verifyCanonicalClothingFit(garment, target, fitted)).toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/exact target skeleton/)],
      targetSkeletonMatched: false,
    });
  });
});
