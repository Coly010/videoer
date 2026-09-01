import { createHumanoidMannequin } from '../characters/mannequin.js';
import {
  animatedAttachmentPosition,
  jointWorldTransforms,
  type JointDelta,
} from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import { motionClipSchema, sampleMotion, type MotionClip } from '../motion/model.js';
import { solveTwoBoneReach } from '../motion/ik.js';
import { createSignificantBook } from '../props/book.js';
import { createBookshopDoor } from '../props/door.js';
import {
  interactionDefinitionSchema,
  sceneTransformSchema,
  type InteractionDefinition,
  type SceneTransform,
} from './model.js';
import { inverseTransformPoint, transformPoint } from './transforms.js';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...subtract(a, b));
const mix = (a: Vec3, b: Vec3, amount: number): Vec3 => add(a, scale(subtract(b, a), amount));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

interface Sample {
  time: number;
  pose: Record<string, JointDelta>;
}

function keyframes(samples: Sample[], joint: string, property: 'rotation-euler' | 'translation') {
  const field = property === 'rotation-euler' ? 'rotation' : 'translation';
  return samples.map((sample) => ({
    time: sample.time,
    value: sample.pose[joint]?.[field] ?? ([0, 0, 0] as Vec3),
    easing: 'linear' as const,
  }));
}

function clipFromSamples(
  id: string,
  skeleton: string,
  durationSeconds: number,
  samples: Sample[],
  tracks: Array<{ joint: string; property: 'rotation-euler' | 'translation' }>,
  metadata: Record<string, unknown>,
) {
  return motionClipSchema.parse({
    schemaVersion: 1,
    id,
    skeleton,
    durationSeconds,
    loop: false,
    tracks: tracks.map((track) => ({
      ...track,
      space: 'local-delta' as const,
      keyframes: keyframes(samples, track.joint, track.property),
    })),
    metadata,
  });
}

function poseFromMotion(clip: MotionClip, seconds: number) {
  const values = sampleMotion(clip, seconds);
  const pose: Record<string, JointDelta> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('morph:') || !Array.isArray(value)) continue;
    const separator = key.lastIndexOf(':');
    const joint = key.slice(0, separator);
    const property = key.slice(separator + 1);
    const delta = (pose[joint] ??= {});
    if (property === 'rotation-euler') delta.rotation = value as [number, number, number];
    if (property === 'translation') delta.translation = value as [number, number, number];
  }
  return pose;
}

function armDimensions(actor: GeometryAsset, side: 'left' | 'right') {
  const joint = (id: string) => {
    const value = actor.skeleton.find((candidate) => candidate.id === id);
    if (!value) throw new Error(`Actor '${actor.id}' lacks required joint '${id}'`);
    return value;
  };
  const upper = joint(`${side}-upper-arm`);
  const forearm = joint(`${side}-forearm`);
  const hand = joint(`${side}-hand`);
  return {
    upperLength: Math.hypot(...upper.restPosition),
    lowerLength: Math.hypot(...forearm.restPosition) + Math.hypot(...hand.restPosition),
  };
}

function solveArmPose(
  actor: GeometryAsset,
  side: 'left' | 'right',
  rootTranslation: Vec3,
  target: Vec3,
) {
  const rest = jointWorldTransforms(actor, { root: { translation: rootTranslation } });
  const origin = rest.get(`${side}-clavicle`)?.position;
  if (!origin) throw new Error(`Actor '${actor.id}' lacks a ${side} clavicle`);
  const dimensions = armDimensions(actor, side);
  const sideSign = side === 'left' ? 1 : -1;
  const solution = solveTwoBoneReach({
    side,
    origin,
    target,
    ...dimensions,
    pole: [sideSign, -0.55, -0.18],
    minimumBendRadians: 0.08,
  });
  if (!solution.reachable)
    throw new Error(
      `${side} hand target is unreachable by ${solution.endpointErrorMeters.toFixed(3)} m`,
    );
  return {
    [`${side}-clavicle`]: { rotation: solution.shoulderRotation },
    [`${side}-upper-arm`]: { rotation: solution.elbowRotation },
  } satisfies Record<string, JointDelta>;
}

function relaxedHandTarget(
  actor: GeometryAsset,
  side: 'left' | 'right',
  rootTranslation: Vec3 = [0, 0, 0],
) {
  const shoulder = jointWorldTransforms(actor, { root: { translation: rootTranslation } }).get(
    `${side}-clavicle`,
  )?.position;
  if (!shoulder) throw new Error(`Actor '${actor.id}' lacks a ${side} clavicle`);
  const outward = side === 'left' ? 0.18 : -0.18;
  return add(shoulder, [outward, -0.64, -0.035]);
}

