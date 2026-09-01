import type { Vec3 } from '../geometry/model.js';
import { composePoseLayers, type MotionPose } from './composition.js';
import {
  evaluateJointLimits,
  evaluatePointContacts,
  type ContactObservation,
} from './constraints.js';
import { offsetPhase, phaseProgress, samplePhaseCurve } from './curves.js';
import { naturalWalkDesign } from './gait-design.js';
import { sampleCenteredHealthyGaitDegrees, sampleHealthyGaitDegrees } from './gait-calibration.js';

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export interface GaitProportions {
  height: number;
  legLength: number;
  thighLength: number;
  shinLength: number;
  thighRestForward: number;
  thighRestDown: number;
  thighRestLateral: number;
  shinRestForward: number;
  shinRestDown: number;
  shinRestLateral: number;
  armLength: number;
  hipWidth: number;
  footScale: number;
  heelBack: number;
  heelDrop: number;
  ballForward: number;
  ballDrop: number;
  toeForward: number;
  toeRise: number;
  flatFootPitch: number;
  hipToGroundRest: number;
  kneeReserve: number;
}

export interface GaitStyle {
  id: 'neutral' | 'cautious' | 'confident';
  strideLengthRatio: number;
  cadenceStepsPerMinute: number;
  postureDegrees: number;
  pelvisRotation: number;
  pelvisLateralShift: number;
  stepWidthRatio: number;
  pelvisVerticalMotion: number;
  armSwing: number;
  elbowFlexion: number;
  headStabilisation: number;
  asymmetry: number;
}

export const gaitStyles: Record<GaitStyle['id'], GaitStyle> = {
  neutral: {
    id: 'neutral',
    strideLengthRatio: 1.18,
    cadenceStepsPerMinute: 108,
    postureDegrees: 1,
    pelvisRotation: 0.5,
    pelvisLateralShift: 0.38,
    stepWidthRatio: 0.08,
    pelvisVerticalMotion: 0.42,
    armSwing: 0.58,
    elbowFlexion: 0.45,
    headStabilisation: 0.78,
    asymmetry: 0.025,
  },
  cautious: {
    id: 'cautious',
    strideLengthRatio: 0.82,
    cadenceStepsPerMinute: 92,
    postureDegrees: 4,
    pelvisRotation: 0.28,
    pelvisLateralShift: 0.39,
    stepWidthRatio: 0.092,
    pelvisVerticalMotion: 0.5,
    armSwing: 0.32,
    elbowFlexion: 0.62,
    headStabilisation: 0.9,
    asymmetry: 0.05,
  },
  confident: {
    id: 'confident',
    // Confidence comes from cadence, posture, counter-rotation, and relaxed
    // amplitude—not overstriding beyond the support leg's contact envelope.
    strideLengthRatio: 1.185,
    cadenceStepsPerMinute: 116,
    postureDegrees: -1.5,
    pelvisRotation: 0.68,
    pelvisLateralShift: 0.36,
    stepWidthRatio: 0.072,
    pelvisVerticalMotion: 0.42,
    armSwing: 0.76,
    elbowFlexion: 0.36,
    headStabilisation: 0.72,
    asymmetry: 0.018,
  },
};

interface GaitMetrics {
  strideLength: number;
  durationSeconds: number;
  thighLength: number;
  shinLength: number;
  thighRestForward: number;
  thighRestDown: number;
  thighRestLateral: number;
  shinRestForward: number;
  shinRestDown: number;
  shinRestLateral: number;
  kneeReserve: number;
  thighRestHeight: number;
  footLength: number;
  heelBack: number;
  heelDrop: number;
  ballForward: number;
  ballDrop: number;
  toeForward: number;
  toeRise: number;
  flatFootPitch: number;
  swingClearance: number;
  stepWidth: number;
}

export function gaitMetrics(proportions: GaitProportions, style: GaitStyle): GaitMetrics {
  const footLength = proportions.ballForward + proportions.toeForward;
  return {
    strideLength: proportions.legLength * style.strideLengthRatio,
    durationSeconds: 120 / style.cadenceStepsPerMinute,
    thighLength: proportions.thighLength,
    shinLength: proportions.shinLength,
    thighRestForward: proportions.thighRestForward,
    thighRestDown: proportions.thighRestDown,
    thighRestLateral: proportions.thighRestLateral,
    shinRestForward: proportions.shinRestForward,
    shinRestDown: proportions.shinRestDown,
    shinRestLateral: proportions.shinRestLateral,
    kneeReserve: proportions.kneeReserve,
    thighRestHeight: proportions.hipToGroundRest,
    footLength,
    heelBack: proportions.heelBack,
    heelDrop: proportions.heelDrop,
    ballForward: proportions.ballForward,
    ballDrop: proportions.ballDrop,
    toeForward: proportions.toeForward,
    toeRise: proportions.toeRise,
    flatFootPitch: proportions.flatFootPitch,
    swingClearance: proportions.height * 0.07,
    stepWidth: proportions.height * style.stepWidthRatio,
  };
}

interface Point2 {
  forward: number;
  height: number;
}

function rotateFootPoint(point: Point2, pitch: number): Point2 {
  return {
    forward: -point.height * Math.sin(pitch) + point.forward * Math.cos(pitch),
    height: point.height * Math.cos(pitch) + point.forward * Math.sin(pitch),
  };
}

function footPitch(phase: number, metrics: GaitMetrics) {
  const measured = sampleHealthyGaitDegrees('footPitch', phase);
  const flatContactWeight = samplePhaseCurve(
    [
      { phase: 0, value: 0 },
      { phase: 0.1, value: 0 },
      { phase: 0.12, value: 1 },
      { phase: 0.3, value: 1 },
      { phase: 0.34, value: 0 },
      { phase: 1, value: 0 },
    ],
    phase,
  );
  return metrics.flatFootPitch + radians(measured * (1 - flatContactWeight));
}

