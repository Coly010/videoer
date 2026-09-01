import {
  createQuinticMotionKeyframes,
  motionClipSchema,
  sampleMotionTrack,
  type MotionClip,
} from './model.js';
import { jointWorldTransforms } from '../geometry/kinematics.js';
import type { GeometryAsset, Vec3 } from '../geometry/model.js';
import {
  bakedWalkGroundCorrection,
  evaluateNaturalWalk,
  gaitMetrics,
  gaitStyles,
  solveNaturalWalkLegsForRoot,
  verifyBakedNaturalWalk,
  verifyNaturalWalk,
  type GaitProportions,
  type GaitStyle,
} from './gait.js';
import { verifyMotionKinematics } from './kinematics.js';
import type { MotionPose } from './composition.js';
import { samplePhaseCurve } from './curves.js';

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function cyclicCorrelation(left: number[], right: number[], lagSamples: number) {
  const count = Math.min(left.length, right.length);
  const leftMean = left.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  const rightMean = right.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < count; index++) {
    const leftValue = left[index]! - leftMean;
    const rightIndex = (((index + lagSamples) % count) + count) % count;
    const rightValue = right[rightIndex]! - rightMean;
    numerator += leftValue * rightValue;
    leftEnergy += leftValue * leftValue;
    rightEnergy += rightValue * rightValue;
  }
  return leftEnergy && rightEnergy ? numerator / Math.sqrt(leftEnergy * rightEnergy) : 1;
}

function strongestOppositionLag(left: number[], right: number[], maximumLagSamples = 8) {
  const candidates = Array.from({ length: maximumLagSamples * 2 + 1 }, (_, index) => {
    const lagSamples = index - maximumLagSamples;
    return { lagSamples, correlation: cyclicCorrelation(left, right, lagSamples) };
  });
  return candidates.reduce((strongest, candidate) =>
    candidate.correlation < strongest.correlation ? candidate : strongest,
  );
}

export interface WalkRigInput {
  height?: number;
  legLength?: number;
  thighLength?: number;
  shinLength?: number;
  thighRestForward?: number;
  thighRestDown?: number;
  thighRestLateral?: number;
  shinRestForward?: number;
  shinRestDown?: number;
  shinRestLateral?: number;
  armLength?: number;
  hipWidth?: number;
  footScale?: number;
  heelBack?: number;
  heelDrop?: number;
  ballForward?: number;
  ballDrop?: number;
  toeForward?: number;
  toeRise?: number;
  flatFootPitch?: number;
  hipToGroundRest?: number;
  kneeReserve?: number;
}

const distance3 = (left: Vec3, right: Vec3) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

/** Derives locomotion proportions from the target bind skeleton instead of
 * trusting requested morph parameters that a template may not yet implement. */