function animatedWorldAttachment(
  asset: GeometryAsset,
  attachment: string,
  transform: SceneTransform,
  pose: Record<string, JointDelta>,
) {
  return transformPoint(animatedAttachmentPosition(asset, attachment, pose), transform);
}

export interface InteractionSynthesis {
  definition: InteractionDefinition;
  actor: GeometryAsset;
  target?: GeometryAsset;
  actorTransform: SceneTransform;
  targetTransform?: SceneTransform;
  actorClip: MotionClip;
  targetClip?: MotionClip;
  verification: {
    valid: boolean;
    issues: string[];
    checks: Record<string, number | string | boolean>;
  };
}

export function createTurnMotion(
  direction: 'left' | 'right',
  scope: 'head' | 'body' | 'head-and-body' = 'head-and-body',
) {
  const durationSeconds = 1.4;
  const sign = direction === 'left' ? 1 : -1;
  const includeHead = scope !== 'body';
  const includeBody = scope !== 'head';
  const tracks: MotionClip['tracks'] = [];
  const turnTrack = (joint: string, radians: number): MotionClip['tracks'][number] => ({
    joint,
    property: 'rotation-euler',
    space: 'local-delta',
    keyframes: [
      { time: 0, value: [0, 0, 0], easing: 'ease-in-out' },
      { time: 0.78, value: [0, radians * sign, 0], easing: 'ease-in-out' },
      { time: durationSeconds, value: [0, radians * sign, 0], easing: 'linear' },
    ],
  });
  if (includeBody) {
    tracks.push(turnTrack('hips', 0.18), turnTrack('spine', 0.2), turnTrack('chest', 0.22));
  }
  if (includeHead) tracks.push(turnTrack('neck', 0.24), turnTrack('head', 0.34));
  return motionClipSchema.parse({
    schemaVersion: 1,
    id: `turn.${scope}.${direction}`,
    skeleton: 'videoer.canonical-humanoid.v1',
    durationSeconds,
    loop: false,
    tracks,
    metadata: { generator: 'videoer.turn-synthesis.v1', direction, scope },
  });
}

export function createTargetedTurnMotion(
  actorTransform: SceneTransform,
  targetWorld: Vec3,
  scope: 'head' | 'body' | 'head-and-body' = 'head-and-body',
  durationSeconds = 1.4,
  maximumYawRadians = Math.PI * 0.48,
) {
  const localTarget = inverseTransformPoint(targetWorld, actorTransform);
  const yaw = Math.max(
    -maximumYawRadians,
    Math.min(maximumYawRadians, Math.atan2(-localTarget[0], -localTarget[2])),
  );
  const distribution =
    scope === 'head'
      ? { neck: 0.38, head: 0.62 }
      : scope === 'body'
        ? { hips: 0.22, spine: 0.27, chest: 0.34, neck: 0.07, head: 0.1 }
        : { hips: 0.12, spine: 0.18, chest: 0.24, neck: 0.18, head: 0.28 };
  return motionClipSchema.parse({
    schemaVersion: 1,
    id: `turn.targeted.${scope}`,
    skeleton: 'videoer.canonical-humanoid.v1',
    durationSeconds,
    loop: false,
    tracks: Object.entries(distribution).map(([joint, amount]) => ({
      joint,
      property: 'rotation-euler' as const,
      space: 'local-delta' as const,
      keyframes: [
        { time: 0, value: [0, 0, 0], easing: 'ease-in-out' as const },
        {
          time: durationSeconds * 0.62,
          value: [0, yaw * amount, 0],
          easing: 'ease-in-out' as const,
        },
        { time: durationSeconds, value: [0, yaw * amount, 0], easing: 'linear' as const },
      ],
    })),
    metadata: {
      generator: 'videoer.targeted-turn-synthesis.v1',
      scope,
      targetWorld,
      targetLocal: localTarget,
      resolvedYawRadians: yaw,
      maximumYawRadians,
    },
  });
}