function toeFlexion(phase: number, metrics: GaitMetrics) {
  // During forefoot support, MTP extension counter-rotates the measured foot
  // pitch so the distal toe stays on the ground instead of forcing the ball
  // and heel through it. Release that extension smoothly after toe-off.
  const maximum = radians(50);
  if (phase < 0.3) return 0;
  if (phase < 0.6) return clamp(-footPitch(phase, metrics), 0, maximum);
  if (phase < 0.8) {
    const toeOff = clamp(-footPitch(0.6, metrics), 0, maximum);
    return toeOff * (1 - smootherstep((phase - 0.6) / 0.2));
  }
  return 0;
}

function footLandmarks(pitch: number, toeBend: number, metrics: GaitMetrics) {
  const heel = rotateFootPoint({ forward: -metrics.heelBack, height: -metrics.heelDrop }, pitch);
  const ball = rotateFootPoint({ forward: metrics.ballForward, height: -metrics.ballDrop }, pitch);
  const toeFromBall = rotateFootPoint(
    { forward: metrics.toeForward, height: metrics.toeRise },
    pitch + toeBend,
  );
  return {
    heel,
    ball,
    toe: {
      forward: ball.forward + toeFromBall.forward,
      height: ball.height + toeFromBall.height,
    },
  };
}

export interface FootRockerChecks {
  initialContactToeClearanceMeters: number;
  midstanceContactErrorMeters: number;
  terminalStanceHeelRiseMeters: number;
  terminalStanceToeContactErrorMeters: number;
  earlySwingFootPitchDegrees: number;
  terminalSwingFootPitchDegrees: number;
  terminalSwingToeBendDegrees: number;
}

function footRockerIssues(
  checks: FootRockerChecks,
  metrics: GaitMetrics,
  verifyContactGeometry = true,
) {
  const issues: string[] = [];
  if (verifyContactGeometry) {
    if (checks.initialContactToeClearanceMeters < metrics.footLength * 0.08)
      issues.push('initial contact lacks a visible heel rocker');
    if (checks.midstanceContactErrorMeters > 0.005)
      issues.push('midstance foot is not flat on the ground');
    if (checks.terminalStanceHeelRiseMeters < metrics.footLength * 0.1)
      issues.push('terminal stance lacks a visible forefoot rocker');
    if (checks.terminalStanceToeContactErrorMeters > 0.01)
      issues.push('terminal-stance toe loses ground contact');
  }
  if (checks.earlySwingFootPitchDegrees > -20 || checks.earlySwingFootPitchDegrees < -75)
    issues.push('early-swing foot pitch falls outside the healthy calibrated envelope');
  if (checks.terminalSwingFootPitchDegrees < 0)
    issues.push('foot does not recover from plantarflexion before terminal swing');
  if (Math.abs(checks.terminalSwingToeBendDegrees) > 8)
    issues.push('forefoot-rocker toe bend persists unnaturally into terminal swing');
  return issues;
}

function plantHeelForward(globalPhase: number, legOffset: number, metrics: GaitMetrics) {
  const legPhaseUnwrapped = globalPhase + legOffset;
  const cycle = Math.floor(legPhaseUnwrapped);
  const heelStrikePhase = cycle - legOffset;
  return heelStrikePhase * metrics.strideLength + metrics.strideLength * 0.25;
}

function ankleForContact(
  phase: number,
  heelTarget: number,
  pitch: number,
  toeBend: number,
  metrics: GaitMetrics,
): Point2 {
  const { heel, toe } = footLandmarks(pitch, toeBend, metrics);
  if (phase < 0.3) return { forward: heelTarget - heel.forward, height: -heel.height };
  const toeTarget = heelTarget + metrics.heelBack + metrics.footLength;
  return { forward: toeTarget - toe.forward, height: -toe.height };
}

function solveLeg(forward: number, down: number, metrics: GaitMetrics) {
  const distance = clamp(
    Math.hypot(forward, down),
    0.001,
    metrics.thighLength + metrics.shinLength - metrics.kneeReserve,
  );
  const relativeBend = -Math.acos(
    clamp(
      (distance * distance - metrics.thighLength ** 2 - metrics.shinLength ** 2) /
        (2 * metrics.thighLength * metrics.shinLength),
      -1,
      1,
    ),
  );
  const target = Math.atan2(forward, down);
  const thighAbsolute =
    target -
    Math.atan2(
      metrics.shinLength * Math.sin(relativeBend),
      metrics.thighLength + metrics.shinLength * Math.cos(relativeBend),
    );
  const thighRest = Math.atan2(metrics.thighRestForward, metrics.thighRestDown);
  const shinRest = Math.atan2(metrics.shinRestForward, metrics.shinRestDown);
  const thigh = thighAbsolute - thighRest;
  const knee = relativeBend - (shinRest - thighRest);
  return { thigh, knee };
}

function rotatedBone(forward: number, down: number, rotation: number): Point2 {
  return {
    forward: forward * Math.cos(rotation) + down * Math.sin(rotation),
    height: -(down * Math.cos(rotation) - forward * Math.sin(rotation)),
  };
}

function ankleFromLeg(
  rootForward: number,
  rootHeight: number,
  thigh: number,
  knee: number,
  metrics: GaitMetrics,
): Point2 {
  const thighVector = rotatedBone(metrics.thighRestForward, metrics.thighRestDown, thigh);
  const shinVector = rotatedBone(metrics.shinRestForward, metrics.shinRestDown, thigh + knee);
  return {
    forward: rootForward + thighVector.forward + shinVector.forward,
    height: metrics.thighRestHeight + rootHeight + thighVector.height + shinVector.height,
  };
}

interface LegState {
  phase: number;
  pose: MotionPose;
  heel: Point2;
  toe: Point2;
  heelTarget: number;
  contact: 'heel' | 'flat' | 'toe' | 'release' | 'swing';
  ankleLateral: number;
  lateralRotation: number;
}

interface RawLegState {
  phase: number;
  ankle: Point2;
  heelTarget: number;
  pitch: number;
  solved: ReturnType<typeof solveLeg>;
}