export function measureWalkRig(geometry: GeometryAsset): Required<WalkRigInput> {
  const worlds = jointWorldTransforms(geometry);
  const position = (id: string) => {
    const value = worlds.get(id)?.position;
    if (!value) throw new Error(`Cannot measure walk rig without joint '${id}'`);
    return value;
  };
  const pairedChain = (proximal: string, middle: string, distal: string) =>
    (['left', 'right'] as const).reduce(
      (sum, side) =>
        sum +
        distance3(position(`${side}-${proximal}`), position(`${side}-${middle}`)) +
        distance3(position(`${side}-${middle}`), position(`${side}-${distal}`)),
      0,
    ) / 2;
  const ys = geometry.positions.map((value) => value[1]);
  const parameters = geometry.metadata.parameters as { footScale?: number } | undefined;
  const paired = (measure: (side: 'left' | 'right') => number) =>
    (measure('left') + measure('right')) / 2;
  const joint = (id: string) => {
    const value = geometry.skeleton.find((candidate) => candidate.id === id);
    if (!value) throw new Error(`Cannot measure walk rig without joint '${id}'`);
    return value;
  };
  const thighLength = paired((side) => Math.hypot(...joint(`${side}-shin`).restPosition));
  const shinLength = paired((side) => Math.hypot(...joint(`${side}-foot`).restPosition));
  const attachment = (id: string) => {
    const value = geometry.attachments[id]?.position;
    if (!value) throw new Error(`Cannot measure walk rig without attachment '${id}'`);
    return value;
  };
  const heelBack = paired(
    (side) => attachment(`${side}-heel-contact`)[2] - position(`${side}-foot`)[2],
  );
  const heelDrop = paired(
    (side) => position(`${side}-foot`)[1] - attachment(`${side}-heel-contact`)[1],
  );
  const ballForward = paired((side) => position(`${side}-foot`)[2] - position(`${side}-toe`)[2]);
  const ballDrop = paired((side) => position(`${side}-foot`)[1] - position(`${side}-toe`)[1]);
  const toeForward = paired(
    (side) => position(`${side}-toe`)[2] - attachment(`${side}-toe-contact`)[2],
  );
  const toeRise = paired(
    (side) => attachment(`${side}-toe-contact`)[1] - position(`${side}-toe`)[1],
  );
  const thighRestForward = paired((side) => -joint(`${side}-shin`).restPosition[2]);
  const thighRestDown = paired((side) => -joint(`${side}-shin`).restPosition[1]);
  const shinRestForward = paired((side) => -joint(`${side}-foot`).restPosition[2]);
  const shinRestDown = paired((side) => -joint(`${side}-foot`).restPosition[1]);
  return {
    height: Math.max(...ys) - Math.min(...ys),
    legLength: thighLength + shinLength,
    thighLength,
    shinLength,
    thighRestForward,
    thighRestDown,
    thighRestLateral: paired((side) => Math.abs(joint(`${side}-shin`).restPosition[0])),
    shinRestForward,
    shinRestDown,
    shinRestLateral: paired((side) => Math.abs(joint(`${side}-foot`).restPosition[0])),
    armLength: pairedChain('upper-arm', 'forearm', 'hand'),
    hipWidth: distance3(position('left-thigh'), position('right-thigh')),
    footScale: parameters?.footScale ?? 1,
    heelBack,
    heelDrop,
    ballForward,
    ballDrop,
    toeForward,
    toeRise,
    flatFootPitch: -Math.atan2(heelDrop - ballDrop + toeRise, heelBack + ballForward + toeForward),
    hipToGroundRest: paired(
      (side) => position(`${side}-thigh`)[1] - attachment(`${side}-heel-contact`)[1],
    ),
    kneeReserve: Math.max(
      0.001,
      thighLength +
        shinLength -
        Math.hypot(thighRestForward + shinRestForward, thighRestDown + shinRestDown),
    ),
  };
}

const defaults: GaitProportions = {
  height: 1.72,
  legLength: 0.88,
  thighLength: 0.88 * 0.51,
  shinLength: 0.88 * 0.49,
  thighRestForward: 0,
  thighRestDown: 0.88 * 0.51,
  thighRestLateral: 0,
  shinRestForward: 0,
  shinRestDown: 0.88 * 0.49,
  shinRestLateral: 0,
  armLength: 0.62,
  hipWidth: 0.32,
  footScale: 1,
  heelBack: 1.72 * 0.028,
  heelDrop: 1.72 * (0.035 + 0.0115),
  ballForward: 1.72 * 0.12 * 0.62,
  ballDrop: 1.72 * (0.035 + 0.0115),
  toeForward: 1.72 * 0.12 * 0.38,
  toeRise: 0,
  flatFootPitch: 0,
  hipToGroundRest: 1.72 * 0.035 + 0.88 * 0.98,
  kneeReserve: 0.001,
};

