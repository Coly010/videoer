import { z } from 'zod';
import type { GeometryAsset } from '../geometry/model.js';

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const keyframeSchema = z.object({
  time: z.number().nonnegative(),
  value: vec3Schema,
  velocity: vec3Schema.optional(),
  acceleration: vec3Schema.optional(),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).default('linear'),
});

const scalarKeyframeSchema = z.object({
  time: z.number().nonnegative(),
  value: z.number().min(0).max(1),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).default('linear'),
});

const morphTrackSchema = z.object({
  target: z.string().regex(/^[a-z][a-z0-9-]*$/),
  property: z.literal('weight'),
  keyframes: z.array(scalarKeyframeSchema).min(2),
});

const motionTrackSchema = z.object({
  joint: z.string().regex(/^[a-z][a-z0-9-]*$/),
  property: z.enum(['rotation-euler', 'translation']),
  space: z.literal('local-delta').default('local-delta'),
  interpolation: z.enum(['linear', 'quintic-hermite']).optional(),
  keyframes: z.array(keyframeSchema).min(2),
});

export const motionClipSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
    skeleton: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/),
    durationSeconds: z.number().positive(),
    loop: z.boolean().default(false),
    tracks: z.array(motionTrackSchema).default([]),
    morphTracks: z.array(morphTrackSchema).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((clip, ctx) => {
    if (!clip.tracks.length && !clip.morphTracks.length)
      ctx.addIssue({
        code: 'custom',
        path: ['tracks'],
        message: 'motion clip requires at least one bone or morph track',
      });
    const tracks = new Set<string>();
    for (const [trackIndex, track] of clip.tracks.entries()) {
      const key = `${track.joint}:${track.property}`;
      if (tracks.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', trackIndex],
          message: `duplicate motion track: ${key}`,
        });
      tracks.add(key);
      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        if (keyframe.time > clip.durationSeconds)
          ctx.addIssue({
            code: 'custom',
            path: ['tracks', trackIndex, 'keyframes', keyframeIndex, 'time'],
            message: 'keyframe exceeds clip duration',
          });
        if (keyframeIndex > 0 && keyframe.time <= track.keyframes[keyframeIndex - 1]!.time)
          ctx.addIssue({
            code: 'custom',
            path: ['tracks', trackIndex, 'keyframes', keyframeIndex, 'time'],
            message: 'keyframe times must be strictly increasing',
          });
        if (
          track.interpolation === 'quintic-hermite' &&
          (!keyframe.velocity || !keyframe.acceleration)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['tracks', trackIndex, 'keyframes', keyframeIndex],
            message: 'quintic Hermite keyframes require velocity and acceleration',
          });
      }
      if (track.keyframes[0]?.time !== 0)
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', trackIndex, 'keyframes', 0, 'time'],
          message: 'each track must begin at zero',
        });
      if (track.keyframes.at(-1)?.time !== clip.durationSeconds)
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', trackIndex, 'keyframes'],
          message: 'each track must end at clip duration',
        });
    }
    const morphTracks = new Set<string>();
    for (const [trackIndex, track] of clip.morphTracks.entries()) {
      if (morphTracks.has(track.target))
        ctx.addIssue({
          code: 'custom',
          path: ['morphTracks', trackIndex],
          message: `duplicate morph track: ${track.target}`,
        });
      morphTracks.add(track.target);
      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        if (keyframe.time > clip.durationSeconds)
          ctx.addIssue({
            code: 'custom',
            path: ['morphTracks', trackIndex, 'keyframes', keyframeIndex, 'time'],
            message: 'keyframe exceeds clip duration',
          });
        if (keyframeIndex > 0 && keyframe.time <= track.keyframes[keyframeIndex - 1]!.time)
          ctx.addIssue({
            code: 'custom',
            path: ['morphTracks', trackIndex, 'keyframes', keyframeIndex, 'time'],
            message: 'keyframe times must be strictly increasing',
          });
      }
      if (track.keyframes[0]?.time !== 0)
        ctx.addIssue({
          code: 'custom',
          path: ['morphTracks', trackIndex, 'keyframes', 0, 'time'],
          message: 'each morph track must begin at zero',
        });
      if (track.keyframes.at(-1)?.time !== clip.durationSeconds)
        ctx.addIssue({
          code: 'custom',
          path: ['morphTracks', trackIndex, 'keyframes'],
          message: 'each morph track must end at clip duration',
        });
    }
  });