function rawLegState(
  side: 'left' | 'right',
  globalPhase: number,
  rootForward: number,
  rootHeight: number,
  metrics: GaitMetrics,
): RawLegState {
  const offset = side === 'left' ? 0.5 : 0;
  const phase = offsetPhase(globalPhase, offset);
  const heelTarget = plantHeelForward(globalPhase, offset, metrics);
  const pitch = footPitch(phase, metrics);
  const toeBend = toeFlexion(phase, metrics);
  let ankle = ankleForContact(phase, heelTarget, pitch, toeBend, metrics);
  if (phase >= 0.6) {
    const takeoff = ankleForContact(
      0.6,
      heelTarget,
      footPitch(0.6, metrics),
      toeFlexion(0.6, metrics),
      metrics,
    );
    const nextHeel = heelTarget + metrics.strideLength;
    const landing = ankleForContact(
      0,
      nextHeel,
      footPitch(0, metrics),
      toeFlexion(0, metrics),
      metrics,
    );
    const progress = phaseProgress(phase, 0.6, 1);
    const travel = smootherstep(progress);
    const symmetricShoulder = 1 + 2.8 * (2 * progress - 1) ** 2;
    const lift = 64 * progress ** 3 * (1 - progress) ** 3 * symmetricShoulder;
    ankle = {
      forward: takeoff.forward + (landing.forward - takeoff.forward) * travel,
      height:
        takeoff.height + (landing.height - takeoff.height) * travel + metrics.swingClearance * lift,
    };
    // A healthy foot remains strongly plantarflexed during early swing. The
    // correct response is to clear the whole foot, not flatten its measured
    // rocker waveform. Enforce clearance against both heel and toe landmarks.
    const landmarks = footLandmarks(pitch, toeBend, metrics);
    const minimumRelativeHeight = Math.min(landmarks.heel.height, landmarks.toe.height);
    const edgeEnvelope = Math.min(
      smootherstep(clamp(progress / 0.1, 0, 1)),
      smootherstep(clamp((1 - progress) / 0.1, 0, 1)),
    );
    const clearanceEnvelope =
      proportionsSafeClearance(metrics) * edgeEnvelope +
      metrics.swingClearance * 0.2 * Math.sin(Math.PI * progress);
    ankle.height = Math.max(ankle.height, clearanceEnvelope - minimumRelativeHeight);
  }
  return {
    phase,
    ankle,
    heelTarget,
    pitch,
    solved: solveLeg(
      ankle.forward - rootForward,
      metrics.thighRestHeight + rootHeight - ankle.height,
      metrics,
    ),
  };
}

function proportionsSafeClearance(metrics: GaitMetrics) {
  return Math.max(0.015, metrics.footLength * 0.07);
}

function evaluateLeg(
  side: 'left' | 'right',
  globalPhase: number,
  rootForward: number,
  rootHeight: number,
  rootLateral: number,
  proportions: GaitProportions,
  metrics: GaitMetrics,
): LegState {
  const raw = rawLegState(side, globalPhase, rootForward, rootHeight, metrics);
  const { phase, heelTarget, pitch } = raw;
  const contact: LegState['contact'] =
    phase < 0.12
      ? 'heel'
      : phase < 0.3
        ? 'flat'
        : phase < 0.58
          ? 'toe'
          : phase < 0.6
            ? 'release'
            : 'swing';
  const solved = raw.solved;
  const ankle =
    phase >= 0.6
      ? ankleFromLeg(rootForward, rootHeight, solved.thigh, solved.knee, metrics)
      : raw.ankle;
  const foot = pitch - (solved.thigh + solved.knee);
  const { heel: heelRelative, toe: toeRelative } = footLandmarks(
    pitch,
    toeFlexion(phase, metrics),
    metrics,
  );
  const sideSign = side === 'left' ? 1 : -1;
  const hipLateral = rootLateral + sideSign * proportions.hipWidth * 0.5;
  const targetAnkleLateral = sideSign * metrics.stepWidth * 0.5;
  const restLateral = sideSign * (metrics.thighRestLateral + metrics.shinRestLateral);
  const restDown = metrics.thighRestDown + metrics.shinRestDown;
  // MakeHuman's production A-pose also abducts the legs. Locomotion needs an
  // explicit walking-base retarget: solve the coronal thigh rotation that
  // brings each ankle from the authored A-pose line to the style's reusable
  // step-width target while the pelvis shifts over the support foot.
  const lateral =
    Math.atan2(targetAnkleLateral - hipLateral, restDown) - Math.atan2(restLateral, restDown);
  return {
    phase,
    pose: {
      [`${side}-thigh`]: { rotation: [solved.thigh, 0, lateral] },
      [`${side}-shin`]: { rotation: [solved.knee, 0, 0] },
      [`${side}-foot`]: { rotation: [foot, 0, 0] },
      [`${side}-toe`]: { rotation: [toeFlexion(phase, metrics), 0, 0] },
    },
    heel: {
      forward: ankle.forward + heelRelative.forward,
      height: ankle.height + heelRelative.height,
    },
    toe: {
      forward: ankle.forward + toeRelative.forward,
      height: ankle.height + toeRelative.height,
    },
    heelTarget,
    contact,
    ankleLateral: targetAnkleLateral,
    lateralRotation: lateral,
  };
}

export function solveNaturalWalkLegsForRoot(
  phaseInput: number,
  root: Vec3,
  proportions: GaitProportions,
  style: GaitStyle,
) {
  const progress = clamp(phaseInput, 0, 1);
  const metrics = gaitMetrics(proportions, style);
  return {
    left: evaluateLeg('left', progress, -root[2], root[1], root[0], proportions, metrics),
    right: evaluateLeg('right', progress, -root[2], root[1], root[0], proportions, metrics),
  };
}