function proportionsFromInput(input: WalkRigInput): GaitProportions {
  const height = input.height ?? defaults.height;
  const legLength = input.legLength ?? defaults.legLength;
  const footScale = input.footScale ?? defaults.footScale;
  const thighLength = input.thighLength ?? legLength * 0.51;
  const shinLength = input.shinLength ?? legLength - thighLength;
  const defaultDrop = height * (0.035 * footScale + 0.0115);
  return {
    height,
    legLength,
    thighLength,
    shinLength,
    thighRestForward: input.thighRestForward ?? 0,
    thighRestDown: input.thighRestDown ?? thighLength,
    thighRestLateral: input.thighRestLateral ?? 0,
    shinRestForward: input.shinRestForward ?? 0,
    shinRestDown: input.shinRestDown ?? shinLength,
    shinRestLateral: input.shinRestLateral ?? 0,
    armLength: input.armLength ?? defaults.armLength,
    hipWidth: input.hipWidth ?? defaults.hipWidth,
    footScale,
    heelBack: input.heelBack ?? height * 0.028 * footScale,
    heelDrop: input.heelDrop ?? defaultDrop,
    ballForward: input.ballForward ?? height * 0.12 * footScale * 0.62,
    ballDrop: input.ballDrop ?? defaultDrop,
    toeForward: input.toeForward ?? height * 0.12 * footScale * 0.38,
    toeRise: input.toeRise ?? 0,
    flatFootPitch: input.flatFootPitch ?? 0,
    hipToGroundRest: input.hipToGroundRest ?? height * 0.035 * footScale + legLength * 0.98,
    kneeReserve: input.kneeReserve ?? 0.001,
  };
}

function gaitBandwidthValues(values: Array<[number, number, number]>, maximumHarmonic = 6) {
  const periodSamples = values.length - 1;
  const filtered = Array.from(
    { length: values.length },
    (_, sampleIndex) =>
      [0, 1, 2].map((axis) => {
        let reconstructed = 0;
        const phase = (sampleIndex % periodSamples) / periodSamples;
        for (let harmonic = -maximumHarmonic; harmonic <= maximumHarmonic; harmonic++) {
          let real = 0;
          let imaginary = 0;
          for (let sourceIndex = 0; sourceIndex < periodSamples; sourceIndex++) {
            const angle = (-2 * Math.PI * harmonic * sourceIndex) / periodSamples;
            real += values[sourceIndex]![axis]! * Math.cos(angle);
            imaginary += values[sourceIndex]![axis]! * Math.sin(angle);
          }
          real /= periodSamples;
          imaginary /= periodSamples;
          const angle = 2 * Math.PI * harmonic * phase;
          reconstructed += real * Math.cos(angle) - imaginary * Math.sin(angle);
        }
        return reconstructed;
      }) as [number, number, number],
  );
  filtered[filtered.length - 1] = [...filtered[0]!] as [number, number, number];
  return filtered;
}

function sampleClipPose(clip: MotionClip, phase: number) {
  const pose: MotionPose = {};
  for (const track of clip.tracks) {
    const joint = (pose[track.joint] ??= {});
    const value = sampleMotionTrack(track, phase * clip.durationSeconds);
    if (track.property === 'rotation-euler') joint.rotation = value;
    else joint.translation = value;
  }
  return pose;
}

