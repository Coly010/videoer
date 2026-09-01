import { describe, expect, it } from 'vitest';
import type { GeometryAsset } from '../src/geometry/model.js';
import { groundMotionToCharacter, verifyCharacterGrounding } from '../src/motion/grounding.js';
import { motionClipSchema } from '../src/motion/model.js';

const geometry: GeometryAsset = {
  schemaVersion: 1,
  id: 'character.grounding-fixture',
  units: 'meters',
  coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
  positions: [
    [-0.1, 0.05, 0],
    [0.1, 0.05, 0],
    [0, 0.25, 0],
  ],
  indices: [0, 1, 2],
  materials: [],
  materialGroups: [],
  skeleton: [{ id: 'root', restPosition: [0, 0, 0], constraints: {} }],
  skinIndices: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  skinWeights: [
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
  ],
  morphTargets: [],
  attachments: {},
  metadata: {},
};

const floating = motionClipSchema.parse({
  schemaVersion: 1,
  id: 'walk.floating',
  skeleton: 'videoer.canonical-humanoid.v1',
  durationSeconds: 1,
  loop: true,
  tracks: [
    {
      joint: 'root',
      property: 'translation',
      keyframes: [
        { time: 0, value: [0, 0.04, 0] },
        { time: 0.5, value: [0, 0.07, -0.5] },
        { time: 1, value: [0, 0.04, -1] },
      ],
    },
  ],
});

describe('geometry-driven character grounding', () => {
  it('rejects clearance and grounds the final skinned surface', () => {
    expect(verifyCharacterGrounding(geometry, floating).status).toBe('fail');
    const result = groundMotionToCharacter(geometry, floating, {
      sampleCount: 41,
      verificationSampleCount: 81,
      maximumClearanceMeters: 0.001,
      maximumPenetrationMeters: 0.001,
    });
    expect(result.verification.status).toBe('pass');
    expect(result.verification.checks.clearanceMeters).toBeLessThan(0.001);
    expect(result.verification.checks.penetrationMeters).toBeLessThan(0.001);
    expect(result.motion.metadata.characterGrounding).toMatchObject({
      generator: 'videoer.character-grounding.v1',
    });
  });
});
