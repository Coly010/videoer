import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { verifyWalkingExtremityDeformation } from '../src/characters/deformation.js';
import { createProductionHuman } from '../src/characters/production-human.js';
import { createProductionTemplateHuman } from '../src/characters/production-template.js';
import { motionClipSchema } from '../src/motion/model.js';
import { groundMotionToCharacter } from '../src/motion/grounding.js';
import {
  productionAPoseArmRetargetJoints,
  retargetMotionRestPose,
} from '../src/motion/rest-pose.js';
import { createWalkStyleMotion, verifyCasualWalkMotion } from '../src/motion/walk.js';

describe('production walking deformation', () => {
  it('preserves both hands and rejects proxy-derived wrist counter-rotation', async () => {
    const [source, weights] = await Promise.all([
      readFile('assets/character-bases/makehuman-hm08/base.obj', 'utf8'),
      readFile('assets/character-bases/makehuman-hm08/default_weights.mhw', 'utf8'),
    ]);
    const geometry = createProductionTemplateHuman(source, weights);
    const proxy = createProductionHuman();
    const motion = retargetMotionRestPose(
      createWalkStyleMotion('neutral'),
      proxy.skeleton,
      geometry.skeleton,
      'walk.production-deformation-fixture',
      { jointIds: productionAPoseArmRetargetJoints },
    );
    const accepted = verifyWalkingExtremityDeformation(geometry, motion);
    expect(accepted.status, accepted.issues.join('; ')).toBe('pass');
    expect(accepted.checks.unexpectedHandRotationTracks).toEqual([]);
    const leftToe = accepted.checks.regions.leftToe!;
    const rightToe = accepted.checks.regions.rightToe!;
    expect(leftToe.triangles).toBeGreaterThan(0);
    expect(rightToe.triangles).toBeGreaterThan(0);
    expect(leftToe.edgeLogStrainP99).toBeLessThan(0.25);
    expect(rightToe.edgeLogStrainP99).toBeLessThan(0.25);
    expect(leftToe.flippedTriangles).toBe(0);
    expect(rightToe.flippedTriangles).toBe(0);

    const grounded = groundMotionToCharacter(geometry, motion, {
      sampleCount: 121,
      verificationSampleCount: 241,
    });
    const finalBiomechanics = verifyCasualWalkMotion(grounded.motion, {
      verifyProxyGrounding: false,
    });
    expect(finalBiomechanics.valid, finalBiomechanics.issues.join('; ')).toBe(true);
    expect(grounded.verification.checks.clearanceMeters).toBeLessThan(0.01);

    const broken = motionClipSchema.parse({
      ...motion,
      tracks: [
        ...motion.tracks,
        {
          joint: 'left-hand',
          property: 'rotation-euler',
          keyframes: [
            { time: 0, value: [0, 0.8, -0.7] },
            { time: motion.durationSeconds, value: [0, 0.8, -0.7] },
          ],
        },
      ],
    });
    const rejected = verifyWalkingExtremityDeformation(geometry, broken);
    expect(rejected.status).toBe('fail');
    expect(rejected.issues.join('; ')).toMatch(/unexpected hand rotation tracks/u);
  }, 15_000);
});