function rebuildBakedLegTracks(clip: MotionClip, proportions: GaitProportions, style: GaitStyle) {
  const phases = Array.from({ length: 401 }, (_, index) => index / 400);
  const joints = [
    'left-thigh',
    'left-shin',
    'left-foot',
    'left-toe',
    'right-thigh',
    'right-shin',
    'right-foot',
    'right-toe',
  ] as const;
  const values = new Map<(typeof joints)[number], Array<[number, number, number]>>(
    joints.map((joint) => [joint, []]),
  );
  const currentValues = new Map<(typeof joints)[number], Array<[number, number, number]>>(
    joints.map((joint) => [joint, []]),
  );
  const rootTrack = requiredTrack(clip, 'root', 'translation');
  for (const phase of phases) {
    const root =
      phase === 1
        ? (rootTrack.keyframes.at(-1)!.value as [number, number, number])
        : sampleMotionTrack(rootTrack, phase * clip.durationSeconds);
    const legs = solveNaturalWalkLegsForRoot(phase, root, proportions, style);
    for (const side of ['left', 'right'] as const)
      for (const part of ['thigh', 'shin', 'foot', 'toe'] as const) {
        const joint = `${side}-${part}` as (typeof joints)[number];
        const rotation = legs[side].pose[joint]?.rotation;
        if (!rotation) throw new Error(`Natural walk leg solve omitted ${joint}`);
        values.get(joint)!.push(rotation);
        const currentTrack = requiredTrack(clip, joint, 'rotation-euler');
        currentValues
          .get(joint)!
          .push(
            phase === 1
              ? (currentTrack.keyframes.at(-1)!.value as [number, number, number])
              : sampleMotionTrack(currentTrack, phase * clip.durationSeconds),
          );
      }
  }
  for (const joint of joints) {
    const track = requiredTrack(clip, joint, 'rotation-euler');
    const current = currentValues.get(joint)!;
    const target = values.get(joint)!;
    const smoothCorrection = gaitBandwidthValues(
      target.map((value, index) => {
        const existing = current[index]!;
        return [value[0] - existing[0], value[1] - existing[1], value[2] - existing[2]];
      }),
      6,
    );
    track.interpolation = 'quintic-hermite';
    track.keyframes = createQuinticMotionKeyframes(
      current.map((value, index) => [
        value[0] + smoothCorrection[index]![0],
        value[1] + smoothCorrection[index]![1],
        value[2] + smoothCorrection[index]![2],
      ]),
      clip.durationSeconds,
      true,
    );
  }
  return motionClipSchema.parse(clip);
}

function correctBakedGroundPenetration(
  clip: MotionClip,
  proportions: GaitProportions,
  style: GaitStyle,
) {
  const sampleCount = 401;
  const phases = Array.from({ length: sampleCount }, (_, index) => index / (sampleCount - 1));
  const rawCorrections = phases.map((phase) =>
    Math.max(
      0,
      bakedWalkGroundCorrection(phase, sampleClipPose(clip, phase), proportions, style) - 0.00475,
    ),
  );
  const filtered = gaitBandwidthValues(
    rawCorrections.map((value) => [value, 0, 0] as [number, number, number]),
    6,
  ).map((value) => value[0]);
  const envelopeOffset = Math.max(
    0,
    ...rawCorrections.map((value, index) => value - filtered[index]!),
  );
  const correctedRoot = clip.tracks.find(
    (track) => track.joint === 'root' && track.property === 'translation',
  );
  if (!correctedRoot) throw new Error('Natural walk requires root translation');
  const correctedValues = phases.map((phase, index) => {
    const value = sampleMotionTrack(correctedRoot, phase * clip.durationSeconds);
    return [value[0], value[1] + filtered[index]! + envelopeOffset + 0.0001, value[2]] as [
      number,
      number,
      number,
    ];
  });
  correctedRoot.interpolation = 'quintic-hermite';
  correctedRoot.keyframes = createQuinticMotionKeyframes(
    correctedValues,
    clip.durationSeconds,
    true,
  );
  return motionClipSchema.parse(clip);
}