export type MotionClip = z.infer<typeof motionClipSchema>;
export type MotionTrack = MotionClip['tracks'][number];
export type MorphTrack = MotionClip['morphTracks'][number];

export function validateMotionClip(clipInput: MotionClip, geometry?: GeometryAsset) {
  const clip = motionClipSchema.parse(clipInput);
  const issues: Array<{ code: string; message: string; track?: string }> = [];
  if (geometry) {
    const joints = new Set(geometry.skeleton.map((joint) => joint.id));
    for (const track of clip.tracks)
      if (!joints.has(track.joint))
        issues.push({
          code: 'motion.unknown-joint',
          message: `Motion targets unknown joint '${track.joint}'`,
          track: `${track.joint}:${track.property}`,
        });
    const morphTargets = new Set((geometry.morphTargets ?? []).map((target) => target.id));
    for (const track of clip.morphTracks)
      if (!morphTargets.has(track.target))
        issues.push({
          code: 'motion.unknown-morph-target',
          message: `Motion targets unknown morph '${track.target}'`,
          track: `morph:${track.target}`,
        });
  }
  return {
    valid: issues.length === 0,
    issues,
    stats: {
      tracks: clip.tracks.length,
      morphTracks: clip.morphTracks.length,
      durationSeconds: clip.durationSeconds,
      loop: clip.loop,
    },
  };
}

function ease(value: number, easing: MotionTrack['keyframes'][number]['easing']) {
  if (easing === 'ease-in') return value * value;
  if (easing === 'ease-out') return 1 - (1 - value) * (1 - value);
  if (easing === 'ease-in-out')
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  return value;
}

function quinticHermite(
  start: MotionTrack['keyframes'][number],
  end: MotionTrack['keyframes'][number],
  amount: number,
): [number, number, number] {
  const duration = end.time - start.time;
  const durationSquared = duration * duration;
  return start.value.map((value, axis) => {
    const endValue = end.value[axis]!;
    const startVelocity = start.velocity![axis]! * duration;
    const endVelocity = end.velocity![axis]! * duration;
    const startAcceleration = start.acceleration![axis]! * durationSquared;
    const endAcceleration = end.acceleration![axis]! * durationSquared;
    const difference = endValue - value;
    const c0 = value;
    const c1 = startVelocity;
    const c2 = startAcceleration / 2;
    const c3 =
      10 * difference -
      6 * startVelocity -
      4 * endVelocity -
      1.5 * startAcceleration +
      0.5 * endAcceleration;
    const c4 =
      -15 * difference +
      8 * startVelocity +
      7 * endVelocity +
      1.5 * startAcceleration -
      endAcceleration;
    const c5 =
      6 * difference -
      3 * (startVelocity + endVelocity) -
      0.5 * (startAcceleration - endAcceleration);
    return c0 + amount * (c1 + amount * (c2 + amount * (c3 + amount * (c4 + amount * c5))));
  }) as [number, number, number];
}

export function sampleMotionTrack(track: MotionTrack, seconds: number): [number, number, number] {
  const first = track.keyframes[0]!;
  const last = track.keyframes.at(-1)!;
  if (seconds <= first.time) return [...first.value];
  if (seconds >= last.time) return [...last.value];
  let lower = 1;
  let upper = track.keyframes.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (track.keyframes[middle]!.time >= seconds) upper = middle;
    else lower = middle + 1;
  }
  const nextIndex = lower;
  const next = track.keyframes[nextIndex]!;
  const previous = track.keyframes[nextIndex - 1]!;
  const rawAmount = (seconds - previous.time) / (next.time - previous.time);
  if (track.interpolation === 'quintic-hermite') return quinticHermite(previous, next, rawAmount);
  const amount = ease(rawAmount, previous.easing);
  return previous.value.map((value, index) => value + (next.value[index]! - value) * amount) as [
    number,
    number,
    number,
  ];
}