function wholeBodyCurves(phase: number, proportions: GaitProportions, style: GaitStyle) {
  // Human COM drops briefly during loading response, rises toward single
  // support, and falls again into the next loading response. Keep that motion
  // around the rig's extended-leg rest height: the previous downward-biased
  // sinusoid forced 30-40 degrees of support-knee flexion throughout the cycle
  // and manufactured the permanently crouched walk caught by visual review.
  const verticalBase = proportions.height * 0.007;
  const verticalAmplitude = proportions.height * 0.012 * style.pelvisVerticalMotion;
  const vertical =
    verticalBase +
    verticalAmplitude *
      samplePhaseCurve(
        [
          { phase: 0, value: 0.2 },
          { phase: 0.08, value: -0.5 },
          { phase: 0.25, value: 1 },
          { phase: 0.42, value: 0.8 },
          { phase: 0.5, value: 0.2 },
          { phase: 0.58, value: -0.5 },
          { phase: 0.75, value: 1 },
          { phase: 0.92, value: 0.8 },
          { phase: 1, value: 0.2 },
        ],
        phase,
      );
  const lateral =
    samplePhaseCurve(
      [
        { phase: 0, value: 0 },
        { phase: 0.18, value: -1 },
        { phase: 0.5, value: 0 },
        { phase: 0.68, value: 1 },
        { phase: 1, value: 0 },
      ],
      phase,
    ) *
    proportions.height *
    style.stepWidthRatio *
    0.5 *
    style.pelvisLateralShift;
  const yaw = radians(
    sampleCenteredHealthyGaitDegrees('pelvisRotation', phase) *
      (style.pelvisRotation / gaitStyles.neutral.pelvisRotation),
  );
  // The thorax is coordinated with the pelvis but does not reverse at the
  // exact same instant. A small cyclic delay creates the inertial follow-
  // through visible in human walking and prevents the robotic result produced
  // by multiplying one pelvis waveform by a negative constant.
  const thoraxWave = samplePhaseCurve(
    [
      { phase: 0, value: 0.86 },
      { phase: 0.08, value: 1 },
      { phase: 0.27, value: 0.12 },
      { phase: 0.36, value: -0.34 },
      { phase: 0.52, value: -1 },
      { phase: 0.6, value: -0.86 },
      { phase: 0.77, value: -0.12 },
      { phase: 0.86, value: 0.34 },
      { phase: 1, value: 0.86 },
    ],
    offsetPhase(phase, -0.045),
  );
  // Keep global trunk excursion materially smaller than pelvis-relative
  // counter-motion. A full pelvis-sized global excursion over-twists the
  // shoulder surface when the delayed peaks overlap, which is both visually
  // excessive and biomechanically the wrong hierarchy.
  const globalThoraxYaw = -radians(1.8) * style.pelvisRotation * thoraxWave;
  const thoraxLocalYaw = globalThoraxYaw - yaw;
  const armWave = samplePhaseCurve(
    [
      { phase: 0, value: 0.88 },
      { phase: 0.07, value: 1 },
      { phase: 0.23, value: 0.3 },
      { phase: 0.34, value: -0.36 },
      { phase: 0.5, value: -1 },
      { phase: 0.58, value: -0.9 },
      { phase: 0.73, value: -0.24 },
      { phase: 0.84, value: 0.4 },
      { phase: 1, value: 0.88 },
    ],
    offsetPhase(phase, -0.035),
  );
  const shoulderWave = samplePhaseCurve(
    [
      { phase: 0, value: 0.82 },
      { phase: 0.1, value: 1 },
      { phase: 0.29, value: 0.1 },
      { phase: 0.39, value: -0.42 },
      { phase: 0.54, value: -1 },
      { phase: 0.63, value: -0.82 },
      { phase: 0.79, value: -0.08 },
      { phase: 0.9, value: 0.48 },
      { phase: 1, value: 0.82 },
    ],
    offsetPhase(phase, -0.05),
  );
  const elbowWave = samplePhaseCurve(
    [
      { phase: 0, value: 0.2 },
      { phase: 0.16, value: -0.65 },
      { phase: 0.42, value: 0.35 },
      { phase: 0.63, value: 1 },
      { phase: 0.86, value: -0.35 },
      { phase: 1, value: 0.2 },
    ],
    phase,
  );
  const loadingPitch =
    radians(1.15) *
    style.pelvisVerticalMotion *
    samplePhaseCurve(
      [
        { phase: 0, value: 0 },
        { phase: 0.065, value: 1 },
        { phase: 0.22, value: -0.3 },
        { phase: 0.5, value: 0 },
        { phase: 0.565, value: 1 },
        { phase: 0.72, value: -0.3 },
        { phase: 1, value: 0 },
      ],
      phase,
    );
  const roll = radians(
    sampleCenteredHealthyGaitDegrees('pelvisObliquity', phase) *
      (style.pelvisLateralShift / gaitStyles.neutral.pelvisLateralShift),
  );
  const pelvisTilt = radians(
    sampleCenteredHealthyGaitDegrees('pelvisTilt', phase) *
      (style.pelvisVerticalMotion / gaitStyles.neutral.pelvisVerticalMotion),
  );
  return {
    vertical,
    lateral,
    yaw,
    roll,
    thoraxLocalYaw,
    globalThoraxYaw,
    armWave,
    shoulderWave,
    elbowWave,
    loadingPitch,
    pelvisTilt,
  };
}

