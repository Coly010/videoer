import { describe, expect, it } from 'vitest';
import { fittedHairRenderPass } from '../src/application/hair-acceptance.js';
import { loadGeometry } from '../src/geometry/io.js';
import { validateGeometry } from '../src/geometry/model.js';
import { createPulledBackHair } from '../src/hair/pulled-back.js';

describe('modular production hair', () => {
  it('derives separable head-owned geometry from the stable canonical target', async () => {
    const target = await loadGeometry(
      'campaigns/reference-cinematic-benchmark/work/characters/production-template-foundation-v14/geometry.json',
    );
    const created = createPulledBackHair(target);
    expect(created.definition).toMatchObject({
      id: 'hair.pulled-back-low-bun',
      version: '0.7.0',
      representation: 'dedicated-scalp-layered-cards',
      compatibleSkeleton: 'canonical-humanoid-v1',
      anchorJoint: 'head',
      cardSystem: {
        scalpTopology: 'parametric-continuous-cap-v1',
        cardCount: 72,
        segmentsPerCard: 24,
      },
    });
    expect(validateGeometry(created.geometry).valid).toBe(true);
    expect(created.geometry.id).not.toBe(target.id);
    expect(created.geometry.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hair-base',
          anisotropy: 0.2,
          specularIorLevel: 0.06,
        }),
      ]),
    );
    expect(new Set(created.geometry.materialGroups.map((group) => group.materialId))).toEqual(
      new Set(['hair-base']),
    );
    expect(created.geometry.metadata.sourceTarget).toBe(target.id);
    const head = created.geometry.skeleton.findIndex((joint) => joint.id === 'head');
    expect(created.geometry.skinIndices?.every((indices) => indices[0] === head)).toBe(true);
    expect(created.geometry.positions.length).toBeGreaterThan(700);
  });

  it('fails closed unless all four fitted views and renderer checks pass', () => {
    const report = {
      verification: { status: 'pass' },
      frames: ['three-quarter-right', 'front', 'three-quarter-left', 'rear'].map((id) => ({ id })),
      renderChecks: [{ id: 'renderer-camera-contract', status: 'pass' }],
    };
    expect(fittedHairRenderPass(report)).toBe(true);
    expect(fittedHairRenderPass({ ...report, frames: report.frames.slice(0, 3) })).toBe(false);
    expect(
      fittedHairRenderPass({
        ...report,
        renderChecks: [{ id: 'renderer-camera-contract', status: 'fail' }],
      }),
    ).toBe(false);
  });
});
