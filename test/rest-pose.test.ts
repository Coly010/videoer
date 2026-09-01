import { describe, expect, it } from 'vitest';
import type { GeometryAsset, SkeletonJoint } from '../src/geometry/model.js';
import { jointWorldTransforms } from '../src/geometry/kinematics.js';
import { motionClipSchema, sampleMotionTrack } from '../src/motion/model.js';
import { retargetMotionRestPose } from '../src/motion/rest-pose.js';

const skeleton = (angle: number): SkeletonJoint[] => [
  { id: 'root', restPosition: [0, 0, 0], constraints: {} },
  { id: 'left-clavicle', parent: 'root', restPosition: [0, 1, 0], constraints: {} },
  {
    id: 'left-upper-arm',
    parent: 'left-clavicle',
    restPosition: [Math.cos(angle), Math.sin(angle), 0],
    constraints: {},
  },
  {
    id: 'left-forearm',
    parent: 'left-upper-arm',
    restPosition: [Math.cos(angle * 0.55), Math.sin(angle * 0.55), 0],
    constraints: {},
  },
];

const asset = (joints: SkeletonJoint[]): GeometryAsset => ({
  schemaVersion: 1,
  id: 'character.retarget-fixture',
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
  skeleton: joints,
  morphTargets: [],
  attachments: {},
  metadata: {},
});

describe('rest-pose motion retargeting', () => {
  it('preserves the authored posed child direction from T-pose on an A-pose target', () => {
    const source = skeleton(0);
    const target = skeleton(-Math.PI * 0.28);
    const sourceAngle = -Math.PI * 0.4;
    const clip = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.t-pose-arm',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      loop: false,
      tracks: [
        {
          joint: 'left-clavicle',
          property: 'rotation-euler',
          space: 'local-delta',
          keyframes: [
            { time: 0, value: [0, 0, sourceAngle], easing: 'linear' },
            { time: 1, value: [0, 0, sourceAngle], easing: 'linear' },
          ],
        },
      ],
      morphTracks: [],
    });
    const adapted = retargetMotionRestPose(clip, source, target);
    const sourceRotation = sampleMotionTrack(clip.tracks[0]!, 0);
    const targetRotation = sampleMotionTrack(adapted.tracks[0]!, 0);
    const sourceWorld = jointWorldTransforms(asset(source), {
      'left-clavicle': { rotation: sourceRotation },
    }).get('left-upper-arm')!.position;
    const targetWorld = jointWorldTransforms(asset(target), {
      'left-clavicle': { rotation: targetRotation },
      'left-upper-arm': {
        rotation: sampleMotionTrack(
          adapted.tracks.find(
            (track) => track.joint === 'left-upper-arm' && track.property === 'rotation-euler',
          )!,
          0,
        ),
      },
    }).get('left-upper-arm')!.position;
    expect(targetWorld[0]).toBeCloseTo(sourceWorld[0], 8);
    expect(targetWorld[1]).toBeCloseTo(sourceWorld[1], 8);
    expect(adapted.metadata.restPoseRetargeting).toMatchObject({
      generator: 'videoer.rest-pose-retarget.v1',
    });
    const sourceForearm = jointWorldTransforms(asset(source), {
      'left-clavicle': { rotation: sourceRotation },
    }).get('left-forearm')!.position;
    const targetForearm = jointWorldTransforms(asset(target), {
      'left-clavicle': { rotation: targetRotation },
      'left-upper-arm': {
        rotation: sampleMotionTrack(
          adapted.tracks.find(
            (track) => track.joint === 'left-upper-arm' && track.property === 'rotation-euler',
          )!,
          0,
        ),
      },
    }).get('left-forearm')!.position;
    const sourceUpperArm = sourceWorld;
    const targetUpperArm = targetWorld;
    const sourceDirection = sourceForearm.map((value, index) => value - sourceUpperArm[index]!) as [
      number,
      number,
      number,
    ];
    const targetDirection = targetForearm.map((value, index) => value - targetUpperArm[index]!) as [
      number,
      number,
      number,
    ];
    const normalized = (value: [number, number, number]) => {
      const length = Math.hypot(...value);
      return value.map((coordinate) => coordinate / length);
    };
    expect(normalized(targetDirection)).toEqual(
      expect.arrayContaining(normalized(sourceDirection).map((value) => expect.closeTo(value, 8))),
    );
  });

  it('fails closed when ordered joint IDs differ', () => {
    const source = skeleton(0);
    const target = skeleton(0).map((joint) =>
      joint.id === 'left-upper-arm' ? { ...joint, id: 'right-upper-arm' } : joint,
    );
    const clip = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.incompatible',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      tracks: [
        {
          joint: 'left-clavicle',
          property: 'rotation-euler',
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [0, 0, 0] },
          ],
        },
      ],
    });
    expect(() => retargetMotionRestPose(clip, source, target)).toThrow(
      /identical ordered joint IDs/u,
    );
  });

  it('limits corrections to an explicit production retarget profile', () => {
    const source = skeleton(0);
    const target = skeleton(-Math.PI * 0.28);
    const clip = motionClipSchema.parse({
      schemaVersion: 1,
      id: 'motion.profiled',
      skeleton: 'videoer.canonical-humanoid.v1',
      durationSeconds: 1,
      tracks: [
        {
          joint: 'left-clavicle',
          property: 'rotation-euler',
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [0, 0, 0] },
          ],
        },
      ],
    });
    const adapted = retargetMotionRestPose(clip, source, target, 'motion.profiled.target', {
      jointIds: ['left-upper-arm'],
    });
    expect(adapted.tracks.find((track) => track.joint === 'left-clavicle')!.keyframes).toEqual(
      clip.tracks[0]!.keyframes,
    );
    expect(adapted.metadata.restPoseRetargeting).toMatchObject({
      correctedJoints: ['left-upper-arm'],
    });
    expect(adapted.tracks.some((track) => track.joint === 'left-forearm')).toBe(false);
  });
});