export function evaluateNaturalWalk(
  phaseInput: number,
  proportions: GaitProportions,
  style: GaitStyle,
) {
  const progress = clamp(phaseInput, 0, 1);
  const phase = progress === 1 ? 0 : progress;
  const metrics = gaitMetrics(proportions, style);
  const curves = wholeBodyCurves(phase, proportions, style);
  const rootForward = metrics.strideLength * progress;
  const maximumReach = metrics.thighLength + metrics.shinLength - metrics.kneeReserve;
  const stanceRootCeilings = (['left', 'right'] as const).flatMap((side) => {
    const offset = side === 'left' ? 0.5 : 0;
    const legPhase = offsetPhase(progress, offset);
    if (legPhase >= 0.6) return [];
    const heelTarget = plantHeelForward(progress, offset, metrics);
    const ankle = ankleForContact(
      legPhase,
      heelTarget,
      footPitch(legPhase, metrics),
      toeFlexion(legPhase, metrics),
      metrics,
    );
    const horizontal = ankle.forward - rootForward;
    const maximumDown = Math.sqrt(Math.max(0, maximumReach ** 2 - horizontal ** 2));
    return [maximumDown - metrics.thighRestHeight + ankle.height];
  });
  // A desired COM crest may not lift either planted ankle out of reach. Clamp
  // against both stance legs, preserving the rig's measured neutral knee reserve instead of
  // relying on the IK distance clamp and silently floating the heel.
  const rootHeight = Math.min(curves.vertical, ...stanceRootCeilings);
  const left = evaluateLeg(
    'left',
    progress,
    rootForward,
    rootHeight,
    curves.lateral,
    proportions,
    metrics,
  );
  const right = evaluateLeg(
    'right',
    progress,
    rootForward,
    rootHeight,
    curves.lateral,
    proportions,
    metrics,
  );
  const armAngle = radians(28) * style.armSwing * curves.armWave;
  const asymmetry = 1 + style.asymmetry;
  const elbowBase = radians(8 + style.elbowFlexion * 18);
  const pose = composePoseLayers([
    {
      id: 'locomotion',
      mode: 'base',
      weight: 1,
      pose: {
        root: { translation: [curves.lateral, rootHeight, -rootForward] },
        ...left.pose,
        ...right.pose,
      },
    },
    {
      id: 'pelvis',
      mode: 'additive',
      weight: 1,
      pose: {
        hips: {
          rotation: [
            radians(style.postureDegrees * 0.25) + curves.pelvisTilt,
            curves.yaw,
            curves.roll,
          ],
        },
      },
    },
    {
      id: 'counter-motion',
      mode: 'additive',
      weight: 1,
      pose: {
        spine: {
          rotation: [
            radians(style.postureDegrees * 0.35) + curves.loadingPitch * 0.4,
            curves.thoraxLocalYaw * 0.42,
            -curves.roll * 0.45,
          ],
        },
        chest: {
          rotation: [
            radians(style.postureDegrees * 0.4) + curves.loadingPitch * 0.6,
            curves.thoraxLocalYaw * 0.58,
            -curves.roll * 0.75,
          ],
        },
      },
    },
    {
      id: 'arms',
      mode: 'additive',
      weight: 1,
      pose: {
        // The clavicle owns only subtle scapular counter-motion. The upper-arm
        // joint owns arm lowering and sagittal swing. Driving the full 72°
        // lowering through the clavicle collapses authored production shoulder
        // weights even though a primitive proxy can hide that mistake.
        'left-clavicle': {
          rotation: [
            0,
            -radians(28) * style.armSwing * curves.shoulderWave * asymmetry * 0.18,
            radians(-2.2),
          ],
        },
        'right-clavicle': {
          rotation: [
            0,
            (-radians(28) * style.armSwing * curves.shoulderWave * 0.18) / asymmetry,
            radians(2.2),
          ],
        },
        // Canonical arm bones extend laterally on ±X. Y rotation creates
        // sagittal ±Z swing; Z lowers them from the diagnostic T-pose.
        'left-upper-arm': { rotation: [0, armAngle * asymmetry, radians(-70)] },
        'right-upper-arm': { rotation: [0, armAngle / asymmetry, radians(70)] },
        'left-forearm': { rotation: [0, elbowBase * (1 - curves.elbowWave * 0.14), 0] },
        'right-forearm': { rotation: [0, -elbowBase * (1 + curves.elbowWave * 0.14), 0] },
      },
    },
    {
      id: 'head-stabilisation',
      mode: 'additive',
      weight: 1,
      pose: {
        neck: {
          rotation: [
            radians(-style.postureDegrees * 0.35),
            curves.yaw * 0.18 * style.headStabilisation,
            curves.roll * 0.12 * style.headStabilisation,
          ],
        },
        head: {
          rotation: [
            radians(-style.postureDegrees * 0.4),
            curves.yaw * 0.12 * style.headStabilisation,
            curves.roll * 0.08 * style.headStabilisation,
          ],
        },
      },
    },
  ]);
  return { phase, progress, pose, metrics, legs: { left, right }, design: naturalWalkDesign };
}

