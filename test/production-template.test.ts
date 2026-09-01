import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createProductionTemplateHuman } from '../src/characters/production-template.js';
import {
  deformSkinnedPositionsDualQuaternion,
  jointWorldTransforms,
} from '../src/geometry/kinematics.js';
import { validateGeometry } from '../src/geometry/model.js';
import { verifyCharacterMotionAlignment } from '../src/motion/character-verification.js';
import { createWalkStyleMotion } from '../src/motion/walk.js';
import { identifySoleSurfaceRegions } from '../src/characters/sole-surface.js';

describe('CC0 stable production-human template', () => {
  it('converts authored topology, A-pose landmarks, and weights into the Videoer contract', async () => {
    const [source, weights] = await Promise.all([
      readFile('assets/character-bases/makehuman-hm08/base.obj', 'utf8'),
      readFile('assets/character-bases/makehuman-hm08/default_weights.mhw', 'utf8'),
    ]);
    const human = createProductionTemplateHuman(source, weights, { height: 1.72 });
    const validation = validateGeometry(human);
    expect(
      validation.valid,
      validation.issues
        .slice(0, 20)
        .map((issue) => issue.code)
        .join(', '),
    ).toBe(true);
    expect(human.metadata).toMatchObject({
      productionPose: 'a-pose',
      sourceLicence: 'CC0-1.0',
      topology: 'makehuman-hm08-cc0-derived-v1',
      weightReduction: {
        shoulderSmoothing: {
          method: 'topology-neighbour-laplacian-v1',
          iterations: 5,
        },
        thumbSmoothing: {
          method: 'topology-neighbour-laplacian-v1',
          iterations: 2,
        },
      },
    });
    expect(human.skeleton).toHaveLength(52);
    expect(human.skeleton.map((joint) => joint.id)).toEqual(
      expect.arrayContaining(['left-thumb-3', 'right-little-3', 'left-toe', 'head']),
    );
    const worlds = jointWorldTransforms(human);
    const leftSole = identifySoleSurfaceRegions(human, 'left');
    expect(human.metadata.soleContactStrategy).toBe('rigid-outsole-surface-v1');
    expect(human.attachments['left-heel-contact']!.position).toEqual(leftSole.heel.contactWitness);
    expect(human.attachments['left-toe-contact']!.position).toEqual(
      leftSole.forefoot.contactWitness,
    );
    expect(leftSole.heel.witnessVertices.length).toBeGreaterThanOrEqual(3);
    expect(leftSole.forefoot.witnessVertices.length).toBeGreaterThanOrEqual(3);
    expect(human.attachments['left-toe-contact']!.position[2]).toBeLessThan(
      worlds.get('left-toe')!.position[2],
    );
    expect(human.positions.length).toBeGreaterThan(13_000);
    expect(human.indices.length).toBeGreaterThan(80_000);
    expect(human.skinWeights).toHaveLength(human.positions.length);
    expect(verifyCharacterMotionAlignment(human, createWalkStyleMotion('neutral')).status).toBe(
      'pass',
    );
    expect(
      human.skinWeights!.every(
        (weights) => Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9,
      ),
    ).toBe(true);
    const bent = deformSkinnedPositionsDualQuaternion(human, {
      'left-forearm': { rotation: [0, -Math.PI * 0.55, 0] },
    });
    expect(
      Math.max(
        ...bent.map((position, index) =>
          Math.hypot(
            position[0] - human.positions[index]![0],
            position[1] - human.positions[index]![1],
            position[2] - human.positions[index]![2],
          ),
        ),
      ),
    ).toBeGreaterThan(0.05);
  });
});
