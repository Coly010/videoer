import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { motionClipSchema, type MotionClip } from './model.js';

const fingers = ['thumb', 'index', 'middle', 'ring', 'little'] as const;

/**
 * Adds a reusable low-energy walking hand layer. The base locomotion clip stays
 * compatible with the 22-joint proxy; production characters with finger chains
 * receive relaxed flexion without rotating the wrist or baking a bespoke gait.
 */
export function applyRelaxedWalkingHands(
  motionInput: MotionClip,
  geometry: GeometryAsset,
  id = motionInput.id,
) {
  const motion = motionClipSchema.parse(motionInput);
  const joints = new Set(geometry.skeleton.map((joint) => joint.id));
  const rotations: Array<{ joint: string; rotation: Vec3 }> = [];
  for (const side of ['left', 'right'] as const) {
    const direction = side === 'left' ? 1 : -1;
    for (const finger of fingers) {
      const fingerScale =
        finger === 'index' ? 0.9 : finger === 'ring' ? 1.08 : finger === 'little' ? 1.15 : 1;
      for (const [segment, degrees] of [
        [1, finger === 'thumb' ? 10 : 16 * fingerScale],
        [2, finger === 'thumb' ? 16 : 34 * fingerScale],
        [3, finger === 'thumb' ? 12 : 24 * fingerScale],
      ] as const) {
        const joint = `${side}-${finger}-${segment}`;
        if (!joints.has(joint)) continue;
        rotations.push({
          joint,
          rotation:
            finger === 'thumb'
              ? [(degrees * Math.PI) / 540, (-direction * (degrees * Math.PI)) / 180, 0]
              : [0, (direction * (degrees * Math.PI)) / 180, 0],
        });
      }
    }
  }
  if (!rotations.length) return motion;
  return motionClipSchema.parse({
    ...motion,
    id,
    tracks: [
      ...motion.tracks,
      ...rotations.map(({ joint, rotation }) => ({
        joint,
        property: 'rotation-euler' as const,
        space: 'local-delta' as const,
        interpolation: 'linear' as const,
        keyframes: [
          { time: 0, value: rotation },
          { time: motion.durationSeconds, value: rotation },
        ],
      })),
    ],
    metadata: {
      ...motion.metadata,
      handPoseLayer: {
        generator: 'videoer.relaxed-walking-hands.v3',
        mode: 'constant-additive-pose',
        flexionAxis: 'local-y-palm-depth',
        thumbOpposition: 'inward-toward-index-base',
        joints: rotations.map((value) => value.joint),
        wristTracks: 0,
      },
    },
  });
}