export function verifyBakedNaturalWalk(
  proportions: GaitProportions,
  style: GaitStyle,
  samplePose: (phase: number) => MotionPose,
  options: { verifyProxyGrounding?: boolean } = {},
) {
  const metrics = gaitMetrics(proportions, style);
  const observations: ContactObservation[] = [];
  let minimumSwingClearance = Number.POSITIVE_INFINITY;
  let maximumGroundPenetration = 0;
  let minimumFootForwardSpan = Number.POSITIVE_INFINITY;
  let minimumLeadingHeelAdvance = Number.POSITIVE_INFINITY;
  let minimumTrailingHeelRetreat = Number.POSITIVE_INFINITY;
  let minimumLateralStepWidth = Number.POSITIVE_INFINITY;
  let maximumLateralStepWidth = 0;
  let minimumAnatomicalSideMargin = Number.POSITIVE_INFINITY;
  let minimumSupportTransferRatio = Number.POSITIVE_INFINITY;
  const rocker: FootRockerChecks = {
    initialContactToeClearanceMeters: Number.NaN,
    midstanceContactErrorMeters: Number.NaN,
    terminalStanceHeelRiseMeters: Number.NaN,
    terminalStanceToeContactErrorMeters: Number.NaN,
    earlySwingFootPitchDegrees: Number.NaN,
    terminalSwingFootPitchDegrees: Number.NaN,
    terminalSwingToeBendDegrees: Number.NaN,
  };
  const requireRotation = (pose: MotionPose, joint: string) => {
    const rotation = pose[joint]?.rotation;
    if (!rotation) throw new Error(`Baked walk is missing ${joint}:rotation-euler`);
    return rotation;
  };
  for (let index = 0; index <= 400; index++) {
    const phase = index / 400;
    const pose = samplePose(phase);
    const root = pose.root?.translation;
    if (!root) throw new Error('Baked walk is missing root:translation');
    const rootForward = -root[2];
    if (index === 80 || index === 280) {
      const supportSign = index === 80 ? -1 : 1;
      minimumSupportTransferRatio = Math.min(
        minimumSupportTransferRatio,
        (supportSign * root[0]) / (metrics.stepWidth * 0.5),
      );
    }
    const ankleLaterals: Partial<Record<'left' | 'right', number>> = {};
    for (const side of ['left', 'right'] as const) {
      const legPhase = offsetPhase(phase, side === 'left' ? 0.5 : 0);
      const thigh = requireRotation(pose, `${side}-thigh`)[0];
      const knee = requireRotation(pose, `${side}-shin`)[0];
      const foot = requireRotation(pose, `${side}-foot`)[0];
      const toeBend = requireRotation(pose, `${side}-toe`)[0];
      const lateralRotation = requireRotation(pose, `${side}-thigh`)[2];
      const pitch = thigh + knee + foot;
      const ankle = ankleFromLeg(rootForward, root[1], thigh, knee, metrics);
      const { heel: heelRelative, toe: toeRelative } = footLandmarks(pitch, toeBend, metrics);
      const heel = {
        forward: ankle.forward + heelRelative.forward,
        height: ankle.height + heelRelative.height,
      };
      const sideSign = side === 'left' ? 1 : -1;
      const restLateral = sideSign * (metrics.thighRestLateral + metrics.shinRestLateral);
      const restDown = metrics.thighRestDown + metrics.shinRestDown;
      const ankleLateral =
        root[0] +
        sideSign * proportions.hipWidth * 0.5 +
        restLateral * Math.cos(lateralRotation) +
        restDown * Math.sin(lateralRotation);
      ankleLaterals[side] = ankleLateral;
      minimumAnatomicalSideMargin = Math.min(minimumAnatomicalSideMargin, sideSign * ankleLateral);
      const toe = {
        forward: ankle.forward + toeRelative.forward,
        height: ankle.height + toeRelative.height,
      };
      if (side === 'right') {
        if (index === 0) rocker.initialContactToeClearanceMeters = toe.height;
        if (index === 80)
          rocker.midstanceContactErrorMeters = Math.max(
            Math.abs(heel.height),
            Math.abs(toe.height),
          );
        if (index === 232) {
          rocker.terminalStanceHeelRiseMeters = heel.height;
          rocker.terminalStanceToeContactErrorMeters = Math.abs(toe.height);
        }
        if (index === 296) {
          rocker.earlySwingFootPitchDegrees = (pitch * 180) / Math.PI;
        }
        if (index === 368) {
          rocker.terminalSwingFootPitchDegrees = (pitch * 180) / Math.PI;
          rocker.terminalSwingToeBendDegrees = (toeBend * 180) / Math.PI;
        }
      }
      const heelTarget = plantHeelForward(phase, side === 'left' ? 0.5 : 0, metrics);
      const toeTarget = heelTarget + metrics.heelBack + metrics.footLength;
      const heelActive = legPhase < 0.3;
      const toeActive = legPhase >= 0.12 && legPhase < 0.58;
      observations.push({
        contactId: `${side}-heel`,
        phase,
        active: heelActive,
        position: [0, heel.height, heel.forward],
        target: [0, 0, heelTarget],
      });
      observations.push({
        contactId: `${side}-toe`,
        phase,
        active: toeActive,
        position: [0, toe.height, toe.forward],
        target: [0, 0, toeTarget],
      });
      maximumGroundPenetration = Math.max(
        maximumGroundPenetration,
        Math.max(0, -heel.height, -toe.height),
      );
      minimumFootForwardSpan = Math.min(minimumFootForwardSpan, toe.forward - heel.forward);
      if (index === 0) {
        if (side === 'right') minimumLeadingHeelAdvance = heel.forward - rootForward;
        else minimumTrailingHeelRetreat = rootForward - heel.forward;
      }
      if (legPhase >= 0.64 && legPhase <= 0.96)
        minimumSwingClearance = Math.min(minimumSwingClearance, heel.height, toe.height);
    }
    const lateralStepWidth = ankleLaterals.left! - ankleLaterals.right!;
    minimumLateralStepWidth = Math.min(minimumLateralStepWidth, lateralStepWidth);
    maximumLateralStepWidth = Math.max(maximumLateralStepWidth, lateralStepWidth);
  }
  const contacts = evaluatePointContacts(observations);
  const issues: string[] = [];
  const verifyProxyGrounding = options.verifyProxyGrounding ?? true;
  issues.push(...footRockerIssues(rocker, metrics, verifyProxyGrounding));
  if (verifyProxyGrounding) {
    if (!contacts.valid) issues.push('baked active foot contact exceeds 1 cm');
    if (minimumSwingClearance < 0.012) issues.push('baked swing foot clearance below 12 mm');
    if (maximumGroundPenetration > 0.005)
      issues.push('baked foot penetrates ground by more than 5 mm');
  }
  if (minimumFootForwardSpan <= metrics.footLength * 0.3)
    issues.push('a baked foot points behind the anatomical leg instead of forward');
  if (minimumLeadingHeelAdvance <= 0)
    issues.push('baked initial-contact foot is not ahead of the travelling body');
  if (minimumTrailingHeelRetreat <= 0)
    issues.push('baked trailing heel is not behind the travelling body');
  if (minimumLateralStepWidth < metrics.stepWidth * 0.7)
    issues.push('baked feet cross or collapse below the authored walking base');
  if (maximumLateralStepWidth > metrics.stepWidth * 1.3)
    issues.push('baked feet retain an over-wide production-rest stance');
  if (minimumAnatomicalSideMargin <= 0)
    issues.push('a baked foot crosses the anatomical centre line');
  if (minimumSupportTransferRatio < 0.35)
    issues.push('baked pelvis does not transfer far enough toward the support foot');
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      samples: 401,
      proxyGroundingVerified: verifyProxyGrounding,
      maximumContactErrorMeters: contacts.maxContactErrorMeters,
      meanContactErrorMeters: contacts.meanContactErrorMeters,
      worstContact: contacts.worstContact,
      minimumSwingClearanceMeters: minimumSwingClearance,
      maximumGroundPenetrationMeters: maximumGroundPenetration,
      minimumFootForwardSpanMeters: minimumFootForwardSpan,
      initialLeadingHeelAdvanceMeters: minimumLeadingHeelAdvance,
      initialTrailingHeelRetreatMeters: minimumTrailingHeelRetreat,
      targetLateralStepWidthMeters: metrics.stepWidth,
      minimumLateralStepWidthMeters: minimumLateralStepWidth,
      maximumLateralStepWidthMeters: maximumLateralStepWidth,
      minimumAnatomicalSideMarginMeters: minimumAnatomicalSideMargin,
      minimumSupportTransferRatio,
      footRocker: rocker,
    },
  };
}

