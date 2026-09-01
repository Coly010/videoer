import { describe, expect, it } from 'vitest';
import type { GeometryAsset } from '../src/geometry/model.js';
import { verifyCharacterMotionAlignment } from '../src/motion/character-verification.js';
import { motionClipSchema } from '../src/motion/model.js';

const geometry: GeometryAsset = {
  schemaVersion: 1,
  id: 'character.facing-fixture',
  units: 'meters',
  coordinateSystem: { handedness: 'right', up: 'y', forward: '-z' },
  positions: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  indices: [0, 1, 2],
  materials: [],
  materialGroups: [],
  skeleton: [
    { id: 'root', restPosition: [0, 0, 0], constraints: {} },
    { id: 'head', parent: 'root', restPosition: [0, 1.6, 0], constraints: {} },
  ],
  morphTargets: [],
  attachments: {
    gaze: { position: [0, 1.62, -0.12], rotation: [0, 0, 0], bone: 'head' },
  },
  metadata: {},
};

const clip = (travelZ: number) =>
  motionClipSchema.parse({
    schemaVersion: 1,
    id: travelZ < 0 ? 'walk.forward' : 'walk.backward',
    skeleton: 'videoer.canonical-humanoid.v1',
    durationSeconds: 1,
    loop: false,
    tracks: [
      {
        joint: 'root',
        property: 'translation',
        space: 'local-delta',
        keyframes: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [0, 0, travelZ] },
        ],
      },
    ],
  });

describe('character motion alignment', () => {
  it('accepts travel in the direction witnessed by the visible face', () => {
    const result = verifyCharacterMotionAlignment(geometry, clip(-1));
    expect(result.status).toBe('pass');
    expect(result.checks.facingDot).toBeCloseTo(1, 8);
  });

  it('rejects a forward-facing character whose root travels backwards', () => {
    const result = verifyCharacterMotionAlignment(geometry, clip(1));
    expect(result.status).toBe('fail');
    expect(result.checks.facingDot).toBeCloseTo(-1, 8);
    expect(result.issues).toContain(
      'character travels against its facial direction (-1.000000 < 0.800000)',
    );
  });
});