export function createTurnVerificationMotion(
  actor: GeometryAsset,
  direction: 'left' | 'right',
  scope: 'head' | 'body' | 'head-and-body',
) {
  const turn = createTurnMotion(direction, scope);
  const relaxedPose = {
    ...solveArmPose(actor, 'left', [0, 0, 0], relaxedHandTarget(actor, 'left')),
    ...solveArmPose(actor, 'right', [0, 0, 0], relaxedHandTarget(actor, 'right')),
  };
  const relaxedTracks: MotionClip['tracks'] = Object.entries(relaxedPose).map(([joint, delta]) => ({
    joint,
    property: 'rotation-euler',
    space: 'local-delta',
    keyframes: [
      { time: 0, value: delta.rotation ?? [0, 0, 0], easing: 'linear' },
      {
        time: turn.durationSeconds,
        value: delta.rotation ?? [0, 0, 0],
        easing: 'linear',
      },
    ],
  }));
  return motionClipSchema.parse({
    ...turn,
    id: `${turn.id}.verification`,
    tracks: [...turn.tracks, ...relaxedTracks],
    metadata: {
      ...turn.metadata,
      verificationBase: 'relaxed-bilateral-arm-pose',
      publishedTracksRemainAdditive: true,
    },
  });
}

export function createOpenDoorInteraction(actor = createHumanoidMannequin()): InteractionSynthesis {
  const door = createBookshopDoor();
  const durationSeconds = 4.8;
  const actorTransform = sceneTransformSchema.parse({
    position: [0, 0, -0.6],
    rotation: [0, Math.PI, 0],
  });
  const targetTransform = sceneTransformSchema.parse({});
  const definition = interactionDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'interaction.open-bookshop-door',
    type: 'open-door',
    actor: actor.id,
    target: door.id,
    hand: 'right',
    phases: [
      { id: 'approach', start: 0, end: 0.18, constraint: 'approach' },
      {
        id: 'reach',
        start: 0.18,
        end: 0.36,
        constraint: 'point',
        actorEffector: 'right-hand-grip',
        targetAttachment: 'handle-grip',
      },
      {
        id: 'grasp',
        start: 0.36,
        end: 0.48,
        constraint: 'attach',
        actorEffector: 'right-hand-grip',
        targetAttachment: 'handle-grip',
      },
      {
        id: 'turn-handle',
        start: 0.48,
        end: 0.58,
        constraint: 'pivot',
        actorEffector: 'right-hand-grip',
        targetAttachment: 'handle-grip',
      },
      {
        id: 'open',
        start: 0.58,
        end: 0.84,
        constraint: 'attach',
        actorEffector: 'right-hand-grip',
        targetAttachment: 'handle-grip',
      },
      { id: 'release', start: 0.84, end: 0.92, constraint: 'release' },
      { id: 'pass-through', start: 0.92, end: 1, constraint: 'approach' },
    ],
    invariants: ['contact', 'joint-limits', 'root-continuity'],
  });
  const sampleCount = 33;
  const doorSamples: Sample[] = [];
  const actorSamples: Sample[] = [];
  const relaxedHand = relaxedHandTarget(actor, 'right');
  const closedHandleWorld = animatedWorldAttachment(door, 'handle-grip', targetTransform, {});
  const closedHandle = inverseTransformPoint(closedHandleWorld, actorTransform);
  for (let index = 0; index < sampleCount; index++) {
    const progress = index / (sampleCount - 1);
    const time = progress * durationSeconds;
    const handleTurn = -0.42 * smoothstep((progress - 0.46) / 0.1);
    const leafTurn = -0.78 * smoothstep((progress - 0.56) / 0.28);
    const doorPose: Record<string, JointDelta> = {
      handle: { rotation: [handleTurn, 0, 0] },
      'door-leaf': { rotation: [0, leafTurn, 0] },
    };
    doorSamples.push({ time, pose: doorPose });
    const handleWorld = animatedWorldAttachment(door, 'handle-grip', targetTransform, doorPose);
    const handle = inverseTransformPoint(handleWorld, actorTransform);
    const follow = smoothstep((progress - 0.5) / 0.34);
    const handleTravel = subtract(handle, closedHandle);
    const rootTranslation: Vec3 =
      progress < 0.84
        ? [handleTravel[0] * 0.84 * follow, 0, handleTravel[2] * 0.84 * follow]
        : [
            handleTravel[0] * 0.84,
            0,
            handleTravel[2] * 0.84 - smoothstep((progress - 0.92) / 0.08) * 0.3,
          ];
    const reach = smoothstep((progress - 0.18) / 0.18);
    const release = smoothstep((progress - 0.84) / 0.12);
    const attachedTarget = progress < 0.36 ? mix(relaxedHand, closedHandle, reach) : handle;
    const handTarget = mix(
      attachedTarget,
      relaxedHandTarget(actor, 'right', rootTranslation),
      release,
    );
    const step = smoothstep((progress - 0.88) / 0.12);
    const stride = Math.sin(step * Math.PI);
    actorSamples.push({
      time,
      pose: {
        root: { translation: rootTranslation },
        ...solveArmPose(
          actor,
          'left',
          rootTranslation,
          relaxedHandTarget(actor, 'left', rootTranslation),
        ),
        ...solveArmPose(actor, 'right', rootTranslation, handTarget),
        'right-hand': { rotation: [0, 0, -0.16 * (1 - release)] },
        'left-thigh': { rotation: [0.42 * stride, 0, 0] },
        'left-shin': { rotation: [-0.58 * stride, 0, 0] },
        'right-thigh': { rotation: [-0.32 * stride, 0, 0] },
        'right-shin': { rotation: [-0.34 * stride, 0, 0] },
      },
    });
  }
  const actorClip = clipFromSamples(
    'interaction.open-bookshop-door.actor',
    'videoer.canonical-humanoid.v1',
    durationSeconds,
    actorSamples,
    [
      { joint: 'root', property: 'translation' },
      { joint: 'left-clavicle', property: 'rotation-euler' },
      { joint: 'left-upper-arm', property: 'rotation-euler' },
      { joint: 'right-clavicle', property: 'rotation-euler' },
      { joint: 'right-upper-arm', property: 'rotation-euler' },
      { joint: 'right-hand', property: 'rotation-euler' },
      { joint: 'left-thigh', property: 'rotation-euler' },
      { joint: 'left-shin', property: 'rotation-euler' },
      { joint: 'right-thigh', property: 'rotation-euler' },
      { joint: 'right-shin', property: 'rotation-euler' },
    ],
    { generator: 'videoer.open-door-synthesis.v1', interaction: definition.id },
  );
  const targetClip = clipFromSamples(
    'interaction.open-bookshop-door.target',
    'videoer.prop.bookshop-door.v1',
    durationSeconds,
    doorSamples,
    [
      { joint: 'door-leaf', property: 'rotation-euler' },
      { joint: 'handle', property: 'rotation-euler' },
    ],
    { generator: 'videoer.open-door-synthesis.v1', interaction: definition.id },
  );
  let maximumContactError = 0;
  let minimumElbowBend = Number.POSITIVE_INFINITY;
  for (let index = 0; index < sampleCount; index++) {
    const progress = index / (sampleCount - 1);
    if (progress < 0.36 || progress > 0.84) continue;
    const time = progress * durationSeconds;
    const actorPose = poseFromMotion(actorClip, time);
    const doorPose = poseFromMotion(targetClip, time);
    maximumContactError = Math.max(
      maximumContactError,
      distance(
        animatedWorldAttachment(actor, 'right-hand-grip', actorTransform, actorPose),
        animatedWorldAttachment(door, 'handle-grip', targetTransform, doorPose),
      ),
    );
    minimumElbowBend = Math.min(
      minimumElbowBend,
      Math.abs(actorPose['right-upper-arm']?.rotation?.[2] ?? 0),
    );
  }
  const issues: string[] = [];
  if (maximumContactError > 0.006)
    issues.push('right hand does not remain attached to the moving handle');
  if (minimumElbowBend < 0.08) issues.push('right elbow reaches a singular straight-arm pose');
  return {
    definition,
    actor,
    target: door,
    actorTransform,
    targetTransform,
    actorClip,
    targetClip,
    verification: {
      valid: issues.length === 0,
      issues,
      checks: {
        maximumContactErrorMeters: maximumContactError,
        minimumElbowBendRadians: minimumElbowBend,
        doorOpenRadians: 0.78,
        handleTurnRadians: 0.42,
      },
    },
  };
}