export function bakedWalkGroundCorrection(
  phase: number,
  pose: MotionPose,
  proportions: GaitProportions,
  style: GaitStyle,
) {
  const metrics = gaitMetrics(proportions, style);
  const root = pose.root?.translation;
  if (!root) throw new Error('Baked walk is missing root:translation');
  const rootForward = -root[2];
  let minimumHeight = Number.POSITIVE_INFINITY;
  for (const side of ['left', 'right'] as const) {
    const thigh = pose[`${side}-thigh`]?.rotation?.[0];
    const knee = pose[`${side}-shin`]?.rotation?.[0];
    const foot = pose[`${side}-foot`]?.rotation?.[0];
    const toeBend = pose[`${side}-toe`]?.rotation?.[0];
    if (thigh === undefined || knee === undefined || foot === undefined || toeBend === undefined)
      throw new Error(`Baked walk is missing ${side} sagittal leg rotations`);
    const pitch = thigh + knee + foot;
    const ankle = ankleFromLeg(rootForward, root[1], thigh, knee, metrics);
    const { heel, toe } = footLandmarks(pitch, toeBend, metrics);
    minimumHeight = Math.min(minimumHeight, ankle.height + heel.height, ankle.height + toe.height);
  }
  return Math.max(0, -minimumHeight);
}