function track(
  samples: ReturnType<typeof evaluateNaturalWalk>[],
  joint: string,
  property: 'rotation-euler' | 'translation',
  durationSeconds: number,
): MotionClip['tracks'][number] | undefined {
  const poseProperty = property === 'rotation-euler' ? 'rotation' : 'translation';
  const values = samples.map((sample) => sample.pose[joint]?.[poseProperty]);
  if (values.every((value) => value === undefined)) return undefined;
  const populated = values.map((value) => (value ?? [0, 0, 0]) as [number, number, number]);
  let conditioned = populated;
  if (property === 'rotation-euler') {
    const contactSolvedLeg = /^(left|right)-(thigh|shin|foot|toe)$/u.test(joint);
    // The contact-solved chain needs enough bandwidth to preserve the rocker
    // trajectory, while the rest of the body stays at the healthy-gait six-
    // harmonic calibration. The derivative gate below remains authoritative.
    conditioned = gaitBandwidthValues(populated, 6);
    if (contactSolvedLeg) {
      const left = joint.startsWith('left-');
      const globalPhase = (localPhase: number) => (localPhase + (left ? 0.5 : 0)) % 1;
      const anchors = [0, 0.2, 0.5, 0.75]
        .map((localPhase) => globalPhase(localPhase))
        .sort((a, b) => a - b);
      const periodSamples = populated.length - 1;
      conditioned = conditioned.map((value, index) => {
        const phase = index / periodSamples;
        return value.map((axisValue, axis) => {
          const keys = anchors.map((anchor) => {
            const anchorIndex = Math.round(anchor * periodSamples);
            return {
              phase: anchor,
              value: populated[anchorIndex]![axis]! - conditioned[anchorIndex]![axis]!,
            };
          });
          return axisValue + samplePhaseCurve(keys, phase);
        }) as [number, number, number];
      });
      conditioned[conditioned.length - 1] = [...conditioned[0]!] as [number, number, number];
    }
  } else if (joint === 'root') {
    const periodic = gaitBandwidthValues(populated);
    const reachEnvelope =
      Math.max(0, ...periodic.map((value, index) => value[1] - populated[index]![1])) + 0.005;
    conditioned = periodic.map((value, index) => [
      value[0],
      value[1] - reachEnvelope,
      // Forward travel is deliberately non-periodic root motion; filtering it
      // as a loop would turn the linear stride into a Fourier sawtooth.
      populated[index]![2],
    ]);
  }
  return {
    joint,
    property,
    space: 'local-delta',
    interpolation: 'quintic-hermite',
    keyframes: createQuinticMotionKeyframes(conditioned, durationSeconds, true),
  };
}

export function createWalkStyleMotion(
  styleId: GaitStyle['id'],
  input: WalkRigInput = {},
  id = `walk.${styleId}`,
): MotionClip {
  const proportions = proportionsFromInput(input);
  const style = gaitStyles[styleId];
  // Resolve the shortest two-percent loading phase with more than one interval.
  // Forty-nine samples placed the entire initial-contact transition inside a
  // single spline span and manufactured a knee/ankle jerk peak.
  const sampleCount = 121;
  const samples = Array.from({ length: sampleCount }, (_, index) =>
    evaluateNaturalWalk(index / (sampleCount - 1), proportions, style),
  );
  const durationSeconds = samples[0]!.metrics.durationSeconds;
  const joints = new Set(samples.flatMap((sample) => Object.keys(sample.pose)));
  const tracks = [...joints].flatMap((joint) =>
    (['rotation-euler', 'translation'] as const)
      .map((property) => track(samples, joint, property, durationSeconds))
      .filter((candidate): candidate is MotionClip['tracks'][number] => Boolean(candidate)),
  );
  const verification = verifyNaturalWalk(proportions, style);
  if (!verification.valid)
    throw new Error(`Natural walk synthesis failed: ${verification.issues.join('; ')}`);
  let clip = motionClipSchema.parse({
    schemaVersion: 1,
    id,
    skeleton: 'videoer.canonical-humanoid.v1',
    durationSeconds,
    loop: true,
    tracks,
    metadata: {
      generator: 'videoer.phase-gait.v4',
      motionDesign: 'motion-design.human-walk-v4',
      motionCalibration: 'motion-calibration.wbds-young-comfortable-overground-v1',
      style: style.id,
      proportions,
      parameters: style,
      rootMotionMeters: samples[0]!.metrics.strideLength,
      footContactPhases: { left: [0.5, 1.1], right: [0, 0.6] },
      footContactModel: {
        localPhase: true,
        heel: [0, 0.12],
        flat: [0.12, 0.3],
        forefoot: [0.3, 0.58],
        release: [0.58, 0.6],
        swing: [0.6, 1],
      },
      walkingBase: {
        normalization: 'character-height-v1',
        targetStepWidthMeters: samples[0]!.metrics.stepWidth,
        anatomicalSideOrder: true,
      },
      phaseModel: samples[0]!.design.phases,
      synthesisVerification: verification.checks,
    },
  });
  clip = rebuildBakedLegTracks(clip, proportions, style);
  clip = correctBakedGroundPenetration(clip, proportions, style);
  const kinematics = verifyMotionKinematics(clip);
  if (!kinematics.valid)
    throw new Error(`Natural walk kinematics failed: ${kinematics.issues.join('; ')}`);
  return motionClipSchema.parse({
    ...clip,
    metadata: {
      ...clip.metadata,
      synthesisVerification: {
        ...verification.checks,
        kinematics: kinematics.analysis.summary,
        kinematicPolicy: kinematics.analysis.policy,
      },
    },
  });
}