export function createReadBookInteraction(actor = createHumanoidMannequin()): InteractionSynthesis {
  const book = createSignificantBook();
  const durationSeconds = 3.2;
  const actorTransform = sceneTransformSchema.parse({});
  const targetTransform = sceneTransformSchema.parse({ position: [0, 1.17, -0.37] });
  const definition = interactionDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'interaction.read-significant-book',
    type: 'read-book',
    actor: actor.id,
    target: book.id,
    hand: 'both',
    phases: [
      { id: 'hold-low', start: 0, end: 0.16, constraint: 'attach' },
      { id: 'raise', start: 0.16, end: 0.48, constraint: 'attach' },
      { id: 'settle', start: 0.48, end: 0.64, constraint: 'attach' },
      { id: 'read', start: 0.64, end: 1, constraint: 'attach' },
    ],
    invariants: ['contact', 'gaze', 'joint-limits'],
    metadata: {
      effectors: { left: 'left-hand-grip', right: 'right-hand-grip' },
      targets: { left: 'left-grip', right: 'right-grip' },
    },
  });
  const head = jointWorldTransforms(actor).get('head')!.position;
  const actorSamples: Sample[] = [];
  const bookSamples: Sample[] = [];
  const sampleCount = 25;
  let finalGazeTurn = 0;
  for (let index = 0; index < sampleCount; index++) {
    const progress = index / (sampleCount - 1);
    const time = progress * durationSeconds;
    const raise = smoothstep((progress - 0.12) / 0.38);
    const settle = Math.sin(smoothstep((progress - 0.48) / 0.16) * Math.PI) * 0.018;
    const rootTranslation: Vec3 = [0, -0.22 * (1 - raise) - settle, 0.25 * (1 - raise)];
    const bookPose: Record<string, JointDelta> = { root: { translation: rootTranslation } };
    bookSamples.push({ time, pose: bookPose });
    const leftGrip = animatedWorldAttachment(book, 'left-grip', targetTransform, bookPose);
    const rightGrip = animatedWorldAttachment(book, 'right-grip', targetTransform, bookPose);
    const gazeTarget = animatedWorldAttachment(book, 'gaze-target', targetTransform, bookPose);
    const gazeVector = subtract(gazeTarget, head);
    const yaw = Math.atan2(-gazeVector[0], -gazeVector[2]);
    const pitch = Math.atan2(gazeVector[1], Math.hypot(gazeVector[0], gazeVector[2]));
    finalGazeTurn = Math.hypot(pitch, yaw);
    const look = smoothstep(progress / 0.52);
    actorSamples.push({
      time,
      pose: {
        ...solveArmPose(actor, 'left', [0, 0, 0], leftGrip),
        ...solveArmPose(actor, 'right', [0, 0, 0], rightGrip),
        neck: { rotation: [pitch * 0.42 * look, yaw * 0.38 * look, 0] },
        head: { rotation: [pitch * 0.58 * look, yaw * 0.62 * look, 0] },
      },
    });
  }
  const actorClip = clipFromSamples(
    'interaction.read-significant-book.actor',
    'videoer.canonical-humanoid.v1',
    durationSeconds,
    actorSamples,
    [
      { joint: 'left-clavicle', property: 'rotation-euler' },
      { joint: 'left-upper-arm', property: 'rotation-euler' },
      { joint: 'right-clavicle', property: 'rotation-euler' },
      { joint: 'right-upper-arm', property: 'rotation-euler' },
      { joint: 'neck', property: 'rotation-euler' },
      { joint: 'head', property: 'rotation-euler' },
    ],
    { generator: 'videoer.read-book-synthesis.v1', interaction: definition.id },
  );
  const targetClip = clipFromSamples(
    'interaction.read-significant-book.target',
    'videoer.prop.significant-book.v1',
    durationSeconds,
    bookSamples,
    [{ joint: 'root', property: 'translation' }],
    { generator: 'videoer.read-book-synthesis.v1', interaction: definition.id },
  );
  let leftError = 0;
  let rightError = 0;
  for (let index = 0; index < sampleCount; index++) {
    const time = (index / (sampleCount - 1)) * durationSeconds;
    const actorPose = poseFromMotion(actorClip, time);
    const bookPose = poseFromMotion(targetClip, time);
    leftError = Math.max(
      leftError,
      distance(
        animatedWorldAttachment(actor, 'left-hand-grip', actorTransform, actorPose),
        animatedWorldAttachment(book, 'left-grip', targetTransform, bookPose),
      ),
    );
    rightError = Math.max(
      rightError,
      distance(
        animatedWorldAttachment(actor, 'right-hand-grip', actorTransform, actorPose),
        animatedWorldAttachment(book, 'right-grip', targetTransform, bookPose),
      ),
    );
  }
  const issues: string[] = [];
  if (leftError > 0.006) issues.push('left hand misses the book grip');
  if (rightError > 0.006) issues.push('right hand misses the book grip');
  if (finalGazeTurn < 0.05) issues.push('head gaze is not directed toward the book');
  return {
    definition,
    actor,
    target: book,
    actorTransform,
    targetTransform,
    actorClip,
    targetClip,
    verification: {
      valid: issues.length === 0,
      issues,
      checks: {
        leftContactErrorMeters: leftError,
        rightContactErrorMeters: rightError,
        gazeTurnRadians: finalGazeTurn,
        twoHandConstraint: true,
        contactCheckedAcrossCompleteClip: true,
      },
    },
  };
}