function vecOperation(
  values: Array<[number, number, number]>,
  coefficients: number[],
  divisor: number,
): [number, number, number] {
  return [0, 1, 2].map(
    (axis) =>
      values.reduce((total, value, index) => total + value[axis]! * coefficients[index]!, 0) /
      divisor,
  ) as [number, number, number];
}

export function createQuinticMotionKeyframes(
  values: Array<[number, number, number]>,
  durationSeconds: number,
  loop: boolean,
) {
  if (values.length < 4)
    throw new Error('Quintic motion interpolation requires at least four samples');
  const interval = durationSeconds / (values.length - 1);
  const lastIndex = values.length - 1;
  const drift = values[lastIndex]!.map((value, axis) => value - values[0]![axis]!) as [
    number,
    number,
    number,
  ];
  const offset = (value: [number, number, number], amount: number) =>
    value.map((component, axis) => component + drift[axis]! * amount) as [number, number, number];
  return values.map((value, index) => {
    let velocity: [number, number, number];
    let acceleration: [number, number, number];
    if (loop && (index === 0 || index === lastIndex)) {
      const previous = index === 0 ? offset(values[lastIndex - 1]!, -1) : values[lastIndex - 1]!;
      const next = index === 0 ? values[1]! : offset(values[1]!, 1);
      velocity = vecOperation([previous, next], [-1, 1], 2 * interval);
      acceleration = vecOperation([previous, value, next], [1, -2, 1], interval ** 2);
    } else if (index === 0) {
      velocity = vecOperation(values.slice(0, 3), [-3, 4, -1], 2 * interval);
      acceleration = vecOperation(values.slice(0, 4), [2, -5, 4, -1], interval ** 2);
    } else if (index === lastIndex) {
      const tail = values.slice(-4);
      velocity = vecOperation(tail.slice(-3), [1, -4, 3], 2 * interval);
      acceleration = vecOperation(tail, [-1, 4, -5, 2], interval ** 2);
    } else {
      velocity = vecOperation([values[index - 1]!, values[index + 1]!], [-1, 1], 2 * interval);
      acceleration = vecOperation(
        [values[index - 1]!, value, values[index + 1]!],
        [1, -2, 1],
        interval ** 2,
      );
    }
    return {
      // Preserve the declared endpoint exactly. For frame-derived durations such as
      // 43 / 24, recomputing the final time as 43 * (duration / 43) can round a few
      // ulps past durationSeconds and make an otherwise valid clip fail its schema.
      time: index === lastIndex ? durationSeconds : index * interval,
      value,
      velocity,
      acceleration,
      easing: 'linear' as const,
    };
  });
}

export function sampleMorphTrack(track: MorphTrack, seconds: number): number {
  const first = track.keyframes[0]!;
  const last = track.keyframes.at(-1)!;
  if (seconds <= first.time) return first.value;
  if (seconds >= last.time) return last.value;
  let lower = 1;
  let upper = track.keyframes.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (track.keyframes[middle]!.time >= seconds) upper = middle;
    else lower = middle + 1;
  }
  const nextIndex = lower;
  const next = track.keyframes[nextIndex]!;
  const previous = track.keyframes[nextIndex - 1]!;
  const amount = ease((seconds - previous.time) / (next.time - previous.time), previous.easing);
  return previous.value + (next.value - previous.value) * amount;
}

export function sampleMotion(clipInput: MotionClip, seconds: number) {
  const clip = motionClipSchema.parse(clipInput);
  const time = clip.loop
    ? ((seconds % clip.durationSeconds) + clip.durationSeconds) % clip.durationSeconds
    : Math.max(0, Math.min(clip.durationSeconds, seconds));
  return Object.fromEntries([
    ...clip.tracks.map((track) => [
      `${track.joint}:${track.property}`,
      sampleMotionTrack(track, time),
    ]),
    ...clip.morphTracks.map((track) => [`morph:${track.target}`, sampleMorphTrack(track, time)]),
  ]);
}
