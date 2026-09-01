import { describe, expect, it } from 'vitest';
import { createHumanoidMannequin, type HumanoidAppearance } from '../src/characters/mannequin.js';
import { bakePoseSpaceClothCorrectives, verifyTemporalClothing } from '../src/clothing/temporal.js';
import { createWalkStyleMotion } from '../src/motion/walk.js';

const appearance: HumanoidAppearance = {
  skin: [0.62, 0.38, 0.27, 1],
  hair: [0.022, 0.009, 0.006, 1],
  eyes: [0.035, 0.11, 0.095, 1],
  dress: [0.012, 0.018, 0.04, 1],
  leather: [0.018, 0.014, 0.012, 1],
};

describe('renderer-independent temporal clothing verification', () => {
  it('detects raw animated body penetration and bakes renderer-consumable pose-space correctives', () => {
    const character = createHumanoidMannequin({ height: 1.7, legLength: 0.86 }, appearance);
    const motion = createWalkStyleMotion('neutral', { height: 1.7, legLength: 0.86 });
    const raw = verifyTemporalClothing(character, character, motion);
    expect(raw.valid).toBe(false);
    expect(raw.collision.maximumDepthMeters).toBeGreaterThan(0.02);

    const corrected = bakePoseSpaceClothCorrectives(character, character, motion);
    expect(corrected.report.addedMorphTargetCount).toBeGreaterThan(0);
    expect(corrected.geometry.morphTargets.length).toBe(corrected.report.addedMorphTargetCount);
    expect(corrected.motion.morphTracks.length).toBe(corrected.report.addedMorphTargetCount);
    expect(
      verifyTemporalClothing(corrected.geometry, corrected.geometry, corrected.motion),
    ).toMatchObject({
      valid: true,
      collision: { maximumDepthMeters: 0, collidingVertexSamples: 0 },
    });

    const rebaked = bakePoseSpaceClothCorrectives(
      corrected.geometry,
      corrected.geometry,
      corrected.motion,
      { targetPrefix: 'cloth-rebake' },
    );
    expect(rebaked.geometry.morphTargets.every((target) => target.vertexIndices.length > 0)).toBe(
      true,
    );
    expect(verifyTemporalClothing(rebaked.geometry, rebaked.geometry, rebaked.motion).valid).toBe(
      true,
    );
  }, 20_000);

  it('rejects the former leg-dominant skirt fan by temporal silhouette measurements', () => {
    const character = createHumanoidMannequin({}, appearance);
    const hips = character.skeleton.findIndex((joint) => joint.id === 'hips');
    const leftThigh = character.skeleton.findIndex((joint) => joint.id === 'left-thigh');
    const rightThigh = character.skeleton.findIndex((joint) => joint.id === 'right-thigh');
    const hipY = 0.93;
    const dressVertices = new Set<number>();
    for (const group of character.materialGroups)
      if (group.materialId === 'dress')
        for (const vertex of character.indices.slice(group.start, group.start + group.count))
          dressVertices.add(vertex);
    for (const vertex of dressVertices) {
      if (character.positions[vertex]![1] >= hipY - 0.2) continue;
      character.skinIndices![vertex] = [
        character.positions[vertex]![0] >= 0 ? leftThigh : rightThigh,
        hips,
        0,
        0,
      ];
      character.skinWeights![vertex] = [0.9, 0.1, 0, 0];
    }
    const result = verifyTemporalClothing(character, character, createWalkStyleMotion('neutral'));
    expect(result.valid).toBe(false);
    expect(result.silhouette.maximumDepthExpansionRatio).toBeGreaterThan(1.15);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'garment depth silhouette expands beyond the long-dress stability limit',
        'garment local surface edges stretch beyond the temporal stability limit',
      ]),
    );
  });

  it('fails closed when the target lacks complete anatomical collision proxies', () => {
    const character = createHumanoidMannequin({}, appearance);
    character.skeleton = character.skeleton.filter((joint) => joint.id !== 'right-shin');
    const result = verifyTemporalClothing(character, character, createWalkStyleMotion('cautious'));
    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      'body lacks complete bilateral arm, leg, and foot collision proxies',
    );
  });
});