export function verifyNaturalWalk(proportions: GaitProportions, style: GaitStyle) {
  const metrics = gaitMetrics(proportions, style);
  const observations: ContactObservation[] = [];
  const jointSamples: Array<{ joint: string; rotation: Vec3 }> = [];
  let minimumSwingClearance = Number.POSITIVE_INFINITY;
  let maximumGroundPenetration = 0;
  let maximumPelvisStep = 0;
  let minimumFootForwardSpan = Number.POSITIVE_INFINITY;
  let minimumLeadingHeelAdvance = Number.POSITIVE_INFINITY;
  let minimumTrailingHeelRetreat = Number.POSITIVE_INFINITY;
  let minimumLateralStepWidth = Number.POSITIVE_INFINITY;
  let minimumAnatomicalSideMargin = Number.POSITIVE_INFINITY;
  let minimumSupportTransferRatio = Number.POSITIVE_INFINITY;
  const rocker: FootRockerChecks = {
    initialContactToeClearanceMeters: Number.NaN,
    midstanceContactErrorMeters: Number.NaN,
    terminalStanceHeelRiseMeters: Number.NaN,
    terminalStanceToeContactErrorMeters: Number.NaN,
    earlySwingFootPitchDegrees: Number.NaN,
    terminalSwingFootPitchDegrees: Number.NaN,
    terminalSwingToeBendDegrees: Number.NaN,
  };
  let previousRoot: Vec3 | undefined;
  for (let index = 0; index <= 100; index++) {
    const phase = index / 100;
    const result = evaluateNaturalWalk(phase, proportions, style);
    const root = result.pose.root?.translation ?? [0, 0, 0];
    if (previousRoot)
      maximumPelvisStep = Math.max(
        maximumPelvisStep,
        Math.hypot(root[0] - previousRoot[0], root[1] - previousRoot[1]),
      );
    previousRoot = root;
    const lateralStepWidth = result.legs.left.ankleLateral - result.legs.right.ankleLateral;
    minimumLateralStepWidth = Math.min(minimumLateralStepWidth, lateralStepWidth);
    minimumAnatomicalSideMargin = Math.min(
      minimumAnatomicalSideMargin,
      result.legs.left.ankleLateral,
      -result.legs.right.ankleLateral,
    );
    if (index === 20 || index === 70) {
      const supportSign = index === 20 ? -1 : 1;
      minimumSupportTransferRatio = Math.min(
        minimumSupportTransferRatio,
        (supportSign * root[0]) / (metrics.stepWidth * 0.5),
      );
    }
    for (const [joint, pose] of Object.entries(result.pose))
      if (pose.rotation) jointSamples.push({ joint, rotation: pose.rotation });
    for (const [side, leg] of Object.entries(result.legs)) {
      if (side === 'right') {
        if (index === 0) rocker.initialContactToeClearanceMeters = leg.toe.height;
        if (index === 20)
          rocker.midstanceContactErrorMeters = Math.max(
            Math.abs(leg.heel.height),
            Math.abs(leg.toe.height),
          );
        if (index === 58) {
          rocker.terminalStanceHeelRiseMeters = leg.heel.height;
          rocker.terminalStanceToeContactErrorMeters = Math.abs(leg.toe.height);
        }
        if (index === 74) {
          const thigh = leg.pose['right-thigh']!.rotation![0];
          const knee = leg.pose['right-shin']!.rotation![0];
          const foot = leg.pose['right-foot']!.rotation![0];
          rocker.earlySwingFootPitchDegrees = ((thigh + knee + foot) * 180) / Math.PI;
        }
        if (index === 92) {
          const thigh = leg.pose['right-thigh']!.rotation![0];
          const knee = leg.pose['right-shin']!.rotation![0];
          const foot = leg.pose['right-foot']!.rotation![0];
          rocker.terminalSwingFootPitchDegrees = ((thigh + knee + foot) * 180) / Math.PI;
          rocker.terminalSwingToeBendDegrees =
            (leg.pose['right-toe']!.rotation![0] * 180) / Math.PI;
        }
      }
      const toeTarget = leg.heelTarget + result.metrics.heelBack + result.metrics.footLength;
      const heelActive = leg.contact === 'heel' || leg.contact === 'flat';
      const toeActive = leg.contact === 'flat' || leg.contact === 'toe';
      observations.push({
        contactId: `${side}-heel`,
        phase,
        active: heelActive,
        position: [0, leg.heel.height, leg.heel.forward],
        target: [0, 0, leg.heelTarget],
      });
      observations.push({
        contactId: `${side}-toe`,
        phase,
        active: toeActive,
        position: [0, leg.toe.height, leg.toe.forward],
        target: [0, 0, toeTarget],
      });
      maximumGroundPenetration = Math.max(
        maximumGroundPenetration,
        Math.max(0, -leg.heel.height, -leg.toe.height),
      );
      minimumFootForwardSpan = Math.min(minimumFootForwardSpan, leg.toe.forward - leg.heel.forward);
      if (phase === 0) {
        if (side === 'right') minimumLeadingHeelAdvance = leg.heel.forward - root[2] * -1;
        if (side === 'left') minimumTrailingHeelRetreat = root[2] * -1 - leg.heel.forward;
      }
      if (leg.contact === 'swing' && leg.phase >= 0.64 && leg.phase <= 0.96)
        minimumSwingClearance = Math.min(minimumSwingClearance, leg.heel.height, leg.toe.height);
    }
  }
  const contacts = evaluatePointContacts(observations);
  const restKneeBend =
    Math.atan2(metrics.shinRestForward, metrics.shinRestDown) -
    Math.atan2(metrics.thighRestForward, metrics.thighRestDown);
  const limits = evaluateJointLimits(jointSamples, {
    'left-thigh': {
      minimum: [radians(-45), radians(-10), radians(-20)],
      maximum: [radians(50), radians(10), radians(20)],
    },
    'right-thigh': {
      minimum: [radians(-45), radians(-10), radians(-20)],
      maximum: [radians(50), radians(10), radians(20)],
    },
    'left-shin': {
      minimum: [radians(-85) - restKneeBend, radians(-5), radians(-5)],
      maximum: [radians(2) - restKneeBend, radians(5), radians(5)],
    },
    'right-shin': {
      minimum: [radians(-85) - restKneeBend, radians(-5), radians(-5)],
      maximum: [radians(2) - restKneeBend, radians(5), radians(5)],
    },
    'left-foot': {
      minimum: [radians(-65), radians(-5), radians(-5)],
      maximum: [radians(65), radians(5), radians(5)],
    },
    'right-foot': {
      minimum: [radians(-65), radians(-5), radians(-5)],
      maximum: [radians(65), radians(5), radians(5)],
    },
    'left-toe': {
      minimum: [radians(-5), radians(-3), radians(-3)],
      maximum: [radians(50), radians(3), radians(3)],
    },
    'right-toe': {
      minimum: [radians(-5), radians(-3), radians(-3)],
      maximum: [radians(50), radians(3), radians(3)],
    },
  });
  const issues: string[] = [];
  if (!contacts.valid) issues.push('active foot contact exceeds 1 cm');
  if (!limits.valid) issues.push('joint limit violation');
  if (minimumSwingClearance < 0.012) issues.push('swing foot clearance below 12 mm');
  if (maximumGroundPenetration > 0.005) issues.push('foot penetrates ground by more than 5 mm');
  if (metrics.strideLength > proportions.legLength * 1.45)
    issues.push('stride exceeds proportion limit');
  if (minimumFootForwardSpan <= metrics.footLength * 0.3)
    issues.push('a foot points behind the anatomical leg instead of forward');
  if (minimumLeadingHeelAdvance <= 0)
    issues.push('initial-contact foot is not ahead of the travelling body');
  if (minimumTrailingHeelRetreat <= 0)
    issues.push('trailing heel is not behind the travelling body');
  if (minimumLateralStepWidth < metrics.stepWidth * 0.99)
    issues.push('analytic feet cross or collapse below the authored walking base');
  if (minimumAnatomicalSideMargin <= 0)
    issues.push('an analytic foot crosses the anatomical centre line');
  if (minimumSupportTransferRatio < 0.35)
    issues.push('pelvis does not transfer far enough toward the single-support foot');
  issues.push(...footRockerIssues(rocker, metrics));
  return {
    valid: issues.length === 0,
    issues,
    checks: {
      style: style.id,
      phaseModel: naturalWalkDesign.phases.map((phase) => phase.id),
      strideLengthMeters: metrics.strideLength,
      cadenceStepsPerMinute: style.cadenceStepsPerMinute,
      speedMetersPerSecond: metrics.strideLength / metrics.durationSeconds,
      maximumContactErrorMeters: contacts.maxContactErrorMeters,
      worstContact: contacts.worstContact,
      minimumSwingClearanceMeters: minimumSwingClearance,
      maximumGroundPenetrationMeters: maximumGroundPenetration,
      maximumPelvisStepMeters: maximumPelvisStep,
      minimumFootForwardSpanMeters: minimumFootForwardSpan,
      initialLeadingHeelAdvanceMeters: minimumLeadingHeelAdvance,
      initialTrailingHeelRetreatMeters: minimumTrailingHeelRetreat,
      targetLateralStepWidthMeters: metrics.stepWidth,
      minimumLateralStepWidthMeters: minimumLateralStepWidth,
      minimumAnatomicalSideMarginMeters: minimumAnatomicalSideMargin,
      minimumSupportTransferRatio,
      footRocker: rocker,
      jointLimitViolations: limits.violations,
    },
  };
}