export function createCasualWalkMotion(input: WalkRigInput = {}) {
  return createWalkStyleMotion('neutral', input, 'walk.casual');
}

function requiredTrack(
  clip: MotionClip,
  joint: string,
  property: 'rotation-euler' | 'translation',
) {
  const value = clip.tracks.find(
    (candidate) => candidate.joint === joint && candidate.property === property,
  );
  if (!value) throw new Error(`Missing natural walk track ${joint}:${property}`);
  return value;
}

function eulerQuaternion([x, y, z]: [number, number, number]) {
  const [sx, sy, sz] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
  const [cx, cy, cz] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

/** Maximum orientation excursion is invariant to a target rig's static rest
 * correction. An Euler-axis range is not: lowering a T-pose into an A-pose
 * redistributes the same physical swing across local channels. */
function trackOrientationSweep(clip: MotionClip, joint: string) {
  const track = requiredTrack(clip, joint, 'rotation-euler');
  const samples = Array.from({ length: 65 }, (_, index) =>
    eulerQuaternion(sampleMotionTrack(track, (index / 64) * clip.durationSeconds)),
  );
  let maximum = 0;
  for (let left = 0; left < samples.length; left++)
    for (let right = left + 1; right < samples.length; right++) {
      const dot = Math.abs(
        samples[left]!.reduce((sum, value, axis) => sum + value * samples[right]![axis]!, 0),
      );
      maximum = Math.max(maximum, 2 * Math.acos(Math.min(1, dot)));
    }
  return maximum;
}

export function verifyCasualWalkMotion(
  clip: MotionClip,
  options: { verifyProxyGrounding?: boolean } = {},
) {
  const proportions = clip.metadata.proportions as GaitProportions | undefined;
  const styleId = clip.metadata.style as GaitStyle['id'] | undefined;
  if (!proportions || !styleId || !gaitStyles[styleId])
    return {
      valid: false,
      issues: ['motion lacks phase-gait proportions or style metadata'],
      checks: {},
    };
  const synthesis = verifyNaturalWalk(proportions, gaitStyles[styleId]);
  const issues = [...synthesis.issues];
  const kinematics = verifyMotionKinematics(clip);
  issues.push(...kinematics.issues);
  const baked = verifyBakedNaturalWalk(
    proportions,
    gaitStyles[styleId],
    (phase) => sampleClipPose(clip, phase),
    options,
  );
  issues.push(...baked.issues);
  const root = requiredTrack(clip, 'root', 'translation');
  const rootStart = sampleMotionTrack(root, 0);
  const rootEnd = sampleMotionTrack(root, clip.durationSeconds);
  const rootForwardMeters = -(rootEnd[2] - rootStart[2]);
  const expectedTravel = Number(clip.metadata.rootMotionMeters);
  if (Math.abs(rootForwardMeters - expectedTravel) > 1e-6)
    issues.push('baked root motion differs from synthesized stride length');
  const kneeValues = ['left-shin', 'right-shin'].flatMap((joint) =>
    requiredTrack(clip, joint, 'rotation-euler').keyframes.map((keyframe) => keyframe.value[0]),
  );
  const restKneeBend =
    Math.atan2(proportions.shinRestForward, proportions.shinRestDown) -
    Math.atan2(proportions.thighRestForward, proportions.thighRestDown);
  if (Math.max(...kneeValues.map((value) => value + restKneeBend)) > 0.01)
    issues.push('a baked knee folds toward travel instead of behind the actor');
  const requiredWholeBodyTracks = [
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'left-clavicle',
    'right-clavicle',
    'left-upper-arm',
    'right-upper-arm',
    'left-forearm',
    'right-forearm',
    'left-toe',
    'right-toe',
  ];
  for (const joint of requiredWholeBodyTracks)
    if (!clip.tracks.some((candidate) => candidate.joint === joint))
      issues.push(`missing whole-body gait track '${joint}'`);
  const trackAxisRange = (
    joint: string,
    property: 'rotation-euler' | 'translation',
    axis: number,
  ) => {
    const values = requiredTrack(clip, joint, property).keyframes.map(
      (keyframe) => keyframe.value[axis]!,
    );
    return Math.max(...values) - Math.min(...values);
  };
  const leftArmSweep = trackOrientationSweep(clip, 'left-upper-arm');
  const rightArmSweep = trackOrientationSweep(clip, 'right-upper-arm');
  const leftClavicleSweep = trackOrientationSweep(clip, 'left-clavicle');
  const rightClavicleSweep = trackOrientationSweep(clip, 'right-clavicle');
  const leftElbowFlexion = Math.max(
    ...requiredTrack(clip, 'left-forearm', 'rotation-euler').keyframes.map((keyframe) =>
      Math.abs(keyframe.value[1]),
    ),
  );
  const rightElbowFlexion = Math.max(
    ...requiredTrack(clip, 'right-forearm', 'rotation-euler').keyframes.map((keyframe) =>
      Math.abs(keyframe.value[1]),
    ),
  );
  const pelvisLateralTransfer = trackAxisRange('root', 'translation', 0);
  const pelvisVerticalTransfer = trackAxisRange('root', 'translation', 1);
  const pelvisYaw = trackAxisRange('hips', 'rotation-euler', 1);
  const chestCounterYaw = trackAxisRange('chest', 'rotation-euler', 1);
  const hipsYawTrack = requiredTrack(clip, 'hips', 'rotation-euler');
  const spineYawTrack = requiredTrack(clip, 'spine', 'rotation-euler');
  const chestYawTrack = requiredTrack(clip, 'chest', 'rotation-euler');
  const counterSamples: Array<[number, number, number]> = Array.from({ length: 65 }, (_, index) => {
    const seconds = (index / 64) * clip.durationSeconds;
    const hips = sampleMotionTrack(hipsYawTrack, seconds)[1];
    const spine = sampleMotionTrack(spineYawTrack, seconds)[1];
    const chest = sampleMotionTrack(chestYawTrack, seconds)[1];
    return [hips, chest, hips + spine + chest];
  });
  const counterNumerator = counterSamples.reduce((sum, [hips, chest]) => sum + hips * chest, 0);
  const counterDenominator = Math.sqrt(
    counterSamples.reduce((sum, [hips]) => sum + hips * hips, 0) *
      counterSamples.reduce((sum, [, chest]) => sum + chest * chest, 0),
  );
  const pelvisThoraxYawCorrelation = counterDenominator ? counterNumerator / counterDenominator : 1;
  const globalThoraxNumerator = counterSamples.reduce(
    (sum, [hips, , globalThorax]) => sum + hips * globalThorax,
    0,
  );
  const globalThoraxDenominator = Math.sqrt(
    counterSamples.reduce((sum, [hips]) => sum + hips * hips, 0) *
      counterSamples.reduce((sum, [, , globalThorax]) => sum + globalThorax * globalThorax, 0),
  );
  const globalThoraxYawCorrelation = globalThoraxDenominator
    ? globalThoraxNumerator / globalThoraxDenominator
    : 1;
  const globalThoraxYaw =
    Math.max(...counterSamples.map(([, , value]) => value)) -
    Math.min(...counterSamples.map(([, , value]) => value));
  const oppositionSamples = counterSamples.slice(0, -1);
  const strongestThoraxOpposition = strongestOppositionLag(
    oppositionSamples.map(([hips]) => hips),
    oppositionSamples.map(([, , globalThorax]) => globalThorax),
  );
  const globalThoraxPhaseLagRatio =
    Math.abs(strongestThoraxOpposition.lagSamples) / oppositionSamples.length;
  const minimumArmSweep = radians(42) * gaitStyles[styleId].armSwing;
  const minimumClavicleSweep = radians(7.5) * gaitStyles[styleId].armSwing;
  if (Math.min(leftArmSweep, rightArmSweep) < minimumArmSweep)
    issues.push('sagittal arm sweep is below its style-specific minimum');
  if (Math.min(leftClavicleSweep, rightClavicleSweep) < minimumClavicleSweep)
    issues.push('shoulder-girdle sweep is below its style-specific minimum');
  if (Math.min(leftElbowFlexion, rightElbowFlexion) < radians(10))
    issues.push('elbows do not retain at least 10 degrees of walking flexion');
  const targetStepWidth = gaitMetrics(proportions, gaitStyles[styleId]).stepWidth;
  if (pelvisLateralTransfer < targetStepWidth * 0.35)
    issues.push('pelvis lacks visible lateral weight transfer');
  if (pelvisVerticalTransfer < proportions.height * 0.007)
    issues.push('pelvis lacks measurable vertical weight transfer');
  if (pelvisYaw < radians(12) * gaitStyles[styleId].pelvisRotation)
    issues.push('pelvis yaw is below its style-specific minimum');
  if (chestCounterYaw < pelvisYaw * 0.25)
    issues.push('thorax does not visibly counter-rotate against the pelvis');
  if (pelvisThoraxYawCorrelation > -0.5)
    issues.push('thorax yaw is not phase-opposed to pelvis yaw');
  if (globalThoraxYaw < pelvisYaw * 0.15)
    issues.push('global thorax counter-rotation is visually negligible');
  if (globalThoraxYawCorrelation > -0.5)
    issues.push('global thorax yaw follows instead of opposing the pelvis');
  if (globalThoraxPhaseLagRatio < 0.025)
    issues.push('global thorax yaw is a mechanically synchronized pelvis inversion');
  if (globalThoraxPhaseLagRatio > 0.1)
    issues.push('global thorax opposition lags too far behind the pelvis');
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      ...synthesis.checks,
      canonicalForward: '-z',
      rootForwardMeters,
      peakKneeFlexionRadians: Math.min(...kneeValues),
      wrongWayKneeRadians: Math.max(...kneeValues),
      wholeBodyTrackCount: requiredWholeBodyTracks.length,
      kinematics: kinematics.analysis.summary,
      kinematicPolicy: kinematics.analysis.policy,
      bakedBiomechanics: baked.checks,
      wholeBodyDynamics: {
        leftArmSweepRadians: leftArmSweep,
        rightArmSweepRadians: rightArmSweep,
        leftClavicleSweepRadians: leftClavicleSweep,
        rightClavicleSweepRadians: rightClavicleSweep,
        leftElbowFlexionRadians: leftElbowFlexion,
        rightElbowFlexionRadians: rightElbowFlexion,
        pelvisLateralTransferMeters: pelvisLateralTransfer,
        pelvisVerticalTransferMeters: pelvisVerticalTransfer,
        pelvisYawRadians: pelvisYaw,
        chestCounterYawRadians: chestCounterYaw,
        pelvisThoraxYawCorrelation,
        globalThoraxYawRadians: globalThoraxYaw,
        globalThoraxYawCorrelation,
        globalThoraxOppositionLagSamples: strongestThoraxOpposition.lagSamples,
        globalThoraxOppositionCorrelation: strongestThoraxOpposition.correlation,
        globalThoraxPhaseLagRatio,
      },
    },
  };
}
